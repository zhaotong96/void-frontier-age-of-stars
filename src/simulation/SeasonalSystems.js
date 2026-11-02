/**
 * simulation/SeasonalSystems.js — 季度/年度结算
 * 纪年归档、胜利条件检查、长期统计采样。
 */

import { registerYearly } from './TickPipeline.js';

registerYearly('stats-guard', (world) => {
  world.stats.yearlyCloses = (world.stats.yearlyCloses || 0) + 1;
});
