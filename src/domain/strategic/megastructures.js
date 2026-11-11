/**
 * domain/strategic/megastructures.js — 星海天工：赤道太空电梯、行星星环城与
 * 四大恒星级四阶段巨构（doc35 WP-P1-2 / WP-P2-1）
 *
 * 四阶段生命周期（doc34 §5.2.2）：S1 勘探基座 → S2 骨架 → S3 功能工坊 → S4 满载。
 * 阶段升级要求轨道实交工业舱段（复用 catapult.js POD_CAPACITY_UNITS 核销机制）。
 *
 * 能耗公式（doc34 §5.2.1 实测锚点）：E_elev = LAUNCH_E0_MWH · g · 0.125
 *   标准宜居星（g=1.0）：21.60 → 1.50 MWh（-93.1%）；重工业星（g=1.8/ρ=0.9）：52.70 → 2.70 MWh；
 *   碎环月（g=0.25 真空）：3.00 → 0.38 MWh。电梯平稳攀升不调用 spikeCatapultLaunch → PTI 增量恒 0。
 *
 * 惰性挂载纪律：planet.ind.elevator / station.mega / 星门网络边仅在
 * ConstructSpaceElevator / ExpandOrbitalRingSegment / StartMegastructureStage
 * 命令触达时创建 → 金快照 4320 tick 窗口字节零漂移。零 Math.random。
 */

import { emit, chronicle } from '../../core/eventBus.js';
import { credit, debit, balance, FLOW } from '../economy/ledger.js';
import { clamp } from '../../core/math.js';
import { LAUNCH_E0_MWH, POD_CAPACITY_UNITS } from '../industry/catapult.js';
import { createEntity } from '../entities/registry.js';

/** 电梯能耗系数（12·g·0.125 = 1.50 MWh @ g=1.0，精确复现 doc34 三档锚点） */
export const ELEVATOR_ENERGY_FACTOR = 0.125;
/** 电梯元组下标（doc34 §5.3：[tier, podsTransferredToday, dailyCapPods, online]） */
export const ELEVATOR_IDX = Object.freeze({ TIER: 0, PODS_TODAY: 1, DAILY_CAP: 2, ONLINE: 3 });
/** Tier1 连续天地管道：每战略小时吞吐 6 舱 → 日上限 144 舱（doc34 §5.2.1） */
export const ELEVATOR_DAILY_CAP = 144;
/** 星环城满级 32 个额外轨道建筑挂点（doc35 §2.4.1） */
export const ORBITAL_RING_SLOTS = 32;

/** 单舱电梯入轨能耗（MWh） */
export function elevatorEnergyMWh(planet) {
  const g = clamp(Number(planet && planet.gravity) || 1.0, 0.1, 3.0);
  return LAUNCH_E0_MWH * g * ELEVATOR_ENERGY_FACTOR;
}

/** 太空电梯建造校验 + 落地（ConstructSpaceElevator 命令执行体） */
export function constructSpaceElevator(world, planetId, factionId) {
  const planet = world.entities.planets[planetId];
  if (!planet) return { ok: false, reason: '行星不存在' };
  const ind = planet.ind;
  if (!ind) return { ok: false, reason: '该行星未激活工业网' };
  if (ind.elevator && ind.elevator[ELEVATOR_IDX.ONLINE]) return { ok: false, reason: '太空电梯已建成' };
  const costs = { credits: 8000, alloy: 3000, conductor: 1200 };
  for (const rid of Object.keys(costs)) {
    if (balance(world, factionId, rid) < costs[rid]) return { ok: false, reason: `缺少 ${rid}` };
  }
  for (const rid of Object.keys(costs)) {
    debit(world, factionId, rid, costs[rid], 'spaceElevator', planetId, FLOW.CONSUME);
  }
  // 紧凑 4 元组（doc34 §5.3：仅 18 字节 JSON）
  ind.elevator = [1, 0, ELEVATOR_DAILY_CAP, 1];
  emit(world, 'SpaceElevatorConstructed', { planetId, factionId }, 'industry');
  chronicle(world, 'industry', `赤道太空电梯落成：行星 ${planet.name} 入轨能耗骤降 93%，PTI 增量归零`, { planetId });
  return { ok: true };
}

