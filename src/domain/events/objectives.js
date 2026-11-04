/**
 * domain/events/objectives.js — 结构化空间任务目标实体（doc5 §3.6 / TASK-2.3 / EVT-01..02）
 *
 * WorldObjective 是持久化纯数据实体（world.entities.objectives，'obj' 前缀）：
 * B 类空间事件触发时绑定真实世界空间实体（目标星系/航路另一端/行星），
 * 银河图据此绘制 Pin / 离屏方向箭头 / 威胁航路虚线。
 *
 * 集成边界（与 TickPipeline/DailySystems 的接线归主工程）：
 *  - 本模块只导出纯领域函数，不自行注册每日/每小时钩子；
 *  - dailyObjectiveSweep(world) 供 DailySystems 每日调用（过期 + 一次性罚则）。
 *
 * 离屏数学（doc5:730-809）：目标星系投影 (sx,sy) 移出视口安全矩形时，
 *   θ = atan2(dy,dx)，padX = max(80, cx-84)（避开左侧导航栏），
 *   padY = max(60, cy-64)，t = min(padX/|dx|, padY/|dy|)，
 *   边缘点 = (cx,cy) + t×(dx,dy)。
 */

import { createEntity, getEntity, listEntities } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { debit } from '../economy/ledger.js';
import { orderMove } from '../fleets/fleet.js';

/** 目标种类（doc5 §3.6） */
export const OBJECTIVE_KINDS = ['escort_lane', 'investigate_system', 'relief_colony', 'survey_planet'];

/** 默认行动窗口：336 小时 = 14 天 */
export const DEFAULT_DURATION_HOURS = 336;

/**
 * 创建空间任务目标。
 * targetSystemId 必须可解析为真实星系实体（绑定真实世界实体是本实体的存在意义），
 * 否则返回 null（调用方按「无有效空间锚点」静默跳过，不建空目标）。
 */
export function createWorldObjective(world, opts = {}) {
  world.entities.objectives ||= {};
  const kind = opts.kind;
  if (!OBJECTIVE_KINDS.includes(kind)) return null;
  const targetSystemId = opts.targetSystemId;
  if (!targetSystemId || !world.entities.systems[targetSystemId]) return null;
  const durationHours = Number.isFinite(opts.durationHours) && opts.durationHours > 0
    ? Math.round(opts.durationHours)
    : DEFAULT_DURATION_HOURS;
  const o = createEntity(world, 'objectives', {
    factionId: opts.factionId || world.playerFactionId,
    status: 'active', // active | completed | expired
    kind,
    titleZh: opts.titleZh || '空间任务目标',
    descZh: opts.descZh || '',
    sourceEventId: opts.sourceEventId || null,
    targetSystemId,
    secondarySystemId: opts.secondarySystemId || null,
    targetPlanetId: opts.targetPlanetId || null,
    priority: opts.priority || 'high',          // high | normal
    createdTick: world.tick,
    deadlineTick: world.tick + durationHours,
    assignedFleetId: null,
    progress: 0,
    goalProgress: 100,
    rewards: opts.rewards || [],
    penalty: opts.penalty || null,              // { credits: n } | { flag: 'key' }
  });
  emit(world, 'ObjectiveCreated', {
    objectiveId: o.id,
    targetSystemId: o.targetSystemId,
    kind: o.kind,
    sourceEventId: o.sourceEventId,
  }, 'world');
  return o;
}

/** 目标进度推进（到达/调查/护航完成等系统调用；满格自动完成） */
export function progressObjective(world, objectiveId, delta) {
  const o = getEntity(world, 'objectives', objectiveId);
  if (!o || o.status !== 'active') return { ok: false, reason: '目标不存在或已结束' };
  o.progress = Math.max(0, Math.min(o.goalProgress, (o.progress || 0) + delta));
  if (o.progress >= o.goalProgress) return completeObjective(world, objectiveId);
  return { ok: true, progress: o.progress };
}

