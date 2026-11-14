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
// SPEC-PLAN-052 Task 52.1/52.2（M4 工位 D）：16 大天体原型名称投影（content 只读表，零环）
import { PLANETARY_ARCHETYPES } from '../content/planetaryArchetypes.js';

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
    // SPEC-PLAN-052 Task 52.2（M4 工位 D）：行星灵魂头栏 / 16×16 热力图 / 三层垂直
    // 建造卡消费的只读投影（compactState 缺失 → null，视图整节不渲染）
    spaceOpera: colonySpaceOperaProjection(world, planet),
  };
}

/**
 * 殖民地详情的太空歌剧投影（doc48 §Task 4.3 ColonyView 行契约；doc52 §Task 52.2）：
 * {archetypeId, archetypeNameZh, archetypeCode, epochStage, envVector[8], tiles[256],
 *  orbitalLayer, urbanZones, subterraneanLayer, industrialAttention, radicalCellState}
 */
function colonySpaceOperaProjection(world, planet) {
  const compact = planet && planet.compactState;
  if (!compact) return null;
  const arch = PLANETARY_ARCHETYPES[compact.archetypeId & 0x0f] || null;
  const cell = compact.radicalCell && typeof compact.radicalCell === 'object' ? compact.radicalCell : null;
  return {
    archetypeId: compact.archetypeId & 0x0f,
    archetypeNameZh: arch ? arch.nameZh : null,
    archetypeCode: arch ? arch.code : null,
    epochStage: Number.isFinite(compact.epochStage) ? compact.epochStage : 0,
    envVector: Array.isArray(compact.envVector) ? compact.envVector.map((v) => (Number.isFinite(v) ? v : 0)) : [],
    tiles: Array.isArray(compact.tiles) ? compact.tiles.map((t) => t >>> 0) : [],
    orbitalLayer: compact.orbitalLayer ? {
      majorOrbitals: compact.orbitalLayer.majorOrbitals || 0,
      capitalLevel: compact.orbitalLayer.capitalLevel || 1,
      hasBlackHoleObservatory: !!compact.orbitalLayer.hasBlackHoleObservatory,
      facilities: Array.isArray(compact.orbitalLayer.facilities) ? compact.orbitalLayer.facilities.slice() : [],
    } : null,
    urbanZones: compact.urbanZones ? {
      zoneSlots: Array.isArray(compact.urbanZones.zoneSlots) ? compact.urbanZones.zoneSlots.slice() : [0, 0],
      industryMods: compact.urbanZones.industryMods && typeof compact.urbanZones.industryMods === 'object'
        ? Object.keys(compact.urbanZones.industryMods).sort() : [],
    } : null,
    subterraneanLayer: compact.subterraneanLayer ? {
      depthTier: compact.subterraneanLayer.depthTier || 0,
      excavationStress: Number.isFinite(compact.subterraneanLayer.excavationStress) ? compact.subterraneanLayer.excavationStress : 0,
      vaultUnlockedMask: compact.subterraneanLayer.vaultUnlockedMask || 0,
    } : null,
    industrialAttention: compact.colony ? (compact.colony.industrialAttention | 0) : 0,
    radicalCellState: cell ? (cell.state || 'DORMANT') : 'DORMANT',
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
    // SPEC-PLAN-051/052（M4 工位 C/D）：舰队学说 / 舰船伤痕 / 战役残骸只读投影
    spaceOpera: fleetSpaceOperaProjection(world, f),
  };
}

/**
 * 舰队详情的太空歌剧投影（doc48 §Task 4.3 FleetView 行契约）：
 * {patrolHQ:{planetId, planetName, level, doctrine}, ships:[{id, name, dMods, sMods}],
 *  wreckSites:[{id, systemId, capitalLosses}]}
 */
