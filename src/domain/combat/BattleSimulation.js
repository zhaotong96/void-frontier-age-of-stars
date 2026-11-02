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

const DT = BAL.combat.dt;

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
  if (battle.endCondition?.kind === 'timeout' && battle.time >= battle.endCondition.timeoutSeconds) {
    finishBattle(world, battle, null);
    return;
  }

  // 单位行为（武器系统在阶段08注入：unitBehaviors 注册表）
  for (const behavior of unitBehaviors) behavior(world, battle, dt);
  for (const behavior of projectileBehaviors) behavior(world, battle, dt);
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
