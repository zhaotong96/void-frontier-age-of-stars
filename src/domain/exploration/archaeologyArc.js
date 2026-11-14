/**
 * domain/exploration/archaeologyArc.js — S1 深空探索与异星考古弧
 * （SPEC-PLAN-044 阶段一 M1 Task 1.4；责任人：Eng-B）
 *
 * 职责（doc44 §Task 1.4 逐条契约）：
 *  1. import 期 registerSituationArc('S1', …)：进度 [0,1000]；
 *     四幕幕界采用 doc42 总纲权威裁决 [0,250]/[251,650]/[651,900]/[901,1000]
 *     （44 号文档 251-500/501-750/751-1000 与总纲冲突，弃用，见施工 notes）；
 *  2. 三大发掘对策精确参数：CAUTIOUS(-5% 科研, +25 pts/月, good×5.0/danger×0.2)、
 *     STREAMLINED(-10%, +40, ×1.0)、OVERDRIVE(-15%, +65, danger×5.0)；
 *  3. 首席科学家特质：PROSPECTOR 矿脉丰度 +20%~+50%
 *     （bonus = 20 + sampleFloat01(ARC_S1_ARCHAEOLOGY, planetId, 0) × 30）；
 *     XENOLINGUIST 破译进度 +30%、外交信任上限 +25（meta 标记）；
 *     群像接线（doc42 总纲终审整改）：startArchaeologyDig 第 5 参 scientistId 挂接
 *     首席科学家 → 考古晋幕 grantScientistXp（难度 = 幕次）、高危灾难事件
 *     traumaCheck('archaeology_disaster')（42 号 §五.2 科学家 [25,120] XP 与创伤实战可达）；
 *  4. 月度事件池采样：权重走 def.approaches[currentApproach].eventWeights，
 *     采样 sampleWeightedIndex(ARC_S1_ARCHAEOLOGY, planetId, world.tick)；
 *  5. 第四幕收官 climax：稀有文物 MinorArtifacts + 遗物 Relics（resolved 历史记 impact）、
 *     envVector[3] += 35.0（clamp 100）、解锁 Relic World 转化旗标、epochStage → 3、appendHistory。
 *
 * 纪律（doc43 §1.4）：零 Math.random / Date.now；弧注册与本文件全部副作用仅限
 * registerSituationArc / registerSituationMonthlyHook（本弧无月度钩子，S1 月度行为
 * 全部走 SpaceOperaClock 注入的 stepSituation 桶步进）；不触世界主随机流。
 */

import {
  registerSituationArc,
  spawnSituation,
  listActiveSituations,
  actStageForBounds,
} from '../events/situationEngine.js';
// 42 号总纲 §五.2：考古阶段事件群像接线（galacticParagons 不反读本模块，无环）
import { grantScientistXp, traumaCheck } from '../characters/galacticParagons.js';
import { DOMAIN_SALTS, sampleFloat01, sampleWeightedIndex } from '../world/deterministicRng.js';
import {
  ensureCompactPlanetState,
  appendHistory,
  HISTORY_EVENT_CODES,
  numericEntityKey,
} from '../planets/planetStateSchema.js';
import { emit } from '../../core/eventBus.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/* ============================== 弧参数（doc44 Task 1.4 精确数值表） ============================== */

/** 四幕幕界（doc42 总纲权威裁决：251-650 / 651-900 / 901-1000） */
export const S1_ACT_BOUNDS = Object.freeze([
  Object.freeze([0, 250]),
  Object.freeze([251, 650]),
  Object.freeze([651, 900]),
  Object.freeze([901, 1000]),
]);

export const S1_PROGRESS_MAX = 1000;

/** 三大对策 → 帝国全局科研速度修正（负值；CHK-M1-05 精确断言 -5%/-10%/-15%） */
export const S1_APPROACH_RESEARCH_MODIFIERS = Object.freeze({
  CAUTIOUS: -0.05,
  STREAMLINED: -0.10,
  OVERDRIVE: -0.15,
});

/** 三大对策 → 基础进度增速（pts/月） */
export const S1_APPROACH_MONTHLY_DELTA = Object.freeze({
  CAUTIOUS: 25,
  STREAMLINED: 40,
  OVERDRIVE: 65,
});

/** 三大对策 → 确定性事件池采样权重修正（good=正面发现 / danger=高危灾难） */
export const S1_APPROACH_EVENT_WEIGHTS = Object.freeze({
  CAUTIOUS: Object.freeze({ good: 5.0, danger: 0.2 }),
  STREAMLINED: Object.freeze({ good: 1.0, danger: 1.0 }),
  OVERDRIVE: Object.freeze({ good: 1.0, danger: 5.0 }),
});

