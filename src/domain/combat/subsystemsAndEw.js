/**
 * domain/combat/subsystemsAndEw.js — 战术战斗 v2：五分部战损、软硬热幅能、
 * RCS/热特征静默伏击、三层近防拦截与舰载机中队（doc35 WP-P0-2）
 *
 * 融合专家乙（doc34 §3：非线性穿甲方程 / 分部损伤表 / 幅能过载 / 三层 PD）
 * 与专家甲（doc33 §3：战术步进原型）的综合裁定（doc35 §2.2）。
 *
 * 特性旗标纪律（doc35 §5.2 / doc34 §7.2 契约）：全部 v2 机制由
 * world.combatV2 === true 门控——该旗标仅由 v2 战术命令
 * （ToggleSilentRunning / TriggerDamageControlRestore / SetCombatTacticalOrder）
 * 惰性置位。金快照 4320 tick 窗口内无新命令 → 战斗路径与旧世界逐位等价。
 *
 * 确定性红线：暴击/部位判定 = mix32 派生纯函数；零 Math.random、零 world.rng。
 */

import { mix32 } from '../ground/planetSeeds.js';
import { hash32 } from '../ground/SurfaceSandbox.js';
import { clamp } from '../../core/math.js';
import { emit } from '../../core/eventBus.js';

/** 舰船 5 分部完好度元组下标（千分比 0..1000；doc34 §3.2.1 契约） */
export const SUB_IDX = Object.freeze({
  BOW_ARMOR: 0,     // 舰首主装甲带
  THRUSTERS: 1,     // 尾部推进阵列
  WEAPON_TURRETS: 2, // 主武器炮塔群
  WARP_CORE: 3,     // 跃迁场发生器
  REACTOR: 4,       // 能量反应堆芯
});
export const SUB_LIGHT_DAMAGE = 600;  // <600‰ 轻度受损
export const SUB_CRIPPLED = 200;      // ≤200‰ 重度瘫痪

/** 软硬热幅能常量（doc34 §3.2.2） */
export const FLUX_CAPACITY = 100;
export const OVERLOAD_SECONDS = 6.0;
export const VENT_SECONDS = 3.0;
export const HARD_FLUX_SHIELD_RATE = 0.5;   // 护盾吸收伤害 → 硬幅能系数
export const HARD_FLUX_DISSIPATION = 0.2;   // 护盾开启期间硬幅能消散倍率
export const VENT_DISSIPATION = 2.5;        // 主动排热倍率（护盾关闭 3s）
export const FLUX_HEAT_GAIN = 8;            // 每次开火软热量 = weapon.heat × 8（动能 6→48/发 @3s 循环 → 持续火力 ~16s 过载）

/** 方向性装甲（doc34 §3.2.1：舰首 1.25 / 侧舷 1.0 / 舰尾 0.65） */
export const ARMOR_SECTOR_MULT = Object.freeze({ bow: 1.25, side: 1.0, stern: 0.65 });
/** 非线性穿甲地板（5% 残余装甲底线 → 减伤乘数下限 15%） */
export const PIERCE_FLOOR = 0.15;

/** 武器伤害类型 → 击穿强度系数（doc34 §3.2.1） */
export const PIERCING_BY_TYPE = Object.freeze({
  kinetic: 0.10, piercing: 0.45, thermal: 0.25, explosive: 0.30, em: 0.60,
});

/** 舰队被探测半径乘数（doc35 §2.2.2：静默+掩体 10% / 仅静默 30%） */
export function detectionRadiusMult(fleet, world) {
  if (fleet?.stance !== 'silent_ambush') return 1.0;
  const sys = fleet.systemId ? world.entities.systems[fleet.systemId] : null;
  const cover = !!(sys && (sys.hazards || []).some((h) => h === 'asteroidDebris' || h === 'ionStorm' || h === 'nebula'));
  return cover ? 0.10 : 0.30;
}

/** v2 旗标置位（仅由 v2 战术命令调用；幂等） */
export function enableCombatV2(world) {
  world.combatV2 = true;
  return world.combatV2;
}

