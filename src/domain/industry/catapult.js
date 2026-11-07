/**
 * domain/industry/catapult.js — 轨道货运弹射井与近地中转站（doc19 v0.4 WP-4）
 *
 * 三级天地物流管线（doc16 §4.12）：地表打包弹射 → 近地轨道缓冲仓 →
 * 船坞直供泰坦装配 / 跨星系货运班轮 / 星际市场倾销。
 *
 * 天体物理弹射能耗（doc19 WP-4）：
 *   E_launch = E0 · (g / g0) · (1 + β · ρ_atm)
 * 高重力/浓密大气行星弹射昂贵，碎环月（0.25g 真空）能耗趋近 E0 下限。
 *
 * 确定性红线：零 Math.random()、零 world.rng 消费。持久化增量：弹射井与
 * 轨道缓冲仓为紧凑 JSON（≤1KB/星，GATE-06 IND-05 预算内）。
 */

import { emit, chronicle } from '../../core/eventBus.js';
import { clamp } from '../../core/math.js';
import { createShip } from '../ships/ship.js';

/** 标准轨道货舱容量（单位物资/舱，doc19 WP-4） */
export const POD_CAPACITY_UNITS = 50;
/** 泰坦装配硬性要求：累计 20 舱装甲模块 + 5 舱量子核心（doc19 WP-4.3） */
export const TITAN_ARMOR_PODS = 20;
export const TITAN_QUANTUM_PODS = 5;
/** 弹射基准能耗（MWh）：g=g0 真空大气下的地板值 */
export const LAUNCH_E0_MWH = 12;
/** 大气阻力系数 β（ρ_atm 0..1） */
export const LAUNCH_BETA = 1.6;

/** 弹射井状态紧凑元组：[charged_permille, podsReady, launchedTotal, resTypeIdx] */
export const CATAPULT_IDX = Object.freeze({ CHARGE: 0, PODS: 1, LAUNCHED: 2, RES: 3 });

/**
 * 单次弹射能耗（MWh）：E0 · (g/g0) · (1 + β·ρ_atm)；g0 = 1.0。
 * @param {object} planet 行星实体（gravity 0.3~1.9；atmosphere.density 0..1）
 */
export function launchEnergyMWh(planet) {
  const g = clamp(Number(planet && planet.gravity) || 1.0, 0.1, 3.0);
  const atmo = planet && planet.atmosphere;
  const rho = atmo && Number.isFinite(atmo.density) ? clamp(atmo.density, 0, 1) : 0.5;
  return LAUNCH_E0_MWH * g * (1 + LAUNCH_BETA * rho);
}

/**
 * 地表物资汇集：每 50 单位打包 1 舱（由 stepPlanetIndustry 输出口或手动输送调用）。
 * @returns {{podsReady:number, launched:boolean}} 是否凑满整舱
 */
export function feedCatapult(indState, resTypeIdx, units) {
  const cat = indState.catapult || (indState.catapult = [0, 0, 0, resTypeIdx]);
  cat[CATAPULT_IDX.RES] = resTypeIdx;
  cat[CATAPULT_IDX.PODS] += units / POD_CAPACITY_UNITS;
  const whole = Math.floor(cat[CATAPULT_IDX.PODS]);
  return { podsReady: whole, launched: whole > 0 };
}

/**
 * 弹射井蓄能推进（由所属子电网 accMWh 扣能；HourlySystems production 调用）。
 * 蓄能达 100% 且舱位就绪 → 触发发射：物资入近地中转站缓冲仓，电网放电。
 * @returns {{launched:number, pods:Array<{resTypeIdx:number, units:number}>}}
 */
export function stepCatapult(world, planet, indState, grid, dtHours = 1) {
  const cat = indState.catapult;
  if (!cat || !grid) return { launched: 0, pods: [] };
  const pods = [];
  let launched = 0;
  const wholePods = Math.floor(cat[CATAPULT_IDX.PODS]);
  if (wholePods <= 0) return { launched: 0, pods };

  const energyNeed = launchEnergyMWh(planet);
  // 蓄能速率：电网富余功率 × dt（充入弹射井专用电容）
  const surplusKW = Math.max(0, grid.genKW - grid.loadKW);
  cat[CATAPULT_IDX.CHARGE] = clamp(cat[CATAPULT_IDX.CHARGE] + (surplusKW / 1000) * dtHours / energyNeed * 1000, 0, 1200);

  if (cat[CATAPULT_IDX.CHARGE] >= 1000) {
    cat[CATAPULT_IDX.CHARGE] -= 1000;
    cat[CATAPULT_IDX.PODS] -= 1;
    cat[CATAPULT_IDX.LAUNCHED] += 1;
    launched = 1;
    const units = POD_CAPACITY_UNITS;
    const resKey = resIdxToId(cat[CATAPULT_IDX.RES]);
    const buf = indState.orbitalBuffer || (indState.orbitalBuffer = {});
    buf[resKey] = (buf[resKey] || 0) + units;
    pods.push({ resTypeIdx: cat[CATAPULT_IDX.RES], resId: resKey, units });
    grid.accMWh = Math.max(0, grid.accMWh - energyNeed); // 电网放电扣能
    emit(world, 'FreightCatapultLaunched', { planetId: planet.id, resId: resKey, units, energyMWh: energyNeed }, 'ground');
    if (cat[CATAPULT_IDX.LAUNCHED] === 1) {
      chronicle(world, 'economy', `行星 ${planet.name} 货运弹射井首舱入轨（冷青电弧音爆）`, { planetId: planet.id });
    }
  }
  return { launched, pods };
}

