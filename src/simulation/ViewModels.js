/**
 * simulation/ViewModels.js — 每个主视图的只读数据模型（任务书 2.2 / 6.2）
 *
 * UI 视图只消费这些构建器产出的纯数据 + 通过 CommandBus 下命令。
 * 全部按确定性顺序遍历，带解释字段（任务书 6.4 计算来源）。
 */

import { dateStr, tickToDate } from '../core/clock.js';
import { sortedKeys } from '../core/math.js';
import { techDef, techStatus, allTechs } from '../domain/research/research.js';
import { buildingDef } from '../domain/planets/colony.js';
import { hullDef, moduleDef, validateFit, computeShipStats } from '../domain/ships/ship.js';
import { price, ensureMarket, marketUnitPrice } from '../domain/economy/market.js';
import { getRelation } from '../domain/diplomacy/war.js';
import { getMod, explainMod } from '../domain/factions/modifiers.js';
import { resourceDef } from '../content/resources.js';
import { HULLS } from '../content/hulls.js';
import { MODULES } from '../content/modules.js';
import { BUILDINGS } from '../content/buildings.js';
import { BAL } from '../content/constants.js';

/** 殖民地详情 */
export function colonyDetail(world, colonyId) {
  const c = world.entities.colonies[colonyId];
  if (!c) return null;
  const planet = world.entities.planets[c.planetId];
  const stock = { ...(c.stockpile || {}) };
  const ledger = {};
  for (const rid of sortedKeys(c.ledger || {})) {
    ledger[rid] = { ...c.ledger[rid] };
  }
  return {
    id: c.id,
    name: planet?.name || c.id,
    planet: planet ? {
      id: planet.id, category: planet.category, categoryName: planet.categoryName,
      habitability: planet.habitability, gravity: planet.gravity, atmosphere: planet.atmosphere,
      radiation: planet.radiation, temperatureBand: planet.temperatureBand, water: planet.water,
      deposits: { ...(planet.deposits || {}) },
    } : null,
    systemId: c.systemId,
    systemName: world.entities.systems[c.systemId]?.name,
    factionId: c.factionId,
    isOutpost: !!c.isOutpost,
    population: { ...c.population, strata: { ...(c.population?.strata || {}) } },
    housing: c.housing,
    stability: c.stability,
    powerBalance: c.powerBalance ?? 0,
    buildings: (c.buildings || []).map((b, i) => {
      const def = buildingDef(b.defId);
      return {
        index: i,
        defId: b.defId,
        name: def?.nameZh || b.defId,
        category: def?.category,
        level: b.level || 1,
        state: b.state,
        progress: b.progress || 0,
        cycleHours: def?.recipe?.hours || null,
        jobs: def?.jobs || 0,
        powerUse: def?.powerUse || 0,
        powerGen: def?.powerGen || 0,
        recipe: def?.recipe ? { inputs: def.recipe.inputs, outputs: def.recipe.outputs } : null,
      };
    }),
    buildingSlots: c.buildingSlots || 12,
    constructionQueue: (c.constructionQueue || []).map((j) => ({
      defId: j.defId, name: buildingDef(j.defId)?.nameZh || j.defId, state: j.state, progress: j.progress || 0,
    })),
    availableBuildings: BUILDINGS.filter((def) => {
      const done = world.research[c.factionId]?.completed || [];
      return !def.techReq || done.includes(def.techReq);
    }).map((def) => ({
      defId: def.id, name: def.nameZh, desc: def.descZh, category: def.category,
      cost: def.cost, buildHours: def.buildHours,
      blocked: (c.buildings.length >= (c.buildingSlots || 12)) ? '槽位已满' : null,
    })),
    stock, ledger,
    foundedTick: c.foundedTick,
  };
}

