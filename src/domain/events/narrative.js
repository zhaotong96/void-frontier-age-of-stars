/**
 * domain/events/narrative.js — 事件系统引擎（任务书 5.9 / EVENT-01/02）
 *
 * 事件为数据驱动内容（content/events.js）+ 世界状态条件 + 效果算子。
 * 触发结合世界状态（每日检查），禁止纯随机弹窗；一次性事件以
 * world.narrative.fired 去重（幂等）；重要抉择进入 pendingChoices
 * 由玩家通过 ResolveEventChoice 命令结算。
 */

import { RNG } from '../../core/rng.js';
import { registerScheduled, schedule } from '../../core/scheduler.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { credit, debit, balance } from '../economy/ledger.js';
import { getRelation } from '../diplomacy/war.js';
import { EVENT_DEFS, objectiveAnchorFor } from '../../content/events.js';
import { createWorldObjective } from './objectives.js';
import { DIFFICULTY } from '../../content/constants.js';
import { resolveSurfaceDilemma } from '../ground/surfaceEvents.js';

/** 每日检查（DailySystems 注册）：条件 + 权重抽取 */
export function dailyEventCheck(world) {
  world.narrative.pendingChoices ||= []; // 兼容旧存档
  if (world.victory.ended && !world.narrative.flags.sandbox_continue) return;
  const mult = (DIFFICULTY[world.difficulty] || DIFFICULTY.standard).eventFrequencyMult || 1;
  for (const def of EVENT_DEFS) {
    // 一次性
    if (def.once && world.narrative.fired[def.id]) continue;
    // 冷却
    const last = world.narrative.fired[def.id];
    if (last && world.tick - last < (def.cooldownTicks || 360)) continue;
    // 互斥组：同组已有待决事件则跳过
    if (def.mutexGroup) {
      const clash = world.narrative.pendingChoices.some((p) => p.mutexGroup === def.mutexGroup);
      if (clash) continue;
    }
    // 条件（结合世界状态，不纯随机）
    let ok = false;
    try {
      ok = def.conditions(world);
    } catch (e) {
      emit(world, 'EventConditionError', { eventId: def.id, message: String(e && e.message) }, 'system');
      continue;
    }
    if (!ok) continue;
    // 概率抽取
    const p = (def.weight ?? 0.3) * mult * 0.42;
    if (!RNG.chance(world, Math.min(0.9, p))) continue;

    fireEvent(world, def);
    if (world.narrative.pendingChoices.length >= 3) break; // 待决上限
  }
}

/** 触发事件：效果型立即结算；抉择型进入待决队列 */
export function fireEvent(world, def) {
  world.narrative.fired[def.id] = world.tick;
  emit(world, 'EventFired', { eventId: def.id, category: def.category }, def.category || 'politics');

  if (def.choices && def.choices.length > 0) {
    // 待决上限：满 3 张时最旧的一张按默认选项自动结算
    //（代表政府按既定方针处理被搁置的议题，防堆积也符合世界观）
    if (world.narrative.pendingChoices.length >= 3) {
      const oldest = world.narrative.pendingChoices.shift();
      const oldDef = EVENT_DEFS.find((e) => e.id === oldest.eventId);
      const defaultChoice = oldDef?.choices?.find((c) => c.isDefault) || oldDef?.choices?.[0];
      if (defaultChoice) {
        resolveChoice(world, oldest.eventId, defaultChoice.id);
        emit(world, 'EventAutoResolved', { eventId: oldest.eventId }, 'politics');
      }
    }
    world.narrative.pendingChoices.push({
      eventId: def.id,
      titleZh: def.titleZh,
      bodyZh: typeof def.bodyZh === 'function' ? def.bodyZh(world) : def.bodyZh,
      mutexGroup: def.mutexGroup || null,
      expiresTick: def.expiresTicks ? world.tick + def.expiresTicks : null,
      choices: def.choices.map((c) => ({
        id: c.id,
        labelZh: c.labelZh,
        hintZh: typeof c.hintZh === 'function' ? c.hintZh(world) : c.hintZh || null,
        cost: c.cost || null,
      })),
      firedTick: world.tick,
    });
    chronicle(world, 'event', `抉择：${def.titleZh}`, { eventId: def.id });
  } else {
    applyEffects(world, def.effects || [], { eventId: def.id });
    chronicle(world, 'event', def.titleZh, { eventId: def.id });
  }

  // B 类空间事件（doc5 §3.6 / EVT-01）：触发时绑定真实空间实体建立持久目标。
  // 锚点解析器来自 content/events.js（def.objective 内联解析器优先）；
  // 同源事件已有 active 目标时不重复建（防冷却期内堆积）。
  try {
    const resolver = typeof def.objective === 'function' ? def.objective : objectiveAnchorFor(def.id);
    const anchor = resolver ? resolver(world) : null;
    if (anchor) {
      const bag = world.entities.objectives || {};
      const dup = Object.keys(bag).some((id) => bag[id].status === 'active' && bag[id].sourceEventId === def.id);
      if (!dup) {
        const obj = createWorldObjective(world, { sourceEventId: def.id, ...anchor });
        if (obj) chronicle(world, 'event', `空间目标建立：${obj.titleZh}`, { objectiveId: obj.id, eventId: def.id });
      }
    }
  } catch (e) {
    emit(world, 'ObjectiveAnchorError', { eventId: def.id, message: String(e && e.message) }, 'system');
  }
}

