/*
 * Small IndexedDB helper for user media (avatar, wallpaper).
 *
 * localStorage was the obvious place for these, but it stores strings: an image
 * has to become a base64 data URL (~1.37x the bytes) and browsers charge 2 bytes
 * per character, so a 4K wallpaper blows through the ~5MB quota. IndexedDB holds
 * the Blob as-is with a quota measured in hundreds of MB, so images are stored at
 * full resolution with no downscaling.
 */

const DB_NAME = 'inout-portal';
const STORE = 'media';
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.onabort = () => reject(tx.error);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const idbGet = (key) => run('readonly', (store) => store.get(key));
export const idbSet = (key, blob) => run('readwrite', (store) => store.put(blob, key));
export const idbDelete = (key) => run('readwrite', (store) => store.delete(key));
