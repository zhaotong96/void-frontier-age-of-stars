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
import { balance, debit, credit, FLOW } from '../economy/ledger.js';
import { createFleet } from '../fleets/fleet.js';
import { difficultyParam } from '../factions/modifiers.js';
// doc35 WP-P2-2：天灾 2.0 空间枢纽（world.crisisV2 旗标门控；金快照零漂移）
import { mix32, SALT_CRISIS_HUB } from '../../domain/ground/planetSeeds.js';
import { hash32 } from '../../domain/ground/SurfaceSandbox.js';

/** 天灾 2.0 定义（doc35 §2.5.1 三大非对称天灾；world.crisisV2 旗标置位后启用） */
export const CRISIS_V2_DEFS = {
  crisis_rift: {
    id: 'crisis_rift', nameZh: '弦裂高维吞噬者',
    hubKind: 'stn_rift_anchor', nexusKind: 'stn_dimensional_portal',
    hubCount: 4, hubNameZh: '维度固定锚', nexusNameZh: '维度裂隙门',
    debuffZh: '航路跃迁燃料消耗 +30%（弦锚红移畸变）',
    fleetHull: 'hull_frigate', fleetMods: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'],
  },
  crisis_automata: {
    id: 'crisis_automata', nameZh: '肃正机偶协议',
    hubKind: 'stn_sterilization_hub', nexusKind: 'stn_automata_nexus',
    hubCount: 4, hubNameZh: '机偶铸造核', nexusNameZh: '零号公理主脑',
    debuffZh: '幽灵信号：搭载 mod_drone* 舰船与机偶混编殖民地效率 -25%',
    fleetHull: 'hull_destroyer', fleetMods: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster', 'mod_armor_composite'],
  },
  crisis_xeno_swarm: {
    id: 'crisis_xeno_swarm', nameZh: '外银河噬星虫群',
    hubKind: 'stn_infestation_node', nexusKind: 'stn_brood_nest',
    hubCount: 4, hubNameZh: '菌毯感染节点', nexusNameZh: '星巢母皇虫巢',
    debuffZh: '亚空间饥饿回声：外环星系 PTI 每小时额外 +15',
    fleetHull: 'hull_destroyer', fleetMods: ['mod_plasma_thrower', 'mod_reactor_fusion', 'mod_fusion_thruster'],
  },
};

/** 天灾 2.0 旗标置位（ProposeSenateResolution 等统战命令调用；幂等） */
export function enableCrisisV2(world) {
  world.crisisV2 = true;
  return world.crisisV2;
}

/** 枢纽/主脑无敌判定（nexus 无敌：任一天灾空间枢纽存活即免疫伤害） */
export function crisisNexusInvulnerable(world, crisis) {
  if (!crisis.hubStationIds || crisis.hubStationIds.length === 0) return false;
  return crisis.hubStationIds.some((id) => world.entities.stations[id]);
}

/** 枢纽摧毁回调（战斗/命令路径调用）：全部拔除 → 主脑无敌解除 */
export function onCrisisHubDestroyed(world, crisis, stationId) {
  crisis.hubStationIds = (crisis.hubStationIds || []).filter((id) => id !== stationId);
  if (crisis.hubStationIds.length === 0) {
    crisis.nexusInvulnerable = false;
    setPhase(world, crisis, 'nexus_exposed');
    chronicle(world, 'crisis', `全部${CRISIS_V2_DEFS[crisis.kind]?.hubNameZh || '空间枢纽'}已拔除——天灾主核心护盾解除`, { crisisId: crisis.id });
  }
  crisis.contributedScore ||= {};
  crisis.contributedScore[world.playerFactionId] = (crisis.contributedScore[world.playerFactionId] || 0) + 350;
  emit(world, 'CrisisHubDestroyed', { crisisId: crisis.id, stationId, remaining: crisis.hubStationIds.length }, 'crisis');
}

/** 对天灾主脑/枢纽的伤害入口（v2 世界启用；无敌态一律 0 伤） */
export function applyCrisisStationDamage(world, crisis, station, amount) {
  if (station.kind === 'crisisNexus' && crisisNexusInvulnerable(world, crisis)) return 0;
  station.hp = Math.max(0, (station.hp ?? 1000) - amount);
  if (station.hp === 0) {
    if (station.kind === 'crisisNexus') {
      crisis.progress = -999; // 强制收束 → endCrisis('contained')
    } else {
      onCrisisHubDestroyed(world, crisis, station.id);
    }
  }
  return amount;
}

