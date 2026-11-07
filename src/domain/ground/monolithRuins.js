/**
 * domain/ground/monolithRuins.js — 五阶段先驱者巨石遗迹（doc18 v0.2 WP-3 / doc16 §4.5）
 *
 * 状态机（持久化于 planet.eco.ruin，固定紧凑 8 元组——doc18 五元组语义 + 布局三点）：
 *   [stage, dialectMask, pylonRotMask, guardianDefeated, coreHarvested, coreX_dm, coreZ_dm, naturalY_dm]
 *   stage: 1 除障(Excavation) → 2 方言拓印(Dialect) → 3 谐振对光(Resonance)
 *          → 4 机偶守卫战(Guardian) → 5 核心破译(Precursor Feedback)
 *   pylonRotMask: 3 座导流塔 × 3-bit 当前档位（0..7 = 45° 步进 × 8）
 *
 * 确定性红线：布局/方言词根/对光目标档位全部由 derivePlanetSeedsExtended().ruinSeed
 * 派生；零 Math.random()、零 world.rng 消费。XENO-03 门禁断言前置条件严苛性。
 */

import { derivePlanetSeedsExtended } from './planetSeeds.js';
import { ensurePlanetEco } from './xenobiology.js';
import { sampleTerrain, raycastTerrain } from './surfaceQueries.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { credit } from '../economy/ledger.js';
import { completeTech } from '../research/research.js';

/** 紧凑元组下标（doc18 WP-3 契约 + 布局追加段） */
export const RUIN_IDX = Object.freeze({
  STAGE: 0, DIALECT: 1, PYLON: 2, GUARDIAN: 3, CORE: 4,
  X_DM: 5, Z_DM: 6, Y_DM: 7,
});

export const RUIN_STAGE = Object.freeze({
  EXCAVATION: 1,
  DIALECT: 2,
  RESONANCE: 3,
  GUARDIAN: 4,
  CORE: 5,
});

/** 方言碑半径（doc18：120m 副碑环）与除障判定参数 */
const PYLON_RING_M = 120;
const EXCAV_PROBE_M = 2.5;
const EXCAV_TOLERANCE_M = 0.8;

/** 前驱者遗落科技（二选一由 ruinSeed 奇偶决定） */
export const PRECURSOR_TECHS = Object.freeze(['tech_precursor_shield_harmonics', 'tech_precursor_mass_catapult']);

/** (world, planet) → ruin 种子整数（布局与目标的唯一确定性来源） */
function ruinSeedOf(world, planet) {
  return derivePlanetSeedsExtended(world, planet.id).ruinSeed('main');
}

/**
 * 纯函数：主碑/副碑/导流塔布局（世界坐标，场域 [-240,+240] 内）。
 * 主碑锚定 ruinSeed 角度 × 140~210m 半径；副碑环 120m；导流塔 60m 内环。
 */
export function deriveRuinLayout(world, planet) {
  const seed = ruinSeedOf(world, planet);
  const ang = ((seed >>> 8) % 3600) / 3600 * Math.PI * 2;
  const rad = 140 + ((seed >>> 20) % 70);
  const coreX = Math.round(Math.cos(ang) * rad);
  const coreZ = Math.round(Math.sin(ang) * rad);
  const pylons = [];
  const towers = [];
  for (let i = 0; i < 3; i++) {
    const pa = ang + ((i + 1) * (Math.PI * 2 / 3)) + ((seed >>> (i * 3)) % 15) / 100;
    pylons.push({
      x: Math.round(coreX + Math.cos(pa) * PYLON_RING_M),
      z: Math.round(coreZ + Math.sin(pa) * PYLON_RING_M),
      lexemeIdx: (seed >>> (5 + i * 4)) % 32, // 32 基础语素位（doc17 §2.1）
    });
    const ta = ang + ((i + 1) * (Math.PI * 2 / 3)) + 0.5;
    towers.push({
      x: Math.round(coreX + Math.cos(ta) * 60),
      z: Math.round(coreZ + Math.sin(ta) * 60),
      targetRot: (seed >>> (17 + i * 5)) % 8, // 对光目标档位（0..7 × 45°）
    });
  }
  return { coreX, coreZ, pylons, towers };
}