/** 舰队详情 */
export function fleetDetail(world, fleetId) {
  const f = world.entities.fleets[fleetId];
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    factionId: f.factionId,
    systemId: f.systemId,
    systemName: f.systemId ? world.entities.systems[f.systemId]?.name : null,
    status: f.status,
    stance: f.stance,
    role: f.role,
    supplyDays: f.supplyDays,
    morale: f.morale,
    transit: f.transit ? {
      destName: world.entities.systems[f.transit.path[f.transit.path.length - 1]]?.name,
      legProgress: f.transit.legProgress,
      legEta: f.transit.legEta,
      totalEta: f.transit.legs.slice(f.transit.legIndex).reduce((s, l) => s + l.eta, 0) - f.transit.legProgress,
    } : null,
    ships: f.shipIds.map((sid) => shipSummary(world, sid)).filter(Boolean),
    commanderId: f.commanderId,
  };
}

export function shipSummary(world, shipId) {
  const s = world.entities.ships[shipId];
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    hullId: s.hullId,
    hullName: hullDef(s.hullId)?.nameZh || s.hullId,
    status: s.status,
    hp: {
      shield: Math.round(s.hp.shield), shieldMax: s.hp.shieldMax,
      armor: Math.round(s.hp.armor), structure: Math.round(s.hp.structure),
      structureMax: s.stats.structure,
    },
    fuel: Math.round(s.fuel),
    fuelCap: s.stats.fuelCap,
    cargo: { ...(s.cargo || {}) },
    stats: {
      strategicSpeed: Math.round((s.stats.strategicSpeed || 0) * 10) / 10,
      sensor: Math.round(s.stats.sensor || 0),
      weapons: (s.stats.weapons || []).length,
      powerNet: s.powerNet,
      cpu: s.stats.cpu,
    },
    modules: s.modules.slice(),
  };
}

/** 科研视图 */
export function researchView(world, factionId) {
  const rs = world.research[factionId];
  if (!rs) return null;
  const labs = countActiveBuildings(world, factionId, 'science');
  const rate = Math.round((1 + labs * 1.5) * (getMod(world, factionId, 'researchOutput', 'mult') || 1) * 10) / 10;
  return {
    completed: rs.completed.slice().sort(),
    active: rs.active.map((a) => {
      const t = techDef(a.techId);
      return { techId: a.techId, name: t?.nameZh, progress: a.progress, cost: t?.cost, category: t?.category };
    }),
    queue: rs.queue.slice(),
    outputPerHour: rate,
    explain: explainMod(world, factionId, 'researchOutput'),
    techs: allTechs().map((t) => ({
      id: t.id, name: t.nameZh, desc: t.descZh, category: t.category, tier: t.tier,
      cost: t.cost, prereqs: (t.prereqs || []).slice(),
      status: techStatus(world, factionId, t.id),
      unlocks: (t.unlocks || []).slice(),
      effects: (t.effects || []).slice(),
    })),
  };
}

function countActiveBuildings(world, factionId, category) {
  let n = 0;
  for (const cid of sortedKeys(world.entities.colonies)) {
    const c = world.entities.colonies[cid];
    if (c.factionId !== factionId) continue;
    for (const b of c.buildings) {
      if (b.state === 'active' && buildingDef(b.defId)?.category === category) n++;
    }
  }
  return n;
}

/** 市场视图 */
export function marketView(world, factionId) {
  const markets = [];
  for (const systemId of sortedKeys(world.economy.markets)) {
    const m = world.economy.markets[systemId];
    const sys = world.entities.systems[systemId];
    const rows = sortedKeys(m.price).map((rid) => {
      const def = resourceDef(rid);
      return {
        resId: rid,
        name: def.nameZh,
        price: m.price[rid],
        base: def.basePrice,
        stock: Math.floor(m.stock[rid] || 0),
        demand: Math.floor(m.demand[rid] || 0),
        embargo: !!m.embargo[factionId],
      };
    });
    markets.push({ systemId, systemName: sys?.name || systemId, rows, owned: sys?.ownerFactionId === factionId });
  }
  const led = world.economy.ledgers[factionId];
  return { markets, credits: led?.balances?.credits ?? 0 };
}

