/**
 * domain/diplomacy/galacticSenateAndCrisisArc.js — S7 星际共同体、兰兹拉德/CHOAM 暗战
 * 与三大终局天灾弧（SPEC-PLAN-046 阶段三 M3 Task 3.4；责任人：Eng-B / Eng-C 协同）
 *
 * 职责（doc46 §Task 3.4 + doc42 总纲 S7 章节逐条契约）：
 *  a) 委任状 signCommission(world, factionId)：月饷（COMMISSION_PAY_BASE +
 *     COMMISSION_PAY_PER_FLEET × 舰队规模，月度钩子入账）+ 军用船体购买权
 *     （world.spaceOperaState.commissions，按派系键存 {factionId, signedTick,
 *     militaryHullAccess:true, totalPaid}）；
 *  b) 兰兹拉德/CHOAM：world.spaceOperaState.landsraad = {standing:0, choamShares:0}；
 *     adjustChoamShares(delta) clamp [0,100]；≥30 → choamTradeDividendMult 导出 1.15
 *     （贸易分红乘子）；≥50 → hasEmbargoLeverage = true（禁运制裁操纵）；
 *  c) 间谍：upgradePalaceEspionage（特工招募 ×1.5）；spyNetwork(targetFactionId) 层 0–3
 *     （layerUpSpyNetwork / plantDoubleAgent）；assassinate：满 3 层 + 双面间谍才可执行
 *     → 目标派系首脑领袖移除（removeEntity）+ 关系震荡（opinion −30 / trust −20 /
 *     grievances +1），网络曝光焚毁；
 *  d) 三大终局天灾（world.spaceOperaState.endgameCrisis = {active, ghostSignalActive,
 *     lastResolved}；月度钩子确定性推进）：
 *     - PRETHORYN：月占 1 星系 → 感染星球（256 tiles overlayId=5 菌毯 + meta.infested=true）；
 *       净化法则 purifyInfestedWorld(planet, devastation)：devastation ≥ 100 → 菌毯清除、
 *       还原可改造荒芜（biome 0 / overlay 0 / infested=false）；援军缩放
 *       PRETHORYN_REINFORCE_SCHEDULE：<20% → 2 支/年、≥20% → 3/年、≥40% → 4/年；
 *     - UNBIDDEN：维度锚点 anchorsRemaining（4），拔除全部锚点才解除传送门无敌
 *       （dimensionalPortalInvulnerable）；侵占 ≥15% → 相继生成 ABERRANT/VEHEMENT
 *       两敌对派系（三方混战旗标 threeWayWar）；
 *     - CONTINGENCY：ghostSignalActive → 全银河智械产出暴跌乘子 0.6 +
 *       40% 阵前倒戈确定性检定（contingencyDefectionRoll）；破 4 座机械母星核心 +
 *       加密防火墙 → 终结（ghostSignalActive=false、active=null）；
 *  e) 利维坦凯旋大游行：onLeviathanDefeated(world, systemId)（经 eventBus.on
 *     'LeviathanDefeated' 钩到 planetaryThreat.reportLeviathanDefeated 的事件路径）→
 *     spawnSituation('LEVIATHAN_PARADE'，目标殖民地)；对策 ENCOURAGE（+6.0/月，
 *     全殖民地幸福度 +15%）/ SUPPRESS（−4.0/月）/ REORGANIZE（扣 1000 凝聚力迁址，
 *     不足 throw）；progress ≥ 100 → 永久巨兽战利品地标（planet.leviathanTrophy）+
 *     凝聚奖励 min(LEVIATHAN_PARADE_UNITY_CAP=1000000, unityMonthlyOutput × 120)。
 *
 * 月度钩子接线（任务书第 5 条）：stepGalacticSenateMonthly / stepEndgameCrisisMonthly
 * 经 situationEngine.registerSituationMonthlyHook 登记 → 动态 import SpaceOperaClock →
 * setClockHooks(monthlyHooks) 注入，月末 tick%720===0 触发；两钩子首行守卫
 * world.spaceOperaState（金快照世界零读取零写入）。
 *
 * 实战可达整改（doc42 总纲合规终审）：stepGalacticSenateMonthly 月末追加大灾有机
 * 触发检定 stepEndgameCrisisOrganicTrigger（游戏后期 month ≥ 120 + 已殖民星系占比
 * ≥ 25% + 无活跃天灾 + 24 月冷却 → 逐月 8% 确定性检定，42 号 §二.7 第三幕）；
 * 巨兽击杀结算（planetaryThreat.reportLeviathanDefeated）直连 onLeviathanDefeated
 * 开启凯旋大游行局势（42 号 §二.7 第四幕；eventBus 监听器路径保留，双路径幂等收敛）；
 * 兰兹拉德宪章法案（Charters）表决弧（§二.7 第二幕「议会支配宪章投票」）：proposeLandsraadBill
 * 提案 + settleLandsraadBillMonthly 月末 standing 加权表决（CHOAM 股份/禁运杠杆/间谍网/
 * 委任状/宣战与交恶修正器），三种宪章通过即落制裁/拨款/授权效果。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅注册弧定义 / 月度钩子 / 事件监听器与冻结常量，不改世界状态；
 *  - S7 新键（commissions / landsraad / palaceEspionage / endgameCrisis / unityTreasury）
 *    一律经 ensureS7State 惰性补齐（幂等）——fresh ensureSpaceOperaState 的顶层键集
 *    （CHK-00-04 冻结契约）不受影响；
 *  - onLeviathanDefeated 与 'LeviathanDefeated' 监听器首行守卫 world.spaceOperaState：
 *    金快照世界即便发生巨兽击杀也绝不 ensure 容器、零漂移；
 *  - 确定性随机一律 deriveSeed/sampleFloat01 + DOMAIN_SALTS.ARC_S7_CRISIS（0xC701）；
 *    零 Math.random / Date.now / world.rng。
 */

import {
  registerSituationArc,
  registerSituationMonthlyHook,
  spawnSituation,
  getSituation,
  switchSituationApproach,
  listActiveSituations,
} from '../events/situationEngine.js';
import { ensureSpaceOperaState } from '../world/worldMigration.js';
import { DOMAIN_SALTS, deriveSeed, sampleFloat01 } from '../world/deterministicRng.js';
import {
  packTile,
  unpackTile,
  ensureCompactPlanetState,
  numericEntityKey,
  appendHistory,
  HISTORY_EVENT_CODES,
} from '../planets/planetStateSchema.js';
import { credit, debit, FLOW } from '../economy/ledger.js';
import { getRelation } from './war.js';
import { relationKey } from '../../core/ids.js';
import { createEntity, removeEntity } from '../entities/registry.js';
import { emit, chronicle, on } from '../../core/eventBus.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/** S7 确定性子流盐值（DOMAIN_SALTS 冻结表：议会刺杀检定与三大终局天灾裂隙选址域） */
const SALT = DOMAIN_SALTS.ARC_S7_CRISIS;

/* ============================== 常量表（doc46 精确值与 M3 裁决值） ============================== */

/** 委任状月饷：基值 + 每支玩家舰队加成（doc42「每月按舰队规模领取固定军饷」；M3 裁决数值） */
export const COMMISSION_PAY_BASE = 1200;
export const COMMISSION_PAY_PER_FLEET = 400;

/** CHOAM 股份两档阈值与贸易分红乘子（doc46 精确值 30% / 1.15 / 50%） */
export const CHOAM_DIVIDEND_SHARE_THRESHOLD = 30;
export const CHOAM_DIVIDEND_MULT = 1.15;
export const CHOAM_EMBARGO_SHARE_THRESHOLD = 50;

/** 宫殿间谍翼升级费用与特工招募乘子（费用为 M3 裁决值；×1.5 为 doc46 精确值） */
export const PALACE_ESPIONAGE_UPGRADE_CREDITS = 8000;
export const PALACE_ESPIONAGE_RECRUIT_MULT = 1.5;

/** 间谍网层级上限与行动成本（intelPoints；M3 裁决值） */
export const SPY_NETWORK_MAX_LAYERS = 3;
export const SPY_LAYER_UP_INTEL_COST = 10;
export const DOUBLE_AGENT_INTEL_COST = 20;

/** 刺杀关系震荡（opinion −30 / trust −20；M3 裁决值） */
export const ASSASSINATE_OPINION_HIT = 30;
export const ASSASSINATE_TRUST_HIT = 20;

/** 三大终局天灾枚举（与 legacy crisis.js 的 crisis_automata / crisis_rift 命名空间正交） */
export const ENDGAME_CRISIS_KINDS = Object.freeze(['PRETHORYN', 'UNBIDDEN', 'CONTINGENCY']);

/** 索林原虫援军动态缩放（doc46 精确档：<20% → 2/年、≥20% → 3/年、≥40% → 4/年） */
export const PRETHORYN_REINFORCE_SCHEDULE = Object.freeze([
  Object.freeze({ minShare: 0, perYear: 2 }),
  Object.freeze({ minShare: 0.2, perYear: 3 }),
  Object.freeze({ minShare: 0.4, perYear: 4 }),
]);

