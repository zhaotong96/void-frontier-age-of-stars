/**
 * domain/combat/tactics.js — 战术行为：机动、目标选择、开火、投射物、伤害
 * （任务书 5.5.1-5.5.4）
 *
 * 行为注册进 BattleSimulation 的 unitBehaviors / projectileBehaviors，
 * 每 dt=1/30s 步进一次。所有随机判定经 world.rng（确定性）。
 */

import { RNG } from '../../core/rng.js';
import { clamp, dist, angleDelta, normalizeAngle } from '../../core/math.js';
import { BAL } from '../../content/constants.js';
import { layerResist } from '../../content/weapons.js';
import { applyDamage, destroyShip } from '../ships/ship.js';
import { emit } from '../../core/eventBus.js';
// doc35 WP-P0-2：战术 v2（world.combatV2 门控；金快照零漂移）
import {
  subsystemModifiers, stepFlux, applyHitV2, tryLayeredInterception, FLUX_HEAT_GAIN,
} from './subsystemsAndEw.js';

const ARENA = { w: 1000, h: 320 };

/** 当前目标单位（按 shipId 查找；销毁/撤离则 null） */
function targetUnit(battle, u) {
  if (!u.targetShipId) return null;
  return battle.units.find((o) => o.shipId === u.targetShipId && !o.destroyed) || null;
}

/** 安装战术行为（由 BattleSimulation 在模块初始化时调用，避免循环导入） */
export function installCombatBehaviors(unitBehaviors, projectileBehaviors) {

// ———— 单位行为 ————

/** 机动：接近/保持距离/环绕/撤退 + 惯性运动（5.5.1） */
unitBehaviors.push(function movementBehavior(world, battle, dt) {
  for (const u of battle.units) {
    if (u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (!ship || ship.status !== 'active') {
      u.destroyed = true; // F-10：僵尸单元（活体舰船非 active）立即出清，防索敌死锁
      continue;
    }
    const stats = ship.stats;
    const target = targetUnit(battle, u);

    let desiredX;
    let desiredY;
    if (u.order === 'retreat') {
      desiredX = u.side === 'a' ? -80 : ARENA.w + 80;
      desiredY = u.y;
      // 蓄能完成后撤离（doc35 v2：跃迁核 ≤200‰ 瘫痪 → 蓄能冻结无法撤离）
      const v2mods = world.combatV2 === true ? subsystemModifiers(ship) : null;
      if (v2mods && v2mods.retreatFrozen) {
        u.retreatCharge = 0;
      } else {
        u.retreatCharge += dt;
        if (u.retreatCharge >= BAL.combat.retreatChargeSeconds) {
          u.destroyed = true; // 从战斗移除（舰船本体保留）
          u.evacuated = true;
          continue;
        }
      }
    } else if (target) {
      const d = dist(u.x, u.y, target.x, target.y);
      const bestRange = bestEngagementRange(ship);
      if (d > bestRange * 1.15) {
        desiredX = target.x;
        desiredY = target.y;
      } else if (d < bestRange * 0.55) {
        // 保持距离：背向目标
        desiredX = u.x - (target.x - u.x);
        desiredY = u.y - (target.y - u.y);
      } else {
        // 环绕
        const ang = Math.atan2(u.y - target.y, u.x - target.x) + 0.5;
        desiredX = target.x + Math.cos(ang) * bestRange;
        desiredY = target.y + Math.sin(ang) * bestRange;
      }
    } else {
      const hasWeapons = (ship.weapons && ship.weapons.length > 0) || (ship.stats?.weapons && ship.stats.weapons.length > 0);
      if (!hasWeapons) {
        // F-10：无武器船只向本方侧后退规避，不贴脸对撞
        desiredX = u.side === 'a' ? -60 : ARENA.w + 60;
        desiredY = clamp(u.y, 60, ARENA.h - 60);
      } else {
        // 有武器但暂无目标：向最近敌人推进（防双方站桩死锁）
        const foe = battle.units
          .filter((o) => !o.destroyed && o.side !== u.side)
          .sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y))[0];
        if (foe) {
          desiredX = foe.x;
          desiredY = foe.y;
        } else {
          desiredX = u.side === 'a' ? 300 : ARENA.w - 300;
          desiredY = clamp(u.y, 60, ARENA.h - 60);
        }
      }
    }

    // 期望方向 → 推进
    const dx = desiredX - u.x;
    const dy = desiredY - u.y;
    const dl = Math.hypot(dx, dy) || 1;
    // doc35 WP-P0-2：分部动态惩罚（推进阵列受损降机动）+ 被伏击前 10s 转向减半
    let speedMult = 1;
    let turnMult = 1;
    if (world.combatV2 === true) {
      const v2mods = subsystemModifiers(ship);
      speedMult = v2mods.speedMult;
      turnMult = v2mods.turnMult;
      if (u.ambushedS > 0) {
        turnMult *= 0.5;
        u.ambushedS = Math.max(0, u.ambushedS - dt);
      }
      if (u.stealthAmbushS > 0) u.stealthAmbushS = Math.max(0, u.stealthAmbushS - dt);
    }
    const accel = (stats.acceleration || 8) * (u.isBig ? 0.6 : 1) * speedMult;
    u.vx += (dx / dl) * accel * dt;
    u.vy += (dy / dl) * accel * dt;

    // 限速 + 阻尼
    const maxV = (stats.maxSpeed || 60) * speedMult;
    const vl = Math.hypot(u.vx, u.vy);
    if (vl > maxV) {
      u.vx = (u.vx / vl) * maxV;
      u.vy = (u.vy / vl) * maxV;
    }
    u.vx *= 0.995;
    u.vy *= 0.995;
    u.x = clamp(u.x + u.vx * dt, -100, ARENA.w + 100);
    u.y = clamp(u.y + u.vy * dt, 30, ARENA.h - 30);

    // 朝向平滑转向
    if (vl > 1) {
      const want = Math.atan2(u.vy, u.vx);
      const cur = u.heading ?? 0;
      const d = angleDelta(cur, want);
      const turn = (stats.turnRate || 1) * 1.4 * dt * turnMult;
      u.heading = normalizeAngle(cur + clamp(d, -turn, turn));
    }
  }
});