/** XENOLINGUIST：破译进度速率乘子（+30%）与外交信任上限加成（+25，meta 标记） */
export const XENOLINGUIST_PROGRESS_RATE_MULT = 1.3;
export const XENOLINGUIST_TRUST_CAP_BONUS = 25;

/** 第四幕收官奖励（M1 粗配数量；随 impact 记入 resolved 历史） */
export const S1_FINALE_MINOR_ARTIFACTS = 3;
export const S1_FINALE_RELICS = 1;
/** 第四幕收官：envVector[3]（PrecursorResonance）推升量（clamp 100） */
export const S1_RESONANCE_GAIN = 35.0;

/**
 * S1 月度确定性事件池（baseWeight 全 1.0；实际权重 = baseWeight ×
 * def.approaches[currentApproach].eventWeights[kind]）。
 */
const S1_EVENT_POOL = Object.freeze([
  { id: 'artifact_intact', kind: 'good', nameZh: '文物完好出土' },
  { id: 'precursor_signal', kind: 'good', nameZh: '先驱者信号破译' },
  { id: 'benign_contact', kind: 'good', nameZh: '良性接触确认' },
  { id: 'excavation_collapse', kind: 'danger', nameZh: '高危坍塌' },
  { id: 'guardian_awakens', kind: 'danger', nameZh: '守卫机关苏醒' },
  { id: 'crew_casualty', kind: 'danger', nameZh: '考察队伤亡' },
]);

/* ============================== 首席科学家特质（doc44 Task 1.4 §3） ============================== */

/**
 * PROSPECTOR 勘探加成采样：矿脉丰度提升百分比 ∈ [20, 50)
 * （bonus = 20 + sampleFloat01(ARC_S1_ARCHAEOLOGY, planetId, 0) × 30；
 * planetId 经 numericEntityKey 归一（'plt_5' → 5），同 (seed, planetId) 永远同值）。
 *
 * @param {object} world - 世界根对象（读 world.seed）
 * @param {string|number} planetId - 行星 ID
 * @returns {number} 丰度提升百分比 [20, 50)
 */
export function prospectingDepositBonus(world, planetId) {
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  return 20 + sampleFloat01(seed, DOMAIN_SALTS.ARC_S1_ARCHAEOLOGY, numericEntityKey(planetId), 0) * 30;
}

/**
 * 应用 PROSPECTOR 勘探加成：planet.deposits[].density 确定性 ×（1 + bonus/100），
 * 并把 bonus 记入局势 meta.veinBonusPercent（勘探发现矿脉丰度提升的权威记账位）。
 *
 * @returns {number} 实际应用的丰度提升百分比
 */
export function applyProspectingBonus(world, planetId, situation) {
  const planet = world && world.entities && world.entities.planets ? world.entities.planets[planetId] : null;
  if (!planet) throw new Error(`SO: 考古目标行星不存在 ${String(planetId)}`);
  const bonus = prospectingDepositBonus(world, planetId);
  if (Array.isArray(planet.deposits)) {
    const factor = 1 + bonus / 100;
    for (const dep of planet.deposits) {
      if (dep && typeof dep === 'object' && Number.isFinite(dep.density)) {
        dep.density = dep.density * factor;
      }
    }
  }
  if (situation) situation.meta.veinBonusPercent = bonus;
  return bonus;
}

/* ============================== 玩家入口：启动考古发掘 ============================== */

/**
 * 启动一条 S1 深空考古弧（spawn + 首席科学家加成；供 M1 命令 handler 直接调用）。
 *
 * @param {object} world - 世界根对象
 * @param {string|number} planetId - 目标行星 ID（实体必须存在）
 * @param {string} approachId - 初始对策 ∈ CAUTIOUS | STREAMLINED | OVERDRIVE
 * @param {string|null} scientistTrait - 首席科学家特质 ∈ PROSPECTOR | XENOLINGUIST | null
 * @param {string|number|null} [scientistId] - 首席科学家人物 ID（可选；挂接后考古阶段
 *   晋幕 grantScientistXp、高危灾难 traumaCheck('archaeology_disaster') 实战可达）
 * @returns {object} 新建的 S1 局势实例
 */
