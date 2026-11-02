/**
 * core/scheduler.js — 可序列化的逻辑事件调度队列（任务书 2.1 core/scheduler）
 *
 * 调度项必须是数据（kind + payload），处理函数注册在代码侧。
 * 按 (tick, seq) 确定性出队；随世界存档持久化。
 */

import { nextId } from './ids.js';

const handlers = new Map(); // kind -> fn(world, payload)

/** 注册调度处理器 */
export function registerScheduled(kind, fn) {
  handlers.set(kind, fn);
}

/** 安排在未来某 tick 执行 */
export function schedule(world, atTick, kind, payload = {}) {
  if (!Number.isFinite(atTick)) throw new Error('scheduler: atTick 非法');
  const item = {
    id: nextId(world, 'scheduled'),
    tick: Math.max(world.tick, Math.floor(atTick)),
    seq: (world.schedSeq = (world.schedSeq || 0) + 1),
    kind,
    payload,
  };
  world.scheduled.push(item);
  return item;
}

/** 取出所有到期项（从队列移除，按 tick/seq 排序返回） */
export function popDue(world) {
  if (world.scheduled.length === 0) return [];
  const due = [];
  const keep = [];
  for (const it of world.scheduled) {
    if (it.tick <= world.tick) due.push(it);
    else keep.push(it);
  }
  if (due.length > 0) {
    due.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    world.scheduled = keep;
  }
  return due;
}

/** 执行到期项（未知 kind 记录告警但不崩溃） */
export function runDue(world, onUnknown = null) {
  const due = popDue(world);
  for (const it of due) {
    const h = handlers.get(it.kind);
    if (h) h(world, it.payload, it);
    else if (onUnknown) onUnknown(it);
  }
  return due.length;
}

/** 按当前状态是否可能仍需要（加载后清理过期一次性项等） */
export function cancelByKind(world, kind, filterFn = null) {
  world.scheduled = world.scheduled.filter(
    (it) => !(it.kind === kind && (!filterFn || filterFn(it)))
  );
}