/** 外交视图 */
export function diplomacyView(world, factionId) {
  const out = [];
  for (const otherId of sortedKeys(world.entities.factions)) {
    if (otherId === factionId) continue;
    const rel = getRelation(world, factionId, otherId);
    const fac = world.entities.factions[otherId];
    const known = rel.contactState !== 'none';
    out.push({
      factionId: otherId,
      name: fac.name,
      color: fac.color,
      personality: fac.personality,
      known,
      contactState: rel.contactState,
      opinion: known ? Math.round(rel.opinion) : null,
      trust: known ? Math.round(rel.trust) : null,
      threat: known ? Math.round(rel.threat) : null,
      borderTension: known ? Math.round(rel.borderTension) : null,
      tradeInterdependence: known ? Math.round(rel.tradeInterdependence) : null,
      grievances: known ? rel.grievances : null,
      intelConfidence: known ? Math.round(rel.intelConfidence * 100) : null,
      treaties: (rel.treaties || []).map((tid) => treatySummary(world, tid)).filter(Boolean),
      atWar: !!rel.warId,
    });
  }
  const wars = sortedKeys(world.entities.wars).map((wid) => warSummary(world, wid));
  return { factions: out, wars };
}

export function treatySummary(world, tid) {
  const t = world.entities.treaties[tid];
  if (!t) return null;
  return {
    id: t.id, type: t.type, parties: t.parties.slice(), status: t.status,
    startTick: t.startTick, expiryTick: t.expiryTick || null,
  };
}

export function warSummary(world, wid) {
  const w = world.entities.wars[wid];
  if (!w) return null;
  return {
    id: wid,
    attackers: w.attackers.slice(),
    defenders: w.defenders.slice(),
    status: w.status,
    startTick: w.startTick,
    wargoals: (w.wargoals || []).slice(),
    exhaustion: { ...w.exhaustion },
    occupiedSystems: Object.keys(w.occupiedSystems || {}),
    battles: w.battles || 0,
  };
}

/** 政府/政治视图 */
export function governmentView(world, factionId) {
  const fac = world.entities.factions[factionId];
  if (!fac) return null;
  const colonies = sortedKeys(world.entities.colonies)
    .map((cid) => world.entities.colonies[cid])
    .filter((c) => c.factionId === factionId);
  const totalPop = colonies.reduce((s, c) => s + (c.population?.total || 0), 0);
  const avgStab = colonies.length
    ? Math.round(colonies.reduce((s, c) => s + c.stability, 0) / colonies.length)
    : 0;
  const led = world.economy.ledgers[factionId];
  return {
    name: fac.name,
    ethosTag: fac.ethosTag,
    personality: fac.personality,
    originType: fac.originType,
    influence: led?.balances?.influence ?? 0,
    adminCapacity: Math.round(adminCapacity(world, factionId)),
    governanceLoad: Math.round(governanceLoad(world, factionId)),
    stability: avgStab,
    totalPopulation: totalPop,
    colonyCount: colonies.length,
    systemCount: sortedKeys(world.entities.systems).filter((sid) => world.entities.systems[sid].ownerFactionId === factionId).length,
    policies: { ...(fac.policies || {}) },
    explainAdmin: explainMod(world, factionId, 'adminCapacity'),
  };
}

// adminCapacity / governanceLoad 下沉到 domain/politics/policy.js（领域函数），
// 此处转发导出以保持既有 UI 引用不变。
import { adminCapacity, governanceLoad } from '../domain/politics/policy.js';
export { adminCapacity, governanceLoad };