/** UNBIDDEN 维度锚点总数 / 侵占月增速 / 三方混战触发阈值（15% 为 doc46 精确值） */
export const UNBIDDEN_ANCHOR_COUNT = 4;
export const UNBIDDEN_SHARE_GROWTH_PER_MONTH = 0.01;
export const UNBIDDEN_RIVAL_SHARE_THRESHOLD = 0.15;

/** CONTINGENCY：智械产出暴跌乘子 / 阵前倒戈概率 / 机械母星核心数（doc46 精确值） */
export const CONTINGENCY_OUTPUT_MULT = 0.6;
export const CONTINGENCY_DEFECT_CHANCE = 0.4;
export const CONTINGENCY_CORE_COUNT = 4;

/** 利维坦大游行：凝聚奖励封顶 / 迁址成本 / 对策月增量（doc46 精确值） */
export const LEVIATHAN_PARADE_UNITY_CAP = 1000000;
export const PARADE_REORGANIZE_UNITY_COST = 1000;
export const PARADE_ENCOURAGE_MONTHLY = 6.0;
export const PARADE_SUPPRESS_MONTHLY = -4.0;
export const PARADE_ENCOURAGE_HAPPINESS_MULT = 1.15;

/** 天灾有机触发：最早触发月龄（游戏后期门槛：120 游戏月 = 第 11 年；42 号 §二.7 第三幕） */
export const ENDGAME_CRISIS_MIN_MONTH = 120;
/** 天灾有机触发：已殖民星系占全银河星系数比例门槛（42 号 §二.7「星系占比」口径） */
export const ENDGAME_CRISIS_MIN_COLONIZED_SHARE = 0.25;
/** 天灾有机触发：达标后逐月检定概率（sampleFloat01 确定性 roll < 该值 → 爆发） */
export const ENDGAME_CRISIS_MONTHLY_CHANCE = 0.08;
/** 天灾有机触发：上次天灾终结后的冷却月数（冷却期内不再有机爆发） */
export const ENDGAME_CRISIS_COOLDOWN_MONTHS = 24;

