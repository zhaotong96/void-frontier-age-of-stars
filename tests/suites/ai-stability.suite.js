/**
 * tests/suites/ai-stability.suite.js — AI-02 战役稳定性 + AI-03 战争与战斗结算
 *
 * 本文件含两个套件（任务书第 7 条：AI-03 为同文件第二套件；受「仅新建 8 个
 * 新套件文件」约束，与 AI-02 共用本文件，由 index.js 分别注册）。
 *
 * AI-02（seed 9，推进半年 4320 tick）：
 *  - checkWorldInvariants 无问题；无 AIError 事件；
 *  - AI 命令失败无 NO_FUNDS / QUEUE_FULL 爆量（各 < 50）；
 *  - 每 AI 文明并发 orders ≤ 6；探索在推进（母星之外新完成调查 ≥ 3）。
 *
 * AI-03（seed 21）：强制接触 + 宣战 + 两 combat 舰队同星系 aggressive →
 * 推进 120 tick → battles.history ≥ 1 或 battles.active ≥ 1，且战争
 * exhaustion 增长。
 *
 * 环境说明（不改 src/）：
 *  - 测试链需 side-effect 导入 src/app/commands.js（正式入口是 main.js），
 *    否则命令注册表为空、AI 全部命令静默 UNKNOWN_COMMAND；
 *  - World 工厂未初始化 narrative.pendingChoices，日结 narrative 阶段崩溃，
 *    在世界实例上补空数组。
 */
import '../../src/app/commands.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { getRelation } from '../../src/domain/diplomacy/war.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { assert, assertEq } from './assert.js';

/** 全事件日志中按类型计数 */
function countLogType(world, type) {
  let n = 0;
  for (const arr of Object.values(world.events.log)) {
    for (const e of arr) if (e.type === type) n++;
  }
  return n;
}

/** 母星之外的完整调查（level ≥ 4）星系数 */
function surveyPairsLevel4(world) {
  let n = 0;
  for (const sys of Object.values(world.entities.systems)) {
    for (const lvl of Object.values(sys.surveyedBy || {})) {
      if (lvl >= 4) n++;
    }
  }
  return n;
}

function starterWorld(seed) {
  const world = createStarterCampaign({ seed });
  world.narrative.pendingChoices ||= [];
  return world;
}

// ————————————————————————————————————————————————————————————

