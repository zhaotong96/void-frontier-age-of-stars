/**
 * simulation/SpaceOperaWiring.js — 太空歌剧层阶段统一静态接线（唯一注册点）。
 * （SPEC-PLAN-048 §Task 4.1 §3 / SPEC-PLAN-049 §Task 49.3 工位 A：全时钟阶段与时钟钩子集中闭环）
 *
 * 裁决背景：SpaceOperaClock/jacobianCoupling/dramaDirector 原先经「顶层 await 动态 import」
 * 与「游离 import(...).then(...)」编排注册次序——前者在静态打包产物（build-static-bundle
 * 单 IIFE 闭包）中是语法错误，后者相对说明符在打包环境不可达（404 → 静默降级 → 收口/钩子
 * 在打包应用中永不就位）。M3 三个每 tick 阶段（信标流/自主舰队/战备度）又散落在各自领域
 * 模块的 import 期副作用里（subspaceBeaconStream / autonomousSectorLife / fleetDoctrineAndScars
 * 文件尾 registerHourly），注册序依赖模块图求值顺序 —— 全部收拢为本模块的同步显式接线：
 *
 *   hourly（严格按序，'space-opera' 恒居末位）：
 *     'space-opera-beacon-stream'      → stepBeaconStream(world)
 *     'space-opera-autonomous-fleets'  → stepAutonomousFleets(world)
 *     'space-opera-fleet-readiness'    → stepFleetReadiness(world)
 *     'space-opera'                    → stepSpaceOperaTick(world)（三级时钟分片）
 *   monthly（严格按序：基础状态 → 雅可比耦合 → 戏剧导演）：
 *     'space-opera-monthly'  → stepSpaceOperaMonthly(world)（弧级月度钩子触发）
 *     'space-opera-jacobian' → stepSpaceOperaJacobian(world)（7×7 雅可比收口，消费冲击并记涟漪链）
 *     'space-opera-drama'    → stepSpaceOperaDramaMonthly(world)（戏剧导演月末推演）
 *   setClockHooks 集中显式绑定（消除对文件加载顺序副作用的脆弱依赖）：
 *     stepSituation=stepSituationBucket / slowPlanetHook=stepArchetypeMechanics /
 *     leaderTick=stepParagonLeaderTick / monthlyHooks=[S2,S3,S4,S6,S7×2 + 群像 XP×2]。
 *     monthlyHooks 共 8 项：doc49 §Task 49.3 契约的 6 条局势弧钩子（S2/S3/S4/S6/S7×2）
 *     + doc48 §1.2「setClockHooks 全绑定」要求的群像月度 XP 与传奇抵达检定 2 条
 *     （grantMonthlyXp / stepLegendaryParagonRecruitment，galacticParagons.js:300/1309
 *     的既有月度钩子 —— 漏挂将使领袖 XP 停摆并破坏 CHK-M3-02/04 契约）。
 *
 * 全部阶段函数体首行自守卫 world.spaceOperaState（或闭包守卫）：未挂载容器（默认流程/
 * 金快照 8be8ce2c 世界）零读取零写入，逐位零漂移。本模块保持幂等（wired 旗标）。
 */

import { registerHourly, registerMonthly } from './TickPipeline.js';
import { setClockHooks, stepSpaceOperaTick, stepSpaceOperaMonthly } from './SpaceOperaClock.js';
import { stepSpaceOperaJacobian } from './jacobianCoupling.js';
import { stepSpaceOperaDramaMonthly } from './dramaDirector.js';
// M3 三阶段步进（原 import 期副作用注册已拆除 → 本模块唯一注册点）
import { stepBeaconStream } from '../domain/world/subspaceBeaconStream.js';
import { stepAutonomousFleets } from '../domain/world/autonomousSectorLife.js';
import { stepFleetReadiness } from '../domain/fleets/fleetDoctrineAndScars.js';
// 时钟钩子注入源（doc49 §Task 49.3 导入清单；别名导出见各模块尾注）
import { stepSituationBucket } from '../domain/events/situationEngine.js';
import { stepArchetypeMechanics } from '../domain/planets/archetypeMechanics.js';
import {
  stepParagonLeaderTick,
  grantMonthlyXp,
  stepLegendaryParagonRecruitment,
} from '../domain/characters/galacticParagons.js';
import { stepEcologicalPerturbation } from '../domain/planets/ecologicalPhaseArc.js';
import { stepColonySocialMonthly } from '../domain/politics/colonySocialArc.js';
import { stepStrategicShortageMonthly } from '../domain/economy/shortageSituationArc.js';
import { stepShadowSyndicateMonthly } from '../domain/economy/shadowSyndicateArc.js';
import {
  stepGalacticSenateMonthly,
  stepEndgameCrisisMonthly,
} from '../domain/diplomacy/galacticSenateAndCrisisArc.js';

