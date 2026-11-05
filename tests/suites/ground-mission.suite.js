/**
 * tests/suites/ground-mission.suite.js — 地面行动（doc9 §3.1 P0-2 / §四 GATE-01 域侧门禁）
 *
 * 任务运行于 site_meters 米制坐标空间（MissionSiteBlueprint 站点 + 3D 连续地形场）：
 * GROUND-01 确定性：同种子世界 → 任务摘要（单位 xyz/zElev/目标物/敌人/目标清单）逐字节
 *           一致；180 步零输入推演对拍；不同种子地形场必异（防「恒等」假阳性）；
 *           着陆坪部署约束 + 撤离区地表路径可达 smoke。
 * GROUND-02 结算正确性与确定性：奖励与模板 rewards 严格一致、账本增量对账、存活角色
 *           +30 经验；两棵同种子世界结算逐字节一致。
 * GROUND-03 结算幂等：finishMission / abortMission 以 rewardPaid 为结算锁，重复调用
 *           不重复入账；abortMission 不抛错、无奖励。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import {
  createGroundMission, stepMission, finishMission, abortMission,
  getMissionField, MISSION_UNIT_SCALE,
} from '../../src/domain/ground/GroundMission.js';
import { findMissionTemplate } from '../../src/content/missions.js';
import { findPathSurface } from '../../src/domain/ground/surfaceQueries.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';

const TEMPLATE = 'gmt_relic_survey';
const DT = 1 / 30;

/** 行星解析：plt_2 在任意种子下均确定生成（兜底取排序首键） */
function pickPlanetId(world) {
  const bag = world.entities.planets || {};
  if (bag.plt_2) return 'plt_2';
  return Object.keys(bag).sort()[0] || null;
}

/** 数值摘要（3 位小数，确定性对拍用；排除跨世界实体 id 与日志/输入等瞬时字段） */
function r3(v) {
  return Math.round(v * 1000) / 1000;
}

/** 任务动态状态摘要：site_meters 几何（单位 xyz + zElev / 目标物 / 敌人 / 物品），
 *  不含 2D 瓦片网格（P0-2 已废除）与任务场对象（地形场由 world.seed 派生，非任务状态）。 */
function missionDigest(mission) {
  const pick = (arr) => (arr || []).map((u) => ({
    x: r3(u.x), y: r3(u.y), z: r3(u.zElev || 0),
    hp: u.hp, shield: u.shield, state: u.state,
    facing: r3(u.facing), type: u.type || null,
  }));
  return JSON.stringify({
    coordSpace: mission.coordSpace,
    siteId: mission.siteId,
    spawn: mission.spawn ? { x: r3(mission.spawn.x), y: r3(mission.spawn.y) } : null,
    extraction: mission.extraction
      ? { x: r3(mission.extraction.x), z: r3(mission.extraction.z), r: mission.extraction.r }
      : null,
    players: pick(mission.playerUnits),
    enemies: pick(mission.enemies),
    npcs: (mission.npcs || []).map((n) => ({ x: r3(n.x), y: r3(n.y), z: r3(n.zElev || 0), kind: n.kind, done: n.done })),
    targets: (mission.targets || []).map((t) => ({ x: r3(t.x), y: r3(t.y), z: r3(t.zElev || 0), done: t.done })),
    items: (mission.items || []).map((i) => ({ x: r3(i.x), y: r3(i.y), done: i.done })),
    objectives: mission.objectives.map((o) => ({ done: o.done, progress: r3(o.progress), doneCount: o.doneCount })),
    time: r3(mission.time),
    stats: mission.stats,
    idSeq: mission.idSeq,
  });
}

function balances(world) {
  return JSON.stringify(world.economy.ledgers[world.playerFactionId]?.balances || {});
}

/** 新建战役 + 构建站点任务场（每种子一场，getMissionField 内部 LRU 复用）+ 生成地面任务 */
function freshMission(seed, opts = {}) {
  const world = createStarterCampaign({ seed });
  const planetId = pickPlanetId(world);
  const field = getMissionField(world, planetId);
  const mission = createGroundMission(world, { templateId: TEMPLATE, planetId, field, ...opts });
  return { world, planetId, field, mission };
}

