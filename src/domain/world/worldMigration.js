/**
 * domain/world/worldMigration.js — 存档平滑迁移器与 world.spaceOperaState 根容器
 * （SPEC-PLAN-043 总控卷 Task 0.3；责任人：Eng-A）
 * （SPEC-PLAN-049 阶段四 M4 工位 A Task 49.1 增补：activateSpaceOperaCampaign 活体战役激活器）
 *
 * 职责：在 world 根对象下挂载向后兼容的惰性初始化容器 world.spaceOperaState。
 * 旧版存档（容器缺失）加载后由 ensureSpaceOperaState(world) 无损补齐默认值。
 *
 * M4 模块图裁决（SPEC-PLAN-049 工位 A 施工 notes）：
 *  - ensureSpaceOperaState 实现下沉至零依赖叶子模块 ./spaceOperaState.js（situationEngine
 *    改 import 叶子，环断裂；缘由见该文件头裁决注释）；
 *  - 本文件以 re-export 保全 doc43 冻结契约（全部既有导入方零改动）；
 *  - activateSpaceOperaCampaign 仍在本文件（doc48 §Task 4.1 指定落点）。
 *
 * 纪律（doc43 §1.4.2 金快照零漂移铁律）：
 *  - 幂等早返：容器已存在时直接返回同一引用，绝不重建；
 *  - 零 world.rng 消费：默认值全部为常量字面量，不触碰任何随机流；
 *  - 惰性挂载：仅在阶段入口/命令 execute 显式调用时才写入 world —— 默认 tick
 *    流程与默认世界创建不调用本函数，金快照 8be8ce2c 保持逐位零漂移；
 *  - SPACE_OPERA_SCHEMA_VERSION=200 是本容器自身的版本号，与 world.schemaVersion
 *    （core/World.js 的存档 v2）正交，不升存档 SCHEMA_VERSION。
 */

import { ensureSpaceOperaState } from './spaceOperaState.js';
import { ensureCompactPlanetState, seedCompactTiles } from '../planets/planetStateSchema.js';
import { applyArchetypeProfile } from '../planets/archetypeMechanics.js';
import { ensureBeaconStream, stepBeaconStream } from './subspaceBeaconStream.js';
import { ensureAutonomousFleets } from './autonomousSectorLife.js';
import { ensureParagonProfile } from '../characters/galacticParagons.js';

/** spaceOperaState 容器版本（冻结契约值；实现在 ./spaceOperaState.js 叶子模块） */
export { SPACE_OPERA_SCHEMA_VERSION, ensureSpaceOperaState } from './spaceOperaState.js';

/* ===================== M4 工位 A（SPEC-PLAN-049 Task 49.1）：活体战役激活器 ===================== */

/**
 * 将一个已完成基础实体构建的 world 实例深度激活为太空歌剧活体战役
 * （SPEC-PLAN-048 §Task 4.1 / SPEC-PLAN-049 §Task 49.1；调用点：App.startNewGame）。
 *
 * 施工细则（doc49 §Task 49.1 逐条契约）：
 *  1. 根容器初始化：幂等 ensureSpaceOperaState + ensureBeaconStream + ensureAutonomousFleets；
 *  2. 全星系行星深度底座铺设：确定性键序（Object.keys(...).sort()）遍历 planets，
 *     依次 ensureCompactPlanetState（紧凑容器）→ applyArchetypeProfile
 *     （16 大天体物理原型法则与 8D envVector）→ seedCompactTiles（256-Tile uint32
 *     位编码地形与初始覆盖层）；
 *  3. 全局群像领袖档案初始化：确定性键序遍历 characters，ensureParagonProfile 挂载
 *     character.paragon 档案（galacticParagons.js:111 权威落点；
 *     doc49 文案「paragonProfile」≙ 代码世界 character.paragon，不重命名字段）；
 *  4. 首帧信标池预热：立即 stepBeaconStream 一次，非帝国叙事信标（kind='NARRATIVE'）
 *     密度铁律即刻补齐至 ≥ 15（BEACON_MIN_NARRATIVE，subspaceBeaconStream.js:58）。
 *
 * 红线（doc49 §1.3 不变量）：
 *  - 严禁调用 world.rng：全链路仅消费 ensure/deriveSeed 派生盐子流
 *    （ensureCompactPlanetState/seedCompactTiles/applyArchetypeProfile/spawnNarrativeBeacon
 *    均为 deterministicRng 派生流，无 world.rng 消费点）；
 *  - 全键稳定排序遍历：planets/characters 一律 Object.keys(...).sort()；
 *  - 幂等性：全部 ensure 函数幂等（同引用直返），重复调用不破坏既有数据；
 *  - 金快照纯洁性：本函数仅在 App.startNewGame 显式启用太空歌剧时调用；
 *    REG-01 无参 createStarterCampaign() 永不触达，金快照 8be8ce2c 零漂移。
 *
 * @param {object} world - 主游戏世界状态（Plain Data）
 * @returns {Object|null} world.spaceOperaState 实例（world 非法时返回 null）
 */
export function activateSpaceOperaCampaign(world) {
  if (!world || typeof world !== 'object') return null;

  // —— 1. 根容器初始化（幂等；零 world.rng 消费）——
  const soState = ensureSpaceOperaState(world);
  ensureBeaconStream(world);
  ensureAutonomousFleets(world);

  // —— 2. 全星系行星深度底座铺设（确定性键序）——
  const planets = (world.entities && world.entities.planets) || {};
  const planetIds = Object.keys(planets).sort();
  for (let i = 0; i < planetIds.length; i++) {
    const pid = planetIds[i];
    const planet = planets[pid];
    if (!planet) continue;
    // 挂载紧凑 PlanetState（幂等）
    ensureCompactPlanetState(planet, world);
    // 注入 16 大天体物理原型法则与 8D envVector（幂等）
    applyArchetypeProfile(planet, world);
    // 播种 256-Tile uint32 位编码地形与初始覆盖层（幂等；只覆盖地形三字段）
    seedCompactTiles(planet, world);
  }

  // —— 3. 全局群像领袖档案初始化（确定性键序）——
  const characters = (world.entities && world.entities.characters) || {};
  const charIds = Object.keys(characters).sort();
  for (let i = 0; i < charIds.length; i++) {
    const ch = characters[charIds[i]];
    if (ch) ensureParagonProfile(ch, world);
  }

  // —— 4. 首帧信标池预热（立即补齐至 >= 15 条非帝国叙事信标）——
  stepBeaconStream(world);

  return soState;
}
