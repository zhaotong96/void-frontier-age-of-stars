/**
 * domain/combat/engagement.js — 交战触发与战斗实例创建（任务书 5.5）
 *
 * 敌对舰队进入同一星系且姿态允许时创建战斗实例。
 * 初始阵位按阵营左右分列、按舰种前后排布（可复盘的确定性布局）。
 */

import { createEntity, getEntity } from '../entities/registry.js';
import { nextId } from '../../core/ids.js';
import { emit } from '../../core/eventBus.js';
import { getRelation } from '../diplomacy/war.js';

export function areHostile(world, a, b) {
  if (a === b) return false;
  const rel = getRelation(world, a, b);
  return !!rel.warId;
}

/** F-10：检测舰队是否包含可用武器（活体舰船且武器列表非空） */
function fleetHasWeapons(world, fleet) {
  return (fleet.shipIds || []).some((sid) => {
    const s = world.entities.ships[sid];
    return s && s.status === 'active' && ((s.weapons && s.weapons.length > 0) || (s.stats?.weapons && s.stats.weapons.length > 0));
  });
}

/** 每小时交战检查（HourlySystems 由 combat 阶段前置调用） */
export function checkEngagements(world) {
  // 按星系聚合舰队
  const bySystem = new Map();
  for (const fid of Object.keys(world.entities.fleets).sort()) {
    const fleet = world.entities.fleets[fid];
    if (!fleet.systemId || fleet.shipIds.length === 0) continue;
    if (fleet.status === 'retreated') continue;
    if (!bySystem.has(fleet.systemId)) bySystem.set(fleet.systemId, []);
    bySystem.get(fleet.systemId).push(fleet);
  }
  for (const [systemId, fleets] of bySystem) {
    // F-10：优先将具备武装的战斗舰队排在前面，保持确定性排序
    //（移除「A.factionId > B.factionId 跳过」——该口径在派系迭代序与 ID 序不一致时
    //  会永久跳过敌对舰队，导致战斗集成停局；i<j 配对本身已保证每对只处理一次）
    fleets.sort((a, b) => (fleetHasWeapons(world, b) - fleetHasWeapons(world, a)) || (a.id < b.id ? -1 : 1));
    for (let i = 0; i < fleets.length; i++) {
      for (let j = i + 1; j < fleets.length; j++) {
        const A = fleets[i];
        const B = fleets[j];
        if (!areHostile(world, A.factionId, B.factionId)) continue;
        if (inBattle(world, A.id) || inBattle(world, B.id)) continue;
        if (A.stance === 'hold' && B.stance === 'hold' && !warActiveBetween(world, A.factionId, B.factionId)) continue;
        // F-10：若双方均无任何武器，不建立无意义的消耗死局
        if (!fleetHasWeapons(world, A) && !fleetHasWeapons(world, B)) continue;
        createBattleFromFleets(world, systemId, A, B);
      }
    }
  }
}

function inBattle(world, fleetId) {
  for (const bid of Object.keys(world.battles.active)) {
    const b = world.battles.active[bid];
    if (b.fleetIds && (b.fleetIds.a === fleetId || b.fleetIds.b === fleetId)) return true;
  }
  return false;
}

function warActiveBetween(world, a, b) {
  for (const wid of Object.keys(world.entities.wars)) {
    const war = world.entities.wars[wid];
    if (war.status !== 'active') continue;
    const hitA = war.attackers.includes(a) || war.defenders.includes(a);
    const hitB = war.attackers.includes(b) || war.defenders.includes(b);
    if (hitA && hitB) return true;
  }
  return false;
}

/**
 * 从两支舰队创建战斗实例。舰船以活体引用参战；战斗结束由
 * BattleSimulation.finishBattle 汇总。
 */
export function createBattleFromFleets(world, systemId, fleetA, fleetB) {
  const battle = {
    id: nextId(world, 'battle'),
    systemId,
    startedTick: world.tick,
    time: 0,
    status: 'active',
    sides: { a: fleetA.factionId, b: fleetB.factionId },
    fleetIds: { a: fleetA.id, b: fleetB.id },
    units: [],
    projectiles: [],
    events: [],
    losses: { a: 0, b: 0 },
    damageDealt: { a: 0, b: 0 },
    initialStrength: {
      a: fleetA.shipIds.length,
      b: fleetB.shipIds.length,
    },
    endCondition: { kind: 'annihilate', timeoutSeconds: 600 }, // F-10：歼灭战亦携带硬性超时上限兜底
  };

  let idx = 0;
  const placeSide = (fleet, side, baseX, dir) => {
    let row = 0;
    let col = 0;
    for (const sid of fleet.shipIds) {
      const ship = world.entities.ships[sid];
      if (!ship || ship.status !== 'active') continue;
      const isBig = (ship.stats?.structure ?? 0) > 600;
      const y = 160 + col * 46 + (row % 2) * 22;
      const x = baseX + dir * (row * 60);
      battle.units.push({
        idx: idx++,
        shipId: sid,
        side,
        x, y,
        vx: 0, vy: 0,
        heading: dir > 0 ? 0 : Math.PI,
        targetShipId: null,
        cooldowns: {},
        retreatCharge: 0,
        destroyed: false,
        order: 'engage', // engage|keepDistance|retreat|protect
        isBig,
      });
      col++;
      if (col >= 6) {
        col = 0;
        row++;
      }
    }
  };
  placeSide(fleetA, 'a', 120, 1);
  placeSide(fleetB, 'b', 880, -1);

  world.battles.active[battle.id] = battle;
  fleetA.status = 'engaged';
  fleetB.status = 'engaged';
  emit(world, 'BattleStarted', { battleId: battle.id, systemId, a: fleetA.id, b: fleetB.id }, 'combat');
  return battle;
}

/** 玩家命令：主动攻击同星系敌对舰队（OrderFleetAttack）走这里 */
export function findAttackTarget(world, fleet) {
  const sys = world.entities.systems[fleet.systemId];
  if (!sys) return null;
  for (const fid of Object.keys(world.entities.fleets).sort()) {
    const other = world.entities.fleets[fid];
    if (other.systemId !== fleet.systemId || other.id === fleet.id) continue;
    if (areHostile(world, fleet.factionId, other.factionId)) return other;
  }
  return null;
}

/** 舰队撤退（脱离战斗：蓄能后移除单位并恢复舰队状态） */
export function orderRetreat(world, fleet) {
  for (const bid of Object.keys(world.battles.active)) {
    const b = world.battles.active[bid];
    if (b.fleetIds.a === fleet.id || b.fleetIds.b === fleet.id) {
      for (const u of b.units) {
        if (b.fleetIds[u.side] === fleet.id && !u.destroyed) {
          u.order = 'retreat';
        }
      }
    }
  }
}
