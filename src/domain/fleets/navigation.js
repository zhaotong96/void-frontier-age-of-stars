/**
 * domain/fleets/navigation.js — 舰队战略航行（任务书 3.3 / 4.9 / FLEET-01/02）
 *
 * 舰队沿航路逐段移动：fleet.transit = { path:[systemId...], legIndex,
 * legProgress, legEta }。每小时推进受燃料约束；燃料耗尽进入 stranded。
 * 移动不可瞬移：legEta = ceil(laneHours)，laneHours = dist/（速度×除数）。
 */

import { BAL } from '../../content/constants.js';
import { dist } from '../../core/math.js';
import { emit } from '../../core/eventBus.js';
import { getEntity } from '../entities/registry.js';
import { shortestPath } from '../../core/spatial.js';
import { observeForeignSystem } from '../exploration/scan.js';

/** 计算一段航路的小时数 */
export function laneHours(world, fleet, fromSystem, toSystem) {
  const speed = fleetSpeed(fleet, world);
  const d = dist(fromSystem.x, fromSystem.y, toSystem.x, toSystem.y);
  const hours = d / Math.max(0.1, speed * BAL.navigation.laneSpeedDivisor);
  return Math.max(1, Math.ceil(hours));
}

/** 舰队战略速度（最慢船决定 —— 任务书 3.3） */
export function fleetSpeed(fleet, world) {
  let min = Infinity;
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (!ship) continue;
    const stats = ship.stats || {};
    min = Math.min(min, stats.strategicSpeed ?? 1.0);
  }
  return Number.isFinite(min) ? min : 1.0;
}

/**
 * 开始一次转移（由 IssueFleetMoveOrder 命令调用）。
 * route = { path, cost }（spatial.shortestPath 产物）
 */
export function beginTransit(world, fleet, route, fuelAvailable) {
  const S = world.entities.systems;
  const legs = [];
  let fuelNeed = 0;
  for (let i = 0; i < route.path.length - 1; i++) {
    const a = S[route.path[i]];
    const b = S[route.path[i + 1]];
    const h = laneHours(world, fleet, a, b);
    legs.push({ to: b.id, eta: h });
    fuelNeed += h * BAL.navigation.fuelPerLaneHour;
  }
  if (fuelNeed > fuelAvailable) {
    return { ok: false, code: 'NO_FUEL', reason: '燃料不足以完成航线', fuelNeed };
  }
  fleet.transit = {
    path: route.path.slice(),
    legIndex: 0,
    legProgress: 0,
    legEta: legs[0].eta,
    legs,
    startedTick: world.tick,
  };
  fleet.systemId = null; // 在途中
  fleet.orders = { kind: 'move', targetSystemId: route.path[route.path.length - 1], stage: 'underway' };
  return { ok: true, fuelNeed, eta: legs.reduce((s, l) => s + l.eta, 0) };
}

/** 每小时推进所有在途舰队 */
export function advanceFleets(world) {
  const S = world.entities.systems;
  const fleets = world.entities.fleets;
  for (const fid of Object.keys(fleets).sort()) {
    const fleet = fleets[fid];
    if (!fleet.transit) continue;
    const t = fleet.transit;
    // 燃料消耗（按当前航段小时折算）
    const fuelPerHour = BAL.navigation.fuelPerLaneHour * fleetFuelMult(fleet, world);
    const drained = drainFleetFuel(world, fleet, fuelPerHour);
    if (!drained) {
      // 燃料耗尽：受困（FLEET-02）
      fleet.transit = null;
      fleet.status = 'stranded';
      fleet.systemId = t.path[t.legIndex];
      emit(world, 'FleetStranded', { fleetId: fid, systemId: fleet.systemId }, 'fleet');
      continue;
    }
    t.legProgress += 1;
    if (t.legProgress >= t.legEta) {
      // 抵达航段终点
      const arriveId = t.legs[t.legIndex].to;
      t.legIndex += 1;
      t.legProgress = 0;
      if (t.legIndex >= t.legs.length) {
        // 全程抵达
        fleet.transit = null;
        fleet.systemId = arriveId;
        fleet.status = 'idle';
        fleet.orders = null;
        emit(world, 'FleetArrived', { fleetId: fid, systemId: arriveId }, 'fleet');
      } else {
        t.legEta = t.legs[t.legIndex].eta;
      }
    }
  }
  // 抵达后触发接触检查
  for (const fid of Object.keys(fleets).sort()) {
    const fleet = fleets[fid];
    if (fleet.systemId && S[fleet.systemId]) {
      checkSystemPresence(world, fleet);
    }
  }
}

