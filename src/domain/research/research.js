/**
 * domain/research/research.js — 科技树与科研队列（任务书 4.7 / TECH-01..03）
 *
 * 科研点按类别（统一单池简化模型 + 项目优先级）累积；
 * 完成 → effectIndex 重建（modifiers 即时生效）→ 领域事件解锁。
 */

import { TECHNOLOGIES } from '../../content/technologies.js';
import { emit } from '../../core/eventBus.js';
import { createEntity } from '../entities/registry.js';

const techIndex = new Map(TECHNOLOGIES.map((t) => [t.id, t]));
export function techDef(id) {
  return techIndex.get(id);
}
export function allTechs() {
  return TECHNOLOGIES;
}

/** 校验 DAG 无环 + prereq 存在（启动与测试调用） */
export function validateTechGraph() {
  const problems = [];
  const state = new Map(); // 0 unvisited 1 visiting 2 done
  const visit = (id) => {
    const st = state.get(id);
    if (st === 1) {
      problems.push(`科技环依赖: ${id}`);
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    const t = techIndex.get(id);
    if (!t) {
      problems.push(`未知科技引用: ${id}`);
      return;
    }
    for (const p of t.prereqs || []) visit(p);
    state.set(id, 2);
  };
  for (const t of TECHNOLOGIES) visit(t.id);
  return problems;
}

/** 初始化阵营科研状态 */
export function initResearch(world, factionId) {
  world.research[factionId] = {
    completed: [],
    active: [],   // [{ projectId, techId, progress }]
    queue: [],    // [techId...]
    points: 0,    // 当前科研点池
    effectIndex: {},
  };
}

/** 前置检查（TECH-01） */
export function canStart(world, factionId, techId) {
  const rs = world.research[factionId];
  const tech = techIndex.get(techId);
  if (!tech) return { ok: false, reason: '未知科技' };
  if (!rs) return { ok: false, reason: '科研状态未初始化' };
  if (rs.completed.includes(techId)) return { ok: false, reason: '已研究完成' };
  if (rs.active.some((a) => a.techId === techId)) return { ok: false, reason: '已在研究中' };
  for (const p of tech.prereqs || []) {
    if (!rs.completed.includes(p)) {
      return { ok: false, reason: `缺少前置: ${techIndex.get(p)?.nameZh || p}` };
    }
  }
  return { ok: true };
}

/** 启动项目（StartResearch 命令执行体） */
export function startResearch(world, factionId, techId) {
  const rs = world.research[factionId];
  const tech = techIndex.get(techId);
  const project = createEntity(world, 'buildQueues', {
    kind: 'research',
    factionId,
    techId,
    progress: 0,
    cost: tech.cost,
  });
  rs.active.push({ projectId: project.id, techId, progress: 0 });
  return project;
}

/** 每小时科研推进（实验室产出已折算为 points 注入） */
export function tickResearch(world, factionId, pointsPerHour) {
  const rs = world.research[factionId];
  if (!rs || rs.active.length === 0) return;
  // 多项目抢占：按队列顺序分配（TECH-03：分配之和 ≤ 实际产出）
  let budget = pointsPerHour;
  for (const a of rs.active) {
    if (budget <= 0) break;
    const tech = techIndex.get(a.techId);
    const give = Math.min(budget, tech.cost - a.progress);
    a.progress += give;
    budget -= give;
    if (a.progress >= tech.cost) {
      completeTech(world, factionId, a.techId);
    }
  }
  rs.active = rs.active.filter((a) => {
    const tech = techIndex.get(a.techId);
    return a.progress < tech.cost;
  });
  // 队列自动补充
  while (rs.active.length < 1 && rs.queue.length > 0) {
    const nextId = rs.queue.shift();
    const chk = canStart(world, factionId, nextId);
    if (chk.ok) {
      const tech = techIndex.get(nextId);
      rs.active.push({ projectId: `auto_${nextId}`, techId: nextId, progress: 0 });
    } else {
      break; // 前置未满足，停止（不静默跳过）
    }
  }
}

/** 完成科技：重建 effectIndex 并广播 */
export function completeTech(world, factionId, techId) {
  const rs = world.research[factionId];
  if (rs.completed.includes(techId)) return; // 幂等（EVENT-01 思路）
  rs.completed.push(techId);
  rs.active = rs.active.filter((a) => a.techId !== techId);
  rebuildEffectIndex(world, factionId);
  const tech = techIndex.get(techId);
  emit(world, 'TechCompleted', { factionId, techId, unlocks: tech.unlocks || [] }, 'research');
}

/** 重建科技效果索引（modifiers.getMod 消费） */
export function rebuildEffectIndex(world, factionId) {
  const rs = world.research[factionId];
  if (!rs) return;
  const idx = {};
  for (const techId of rs.completed) {
    const tech = techIndex.get(techId);
    if (!tech || !tech.effects) continue;
    for (const e of tech.effects) {
      (idx[e.stat] ||= []).push({ value: e.value, mode: e.mode, techId });
    }
  }
  rs.effectIndex = idx;
}

/** 科技可用状态（UI 树着色） */
export function techStatus(world, factionId, techId) {
  const rs = world.research[factionId];
  const tech = techIndex.get(techId);
  if (!rs || !tech) return 'hidden';
  if (rs.completed.includes(techId)) return 'done';
  if (rs.active.some((a) => a.techId === techId)) return 'active';
  const prereqMet = (tech.prereqs || []).every((p) => rs.completed.includes(p));
  return prereqMet ? 'available' : 'locked';
}
