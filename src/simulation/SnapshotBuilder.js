/**
 * simulation/SnapshotBuilder.js — 只读渲染快照（任务书 2.2）
 *
 * UI/渲染层只消费快照，绝不直接写世界状态。
 * 快照为纯数据，按需包含解释信息（任务书 6.4 计算来源）。
 */

import { dateStr } from '../core/clock.js';
import { sortedKeys } from '../core/math.js';
import { getRelation } from '../domain/diplomacy/war.js';

/** 构建全局快照（App 以 ~4Hz 刷新） */
export function buildSnapshot(world) {
  const E = world.entities;
  const player = E.factions[world.playerFactionId];

  const snap = {
    tick: world.tick,
    date: dateStr(world.tick),
    paused: null, // App 填充
    speedIdx: null,
    player: player ? factionSummary(world, player) : null,
    factions: sortedKeys(E.factions).map((id) => factionSummary(world, E.factions[id])),
    systems: buildSystemsView(world),
    fleets: buildFleetsView(world),
    colonies: buildColoniesView(world),
    battles: Object.keys(world.battles.active).sort().map((id) => ({
      id,
      systemId: world.battles.active[id].systemId,
      time: world.battles.active[id].time,
    })),
    alerts: buildAlerts(world),
    logLines: buildLogLines(world),
    resources: player ? resourceSummary(world, player) : null,
    pendingEvent: world.narrative.pendingChoices?.[0] || null,
    victory: world.victory,
  };
  return snap;
}

function factionSummary(world, f) {
  const led = world.economy.ledgers[f.id];
  return {
    id: f.id,
    name: f.name,
    color: f.color,
    isPlayer: f.id === world.playerFactionId,
    personality: f.personality,
    credits: led?.balances?.credits ?? 0,
    influence: led?.balances?.influence ?? 0,
    contactState: null, // 对玩家视角在 UI 层按关系填充
  };
}

function buildSystemsView(world) {
  const E = world.entities;
  const out = [];
  for (const id of sortedKeys(E.systems)) {
    const s = E.systems[id];
    out.push({
      id,
      name: s.name,
      x: s.x,
      y: s.y,
      star: s.star,
      lanes: s.lanes,
      ownerFactionId: s.ownerFactionId,
      surveyedLevel: s.surveyedBy[world.playerFactionId] ?? 0,
      dangerRating: s.dangerRating,
      resourceRating: s.resourceRating,
      planetCount: s.planetIds.length,
      habitableCount: s.planetIds.filter((pid) => E.planets[pid].habitability >= 30).length,
      colonyCount: s.planetIds.filter((pid) => E.planets[pid].colonyId).length,
      hasAnomaly: (s.anomalyIds || []).length > 0,
      fleetIds: [], // 由 buildFleetsView 反查填充
      stationCount: (s.stationIds || []).length,
    });
  }
  // 舰队位置反查
  const idx = new Map(out.map((s) => [s.id, s]));
  for (const id of sortedKeys(E.fleets)) {
    const f = E.fleets[id];
    if (f.systemId && idx.has(f.systemId)) idx.get(f.systemId).fleetIds.push(id);
  }
  return out;
}

function buildFleetsView(world) {
  const E = world.entities;
  const out = [];
  for (const id of sortedKeys(E.fleets)) {
    const f = E.fleets[id];
    out.push({
      id,
      name: f.name,
      factionId: f.factionId,
      systemId: f.systemId,
      inTransit: !!f.transit,
      transitInfo: f.transit ? { dest: f.transit.path[f.transit.path.length - 1], eta: f.transit.legEta - f.transit.legProgress } : null,
      shipCount: (f.shipIds || []).length,
      status: f.status || 'idle',
      stance: f.stance || 'hold',
    });
  }
  return out;
}

function buildColoniesView(world) {
  const E = world.entities;
  const out = [];
  for (const id of sortedKeys(E.colonies)) {
    const c = E.colonies[id];
    const planet = E.planets[c.planetId];
    out.push({
      id,
      name: planet ? planet.name : id,
      planetId: c.planetId,
      systemId: planet?.systemId,
      factionId: c.factionId,
      population: c.population?.total ?? 0,
      stability: c.stability ?? 0,
      housing: c.housing ?? 0,
      buildingCount: (c.buildings || []).length,
    });
  }
  return out;
}

function buildAlerts(world) {
  // 从事件日志提取需要玩家注意的条目（最近 24 小时）
  const cut = world.tick - 24;
  const out = [];
  const cats = world.events.log || {};
  const alarmTypes = new Set([
    'BattleStarted', 'BattleEnded', 'FleetStranded', 'ColonyFamine', 'ColonyBlackout',
    'TreatyBreached', 'TreatyExpired', 'WarDeclared', 'AnomalyDetected', 'FirstContact',
    'CrisisPhase', 'ColonyLost', 'ShipDestroyed', 'TechCompleted',
  ]);
  for (const cat of sortedKeys(cats)) {
    for (const e of cats[cat]) {
      if (e.tick >= cut && alarmTypes.has(e.type)) {
        out.push({ tick: e.tick, type: e.type, payload: e.payload, category: cat });
      }
    }
  }
  out.sort((a, b) => b.tick - a.tick);
  return out.slice(0, 30);
}

function buildLogLines(world) {
  const out = [];
  const cats = world.events.log || {};
  for (const cat of sortedKeys(cats)) {
    for (const e of cats[cat]) out.push({ tick: e.tick, type: e.type, category: cat, payload: e.payload });
  }
  out.sort((a, b) => a.tick - b.tick || (a.type < b.type ? -1 : 1));
  return out.slice(-40);
}

function resourceSummary(world, faction) {
  const led = world.economy.ledgers[faction.id];
  if (!led) return null;
  return { balances: { ...led.balances } };
}

/** 玩家视角的外交关系快照 */
export function diplomacySnapshot(world) {
  const out = [];
  const pid = world.playerFactionId;
  for (const otherId of sortedKeys(world.entities.factions)) {
    if (otherId === pid) continue;
    const rel = getRelation(world, pid, otherId);
    const known = rel.contactState !== 'none';
    out.push({
      factionId: otherId,
      name: world.entities.factions[otherId].name,
      color: world.entities.factions[otherId].color,
      known,
      contactState: known ? rel.contactState : 'none',
      opinion: known ? rel.opinion : null,
      trust: known ? rel.trust : null,
      threat: known ? rel.threat : null,
      borderTension: known ? rel.borderTension : null,
      treaties: known ? rel.treaties.slice() : [],
      atWar: !!rel.warId,
    });
  }
  return out;
}
