/**
 * domain/politics/policy.js — 政策颁布/撤销与结算（任务书 4.1）
 *
 * 规则：
 *  - 颁布支付影响力成本并占用行政容量（Σ政策 adminCost ≤ 行政容量）
 *  - 互斥组内同时只能生效一项
 *  - 定期法令 durationDays 到期自动失效并进入冷却
 *  - 撤销即时生效但不退还影响力，且进入冷却
 *  - 行政超载（governanceLoad > adminCapacity）→ 稳定度惩罚（4.1）
 * 效果经 fac.policies 由 modifiers.getMod 即时消费。
 */

import { POLICIES, policyDef } from '../../content/policies.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { balance, debit } from '../economy/ledger.js';
import { getMod } from '../factions/modifiers.js';
import { buildingDef } from '../planets/colony.js';
import { sortedKeys } from '../../core/math.js';

/** 行政容量 = 基础 20 + 行政建筑 ×10，经修正（从 ViewModels 下沉为领域函数） */
export function adminCapacity(world, factionId) {
  let adminBuildings = 0;
  for (const cid of sortedKeys(world.entities.colonies)) {
    const c = world.entities.colonies[cid];
    if (c.factionId !== factionId) continue;
    for (const b of c.buildings) {
      if (b.state === 'active' && buildingDef(b.defId)?.category === 'admin') adminBuildings++;
    }
  }
  return (20 + adminBuildings * 10) * (getMod(world, factionId, 'adminCapacity', 'mult') || 1);
}

/** 治理负担 = 殖民地 ×6 + 星系 ×2，经治理效率修正 */
export function governanceLoad(world, factionId) {
  let colonies = 0;
  let systems = 0;
  for (const cid of sortedKeys(world.entities.colonies)) {
    if (world.entities.colonies[cid].factionId === factionId) colonies++;
  }
  for (const sid of sortedKeys(world.entities.systems)) {
    if (world.entities.systems[sid].ownerFactionId === factionId) systems++;
  }
  return Math.round(colonies * 6 + systems * 2 * (getMod(world, factionId, 'governanceLoad', 'mult') || 1));
}

/** 政策状态（政府视图） */
export function policyStatus(world, factionId, policyId) {
  const def = policyDef(policyId);
  if (!def) return { status: 'unknown' };
  const fac = world.entities.factions[factionId];
  const enacted = fac.policies?.[policyId];
  const cd = world.narrative.flags[`policyCd:${factionId}:${policyId}`];
  if (enacted) {
    const expires = enacted.expiresTick || null;
    return {
      status: 'active',
      enactedTick: enacted.enactedTick,
      expiresTick: expires,
      remainingDays: expires ? Math.max(0, Math.ceil((expires - world.tick) / 24)) : null,
    };
  }
  if (typeof cd === 'number' && world.tick < cd) {
    return { status: 'cooldown', readyTick: cd, remainingDays: Math.ceil((cd - world.tick) / 24) };
  }
  return { status: 'available' };
}

/** 颁布校验（EnactPolicy 命令 validate 用；只读） */
export function canEnact(world, factionId, policyId) {
  const def = policyDef(policyId);
  if (!def) return { ok: false, code: 'NO_DEF', reason: '未知政策' };
  const fac = world.entities.factions[factionId];
  if (!fac) return { ok: false, code: 'NO_FACTION', reason: '文明不存在' };
  fac.policies ||= {};

  if (fac.policies[policyId]) return { ok: false, code: 'ACTIVE', reason: '该政策已生效' };

  // 冷却
  const cd = world.narrative.flags[`policyCd:${factionId}:${policyId}`];
  if (typeof cd === 'number' && world.tick < cd) {
    return { ok: false, code: 'COOLDOWN', reason: `冷却中（剩余 ${Math.ceil((cd - world.tick) / 24)} 日）` };
  }

  // 互斥组
  if (def.mutexGroup) {
    for (const pid of Object.keys(fac.policies)) {
      const other = policyDef(pid);
      if (other && other.mutexGroup === def.mutexGroup) {
        return { ok: false, code: 'MUTEX', reason: `与「${other.nameZh}」互斥，请先撤销` };
      }
    }
  }

  // 影响力成本
  if (def.cost.influence && balance(world, factionId, 'influence') < def.cost.influence) {
    return { ok: false, code: 'NO_INFLUENCE', reason: `影响力不足（需 ${def.cost.influence}）` };
  }

  // 行政容量：Σ已生效政策 adminCost + 本政策 ≤ 行政容量
  const used = usedAdminSlots(fac);
  const cap = adminCapacity(world, factionId);
  if (used + def.adminCost > cap) {
    return { ok: false, code: 'NO_ADMIN', reason: `行政容量不足（已占 ${used}/${cap}，需 ${def.adminCost}）` };
  }

  return { ok: true, def };
}