/**
 * 惰性创建遗迹元组（幂等；GroundView 场域就绪后首登陆调用）。
 * naturalY 以创建时地表高程捕获（玩家此后堆高需自行刻槽削平——doc18 阶段 1）。
 */
export function ensurePlanetRuin(world, planet, field) {
  ensurePlanetEco(world, planet);
  if (planet.eco.ruin) return planet.eco.ruin;
  const layout = deriveRuinLayout(world, planet);
  // 布局持世界坐标；场域 = 世界 − 32（field ∈ [-256,+256]，doc11 坐标系铁律）
  const s = field ? sampleTerrain(field, layout.coreX - 32, layout.coreZ - 32) : null;
  const naturalY = s && Number.isFinite(s.y) ? s.y : 0;
  const ruin = [
    RUIN_STAGE.EXCAVATION, 0, 0, 0, 0,
    layout.coreX * 10, layout.coreZ * 10, Math.round(naturalY * 10),
  ];
  planet.eco.ruin = ruin;
  return ruin;
}

/** 布局反解（渲染/交互层消费；纯函数） */
export function ruinLayoutOf(ruin) {
  const seedBase = null; // 布局以坐标持久化，导流塔目标档位仍需 seed —— 由 consume 方传 world
  return {
    coreX: ruin[RUIN_IDX.X_DM] / 10,
    coreZ: ruin[RUIN_IDX.Z_DM] / 10,
    naturalY: ruin[RUIN_IDX.Y_DM] / 10,
    dialectMask: ruin[RUIN_IDX.DIALECT],
    pylonRotMask: ruin[RUIN_IDX.PYLON],
    stage: ruin[RUIN_IDX.STAGE],
    seedBase,
  };
}

/** 读导流塔当前档位（pylonRotMask 3-bit × 3） */
export function towerRotOf(ruin, towerIdx) {
  return (ruin[RUIN_IDX.PYLON] >>> (towerIdx * 3)) & 0b111;
}

/** 对光目标档位（ruinSeed 派生，纯确定性） */
export function towerTargetRot(world, planet, towerIdx) {
  const seed = ruinSeedOf(world, planet);
  return (seed >>> (17 + towerIdx * 5)) % 8;
}

/** 副碑语素位（ruinSeed 派生） */
export function pylonLexemeIdx(world, planet, pylonIdx) {
  const seed = ruinSeedOf(world, planet);
  return (seed >>> (5 + pylonIdx * 4)) % 32;
}

/**
 * 阶段 1 → 2：除障检测（doc18：调用 getElevation 检测周围 4 点平均覆土高度，
 * 需将高度降至阈值下方——naturalY + 0.8m 以内视为覆土清除）。
 * @returns {{ok:boolean, reason?:string, meanY?:number, advanced?:boolean}}
 */
export function tryCompleteExcavation(world, planet, field) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] >= RUIN_STAGE.DIALECT) return { ok: true, advanced: false };
  const cx = ruin[RUIN_IDX.X_DM] / 10;
  const cz = ruin[RUIN_IDX.Z_DM] / 10;
  const naturalY = ruin[RUIN_IDX.Y_DM] / 10;
  const probes = [
    [cx + EXCAV_PROBE_M, cz], [cx - EXCAV_PROBE_M, cz],
    [cx, cz + EXCAV_PROBE_M], [cx, cz - EXCAV_PROBE_M],
  ];
  let sum = 0;
  let valid = 0;
  for (const [px, pz] of probes) {
    const s = field ? sampleTerrain(field, px - 32, pz - 32) : null;
    if (s && Number.isFinite(s.y)) { sum += s.y; valid++; }
  }
  if (valid < 4) return { ok: false, reason: 'FieldNotReady' };
  const meanY = sum / 4;
  if (meanY > naturalY + EXCAV_TOLERANCE_M) {
    return { ok: false, reason: 'StillBuried', meanY, threshold: naturalY + EXCAV_TOLERANCE_M };
  }
  ruin[RUIN_IDX.STAGE] = RUIN_STAGE.DIALECT;
  emit(world, 'MonolithStageAdvanced', { planetId: planet.id, stage: RUIN_STAGE.DIALECT }, 'ground');
  return { ok: true, advanced: true, meanY };
}