/* ============================== 惰性 S7 容器（幂等 ensure） ============================== */

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function worldSeedOf(world) {
  return (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
}

function tickOf(world) {
  return Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
}

/** 派系注册解析（字符串键直查 + String 同值桥接；未注册返回 null） */
function resolveRegisteredFaction(world, factionId) {
  const factions = world && world.entities && world.entities.factions ? world.entities.factions : {};
  for (const k of Object.keys(factions)) {
    if (k === factionId || String(k) === String(factionId)) return k;
  }
  return null;
}

/** 派系存在性守卫（业务失败抛 SO → 命令总线回滚） */
function requireFaction(world, factionId) {
  const key = resolveRegisteredFaction(world, factionId);
  if (!key) throw new Error(`SO: 派系不存在 ${String(factionId)}`);
  return key;
}

/** 玩家派系键（未定义/未注册抛 SO） */
function playerFactionKey(world) {
  const pf = world && world.playerFactionId;
  if (!pf) throw new Error('SO: 需要已定义的玩家派系（world.playerFactionId）');
  return requireFaction(world, pf);
}

/**
 * 幂等补齐 S7 子容器（仅显式生命周期入口与月度钩子调用；绝不消费 world.rng）。
 * fresh ensureSpaceOperaState 的顶层键集（CHK-00-04 冻结契约）不受影响 ——
 * 本函数只在首次触达 S7 时追加 commissions / landsraad / palaceEspionage /
 * endgameCrisis / unityTreasury 五键。
 */
export function ensureS7State(world) {
  const soState = ensureSpaceOperaState(world);
  if (!isPlainObject(soState.commissions)) soState.commissions = {};
  if (!isPlainObject(soState.landsraad)) {
    soState.landsraad = { standing: 0, choamShares: 0 };
  } else {
    if (!Number.isFinite(soState.landsraad.standing)) soState.landsraad.standing = 0;
    if (!Number.isFinite(soState.landsraad.choamShares)) soState.landsraad.choamShares = 0;
  }
  if (!isPlainObject(soState.palaceEspionage)) {
    soState.palaceEspionage = { upgraded: false, agentRecruitMult: 1.0, spyNetworks: {} };
  } else {
    if (!isPlainObject(soState.palaceEspionage.spyNetworks)) soState.palaceEspionage.spyNetworks = {};
    if (typeof soState.palaceEspionage.upgraded !== 'boolean') soState.palaceEspionage.upgraded = false;
    if (!Number.isFinite(soState.palaceEspionage.agentRecruitMult)) {
      soState.palaceEspionage.agentRecruitMult = soState.palaceEspionage.upgraded ? 1.5 : 1.0;
    }
  }
  if (!isPlainObject(soState.endgameCrisis)) {
    soState.endgameCrisis = { active: null, ghostSignalActive: false, lastResolved: null };
  } else {
    if (!('active' in soState.endgameCrisis)) soState.endgameCrisis.active = null;
    if (typeof soState.endgameCrisis.ghostSignalActive !== 'boolean') soState.endgameCrisis.ghostSignalActive = false;
  }
  if (!Number.isFinite(soState.unityTreasury)) soState.unityTreasury = 0;
  return soState;
}

/* ============================== a) 委任状（Commission） ============================== */

/** 委任状月饷：基值 + 每支玩家舰队 400（月度钩子重算口径；「按舰队规模领取固定军饷」） */
export function commissionMonthlyPay(world) {
  const fleets = world && world.entities && world.entities.fleets ? world.entities.fleets : {};
  const pf = world && world.playerFactionId;
  let n = 0;
  for (const k of Object.keys(fleets)) {
    const f = fleets[k];
    if (f && f.status !== 'dissolved' && pf != null
      && (f.factionId === pf || String(f.factionId) === String(pf))) n++;
  }
  return COMMISSION_PAY_BASE + COMMISSION_PAY_PER_FLEET * n;
}

/**
 * 签署雇佣委任状（月饷 + 军用船体购买权；world.spaceOperaState.commissions）。
 * 业务失败（派系不存在 / 自签 / 重复签署）抛 Error('SO:…') → 命令总线回滚。
 *
 * @returns {object} 新建的委任状记录
 */
export function signCommission(world, factionId) {
  const key = requireFaction(world, factionId);
  const pf = playerFactionKey(world);
  if (key === pf) throw new Error('SO: 不可与己方派系签署委任状');
  const soState = ensureS7State(world);
  if (soState.commissions[key]) throw new Error(`SO: 已持有 ${String(key)} 的委任状，禁止重复签署`);
  const commission = {
    factionId: key,
    signedTick: tickOf(world),
    militaryHullAccess: true, // 军用船体购买权解锁
    totalPaid: 0,
  };
  soState.commissions[key] = commission;
  emit(world, 'CommissionSigned', {
    factionId: key,
    signedTick: commission.signedTick,
    militaryHullAccess: true,
    monthlyPayCredits: commissionMonthlyPay(world),
  }, 'diplomacy');
  chronicle(world, 'diplomacy', `已签署 ${String(key)} 雇佣委任状：月饷按舰队规模领取，军用船体市场准入解锁`, { factionId: key });
  return commission;
}

/* ============================== b) 兰兹拉德 / CHOAM ============================== */

/**
 * 调整 CHOAM 星际垄断联合体股份（clamp [0,100]；world.spaceOperaState.landsraad）。
 * ≥30 → 全银河贸易分红乘子 1.15（choamTradeDividendMult 导出）；
 * ≥50 → embargoLeverage = true（禁运制裁操纵）。
 */
export function adjustChoamShares(world, delta) {
  const soState = ensureS7State(world);
  const cur = Number.isFinite(soState.landsraad.choamShares) ? soState.landsraad.choamShares : 0;
  const d = Number.isFinite(delta) ? delta : 0;
  const next = Math.max(0, Math.min(100, cur + d));
  soState.landsraad.choamShares = next;
  emit(world, 'ChoamSharesAdjusted', {
    choamShares: next,
    delta: d,
    dividendMult: choamTradeDividendMult(world),
    embargoLeverage: hasEmbargoLeverage(world),
  }, 'diplomacy');
  return next;
}

/** 兰兹拉德大议会选票调整（clamp [0,100]；standing 字段维护） */
export function adjustLandsraadStanding(world, delta) {
  const soState = ensureS7State(world);
  const cur = Number.isFinite(soState.landsraad.standing) ? soState.landsraad.standing : 0;
  const next = Math.max(0, Math.min(100, cur + (Number.isFinite(delta) ? delta : 0)));
  soState.landsraad.standing = next;
  return next;
}

/** CHOAM 贸易分红乘子导出（≥30% → 1.15，否则 1.0；只读，容器缺失返回 1.0） */
export function choamTradeDividendMult(world) {
  const soState = world && world.spaceOperaState;
  const shares = soState && isPlainObject(soState.landsraad)
    && Number.isFinite(soState.landsraad.choamShares) ? soState.landsraad.choamShares : 0;
  return shares >= CHOAM_DIVIDEND_SHARE_THRESHOLD ? CHOAM_DIVIDEND_MULT : 1.0;
}

/** 禁运制裁操纵杠杆（≥50% → true；只读） */
export function hasEmbargoLeverage(world) {
  const soState = world && world.spaceOperaState;
  const shares = soState && isPlainObject(soState.landsraad)
    && Number.isFinite(soState.landsraad.choamShares) ? soState.landsraad.choamShares : 0;
  return shares >= CHOAM_EMBARGO_SHARE_THRESHOLD;
}

/* ============================== b+) 兰兹拉德宪章法案（Charters）表决弧 ============================== */
// （doc42 总纲 §二.7 第二幕「擅长政治博弈的派系可在议会中支配宪章（Charters）投票」
//  实战可达整改；46 号执行卷 §Task 3.4.1 的窄化（仅 Landsraad Standing + CHOAM 股份）
//  不在允许裁决清单内 —— 本弧补齐离散法案对象 + standing 加权表决 + 通过/否决修正器。）

/** 宪章法案种类（M3 裁决三种：制裁禁运 / 财政拨款 / 议席授权） */
export const LANDSRAAD_BILL_KINDS = Object.freeze([
  'CHARTER_SANCTION',
  'CHARTER_SUBSIDY',
  'CHARTER_MANDATE',
]);

/** 提案门槛：兰兹拉德 standing ≥ 10 方可提案（议会发言权最低席位） */
export const LANDSRAAD_PROPOSE_MIN_STANDING = 10;
/** 玩家基本票权权重（standing/100 × 2.0；× choamTradeDividendMult；× 禁运杠杆 1.15） */
export const LANDSRAAD_PLAYER_VOTE_WEIGHT = 2.0;
export const LANDSRAAD_EMBARGO_VOTE_MULT = 1.15;
/** 非玩家派系基准票权（1.0）与出席赞成概率（sampleFloat01 确定性） */
export const LANDSRAAD_FACTION_BASE_WEIGHT = 1.0;
export const LANDSRAAD_FACTION_SUPPORT_P = 0.35;
/** 反对票修正器：交战中 ×1.5 / 深度交恶（opinion < −20）×1.2 */
export const LANDSRAAD_WAR_OPPOSE_MULT = 1.5;
export const LANDSRAAD_HOSTILE_OPPOSE_MULT = 1.2;
/** 渗透瘫痪阈值：间谍网 ≥ 2 层（未植双面间谍）→ 该派系席位弃权 */
export const LANDSRAAD_ABSTAIN_SPY_LAYERS = 2;
/** 法案通过效果：CHARTER_SUBSIDY 拨款 = 委任状月饷基值 × 3；CHARTER_MANDATE standing +5 */
export const LANDSRAAD_SUBSIDY_CREDITS_MULT = 3;
export const LANDSRAAD_MANDATE_STANDING_BONUS = 5;
/** CHARTER_SANCTION 通过效果：最敌对派系 opinion −10 / trust −10 / grievances +1 */
export const LANDSRAAD_SANCTION_OPINION_HIT = 10;
export const LANDSRAAD_SANCTION_TRUST_HIT = 10;
/** 法案否决反弹：standing −2（政治挫败） */
export const LANDSRAAD_VETO_STANDING_REBOUND = 2;

/** 活跃宪章法案只读查询（容器缺失返回 null，绝不 ensure） */
export function getActiveLandsraadBill(world) {
  const soState = world && world.spaceOperaState;
  const bill = soState && isPlainObject(soState.landsraad) ? soState.landsraad.activeBill : null;
  return isPlainObject(bill) ? bill : null;
}

/**
 * 提出兰兹拉德宪章法案（一次仅一项待决；业务失败抛 Error('SO:…') → 命令总线回滚）。
 *
 * @param {object} world - 世界根对象
 * @param {string} kind - 法案种类 ∈ LANDSRAAD_BILL_KINDS
 * @returns {object} 新建的法案对象（写入 soState.landsraad.activeBill）
 */
export function proposeLandsraadBill(world, kind) {
  if (!LANDSRAAD_BILL_KINDS.includes(kind)) {
    throw new Error(`SO: 未知宪章法案 ${String(kind)}（合法 ${LANDSRAAD_BILL_KINDS.join('|')}）`);
  }
  const soState = ensureS7State(world);
  if (isPlainObject(soState.landsraad.activeBill)) {
    throw new Error(`SO: 宪章法案 ${soState.landsraad.activeBill.kind} 表决中，禁止叠加提案`);
  }
  if ((Number(soState.landsraad.standing) || 0) < LANDSRAAD_PROPOSE_MIN_STANDING) {
    throw new Error(`SO: 兰兹拉德 standing 不足 ${LANDSRAAD_PROPOSE_MIN_STANDING}，无提案席位`);
  }
  if (!Number.isFinite(soState.landsraad.nextBillId)) soState.landsraad.nextBillId = 1;
  const bill = {
    id: soState.landsraad.nextBillId++,
    kind,
    proposedTick: tickOf(world),
    proposedMonth: Math.floor(tickOf(world) / TICKS_PER_MONTH),
  };
  soState.landsraad.activeBill = bill;
  emit(world, 'LandsraadBillProposed', { billId: bill.id, kind, proposedMonth: bill.proposedMonth }, 'politics');
  chronicle(world, 'politics', `兰兹拉德大议会受理宪章法案 #${bill.id}（${kind}），月末表决`, { kind });
  return bill;
}

/** 既有外交关系只读解析（绝不惰性建卡：月度表决零关系写入副作用） */
function peekRelation(world, a, b) {
  const diplomacy = world && world.relations && world.relations.diplomacy ? world.relations.diplomacy : null;
  return diplomacy ? diplomacy[relationKey(a, b)] || null : null;
}

/** 最敌对派系（opinion 最低；tie 数值键最小；无关系记录按 0 观感参与排序；无他派系 → null） */
function mostHostileFaction(world, pf) {
  const factions = world.entities && world.entities.factions ? world.entities.factions : {};
  let worst = null;
  let worstNum = Infinity;
  let worstOpinion = 1;
  for (const key of Object.keys(factions).sort()) {
    if (pf != null && (key === pf || String(key) === String(pf))) continue;
    const rel = peekRelation(world, pf, key);
    const opinion = rel && Number.isFinite(rel.opinion) ? rel.opinion : 0;
    const num = numericEntityKey(key);
    if (opinion < worstOpinion || (opinion === worstOpinion && num < worstNum)) {
      worst = key;
      worstNum = num;
      worstOpinion = opinion;
    }
  }
  return worst;
}

/**
 * 兰兹拉德宪章法案月末表决（stepGalacticSenateMonthly 消费；standing 加权表决）：
 *  - 玩家票权 = (standing/100) × 2.0 × choamTradeDividendMult ×（禁运杠杆 ≥50% → ×1.15）；
 *  - 各非玩家派系席位（键序确定性）：双面间谍 → 强制赞成；间谍网 ≥ 2 层 → 弃权；
 *    已签委任状 → 赞成；否则 sampleFloat01(ARC_S7_CRISIS, 派系键, 表决月) < 0.35 赞成；
 *  - 反对票修正器：对玩家宣战 ×1.5、深度交恶（opinion < −20）×1.2；
 *  - support > oppose → 通过并按法案种类落效果（SANCTION 制裁 / SUBSIDY 拨款 /
 *    MANDATE 授权）；否则否决（standing −2 反弹）。表决后 activeBill 清空，
 *    结果记入 soState.landsraad.lastBill。
 * 首行守卫 world.spaceOperaState；无待决法案零动作。
 *
 * @returns {{settled: boolean, passed: boolean, kind: string|null, billId: number|null,
 *            support: number, oppose: number}} 本月表决摘要
 */
export function settleLandsraadBillMonthly(world) {
  const stats = { settled: false, passed: false, kind: null, billId: null, support: 0, oppose: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const soState = world.spaceOperaState;
  const landsraad = isPlainObject(soState.landsraad) ? soState.landsraad : null;
  const bill = landsraad && isPlainObject(landsraad.activeBill) ? landsraad.activeBill : null;
  if (!bill) return stats;
  const pf = world.playerFactionId;
  const standing = Number.isFinite(landsraad.standing) ? landsraad.standing : 0;

  // —— 玩家票权（standing 加权 + CHOAM 股份杠杆）——
  let playerWeight = (standing / 100) * LANDSRAAD_PLAYER_VOTE_WEIGHT * choamTradeDividendMult(world);
  if (hasEmbargoLeverage(world)) playerWeight *= LANDSRAAD_EMBARGO_VOTE_MULT;
  let support = playerWeight;
  let oppose = 0;

  // —— 各派系席位（键序确定性；无玩家派系时按无玩家票权结算）——
  const factions = world.entities && world.entities.factions ? world.entities.factions : {};
  const voteMonth = Math.floor(tickOf(world) / TICKS_PER_MONTH);
  for (const key of Object.keys(factions).sort()) {
    const f = factions[key];
    if (!f || typeof f !== 'object') continue;
    if (pf != null && (key === pf || String(key) === String(pf))) continue;
    let supportFaction = false;
    const net = spyNetwork(world, key);
    if (net.doubleAgent) supportFaction = true; // 双面间谍：强制赞成
    else if (net.layers >= LANDSRAAD_ABSTAIN_SPY_LAYERS) continue; // 渗透瘫痪：弃权
    else if (soState.commissions && soState.commissions[key]) supportFaction = true; // 委任状派系：赞成
    if (!supportFaction) {
      const r = sampleFloat01(worldSeedOf(world), SALT, numericEntityKey(key), voteMonth);
      if (r < LANDSRAAD_FACTION_SUPPORT_P) supportFaction = true;
    }
    if (supportFaction) {
      support += LANDSRAAD_FACTION_BASE_WEIGHT;
      continue;
    }
    let mult = 1.0;
    const rel = pf != null ? peekRelation(world, pf, key) : null;
    if (rel && rel.warId) mult *= LANDSRAAD_WAR_OPPOSE_MULT;
    else if (rel && Number.isFinite(rel.opinion) && rel.opinion < -20) mult *= LANDSRAAD_HOSTILE_OPPOSE_MULT;
    oppose += LANDSRAAD_FACTION_BASE_WEIGHT * mult;
  }

  // —— 结算：通过落效果 / 否决 standing 反弹；activeBill 清空 + lastBill 记账 ——
  const passed = support > oppose;
  landsraad.activeBill = null;
  landsraad.lastBill = {
    billId: bill.id,
    kind: bill.kind,
    passed,
    support,
    oppose,
    settledTick: tickOf(world),
  };
  stats.settled = true;
  stats.passed = passed;
  stats.kind = bill.kind;
  stats.billId = bill.id;
  stats.support = support;
  stats.oppose = oppose;

  if (passed && bill.kind === 'CHARTER_MANDATE') {
    landsraad.standing = Math.max(0, Math.min(100, standing + LANDSRAAD_MANDATE_STANDING_BONUS));
  }
  if (!passed) {
    landsraad.standing = Math.max(0, Math.min(100, standing - LANDSRAAD_VETO_STANDING_REBOUND));
  }
  if (passed && bill.kind === 'CHARTER_SUBSIDY' && pf && world.economy) {
    credit(world, pf, 'credits', COMMISSION_PAY_BASE * LANDSRAAD_SUBSIDY_CREDITS_MULT,
      'landsraadSubsidy', `bill_${bill.id}`, FLOW.TRANSFER);
  }
  if (passed && bill.kind === 'CHARTER_SANCTION' && pf != null) {
    const target = mostHostileFaction(world, pf);
    if (target) {
      const rel = getRelation(world, pf, target);
      rel.opinion = Math.max(-100, (Number.isFinite(rel.opinion) ? rel.opinion : 0) - LANDSRAAD_SANCTION_OPINION_HIT);
      rel.trust = Math.max(0, (Number.isFinite(rel.trust) ? rel.trust : 0) - LANDSRAAD_SANCTION_TRUST_HIT);
      rel.grievances = (Number.isFinite(rel.grievances) ? rel.grievances : 0) + 1;
      landsraad.lastBill.sanctionTarget = target;
    }
  }
  emit(world, passed ? 'LandsraadBillPassed' : 'LandsraadBillVetoed', {
    billId: bill.id,
    kind: bill.kind,
    support,
    oppose,
    standing: landsraad.standing,
  }, 'politics');
  chronicle(world, 'politics',
    `兰兹拉德宪章法案 #${bill.id}（${bill.kind}）${passed ? '表决通过' : '遭否决'}（赞成 ${support.toFixed(2)} / 反对 ${oppose.toFixed(2)}）`,
    { billId: bill.id, kind: bill.kind });
  return stats;
}

/* ============================== c) 宫殿间谍网与刺杀 ============================== */

/**
 * 升级帝国情报中枢（Palace Espionage Wing）：精确扣 PALACE_ESPIONAGE_UPGRADE_CREDITS
 * 信用点 → 特工招募速度 ×1.5（agentRecruitMult 导出）。已升级/点数不足抛 SO。
 */
export function upgradePalaceEspionage(world) {
  const pf = playerFactionKey(world);
  const soState = ensureS7State(world);
  if (soState.palaceEspionage.upgraded) throw new Error('SO: 宫殿间谍翼已升级，禁止重复投入');
  if (!debit(world, pf, 'credits', PALACE_ESPIONAGE_UPGRADE_CREDITS, 'palaceEspionage', 's7')) {
    throw new Error(`SO: 信用点不足 ${PALACE_ESPIONAGE_UPGRADE_CREDITS}，无法升级宫殿间谍翼`);
  }
  soState.palaceEspionage.upgraded = true;
  soState.palaceEspionage.agentRecruitMult = PALACE_ESPIONAGE_RECRUIT_MULT;
  emit(world, 'PalaceEspionageUpgraded', {
    factionId: pf,
    agentRecruitMult: PALACE_ESPIONAGE_RECRUIT_MULT,
  }, 'politics');
  return soState.palaceEspionage;
}

/** 间谍网只读查询（层 0–3 + 双面间谍旗标；容器缺失返回零层默认，绝不 ensure） */
export function spyNetwork(world, targetFactionId) {
  const soState = world && world.spaceOperaState;
  const nets = soState && isPlainObject(soState.palaceEspionage)
    ? soState.palaceEspionage.spyNetworks : null;
  const net = nets ? nets[targetFactionId] : null;
  if (!net || !isPlainObject(net)) return { layers: 0, doubleAgent: false };
  return { layers: Math.max(0, Math.min(3, Number(net.layers) || 0)), doubleAgent: net.doubleAgent === true };
}

function ensureSpyNetwork(soState, targetFactionId) {
  const nets = soState.palaceEspionage.spyNetworks;
  if (!isPlainObject(nets[targetFactionId])) {
    nets[targetFactionId] = { layers: 0, doubleAgent: false };
  }
  return nets[targetFactionId];
}

/** 间谍网升层（0→3；每层扣 SPY_LAYER_UP_INTEL_COST 情报点，不足抛 SO） */
export function layerUpSpyNetwork(world, targetFactionId) {
  const key = requireFaction(world, targetFactionId);
  const pf = playerFactionKey(world);
  const soState = ensureS7State(world);
  const net = ensureSpyNetwork(soState, key);
  if (net.layers >= SPY_NETWORK_MAX_LAYERS) throw new Error('SO: 间谍网已达满层 3，禁止继续渗透');
  if (!debit(world, pf, 'intelPoints', SPY_LAYER_UP_INTEL_COST, 'spyLayerUp', key)) {
    throw new Error(`SO: 情报点不足 ${SPY_LAYER_UP_INTEL_COST}，无法升层间谍网`);
  }
  net.layers += 1;
  emit(world, 'SpyNetworkLayerUp', { targetFactionId: key, layers: net.layers }, 'politics');
  return net;
}

/** 植入双面间谍（前置满 3 层；扣 DOUBLE_AGENT_INTEL_COST 情报点） */
export function plantDoubleAgent(world, targetFactionId) {
  const key = requireFaction(world, targetFactionId);
  const pf = playerFactionKey(world);
  const soState = ensureS7State(world);
  const net = ensureSpyNetwork(soState, key);
  if (net.layers < SPY_NETWORK_MAX_LAYERS) {
    throw new Error(`SO: 植入双面间谍需要满 ${SPY_NETWORK_MAX_LAYERS} 层间谍网（实测 ${net.layers}）`);
  }
  if (net.doubleAgent) throw new Error('SO: 双面间谍已就位，禁止重复植入');
  if (!debit(world, pf, 'intelPoints', DOUBLE_AGENT_INTEL_COST, 'plantDoubleAgent', key)) {
    throw new Error(`SO: 情报点不足 ${DOUBLE_AGENT_INTEL_COST}，无法植入双面间谍`);
  }
  net.doubleAgent = true;
  emit(world, 'DoubleAgentPlanted', { targetFactionId: key }, 'politics');
  return net;
}

/** 派系首脑领袖（该派系 level 最高的 character；tie 数值键最小；无则 null） */
export function factionLeaderOf(world, factionId) {
  const chars = world && world.entities && world.entities.characters ? world.entities.characters : {};
  let leader = null;
  let leaderNum = Infinity;
  let leaderLevel = -1;
  for (const k of Object.keys(chars)) {
    const c = chars[k];
    if (!c || !(c.factionId === factionId || String(c.factionId) === String(factionId))) continue;
    const lvl = Number.isFinite(c.level) ? c.level : 1;
    const num = numericEntityKey(c.id);
    if (lvl > leaderLevel || (lvl === leaderLevel && num < leaderNum)) {
      leader = c;
      leaderLevel = lvl;
      leaderNum = num;
    }
  }
  return leader;
}

/**
 * 终极刺杀（斩首行动）：满 3 层间谍网 + 双面间谍才可执行 →
 *  1. 目标派系首脑领袖移除（removeEntity；无领袖则仅记录）；
 *  2. 关系震荡：opinion −30 / trust −20 / grievances +1（war.js getRelation 口径）；
 *  3. 间谍网络曝光焚毁（layers 归零、doubleAgent 清除）。
 * 业务失败（网络不足 / 自杀 / 派系不存在）抛 Error('SO:…') → 命令总线回滚。
 */
export function assassinate(world, targetFactionId) {
  const key = requireFaction(world, targetFactionId);
  const pf = playerFactionKey(world);
  if (key === pf) throw new Error('SO: 不可刺杀己方派系首脑');
  const net = spyNetwork(world, key);
  if (net.layers < SPY_NETWORK_MAX_LAYERS || !net.doubleAgent) {
    throw new Error('SO: 刺杀需要满 3 层间谍网并植入双面间谍');
  }
  const soState = ensureS7State(world);
  const leader = factionLeaderOf(world, key);
  if (leader) {
    removeEntity(world, 'characters', leader.id);
  }
  const rel = getRelation(world, pf, key);
  rel.opinion = Math.max(-100, (Number.isFinite(rel.opinion) ? rel.opinion : 0) - ASSASSINATE_OPINION_HIT);
  rel.trust = Math.max(0, (Number.isFinite(rel.trust) ? rel.trust : 0) - ASSASSINATE_TRUST_HIT);
  rel.grievances = (Number.isFinite(rel.grievances) ? rel.grievances : 0) + 1;
  const stored = soState.palaceEspionage.spyNetworks[key];
  stored.layers = 0; // 网络曝光焚毁
  stored.doubleAgent = false;
  emit(world, 'FactionLeaderAssassinated', {
    targetFactionId: key,
    leaderId: leader ? leader.id : null,
    opinionDelta: -ASSASSINATE_OPINION_HIT,
  }, 'politics');
  chronicle(world, 'politics', `终极刺杀成功：${String(key)} 首脑${leader ? ` ${leader.name}` : ''} 遇刺，双边关系剧烈震荡`, { targetFactionId: key });
  return { ok: true, leaderRemoved: !!leader, leaderId: leader ? leader.id : null };
}

/* ============================== d) 三大终局天灾 ============================== */

/**
 * 开启终局天灾（一次仅一场活跃，与 legacy crisis.js 的月度危机互不占用命名空间）。
 * 业务失败（未知 kind / 已有活跃天灾）抛 Error('SO:…') → 命令总线回滚。
 */
export function startEndgameCrisis(world, kind) {
  if (!ENDGAME_CRISIS_KINDS.includes(kind)) {
    throw new Error(`SO: 未知终局天灾 ${String(kind)}（合法 ${ENDGAME_CRISIS_KINDS.join('|')}）`);
  }
  const soState = ensureS7State(world);
  if (soState.endgameCrisis.active) {
    throw new Error(`SO: 终局天灾 ${soState.endgameCrisis.active.kind} 进行中，不可叠加开启`);
  }
  const startedTick = tickOf(world);
  let active;
  if (kind === 'PRETHORYN') {
    active = { kind, startedTick, infestedSystemIds: [], reinforceMonths: 0, reinforcementsSpawned: 0 };
  } else if (kind === 'UNBIDDEN') {
    active = {
      kind,
      startedTick,
      anchorsTotal: UNBIDDEN_ANCHOR_COUNT,
      anchorsRemaining: UNBIDDEN_ANCHOR_COUNT,
      unbiddenShare: 0,
      rivalFactionsSpawned: false,
      threeWayWar: false,
    };
  } else {
    active = { kind, startedTick, coresTotal: CONTINGENCY_CORE_COUNT, coresBroken: 0, firewallDeployed: false };
  }
  soState.endgameCrisis.active = active;
  if (kind === 'CONTINGENCY') soState.endgameCrisis.ghostSignalActive = true;
  emit(world, 'EndgameCrisisStarted', { kind, startedTick }, 'crisis');
  chronicle(world, 'crisis', `终局天灾降临：${{ PRETHORYN: '索林原虫', UNBIDDEN: '高维恶魔', CONTINGENCY: '肃正协议' }[kind]}`, { kind });
  return active;
}

/** 活跃天灾守卫（kind 不符 / 无活跃 → 抛 SO） */
function requireActiveCrisis(world, kind) {
  const soState = world && world.spaceOperaState;
  const active = soState && isPlainObject(soState.endgameCrisis) ? soState.endgameCrisis.active : null;
  if (!active || active.kind !== kind) throw new Error(`SO: 无活跃的 ${kind} 天灾`);
  return active;
}

/** 虫群/恶魔侵占的银河星系占比（0..1；天灾星系数 / 全银河星系数） */
export function galaxyShareOf(world, crisis) {
  const total = world && world.entities && world.entities.systems
    ? Object.keys(world.entities.systems).length : 0;
  if (total <= 0 || !crisis || !Array.isArray(crisis.infestedSystemIds)) return 0;
  return crisis.infestedSystemIds.length / total;
}

/** 援军缩放（纯函数；share ≥ 0.4 → 4、≥ 0.2 → 3、否则 2 支/年） */
export function prethorynReinforcementsPerYear(share) {
  const s = Number.isFinite(share) ? share : 0;
  for (let i = PRETHORYN_REINFORCE_SCHEDULE.length - 1; i >= 0; i--) {
    if (s >= PRETHORYN_REINFORCE_SCHEDULE[i].minShare) return PRETHORYN_REINFORCE_SCHEDULE[i].perYear;
  }
  return 2;
}

/** 感染单星：256 tiles 全铺 overlayId=5 菌毯（保留其余位段）+ meta.infested=true */
function infestPlanet(world, planet) {
  const compact = ensureCompactPlanetState(planet, world);
  for (let i = 0; i < compact.tiles.length; i++) {
    const u = unpackTile(compact.tiles[i] >>> 0);
    compact.tiles[i] = packTile({ ...u, overlayId: 5 }); // 索林虫族菌毯
  }
  compact.meta = { ...(isPlainObject(compact.meta) ? compact.meta : {}), infested: true };
  emit(world, 'PlanetInfested', { planetId: planet.id, systemId: planet.systemId }, 'crisis');
  return compact;
}

/** 索林原虫月度占领：优先殖民星系、其次荒野星系（deriveSeed 确定性选址），感染全行星 */
function infestNextSystem(world, crisis) {
  const systems = world && world.entities && world.entities.systems ? world.entities.systems : {};
  const keys = Object.keys(systems).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const infested = new Set(crisis.infestedSystemIds.map(String));
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const colonized = [];
  const wild = [];
  for (const k of keys) {
    if (infested.has(k)) continue;
    let hasColony = false;
    for (const pk of Object.keys(planets)) {
      const p = planets[pk];
      if (p && p.systemId === k && p.compactState && p.compactState.colony
        && Number(p.compactState.colony.ownerId) >= 0) {
        hasColony = true;
        break;
      }
    }
    (hasColony ? colonized : wild).push(k);
  }
  const pool = colonized.length > 0 ? colonized : wild;
  if (pool.length === 0) return null;
  const pick = pool[deriveSeed(worldSeedOf(world), SALT, tickOf(world), 81) % pool.length];
  crisis.infestedSystemIds.push(pick);
  for (const pk of Object.keys(planets).sort()) {
    const p = planets[pk];
    if (p && p.systemId === pick) infestPlanet(world, p);
  }
  emit(world, 'SystemInfested', { systemId: pick, totalInfested: crisis.infestedSystemIds.length }, 'crisis');
  return pick;
}

/**
 * 净化法则（doc46 精确契约签名 (planet, devastation)）：
 * 轨道轰炸破坏度 devastation ≥ 100 → 菌毯清除、还原可改造荒芜
 * （biome 0 / overlay 0 / meta.infested=false）；未达 100 抛 Error('SO:…')。
 * 纯行星态函数（不触 world/事件，便于战斗层直接调用）。
 *
 * @param {object} planet - 感染行星实体（含 compactState）
 * @param {number} devastation - 轨道轰炸破坏度（0–100）
 * @returns {{ok: boolean, purifiedTiles: number, devastation: number}}
 */
export function purifyInfestedWorld(planet, devastation) {
  const compact = planet && planet.compactState ? planet.compactState : null;
  if (!compact) throw new Error('SO: 净化目标行星缺少紧凑态');
  if (!isPlainObject(compact.meta) || compact.meta.infested !== true) {
    throw new Error('SO: 目标行星并非感染星球，无需净化');
  }
  const dev = Number.isFinite(devastation) ? devastation : 0;
  if (dev < 100) {
    throw new Error(`SO: 轨道轰炸破坏度未达 100%（实测 ${dev}），菌毯无法烧毁`);
  }
  let purified = 0;
  for (let i = 0; i < compact.tiles.length; i++) {
    const u = unpackTile(compact.tiles[i] >>> 0);
    if (u.overlayId === 5 || u.biomeId !== 0) purified++;
    compact.tiles[i] = packTile({ ...u, biomeId: 0, overlayId: 0 }); // 还原可改造荒芜
  }
  compact.meta = { ...compact.meta, infested: false };
  return { ok: true, purifiedTiles: purified, devastation: dev };
}

/** UNBIDDEN 传送门无敌判定（全部维度锚点拔除前恒无敌；只读） */
export function dimensionalPortalInvulnerable(world) {
  const soState = world && world.spaceOperaState;
  const active = soState && isPlainObject(soState.endgameCrisis) ? soState.endgameCrisis.active : null;
  if (!active || active.kind !== 'UNBIDDEN') return false;
  return (Number(active.anchorsRemaining) || 0) > 0;
}

/** 拔除一座维度空间锚点（全部拔除 → 传送门无敌解除事件） */
export function removeDimensionalAnchor(world) {
  const crisis = requireActiveCrisis(world, 'UNBIDDEN');
  if ((Number(crisis.anchorsRemaining) || 0) <= 0) throw new Error('SO: 维度锚点已全部拔除');
  crisis.anchorsRemaining -= 1;
  emit(world, 'DimensionalAnchorRemoved', {
    remaining: crisis.anchorsRemaining,
    total: crisis.anchorsTotal,
  }, 'crisis');
  if (crisis.anchorsRemaining === 0) {
    emit(world, 'DimensionalAnchorsCleared', { kind: 'UNBIDDEN' }, 'crisis');
    chronicle(world, 'crisis', '全部维度锚点已拔除——高维传送门无敌护盾解除', { kind: 'UNBIDDEN' });
  }
  return crisis.anchorsRemaining;
}

/** 相继生成 ABERRANT / VEHEMENT 两敌对高维派系（三方混战旗标；幂等） */
function ensureRivalDimensionalFactions(world) {
  const factions = world.entities && world.entities.factions ? world.entities.factions : {};
  if (!factions.fac_aberrant) {
    createEntity(world, 'factions', {
      id: 'fac_aberrant',
      name: '异端者',
      traitId: 'unbidden_aberrant',
      personality: 'expansionist',
      color: '#b04fe0',
      originType: 'unbidden',
      isPlayer: false,
    });
  }
  if (!factions.fac_vehement) {
    createEntity(world, 'factions', {
      id: 'fac_vehement',
      name: '狂热者',
      traitId: 'unbidden_vehement',
      personality: 'expansionist',
      color: '#e04f6a',
      originType: 'unbidden',
      isPlayer: false,
    });
  }
}

/** 幽灵信号期全银河智械产出暴跌乘子（0.6 / 恢复 1.0；集成层产出结算消费） */
export function contingencyMachineOutputMult(world) {
  const soState = world && world.spaceOperaState;
  const ec = soState && isPlainObject(soState.endgameCrisis) ? soState.endgameCrisis : null;
  if (!ec || ec.ghostSignalActive !== true) return 1.0;
  return CONTINGENCY_OUTPUT_MULT;
}

/** 阵前倒戈确定性检定（幽灵信号期 40%；同 (seed, unitId, tick) 恒定） */
export function contingencyDefectionRoll(world, unitId) {
  const soState = world && world.spaceOperaState;
  const ec = soState && isPlainObject(soState.endgameCrisis) ? soState.endgameCrisis : null;
  if (!ec || ec.ghostSignalActive !== true) return false;
  const r = sampleFloat01(worldSeedOf(world), SALT, numericEntityKey(unitId), tickOf(world));
  return r < CONTINGENCY_DEFECT_CHANCE;
}

/** 破一座机械母星核心（4 座全破 + 防火墙 → 终结） */
export function destroyContingencyCore(world) {
  const crisis = requireActiveCrisis(world, 'CONTINGENCY');
  if (crisis.coresBroken >= CONTINGENCY_CORE_COUNT) throw new Error('SO: 机械母星核心已全部击破');
  crisis.coresBroken += 1;
  emit(world, 'ContingencyCoreBroken', {
    broken: crisis.coresBroken,
    total: CONTINGENCY_CORE_COUNT,
  }, 'crisis');
  tryTerminateContingency(world, crisis);
  return crisis.coresBroken;
}

/** 部署加密防火墙（与 4 核心全破合成终结条件） */
export function deployEncryptionFirewall(world) {
  const crisis = requireActiveCrisis(world, 'CONTINGENCY');
  if (crisis.firewallDeployed) throw new Error('SO: 加密防火墙已部署');
  crisis.firewallDeployed = true;
  emit(world, 'EncryptionFirewallDeployed', { kind: 'CONTINGENCY' }, 'crisis');
  tryTerminateContingency(world, crisis);
  return true;
}

function tryTerminateContingency(world, crisis) {
  if (crisis.coresBroken < CONTINGENCY_CORE_COUNT || crisis.firewallDeployed !== true) return false;
  const ec = world.spaceOperaState.endgameCrisis;
  ec.ghostSignalActive = false;
  ec.lastResolved = { kind: 'CONTINGENCY', endedTick: tickOf(world) };
  ec.active = null;
  emit(world, 'ContingencyTerminated', { endedTick: tickOf(world) }, 'crisis');
  chronicle(world, 'crisis', '肃正协议终结：4 座机械母星核心全破，加密防火墙掐断幽灵信号', { kind: 'CONTINGENCY' });
  return true;
}

/* ============================== e) 凝聚力金库与利维坦凯旋大游行 ============================== */

/**
 * 帝国凝聚力月产出（月速率口径）：
 *  - Σ 行星 colony.telepathUnity（灵能合唱体凝聚通道，月流量语义）；
 *  - Σ 残骸栖息地 habitatYield.unityPerMonth（fleetDoctrineAndScars 永久军事凝聚力）。
 * 只读；容器缺失返回 0。
 */
export function empireUnityMonthlyOutput(world) {
  const soState = world && world.spaceOperaState;
  if (!soState) return 0;
  let out = 0;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  for (const k of Object.keys(planets)) {
    const colony = planets[k] && planets[k].compactState && planets[k].compactState.colony;
    const u = colony ? Number(colony.telepathUnity) : NaN;
    if (Number.isFinite(u) && u > 0) out += u;
  }
  const wrecks = Array.isArray(soState.wreckSites) ? soState.wreckSites : [];
  for (const w of wrecks) {
    if (w && w.converted === 'habitat' && w.habitatYield
      && Number.isFinite(w.habitatYield.unityPerMonth) && w.habitatYield.unityPerMonth > 0) {
      out += w.habitatYield.unityPerMonth;
    }
  }
  return out;
}

/** 凝聚力入账（soState.unityTreasury；显式生命周期入口，幂等 ensure） */
export function grantUnity(world, amount) {
  const soState = ensureS7State(world);
  const v = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  soState.unityTreasury += v;
  return soState.unityTreasury;
}

/** 凝聚力支出（不足返回 false；REORGANIZE 前置检定用） */
export function spendUnity(world, amount) {
  const soState = ensureS7State(world);
  const v = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  if ((Number.isFinite(soState.unityTreasury) ? soState.unityTreasury : 0) < v) return false;
  soState.unityTreasury -= v;
  return true;
}

/** 帝国凝聚力金库余额（只读；容器缺失返回 0） */
export function empireUnityBalance(world) {
  const soState = world && world.spaceOperaState;
  return soState && Number.isFinite(soState.unityTreasury) ? soState.unityTreasury : 0;
}

/** 行星解析（数字键直查 + 'plt_N' 前缀回查；与 commandsSpaceOpera 同构） */
function resolvePlanetEntity(world, planetId) {
  const bag = world && world.entities && world.entities.planets;
  if (!bag) return null;
  if (bag[planetId]) return bag[planetId];
  return bag[`plt_${planetId}`] || null;
}

/** 星系内游行目标殖民地（优先已殖民；数值键升序；无则 null） */
function pickParadePlanet(world, systemId, excludePlanetId = null) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const found = [];
  for (const k of Object.keys(planets)) {
    const p = planets[k];
    if (!p || p.systemId !== systemId) continue;
    if (excludePlanetId != null && (p.id === excludePlanetId || String(p.id) === String(excludePlanetId))) continue;
    const colonized = !!(p.compactState && p.compactState.colony && Number(p.compactState.colony.ownerId) >= 0);
    found.push({ num: numericEntityKey(p.id), p, colonized });
  }
  found.sort((a, b) => (a.colonized === b.colonized ? a.num - b.num : a.colonized ? -1 : 1));
  return found.length > 0 ? found[0].p : null;
}

/** 大游行对策即时效果：全殖民地幸福度 ×1.15（阶层 happiness 字段，clamp [0,100]） */
function applyParadeHappinessBoost(world, situation) {
  const planet = resolvePlanetEntity(world, situation.targetEntityId);
  const colony = planet && planet.compactState && planet.compactState.colony;
  if (!colony || !Array.isArray(colony.strata)) return 0;
  let touched = 0;
  for (let i = 0; i < colony.strata.length; i++) {
    const row = colony.strata[i];
    if (!Array.isArray(row) || !Number.isFinite(row[1])) continue;
    row[1] = Math.max(0, Math.min(100, row[1] * PARADE_ENCOURAGE_HAPPINESS_MULT));
    touched++;
  }
  return touched;
}

/**
 * 利维坦凯旋大游行局势（LEVIATHAN_PARADE 弧定义；import 期注册）：
 *  - ENCOURAGE：进度 +6.0/月，对策切换即时全殖民地幸福度 +15%；
 *  - SUPPRESS：进度 −4.0/月（实验室闭门研究旗标）；
 *  - progress ≥ 100（climax）→ 永久巨兽战利品地标（planet.leviathanTrophy）+
 *    凝聚奖励 min(1,000,000, unityMonthlyOutput × 120) 入 soState.unityTreasury。
 */
registerSituationArc('LEVIATHAN_PARADE', {
  progressMax: 100,
  baseMonthlyDelta: 0,
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],
  approaches: {
    ENCOURAGE: {
      monthlyDelta: PARADE_ENCOURAGE_MONTHLY,
      immediate(world, situation) {
        const touched = applyParadeHappinessBoost(world, situation);
        situation.meta.encouragedCount = (Number(situation.meta.encouragedCount) || 0) + 1;
        situation.meta.happinessMult = PARADE_ENCOURAGE_HAPPINESS_MULT;
        if (touched > 0) {
          emit(world, 'LeviathanParadeEncouraged', {
            situationId: situation.id,
            planetId: situation.targetEntityId,
            strataTouched: touched,
            happinessMult: PARADE_ENCOURAGE_HAPPINESS_MULT,
          }, 'world');
        }
      },
    },
    SUPPRESS: {
      monthlyDelta: PARADE_SUPPRESS_MONTHLY,
      immediate(world, situation) {
        situation.meta.closedStudy = true; // 转为实验室闭门研究
      },
    },
  },
  climax(world, situation, outcome) {
    if (outcome !== 'climax') {
      situation.impact = 'LEVIATHAN_PARADE:FIZZLED';
      return;
    }
    const tick = tickOf(world);
    const reward = Math.min(
      LEVIATHAN_PARADE_UNITY_CAP,
      Math.round(empireUnityMonthlyOutput(world) * 120),
    );
    const planet = resolvePlanetEntity(world, situation.targetEntityId);
    if (planet) {
      // 永久巨兽战利品地标（行星级永久修正）
      planet.leviathanTrophy = { sinceTick: tick, unityReward: reward, situationId: situation.id };
      const compact = planet.compactState;
      if (compact) {
        appendHistory(
          compact,
          tick,
          HISTORY_EVENT_CODES.EPOCH_LEGACY,
          compact.colony ? compact.colony.ownerId : -1,
          reward % 100000, // impactCode 槽位记录奖励尾数（历史环语义）
        );
      }
    }
    grantUnity(world, reward);
    situation.impact = `LEVIATHAN_PARADE:COMPLETED_REWARD_${reward}`;
    emit(world, 'LeviathanParadeCompleted', {
      situationId: situation.id,
      planetId: situation.targetEntityId,
      unityReward: reward,
      capped: reward >= LEVIATHAN_PARADE_UNITY_CAP,
    }, 'world');
    chronicle(world, 'world', '利维坦凯旋大游行落幕：巨兽战利品地标永久落成，凝聚力奖励入账', {
      situationId: situation.id,
    });
  },
});