/** 已占用行政槽位 */
export function usedAdminSlots(fac) {
  let used = 0;
  for (const pid of Object.keys(fac.policies || {})) {
    const def = policyDef(pid);
    if (def) used += def.adminCost;
  }
  return used;
}

/** 颁布（命令 execute 体） */
export function enactPolicy(world, factionId, policyId) {
  const def = policyDef(policyId);
  const fac = world.entities.factions[factionId];
  fac.policies ||= {};
  debit(world, factionId, 'influence', def.cost.influence || 0, `enactPolicy:${policyId}`, null);
  fac.policies[policyId] = {
    nameZh: def.nameZh,
    effects: def.effects.map((e) => ({ ...e })),
    enactedTick: world.tick,
    expiresTick: def.durationDays ? world.tick + def.durationDays * 24 : null,
  };
  // 记录行政占用快照（UI 显示）
  fac.policySlots = usedAdminSlots(fac);
  emit(world, 'PolicyEnacted', { factionId, policyId }, 'politics');
  chronicle(world, 'politics', `颁布政策：${def.nameZh}`, { factionId, policyId });
  return { ok: true };
}

/** 撤销（命令 execute 体）：即时失效，进入冷却 */
export function revokePolicy(world, factionId, policyId) {
  const def = policyDef(policyId);
  const fac = world.entities.factions[factionId];
  if (!fac?.policies?.[policyId]) return { ok: false, reason: '政策未生效' };
  delete fac.policies[policyId];
  fac.policySlots = usedAdminSlots(fac);
  const cooldownTick = world.tick + (def.cooldownDays || 30) * 24;
  world.narrative.flags[`policyCd:${factionId}:${policyId}`] = cooldownTick;
  emit(world, 'PolicyRevoked', { factionId, policyId }, 'politics');
  chronicle(world, 'politics', `撤销政策：${def.nameZh}`, { factionId, policyId });
  return { ok: true };
}

/** 每日结算：定期法令到期 + 行政超载稳定度惩罚（DailySystems 注册） */
export function dailyPolicySettlement(world) {
  for (const fid of Object.keys(world.entities.factions).sort()) {
    const fac = world.entities.factions[fid];
    fac.policies ||= {};
    // 1. 到期失效
    for (const pid of Object.keys(fac.policies).sort()) {
      const rec = fac.policies[pid];
      if (rec.expiresTick && world.tick >= rec.expiresTick) {
        const def = policyDef(pid);
        delete fac.policies[pid];
        fac.policySlots = usedAdminSlots(fac);
        const cd = world.narrative.flags[`policyCd:${fid}:${pid}`];
        world.narrative.flags[`policyCd:${fid}:${pid}`] =
          Math.max(cd || 0, world.tick + ((def?.cooldownDays || 30) * 24));
        emit(world, 'PolicyExpired', { factionId: fid, policyId: pid }, 'politics');
      }
    }
    // 2. 行政超载 → 稳定度侵蚀（4.1：行政容量不足产生实际后果）
    const cap = adminCapacity(world, fid);
    const load = governanceLoad(world, fid);
    if (load > cap) {
      const over = (load - cap) / Math.max(1, cap);
      for (const cid of Object.keys(world.entities.colonies).sort()) {
        const col = world.entities.colonies[cid];
        if (col.factionId !== fid) continue;
        col.stability = Math.max(0, col.stability - over * 1.5);
      }
      if (!world.narrative.flags[`overloadWarn:${fid}`] || world.tick - world.narrative.flags[`overloadWarn:${fid}`] > 720) {
        world.narrative.flags[`overloadWarn:${fid}`] = world.tick;
        emit(world, 'AdminOverload', { factionId: fid, load, cap }, 'politics');
      }
    }
  }
}

/** 政府视图政策数据（含行政占用与预期影响） */
export function policiesView(world, factionId) {
  const fac = world.entities.factions[factionId];
  const used = usedAdminSlots(fac || {});
  const cap = adminCapacity(world, factionId);
  return {
    usedSlots: used,
    capacity: Math.round(cap),
    load: governanceLoad(world, factionId),
    list: POLICIES.map((def) => ({
      id: def.id,
      name: def.nameZh,
      desc: def.descZh,
      category: def.category,
      cost: def.cost,
      adminCost: def.adminCost,
      durationDays: def.durationDays,
      cooldownDays: def.cooldownDays,
      effects: def.effects,
      expected: def.expectedZh,
      mutexGroup: def.mutexGroup,
      ...policyStatus(world, factionId, def.id),
    })),
  };
}
