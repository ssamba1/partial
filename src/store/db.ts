export interface RecordingEntry {
  id: string;
  name: string;
  created: number;
  duration: number;
  mime: string;
  blob: Blob;
}

export interface ScoreEntry {
  id: string;
  name: string;
  added: number;
  lastPage: number;
  blob: Blob;
}

type StoreName = 'recordings' | 'scores';

const DB_NAME = 'resonare';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Local storage for files is not available in this browser.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('scores')) db.createObjectStore('scores', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Could not open local database.'));
      };
    });
  }
  return dbPromise;
}

function request<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted (storage may be full).'));
      }),
  );
}

export const db = {
  list<T extends RecordingEntry | ScoreEntry>(store: StoreName): Promise<T[]> {
    return request<T[]>(store, 'readonly', (s) => s.getAll());
  },
  get<T>(store: StoreName, id: string): Promise<T | undefined> {
    return request<T | undefined>(store, 'readonly', (s) => s.get(id));
  },
  put(store: StoreName, value: RecordingEntry | ScoreEntry): Promise<void> {
    return request<IDBValidKey>(store, 'readwrite', (s) => s.put(value)).then(() => undefined);
  },
  delete(store: StoreName, id: string): Promise<void> {
    return request<undefined>(store, 'readwrite', (s) => s.delete(id));
  },
};
