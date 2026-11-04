/**
 * tests/suites/objectives-poi.suite.js — 持久化行星 POI 与空间任务目标
 * （doc5 §3.6/§3.7 / doc7 TASK-2.3；门禁 EVT-01 / WORLD-03 / SAVE-03 / THEME-05 前置）
 *
 * OBJ-01 汇总套件：
 *  (a) EVT-01  evt_pirate_raid 触发 → active WorldObjective + 合法 target/secondary；
 *  (b) WORLD-03 同种子两世界 POI 结构逐位一致 + 生成不消费 world.rng + 旧档惰性重建一致；
 *  (c) SAVE-03  采样幂等：二次拒绝；SaveCodec 序列化→反序列化→仍拒绝；
 *  (d) 结算对账：账本入账、deep_vein 矿藏 +35%、subsurface_ocean 宜居度 +8；
 *  (e) 离屏箭头数学（computeOffscreenArrow 纯函数）；
 *  (f) 目标过期：deadline 后清扫一次性罚则（重复清扫零副作用）。
 */

import { createStarterCampaign, createMinimalWorld } from '../../src/devtools/scenarioFactory.js';
import { EVENT_DEFS, isSpatialEvent } from '../../src/content/events.js';
import { fireEvent } from '../../src/domain/events/narrative.js';
import {
  createWorldObjective, dailyObjectiveSweep, computeOffscreenArrow,
} from '../../src/domain/events/objectives.js';
import {
  generatePlanetPois, ensurePlanetPois, harvestPlanetPoi, unexploredPoiCount,
} from '../../src/domain/ground/planetPOI.js';
import { encodeSave, validateSaveRecord } from '../../src/persistence/SaveCodec.js';
import { balance } from '../../src/domain/economy/ledger.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';

/** 在世界中找一颗未殖民、且带指定 kind 未探索 POI 的行星（确定性序） */
function findPlanetWithKind(world, kind) {
  const ids = Object.keys(world.entities.planets).sort();
  for (const id of ids) {
    const p = world.entities.planets[id];
    if (p.colonyId) continue;
    const poi = Object.values(p.pois || {}).find((q) => q.kind === kind && q.state === 'unexplored');
    if (poi) return { planet: p, poi };
  }
  return null;
}

/** (a)(b) 共用： EVT-01 断言 */
function assertPirateObjective(world) {
  const def = EVENT_DEFS.find((e) => e.id === 'evt_pirate_raid');
  if (!def) return 'evt_pirate_raid 定义缺失';
  fireEvent(world, def);
  const objs = Object.values(world.entities.objectives || {})
    .filter((o) => o.status === 'active' && o.sourceEventId === 'evt_pirate_raid');
  if (objs.length !== 1) return `预期 1 个 active 目标，实得 ${objs.length}`;
  const o = objs[0];
  if (o.kind !== 'escort_lane') return `kind 异常：${o.kind}`;
  if (!o.targetSystemId || !world.entities.systems[o.targetSystemId]) return 'targetSystemId 不可解析';
  if (!o.secondarySystemId || !world.entities.systems[o.secondarySystemId]) return 'secondarySystemId 不可解析';
  const lanes = world.entities.systems[o.targetSystemId].lanes || [];
  if (!lanes.includes(o.secondarySystemId)) return 'secondary 不在目标航路表中';
  if (!(o.deadlineTick > o.createdTick)) return '行动窗口非法';
  return null;
}

