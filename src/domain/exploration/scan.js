/**
 * domain/exploration/scan.js — 扫描、调查与发现（任务书 3.5 / EXP-01/02）
 *
 * 信息分层：0 未接触 → 1 侦测 → 2 分类 → 3 定位 → 4 调查完成。
 * 扫描点每小时累积；恒星噪声与危险度提高阈值（EXP-01：高级扫描精度更高）。
 * 调查奖励只结算一次（EXP-02）。
 */

import { emit } from '../../core/eventBus.js';
import { RNG } from '../../core/rng.js';
import { credit } from '../economy/ledger.js';
import { ANOMALY_TEMPLATES } from '../../content/anomalies.js';
import { createEntity, getEntity } from '../entities/registry.js';
import { getMod } from '../factions/modifiers.js';
import { getRelation } from '../diplomacy/war.js';
import { checkAndProgressObjectives } from '../events/objectives.js';
// doc35 WP-P0-1：异象 DAG 调查（惰性挂载；AI 从不下达 InvestigateAnomaly → 金快照零漂移）
import { tickDagAnomaly, attachDagIfTemplate, setResolveAnomalyHook } from './precursorDag.js';

/** 分层阈值（扫描点） */
export const LEVEL_THRESHOLDS = [0, 14, 36, 72, 120];

/** 计算舰队扫描功率/小时 */
export function scanPower(world, fleet, factionId) {
  let best = 0;
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (!ship || ship.status !== 'active') continue;
    const s = ship.stats?.sensor ?? 0;
    best = Math.max(best, s);
  }
  return best * (getMod(world, factionId, 'scanSpeed', 'mult') || 1);
}

/** 是否可以下达扫描命令（相邻或本星系） */
export function canScanTarget(world, fleet, targetSystemId) {
  const sys = world.entities.systems[targetSystemId];
  if (!sys) return { ok: false, reason: '目标星系不存在' };
  if (fleet.systemId === targetSystemId) return { ok: true };
  const here = world.entities.systems[fleet.systemId];
  if (here && here.lanes.includes(targetSystemId)) return { ok: true };
  return { ok: false, reason: '目标超出扫描范围（需在当前或相邻星系）' };
}

/** 开始/继续对目标星系的扫描任务 */
export function startScan(world, fleet, targetSystemId) {
  fleet.orders = {
    kind: 'scan',
    targetSystemId,
    progress: fleet.orders?.kind === 'scan' && fleet.orders.targetSystemId === targetSystemId
      ? fleet.orders.progress : 0,
    stage: 'underway',
  };
}

/** 每小时推进扫描任务（由 HourlySystems 的 exploration 阶段调用） */
export function tickScanning(world, fleet) {
  const order = fleet.orders;
  if (!order || order.kind !== 'scan') return;
  const sys = world.entities.systems[order.targetSystemId];
  if (!sys) {
    fleet.orders = null;
    return;
  }
  const facId = fleet.factionId;
  const level = sys.surveyedBy[facId] ?? 0;
  if (level >= 4) {
    fleet.orders = null;
    return;
  }
  const noise = 1 + (sys.star?.scanNoise ?? 0.2) + sys.dangerRating * 0.06;
  // /10：内容侧传感器数值为装备强度口径，扫描点按 1/10 折算控制节奏
  const power = scanPower(world, fleet, facId) / 10 / noise;
  if (power <= 0) {
    order.stage = 'blocked';
    return;
  }
  const precision = getMod(world, facId, 'scanPrecision', 'mult') || 1;
  order.progress += power * precision;
  order.stage = 'underway';

  const nextThreshold = LEVEL_THRESHOLDS[level + 1];
  if (order.progress >= nextThreshold) {
    revealSurveyLevel(world, sys, facId, level + 1);
  }
}

