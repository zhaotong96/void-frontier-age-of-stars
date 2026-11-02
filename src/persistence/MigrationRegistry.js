/**
 * persistence/MigrationRegistry.js — 存档版本迁移（任务书 8.2）
 *
 * 单向版本链 v1 → v2 → …；每个迁移函数接收 payload（世界数据）并
 * 原地升级到下一版本。迁移失败保留原记录不覆盖（SAVE-04）。
 */

const migrations = new Map(); // fromVersion -> fn(payload)

/** 注册迁移：把 payload 从 version 升级到 version+1 */
export function registerMigration(fromVersion, fn) {
  migrations.set(fromVersion, fn);
}

/** 迁移到最新版本。返回 { ok, payload, applied:[], reason? } */
export function migratePayload(payload, fromVersion, latestVersion) {
  let v = fromVersion;
  let data = payload;
  const applied = [];
  while (v < latestVersion) {
    const fn = migrations.get(v);
    if (!fn) {
      return { ok: false, reason: `缺少迁移 v${v} → v${v + 1}`, applied };
    }
    try {
      data = fn(data);
      v += 1;
      applied.push(v);
    } catch (e) {
      return { ok: false, reason: `迁移 v${v} 失败: ${e && e.message}`, applied };
    }
  }
  return { ok: true, payload: data, applied };
}

export function registeredMigrations() {
  return [...migrations.keys()].sort((a, b) => a - b);
}

// —— 已注册迁移 ————————————————————————————————
// v1 为首个正式 schema；尚无历史版本。未来字段演进示例：
// registerMigration(1, (p) => { p.settings = p.settings || {}; return p; });