export const suite01 = {
  id: 'GROUND-01',
  name: '地面行动确定性（site_meters 站点/单位/推演对拍）',
  group: 'ground',
  async run() {
    const a = freshMission(4101);
    const ma = a.mission;
    const site = ma.site;

    // P0-2 空间拓扑：站点米制坐标空间，2D 瓦片网格彻底移除
    if (ma.coordSpace !== 'site_meters') return { ok: false, detail: `coordSpace=${ma.coordSpace} ≠ site_meters` };
    if (!ma.siteId || !site || !site.anchors) return { ok: false, detail: '站点蓝图未注入' };
    if (ma.grid !== undefined || ma.w !== undefined || ma.h !== undefined) {
      return { ok: false, detail: 'site_meters 任务残留 2D 网格字段' };
    }
    if (!ma.extraction || !(ma.extraction.r > 0)) return { ok: false, detail: '撤离区未绑定站点锚点' };

    // 米制单位刻度（doc8 P0-2：移速 5.2 m/s / 远程 22 m）
    if (MISSION_UNIT_SCALE.playerSpeed !== 5.2 || MISSION_UNIT_SCALE.meleeReach !== 2.2
      || MISSION_UNIT_SCALE.rangedRange !== 22 || MISSION_UNIT_SCALE.interactRadius !== 3.0) {
      return { ok: false, detail: 'MISSION_UNIT_SCALE 与 doc8 P0-2 指定值不符' };
    }
    for (const u of ma.playerUnits) {
      if (u.speed !== MISSION_UNIT_SCALE.playerSpeed || u.range !== MISSION_UNIT_SCALE.rangedRange) {
        return { ok: false, detail: `单位刻度漂移：speed=${u.speed} range=${u.range}` };
      }
      if (!Number.isFinite(u.zElev)) return { ok: false, detail: '单位 zElev 非有限值' };
      const dLanding = Math.hypot(u.x - site.anchors.landing.x, u.y - site.anchors.landing.z);
      if (dLanding > 12) return { ok: false, detail: `单位距着陆坪 ${dLanding.toFixed(1)}m > 12m（未部署在承台上）` };
    }

    // 同种子确定性：初始任务状态逐字节一致
    const b = freshMission(4101);
    const d1 = missionDigest(ma);
    const d2 = missionDigest(b.mission);
    if (d1 !== d2) return { ok: false, detail: '同种子初始任务状态不一致' };

    // 180 步（6 秒）零输入推演对拍：敌人 AI / 目标机 / 3D LOS 均为任务内确定性路径
    for (let i = 0; i < 180; i++) { stepMission(a.world, ma, DT); stepMission(b.world, b.mission, DT); }
    const d3 = missionDigest(ma);
    const d4 = missionDigest(b.mission);
    if (d3 !== d4) return { ok: false, detail: '180 步推演后状态发散' };
    if (ma.time < 5.9) return { ok: false, detail: `推演未推进：${ma.time}` };

    // 不同种子必须产生不同地形场（zElev 随行星种子派生，防「恒等」假阳性）
    const c = freshMission(4102);
    if (missionDigest(c.mission) === d1) {
      return { ok: false, detail: '不同种子任务摘要完全相同（确定性检验失效）' };
    }

    // 撤离区地表路径可达 smoke（A*；锚点间由站点生成门禁保证连通）
    const path = findPathSurface(a.field, site.anchors.landing.x, site.anchors.landing.z, ma.extraction.x, ma.extraction.z);
    if (!path) return { ok: false, detail: '着陆坪 → 撤离区无地表路径' };

    const inv = checkWorldInvariants(a.world);
    if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
    return { ok: true };
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
      const planetId = pickPlanetId(world);
      const field = getMissionField(world, planetId);
      const pid = world.playerFactionId;
      const chars = Object.values(world.entities.characters).filter((c) => c.factionId === pid).slice(0, 2);
      if (chars.length < 1) return { ok: false, detail: '无可用角色' };
      const charIds = chars.map((c) => c.id);
      const before = JSON.parse(balances(world));
      const mission = createGroundMission(world, { templateId: TEMPLATE, planetId, field, squadCharacterIds: charIds });
      if (mission.coordSpace !== 'site_meters') return { ok: false, detail: '结算对账任务未运行于 site_meters' };
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
    let abortErr = null;
    try { abortMission(world, a.mission); } catch (e) { abortErr = e && e.message; }
    if (abortErr) return { ok: false, detail: `abortMission 抛错：${abortErr}` };
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

    // 中止幂等：abort 两次 + 事后 finish 均无奖励、不抛错
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