let wired = false;

/**
 * 幂等注册太空歌剧层全部时钟阶段与时钟钩子（由 HourlySystems.js 文件末尾显式调用：
 * 保证 4 个 hourly 阶段恒注册于该文件全部既有 hourly 阶段之后，'space-opera' 每 tick 最后执行）。
 */
export function registerSpaceOperaPhases() {
  if (wired) return;
  wired = true;

  /* —— Hourly 阶段（严格按序：信标流 → 自主舰队 → 战备度 → 三级时钟分片恒末位）—— */
  registerHourly('space-opera-beacon-stream', (world) => {
    if (world && world.spaceOperaState) stepBeaconStream(world);
  });
  registerHourly('space-opera-autonomous-fleets', (world) => {
    if (world && world.spaceOperaState) stepAutonomousFleets(world);
  });
  registerHourly('space-opera-fleet-readiness', (world) => {
    if (world && world.spaceOperaState) stepFleetReadiness(world);
  });
  registerHourly('space-opera', (world) => {
    if (world && world.spaceOperaState) stepSpaceOperaTick(world);
  });

  /* —— Monthly 阶段（严格按序：基础状态 → 雅可比耦合 → 戏剧导演）——
   * stepSpaceOperaJacobian 为 jacobianCoupling 的月末收口包装（endoDelta 聚合 + pendingSystemShocks
   * 消费 + stepJacobianCoupling 步进 + 涟漪补录），doc49 契约直呼 stepJacobianCoupling 为其内核 ——
   * 注册包装入口而非内核，否则雅可比退化为零冲击恒等步进（doc45 §Task 2.1 契约破坏）。 */
  registerMonthly('space-opera-monthly', (world) => {
    if (world && world.spaceOperaState) stepSpaceOperaMonthly(world);
  });
  registerMonthly('space-opera-jacobian', (world) => {
    if (world && world.spaceOperaState) stepSpaceOperaJacobian(world);
  });
  registerMonthly('space-opera-drama', (world) => {
    if (world && world.spaceOperaState) stepSpaceOperaDramaMonthly(world);
  });

  /* —— setClockHooks 集中显式绑定（幂等覆盖；与各弧模块 import 期自注册等值，此后本模块
   *     为权威终态 —— 彻底消除对文件加载顺序副作用的脆弱依赖）—— */
  setClockHooks({
    stepSituation: stepSituationBucket,
    slowPlanetHook: stepArchetypeMechanics,
    leaderTick: stepParagonLeaderTick,
    monthlyHooks: [
      stepEcologicalPerturbation,        // S2 生态扰动推进
      stepColonySocialMonthly,           // S3 殖民地社会弧
      stepStrategicShortageMonthly,      // S4 短缺监视（watchStrategicStockpiles 别名）
      stepShadowSyndicateMonthly,        // S6 黑市辛迪加弧
      stepGalacticSenateMonthly,         // S7 议会表决与有机天灾检定
      stepEndgameCrisisMonthly,          // S7 终局天灾推演
      grantMonthlyXp,                    // 群像月度 XP 入账（doc48「全绑定」）
      stepLegendaryParagonRecruitment,   // 传奇群像逐月抵达检定（doc48「全绑定」）
    ],
  });
}
