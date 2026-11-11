/**
 * tests/agent/AutonomousGameplayAgent.js — 玩法自治 Agent（doc25 SPEC-TEST-025）
 *
 * 五阶段闭环：星系跃迁 → 轨道切入 → 地表着陆 → 资源/事件结算 → 存档冷重启验证。
 * 纯外部驱动真实游戏内核：
 *  - 全部写操作经官方命令总线 executeCommand（与玩家鼠标/键盘 100% 同源）；
 *  - 推进一律真实时间步 advanceTicks / advanceOneTick / stepMission；
 *  - 存档走真实 SaveManager（隔离槽位 test-agent-slot，finally 清理现场）；
 *  - 零 Mock 铁律：不伪造 World 实体、不拦截 commandBus、不伪造存储底层。
 *
 * ctx = { world, saveManager, ui? }；ui 为浏览器实机门禁可选桥
 * （{ navigate(screen, param), activeScreen() }），无头 CLI 传 null 时
 * UI 断言自动降级为 WORLD 口径并记录 BROWSER-ONLY 标记。
 */

import {
  cmd, cmdOk, advanceUntil, pickFleet, pickAdjacentSystem, orderJump, driveJumpToArrival,
  orderScan, driveScanToLevel, landOnSurface, findOreCoord, activeMissionOf,
  driveMissionToCompletion, saveToSlot, assertOneTickReplay, registeredCommands,
  MISSION_DT,
} from './FivePhaseActionDriver.js';
import {
  assert, assertEq, assertWorldPure, assertInvariants,
  ledgerBalance, ledgerSnapshot, hashOf, entitiesEqual, firstEntityDivergence,
} from './StateAssertionInspector.js';
import { deepClone } from '../../src/core/serialization.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { createGroundMission, getMissionField } from '../../src/domain/ground/GroundMission.js';
import { sampleTerrain } from '../../src/domain/ground/surfaceQueries.js';
import { findMissionTemplate } from '../../src/content/missions.js';

const SAVE_SLOT = 'test-agent-slot';
const MISSION_TEMPLATE = 'gmt_relic_survey';