/** 设计器视图：船体/模块目录 + 蓝图列表 */
export function designerView(world, factionId) {
  const done = world.research[factionId]?.completed || [];
  return {
    hulls: HULLS.map((h) => ({
      id: h.id, name: h.nameZh, desc: h.descZh, category: h.category,
      techReq: h.techReq, unlocked: !h.techReq || done.includes(h.techReq),
      baseStats: h.baseStats, slots: h.slots, cost: h.cost, buildHours: h.buildHours,
    })),
    modules: MODULES.map((m) => ({
      id: m.id, name: m.nameZh, desc: m.descZh, slotType: m.slotType, category: m.category,
      techReq: m.techReq, unlocked: !m.techReq || done.includes(m.techReq),
      cost: m.cost, power: m.power, cpu: m.cpu,
      weapon: m.weapon ? { damage: m.weapon.damage, damageType: m.weapon.damageType, range: m.weapon.range, cycleSeconds: m.weapon.cycleSeconds, kind: m.weapon.kind, tracking: m.weapon.tracking, pd: !!m.weapon.pd } : null,
      effects: (m.effects || []).slice(),
    })),
    blueprints: sortedKeys(world.entities.blueprints)
      .map((bid) => world.entities.blueprints[bid])
      .filter((b) => b.factionId === factionId)
      .map((b) => {
        const v = validateFit(b.hullId, b.modules);
        const stats = computeShipStats(b.hullId, b.modules);
        return {
          id: b.id, name: b.name, hullId: b.hullId, hullName: hullDef(b.hullId)?.nameZh,
          modules: b.modules.slice(), valid: v.ok,
          errors: v.errors.map((e) => e.reason),
          stats: stats ? {
            structure: stats.structure, shield: Math.round(stats.shield), armor: Math.round(stats.armor),
            powerNet: stats.powerNet, cpu: stats.cpu, strategicSpeed: Math.round(stats.strategicSpeed * 10) / 10,
            weapons: (stats.weapons || []).length, sensor: Math.round(stats.sensor), cargo: stats.cargo,
          } : null,
        };
      }),
  };
}

/** 装配实时校验（设计器交互用） */
export function fitPreview(hullId, modules) {
  const v = validateFit(hullId, modules);
  const stats = v.ok ? computeShipStats(hullId, modules) : null;
  return {
    ok: v.ok,
    errors: v.errors,
    stats: stats ? {
      structure: stats.structure, shield: Math.round(stats.shield), armor: Math.round(stats.armor),
      power: stats.power, powerUsed: stats.powerUsed, cpu: stats.cpu,
      strategicSpeed: Math.round(stats.strategicSpeed * 10) / 10,
      cargo: stats.cargo, sensor: Math.round(stats.sensor),
      weapons: (stats.weapons || []).map((w) => ({ name: w.nameZh, damage: w.damage, range: w.range, kind: w.kind })),
      buildHours: hullDef(hullId)?.buildHours,
      cost: hullDef(hullId)?.cost,
    } : null,
  };
}

/** 船坞视图 */
export function shipyardView(world, factionId) {
  const stations = sortedKeys(world.entities.stations)
    .map((sid) => world.entities.stations[sid])
    .filter((s) => s.factionId === factionId)
    .map((s) => ({
      id: s.id, kind: s.kind, systemName: world.entities.systems[s.systemId]?.name,
      systemId: s.systemId, level: s.level || 1,
      queue: (s.buildQueue || []).map((j) => ({
        blueprintName: world.entities.blueprints[j.blueprintId]?.name || j.blueprintId,
        remainingHours: j.remainingHours,
      })),
    }));
  const led = world.economy.ledgers[factionId];
  return { stations, balances: { ...(led?.balances || {}) } };
}

