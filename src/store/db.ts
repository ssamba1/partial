import type { Stroke } from '../core/ink';

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
  pageCount?: number;
  /** Tempo last used with this piece. */
  bpm?: number;
  /** Small JPEG data URL of page one, for the library grid. */
  thumb?: string;
  blob: Blob;
}

export interface AnnotationEntry {
  /** `${scoreId}:${page}` */
  id: string;
  scoreId: string;
  page: number;
  strokes: Stroke[];
}

interface Stores {
  recordings: RecordingEntry;
  scores: ScoreEntry;
  annotations: AnnotationEntry;
}
type StoreName = keyof Stores;

const DB_NAME = 'partial';
const DB_VERSION = 2;
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
        if (!db.objectStoreNames.contains('annotations')) db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('scoreId', 'scoreId');
      };
      req.onblocked = () => {
        // Another tab still has the old database version open.
        dbPromise = null;
        reject(new Error('Partial is open in another tab with an older version. Close that tab and try again.'));
      };
      req.onsuccess = () => {
        const database = req.result;
        // Let a newer version in another tab upgrade: close this connection and reopen on next use.
        database.onversionchange = () => {
          database.close();
          dbPromise = null;
        };
        resolve(database);
      };
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
  list<K extends StoreName>(store: K): Promise<Stores[K][]> {
    return request<Stores[K][]>(store, 'readonly', (s) => s.getAll());
  },
  get<K extends StoreName>(store: K, id: string): Promise<Stores[K] | undefined> {
    return request<Stores[K] | undefined>(store, 'readonly', (s) => s.get(id));
  },
  put<K extends StoreName>(store: K, value: Stores[K]): Promise<void> {
    return request<IDBValidKey>(store, 'readwrite', (s) => s.put(value)).then(() => undefined);
  },
  delete(store: StoreName, id: string): Promise<void> {
    return request<undefined>(store, 'readwrite', (s) => s.delete(id));
  },
  /** Removes every annotation page belonging to a score. */
  async deleteAnnotationsFor(scoreId: string): Promise<void> {
    const keys = await request<IDBValidKey[]>('annotations', 'readonly', (s) => s.index('scoreId').getAllKeys(IDBKeyRange.only(scoreId)));
    await Promise.all(keys.map((k) => db.delete('annotations', String(k))));
  },
};
