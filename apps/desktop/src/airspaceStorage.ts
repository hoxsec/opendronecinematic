/** One bounded, user-imported layer, separate from projects, terrain and tile caches. */
export interface StoredAirspace {
  fileName: string;
  json: string;
  importedAt: number;
  visible: boolean;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('odc-airspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('layers');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('layers', mode);
      const request = action(tx.objectStore('layers'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Airspace storage transaction aborted.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const loadAirspace = () =>
  transaction<StoredAirspace | undefined>('readonly', (s) => s.get('active'));
export const saveAirspace = (layer: StoredAirspace) =>
  transaction('readwrite', (s) => s.put(layer, 'active'));
export const deleteAirspace = () => transaction('readwrite', (s) => s.delete('active'));
