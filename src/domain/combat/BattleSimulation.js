/**
 * domain/combat/BattleSimulation.js — 战术战斗模拟（任务书 5.5）
 *
 * 固定战术步长 dt = 1/30s；1 战略 tick 推进 BAL.combat.tickBattleSeconds
 * 战斗秒。战斗实例运行在活体舰船实体之上（单一世界模型），位置/速度/
 * 投射物属于战斗实例，伤害直接写回舰船实体。
 *
 * 当前版本：战斗生命周期与结束条件（COMBAT-06 的结算骨架）；
 * 武器/护盾/电子战细节由武器系统模块注入 stepOneBattle。
 */

import { BAL } from '../../content/constants.js';
import { emit } from '../../core/eventBus.js';
import { chronicle } from '../../core/eventBus.js';
// doc35 WP-P0-2：战术 v2（world.combatV2 门控；金快照零漂移）
import { initBattleV2, stepSquadrons } from './subsystemsAndEw.js';

const DT = BAL.combat.dt;

// ———— TD3：投射物 / 命中事件环形对象池（doc5 §3.8；容量 256，复用对象） ————

/** 环形池容量（doc5:900：容量 256 的预分配环形对象池） */
export const POOL_CAPACITY = 256;

/**
 * 预分配环形对象池：acquire 从空闲栈取对象（空则返回 null，调用方透传瞬态对象，
 * 行为与池化完全一致 —— 只省分配不改模拟）；release 归还。零 Math.random、零 world.rng。
 */
export function createRingPool(capacity, factory) {
  const items = new Array(capacity);
  const freeStack = new Array(capacity);
  for (let i = 0; i < capacity; i++) {
    items[i] = factory();
    items[i]._poolIdx = i;
    items[i]._poolFree = true;
    freeStack[i] = capacity - 1 - i;
  }
  let freeTop = capacity;
  return {
    capacity,
    items,
    acquire() {
      if (freeTop === 0) return null;
      const it = items[freeStack[--freeTop]];
      it._poolFree = false;
      return it;
    },
    release(item) {
      if (!item || item._poolIdx === undefined || item._poolFree) return;
      item._poolFree = true;
      freeStack[freeTop++] = item._poolIdx;
    },
  };
}

/** 投射物工厂（覆盖导弹与光束可视化两种形态的字段并集） */
function makeProjectile() {
  return {
    id: '', side: 'a', kind: '',
    x: 0, y: 0, vx: 0, vy: 0, speed: 0,
    damage: 0, damageType: '', targetShipId: null,
    life: 0, maxLife: 0, tracking: 0, intercepted: false,
    x0: 0, y0: 0, x1: 0, y1: 0,
  };
}

/** 命中事件工厂（战斗时间线） */
function makeEvent() {
  return { t: 0, type: '', side: 'a', shipId: null };
}

/**
 * 战斗池登记簿（WeakMap）：池与代次计数挂在战斗实例之外 —— 战斗实体保持纯数据
 * （存档 payload 不含函数/池结构，SAVE-03 校验和不受影响），战斗结束随 WeakMap 释放。
 */
const battlePools = new WeakMap();

/** 战斗开局惰性预热（一次性分配；每步归零复用） */
function ensureBattlePools(battle) {
  let entry = battlePools.get(battle);
  if (!entry) {
    entry = {
      projPool: createRingPool(POOL_CAPACITY, makeProjectile),
      evtPool: createRingPool(POOL_CAPACITY, makeEvent),
      gen: 0,
    };
    battlePools.set(battle, entry);
  }
  return entry;
}

/**
 * 逐步吸收（reconcile）：把战术层本步推入的瞬态字面量吸进预分配池对象（原位替换，
 * 列表顺序与字段值逐位不变 → 模拟结果不变）；上一步存活、本步已消失的池对象归还空闲栈。
 * 池满（256 在用）后新对象保持瞬态透传 —— 行为不变，仅不再复用。
 * 零新增分配：不建临时数组，直接原位改写 battle.projectiles / battle.events。
 */
function reconcileBattlePools(battle) {
  const entry = ensureBattlePools(battle);
  const gen = ++entry.gen;
  absorb(battle.projectiles, entry.projPool, gen);
  absorb(battle.events, entry.evtPool, gen);

  /** 原位吸收：瞬态字面量 → 池对象；标记 gen */
  function absorb(list, pool, gen) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it && it._poolIdx !== undefined) {
        it._gen = gen; // 本步仍存活
      } else {
        const q = pool.acquire();
        if (q) {
          const poolIdx = q._poolIdx;
          Object.assign(q, it); // 复用对象：字段复制，无新分配
          q._poolIdx = poolIdx;
          q._poolFree = false;
          q._gen = gen;
          list[i] = q;
        }
      }
    }
    // 归还：本步未出现的在借池对象
    for (let k = 0; k < pool.capacity; k++) {
      const it = pool.items[k];
      if (!it._poolFree && it._gen !== gen) pool.release(it);
    }
  }
}