export class AutonomousGameplayAgent {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.world = ctx.world;
    this.saveManager = ctx.saveManager;
    this.ui = ctx.ui || null;
    this.options = Object.assign({
      timeoutMs: 30000,
      logSteps: true,
      seed: 24601,
      missionMaxSteps: 45000,
    }, options);
    this.traceLog = [];
    this.currentPhase = 'init';
    this.traceSeq = 0;
  }

  trace(type, detail) {
    this.traceSeq++;
    this.traceLog.push({ step: this.traceSeq, phase: this.currentPhase, type, detail: String(detail).slice(0, 220) });
    if (this.traceLog.length > 400) this.traceLog.splice(0, this.traceLog.length - 400);
  }

  /** 执行五阶段闭环全流程（返回报告；失败抛错并携带 phase 上下文） */
  async runFullLoop() {
    const report = {
      startTime: performance.now(),
      seed: this.options.seed,
      phases: {},
      success: false,
      divergence: null,
      traceLog: this.traceLog,
    };

    try {
      // 阶段 0：内核自检（命令注册表非空，防命令副作用 import 失效）
      const cmds = registeredCommands();
      assert(cmds.length >= 50, `命令注册表仅 ${cmds.length} 项（<50，命令模块未同源加载）`);
      this.trace('BOOT', `命令注册表 ${cmds.length} 项`);

      report.phases.jump = await this.executeGalaxyJump();
      report.phases.orbit = await this.executeOrbitInsertion(report.phases.jump.targetSystemId);
      report.phases.landing = await this.executeSurfaceLanding(report.phases.orbit.targetPlanetId);
      report.phases.settlement = await this.executeSettlement(report.phases.landing.missionCtx);
      report.phases.saveRoundtrip = await this.executeSaveAndReloadVerification();

      report.success = true;
    } catch (err) {
      report.success = false;
      report.error = {
        message: err.message,
        stack: (err.stack || '').split('\n').slice(0, 6).join('\n'),
        phase: this.currentPhase,
      };
      err.agentPhase = this.currentPhase;
      throw err;
    } finally {
      // 现场清理：隔离槽位必须移除（doc25 IMPORTANT：严禁污染开发与测试存档）
      try {
        await this.saveManager.remove(SAVE_SLOT);
        const gone = await this.saveManager.load(SAVE_SLOT);
        report.slotCleanedUp = gone && gone.ok === false;
      } catch { report.slotCleanedUp = false; }
      report.totalDurationMs = performance.now() - report.startTime;
    }

    return report;
  }

  /** ———— 阶段 1：星系跃迁 ———— */
  async executeGalaxyJump() {
    this.currentPhase = 'jump';
    const t0 = performance.now();
    const world = this.world;
    const pid = world.playerFactionId;

    const fleet = pickFleet(world, pid, 'science');
    assert(fleet, '玩家 science 舰队缺失');
    const targetSystemId = pickAdjacentSystem(world, fleet);
    assert(targetSystemId, '母星系无连通航路（银河拓扑异常）');

    const hydrogenBefore = ledgerBalance(world, pid, 'hydrogen');
    const telemetry = orderJump(world, pid, fleet, targetSystemId);
    this.trace('JUMP_ORDER', `fleet=${fleet.id} → ${targetSystemId} eta=${telemetry.etaTicks}t legs=${telemetry.legs.length}`);

    // 途中采样：航行中段必须仍在途（零瞬移直接证据）。
    // eta=1 的极短航段在 1 tick 内合法抵达——以 orderJump 的「下单即 in-transit」
    // 同步断言为准（advanceTicks 之前 transit 已建立 + eta>0）。
    const sampleAt = Math.min(telemetry.etaTicks - 1, Math.floor(telemetry.etaTicks / 2));
    if (sampleAt >= 1) {
      advanceTicks(world, sampleAt);
      const midFleet = world.entities.fleets[fleet.id];
      assert(midFleet.transit !== null && midFleet.systemId === null, '航行中段舰队已在目的地（瞬移实锤）');
    }

    const arrival = driveJumpToArrival(world, world.entities.fleets[fleet.id], telemetry);
    const arrivedFleet = world.entities.fleets[fleet.id];
    assertEq(arrivedFleet.transit, null, '抵达后 transit 应为 null');
    assertEq(arrivedFleet.systemId, targetSystemId, '抵达星系不符');

    // 燃料对账：舰队燃料严格递减、无透支（fuelPerLaneHour × 航路小时）
    assert(arrival.fuelDrained > 0, `跃迁未消耗燃料（drained=${arrival.fuelDrained}）`);
    assert(arrival.fuelAfter >= 0, `燃料透支为负（${arrival.fuelAfter}）`);
    const expectedFuel = telemetry.etaTicks * 1.0; // BAL.navigation.fuelPerLaneHour = 1.0/h
    const fuelErr = Math.abs(arrival.fuelDrained - expectedFuel);
    assert(fuelErr <= Math.max(2.0, expectedFuel * 0.1),
      `燃料消耗 ${arrival.fuelDrained.toFixed(2)} 与理论 ${expectedFuel.toFixed(2)} 偏差 ${fuelErr.toFixed(2)} 超限`);
    // 账本侧氢燃料只在补给时动账，跃迁本身不凭空补给
    assert(ledgerBalance(world, pid, 'hydrogen') <= hydrogenBefore, '跃迁期间账本氢燃料凭空增加');
    assertInvariants(world, '阶段1跃迁后');

    return {
      ok: true, targetSystemId, fleetId: fleet.id,
      etaTicks: telemetry.etaTicks, elapsedTicks: arrival.ticks,
      fuelBefore: telemetry.fuelBefore, fuelAfter: arrival.fuelAfter,
      fuelDrained: Number(arrival.fuelDrained.toFixed(2)), expectedFuel: Number(expectedFuel.toFixed(2)),
      ms: performance.now() - t0,
    };
  }

  /** ———— 阶段 2：轨道切入 ———— */
  async executeOrbitInsertion(targetSystemId) {
    this.currentPhase = 'orbit';
    const t0 = performance.now();
    const world = this.world;
    const pid = world.playerFactionId;

    if (this.ui) {
      // location.hash 变更异步派发 hashchange → 等待一帧后再断言 router.screen
      await this.ui.navigate('system', targetSystemId);
      assertEq(this.ui.activeScreen(), 'system', 'router.screen 应为 system');
    }

    const fleet = pickFleet(world, pid, 'science');
    assert(fleet && fleet.systemId === targetSystemId, 'science 舰队未随跃迁到位');
    orderScan(world, pid, fleet, targetSystemId);

    const scan = driveScanToLevel(world, targetSystemId, pid, 4, 3000);
    assert(scan.level >= 4, `调查层级 ${scan.level} < 4（${scan.ticks} tick 内未完成扫描）`);
    this.trace('SCAN_DONE', `level=${scan.level} ticks=${scan.ticks}`);

    const sys = world.entities.systems[targetSystemId];
    const planets = (sys.planetIds || []).map((id) => world.entities.planets[id]);
    assert(planets.length >= 1, '目标星系无行星（轨道切入无目标）');
    // 行星环境显形：主主题 + 二级主题修饰 + 矿产丰度全量就绪
    // （world 口径字段：primaryThemeId/secondaryThemeModifiers；themePayload 为渲染层装配产物，属 Tier 2 图形门禁）
    for (const p of planets) {
      assert(p.primaryThemeId, `行星 ${p.id} 缺 primaryThemeId`);
      assert(p.secondaryThemeModifiers !== undefined, `行星 ${p.id} 缺 secondaryThemeModifiers`);
      assert(Number.isFinite(p.habitability), `行星 ${p.id} habitability 非有限值`);
      assert(p.deposits && typeof p.deposits === 'object', `行星 ${p.id} 矿产表缺失`);
    }
    assertInvariants(world, '阶段2扫描后');

    // 着陆目标：优先宜居行星，否则首行星
    const target =
      planets.filter((p) => !p.colonyId).sort((a, b) => b.habitability - a.habitability)[0] || planets[0];

    return {
      ok: true, targetPlanetId: target.id, systemId: targetSystemId,
      surveyLevel: scan.level, scanTicks: scan.ticks,
      planetCount: planets.length,
      uiBridge: this.ui ? 'router-asserted' : 'BROWSER-ONLY',
      ms: performance.now() - t0,
    };
  }

  /** ———— 阶段 3：地表着陆 ———— */
  async executeSurfaceLanding(targetPlanetId) {
    this.currentPhase = 'landing';
    const t0 = performance.now();
    const world = this.world;

    if (this.ui) {
      await this.ui.navigate('ground', targetPlanetId);
      assertEq(this.ui.activeScreen(), 'ground', 'router.screen 应为 ground');
    }

    const t0g = performance.now();
    const landing = landOnSurface(world, targetPlanetId);
    const gridMs = performance.now() - t0g;
    assert(gridMs < 150, `着陆网格生成 ${gridMs.toFixed(1)}ms ≥ 150ms 门禁`);
    this.trace('LANDED', `spawn=(${landing.spawn.x},${landing.spawn.y},${landing.spawn.z}) stepDh=${landing.stepDh}`);

    // 任务场就绪：站点蓝图 + 撤离区锚定
    const field = getMissionField(world, targetPlanetId);
    assert(field, '任务地形场构建失败');
    const tpl = findMissionTemplate(MISSION_TEMPLATE);
    assert(tpl && Array.isArray(tpl.rewards) && tpl.rewards.length > 0, '任务模板/奖励缺失');

    const missionCtx = { planetId: targetPlanetId, templateId: MISSION_TEMPLATE, fieldReady: true };
    return {
      ok: true, missionCtx, planetId: targetPlanetId,
      spawn: landing.spawn, stepDh: landing.stepDh,
      distToGround: Number(landing.distToGround.toFixed(2)), gridMs: Number(gridMs.toFixed(1)),
      uiBridge: this.ui ? 'router-asserted' : 'BROWSER-ONLY',
      ms: performance.now() - t0,
    };
  }

  /** ———— 阶段 4：资源与事件结算 ———— */
  async executeSettlement(missionCtx) {
    this.currentPhase = 'settlement';
    const t0 = performance.now();
    const world = this.world;
    const pid = world.playerFactionId;
    const planetId = missionCtx.planetId;

    // 4a. 地质采掘：场域 ORE 旗点位 → HarvestTerrainOre → 殖民地仓储入账。
    // 采掘入账目标为该行星殖民地；任务行星未殖民时在生产语义下无入账主体
    // （命令事件 credited=false），此时改在母星殖民地行星验证同一命令链路。
    const colony = Object.values(world.entities.colonies).find((c) => c.planetId === planetId) || null;
    const homeColony = Object.values(world.entities.colonies)
      .find((c) => c.factionId === pid && c.planetId !== planetId) || null;
    const harvestPlanetId = colony ? planetId : (homeColony ? homeColony.planetId : null);
    const ore = harvestPlanetId ? findOreCoord(world, harvestPlanetId) : null;
    let harvest = { attempted: false };
    if (ore && harvestPlanetId) {
      const hColony = world.entities.colonies[
        (world.entities.planets[harvestPlanetId] || {}).colonyId
      ] || Object.values(world.entities.colonies).find((c) => c.planetId === harvestPlanetId);
      assert(hColony, `采掘目标行星 ${harvestPlanetId} 无殖民地（入账主体缺失）`);
      const oreRes = fieldOreRes(world, harvestPlanetId);
      const stockBefore = hColony.stockpile[oreRes] || 0;
      const r = cmd(world, 'HarvestTerrainOre', { planetId: harvestPlanetId, x: ore.x, z: ore.z }, pid);
      assert(r.ok === true, `HarvestTerrainOre 被拒: ${r.code} ${r.reason}（ore=${JSON.stringify(ore)}）`);
      const stockAfter = world.entities.colonies[hColony.id].stockpile[oreRes] || 0;
      assertEq(stockAfter, stockBefore + 1, '采掘入账幂等破坏（仓储增量 ≠ 1）');
      const harvested = (world.events.log.ground || []).some((e) => e.type === 'TerrainOreHarvested');
      assert(harvested, 'TerrainOreHarvested 事件未入事件日志');
      harvest = { attempted: true, planetId: harvestPlanetId, coord: ore, resId: oreRes, delta: stockAfter - stockBefore };
      this.trace('ORE_HARVEST', `${harvestPlanetId} (${ore.x},${ore.z}) stockpile.${oreRes} +${stockAfter - stockBefore}`);
    }

    // 4b. 地面任务：官方 BeginGroundMission 命令发起
    const chars = Object.values(world.entities.characters)
      .filter((c) => c.factionId === pid).slice(0, 2).map((c) => c.id);
    const ledgerBefore = ledgerSnapshot(world, pid);
    const xpBefore = chars.map((id) => world.entities.characters[id].xp || 0);
    cmdOk(world, 'BeginGroundMission', {
      templateId: MISSION_TEMPLATE, planetId,
      squadCharacterIds: chars,
    }, pid);
    const mission = activeMissionOf(world, planetId);
    assert(mission, 'BeginGroundMission 后无活跃任务实体');
    assertEq(mission.coordSpace, 'site_meters', '任务未运行于 site_meters');

    if (this.ui) {
      // 实机门禁：任务在地面视图驻留期间创建（等价玩家在简报页发起行动后
      // 重新进入地表）——经 system → ground 真实路由链重建任务 3D 场景
      const sysId = world.entities.planets[planetId].systemId;
      await this.ui.navigate('system', sysId);
      await this.ui.navigate('ground', planetId);
      assertEq(this.ui.activeScreen(), 'ground', '任务重建后 router.screen 应回 ground');
    }

    // 着陆坪触地法线倾角（连续地表口径：任务场平滑地形插值法线，doc25 门禁 < 30°）
    const anchor = mission.site?.anchors?.landing;
    let padSlopeDeg = null;
    if (anchor) {
      const s = sampleTerrain(getMissionField(world, planetId), anchor.x, anchor.z);
      assert(s && Number.isFinite(s.ny), '着陆坪锚点地形采样失败');
      padSlopeDeg = (Math.acos(Math.max(-1, Math.min(1, s.ny))) * 180) / Math.PI;
      assert(padSlopeDeg < 30, `着陆坪法线倾角 ${padSlopeDeg.toFixed(1)}° ≥ 30°`);
    }
    this.trace('MISSION_START', `mission=${mission.id} site=${mission.siteId} pad=${padSlopeDeg === null ? 'N/A' : padSlopeDeg.toFixed(1) + '°'}`);

    // 4c. 任务状态机推演（自治 Bot 经生产同源瞬态输入通道驾驶；生产寻路器绕行废墟）
    const drive = await driveMissionToCompletion(
      world, mission, pid, this.options.missionMaxSteps,
      {
        field: getMissionField(world, planetId),
        stepMode: this.options.stepMode || 'self',
        awaitFrame: this.options.awaitFrame,
        getView: this.options.getView,
      },
    );
    assert(drive.status === 'success',
      `任务未达成 success（status=${drive.status}，steps=${drive.steps}，objectives=${JSON.stringify(drive.objectives)}）`);
    this.trace('MISSION_END', `status=${drive.status} steps=${drive.steps} sim=${drive.simSeconds.toFixed(1)}s`);

    // 4d. 奖励对账：账本增量与模板 rewards 逐条精确一致
    const tpl = findMissionTemplate(MISSION_TEMPLATE);
    const ledgerAfter = ledgerSnapshot(world, pid);
    for (const rw of tpl.rewards) {
      const delta = (ledgerAfter[rw.resId] ?? 0) - (ledgerBefore[rw.resId] ?? 0);
      assertEq(delta, rw.amount, `任务奖励 ${rw.resId} 入账 ${delta} ≠ 模板 ${rw.amount}`);
    }
    // 存活角色 +30 经验（GROUND-02 同口径）
    const xpAfter = chars.map((id) => world.entities.characters[id].xp || 0);
    for (let i = 0; i < chars.length; i++) {
      const gain = xpAfter[i] - xpBefore[i];
      if (gain !== 30) {
        const dead = drive.view?.players?.some((p) => p.state === 'dead');
        assert(dead, `${chars[i]} 经验增量 ${gain} ≠ 30 且小队无阵亡（结算对账异常）`);
      }
    }

    // 4e. 叙事事件裁决：若五阶段期间出现待决事件，经官方命令通道裁决一支选项
    let eventSettled = null;
    const pending = (world.narrative?.pendingChoices || [])[0];
    if (pending) {
      const choice = (pending.choices || [])[0];
      assert(choice && choice.id, '待决事件无可用选项');
      const r = cmd(world, 'ResolveEventChoice', { eventId: pending.eventId, choiceId: choice.id }, pid);
      assert(r.ok === true, `ResolveEventChoice 被拒: ${r.code} ${r.reason}`);
      eventSettled = { eventId: pending.eventId, choiceId: choice.id };
      this.trace('EVENT_RESOLVED', `${pending.eventId} → ${choice.id}`);
    }

    assertWorldPure(world, '阶段4结算后');
    assertInvariants(world, '阶段4结算后');

    return {
      ok: true, missionId: mission.id, missionStatus: drive.status,
      missionSteps: drive.steps, simSeconds: Number(drive.simSeconds.toFixed(1)),
      padSlopeDeg: padSlopeDeg === null ? null : Number(padSlopeDeg.toFixed(2)),
      rewards: tpl.rewards, harvest, eventSettled,
      eventLogHasMissionEvents: (world.events.log.ground || []).length > 0,
      ms: performance.now() - t0,
    };
  }

  /** ———— 阶段 5：存档冷重启与回放验证 ———— */
  async executeSaveAndReloadVerification() {
    this.currentPhase = 'saveRoundtrip';
    const t0 = performance.now();
    const world = this.world;

    const saveRes = await saveToSlot(this.saveManager, world, SAVE_SLOT, '五阶段闭环检查点');
    const hashA = hashOf(world);
    this.trace('SAVE', `slot=${SAVE_SLOT} hashA=${hashA}`);

    // 冷重启：彻底弃用当前内存世界引用（Agent 不再触碰旧树）
    const loaded = await this.saveManager.load(SAVE_SLOT);
    assert(loaded && loaded.ok === true, `读档失败: ${loaded ? loaded.reason : '无返回'}`);
    const world2 = loaded.world;
    const hashB = hashOf(world2);
    this.trace('LOAD', `hashB=${hashB}`);

    assertEq(world2.tick, world.tick, '重载后 tick 不一致');
    assertEq(world2.seq, world.seq, '重载后 seq 不一致');
    assertEq(hashB, hashA, `持久化 Hash A(${hashA}) ≠ 重载 Hash B(${hashB})`);

    // 实体树逐位对账（stableStringify 键序无关深比较）
    if (!entitiesEqual(world, world2)) {
      const div = firstEntityDivergence(world, world2);
      this.trace('DIVERGENCE', div ? `${div.path}: ${div.a} vs ${div.b}` : '未定位');
      // 编解码合法剥离（任务运行时场域为不可枚举写入侧台账）之外不允许任何差异
      throw new Error(`实体树对账失败: ${div ? `${div.path} ${div.a} ≠ ${div.b}` : '差异未定位'}`);
    }

    // 世界哈希幂等性（哈希函数本身不得有状态；必须在续推对拍前采样）
    assertEq(hashOf(world2), hashB, 'worldHash 非幂等');

    // 重新执行 1 tick：存档侧深克隆与读档侧确定性续推对拍
    const replay = await assertOneTickReplay(world, world2, deepClone, hashOf);
    assertWorldPure(world2, '重载世界');
    assertInvariants(world2, '重载世界');

    return {
      ok: true, slot: SAVE_SLOT, hashA, hashB,
      recordBytes: JSON.stringify(saveRes.record).length,
      replayHash: replay.hashA1,
      invariants: 0, purity: 'clean',
      ms: performance.now() - t0,
    };
  }
}

/** 行星场域矿种映射（与 commands.js fieldOreResIdOf 同口径：ferro→silicate→heavyMetal→rareEarth） */
function fieldOreRes(world, planetId) {
  const planet = world.entities.planets[planetId];
  const dep = planet?.deposits || {};
  for (const k of ['ferro', 'silicate', 'heavyMetal', 'rareEarth']) {
    if (dep[k] > 0) return k;
  }
  return 'ferro';
}

export { MISSION_DT, SAVE_SLOT };
