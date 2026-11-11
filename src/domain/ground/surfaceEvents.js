/**
 * domain/ground/surfaceEvents.js — 行星地表深度机制领域层（SPEC-39 Phase S1）
 *
 * doc38 §实现切片契约的三条动态涌现事件链 + 1~5 星警戒热度 + 4 类野战部署物，
 * 全部状态收敛进 planet.surfaceDelta 紧凑差分容器（惰性挂载，随存档持久化）：
 *   { v:1, sos:[state,srcX_dm,srcZ_dm,branchKind,resolvedChoice]|null,
 *     extraction:[active,x_dm,z_dm,remainSec_d10,completedCount],
 *     heat:[heatPermille(0..1000), starLevel(0..5), evadeSec_d10, bastionDefeated(0|1)],
 *     deployables:[ [id,kindIdx,x_dm,z_dm,hp,ttlSec_d10] ](≤8),
 *     slatesMask(24bit 日志), floraScannedMask, geoWonderScanned }
 *
 * 确定性红线（SURF-01）：
 *  - 拓扑/分支/波次编制一律消费 derivePlanetSeedsExtended 的 sosSeed/slateSeed/
 *    heatWaveSeed 子流（mix32 雪崩），零 world.rng 消费、零 Math.random；
 *  - 全部写入命令触达（InteractPoiStage/TriggerSosBeacon/DeployFieldTool/
 *    StartDeepCoreExtraction），金快照基线零漂移。
 *
 * 幂等红线（SURF-02/03）：rewardPaid===1 严格发奖锁（二次领奖 ALREADY_HARVESTED）；
 * 勘探大奖 surveyAwardPaid 一次性；slatesMask 位读锁不重复发放。
 *
 * 依赖方向：本模块不 import 任何 UI 渲染层。
 */

import { derivePlanetSeedsExtended } from './planetSeeds.js';
import { deriveSurfacePoiTopology } from './planetPOI.js';
import { getEntity } from '../entities/registry.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { credit, creditColony, debit, balance, FLOW } from '../economy/ledger.js';
import { createCharacter } from '../characters/crew.js';
import { checkAndProgressObjectives } from '../events/objectives.js';
import { surfacePoiBlueprintOf, surfaceLogOfBit, surfaceDilemmaOf } from '../../content/surfaceNarratives.js';
import { COLONY_EDICTS } from '../planets/colonyGovernance.js';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ———— 一、紧凑差分状态容器 ————————————————————————————————————

export const SURFACE_DELTA_VERSION = 1;

/** 惰性挂载 planet.surfaceDelta（幂等；气态巨行星 sos=null） */
export function ensureSurfaceDelta(world, planet) {
  if (planet.surfaceDelta && planet.surfaceDelta.v === SURFACE_DELTA_VERSION) {
    return planet.surfaceDelta;
  }
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const isGas = planet.category === 'gasGiant';
  // SOS：75% 非气态可登陆行星生成信标（doc38 §事件链一）
  let sos = null;
  if (!isGas && (seeds.sosSeed() % 100) < 75) {
    const ss = seeds.sosSeed();
    const ang = (((ss >>> 8) % 3600) / 3600) * Math.PI * 2;
    const rad = 145 + ((ss >>> 20) % 85); // 145..230m 外围环带
    const branch = (ss >>> 4) % 3;        // 0 幸存者救援 / 1 全灭遗言 / 2 海盗伏击
    sos = [
      0,                                    // state: SOS_STATE.INACTIVE
      Math.round(Math.cos(ang) * rad * 10), // srcX_dm（0.1m 分辨率定长整型）
      Math.round(Math.sin(ang) * rad * 10),
      branch,
      -1,                                   // resolvedChoice（-1 未决）
    ];
  }
  planet.surfaceDelta = {
    v: SURFACE_DELTA_VERSION,
    sos,
    extraction: [0, 0, 0, 0, 0],   // [active, x_dm, z_dm, remainSec_d10, completedCount]
    heat: [0, 0, 0, 0],            // [heatPermille, starLevel, evadeSec_d10, bastionDefeated]
    deployables: [],
    slatesMask: 0,
    floraScannedMask: 0,
    geoWonderScanned: 0,
    surveyAwardPaid: 0,            // 星际联盟勘探大奖一次性锁
    pendingWave: 0,                // 升星挂起波次星级（step 统一消费后清零）
    deepSolvedMask: 0,             // 深度 POI 三步进度（bit idx*3+stage；8 POI × 3bit）
    deepPaidMask: 0,               // 深度 POI 发奖锁（bit idx）
    deployCd: {},                  // kindIdx → 上次部署 tickSec（冷却；不入 6 元组）
  };
  return planet.surfaceDelta;
}

/** SOS 状态枚举 */
export const SOS_STATE = Object.freeze({ INACTIVE: 0, TRACKING: 1, TRIGGERED: 2, RESOLVED: 3 });
/** SOS 三分支 */
export const SOS_BRANCH = Object.freeze({ SURVIVOR_RESCUE: 0, ALL_DEAD_SLATE: 1, PIRATE_AMBUSH: 2 });

/** 信标源世界坐标（米；无信标返回 null） */
export function sosSourceOf(planet) {
  const sd = planet.surfaceDelta;
  if (!sd || !sd.sos) return null;
  return { x: sd.sos[1] / 10, z: sd.sos[2] / 10, branch: sd.sos[3], state: sd.sos[0] };
}

// ———— 二、SOS 测向：余弦定向聚焦 + 距离衰减（SURF-03） ——————————————

/** 信号模型常量（doc38 §事件链一） */
export const SOS_I0 = 1.0;
export const SOS_R_ATTEN_M = 180;
/**
 * 定向聚焦指数 γ=7（SURF-03 红线「偏角 >45° 定向增益衰减 ≥90%」的精确解）：
 * 定向增益 G(θ)=0.80·max(0,cosθ)^γ；G(45°)=0.80·0.0884=0.0707 → 衰减 91.2% ≥90%。
 * （doc38 设计稿 γ=6.0 在 45° 处仅 87.5% 衰减，不满足 SPEC-40 零容忍红线，取 7.0 收严。）
 */
