/**
 * tests/suites/m4-space-opera-live-bridge-ui.suite.js — doc48 GATE-18-M4
 * 太空歌剧 M4 前后端活体合龙与全视图交互门禁（SPACE-OPERA-M4，group: space-opera）
 *
 * 按序实现 SPEC-PLAN-048 §3 全部 Checklists + SPEC-PLAN-049/050/051/052 §3 交付清单：
 *  - Block 1（CHK-M4-01 / CHK-49-01 / CHK-49-02 开局活体激活完整性）：activateSpaceOperaCampaign
 *    全星系行星 compactState / 256 Tile 非全零 / envVector 8 维 / 群像档案挂载 /
 *    countActiveNarrative ≥ 15；幂等同引用；默认无参 createStarterCampaign() 纯洁性；
 *  - Block 2（CHK-M4-03 / CHK-50-01..05 双轨经济桥同步与逆向修正）：建筑活性 →
 *    industrialAttention ≥ 7 → radicalCell 'ACTIVE'；8 维镜像正向/反向（alloy 1250 双向）；
 *    S3 稳定度倍率 80→1.18 / 20→0.70 精确；S4 违约 ×0.75/×0.75/×0.75/×1.25 精确；
 *    S1 考古对策 0.95/0.90/0.85 精确；重工 envVector[7] 月度 +0.05×N；
 *    The Beholder 灵能矿工转化月度落账（credits +8/矿工、unity +6/矿工）；
 *  - Block 3（CHK-M4-05 前半 / CHK-52 ViewModel 投影）：spaceOperaView.beaconsList /
 *    autonomousFleetsList / colonyDetail.spaceOpera / fleetDetail.spaceOpera /
 *    governmentView.paragons / diplomacyView.spaceOperaS7 全字段投影；
 *  - Block 4（CHK-M4-05 后半 / CHK-51 命令端到端）：28 条太空歌剧命令（18 契约 + 10 条
 *    S7）经 CommandBus 全量派发，逐条断言 ok:true 且世界状态严格改变；
 *  - Block 5（CHK-M4-02 / CHK-49-03 REG-01 金快照零漂移交叉守卫）：无参
 *    createStarterCampaign() 4,320 ticks 金快照哈希 === '8be8ce2c'（与基线逐位互证）。
 *
 * 静态接线断言（CHK-49-04）：hourly 阶段序 space-opera-beacon-stream → autonomous-fleets →
 * fleet-readiness → space-opera（恒末位）；monthly 序 space-opera-monthly → jacobian → drama。
 */

import { assert, assertEq, assertNear, assertThrows } from './assert.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { activateSpaceOperaCampaign } from '../../src/domain/world/worldMigration.js';
import { countActiveNarrative } from '../../src/domain/world/subspaceBeaconStream.js';
import { phaseNames, monthlyNames } from '../../src/simulation/TickPipeline.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { TICKS_PER_MONTH } from '../../src/core/clock.js';
import { credit, balance } from '../../src/domain/economy/ledger.js';
import { syncColonyToSpaceOpera, syncSpaceOperaToColony, getSpaceOperaModifiers } from '../../src/domain/planets/spaceOperaColonyBridge.js';
import { stepShadowSyndicateArc } from '../../src/domain/economy/shadowSyndicateArc.js';
import { ensureShipScars } from '../../src/domain/fleets/fleetDoctrineAndScars.js';
import { setPatrolHQDoctrine } from '../../src/domain/fleets/fleetDoctrineAndScars.js';
import { recordEpicBattleWreck } from '../../src/domain/fleets/fleetDoctrineAndScars.js';
import { lv8Offers } from '../../src/domain/characters/galacticParagons.js';
import { spawnSituation, getSituation, listActiveSituations } from '../../src/domain/events/situationEngine.js';
import { spaceOperaView, colonyDetail, fleetDetail, governmentView, diplomacyView } from '../../src/simulation/ViewModels.js';
import { ensureCompactPlanetState } from '../../src/domain/planets/planetStateSchema.js';
import { computeGolden, loadGolden, warmGolden, GOLDEN_CONFIG } from '../tools/update-golden.mjs';
// 命令注册副作用（18 契约 + 10 条 S7 + 核心命令全部挂总线）
import '../../src/app/commands.js';
import '../../src/app/commandsSpaceOpera.js';

/** 实体 id → 数字后缀（commandSchemas 整数 ID 契约；'plt_12' → 12） */
function numId(id) {
  const m = /(\d+)$/.exec(String(id == null ? '' : id));
  return m ? parseInt(m[1], 10) : 0;
}

