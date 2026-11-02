/**
 * simulation/MonthlySystems.js — 月度结算
 * 市场/人口维护、AI 战略评估批次、历史归档。
 */

import { registerMonthly } from './TickPipeline.js';

registerMonthly('stats-guard', (world) => {
  world.stats.monthlyCloses = (world.stats.monthlyCloses || 0) + 1;
});
