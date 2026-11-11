/**
 * tests/e2e/assertions/MilestoneStateAssertions.js — 各里程碑深层状态审计器（doc28 §4）
 */

import { balance } from '../../../src/domain/economy/ledger.js';
import { checkWorldInvariants } from '../../../src/core/invariant.js';
import { stableStringify } from '../../../src/core/serialization.js';

export function assert(cond, msg) {
  if (!cond) throw new Error(`[Milestone] 断言失败 — ${msg}`);
}

export function assertEq(actual, expected, msg) {
  if (String(actual) !== String(expected)) {
    throw new Error(`[Milestone] 断言失败 — ${msg}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  }
}

/** 命令成功断言（官方命令总线；拒绝即失败） */
export function assertCmd(world, type, params, actorId) {
  return import('../../../src/core/commandBus.js').then(({ executeCommand }) => {
    const r = executeCommand(world, { type, actorId, params });
    if (!r || r.ok !== true) {
      throw new Error(`[Milestone] 命令 ${type} 被拒: ${r ? `${r.code} ${r.reason || ''}` : '无返回'}`);
    }
    return r;
  });
}

/** 派发命令（允许拒绝，返回结果） */
export async function cmd(world, type, params = {}, actorId = null) {
  const { executeCommand } = await import('../../../src/core/commandBus.js');
  return executeCommand(world, { type, actorId, params });
}

/** 真实时间步推进（advanceTicks 官方管道） */
export async function advance(world, ticks) {
  const { advanceTicks } = await import('../../../src/simulation/WorldSimulation.js');
  advanceTicks(world, ticks);
}

/** 世界健全性：不变量 0 违规 + 纯洁度（NaN/Inf 零容忍） */
export async function assertWorldHealthy(world, label) {
  const problems = checkWorldInvariants(world);
  assert(problems.length === 0, `${label} 不变量违规: ${problems.slice(0, 2).join('; ')}`);
  const { scanWorldPurity } = await import('../../fuzz/StateMachineFuzzer.js');
  const purity = scanWorldPurity(world);
  assert(purity.nanInf.length === 0, `${label} 状态污染: ${purity.nanInf.slice(0, 2).join('; ')}`);
}

/** 编年史数据契约（ChronicleView 反序列化口径：id/tick/type/text 齐备） */
export function assertChronicleShape(world, minEntries) {
  const ch = world.events?.chronicle || [];
  assert(Array.isArray(ch) && ch.length >= minEntries, `编年史条目 ${ch.length} < ${minEntries}`);
  for (const e of ch) {
    assert(typeof e.id === 'string' || typeof e.id === 'number', `编年史条目缺 id: ${stableStringify(e).slice(0, 80)}`);
    assert(Number.isInteger(e.tick), '编年史条目缺 tick');
    assert(typeof e.type === 'string' && typeof e.text === 'string', '编年史条目缺 type/text');
  }
  return ch;
}

/** 账本余额快捷读取 */
export function ledger(world, fid, resId) {
  return balance(world, fid, resId);
}