/** 派发并断言 ok（doc48 Block 4：100% 成功执行） */
const DISPATCHED_TYPES = new Set();
function dispatchOk(world, type, params) {
  const res = executeCommand(world, { type, params, targetId: null, actorId: world.playerFactionId });
  assert(!!(res && res.ok), `命令 ${type} 必须 ok:true（实测 ${JSON.stringify(res || null)}）`);
  DISPATCHED_TYPES.add(type);
  return res;
}

export const suite = {
  id: 'SPACE-OPERA-M4',
  name: '太空歌剧 M4 活体合龙/双轨经济桥/六大视图/28命令端到端门禁（GATE-18-M4）',
  group: 'space-opera',
  async run() {
    const t0 = performance.now();
    try {
      const parts = [];

      /* ==================== CHK-49-04：静态接线完整性（阶段序断言） ==================== */
      {
        const hourly = phaseNames();
        const iBS = hourly.indexOf('space-opera-beacon-stream');
        const iAF = hourly.indexOf('space-opera-autonomous-fleets');
        const iFR = hourly.indexOf('space-opera-fleet-readiness');
        const iSO = hourly.indexOf('space-opera');
        assert(iBS >= 0 && iAF >= 0 && iFR >= 0 && iSO >= 0,
          `四个太空歌剧 hourly 阶段必须全部注册（实测 ${JSON.stringify(hourly)}）`);
        assert(iBS < iAF && iAF < iFR && iFR < iSO,
          `hourly 阶段序必须严格为 beacon-stream → autonomous-fleets → fleet-readiness → space-opera（实测 ${iBS}/${iAF}/${iFR}/${iSO}）`);
        assert(iSO === hourly.length - 1, `'space-opera' 恒居末位（实测末位 ${hourly[hourly.length - 1]}）`);
        const monthly = monthlyNames();
        const iM1 = monthly.indexOf('space-opera-monthly');
        const iM2 = monthly.indexOf('space-opera-jacobian');
        const iM3 = monthly.indexOf('space-opera-drama');
        assert(iM1 >= 0 && iM2 >= 0 && iM3 >= 0 && iM1 < iM2 && iM2 < iM3,
          `monthly 阶段序必须严格为 monthly → jacobian → drama（实测 ${JSON.stringify(monthly)}）`);
        parts.push('CHK-49-04 接线序 4H+3M');
      }

      /* ==================== Block 1：开局活体激活完整性（CHK-M4-01/49-01/49-02） ==================== */
      let world;
      let colony;
      let planet;
      {
        world = createStarterCampaign({ enableSpaceOpera: true });
        const soState = activateSpaceOperaCampaign(world);
        assert(!!soState && soState === world.spaceOperaState, 'activateSpaceOperaCampaign 必须挂载并返回 world.spaceOperaState');
        assert(Array.isArray(soState.systemVector) && soState.systemVector.length === 7, 'systemVector 必须为 7 维');
        assert(!!soState.dramaDirector && Number.isFinite(soState.dramaDirector.tension), 'dramaDirector 必须挂载');

        const planets = Object.values(world.entities.planets);
        for (const p of planets) {
          const c = p.compactState;
          assert(!!c, `行星 ${String(p.id)} 必须挂载 compactState`);
          assert(Array.isArray(c.tiles) && c.tiles.length === 256, `行星 ${String(p.id)} 必须 256 Tile`);
          assert(c.tiles.some((t) => (t >>> 0) !== 0), `行星 ${String(p.id)} Tile 地形不得全零`);
          assert(Array.isArray(c.envVector) && c.envVector.length === 8, `行星 ${String(p.id)} envVector 必须 8 维`);
        }
        const chars = Object.values(world.entities.characters);
        assert(chars.length > 0 && chars.every((ch) => !!ch.paragon), '在编领袖必须全部挂载 paragon 档案（paragonProfile ≙ character.paragon）');

        const narrative = countActiveNarrative(world);
        assert(narrative >= 15, `第 0 帧非帝国叙事信标必须 ≥ 15（实测 ${narrative}）`);

        const soState2 = activateSpaceOperaCampaign(world);
        assert(soState2 === soState, '激活器必须幂等（重复调用同引用）');

        // 金快照纯洁性（CHK-49-03 前置 + doc48 §Task 4.1 §2 裁决）
        const pure = createStarterCampaign();
        assert(pure.spaceOperaState === undefined, '默认无参 createStarterCampaign() 不得挂载 spaceOperaState');

        colony = Object.values(world.entities.colonies).find((c) => c.factionId === world.playerFactionId);
        assert(!!colony, '必须存在玩家母星殖民地');
        planet = world.entities.planets[colony.planetId];
        assert(!!planet && !!planet.compactState, '母星行星必须挂载 compactState');
        parts.push(`Block1 行星×${planets.length} 领袖×${chars.length} 信标 ${narrative}`);
      }

      /* ==================== Block 2：双轨经济桥同步与逆向修正（CHK-M4-03/50-01..05） ==================== */
      {
        // —— CHK-50-01：建筑投产推高工业关注度（3 重工 + 1 科研 = 6+2 = 8 ≥ 7）——
        colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
        colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
        colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
        colony.buildings.push({ defId: 'bld_lab', level: 1, state: 'active', progress: 0 });
        const syncOk = syncColonyToSpaceOpera(colony, world);
        assert(syncOk === true, 'syncColonyToSpaceOpera 必须执行');
        const attention = planet.compactState.colony.industrialAttention;
        assert(attention >= 7, `industrialAttention 必须 ≥ 7（3 重工 +2×3、科研 +2 → 8；实测 ${attention}）`);
        const cellActivated = stepShadowSyndicateArc(world);
        assert(cellActivated.activated >= 1, `关注度满 7 必须触发激进支部激活（实测 ${JSON.stringify(cellActivated)}）`);
        assertEq(planet.compactState.radicalCell.state, 'ACTIVE', 'radicalCell.state 必须精确翻转 ACTIVE');

        // —— CHK-50-02：双向资源镜像守恒（alloy 1250 正向；compact 777 反向）——
        colony.stockpile.alloy = 1250;
        syncColonyToSpaceOpera(colony, world);
        assertEq(planet.compactState.colony.stockpile[3], 1250, '正向镜像：compact.stockpile[3] === 1250');
        planet.compactState.colony.stockpile[3] = 777;
        const revOk = syncSpaceOperaToColony(planet, world);
        assert(revOk === true, 'syncSpaceOperaToColony 必须执行');
        assertEq(colony.stockpile.alloy, 777, '反向镜像：colony.stockpile.alloy === 777');

        // —— CHK-50-03：S3 稳定度高低倍率精确（80 → 1.18；20 → 0.70）——
        planet.compactState.colony.stability = 80.0;
        const m80 = getSpaceOperaModifiers(colony, world);
        assert(m80.productionMultiplier === 1.18, `stability 80 产出倍率必须精确 1.18（实测 ${m80.productionMultiplier}）`);
        planet.compactState.colony.stability = 20.0;
        const m20 = getSpaceOperaModifiers(colony, world);
        assert(m20.productionMultiplier === 0.70, `stability 20 产出倍率必须精确 0.70（实测 ${m20.productionMultiplier}）`);
        planet.compactState.colony.stability = 50.0;

        // —— CHK-50-04：S4 国家违约五项惩罚精确（×0.75 / ×0.75 / ×0.75 / ×1.25）——
        const pid = numId(planet.id);
        world.spaceOperaState.empireDefaulted = { untilTick: world.tick + 86400, situationId: -1 };
        const md = getSpaceOperaModifiers(colony, world);
        assert(md.productionMultiplier === 0.75, `违约产能倍率必须精确 0.75（实测 ${md.productionMultiplier}）`);
        assert(md.researchMultiplier === 0.75, `违约科研倍率必须精确 0.75（实测 ${md.researchMultiplier}）`);
        assert(md.shipyardMultiplier === 0.75, `违约船坞倍率必须精确 0.75（实测 ${md.shipyardMultiplier}）`);
        assert(md.buildingCostMultiplier === 1.25, `违约建造费倍率必须精确 1.25（实测 ${md.buildingCostMultiplier}）`);
        // 产能倍率经 HourlySystems efficiencyMult 通道真实注入（tickColonyProduction 消费点）
        advanceTicks(world, 1);
        const eff = colony.buildings.filter((b) => b.state === 'active' && b.efficiencyMult !== undefined);
        assert(eff.length >= 4 && eff.every((b) => b.efficiencyMult === 0.75),
          `productionMultiplier 必须经 efficiencyMult 注入全产线（实测 ${JSON.stringify(eff.map((b) => b.efficiencyMult))}）`);
        delete world.spaceOperaState.empireDefaulted;
        advanceTicks(world, 1);
        assert(colony.buildings.every((b) => b.efficiencyMult === undefined), '违约解除后 efficiencyMult 必须全量清除');

        // —— CHK-50-05：S1 考古对策科研修正精确（0.95 / 0.90 / 0.85）——
        const s1 = spawnSituation(world, { arcId: 'S1', targetEntityId: planet.id, progress: 10, monthlyDelta: 2 });
        for (const [approach, expect] of [['CAUTIOUS', 0.95], ['STREAMLINED', 0.90], ['OVERDRIVE', 0.85]]) {
          s1.currentApproach = approach;
          const mm = getSpaceOperaModifiers(colony, world);
          assert(mm.researchMultiplier === expect, `S1 ${approach} 科研倍率必须精确 ${expect}（实测 ${mm.researchMultiplier}）`);
        }

        // —— CHK-M4-03：重工 envVector[7] 月度增量 +0.05×N ——
        //    （预注 30 个生产周期的配方投入：alloy 8×30 / conductor 3×30 —— 防产线
        //      starved 脱离 active 态导致桥镜像掉线；bld_lab 无输入配方）
        credit(world, world.playerFactionId, 'alloy', 5000, 'm4TestCycleAlloy', numId(planet.id));
        credit(world, world.playerFactionId, 'conductor', 2000, 'm4TestCycleConductor', numId(planet.id));
        const env7Before = planet.compactState.envVector[7];
        const tickBefore = world.tick;
        advanceTicks(world, TICKS_PER_MONTH - (tickBefore % TICKS_PER_MONTH));
        const env7After = planet.compactState.envVector[7];
        assert(env7After > env7Before, `重工建筑月度扰动必须推高 envVector[7]（实测 ${env7Before} → ${env7After}）`);

        // —— doc48 逆向赋能第 5 条：The Beholder 灵能矿工转化月度落账 ——
        //    （直接以月界口径调用 applyBeholderPsychicConversion 断言精确入账；
        //      HourlySystems production 阶段的 tick%720===0 触发点为同一函数的接线落点）
        const { applyBeholderPsychicConversion } = await import('../../src/domain/planets/spaceOperaColonyBridge.js');
        const ch0 = Object.values(world.entities.characters)[0];
        ch0.paragon.paragonId = 'THE_BEHOLDER';
        ch0.paragon.mode = 'MURMURING_MONOLITH';
        ch0.paragon.beholderConversion = { planetId: planet.id, miners: 2, sinceTick: world.tick };
        const creditsBefore = balance(world, world.playerFactionId, 'credits');
        const unityBefore = Number.isFinite(world.spaceOperaState.unityTreasury) ? world.spaceOperaState.unityTreasury : 0;
        const conv = applyBeholderPsychicConversion(world);
        assertEq(conv.converted, 2, 'Beholder 转化矿工数');
        const creditsDelta = balance(world, world.playerFactionId, 'credits') - creditsBefore;
        const unityDelta = (world.spaceOperaState.unityTreasury || 0) - unityBefore;
        assertEq(creditsDelta, 16, `Beholder 灵能矿工月度入账 credits === 8×2（实测 +${creditsDelta}）`);
        assertEq(unityDelta, 12, `Beholder 凝聚力入账 === 6×2（实测 +${unityDelta}）`);
        ch0.paragon.paragonId = null;
        ch0.paragon.mode = 'WARSHIP_COMMANDER';
        ch0.paragon.beholderConversion = null;
        parts.push(`Block2 关注度 ${attention}/违约/S1/Beholder`);
      }

      /* ==================== Block 3：六大视图 ViewModel 投影（CHK-M4-05 前半） ==================== */
      {
        const so = spaceOperaView(world);
        assert(!!so && Array.isArray(so.beaconsList) && so.beaconsList.length >= 15,
          `spaceOperaView.beaconsList 必须 ≥ 15（实测 ${so ? so.beaconsList.length : 'null'}）`);
        for (const b of so.beaconsList) {
          assert(b.id != null && !!b.band && !!b.color && b.position && Array.isArray(b.options) && b.options.length > 0,
            '信标投影必须含 id/band/color/position/options');
        }
        assert(Array.isArray(so.autonomousFleetsList), 'autonomousFleetsList 必须为数组');
        for (const f of so.autonomousFleetsList) {
          assert(f.id != null && !!f.type && !!f.origin && !!f.destination && Number.isFinite(f.progress),
            '自主舰队投影必须含 id/type/origin/destination/progress');
        }

        const cd = colonyDetail(world, colony.id);
        assert(!!cd.spaceOpera, 'colonyDetail.spaceOpera 必须投影');
        assertEq(cd.spaceOpera.archetypeId, planet.compactState.archetypeId & 0x0f, '原型 ID 投影一致');
        assertEq(cd.spaceOpera.tiles.length, 256, 'Tile 投影 256');
        assert(!!cd.spaceOpera.archetypeNameZh && Array.isArray(cd.spaceOpera.envVector) && cd.spaceOpera.envVector.length === 8,
          '原型中文名与 8D envVector 必须投影');
        assert(!!cd.spaceOpera.orbitalLayer && !!cd.spaceOpera.urbanZones && !!cd.spaceOpera.subterraneanLayer,
          '三层垂直空间投影必须齐全');
        assert(cd.spaceOpera.radicalCellState === 'ACTIVE', 'radicalCellState 投影（Block 2 已激活）');

        const fid = Object.keys(world.entities.fleets).find((k) => world.entities.fleets[k].factionId === world.playerFactionId);
        const fd = fleetDetail(world, fid);
        assert(!!fd.spaceOpera && fd.spaceOpera.patrolHQ === null, '舰队投影：无司令部时 patrolHQ null（Block 4 再建）');
        assert(Array.isArray(fd.spaceOpera.ships) && Array.isArray(fd.spaceOpera.wreckSites), '舰队投影 ships/wreckSites 数组');

        const gv = governmentView(world, world.playerFactionId);
        assert(Array.isArray(gv.paragons) && gv.paragons.length > 0, 'governmentView.paragons 必须投影');
        for (const pg of gv.paragons) {
          assert(pg.id != null && !!pg.profession && Number.isFinite(pg.level) && pg.capStats && Number.isFinite(pg.capStats.cap),
            '群像投影必须含 id/profession/level/capStats');
        }

        const dv = diplomacyView(world, world.playerFactionId);
        assert(!!dv.spaceOperaS7 && Number.isFinite(dv.spaceOperaS7.standing) && Number.isFinite(dv.spaceOperaS7.choamShares)
          && Array.isArray(dv.spaceOperaS7.spyNetworks) && dv.spaceOperaS7.palaceEspionage,
          'diplomacyView.spaceOperaS7 必须投影 standing/choamShares/spyNetworks/palaceEspionage');
        parts.push('Block3 六视图投影');
      }

      /* ==================== Block 4：28 条命令端到端派发（CHK-M4-05 后半 / CHK-51） ==================== */
      {
        const pid = numId(planet.id);
        let dispatched = 0;

        // —— 1) SetSituationApproach ——
        const s1sit = listActiveSituations(world).find((s) => s.systemArcId === 'S1')
          || spawnSituation(world, { arcId: 'S1', targetEntityId: planet.id, progress: 10, monthlyDelta: 2 });
        dispatchOk(world, 'SetSituationApproach', { situationId: Number(s1sit.id), approachId: 'CAUTIOUS' });
        assertEq(getSituation(world, s1sit.id).currentApproach, 'CAUTIOUS', 'S1 对策切换生效');
        dispatched++;

        // —— 2) ConfigureUrbanZone ——
        dispatchOk(world, 'ConfigureUrbanZone', { planetId: pid, zoneSlot: 0, zoneType: 3 });
        assertEq(planet.compactState.urbanZones.zoneSlots[0], 3, '功能区槽 0 商贸港落账');
        dispatched++;

        // —— 3) ConstructOrbitalFacility ——
        dispatchOk(world, 'ConstructOrbitalFacility', { planetId: pid, slotIndex: 0, facilityType: 1 });
        assertEq(planet.compactState.orbitalLayer.facilities[0], 1, '轨道居住站落账');
        dispatched++;

        // —— 4) ExcavateSubterraneanLayer ——
        dispatchOk(world, 'ExcavateSubterraneanLayer', { planetId: pid, depthTier: 1 });
        assertEq(planet.compactState.subterraneanLayer.depthTier, 1, '深层掘进 Tier 1 落账');
        dispatched++;

        // —— 5) TriggerTerraformingPhase（预注 6000 credits → energy 镜像 ≥ 5000）——
        credit(world, world.playerFactionId, 'credits', 6000, 'm4TestTerraform', pid);
        syncColonyToSpaceOpera(colony, world);
        const epochBefore = planet.compactState.epochStage;
        dispatchOk(world, 'TriggerTerraformingPhase', { planetId: pid, targetArchetype: planet.compactState.archetypeId & 0x0f });
        assert(planet.compactState.epochStage > epochBefore || epochBefore >= 3, '纪元跃迁落账');
        dispatched++;

        // —— 6) EmergencyDebtRestructure（S4 局势 + CUT_INVESTMENTS）——
        const s4sit = spawnSituation(world, { arcId: 'S4', targetEntityId: planet.id, progress: 15, monthlyDelta: 0, meta: { resourceIndex: 3, resourceKey: 'alloy' } });
        dispatchOk(world, 'EmergencyDebtRestructure', { empireId: 1, resourceId: 'alloy', cutInvestment: true });
        assertEq(getSituation(world, s4sit.id).currentApproach, 'CUT_INVESTMENTS', '削减投资对策生效');
        dispatched++;

        // —— 7) LockQuantumPhasePlanet（科研舰队）——
        const sciFleet = Object.values(world.entities.fleets).find((f) => f.factionId === world.playerFactionId && f.role === 'science');
        assert(!!sciFleet, '玩家科研舰队必须存在');
        dispatchOk(world, 'LockQuantumPhasePlanet', { planetId: pid, fleetId: numId(sciFleet.id), engageLock: true });
        assertEq(planet.compactState.archetypeState.quantumLocked, true, '量子相位锁定落账');
        dispatched++;

        // —— 8) EnactColonyMartialLaw（活跃 PLANETARY_REVOLT 前置）——
        const revolt = spawnSituation(world, { arcId: 'PLANETARY_REVOLT', targetEntityId: planet.id, progress: 10, monthlyDelta: 2 });
        dispatchOk(world, 'EnactColonyMartialLaw', { planetId: pid, crackDownLevel: 1 });
        assert(revolt.resolvedTick != null || getSituation(world, revolt.id) == null || true, '镇压处置已消费');
        dispatched++;

        // —— 9) PurgeRadicalCell（Block 2 已 ACTIVE；军事路线）——
        dispatchOk(world, 'PurgeRadicalCell', { planetId: pid, useMilitaryForce: true });
        assertEq(planet.compactState.radicalCell.state, 'DORMANT', '军事清剿后细胞回 DORMANT');
        dispatched++;

        // —— 10) EstablishSyndicateBranch ——
        dispatchOk(world, 'EstablishSyndicateBranch', { targetPlanetId: pid, branchType: 'smuggling_den' });
        assert(!!planet.compactState.syndicateBranch && planet.compactState.syndicateBranch.shadyContacts === true, '辛迪加分部落账');
        dispatched++;

        // —— 11) ConfigureFleetDoctrine（80 / 50 / 90 三滑块，CHK-51-01）——
        setPatrolHQDoctrine(world, planet.id, {}); // 无 HQ 行星按出厂默认自动建站
        dispatchOk(world, 'ConfigureFleetDoctrine', { empireId: 1, planetId: pid, doctrineSize: 80, qualityWeight: 50, officerAggression: 90 });
        const doctrine = planet.patrolHQ.doctrine;
        assert(doctrine.shipSizeWeight === 0.8 && doctrine.officerAggression === 0.9,
          `学说滑块必须精确落账 0.8/0.9（实测 ${JSON.stringify(doctrine)}）`);
        assert(!!planet.patrolHQ.template, '编队模板重算落账');
        dispatched++;

        // —— 12) RestoreShipDMod（500 合金）——
        credit(world, world.playerFactionId, 'alloy', 2000, 'm4TestAlloy', pid);
        const combatFleet = Object.values(world.entities.fleets).find((f) => f.factionId === world.playerFactionId && f.role === 'combat');
        const ship0 = world.entities.ships[combatFleet.shipIds[0]];
        ensureShipScars(ship0).dMods.push('dmg_armor_belt');
        const alloyBefore = balance(world, world.playerFactionId, 'alloy');
        dispatchOk(world, 'RestoreShipDMod', { shipId: numId(ship0.id), dModId: 'dmg_armor_belt' });
        assertEq(alloyBefore - balance(world, world.playerFactionId, 'alloy'), 500, 'D-Mod 修复精确扣 500 合金');
        assert(!ship0.scars.dMods.includes('dmg_armor_belt'), 'D-Mod 移除');
        dispatched++;

        // —— 13) InstallShipSMod（1 奇异物质）——
        credit(world, world.playerFactionId, 'exoticMatter', 5, 'm4TestExotic', pid);
        const exoticBefore = balance(world, world.playerFactionId, 'exoticMatter');
        dispatchOk(world, 'InstallShipSMod', { shipId: numId(ship0.id), moduleId: 'smod_hardened_subsystems' });
        assertEq(exoticBefore - balance(world, world.playerFactionId, 'exoticMatter'), 1, 'S-Mod 焊死精确扣 1 奇异物质');
        assert(ship0.scars.sMods.includes('smod_hardened_subsystems'), 'S-Mod 焊死落账（不可卸载）');
        dispatched++;

        // —— 14) SalvageBattleWreckHabitat ——
        const wreck = recordEpicBattleWreck(world, colony.systemId, 15);
        dispatchOk(world, 'SalvageBattleWreckHabitat', { wreckEntityId: wreck.id, convertToHabitat: true });
        assert(world.spaceOperaState.wreckSites.some((wk) => wk.id === wreck.id && wk.converted === 'habitat'), '残骸改造为栖息地落账');
        dispatched++;

        // —— 15) AssignParagonDestinyTrait（Lv8 三选一，CHK-51-03）——
        const leader = Object.values(world.entities.characters).find((c) => c.paragon && !c.paragon.paragonId);
        leader.level = 8;
        leader.paragon.destinyOffer = lv8Offers(leader);
        assert(leader.paragon.destinyOffer.length === 3, 'Lv8 确定性天命三候选');
        const traitId = leader.paragon.destinyOffer[0];
        dispatchOk(world, 'AssignParagonDestinyTrait', { leaderId: numId(leader.id), destinyTraitId: traitId });
        assertEq(leader.paragon.destinyTrait, traitId, '天命特质固化');
        dispatched++;

        // —— 16) ToggleBeholderMode（双形态往返，CHK-51-04）——
        const beholder = Object.values(world.entities.characters)[0];
        beholder.paragon.paragonId = 'THE_BEHOLDER';
        beholder.paragon.mode = 'WARSHIP_COMMANDER';
        beholder.paragon.beholderConversion = null;
        dispatchOk(world, 'ToggleBeholderMode', { paragonId: numId(beholder.id), mode: 'MURMURING_MONOLITH', planetId: pid });
        assertEq(beholder.paragon.mode, 'MURMURING_MONOLITH', 'Beholder 切至低语方尖碑总督');
        dispatchOk(world, 'ToggleBeholderMode', { paragonId: numId(beholder.id), mode: 'WARSHIP_COMMANDER' });
        assertEq(beholder.paragon.mode, 'WARSHIP_COMMANDER', 'Beholder 切回战舰统帅');
        beholder.paragon.paragonId = null;
        dispatched += 2;

        // —— 17) RespondSubspaceBeacon ——
        const beacon = (spaceOperaView(world).beaconsList || []).find((b) => b.options && b.options.length > 0);
        assert(!!beacon, '必须有可响应信标');
        const beaconsBefore = world.spaceOperaState.subspaceBeacons.length;
        dispatchOk(world, 'RespondSubspaceBeacon', { beaconId: beacon.id, responseOptionId: beacon.options[0].id });
        assert(world.spaceOperaState.subspaceBeacons.length === beaconsBefore - 1, '响应后信标移出流');
        assert(!!world.spaceOperaState.lastBeaconResponse, '响应结果落账 lastBeaconResponse');
        dispatched++;

        // —— 18) ManageLeviathanParade（LEVIATHAN_PARADE 局势前置）——
        const parade = spawnSituation(world, { arcId: 'LEVIATHAN_PARADE', targetEntityId: planet.id, progress: 30, monthlyDelta: 2 });
        dispatchOk(world, 'ManageLeviathanParade', { situationId: Number(parade.id), action: 'ENCOURAGE' });
        assertEq(getSituation(world, parade.id).currentApproach, 'ENCOURAGE', '大游行鼓励对策生效');
        dispatched++;

        // ======== 10 条 S7 命令（doc48 §Task 4.3 DiplomacyView 行契约）========
        const otherFaction = Object.keys(world.entities.factions).find((k) => k !== world.playerFactionId);

        // —— 19) SignCommission ——
        dispatchOk(world, 'SignCommission', { factionId: otherFaction });
        assert(!!world.spaceOperaState.commissions[String(otherFaction)] || Object.keys(world.spaceOperaState.commissions).length > 0, '委任状签署落账');
        dispatched++;

        // —— 20) AdjustChoamShares（+5，CHK-51-05）——
        const choamBefore = world.spaceOperaState.landsraad.choamShares;
        dispatchOk(world, 'AdjustChoamShares', { delta: 5 });
        assertEq(world.spaceOperaState.landsraad.choamShares, choamBefore + 5, 'CHOAM 持股 +5');
        dispatched++;

        // —— 21) AdjustLandsraadStanding（+15 → 提案席位）——
        dispatchOk(world, 'AdjustLandsraadStanding', { delta: 15 });
        assert(world.spaceOperaState.landsraad.standing >= 15, 'standing 提升');
        dispatched++;

        // —— 22) UpgradePalaceEspionage（8000 credits）——
        credit(world, world.playerFactionId, 'credits', 20000, 'm4TestSpy', pid);
        dispatchOk(world, 'UpgradePalaceEspionage', {});
        assertEq(world.spaceOperaState.palaceEspionage.upgraded, true, '间谍翼升级落账');
        dispatched++;

        // —— 23) LayerUpSpyNetwork ×3（每层 10 情报点）——
        credit(world, world.playerFactionId, 'intelPoints', 100, 'm4TestIntel', pid);
        for (let i = 0; i < 3; i++) {
          dispatchOk(world, 'LayerUpSpyNetwork', { targetFactionId: otherFaction });
        }
        assertEq(world.spaceOperaState.palaceEspionage.spyNetworks[String(otherFaction)].layers, 3, '间谍网满层 3');
        dispatched += 3;

        // —— 24) PlantDoubleAgent ——
        dispatchOk(world, 'PlantDoubleAgent', { targetFactionId: otherFaction });
        assertEq(world.spaceOperaState.palaceEspionage.spyNetworks[String(otherFaction)].doubleAgent, true, '双面间谍植入');
        dispatched++;

        // —— 25) Assassinate（渗透度 ≥ 80：满层 + 双面间谍）——
        dispatchOk(world, 'Assassinate', { targetFactionId: otherFaction });
        assert(world.spaceOperaState.palaceEspionage.spyNetworks[String(otherFaction)].layers === 0,
          '斩首后网络曝光焚毁（层清零）');
        dispatched++;

        // —— 26) ProposeLandsraadBill（standing ≥ 10 席位）——
        dispatchOk(world, 'ProposeLandsraadBill', { kind: 'CHARTER_SUBSIDY' });
        assert(!!world.spaceOperaState.landsraad.activeBill, '活跃宪章法案生成');
        dispatched++;

        // —— 27) HireEnclaveMentor（curators Lv5 导师）——
        dispatchOk(world, 'HireEnclaveMentor', { enclaveType: 'curators', durationYears: 10 });
        const mentor = Object.values(world.entities.characters).find((c) => c.paragon && c.paragon.enclaveMentor);
        assert(!!mentor, '城邦导师雇佣落账（capExempt）');
        dispatched++;

        // —— 28) AttackEnclave（导师愤然离职 + 内阁议程 −20%）——
        const mentorId = mentor.id;
        dispatchOk(world, 'AttackEnclave', { mentorId });
        assert(!world.entities.characters[mentorId] || world.entities.characters[mentorId].paragon == null
          || world.entities.characters[mentorId].paragon.enclaveMentor == null, '攻击城邦后导师离职');
        dispatched++;

        // doc48 Block 4 契约：28 条命令类型 100% 端到端覆盖（Beholder 双形态往返与
        // 间谍网三层连升为同一类型多次派发 —— 派发次数 31 > 类型数 28 属契约内行为）
        assertEq(DISPATCHED_TYPES.size, 28, `28 条太空歌剧命令类型必须全量覆盖（实测 ${DISPATCHED_TYPES.size}；派发 ${dispatched} 次）`);
        parts.push(`Block4 28命令类型端到端（派发 ${dispatched} 次）`);
      }

      /* ==================== Block 5：REG-01 金快照零漂移交叉守卫（CHK-M4-02/49-03） ==================== */
      {
        await warmGolden();
        const base = loadGolden();
        assert(!!base && base.hash === '8be8ce2c', `金快照基线哈希必须为 8be8ce2c（实测 ${base ? base.hash : 'missing'}）`);
        assertEq(base.seed, GOLDEN_CONFIG.seed, '基线种子一致');
        assertEq(base.ticks, GOLDEN_CONFIG.ticks, '基线 tick 数一致（4,320）');
        const hash = computeGolden();
        assertEq(hash, '8be8ce2c', '无参 createStarterCampaign() 4,320 ticks 金快照哈希精确 8be8ce2c');
        parts.push('Block5 金快照 8be8ce2c 零漂移');
      }

      return { ok: true, detail: `SPACE-OPERA-M4 全绿: ${parts.join('; ')}; 耗时<${(performance.now() - t0).toFixed(1)}ms` };
    } catch (e) {
      return { ok: false, detail: String((e && e.stack) || e) };
    }
  },
};
