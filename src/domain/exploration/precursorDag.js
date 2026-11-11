/**
 * domain/exploration/precursorDag.js — 先驱者考古链、异象 DAG 与确定性虚拟 d10 检定
 * （doc35 WP-P0-1；融合 doc33 §2 叙事范式与 doc34 §2 数学模型）
 *
 * 持久化挂点（全部惰性创建——未触碰新特性时世界字节零变动，金快照 8be8ce2c 零漂移）：
 *   world.narrative.precursors[civId] = [stage, clueMask, sitesFound, homeSystemId, relicState]
 *   world.entities.anomalies[id].dag  = [dagId, nodeId, clues, branchMask, phaseTicks]
 *   world.narrative.relicCooldownUntil = tick（遗物主动技能全局 1800 日冷却）
 *
 * 确定性红线：d10 检定 = mix32(world.seed ^ hash32(anomalyId) ^ stageIdx*104729 ^ attempts
 * ^ SALT_DAG_ROLL) % 10 + 1 —— 纯函数，零 Math.random、零 world.rng 消费。
 */

import { mix32, SALT_DAG_ROLL, SALT_PRECURSOR } from '../ground/planetSeeds.js';
import { hash32 } from '../ground/SurfaceSandbox.js';
import { ANOMALY_DAG_TEMPLATES, PRECURSOR_BY_ID, PRECURSORS } from '../../content/precursors.js';
import { credit, debit, FLOW } from '../economy/ledger.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { clamp } from '../../core/math.js';

/** world.narrative.precursors[civId] 紧凑元组下标（doc33 §2.4 契约） */
export const PREC_IDX = Object.freeze({
  STAGE: 0,        // 0 未发现 / 1 线索收集中 / 2 母星已揭示 / 3 遗物已归档
  CLUE_MASK: 1,    // 6-bit 掩码
  SITES_FOUND: 2,
  HOME_SYS_ID: 3,
  RELIC_STATE: 4,  // 0 未获取 / 1 待机（被动生效）/ >1 主动激活到期 tick
});

/** world.entities.anomalies[id].dag 紧凑元组下标（doc33 §2.4 契约） */
export const ANO_DAG_IDX = Object.freeze({
  DAG_ID: 0,
  NODE_ID: 1,
  CLUES: 2,
  BRANCH_MASK: 3,
  PHASE_TICKS: 4,  // 当前阶段已推进小时数（每 6 小时一次虚拟 d10 相位检定）
  ATTEMPTS: 5,     // 当前阶段已投骰次数（mix32 盐值；doc35 公式输入）
});

export const DAG_PHASE_HOURS = 6;
export const DAG_SCORE_BREAKTHROUGH = 10;  // ≥10 大成功：直接完成节点
export const DAG_SCORE_NORMAL = 6;         // 6..9 常规：+1 线索；<6 受挫：悬停抉择

/**
 * 确定性虚拟 d10 检定骰（doc35 §2.1.2 方程，纯函数）。
 * Roll = (mix32(seed ⊕ hash32(anomalyId) ⊕ stageIdx×104729 ⊕ attempts ⊕ SALT) mod 10) + 1
 */
export function deriveAnomalyRoll(world, anomalyId, stageIdx, attempts) {
  const h = (world.seed >>> 0) ^ hash32(String(anomalyId)) ^
    Math.imul(stageIdx | 0, 104729) ^ ((attempts | 0) * 0x9E3779B1 | 0) ^ SALT_DAG_ROLL;
  return (mix32(h) % 10) + 1;
}

/** 检定总分 = Roll + ScientistSkill + Clues − Difficulty（doc35 §2.1.2） */
export function dagTotalScore(roll, scientistSkill, clues, difficulty) {
  return roll + (scientistSkill | 0) + (clues | 0) - (difficulty | 0);
}

/**
 * 舰队科学家技能（1..5）：首席舰船乘员指令加成 + 考古/天体物理特质。
 * 纯读取；无乘员时保底 1。
 */