/** 提升调查层级：揭示信息、触发事件与奖励 */
export function revealSurveyLevel(world, sys, factionId, newLevel) {
  sys.surveyedBy[factionId] = newLevel;
  const fleetId = findScanningFleet(world, factionId, sys.id);

  // 扫描揭示他国主权 → 首次接触流程推进（EXP-03）
  // （F-06 修复：必须传 ownerFactionId——原实现传入系统对象，getRelation 会以
  //  "[object Object]" 字符串化键位制造幽灵关系记录，污染外交状态面）
  if (sys.ownerFactionId && sys.ownerFactionId !== factionId && newLevel >= 2) {
    observeForeignSystem(world, factionId, sys.ownerFactionId);
  }
  // 邻近感知：调查星系的邻接星系若为他国领土，侦测到边境信号
  if (newLevel >= 2) {
    for (const nid of sys.lanes) {
      const ns = world.entities.systems[nid];
      if (ns.ownerFactionId && ns.ownerFactionId !== factionId) {
        observeForeignSystem(world, factionId, ns.ownerFactionId, sys.id);
      }
    }
  }

  if (newLevel === 2) {
    // 分类：揭示恒星/行星类型概要
    emit(world, 'SystemClassified', { systemId: sys.id, factionId, star: sys.star.typeId }, 'exploration');
    spawnAnomaliesForSystem(world, sys, factionId);
  } else if (newLevel === 3) {
    // 定位：揭示资源评级与危险度
    emit(world, 'SystemLocated', { systemId: sys.id, factionId, resources: sys.resourceRating, danger: sys.dangerRating }, 'exploration');
  } else if (newLevel === 4) {
    // 调查完成：一次性奖励（EXP-02：只结算一次）
    if (!sys.surveyRewarded) sys.surveyRewarded = {};
    if (!sys.surveyRewarded[factionId]) {
      sys.surveyRewarded[factionId] = true;
      const data = 8 + Math.round(sys.resourceRating * 3);
      credit(world, factionId, 'researchData', data, 'surveyComplete', sys.id);
      if (RNG.chance(world, 0.4)) {
        credit(world, factionId, 'credits', 60 + RNG.int(world, 90), 'surveySalvage', sys.id);
      }
      emit(world, 'SystemSurveyed', { systemId: sys.id, factionId, researchData: data }, 'exploration');
    }
    // WP-6：调查层级升满推进空间目标（investigate_system 锚定目标星系，调查完成即溯源达成）
    checkAndProgressObjectives(world, (o) =>
      o.kind === 'investigate_system' && o.factionId === factionId && o.targetSystemId === sys.id);
    if (fleetId) {
      const fleet = world.entities.fleets[fleetId];
      if (fleet && fleet.orders?.kind === 'scan' && fleet.orders.targetSystemId === sys.id) {
        fleet.orders = null;
      }
    }
  }
}

function findScanningFleet(world, factionId, systemId) {
  for (const id of Object.keys(world.entities.fleets).sort()) {
    const f = world.entities.fleets[id];
    if (f.factionId === factionId && f.orders?.kind === 'scan' && f.orders.targetSystemId === systemId) return id;
  }
  return null;
}

/** 为星系生成异常实体（首次进入分类层时；模板从 content 注入） */
export function spawnAnomaliesForSystem(world, sys, factionId) {
  if (!sys.flags?.hasAnomalySlot) return;
  if ((sys.anomalyIds || []).length > 0) return; // 幂等
  const template = RNG.pick(world, ANOMALY_TEMPLATES);
  const anomaly = createEntity(world, 'anomalies', {
    systemId: sys.id,
    templateId: template.id,
    category: template.category,
    nameZh: template.nameZh,
    nameEn: template.nameEn,
    descZh: template.descZh,
    state: 'detected',        // detected → analyzing → ready → resolved
    progress: 0,
    difficulty: Math.round(sys.dangerRating + RNG.range(world, 0, 4)),
    rewards: template.rewards,
    risks: template.risks,
    discoveredBy: factionId,
    resolvedBy: null,
    storyTag: template.storyTag || null,
  });
  sys.anomalyIds.push(anomaly.id);
  emit(world, 'AnomalyDetected', { anomalyId: anomaly.id, systemId: sys.id, factionId }, 'exploration');
  return anomaly;
}

