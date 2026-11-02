/**
 * simulation/TickPipeline.js — 领域更新阶段注册与执行（任务书 4.10）
 *
 * 每个战略 tick 按稳定顺序运行已注册阶段；阶段顺序由 WorldSimulation.js
 * 中的 import 顺序显式决定，杜绝插入次序依赖。
 * 阶段输入/输出契约：每个阶段只读上一阶段产物并只写自己负责的字段。
 */

const hourlyPhases = [];
const dailyCloses = [];
const monthlyCloses = [];
const yearlyCloses = [];

/** 注册每 tick 阶段（顺序敏感，注册即锁定） */
export function registerHourly(name, fn) {
  hourlyPhases.push({ name, fn });
}

/** 注册日结回调（每天 00:00 tick 触发，按注册顺序） */
export function registerDaily(name, fn) {
  dailyCloses.push({ name, fn });
}

export function registerMonthly(name, fn) {
  monthlyCloses.push({ name, fn });
}

export function registerYearly(name, fn) {
  yearlyCloses.push({ name, fn });
}

export function runHourly(world) {
  for (const p of hourlyPhases) p.fn(world);
}

export function runDaily(world) {
  for (const p of dailyCloses) p.fn(world);
}

export function runMonthly(world) {
  for (const p of monthlyCloses) p.fn(world);
}

export function runYearly(world) {
  for (const p of yearlyCloses) p.fn(world);
}

export function phaseNames() {
  return hourlyPhases.map((p) => p.name);
}
