/**
 * domain/ground/planetaryThreat.js — 开采警戒指数与阶梯威胁（doc20 v0.6 WP-3/WP-4）
 *
 * PTI 微分演化方程（doc20 WP-3.2，0..1000 千分比口径）：
 *   H_t = clamp(H_{t-1} + Δmine + Δind + Δcatapult − Δrestore − Δdampener − λH_{t-1}, 0, 1000)
 *   Δmine = +2.0 × 运行矿井数；Δind = +0.4 × 工业节点数；Δcatapult = +25.0/次发射；
 *   Δrestore = −1.5 × (plant/RestoreTerrain) 次数；Δdampener = −6.0 × 抑制塔数；
 *   λ = 1.5%/小时（自然阻尼——世界不会永远惩罚玩家，doc16 §11）。
 *
 * 阶梯响应（doc16 §4.17 / doc20 WP-3.4）：
 *   Tier 0 潜伏（0-199）→ Tier 1 侦测（200-399，120s 侦察波）→
 *   Tier 2 袭扰（400-649，90s 侧翼波，优先打输电塔/传送带）→
 *   Tier 3 围攻（650-849，75s 攻城波）→ Tier 4 利维坦苏醒（850-1000）。
 *
 * 双派系哲学（doc20 WP-3.3）：远古哨卫（机械/极地/晶原主题）优先打击电网与
 * 弹射井；原生异虫（自然主题）优先打击农场/矿井/居民区。
 *
 * 确定性红线：零 Math.random()、零 world.rng 消费（波次构成由 planetSeed 派生）。
 */

import { emit, chronicle } from '../../core/eventBus.js';
import { clamp } from '../../core/math.js';
import { derivePlanetSeedsExtended } from './planetSeeds.js';
import { ensurePlanetInd } from '../industry/planetaryLogistics.js';

/** 警戒阶级阈值（PTI 0..1000） */
export const PTI_THRESHOLDS = Object.freeze([0, 200, 400, 650, 850]);

/** 增援波次间隔（任务秒；Tier 1/2/3） */
export const WAVE_INTERVAL_S = Object.freeze({ 1: 120, 2: 90, 3: 75 });

/** 弹射单次激发（doc20 WP-3.2 契约） */
export const PTI_CATAPULT_SPIKE = 25.0;

/** 利维坦原型（按行星类别确定性派生） */
export function leviathanArchetypeOf(planet) {
  if (planet.category === 'lava') return 'lev_magma_colossus';
  if (planet.category === 'ocean') return 'lev_abyssal_kraken';
  return 'lev_automata_dreadnought';
}

/** 主题 → 威胁派系（doc20 WP-3.3：机械/极地/晶原 = 远古哨卫，其余 = 原生异虫） */
export function factionOf(planet) {
  const sentinelThemes = ['ancient_megastructure', 'magnetar_aurora', 'prism_crystal', 'dry_night_polar', 'permafrost_furnace', 'glassstorm_barrens', 'fractured_moon', 'cloud_giant_atolls'];
  return sentinelThemes.includes(planet.primaryThemeId) ? 'sentinel' : 'xeno_swarm';
}

/**
 * 每战略小时 PTI 微分推进（HourlySystems production 后调用；O(nodes) 线性）。
 * @returns {{pti:number, tier:number, escalated:boolean}}
 */
export function tickPlanetaryThreatIndex(world, planet) {
  const th = ensurePlanetThreat(planet);
  const ind = ensurePlanetInd(planet);

  // 1) 扰动增量与消减项统计（只读账本化状态，不重载地形场）
  const colony = planet.colonyId ? world.entities.colonies[planet.colonyId] : null;
  const buildings = (colony && colony.buildings) || [];
  let mines = 0;
  let dampeners = 0;
  for (const b of buildings) {
    if (b.state === 'active' || b.state === undefined) {
      if (String(b.defId || '').startsWith('bld_mine')) mines++;
      if (b.defId === 'bld_sonic_dampener') dampeners++;
    }
  }
  const indNodes = (ind.nodes || []).length;
  const edits = planet.terrainEdits && Array.isArray(planet.terrainEdits.ops)
    ? planet.terrainEdits.ops : [];
  let restores = 0;
  for (const op of edits) {
    if (op.kind === 'plant' || op.kind === 'restore') restores++;
  }

  const deltaMine = 2.0 * mines;
  const deltaInd = 0.4 * indNodes;
  const deltaCatapult = (planet.threat.pendingCatapultSpike || 0);
  const deltaRestore = 1.5 * restores;
  const deltaDampener = 6.0 * dampeners;
  const damping = th.pti * 0.015; // λ = 1.5%/小时

  th.pti = Math.round(clamp(th.pti + deltaMine + deltaInd + deltaCatapult - deltaRestore - deltaDampener - damping, 0, 1000));
  planet.threat.pendingCatapultSpike = 0; // 单次激发消费即清

  // 2) 阶梯跃迁判定
  let newTier = 0;
  for (let t = PTI_THRESHOLDS.length - 1; t >= 0; t--) {
    if (th.pti >= PTI_THRESHOLDS[t]) { newTier = t; break; }
  }
  let escalated = false;
  if (newTier > th.tier) {
    th.tier = newTier;
    escalated = true;
    th.waveCdTicks = 2; // 2 战略小时后首波
    emit(world, 'PlanetaryThreatEscalated', { planetId: planet.id, tier: newTier, pti: th.pti }, 'ground');
    if (newTier >= 4 && !th.leviathan) {
      awakenLeviathan(world, planet);
    }
  } else if (newTier < th.tier && (!th.leviathan || !th.leviathan.active)) {
    th.tier = newTier; // 平降（恢复手段奏效）
  }
  if (th.waveCdTicks > 0) th.waveCdTicks--;
  return { pti: th.pti, tier: th.tier, escalated };
}