export function scientistSkill(world, fleet) {
  let best = 1;
  for (const sid of fleet?.shipIds || []) {
    const ship = world.entities.ships[sid];
    if (!ship || ship.status !== 'active') continue;
    const crew = ship.crew;
    const level = crew && Number.isFinite(crew.healthy) ? Math.min(5, 1 + Math.floor(crew.healthy / 40)) : 1;
    if (level > best) best = level;
  }
  return best;
}

/** 调查命令附带 DAG 状态创建（InvestigateAnomaly 命令执行体调用；AI 不发此命令 → 金快照零漂移） */
export function attachDagIfTemplate(world, anomaly) {
  if (!anomaly || anomaly.dag) return anomaly;
  const tpl = ANOMALY_DAG_TEMPLATES[anomaly.dagTemplateId] ||
    ANOMALY_DAG_TEMPLATES[defaultDagForCategory(anomaly.category)];
  if (!tpl) return anomaly;
  anomaly.dag = [tpl.id, tpl.rootId, 0, 0, 0, 0];
  return anomaly;
}

function defaultDagForCategory(category) {
  return { ruins: 'dag_ancient_gallery', spatial: 'dag_tidal_rift', signal: 'dag_silent_forest' }[category] || 'dag_ancient_gallery';
}

/**
 * DAG 异象小时推进（tickAnomalyInvestigation 在 ano.dag 存在时改调本函数）。
 * 每 DAG_PHASE_HOURS 小时投骰一次；阶段推进沿用 ano.progress 累计（goal 同旧口径）。
 * @returns {'ongoing'|'awaiting_choice'|'stage_cleared'|'resolved'} 本小时推进结果
 */
export function tickDagAnomaly(world, ano, fleet) {
  const dag = ano.dag;
  const tpl = ANOMALY_DAG_TEMPLATES[dag[ANO_DAG_IDX.DAG_ID]];
  const node = tpl.nodes[dag[ANO_DAG_IDX.NODE_ID]];
  dag[ANO_DAG_IDX.PHASE_TICKS] += 1;
  if (dag[ANO_DAG_IDX.PHASE_TICKS] < DAG_PHASE_HOURS) return 'ongoing';
  dag[ANO_DAG_IDX.PHASE_TICKS] = 0;
  dag[ANO_DAG_IDX.ATTEMPTS] += 1;

  const roll = deriveAnomalyRoll(world, ano.id, node.stage, dag[ANO_DAG_IDX.ATTEMPTS]);
  const skill = scientistSkill(world, fleet);
  const score = dagTotalScore(roll, skill, dag[ANO_DAG_IDX.CLUES], node.difficulty);
  ano.lastRoll = { roll, skill, score, node: node.id }; // 运行时遥测（非持久化契约字段）

  if (score >= DAG_SCORE_BREAKTHROUGH) {
    return completeDagNode(world, ano, fleet, node);
  }
  if (score >= DAG_SCORE_NORMAL) {
    dag[ANO_DAG_IDX.CLUES] = Math.min(15, dag[ANO_DAG_IDX.CLUES] + 1);
    emit(world, 'DagStageProgress', { anomalyId: ano.id, nodeId: node.id, clues: dag[ANO_DAG_IDX.CLUES] }, 'exploration');
    return 'ongoing';
  }
  // 受挫：悬停抉择点（非阻塞事件卡；由 ResolveAnomalyDagBranch 结算）
  ano.state = 'awaiting_choice';
  ano.pendingDagChoices = node.choices.map((c) => c.id);
  pushPendingChoice(world, ano, node);
  return 'awaiting_choice';
}

function pushPendingChoice(world, ano, node) {
  world.narrative.pendingChoices ||= [];
  world.narrative.pendingChoices.push({
    id: `dag_${ano.id}_${node.id}_${world.tick}`,
    kind: 'anomaly_dag',
    anomalyId: ano.id,
    nodeId: node.id,
    titleZh: `${ano.nameZh}：${node.titleZh}`,
    choices: node.choices,
    createdTick: world.tick,
  });
  const cap = 24;
  if (world.narrative.pendingChoices.length > cap) {
    world.narrative.pendingChoices.splice(0, world.narrative.pendingChoices.length - cap);
  }
}

