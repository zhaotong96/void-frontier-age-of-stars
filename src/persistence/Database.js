/**
 * persistence/Database.js — IndexedDB 封装（任务书 8.1）
 *
 * 单库两 store：saves（存档记录）与 meta（轻量索引）。
 * 所有写操作在事务内完成；不支持 IndexedDB 的环境（file:// 某些浏览器）
 * 退化为内存实现并给出警告（测试可用）。
 */

const DB_NAME = 'void-frontier';
const DB_VERSION = 1;
const STORE_SAVES = 'saves';
const STORE_META = 'meta';

let memoryMode = false;
const memory = { saves: new Map(), meta: new Map() };

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      memoryMode = true;
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        db.createObjectStore(STORE_SAVES, { keyPath: 'slotId' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return db().then((database) => {
    if (memoryMode || !database) return fn(null);
    return new Promise((resolve, reject) => {
      const t = database.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const result = fn(store);
      t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('事务中止'));
    });
  });
}

function reqValue(request) {
  const holder = { __value: undefined };
  request.onsuccess = () => {
    holder.__value = request.result;
  };
  return holder;
}

export const Database = {
  isMemoryMode() {
    return memoryMode;
  },

  /** 写入存档槽（整条记录覆盖） */
  async putSave(record) {
    if (memoryMode) {
      memory.saves.set(record.slotId, record);
      return;
    }
    await tx(STORE_SAVES, 'readwrite', (store) => {
      store.put(record);
    });
  },

  async getSave(slotId) {
    if (memoryMode) return memory.saves.get(slotId) || null;
    const holder = await tx(STORE_SAVES, 'readonly', (store) => reqValue(store.get(slotId)));
    return holder?.__value ?? null;
  },

  async deleteSave(slotId) {
    if (memoryMode) {
      memory.saves.delete(slotId);
      return;
    }
    await tx(STORE_SAVES, 'readwrite', (store) => {
      store.delete(slotId);
    });
  },

  async listSaves() {
    if (memoryMode) return [...memory.saves.values()];
    const holder = await tx(STORE_SAVES, 'readonly', (store) => reqValue(store.getAll()));
    return (holder?.__value || []).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  },

  async setMeta(k, v) {
    if (memoryMode) {
      memory.meta.set(k, v);
      return;
    }
    await tx(STORE_META, 'readwrite', (store) => {
      store.put({ k, v });
    });
  },

  async getMeta(k) {
    if (memoryMode) return memory.meta.get(k) ?? null;
    const holder = await tx(STORE_META, 'readonly', (store) => reqValue(store.get(k)));
    return holder?.__value?.v ?? null;
  },
};