/** 舰船分部元组惰性初始化（v2 世界内首次参战/受创时创建） */
export function ensureSubsystems(ship) {
  if (!ship.subsystems) ship.subsystems = [1000, 1000, 1000, 1000, 1000];
  return ship.subsystems;
}

/**
 * 非线性穿甲减伤乘数（doc35 §2.2.1 方程）：
 * D_eff = D_raw · max(0.15, D_raw / (D_raw + 0.5 × Armor_eff))
 * 锚点对拍（doc34 §3.2.1）：动能炮 14 伤 vs 战列舰正面（装甲 500×(1−0.10 系数)×1.25）
 * → 乘数触底 0.150（D_eff=2.1）；鱼雷 95 伤 vs 巡洋舰侧舷（装甲 300×0.70）
 * → 乘数 0.475（D_eff=45.1）。
 * @param {number} rawDamage 武器单发伤害（击穿系数走护甲削减，不改写伤害）
 * @param {number} armorEff 区段有效装甲（基准装甲 × 方向乘数 × (1−击穿系数)）
 */
export function pierceMultiplier(rawDamage, armorEff) {
  if (armorEff <= 0) return 1.0;
  return Math.max(PIERCE_FLOOR, rawDamage / (rawDamage + 0.5 * armorEff));
}

/**
 * 入射方位判定：来袭方向相对目标朝向的夹角 → 'bow' | 'side' | 'stern'。
 * @param {{x:number,y:number}} attackerPos
 * @param {{x:number,y:number,heading:number}} targetUnit
 */
export function incomingSector(attackerPos, targetUnit) {
  const dx = attackerPos.x - targetUnit.x;
  const dy = attackerPos.y - targetUnit.y;
  const ang = Math.atan2(dy, dx);
  let d = Math.abs(ang - targetUnit.heading);
  while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
  if (d <= Math.PI / 4) return 'bow';         // ≤45°
  if (d >= (3 * Math.PI) / 4) return 'stern'; // ≥135°
  return 'side';
}

/** 确定性部位暴击/殉爆判定（纯函数；同一 (shipId, 战斗秒) 恒定） */
export function deterministicChance(world, shipId, battleTime, permille) {
  const h = mix32((world.seed >>> 0) ^ hash32(`sub:${shipId}`) ^ Math.imul(Math.floor(battleTime * 30) | 0, 0x5bd1e995));
  return (h % 1000) < permille;
}

/**
 * 分部损伤结算（穿甲后过剩伤害按受击方位入部；doc34 §3.2.1 权重表）。
 * @returns {{crippled:boolean, exploded:boolean, idx:number}}
 */
export function applySubsystemDamage(world, battle, unit, ship, excessDamage, sector) {
  const subs = ensureSubsystems(ship);
  const bySector = { bow: SUB_IDX.BOW_ARMOR, side: SUB_IDX.WEAPON_TURRETS, stern: SUB_IDX.THRUSTERS };
  let idx = bySector[sector] ?? SUB_IDX.WEAPON_TURRETS;
  // 结构 <50% 后的穿甲命中转向要害（反应堆/跃迁核），确定性二选一
  if (ship.hp.structure < ship.stats.structure * 0.5) {
    const pickCore = deterministicChance(world, ship.id, battle.time, 500);
    idx = pickCore ? SUB_IDX.REACTOR : SUB_IDX.WARP_CORE;
  }
  const before = subs[idx];
  subs[idx] = Math.max(0, subs[idx] - Math.round(excessDamage * 8)); // 千分比标度
  const crippled = subs[idx] <= SUB_CRIPPLED && before > SUB_CRIPPLED;
  let exploded = false;
  if (idx === SUB_IDX.REACTOR && subs[idx] === 0 && deterministicChance(world, `${ship.id}:boom`, battle.time, 250)) {
    exploded = true; // 反应堆归零 25% 确定性殉爆
  }
  if (crippled || exploded) {
    emit(world, 'SubsystemCrippled', { shipId: ship.id, subsystemIdx: idx, exploded }, 'combat');
  }
  return { crippled, exploded, idx };
}

