/**
 * domain/ground/planetWeather.js — 动态气象灾变（doc20 v0.6 WP-1 / doc16 §4.14~4.15）
 *
 * 五阶段气象状态机（doc16 §4.14）：
 *   Clear → Warning(45s) → Build-up(30s) → Peak(90~150s) → Recovery(30s) → Clear …
 * 锋面以 v = 1.8 m/s 沿风向角从场域一侧横扫（uStormFront 平面波，GPU 解析求值，
 * 严禁 CPU 逐粒子对象——doc20 红线 2 / FFF #176 纪律）。
 *
 * 确定性：气象循环由 derivePlanetSeedsExtended().weatherCycleSeed(dayIndex) 驱动，
 * 零 Math.random()、零 world.rng 消费。持久化仅 planet.threat.storm 6 元组：
 *   [active, kindIdx, dirDeg, frontPosM, intensityPermille, remainTicks]
 * （≤2KB/星，GATE-07 预算）。
 */

import { derivePlanetSeedsExtended } from './planetSeeds.js';
import { TERRAIN_FLAGS } from './terrainField.js';

/** 风暴阶段（五状态机） */
export const STORM_PHASE = Object.freeze({
  CLEAR: 0,
  WARNING: 1,
  BUILDUP: 2,
  PEAK: 3,
  RECOVERY: 4,
});

/** 阶段时长（任务秒；doc20 WP-1.2 契约） */
export const PHASE_SECONDS = Object.freeze({
  WARNING: 45,
  BUILDUP: 30,
  PEAK_MIN: 90,
  PEAK_MAX: 150,
  RECOVERY: 30,
});

/** 锋面推进速度（m/s）与场域半宽 */
export const STORM_FRONT_SPEED_M_S = 1.8;
export const FIELD_HALF_M = 256;

/** 四大旗舰极端风暴（kindIdx 0..3；doc20 WP-1.4 规则表） */
export const STORM_KINDS = Object.freeze([
  {
    id: 'super_thermal_gale', nameZh: '超温热浪风暴',
    themes: ['obsidian_lava', 'red_regolith_frontier'],
    fogRangeScale: 0.22, solarOutput: 0.15, windOutput: 2.5, jetDrainMult: 2.0,
    dmgPerSec: 0, kind: 'heat',
  },
  {
    id: 'corrosive_acid_hail', nameZh: '腐蚀酸雹风暴',
    themes: ['sulfur_marsh', 'fungal_catacombs'],
    fogRangeScale: 0.30, solarOutput: 0.5, windOutput: 1.2, jetDrainMult: 1.0,
    dmgPerSec: 4.5, tiltDeg: 35, kind: 'acid',
  },
  {
    id: 'em_plasma_superstorm', nameZh: '电磁等离子磁暴',
    themes: ['magnetar_aurora', 'prism_crystal', 'dry_night_polar'],
    fogRangeScale: 0.40, solarOutput: 0.3, windOutput: 1.0, jetDrainMult: 1.0,
    dmgPerSec: 0, lightningEveryS: 8, batteryDrainPctPerHour: 30, kind: 'plasma',
  },
  {
    id: 'cryo_whiteout_mega_tide', nameZh: '极寒白毛风与巨潮',
    themes: ['permafrost_furnace', 'abyssal_ocean', 'cryomethane_sea'],
    fogRangeScale: 0.25, solarOutput: 0.4, windOutput: 1.4, jetDrainMult: 1.5,
    dmgPerSec: 0, tideRiseM: 8.5, heatZoneShrink: 0.4, kind: 'cryo',
  },
]);

/** 主题 → 风暴档位（无匹配主题的行星按四档轮换——每颗星球都有天气身份） */
function stormKindIdxFor(planet, dayIndex) {
  const themeId = planet.primaryThemeId || '';
  for (let i = 0; i < STORM_KINDS.length; i++) {
    if (STORM_KINDS[i].themes.includes(themeId)) return i;
  }
  return dayIndex % STORM_KINDS.length;
}

/** 惰性初始化 planet.threat（doc20 WP-3 契约同形；storm 为 6 元组或 null） */
export function ensurePlanetThreat(planet) {
  if (planet.threat && planet.threat.v === 1) return planet.threat;
  planet.threat = { v: 1, pti: 0, tier: 0, waveCdTicks: 0, leviathan: null, storm: null };
  return planet.threat;
}

/**
 * 单日气象日历派生（纯函数；渲染/HUD 预报消费）。
 * 每游戏日（24 战略 tick）0~2 场风暴：kindIdx/dirDeg/起始任务秒/峰持续全由种子定。
 * @returns {{kindIdx:number, dirDeg:number, startS:number, peakS:number, phaseAt:(elapsedS:number)=>number}}
 */
export function deriveDayStormCalendar(world, planet, dayIndex) {
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const s = seeds.weatherCycleSeed(dayIndex);
  const kindIdx = stormKindIdxFor(planet, dayIndex);
  const dirDeg = (s >>> 4) % 360;
  const startS = ((s >>> 12) % 200) + 30;          // 30~229s 首风暴起点
  const peakS = PHASE_SECONDS.PEAK_MIN + ((s >>> 22) % (PHASE_SECONDS.PEAK_MAX - PHASE_SECONDS.PEAK_MIN + 1));
  const count = planet.category === 'gasGiant' ? 2 : ((s >>> 28) % 2) + 1; // 1~2 场/日
  const phaseAt = (elapsedS) => {
    const t = elapsedS - startS;
    if (t < 0 || t >= PHASE_SECONDS.WARNING + PHASE_SECONDS.BUILDUP + peakS + PHASE_SECONDS.RECOVERY) {
      return STORM_PHASE.CLEAR;
    }
    if (t < PHASE_SECONDS.WARNING) return STORM_PHASE.WARNING;
    if (t < PHASE_SECONDS.WARNING + PHASE_SECONDS.BUILDUP) return STORM_PHASE.BUILDUP;
    if (t < PHASE_SECONDS.WARNING + PHASE_SECONDS.BUILDUP + peakS) return STORM_PHASE.PEAK;
    return STORM_PHASE.RECOVERY;
  };
  return { kindIdx, dirDeg, startS, peakS, count, phaseAt };
}