export function startArchaeologyDig(world, planetId, approachId, scientistTrait, scientistId = null) {
  const planet = world && world.entities && world.entities.planets ? world.entities.planets[planetId] : null;
  if (!planet) throw new Error(`SO: 考古目标行星不存在 ${String(planetId)}`);
  if (scientistTrait != null && scientistTrait !== ''
    && scientistTrait !== 'PROSPECTOR' && scientistTrait !== 'XENOLINGUIST') {
    throw new Error(`SO: 未知首席科学家特质 ${String(scientistTrait)}（合法 PROSPECTOR|XENOLINGUIST|null）`);
  }
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId === 'S1' && s.targetEntityId === planetId) {
      throw new Error(`SO: 行星 ${String(planetId)} 已有进行中的深空考古局势 #${s.id}`);
    }
  }
  // 命令时点惰性挂载紧凑态（climax 需要/envVector 与 historyRing；绝不触 world.rng）
  ensureCompactPlanetState(planet, world);
  const situation = spawnSituation(world, {
    arcId: 'S1',
    targetEntityId: planetId,
    progress: 0,
    currentApproach: approachId,
    meta: {
      scientistTrait: scientistTrait != null && scientistTrait !== '' ? scientistTrait : null,
      scientistId: scientistId != null && scientistId !== '' ? scientistId : null,
      lastActStage: 1, // 群像晋幕 XP 游标（初始第 1 幕，跨幕时入账 grantScientistXp）
      // 生成月即锁定事件采样游标：首个完整月界（次月）起采，生成当月不采
      lastEventMonth: Math.floor((Number.isFinite(world.tick) ? world.tick : 0) / TICKS_PER_MONTH),
    },
  });
  if (scientistTrait === 'PROSPECTOR') {
    applyProspectingBonus(world, planetId, situation);
  } else if (scientistTrait === 'XENOLINGUIST') {
    situation.meta.progressRateMult = XENOLINGUIST_PROGRESS_RATE_MULT;
    situation.meta.diplomacyTrustCapBonus = XENOLINGUIST_TRUST_CAP_BONUS;
  }
  return situation;
}

/**
 * 当前世界活跃 S1 考古局势的帝国科研速度修正合计（供结算钩子/集成层消费；
 * 多条考古并发时线性叠加）。
 *
 * @returns {number} ≤ 0（无活跃考古 = 0）
 */
export function s1ResearchModifier(world) {
  let mod = 0;
  for (const s of listActiveSituations(world)) {
    if (s.systemArcId !== 'S1') continue;
    const m = S1_APPROACH_RESEARCH_MODIFIERS[s.currentApproach];
    if (Number.isFinite(m)) mod += m;
  }
  return mod;
}

/* ============================== 弧注册（import 期自注册） ============================== */