/**
 * 分部动态惩罚 → 机动/火控有效值（读取侧纯函数；movement/firing 行为调用）。
 * thrusters<600: maxSpeed/turnRate ×0.65；≤200: ×0.15
 * turrets<600: cycleSeconds ×1.35 / tracking ×0.75；≤200: 偶数槽位武器离线
 * warpCore≤200: 撤退蓄能冻结
 * reactor<600: power ×0.75 / heatDissipation ×0.70；≤200: powerNet 视为 <0
 */
const DEFAULT_MODS = Object.freeze({
  speedMult: 1.0, turnMult: 1.0, cycleMult: 1.0, trackingMult: 1.0,
  turretOffline: () => false, retreatFrozen: false, retreatChargeMult: 1.0,
  powerMult: 1.0, heatDissipationMult: 1.0, powerNetDown: false, bowArmorGone: false,
});

export function subsystemModifiers(ship) {
  const subs = ship.subsystems || ensureSubsystems(ship);
  // 零分配快路径：全健康舰共享冻结默认值（perf 舰队 40 单位 × 每 tick 3 次调用）
  if (subs[0] >= 1000 && subs[1] >= 1000 && subs[2] >= 1000 && subs[3] >= 1000 && subs[4] >= 1000) {
    return DEFAULT_MODS;
  }
  return computeSubsystemModifiers(subs);
}

function computeSubsystemModifiers(subs) {
  const t = subs[SUB_IDX.THRUSTERS];
  const w = subs[SUB_IDX.WEAPON_TURRETS];
  const c = subs[SUB_IDX.WARP_CORE];
  const r = subs[SUB_IDX.REACTOR];
  return {
    speedMult: t <= SUB_CRIPPLED ? 0.15 : t < SUB_LIGHT_DAMAGE ? 0.65 : 1.0,
    turnMult: t <= SUB_CRIPPLED ? 0.15 : t < SUB_LIGHT_DAMAGE ? 0.65 : 1.0,
    cycleMult: w < SUB_LIGHT_DAMAGE ? 1.35 : 1.0,
    trackingMult: w < SUB_LIGHT_DAMAGE ? 0.75 : 1.0,
    turretOffline: (wi) => w <= SUB_CRIPPLED && wi % 2 === 0, // 半数高槽（偶数）哑火
    retreatFrozen: c <= SUB_CRIPPLED,
    retreatChargeMult: c < SUB_LIGHT_DAMAGE ? 2.0 : 1.0, // 蓄能速率减半（时长翻倍）
    powerMult: r < SUB_LIGHT_DAMAGE ? 0.75 : 1.0,
    heatDissipationMult: r < SUB_LIGHT_DAMAGE ? 0.70 : 1.0,
    powerNetDown: r <= SUB_CRIPPLED,
    bowArmorGone: subs[SUB_IDX.BOW_ARMOR] <= SUB_CRIPPLED, // 舰首装甲剥离：正面 1.25 → 1.0 且暴击 +15%
  };
}

/**
 * 战斗单元 v2 状态初始化（stepOneBattle 首步调用；world.combatV2 门控）。
 * 静默伏击：未被发现侧获得 stealthAmbushS=10（首轮 +25% 暴击），
 * 被伏击侧初始护盾 40%、转向 ×0.5（前 10s）。
 */