export const suite = {
  id: 'OBJ-01',
  name: '持久化行星 POI 与 WorldObjective 空间目标',
  group: 'WORLD',
  async run() {
    // —— (a) EVT-01：航线劫掠生成空间目标 ——————————————————————
    const wa = createStarterCampaign({ seed: 5101 });
    let err = assertPirateObjective(wa);
    if (err) return { ok: false, detail: `EVT-01: ${err}` };
    const invA = checkWorldInvariants(wa);
    if (invA.length > 0) return { ok: false, detail: `EVT-01 不变量: ${invA.slice(0, 2).join(';')}` };
    // 同源事件重复触发不重复建目标（冷却内防堆积）
    fireEvent(wa, EVENT_DEFS.find((e) => e.id === 'evt_pirate_raid'));
    const dupCount = Object.values(wa.entities.objectives)
      .filter((o) => o.status === 'active' && o.sourceEventId === 'evt_pirate_raid').length;
    if (dupCount !== 1) return { ok: false, detail: `EVT-01 去重失败：${dupCount}` };

    // —— (b) WORLD-03：同种子 POI 确定性 + world.rng 零消费 ————————
    const wb = createStarterCampaign({ seed: 5101 });
    const planetsB = Object.keys(wb.entities.planets).sort();
    const planetsA = Object.keys(wa.entities.planets).sort();
    if (planetsA.join(',') !== planetsB.join(',')) return { ok: false, detail: 'WORLD-03: 行星 id 序不一致' };
    for (const id of planetsA) {
      const pa = JSON.stringify(wa.entities.planets[id].pois || {});
      const pb = JSON.stringify(wb.entities.planets[id].pois || {});
      if (pa !== pb) return { ok: false, detail: `WORLD-03: ${id} POI 结构漂移` };
    }
    // 生成路径 rng 纯度：删除后 ensurePlanetPois 重建，主 RNG 状态与结构均逐位不变
    const probe = wb.entities.planets[planetsB[0]];
    const rngBefore = JSON.stringify(wb.rng);
    const poiSnapshot = JSON.stringify(probe.pois);
    delete probe.pois;
    ensurePlanetPois(wb, probe);
    if (JSON.stringify(wb.rng) !== rngBefore) return { ok: false, detail: 'WORLD-03: ensurePlanetPois 消费了 world.rng' };
    if (JSON.stringify(probe.pois) !== poiSnapshot) return { ok: false, detail: 'WORLD-03: 惰性重建与开局生成不一致' };
    // 直呼生成器同样零消费
    const rngBefore2 = JSON.stringify(wb.rng);
    generatePlanetPois(wb, probe, { danger: 2 });
    if (JSON.stringify(wb.rng) !== rngBefore2) return { ok: false, detail: 'WORLD-03: generatePlanetPois 消费了 world.rng' };
    // gasGiant 恰 1 个 POI；其余 1..3
    for (const id of planetsA) {
      const p = wa.entities.planets[id];
      const n = Object.keys(p.pois || {}).length;
      if (p.category === 'gasGiant' ? n !== 1 : (n < 1 || n > 3)) {
        return { ok: false, detail: `WORLD-03: ${id} (${p.category}) POI 数量 ${n} 越界` };
      }
    }
    // 不同种子必须不同（防恒等假阳性）
    const wc = createStarterCampaign({ seed: 5102 });
    const same = planetsA.every((id) => {
      const pc = wc.entities.planets[id];
      return pc && JSON.stringify(wa.entities.planets[id].pois || {}) === JSON.stringify(pc.pois || {});
    });
    if (same) return { ok: false, detail: 'WORLD-03: 不同种子 POI 完全相同（确定性检验失效）' };

    // —— (c) SAVE-03：采样幂等 + 存档往返后仍拒绝 ——————————————————
    const wd = createStarterCampaign({ seed: 5201 });
    const hit = findPlanetWithKind(wd, 'crashed_ship') || findPlanetWithKind(wd, 'ancient_ruin');
    if (!hit) return { ok: false, detail: 'SAVE-03: 未找到可采样 POI' };
    const r1 = harvestPlanetPoi(wd, hit.planet.id, hit.poi.id, wd.playerFactionId);
    if (!r1.ok) return { ok: false, detail: `SAVE-03: 首次采样失败 ${r1.code}` };
    const r2 = harvestPlanetPoi(wd, hit.planet.id, hit.poi.id, wd.playerFactionId);
    if (r2.ok || r2.code !== 'ALREADY_HARVESTED') return { ok: false, detail: `SAVE-03: 二次采样未被拒绝 ${JSON.stringify(r2)}` };
    const rec = encodeSave(wd, { factionName: 'test' });
    const vres = validateSaveRecord(rec);
    if (!vres.ok) return { ok: false, detail: `SAVE-03: 存档校验失败 ${vres.reason}` };
    const restored = JSON.parse(JSON.stringify(rec.payload));
    if (restored.entities.planets[hit.planet.id].pois[hit.poi.id].rewardPaid !== true) {
      return { ok: false, detail: 'SAVE-03: 存档后 rewardPaid 未持久化' };
    }
    const r3 = harvestPlanetPoi(restored, hit.planet.id, hit.poi.id, restored.playerFactionId);
    if (r3.ok || r3.code !== 'ALREADY_HARVESTED') return { ok: false, detail: `SAVE-03: 读档后重复发奖 ${JSON.stringify(r3)}` };

    // —— (d) 结算对账：账本 / deep_vein +35% / subsurface +8 ——————————
    const we = createStarterCampaign({ seed: 5301 });
    const pid2 = we.playerFactionId;
    const dv = findPlanetWithKind(we, 'deep_vein');
    const so = findPlanetWithKind(we, 'subsurface_ocean');
    if (!dv || !so) return { ok: false, detail: '结算对账: 缺 deep_vein 或 subsurface_ocean 样本' };

    // deep_vein：资源 +40 入阵营账本；矿藏 ×1.35（缺矿藏则授予 60）
    const depKey = (dv.planet.deposits || {}).rareEarth > 0 ? 'rareEarth'
      : (dv.planet.deposits || {}).heavyMetal > 0 ? 'heavyMetal' : 'rareEarth';
    const depBefore = dv.planet.deposits[depKey] || 0;
    const balBefore = balance(we, pid2, depKey);
    const rdv = harvestPlanetPoi(we, dv.planet.id, dv.poi.id, pid2);
    if (!rdv.ok) return { ok: false, detail: `deep_vein 采样失败 ${rdv.code}` };
    if (rdv.rewards[depKey] !== 40) return { ok: false, detail: `deep_vein 奖励异常 ${JSON.stringify(rdv.rewards)}` };
    if (balance(we, pid2, depKey) !== balBefore + 40) return { ok: false, detail: 'deep_vein 账本入账不符' };
    const depExpected = depBefore > 0 ? Math.round(depBefore * 1.35) : 60;
    if (dv.planet.deposits[depKey] !== depExpected) {
      return { ok: false, detail: `deep_vein 矿藏回写 ${dv.planet.deposits[depKey]} ≠ 期望 ${depExpected}` };
    }

    // subsurface_ocean：biomass 35 / researchData 20（数据只入阵营账本）；宜居度 +8
    const habBefore = so.planet.habitability;
    const bioBefore = balance(we, pid2, 'biomass');
    const resBefore = balance(we, pid2, 'researchData');
    const rso = harvestPlanetPoi(we, so.planet.id, so.poi.id, pid2);
    if (!rso.ok) return { ok: false, detail: `subsurface 采样失败 ${rso.code}` };
    if (rso.rewards.biomass !== 35 || rso.rewards.researchData !== 20) {
      return { ok: false, detail: `subsurface 奖励异常 ${JSON.stringify(rso.rewards)}` };
    }
    if (balance(we, pid2, 'biomass') !== bioBefore + 35) return { ok: false, detail: 'biomass 账本不符' };
    if (balance(we, pid2, 'researchData') !== resBefore + 20) return { ok: false, detail: 'researchData 账本不符' };
    if (so.planet.habitability !== Math.min(90, habBefore + 8)) return { ok: false, detail: `宜居度回写 ${so.planet.habitability} ≠ ${habBefore + 8}` };
    // 状态迁移与计数
    if (dv.poi.state !== 'explored' || dv.poi.rewardPaid !== true || dv.poi.revision !== 2) {
      return { ok: false, detail: 'POI 状态/版本迁移异常' };
    }
    const harvestedOnSo = 1 + (dv.planet.id === so.planet.id ? 1 : 0); // 同行星可能带两类 POI
    if (unexploredPoiCount(so.planet) !== Object.keys(so.planet.pois).length - harvestedOnSo) {
      return { ok: false, detail: 'unexploredPoiCount 计数不符' };
    }
    const invE = checkWorldInvariants(we);
    if (invE.length > 0) return { ok: false, detail: `结算后不变量: ${invE.slice(0, 2).join(';')}` };

    // —— (e) 离屏箭头数学 ————————————————————————————————————
    const W = 1200;
    const H = 800;
    const on = computeOffscreenArrow(300, 300, W, H);
    if (!on.onScreen) return { ok: false, detail: '箭头: 屏内点被误判离屏' };
    const right = computeOffscreenArrow(W / 2 + 1000, H / 2, W, H);
    if (right.onScreen) return { ok: false, detail: '箭头: 远右点被误判在屏' };
    if (Math.abs(right.angle) > 1e-9) return { ok: false, detail: `箭头: 右向角 ${right.angle}` };
    if (Math.abs(right.x - (W / 2 + right.padX)) > 1e-6) return { ok: false, detail: '箭头: 右边界交点不符' };
    if (right.padX !== Math.max(80, W / 2 - 84)) return { ok: false, detail: '箭头: padX 公式不符' };
    const top = computeOffscreenArrow(W / 2, -500, W, H);
    if (Math.abs(top.angle - (-Math.PI / 2)) > 1e-9) return { ok: false, detail: `箭头: 上向角 ${top.angle}` };
    if (Math.abs(top.y - (H / 2 - top.padY)) > 1e-6) return { ok: false, detail: '箭头: 上边界交点不符' };
    if (top.padY !== Math.max(60, H / 2 - 64)) return { ok: false, detail: '箭头: padY 公式不符' };
    const left = computeOffscreenArrow(-9999, H / 2, W, H);
    if (Math.abs(left.x - (W / 2 - left.padX)) > 1e-6) return { ok: false, detail: '箭头: 左边界交点不符' };
    if (left.x < 84 - 1e-6) return { ok: false, detail: '箭头: 越过左侧导航安全线' };

    // —— (f) 过期清扫 + 一次性罚则 ————————————————————————————
    const wf = createStarterCampaign({ seed: 5401 });
    const sysIds = Object.keys(wf.entities.systems).sort();
    const o1 = createWorldObjective(wf, {
      sourceEventId: 'test_expire',
      titleZh: '测试目标',
      descZh: '过期罚则验证',
      kind: 'investigate_system',
      targetSystemId: sysIds[0],
      durationHours: 24,
      penalty: { credits: 120 },
    });
    if (!o1) return { ok: false, detail: '过期: 目标创建失败' };
    const flagObj = createWorldObjective(wf, {
      sourceEventId: 'test_expire_flag',
      titleZh: '测试目标二',
      descZh: '旗标罚则验证',
      kind: 'survey_planet',
      targetSystemId: sysIds[1] || sysIds[0],
      durationHours: 48,
      penalty: { flag: 'obj_test_flag' },
    });
    wf.tick = Math.max(o1.deadlineTick, flagObj.deadlineTick) + 1;
    const creditsBefore = balance(wf, wf.playerFactionId, 'credits');
    const n1 = dailyObjectiveSweep(wf);
    if (n1 !== 2) return { ok: false, detail: `过期: 首次清扫数 ${n1} ≠ 2` };
    if (o1.status !== 'expired' || flagObj.status !== 'expired') return { ok: false, detail: '过期: 状态未迁移' };
    if (balance(wf, wf.playerFactionId, 'credits') !== creditsBefore - 120) return { ok: false, detail: '过期: 信用罚则未入账' };
    if (wf.narrative.flags.obj_test_flag === undefined) return { ok: false, detail: '过期: 旗标罚则未写入' };
    const creditsAfter = balance(wf, wf.playerFactionId, 'credits');
    const n2 = dailyObjectiveSweep(wf);
    if (n2 !== 0) return { ok: false, detail: `过期: 重复清扫数 ${n2} ≠ 0` };
    if (balance(wf, wf.playerFactionId, 'credits') !== creditsAfter) return { ok: false, detail: '过期: 罚则重复应用' };

    // —— 内容接线健全性：B 类事件全部有锚点解析器 ——————————————
    for (const id of ['evt_pirate_raid', 'evt_famine_relieef', 'evt_signal_frontier', 'evt_deepspace_signal', 'evt_frontier_dispute']) {
      if (!isSpatialEvent(id)) return { ok: false, detail: `空间事件解析器缺失：${id}` };
    }
    return { ok: true };
  },
};

// 极小世界回归（防 galaxyGen 早期路径回归）：1 星系也带 POI
export const suiteMin = {
  id: 'OBJ-02',
  name: '最小世界 POI 兼容（createMinimalWorld 路径）',
  group: 'WORLD',
  async run() {
    const world = createMinimalWorld(777);
    const planets = Object.values(world.entities.planets);
    if (!planets.length || planets.some((p) => !p.pois || Object.keys(p.pois).length === 0)) {
      return { ok: false, detail: '最小世界行星缺少 POI' };
    }
    const inv = checkWorldInvariants(world);
    if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
    return { ok: true };
  },
};
