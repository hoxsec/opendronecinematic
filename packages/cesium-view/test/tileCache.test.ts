import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTileUrl, TileCache, tileCache, tileCacheKey, tileExpiry } from '../src/tileCache';
import { cachedLoadWithXhr } from '../src/tileCacheAdapter';

const now = Date.parse('2026-10-29T12:00:00Z');
const headers = (extra: Record<string, string> = {}) =>
  new Headers({
    'cache-control': 'private, max-age=3600',
    date: new Date(now).toUTCString(),
    ...extra,
  });

describe('tile HTTP cache policy', () => {
  it('honors private max-age, Age, Date and request delay', () => {
    expect(tileExpiry(headers(), now, now + 1000)).toBe(now + 3600_000);
    expect(tileExpiry(headers({ age: '120' }), now, now + 1000)).toBe(now + 3480_000);
    expect(tileExpiry(headers({ date: new Date(now - 600_000).toUTCString() }), now, now)).toBe(
      now + 3000_000,
    );
  });
  it('uses explicit Expires when max-age is absent', () => {
    expect(
      tileExpiry(
        headers({ 'cache-control': 'private', expires: new Date(now + 5000).toUTCString() }),
        now,
        now,
      ),
    ).toBe(now + 5000);
  });
  it.each([
    'no-store, max-age=3600',
    'no-cache, max-age=3600',
    'no-cache="ETag", max-age=3600',
    'max-age=0',
    'max-age=oops',
    'max-age=-1',
    's-maxage=3600',
    '',
  ])('does not reuse %s', (control) => {
    expect(tileExpiry(headers({ 'cache-control': control }), now, now)).toBeUndefined();
  });
  it('never serves stale content even with stale-while-revalidate', () => {
    expect(
      tileExpiry(
        headers({ 'cache-control': 'max-age=1, stale-while-revalidate=300, must-revalidate' }),
        now,
        now + 2000,
      ),
    ).toBeUndefined();
  });
  it('refuses Vary *, hidden age information and malformed Age', () => {
    expect(tileExpiry(headers({ vary: '*' }), now, now)).toBeUndefined();
    expect(tileExpiry(new Headers({ 'cache-control': 'max-age=3600' }), now, now)).toBeUndefined();
    expect(tileExpiry(headers({ age: 'bad' }), now, now)).toBeUndefined();
  });
  it('only targets Google 3D and Cesium asset hosts', () => {
    expect(isTileUrl('https://tile.googleapis.com/v1/3dtiles/a.glb?session=x')).toBe(true);
    expect(isTileUrl('https://assets.cesium.com/123/a.b3dm')).toBe(true);
    for (const url of [
      'http://assets.cesium.com/a',
      'https://api.cesium.com/v1/assets/1/endpoint',
      'https://assets.cesium.com.evil.test/a',
      'https://tile.googleapis.com/v1/2dtiles/a',
      'garbage',
    ]) {
      expect(isTileUrl(url)).toBe(false);
    }
  });
  it('keys isolate LODs, sessions and tokens without saving credentials in plaintext', async () => {
    const url = 'https://assets.cesium.com/a.glb?level=20';
    const key = await tileCacheKey(url, { Authorization: 'Bearer secret' });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await tileCacheKey(url, { authorization: 'Bearer secret' })).toBe(key);
    expect(await tileCacheKey(url, { authorization: 'Bearer other' })).not.toBe(key);
    expect(await tileCacheKey(url + '&session=other', { authorization: 'Bearer secret' })).not.toBe(
      key,
    );
    expect(
      await tileCacheKey(url.replace('20', '19'), { authorization: 'Bearer secret' }),
    ).not.toBe(key);
  });
});

describe('persistent tile storage', () => {
  const cache = new TileCache(10);
  beforeEach(async () => {
    await cache.clear();
  });
  afterEach(() => vi.restoreAllMocks());
  it('stores byte-exact payloads and reopens across cache instances', async () => {
    const body = Uint8Array.from([0, 10, 255, 80]).buffer;
    await cache.put('detailed', body, Date.now() + 60_000);
    expect(new Uint8Array((await new TileCache(10).get('detailed'))!)).toEqual(
      new Uint8Array(body),
    );
    expect(await cache.stats()).toEqual({ bytes: 4, tiles: 1 });
  });
  it('evicts the least recently used tile without downgrading other tiles', async () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(now);
    await cache.put('fine', new ArrayBuffer(4), now + 60_000);
    clock.mockReturnValue(now + 1);
    await cache.put('coarse', new ArrayBuffer(4), now + 60_000);
    clock.mockReturnValue(now + 2);
    await cache.get('fine');
    clock.mockReturnValue(now + 3);
    await cache.put('new', new ArrayBuffer(4), now + 60_000);
    expect(await cache.get('coarse')).toBeUndefined();
    expect(await cache.get('fine')).toBeInstanceOf(ArrayBuffer);
    expect(await cache.stats()).toEqual({ bytes: 8, tiles: 2 });
  });
  it('removes expired entries and never falls back to stale data', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await cache.put('tile', new ArrayBuffer(4), now + 10);
    clock.mockReturnValue(now + 10);
    expect(await cache.get('tile')).toBeUndefined();
    expect(await cache.stats()).toEqual({ bytes: 0, tiles: 0 });
  });
  it('accounts for replacements, skips oversized entries, and clears only this cache', async () => {
    await cache.put('tile', new ArrayBuffer(4), Date.now() + 60_000);
    await cache.put('tile', new ArrayBuffer(7), Date.now() + 60_000);
    await cache.put('huge', new ArrayBuffer(11), Date.now() + 60_000);
    expect(await cache.stats()).toEqual({ bytes: 7, tiles: 1 });
    await cache.clear();
    expect(await cache.stats()).toEqual({ bytes: 0, tiles: 0 });
  });
  it('recovers from a smaller webview quota by evicting its own LRU entries', async () => {
    await cache.put('old', new ArrayBuffer(4), Date.now() + 60_000);
    await cache.put('other', new ArrayBuffer(4), Date.now() + 60_000);
    const put = IDBObjectStore.prototype.put;
    let fail = true;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      if (this.name === 'bodies' && fail) {
        fail = false;
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return put.apply(this, args);
    });
    await cache.put('new', new ArrayBuffer(4), Date.now() + 60_000);
    expect(await cache.get('new')).toBeInstanceOf(ArrayBuffer);
    expect(await cache.stats()).toEqual({ bytes: 4, tiles: 1 });
  });
});