export function initBattleV2(world, battle) {
  if (battle._v2Init) return;
  battle._v2Init = true;
  battle.squadrons = battle.squadrons || [];
  let sqdId = 0;
  for (const u of battle.units) {
    const ship = world.entities.ships[u.shipId];
    if (!ship) continue;
    ensureSubsystems(ship);
    u.subsystems = ship.subsystems; // 运行时镜像（持久化以 ship 为准）
    u.softHeat = 0;
    u.hardFlux = 0;
    u.overloadTimer = 0;
    u.ventingTimer = 0;
    u.stealthAmbushS = 0;
    u.order = u.order === 'retreat' ? 'retreat' : 'engage';
    // 舰载机中队：机库舰按确定性顺序展开（上限 16/战场）
    const hangar = ship.stats?.hangar || 0;
    if (hangar > 0 && battle.squadrons.length < 16) {
      battle.squadrons.push({
        id: `sqd_${++sqdId}_${battle.id}`,
        carrierShipId: ship.id,
        side: u.side,
        kind: hangar >= 3 ? 'bomber' : 'interceptor',
        strength: 12,
        x: u.x, y: u.y,
        targetUnitIdx: null,
        cooldown: 0,
      });
    }
  }
  // 静默伏击判定：任一侧处于 silent_ambush 且对方未探测（determinstic 距离口径 → 布尔化：静默方开战即伏击）
  for (const side of ['a', 'b']) {
    const fleetId = battle.fleetIds[side];
    const fleet = world.entities.fleets[fleetId];
    if (fleet && fleet.stance === 'silent_ambush') {
      for (const u of battle.units) {
        if (u.side === side) u.stealthAmbushS = 10.0;
        else {
          u.ambushedS = 10.0;               // 被伏击：前 10s 转向减半
          const ship = world.entities.ships[u.shipId];
          if (ship && ship.hp.shieldMax > 0) ship.hp.shield = Math.min(ship.hp.shield, ship.hp.shieldMax * 0.4);
        }
      }
      emit(world, 'SuddenStrike', { battleId: battle.id, side }, 'combat');
    }
  }
}

/**
 * v2 伤害管线（tactics.applyHit 在 world.combatV2 时改走本函数口径）：
 * 方向装甲乘数 → 非线性穿甲 → 护盾(硬/软幅能) → 装甲(5% 底线) → 结构 → 分部穿透。
 * @returns {{destroyed:boolean, totalDealt:number}}
 */
export function applyHitV2(world, battle, attacker, target, baseDamage, damageType, weapon) {
  const tShip = world.entities.ships[target.shipId];
  if (!tShip || tShip.status === 'destroyed') return { destroyed: false, totalDealt: 0 };
  const side = attacker?.side || 'a';
  const pos = attacker && Number.isFinite(attacker.x) && Number.isFinite(attacker.y)
    ? attacker
    : { x: target.x - 100, y: target.y }; // 导弹/中队路径无坐标时按舰首迎击默认方位
  const sector = incomingSector(pos, target);
  const mods = subsystemModifiers(tShip);

  // 1) 方向性有效装甲（舰首装甲剥离后正面加成失效；击穿系数按 doc34 锚点削减护甲）
  let sectorMult = ARMOR_SECTOR_MULT[sector];
  if (sector === 'bow' && mods.bowArmorGone) sectorMult = 1.0;
  const pierceCoef = PIERCING_BY_TYPE[damageType] ?? 0.25;
  const armorBase = tShip.hp.armor > 0 ? tShip.hp.armor : tShip.stats.armor * 0.05;
  const armorEff = Math.max(0, armorBase * sectorMult * (1 - pierceCoef));
  // 2) 非线性穿甲（静默奇袭首轮 +25% 结算于最终伤害）
  const critBonus = (attacker && attacker.stealthAmbushS > 0) ? 0.25 : 0;
  const mult = pierceMultiplier(baseDamage, armorEff);
  let dmg = baseDamage * mult * (1 + critBonus);

  // 3) 层间结算：护盾（幅能化）→ 装甲（残余底线）→ 结构 → 分部
  let dealt = 0;
  if (tShip.hp.shield > 0) {
    const absorbed = Math.min(tShip.hp.shield, dmg);
    tShip.hp.shield -= absorbed;
    dmg -= absorbed;
    dealt += absorbed;
    tShip.hp.shieldRegenDelay = 6;
    // Starsector 口径：非光束→硬幅能；光束→软热量（doc34 §3.2.2）
    if (weapon?.kind === 'beam') target.softHeat = (target.softHeat || 0) + absorbed * HARD_FLUX_SHIELD_RATE;
    else target.hardFlux = (target.hardFlux || 0) + absorbed * HARD_FLUX_SHIELD_RATE;
  }
  if (dmg > 0) {
    const residualArmor = Math.max(tShip.hp.armor, tShip.stats.armor * 0.05); // 5% 残余装甲底线
    const aAbsorbed = Math.min(residualArmor, dmg * 0.7);
    tShip.hp.armor = Math.max(0, tShip.hp.armor - aAbsorbed);
    dmg -= aAbsorbed;
    dealt += aAbsorbed;
  }
  const structureBefore = tShip.hp.structure;
  if (dmg > 0) {
    const sAbsorbed = Math.min(tShip.hp.structure, dmg);
    tShip.hp.structure -= sAbsorbed;
    dealt += sAbsorbed;
  }
  // 4) 分部穿透（护盾归零后或侧后命中才入部；过剩伤害按比例转千分比损伤）
  if (dmg > 0 || sector !== 'bow') {
    const excess = Math.max(0, dmg) + (sector !== 'bow' ? Math.min(dmg, baseDamage * 0.2) : 0);
    const subRes = applySubsystemDamage(world, battle, target, tShip, excess, sector);
    if (subRes.exploded) {
      tShip.hp.structure = 0;
    }
  }
  battle.damageDealt[side] = (battle.damageDealt[side] || 0) + dealt;
  const destroyed = tShip.hp.structure <= 0;
  return { destroyed, totalDealt: dealt, structureBefore };
}

