/**
 * tests/fuzz/CommandMutator.js — 命令参数混沌变异器（doc26 §2.2）
 *
 * 对全量注册命令的 payload 注入三类变异算子（doc26 §2.2 逐项）：
 * 数值型 / 引用型 / 结构型。全部随机性来自 src/core/rng.js 确定性子流
 * （Iron Discipline 1：严禁 Math.random）。
 */

import { pick, int, intRange, chance, seedFromNumber } from '../../src/core/rng.js';

/** 数值型变异算子（doc26 §2.2.1） */
export const NUMERIC_MUTATIONS = [0, -1, -999999, 1e20, NaN, Infinity, -Infinity, 0.0000001, Number.MAX_VALUE];

/** 引用型变异算子（doc26 §2.2.2） */
export const REFERENCE_MUTATIONS = [null, undefined, '', '   ', 'INVALID_ENTITY_ID_9999', '__proto__', '<script>alert(1)</script>'];

/** 结构型变异算子工厂（doc26 §2.2.3；循环引用单列 —— 见 FuzzStorm 的循环引用隔离探针） */
export function structuralMutations() {
  return {
    empty: {},
    swappedKeys: { targetId: 'fleetId', fleetId: 'planetId', planetId: 'systemId' },
    protoKey: JSON.parse('{"__proto__":{"polluted":1},"qty":1}'),
    deepNested: { a: { b: { c: { d: { e: [1, [2, [3, {}]]] } } } } },
  };
}

/** 循环引用对象工厂（结构型·循环引用；仅用于隔离探针） */
export function makeCyclic() {
  const c = { name: 'cyclic-probe' };
  c.self = c;
  return c;
}

/** 常见命令参数键位池（按命令类型启发式，覆盖实体 id / 数量 / 坐标 / 枚举） */
const KEY_POOL = [
  'fleetId', 'shipId', 'planetId', 'colonyId', 'systemId', 'stationId', 'blueprintId',
  'anomalyId', 'missionId', 'targetSystemId', 'targetFactionId', 'factionId', 'objectiveId',
  'eventId', 'choiceId', 'defId', 'hullId', 'techId', 'resId', 'poiId', 'ruinId',
  'qty', 'amount', 'x', 'z', 'radius', 'strength', 'level', 'index', 'slot',
  'stance', 'op', 'brush', 'resTypeIdx', 'units', 'templateId', 'siteId', 'edictId',
  'squadCharacterIds', 'modules', 'input',
];

const ENUM_POOL = ['aggressive', 'hold', 'patrol', 'escort', 'raise', 'lower', 'smooth', 'flatten', 'restore', 'plant', 'removePlant'];

export class CommandMutator {
  constructor(seed) {
    this.state = seedFromNumber(seed);
  }

  /** 生成一条变异命令 { type, actorId, params } */
  mutateCommand(commandTypes, actorId, world) {
    const s = this.state;
    const type = pick(s, commandTypes);
    const params = this.buildParams(type, world, s);
    const actorRoll = int(s, 3);
    const actor = actorRoll === 0 ? actorId : actorRoll === 1 ? null : pick(s, REFERENCE_MUTATIONS.filter((v) => typeof v === 'string'));
    return { type, actorId: actor, targetId: chance(s, 0.2) ? pick(s, REFERENCE_MUTATIONS) : null, params };
  }

  buildParams(type, world, s) {
    const params = {};
    const nKeys = intRange(s, 1, 4);
    const mode = int(s, 3); // 0 数值为主 1 引用为主 2 混合
    for (let i = 0; i < nKeys; i++) {
      const key = pick(s, KEY_POOL);
      let val;
      if (mode === 0) val = pick(s, NUMERIC_MUTATIONS);
      else if (mode === 1) val = pick(s, REFERENCE_MUTATIONS);
      else val = chance(s, 0.5) ? pick(s, NUMERIC_MUTATIONS) : pick(s, REFERENCE_MUTATIONS);
      // 少量「半合法」注入：真实实体 id 配非法数值 / 真实枚举配悬空实体
      if (chance(s, 0.15)) {
        val = pick(s, ENUM_POOL);
      }
      if (chance(s, 0.1) && world && world.entities.fleets) {
        const ids = Object.keys(world.entities.fleets);
        if (ids.length > 0) val = pick(s, ids); // 真实 id + 其余字段非法（跨星系错配/悬空引用的合法面）
      }
      params[key] = val;
    }
    // 结构型污染（不含循环引用——循环引用走 FuzzStorm 隔离探针）
    if (chance(s, 0.08)) {
      const sm = structuralMutations();
      Object.assign(params, pick(s, [sm.empty, sm.swappedKeys, sm.protoKey, sm.deepNested]));
    }
    return params;
  }
}

/** 路由哈希变异池（doc26 §2.1：合法/半合法/未知路由 + 畸形哈希） */
export const ROUTE_MUTATION_POOL = [
  '#/menu', '#/galaxy', '#/system/sys_01', '#/colony/col_1', '#/fleet/flt_1', '#/designer',
  '#/combat/bat_1', '#/research', '#/market', '#/diplomacy', '#/government', '#/ground/plt_1',
  '#/events', '#/chronicle', '#/settings', '#/diagnostics',
  // 半合法 / 未知 / 畸形（doc26 §2.1 变异策略）
  '#/ground/invalid_planet', '#/unknown_route', '#/system/', '#/', '#', '#//', '#/system/a/b/c',
  '#/COLONY/col_1', '#/system/%20%20', '#/system/__proto__', '#/system/<script>', '#/../../etc',
  '#/system/sys_01?nosw=1', '#/system/sys_01#fragment', '#/' + 'x'.repeat(300),
];

/** 生成一条变异路由哈希 */
export function mutateRoute(s) {
  const base = pick(s, ROUTE_MUTATION_POOL);
  if (chance(s, 0.7)) return base;
  // 复合变异：随机拼接双路由 / 截断 / 大小写翻转
  const other = pick(s, ROUTE_MUTATION_POOL);
  const roll = int(s, 3);
  if (roll === 0) return base + other;
  if (roll === 1) return base.slice(0, Math.max(1, Math.floor(base.length / 2)));
  return base.toUpperCase();
}
