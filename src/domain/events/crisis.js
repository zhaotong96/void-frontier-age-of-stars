/**
 * domain/events/crisis.js — 银河级危机（任务书 5.10 / CRISIS-01）
 *
 * 两套首发危机：机偶狂潮（失控自治机械群）与弦裂风暴（空间结构失稳）。
 * 阶段机：休眠 → 预兆 → 爆发 → 扩张 → 应对 → 终结；阶段转换由可检查
 * 条件驱动；进度可累积可消减；玩家缺席时 AI 仍自动应对（月度）。
 */

import { registerMonthly } from '../../simulation/TickPipeline.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { createEntity } from '../entities/registry.js';
import { RNG } from '../../core/rng.js';
import { balance, debit, credit } from '../economy/ledger.js';
import { createFleet } from '../fleets/fleet.js';
import { difficultyParam } from '../factions/modifiers.js';

export const CRISIS_DEFS = [
  {
    id: 'crisis_automata',
    nameZh: '机偶狂潮',
    descZh: '沉睡数个纪元的工业自治体突然重启，把一切有机文明视为「干扰源」。',
    omenFlags: ['crisis_automata'],          // 异常调查 storyTag 可提前点亮预兆
    startYear: 5,
    progressPerMonth: 3.2,
    suppressionPerContribution: 0.9,
    outbreakThreshold: 40,
    catastropheThreshold: 100,
    containedThreshold: -40,                 // 压制到负值 → 封锁成功
  },
  {
    id: 'crisis_rift',
    nameZh: '弦裂风暴',
    descZh: '空间结构在弦锚点阵列激活后开始连锁失稳，航道逐一崩解。',
    omenFlags: ['chord_anchors_known', 'chord_anchors_sold'],
    startYear: 6,
    progressPerMonth: 2.8,
    suppressionPerContribution: 1.1,
    outbreakThreshold: 45,
    catastropheThreshold: 100,
    containedThreshold: -40,
  },
];

/** 注册月度危机推进（由 MonthlySystems 在正确顺序显式调用） */
export function registerCrisis() {
  registerMonthly('crisis', crisisMonthly);
}

function crisisMonthly(world) {
  if (world.victory.ended && !world.narrative.flags.sandbox_continue) return;
  const year = Math.floor(world.tick / 8640) + 1;
  const speed = difficultyParam(world, 'crisisSpeedMult');

  // 触发检查（一次只有一场活动危机）
  const active = Object.values(world.entities.crises).find((c) => c.status === 'active');
  if (!active) {
    for (const def of CRISIS_DEFS) {
      if (world.narrative.firedCrisis?.[def.id]) continue;
      const omen = def.omenFlags.some((f) => world.narrative.flags[f]);
      if (year >= def.startYear && (omen || year >= def.startYear + 3)) {
        startCrisis(world, def);
        break;
      }
    }
    return;
  }

  // 阶段推进
  const def = CRISIS_DEFS.find((d) => d.id === active.kind);
  if (!def) return;
  const aiSuppression = aiSuppressCrisis(world, active, def);

  if (active.status === 'active') {
    active.progress += def.progressPerMonth * speed - aiSuppression;
    if (active.progress >= def.outbreakThreshold && active.phase === 'omens') {
      setPhase(world, active, 'outbreak');
    }
    if (active.phase === 'outbreak' || active.phase === 'expansion') {
      active.progress += def.progressPerMonth * 0.4 * speed;
      crisisCombatPressure(world, active);
      if (active.progress >= 70 && active.phase === 'outbreak') setPhase(world, active, 'expansion');
    }
    if (active.progress >= def.catastropheThreshold) {
      endCrisis(world, active, 'catastrophe');
    } else if (active.progress <= def.containedThreshold) {
      endCrisis(world, active, 'contained');
    }
  }
}

function startCrisis(world, def) {
  world.narrative.firedCrisis ||= {};
  world.narrative.firedCrisis[def.id] = world.tick;
  const crisis = createEntity(world, 'crises', {
    kind: def.id,
    nameZh: def.nameZh,
    descZh: def.descZh,
    phase: 'omens',
    progress: 0,
    status: 'active',
    startedTick: world.tick,
    contributed: {},
    threatSystemIds: pickThreatSystems(world, 5),
  });
  emit(world, 'CrisisOmens', { crisisId: crisis.id, kind: def.id }, 'crisis');
  chronicle(world, 'crisis', `预兆：${def.nameZh}的迹象开始出现`, { crisisId: crisis.id });
  return crisis;
}

function pickThreatSystems(world, n) {
  const owned = Object.values(world.entities.systems).filter((s) => s.ownerFactionId);
  const picks = [];
  const pool = [...owned];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = RNG.int(world, pool.length);
    picks.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picks;
}

function setPhase(world, crisis, phase) {
  crisis.phase = phase;
  emit(world, 'CrisisPhase', { crisisId: crisis.id, phase }, 'crisis');
  chronicle(world, 'crisis', `${crisis.nameZh}进入${phaseName(phase)}阶段`, { crisisId: crisis.id });
}

function phaseName(p) {
  return { omens: '预兆', outbreak: '爆发', expansion: '扩张', response: '应对', resolved: '终结' }[p] || p;
}

