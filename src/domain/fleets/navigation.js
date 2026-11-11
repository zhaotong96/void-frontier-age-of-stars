/**
 * domain/fleets/navigation.js — 舰队战略航行（任务书 3.3 / 4.9 / FLEET-01/02）
 *
 * 舰队沿航路逐段移动：fleet.transit = { path:[systemId...], legIndex,
 * legProgress, legEta }。每小时推进受燃料约束；燃料耗尽进入 stranded。
 * 移动不可瞬移：legEta = ceil(laneHours)，laneHours = dist/（速度×除数）。
 */

import { BAL } from '../../content/constants.js';
import { debit, FLOW } from '../economy/ledger.js';
import { dist } from '../../core/math.js';
import { emit } from '../../core/eventBus.js';
import { getEntity } from '../entities/registry.js';
import { shortestPath } from '../../core/spatial.js';
import { observeForeignSystem } from '../exploration/scan.js';
import { checkAndProgressObjectives } from '../events/objectives.js';
import { gatewayLinkHours, citadelSnareBlocks } from '../strategic/megastructures.js';

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


/** doc35 安全包装：星门网络/天堑判定（惰性；异常静默回退 null） */
function gatewayLinkHoursSafe(world, fromSystemId, toSystemId, factionId) {
  try { return gatewayLinkHours(world, fromSystemId, toSystemId, factionId); } catch { return null; }
}
function citadelSnareBlocksSafe(world, systemId, factionId) {
  try { return systemId ? citadelSnareBlocks(world, systemId, factionId) : null; } catch { return null; }
}

/**
 * 开始一次转移（由 IssueFleetMoveOrder 命令调用）。
 * route = { path, cost }（spatial.shortestPath 产物）
 */
export function beginTransit(world, fleet, route, fuelAvailable) {
  const S = world.entities.systems;
  // doc35 WP-P2-1：拉格朗日天堑 S3+ 跃迁阻断——敌对要塞星系内严禁向非来路星系跃迁
  const snare = world.economy?._gatewayIndex !== false ? citadelSnareBlocksSafe(world, fleet.systemId, fleet.factionId) : null;
  if (snare) {
    const cameFrom = fleet.lastSystemId || route.path[0];
    const firstTo = route.path[1];
    if (firstTo && firstTo !== cameFrom) {
      return { ok: false, code: 'FTL_SNARE', reason: '拉格朗日天堑引力阻断：未摧毁要塞前仅可沿来路星系跃迁' };
    }
  }
  const legs = [];
  let fuelNeed = 0;
  for (let i = 0; i < route.path.length - 1; i++) {
    const a = S[route.path[i]];
    const b = S[route.path[i + 1]];
    // doc35 WP-P2-1：弦星门 S4 网络直连 → 跨星域 1 小时瞬时边
    const gw = gatewayLinkHoursSafe(world, route.path[i], b.id, fleet.factionId);
    const h = gw != null ? gw : laneHours(world, fleet, a, b);
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
        // doc35：天堑「来路星系」口径——仅当银河存在 S3+ 拉格朗日天堑时才落盘
        // （金快照 4320 tick 窗口无巨构 → 舰队实体字节零漂移）
        if (world.entities.stations && Object.values(world.entities.stations).some((st) =>
          st.kind === 'megastructure' && st.mega && st.mega.defId === 'mega_lagrange_citadel' && st.mega.stage >= 3)) {
          fleet.lastSystemId = arriveId;
        }
        fleet.systemId = arriveId;
        fleet.status = 'idle';
        fleet.orders = null;
        emit(world, 'FleetArrived', { fleetId: fid, systemId: arriveId }, 'fleet');
        // WP-6：抵达即推进护航/巡逻类空间目标（escort_lane 锚定目标星系，按舰队归属匹配）
        checkAndProgressObjectives(world, (o) =>
          o.kind === 'escort_lane' && o.factionId === fleet.factionId && o.targetSystemId === arriveId);
      } else {
        t.legEta = t.legs[t.legIndex].eta;
      }
    }
  }
  // 抵达后触发接触检查与燃料补加
  for (const fid of Object.keys(fleets).sort()) {
    const fleet = fleets[fid];
    if (fleet.systemId && S[fleet.systemId]) {
      checkSystemPresence(world, fleet);
      refuelFleet(world, fleet, S[fleet.systemId]);
    }
  }
}