/** 天灾 2.0 空间枢纽布设（爆发阶段 monthly 调用 + GATE-14 测试驱动；mix32 确定性选址） */
export function deployCrisisHubs(world, crisis) {
  const def = CRISIS_V2_DEFS[crisis.kind];
  if (!def || crisis.hubStationIds?.length) return;
  const owned = Object.values(world.entities.systems).filter((s) => s.ownerFactionId);
  const picks = [];
  const pool = owned.length > 0 ? [...owned] : Object.values(world.entities.systems);
  for (let i = 0; i < def.hubCount && pool.length > 0; i++) {
    const h = mix32((world.seed >>> 0) ^ hash32(`hub:${crisis.id}`) ^ Math.imul(i + 1, 104729) ^ SALT_CRISIS_HUB);
    const idx = h % pool.length;
    picks.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  crisis.hubStationIds = [];
  for (const sysId of picks) {
    const st = createEntity(world, 'stations', {
      kind: 'crisisHub',
      crisisKind: crisis.kind,
      systemId: sysId,
      factionId: crisis.factionId || 'fac_crisis',
      name: def.hubNameZh,
      hp: 2400,
      shield: 1200,
    });
    crisis.hubStationIds.push(st.id);
  }
  // 主脑星系（第一枢纽所在星系）
  crisis.nexusSystemId = picks[0] || null;
  crisis.nexusInvulnerable = true;
  const nexus = createEntity(world, 'stations', {
    kind: 'crisisNexus',
    crisisKind: crisis.kind,
    systemId: crisis.nexusSystemId,
    factionId: crisis.factionId || 'fac_crisis',
    name: def.nexusNameZh,
    hp: 8000,
    shield: 4000,
  });
  crisis.nexusStationId = nexus.id;
  chronicle(world, 'crisis', `${crisis.nameZh}空间枢纽展开：${def.hubCount} 座${def.hubNameZh}落地（摧毁全部枢纽前主核心无敌）`, { crisisId: crisis.id });
}

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
      // doc35 WP-P2-2：v2 爆发 → 空间枢纽布设 + 统战紧急事态
      if (world.crisisV2 === true) {
        deployCrisisHubs(world, active);
        triggerGalacticEmergency(world, active);
      }
    }
    if (active.phase === 'outbreak' || active.phase === 'expansion') {
      active.progress += def.progressPerMonth * 0.4 * speed;
      crisisCombatPressure(world, active);
      if (world.crisisV2 === true) {
        v2HubPressure(world, active);
        if (active.progress >= 70 && active.phase === 'outbreak') setPhase(world, active, 'expansion');
      } else if (active.progress >= 70 && active.phase === 'outbreak') setPhase(world, active, 'expansion');
    }
    if (active.progress >= def.catastropheThreshold) {
      endCrisis(world, active, 'catastrophe');
    } else if (active.progress <= def.containedThreshold) {
      if (world.crisisV2 === true && active.nexusStationId && world.entities.stations[active.nexusStationId]) {
        delete world.entities.stations[active.nexusStationId];
      }
      for (const hid of active.hubStationIds || []) delete world.entities.stations[hid];
      active.hubStationIds = [];
      endCrisis(world, active, 'contained');
    }
  }
}

/** v2 枢纽月度压力：每座存活枢纽每月刷 1 支收割舰队（上限 4 支） */
function v2HubPressure(world, crisis) {
  const def = CRISIS_V2_DEFS[crisis.kind];
  if (!def) return;
  const existing = Object.values(world.entities.fleets).filter((f) => f.isCrisisFleet).length;
  if (existing >= 4) return;
  const hubIds = (crisis.hubStationIds || []).filter((id) => world.entities.stations[id]);
  if (hubIds.length === 0) return;
  const h = mix32((world.seed >>> 0) ^ hash32(`hubfleet:${crisis.id}`) ^ (world.tick | 0) ^ SALT_CRISIS_HUB);
  const st = world.entities.stations[hubIds[h % hubIds.length]];
  const fleet = createFleet(world, {
    factionId: crisis.factionId || (crisis.factionId = createCrisisFaction(world)),
    systemId: st.systemId,
    name: `${def.nameZh}收割集群`,
    role: 'combat',
    stance: 'aggressive',
    ships: [
      { hullId: def.fleetHull, moduleIds: def.fleetMods, name: '收割体' },
    ],
  });
  fleet.isCrisisFleet = true;
  ensureCrisisWar(world, crisis);
  emit(world, 'CrisisFleetSpotted', { crisisId: crisis.id, systemId: st.systemId }, 'crisis');
}

