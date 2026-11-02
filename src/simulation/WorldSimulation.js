/**
 * simulation/WorldSimulation.js — 统一世界推进器（任务书 1.5 / 4.10）
 *
 * 固定步长累加器模型：App 的渲染循环调用 advanceOneTick；
 * 模拟推进与渲染帧率完全解耦（CORE-04）。暂停即不调用本函数。
 *
 * tick 内顺序：
 *   1. 调度队列到期项
 *   2-N. 各领域每小时阶段（TickPipeline 注册序）
 *   日/月/年结（按 tick 边界）
 *   事件分发（drain → dispatch）
 *   廉价不变量检查
 */

import { runHourly, runDaily, runMonthly, runYearly } from './TickPipeline.js';
import { runDue } from '../core/scheduler.js';
import { drainQueue, dispatch } from '../core/eventBus.js';
import { isDayStart, isMonthStart, isYearStart } from '../core/clock.js';
import { checkQuickInvariants } from '../core/invariant.js';

// 按依赖顺序导入各领域阶段模块（import 副作用注册阶段）
import './HourlySystems.js';
import './DailySystems.js';
import './MonthlySystems.js';
import './SeasonalSystems.js';

/** 推进一个战略 tick（1 游戏小时）。唯一的世界状态推进入口。 */
export function advanceOneTick(world) {
  world.tick += 1;

  // 1. 到期调度项（延迟命令、事件回调等）
  runDue(world);

  // 2. 领域每小时阶段
  runHourly(world);

  // 3. 日/月/年结
  if (isDayStart(world.tick)) {
    runDaily(world);
    if (isMonthStart(world.tick)) {
      runMonthly(world);
      if (isYearStart(world.tick)) {
        runYearly(world);
      }
    }
  }

  // 4. 事件分发（本 tick 产生的领域事件交给监听器）
  const events = drainQueue(world);
  dispatch(world, events);

  // 5. 廉价不变量（违规即抛出 —— 禁止静默续跑）
  const problems = checkQuickInvariants(world);
  if (problems.length > 0) {
    throw new Error(`[tick ${world.tick}] 世界不变量失败: ${problems.slice(0, 3).join(' ; ')}`);
  }

  world.stats.ticksProcessed += 1;
}

/** 推进 N tick（测试与离线模拟用） */
export function advanceTicks(world, n) {
  for (let i = 0; i < n; i++) advanceOneTick(world);
}