/** 危机军事压力：爆发/扩张阶段生成敌对自治舰队 */
function crisisCombatPressure(world, crisis) {
  if (crisis.kind !== 'crisis_automata') return;
  // 每月最多 1 支，且场上自治舰队 < 4
  const existing = Object.values(world.entities.fleets).filter((f) => f.isCrisisFleet).length;
  if (existing >= 4) return;
  const systemId = crisis.threatSystemIds[RNG.int(world, crisis.threatSystemIds.length)];
  if (!systemId) return;
  const fleet = createFleet(world, {
    factionId: crisis.factionId || (crisis.factionId = createCrisisFaction(world)),
    systemId,
    name: '失控自治集群',
    role: 'combat',
    stance: 'aggressive',
    ships: [
      { hullId: 'hull_destroyer', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster', 'mod_armor_composite'], name: '收割体' },
      { hullId: 'hull_frigate', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], name: '蜂群单元' },
    ],
  });
  fleet.isCrisisFleet = true;
  // 对所有正式文明敌对
  for (const fid of Object.keys(world.entities.factions)) {
    const rel = world.relations.diplomacy[fid < 'fac_crisis' ? `${fid}|fac_crisis` : `fac_crisis|${fid}`];
    if (rel) rel.warId = crisis.warId || (crisis.warId = `war_${++world.seq}`), rel.warId = crisis.warId;
  }
  world.entities.wars[crisis.warId] ||= {
    id: crisis.warId,
    type: 'war',
    createdAtTick: world.tick,
    attackers: ['fac_crisis'],
    defenders: Object.keys(world.entities.factions).filter((f) => f !== 'fac_crisis'),
    startTick: world.tick,
    wargoals: ['exterminate'],
    occupiedSystems: {},
    exhaustion: {},
    battles: 0,
    status: 'active',
    peaceOffers: [],
  };
  emit(world, 'CrisisFleetSpotted', { crisisId: crisis.id, systemId }, 'crisis');
}

let _crisisFactionMade = false;
function createCrisisFaction(world) {
  if (_crisisFactionMade && world.entities.factions['fac_crisis']) return 'fac_crisis';
  createEntity(world, 'factions', {
    id: 'fac_crisis',
    name: '失控自治体',
    traitId: 'crisis_automata',
    personality: 'balanced',
    color: '#e85f5f',
    originType: 'automata',
    isPlayer: false,
  });
  _crisisFactionMade = true;
  return 'fac_crisis';
}

/** AI 自动应对：有能力的文明月度投入科研数据压制（玩家缺席时世界仍有响应） */
function aiSuppressCrisis(world, crisis, def) {
  let suppression = 0;
  for (const fid of Object.keys(world.research).sort()) {
    const fac = world.entities.factions[fid];
    if (!fac || fac.isPlayer) continue;
    const rd = balance(world, fid, 'researchData');
    if (rd >= 20) {
      debit(world, fid, 'researchData', 20, `crisisContribution:${crisis.id}`, crisis.id);
      crisis.contributed[fid] = (crisis.contributed[fid] || 0) + 20;
      suppression += def.suppressionPerContribution;
    }
  }
  return suppression;
}

/** 玩家贡献（ContributeToCrisis 命令执行体） */
export function playerContribute(world, crisisId, amount) {
  const crisis = world.entities.crises[crisisId];
  if (!crisis || crisis.status !== 'active') return { ok: false, reason: '危机不存在或已结束' };
  const pid = world.playerFactionId;
  if (balance(world, pid, 'researchData') < amount) {
    return { ok: false, reason: '科研数据不足' };
  }
  const def = CRISIS_DEFS.find((d) => d.id === crisis.kind);
  debit(world, pid, 'researchData', amount, `crisisContribution:${crisisId}`, crisisId);
  crisis.contributed[pid] = (crisis.contributed[pid] || 0) + amount;
  crisis.progress -= amount * 0.05 * (def?.suppressionPerContribution || 1);
  emit(world, 'CrisisContribution', { crisisId, factionId: pid, amount }, 'crisis');
  return { ok: true };
}

function endCrisis(world, crisis, outcome) {
  crisis.status = 'resolved';
  crisis.outcome = outcome;
  crisis.endedTick = world.tick;
  crisis.phase = 'resolved';
  // 清理敌对舰队与战争
  for (const fid of Object.keys(world.entities.fleets)) {
    const f = world.entities.fleets[fid];
    if (f.isCrisisFleet) {
      for (const sid of f.shipIds.slice()) {
        const ship = world.entities.ships[sid];
        if (ship) ship.status = 'destroyed';
      }
      f.shipIds = [];
      f.status = 'dissolved';
    }
  }
  if (crisis.warId && world.entities.wars[crisis.warId]) {
    world.entities.wars[crisis.warId].status = 'ended';
  }
  world.narrative.arcs.arc_crisis ||= { stage: 0, vars: {} };
  world.narrative.arcs.arc_crisis.resolved = outcome;
  emit(world, 'CrisisEnded', { crisisId: crisis.id, outcome }, 'crisis');
  chronicle(world, 'crisis', outcome === 'contained'
    ? `${crisis.nameZh}被联合力量封锁压制`
    : `${crisis.nameZh}演变为银河灾难`, { crisisId: crisis.id });
}
