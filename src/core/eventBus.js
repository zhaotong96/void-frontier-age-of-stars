/**
 * core/eventBus.js — 领域事件总线（任务书 2.4）
 *
 * 重大状态变化产生可追踪领域事件；事件进入 world.events.queue，
 * 由 TickPipeline 在固定阶段消费；历史事件按类别归档进 world.events.log。
 * 监听器注册在代码侧（非世界状态），保持可序列化。
 */

import { nextId } from './ids.js';
import { sortedKeys } from './math.js';

/** 事件类别 → 日志容量上限（防长期膨胀，任务书 7.5） */
const LOG_CAPS = {
  economy: 400,
  fleet: 400,
  combat: 400,
  diplomacy: 300,
  exploration: 300,
  colony: 300,
  research: 200,
  politics: 300,
  crisis: 300,
  world: 200,
  system: 120,
};

const listeners = new Map(); // type -> handler[]

/** 注册监听器（模拟内核初始化时调用一次） */
export function on(type, handler) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(handler);
}

/** 发出事件：入队 + 归档 */
export function emit(world, type, payload, category = 'world') {
  const ev = {
    id: nextId(world, 'event'),
    tick: world.tick,
    type,
    category,
    payload: payload || {},
  };
  world.events.queue.push(ev);
  pushLog(world, ev);
  return ev;
}

function pushLog(world, ev) {
  const cap = LOG_CAPS[ev.category] ?? 200;
  if (!world.events.log[ev.category]) world.events.log[ev.category] = [];
  const arr = world.events.log[ev.category];
  arr.push({ id: ev.id, tick: ev.tick, type: ev.type, payload: ev.payload });
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

/** 取走当前队列（TickPipeline 每阶段后调用） */
export function drainQueue(world) {
  const q = world.events.queue;
  world.events.queue = [];
  return q;
}

/** 把事件分发给已注册监听器（顺序 = 注册顺序，确定性） */
export function dispatch(world, events) {
  for (const ev of events) {
    const hs = listeners.get(ev.type);
    if (hs) for (const h of hs) h(world, ev);
    const any = listeners.get('*');
    if (any) for (const h of any) h(world, ev);
  }
}

/** 查询最近日志（UI 用） */
export function recentLog(world, category, limit = 50) {
  if (category && category !== 'all') {
    return (world.events.log[category] || []).slice(-limit);
  }
  // 合并所有类别并按 tick、id 排序
  const all = [];
  for (const cat of sortedKeys(world.events.log)) {
    for (const e of world.events.log[cat]) all.push({ ...e, category: cat });
  }
  all.sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : 1));
  return all.slice(-limit);
}

/** 战役纪年：只记录重大事件（完整保留，归档策略在 SeasonalSystems） */
export function chronicle(world, type, text, refs = {}) {
  world.events.chronicle.push({
    id: nextId(world, 'event'),
    tick: world.tick,
    type,
    text,
    refs,
  });
}
