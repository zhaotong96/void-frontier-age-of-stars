/**
 * domain/strategic/orbitalSynergy.js — 天地一体空地战略协同（doc22 v1.0 WP-1/WP-3）
 *
 * 轨道向下五大支援（doc16 §4.24）：精准激光（7）/动能打击/EW 压制/机甲空投（8）/
 * 战术补给舱（9）——每次呼叫受轨道舰队构成/燃料/冷却真实约束（严禁无限免费按钮）。
 * 激光洗地自动触发 ShapeTerrain(lower) + HarvestTerrainOre（真实开山）。
 *
 * 地面向上（doc22 WP-3）：高地离子炮每战略小时向入轨敌对封锁舰队齐射——
 * 命中率依赖地面雷达在线（无雷达 20%），高程每 +10m 穿甲 +12%（上限 +35%），
 * 50% 穿盾直击装甲层。
 *
 * 确定性红线：零 Math.random()、零 world.rng 消费（弹着散布由种子派生）。
 */

import { clamp } from '../../core/math.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { applyDamage } from '../ships/ship.js';

/** 轨道支援冷却与消耗（doc22 WP-1.2 契约） */
export const SUPPORT_SPECS = Object.freeze({
  support_orbital_laser: { cooldownS: 45, fuelCost: 15, key: 'Digit7', needEnergyWeapon: true },
  support_kinetic_strike: { cooldownS: 180, fuelCost: 30, key: 'Digit6', needMassDriver: true, aoe: 400 },
  support_electronic_warfare: { cooldownS: 90, fuelCost: 10, key: null, needEwar: true, durationS: 30 },
  support_mech_drop: { cooldownS: 120, fuelCost: 0, cost: { alloy: 20, powerCell: 2 }, key: 'Digit8', needHangar: true },
  support_supply_pod: { cooldownS: 60, fuelCost: 5, key: 'Digit9', durationS: 90 },
});

/**
 * 检索同星系非受困己方舰队（doc22 WP-1.2 契约：fleet.systemId === planet.systemId
 * 且 status !== 'stranded'；返回满足能力谓词的主力舰列表）。
 */
export function findSupportFleet(world, planet, pred) {
  const fleets = Object.values(world.entities.fleets || {}).filter(
    (f) => f.systemId === planet.systemId && f.status !== 'stranded'
      && (!f.factionId || f.factionId === world.playerFactionId),
  );
  const ships = [];
  for (const f of fleets) {
    for (const sid of f.shipIds || []) {
      const sh = world.entities.ships[sid];
      if (sh && sh.status === 'active' && (!pred || pred(sh))) ships.push(sh);
    }
  }
  return ships;
}

/** 舰船能力谓词（能量武器/质量投射器/电子战/机库） */
export const CAPS = Object.freeze({
  energyWeapon: (sh) => (sh.modules || []).some((m) => String(m).includes('laser') || String(m).includes('particle')),
  massDriver: (sh) => (sh.modules || []).some((m) => String(m).includes('railgun') || String(m).includes('mass')),
  ewar: (sh) => (sh.modules || []).some((m) => String(m).includes('ewar') || String(m).includes('jammer')),
  hangar: (sh) => (sh.stats && sh.stats.hangar > 0) || sh.hullId === 'hull_carrier',
});

/**
 * 轨道支援呼叫域结算（CallOrbitalSupport 命令执行体）。
 * @returns {{ok:boolean, reason?:string, effect?:object}}
 */
export function callOrbitalSupport(world, planet, kind, targetWx, targetWz) {
  const spec = SUPPORT_SPECS[kind];
  if (!spec) return { ok: false, reason: 'UnknownSupportKind' };
  // 冷却台账（挂 planet.fort，紧凑持久化）
  const fort = ensurePlanetFort(planet);
  const now = world.tick * 3600; // 任务秒口径（Hourly 粒度）
  const last = fort.supportCd[kind] || -1e9;
  if (now - last < spec.cooldownS) {
    return { ok: false, reason: `冷却中（${Math.ceil(spec.cooldownS - (now - last))}s）` };
  }
  // 舰队能力约束
  const pred = spec.needEnergyWeapon ? CAPS.energyWeapon
    : spec.needMassDriver ? CAPS.massDriver
      : spec.needEwar ? CAPS.ewar
        : spec.needHangar ? CAPS.hangar : null;
  const fleet = findSupportFleet(world, planet, pred);
  if (spec.needEnergyWeapon || spec.needMassDriver || spec.needEwar || spec.needHangar) {
    if (fleet.length === 0) return { ok: false, reason: '无满足能力的在轨舰队' };
  }
  // 磁暴制约（doc16 §4.24：磁暴期需地面雷达在线方可锁定）
  if (planet.threat && planet.threat.storm && planet.threat.storm[0]
    && STORM_IS_PLASMA(planet) && !radarOnline(world, planet)) {
    return { ok: false, reason: '电磁磁暴：需地面雷达在线方可锁定' };
  }
  // 资源消耗
  const fid = world.playerFactionId;
  const led = fid ? world.economy.ledgers[fid] : null;
  if (spec.fuelCost && fleet.length > 0) {
    const ship = fleet[0];
    ship.fuel = Math.max(0, ship.fuel - spec.fuelCost);
  }
  if (spec.cost && led) {
    for (const [res, qty] of Object.entries(spec.cost)) {
      if ((led.balances[res] || 0) < qty) return { ok: false, reason: `${res} 不足` };
      led.balances[res] -= qty;
    }
  }
  fort.supportCd[kind] = now;
  const effect = { kind, targetWx, targetWz, durS: spec.durationS || 6, aoe: spec.aoe || 0 };
  emit(world, 'OrbitalSupportCalled', { planetId: planet.id, ...effect }, 'ground');
  return { ok: true, effect };
}