/**
 * 巨兽击杀回调（doc46 §Task 3.4 §3）：在目标星系选定核心殖民地开启三阶段
 * 「利维坦凯旋大游行」局势。守卫式读取：world.spaceOperaState 缺失（金快照世界）
 * 返回 null —— 绝不 ensure 容器（零漂移铁律）。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} systemId - 巨兽击杀星系 ID
 * @returns {object|null} 新建（或幂等复用）的 LEVIATHAN_PARADE 局势
 */
export function onLeviathanDefeated(world, systemId) {
  if (!world || !world.spaceOperaState) return null;
  const existing = listActiveSituations(world).find((s) => s.systemArcId === 'LEVIATHAN_PARADE'
    && s.resolvedTick == null && s.meta && s.meta.systemId === systemId);
  if (existing) return existing; // 幂等：同星系已有游行不重复开启
  const planet = pickParadePlanet(world, systemId);
  if (!planet) return null;
  const sit = spawnSituation(world, {
    arcId: 'LEVIATHAN_PARADE',
    targetEntityId: planet.id,
    progress: 0,
    monthlyDelta: 0,
    meta: { systemId },
  });
  emit(world, 'LeviathanParadeStarted', {
    situationId: sit.id,
    systemId,
    planetId: planet.id,
  }, 'world');
  return sit;
}