registerSituationArc('S1', {
  progressMax: S1_PROGRESS_MAX,
  actBounds: S1_ACT_BOUNDS,

  approaches: {
    CAUTIOUS: {
      monthlyDelta: S1_APPROACH_MONTHLY_DELTA.CAUTIOUS,
      researchModifier: S1_APPROACH_RESEARCH_MODIFIERS.CAUTIOUS,
      eventWeights: S1_APPROACH_EVENT_WEIGHTS.CAUTIOUS,
    },
    STREAMLINED: {
      monthlyDelta: S1_APPROACH_MONTHLY_DELTA.STREAMLINED,
      researchModifier: S1_APPROACH_RESEARCH_MODIFIERS.STREAMLINED,
      eventWeights: S1_APPROACH_EVENT_WEIGHTS.STREAMLINED,
    },
    OVERDRIVE: {
      monthlyDelta: S1_APPROACH_MONTHLY_DELTA.OVERDRIVE,
      researchModifier: S1_APPROACH_RESEARCH_MODIFIERS.OVERDRIVE,
      eventWeights: S1_APPROACH_EVENT_WEIGHTS.OVERDRIVE,
    },
  },

  /**
   * 每次桶步进：monthlyDelta = 对策基础增速 × 特质速率乘子（XENOLINGUIST +30%）；
   * 考古晋幕群像 XP（meta.scientistId 挂接时跨幕入账 grantScientistXp，难度 = 幕次）；
   * 月界推进一次事件池采样（采样 step = world.tick，doc44 Task 1.4 §2 口径），
   * 高危灾难事件对首席科学家执行 traumaCheck('archaeology_disaster')。
   */
  onStep(world, situation) {
    const approach = S1_APPROACH_MONTHLY_DELTA[situation.currentApproach];
    const rateMult = Number.isFinite(situation.meta.progressRateMult) ? situation.meta.progressRateMult : 1.0;
    situation.monthlyDelta = (Number.isFinite(approach) ? approach : 0) * rateMult;

    // —— 考古晋幕群像 XP（42 号 §五.2 科学家 [25,120] 实战可达整改；跨幕游标幂等）——
    if (situation.meta.scientistId != null) {
      const stage = actStageForBounds(S1_ACT_BOUNDS, situation.progress);
      if (!Number.isFinite(situation.meta.lastActStage)) situation.meta.lastActStage = stage;
      if (stage > situation.meta.lastActStage) {
        situation.meta.lastActStage = stage;
        grantScientistXp(world, situation.meta.scientistId, stage);
      }
    }

    const month = Math.floor(world.tick / TICKS_PER_MONTH);
    if (situation.meta.lastEventMonth == null) {
      // 兜底（未经 startArchaeologyDig 的裸 spawn）：生成当月不计采样，次月界起采
      situation.meta.lastEventMonth = month;
      return;
    }
    if (month <= situation.meta.lastEventMonth) return;
    situation.meta.lastEventMonth = month;

    const weights = [];
    const w = S1_APPROACH_EVENT_WEIGHTS[situation.currentApproach] || { good: 1.0, danger: 1.0 };
    for (const e of S1_EVENT_POOL) {
      weights.push(e.kind === 'good' ? w.good : w.danger);
    }
    const pick = sampleWeightedIndex(
      world.seed,
      DOMAIN_SALTS.ARC_S1_ARCHAEOLOGY,
      numericEntityKey(situation.targetEntityId),
      world.tick,
      weights,
    );
    const ev = S1_EVENT_POOL[pick] || S1_EVENT_POOL[0];
    if (ev.kind === 'good') situation.meta.goodEvents = (situation.meta.goodEvents | 0) + 1;
    else situation.meta.dangerEvents = (situation.meta.dangerEvents | 0) + 1;
    if (ev.id === 'artifact_intact') situation.meta.minorArtifacts = (situation.meta.minorArtifacts | 0) + 1;
    if (ev.id === 'crew_casualty') situation.meta.crewCasualties = (situation.meta.crewCasualties | 0) + 1;
    // —— 高危灾难 → 首席科学家创伤检定（42 号 §五.2 考古惨剧实战可达整改；确定性）——
    if (ev.kind === 'danger' && situation.meta.scientistId != null) {
      const scientist = world.entities && world.entities.characters
        ? world.entities.characters[situation.meta.scientistId] : null;
      if (scientist) traumaCheck(scientist, 'archaeology_disaster', world.tick);
    }
    emit(world, 'SituationArcEvent', {
      situationId: situation.id,
      systemArcId: 'S1',
      planetId: situation.targetEntityId,
      eventId: ev.id,
      kind: ev.kind,
      monthIndex: month,
    }, 'exploration');
  },

  /**
   * 收官钩子：climax = 第四幕终极蜕变（文物/遗物/谐振/纪元）；defused = 考古中止（S1
   * 对策增速全为正，理论不可达，保留契约对称性）。
   */
  climax(world, situation, outcome) {
    if (outcome !== 'climax') {
      situation.impact = 'S1:DIG_ABORTED';
      return;
    }
    const planet = world && world.entities && world.entities.planets
      ? world.entities.planets[situation.targetEntityId] : null;
    const compact = planet ? planet.compactState : null;

    const finaleArtifacts = (situation.meta.minorArtifacts | 0) + S1_FINALE_MINOR_ARTIFACTS;
    situation.meta.minorArtifacts = finaleArtifacts;
    situation.meta.relics = (situation.meta.relics | 0) + S1_FINALE_RELICS;
    // resolved 历史 impact 记账（resolveSituationClimax 写入 SituationResolved payload）
    situation.impact = `S1:MINOR_ARTIFACTS_${finaleArtifacts};RELICS_${situation.meta.relics}`;

    if (planet) planet.relicWorldUnlocked = true; // Relic World 转化旗标（M2 转化科技消费）
    situation.meta.relicWorldUnlocked = true;

    if (compact && Array.isArray(compact.envVector)) {
      compact.envVector[3] = Math.min(100, compact.envVector[3] + S1_RESONANCE_GAIN); // 先驱者谐振 +35
      if (compact.epochStage < 3) compact.epochStage = 3; // 奇观蜕变纪元（不可逆晋升，绝不降级）
      appendHistory(
        compact,
        world.tick,
        HISTORY_EVENT_CODES.EPOCH_TRANSFORMED,
        compact.colony ? compact.colony.ownerId : -1,
        finaleArtifacts,
      );
    }
  },
});