function STORM_IS_PLASMA(planet) {
  return planet.threat && planet.threat.storm && planet.threat.storm[1] === 2; // kindIdx 2 = plasma
}

/** 惰性初始化 planet.fort（doc22 WP-4 v3 schema 同形；幂等） */
export function ensurePlanetFort(planet) {
  if (planet.fort && planet.fort.v === 1) return planet.fort;
  planet.fort = { v: 1, ionBatteries: [], planetaryShield: null, supportCd: {} };
  return planet.fort;
}

/** 地面轨道雷达在线判定（groundBuildings 中 orbitalRadar 定义的建筑） */
export function radarOnline(world, planet) {
  void world;
  const gbs = planet.groundBuildings || [];
  return gbs.some((gb) => {
    const id = String(gb.defId || '');
    return id === 'bld_orbital_radar' && (gb.state === undefined || gb.state === 'active');
  });
}

/** 行星天幕护盾当前容量（受电网供能回充；轨道轰炸入口扣减） */
export function planetaryShieldHp(world, planet) {
  void world;
  const fort = planet.fort;
  if (!fort || !fort.planetaryShield) return 0;
  const shield = fort.planetaryShield;
  return { hp: shield.hp || 0, hpMax: shield.hpMax || 3000 };
}

/**
 * 行星高地离子炮向入轨敌对舰队越级齐射（HourlySystems combat 阶段调用；
 * doc22 WP-3.2 契约实现——高程穿甲增益 + 雷达命中率门槛 + 2 小时冷却）。
 * @returns {number} 命中次数
 */
export function firePlanetaryIonBatteries(world, planet, hostileFleetsInSystem) {
  const fort = planet.fort;
  if (!fort || !Array.isArray(fort.ionBatteries) || fort.ionBatteries.length === 0) return 0;
  if (!hostileFleetsInSystem || hostileFleetsInSystem.length === 0) return 0;

  // 必须依赖地面雷达在线支持目标锁定，否则命中率跌落至 20%
  const radarOnlineFlag = radarOnline(world, planet);
  const hitChance = radarOnlineFlag ? 1.0 : 0.20;

  let totalHits = 0;
  for (const bat of fort.ionBatteries) {
    // bat 元组: [id, defIdx, x_dm, z_dm, y_dm, online, cdHours]
    if (!bat[5] || bat[4] <= 0) continue;
    if (bat[6] > 0) { bat[6] -= 1; continue; }

    const targetShip = findHeaviestHostileCapitalShip(world, hostileFleetsInSystem);
    if (!targetShip) break;

    const elevM = bat[4] / 10;
    const elevMult = clamp(1.0 + Math.max(0, elevM - 10) * 0.012, 1.0, 1.35);
    const rawDmg = Math.round(85 * elevMult * hitChance);

    applyDamage(world, targetShip, Math.round(rawDmg * 0.5), 'shield');
    applyDamage(world, targetShip, Math.round(rawDmg * 0.5), 'armor');
    bat[6] = 2; // 2 小时冷却
    totalHits += 1;

    emit(world, 'PlanetaryIonBatteryFired', {
      planetId: planet.id, batteryId: bat[0], targetShipId: targetShip.id, damage: rawDmg,
    }, 'combat');
  }
  return totalHits;
}

/** 最重敌舰锁定（结构值最大的主力舰优先） */
export function findHeaviestHostileCapitalShip(world, hostileFleetsInSystem) {
  let targetShip = null;
  let bestHullHp = -1;
  for (const fleet of hostileFleetsInSystem) {
    for (const sid of fleet.shipIds || []) {
      const sh = world.entities.ships[sid];
      if (sh && sh.status === 'active' && sh.hp.structure > bestHullHp) {
        bestHullHp = sh.hp.structure;
        targetShip = sh;
      }
    }
  }
  return targetShip;
}

/** 入轨敌对封锁舰队集合（HourlySystems combat 阶段检索） */
export function hostileFleetsInSystemOf(world, planet) {
  return Object.values(world.entities.fleets || {}).filter(
    (f) => f.systemId === planet.systemId && f.factionId
      && f.factionId !== world.playerFactionId
      && f.status !== 'stranded',
  );
}

/** chronicle 透传（供 HourlySystems 战果播报） */
export function announceIonSalvo(world, planet, hits) {
  if (hits > 0) {
    chronicle(world, 'combat', `行星 ${planet.name} 对空离子炮齐射 ${hits} 轮命中入轨敌舰`, { planetId: planet.id });
  }
}
