/**
 * tests/suites/ground-mission.suite.js — 地面行动（rework2 R8 门禁）
 *
 * GROUND-01 确定性：同种子世界下地图/单位布局/逐步推演完全一致；
 * GROUND-02 结算正确性与确定性：奖励与模板一致、账本入账与经验严格对账；
 * GROUND-03 结算幂等：finishMission/abortMission 结算锁防重复入账。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import {
  createGroundMission, stepMission, finishMission, abortMission,
} from '../../src/domain/ground/GroundMission.js';
import { findMissionTemplate } from '../../src/content/missions.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';

const TEMPLATE = 'gmt_relic_survey';
const DT = 1 / 30;

/** FNV-1a 网格摘要（grid[y*w+x]） */
function gridDigest(grid, w, h) {
  let acc = 0x811c9dc5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc ^= grid[y * w + x] & 0xff;
      acc = Math.imul(acc, 0x01000193);
    }
  }
  return acc >>> 0;
}

/** 任务动态状态摘要（确定性对拍用；排除跨世界实体 id 与日志/输入等瞬时字段） */
function missionDigest(mission) {
  const pick = (arr) => (arr || []).map((u) => ({
    x: u.x, y: u.y, hp: u.hp, shield: u.shield, state: u.state,
    facing: Math.round(u.facing * 1000) / 1000, type: u.type || null,
  }));
  return JSON.stringify({
    grid: gridDigest(mission.grid, mission.w, mission.h),
    w: mission.w, h: mission.h,
    spawn: mission.spawn, extraction: mission.extraction,
    players: pick(mission.playerUnits),
    enemies: pick(mission.enemies),
    targets: (mission.targets || []).map((t) => ({ x: t.x, y: t.y, done: t.done })),
    objectives: mission.objectives.map((o) => ({ done: o.done, progress: o.progress, doneCount: o.doneCount })),
    time: Math.round(mission.time * 1000) / 1000,
    stats: mission.stats,
    idSeq: mission.idSeq,
  });
}

function balances(world) {
  return JSON.stringify(world.economy.ledgers[world.playerFactionId]?.balances || {});
}

/** 新建战役 + 生成地面任务 */
function freshMission(seed, opts = {}) {
  const world = createStarterCampaign({ seed });
  const mission = createGroundMission(world, { templateId: TEMPLATE, ...opts });
  return { world, mission };
}

export const suite01 = {
  id: 'GROUND-01',
  name: '地面行动确定性（地图/单位/推演对拍）',
  group: 'ground',
  async run() {
    const a = freshMission(4101);
    const b = freshMission(4101);
    try {
      if (a.mission.gridDigest !== undefined) return { ok: false, detail: '意外字段' };
      const d1 = missionDigest(a.mission);
      const d2 = missionDigest(b.mission);
      if (d1 !== d2) return { ok: false, detail: '同种子初始任务状态不一致' };

      // 180 步（6 秒）零输入推演对拍：敌人 AI/目标机均走任务内 rngState
      for (let i = 0; i < 180; i++) { stepMission(a.world, a.mission, DT); stepMission(b.world, b.mission, DT); }
      const d3 = missionDigest(a.mission);
      const d4 = missionDigest(b.mission);
      if (d3 !== d4) return { ok: false, detail: '180 步推演后状态发散' };
      if (a.mission.time < 5.9) return { ok: false, detail: `推演未推进：${a.mission.time}` };

      // 不同种子必须产生不同地图（防「恒等」假阳性）
      const c = freshMission(4102);
      if (gridDigest(c.mission.grid, c.mission.w, c.mission.h) === gridDigest(a.mission.grid, a.mission.w, a.mission.h)
          && JSON.stringify(c.mission.spawn) === JSON.stringify(a.mission.spawn)) {
        return { ok: false, detail: '不同种子地图完全相同（确定性检验失效）' };
      }
      const inv = checkWorldInvariants(a.world);
      if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
      return { ok: true };
    } finally {
      // 不落盘：世界为内存对象，无需清理
    }
  },
};

