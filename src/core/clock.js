/**
 * core/clock.js — 统一战略时钟（任务书 1.5）
 *
 * 1 tick = 1 游戏小时。24 小时/日，30 日/月，12 月/年。
 * 游戏纪年从「星历 1.01.01 00:00」开始。
 */

export const HOURS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_DAY = HOURS_PER_DAY; // 24
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH; // 720
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR; // 8640

/** tick → 日期对象 */
export function tickToDate(tick) {
  const t = Math.max(0, Math.floor(tick));
  const hour = t % HOURS_PER_DAY;
  const totalDays = Math.floor(t / HOURS_PER_DAY);
  const day = (totalDays % DAYS_PER_MONTH) + 1;
  const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
  const month = (totalMonths % MONTHS_PER_YEAR) + 1;
  const year = Math.floor(totalMonths / MONTHS_PER_YEAR) + 1;
  return { year, month, day, hour };
}

/** 日期显示字符串 */
export function dateStr(tick) {
  const d = tickToDate(tick);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `星历${d.year}.${p(d.month)}.${p(d.day)} ${p(d.hour)}:00`;
}

export function isDayStart(tick) {
  return tick > 0 && tick % TICKS_PER_DAY === 0;
}
export function isMonthStart(tick) {
  return tick > 0 && tick % TICKS_PER_MONTH === 0;
}
export function isYearStart(tick) {
  return tick > 0 && tick % TICKS_PER_YEAR === 0;
}

/** tick 距离下一个日/月/年开始还差多少 */
export function ticksUntilDayStart(tick) {
  return TICKS_PER_DAY - (tick % TICKS_PER_DAY);
}

/**
 * 战略速度档位：暂停 / 1x / 2x / 4x / 8x。
 * SPEEDS[i] = 每现实秒推进的游戏小时数。
 */
export const SPEEDS = [
  { id: 'pause', label: '暂停', ticksPerSecond: 0 },
  { id: '1x', label: '1×', ticksPerSecond: 6 },
  { id: '2x', label: '2×', ticksPerSecond: 12 },
  { id: '4x', label: '4×', ticksPerSecond: 24 },
  { id: '8x', label: '8×', ticksPerSecond: 48 },
];
