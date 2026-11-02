/**
 * core/commandBus.js — 命令总线（任务书 2.4）
 *
 * 所有写操作必须经命令：validate（前置检查）→ execute（唯一修改点）→ 领域事件。
 * 事务语义：execute 抛错或执行后廉价不变量失败时，整世界回滚到执行前快照，
 * 保证「非法命令不能部分修改状态」（CORE-05）。
 * 命令记录进 world.commandLog（有界），供事件日志、回放和调试。
 */

import { deepClone } from './serialization.js';
import { nextId } from './ids.js';
import { checkQuickInvariants } from './invariant.js';

const registry = new Map(); // type -> { validate, execute, desc }

/**
 * 注册命令。def = {
 *   desc: '人类可读描述',
 *   validate(ctx, cmd) => { ok:true } | { ok:false, code, reason }   // 可省略
 *   execute(ctx, cmd)   // 直接修改 world；可 emit 事件
 * }
 * ctx = { world, tick, actorId }
 */
export function registerCommand(type, def) {
  if (registry.has(type)) throw new Error(`命令重复注册: ${type}`);
  registry.set(type, def);
}

export function hasCommand(type) {
  return registry.has(type);
}

export function commandList() {
  return [...registry.keys()].sort();
}

/**
 * 执行命令。cmd = { type, actorId?, targetId?, params? }
 * 返回 { ok:true } | { ok:false, code, reason }
 */
export function executeCommand(world, cmd) {
  if (!cmd || typeof cmd.type !== 'string') {
    return { ok: false, code: 'MALFORMED', reason: '命令格式非法' };
  }
  const def = registry.get(cmd.type);
  if (!def) {
    // 未知命令同样入审计（防止缺注册环境下 AI 空转被掩盖）
    const rec0 = {
      id: nextId(world, 'command'), tick: world.tick, type: cmd.type,
      actorId: cmd.actorId ?? null, targetId: cmd.targetId ?? null,
      params: cmd.params ?? {}, ok: false, code: 'UNKNOWN_COMMAND', reason: '未知命令',
    };
    world.commandLog.push(rec0);
    if (world.commandLog.length > 600) world.commandLog.splice(0, world.commandLog.length - 600);
    (world.stats.commandsFailed ||= {}).UNKNOWN_COMMAND = (world.stats.commandsFailed.UNKNOWN_COMMAND || 0) + 1;
    return { ok: false, code: 'UNKNOWN_COMMAND', reason: `未知命令 ${cmd.type}` };
  }

  const record = {
    id: nextId(world, 'command'),
    tick: world.tick,
    type: cmd.type,
    actorId: cmd.actorId ?? null,
    targetId: cmd.targetId ?? null,
    params: cmd.params ?? {},
  };

  const ctx = { world, tick: world.tick, actorId: cmd.actorId ?? null };

  // 1. 前置校验（不触碰状态）
  if (def.validate) {
    let v;
    try {
      v = def.validate(ctx, cmd);
    } catch (e) {
      logCommand(world, record, false, 'VALIDATE_ERROR', String(e && e.message));
      return { ok: false, code: 'VALIDATE_ERROR', reason: `校验异常: ${e && e.message}` };
    }
    if (!v || v.ok !== true) {
      const code = (v && v.code) || 'BLOCKED';
      const reason = (v && v.reason) || '条件不满足';
      logCommand(world, record, false, code, reason);
      return { ok: false, code, reason };
    }
  }

  // 2. 事务执行：失败回滚
  const snapshot = deepClone(world);
  let eventsBefore;
  try {
    eventsBefore = world.events.queue.length;
    def.execute(ctx, cmd);
    // 3. 执行后廉价不变量：失败视为事务失败
    const problems = checkQuickInvariants(world);
    if (problems.length > 0) {
      throw new Error(`不变量失败: ${problems[0]}`);
    }
  } catch (e) {
    restore(world, snapshot);
    logCommand(world, record, false, 'EXEC_ERROR', String(e && e.message));
    return { ok: false, code: 'EXEC_ERROR', reason: String(e && e.message) };
  }

  world.stats.commandsExecuted = (world.stats.commandsExecuted || 0) + 1;
  const byType = (world.stats.commandsByType ||= {});
  byType[cmd.type] = (byType[cmd.type] || 0) + 1;
  logCommand(world, record, true, null, null);
  return { ok: true, eventCount: world.events.queue.length - eventsBefore };
}

function restore(world, snapshot) {
  // 原地恢复：清空再逐键赋回，保持同一对象引用语义
  for (const k of Object.keys(world)) delete world[k];
  for (const k of Object.keys(snapshot)) world[k] = snapshot[k];
}

function logCommand(world, record, ok, code, reason) {
  const arr = world.commandLog;
  arr.push({ ...record, ok, code, reason });
  if (arr.length > 600) arr.splice(0, arr.length - 600);
  const failed = (world.stats.commandsFailed ||= {});
  if (!ok) failed[code] = (failed[code] || 0) + 1;
}
