// The GeoTIFF DEM can be tens of megabytes, too big for localStorage, so the raw file is kept
// in IndexedDB and decoded again on startup. Works the same in Tauri and the browser.

const DB = 'odc';
const STORE = 'files';
const KEY = 'dem';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveDemFile = (data: ArrayBuffer) => run('readwrite', (s) => s.put(data, KEY));
export const loadDemFile = () =>
  run<ArrayBuffer | undefined>('readonly', (s) => s.get(KEY)).catch(() => undefined);
export const clearDemFile = () => run('readwrite', (s) => s.delete(KEY));
