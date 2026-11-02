/**
 * core/invariant.js — 世界状态不变量（任务书 2.5 / 11.3 / 11.4）
 *
 * 每次命令执行后运行「廉价检查」；调试、测试、玩家诊断时运行「完整检查」。
 * 模拟器遇到非法状态必须报告而非静默替换（任务书 11.4）。
 */

import { sortedKeys } from './math.js';

/** 判定是否为「可进入世界状态」的有限数值 */
export function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 数值字段扫描：发现 NaN/Infinity 返回问题描述 */
function scanNumeric(obj, path, out, depth = 0) {
  if (depth > 6 || out.length > 8) return;
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${path}.${k} = ${v}`);
    } else if (v && typeof v === 'object' && typeof v.getMonth !== 'function') {
      scanNumeric(v, `${path}.${k}`, out, depth + 1);
    }
  }
}

/** 实体集合注册表：由 World 模块写入（避免循环依赖） */
export const ENTITY_COLLECTIONS = new Set([
  'factions', 'systems', 'planets', 'colonies', 'stations', 'ships', 'fleets',
  'characters', 'blueprints', 'anomalies', 'groundMissions', 'wars', 'treaties',
  'crises', 'tradeRoutes', 'buildQueues',
]);

/**
 * 廉价检查（每 tick 与每命令后）：ID 唯一、资源非负、无 NaN 扩散。
 * 返回问题字符串数组（空 = 通过）。
 */
export function checkQuickInvariants(world) {
  const problems = [];
  try {
    // ID 唯一性（集合内）
    for (const col of sortedKeys(world.entities)) {
      const bag = world.entities[col];
      if (!bag || typeof bag !== 'object') continue;
      let count = 0;
      for (const id of Object.keys(bag)) {
        if (bag[id] == null) problems.push(`实体 ${col}/${id} 为空`);
        if (++count > 40000) break;
      }
    }
    // NaN 扩散扫描（限深采样：账本、市场、舰队、战斗）
    const sample = [world.economy, world.research];
    for (const s of sample) scanNumeric(s, 'world', problems);
  } catch (e) {
    problems.push(`检查器异常: ${e && e.message}`);
  }
  return problems;
}

/**
 * 完整检查：引用可解析、关系一致、账本非负。
 * opts.throwOnError = true 时发现即抛出。
 */
export function checkWorldInvariants(world, opts = {}) {
  const problems = [...checkQuickInvariants(world)];
  const E = world.entities;

  // 1. 全局 ID 唯一
  const seen = new Map();
  for (const col of sortedKeys(E)) {
    for (const id of Object.keys(E[col] || {})) {
      if (seen.has(id)) problems.push(`ID 重复: ${id}（${seen.get(id)} 与 ${col}）`);
      seen.set(id, col);
    }
  }

  // 2. 引用可解析
  const has = (col, id) => !!(id && E[col] && E[col][id]);
  for (const fleetId of sortedKeys(E.fleets || {})) {
    const f = E.fleets[fleetId];
    for (const sid of f.shipIds || []) {
      if (!has('ships', sid)) problems.push(`舰队 ${fleetId} 引用不存在舰船 ${sid}`);
      else if (E.ships[sid].fleetId !== fleetId) problems.push(`舰船 ${sid}.fleetId 与舰队 ${fleetId} 成员表不一致`);
    }
    if (f.commanderId && !has('characters', f.commanderId)) problems.push(`舰队 ${fleetId} 指挥官缺失`);
  }
  for (const sid of sortedKeys(E.ships || {})) {
    const s = E.ships[sid];
    if (s.fleetId && (!has('fleets', s.fleetId) || !(E.fleets[s.fleetId].shipIds || []).includes(sid))) {
      problems.push(`舰船 ${sid} 声称属于舰队 ${s.fleetId} 但不在成员表中`);
    }
    if (!has('factions', s.factionId)) problems.push(`舰船 ${sid} 归属阵营缺失`);
  }
  for (const cid of sortedKeys(E.colonies || {})) {
    const c = E.colonies[cid];
    if (!has('planets', c.planetId)) problems.push(`殖民地 ${cid} 行星缺失`);
    if (!has('factions', c.factionId)) problems.push(`殖民地 ${cid} 归属缺失`);
    for (const r of Object.keys(c.stockpile || {})) {
      const v = c.stockpile[r];
      if (!isFiniteNum(v) || v < 0) problems.push(`殖民地 ${cid} 库存 ${r} = ${v} 非法`);
    }
  }
  for (const sid of sortedKeys(E.systems || {})) {
    const s = E.systems[sid];
    for (const pid of s.planetIds || []) if (!has('planets', pid)) problems.push(`星系 ${sid} 行星 ${pid} 缺失`);
    for (const lid of s.lanes || []) if (!has('systems', lid)) problems.push(`星系 ${sid} 航路指向缺失 ${lid}`);
  }

  // 3. 阵营账本非负
  for (const fid of sortedKeys(world.economy.ledgers || {})) {
    const led = world.economy.ledgers[fid];
    for (const r of Object.keys(led.balances || {})) {
      const v = led.balances[r];
      if (!isFiniteNum(v) || v < 0) problems.push(`阵营 ${fid} 账本 ${r} = ${v} 非法`);
    }
  }

  // 4. RNG 状态合法
  const rs = world.rng;
  if (!Array.isArray(rs) || rs.length !== 4 || rs.some((v) => !Number.isInteger(v) || v < 0)) {
    problems.push('RNG 状态非法');
  }

  if (opts.throwOnError && problems.length > 0) {
    throw new Error(`世界不变量失败（${problems.length}）: ${problems.slice(0, 5).join(' ; ')}`);
  }
  return problems;
}