/** 探索/异常视图 */
export function explorationView(world, factionId) {
  const anomalies = sortedKeys(world.entities.anomalies)
    .map((aid) => world.entities.anomalies[aid])
    .filter((a) => a.discoveredBy === factionId)
    .map((a) => ({
      id: a.id,
      name: a.nameZh,
      desc: a.descZh,
      systemName: world.entities.systems[a.systemId]?.name,
      systemId: a.systemId,
      state: a.state,
      progress: Math.round(a.progress),
      difficulty: a.difficulty,
      rewards: (a.rewards || []).slice(),
      resolvedTick: a.resolvedTick || null,
    }));
  const surveyed = sortedKeys(world.entities.systems)
    .map((sid) => world.entities.systems[sid])
    .filter((s) => (s.surveyedBy[factionId] ?? 0) > 0).length;
  return { anomalies, surveyedCount: surveyed, totalSystems: Object.keys(world.entities.systems).length };
}

/** 事件纪年视图 */
export function chronicleView(world) {
  return {
    entries: (world.events.chronicle || []).slice(-400).map((e) => ({
      id: e.id, tick: e.tick, date: dateStr(e.tick), type: e.type, text: e.text,
    })).reverse(),
    stats: {
      ticks: world.tick,
      date: dateStr(world.tick),
      commands: world.stats.commandsExecuted || 0,
      battles: (world.battles.history || []).length,
      coloniesFounded: world.stats.coloniesFounded || 0,
      shipsBuilt: world.stats.shipsBuilt || 0,
    },
  };
}

/** 战斗视图数据 */
export function battleView(world, battleId) {
  const b = world.battles.active[battleId];
  if (!b) return null;
  return {
    id: b.id,
    systemName: world.entities.systems[b.systemId]?.name,
    time: Math.round(b.time),
    status: b.status,
    sides: b.sides,
    units: b.units.filter((u) => !u.destroyed || u.evacuated).map((u) => {
      const s = world.entities.ships[u.shipId];
      return {
        shipId: u.shipId, side: u.side, x: Math.round(u.x), y: Math.round(u.y),
        heading: Math.round((u.heading || 0) * 100) / 100,
        name: s?.name, hullName: s ? hullDef(s.hullId)?.nameZh : '?',
        shield: s ? Math.round(s.hp.shield) : 0,
        shieldMax: s?.hp.shieldMax || 1,
        structure: s ? Math.round(s.hp.structure) : 0,
        structureMax: s?.stats.structure || 1,
        destroyed: !!u.destroyed, order: u.order,
      };
    }),
    projectiles: b.projectiles.map((p) => ({
      kind: p.kind, x: Math.round(p.x), y: Math.round(p.y),
      x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1,
      side: p.side,
    })),
    events: b.events.slice(-30),
    losses: b.losses,
  };
}

/** 情报摘要（对某文明的估计——置信度约束下的模糊数据，任务书 5.2/DIP-03） */
export function intelView(world, factionId, targetFactionId) {
  const rel = getRelation(world, factionId, targetFactionId);
  const fac = world.entities.factions[targetFactionId];
  const conf = rel.intelConfidence ?? 0.2;
  const systems = sortedKeys(world.entities.systems)
    .map((sid) => world.entities.systems[sid])
    .filter((s) => s.ownerFactionId === targetFactionId);
  const fleets = sortedKeys(world.entities.fleets)
    .map((fid) => world.entities.fleets[fid])
    .filter((f) => f.factionId === targetFactionId);
  // 显示区间而非精确值
  const jitter = (v) => Math.max(0, Math.round(v * (1 - conf * 0.5)));
  return {
    factionId: targetFactionId,
    name: fac.name,
    confidence: Math.round(conf * 100),
    estimatedSystems: systems.length > 0 && conf > 0.3 ? { min: jitter(systems.length), max: Math.round(systems.length * (1 + (1 - conf))) } : null,
    estimatedFleets: fleets.length > 0 && conf > 0.3 ? { min: jitter(fleets.length), max: Math.round(fleets.length * (1 + (1 - conf))) } : null,
    contactState: rel.contactState,
    atWar: !!rel.warId,
  };
}