/** 资源 idx → 资源 id（与 content/resources.js 对齐的工业流小子集） */
const IND_RES_IDS = ['ferro', 'silicate', 'alloy', 'conductor', 'shipModule', 'quantumCore'];
export function resIdxToId(idx) {
  return IND_RES_IDS[idx] || 'alloy';
}
export function resIdToIdx(resId) {
  return IND_RES_IDS.indexOf(resId) >= 0 ? IND_RES_IDS.indexOf(resId) : 2;
}

/**
 * 近地中转站三级分发（HourlySystems production 每战略小时结算；doc19 WP-4.3）。
 * 1) 同星系轨道船坞直供 → 泰坦装配台账；2) 跨星系班轮（有母星系中转站则划拨）；
 * 3) 星际市场倾销 → 信用点。确定性顺序结算。
 * @returns {{titanLaid:boolean, shipId?:string, marketCredits:number}}
 */
export function settleOrbitalBuffer(world, planet, indState) {
  const out = { titanLaid: false, marketCredits: 0 };
  const buf = indState.orbitalBuffer || {};
  const fid = planet.colonyId
    ? (world.entities.colonies[planet.colonyId] || {}).factionId
    : world.playerFactionId;
  if (!fid) return out;

  // 1) 同星系轨道船坞直供：泰坦装配台账（装甲模块舱/量子核心舱）
  const sys = world.entities.systems[planet.systemId];
  const shipyard = sys ? Object.values(world.entities.stations || {})
    .find((st) => st.kind === 'shipyard' && st.systemId === sys.id && st.factionId === fid) : null;
  if (shipyard) {
    shipyard.titanAssembly ||= { armorPods: 0, quantumPods: 0 };
    const armorRes = ['alloy', 'shipModule'];
    for (const r of armorRes) {
      if (buf[r] > 0) {
        shipyard.titanAssembly.armorPods += buf[r];
        buf[r] = 0;
      }
    }
    if (buf.quantumCore > 0) {
      shipyard.titanAssembly.quantumPods += buf.quantumCore;
      buf.quantumCore = 0;
    }
    const ta = shipyard.titanAssembly;
    if (ta.armorPods >= TITAN_ARMOR_PODS && ta.quantumPods >= TITAN_QUANTUM_PODS && !shipyard.titanBuilt) {
      ta.armorPods -= TITAN_ARMOR_PODS;
      ta.quantumPods -= TITAN_QUANTUM_PODS;
      // 泰坦级无畏巨舰合拢龙骨（物料已由弹射舱直供，造舰不再扣账本）
      const ship = createShip(world, {
        factionId: fid,
        hullId: 'hull_titan',
        moduleIds: [],
        name: '泰坦级无畏巨舰',
        systemId: sys.id,
      });
      shipyard.titanBuilt = (shipyard.titanBuilt || 0) + 1;
      out.titanLaid = true;
      out.shipId = ship.id;
      chronicle(world, 'economy', `泰坦级无畏巨舰龙骨合拢：行星货运弹射供应链打通天地造舰闭环`, { planetId: planet.id, shipId: ship.id });
      emit(world, 'TitanKeelLaid', { planetId: planet.id, shipId: ship.id, systemId: sys.id }, 'fleet');
    }
  }

  // 2/3) 余量：跨星系班轮占位（母星系无中转站时直接市场倾销——v0.4 先打通货币闭环）
  const POD_VALUE = { ferro: 120, silicate: 90, alloy: 240, conductor: 320, shipModule: 900, quantumCore: 1500 };
  for (const r of Object.keys(buf)) {
    if (buf[r] > 0) {
      out.marketCredits += (POD_VALUE[r] || 150) * buf[r];
      buf[r] = 0;
    }
  }
  if (out.marketCredits > 0) {
    const led = world.economy.ledgers[fid];
    if (led) led.balances.credits = (led.balances.credits || 0) + out.marketCredits;
    emit(world, 'OrbitalBufferMarketSold', { planetId: planet.id, credits: out.marketCredits }, 'economy');
  }
  return out;
}