/**
 * 太空电梯小时推进（HourlySystems production 相位调用；替代弹射井路径）。
 * 电网富余功率 → 攀爬舱提拉：能量按 E_elev 计、PTI 增量恒 0、货物直入轨道缓冲仓。
 * @returns {{launched:number, energyMWh:number}}
 */
export function stepSpaceElevator(world, planet, indState, grid, dtHours = 1) {
  const elev = indState?.elevator;
  if (!elev || !elev[ELEVATOR_IDX.ONLINE] || !grid) return { launched: 0, energyMWh: 0 };
  const wholePods = Math.floor(indState.catapult?.[1] ?? 0); // 复用弹射井舱位打包（feedCatapult 已凑舱）
  if (wholePods <= 0) return { launched: 0, energyMWh: 0 };
  const dailyLeft = elev[ELEVATOR_IDX.DAILY_CAP] - elev[ELEVATOR_IDX.PODS_TODAY];
  if (dailyLeft <= 0) return { launched: 0, energyMWh: 0 };

  const energyNeed = elevatorEnergyMWh(planet);
  const surplusKW = Math.max(0, grid.genKW - grid.loadKW);
  const chargeable = Math.floor((surplusKW / 1000) * dtHours / energyNeed);
  const n = Math.min(wholePods, chargeable, dailyLeft);
  if (n <= 0) return { launched: 0, energyMWh: 0 };

  const cat = indState.catapult;
  cat[1] -= n;
  elev[ELEVATOR_IDX.PODS_TODAY] += n;
  const resKey = resIdxFn(cat[3] ?? 2);
  const buf = indState.orbitalBuffer || (indState.orbitalBuffer = {});
  buf[resKey] = (buf[resKey] || 0) + n * POD_CAPACITY_UNITS;
  grid.accMWh = Math.max(0, grid.accMWh - energyNeed * n);
  // 平稳电磁攀爬：无音爆/无电磁脉冲 → 不调用 spikeCatapultLaunch，PTI 增量恒 0
  emit(world, 'ElevatorPodTransferred', { planetId: planet.id, pods: n, energyMWh: energyNeed * n }, 'industry');
  return { launched: n, energyMWh: energyNeed * n };
}

// 资源 idx→id（与 catapult.js IND_RES_IDS 对齐；避免循环导入，此处内联同一映射）
const IND_RES_IDS = ['ferro', 'silicate', 'alloy', 'conductor', 'shipModule', 'quantumCore'];
function resIdxFn(idx) { return IND_RES_IDS[idx] || 'alloy'; }

/** 每日重置电梯吞吐计数（DailySystems 调用；惰性） */
export function resetElevatorDaily(world) {
  for (const planet of Object.values(world.entities.planets)) {
    const elev = planet.ind?.elevator;
    if (elev) elev[ELEVATOR_IDX.PODS_TODAY] = 0;
  }
}

