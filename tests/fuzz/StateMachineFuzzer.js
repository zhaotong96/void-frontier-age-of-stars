/**
 * tests/fuzz/StateMachineFuzzer.js — 状态机模糊测试主调度器（doc26 §1/§2/§4.1）
 *
 * 三维混沌：16 屏路由冲浪（Node=parseHash 纯解析器 fuzz；浏览器=真实视图导航）+
 * 全量注册命令参数变异注入 + 并发时序乱序（混沌组合拳 + SIM_ACCEL 时间加速）。
 * 判负唯一依据（doc26 NOTE）：未捕获崩溃或世界状态污染（NaN/Infinity/不变量违规）。
 * 全部随机性来自 src/core/rng.js 确定性子流（Iron Discipline 1）。
 */

import { pick, int, intRange, chance, seedFromNumber } from '../../src/core/rng.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { executeCommand, commandList } from '../../src/core/commandBus.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { parseHash } from '../../src/app/Router.js';
import { CommandMutator, mutateRoute, makeCyclic } from './CommandMutator.js';
import { BlackBoxCrashDumper } from './BlackBoxCrashDumper.js';
import { SURF_ROUTES, surfNavigate } from './ChaosRouteSurfer.js';

/** Node 环境路由解析 location 垫片（仅当宿主无 location 时注入纯数据对象） */
function ensureLocationShim() {
  if (typeof location === 'undefined') {
    (globalThis).location = { hash: '#/menu' };
  }
}

/** 面包屑载荷净化：JSON 安全副本（NaN/Infinity→null、undefined/函数剔除；重放骨架口径） */
function sanitizeParams(params) {
  const walk = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v === undefined || typeof v === 'function') return null;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v)) out[k] = walk(v[k]);
    return out;
  };
  return walk(params);
}

/** 循环引用安全 + NaN/Infinity 哨兵的全量状态扫描。
 * commandLog 审计环契约：命令提交审计按设计逐字保存原始参数（含被拒绝/被忽略
 * 的垃圾键——审计职责即记录提交本身，命令可合法忽略未用的多余键），因此审计环
 * 仅扫描元数据（id/tick/type/ok/code/reason）。污染判定由其余全量模拟状态
 * （entities/relations/economy/narrative/...）100% 扫描 + 不变量采样承担。 */
export function scanWorldPurity(world) {
  const stats = { nodes: 0, cyclic: 0, nanInf: [], logRecords: 0 };
  const seen = new Set();
  const walk = (v, path) => {
    if (v === undefined || typeof v === 'function') return;
    if (v === null) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) stats.nanInf.push(`${path}=${v}`);
      return;
    }
    if (typeof v !== 'object') {
      if (typeof v === 'string' && (v === 'NaN' || v === 'Infinity' || v === '-Infinity')) {
        stats.nanInf.push(`${path}=${v}`);
      }
      return;
    }
    if (seen.has(v)) { stats.cyclic++; return; }
    seen.add(v);
    stats.nodes++;
    if (stats.nodes > 4000000) { stats.nanInf.push('<scan-budget-exceeded>'); return; }
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
    seen.delete(v);
  };
  for (const k of Object.keys(world)) {
    if (k === 'commandLog' && Array.isArray(world.commandLog)) {
      for (const rec of world.commandLog) {
        stats.logRecords++;
        if (!rec || typeof rec !== 'object') continue;
        walk({ id: rec.id, tick: rec.tick, type: rec.type, ok: rec.ok, code: rec.code, reason: rec.reason }, `world.commandLog.${rec.id}.meta`);
      }
      continue;
    }
    walk(world[k], `world.${k}`);
  }
  return stats;
}

/** 已注册故障注入表（FUZZ-REPLAY 的可复现故障 = 真实生产代码抛错点） */
export const FAULTS = {
  // src/core/scheduler.js:21 — schedule(world, NaN, …) → 'scheduler: atTick 非法'
  scheduler_nan_atTick: (world) => {
    // 延迟 import 避免 Node 侧套件模块图外泄到浏览器 bundle 无关分支
    return import('../../src/core/scheduler.js').then((m) => m.schedule(world, NaN, 'fuzz-probe', {}));
  },
  // 叙事事件裁决通道：悬空 eventId + 非法 choiceId（命令总线受控拦截面）
  command_unknown_type: (world) => {
    return Promise.resolve(executeCommand(world, { type: 'FuzzGhostCommand', actorId: null, params: { x: NaN } }));
  },
};

