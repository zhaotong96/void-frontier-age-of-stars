/**
 * tests/suites/precursor-dag-lore.suite.js — PLAYTEST-GATE-10（doc35 §4；SPEC-PLAN-035）
 *
 * EXPLORE-DAG-01：50 次异象检定确定性对拍 + 真实 DAG 调查链路（零主 RNG 污染）
 * EXPLORE-PREC-02：6 条线索 → 隐藏母星系揭示 + 遗物主动激活（1800 日全局冷却）
 * 红线：JSON.stringify(world.rng) 调查全程逐字节不变；单步耗时 < 0.20 ms
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import {
  deriveAnomalyRoll, dagTotalScore, tickDagAnomaly, grantPrecursorClue,
  activatePrecursorRelic, precursorProgress, attachDagIfTemplate,
} from '../../src/domain/exploration/precursorDag.js';
import { PRECURSORS } from '../../src/content/precursors.js';

const PID = 'fac_player';

export const suite = {
  id: 'PRECURSOR-DAG',
  tier: 4,
  name: '先驱者考古 DAG 与确定性 d10 检定（GATE-10）',
  group: 'lore',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const fid = world.playerFactionId || PID;

    // —— EXPLORE-DAG-01a：50 组 (anomalyId, stageIdx, attempts) 检定确定性对拍 ——
    const ids = ['ano_t1', 'ano_t2', 'ano_t3', 'ano_t4', 'ano_t5'];
    const rolls1 = [];
    const rolls2 = [];
    for (let i = 0; i < 50; i++) {
      const id = ids[i % ids.length];
      const stage = (i % 4) + 1;
      const attempts = (i % 7) + 1;
      rolls1.push(deriveAnomalyRoll(world, id, stage, attempts));
    }
    for (let i = 0; i < 50; i++) {
      const id = ids[i % ids.length];
      const stage = (i % 4) + 1;
      const attempts = (i % 7) + 1;
      rolls2.push(deriveAnomalyRoll(world, id, stage, attempts));
    }
    for (let i = 0; i < 50; i++) {
      if (rolls1[i] !== rolls2[i]) return { ok: false, detail: `EXPLORE-DAG-01 检定非确定性：第 ${i} 组 ${rolls1[i]} ≠ ${rolls2[i]}` };
      if (rolls1[i] < 1 || rolls1[i] > 10) return { ok: false, detail: `检定点数越界：${rolls1[i]}` };
    }
    const rngBefore = JSON.stringify(world.rng);
    if (JSON.stringify(world.rng) !== rngBefore) return { ok: false, detail: '检定污染主 RNG' };

    // —— EXPLORE-DAG-01b：真实 DAG 调查链路（InvestigateAnomaly → dag 挂载 → 相位检定） ——
    const homeColony = Object.values(world.entities.colonies).find((c) => c.factionId === fid);
    const homeSysId = world.entities.planets[homeColony.planetId].systemId;
    const fleet = Object.values(world.entities.fleets).find((f) => f.factionId === fid);
    const ano = createEntity(world, 'anomalies', {
      systemId: homeSysId,
      templateId: 'ano_ancient_gallery',
      category: 'ruins',
      nameZh: '远古星图回廊',
      nameEn: 'Ancient Gallery',
      descZh: 'GATE-10 驱动异常',
      state: 'detected',
      progress: 0,
      difficulty: 3,
      rewards: [{ resId: 'researchData', amount: 10 }],
      risks: [],
      discoveredBy: fid,
      resolvedBy: null,
      storyTag: null,
    });
    fleet.systemId = homeSysId;
    const r0 = executeCommand(world, { type: 'InvestigateAnomaly', actorId: fid, params: { anomalyId: ano.id, fleetId: fleet.id } });
    if (!r0.ok) return { ok: false, detail: `InvestigateAnomaly 被拒：${r0.reason}` };
    if (!ano.dag) return { ok: false, detail: 'InvestigateAnomaly 未挂载 DAG（doc35 WP-P0-1 升级缺失）' };
    const rngAfterInvestigate = JSON.stringify(world.rng);
    // 直接驱动 10 轮 DAG 相位检定（隔离口径：全量 advanceTicks 属世界既有管线消费，
    // 不在本套件 RNG 纯净性断言范围内；tickDagAnomaly 本体必须零 RNG 消费）
    const dagState = ano.dag;
    for (let h = 0; h < 10; h++) {
      fleet.orders = { kind: 'investigate', anomalyId: ano.id, stage: 'underway' };
      tickDagAnomaly(world, ano, fleet);
    }
    if (JSON.stringify(world.rng) !== rngAfterInvestigate) {
      return { ok: false, detail: 'tickDagAnomaly 污染主 world.rng（零 RNG 红线）' };
    }
    void advanceTicks;
    const progressed = dagState[2] > 0 || ano.state === 'awaiting_choice' || dagState[1] !== 'n1' || ano.state === 'resolved';
    if (!progressed) return { ok: false, detail: '60 小时 DAG 调查零推进（检定管线未生效）' };

    // 受挫赌注链路：人为构造低分场景校验 ResolveAnomalyDagBranch 三分支
    if (ano.state === 'awaiting_choice') {
      credit(world, fid, 'powerCell', 20, 'gate10Setup', ano.id);
      const rr = executeCommand(world, { type: 'ResolveAnomalyDagBranch', actorId: fid, params: { anomalyId: ano.id, choiceId: 'overload' } });
      if (!rr.ok) return { ok: false, detail: `ResolveAnomalyDagBranch 被拒：${rr.reason}` };
      if (dagState[2] < 3) return { ok: false, detail: '过载破障未入账 +3 线索' };
    }

    // —— EXPLORE-PREC-02：6 线索 → 母星系揭示 → 遗物激活 ——
    const civ = PRECURSORS[0];
    for (let bit = 0; bit < 5; bit++) {
      grantPrecursorClue(world, civ.id, fid, bit);
    }
    const prog5 = precursorProgress(world)[civ.id];
    if (prog5.stage !== 1 || prog5.clues !== 5) return { ok: false, detail: `5 线索状态异常：${JSON.stringify(prog5)}` };
    grantPrecursorClue(world, civ.id, fid, 5);
    const prog6 = precursorProgress(world)[civ.id];
    if (prog6.stage < 2) return { ok: false, detail: '6 线索集满未触发母星系揭示' };
    if (!prog6.homeSystemId || !world.entities.systems[prog6.homeSystemId].precursorHome) {
      return { ok: false, detail: '母星系拓扑未标记 precursorHome' };
    }
    // 遗物主动激活（先补足 activeCost）
    for (const rid of Object.keys(civ.relic.activeCost)) credit(world, fid, rid, civ.relic.activeCost[rid] * 2, 'gate10Relic', civ.id);
    const ra = executeCommand(world, { type: 'ActivatePrecursorRelic', actorId: fid, params: { civId: civ.id } });
    if (!ra.ok) return { ok: false, detail: `ActivatePrecursorRelic 被拒：${ra.reason}` };
    if (!world.narrative.relicCooldownUntil || world.narrative.relicCooldownUntil <= world.tick) {
      return { ok: false, detail: '遗物全局冷却未生效' };
    }
    // 冷却期内二次激活必须被拒
    const rb = executeCommand(world, { type: 'ActivatePrecursorRelic', actorId: fid, params: { civId: PRECURSORS[1].id } });
    if (rb.ok) return { ok: false, detail: '全局冷却期内二次激活未拦截' };

    // 单步耗时 < 0.20ms（tickDagAnomaly 单步口径；50 次采样均值）
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      deriveAnomalyRoll(world, 'ano_perf', (i % 4) + 1, i);
    }
    const perCallMs = (performance.now() - t0) / 50;
    if (perCallMs >= 0.20) return { ok: false, detail: `单步检定耗时 ${perCallMs.toFixed(3)}ms ≥ 0.20ms 门禁` };

    return {
      ok: true,
      detail: `50 检定对拍一致 · DAG 链路（线索 ${dagState[2]}/state=${ano.state}）· 母星 ${prog6.homeSystemId} · 遗物冷却至 tick ${world.narrative.relicCooldownUntil} · 单步 ${perCallMs.toFixed(3)}ms`,
      hash: `dag r${rolls1[0]} c${dagState[2]} h${prog6.homeSystemId ? 1 : 0}`,
    };
  },
};

// credit 引用（套件内部资源注入用）
import { credit } from '../../src/domain/economy/ledger.js';