export const SOS_GAMMA = 7.0;
export const SOS_TRIGGER_RADIUS_M = 6.0;
export const SOS_STORM_ETA_MAX = 0.70;
/** 背景底噪焦点（全偏角保底 20% 信号感） */
export const SOS_FOCUS_FLOOR = 0.20;
/** 定向增益满偏幅值 */
export const SOS_FOCUS_SPAN = 0.80;

/** 定向增益（0..1 归一；on-axis=1.0）：G(θ)=max(0,cosθ)^γ（SURF-03 门禁消费） */
export function sosDirectionalGain(facingAngleRad, sourceAngleRad) {
  const c = Math.cos(facingAngleRad - sourceAngleRad);
  return Math.pow(Math.max(0, Number.isFinite(c) ? c : 0), SOS_GAMMA);
}

/**
 * 信噪比评估（纯函数）。
 * S_k(r,θ) = I0 · exp(−r/R_atten) · (0.20 + 0.80·cosθ^γ) · (1 − η_storm)，钳制 [0,1]；
 * 偏角 >45° 时定向增益衰减 ≥91%（γ=7）→ 背景白噪声。
 * @param {number} distM 玩家到信标距离（米）
 * @param {number} facingAngleRad 玩家视线朝向角
 * @param {number} sourceAngleRad 信标方位角
 * @param {number} stormEta 电离干扰系数 [0,1]（em_plasma_superstorm 峰值 0.70）
 * @returns {{ rawSignal:number, noiseLevel:number, offAxisDeg:number, gain:number }}
 */
export function evaluateSosSignalscope(distM, facingAngleRad, sourceAngleRad, stormEta = 0) {
  const d = Math.max(0, Number(distM) || 0);
  let cosT = Math.cos(facingAngleRad - sourceAngleRad);
  if (!Number.isFinite(cosT)) cosT = 0;
  const gain = Math.pow(Math.max(0, cosT), SOS_GAMMA);
  const focus = SOS_FOCUS_FLOOR + SOS_FOCUS_SPAN * gain;
  const eta = clamp(Number(stormEta) || 0, 0, SOS_STORM_ETA_MAX);
  const rawSignal = clamp(SOS_I0 * Math.exp(-d / SOS_R_ATTEN_M) * focus * (1 - eta), 0, 1);
  const noiseLevel = clamp(1 - rawSignal + 0.35 * eta, 0.05, 1.0);
  const offAxisDeg = Math.abs(((facingAngleRad - sourceAngleRad) * 180) / Math.PI) % 360;
  return { rawSignal, noiseLevel, offAxisDeg: offAxisDeg > 180 ? 360 - offAxisDeg : offAxisDeg, gain };
}

/**
 * 触发信标处置（≤6m 按 E；TriggerSosBeacon 命令执行体）。
 * 三分支（doc38）：A 幸存者救援 / B 黑匣子绝笔 / C 海盗伏击。
 * 幂等：state 已 RESOLVED 或 TRIGGERED → 拒绝重复处置。
 */
export function triggerSosBeaconOutcome(world, planetId, actorId) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const sd = ensureSurfaceDelta(world, planet);
  if (!sd.sos) return { ok: false, code: 'NO_SOS', reason: '本行星无求救信标' };
  if (sd.sos[0] === SOS_STATE.RESOLVED || sd.sos[0] === SOS_STATE.TRIGGERED) {
    return { ok: false, code: 'ALREADY_HARVESTED', reason: '该信标已处置完毕' };
  }
  const factionId = actorId || world.playerFactionId;
  const branch = sd.sos[3];
  const rewards = {};
  if (branch === SOS_BRANCH.SURVIVOR_RESCUE) {
    Object.assign(rewards, { credits: 400, researchData: 35 });
    credit(world, factionId, 'credits', 400, 'sosRescue', planet.id, FLOW.LOOT);
    credit(world, factionId, 'researchData', 35, 'sosRescue', planet.id, FLOW.LOOT);
    chronicle(world, 'event', 'SOS 求救信标：幸存者救援成功，星盟补偿已入账', { planetId });
  } else if (branch === SOS_BRANCH.ALL_DEAD_SLATE) {
    Object.assign(rewards, { ancientData: 10, alloy: 40 });
    credit(world, factionId, 'ancientData', 10, 'sosBlackbox', planet.id, FLOW.LOOT);
    credit(world, factionId, 'alloy', 40, 'sosBlackbox', planet.id, FLOW.LOOT);
    chronicle(world, 'event', 'SOS 求救信标：全员罹难——黑匣子绝笔已存入编年史', { planetId });
  } else {
    // 海盗伏击：战利品在击败伏兵后由战斗域结算；此处登记遭遇
    Object.assign(rewards, { ambush: true });
    chronicle(world, 'event', 'SOS 求救信标：鉴别为海盗陷阱——伏击小队已现身', { planetId });
  }
  sd.sos[0] = SOS_STATE.RESOLVED;
  sd.sos[4] = branch;
  emit(world, 'SosBeaconResolved', { planetId, branch, rewards }, 'ground');
  checkAndProgressObjectives(world, (o) => o.targetPlanetId === planetId && o.factionId === factionId);
  return { ok: true, branch, rewards };
}

// ———— 三、行星大勘探：50% 动物 + 30% 植物 + 20% 地质奇观（SURF-03） ————————

/** 勘探度加权（doc38 §事件链二契约） */
export const SURVEY_WEIGHTS = Object.freeze({ fauna: 0.50, flora: 0.30, geo: 0.20 });
/** 100% 闭环目标：3 原生动物 + 2 奇异植物 + 1 地质奇观 */
export const SURVEY_TARGET = Object.freeze({ fauna: 3, flora: 2, geo: 1 });

/**
 * 行星勘探度 0..100（纯函数）。
 * faunaRatio = min(1, 已掌握原生动物/3)；floraRatio = min(1, floraScannedMask 位计数/2)；
 * geoRatio = geoWonderScanned ? 1 : 0。不育天体（无物种）只看 geoWonderScanned。
 */