/**
 * 效果算子（数据驱动，可序列化）。
 * 支持：resource / relation / flag / arc / event / chronicle
 */
export function applyEffects(world, effects, ctx = {}) {
  const pid = world.playerFactionId;
  for (const fx of effects) {
    switch (fx.op) {
      case 'resource': {
        const fid = fx.target === 'player' ? pid : fx.target;
        if (fx.amount >= 0) credit(world, fid, fx.resId, fx.amount, `event:${ctx.eventId}`, null);
        else debit(world, fid, fx.resId, -fx.amount, `event:${ctx.eventId}`, null);
        break;
      }
      case 'relation': {
        // F-11 修复：'ALL_AI' 为广播伪目标（34 项叙事事件的外交效果此前经
        // getRelation 写入 "[object]/ALL_AI" 幽灵关系键——效果从未真实生效）。
        // 现展开为全部 AI 文明逐派系应用（getRelation 双方存在性守卫保持）。
        const a = fx.a || pid;
        const targets = fx.b === 'ALL_AI'
          ? Object.keys(world.entities.factions).filter((f) => f !== a)
          : [fx.b];
        for (const b of targets) {
          const rel = getRelation(world, a, b);
          rel[fx.key] = Math.max(-100, Math.min(100, (rel[fx.key] || 0) + fx.delta));
        }
        break;
      }
      case 'flag':
        world.narrative.flags[fx.key] = fx.value ?? world.tick;
        break;
      case 'arc': {
        const arc = world.narrative.arcs[fx.arcId] || { stage: 0, vars: {} };
        arc.stage = Math.max(arc.stage, fx.stage);
        if (fx.vars) Object.assign(arc.vars, fx.vars);
        world.narrative.arcs[fx.arcId] = arc;
        chronicle(world, 'arc', `剧情推进：${fx.arcId} → 阶段 ${arc.stage}`, { arcId: fx.arcId });
        break;
      }
      case 'event': {
        // 延迟后续事件（调度器承载，可序列化）
        schedule(world, world.tick + (fx.delayTicks || 0), 'narrativeEvent', { eventId: fx.eventId });
        break;
      }
      case 'chronicle':
        chronicle(world, fx.type || 'world', fx.text, ctx);
        break;
      default:
        emit(world, 'UnknownEffectOp', { op: fx.op, eventId: ctx.eventId }, 'system');
    }
  }
}

/** 玩家抉择结算（ResolveEventChoice 命令执行体） */
export function resolveChoice(world, eventId, choiceId) {
  const idx = world.narrative.pendingChoices.findIndex((p) => p.eventId === eventId);
  if (idx < 0) return { ok: false, reason: '事件不存在或已结算' };
  const pending = world.narrative.pendingChoices[idx];
  // [SPEC-39] 地表道德抉择卡分支：域侧回写路由（资源/希望不满/招募/热度冲 spike）
  if (pending.surface) {
    const res = resolveSurfaceDilemma(world, pending, choiceId);
    if (res.ok) {
      world.narrative.pendingChoices.splice(idx, 1);
      world.narrative.flags[`choice:${eventId}`] = choiceId;
    }
    return res;
  }
  const def = EVENT_DEFS.find((e) => e.id === eventId);
  if (!def) return { ok: false, reason: '未知事件定义' };
  const choice = def.choices?.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, reason: '未知选项' };

  // 成本检查（事务性：命令总线保证失败回滚）
  if (choice.cost) {
    for (const resId of Object.keys(choice.cost)) {
      if (balance(world, world.playerFactionId, resId) < choice.cost[resId]) {
        return { ok: false, reason: `资源不足：${resId}` };
      }
    }
    for (const resId of Object.keys(choice.cost)) {
      debit(world, world.playerFactionId, resId, choice.cost[resId], `choice:${eventId}:${choiceId}`, null);
    }
  }

  applyEffects(world, choice.effects || [], { eventId, choiceId });
  world.narrative.pendingChoices.splice(idx, 1);
  world.narrative.flags[`choice:${eventId}`] = choiceId;
  chronicle(world, 'event', `抉择结果：${def.titleZh} → ${choice.labelZh}`, { eventId, choiceId });
  emit(world, 'EventResolved', { eventId, choiceId }, 'politics');
  return { ok: true };
}

/** 过期待决到期处理（默认选项 / 撤下） */
export function expirePendingChoices(world) {
  const AGE_LIMIT = 30 * 24; // 30 游戏日未决 → 自动默认
  const keep = [];
  for (const p of world.narrative.pendingChoices) {
    const aged = world.tick - p.firedTick > AGE_LIMIT;
    if ((p.expiresTick && world.tick > p.expiresTick) || aged) {
      const def = EVENT_DEFS.find((e) => e.id === p.eventId);
      const defaultChoice = def?.choices?.find((c) => c.isDefault) || def?.choices?.[0];
      if (defaultChoice) {
        resolveChoice(world, p.eventId, defaultChoice.id);
        emit(world, 'EventExpired', { eventId: p.eventId, defaultChoice: defaultChoice.id }, 'politics');
      } else {
        world.narrative.pendingChoices = world.narrative.pendingChoices.filter((x) => x.eventId !== p.eventId);
      }
    } else {
      keep.push(p);
    }
  }
  world.narrative.pendingChoices = keep;
}

// 延迟事件调度注册（'event' 效果算子的载体）
registerScheduled('narrativeEvent', (world, payload) => {
  const def = EVENT_DEFS.find((e) => e.id === payload.eventId);
  if (def) fireEvent(world, def);
});