/** 危机战争关系确保（legacy crisisCombatPressure 内联逻辑提取复用） */
function ensureCrisisWar(world, crisis) {
  for (const fid of Object.keys(world.entities.factions)) {
    if (fid === 'fac_crisis') continue;
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

// ———— doc35 WP-P2-2：星海统战理事会、监护人联军与四维飞升（world.crisisV2 门控） ————

/**
 * 紧急事态触发（天灾爆发时调用；惰性创建 world.galacticCouncil）。
 * 统战投票权重 = contributedScore + (credits/1000) + 舰队战力/100，最高者当选监护人。
 */
export function triggerGalacticEmergency(world, crisis) {
  if (world.galacticCouncil?.active) return;
  world.galacticCouncil = {
    active: true,
    crisisId: crisis.id,
    custodianFactionId: null,
    emergencyDirectives: ['dir_open_borders'], // 《全星海戒严与无障碍通行令》自动生效
    gdfPool: { alloy: 0, credits: 0 },
    unitedFleetIds: [],
    imperiumProclaimed: false,
    elections: 0,
  };
  // 冻结所有正式文明间常规战争（统战停火）
  for (const war of Object.values(world.entities.wars)) {
    if (war.status === 'active' && !war.wargoals?.includes('exterminate')) war.status = 'suspended';
  }
  chronicle(world, 'crisis', '星海统战理事会紧急事态：全银河边境开放，常规战争强制停火', { crisisId: crisis.id });
  emit(world, 'GalacticEmergencyCouncil', { crisisId: crisis.id }, 'crisis');
}

/** 监护人选举（ProposeSenateResolution 命令执行体；权重最高者当选） */
export function electCustodian(world, proposerFactionId) {
  const council = world.galacticCouncil;
  if (!council?.active) return { ok: false, reason: '统战理事会未激活（需天灾进入爆发阶段）' };
  if (council.custodianFactionId) return { ok: false, reason: '监护人已在任' };
  const crisis = world.entities.crises[council.crisisId];
  let best = null;
  let bestScore = -Infinity;
  for (const fid of Object.keys(world.entities.factions).sort()) {
    const fac = world.entities.factions[fid];
    if (!fac || fid === 'fac_crisis') continue;
    const led = world.economy.ledgers[fid];
    const fleetPower = Object.values(world.entities.fleets)
      .filter((f) => f.factionId === fid)
      .reduce((n, f) => n + (f.shipIds?.length || 0) * 100, 0);
    const contributed = crisis?.contributedScore?.[fid] || crisis?.contributed?.[fid] || 0;
    const score = contributed + (led?.balances?.credits || 0) / 1000 + fleetPower / 100 +
      (fid === proposerFactionId ? 250 : 0); // 发起动议 +250 信任票
    if (score > bestScore) { bestScore = score; best = fid; }
  }
  council.custodianFactionId = best;
  council.elections += 1;
  emit(world, 'CustodianElected', { factionId: best, score: Math.round(bestScore) }, 'crisis');
  chronicle(world, 'crisis', `星海最高监护人当选：${(world.entities.factions[best] || {}).name || best} 统领抗灾联军`, { factionId: best });
  return { ok: true, custodianFactionId: best };
}

/**
 * 星海联军征调（MusterGalacticDefenseForce 命令执行体；监护人专属）。
 * 各文明按月缴纳 alloy 15 / credits 200 入 gdfPool；监护人免维护费整编联军特遣队。
 */
export function musterGalacticDefenseForce(world, factionId) {
  const council = world.galacticCouncil;
  if (!council?.active) return { ok: false, reason: '统战理事会未激活' };
  if (council.custodianFactionId !== factionId) return { ok: false, reason: '仅星海监护人可整编联军' };
  // 月度缴纳（一次性征调时向全文明催缴当期份额）
  for (const fid of Object.keys(world.entities.factions).sort()) {
    if (fid === 'fac_crisis' || fid === factionId) continue;
    const led = world.economy.ledgers[fid];
    const alloyTake = Math.min(15, led?.balances?.alloy || 0);
    const creditsTake = Math.min(200, led?.balances?.credits || 0);
    if (alloyTake > 0) debit(world, fid, 'alloy', alloyTake, 'gdfLevy', 'galacticCouncil', FLOW.TRANSFER);
    if (creditsTake > 0) debit(world, fid, 'credits', creditsTake, 'gdfLevy', 'galacticCouncil', FLOW.TRANSFER);
    council.gdfPool.alloy += alloyTake;
    council.gdfPool.credits += creditsTake;
  }
  // 整编联军特遣队（首都船坞；物料走 gdfPool，免维护费）
  const homeColony = Object.values(world.entities.colonies).find((c) => c.factionId === factionId);
  const homeSysId = homeColony ? world.entities.planets[homeColony.planetId]?.systemId : null;
  if (!homeSysId) return { ok: false, reason: '监护人母星系缺失' };
  const pool = council.gdfPool;
  const ships = [];
  const nHeavies = Math.min(3, Math.floor(pool.alloy / 60));
  for (let i = 0; i < Math.max(1, nHeavies); i++) {
    ships.push({ hullId: 'hull_gun_cruiser', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster', 'mod_armor_composite'], name: `星海联军巡洋舰 ${i + 1}` });
  }
  pool.alloy = Math.max(0, pool.alloy - nHeavies * 60);
  const fleet = createFleet(world, {
    factionId,
    systemId: homeSysId,
    name: '星海联军特遣队',
    role: 'combat',
    stance: 'aggressive',
    ships,
  });
  fleet.isUnitedFrontFleet = true;
  council.unitedFleetIds.push(fleet.id);
  emit(world, 'UnitedFrontAssembled', { fleetId: fleet.id, custodianFactionId: factionId }, 'crisis');
  chronicle(world, 'crisis', '星海联军特遣队整编完毕，奔赴天灾前线', { fleetId: fleet.id });
  return { ok: true, fleetId: fleet.id };
}

/** 危机聚焦目标（DesignateCrisisFocusTarget；联军全 galaxy 集中调度） */
export function designateCrisisFocusTarget(world, factionId, targetSystemId) {
  const council = world.galacticCouncil;
  if (!council?.active) return { ok: false, reason: '统战理事会未激活' };
  if (council.custodianFactionId !== factionId) return { ok: false, reason: '仅星海监护人可指定聚焦目标' };
  council.focusTargetSystemId = targetSystemId;
  for (const flid of council.unitedFleetIds) {
    const f = world.entities.fleets[flid];
    if (f && f.status !== 'dissolved') f.orders = { kind: 'move', targetSystemId };
  }
  emit(world, 'CrisisFocusDesignated', { factionId, targetSystemId }, 'crisis');
  return { ok: true };
}

/** 联军对天灾枢纽/主脑的战果入账（战斗路径调用； contributedScore → 监护人权重） */
export function creditCrisisAction(world, factionId, crisisId, score) {
  const crisis = world.entities.crises[crisisId];
  if (!crisis) return;
  crisis.contributedScore ||= {};
  crisis.contributedScore[factionId] = (crisis.contributedScore[factionId] || 0) + score;
}

// ———— 四维非传统飞升终局（doc35 §2.5.3；world.victory.ascensions 惰性挂载） ————

export const ASCENSION_DEFS = {
  ascension_mind_transcendence: {
    id: 'ascension_mind_transcendence', nameZh: '宇宙创生（Cosmogenesis）',
    stages: [
      { descZh: '破译任一先驱者文明核心', check: (w) => Object.values(w.narrative.precursors || {}).some((t) => t[0] >= 2) },
      { descZh: '完成 45 项科技', check: (w) => (w.research[w.playerFactionId]?.completed?.length || 0) >= 45 },
      { descZh: '三殖民地意识光谱拓印', check: (w, a) => (a.imprintedColonyIds || []).length >= 3 },
      { descZh: '视界之针驶入黑洞（ExecuteAscensionProject）', check: null }, // 由命令直接结算
    ],
    endingId: 'cosmogenesis',
  },
  ascension_chord_expedition: {
    id: 'ascension_chord_expedition', nameZh: '超维弦星门大远征',
    stages: [
      { descZh: 'ancientData ≥ 40', check: (w) => (balance(w, w.playerFactionId, 'ancientData') || 0) >= 40 },
      { descZh: '激活 ≥ 3 座 S4 弦星门', check: (w) => Object.values(w.entities.stations || {})
        .filter((s) => s.kind === 'megastructure' && s.mega?.defId === 'mega_chord_gateway' && s.mega.stage >= 4 && s.factionId === w.playerFactionId).length >= 3 },
      { descZh: '180 日河外大远征调谐（ExecuteAscensionProject）', check: null },
      { descZh: '满编远征舰队穿越中央主星门', check: null },
    ],
    endingId: 'chord_voyager',
  },
  ascension_pan_consensus: {
    id: 'ascension_pan_consensus', nameZh: '银河泛共识永恒共同体',
    stages: [
      { descZh: '以监护人身份平定一场终局天灾', check: (w) => Object.values(w.entities.crises)
        .some((c) => c.status === 'resolved' && c.outcome === 'contained') && w.galacticCouncil?.custodianFactionId === w.playerFactionId },
      { descZh: '与所有存活文明 trust ≥ 65', check: (w) => {
        const pid = w.playerFactionId;
        const alive = Object.keys(w.entities.factions).filter((f) => f !== pid && f !== 'fac_crisis');
        return alive.every((f) => {
          const rel = w.relations.diplomacy[pid < f ? `${pid}|${f}` : `${f}|${pid}`];
          return rel && (rel.trust ?? 0) >= 65;
        });
      } },
      { descZh: '《星海永久和平与泛共识宪章》全票通过（ExecuteAscensionProject）', check: null },
    ],
    endingId: 'pan_galactic_consensus',
  },
};
export function ensureAscensions(world) {
  world.victory.ascensions ||= { activePath: null, stage: 0, infinityTheoremsDone: 0, horizonNeedleShipId: null, imprintedColonyIds: [], expeditionTuningTicks: 0 };
  return world.victory.ascensions;
}

/** 飞升阶段推进检查（ExecuteAscensionProject 命令执行体） */
export function advanceAscension(world, pathId) {
  const a = ensureAscensions(world);
  const def = ASCENSION_DEFS[pathId];
  if (!def) return { ok: false, reason: '未知飞升路线' };
  if (a.activePath && a.activePath !== pathId) return { ok: false, reason: '飞升路线一经选择不可更改' };
  a.activePath = pathId;
  // 逐级校验（check 为 null 的阶段由命令层的专属动作结算）
  for (let i = 0; i < def.stages.length; i++) {
    const st = def.stages[i];
    if (i >= a.stage && st.check) {
      if (!st.check(world, a)) return { ok: false, reason: `阶段 ${i + 1} 未达成：${st.descZh}` };
      a.stage = i + 1;
    }
  }
  return { ok: true, stage: a.stage, pathId };
}

/** 视界之针意识拓印（ImprintColonyConsciousness 内联；ExecuteAscensionProject 参数驱动） */
export function imprintColony(world, colonyId) {
  const a = ensureAscensions(world);
  if (a.activePath !== 'ascension_mind_transcendence') return { ok: false, reason: '需先选择宇宙创生飞升路线' };
  if (!world.entities.colonies[colonyId]) return { ok: false, reason: '殖民地不存在' };
  if (!a.imprintedColonyIds.includes(colonyId)) a.imprintedColonyIds.push(colonyId);
  emit(world, 'ColonyConsciousnessImprinted', { colonyId, count: a.imprintedColonyIds.length }, 'victory');
  return { ok: true, imprinted: a.imprintedColonyIds.length };
}

/** 视界之针黑洞跃迁终局结算（ExecuteAscensionProject 终段；GATE-14 VICTORY-ASCEND-03） */
export function executeBlackHoleAscension(world, systemId) {
  const a = ensureAscensions(world);
  const sys = world.entities.systems[systemId];
  if (!sys || sys.star?.typeId !== 'blackHole') return { ok: false, reason: '目标星系并非黑洞' };
  if ((a.imprintedColonyIds || []).length < 3) return { ok: false, reason: '意识拓印不足 3 殖民地' };
  const res = advanceAscension(world, 'ascension_mind_transcendence');
  if (!res.ok) return res;
  // 胜利结算（与 victory.js win 同口径：endingId=cosmogenesis）
  world.victory.ended = { routeId: 'ascension', endingId: 'cosmogenesis', tick: world.tick };
  world.narrative.flags.sandbox_continue = true;
  emit(world, 'VictoryAchieved', { routeId: 'ascension', endingId: 'cosmogenesis' }, 'world');
  chronicle(world, 'victory', '胜利：视界之针没入黑洞引力透镜，文明在新生子宇宙中再度睁开双眼（宇宙创生）', { routeId: 'ascension' });
  return { ok: true, endingId: 'cosmogenesis' };
}