/** 目标选择：射程内优先、按威胁（ DPS×剩余结构 倒数）加权（确定性排序） */
unitBehaviors.push(function targetingBehavior(world, battle, dt) {
  for (const u of battle.units) {
    if (u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (!ship || ship.status !== 'active' || !ship.stats?.weapons?.length) {
      if (!ship || ship.status !== 'active') u.destroyed = true; // F-10：僵尸单元出清
      continue;
    }
    // 换目标节流：每 2 战斗秒重估一次
    u._targetEval = (u._targetEval ?? 0) + dt;
    if (u.targetShipId && u._targetEval < 2) continue;
    u._targetEval = 0;

    const range = bestEngagementRange(ship);
    const enemies = battle.units.filter((o) => !o.destroyed && o.side !== u.side);
    let best = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      if (e.destroyed) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      // 目标捕获放宽：射程外也按距离衰减计入（否则开局间距 > 捕获半径 → 永久无目标死锁）
      const reach = d > range * 1.3 ? -d * 0.02 : 20;
      const eship = world.entities.ships[e.shipId];
      if (!eship || eship.status !== 'active') {
        e.destroyed = true; // F-10：敌方僵尸单元同样出清，防索敌/歼灭判定悬挂
        continue;
      }
      const threat = (eship.stats.weapons?.length || 0) * 10 + (eship.hullId === 'hull_supply' ? -20 : 0);
      const score = threat - d * 0.05 + (e.isBig ? 8 : 0) + (eship.hp.structure < eship.stats.structure * 0.4 ? 12 : 0) + reach;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    u.targetShipId = best ? best.shipId : null;
  }
});

/** 开火：武器周期、能耗/热、弹药、投射物生成（导弹）或即时弹道（炮/激光） */
unitBehaviors.push(function firingBehavior(world, battle, dt) {
  for (const u of battle.units) {
    if (u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (!ship || ship.status !== 'active') {
      u.destroyed = true; // F-10：僵尸单元出清
      continue;
    }
    // doc35 WP-P0-2：热幅能推进 + 主动排热指令（world.combatV2 门控）
    let v2mods = null;
    if (world.combatV2 === true) {
      if (u.order === 'vent' && (u.ventingTimer ?? 0) <= 0) {
        u.ventingTimer = 3.0; // 主动排热 3s（护盾关闭、2.5× 散热）
        u.order = 'engage';
      }
      stepFlux(world, battle, u, ship, dt);
      v2mods = subsystemModifiers(ship);
      if (u.overloadTimer > 0) continue;               // 过载瘫痪：全武器停火
      if (v2mods.powerNetDown) continue;               // 反应堆重度受损：断电哑火
    }
    const target = u.targetShipId ? battle.units.find((o) => o.shipId === u.targetShipId && !o.destroyed) : null;
    const weapons = ship.stats.weapons || [];
    for (let wi = 0; wi < weapons.length; wi++) {
      const w = weapons[wi];
      if (v2mods && v2mods.turretOffline(wi)) continue; // 炮塔群重度受损：偶数槽位离线
      const cdKey = `w${wi}`;
      const cycleMult = v2mods ? v2mods.cycleMult : 1.0;
      u.cooldowns[cdKey] = Math.max(0, (u.cooldowns[cdKey] ?? 0) - dt);
      if (u.cooldowns[cdKey] > 0) continue;
      if (!target) continue;
      if (ship.powerNet < 0) continue; // 缺电：无法开火（装配后果）
      const d = dist(u.x, u.y, target.x, target.y);
      if (d > w.range) continue;

      // 弹药检查
      if (w.ammo) {
        const have = ship.cargo[w.ammo.resId] ?? 0;
        if (have < w.ammo.perShot) continue;
        ship.cargo[w.ammo.resId] = have - w.ammo.perShot;
      }

      u.cooldowns[cdKey] = w.cycleSeconds * cycleMult;
      // doc35 WP-P0-2：开火产生软热量（weapon.heat 激活，doc34 §3.2.2）
      if (v2mods) u.softHeat = (u.softHeat || 0) + (w.heat || 0) * FLUX_HEAT_GAIN;
      const angle = Math.atan2(target.y - u.y, target.x - u.x);
      const mult = factionDamageMult(world, ship.factionId);
      if (w.kind === 'missile') {
        battle.projectiles.push({
          id: `${u.shipId}:${wi}:${battle.time.toFixed(2)}:${battle.projectiles.length}`,
          side: u.side,
          kind: 'missile',
          x: u.x, y: u.y,
          vx: Math.cos(angle) * w.projectileSpeed,
          vy: Math.sin(angle) * w.projectileSpeed,
          speed: w.projectileSpeed,
          damage: w.damage * mult,
          damageType: w.damageType,
          targetShipId: target.shipId,
          life: w.range / w.projectileSpeed + 2,
          tracking: w.tracking,
          // doc35 WP-P0-2：弹体实体血量（重型鱼雷 38 / 普通导弹 12；三层近防可拦截）
          hp: (w.damage || 0) >= 50 ? 38 : 12,
        });
      } else {
        // 直接弹道：命中判定 → 伤害
        const hit = hitProbability(world, battle, u, target, ship, w, d);
        if (RNG.chance(world, hit)) {
          applyHit(world, battle, u, target, w.damage * mult * qualityMult(world, u, target), w.damageType);
        } else {
          battle.events.push({ t: battle.time, type: 'miss', side: u.side });
        }
        // 激光/粒子束可视化：短命投射物（纯表现）
        if (w.kind === 'beam') {
          battle.projectiles.push({
            id: `fx_${battle.projectiles.length}_${battle.time.toFixed(3)}`,
            side: u.side, kind: 'beamFx',
            x0: u.x, y0: u.y, x1: target.x, y1: target.y,
            life: 0.12, maxLife: 0.12,
          });
        }
      }
      battle._dirty = true;
    }

    // 护盾再生（受击延迟）
    const hp = ship.hp;
    if (hp.shield < hp.shieldMax) {
      hp.shieldRegenDelay = Math.max(0, (hp.shieldRegenDelay ?? 0) - dt);
      if ((hp.shieldRegenDelay ?? 0) <= 0) {
        hp.shield = Math.min(hp.shieldMax, hp.shield + (ship.stats.shieldRegen || 1) * dt);
      }
    }
  }
});

/** 阵型保护/护航：屏卫单位为旗舰挡伤（简单实现：保护者贴近被保护者） */
unitBehaviors.push(function formationBehavior(world, battle, dt) {
  // 集中火力：同侧 20% 概率对齐已有目标（由舰队命令统一时关闭）
});

// ———— 投射物行为 ————

projectileBehaviors.push(function missileStep(world, battle, dt) {
  const next = [];
  for (const p of battle.projectiles) {
    if (p.kind === 'beamFx') {
      p.life -= dt;
      if (p.life > 0) next.push(p);
      continue;
    }
    // 导弹追踪
    const target = battle.units.find((o) => o.shipId === p.targetShipId && !o.destroyed);
    if (!target) continue; // 目标消失：导弹自毁（不重复命中）
    const desired = Math.atan2(target.y - p.y, target.x - p.x);
    const cur = Math.atan2(p.vy, p.vx);
    const turn = clamp(angleDelta(cur, desired), -p.tracking * dt, p.tracking * dt);
    const na = cur + turn;
    p.vx = Math.cos(na) * p.speed;
    p.vy = Math.sin(na) * p.speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    // 近防拦截（COMBAT-05：唯一生命周期）
    if (!p.intercepted && world.combatV2 === true) {
      // doc35 WP-P0-2：三层拦截网（外圈中队 350m / 中圈高追踪 180m / 内圈近防 100m）
      if (tryLayeredInterception(world, battle, p, target, dt)) {
        battle.events.push({ t: battle.time, type: 'intercept', side: target.side });
        continue;
      }
    } else if (!p.intercepted && tryIntercept(world, battle, p, target, dt)) {
      continue; // 拦截：销毁
    }
    if (dist(p.x, p.y, target.x, target.y) < 14) {
      const attacker = battle.units.find((o) => o.side === p.side && !o.destroyed);
      applyHit(world, battle, attacker || { side: p.side }, target, p.damage, p.damageType);
      continue;
    }
    if (p.life > 0) next.push(p);
  }
  battle.projectiles = next.slice(0, BAL.combat.maxProjectiles);
});

function tryIntercept(world, battle, missile, target, dt) {
  // 目标侧所有近防武器（cycleSeconds 短、tracking 高）尝试拦截
  const defenders = battle.units.filter((o) => o.side === target.side && !o.destroyed);
  for (const d of defenders) {
    const ship = world.entities.ships[d.shipId];
    if (!ship) continue;
    for (const w of ship.stats.weapons || []) {
      if (!w.pd) continue;
      if ((d.cooldowns[`pd_${d.shipId}`] ?? 0) > 0) continue;
      if (dist(d.x, d.y, missile.x, missile.y) > (w.range || 120)) continue;
      d.cooldowns[`pd_${d.shipId}`] = w.cycleSeconds || 1;
      const eff = 0.6 + 0.4 * (ship.stats.pdEfficiency || 0);
      if (RNG.chance(world, eff)) {
        battle.events.push({ t: battle.time, type: 'intercept', side: target.side });
        return true;
      }
      return false; // 一次拦截尝试未成功仍消耗该防御者本轮
    }
  }
  return false;
}

// ———— 伤害管线（COMBAT-01：护盾 → 装甲 → 结构，逐层抗性） ————

function applyHit(world, battle, attacker, target, baseDamage, damageType) {
  const tShip = world.entities.ships[target.shipId];
  if (!tShip || tShip.status === 'destroyed') return;
  // doc35 WP-P0-2：v2 伤害管线（方向性穿甲 + 分部损伤 + 热幅能；world.combatV2 门控）
  if (world.combatV2 === true) {
    const v2res = applyHitV2(world, battle, attacker, target, baseDamage, damageType, null);
    if (v2res.destroyed) {
      destroyShip(world, tShip, 'combat');
      target.destroyed = true;
      battle.losses[attacker?.side === 'a' ? 'b' : 'a'] = (battle.losses[attacker?.side === 'a' ? 'b' : 'a'] || 0) + 1;
      battle.events.push({ t: battle.time, type: 'destroyed', side: target.side, shipId: target.shipId });
      emit(world, 'ShipDestroyed', { shipId: tShip.id, battleId: battle.id }, 'combat');
    }
    battle._dirty = true;
    return;
  }
  let dmg = baseDamage;
  const layers = ['shield', 'armor', 'structure'];
  const side = attacker?.side || 'a';
  battle.damageDealt[side] = (battle.damageDealt[side] || 0) + dmg;

  for (const layer of layers) {
    if (dmg <= 0) break;
    const resist = layerResist(layer, damageType);
    const effective = dmg * (1 - resist);
    const pool = tShip.hp[layer];
    if (pool <= 0) continue;
    const absorbed = Math.min(pool, effective);
    tShip.hp[layer] = pool - absorbed;
    dmg = dmg - absorbed; // 未被该层抗掉的伤害继续穿透（抗性只减伤该层吸收量）
    if (layer === 'shield') tShip.hp.shieldRegenDelay = BAL.combat.shieldRegenDelay;
  }
  if (tShip.hp.structure <= 0) {
    destroyShip(world, tShip, 'combat');
    target.destroyed = true;
    battle.losses[side === 'a' ? 'b' : 'a'] = (battle.losses[side === 'a' ? 'b' : 'a'] || 0) + 1;
    battle.events.push({ t: battle.time, type: 'destroyed', side: target.side, shipId: target.shipId });
    emit(world, 'ShipDestroyed', { shipId: tShip.id, battleId: battle.id }, 'combat');
  }
  battle._dirty = true;
}

/** 命中概率（任务书 5.5.2 模型：角速度与距离衰减） */
function hitProbability(world, battle, u, target, ship, w, d) {
  const tShip = world.entities.ships[target.shipId];
  const omega = Math.abs(target._angVel ?? Math.hypot(target.vx, target.vy) / Math.max(10, d));
  const Sr = w.signatureRes ?? 1.0;
  const T = w.tracking ?? 1.0;
  const St = Math.max(0.2, tShip?.stats?.signature ?? 1.0);
  const dO = w.optimal ?? w.range * 0.6;
  const dF = w.falloff ?? w.range * 0.35;
  const ewPenalty = sideEwarStrength(world, battle, target.side) * 0.04;
  let p = Math.pow(2, -Math.pow((omega * Sr) / (T * St), 2) - Math.pow(Math.max(0, d - dO) / dF, 2));
  p = p * (1 + (ship.stats.hitChanceBonus || 0) - clamp(ewPenalty, 0, 0.35));
  return clamp(p, 0.02, 0.98);
}

function sideEwarStrength(world, battle, side) {
  // 敌方（相对 side）的电子战强度总和
  const enemySide = side === 'a' ? 'b' : 'a';
  let s = 0;
  for (const u of battle.units) {
    if (u.side !== enemySide || u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (ship) s += ship.stats.ewarStrength || 0;
  }
  return s;
}

function qualityMult(world, u, target) {
  // 暴击（确定性 RNG）
  if (RNG.chance(world, BAL.combat.critChance)) return BAL.combat.critMult;
  return 1;
}

function bestEngagementRange(ship) {
  let best = 0;
  for (const w of ship.stats?.weapons || []) best = Math.max(best, w.optimal || w.range * 0.6);
  return best || 140;
}

function factionDamageMult(world, factionId) {
  // 文明/科技 weaponDamage 乘数
  const rs = world.research[factionId];
  let m = 1;
  if (rs?.effectIndex?.weaponDamage) for (const e of rs.effectIndex.weaponDamage) m *= e.value;
  return m;
}
}
