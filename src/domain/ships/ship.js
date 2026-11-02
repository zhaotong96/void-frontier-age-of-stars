/**
 * domain/ships/ship.js — 舰船实体、属性计算与装配合法性（任务书 4.8 / SHIP-01）
 *
 * 舰船 = 船体（content/hulls）+ 模块组合（content/modules）。
 * 统计值由 computeShipStats 纯函数推导（船体基准 + 模块效果 + 功率/热约束）。
 */

import { HULLS } from '../../content/hulls.js';
import { MODULES } from '../../content/modules.js';
import { clamp } from '../../core/math.js';
import { createEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';

const hullIndex = new Map(HULLS.map((h) => [h.id, h]));
const moduleIndex = new Map(MODULES.map((m) => [m.id, m]));

export function hullDef(id) {
  return hullIndex.get(id);
}
export function moduleDef(id) {
  return moduleIndex.get(id);
}

/**
 * 装配校验（SHIP-01）：槽位数、功率、CPU。
 * 返回 { ok, errors:[{code, reason}], stats? }
 */
export function validateFit(hullId, moduleIds) {
  const hull = hullIndex.get(hullId);
  if (!hull) return { ok: false, errors: [{ code: 'NO_HULL', reason: '未知船体' }] };
  const errors = [];
  const used = { high: 0, mid: 0, low: 0 };
  let power = hull.baseStats.power; // 舰体基础发电（反应堆外）
  let cpu = 0;
  let hasReactor = false;

  for (const mid of moduleIds) {
    const def = moduleIndex.get(mid);
    if (!def) {
      errors.push({ code: 'NO_MODULE', reason: `未知模块 ${mid}` });
      continue;
    }
    used[def.slotType] += 1;
    power += def.power;
    cpu += def.cpu;
    if (def.category === 'reactor') hasReactor = true;
  }
  for (const slot of ['high', 'mid', 'low']) {
    if (used[slot] > hull.slots[slot]) {
      errors.push({ code: 'SLOT_OVERFLOW', reason: `${slot.toUpperCase()} 槽位超限（${used[slot]}/${hull.slots[slot]}）` });
    }
  }
  if (!hasReactor && moduleIds.length > 0) {
    // 未装反应堆也能装配，但标记为不可启动
    errors.push({ code: 'NO_REACTOR', reason: '缺少反应堆，舰船无法启动' });
  }
  if (power < 0) {
    errors.push({ code: 'POWER_DEFICIT', reason: `功率不足（缺口 ${-power}）` });
  }
  if (cpu > hull.baseStats.cpu) {
    errors.push({ code: 'CPU_DEFICIT', reason: `算力不足（${cpu}/${hull.baseStats.cpu}）` });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 由船体+模块推导完整统计。
 * 返回：hp 层、功率/算力、速度、机动、货舱、传感器、武器清单等。
 */
export function computeShipStats(hullId, moduleIds, factionMods = null) {
  const hull = hullIndex.get(hullId);
  if (!hull) return null;
  const s = {
    structure: hull.baseStats.structure,
    armor: hull.baseStats.armor,
    shield: hull.baseStats.shield,
    shieldRegen: Math.max(1, Math.round(hull.baseStats.shield * 0.02)),
    power: hull.baseStats.power,
    cpu: 0,
    strategicSpeed: hull.baseStats.strategicSpeed,
    acceleration: 6 + (hull.category === 'combat' ? 4 : 0),
    turnRate: 0.9,
    maxSpeed: 40 + hull.baseStats.strategicSpeed * 10,
    fuelEfficiency: 1.0,
    fuelCap: hull.baseStats.fuelCap,
    cargo: hull.baseStats.cargo,
    sensor: hull.baseStats.sensor,
    signature: hull.baseStats.signature,
    lockons: hull.baseStats.lockons,
    hangar: hull.baseStats.hangar,
    crew: hull.baseStats.crew,
    ewarStrength: 0,
    trackingBonus: 0,
    weaponDamage: 1,
    weaponRange: 1,
    repairRate: 0,
    pdEfficiency: 0,
    hitChanceBonus: 0,
    evasionBonus: 0,
    heatDissipation: 12,
    weapons: [],
    miningRating: 0,
  };
  let powerUsedByModules = 0;
  let powerGenerated = hull.baseStats.power;
  for (const mid of moduleIds) {
    const def = moduleIndex.get(mid);
    if (!def) continue;
    s.cpu += def.cpu;
    if (def.power < 0) powerUsedByModules += -def.power;
    else powerGenerated += def.power;
    if (def.effects) {
      for (const e of def.effects) {
        const key = e.stat;
        if (s[key] !== undefined) {
          s[key] = e.mode === 'mult' ? s[key] * e.value : s[key] + e.value;
        } else {
          s[key] = e.value;
        }
      }
    }
    if (def.weapon) {
      s.weapons.push({
        moduleId: def.id,
        nameZh: def.nameZh,
        ...def.weapon,
      });
    }
    if (def.category === 'mining') s.miningRating += 10;
  }
  s.powerNet = powerGenerated - powerUsedByModules;
  s.power = powerGenerated; // 总供电能力
  s.powerUsed = powerUsedByModules;

  // 文明修正（乘数层）
  if (factionMods) {
    const m = (stat) => factionMods[stat] ?? 1;
    s.strategicSpeed *= m('strategicSpeed');
    s.fuelEfficiency *= m('fuelEfficiency');
    s.sensor *= m('sensorStrength');
    s.ewarStrength *= m('ewarStrength');
    s.weaponDamage *= m('weaponDamage');
    s.shield *= m('maxShield');
    s.shieldRegen *= m('shieldRegen');
    s.armor *= m('armor');
  }

  // 边界保护（防 NaN/负值扩散）
  for (const k of Object.keys(s)) {
    if (typeof s[k] === 'number' && !Number.isFinite(s[k])) s[k] = 0;
  }
  s.structure = Math.max(1, Math.round(s.structure));
  s.armor = Math.max(0, Math.round(s.armor));
  s.shield = Math.max(0, Math.round(s.shield));
  return s;
}

/**
 * 创建舰船实体（船坞生产与开局投放共用）。
 * opts = { factionId, hullId, moduleIds, name?, fleetId?, cargo?, fuel? }
 */
export function createShip(world, opts) {
  const hull = hullIndex.get(opts.hullId);
  if (!hull) throw new Error(`createShip: 未知船体 ${opts.hullId}`);
  const factionMods = opts.factionMods || null;
  const stats = computeShipStats(opts.hullId, opts.moduleIds || [], factionMods);
  const ship = createEntity(world, 'ships', {
    factionId: opts.factionId,
    fleetId: opts.fleetId || null,
    hullId: opts.hullId,
    modules: (opts.moduleIds || []).slice().sort(),
    name: opts.name || hull.nameZh,
    blueprintId: opts.blueprintId || null,
    stats,
    hp: {
      structure: stats.structure,
      armor: stats.armor,
      shield: stats.shield,
      shieldMax: stats.shield,
    },
    powerNet: stats.powerNet,
    cargo: opts.cargo || {},
    fuel: opts.fuel ?? Math.round(stats.fuelCap * 0.8),
    ammo: {},
    crew: { assigned: stats.crew, healthy: stats.crew },
    xp: 0,
    status: 'active', // active|disabled|captured|destroyed
    systemId: opts.systemId || null,
    buildTick: world.tick,
  });
  // 舰船↔舰队双向一致性（invariant 约定）
  if (ship.fleetId) {
    const fleet = world.entities.fleets[ship.fleetId];
    if (fleet && !fleet.shipIds.includes(ship.id)) fleet.shipIds.push(ship.id);
  }
  emit(world, 'ShipCompleted', { shipId: ship.id, factionId: ship.factionId, hullId: ship.hullId }, 'fleet');
  return ship;
}

/** 舰船受创（战斗系统调用；幂等：不重复结算） */
export function applyDamage(world, ship, amount, layer = 'structure') {
  if (ship.status === 'destroyed') return 0;
  const hp = ship.hp;
  const before = hp.structure;
  hp[layer] = Math.max(0, hp[layer] - amount);
  if (layer === 'shield') {
    hp.shieldRegenDelay = 6;
  }
  if (hp.structure <= 0) {
    destroyShip(world, ship, 'combat');
  }
  return before - hp.structure;
}

/** 舰船销毁：从舰队移除、保留历史（任务书 2.3 引用清理） */
let _fateHook = null;
/** 注入人物命运钩子（crew.onShipDestroyed；避免循环导入） */
export function setFateHook(fn) {
  _fateHook = fn;
}

export function destroyShip(world, ship, cause) {
  if (ship.status === 'destroyed') return;
  ship.status = 'destroyed';
  if (_fateHook) {
    try {
      _fateHook(world, ship);
    } catch { /* 人物结算失败不阻断战斗 */ }
  }
  ship.destroyedTick = world.tick;
  ship.destroyCause = cause;
  if (ship.fleetId) {
    const fleet = world.entities.fleets[ship.fleetId];
    if (fleet) {
      fleet.shipIds = fleet.shipIds.filter((id) => id !== ship.id);
    }
    ship.fleetId = null;
  }
  emit(world, 'ShipDestroyed', { shipId: ship.id, factionId: ship.factionId, cause }, 'combat');
}

/** 护盾每小时再生 */
export function regenShield(world, ship) {
  const hp = ship.hp;
  if (hp.shield < hp.shieldMax && ship.status === 'active') {
    const regen = ship.stats.shieldRegen / 24; // stats.shieldRegen 是每战斗秒口径 → 每小时用/24 的近似口径在战斗外按小时恢复
    hp.shield = Math.min(hp.shieldMax, hp.shield + Math.max(0.5, regen));
    hp.shield = Math.round(hp.shield * 10) / 10;
  }
}