/** 弹射发射瞬间的 PTI 激发（catapult.js 发射路径调用；hourly 结算时入账） */
export function spikeCatapultLaunch(planet) {
  ensurePlanetThreat(planet);
  planet.threat.pendingCatapultSpike = (planet.threat.pendingCatapultSpike || 0) + PTI_CATAPULT_SPIKE;
}

/**
 * Tier 4：超巨型漫游利维坦苏醒（3600 HP / 14m 级；三阶段部位破坏由战斗层消费）。
 * 持久化紧凑元组：{ active, archetype, hpPermille, wx, wz, phase }
 */
export function awakenLeviathan(world, planet) {
  const th = ensurePlanetThreat(planet);
  if (th.leviathan && th.leviathan.active) return th.leviathan;
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const ang = ((seeds.faunaSeed(99) % 3600) / 3600) * Math.PI * 2;
  th.leviathan = {
    active: true,
    archetype: leviathanArchetypeOf(planet),
    hpPermille: 1000,
    wx: Math.round(Math.cos(ang) * 190),
    wz: Math.round(Math.sin(ang) * 190),
    phase: 1,
    backCoreBroken: 0,
    toxinSacsBroken: 0,
    staggerT: 0,
  };
  planet.threat.catapultLock = true; // 利维坦场锁死货运弹射井（doc20 WP-4 战略后果）
  chronicle(world, 'crisis', `行星 ${planet.name} 采掘扰动突破临界，超巨型利维坦苏醒！`, { planetId: planet.id });
  emit(world, 'LeviathanAwakened', { planetId: planet.id, archetype: th.leviathan.archetype }, 'ground');
  return th.leviathan;
}

/**
 * 利维坦部位破坏（战斗层命中回执）：背部散热晶核/双侧毒素腺囊独立判定体积，
 * 击碎触发 6.0s stagger 瘫痪硬直并永久关闭该部位 AoE。
 */
export function breakLeviathanPart(world, planet, part) {
  const th = ensurePlanetThreat(planet);
  const lev = th.leviathan;
  if (!lev || !lev.active) return { ok: false, reason: 'NoLeviathan' };
  if (part !== 'back_core' && part !== 'toxin_sacs') return { ok: false, reason: 'BadPart' };
  if (part === 'back_core' && !lev.backCoreBroken) {
    lev.backCoreBroken = 1;
    lev.staggerT = 6.0;
  } else if (part === 'toxin_sacs' && !lev.toxinSacsBroken) {
    lev.toxinSacsBroken = 1;
    lev.staggerT = 6.0;
  } else {
    return { ok: true, already: true };
  }
  emit(world, 'LeviathanPartBroken', { planetId: planet.id, part, staggerS: 6.0 }, 'ground');
  return { ok: true, staggerS: 6.0 };
}

/**
 * 利维坦讨伐战果（战斗层上报）：PTI 归零、弹射井解锁、传奇战利品入账。
 * @returns {{ok:boolean, loot?:object}}
 */
export function reportLeviathanDefeated(world, planet) {
  const th = ensurePlanetThreat(planet);
  const lev = th.leviathan;
  if (!lev || !lev.active) return { ok: false, reason: 'NoLeviathan' };
  lev.active = false;
  lev.phase = 0;
  th.pti = 0;
  th.tier = 0;
  th.catapultLock = false;
  const fid = world.playerFactionId;
  const loot = { exoticMatter: 5, leviathanGene: 1 };
  if (fid && world.economy.ledgers[fid]) {
    const led = world.economy.ledgers[fid];
    led.balances.exoticMatter = (led.balances.exoticMatter || 0) + loot.exoticMatter;
  }
  chronicle(world, 'crisis', `行星 ${planet.name} 利维坦讨伐成功：PTI 归零，先驱者奇异物质 ×5 入账`, { planetId: planet.id });
  emit(world, 'LeviathanDefeated', { planetId: planet.id, loot }, 'ground');
  return { ok: true, loot };
}

/**
 * 阶梯增援波次构成（纯函数；GroundMission/GroundView 刷怪消费）。
 * 编制随 Tier 与派系哲学差异化（哨卫打电网/异虫打农场——目标偏好由调用方消费）。
 */
export function composeWave(world, planet, tier) {
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const s = seeds.faunaSeed(50 + tier * 7 + (planet.threat ? planet.threat.wavesSpawned || 0 : 0));
  const fac = factionOf(planet);
  if (tier <= 1) {
    return { faction: fac, units: [{ kind: 'grunt', count: 2 + (s % 2) }], targetPref: 'probe' };
  }
  if (tier === 2) {
    return { faction: fac, units: [{ kind: 'grunt', count: 4 }, { kind: 'heavy', count: 1 }], targetPref: fac === 'sentinel' ? 'power_grid' : 'mines_farms', flank: true };
  }
  if (tier === 3) {
    return { faction: fac, units: [{ kind: 'grunt', count: 6 }, { kind: 'heavy', count: 2 }, { kind: 'mortar', count: 1 }], targetPref: 'power_core', flank: true };
  }
  return { faction: fac, units: [{ kind: 'leviathan', count: 1 }], targetPref: 'all' };
}