export function computePlanetarySurveyPercent(planet) {
  if (!planet) return 0;
  const sd = planet.surfaceDelta;
  const totalSpecies = planet.eco ? (planet.eco.speciesCount || 0) : 0; // doc18 契约字段（getPlanetSpeciesCount 同源）
  let faunaRatio = 0;
  if (totalSpecies > 0 && planet.eco && planet.eco.discoveryMask != null) {
    let mastered = 0;
    for (let i = 0; i < totalSpecies; i++) {
      if (((planet.eco.discoveryMask >>> (i * 2)) & 0b11) >= 3) mastered++; // 0b11 = MASTERED
    }
    faunaRatio = Math.min(1, mastered / SURVEY_TARGET.fauna);
  }
  let floraRatio = 0;
  if (sd) {
    let bits = 0;
    let m = sd.floraScannedMask >>> 0;
    while (m) {
      m &= m - 1;
      bits++;
    }
    floraRatio = Math.min(1, bits / SURVEY_TARGET.flora);
  }
  const geoRatio = sd && sd.geoWonderScanned ? 1 : 0;
  if (totalSpecies === 0) return geoRatio ? 100 : 0;
  return Math.round((SURVEY_WEIGHTS.fauna * faunaRatio + SURVEY_WEIGHTS.flora * floraRatio + SURVEY_WEIGHTS.geo * geoRatio) * 100);
}

/**
 * 星际联盟勘探大奖（100% 触发；严格幂等——二次调用不重复派发）。
 */
export function grantSurveyAwardIfComplete(world, planetId, actorId) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const sd = ensureSurfaceDelta(world, planet);
  if (sd.surveyAwardPaid) return { ok: false, code: 'ALREADY_HARVESTED', reason: '勘探大奖已发放' };
  if (computePlanetarySurveyPercent(planet) < 100) {
    return { ok: false, code: 'SURVEY_INCOMPLETE', reason: `勘探度 ${computePlanetarySurveyPercent(planet)}% 未满` };
  }
  const factionId = actorId || world.playerFactionId;
  const prize = { credits: 1200, researchData: 60, ancientData: 6 };
  credit(world, factionId, 'credits', prize.credits, 'surveyGrandPrize', planet.id, FLOW.LOOT);
  credit(world, factionId, 'researchData', prize.researchData, 'surveyGrandPrize', planet.id, FLOW.LOOT);
  credit(world, factionId, 'ancientData', prize.ancientData, 'surveyGrandPrize', planet.id, FLOW.LOOT);
  sd.surveyAwardPaid = 1;
  chronicle(world, 'event', `星际联盟大奖：${planet.name} 全要素勘探 100% 完成，奖金与勋章已入账`, { planetId });
  emit(world, 'SurveyGrandAward', { planetId, prize }, 'ground');
  checkAndProgressObjectives(world, (o) => o.targetPlanetId === planetId && o.factionId === factionId);
  return { ok: true, prize };
}

/** 植物扫描位登记（floraScannedMask bit idx；幂等） */
export function recordFloraScan(world, planetId, slotIdx) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const sd = ensureSurfaceDelta(world, planet);
  const bit = 1 << (clamp(slotIdx | 0, 0, 30));
  const before = sd.floraScannedMask;
  sd.floraScannedMask |= bit;
  return { ok: true, firstSeen: before !== sd.floraScannedMask, floraScannedMask: sd.floraScannedMask };
}

/** 地质奇观扫描登记（幂等置 geoWonderScanned=1） */
export function recordGeoWonderScan(world, planetId) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const sd = ensureSurfaceDelta(world, planet);
  const first = sd.geoWonderScanned !== 1;
  sd.geoWonderScanned = 1;
  return { ok: true, firstSeen: first };
}

// ———— 四、1~5 星警戒热度动态微分（SURF-04） ————————————————————

/** 星级跃迁阈值（‰）：[0,150,320,520,720,900] */
export const HEAT_STAR_THRESHOLDS = Object.freeze([0, 150, 320, 520, 720, 900]);
/** 热源（‰/次 或 ‰/s） */
export const HEAT_GAIN = Object.freeze({
  digOre: 18,            // 采掘矿脉/挖掘体素
  killHerbivore: 45,     // 猎杀温和生物
  extractionStart: 180,  // 深核钻机启动
  drillNoisePerSec: 4.5, // 钻探持续噪音
  forcedDecrypt: 260,    // 强行破解受保护先驱遗迹
});
/** 消退：脱战（42m 内无敌）λ_base；诱饵弹 λ_decoy（15s） */
export const HEAT_DECAY = Object.freeze({ basePerSec: 8.5, decoyPerSec: 25.0, decoyRadiusM: 18, decoyDurationS: 15, nearHostileM: 42 });
/** 诱饵弹瞬时削减 */
export const DECOY_HEAT_CUT = 220;
/** 5 星首领：重装步行要塞（HP） */
export const BASTION_HP = 1200;

/**
 * 局部热度 +Δ（钳制 0..1000；跨跃迁线时 emit StarUp 事件）。
 */
export function addSurfaceHeat(world, planet, delta, reason = '') {
  const sd = ensureSurfaceDelta(world, planet);
  const before = sd.heat[0];
  const beforeStar = sd.heat[1];
  const after = clamp(before + delta, 0, 1000);
  sd.heat[0] = after;
  sd.heat[1] = starLevelOf(after);
  // 升星跃迁：挂起增援波次（stepSurfaceThreatAndDeployables 统一消费；降星不挂起）
  if (sd.heat[1] > beforeStar && sd.heat[1] >= 1) {
    sd.pendingWave = sd.heat[1];
  }
  if (after > before) {
    emit(world, 'SurfaceHeatGain', { planetId: planet.id, delta, reason, heatPermille: after, starLevel: sd.heat[1] }, 'ground');
  }
  return sd.heat;
}

/** 热度（‰）→ 星级 0..5 */
export function starLevelOf(heatPermille) {
  const h = clamp(Math.round(heatPermille), 0, 1000);
  let lv = 0;
  for (let i = 1; i < HEAT_STAR_THRESHOLDS.length; i++) {
    if (h >= HEAT_STAR_THRESHOLDS[i]) lv = i;
  }
  return lv;
}

/**
 * 增援波次编制（heatWaveSeed(star, waveIdx) 确定性派生；SURF-01 零 rng 消费）。
 * 星级 → 编制基线（doc38 §热度阶梯）：
 *   ★1 侦察机偶 ×2 / ★2 猎杀包 3+1 / ★3 压制班 4+2+炮台 / ★4 轨道拦截 5+3 / ★5 要塞 1+4
 * @returns {{ star:number, grunts:number, heavies:number, turret:boolean, bastion:boolean, seed:number }}
 */
