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
  return new Promise((resolve) => {
    // 三级降级：IndexedDB 打开失败（file:// 沙箱/隐私模式/安全策略）→
    // 不 reject，转入 localStorage/内存分层，绝不向外抛出异常
    try {
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
      req.onerror = () => {
        memoryMode = true;
        resolve(null);
      };
      req.onblocked = () => {
        memoryMode = true;
        resolve(null);
      };
    } catch (e) {
      memoryMode = true;
      resolve(null);
    }
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDb().catch(() => {
      memoryMode = true;
      return null;
    });
  }
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return db().then((database) => {
    if (memoryMode || !database) return fn(null);
    return new Promise((resolve, reject) => {
      const t = database.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const result = fn(store);
      // 统一返回 reqValue 的 holder（调用方用 holder.__value 取值，防双重解包）
      t.oncomplete = () => resolve(result);
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

/** localStorage 第三层（仅 memoryMode 时启用；超限静默跳过） */
const LS_PREFIX = 'vf-save:';

function lsPut(record) {
  try {
    const text = JSON.stringify(record);
    if (text.length > 4 * 1024 * 1024) return; // 超出 localStorage 配额预算
    localStorage.setItem(LS_PREFIX + record.slotId, text);
  } catch { /* 隐私模式/配额：静默 */ }
}

function lsGet(slotId) {
  try {
    const text = localStorage.getItem(LS_PREFIX + slotId);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function lsList() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        try {
          out.push(JSON.parse(localStorage.getItem(k)));
        } catch { /* 忽略损坏条目 */ }
      }
    }
  } catch { /* ignore */ }
  return out;
}

function lsDelete(slotId) {
  try {
    localStorage.removeItem(LS_PREFIX + slotId);
  } catch { /* ignore */ }
}

export const Database = {
  isMemoryMode() {
    return memoryMode;
  },
  /** 诊断探针（测试与诊断面板用） */
  __diag() {
    return { memoryMode, dbOpen: !!dbPromise };
  },

  /** 写入存档槽（整条记录覆盖）。IDB 不可用时写 localStorage + 内存 */
  async putSave(record) {
    if (memoryMode) {
      memory.saves.set(record.slotId, record);
      lsPut(record);
      return;
    }
    try {
      await tx(STORE_SAVES, 'readwrite', (store) => {
        store.put(record);
      });
    } catch (e) {
      // 运行时异常（SecurityError 等）→ 永久降级并补写低层
      memoryMode = true;
      memory.saves.set(record.slotId, record);
      lsPut(record);
    }
  },

  async getSave(slotId) {
    if (memoryMode) {
      return memory.saves.get(slotId) || lsGet(slotId);
    }
    try {
      const holder = await tx(STORE_SAVES, 'readonly', (store) => reqValue(store.get(slotId)));
      return holder?.__value ?? lsGet(slotId);
    } catch (e) {
      memoryMode = true;
      return memory.saves.get(slotId) || lsGet(slotId);
    }
  },

  async deleteSave(slotId) {
    memory.saves.delete(slotId);
    lsDelete(slotId);
    if (memoryMode) return;
    try {
      await tx(STORE_SAVES, 'readwrite', (store) => {
        store.delete(slotId);
      });
    } catch {
      memoryMode = true;
    }
  },

  async listSaves() {
    let idbList = [];
    if (!memoryMode) {
      try {
        const holder = await tx(STORE_SAVES, 'readonly', (store) => reqValue(store.getAll()));
        idbList = holder?.__value || [];
      } catch {
        memoryMode = true;
      }
    }
    const merged = new Map();
    for (const rec of [...lsList(), ...[...memory.saves.values()], ...idbList]) {
      if (rec && rec.slotId) merged.set(rec.slotId, rec);
    }
    return [...merged.values()].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  },

  async setMeta(k, v) {
    if (memoryMode) {
      memory.meta.set(k, v);
      return;
    }
    try {
      await tx(STORE_META, 'readwrite', (store) => {
        store.put({ k, v });
      });
    } catch {
      memoryMode = true;
      memory.meta.set(k, v);
    }
  },

  async getMeta(k) {
    if (memoryMode) return memory.meta.get(k) ?? null;
    try {
      const holder = await tx(STORE_META, 'readonly', (store) => reqValue(store.get(k)));
      return holder?.__value?.v ?? null;
    } catch {
      memoryMode = true;
      return memory.meta.get(k) ?? null;
    }
  },
};
