/**
 * tests/suites/fuzz-stability.suite.js — 10,000 步混沌压力回归（doc26 SPEC-TEST-026 CLI 门禁）
 *
 * FUZZ-STORM：双世界风暴（8,000 步最小内核世界 + 2,000 步标准战役世界），
 *   门禁 = 零未捕获异常 + 全量状态扫描零 NaN/Infinity + 采样不变量 0 违规
 *   （doc26 §5.1/§5.2）。
 * FUZZ-REPLAY：真实生产抛错点故障注入 → 黑匣子 Dump 落盘 → 重放器 100% 复现
 *   相同错误签名与堆栈首帧（doc26 §5.3）。
 * CYCLIC-PROBE：结构型·循环引用隔离探针（doc26 §2.2.3 特征化发现，独立于主风暴）。
 */

import { createStarterCampaign, createMinimalWorld } from '../../src/devtools/scenarioFactory.js';
import { StateMachineFuzzer, cyclicProbe } from '../fuzz/StateMachineFuzzer.js';
import { replayDump } from '../fuzz/replayCrash.js';
import { commandList } from '../../src/core/commandBus.js';

export const suiteStorm = {
  id: 'FUZZ-STORM',
  tier: 4,
  name: '状态机模糊风暴 10,000 步（路由冲浪+命令变异+时序乱序）',
  group: 'fuzz',
  async run() {
    const t0 = performance.now();
    const runs = [];
    // —— 相位 A：最小内核世界 8,000 步（命令管线全覆盖，事务快照廉价） ——
    {
      const world = createMinimalWorld(24601);
      const fuzzer = new StateMachineFuzzer(
        { world, worldKind: 'minimal', seed: 24601, ui: null },
        { iterations: 8000, faultAt: null },
      );
      const stats = await fuzzer.startStorm();
      runs.push({ kind: 'minimal', steps: 8000, ...stats });
    }
    // —— 相位 B：标准战役世界 2,000 步（96 星系真实状态面 + 混沌组合拳） ——
    {
      const world = createStarterCampaign({ seed: 24601 });
      const fuzzer = new StateMachineFuzzer(
        { world, worldKind: 'starter', seed: 24602, ui: null },
        { iterations: 2000, faultAt: null },
      );
      const stats = await fuzzer.startStorm();
      runs.push({ kind: 'starter', steps: 2000, ...stats });
    }

    const totalSteps = runs.reduce((s, r) => s + r.steps, 0);
    const durMs = performance.now() - t0;
    const cmdOk = runs.reduce((s, r) => s + r.counters.commandOk, 0);
    const cmdBlocked = runs.reduce((s, r) => s + r.counters.commandBlocked, 0);
    const cyclic = runs.reduce((s, r) => s + r.finalCyclicRefs, 0);

    return {
      ok: true,
      detail: `10,000 步混沌风暴 PASS（${runs.map((r) => `${r.kind}:${r.steps}`).join('+')}）· 路由 ${runs.reduce((s, r) => s + r.counters.ROUTE, 0)} 命令 ${cmdOk}ok/${cmdBlocked}blocked(受控拦截) 时序加速 ${runs.reduce((s, r) => s + r.counters.SIM_ACCEL, 0)} 组合拳 ${runs.reduce((s, r) => s + (r.counters.COMBO || 0), 0)} · 纯洁度采样 ${runs.reduce((s, r) => s + r.sanityCycles, 0)} 轮零 NaN/Infinity · 终局不变量 0 违规 · 扫描 ${runs[runs.length - 1].finalScanNodes} 节点 · ${durMs.toFixed(0)}ms`,
      hash: `steps${totalSteps}ok${cmdOk}bl${cmdBlocked}cy${cyclic}`,
    };
  },
};

export const suiteReplay = {
  id: 'FUZZ-REPLAY',
  tier: 4,
  name: '黑匣子 Crash Dump → 离线重放 100% 复现（doc26 §3/§5.3）',
  group: 'fuzz',
  async run() {
    const t0 = performance.now();
    // 1. 故障注入风暴：步 700 触发真实生产抛错点（scheduler.js:21 atTick NaN）
    const world = createStarterCampaign({ seed: 24601 });
    const fuzzer = new StateMachineFuzzer(
      { world, worldKind: 'starter', seed: 24601, ui: null },
      { iterations: 1000, sanityEvery: 25, faultAt: 700, faultId: 'scheduler_nan_atTick' },
    );
    let crash = null;
    try {
      await fuzzer.startStorm();
      return { ok: false, detail: '故障注入未被捕获（风暴异常通过）——重放验证前提失效' };
    } catch (e) {
      if (!e.fuzzDump) return { ok: false, detail: `非预期崩溃（无 Dump）: ${e.message}` };
      crash = e.fuzzDump;
    }
    if (!crash.dumpPath) return { ok: false, detail: `Dump 未落盘: ${crash.ioError || '无路径'}` };

    // 2. Dump 结构断言（doc26 §3.1 契约字段）
    for (const k of ['timestamp', 'gameVersion', 'seed', 'error', 'breadcrumbs', 'systemProfile', 'worldSnapshot']) {
      if (!(k in crash)) return { ok: false, detail: `Dump 缺契约字段 ${k}` };
    }
    if (!crash.error.stack || !crash.error.message) return { ok: false, detail: 'Dump error 签名不完整' };
    if (!crash.breadcrumbs.some((b) => b.type === 'FAULT')) return { ok: false, detail: 'Dump 面包屑缺 FAULT 步' };

    // 3. 离线重放：同种子重建 → 逐面包屑重喂 → 错误签名 + 堆栈首帧比对
    const rep = await replayDump(crash);
    if (!rep.replayError) return { ok: false, detail: `重放未崩溃: ${rep.reason}` };
    if (!rep.ok) {
      return {
        ok: false,
        detail: `复现签名不一致: 原始[${crash.error.name}: ${crash.error.message}] 重放[${rep.replayError.name}: ${rep.replayError.message}] stackMatch=${rep.stackMatch}`,
      };
    }

    // 4. 已知发现特征化：循环引用参数 → commandLog 审计环引用（doc26 §2.2.3 结构型）
    const probeWorld = createMinimalWorld(24603);
    const probe = await cyclicProbe(probeWorld, commandList());

    return {
      ok: true,
      detail: `Dump→重放 100% 复现 PASS：${crash.error.name}: ${crash.error.message.slice(0, 46)}（堆栈首帧一致，${rep.steps} 步重喂，dump=crash-dump-<ts>.json @ tests/fuzz/dumps/）· 循环引用探针：${probe.blockedWithCyclicLog}/50 拦截、stringifyThrows=${probe.stringifyThrows}、NaN/Inf=${probe.nanInf}（发现 F-01 见报告）`,
      hash: `${crash.error.name}:${crash.error.message.length}:${rep.steps}`,
    };
  },
};
