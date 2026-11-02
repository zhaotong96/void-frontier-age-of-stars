/**
 * domain/fleets/fleet.js — 舰队编组与命令（任务书 4.9）
 */

import { createEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { createShip, computeShipStats } from '../ships/ship.js';
import { hullDef } from '../ships/ship.js';
import { beginTransit } from './navigation.js';
import { shortestPath } from '../../core/spatial.js';

/** 创建舰队（ships: [{hullId, moduleIds, name?}] 或直接给 shipIds） */
export function createFleet(world, opts) {
  const fleet = createEntity(world, 'fleets', {
    factionId: opts.factionId,
    name: opts.name || `第 ${1 + Object.keys(world.entities.fleets).length} 分舰队`,
    shipIds: [],
    systemId: opts.systemId || null,
    stance: opts.stance || 'hold', // hold|patrol|aggressive|escort
    status: 'idle',
    orders: null,
    transit: null,
    commanderId: opts.commanderId || null,
    supplyDays: opts.supplyDays ?? 60,
    morale: 70,
    role: opts.role || 'combat', // combat|science|mining|trade|colony
  });
  for (const spec of opts.ships || []) {
    const ship = createShip(world, {
      factionId: opts.factionId,
      hullId: spec.hullId,
      moduleIds: spec.moduleIds || [],
      name: spec.name,
      fleetId: fleet.id,
      systemId: opts.systemId,
      cargo: spec.cargo,
      fuel: spec.fuel,
    });
    fleet.shipIds.push(ship.id);
  }
  emit(world, 'FleetFormed', { fleetId: fleet.id, factionId: fleet.factionId, ships: fleet.shipIds.length }, 'fleet');
  return fleet;
}

/** 向舰队追加舰船 */
export function addShipToFleet(world, fleet, shipId) {
  const ship = world.entities.ships[shipId];
  if (!ship || ship.status !== 'active') return false;
  if (ship.fleetId && ship.fleetId !== fleet.id) {
    const old = world.entities.fleets[ship.fleetId];
    if (old) old.shipIds = old.shipIds.filter((id) => id !== shipId);
  }
  ship.fleetId = fleet.id;
  if (!fleet.shipIds.includes(shipId)) fleet.shipIds.push(shipId);
  return true;
}

/** 从舰队移除舰船（不销毁） */
export function removeShipFromFleet(world, fleet, shipId) {
  fleet.shipIds = fleet.shipIds.filter((id) => id !== shipId);
  const ship = world.entities.ships[shipId];
  if (ship) ship.fleetId = null;
  if (fleet.shipIds.length === 0) {
    fleet.status = 'dissolved';
    emit(world, 'FleetDissolved', { fleetId: fleet.id }, 'fleet');
  }
}

/** 舰队移动命令的路由计算与出发（CommandBus 层校验后调用） */
export function orderMove(world, fleet, targetSystemId) {
  const S = world.entities.systems;
  const from = fleet.systemId;
  if (!from) return { ok: false, code: 'IN_TRANSIT', reason: '舰队在途中，不能接受新航路' };
  if (!S[targetSystemId]) return { ok: false, code: 'NO_TARGET', reason: '目标星系不存在' };
  if (from === targetSystemId) return { ok: false, code: 'SAME_SYSTEM', reason: '已在该星系' };

  // 航路图（考虑封锁：敌方控制的中间节点大幅加权）
  const nodeIds = Object.keys(S);
  const edges = new Map();
  for (const id of nodeIds) edges.set(id, new Set(S[id].lanes));
  const weightFn = (a, b) => {
    let w = Math.hypot(S[a].x - S[b].x, S[a].y - S[b].y);
    const hostile = (sid) => {
      const owner = S[sid].ownerFactionId;
      return owner && owner !== fleet.factionId && isHostile(world, fleet.factionId, owner);
    };
    if (hostile(b)) w *= 4; // 敌区绕行偏好
    return w;
  };
  const route = shortestPath(nodeIds, edges, from, targetSystemId, weightFn);
  if (!route) return { ok: false, code: 'NO_ROUTE', reason: '没有可达航路' };

  const fuel = fleetFuelTotal(world, fleet);
  const res = beginTransit(world, fleet, route, fuel);
  if (!res.ok) return res;
  emit(world, 'FleetDeparted', { fleetId: fleet.id, from, to: targetSystemId, eta: res.eta }, 'fleet');
  return { ok: true, eta: res.eta };
}

function isHostile(world, a, b) {
  const rel = world.relations.diplomacy[a < b ? `${a}|${b}` : `${b}|${a}`];
  return !!(rel && rel.atWarWith);
}

/** 舰队总燃料（各船货舱 hydrogen 之和） */
export function fleetFuelTotal(world, fleet) {
  let sum = 0;
  for (const sid of fleet.shipIds) {
    const ship = world.entities.ships[sid];
    if (ship) sum += ship.cargo?.hydrogen ?? 0;
  }
  return sum;
}