/**
 * 阶段 2：方言拓印（靠近副碑按 E；需 stage ≥ 2——XENO-03 未除障前拒发）。
 * 每次拓印向 world.narrative.lexiconMask 写入 1 个先驱者语素位（32 基础语素）。
 * 三碑齐拓 → 自动进阶阶段 3。
 */
export function inscribeDialectPylon(world, planet, pylonIdx) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] < RUIN_STAGE.DIALECT) return { ok: false, reason: 'StillBuried' };
  if (ruin[RUIN_IDX.STAGE] > RUIN_STAGE.DIALECT) return { ok: true, advanced: false };
  if (!(pylonIdx >= 0 && pylonIdx < 3)) return { ok: false, reason: 'BadPylonIdx' };
  const bit = 1 << pylonIdx;
  const already = (ruin[RUIN_IDX.DIALECT] & bit) !== 0;
  if (!already) {
    ruin[RUIN_IDX.DIALECT] |= bit;
    const lexIdx = pylonLexemeIdx(world, planet, pylonIdx);
    world.narrative ||= {};
    world.narrative.lexiconMask = (world.narrative.lexiconMask || 0) | (1 << lexIdx);
    emit(world, 'MonolithDialectInscribed', { planetId: planet.id, pylonIdx, lexIdx }, 'ground');
  }
  const all = (ruin[RUIN_IDX.DIALECT] & 0b111) === 0b111;
  if (all && ruin[RUIN_IDX.STAGE] === RUIN_STAGE.DIALECT) {
    ruin[RUIN_IDX.STAGE] = RUIN_STAGE.RESONANCE;
    emit(world, 'MonolithStageAdvanced', { planetId: planet.id, stage: RUIN_STAGE.RESONANCE }, 'ground');
    return { ok: true, advanced: true };
  }
  return { ok: true, advanced: false, already };
}

/**
 * 阶段 3：导流塔旋转（按 E 每次 +45°）+ 光路合龙检验。
 * 需 stage ≥ 3；三塔档位全部命中目标 且 raycastTerrain 视线直达主碑无山脊遮挡
 * → 进阶阶段 4（机偶守卫苏醒事件）。
 */
export function rotateResonatorTower(world, planet, towerIdx, field) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] < RUIN_STAGE.RESONANCE) return { ok: false, reason: 'DialectIncomplete' };
  if (ruin[RUIN_IDX.STAGE] > RUIN_STAGE.RESONANCE) return { ok: true, advanced: false };
  if (!(towerIdx >= 0 && towerIdx < 3)) return { ok: false, reason: 'BadTowerIdx' };
  const rot = towerRotOf(ruin, towerIdx);
  ruin[RUIN_IDX.PYLON] = (ruin[RUIN_IDX.PYLON] & ~(0b111 << (towerIdx * 3)))
    | (((rot + 1) % 8) << (towerIdx * 3));
  emit(world, 'MonolithTowerRotated', { planetId: planet.id, towerIdx, rot: (rot + 1) % 8 }, 'ground');
  return tryAlignResonators(world, planet, field);
}

/**
 * 光路合龙检验：三塔档位命中 + 三塔→主碑 raycast 无遮挡。
 * @returns {{ok:boolean, aligned?:boolean, reason?:string}}
 */
