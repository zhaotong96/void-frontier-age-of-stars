/**
 * tests/suites/gameplay-agent-loop.suite.js — 玩法自治 Agent 五阶段闭环（doc25 SPEC-TEST-025 CLI 门禁）
 *
 * AGENT-LOOP：自治 Agent 以纯外部驱动方式在真实运行环境（无打桩、无降级 Mock）
 * 下自主完成：星系跃迁 → 轨道切入 → 地表着陆 → 资源/事件结算 → 存档冷重启验证。
 * 门禁（doc25 §5）：通过率恒定 100%；平均耗时 ≤ 8.0s/轮；零确定性漂移（doc24 v2 运行器 3 轮对拍）。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { SaveManager } from '../../src/persistence/SaveManager.js';
import { AutonomousGameplayAgent } from '../agent/AutonomousGameplayAgent.js';

export const suite = {
  id: 'AGENT-LOOP',
  tier: 4,
  name: '玩法自治 Agent 五阶段闭环（跃迁→轨道→着陆→结算→存读档）',
  group: 'agent',
  async run() {
    const t0 = performance.now();
    const world = createStarterCampaign({ seed: 24601 });
    const saveManager = new SaveManager();
    const agent = new AutonomousGameplayAgent(
      { world, saveManager, ui: null },
      { seed: 24601, missionMaxSteps: 45000 },
    );

    let report;
    try {
      report = await agent.runFullLoop();
    } catch (err) {
      const trace = agent.traceLog.slice(-12)
        .map((t) => `#${t.step}[${t.phase}]${t.type}:${t.detail}`).join(' | ');
      return {
        ok: false,
        detail: `五阶段闭环在「${err.agentPhase || agent.currentPhase}」阶段失败: ${err.message} · 面包屑: ${trace}`,
      };
    }

    const durMs = performance.now() - t0;
    if (durMs > 8000) {
      return { ok: false, detail: `五阶段闭环耗时 ${durMs.toFixed(0)}ms > 8000ms 门禁（doc25 §5.1）` };
    }
    if (!report.slotCleanedUp) {
      return { ok: false, detail: '隔离存档槽位清理失败（污染现场）' };
    }

    const ph = report.phases;
    return {
      ok: true,
      detail: `五阶段闭环 PASS：跃迁 ${ph.jump.elapsedTicks}t(eta${ph.jump.etaTicks}) 燃料 -${ph.jump.fuelDrained}` +
        ` · 扫描 L${ph.orbit.surveyLevel}/${ph.orbit.scanTicks}t ${ph.orbit.planetCount}行星主题载荷 100%` +
        ` · 着陆台阶 ${ph.landing.stepDh} 网格 ${ph.landing.gridMs}ms` +
        ` · 任务 ${ph.settlement.missionStatus}(${ph.settlement.missionSteps}步/${ph.settlement.simSeconds}s) 奖励 ${ph.settlement.rewards.map((r) => `${r.resId}+${r.amount}`).join(',')}` +
        ` · 采掘 ${ph.settlement.harvest.attempted ? `${ph.settlement.harvest.resId}+${ph.settlement.harvest.delta}` : 'N/A'}` +
        ` · 事件 ${ph.settlement.eventSettled ? ph.settlement.eventSettled.eventId : '无待决'}` +
        ` · Hash ${ph.saveRoundtrip.hashA} ≡ ${ph.saveRoundtrip.hashB}(${ph.saveRoundtrip.recordBytes}B)`,
      hash: ph.saveRoundtrip.hashA,
    };
  },
};

export const suiteTrace = {
  id: 'AGENT-TRACE',
  tier: 4,
  name: 'Agent 面包屑轨迹与阶段遥测完整性（doc25 TIP：断言失败可回溯前 50 步）',
  group: 'agent',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const saveManager = new SaveManager();
    const agent = new AutonomousGameplayAgent(
      { world, saveManager, ui: null },
      { seed: 24601, missionMaxSteps: 45000 },
    );
    let phasesSeen = [];
    try {
      await agent.runFullLoop();
    } catch (err) {
      return { ok: false, detail: `闭环失败无法审计轨迹: ${err.message}` };
    }
    phasesSeen = [...new Set(agent.traceLog.map((t) => t.phase))];
    const need = ['jump', 'orbit', 'landing', 'settlement', 'saveRoundtrip'];
    for (const p of need) {
      if (!phasesSeen.includes(p)) return { ok: false, detail: `轨迹缺阶段 ${p}（面包屑断链）` };
    }
    if (agent.traceLog.length < 5) return { ok: false, detail: '面包屑轨迹过稀（<5 条）' };
    return {
      ok: true,
      detail: `轨迹 ${agent.traceLog.length} 条覆盖 5 阶段（${phasesSeen.join('→')}），traceSeq=${agent.traceSeq}`,
    };
  },
};