export function composeHeatWave(world, planet, star, waveIdx) {
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const seed = seeds.heatWaveSeed(star, waveIdx);
  const table = {
    1: { grunts: 2, heavies: 0, turret: false, bastion: false },
    2: { grunts: 3, heavies: 1, turret: false, bastion: false },
    3: { grunts: 4, heavies: 2, turret: true, bastion: false },
    4: { grunts: 5, heavies: 3, turret: false, bastion: false },
    5: { grunts: 0, heavies: 4, turret: false, bastion: true },
  };
  const base = table[clamp(star | 0, 1, 5)] || table[1];
  return { star, waveIdx, ...base, flank: (seed >>> 3) % 2 === 0, seed };
}

/**
 * 热度与部署物推进步（SURF-04 核心微分方程；纯状态机，dt=1/30s 粒度由调用方定）。
 * H(t+Δt) = clamp(H(t) + Σ增减 − (nearHostile<42m ? 0 : 8.5)·Δt − (诱饵活跃 ? 25.0)·Δt, 0, 1000)
 *
 * @param {object} world 世界实体
 * @param {object} planet 行星实体（surfaceDelta 就地更新）
 * @param {number} dtSec 步长秒
 * @param {{ drillNoiseActive?:boolean, nearHostileM?:number, hostiles?:Array<object> }} env
 *        env.hostiles：供诱饵 overrideTarget 改写的敌军列表（元素可带 overrideTarget 字段）
 * @returns {{ heat:number, star:number, spawns:Array<object>, expired:hexId[] }}
 */
export function stepSurfaceThreatAndDeployables(world, planet, dtSec, env = {}) {
  const sd = ensureSurfaceDelta(world, planet);
  const dt = Math.max(0, Number(dtSec) || 0);
  const spawns = [];
  const expired = [];

  // —— 1) 噪音源：深核钻探持续 +4.5/s ——
  if (sd.extraction[0] === 1 && sd.extraction[3] > 0) {
    const remainTenths = Math.max(0, sd.extraction[3] - Math.round(dt * 10));
    sd.extraction[3] = remainTenths;
    addSurfaceHeat(world, planet, HEAT_GAIN.drillNoisePerSec * dt, 'drillNoise');
    if (remainTenths === 0) {
      sd.extraction[0] = 0;
      sd.extraction[4] += 1;
      onExtractionComplete(world, planet);
    }
  }

  // —— 2) 部署物生命周期（ttl 递减；诱饵活跃窗口拉仇恨 + 削热） ——
  let decoyActive = false;
  for (const dep of sd.deployables) {
    if (dep[5] <= 0) continue;
    dep[5] = Math.max(0, dep[5] - Math.round(dt * 10));
    if (dep[5] === 0) {
      expired.push(dep[0]);
      continue;
    }
    if (dep[1] === 3) { // dep_decoy_emitter
      decoyActive = true;
      // 15s 内强制改写 18m 内敌军 overrideTarget（拉走仇恨）
      if (Array.isArray(env.hostiles)) {
        for (const h of env.hostiles) {
          if (!h || typeof h !== 'object') continue;
          const dx = (h.x || 0) - dep[2] / 10;
          const dz = (h.z || 0) - dep[3] / 10;
          if (Math.hypot(dx, dz) <= HEAT_DECAY.decoyRadiusM) {
            h.overrideTarget = { kind: 'decoy', deployableId: dep[0] };
          }
        }
      }
    }
  }
  if (expired.length) {
    sd.deployables = sd.deployables.filter((d) => d[5] > 0);
  }

  // —— 3) 热度自然消退（脱战 λ_base；诱饵 λ_decoy） ——
  const nearHostile = Number.isFinite(env.nearHostileM) ? env.nearHostileM < HEAT_DECAY.nearHostileM : false;
  let decay = 0;
  if (!nearHostile) decay += HEAT_DECAY.basePerSec;
  if (decoyActive) decay += HEAT_DECAY.decoyPerSec;
  if (decay > 0 && sd.heat[0] > 0) {
    addSurfaceHeat(world, planet, -decay * dt, 'decay');
  }

  // —— 4) 星级跃迁 → 确定性增援波次（addSurfaceHeat 升星时挂起；此处单次消费） ——
  if (sd.pendingWave >= 1) {
    const star = sd.pendingWave | 0;
    sd.pendingWave = 0;
    const waveIdx = (sd.heat[2] = (sd.heat[2] + 1)) - 1; // heat[2] 复用为波次计数
    const wave = composeHeatWave(world, planet, star, waveIdx);
    spawns.push(wave);
    emit(world, 'SurfaceStarUp', { planetId: planet.id, star, wave }, 'ground');
  }
  return { heat: sd.heat[0], star: sd.heat[1], spawns, expired };
}

/** 深核采掘时长（秒；钻探期间 +4.5/s 噪音持续） */
export const DEEP_CORE_DURATION_S = 600;

/**
 * 启动深核矿脉采掘（StartDeepCoreExtraction 命令执行体）。
 * 启动瞬间 +180‰ 热度；extraction 元组 [active,x_dm,z_dm,remainSec_d10,completedCount]。
 * 互斥：同一行星同一时刻仅一台钻机（active===1 拒绝重复启动）。
 */
export function startDeepCoreExtraction(world, planetId, xM, zM) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  if (planet.category === 'gasGiant') return { ok: false, code: 'BAD_CATEGORY', reason: '气态巨行星无法地表采掘' };
  const sd = ensureSurfaceDelta(world, planet);
  if (sd.extraction[0] === 1) {
    return { ok: false, code: 'ALREADY_ACTIVE', reason: '深核钻机已在作业中' };
  }
  sd.extraction = [1, Math.round(xM * 10), Math.round(zM * 10), Math.round(DEEP_CORE_DURATION_S * 10), sd.extraction[4] || 0];
  addSurfaceHeat(world, planet, HEAT_GAIN.extractionStart, 'deepCoreStart');
  emit(world, 'DeepCoreStarted', { planetId, xM, zM, durationS: DEEP_CORE_DURATION_S }, 'ground');
  chronicle(world, 'event', `深核采掘启动：${planet.name} 钻机就位（噪音将引来警戒增援）`, { planetId });
  return { ok: true, extraction: sd.extraction.slice() };
}