// —— import 副作用：钩到 planetaryThreat.reportLeviathanDefeated 的事件路径 ——
//    （reportLeviathanDefeated emit 'LeviathanDefeated' {planetId, loot}；
//     WorldSimulation 每 tick drain→dispatch 分发；金快照世界首行守卫零动作）
on('LeviathanDefeated', (world, ev) => {
  if (!world || !world.spaceOperaState) return;
  const planetId = ev && ev.payload ? ev.payload.planetId : null;
  const planet = planetId != null && world.entities && world.entities.planets
    ? world.entities.planets[planetId] : null;
  if (!planet) return;
  onLeviathanDefeated(world, planet.systemId);
});

/**
 * 大游行对策处置（ManageLeviathanParade 命令领域落点；M3 编排层注入 handler）：
 *  - ENCOURAGE / SUPPRESS：switchSituationApproach（720 tick 冷却由引擎统一约束）；
 *  - REORGANIZE：精确扣 PARADE_REORGANIZE_UNITY_COST(1000) 凝聚力迁址（不足 throw）；
 *    目标缺省按「数值键最小的另一颗已殖民行星」确定性选取（命令 params 可透传
 *    targetPlanetId 覆盖 —— commandSchemas 宽松透传契约）。
 */
export function manageLeviathanParade(world, situationId, action, targetPlanetId = null) {
  const sit = getSituation(world, situationId);
  if (!sit || sit.resolvedTick != null || sit.systemArcId !== 'LEVIATHAN_PARADE') {
    throw new Error(`SO: 利维坦大游行局势不存在或已收束 ${String(situationId)}`);
  }
  if (action === 'ENCOURAGE' || action === 'SUPPRESS') {
    return switchSituationApproach(world, sit.id, action);
  }
  if (action === 'REORGANIZE') {
    ensureS7State(world);
    // —— 先解析迁址目标（消费前校验，杜绝直调路径的部分扣账）——
    let target = null;
    if (targetPlanetId != null) {
      const p = resolvePlanetEntity(world, targetPlanetId);
      if (!p) throw new Error(`SO: 迁址目标行星不存在 ${String(targetPlanetId)}`);
      target = p;
    } else {
      // 缺省迁址：全银河「数值键最小的另一颗已殖民行星」（确定性；不含当前目标）
      const planets = world.entities && world.entities.planets ? world.entities.planets : {};
      const found = [];
      for (const k of Object.keys(planets)) {
        const p = planets[k];
        if (!p || !p.compactState || !p.compactState.colony || Number(p.compactState.colony.ownerId) < 0) continue;
        if (p.id === sit.targetEntityId || String(p.id) === String(sit.targetEntityId)) continue;
        found.push({ num: numericEntityKey(p.id), p });
      }
      found.sort((a, b) => a.num - b.num);
      target = found.length > 0 ? found[0].p : null;
    }
    if (!target) throw new Error('SO: 无可迁址的目标殖民地');
    if (target.id === sit.targetEntityId || String(target.id) === String(sit.targetEntityId)) {
      throw new Error('SO: 迁址目标与当前巡游殖民地相同');
    }
    if (!spendUnity(world, PARADE_REORGANIZE_UNITY_COST)) {
      throw new Error(`SO: 凝聚力不足 ${PARADE_REORGANIZE_UNITY_COST}，无法重新规划巡游星区`);
    }
    const from = sit.targetEntityId;
    sit.targetEntityId = target.id;
    sit.meta.reorganizedCount = (Number(sit.meta.reorganizedCount) || 0) + 1;
    emit(world, 'LeviathanParadeReorganized', {
      situationId: sit.id,
      fromPlanetId: from,
      toPlanetId: target.id,
      unityCost: PARADE_REORGANIZE_UNITY_COST,
    }, 'world');
    return sit;
  }
  throw new Error(`SO: 非法大游行动作 ${String(action)}（合法 ENCOURAGE | SUPPRESS | REORGANIZE）`);
}

