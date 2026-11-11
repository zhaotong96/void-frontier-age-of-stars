/**
 * domain/fleets/fleet.js — 舰队编组与命令（任务书 4.9）
 */

import { createEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { createShip, computeShipStats } from '../ships/ship.js';
import { hullDef } from '../ships/ship.js';
import { beginPlannedTransit, planRoute, fleetFuelTotal } from './navigation.js';
import { getMod } from '../factions/modifiers.js';

/**
 * 文明修正表（TD3：combat特质断链清偿）—— computeShipStats 消费的全部乘数键。
 * 统一经 getMod 聚合（特质 × 科技 × 政策），开局投放与船坞生产共用同一口径。
 */
export function factionShipMods(world, factionId) {
  return {
    strategicSpeed: getMod(world, factionId, 'strategicSpeed', 'mult'),
    fuelEfficiency: getMod(world, factionId, 'fuelEfficiency', 'mult'),
    sensorStrength: getMod(world, factionId, 'sensorStrength', 'mult'),
    ewarStrength: getMod(world, factionId, 'ewarStrength', 'mult'),
    weaponDamage: getMod(world, factionId, 'weaponDamage', 'mult'),
    maxShield: getMod(world, factionId, 'maxShield', 'mult'),
    shieldRegen: getMod(world, factionId, 'shieldRegen', 'mult'),
    armor: getMod(world, factionId, 'armor', 'mult'),
  };
}

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
      factionMods: factionShipMods(world, opts.factionId), // TD3：文明战斗特质汇入 computeShipStats
    });
    // F-10a 修复：createShip 内已按「舰船↔舰队双向一致性」守卫入列
    // （ship.js:191-194），此处再无条件 push 造成 fleet.shipIds 重复项
    // （实测 AI 舰队 ["shp_595","shp_595","shp_597","shp_597"]）——重复
    // shipId 使战斗配对产生同舰双单元，annihilate 终局条件无法达成。
    if (!fleet.shipIds.includes(ship.id)) fleet.shipIds.push(ship.id);
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

/** 舰队移动（planRoute 只读预检 → beginPlannedTransit；失败不触碰状态） */
export function orderMove(world, fleet, targetSystemId) {
  const plan = planRoute(world, fleet, targetSystemId);
  if (!plan.ok) return plan;
  const res = beginPlannedTransit(world, fleet, plan);
  emit(world, 'FleetDeparted', { fleetId: fleet.id, from: plan.route.path[0], to: targetSystemId, eta: res.eta }, 'fleet');
  return res;
}