/** 深核采掘完成结算（+产出；幂等由 remainSec 归零单次触发保证） */
function onExtractionComplete(world, planet) {
  const fid = world.playerFactionId;
  const colony = planet.colonyId ? getEntity(world, 'colonies', planet.colonyId) : null;
  const useColony = !!(colony && colony.factionId === fid);
  const yieldTable = { rareEarth: 22, heavyMetal: 25, helium3: 18 };
  for (const rid of Object.keys(yieldTable).sort()) {
    if (useColony) creditColony(world, colony, rid, yieldTable[rid], 'deepCore', planet.id);
    else credit(world, fid, rid, yieldTable[rid], 'deepCore', planet.id, FLOW.PRODUCE);
  }
  chronicle(world, 'event', `深核采掘完成：${planet.name} 同位素罐已入账（第 ${planet.surfaceDelta.extraction[4]} 罐）`, { planetId: planet.id });
  emit(world, 'DeepCoreExtracted', { planetId: planet.id, yields: yieldTable }, 'ground');
}

// ———— 五、4 类野战部署物（SURF-04） ————————————————————————————

/** 部署物定义（doc38 §部署物表；kindIdx 与 6 元组 [1] 槽严格对齐） */
export const FIELD_DEPLOYABLES = Object.freeze([
  {
    id: 'dep_gpr_radar', kindIdx: 0, nameZh: '便携式探地雷达', tris: 128,
    cost: { powerCell: 1 }, cooldownS: 30, ttlS: 120, hp: 80, radiusM: 85,
    desc: '低频地震波穿透揭示 85m 内地下矿脉 / 隐藏密室 / 掩埋货柜',
  },
  {
    id: 'dep_thermal_pylon', kindIdx: 1, nameZh: '临时充能桩', tris: 96,
    cost: { powerCell: 1, alloy: 4 }, cooldownS: 40, ttlS: 90, hp: 120, radiusM: 12,
    desc: '12m 琥珀热能护盾：极寒冰暴/酸雹环境伤害免疫，+6 护盾/s、+10 外骨骼能量/s',
  },
  {
    id: 'dep_sentry_turret', kindIdx: 2, nameZh: '便携式防御哨兵机枪塔', tris: 180,
    cost: { alloy: 8, powerCell: 1 }, cooldownS: 45, ttlS: 75, hp: 150, rangeM: 24, dps: 18,
    desc: '自动索敌 24m 内最近敌人，动能弹幕 + 减速',
  },
  {
    id: 'dep_decoy_emitter', kindIdx: 3, nameZh: '全频段信号诱饵弹', tris: 110,
    cost: { reagents: 4 }, cooldownS: 35, ttlS: 15, hp: 60, radiusM: 18,
    desc: '瞬间 −220‰ 热度；15s 强制吸引 18m 内敌军仇恨（overrideTarget）',
  },
]);

export function fieldDeployableOf(kindIdOrIdx) {
  if (typeof kindIdOrIdx === 'number') return FIELD_DEPLOYABLES[kindIdx(kindIdOrIdx)] || null;
  return FIELD_DEPLOYABLES.find((d) => d.id === kindIdOrIdx) || null;
}
function kindIdx(i) { return i | 0; }

/** 部署物放置上限 */
export const DEPLOYABLE_CAP = 8;

/**
 * 部署野战工具（DeployFieldTool 命令执行体）。
 * 校验：种类存在 / 场上 ≤8 / 冷却期 / 资源足额（事务性：扣费失败整体拒绝）。
 * @returns {{ok:boolean, code?:string, reason?:string, deployable?:Array}}
 */
export function placeFieldDeployable(world, planetId, kindId, xM, zM) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const def = fieldDeployableOf(kindId);
  if (!def) return { ok: false, code: 'BAD_KIND', reason: '未知部署物类型' };
  const fid = world.playerFactionId;
  if (!fid) return { ok: false, code: 'NO_FACTION', reason: '无归属文明' };
  const sd = ensureSurfaceDelta(world, planet);
  if (sd.deployables.length >= DEPLOYABLE_CAP) {
    return { ok: false, code: 'CAP_REACHED', reason: `场上部署物已达上限 ${DEPLOYABLE_CAP}` };
  }
  // 冷却：同种类最近一次部署在 cooldownS 内拒绝（时间戳存 sd.deployCd，
  // 6 元组契约 [id,kindIdx,x_dm,z_dm,hp,ttlSec_d10] 不破）
  sd.deployCd ||= {};
  const nowSec = world.tick * 3600; // 战略 tick(小时) → 秒口径；同 tick 内多次部署共享窗口
  const lastAt = sd.deployCd[def.kindIdx];
  if (Number.isFinite(lastAt) && nowSec - lastAt < def.cooldownS) {
    return { ok: false, code: 'COOLDOWN', reason: `${def.nameZh} 冷却中` };
  }
  // 资源扣费（命令事务保证失败回滚）
  for (const rid of Object.keys(def.cost).sort()) {
    if (balance(world, fid, rid) < def.cost[rid]) {
      return { ok: false, code: 'NO_FUNDS', reason: `${def.nameZh} 需要 ${rid}×${def.cost[rid]}` };
    }
  }
  for (const rid of Object.keys(def.cost).sort()) {
    debit(world, fid, rid, def.cost[rid], 'deployFieldTool', planet.id, FLOW.CONSUME);
  }
  // 诱饵弹：瞬间 −220‰
  if (def.id === 'dep_decoy_emitter') {
    addSurfaceHeat(world, planet, -DECOY_HEAT_CUT, 'decoyCut');
  }
  const dep = [world.seq = (world.seq || 0) + 1, def.kindIdx, Math.round(xM * 10), Math.round(zM * 10), def.hp, Math.round(def.ttlS * 10)];
  sd.deployables.push(dep);
  sd.deployCd[def.kindIdx] = nowSec;
  emit(world, 'SurfaceDeployed', { planetId: planet.id, kindId: def.id, xM, zM }, 'ground');
  return { ok: true, deployable: dep };
}