const REFUEL_PER_HOUR = 20;

/**
 * 友方补给（任务书 3.3/4.9：舰队不能无限期无成本作战）：
 *  1) 本文明殖民地 → 直接从殖民地氢仓储加注（舱对舱）
 *  2) 星系市场 → 以 1.5× 市价用阵营信用点购买
 * 搁浅舰队在可补给处恢复为 idle。
 */
export function refuelFleet(world, fleet, sys) {
  if (!sys) return;
  const needTotal = () => fleet.shipIds.reduce((s, sid) => {
    const ship = world.entities.ships[sid];
    return s + (ship && ship.status === 'active' ? Math.max(0, (ship.stats?.fuelCap ?? 0) - (ship.fuel ?? 0)) : 0);
  }, 0);

  // 1. 殖民地仓储直补
  const colony = sys.planetIds.map((pid) => world.entities.planets[pid]).find((p) => p.colonyId);
  const col = colony ? world.entities.colonies[colony.colonyId] : null;
  let gave = 0;
  if (col && col.factionId === fleet.factionId && (col.stockpile?.hydrogen ?? 0) > 0) {
    for (const sid of fleet.shipIds) {
      const ship = world.entities.ships[sid];
      if (!ship || ship.status !== 'active') continue;
      const cap = ship.stats?.fuelCap ?? 0;
      const want = Math.min(cap - (ship.fuel ?? 0), REFUEL_PER_HOUR - gave, col.stockpile.hydrogen);
      if (want <= 0) continue;
      col.stockpile.hydrogen -= want;
      ship.fuel = Math.round(((ship.fuel ?? 0) + want) * 100) / 100;
      gave += want;
      if (gave >= REFUEL_PER_HOUR) break;
    }
  }

  // 2. 市场购买（1.5× 市价）
  if (gave < REFUEL_PER_HOUR && needTotal() > 0) {
    const market = world.economy.markets[sys.id];
    if (market && !market.embargo[fleet.factionId]) {
      const led = world.economy.ledgers[fleet.factionId];
      const price = (market.price.hydrogen ?? 2) * 1.5;
      let budget = Math.floor((led?.balances?.credits ?? 0) / Math.max(0.1, price));
      budget = Math.min(budget, REFUEL_PER_HOUR - gave, Math.floor(market.stock.hydrogen || 0));
      if (budget > 0) {
        for (const sid of fleet.shipIds) {
          const ship = world.entities.ships[sid];
          if (!ship || ship.status !== 'active' || budget <= 0) continue;
          const cap = ship.stats?.fuelCap ?? 0;
          const take = Math.min(cap - (ship.fuel ?? 0), budget);
          if (take <= 0) continue;
          ship.fuel = Math.round(((ship.fuel ?? 0) + take) * 100) / 100;
          budget -= take;
          market.stock.hydrogen = Math.max(0, (market.stock.hydrogen || 0) - take);
          if (led) debit(world, fleet.factionId, 'credits', Math.round(take * price), 'fleetRefuel', fleet.systemId, FLOW.CONSUME);
        }
      }
    }
  }

  // 3. 搁浅恢复：有燃料且在星系内；清除残留的失效移动订单（防空转死锁）
  if (fleet.status === 'stranded' && fleetFuelTotal(world, fleet) > 1) {
    fleet.status = 'idle';
    if (fleet.orders?.kind === 'move' && !fleet.transit) fleet.orders = null;
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
  // 从舰队各船油箱（ship.fuel，上限 fuelCap）扣燃料
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (!ship || ship.status !== 'active' || (ship.fuel ?? 0) <= 0) continue;
    const take = Math.min(ship.fuel, amount);
    ship.fuel = Math.round((ship.fuel - take) * 100) / 100;
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