function fleetSpaceOperaProjection(world, f) {
  const so = world && world.spaceOperaState;
  if (!so) return null;
  // 巡逻司令部：舰队驻防星系行星优先，缺省全银河键序第一座 patrolHQ
  let hqPlanet = null;
  let fallbackHQ = null;
  const planets = (world.entities && world.entities.planets) || {};
  for (const key of Object.keys(planets).sort()) {
    const p = planets[key];
    if (!p || !p.patrolHQ) continue;
    if (f.systemId != null && p.systemId === f.systemId) { hqPlanet = p; break; }
    if (!fallbackHQ) fallbackHQ = p;
  }
  if (!hqPlanet) hqPlanet = fallbackHQ;
  const ships = (world.entities && world.entities.ships) || {};
  const shipRows = (f.shipIds || []).map((sid) => {
    const s = ships[sid];
    const scars = s && s.scars;
    return {
      id: s ? s.id : sid,
      name: s ? s.name : String(sid),
      dMods: scars && Array.isArray(scars.dMods) ? scars.dMods.slice() : [],
      sMods: scars && Array.isArray(scars.sMods) ? scars.sMods.slice() : [],
    };
  }).filter((r) => r.dMods.length > 0 || r.sMods.length > 0);
  const sites = Array.isArray(so.wreckSites) ? so.wreckSites : [];
  return {
    patrolHQ: hqPlanet && hqPlanet.patrolHQ ? {
      planetId: hqPlanet.id,
      planetName: hqPlanet.name || String(hqPlanet.id),
      level: hqPlanet.patrolHQ.level || 1,
      doctrine: { ...(hqPlanet.patrolHQ.doctrine || {}) },
    } : null,
    ships: shipRows,
    wreckSites: sites
      .filter((wk) => wk && wk.converted == null && (f.systemId == null || wk.systemId === f.systemId))
      .map((wk) => ({ id: wk.id, systemId: wk.systemId, capitalLosses: wk.capitalLosses || 0 })),
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
  return { factions: out, wars, spaceOperaS7: diplomacyS7Projection(world) };
}

/**
 * 外交视图太空歌剧 S7 投影（doc48 §Task 4.3 DiplomacyView 行契约；doc52 §Task 52.3）：
 * {standing, choamShares, activeBill, lastBill, commissions[], palaceEspionage,
 *  spyNetworks[], endgameCrisis, unityTreasury}（spaceOperaState 缺失 → null）。
 */
function diplomacyS7Projection(world) {
  const so = world && world.spaceOperaState;
  if (!so) return null;
  const landsraad = so.landsraad && typeof so.landsraad === 'object' ? so.landsraad : {};
  const spy = so.palaceEspionage && typeof so.palaceEspionage === 'object' ? so.palaceEspionage : {};
  const nets = spy.spyNetworks && typeof spy.spyNetworks === 'object' ? spy.spyNetworks : {};
  const commissions = so.commissions && typeof so.commissions === 'object'
    ? Object.keys(so.commissions).sort().map((k) => ({ factionId: k, ...(so.commissions[k] && typeof so.commissions[k] === 'object' ? { signedTick: so.commissions[k].signedTick ?? null } : {}) }))
    : [];
  const ec = so.endgameCrisis && typeof so.endgameCrisis === 'object' ? so.endgameCrisis : {};
  const facs = (world.entities && world.entities.factions) || {};
  return {
    standing: Number.isFinite(landsraad.standing) ? landsraad.standing : 0,
    choamShares: Number.isFinite(landsraad.choamShares) ? landsraad.choamShares : 0,
    activeBill: landsraad.activeBill && typeof landsraad.activeBill === 'object'
      ? { id: landsraad.activeBill.id, kind: landsraad.activeBill.kind, proposedMonth: landsraad.activeBill.proposedMonth ?? null } : null,
    lastBill: landsraad.lastBill && typeof landsraad.lastBill === 'object'
      ? { id: landsraad.lastBill.id ?? null, kind: landsraad.lastBill.kind ?? null, passed: landsraad.lastBill.passed ?? null } : null,
    commissions,
    palaceEspionage: {
      upgraded: spy.upgraded === true,
      agentRecruitMult: Number.isFinite(spy.agentRecruitMult) ? spy.agentRecruitMult : 1.0,
    },
    spyNetworks: Object.keys(nets).sort().map((fid) => ({
      factionId: fid,
      factionName: (facs[fid] && facs[fid].name) || fid,
      layers: nets[fid] && Number.isFinite(nets[fid].layers) ? nets[fid].layers : 0,
      doubleAgent: !!(nets[fid] && nets[fid].doubleAgent === true),
    })),
    endgameCrisis: {
      activeKind: ec.active && typeof ec.active === 'object' ? ec.active.kind || null : null,
      ghostSignalActive: ec.ghostSignalActive === true,
    },
    unityTreasury: Number.isFinite(so.unityTreasury) ? so.unityTreasury : 0,
  };
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
    // SPEC-PLAN-052（M4 工位 D）：星海群像英雄名录投影（doc48 §Task 4.3 GovernmentView 行契约）
    paragons: paragonsProjection(world),
  };
}