/**
 * 充能桩热能护盾圈：极寒/酸雹风暴期间 12m 半径内护盾持续回充、环境扣血为 0（纯函数）。
 * @returns {{ shielded:boolean, distM:number, shieldRegenPerSec:number }}
 */
export function pylonShelterAt(planet, xM, zM) {
  const sd = planet && planet.surfaceDelta;
  if (!sd) return { shielded: false, distM: Infinity, shieldRegenPerSec: 0 };
  const PYLON_RADIUS = 12;
  const REGEN = 6.0;
  let best = Infinity;
  for (const dep of sd.deployables) {
    if (dep[1] !== 1 || dep[5] <= 0) continue;
    const d = Math.hypot(xM - dep[2] / 10, zM - dep[3] / 10);
    if (d < best) best = d;
  }
  return { shielded: best <= PYLON_RADIUS, distM: best, shieldRegenPerSec: best <= PYLON_RADIUS ? REGEN : 0 };
}

/** 哨兵塔自动索敌（纯函数；24m 内最近敌） */
export function sentryTargetAt(planet, hostiles) {
  const sd = planet && planet.surfaceDelta;
  if (!sd || !Array.isArray(hostiles)) return null;
  let best = null;
  let bestD = Infinity;
  for (const dep of sd.deployables) {
    if (dep[1] !== 2 || dep[5] <= 0) continue;
    const dx0 = dep[2] / 10;
    const dz0 = dep[3] / 10;
    for (const h of hostiles) {
      if (!h || h.hp <= 0) continue;
      const d = Math.hypot((h.x || 0) - dx0, (h.z || 0) - dz0);
      if (d <= 24 && d < bestD) {
        bestD = d;
        best = h;
      }
    }
  }
  return best;
}

// ———— 六、POI 三步微副本状态机（SURF-02） ————————————————————

/** 兼容旧档/旧八类 POI：kind → 蓝图 id 映射（ancient_ruin/crashed_ship 保底映射） */
const LEGACY_KIND_TO_BLUEPRINT = Object.freeze({
  crashed_ship: 'poi_wreck_pioneer_frigate',
  ancient_ruin: 'poi_xeno_ring_monolith',
  deep_vein: 'poi_outpost_deepcore_rig',
  lost_station: 'poi_outpost_comms_bunker',
  bio_trace: 'poi_outpost_xenobio_lab',
  magnetic_anomaly: 'poi_xeno_antigrav_pylon',
  subsurface_ocean: 'poi_outpost_hydroponic_dome',
  storm_vortex: 'poi_xeno_harmonic_prism',
});

/** POI 实体的生效蓝图 id（surfaceBlueprintId 优先；旧档按 kind 映射；未知回退护卫舰） */
export function poiBlueprintId(poi) {
  if (poi.surfaceBlueprintId && surfacePoiBlueprintOf(poi.surfaceBlueprintId)) return poi.surfaceBlueprintId;
  return LEGACY_KIND_TO_BLUEPRINT[poi.kind] || 'poi_wreck_pioneer_frigate';
}

/**
 * POI 三步微副本推进（InteractPoiStage 命令执行体；深度拓扑层）。
 * 严格按序：bit0（切割/清障）→ bit1（通电/解密）→ bit2（领奖/读日志）。
 * 可变状态仅 surfaceDelta.deepSolvedMask/deepPaidMask 两掩码（拓扑为种子派生零存储）。
 * 奖励幂等：deepPaidMask 位 ===1 后二次终步严格 ALREADY_HARVESTED。
 *
 * @param {object} world 世界实体
 * @param {string} planetId 行星 id
 * @param {string|number} poiIdOrIdx 深度 POI id（`${planetId}_deep_${n}`）或 idx
 * @param {object|null} field 场域（可选；供拓扑坡度落位复算，命令通路可不传）
 * @returns {{ok:boolean, code?:string, reason?:string, stage?:number, solvedMask?:number, rewards?:object, logBit?:number, dilemmaId?:string}}
 */
