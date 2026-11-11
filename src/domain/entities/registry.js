/**
 * domain/entities/registry.js — 实体注册表（任务书 2.3）
 *
 * 实体为 Plain Data：至少含 id、type、createdAtTick 与归属字段。
 * 删除实体时由调用方负责清理引用（如舰船被摧毁后从舰队成员表移除，
 * 但战斗历史与归属史保留）。
 */

import { nextId } from '../../core/ids.js';
import { ENTITY_TYPES } from '../world/World.js';

/** 危险键守卫（F-14）：'__proto__'/'constructor' 等键经 getEntity/赋值路径
 *  会触碰对象原型——模糊测试实证 `world.entities.planets['__proto__']` 返回
 *  Object.prototype，ensure* 工厂随即污染全局原型（所有后续世界继承
 *  ind/threat 容器 → 每 tick 工业步进 + 金快照漂移）。 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 创建实体并插入集合，返回实体 */
export function createEntity(world, collection, fields) {
  const type = ENTITY_TYPES[collection];
  if (!type) throw new Error(`registry: 未知集合 ${collection}`);
  if (world.entities[collection] === undefined) {
    world.entities[collection] = {};
  }
  const rawId = fields.id || nextId(world, type);
  const id = DANGEROUS_KEYS.has(rawId) ? nextId(world, type) : rawId;
  const e = { id, type, createdAtTick: world.tick, ...fields };
  e.id = id; // 防止 fields 覆盖
  world.entities[collection][id] = e;
  return e;
}

/** 读取实体（不存在返回 undefined；F-14 危险键一律返回 undefined） */
export function getEntity(world, collection, id) {
  if (id == null || typeof id !== 'string' || DANGEROUS_KEYS.has(id)) return undefined;
  return world.entities[collection]?.[id];
}

/** 删除实体（仅移除条目，引用清理由调用方完成） */
export function removeEntity(world, collection, id) {
  if (world.entities[collection]) delete world.entities[collection][id];
}

/** 确定性遍历某集合（按 id 排序） */
export function eachEntity(world, collection, fn) {
  const bag = world.entities[collection];
  if (!bag) return;
  for (const id of Object.keys(bag).sort()) fn(bag[id], id);
}

/** 某集合实体的确定性数组 */
export function listEntities(world, collection) {
  const bag = world.entities[collection] || {};
  return Object.keys(bag).sort().map((id) => bag[id]);
}

/** 按阵营过滤实体 */
export function listByFaction(world, collection, factionId) {
  return listEntities(world, collection).filter((e) => e.factionId === factionId);
}

/** 实体计数 */
export function countEntities(world, collection) {
  return Object.keys(world.entities[collection] || {}).length;
}