export class StateMachineFuzzer {
  constructor(ctx, config = {}) {
    this.ctx = ctx; // { world, worldKind, seed, ui? }
    this.config = Object.assign({
      iterations: 10000,
      maxStepIntervalMs: 30,
      sanityEvery: 25,
      invariantsEvery: 500,
      faultAt: null,       // 故障注入步（FUZZ-REPLAY 专用；null = 纯风暴）
      faultId: null,
    }, config);
    this.state = seedFromNumber(ctx.seed ^ 0xf00d);
    this.mutator = new CommandMutator(ctx.seed ^ 0xbeef);
    this.breadcrumbs = [];
    this.dumper = new BlackBoxCrashDumper({
      seed: ctx.seed, worldKind: ctx.worldKind, lastRoute: { screen: 'menu', param: null },
    });
    this.counters = { ROUTE: 0, COMMAND: 0, SIM_ACCEL: 0, commandOk: 0, commandBlocked: 0 };
  }

  breadcrumb(step, type, detail, cmd = null) {
    const bc = { step, type, detail: String(detail).slice(0, 180), time: Number((performance.now() / 1000).toFixed(2)) };
    if (cmd) bc.cmd = cmd; // 完整命令载荷（重放器逐字节重喂）
    this.breadcrumbs.push(bc);
    if (this.breadcrumbs.length > 120) this.breadcrumbs.splice(0, this.breadcrumbs.length - 120);
  }

  chooseActionType() {
    const r = int(this.state, 100);
    if (r < 40) return 'ROUTE';
    if (r < 85) return 'COMMAND';
    return 'SIM_ACCEL';
  }

  async dispatchRandomRoute(step) {
    ensureLocationShim();
    if (this.ctx.ui) {
      // 浏览器实机：真实 16 屏导航（ChaosRouteSurfer）
      const r = surfNavigate(this.ctx.ui, pick(this.state, SURF_ROUTES));
      this.breadcrumb(step, 'route', `surf→${r}`);
      this.ctx.lastRoute = { screen: r };
      return;
    }
    // Node 无头：真实 parseHash 解析器 × 变异哈希（Router.js:9-19 纯函数）。
    // [SPEC-39 TC-FIX-01 隔离修复 2026-11-11] 浏览器实机（DiagnosticsView 全套件
    // 运行）中 globalThis.location 是宿主页面路由——写入变异哈希会劫持宿主导航、
    // 打断 #/diagnostics 进度条（实测 #/system/__proto__ / #/unknown_route 风暴）。
    // 变异哈希的确定性断言价值在 parseHash 纯函数本身：宿主页面环境下改为
    // 「仅解析不落位」（mutant 不写入 live hash；等价覆盖解析器契约）；
    // 真实导航模糊测试仍归 fuzz-runner.html 专用门禁页（doc26 既有分工）。
    const mutant = mutateRoute(this.state);
    const livePage = typeof window !== 'undefined' && window.location === location;
    if (!livePage) {
      (globalThis).location.hash = mutant;
    }
    const route = parseHash();
    // 生产契约（App._onRoute 未知路由回菜单守卫兜底）：解析器绝不抛错，
    // 恒返回 { screen: string, param: string|null }；空 screen 为合法守卫面。
    if (!route || typeof route !== 'object' || typeof route.screen !== 'string'
      || (route.param !== null && typeof route.param !== 'string')) {
      throw new Error(`parseHash 产出非法路由: ${JSON.stringify(route)} ← ${mutant}`);
    }
    this.ctx.lastRoute = route;
    this.breadcrumb(step, 'route', `${mutant} → ${route.screen}/${route.param}`);
  }

  async dispatchMutatedCommand(step) {
    const types = commandList();
    const cmd = this.mutator.mutateCommand(types, this.ctx.world.playerFactionId, this.ctx.world);
    const r = executeCommand(this.ctx.world, cmd);
    if (r && r.ok) this.counters.commandOk++; else this.counters.commandBlocked++;
    this.breadcrumb(step, 'command', `${cmd.type} ${JSON.stringify(cmd.params).slice(0, 110)} → ${r ? `${r.ok ? 'ok' : r.code}` : 'void'}`,
      { type: cmd.type, actorId: cmd.actorId, targetId: cmd.targetId, params: JSON.parse(JSON.stringify(sanitizeParams(cmd.params))) });
    return r;
  }

  dispatchTimeWarp(step) {
    const n = intRange(this.state, 1, 50);
    advanceTicks(this.ctx.world, n);
    this.breadcrumb(step, 'sim', `+${n}t tick=${this.ctx.world.tick}`);
  }