/**
 * 星海群像英雄只读投影（doc48 GovernmentView 行契约）：在编领袖（character.paragon
 * 已挂载且存活）→ [{id, name, profession, level, xp, xpNext, loyalty, trauma[],
 * destinyTrait, destinyOffer[], paragonId, mode, legendary, capExempt, capStats}]。
 */
function paragonsProjection(world) {
  const characters = (world.entities && world.entities.characters) || {};
  const out = [];
  for (const key of Object.keys(characters).sort()) {
    const ch = characters[key];
    const pg = ch && ch.paragon;
    if (!ch || !pg || ch.health === 'dead') continue;
    const lvl = Number.isFinite(ch.level) ? ch.level : 1;
    const xp = Number.isFinite(ch.xp) ? ch.xp : 0;
    // 在编口径与 leaderCapStats 同源：职业内、非 capExempt、存活
    const sameProf = Object.keys(characters).filter((k2) => {
      const c2 = characters[k2];
      return c2 && c2.paragon && c2.health !== 'dead'
        && c2.paragon.profession === pg.profession && c2.paragon.capExempt !== true;
    }).length;
    const cap = (world.spaceOperaState && world.spaceOperaState.leaderCaps
      && Number.isFinite(world.spaceOperaState.leaderCaps[pg.profession])
      && world.spaceOperaState.leaderCaps[pg.profession] >= 1)
      ? Math.trunc(world.spaceOperaState.leaderCaps[pg.profession]) : 4;
    out.push({
      id: ch.id,
      name: ch.name || ch.id,
      profession: pg.profession || null,
      level: lvl,
      xp: Math.round(xp),
      xpNext: lvl * 100,
      loyalty: Number.isFinite(ch.loyalty) ? ch.loyalty : 100,
      trauma: (Array.isArray(pg.trauma) ? pg.trauma : []).map((t) => (t && (t.id || t)) || null),
      destinyTrait: pg.destinyTrait || null,
      destinyOffer: Array.isArray(pg.destinyOffer) ? pg.destinyOffer.slice() : [],
      paragonId: pg.paragonId || null,
      mode: pg.mode || 'WARSHIP_COMMANDER',
      legendary: pg.legendary === true || !!pg.paragonId,
      capExempt: pg.capExempt === true,
      capStats: { employed: sameProf, cap, over: sameProf > cap },
    });
  }
  return out;
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
    systemId: b.systemId || null,
    systemName: world.entities.systems[b.systemId]?.name,
    time: Math.round(b.time),
    status: b.status,
    sides: b.sides,
    units: b.units.filter((u) => !u.destroyed || u.evacuated).map((u) => {
      const s = world.entities.ships[u.shipId];
      return {
        shipId: u.shipId, side: u.side, x: Math.round(u.x), y: Math.round(u.y),
        heading: Math.round((u.heading || 0) * 100) / 100,
        hullId: s?.hullId || null,
        retreatCharge: Math.round((u.retreatCharge || 0) * 10) / 10,
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

/**
 * 太空歌剧态势只读投影（SPEC-PLAN-046 M3 集成；Eng-D 纪律：本函数零领域写入，
 * 全部数据自 world.spaceOperaState 只读派生，未挂载容器返回 null）。
 *
 * 结构契约（doc46 M3 集成交付面）：
 *  - systemVector: 七维宏观状态向量快照（NaN 防御 → 0）；
 *  - equilibriumGap: 七维 |S_i − S_eq,i| 偏离幅值（S_eq 与 jacobianCoupling.SYSTEM_EQUILIBRIUM
 *    同源常量本地复制 —— 与 dramaDirector 同款裁决：避免本模块静态 import 翻转月度注册序；
 *    M3 套件 CHK-M3-06 与 jacobian 权威常量逐位互证）；
 *  - activeSituations: [{id, arc, progress, act, approach}]（活跃四幕局势，数值 ID 升序）；
 *  - butterflyCausalLog: 三阶蝴蝶效应因果链尾 8 条（浅拷贝）；
 *  - beacons: {total, nonEmpire, opportunity}（非帝国 = kind !== 'OFFICIAL'）；
 *  - drama: {tension, adaptationFactor, adaptDays, climaxCount}；
 *  - empireDefaulted: 主权违约进行中（untilTick > tick，shortageSituationArc 口径）；
 *  - endgameCrisis: {active, ghostSignalActive}（S7 终局天灾态势；无 S7 容器 → active null）。
 */
const SPACE_OPERA_EQUILIBRIUM = Object.freeze([15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0]);

export function spaceOperaView(world) {
  const so = world && world.spaceOperaState;
  if (!so) return null;
  const safe = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

  const systemVector = Array.isArray(so.systemVector) && so.systemVector.length === 7
    ? so.systemVector.map((v) => safe(Number(v)))
    : SPACE_OPERA_EQUILIBRIUM.map(() => 0);
  const equilibriumGap = SPACE_OPERA_EQUILIBRIUM.map(
    (eq, i) => Math.abs(systemVector[i] - eq),
  );

  const sitBag = so.situations && typeof so.situations === 'object' ? so.situations : {};
  const activeSituations = Object.keys(sitBag)
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
    .filter((id) => sitBag[id] && sitBag[id].resolvedTick == null)
    .map((id) => {
      const sit = sitBag[id];
      return {
        id: sit.id,
        arc: sit.systemArcId,
        progress: safe(Number(sit.progress)),
        act: sit.actStage,
        approach: sit.currentApproach || null,
      };
    });

  const causalLog = Array.isArray(so.butterflyCausalLog) ? so.butterflyCausalLog.slice(-8) : [];

  const beacons = Array.isArray(so.subspaceBeacons) ? so.subspaceBeacons : [];
  const beaconsView = {
    total: beacons.length,
    nonEmpire: beacons.filter((b) => b && b.kind !== 'OFFICIAL').length,
    opportunity: beacons.filter((b) => b && b.kind === 'OPPORTUNITY').length,
  };

  const dd = so.dramaDirector && typeof so.dramaDirector === 'object' ? so.dramaDirector : {};
  const drama = {
    tension: safe(Number(dd.tension)),
    adaptationFactor: safe(Number(dd.adaptationFactor), 1),
    adaptDays: safe(Number(dd.adaptDays)),
    climaxCount: safe(Number(dd.climaxCount)),
  };

  const defaulted = so.empireDefaulted;
  const tick = Number.isFinite(world.tick) ? world.tick : 0;
  const empireDefaulted = !!(defaulted
    && (Number.isFinite(defaulted.untilTick) ? tick < defaulted.untilTick : true));

  const ec = so.endgameCrisis && typeof so.endgameCrisis === 'object' ? so.endgameCrisis : null;
  const endgameCrisis = {
    active: ec && ec.active && typeof ec.active === 'object' ? ec.active.kind || null : null,
    ghostSignalActive: !!(ec && ec.ghostSignalActive === true),
  };

  return {
    systemVector,
    equilibriumGap,
    activeSituations,
    butterflyCausalLog: causalLog,
    beacons: beaconsView,
    // SPEC-PLAN-052 Task 52.1：信标流/自主舰队轻量只读列表（星图图层与弹窗消费）
    beaconsList: spaceOperaBeaconsList(world, so),
    autonomousFleetsList: spaceOperaAutonomousFleetsList(world, so),
    drama,
    empireDefaulted,
    endgameCrisis,
  };
}

/* ==================== SPEC-PLAN-052 Task 52.1：信标流 / 自主舰队只读投影 ==================== */

/** 四大频段中文解调名 + 星图着色（doc52 §Task 52.1 四频段着色映射到实际 FREQ_* 枚举） */
const BEACON_FREQ_ZH = Object.freeze({
  FREQ_DISTRESSED_CIV: { nameZh: '民用求援频段', color: '#e040fb' },
  FREQ_STAR_JOURNAL: { nameZh: '星海日报频段', color: '#ffd700' },
  FREQ_SHADOW_CONTRACT: { nameZh: '黑市合约频段', color: '#ff4444' },
  FREQ_PRECURSOR_ECHO: { nameZh: '先驱者低语频段', color: '#00e5ff' },
  OPPORTUNITY_BEACON: { nameZh: '机遇信标频段', color: '#ffffff' },
});

/** 5 类自主生态舰队中文（doc48 §1.2 / doc52 §Task 52.1） */
const AUTONOMOUS_FLEET_ZH = Object.freeze({
  TRADE_CONVOY: '套利商队',
  SMUGGLER_RUNNER: '走私船',
  PATROL_FLOTILLA: '星区巡逻队',
  MARKET_EXPEDITION: '市场远征军',
  BOUNTY_HUNTER: '赏金猎人',
});

/**
 * 活跃信标流轻量列表：[{id, kind, band, frequencyName, color, position:{x,y},
 * systemId, systemName, title, text, options:[{id,label}], expiresTick}]
 * （doc52 §Task 52.1 §1 投影契约；position 取信标挂载星系策略坐标）。
 */
function spaceOperaBeaconsList(world, so) {
  const beacons = Array.isArray(so.subspaceBeacons) ? so.subspaceBeacons : [];
  const systems = (world && world.entities && world.entities.systems) || {};
  const out = [];
  for (const b of beacons) {
    if (!b || typeof b !== 'object') continue;
    const sys = systems[b.systemId];
    const meta = BEACON_FREQ_ZH[b.freqClass] || { nameZh: b.freqClass || '未知频段', color: '#71839a' };
    const text = String(b.text || '');
    const sep = text.indexOf('：');
    out.push({
      id: b.id,
      kind: b.kind || 'NARRATIVE',
      band: b.freqClass || null,
      frequencyName: meta.nameZh,
      color: meta.color,
      position: sys && Number.isFinite(sys.x) ? { x: sys.x, y: sys.y } : null,
      systemId: b.systemId || null,
      systemName: (sys && sys.name) || String(b.systemId || '—'),
      title: sep > 0 ? text.slice(0, sep) : text.slice(0, 24),
      text,
      options: Array.isArray(b.responseOptions)
        ? b.responseOptions.filter((o) => o && o.id != null).map((o) => ({ id: o.id, label: o.label || o.id, effectHint: o.effectHint || null }))
        : [],
      expiresTick: Number.isFinite(b.expiresTick) ? b.expiresTick : null,
    });
  }
  return out;
}

/**
 * 自主生态舰队轻量列表：[{id, type, typeZh, origin, destination, progress(0..1),
 * cargo, position:{x,y}}]（doc52 §Task 52.1 §1 投影契约；position 为航线插值坐标）。
 */
function spaceOperaAutonomousFleetsList(world, so) {
  const fleets = Array.isArray(so.autonomousFleets) ? so.autonomousFleets : [];
  const systems = (world && world.entities && world.entities.systems) || {};
  const out = [];
  for (const f of fleets) {
    if (!f || typeof f !== 'object') continue;
    const a = systems[f.originSystemId];
    const b = systems[f.destSystemId];
    const total = Number.isFinite(f.travelTicks) && f.travelTicks > 0 ? f.travelTicks : 1;
    const prog = Math.max(0, Math.min(1, (Number.isFinite(f.transitProgress) ? f.transitProgress : 0) / total));
    const pos = a && b && Number.isFinite(a.x) && Number.isFinite(b.x)
      ? { x: a.x + (b.x - a.x) * prog, y: a.y + (b.y - a.y) * prog }
      : null;
    out.push({
      id: f.id,
      type: f.type || null,
      typeZh: AUTONOMOUS_FLEET_ZH[f.type] || f.type || '未知舰队',
      origin: (a && a.name) || String(f.originSystemId || '—'),
      destination: (b && b.name) || String(f.destSystemId || '—'),
      progress: prog,
      cargo: f.cargo && typeof f.cargo === 'object' ? { resourceId: f.cargo.resourceId || null, qty: f.cargo.qty || 0 } : null,
      position: pos,
    });
  }
  return out;
}