/**
 * 热幅能推进（firingBehavior 每步调用；dt 为战斗秒）。
 * 软热量/硬幅能随散热速率消散（排热态 ×2.5）；总量达容量 → 6s 过载。
 * @returns {{overloaded:boolean}}
 */
export function stepFlux(world, battle, u, ship, dt) {
  const mods = subsystemModifiers(ship);
  const baseDiss = (ship.stats.heatDissipation || 12) * mods.heatDissipationMult;
  const ventMult = u.ventingTimer > 0 ? VENT_DISSIPATION : 1.0;
  u.softHeat = Math.max(0, (u.softHeat || 0) - baseDiss * ventMult * dt);
  const hardDiss = baseDiss * (u.ventingTimer > 0 ? VENT_DISSIPATION : HARD_FLUX_DISSIPATION); // 护盾开启仅 20% 速率
  u.hardFlux = Math.max(0, (u.hardFlux || 0) - hardDiss * dt);
  if (u.ventingTimer > 0) u.ventingTimer = Math.max(0, u.ventingTimer - dt);
  if (u.overloadTimer > 0) u.overloadTimer = Math.max(0, u.overloadTimer - dt);
  const total = (u.softHeat || 0) + (u.hardFlux || 0);
  if (total >= FLUX_CAPACITY && u.overloadTimer <= 0) {
    u.overloadTimer = OVERLOAD_SECONDS;
    u.softHeat = 0;
    u.hardFlux = 0;
    const ship2 = world.entities.ships[u.shipId];
    if (ship2) ship2.hp.shield = 0; // 护盾瞬间清零
    emit(world, 'FluxOverload', { battleId: battle.id, shipId: u.shipId, seconds: OVERLOAD_SECONDS }, 'combat');
    return { overloaded: true };
  }
  return { overloaded: false };
}

