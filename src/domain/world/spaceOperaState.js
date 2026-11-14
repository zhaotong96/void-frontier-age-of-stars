/**
 * domain/world/spaceOperaState.js — world.spaceOperaState 根容器叶子模块
 * （SPEC-PLAN-049 工位 A 模块图裁决；实现自 worldMigration.js 原样迁移）
 *
 * 裁决背景：situationEngine.js（M1 权威引擎）静态 import worldMigration 的
 * ensureSpaceOperaState —— worldMigration 处于 situationEngine 求值链首位，
 * situationEngine 求值期间恒被挂起。M4 工位 A 给 worldMigration 新增
 * activateSpaceOperaCampaign 的静态依赖链（archetypeMechanics → planetaryThreat →
 * galacticSenateAndCrisisArc → situationEngine 顶层的 registerSituationArc 调用、
 * galacticParagons 顶层的 registerSituationMonthlyHook 调用）会在该挂起窗口读
 * situationEngine 尚未初始化的 const 绑定（ARC_ENUM / monthlyHookFns）→
 * "Cannot access before initialization" TDZ 爆破。
 *
 * 解法（最小机制）：把 ensureSpaceOperaState 实现下沉至本零依赖叶子模块；
 * situationEngine 改 import 本叶子（环断裂），worldMigration 以 re-export
 * 保全 doc43 冻结契约（全部既有导入方零改动），activateSpaceOperaCampaign
 * 仍在 worldMigration.js（doc48 §Task 4.1 指定落点）。
 *
 * 纪律（doc43 §1.4 金快照零漂移铁律，原样保留）：
 *  - 幂等早返：容器已存在时直接返回同一引用，绝不重建；
 *  - 零 world.rng 消费：默认值全部为常量字面量，不触碰任何随机流；
 *  - 惰性挂载：仅在阶段入口/命令 execute 显式调用时才写入 world —— 默认 tick
 *    流程与默认世界创建不调用本函数，金快照 8be8ce2c 保持逐位零漂移。
 */

/** spaceOperaState 容器版本（冻结契约值） */
export const SPACE_OPERA_SCHEMA_VERSION = 200;

/**
 * 惰性补齐 world.spaceOperaState 容器（幂等；无副作用除挂载该容器本身）
 *
 * 容器结构（doc43 §Task 0.3 逐字段契约）：
 *  - schemaVersion: 200                          容器版本
 *  - systemVector: [15,15,20,15,15,10,10]        七大系统宏观状态向量 S=[S1..S7] ∈ [0,100]^7
 *  - butterflyCausalLog: []                      三阶蝴蝶效应跨系统传导因果链日志（有界）
 *  - situations: {}                              活跃四幕局势字典（key: situationId）
 *  - nextSituationId: 1                          局势 ID 自增游标
 *  - autonomousFleets: []                        自主星区生态舰队列表（商队/走私/巡逻/远征/赏金）
 *  - subspaceBeacons: []                         活跃子空间信标流列表（保持 ≥ 15 个非帝国叙事信标）
 *  - dramaDirector: { tension, adaptationFactor, adaptDays, climaxCount,
 *                     lastClimaxTick, recoveryGraceUntilTick }   自适应戏剧导演状态
 *
 * @param {object} world - 世界根对象（Plain Data）
 * @returns {object} world.spaceOperaState（幂等：两次调用同一引用）
 */
export function ensureSpaceOperaState(world) {
  if (!world || typeof world !== 'object') {
    throw new Error('SO: ensureSpaceOperaState 需要 world 对象');
  }
  if (world.spaceOperaState) return world.spaceOperaState;
  world.spaceOperaState = {
    schemaVersion: SPACE_OPERA_SCHEMA_VERSION,
    // 7 大核心系统宏观状态向量 S = [S1..S7] in [0, 100]^7
    systemVector: [15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0],
    // 最近 16 条三阶蝴蝶效应跨系统传导因果链日志
    butterflyCausalLog: [],
    // 活跃四幕局势字典 (key: situationId)
    situations: {},
    nextSituationId: 1,
    // 自主星区生态舰队列表 (商队/走私/巡逻/远征/赏金)
    autonomousFleets: [],
    // 活跃子空间信标流列表 (保持 >= 15 个非帝国叙事信标)
    subspaceBeacons: [],
    // 自适应太空歌剧戏剧导演状态
    dramaDirector: {
      tension: 18.0,          // T in [0.0, 100.0]
      adaptationFactor: 1.0,  // A in [0.75, 1.35]
      adaptDays: 0.0,         // 创伤适应累积天数 [-50, 100]
      climaxCount: 0,         // 已触发的史诗高潮次数
      lastClimaxTick: -1,
      recoveryGraceUntilTick: -1,
    },
  };
  return world.spaceOperaState;
}