/** 完成 DAG 节点：点亮先驱者语素位 + 支线奖励；末级节点结算整条异常 */
export function completeDagNode(world, ano, fleet, node) {
  const dag = ano.dag;
  const tpl = ANOMALY_DAG_TEMPLATES[dag[ANO_DAG_IDX.DAG_ID]];
  const fid = fleet.factionId;
  const gain = 2; // 大成功双倍线索（doc34 §2.2.1 梯度 1+2 合并口径：完成节点 + 线索奖励）
  dag[ANO_DAG_IDX.CLUES] = Math.min(15, dag[ANO_DAG_IDX.CLUES] + gain);
  dag[ANO_DAG_IDX.BRANCH_MASK] |= (1 << (node.stage - 1));

  // 先驱者线索：点亮文明语素位
  const civ = precursorForAnomaly(world, ano);
  if (civ && node.clueBit !== undefined) {
    ensurePrecursorTuple(world, civ.id);
    const t = world.narrative.precursors[civ.id];
    t[PREC_IDX.SITES_FOUND] += 1;
    creditPrecursorClue(world, civ, fid, t, node.clueBit);
  }

  emit(world, 'DagNodeCompleted', { anomalyId: ano.id, nodeId: node.id, score: ano.lastRoll?.score }, 'exploration');

  // 末级节点 → 整条异常按旧口径结算（奖励照发），DAG 收束
  const next = Object.values(tpl.nodes).find((n) => n.stage === node.stage + 1);
  if (!next) {
    ano.dagBonusPaid = true;
    if (civ) credit(world, fid, 'ancientData', 4, `dagFinale:${civ.id}`, ano.id, FLOW.LOOT);
    return 'resolved';
  }
  dag[ANO_DAG_IDX.NODE_ID] = next.id;
  dag[ANO_DAG_IDX.PHASE_TICKS] = 0;
  return 'stage_cleared';
}

/** 受挫赌注抉择结算（ResolveAnomalyDagBranch 命令执行体） */
export function resolveDagChoice(world, ano, factionId, choiceId) {
  const dag = ano.dag;
  if (!dag) return { ok: false, reason: '该异常不在 DAG 调查中' };
  const tpl = ANOMALY_DAG_TEMPLATES[dag[ANO_DAG_IDX.DAG_ID]];
  const node = tpl.nodes[dag[ANO_DAG_IDX.NODE_ID]];
  const choice = (node.choices || []).find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: '未知抉择' };
  const led = world.economy.ledgers[factionId];

  if (choice.effect === 'clues3') {
    if (choice.cost) {
      for (const rid of Object.keys(choice.cost)) {
        if ((led?.balances[rid] || 0) < choice.cost[rid]) return { ok: false, reason: `缺少 ${rid}` };
      }
      for (const rid of Object.keys(choice.cost)) {
        debit(world, factionId, rid, choice.cost[rid], `dagWager:${ano.id}`, ano.id, FLOW.CONSUME);
      }
    }
    dag[ANO_DAG_IDX.CLUES] = Math.min(15, dag[ANO_DAG_IDX.CLUES] + 3);
    ano.state = 'analyzing'; // 继续下一轮相位检定
  } else if (choice.effect === 'close_alloy') {
    if (led) credit(world, factionId, 'alloy', 35, `dagSalvage:${ano.id}`, ano.id, FLOW.LOOT);
    finishDagAnomaly(world, ano, factionId);
  } else if (choice.effect === 'close_darkmatter') {
    if (led) credit(world, factionId, 'darkMatter', 5, `dagHarvest:${ano.id}`, ano.id, FLOW.LOOT);
    finishDagAnomaly(world, ano, factionId);
  } else {
    // clues0：谨慎规避，无资源损耗，继续检定
    ano.state = 'analyzing';
  }
  // 移除已结算的悬停事件卡
  world.narrative.pendingChoices = (world.narrative.pendingChoices || [])
    .filter((p) => !(p.kind === 'anomaly_dag' && p.anomalyId === ano.id));
  emit(world, 'DagChoiceResolved', { anomalyId: ano.id, choiceId, factionId }, 'exploration');
  return { ok: true };
}

function finishDagAnomaly(world, ano, factionId) {
  ano.state = 'analyzing'; // 借旧结算通道一次性收束（resolveAnomaly 幂等）
  resolveAnomalyViaScan(world, ano, factionId);
  ano.dag = null;
}