/* ============================== 月度钩子（registerSituationMonthlyHook → setClockHooks） ============================== */

/** 已殖民星系占比（任一行星 colony.ownerId ≥ 0 的星系数 / 全银河星系数；0..1，纯读） */
export function colonizedSystemShare(world) {
  const systems = world && world.entities && world.entities.systems ? world.entities.systems : {};
  const total = Object.keys(systems).length;
  if (total <= 0) return 0;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const colonized = new Set();
  for (const k of Object.keys(planets)) {
    const p = planets[k];
    const c = p && p.compactState && p.compactState.colony;
    if (c && Number(c.ownerId) >= 0) colonized.add(String(p.systemId));
  }
  return colonized.size / total;
}

/**
 * 终局天灾有机触发检定（42 号总纲 §二.7 第三幕「多维终局天灾」实战可达性整改）：
 *  - 前置：无活跃天灾；游戏后期（month ≥ ENDGAME_CRISIS_MIN_MONTH）；
 *    星系占比条件（colonizedSystemShare ≥ ENDGAME_CRISIS_MIN_COLONIZED_SHARE）；
 *    上次天灾终结后冷却 ENDGAME_CRISIS_COOLDOWN_MONTHS 个月期满；
 *  - 达标后逐月确定性检定（sampleFloat01(ARC_S7_CRISIS, 0xECE5, month) < 0.08），
 *    天灾种类按月键 deriveSeed 轮转（PRETHORYN → UNBIDDEN → CONTINGENCY），
 *    经 startEndgameCrisis 权威业务入口开启（事件 + 纪年由其统一落账）。
 * 首行守卫 world.spaceOperaState（金快照世界零读取零写入）；容器形态非法零动作。
 *
 * @returns {{eligible: boolean, rolled: boolean, triggered: boolean, kind: string|null,
 *            month: number, colonizedShare: number}} 本月检定摘要
 */
