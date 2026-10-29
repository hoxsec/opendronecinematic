/** A private, per-app cache. Never strips tokens, session IDs or tile/LOD parameters. */
export const TILE_CACHE_LIMIT = 10_000_000_000;
const DATABASE = 'odc-tile-cache-v1';

export interface TileEntry {
  id: string;
  expires: number;
  accessed: number;
  size: number;
}

/** Conservative HTTP caching: only explicitly fresh responses, never stale/offline reuse. */
export function tileExpiry(headers: Headers, started: number, now: number): number | undefined {
  const control = headers.get('cache-control') ?? '';
  const directives = new Map(
    control.split(',').map((part) => {
      const [name, ...value] = part.trim().split('=');
      return [(name ?? '').toLowerCase(), value.join('=').replace(/^"|"$/g, '')];
    }),
  );
  if (
    directives.has('no-store') ||
    directives.has('no-cache') ||
    headers
      .get('vary')
      ?.split(',')
      .some((v) => v.trim() === '*')
  )
    return;
  // No heuristic expiry, and s-maxage is deliberately ignored: this is a private cache.
  const maxAge = directives.get('max-age');
  const date = Date.parse(headers.get('date') ?? '');
  const expires = Date.parse(headers.get('expires') ?? '');
  // Cross-origin headers can be hidden. Without evidence of response age, do not
  // start a fresh lifetime on an already-aged browser/proxy response.
  if (!Number.isFinite(date) && !headers.has('age')) return;
  const lifetime =
    maxAge !== undefined ? (/^\d+$/.test(maxAge) ? Number(maxAge) * 1000 : NaN) : expires - date;
  const ageValue = headers.get('age') ?? '0';
  if (!/^\d+$/.test(ageValue)) return;
  const age = Math.max(
    Number.isFinite(date) ? Math.max(0, now - date) : 0,
    Number(ageValue) * 1000 + Math.max(0, now - started),
  );
  const remaining = lifetime - age;
  if (!Number.isFinite(remaining) || remaining <= 0) return;
  return now + remaining;
}

export function isTileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (u.hostname === 'assets.cesium.com' ||
        (u.hostname === 'tile.googleapis.com' && u.pathname.startsWith('/v1/3dtiles/')))
    );
  } catch {
    return false;
  }
}

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const complete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Tile cache transaction aborted'));
    transaction.onerror = () => {}; // onabort handles failure, including quota exhaustion.
  });

export class TileCache {
  private database?: Promise<IDBDatabase>;
  private budget: number;
  constructor(readonly limit = TILE_CACHE_LIMIT) {
    this.budget = limit;
  }

  private open(): Promise<IDBDatabase> {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('accessed', 'accessed');
        db.createObjectStore('bodies');
        db.createObjectStore('stats');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Tile cache database is blocked'));
    }));
  }

  async get(id: string): Promise<ArrayBuffer | undefined> {
    const db = await this.open();
    const tx = db.transaction(['entries', 'bodies', 'stats'], 'readwrite');
    const done = complete(tx);
    const entries = tx.objectStore('entries');
    // Handle transaction failure even when an individual request rejects first.
    try {
      const entry: TileEntry | undefined = await result(entries.get(id));
      let body: ArrayBuffer | undefined;
      if (entry && entry.expires > Date.now()) {
        body = await result(tx.objectStore('bodies').get(id));
        entries.put({ ...entry, accessed: Date.now() });
      } else if (entry) {
        const total = (await result(tx.objectStore('stats').get('bytes'))) ?? 0;
        entries.delete(id);
        tx.objectStore('bodies').delete(id);
        tx.objectStore('stats').put(Math.max(0, total - entry.size), 'bytes');
      }
      await done;
      return body;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await done.catch(() => {});
      throw e;
    }
  }

  async put(id: string, body: ArrayBuffer, expires: number): Promise<void> {
    try {
      await this.write(id, body, expires);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
      // Webview/browser quotas may be smaller than 10 GB. Free only our own LRU
      // entries and retry once; never touch downloaded countries, DEMs or missions.
      const { bytes } = await this.stats();
      this.budget = Math.min(this.budget, Math.max(body.byteLength, Math.floor(bytes * 0.8)));
      await this.write(id, body, expires);
    }
  }

  private async write(id: string, body: ArrayBuffer, expires: number): Promise<void> {
    if (body.byteLength > this.budget || expires <= Date.now()) return;
    const db = await this.open();
    const tx = db.transaction(['entries', 'bodies', 'stats'], 'readwrite');
    const done = complete(tx);
    try {
      const entries = tx.objectStore('entries');
      const bodies = tx.objectStore('bodies');
      const stats = tx.objectStore('stats');
      const old: TileEntry | undefined = await result(entries.get(id));
      let total = ((await result(stats.get('bytes'))) ?? 0) - (old?.size ?? 0);
      entries.delete(id);
      bodies.delete(id);
      // Evict in least-recently-used order before adding the original, full-quality payload.
      await new Promise<void>((resolve, reject) => {
        const request = entries.index('accessed').openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || total + body.byteLength <= this.budget) return resolve();
          const entry = cursor.value as TileEntry;
          total -= entry.size;
          cursor.delete();
          bodies.delete(entry.id);
          cursor.continue();
        };
      });
      bodies.put(body, id);
      entries.put({ id, expires, accessed: Date.now(), size: body.byteLength } satisfies TileEntry);
      stats.put(total + body.byteLength, 'bytes');
      await done;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await done.catch(() => {});
      throw e;
    }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['entries', 'bodies', 'stats'], 'readwrite');
    const done = complete(tx);
    for (const name of ['entries', 'bodies', 'stats']) tx.objectStore(name).clear();
    await done;
    this.budget = this.limit;
  }

  async stats(): Promise<{ bytes: number; tiles: number }> {
    const db = await this.open();
    const tx = db.transaction(['entries', 'stats'], 'readonly');
    const done = complete(tx);
    const [bytes, tiles] = await Promise.all([
      result(tx.objectStore('stats').get('bytes')),
      result(tx.objectStore('entries').count()),
    ]);
    await done;
    return { bytes: bytes ?? 0, tiles };
  }
}

export const tileCache = new TileCache();

export async function tileCacheKey(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const canonical = [...new Headers(headers)].sort(([a], [b]) => a.localeCompare(b));
  const bytes = new TextEncoder().encode(JSON.stringify([url, canonical]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
