const DB_NAME = 'gpt-node-studio-images-v1';
const STORE = 'images';
type ImageRecord = { readonly key: string; readonly url: string };
const scopedKey = (projectId: string, key: string) => `project:${encodeURIComponent(projectId)}:${key}`;

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveImageRecords(records: readonly ImageRecord[], projectId: string) {
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const prefix = scopedKey(projectId, '');
      const retained = new Set(records.map((record) => scopedKey(projectId, record.key)));
      const cursor = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (typeof entry.key === 'string' && !retained.has(entry.key)) entry.delete();
        entry.continue();
      };
      records.forEach((record) => store.put(record.url, scopedKey(projectId, record.key)));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function loadImageRecords(keys: readonly string[], projectId: string, legacy = false): Promise<Record<string, string>> {
  const db = await openImageDb();
  const result: Record<string, string> = {};
  try {
    await Promise.all(keys.map((key) => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const request = store.get(scopedKey(projectId, key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (typeof request.result === 'string') { result[key] = request.result; resolve(); return; }
        if (!legacy) { resolve(); return; }
        const previous = store.get(key);
        previous.onsuccess = () => { if (typeof previous.result === 'string') result[key] = previous.result; resolve(); };
        previous.onerror = () => reject(previous.error);
      };
    })));
    return result;
  } finally { db.close(); }
}
export async function deleteImageRecords(keys: readonly string[], projectId: string) {
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      keys.forEach((key) => transaction.objectStore(STORE).delete(scopedKey(projectId, key)));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function deleteProjectImageRecords(projectId: string) {
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const prefix = scopedKey(projectId, '');
      transaction.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