export function stepEndgameCrisisOrganicTrigger(world) {
  const stats = { eligible: false, rolled: false, triggered: false, kind: null, month: 0, colonizedShare: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const ec = world.spaceOperaState.endgameCrisis;
  if (!isPlainObject(ec) || ec.active) return stats; // 一次仅一场活跃天灾
  const month = Math.floor(tickOf(world) / TICKS_PER_MONTH);
  stats.month = month;
  if (month < ENDGAME_CRISIS_MIN_MONTH) return stats;
  if (isPlainObject(ec.lastResolved) && Number.isFinite(ec.lastResolved.endedTick)
    && month - Math.floor(ec.lastResolved.endedTick / TICKS_PER_MONTH) < ENDGAME_CRISIS_COOLDOWN_MONTHS) {
    return stats; // 终结冷却期内不再有机爆发
  }
  const share = colonizedSystemShare(world);
  stats.colonizedShare = share;
  if (share < ENDGAME_CRISIS_MIN_COLONIZED_SHARE) return stats;
  stats.eligible = true;
  const roll = sampleFloat01(worldSeedOf(world), SALT, 0xece5, month);
  stats.rolled = true;
  if (roll >= ENDGAME_CRISIS_MONTHLY_CHANCE) return stats;
  const kind = ENDGAME_CRISIS_KINDS[deriveSeed(worldSeedOf(world), SALT, month, 0xec15) % ENDGAME_CRISIS_KINDS.length];
  startEndgameCrisis(world, kind);
  stats.triggered = true;
  stats.kind = kind;
  return stats;
}

/**
 * S7 议会月度收口：委任状月饷入账 + 兰兹拉德宪章法案表决 + 帝国凝聚力金库月度累积
 * + 终局天灾有机触发检定。
 * 首行守卫 world.spaceOperaState（金快照世界零读取零写入）。
 *
 * @returns {{commissionsPaid: number, creditsPaid: number, unityAccrued: number,
 *            billSettled: boolean, billPassed: boolean, crisisTriggered: boolean,
 *            crisisKind: string|null}}
 */
export function stepGalacticSenateMonthly(world) {
  const stats = {
    commissionsPaid: 0, creditsPaid: 0, unityAccrued: 0,
    billSettled: false, billPassed: false,
    crisisTriggered: false, crisisKind: null,
  };
  if (!world || !world.spaceOperaState) return stats;
  ensureS7State(world);
  const soState = world.spaceOperaState;
  const pf = world.playerFactionId;
  if (pf && world.economy) {
    const pay = commissionMonthlyPay(world);
    for (const key of Object.keys(soState.commissions).sort()) {
      credit(world, pf, 'credits', pay, 'commissionPay', key, FLOW.TRANSFER);
      soState.commissions[key].totalPaid = (Number(soState.commissions[key].totalPaid) || 0) + pay;
      stats.commissionsPaid++;
      stats.creditsPaid += pay;
    }
    if (stats.commissionsPaid > 0) {
      emit(world, 'CommissionSalaryPaid', {
        factionId: pf,
        commissions: stats.commissionsPaid,
        credits: stats.creditsPaid,
      }, 'diplomacy');
    }
  }
  const monthly = empireUnityMonthlyOutput(world);
  if (monthly > 0) {
    soState.unityTreasury = (Number.isFinite(soState.unityTreasury) ? soState.unityTreasury : 0) + monthly;
    stats.unityAccrued = monthly;
  }
  // —— 兰兹拉德宪章法案月末表决（42 号 §二.7 第二幕「支配宪章投票」实战可达路径）——
  const bill = settleLandsraadBillMonthly(world);
  stats.billSettled = bill.settled;
  stats.billPassed = bill.passed;
  // —— 终局天灾有机触发检定（42 号总纲 §二.7 第三幕实战可达路径；无活跃天灾时逐月检定）——
  const crisis = stepEndgameCrisisOrganicTrigger(world);
  stats.crisisTriggered = crisis.triggered;
  stats.crisisKind = crisis.kind;
  return stats;
}

/**
 * 三大终局天灾月度确定性推进：
 *  - PRETHORYN：月占 1 星系（感染全行星）+ 援军累积（galaxyShareOf → 2/3/4 支每年折月）；
 *  - UNBIDDEN：侵占度月增 → 15% 引入 ABERRANT/VEHEMENT 三方混战；
 *  - CONTINGENCY：幽灵信号持续（产出乘子 0.6 / 40% 倒戈为消费接口），终结由
 *    破核 + 防火墙玩家动作驱动（本钩子零写入）。
 * 首行守卫 world.spaceOperaState；无活跃天灾零动作。
 */
export function stepEndgameCrisisMonthly(world) {
  const stats = { advanced: false, kind: null, share: 0, perYear: 0, infested: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const ec = world.spaceOperaState.endgameCrisis;
  if (!isPlainObject(ec) || !ec.active) return stats;
  const crisis = ec.active;
  stats.kind = crisis.kind;

  if (crisis.kind === 'PRETHORYN') {
    infestNextSystem(world, crisis);
    const share = galaxyShareOf(world, crisis);
    const perYear = prethorynReinforcementsPerYear(share);
    // —— 精确整数累积（杜绝 4/12 浮点累加 12 个月只补出 3 支的 IEEE-754 漂移）：
    //    应到援军数 due = floor(已过月数 × 当档每年支数 / 12)，逐月补齐差额 ——
    crisis.reinforceMonths = (Number.isFinite(crisis.reinforceMonths) ? crisis.reinforceMonths : 0) + 1;
    const due = Math.floor((crisis.reinforceMonths * perYear) / 12);
    while ((Number(crisis.reinforcementsSpawned) || 0) < due) {
      crisis.reinforcementsSpawned = (Number(crisis.reinforcementsSpawned) || 0) + 1;
      emit(world, 'PrethorynSwarmReinforced', {
        spawned: crisis.reinforcementsSpawned,
        due,
        perYear,
        share,
      }, 'crisis');
    }
    stats.advanced = true;
    stats.share = share;
    stats.perYear = perYear;
    stats.infested = crisis.infestedSystemIds.length;
  } else if (crisis.kind === 'UNBIDDEN') {
    crisis.unbiddenShare = Math.min(1, (Number.isFinite(crisis.unbiddenShare) ? crisis.unbiddenShare : 0)
      + UNBIDDEN_SHARE_GROWTH_PER_MONTH);
    if (!crisis.rivalFactionsSpawned && crisis.unbiddenShare >= UNBIDDEN_RIVAL_SHARE_THRESHOLD) {
      ensureRivalDimensionalFactions(world);
      crisis.rivalFactionsSpawned = true;
      crisis.threeWayWar = true;
      emit(world, 'RivalDimensionalFactionsArrived', {
        share: crisis.unbiddenShare,
        rivals: ['fac_aberrant', 'fac_vehement'],
        threeWayWar: true,
      }, 'crisis');
      chronicle(world, 'crisis', '高维恶魔侵占达 15%：异端者与狂热者相继撕开维度，三方混战开幕', { kind: 'UNBIDDEN' });
    }
    stats.advanced = true;
    stats.share = crisis.unbiddenShare;
  } else if (crisis.kind === 'CONTINGENCY') {
    stats.advanced = true; // 幽灵信号持续；终结由 destroyContingencyCore + deployEncryptionFirewall 驱动
  }
  return stats;
}

// —— import 副作用：两大月度钩子登记（经 situationEngine → setClockHooks 动态注入
//    SpaceOperaClock，月末 tick%720===0 触发；任务书第 5 条接线契约）——
registerSituationMonthlyHook(stepGalacticSenateMonthly);
registerSituationMonthlyHook(stepEndgameCrisisMonthly);