/**
 * 调查异常（在系内科学舰执行；InvestigateAnomaly 命令执行体）。
 * 每小时推进；完成时一次性发放奖励（EXP-02 幂等）。
 */
export function tickAnomalyInvestigation(world) {
  for (const id of Object.keys(world.entities.anomalies).sort()) {
    const ano = world.entities.anomalies[id];
    if (ano.state !== 'analyzing') continue;
    const sys = world.entities.systems[ano.systemId];
    const fleet = findInvestigatingFleet(world, ano);
    if (!fleet || !sys || fleet.systemId !== ano.systemId) {
      ano.state = 'detected'; // 调查舰离开则暂停
      continue;
    }
    const power = scanPower(world, fleet, fleet.factionId) * 0.6;
    ano.progress += Math.max(1, power);
    // doc35 WP-P0-1：DAG 调查模式（ano.dag 仅由 InvestigateAnomaly 玩家命令挂载）
    if (ano.dag) {
      const dagRes = tickDagAnomaly(world, ano, fleet);
      if (dagRes === 'resolved') resolveAnomaly(world, ano, fleet.factionId);
      continue;
    }
    const goal = 60 + ano.difficulty * 18;
    if (ano.progress >= goal) {
      resolveAnomaly(world, ano, fleet.factionId);
    }
  }
}

function findInvestigatingFleet(world, anomaly) {
  for (const id of Object.keys(world.entities.fleets).sort()) {
    const f = world.entities.fleets[id];
    if (f.factionId === anomaly.discoveredBy && f.systemId === anomaly.systemId &&
        (f.orders?.kind === 'investigate' && f.orders.anomalyId === anomaly.id)) return f;
  }
  return null;
}

/** 结算异常奖励（一次性） */
export function resolveAnomaly(world, ano, factionId) {
  if (ano.state === 'resolved') return; // EXP-02
  ano.state = 'resolved';
  ano.resolvedBy = factionId;
  ano.resolvedTick = world.tick;
  let total = 0;
  for (const r of ano.rewards || []) {
    credit(world, factionId, r.resId, r.amount, `anomaly:${ano.templateId}`, ano.id);
    total += r.amount;
  }
  emit(world, 'AnomalyResolved', { anomalyId: ano.id, factionId, rewards: ano.rewards }, 'exploration');
  if (ano.storyTag) {
    emit(world, 'StoryFlag', { tag: ano.storyTag, systemId: ano.systemId }, 'world');
    world.narrative.flags[ano.storyTag] = world.tick;
  }
}

/** 首次接触推进：侦测到未知文明（扫描揭示主权或舰队抵达）（EXP-03） */
export function observeForeignSystem(world, factionId, otherFactionId, viaSystemId = null) {
  if (!otherFactionId || otherFactionId === factionId) return;
  const rel = getRelation(world, factionId, otherFactionId);
  if (rel.contactState === 'none') {
    rel.contactState = 'signal';
    rel.firstContactTick = world.tick;
    emit(world, 'FirstContactSignal', { a: factionId, b: otherFactionId, systemId: viaSystemId }, 'diplomacy');
  } else if (rel.contactState === 'signal') {
    rel.contactState = 'contacted';
    rel.intelConfidence = 0.35;
    emit(world, 'FirstContact', { a: factionId, b: otherFactionId, systemId: viaSystemId }, 'diplomacy');
  }
}

// doc35 WP-P0-1：DAG 受挫「激进强拆/封存」经旧结算通道收束（避免循环导入，模块初始化时挂钩）
setResolveAnomalyHook(resolveAnomaly);
