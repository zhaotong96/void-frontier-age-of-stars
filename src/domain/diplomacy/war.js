/**
 * domain/diplomacy/war.js — 战争状态机、条约计时与关系维护（任务书 5.1 / 5.4）
 *
 * 当前版本：条约到期处理、战争疲劳累积、关系维度自然回归。
 * 宣战/和谈/占领逻辑随阶段09扩展（均通过命令总线）。
 */

import { emit } from '../../core/eventBus.js';
import { relationKey } from '../../core/ids.js';

/** 每小时计时器：条约到期、战争状态推进 */
export function runDiplomacyTimers(world) {
  const E = world.entities;

  // 条约到期
  for (const tid of Object.keys(E.treaties).sort()) {
    const treaty = E.treaties[tid];
    if (treaty.status === 'active' && typeof treaty.expiryTick === 'number' && world.tick >= treaty.expiryTick) {
      treaty.status = 'expired';
      emit(world, 'TreatyExpired', { treatyId: tid, type: treaty.type, parties: treaty.parties }, 'diplomacy');
      onTreatyEnd(world, treaty, 'expired');
    }
  }

  // 战争疲劳（每小时微量累积，战斗损失在战斗结算中额外累加）
  for (const wid of Object.keys(E.wars).sort()) {
    const war = E.wars[wid];
    if (war.status !== 'active') continue;
    for (const fid of [...war.attackers, ...war.defenders]) {
      war.exhaustion[fid] = Math.min(100, (war.exhaustion[fid] || 0) + 0.005);
    }
  }
}

/** 条约结束时的关系反馈（DIP-02 违约/到期差异） */
export function onTreatyEnd(world, treaty, reason) {
  const [a, b] = treaty.parties;
  const rel = getRelation(world, a, b);
  if (reason === 'breached') {
    rel.trust = Math.max(0, rel.trust - 18);
    rel.opinion = Math.max(-100, rel.opinion - 15);
    rel.grievances += 1;
  } else if (reason === 'expired') {
    rel.trust = Math.max(0, rel.trust - 2);
  }
}

/** 取得（或惰性创建）两阵营多维关系记录 */
export function getRelation(world, a, b) {
  if (a === b) throw new Error('关系不能指向自身');
  const key = relationKey(a, b);
  let rel = world.relations.diplomacy[key];
  if (!rel) {
    rel = {
      key,
      parties: [a, b].sort(),
      contactState: 'none', // none|signal|analyzing|contacted
      firstContactTick: null,
      opinion: 0,
      trust: 10,
      threat: 0,
      borderTension: 0,
      tradeInterdependence: 0,
      grievances: 0,
      warWeariness: 0,
      intelConfidence: 0.2,
      treaties: [],
    };
    world.relations.diplomacy[key] = rel;
  }
  return rel;
}

/** 宣战（由 DeclareWar 命令调用；校验在命令层） */
export function declareWar(world, attackerId, defenderId, wargoals) {
  const rel = getRelation(world, attackerId, defenderId);
  if (rel.warId && world.entities.wars[rel.warId]?.status === 'active') {
    return null; // 已在战争中
  }
  rel.borderTension = Math.min(100, rel.borderTension + 40);
  rel.opinion = Math.max(-100, rel.opinion - 30);

  // 解除双方条约
  for (const tid of rel.treaties.slice()) {
    const t = world.entities.treaties[tid];
    if (t && t.status === 'active') {
      t.status = 'breached';
      onTreatyEnd(world, t, 'breached');
      emit(world, 'TreatyBreached', { treatyId: tid, reason: 'war' }, 'diplomacy');
    }
  }
  rel.treaties = [];

  const war = {
    id: `war_${++world.seq}`,
    type: 'war',
    createdAtTick: world.tick,
    attackers: [attackerId],
    defenders: [defenderId],
    startTick: world.tick,
    wargoals: wargoals || [],
    occupiedSystems: {},
    exhaustion: {},
    battles: 0,
    status: 'active',
    peaceOffers: [],
  };
  world.entities.wars[war.id] = war;
  rel.warId = war.id;
  emit(world, 'WarDeclared', { warId: war.id, attackerId, defenderId, wargoals: war.wargoals }, 'diplomacy');
  return war;
}

/** 缔结条约（OfferTreaty 被接受后调用） */
export function createTreaty(world, a, b, type, durationDays = 360) {
  const rel = getRelation(world, a, b);
  const treaty = {
    id: `try_${++world.seq}`,
    type: 'treaty',
    createdAtTick: world.tick,
    kind: type, // nonaggression|trade|research|openBorders|mutualDefense
    parties: [a, b].sort(),
    startTick: world.tick,
    expiryTick: world.tick + durationDays * 24,
    status: 'active',
    terms: TREATY_TERMS[type] || {},
  };
  world.entities.treaties[treaty.id] = treaty;
  rel.treaties.push(treaty.id);
  rel.trust = Math.min(100, rel.trust + 6);
  emit(world, 'TreatySigned', { treatyId: treaty.id, kind: type, parties: treaty.parties }, 'diplomacy');
  return treaty;
}

export const TREATY_TERMS = {
  nonaggression: { desc: '互不侵犯', tensionDecayMult: 2.0 },
  trade: { desc: '贸易协定', tradeCapacityMult: 1.15, trustPerMonth: 1 },
  research: { desc: '科研交流', researchOutputMult: 1.05 },
  openBorders: { desc: '开放边境', fleetPass: true },
  mutualDefense: { desc: '共同防御', joinWars: true },
};

/** 条约接受效用（AI 判定与 UI 预估共用，DIP-01） */
export function treatyAcceptanceScore(world, proposerId, targetId, type) {
  const rel = getRelation(world, proposerId, targetId);
  let score = 0;
  score += (rel.opinion || 0) * 0.4;
  score += (rel.trust || 0) * 0.5;
  score -= (rel.threat || 0) * 0.3;
  score -= (rel.borderTension || 0) * 0.2;
  if (type === 'trade') score += (rel.tradeInterdependence || 0) * 0.5 + 15;
  if (type === 'nonaggression') score += 10;
  if (type === 'mutualDefense') score -= 10;
  const fac = world.entities.factions[targetId];
  if (fac?.personality === 'trader' && type === 'trade') score += 20;
  if (fac?.personality === 'defensive' && type === 'nonaggression') score += 15;
  if (fac?.personality === 'expansionist') score -= 8;
  return Math.round(score);
}