/** 星环城分段扩建（ExpandOrbitalRingSegment 命令执行体；Tier 1..3） */
export function expandOrbitalRing(world, planetId, factionId) {
  const planet = world.entities.planets[planetId];
  if (!planet) return { ok: false, reason: '行星不存在' };
  const elev = planet.ind?.elevator;
  if (!elev || !elev[ELEVATOR_IDX.ONLINE]) return { ok: false, reason: '需要先建成赤道太空电梯' };
  let ring = world.entities.stations && Object.values(world.entities.stations)
    .find((st) => st.kind === 'orbital_ring' && st.planetId === planetId);
  if (!ring) {
    ring = createStation(world, { kind: 'orbital_ring', systemId: planet.systemId, planetId, factionId, name: '行星星环城' });
    ring.ringTier = 0;
  }
  if ((ring.ringTier || 0) >= 3) return { ok: false, reason: '星环城已达 Tier 3 满级' };
  const tierCosts = [
    { credits: 5000, alloy: 2000, conductor: 800 },
    { credits: 9000, alloy: 4000, conductor: 1600, quantumCore: 200 },
    { credits: 15000, alloy: 7000, conductor: 2800, quantumCore: 400 },
  ];
  const costs = tierCosts[ring.ringTier || 0];
  for (const rid of Object.keys(costs)) {
    if (balance(world, factionId, rid) < costs[rid]) return { ok: false, reason: `缺少 ${rid}` };
  }
  for (const rid of Object.keys(costs)) {
    debit(world, factionId, rid, costs[rid], 'orbitalRing', planetId, FLOW.CONSUME);
  }
  ring.ringTier = (ring.ringTier || 0) + 1;
  ring.buildingSlots = ring.ringTier * Math.ceil(ORBITAL_RING_SLOTS / 3); // 满级 32 挂点
  emit(world, 'OrbitalRingExpanded', { planetId, tier: ring.ringTier }, 'industry');
  return { ok: true, tier: ring.ringTier };
}

function createStation(world, opts) {
  return createEntity(world, 'stations', opts);
}

// ———— 四大恒星级四阶段巨构（doc35 §2.4.2 / doc34 §5.2.2） ————

/** 巨构定义：选址约束 + 四阶段成本（账本 + 轨道实交舱段）+ 满载产出 */
export const MEGA_DEFS = {
  mega_dyson_array: {
    id: 'mega_dyson_array', nameZh: '恒星微型戴森阵列',
    siteCheck: (sys) => ['blueGiant', 'yellowDwarf', 'whiteDwarf'].includes(sys.star?.typeId),
    stages: [
      { credits: 1500, pods: { alloy: 4 }, hours: 720 },
      { credits: 3000, pods: { alloy: 12, conductor: 4 }, hours: 1440 },
      { credits: 5000, pods: { conductor: 20, quantumCore: 4 }, hours: 2160 },
      { credits: 8000, pods: { quantumCore: 10 }, hours: 2880 },
    ],
    outputByStage: {
      2: { powerCell: 15 },
      3: { powerCell: 45, reactorFuel: 15 },
      4: { powerCell: 120, reactorFuel: 45, credits: 1500 },
    },
    perMonthExotic: 1, // S4 每月 exoticMatter +1
  },
  mega_matter_decompressor: {
    id: 'mega_matter_decompressor', nameZh: '奇点物质解压器',
    siteCheck: (sys) => sys.star?.typeId === 'blackHole' || sys.star?.typeId === 'neutronStar',
    stages: [
      { credits: 1500, pods: { alloy: 4 }, hours: 720 },
      { credits: 3500, pods: { alloy: 15 }, hours: 1440 },
      { credits: 5500, pods: { shipModule: 12, quantumCore: 4 }, hours: 2160 },
      { credits: 7500, pods: { quantumCore: 8 }, hours: 2880 },
    ],
    outputByStage: {
      2: { ferro: 40, heavyMetal: 20 },
      3: { ferro: 40, heavyMetal: 20, rareEarth: 25 },
      4: { ferro: 120, silicate: 80, heavyMetal: 60, rareEarth: 50 },
    },
    perMonthExotic: 1,
  },
  mega_chord_gateway: {
    id: 'mega_chord_gateway', nameZh: '弦超空间星门',
    siteCheck: () => true,
    stages: [
      { credits: 800, pods: { alloy: 4 }, hours: 480 },
      { credits: 1800, pods: { conductor: 8 }, hours: 960 },
      { credits: 3000, pods: { quantumCore: 4 }, hours: 1440 },
      { credits: 0, pods: {}, hours: 24, ancientData: 10 }, // S4 激活：消耗 ancientData
    ],
    outputByStage: {},
    isGateway: true,
  },
  mega_lagrange_citadel: {
    id: 'mega_lagrange_citadel', nameZh: '拉格朗日深空要塞',
    siteCheck: (sys) => (sys.lanes || []).length >= 3,
    stages: [
      { credits: 1000, pods: { alloy: 6 }, hours: 600 },
      { credits: 2500, pods: { alloy: 14 }, hours: 1200 },
      { credits: 4000, pods: { shipModule: 10 }, hours: 1800 },
      { credits: 6000, pods: { quantumCore: 6 }, hours: 2400 },
    ],
    outputByStage: {},
    isCitadel: true,
  },
};

