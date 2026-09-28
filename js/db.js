// IndexedDB 轻封装：课表（schedule）、笔记（notes）、总结（summaries）

const DB_NAME = 'ds-db';
const DB_VERSION = 1;
let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('schedule')) {
        const s = db.createObjectStore('schedule', { keyPath: 'id' });
        s.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const n = db.createObjectStore('notes', { keyPath: 'id' });
        n.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('summaries')) {
        const m = db.createObjectStore('summaries', { keyPath: 'id' });
        m.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  put: (store, val) => tx(store, 'readwrite', s => s.put(val)),
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  getAll: (store) => tx(store, 'readonly', s => s.getAll()),
  delete: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  byIndex: (store, index, key) => tx(store, 'readonly', s => s.index(index).getAll(key)),
};
