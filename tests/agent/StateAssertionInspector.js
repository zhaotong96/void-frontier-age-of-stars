/**
 * tests/agent/StateAssertionInspector.js — 跨阶段深层状态与账本审计器（doc25 §4）
 *
 * 纯外部审计：只读取世界状态并断言，严禁修改任何实体字段。
 * 零依赖（Node / 浏览器同构）；所有断言失败一律抛出 Error。
 */

import { worldHash, stableStringify } from '../../src/core/serialization.js';
import { balance } from '../../src/domain/economy/ledger.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';

/** 断言为真 */
export function assert(cond, msg) {
  if (!cond) throw new Error(`[Agent-Inspector] 断言失败${msg ? ' — ' + msg : ''}`);
}

/** 断言相等（经 stableStringify 深比较，键序无关） */
export function assertEq(actual, expected, msg) {
  const a = stableStringify(actual);
  const b = stableStringify(expected);
  if (a !== b) {
    throw new Error(`[Agent-Inspector] 断言失败${msg ? ' — ' + msg : ''}: 实际=${a.slice(0, 160)} 期望=${b.slice(0, 160)}`);
  }
}

/**
 * 世界纯洁度扫描：全量 JSON 序列化中严禁出现 NaN / Infinity 裸字面量
 * （doc26 §5 状态纯洁度同口径；doc25 阶段 4/5 复用）。
 * 注意：JSON.stringify 会把 NaN/Infinity 序列化为 null，因此改用
 * stableStringify（保留类型标签）后按 token 检索。
 */
export function assertWorldPure(world, label = 'world') {
  const text = stableStringify(world);
  const nanHits = text.match(/NaN/g) || [];
  const infHits = text.match(/Infinity/g) || [];
  assert(nanHits.length === 0, `${label} 存在 ${nanHits.length} 处 NaN 污染`);
  assert(infHits.length === 0, `${label} 存在 ${infHits.length} 处 Infinity 污染`);
  return { nanHits: 0, infHits: 0, bytes: text.length };
}

/** 全银河不变量：违规数必须为 0 */
export function assertInvariants(world, label = 'world') {
  const problems = checkWorldInvariants(world);
  assert(problems.length === 0, `${label} 不变量违规 ${problems.length} 项: ${problems.slice(0, 2).join('; ')}`);
  return problems.length;
}

/** 账本余额读取（权威口径：economy.ledgers） */
export function ledgerBalance(world, factionId, resId) {
  return balance(world, factionId, resId);
}

/** 账本快照（全资源，用于阶段 4 奖励对账基线） */
export function ledgerSnapshot(world, factionId) {
  const led = world.economy.ledgers[factionId];
  return JSON.parse(JSON.stringify(led?.balances || {}));
}

/** 世界哈希（持久化 Hash A/B 口径） */
export function hashOf(world) {
  return worldHash(world);
}

/** 实体树深比较（stableStringify 逐位对账） */
export function entitiesEqual(a, b) {
  return stableStringify(a.entities) === stableStringify(b.entities);
}

/** 实体树差异定位（首个分歧路径，用于失败诊断） */
export function firstEntityDivergence(a, b, maxDepth = 6) {
  const walk = (x, y, path, depth) => {
    const sx = stableStringify(x);
    const sy = stableStringify(y);
    if (sx === sy) return null;
    if (depth >= maxDepth || x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
      return { path, a: sx.slice(0, 80), b: sy.slice(0, 80) };
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      const hit = walk(x[k], y[k], `${path}.${k}`, depth + 1);
      if (hit) return hit;
    }
    return { path, a: sx.slice(0, 80), b: sy.slice(0, 80) };
  };
  return walk(a.entities, b.entities, 'entities', 0);
}