/** 三层近防 + 舰载机中队推进（missileStep v2 路径；返回 true 表示弹体被拦截/摧毁） */
export function tryLayeredInterception(world, battle, projectile, target, dt) {
  // 外圈 350m：护航截击机中队（每中队每秒 18 动能拦截伤害）
  const pHp = projectile.hp ?? 12;
  let hp = pHp;
  for (const s of battle.squadrons || []) {
    if (s.side !== target.side || s.strength <= 0 || s.kind !== 'interceptor') continue;
    const carrier = world.entities.ships[s.carrierShipId];
    if (!carrier || carrier.status !== 'active') continue;
    if (dist2d(s, target) > 350) continue;
    hp -= 18 * dt * (s.strength / 12);
    s._dmgDealt = (s._dmgDealt || 0) + 18 * dt * (s.strength / 12);
  }
  // 中圈 180m：高追踪武器（tracking ≥ 2.0）光速点杀（确定性概率）
  for (const u of battle.units) {
    if (u.side !== target.side || u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (!ship || ship.status !== 'active') continue;
    if (dist2d(u, target) > 180) continue;
    for (const w of ship.stats.weapons || []) {
      if ((w.tracking ?? 0) < 2.0) continue;
      if (deterministicChance(world, `${u.shipId}:mid`, battle.time, 350)) { hp -= 14; break; }
    }
  }
  // 内圈 100m：近防炮（tracking 3.8，高射速弹幕）
  for (const u of battle.units) {
    if (u.side !== target.side || u.destroyed) continue;
    const ship = world.entities.ships[u.shipId];
    if (!ship || ship.status !== 'active') continue;
    if (dist2d(u, target) > 100) continue;
    for (const w of ship.stats.weapons || []) {
      if (w.range !== 140) continue; // mod_pd_turret 特征（range 140 / tracking 3.8）
      if (deterministicChance(world, `${u.shipId}:inner`, battle.time, 550)) { hp -= 16; break; }
    }
  }
  if (hp <= 0) {
    projectile.destroyed = true;
    return true;
  }
  projectile.hp = hp;
  return false;
}

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 舰载机中队步进（stepOneBattle v2 路径；聚合单元代表 12 架，FFF#176 纪律） */
export function stepSquadrons(world, battle, dt) {
  for (const s of battle.squadrons || []) {
    const carrier = world.entities.ships[s.carrierShipId];
    if (!carrier || carrier.status !== 'active') {
      s.dissolveS = (s.dissolveS ?? 10) - dt; // 母舰被毁：10s 燃料耗尽散逸
      continue;
    }
    if (s.dissolveS !== undefined && s.dissolveS > 0) { s.dissolveS = Math.max(0, s.dissolveS - dt); if (s.dissolveS === 0) s.strength = 0; }
    if (s.strength <= 0) continue;
    // 锁定最近敌方单位
    if (s.targetUnitIdx === null || !battle.units[s.targetUnitIdx] || battle.units[s.targetUnitIdx].destroyed) {
      let best = null;
      let bestD = Infinity;
      battle.units.forEach((u, i) => {
        if (u.destroyed || u.side === s.side) return;
        const d = dist2d(s, u);
        if (d < bestD) { bestD = d; best = i; }
      });
      s.targetUnitIdx = best;
    }
    const target = s.targetUnitIdx !== null ? battle.units[s.targetUnitIdx] : null;
    if (!target) continue;
    s.cooldown = Math.max(0, s.cooldown - dt);
    // 向目标移动
    const dx = target.x - s.x;
    const dy = target.y - s.y;
    const dl = Math.hypot(dx, dy) || 1;
    s.x += (dx / dl) * 55 * dt;
    s.y += (dy / dl) * 55 * dt;
    if (s.cooldown <= 0 && dl < 60) {
      s.cooldown = 1.0;
      if (s.kind === 'bomber') {
        // 反舰鱼雷轰炸：直接伤害目标舰
        const tShip = world.entities.ships[target.shipId];
        if (tShip) {
          tShip.hp.armor = Math.max(0, tShip.hp.armor - 6);
          tShip.hp.structure = Math.max(0, tShip.hp.structure - 8 * (s.strength / 12));
          battle.damageDealt[s.side] = (battle.damageDealt[s.side] || 0) + 8 * (s.strength / 12);
          if (tShip.hp.structure <= 0) target.destroyed = true;
        }
      }
      // 拦截伤害在 tryLayeredInterception 外圈层结算
    }
  }
  battle.squadrons = (battle.squadrons || []).filter((s) => s.strength > 0);
}