export const suite02 = {
  id: 'GROUND-02',
  name: '地面行动结算正确性（奖励对账/经验）',
  group: 'ground',
  async run() {
    const tpl = findMissionTemplate(TEMPLATE);
    if (!tpl || !Array.isArray(tpl.rewards)) return { ok: false, detail: '任务模板或 rewards 缺失' };

    // 两棵同种子世界独立结算，对账必须逐字节一致
    const runs = [];
    for (let k = 0; k < 2; k++) {
      const world = createStarterCampaign({ seed: 4202 });
      const pid = world.playerFactionId;
      const chars = Object.values(world.entities.characters).filter((c) => c.factionId === pid).slice(0, 2);
      if (chars.length < 1) return { ok: false, detail: '无可用角色' };
      const charIds = chars.map((c) => c.id);
      const before = JSON.parse(balances(world));
      const mission = createGroundMission(world, { templateId: TEMPLATE, squadCharacterIds: charIds });
      const xp0 = charIds.map((id) => world.entities.characters[id].xp || 0);

      const res = finishMission(world, mission, 'success');
      if (mission.status !== 'success') return { ok: false, detail: `结算后状态异常：${mission.status}` };

      // 奖励与模板逐条一致
      const expect = tpl.rewards.map((r) => ({ resId: r.resId, amount: r.amount }));
      if (JSON.stringify(res.rewardsPaid) !== JSON.stringify(expect)) {
        return { ok: false, detail: `奖励与模板不符：${JSON.stringify(res.rewardsPaid)} ≠ ${JSON.stringify(expect)}` };
      }
      // 账本增量 = 奖励
      const after = JSON.parse(balances(world));
      for (const r of expect) {
        const delta = (after[r.resId] ?? 0) - (before[r.resId] ?? 0);
        if (delta !== r.amount) return { ok: false, detail: `${r.resId} 入账 ${delta} ≠ ${r.amount}` };
      }
      // 存活角色各 +30 XP
      const xp1 = charIds.map((id) => world.entities.characters[id].xp || 0);
      for (let i = 0; i < charIds.length; i++) {
        if (xp1[i] - xp0[i] !== 30) return { ok: false, detail: `${charIds[i]} 经验增量 ${xp1[i] - xp0[i]} ≠ 30` };
      }
      runs.push({ rewards: JSON.stringify(res.rewardsPaid), balances: balances(world) });
    }
    if (runs[0].rewards !== runs[1].rewards || runs[0].balances !== runs[1].balances) {
      return { ok: false, detail: '两棵同种子世界结算结果不一致（确定性破坏）' };
    }
    return { ok: true };
  },
};

export const suite03 = {
  id: 'GROUND-03',
  name: '地面行动结算幂等（防重复入账）',
  group: 'ground',
  async run() {
    // 成功结算后重复 finish / abort 均不得二次入账
    const a = freshMission(4303);
    const world = a.world;
    const res1 = finishMission(world, a.mission, 'success');
    const bal1 = balances(world);
    const res2 = finishMission(world, a.mission, 'success');
    abortMission(world, a.mission);
    if (JSON.stringify(res2) !== JSON.stringify(res1)) return { ok: false, detail: '重复结算返回结果漂移' };
    if (balances(world) !== bal1) return { ok: false, detail: '重复结算二次入账（幂等破坏）' };
    if (a.mission.status !== 'success') return { ok: false, detail: `结算锁后状态被改写：${a.mission.status}` };

    // 失败结算同样锁定：失败无奖励
    const b = freshMission(4304);
    const balB0 = balances(b.world);
    const rf = finishMission(b.world, b.mission, 'failed', 'test');
    if (rf.rewardsPaid.length !== 0) return { ok: false, detail: '失败结算不应发放奖励' };
    finishMission(b.world, b.mission, 'success'); // 试图改判成功
    if (balances(b.world) !== balB0) return { ok: false, detail: '失败后改判成功二次入账' };
    if (b.mission.status !== 'failed') return { ok: false, detail: '失败状态被改写' };

    // 中止幂等：abort 两次 + 事后 finish 均无奖励
    const c = freshMission(4305);
    abortMission(c.world, c.mission);
    const balC = balances(c.world);
    abortMission(c.world, c.mission);
    finishMission(c.world, c.mission, 'success');
    if (balances(c.world) !== balC) return { ok: false, detail: '中止后结算二次入账' };
    if (c.mission.status !== 'aborted') return { ok: false, detail: `中止状态漂移：${c.mission.status}` };

    const inv = checkWorldInvariants(world);
    if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
    return { ok: true };
  },
};
