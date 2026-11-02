/**
 * domain/characters/crew.js — 船员与人物系统（任务书 5.8 / 15.1）
 *
 * 紧凑实现：舰队指挥官与关键岗位人物实体；经验/升级/特质/忠诚；
 * 舰船损失 → 人物命运写入人物史；人物影响舰队小幅度加成（不决定胜负）。
 */

import { createEntity, listByFaction } from '../entities/registry.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { RNG } from '../../core/rng.js';

const NAMES_A = ['赵', '沈', '林', '洛', '叶', '苏', '霍', '秦', '温', '裴', '宋', '楚'];
const NAMES_B = ['衡', '嵘', '澜', '晞', '曜', '珩', '汐', '澈', '铮', '萤', '昭', '湮'];
const ROLES = [
  { id: 'captain', nameZh: '舰长', fleetBonus: { morale: 4 } },
  { id: 'navigator', nameZh: '导航官', fleetBonus: { strategicSpeed: 0.05 } },
  { id: 'engineer', nameZh: '工程官', fleetBonus: { repairRate: 0.08 } },
  { id: 'science', nameZh: '科学官', fleetBonus: { sensor: 0.06 } },
  { id: 'tactical', nameZh: '战术官', fleetBonus: { hitChanceBonus: 0.02 } },
  { id: 'diplomat', nameZh: '外交官', fleetBonus: {} },
  { id: 'medic', nameZh: '医疗官', fleetBonus: {} },
  { id: 'intel', nameZh: '情报官', fleetBonus: {} },
];

const TRAIT_POOL = [
  { id: 'steady', nameZh: '沉着', descZh: '压力积累减缓' },
  { id: 'bold', nameZh: '果决', descZh: '战术小队成功率提升' },
  { id: 'bookish', nameZh: '好学', descZh: '经验获取 +20%' },
  { id: 'gambler', nameZh: '冒险家', descZh: '高风险行动偏好' },
  { id: 'gregarious', nameZh: '亲和', descZh: '忠诚度衰退减缓' },
];

function genName(world) {
  return NAMES_A[RNG.int(world, NAMES_A.length)] + NAMES_B[RNG.int(world, NAMES_B.length)];
}

/** 为文明生成初始人物（每舰队一名舰长 + 少量储备） */
export function initCrew(world, factionId) {
  const created = [];
  const fleets = listByFaction(world, 'fleets', factionId);
  for (const fleet of fleets) {
    const c = createCharacter(world, factionId, 'captain', `${fleet.name} 舰长`);
    assignToFleet(world, c.id, fleet.id);
    created.push(c.id);
  }
  // 储备军官 2 名
  for (let i = 0; i < 2; i++) {
    const role = ROLES[1 + RNG.int(world, ROLES.length - 1)];
    created.push(createCharacter(world, factionId, role.id, '储备军官').id);
  }
  return created;
}

export function createCharacter(world, factionId, roleId, note) {
  const role = ROLES.find((r) => r.id === roleId) || ROLES[0];
  const traits = [TRAIT_POOL[RNG.int(world, TRAIT_POOL.length)].id];
  const c = createEntity(world, 'characters', {
    factionId,
    name: genName(world),
    species: 'human',
    age: 28 + RNG.int(world, 22),
    role: role.id,
    roleName: role.nameZh,
    fleetId: null,
    level: 1,
    xp: 0,
    traits,
    loyalty: 65 + RNG.int(world, 20),
    stress: 0,
    health: 'healthy', // healthy|wounded|missing|dead
    history: [],
    note: note || '',
    statModifiers: role.fleetBonus || {},
  });
  c.history.push({ tick: world.tick, event: '入职', note: note || role.nameZh });
  return c;
}

/** 经验获取（战斗/任务/科研事件调用） */
export function gainXp(world, characterId, amount, reason) {
  const c = world.entities.characters[characterId];
  if (!c || c.health === 'dead') return;
  const mult = c.traits.includes('bookish') ? 1.2 : 1;
  c.xp += Math.round(amount * mult);
  const need = c.level * 100;
  if (c.xp >= need) {
    c.xp -= need;
    c.level += 1;
    c.history.push({ tick: world.tick, event: `晋升 Lv${c.level}`, reason: reason || '' });
    emit(world, 'CharacterPromoted', { characterId, level: c.level }, 'politics');
  }
}

/** 舰船被毁时的命运结算（战斗系统调用） */
export function onShipDestroyed(world, ship) {
  const fleet = ship.fleetId ? world.entities.fleets[ship.fleetId] : null;
  const cmdId = fleet?.commanderId;
  if (!cmdId) return;
  const c = world.entities.characters[cmdId];
  if (!c || c.health === 'dead') return;
  const roll = RNG.float(world);
  if (roll < 0.45) {
    c.health = 'dead';
    c.history.push({ tick: world.tick, event: '阵亡', note: ship.name });
    chronicle(world, 'politics', `${c.roleName} ${c.name} 随 ${ship.name} 阵亡`, { characterId: c.id });
    emit(world, 'CharacterDied', { characterId: c.id, shipId: ship.id }, 'politics');
  } else if (roll < 0.8) {
    c.health = 'wounded';
    c.stress = Math.min(100, c.stress + 25);
    c.history.push({ tick: world.tick, event: '负伤获救', note: ship.name });
  } else {
    c.health = 'missing';
    c.history.push({ tick: world.tick, event: '失踪', note: ship.name });
  }
  if (fleet) fleet.commanderId = null;
}

/** 指派人物到舰队（AssignCharacter 命令执行体） */
export function assignToFleet(world, characterId, fleetId) {
  const c = world.entities.characters[characterId];
  const f = world.entities.fleets[fleetId];
  if (!c || c.health === 'dead') return { ok: false, reason: '人物不可用' };
  if (c.fleetId) {
    const old = world.entities.fleets[c.fleetId];
    if (old && old.commanderId === c.id) old.commanderId = null;
  }
  c.fleetId = fleetId;
  if (f) {
    f.commanderId = characterId;
    c.history.push({ tick: world.tick, event: '就任', note: f.name });
  }
  return { ok: true };
}

/** 舰队指挥官加成（战斗/航行读取） */
export function fleetCommanderBonus(world, fleet) {
  if (!fleet?.commanderId) return null;
  const c = world.entities.characters[fleet.commanderId];
  if (!c || c.health !== 'healthy') return null;
  const bonus = { ...(c.statModifiers || {}) };
  for (const k of Object.keys(bonus)) bonus[k] *= 1 + (c.level - 1) * 0.15;
  return { characterId: c.id, name: c.name, level: c.level, bonus };
}

/** 文明人物列表视图数据 */
export function crewView(world, factionId) {
  return listByFaction(world, 'characters', factionId).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.roleName,
    level: c.level,
    xp: c.xp,
    xpNeed: c.level * 100,
    traits: c.traits.map((t) => TRAIT_POOL.find((x) => x.id === t)?.nameZh || t),
    loyalty: Math.round(c.loyalty),
    stress: Math.round(c.stress),
    health: c.health,
    healthName: { healthy: '健康', wounded: '负伤', missing: '失踪', dead: '殉职' }[c.health] || c.health,
    fleetName: c.fleetId ? world.entities.fleets[c.fleetId]?.name || null : null,
    history: (c.history || []).slice(-6),
  }));
}
