// ===================== A very small IndexedDB key/value store =====================
// The channel list is several megabytes once parsed – too much for localStorage, and worth keeping
// between visits so the viewer opens instantly. IndexedDB holds it without a quota fight and
// without a dependency; every call resolves to null rather than throwing when storage is refused
// (private windows, disabled storage), so the caller simply falls back to the network.

const DB_NAME = 'veditor-iptv';
const STORE = 'cache';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return open().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let req: IDBRequest;
      try { req = body(db.transaction(STORE, mode).objectStore(STORE)); } catch { db.close(); resolve(null); return; }
      req.onsuccess = () => { resolve(req.result as T); db.close(); };
      req.onerror = () => { resolve(null); db.close(); };
    });
  });
}

export function idbGet<T>(key: string): Promise<T | null> {
  return run<T>('readonly', (store) => store.get(key));
}

export function idbSet(key: string, value: unknown): Promise<unknown> {
  return run('readwrite', (store) => store.put(value, key));
}

export function idbDelete(key: string): Promise<unknown> {
  return run('readwrite', (store) => store.delete(key));
}