/** 完成目标（发放 rewards 资源表由调用方/主工程按奖励语义执行，这里只迁移状态） */
export function completeObjective(world, objectiveId) {
  const o = getEntity(world, 'objectives', objectiveId);
  if (!o || o.status !== 'active') return { ok: false, reason: '目标不存在或已结束' };
  o.status = 'completed';
  o.progress = o.goalProgress;
  o.completedTick = world.tick;
  emit(world, 'ObjectiveCompleted', { objectiveId: o.id, sourceEventId: o.sourceEventId }, 'world');
  return { ok: true };
}

/**
 * 每日清扫：过期目标迁移状态并一次性应用罚则。
 * 返回本次过期的目标数（供 DailySystems 统计）。
 */
export function dailyObjectiveSweep(world) {
  world.entities.objectives ||= {};
  world.narrative.flags ||= {};
  let expired = 0;
  for (const o of listEntities(world, 'objectives')) {
    if (o.status !== 'active') continue;
    if (world.tick <= o.deadlineTick) continue;
    o.status = 'expired';
    o.expiredTick = world.tick;
    expired++;
    const pen = o.penalty;
    if (pen && pen.credits > 0 && o.factionId) {
      // 信用点不足时挂债标记（不产生负库存，ECON-02）
      const paid = debit(world, o.factionId, 'credits', pen.credits, 'objectiveExpired', o.id);
      if (!paid) world.narrative.flags[`${o.id}:creditDebt`] = true;
    }
    if (pen && pen.flag) {
      world.narrative.flags[pen.flag] = world.tick;
    }
    emit(world, 'ObjectiveExpired', {
      objectiveId: o.id,
      sourceEventId: o.sourceEventId,
      penaltyApplied: !!(pen && (pen.credits > 0 || pen.flag)),
    }, 'world');
  }
  return expired;
}

/** 兼容别名（doc5 用语：过期清扫） */
export const expireObjectives = dailyObjectiveSweep;

/**
 * 目标 → 舰队派遣桥接（EVT-02）：与 OrderFleetMove 命令共用同一域路径
 * （planRoute 只读预检 → beginPlannedTransit）。失败不触碰任何状态。
 */
export function dispatchObjectiveFleet(world, objectiveId, fleetId) {
  const o = getEntity(world, 'objectives', objectiveId);
  if (!o) return { ok: false, reason: '任务目标不存在' };
  if (o.status !== 'active') return { ok: false, reason: '任务目标已结束' };
  const fleet = getEntity(world, 'fleets', fleetId);
  if (!fleet) return { ok: false, reason: '舰队不存在' };
  if (!(fleet.shipIds || []).length) return { ok: false, reason: '舰队没有舰船' };
  const res = orderMove(world, fleet, o.targetSystemId);
  if (!res.ok) return res;
  o.assignedFleetId = fleet.id;
  emit(world, 'ObjectiveFleetDispatched', {
    objectiveId: o.id,
    fleetId: fleet.id,
    targetSystemId: o.targetSystemId,
    eta: res.eta ?? null,
  }, 'world');
  return { ok: true, eta: res.eta ?? null };
}

/**
 * 离屏方向箭头数学（纯函数，供渲染层与单测共用）。
 * @param {number} sx 目标投影屏幕 x
 * @param {number} sy 目标投影屏幕 y
 * @param {number} w 视口逻辑宽
 * @param {number} h 视口逻辑高
 * @returns {{onScreen:true} | {onScreen:false, x:number, y:number, angle:number, padX:number, padY:number}}
 */
export function computeOffscreenArrow(sx, sy, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const padX = Math.max(80, cx - 84); // 避开左侧导航栏
  const padY = Math.max(60, cy - 64);
  const dx = sx - cx;
  const dy = sy - cy;
  if (Math.abs(dx) <= padX && Math.abs(dy) <= padY) return { onScreen: true };
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tx = adx > 1e-9 ? padX / adx : Infinity;
  const ty = ady > 1e-9 ? padY / ady : Infinity;
  const t = Math.min(tx, ty);
  return {
    onScreen: false,
    x: cx + dx * t,
    y: cy + dy * t,
    angle: Math.atan2(dy, dx),
    padX,
    padY,
  };
}

/** 活跃目标列表（快照/渲染用，确定性序） */
export function activeObjectives(world) {
  return listEntities(world, 'objectives').filter((o) => o.status === 'active');
}
