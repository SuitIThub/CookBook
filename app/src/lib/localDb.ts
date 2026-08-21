/**
 * Local database bootstrap: runs the shared CookbookDatabase against sql.js,
 * persisting the serialized DB in IndexedDB (large enough for our ~12MB dataset;
 * localStorage is not). On device this persistence layer will move to the
 * Capacitor Filesystem, but the CookbookDatabase/driver seam stays the same.
 */
import { CookbookDatabase } from '@core/database';
import { createSqlJsDriver, SqlJsDriver } from './sqlJsDriver';

const IDB_NAME = 'kochbuch-local';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'db-bytes';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | undefined> {
  const idb = await openIdb();
  try {
    return await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    idb.close();
  }
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

export interface LocalDb {
  db: CookbookDatabase;
  driver: SqlJsDriver;
  /** Serialize + persist the current state to IndexedDB. */
  persist(): Promise<void>;
}

let instance: LocalDb | null = null;
let pending: Promise<LocalDb> | null = null;

export function getLocalDb(): Promise<LocalDb> {
  if (instance) return Promise.resolve(instance);
  if (pending) return pending;
  pending = (async () => {
    const bytes = await loadBytes();
    const driver = await createSqlJsDriver(bytes);
    // CookbookDatabase.initTables() is idempotent (CREATE TABLE IF NOT EXISTS +
    // guarded ALTERs), so this both creates a fresh schema and migrates a loaded one.
    const db = new CookbookDatabase(driver);
    instance = {
      db,
      driver,
      persist: async () => {
        await saveBytes(driver.export());
      }
    };
    return instance;
  })();
  return pending;
}

/** Drop the in-memory instance and the persisted bytes (dev/testing). */
export async function resetLocalDb(): Promise<void> {
  instance?.driver.close();
  instance = null;
  pending = null;
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}