/**
 * 任务秒级气象推进（GroundView 帧驱动；写入 planet.threat.storm 6 元组）。
 * storm = [active, kindIdx, dirDeg, frontPosM, intensityPermille, remainTicks]
 * 锋面：Peak 期 frontPosM 以 1.8 m/s 沿 dirDeg 从 −256 扫到 +256。
 * @param {number} missionSeconds 任务已进行秒数（场景时钟）
 * @param {number} dtSeconds 帧步长
 */
export function tickPlanetWeather(world, planet, missionSeconds, dtSeconds) {
  ensurePlanetThreat(planet);
  const th = planet.threat;
  const dayIndex = Math.floor(missionSeconds / 240); // 微缩日 = 240 任务秒（24 tick × 10s）
  const cal = deriveDayStormCalendar(world, planet, dayIndex);
  const phase = cal.phaseAt(missionSeconds);

  if (phase === STORM_PHASE.CLEAR) {
    th.storm = null;
    return null;
  }
  const intensityByPhase = phase === STORM_PHASE.WARNING ? 120
    : phase === STORM_PHASE.BUILDUP ? 450
      : phase === STORM_PHASE.PEAK ? 1000
        : 300; // Recovery 残余
  // 锋面推进：Warning 起跑（预锋面），Peak 全速，Recovery 停滞
  const speed = phase === STORM_PHASE.PEAK ? STORM_FRONT_SPEED_M_S
    : phase === STORM_PHASE.BUILDUP ? STORM_FRONT_SPEED_M_S * 0.5
      : phase === STORM_PHASE.WARNING ? STORM_FRONT_SPEED_M_S * 0.25
        : 0;
  let storm = th.storm;
  if (!storm || storm[1] !== cal.kindIdx || storm[5] === undefined) {
    storm = [1, cal.kindIdx, cal.dirDeg, -FIELD_HALF_M - 40, 0, 0];
  }
  storm[0] = 1;
  storm[1] = cal.kindIdx;
  storm[2] = cal.dirDeg;
  storm[4] = intensityByPhase;
  storm[5] = (storm[5] || 0) + Math.round(dtSeconds * 100);
  const prevFront = storm[3];
  storm[3] = Math.min(FIELD_HALF_M + 40, prevFront + speed * dtSeconds);
  th.storm = storm;
  return {
    phase,
    kindIdx: storm[1],
    dirDeg: storm[2],
    frontPosM: storm[3],
    intensityPermille: storm[4],
    kind: STORM_KINDS[storm[1]],
  };
}

/**
 * 风暴浸没度（世界坐标 → 0..1；CPU 与 GLSL uStormFront 平面波同源口径）。
 * GLSL: localStorm = smoothstep(-28,28, frontZ − proj) × intensity
 * @returns {number} 0..1（0 = 锋外）
 */
export function stormDepthAt(storm, wx, wz) {
  if (!storm || !storm[0]) return 0;
  const dirRad = (storm[2] * Math.PI) / 180;
  const cx = Math.cos(dirRad);
  const cz = Math.sin(dirRad);
  const proj = wx * cx + wz * cz;
  const front = storm[3];
  const t = (front - proj + 28) / 56; // smoothstep(-28,28, front−proj) 线性近似带沿
  const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return s * (storm[4] / 1000);
}

/**
 * 三重庇护判定（doc20 WP-2）：风暴锋面过境时角色免伤判定。
 * 1) FOUNDATION 建筑屋檐 3.5m；2) 热源/护盾穹顶半径内；3) 外骨骼抗性插件。
 * @param {{x:number,z:number}} charPos 角色世界坐标
 * @param {Array<{x:number,z:number,flags:number}>} foundations 地基建筑（TERRAIN_FLAGS.FOUNDATION 已挂旗）
 * @param {Array<{x:number,z:number,radius:number}>} heatZones uHeatZones
 * @param {Set<string>} exoMods 已装配外骨骼模块 id 集
 * @param {string} stormKind 'heat'|'acid'|'plasma'|'cryo'
 * @returns {boolean} true = 完全免伤
 */
export function isSheltered(charPos, foundations, heatZones, exoMods, stormKind) {
  const modFor = { heat: 'exo_mod_thermal_shield', acid: 'exo_mod_acid_carapace', plasma: 'exo_mod_thermal_shield', cryo: 'exo_mod_thermal_shield' };
  if (exoMods && exoMods.has(modFor[stormKind])) return true;
  if (Array.isArray(foundations)) {
    for (const f of foundations) {
      if (!(f.flags & TERRAIN_FLAGS.FOUNDATION)) continue;
      if (Math.hypot(f.x - charPos.x, f.z - charPos.z) <= 3.5) return true;
    }
  }
  if (Array.isArray(heatZones)) {
    for (const hz of heatZones) {
      if (hz.radius > 0 && Math.hypot(hz.x - charPos.x, hz.z - charPos.z) <= hz.radius) return true;
    }
  }
  return false;
}