export function interactPoiStage(world, planetId, poiIdOrIdx, field = null) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const topo = deriveSurfacePoiTopology(world, planet, field);
  const poi = topo.find((t) => t.id === poiIdOrIdx) || topo[Number(poiIdOrIdx) | 0];
  if (!poi) return { ok: false, code: 'NO_POI', reason: '兴趣点不存在' };
  const factionId = world.playerFactionId;
  if (!factionId) return { ok: false, code: 'NO_FACTION', reason: '无归属文明' };
  const sd = ensureSurfaceDelta(world, planet);
  const bp = poi.blueprint;
  const shift = poi.idx * 3;
  let solved = (sd.deepSolvedMask >>> shift) & 0b111;
  const paid = ((sd.deepPaidMask >>> poi.idx) & 1) === 1;
  const stage = popcount(solved); // 下一个待完成步骤 0/1/2
  if (stage >= 3) {
    return { ok: false, code: 'ALREADY_HARVESTED', reason: '该兴趣点三步已全部完成' };
  }

  // —— 终步（bit2 领奖）：严格幂等发奖 ——
  if (stage === 2) {
    if (paid) {
      return { ok: false, code: 'ALREADY_HARVESTED', reason: '该兴趣点已采样结算' };
    }
    const rewards = {};
    const colony = planet.colonyId ? getEntity(world, 'colonies', planet.colonyId) : null;
    const useColony = !!(colony && colony.factionId === factionId);
    for (const rid of Object.keys(bp.rewards || {}).sort()) {
      const amt = bp.rewards[rid];
      if (!(amt > 0)) continue;
      if (useColony) creditColony(world, colony, rid, amt, 'poiStage', planet.id);
      else credit(world, factionId, rid, amt, 'poiStage', planet.id, FLOW.LOOT);
      rewards[rid] = amt;
    }
    // 一次性叙事数据板（slatesMask 位读锁；logGroup 关联第 1 则）
    let logBit = -1;
    if (bp.logGroup != null) {
      const log = surfaceLogOfBit(bp.logGroup * 3 + 0);
      if (log) {
        logBit = bp.logGroup * 3 + 0;
        if (!((sd.slatesMask >>> logBit) & 1)) {
          sd.slatesMask |= 1 << logBit;
          chronicle(world, 'lore', `数据板解读：${log.group.titleZh} · ${log.titleZh}`, { planetId, poiId: poi.id });
        } else {
          logBit = -1; // 已读过：不重复发放/记史
        }
      }
    }
    sd.deepSolvedMask |= 0b100 << shift;
    sd.deepPaidMask |= 1 << poi.idx;
    // 深井矿站：永久丰度 ×1.25（doc38 POI-07 契约）
    if (bp.id === 'poi_outpost_deepcore_rig') {
      planet.deposits ||= {};
      for (const key of ['rareEarth', 'heavyMetal']) {
        if ((planet.deposits[key] || 0) > 0) planet.deposits[key] = Math.round(planet.deposits[key] * 1.25);
      }
    }
    // 终局道德抉择卡（冷冻救生艇固定卡；xeno 类按 slateSeed 二选一）
    let dilemmaId = bp.dilemmaId || null;
    if (!dilemmaId && bp.cat === 'xeno') {
      const ss = derivePlanetSeedsExtended(world, planet.id).slateSeed(poi.id);
      dilemmaId = ['dil_ground_sentient_automata', 'dil_ground_stranded_pirate'][ss % 2];
    }
    if (dilemmaId) pushSurfaceDilemma(world, planet, dilemmaId);
    emit(world, 'PoiStageAdvanced', { planetId, poiId: poi.id, stage: 2, rewards, logBit, dilemmaId }, 'ground');
    checkAndProgressObjectives(world, (o) => o.targetPlanetId === planetId && o.factionId === factionId);
    return { ok: true, stage: 2, solvedMask: (sd.deepSolvedMask >>> shift) & 0b111, rewards, logBit, dilemmaId };
  }

  // —— bit0 / bit1：工序推进（严格按序；solved 即进度计数） ——
  solved |= (stage === 0 ? 0b001 : 0b010);
  sd.deepSolvedMask = (sd.deepSolvedMask & ~(0b111 << shift)) | (solved << shift);
  if (stage === 1) {
    // 钻机唤醒（POI-07 bit1）：+180 瞬时热度
    if (bp.id === 'poi_outpost_deepcore_rig') {
      addSurfaceHeat(world, planet, HEAT_GAIN.extractionStart, 'rigWake');
    }
    // 受保护先驱遗迹强行破译（xeno bit1）：+260 瞬时热度
    if (bp.cat === 'xeno') {
      addSurfaceHeat(world, planet, HEAT_GAIN.forcedDecrypt, 'forcedDecrypt');
    }
  }
  emit(world, 'PoiStageAdvanced', { planetId, poiId: poi.id, stage, solvedMask: solved }, 'ground');
  return { ok: true, stage, solvedMask: solved };
}

function popcount(v) {
  let m = v >>> 0;
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

// ———— 七、终局道德抉择卡（经 world.narrative.pendingChoices 非侵入模态） ————

/**
 * 推送地表道德抉择卡（App._openNonIntrusiveEventModal 消费；
 * ResolveEventChoice → narrative.resolveChoice 检 pending.surface 分支回写）。
 */
export function pushSurfaceDilemma(world, planet, dilemmaId) {
  const def = surfaceDilemmaOf(dilemmaId);
  if (!def) return null;
  world.narrative ||= {};
  world.narrative.pendingChoices ||= [];
  if (world.narrative.pendingChoices.some((p) => p.eventId === def.id)) return null;
  const entry = {
    eventId: def.id,
    titleZh: def.titleZh,
    bodyZh: def.bodyZh,
    mutexGroup: null,
    expiresTick: null,
    choices: def.choices.map((c) => ({
      id: c.id,
      labelZh: c.labelZh,
      hintZh: c.hintZh || null,
      cost: c.cost || null,
    })),
    firedTick: world.tick,
    surface: { planetId: planet.id, dilemmaId: def.id }, // 域侧回写路由标记
  };
  world.narrative.pendingChoices.push(entry);
  chronicle(world, 'event', `地表抉择：${def.titleZh}`, { planetId: planet.id, dilemmaId });
  return entry;
}

/**
 * 地表抉择结算（narrative.resolveChoice 的 pending.surface 分支执行体）。
 * 资源经 ledger FLOW 管道；希望/不满回写 planet.soc（colonyGovernance 双轨）。
 * 事务性：资源不足整体拒绝（命令总线回滚）。
 */
export function resolveSurfaceDilemma(world, pending, choiceId) {
  const def = surfaceDilemmaOf(pending.dilemmaId || pending.eventId);
  if (!def) return { ok: false, reason: '未知地表抉择' };
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: '未知选项' };
  const planet = getEntity(world, 'planets', pending.surface && pending.surface.planetId);
  const fid = world.playerFactionId;
  // 第三选项解锁条件校验（bookish 总督 / mercantile / axiom 科技）
  if (choice.requireKind) {
    if (!surfaceDilemmaUnlocked(world, planet, choice.requireKind)) {
      return { ok: false, reason: '该选项未解锁（不满足总督特质/科技条件）' };
    }
  }
  // 成本校验（事务性）
  for (const rid of Object.keys(choice.cost || {})) {
    if (balance(world, fid, rid) < choice.cost[rid]) {
      return { ok: false, reason: `资源不足：${rid}` };
    }
  }
  for (const rid of Object.keys(choice.cost || {})) {
    debit(world, fid, rid, choice.cost[rid], `surfaceChoice:${def.id}`, planet ? planet.id : null, FLOW.CONSUME);
  }
  for (const rid of Object.keys(choice.grant || {}).sort()) {
    credit(world, fid, rid, choice.grant[rid], `surfaceChoice:${def.id}`, planet ? planet.id : null, FLOW.LOOT);
  }
  // 希望/不满双轨回写（聚落已激活时）
  if (planet && planet.soc && planet.soc.v === 1) {
    planet.soc.hope = clamp(planet.soc.hope + (choice.hope || 0), 0, 100);
    planet.soc.discontent = clamp(planet.soc.discontent + (choice.discontent || 0), 0, 100);
    planet.soc.history.push({ tick: world.tick, dilemmaId: def.id, choiceId: choice.id, seed: choice.historySeed || null });
    if (planet.soc.history.length > 20) planet.soc.history.splice(0, planet.soc.history.length - 20);
  }
  // 特殊分支：招募 / 热度冲 spike / 黑市折扣 / 机偶希望上限豁免 / 隐藏 POI 揭示
  if (choice.recruit && world.entities.factions[fid]) {
    const c = createCharacter(world, fid, choice.recruit.role || 'science', `地表幸存者（${planet ? planet.name : '未知行星'}）`);
    c.traits = [choice.recruit.trait || 'bookish'];
    c.level = choice.recruit.level || 2;
    c.history.push({ tick: world.tick, event: '加入', note: def.id });
    emit(world, 'PoiScientistJoined', { characterId: c.id, dilemmaId: def.id }, 'ground');
  }
  if (choice.heatSpike && planet) {
    addSurfaceHeat(world, planet, choice.heatSpike, 'dilemmaSpike');
  }
  if (choice.marketDiscount) {
    world.narrative.flags ||= {};
    world.narrative.flags['blackmarket:discount'] = choice.marketDiscount;
  }
  if (choice.removeAutomataHopeCap) {
    world.narrative.flags ||= {};
    world.narrative.flags['edict:automata_no_hope_cap'] = 1;
  }
  if (choice.riskEpidemic && planet) {
    world.narrative.flags ||= {};
    world.narrative.flags[`spore_carrier:${planet.id}`] = world.tick; // DailySystems 消费的隐患种子
  }
  if (choice.revealHiddenPoi && planet && planet.pois) {
    for (const poi of Object.values(planet.pois)) {
      if (poi.discoveryState === 'hidden') poi.discoveryState = 'detected';
    }
  }
  chronicle(world, 'event', `地表抉择结果：${def.titleZh} → ${choice.labelZh}`, { planetId: planet ? planet.id : null, choiceId: choice.id });
  emit(world, 'SurfaceDilemmaResolved', { dilemmaId: def.id, choiceId: choice.id }, 'ground');
  return { ok: true, choice };
}