export const suite = {
  id: 'AI-02',
  name: 'AI 战役稳定性（半年推进）',
  group: 'ai',
  async run() {
    try {
      const world = starterWorld(9);
      const aiFids = Object.keys(world.ai).filter((f) => f !== world.playerFactionId);
      assertEq(aiFids.length, 5, '标准战役应有 5 个 AI 文明在运转');

      advanceTicks(world, 4320); // 半年（180 天 × 24 小时）

      // 1) 世界不变量（完整检查）为空
      const problems = checkWorldInvariants(world);
      assertEq(problems.length, 0, `世界不变量应通过（实测 ${problems.slice(0, 3).join(' ; ')}）`);

      // 2) 无 AIError 事件（AI 单文明失败会发 AIError 并冷却）
      assertEq(countLogType(world, 'AIError'), 0, '不应出现 AIError 事件');

      // 3) AI 命令失败无爆量：NO_FUNDS / QUEUE_FULL 各 < 50
      const failed = world.stats.commandsFailed || {};
      const noFunds = failed.NO_FUNDS || 0;
      const queueFull = failed.QUEUE_FULL || 0;
      assert(noFunds < 50, `AI NO_FUNDS 失败 ${noFunds} 应 < 50（防空转约束）`);
      assert(queueFull < 50, `AI QUEUE_FULL 失败 ${queueFull} 应 < 50（防空转约束）`);

      // 4) 每 AI 文明并发 orders ≤ 6（评估期并发上限）
      for (const fid of aiFids) {
        const st = world.ai[fid];
        const n = Object.keys(st.orders || {}).length;
        assert(n <= 6, `文明 ${fid} 并发 orders ${n} 应 ≤ 6`);
        assert(st.lastEvalTick > 0, `文明 ${fid} 应被评估过（lastEvalTick=${st.lastEvalTick}）`);
      }

      // 5) 探索在推进：level≥4 调查对 ≥ 3（任务书字面口径），
      //    且高于开局 6 个母星自调查 → 母星之外新增完整调查 ≥ 3
      const surveyed = surveyPairsLevel4(world);
      assert(surveyed >= 3, `完整调查（level≥4）星系数 ${surveyed} 应 ≥ 3`);
      assert(
        surveyed >= 9,
        `探索应在推进：母星之外新增完整调查 ${surveyed - 6} 应 ≥ 3（开局 6 个母星已预调查）`
      );

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};

// ————————————————————————————————————————————————————————————

export const suiteWar = {
  id: 'AI-03',
  name: 'AI 战争与战斗结算',
  group: 'ai',
  async run() {
    try {
      const world = starterWorld(21);
      const aiIds = Object.keys(world.entities.factions)
        .filter((f) => f !== world.playerFactionId)
        .sort();
      assert(aiIds.length >= 2, '至少需要两个 AI 文明');
      const facA = aiIds[0];
      const facB = aiIds[1];

      // 1) 强制接触 + 宣战（经 DeclareWar 命令全流程）
      const rel = getRelation(world, facA, facB);
      rel.contactState = 'contacted'; // 强制完成首次接触
      const rWar = executeCommand(world, {
        type: 'DeclareWar', actorId: facA,
        params: { targetFactionId: facB, wargoal: 'borderSystems' },
      });
      assertEq(rWar.ok, true, `宣战应成功（实测 ${JSON.stringify(rWar)}）`);
      assert(rel.warId, '关系应记录 warId');
      const war = world.entities.wars[rel.warId];
      assertEq(war.status, 'active', '战争状态 active');

      // 2) 两支 combat 舰队调入同星系并置 aggressive
      const homeA = world.entities.factions[facA].homeSystemId;
      const fleetA = Object.values(world.entities.fleets).find((f) => f.factionId === facA && f.role === 'combat');
      const fleetB = Object.values(world.entities.fleets).find((f) => f.factionId === facB && f.role === 'combat');
      assert(fleetA && fleetB, '双方都应有 combat 舰队');
      fleetA.systemId = homeA;
      fleetB.systemId = homeA;
      fleetB.transit = null;
      const rStanceA = executeCommand(world, { type: 'SetFleetStance', actorId: facA, params: { fleetId: fleetA.id, stance: 'aggressive' } });
      const rStanceB = executeCommand(world, { type: 'SetFleetStance', actorId: facB, params: { fleetId: fleetB.id, stance: 'aggressive' } });
      assertEq(rStanceA.ok, true, 'A 舰队姿态设置');
      assertEq(rStanceB.ok, true, 'B 舰队姿态设置');

      // 3) 推进 120 tick：交战触发 → 战斗产生/结束
      advanceTicks(world, 120);

      const historyN = world.battles.history.length;
      const activeN = Object.keys(world.battles.active).length;
      assert(
        historyN >= 1 || activeN >= 1,
        `应产生战斗：history=${historyN}, active=${activeN}`
      );
      assert(
        (world.events.log.combat || []).some((e) => e.type === 'BattleStarted'),
        '应有 BattleStarted 事件'
      );

      // 4) 战争疲劳随战争持续增长（0.005/小时 × ≥120 小时）
      assertEq(war.status, 'active', '战争仍在进行');
      assert(
        (war.exhaustion[facA] || 0) > 0,
        `攻方 exhaustion 应增长（实测 ${war.exhaustion[facA] || 0}）`
      );
      assert(
        (war.exhaustion[facB] || 0) > 0,
        `守方 exhaustion 应增长（实测 ${war.exhaustion[facB] || 0}）`
      );

      // 5) 交战留下痕迹：世界不变量仍干净
      const problems = checkWorldInvariants(world);
      assertEq(problems.length, 0, `战后不变量应通过（实测 ${problems.slice(0, 3).join(' ; ')}）`);

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