/** 巨构开工（StartMegastructureStage 命令执行体；stage 0 → 1） */
export function startMegastructure(world, systemId, defId, factionId) {
  const sys = world.entities.systems[systemId];
  const def = MEGA_DEFS[defId];
  if (!sys || !def) return { ok: false, reason: '星系或巨构定义不存在' };
  if (!def.siteCheck(sys)) return { ok: false, reason: '选址不符合天体约束' };
  const dup = Object.values(world.entities.stations || {})
    .find((st) => st.kind === 'megastructure' && st.mega && st.mega.defId === defId && st.factionId === factionId);
  if (dup && defId !== 'mega_chord_gateway') return { ok: false, reason: '该巨构每文明限建一座' };
  const st = createStation(world, { kind: 'megastructure', systemId, factionId, name: def.nameZh });
  st.mega = {
    defId,
    stage: 0,
    upgradingTo: 1,
    progressHours: 0,
    requiredHours: def.stages[0].hours,
    podsDelivered: {},
    ftlSnareActive: false,
    linkedGatewaySystemIds: [],
  };
  emit(world, 'MegastructureStarted', { systemId, defId, factionId, stationId: st.id }, 'industry');
  chronicle(world, 'industry', `巨构开工：${def.nameZh} 勘探基座铺设于 ${sys.name || systemId}`, { systemId });
  return { ok: true, stationId: st.id };
}

/**
 * 巨构阶段推进（StartMegastructureStage 命令执行体亦可推进进行中阶段）：
 * 支付账本成本 + 向轨道缓冲仓核销实交舱段 → 工时累积 → 升阶。
 */
export function advanceMegastructureStage(world, stationId, factionId, orbitalBuffer = null) {
  const st = world.entities.stations?.[stationId];
  if (!st || !st.mega) return { ok: false, reason: '巨构不存在' };
  const def = MEGA_DEFS[st.mega.defId];
  const mega = st.mega;
  if (mega.stage >= 4) return { ok: false, reason: '巨构已满载运转' };
  const target = mega.stage + 1;
  const stageDef = def.stages[mega.stage];
  // 账本成本
  if (stageDef.credits && balance(world, factionId, 'credits') < stageDef.credits) {
    return { ok: false, reason: '缺少 credits' };
  }
  if (stageDef.ancientData && balance(world, factionId, 'ancientData') < stageDef.ancientData) {
    return { ok: false, reason: '缺少 ancientData' };
  }
  // 轨道实交舱段核销（orbitalBuffer 直供）
  for (const rid of Object.keys(stageDef.pods || {})) {
    const required = stageDef.pods[rid];
    const have = orbitalBuffer ? Math.floor((orbitalBuffer[rid] || 0) / POD_CAPACITY_UNITS) : 0;
    if (have < required) return { ok: false, reason: `轨道舱段不足：${rid}（${have}/${required} 舱）` };
  }
  if (stageDef.credits) debit(world, factionId, 'credits', stageDef.credits, `megaStage:${def.id}`, stationId, FLOW.CONSUME);
  if (stageDef.ancientData) debit(world, factionId, 'ancientData', stageDef.ancientData, `megaStage:${def.id}`, stationId, FLOW.CONSUME);
  for (const rid of Object.keys(stageDef.pods || {})) {
    if (orbitalBuffer) orbitalBuffer[rid] -= stageDef.pods[rid] * POD_CAPACITY_UNITS;
    mega.podsDelivered[rid] = (mega.podsDelivered[rid] || 0) + stageDef.pods[rid];
  }
  mega.stage = target;
  mega.upgradingTo = target >= 4 ? null : target + 1;
  mega.progressHours = 0;
  mega.requiredHours = target < 4 ? def.stages[target].hours : 0;
  if (def.isGateway && target === 4) {
    linkGatewayNetwork(world, st);
  }
  emit(world, 'MegastructureStage', { stationId, defId: def.id, stage: target }, 'industry');
  chronicle(world, 'industry', `巨构升阶：${def.nameZh} 进入阶段 ${target}/4`, { systemId: st.systemId });
  return { ok: true, stage: target };
}