/** 第三选项解锁条件（bookish/mercantile 总督特质或 axiom 科技/tech_ai_2） */
function surfaceDilemmaUnlocked(world, planet, requireKind) {
  const soc = planet && planet.soc;
  const overseer = soc && soc.overseerId ? world.entities.characters[soc.overseerId] : null;
  if (overseer && Array.isArray(overseer.traits) && overseer.traits.includes(requireKind)) return true;
  if (requireKind === 'axiom') {
    const rs = world.research && world.research[world.playerFactionId];
    if (rs && Array.isArray(rs.completed) && rs.completed.includes('tech_ai_2')) return true;
  }
  return false;
}

// ———— 八、POI 承台整平算子（SURF-02 地形贴合；S2 渲染协同） ————————

/** 承台几何常量：内圈全平半径 / 外圈平滑过渡半径 / 9 点采样半距 */
export const POI_PAD = Object.freeze({ innerM: 4.5, outerM: 9.0, sampleHalfM: 3.2 });

/**
 * 9 点平均高程整平承台（内平 4.5m、外过渡 9.0m；纯函数）。
 * 以场域宏观高度函数（field._macro.heightAt，未钳制基面）求 POI 中心 3×3 采样均值，
 * 站位点 dy = padY − baseY · smoothstep 衰减（内圈 1.0 → 外圈 0.0）。
 *
 * @param {object} field buildTerrainField 产物（含 _macro.heightAt）
 * @param {Array<{x:number,z:number}>} poiFieldCoords POI 中心（场域坐标，米）
 * @returns {(fx:number,fz:number,baseY:number)=>number|null} dy（无承台命中返回 null）
 */
export function makePoiPadModifier(field, poiFieldCoords) {
  const macro = field && field._macro;
  if (!macro || !Array.isArray(poiFieldCoords) || poiFieldCoords.length === 0) return null;
  const pads = poiFieldCoords.map((p) => {
    let sum = 0;
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const h = macro.heightAt(p.x + dx * POI_PAD.sampleHalfM, p.z + dz * POI_PAD.sampleHalfM);
        if (h && Number.isFinite(h.y)) {
          sum += h.y;
          n++;
        }
      }
    }
    return { x: p.x, z: p.z, padY: n > 0 ? sum / n : 0 };
  });
  const inner2 = POI_PAD.innerM * POI_PAD.innerM;
  const outer2 = POI_PAD.outerM * POI_PAD.outerM;
  return (fx, fz, baseY) => {
    let best = null;
    let bestD2 = Infinity;
    for (const pad of pads) {
      const d2 = (fx - pad.x) * (fx - pad.x) + (fz - pad.z) * (fz - pad.z);
      if (d2 < outer2 && d2 < bestD2) {
        bestD2 = d2;
        best = pad;
      }
    }
    if (!best) return null;
    // smoothstep 衰减：内圈全平（k=1）→ 外圈归零（k=0）
    const t = clamp((Math.sqrt(bestD2) - POI_PAD.innerM) / (POI_PAD.outerM - POI_PAD.innerM), 0, 1);
    const k = 1 - (t * t * (3 - 2 * t));
    if (k <= 0) return null;
    return (best.padY - baseY) * k;
  };
}

// ———— 九、日志与词典读接口（2D 终端/HUD 消费） ————————————————————

/** 已读日志位列表（0..23） */
export function readSlateBits(planet) {
  const sd = planet && planet.surfaceDelta;
  if (!sd) return [];
  const bits = [];
  for (let i = 0; i < 24; i++) {
    if ((sd.slatesMask >>> i) & 1) bits.push(i);
  }
  return bits;
}

/** 法典希望上限修正（机偶混编法案希望上限 −10；抉择 C 豁免） */
export function edictHopeCapModifier(world, planet) {
  const soc = planet && planet.soc;
  if (!soc || !Array.isArray(soc.edicts)) return 0;
  let cap = 0;
  for (const eid of soc.edicts) {
    const ed = COLONY_EDICTS[eid];
    if (ed && ed.hopeCap) cap += ed.hopeCap;
  }
  if (world.narrative && world.narrative.flags && world.narrative.flags['edict:automata_no_hope_cap']) {
    // 升维副总督 AI：机偶混编法案不再扣除希望上限
    const automata = COLONY_EDICTS.edict_automata_shift;
    if (automata && automata.hopeCap) cap -= automata.hopeCap;
  }
  return cap;
}
