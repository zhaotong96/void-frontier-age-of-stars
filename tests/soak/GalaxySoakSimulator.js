/**
 * tests/soak/GalaxySoakSimulator.js — 1,000~10,000 天时间加速沙盒（doc27 §2.1）
 *
 * 绕过渲染帧率限制，以微秒级步长 advanceTicks 纯逻辑长程演进；
 * 逐日健康度断言：AI 折返反模式（Ping-Pong Anti-Pattern）、调度器队列
 * 稳定域 [0,500]、全银河实体库 NaN/Infinity 零容忍、有界日志容器、
 * 命令失败码死循环刷屏检测（NO_FUNDS/QUEUE_FULL 等）。
 */

import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { scanWorldPurity } from '../fuzz/StateMachineFuzzer.js';

const TICKS_PER_DAY = 24;

/** AI 舰队折返审计器（doc27 §2.1 健康度规则 1） */
export class PingPongAuditor {
  constructor() {
    this.legs = new Map(); // fleetId → { a, b, startDay, reversals }
    this.violations = [];
  }

  /** 每日采样一次：fleet.systemId（在途 null 不计落点但计连续折返时长） */
  sample(day, fleets) {
    for (const f of fleets) {
      if (!f.transit) {
        const cur = f.systemId;
        const st = this.legs.get(f.id);
        if (!st) {
          this.legs.set(f.id, { a: cur, b: null, startDay: day, reversals: 0 });
          continue;
        }
        if (st.b === null && cur !== st.a) {
          st.b = cur;
          st.startDay = day;
        } else if (st.b !== null && cur === st.a) {
          // A→B→A 折返：反向重置起点继续累计（连续折返区间时长按天数计）
          st.reversals++;
          st.startDay = day;
          st.b = null;
          if (st.reversals > 20) {
            this.violations.push({ fleetId: f.id, day, reversals: st.reversals });
            st.reversals = 0;
          }
        } else if (st.b !== null && cur !== st.a && cur !== st.b) {
          // 折返链断裂（去了第三点）：重置
          this.legs.set(f.id, { a: cur, b: null, startDay: day, reversals: 0 });
        }
      }
    }
  }
}

/**
 * 长程浸泡推演（doc27 §2.1）。
 * @returns {{days, msPerDay, pingPong, schedQueueMax, purityScans, invariantViolations,
 *            logBoundViolations, commandFailSpikes, aiErrorEvents}}
 */
export function runSoak(world, days = 1000, opts = {}) {
  const sampleEvery = opts.sampleEveryDays ?? 1;
  const t0 = performance.now();
  const auditor = new PingPongAuditor();
  const stats = {
    days: 0,
    schedQueueMax: 0,
    purityScans: 0,
    invariantViolations: [],
    logBoundViolations: [],
    commandFailSpikes: [],
    aiErrorEvents: 0,
    failCodeBaseline: {},
  };
  const LOG_BOUNDS = [
    ['transactions', (w) => w.economy.transactions?.length ?? 0, 400],
    ['commandLog', (w) => w.commandLog?.length ?? 0, 600],
    ['chronicle', (w) => w.chronicle?.length ?? 0, 800],
    ['battles.history', (w) => w.battles?.history?.length ?? 0, 24],
  ];

  for (let day = 1; day <= days; day++) {
    advanceTicks(world, TICKS_PER_DAY);
    stats.days = day;

    // 调度器队列稳定域（doc27 §2.1 规则 2：[0, 500] 严禁事件无限堆积）
    const q = world.scheduled?.length ?? 0;
    if (q > stats.schedQueueMax) stats.schedQueueMax = q;
    if (q > 500) throw new Error(`[SOAK] day=${day} 调度器队列 ${q} > 500（事件无限堆积）`);

    if (opts.onDayEnd) opts.onDayEnd(day, world);

    if (day % sampleEvery === 0) {
      // AI 折返采样
      auditor.sample(day, Object.values(world.entities.fleets));
      // 有界日志容器
      for (const [name, get, bound] of LOG_BOUNDS) {
        const n = get(world);
        if (n > bound) stats.logBoundViolations.push(`day=${day} ${name}=${n}>${bound}`);
      }
      // 殖民地社会记忆
      for (const p of Object.values(world.entities.planets)) {
        if (p.soc?.history?.length > 20) stats.logBoundViolations.push(`day=${day} soc.history=${p.soc.history.length}>20 @${p.id}`);
      }
      // AIError 事件
      stats.aiErrorEvents += (world.events?.log?.ai || []).filter((e) => e.type === 'AIError').length;
      // 命令失败码死循环刷屏（doc24 SIM-LONG ④：单码日增 > 200 判死循环）
      const failed = world.stats?.commandsFailed || {};
      for (const code of Object.keys(failed)) {
        const prev = stats.failCodeBaseline[code] || 0;
        if (failed[code] - prev > 200) stats.commandFailSpikes.push(`day=${day} ${code} +${failed[code] - prev}`);
        stats.failCodeBaseline[code] = failed[code];
      }
      // 全银河纯洁度 + 不变量（逐日全量扫描代价高：每 10 日一次全量 purity + 不变量）
      if (day % 10 === 0) {
        const purity = scanWorldPurity(world);
        if (purity.nanInf.length > 0) {
          throw new Error(`[SOAK] day=${day} 全银河实体库被污染: ${purity.nanInf.slice(0, 3).join('; ')}`);
        }
        stats.purityScans++;
        const problems = checkWorldInvariants(world);
        if (problems.length > 0) {
          stats.invariantViolations.push(`day=${day}: ${problems.slice(0, 2).join('; ')}`);
          if (stats.invariantViolations.length > 3) break;
        }
      }
    }
  }

  if (auditor.violations.length > 0) {
    throw new Error(`[SOAK] AI 折返反模式: ${JSON.stringify(auditor.violations.slice(0, 3))}`);
  }
  if (stats.logBoundViolations.length > 0) {
    throw new Error(`[SOAK] 有界日志越界: ${stats.logBoundViolations.slice(0, 3).join('; ')}`);
  }
  if (stats.commandFailSpikes.length > 0) {
    throw new Error(`[SOAK] 命令失败码死循环: ${stats.commandFailSpikes.slice(0, 3).join('; ')}`);
  }
  if (stats.invariantViolations.length > 0) {
    throw new Error(`[SOAK] 不变量违规: ${stats.invariantViolations[0]}`);
  }

  stats.msPerDay = (performance.now() - t0) / days;
  stats.pingPongViolations = auditor.violations.length;
  return stats;
}