// 延迟导入（避免 scan.js ↔ precursorDag.js 循环导入 TDZ）
let _resolveAnomalyFn = null;
export function setResolveAnomalyHook(fn) { _resolveAnomalyFn = fn; }
function resolveAnomalyViaScan(world, ano, factionId) {
  if (_resolveAnomalyFn) _resolveAnomalyFn(world, ano, factionId);
}

/** 异象 → 先驱者文明映射：探测时按确定性盐值静态绑定（同一 anomaly 恒定） */
export function precursorForAnomaly(world, ano) {
  if (ano.precursorId) return PRECURSOR_BY_ID[ano.precursorId];
  const h = mix32((world.seed >>> 0) ^ hash32(`prec:${ano.id}`) ^ SALT_PRECURSOR);
  const civ = PRECURSORS[h % PRECURSORS.length];
  ano.precursorId = civ.id; // 惰性绑定：仅 DAG 调查路径写入（金快照零漂移）
  return civ;
}

function ensurePrecursorTuple(world, civId) {
  world.narrative.precursors ||= {};
  if (!world.narrative.precursors[civId]) {
    world.narrative.precursors[civId] = [0, 0, 0, null, 0];
  }
  return world.narrative.precursors[civId];
}

function creditPrecursorClue(world, civ, factionId, tuple, bitIdx) {
  const [lo, hi] = civ.lexiconBits;
  const bit = clamp(bitIdx, 0, hi - lo);
  tuple[PREC_IDX.CLUE_MASK] |= (1 << bit);
  tuple[PREC_IDX.STAGE] = Math.max(tuple[PREC_IDX.STAGE], 1);
  emit(world, 'PrecursorClueFound', { civId: civ.id, factionId, clueMask: tuple[PREC_IDX.CLUE_MASK] }, 'exploration');
  if (tuple[PREC_IDX.CLUE_MASK] === ((1 << (hi - lo + 1)) - 1) && tuple[PREC_IDX.STAGE] < 2) {
    revealPrecursorHomeSystem(world, civ, factionId, tuple);
  }
}

/**
 * 集满线索 → 隐藏母星系揭示（玩家母星系 2~4 跳内首个无主星系；
 * 无候选时取全图距玩家母星最近的无主星系）。母星系静态标记 + 遗物入库。
 */