/** 每战略 tick 推进所有活动战斗 */
export function stepBattles(world) {
  const active = world.battles.active;
  const ids = Object.keys(active).sort();
  for (const bid of ids) {
    const battle = active[bid];
    let seconds = BAL.combat.tickBattleSeconds;
    while (seconds > 0 && world.battles.active[bid]) {
      const step = Math.min(DT, seconds);
      stepOneBattle(world, battle, step);
      seconds -= step;
      if (battle.status !== 'active') break;
    }
  }
}

/**
 * 推进一个战斗实例一步。
 * 战斗实例结构：
 * {
 *   id, systemId, startedTick, time, status: 'active'|'done',
 *   sides: { a: factionId, b: factionId },
 *   units: [{ shipId, side, x, y, vx, vy, heading, targetShipId, cooldowns:{weaponId:rest}, retreatCharge, destroyed }],
 *   projectiles: [{ id, side, x, y, vx, vy, damage, damageType, targetUnitIdx, life, kind }],
 *   events: [ {t, type, text} ],   // 战斗时间线
 *   endCondition: { kind: 'annihilate'|'retreat'|'timeout', timeoutSeconds }
 * }
 */
export function stepOneBattle(world, battle, dt) {
  battle.time += dt;

  // 结束条件检查（全歼 / 全员撤离 / 超时）
  const aliveA = battle.units.filter((u) => !u.destroyed && u.side === 'a');
  const aliveB = battle.units.filter((u) => !u.destroyed && u.side === 'b');
  if (aliveA.length === 0 || aliveB.length === 0) {
    finishBattle(world, battle, aliveA.length === 0 ? 'b' : 'a');
    return;
  }
  // F-10：无论 endCondition 为 timeout 还是携带 timeoutSeconds 的歼灭战，
  // 超时均强制收束防卡死（无武装对峙、目标互不可达等极端情形的硬性兜底）
  if (battle.endCondition?.timeoutSeconds && battle.time >= battle.endCondition.timeoutSeconds) {
    finishBattle(world, battle, null);
    return;
  }

  // doc35 WP-P0-2：战术 v2 初始化与舰载机中队（world.combatV2 门控）
  if (world.combatV2 === true) {
    initBattleV2(world, battle);
    stepSquadrons(world, battle, dt);
  }
  // 单位行为（武器系统在阶段08注入：unitBehaviors 注册表）
  for (const behavior of unitBehaviors) behavior(world, battle, dt);
  for (const behavior of projectileBehaviors) behavior(world, battle, dt);
  // TD3：逐步吸收瞬态投射物/事件进环形池（容量 256；原位替换，模拟值不变）
  ensureBattlePools(battle);
  reconcileBattlePools(battle);
}

/** 行为注册表（阶段08由武器/机动模块注册；保持顺序确定） */
export const unitBehaviors = [];
export const projectileBehaviors = [];

/** 结束战斗并结算回写主世界（损失已实时写回实体；此处汇总战报） */
export function finishBattle(world, battle, winnerSide) {
  battle.status = 'done';
  battle.winnerSide = winnerSide;
  battle.endedTick = world.tick;

  const report = {
    id: battle.id,
    systemId: battle.systemId,
    startedTick: battle.startedTick,
    endedTick: world.tick,
    durationSeconds: Math.round(battle.time),
    winnerSide,
    sides: battle.sides,
    initial: battle.initialStrength || {},
    losses: battle.losses || { a: 0, b: 0 },
    damageDealt: battle.damageDealt || { a: 0, b: 0 },
    events: battle.events.slice(-120),
  };
  world.battles.history.push(report);
  const cap = 24;
  if (world.battles.history.length > cap) world.battles.history.splice(0, world.battles.history.length - cap);

  // 舰队脱离交战状态（battle.fleetIds 双侧复位）
  if (battle.fleetIds) {
    for (const flid of [battle.fleetIds.a, battle.fleetIds.b]) {
      const f = world.entities.fleets[flid];
      if (f && f.status === 'engaged') f.status = 'idle';
    }
  }

  emit(world, 'BattleEnded', {
    battleId: battle.id,
    systemId: battle.systemId,
    winnerSide,
    losses: report.losses,
  }, 'combat');
  chronicle(world, 'battle', `战斗结束于 ${world.entities.systems[battle.systemId]?.name || battle.systemId}（${winnerSide === 'a' ? battle.sides.a : battle.sides.b} 获胜）`, {
    battleId: battle.id,
    systemId: battle.systemId,
  });

  delete world.battles.active[battle.id];
}

// 战术行为注册：安装函数在数组定义之后显式调用（避免循环导入 TDZ）
import { installCombatBehaviors } from './tactics.js';
installCombatBehaviors(unitBehaviors, projectileBehaviors);