export function tryAlignResonators(world, planet, field) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] < RUIN_STAGE.RESONANCE) return { ok: false, reason: 'DialectIncomplete' };
  if (ruin[RUIN_IDX.STAGE] > RUIN_STAGE.RESONANCE) return { ok: true, aligned: true };
  for (let i = 0; i < 3; i++) {
    if (towerRotOf(ruin, i) !== towerTargetRot(world, planet, i)) {
      return { ok: true, aligned: false, reason: 'RotationMismatch' };
    }
  }
  if (field) {
    const layout = deriveRuinLayout(world, planet);
    const cx = ruin[RUIN_IDX.X_DM] / 10;
    const cz = ruin[RUIN_IDX.Z_DM] / 10;
    for (let i = 0; i < 3; i++) {
      const t = layout.towers[i];
      // 端点各取「本地地面 + 10m」导流塔光学轴高（塔身有效高度）；山脊遮挡由
      // 玩家削平——doc17 §2.1：地形改造服务于考古解谜的玩法互锁
      const tS = sampleTerrain(field, t.x - 32, t.z - 32);
      const cS = sampleTerrain(field, cx - 32, cz - 32);
      const towerTopY = (tS && Number.isFinite(tS.y) ? tS.y : 0) + 10;
      const coreTopY = (cS && Number.isFinite(cS.y) ? cS.y : 0) + 10;
      const dir = [cx - t.x, coreTopY - towerTopY, cz - t.z];
      const len = Math.hypot(dir[0], dir[2]);
      if (len > 0.5) {
        const dl = Math.hypot(dir[0], dir[1], dir[2]);
        dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
        const hit = raycastTerrain(field, [t.x - 32, towerTopY, t.z - 32], dir, len + 4);
        if (hit && hit.hit) return { ok: true, aligned: false, reason: 'SkyObstructed', towerIdx: i };
      }
    }
  }
  ruin[RUIN_IDX.STAGE] = RUIN_STAGE.GUARDIAN;
  chronicle(world, 'discovery', `行星 ${planet.name} 的先驱者导流塔光路合龙，遗迹守卫苏醒！`, { planetId: planet.id });
  emit(world, 'MonolithStageAdvanced', { planetId: planet.id, stage: RUIN_STAGE.GUARDIAN }, 'ground');
  return { ok: true, aligned: true, advanced: true };
}

/** 阶段 4 → 5：机偶守卫击杀回执（GroundMission/GroundView 战斗层上报） */
export function reportGuardianDefeated(world, planet) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] < RUIN_STAGE.GUARDIAN) return { ok: false, reason: 'GuardianNotAwakened' };
  if (ruin[RUIN_IDX.GUARDIAN]) return { ok: true, advanced: false };
  ruin[RUIN_IDX.GUARDIAN] = 1;
  ruin[RUIN_IDX.STAGE] = RUIN_STAGE.CORE;
  emit(world, 'MonolithStageAdvanced', { planetId: planet.id, stage: RUIN_STAGE.CORE }, 'ground');
  return { ok: true, advanced: true };
}

/**
 * 阶段 5：先驱者核心提取（需守卫已灭——XENO-03 提前提取拒发）。
 * ancientData × 15 入玩家账本 + 解锁先驱者遗落科技（二选一，ruinSeed 奇偶）；
 * 幂等：coreHarvested 位防二次发放。
 */
export function extractMonolithCore(world, planet) {
  const ruin = planet.eco && planet.eco.ruin;
  if (!ruin) return { ok: false, reason: 'RuinNotInitialized' };
  if (ruin[RUIN_IDX.STAGE] < RUIN_STAGE.CORE || !ruin[RUIN_IDX.GUARDIAN]) {
    return { ok: false, reason: 'GuardianAlive' };
  }
  if (ruin[RUIN_IDX.CORE]) return { ok: true, already: true };
  ruin[RUIN_IDX.CORE] = 1;
  const fid = world.playerFactionId;
  if (fid) credit(world, fid, 'ancientData', 15, 'monolithCore', planet.id);
  const seed = ruinSeedOf(world, planet);
  const techId = PRECURSOR_TECHS[seed & 1];
  if (fid && world.research && world.research[fid]) {
    completeTech(world, fid, techId);
  }
  chronicle(world, 'discovery', `先驱者核心破译完成：遗落科技 ${techId} 已点亮`, { planetId: planet.id, techId });
  emit(world, 'MonolithCoreHarvested', { planetId: planet.id, techId, ancientData: 15 }, 'ground');
  return { ok: true, techId };
}