export function revealPrecursorHomeSystem(world, civ, factionId, tuple) {
  const homeColony = Object.values(world.entities.colonies).find((c) => c.factionId === factionId);
  const homeSysId = homeColony ? world.entities.planets[homeColony.planetId]?.systemId : null;
  const owned = (s) => !!s.ownerFactionId;
  let candidates = Object.values(world.entities.systems).filter((s) => !owned(s) && !s.precursorHome);
  if (homeSysId) {
    const hops = hopsFrom(world, homeSysId);
    const inRange = candidates.filter((s) => { const d = hops(s.id); return d >= 2 && d <= 4; });
    if (inRange.length > 0) candidates = inRange;
    candidates.sort((a, b) => hops(a.id) - hops(b.id) || (a.id < b.id ? -1 : 1));
  } else {
    candidates.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const sys = candidates[0];
  tuple[PREC_IDX.STAGE] = 2;
  tuple[PREC_IDX.RELIC_STATE] = 1; // 遗物待机（被动生效）
  if (sys) {
    sys.precursorHome = civ.id;
    tuple[PREC_IDX.HOME_SYS_ID] = sys.id;
    chronicle(world, 'discovery', `先驱者母星系揭示：${civ.nameZh}的痕迹指向 ${sys.name || sys.id}`, { systemId: sys.id });
  }
  emit(world, 'PrecursorHomeworldRevealed', { civId: civ.id, factionId, systemId: sys?.id || null }, 'exploration');
}

function hopsFrom(world, startId) {
  const adj = new Map();
  for (const s of Object.values(world.entities.systems)) {
    adj.set(s.id, s.lanes || []);
  }
  const dist = new Map([[startId, 0]]);
  const q = [startId];
  while (q.length) {
    const cur = q.shift();
    for (const nxt of adj.get(cur) || []) {
      const nid = typeof nxt === 'string' ? nxt : nxt.to;
      if (!dist.has(nid)) { dist.set(nid, dist.get(cur) + 1); q.push(nid); }
    }
  }
  return (id) => dist.get(id) ?? 999;
}

/** 遗物主动激活（ActivatePrecursorRelic 命令执行体；全局 1800 日冷却） */
export function activatePrecursorRelic(world, factionId, civId) {
  const tuple = world.narrative.precursors?.[civId];
  const civ = PRECURSOR_BY_ID[civId];
  if (!tuple || !civ) return { ok: false, reason: '先驱者遗物未归档' };
  if (tuple[PREC_IDX.RELIC_STATE] < 1) return { ok: false, reason: '遗物未获取' };
  if (tuple[PREC_IDX.RELIC_STATE] > 1 && tuple[PREC_IDX.RELIC_STATE] > world.tick) {
    return { ok: false, reason: '遗物主动技能冷却中' };
  }
  const cdUntil = world.narrative.relicCooldownUntil || 0;
  if (cdUntil > world.tick) return { ok: false, reason: '全部遗物共享冷却中' };

  const led = world.economy.ledgers[factionId];
  for (const rid of Object.keys(civ.relic.activeCost || {})) {
    if ((led?.balances[rid] || 0) < civ.relic.activeCost[rid]) return { ok: false, reason: `缺少 ${rid}` };
  }
  for (const rid of Object.keys(civ.relic.activeCost || {})) {
    debit(world, factionId, rid, civ.relic.activeCost[rid], `relicActiveCost:${civ.id}`, civ.id, FLOW.CONSUME);
  }
  // 主动效果结算
  if (civ.relic.activeGain) {
    for (const rid of Object.keys(civ.relic.activeGain)) {
      credit(world, factionId, rid, civ.relic.activeGain[rid], `relicActive:${civ.id}`, civ.id, FLOW.LOOT);
    }
  }
  const activeDays = civ.relic.activeDays || 0;
  world.narrative.relicCooldownUntil = activeDays > 0 ? world.tick + activeDays * 24 : world.tick;
  world.narrative.relicEffects ||= {};
  world.narrative.relicEffects[civ.relic.activeEffect] = world.narrative.relicCooldownUntil;
  tuple[PREC_IDX.RELIC_STATE] = activeDays > 0 ? world.narrative.relicCooldownUntil : tuple[PREC_IDX.RELIC_STATE];
  tuple[PREC_IDX.STAGE] = 3;
  emit(world, 'PrecursorRelicActivated', { civId: civ.id, factionId, effect: civ.relic.activeEffect }, 'narrative');
  chronicle(world, 'discovery', `先驱者遗物激活：${civ.relic.nameZh}（${civ.nameZh}）`, { civId: civ.id });
  return { ok: true, effect: civ.relic.activeEffect, nameZh: civ.relic.nameZh };
}


/** 线索发放通道（遗物剧情/任务奖励/测试驱动；复用 creditPrecursorClue 收敛逻辑） */
export function grantPrecursorClue(world, civId, factionId, bitIdx) {
  const civ = PRECURSOR_BY_ID[civId];
  if (!civ) return { ok: false, reason: '未知先驱者文明' };
  const t = ensurePrecursorTuple(world, civId);
  creditPrecursorClue(world, civ, factionId, t, bitIdx);
  return { ok: true, stage: t[PREC_IDX.STAGE], clueMask: t[PREC_IDX.CLUE_MASK] };
}

/** 先驱者考古进度快照（UI/遥测） */
export function precursorProgress(world) {
  const out = {};
  for (const civ of PRECURSORS) {
    const t = world.narrative.precursors?.[civ.id];
    out[civ.id] = t ? { stage: t[PREC_IDX.STAGE], clues: popcount(t[PREC_IDX.CLUE_MASK]), homeSystemId: t[PREC_IDX.HOME_SYS_ID], relicState: t[PREC_IDX.RELIC_STATE] } : null;
  }
  return out;
}

function popcount(v) {
  let n = 0;
  while (v) { v &= v - 1; n++; }
  return n;
}
