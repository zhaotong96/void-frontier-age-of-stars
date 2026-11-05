/**
 * domain/diplomacy/war.js — 战争状态机、条约计时与关系维护（任务书 5.1 / 5.4）
 *
 * 当前版本：条约到期处理、战争疲劳累积、关系维度自然回归。
 * 宣战/和谈/占领逻辑随阶段09扩展（均通过命令总线）。
 */

import { emit } from '../../core/eventBus.js';
import { relationKey } from '../../core/ids.js';
import { RNG } from '../../core/rng.js';

// ———— 战争终局：占领积分 / 和谈 / 割地吞并（doc5 TD2 / DIP-02） ————

/** 占领吞并积分阈值：占领 1 个星系（30 分）即可在战争结束时主张割地 */
export const OCCUPATION_ANNEX_THRESHOLD = 30;
const OCCUPIED_SYSTEM_SCORE = 30;

/**
 * 战争积分（确定性）：占领星系 × 30 + 敌方战争疲劳 × 0.5。
 * 和谈接受概率与占领吞并阈值共用此口径。
 */
export function warScore(war, factionId) {
  const enemy = war.attackers.includes(factionId) ? war.defenders : war.attackers;
  let occupied = 0;
  for (const sid of Object.keys(war.occupiedSystems || {})) {
    if (war.occupiedSystems[sid] === factionId) occupied += 1;
  }
  let enemyExhaust = 0;
  for (const fid of enemy) enemyExhaust += war.exhaustion[fid] || 0;
  return occupied * OCCUPIED_SYSTEM_SCORE + enemyExhaust * 0.5;
}

/** 标记星系被某交战方实际占领（战场结算系统调用；不转移主权） */
export function markSystemOccupied(world, warId, systemId, occupantFactionId) {
  const war = world.entities.wars[warId];
  if (!war || war.status !== 'active') return false;
  if (!war.attackers.includes(occupantFactionId) && !war.defenders.includes(occupantFactionId)) return false;
  const sys = world.entities.systems[systemId];
  if (!sys) return false;
  war.occupiedSystems[systemId] = occupantFactionId;
  emit(world, 'SystemOccupied', { warId, systemId, occupantFactionId }, 'diplomacy');
  return true;
}

/**
 * 和谈提案（ProposePeace 执行体）：
 * 接受概率 = 0.30 + 敌方战争疲劳/200 + 敌方对我方占领积分/120，钳制 [0.05, 0.95]。
 * 接受 → 战争结束（occupied 星系按占领积分阈值决定割留，见 endWarPeace）；
 * 拒绝 → 记入 war.peaceOffers 并轻微恶化关系（确定性 RNG）。
 */
export function resolvePeaceProposal(world, proposerId, warId, terms = 'whitePeace') {
  const war = world.entities.wars[warId];
  if (!war || war.status !== 'active') return { ok: false, reason: '战争不存在或已结束' };
  if (!war.attackers.includes(proposerId) && !war.defenders.includes(proposerId)) {
    return { ok: false, reason: '非交战方' };
  }
  const enemy = war.attackers.includes(proposerId) ? war.defenders : war.attackers;
  const enemyId = enemy[0];
  let enemyExhaust = 0;
  for (const fid of enemy) enemyExhaust += war.exhaustion[fid] || 0;
  const p = Math.max(0.05, Math.min(0.95,
    0.30 + enemyExhaust / 200 + warScore(war, proposerId) / 120));
  const accepted = RNG.chance(world, p);
  war.peaceOffers.push({ tick: world.tick, from: proposerId, terms, accepted });
  if (!accepted) {
    const rel = getRelation(world, proposerId, enemyId);
    rel.opinion = Math.max(-100, rel.opinion - 2);
    emit(world, 'PeaceRejected', { warId, from: proposerId, terms }, 'diplomacy');
    return { ok: true, accepted: false, p };
  }
  endWarPeace(world, war, { peaceTerms: terms, initiator: proposerId });
  return { ok: true, accepted: true, p };
}

/**
 * 和平终局：占领星系按 warScore 阈值割留给占领方，其余回到原主权；
 * 解除双方 warId 关联并发出 WarEnded 事件。
 */
export function endWarPeace(world, war, opts = {}) {
  war.status = 'ended';
  war.endedTick = world.tick;
  war.peaceTerms = opts.peaceTerms || 'whitePeace';

  // 占领星系结算：占领方积分达阈值 → 主权转移（割地）；否则占领解除
  for (const sid of Object.keys(war.occupiedSystems)) {
    const occupant = war.occupiedSystems[sid];
    const sys = world.entities.systems[sid];
    if (!sys) continue;
    if (warScore(war, occupant) >= OCCUPATION_ANNEX_THRESHOLD) {
      const prevOwner = sys.ownerFactionId || null;
      sys.ownerFactionId = occupant;
      war.annexedSystems ||= [];
      if (!war.annexedSystems.includes(sid)) war.annexedSystems.push(sid);
      emit(world, 'SystemAnnexed', { warId: war.id, systemId: sid, from: prevOwner, to: occupant }, 'diplomacy');
    }
    delete war.occupiedSystems[sid];
  }

  const parties = [...war.attackers, ...war.defenders];
  for (const fid of parties) {
    for (const other of parties) {
      if (fid === other) continue;
      const rel = world.relations.diplomacy[relationKey(fid, other)];
      if (rel && rel.warId === war.id) rel.warId = null;
    }
  }
  emit(world, 'WarEnded', {
    warId: war.id,
    peaceTerms: war.peaceTerms,
    initiator: opts.initiator || null,
    attackers: war.attackers,
    defenders: war.defenders,
  }, 'diplomacy');
}

/**
 * 割地吞并（AnnexOccupied 执行体）：交战方对已实际占领且积分达阈值的星系
 * 立即完成主权转移（战争进行中即可割地；战争结束时 endWarPeace 自动结算剩余占领）。
 */
export function annexOccupiedSystem(world, warId, systemId, actorId) {
  const war = world.entities.wars[warId];
  if (!war) return { ok: false, reason: '战争不存在' };
  if (!war.attackers.includes(actorId) && !war.defenders.includes(actorId)) {
    return { ok: false, reason: '非交战方' };
  }
  if (war.occupiedSystems[systemId] !== actorId) {
    return { ok: false, reason: '该星系未被己方实际占领' };
  }
  if (warScore(war, actorId) < OCCUPATION_ANNEX_THRESHOLD) {
    return { ok: false, reason: '占领积分不足，无法割地' };
  }
  const sys = world.entities.systems[systemId];
  if (!sys) return { ok: false, reason: '星系不存在' };
  const prevOwner = sys.ownerFactionId || null;
  sys.ownerFactionId = actorId;
  delete war.occupiedSystems[systemId];
  war.annexedSystems ||= [];
  if (!war.annexedSystems.includes(systemId)) war.annexedSystems.push(systemId);
  emit(world, 'SystemAnnexed', { warId, systemId, from: prevOwner, to: actorId }, 'diplomacy');
  return { ok: true };
}

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