describe('Cesium tile cache adapter', () => {
  const url = 'https://tile.googleapis.com/v1/3dtiles/a.glb?session=one';
  beforeEach(() => {
    vi.spyOn(tileCache, 'get').mockResolvedValue(undefined);
    vi.spyOn(tileCache, 'put').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('serves cache hits without a network request', async () => {
    const body = new ArrayBuffer(4);
    vi.mocked(tileCache.get).mockResolvedValue(body);
    const original = vi.fn();
    const deferred = { resolve: vi.fn(), reject: vi.fn() };
    cachedLoadWithXhr(original)(url, 'arraybuffer', 'GET', undefined, {}, deferred);
    await vi.waitFor(() => expect(deferred.resolve).toHaveBeenCalledWith(body));
    expect(original).not.toHaveBeenCalled();
  });
  it('keeps network payloads byte-exact and copies before decoder detachment', async () => {
    const xhr = {
      abort: vi.fn(),
      status: 200,
      withCredentials: false,
      getAllResponseHeaders: () =>
        `cache-control: private, max-age=3600\r\ndate: ${new Date().toUTCString()}`,
    };
    const original = vi.fn(() => xhr);
    const deferred = { resolve: vi.fn(), reject: vi.fn() };
    cachedLoadWithXhr(original)(url, 'arraybuffer', 'GET', undefined, {}, deferred);
    await vi.waitFor(() => expect(original).toHaveBeenCalled());
    const body = Uint8Array.from([1, 4, 255]).buffer;
    const networkDeferred = (original.mock.calls[0] as unknown as unknown[])[5] as typeof deferred;
    networkDeferred.resolve(body);
    expect(deferred.resolve).toHaveBeenCalledWith(body);
    expect(tileCache.put).toHaveBeenCalled();
    const saved = vi.mocked(tileCache.put).mock.calls[0]![1];
    expect(saved).not.toBe(body);
    expect(new Uint8Array(saved)).toEqual(new Uint8Array(body));
  });
  it('falls back to normal XHR when persistent storage fails', async () => {
    vi.mocked(tileCache.get).mockRejectedValue(new Error('storage unavailable'));
    const original = vi.fn();
    cachedLoadWithXhr(original)(
      url,
      'arraybuffer',
      'GET',
      undefined,
      {},
      { resolve() {}, reject() {} },
    );
    await vi.waitFor(() => expect(original).toHaveBeenCalled());
  });
  it('does not store responses that prohibit caching', async () => {
    const original = vi.fn(() => ({
      abort() {},
      status: 200,
      withCredentials: false,
      getAllResponseHeaders: () => 'cache-control: no-store',
    }));
    const deferred = { resolve: vi.fn(), reject: vi.fn() };
    cachedLoadWithXhr(original)(url, 'arraybuffer', 'GET', undefined, {}, deferred);
    await vi.waitFor(() => expect(original).toHaveBeenCalled());
    const networkDeferred = (original.mock.calls[0] as unknown as unknown[])[5] as typeof deferred;
    networkDeferred.resolve(new ArrayBuffer(4));
    expect(deferred.resolve).toHaveBeenCalled();
    expect(tileCache.put).not.toHaveBeenCalled();
  });
  it('forwards cancellation once the network request has started', async () => {
    const abort = vi.fn();
    const original = vi.fn(() => ({ abort }));
    const request = cachedLoadWithXhr(original)(
      url,
      'arraybuffer',
      'GET',
      undefined,
      {},
      { resolve() {}, reject() {} },
    );
    await vi.waitFor(() => expect(original).toHaveBeenCalled());
    request!.abort();
    expect(abort).toHaveBeenCalledOnce();
  });
  it('preserves cancellation before the cache lookup finishes', async () => {
    let finish!: (value: ArrayBuffer | undefined) => void;
    vi.mocked(tileCache.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const original = vi.fn();
    const deferred = { resolve: vi.fn(), reject: vi.fn() };
    const request = cachedLoadWithXhr(original)(url, 'arraybuffer', 'GET', undefined, {}, deferred);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    request!.abort();
    finish(new ArrayBuffer(4));
    await Promise.resolve();
    expect(original).not.toHaveBeenCalled();
    expect(deferred.resolve).not.toHaveBeenCalled();
  });
  it('bypasses cache for ranges, explicit revalidation, manifests and other providers', () => {
    const original = vi.fn();
    const load = cachedLoadWithXhr(original);
    const deferred = { resolve() {}, reject() {} };
    load(url, 'arraybuffer', 'GET', undefined, { Range: 'bytes=0-100' }, deferred);
    load(url, 'arraybuffer', 'GET', undefined, { 'Cache-Control': 'no-cache' }, deferred);
    load(url, 'text', 'GET', undefined, {}, deferred);
    load('https://example.com/tile.glb', 'arraybuffer', 'GET', undefined, {}, deferred);
    expect(original).toHaveBeenCalledTimes(4);
    expect(tileCache.get).not.toHaveBeenCalled();
  });
});