/** 弦星门 S4 激活：接入全银河星门网络（同阵营/开放边境的 S4 星门 0 小时瞬时直连） */
export function linkGatewayNetwork(world, station) {
  station.mega.linkedGatewaySystemIds = [];
  for (const other of Object.values(world.entities.stations || {})) {
    if (other.id === station.id || other.kind !== 'megastructure' || !other.mega) continue;
    if (other.mega.defId !== 'mega_chord_gateway' || other.mega.stage < 4) continue;
    station.mega.linkedGatewaySystemIds.push(other.systemId);
    other.mega.linkedGatewaySystemIds.push(station.systemId);
  }
  emit(world, 'GatewayLinked', { systemId: station.systemId, links: station.mega.linkedGatewaySystemIds.length }, 'industry');
}

/** 星门网络直连判定（navigation.planRoute 接入：同阵营 S4 星门对 → 0 小时边） */
export function gatewayLinkHours(world, fromSystemId, toSystemId, factionId) {
  for (const st of Object.values(world.entities.stations || {})) {
    if (st.kind !== 'megastructure' || !st.mega || st.mega.defId !== 'mega_chord_gateway') continue;
    if (st.mega.stage < 4 || st.factionId !== factionId || st.systemId !== fromSystemId) continue;
    if (st.mega.linkedGatewaySystemIds.includes(toSystemId)) return 1; // 跨星域 1 小时投送
  }
  return null;
}

/** 拉格朗日天堑 S3+ 跃迁阻断（navigation 离场守卫接入） */
export function citadelSnareBlocks(world, systemId, factionId) {
  for (const st of Object.values(world.entities.stations || {})) {
    if (st.kind !== 'megastructure' || !st.mega || st.mega.defId !== 'mega_lagrange_citadel') continue;
    if (st.systemId !== systemId || st.mega.stage < 3) continue;
    if (st.factionId === factionId) continue;
    if (!st.mega.ftlSnareActive) continue;
    return st.id;
  }
  return null;
}

/** 巨构月度产出结算（MonthlySystems 调用；惰性：无巨构零开销） */
export function settleMegastructureOutputs(world) {
  for (const st of Object.values(world.entities.stations || {})) {
    if (st.kind !== 'megastructure' || !st.mega || st.mega.stage < 2) continue;
    const def = MEGA_DEFS[st.mega.defId];
    const out = def.outputByStage[st.mega.stage];
    if (!out) continue;
    for (const rid of Object.keys(out)) {
      if (rid === 'credits') credit(world, st.factionId, 'credits', out[rid], `megaOutput:${def.id}`, st.id, FLOW.PRODUCE);
      else credit(world, st.factionId, rid, out[rid], `megaOutput:${def.id}`, st.id, FLOW.PRODUCE);
    }
    if (st.mega.stage === 4 && def.perMonthExotic) {
      credit(world, st.factionId, 'exoticMatter', def.perMonthExotic, `megaOutput:${def.id}`, st.id, FLOW.PRODUCE);
    }
  }
}