function fleetFuelMult(fleet, world) {
  let mult = 0;
  let n = 0;
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (!ship) continue;
    mult += ship.stats?.fuelEfficiency ?? 1.0;
    n++;
  }
  return n > 0 ? mult / n : 1;
}

/** 从舰队随行补给船/货舱扣燃料；返回是否还有燃料 */
function drainFleetFuel(world, fleet, amount) {
  // 先从旗舰货舱，再从补给舰货舱
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (!ship || (ship.cargo?.hydrogen ?? 0) <= 0) continue;
    const take = Math.min(ship.cargo.hydrogen, amount);
    ship.cargo.hydrogen -= take;
    amount -= take;
    if (amount <= 1e-9) return true;
  }
  return amount <= 1e-9;
}

/** 舰队抵达星系时的存在检查（首次接触入口） */
function checkSystemPresence(world, fleet) {
  const sys = world.entities.systems[fleet.systemId];
  if (!sys) return;
  if (sys.ownerFactionId && sys.ownerFactionId !== fleet.factionId) {
    observeForeignSystem(world, fleet.factionId, sys.ownerFactionId, sys.id);
  }
}

/** 舰队所在星系（在途返回 null） */
export function fleetSystem(world, fleet) {
  return fleet.systemId ? getEntity(world, 'systems', fleet.systemId) : null;
}

/** 舰队总燃料（各船油箱之和） */
export function fleetFuelTotal(world, fleet) {
  let sum = 0;
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (ship && ship.status === 'active') sum += ship.fuel ?? 0;
  }
  return sum;
}

/**
 * 规划航线（只读，供命令 validate 与 AI 预检使用）
 */
export function planRoute(world, fleet, targetSystemId) {
  const S = world.entities.systems;
  const from = fleet.systemId;
  if (!from) return { ok: false, code: 'IN_TRANSIT', reason: '舰队在途中，不能接受新航路' };
  if (!S[targetSystemId]) return { ok: false, code: 'NO_TARGET', reason: '目标星系不存在' };
  if (from === targetSystemId) return { ok: false, code: 'SAME_SYSTEM', reason: '已在该星系' };

  const nodeIds = Object.keys(S);
  const edges = new Map();
  for (const id of nodeIds) edges.set(id, new Set(S[id].lanes));
  const weightFn = (a, b) => {
    let w = Math.hypot(S[a].x - S[b].x, S[a].y - S[b].y);
    const owner = S[b].ownerFactionId;
    if (owner && owner !== fleet.factionId && isHostile(world, fleet.factionId, owner)) w *= 4;
    return w;
  };
  const route = shortestPath(nodeIds, edges, from, targetSystemId, weightFn);
  if (!route) return { ok: false, code: 'NO_ROUTE', reason: '没有可达航路' };

  const legs = [];
  let fuelNeed = 0;
  let eta = 0;
  for (let i = 0; i < route.path.length - 1; i++) {
    const a = S[route.path[i]];
    const b = S[route.path[i + 1]];
    const h = laneHours(world, fleet, a, b);
    legs.push({ to: b.id, eta: h });
    fuelNeed += h * BAL.navigation.fuelPerLaneHour;
    eta += h;
  }
  const fuelAvailable = fleetFuelTotal(world, fleet);
  if (fuelNeed > fuelAvailable) {
    return { ok: false, code: 'NO_FUEL', reason: '燃料不足以完成航线', fuelNeed, fuelAvailable };
  }
  return { ok: true, route, legs, fuelNeed, eta };
}

/** 执行已规划转移（planRoute 通过后调用） */
export function beginPlannedTransit(world, fleet, plan) {
  fleet.transit = {
    path: plan.route.path.slice(),
    legIndex: 0,
    legProgress: 0,
    legEta: plan.legs[0].eta,
    legs: plan.legs,
    startedTick: world.tick,
  };
  fleet.systemId = null;
  fleet.orders = { kind: 'move', targetSystemId: plan.route.path[plan.route.path.length - 1], stage: 'underway' };
  return { ok: true, fuelNeed: plan.fuelNeed, eta: plan.eta };
}

function isHostile(world, a, b) {
  const rel = world.relations.diplomacy[a < b ? `${a}|${b}` : `${b}|${a}`];
  return !!(rel && rel.warId);
}