  /** 混沌组合拳（doc26 §2 维度三）：战斗中切屏 / 中途注销前置 / 挂单并发宣战 */
  dispatchChaosCombo(step) {
    const w = this.ctx.world;
    const pid = w.playerFactionId;
    const foe = Object.keys(w.entities.factions).find((f) => f !== pid);
    const fleet = Object.values(w.entities.fleets).find((f) => f.factionId === pid);
    const seq = [];
    if (foe) seq.push(() => executeCommand(w, { type: 'DeclareWar', actorId: pid, params: { targetFactionId: foe, wargoal: 'borderSystems' } }));
    if (fleet) seq.push(() => executeCommand(w, { type: 'OrderFleetMove', actorId: pid, params: { fleetId: fleet.id, targetSystemId: fleet.systemId } }));
    seq.push(() => executeCommand(w, { type: 'MarketBuy', actorId: pid, params: { systemId: Object.keys(w.entities.systems)[0], resId: 'alloy', qty: -5 } }));
    seq.push(() => executeCommand(w, { type: 'QueueResearch', actorId: pid, params: { techId: 'INVALID_TECH' } }));
    seq.push(() => executeCommand(w, { type: 'AbortGroundMission', actorId: pid, params: { missionId: 'NOPE' } }));
    for (const s of seq) {
      const r = s();
      if (r && r.ok) this.counters.commandOk++; else this.counters.commandBlocked++;
    }
    advanceTicks(w, intRange(this.state, 1, 24));
    this.breadcrumb(step, 'combo', `war+market+research+abort x${seq.length}`);
  }

  verifyWorldSanity(step) {
    const stats = scanWorldPurity(this.ctx.world);
    if (stats.nanInf.length > 0) {
      throw new Error(`[FUZZ SANITY] 世界状态被污染（step=${step}）: ${stats.nanInf.slice(0, 3).join('; ')}（共 ${stats.nanInf.length} 处）`);
    }
    return stats;
  }

  /** 启动混沌模糊风暴（doc26 §4.1 契约） */
  async startStorm() {
    const cfg = this.config;
    let sanityCycles = 0;
    let worstNodes = 0;
    for (let step = 0; step < cfg.iterations; step++) {
      const doFault = cfg.faultAt != null && step === cfg.faultAt;
      const actionType = step % 700 === 699 ? 'COMBO' : this.chooseActionType();
      try {
        if (doFault) {
          // 已登记故障注入（真实生产抛错点；不在 commandBus 保护面内的裸调用）
          this.breadcrumb(step, 'FAULT', cfg.faultId);
          await FAULTS[cfg.faultId](this.ctx.world);
        }
        if (actionType === 'ROUTE') await this.dispatchRandomRoute(step);
        else if (actionType === 'COMMAND') await this.dispatchMutatedCommand(step);
        else if (actionType === 'SIM_ACCEL') this.dispatchTimeWarp(step);
        else if (actionType === 'COMBO') this.dispatchChaosCombo(step);

        if (step % cfg.sanityEvery === cfg.sanityEvery - 1) {
          const stats = this.verifyWorldSanity(step);
          sanityCycles++;
          if (stats.nodes > worstNodes) worstNodes = stats.nodes;
        }
        if (step % cfg.invariantsEvery === cfg.invariantsEvery - 1) {
          const problems = checkWorldInvariants(this.ctx.world);
          if (problems.length > 0) {
            throw new Error(`[FUZZ INVARIANT] step=${step}: ${problems.slice(0, 2).join('; ')}`);
          }
        }
      } catch (err) {
        const dump = await this.dumper.captureAndSave(err, this.breadcrumbs, this.ctx.world);
        const e = new Error(`[FUZZ CRASH] 步骤 ${step} 触发致命异常！Dump 已导出至 ${dump.dumpPath || '(memory)'}: ${err.message}`);
        e.fuzzDump = dump;
        e.fuzzStep = step;
        throw e;
      }
    }
    // 终局全量纯洁度 + 不变量
    const finalStats = this.verifyWorldSanity('final');
    const problems = checkWorldInvariants(this.ctx.world);
    if (problems.length > 0) throw new Error(`[FUZZ FINAL] 不变量违规: ${problems.slice(0, 2).join('; ')}`);
    return {
      iterations: cfg.iterations,
      counters: { ...this.counters, COMBO: Math.floor(cfg.iterations / 700) },
      sanityCycles,
      worstScanNodes: worstNodes,
      finalCyclicRefs: finalStats.cyclic,
      finalScanNodes: finalStats.nodes,
      breadcrumbsKept: this.breadcrumbs.length,
    };
  }
}

/** 循环引用隔离探针（doc26 §2.2.3 结构型·循环引用；独立于主风暴，特征化发现用） */
export async function cyclicProbe(world, commandTypes, seed = 99) {
  const s = seedFromNumber(seed);
  let blockedWithCyclicLog = 0;
  for (let i = 0; i < 50; i++) {
    const type = pick(s, commandTypes);
    const r = executeCommand(world, {
      type, actorId: world.playerFactionId, params: { fleetId: makeCyclic(), qty: 1 },
    });
    if (r && !r.ok) blockedWithCyclicLog++;
  }
  // 循环引用参数即使被前置校验拦截，也会以引用形式进入 commandLog 审计环
  let stringifyThrows = false;
  try { JSON.stringify(world); } catch { stringifyThrows = true; }
  const purity = scanWorldPurity(world);
  return { blockedWithCyclicLog, stringifyThrows, cyclicRefs: purity.cyclic, nanInf: purity.nanInf.length };
}
