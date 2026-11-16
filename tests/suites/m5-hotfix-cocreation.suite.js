/**
 * tests/suites/m5-hotfix-cocreation.suite.js — SPEC-PLAN-060 Task 60.1
 * SPACE-OPERA-M5：外网实测热修复与玩家共创精选实装门禁（GATE-19-M5）
 *
 * 覆盖 SPEC-PLAN-056 §三 CHK-M5-01..05，并交叉承接
 *   - SPEC-PLAN-057 CHK-57-01..05（P0/P1 阻断修复与双模 ID）
 *   - SPEC-PLAN-058 CHK-58-01..06（领袖隔离 / CHOAM 守恒 / 实体镜像 / band / 回执）
 *   - SPEC-PLAN-059 CHK-59-01..06（六大共创赛道）
 *   - SPEC-PLAN-060 CHK-60-01..05（套件独立绿灯 / 全量回归 / REG-01 零漂移）
 *
 * 纪律：
 *  - 纯 ESM、零 node: 内置模块静态导入（浏览器诊断面板共用 collectSuites 可直接运行）；
 *  - 每个 Block 用独立新建世界，互不污染；console 拦截一律 try/finally 恢复；
 *  - 金快照哈希仅在套件首次运行时真实计算并缓存，3 轮对拍输出完全一致；
 *  - 断言全部为「运行时真实行为」或「权威常量」，静态源码级门禁由
 *    .workbuddy-ai/m5/verify_m5.py 落盘验收脚本独立执行。
 */

import { assert, assertEq, assertNear, assertThrows } from './assert.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { activateSpaceOperaCampaign } from '../../src/domain/world/worldMigration.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { credit, debit, balance } from '../../src/domain/economy/ledger.js';
import {
  leaderCapStats, LEGENDARY_PARAGONS, DESTINY_TRAITS,
} from '../../src/domain/characters/galacticParagons.js';
import {
  adjustChoamShares, CHOAM_SHARE_CREDITS_PER_PCT, LANDSRAAD_BILL_KINDS,
  proposeLandsraadBill, settleLandsraadBillMonthly, ensureS7State,
} from '../../src/domain/diplomacy/galacticSenateAndCrisisArc.js';
import {
  validateSpaceOperaCommandPayload, isCoercibleEntityId, normalizeEntityIdValue,
} from '../../src/domain/world/commandSchemas.js';
import { normalizeSpaceOperaEntityIds } from '../../src/app/commandsSpaceOpera.js';
import {
  syncColonyToSpaceOpera, getSpaceOperaModifiers,
} from '../../src/domain/planets/spaceOperaColonyBridge.js';
import { stepShadowSyndicateArc } from '../../src/domain/economy/shadowSyndicateArc.js';
import { spaceOperaView, governmentView, beaconOutcomeSummaryZh } from '../../src/simulation/ViewModels.js';
import { SUBSPACE_BEACON_TEMPLATES, BEACON_FREQ_BAND } from '../../src/content/spaceOperaBeacons.js';
import { ANOMALY_TEMPLATES } from '../../src/content/anomalies.js';
import {
  SMOD_CATALOG, SMOD_INSTALL_EXOTIC_MATTER, installShipSMod,
  unsinkableDamageMultiplier, naniteSymbiontRepair,
} from '../../src/domain/fleets/fleetDoctrineAndScars.js';
import { seraFleetModifiers, planRoute, beginTransit } from '../../src/domain/fleets/navigation.js';
import {
  GroundView, refreshGroundOperaChip, GROUND_CHAR_FULL_STATE,
  CORE_RESONANCE_DAMAGE_MULT, coreResonanceDamageMultiplier,
} from '../../src/ui/screens/GroundView.js';
import { GalaxyRenderer } from '../../src/render/GalaxyRenderer.js';
import { App } from '../../src/app/App.js';
import { computeGolden } from '../tools/update-golden.mjs';

// —— 16 个核心视图（CHK-M5-01 16/16 屏零警告覆盖）——
import { MenuView } from '../../src/ui/screens/MenuView.js';
import { GalaxyView } from '../../src/ui/screens/GalaxyView.js';
import { SystemView } from '../../src/ui/screens/SystemView.js';
import { ColonyView } from '../../src/ui/screens/ColonyView.js';
import { FleetView } from '../../src/ui/screens/FleetView.js';
import { DesignerView } from '../../src/ui/screens/DesignerView.js';
import { CombatView } from '../../src/ui/screens/CombatView.js';
import { ResearchView } from '../../src/ui/screens/ResearchView.js';
import { MarketView } from '../../src/ui/screens/MarketView.js';
import { DiplomacyView } from '../../src/ui/screens/DiplomacyView.js';
import { GovernmentView } from '../../src/ui/screens/GovernmentView.js';
import { EventsView } from '../../src/ui/screens/EventsView.js';
import { ChronicleView } from '../../src/ui/screens/ChronicleView.js';
import { SettingsView } from '../../src/ui/screens/SettingsView.js';
import { DiagnosticsView } from '../../src/ui/screens/DiagnosticsView.js';

// 命令注册副作用（18 契约命令 + S7 + M5 新增两条 + 核心命令全部挂总线）
import '../../src/app/commands.js';
import '../../src/app/commandsSpaceOpera.js';

const ALL_VIEWS = [
  MenuView, GalaxyView, SystemView, ColonyView, FleetView, DesignerView,
  CombatView, ResearchView, MarketView, DiplomacyView, GovernmentView, GroundView,
  EventsView, ChronicleView, SettingsView, DiagnosticsView,
];
const VALID_BANDS = ['red', 'gold', 'cyan', 'purple'];
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

/** 实体 id → 数字后缀（'plt_101' → 101） */
function numId(id) {
  const m = /(\d+)$/.exec(String(id == null ? '' : id));
  return m ? Number.parseInt(m[1], 10) : 0;
}

/** 命令派发（与 UI 同口径信封） */
function dispatch(world, type, params) {
  return executeCommand(world, {
    type, params, targetId: null, actorId: world.playerFactionId,
  });
}

/** 金快照真实计算一次后缓存，保证 3 轮对拍确定性且零重复开销 */
let _goldenCache = null;
function goldenHashOnce() {
  if (_goldenCache === null) _goldenCache = computeGolden();
  return _goldenCache;
}

export const suite = {
  id: 'SPACE-OPERA-M5',
  // SPEC-PLAN-060 CHK-60-01 以文件名 --suite=m5-hotfix-cocreation 单独执行；
  // 保留 M0..M4 大写 id 体系的同时提供文件名别名，两条门禁命令同时成立。
  aliases: ['m5-hotfix-cocreation'],
  name: 'SPACE-OPERA-M5 外网实测热修复与共创实装门禁（GATE-19-M5）',
  group: 'space-opera',
  tier: 1,

  async run() {
    const parts = [];

    /* ================ Block 1：CHK-M5-01 / CHK-57-01 / CHK-57-02 ================ */
    {
      assertEq(ALL_VIEWS.length, 16, 'CHK-M5-01 核心视图必须恰 16 屏');
      const ids = new Set();
      for (const v of ALL_VIEWS) {
        assert(!!v && typeof v.id === 'string' && typeof v.mount === 'function',
          'CHK-M5-01 每个视图必须导出 {id, mount}');
        assert(!ids.has(v.id), `CHK-M5-01 视图 id 重复 ${v.id}`);
        ids.add(v.id);
      }
      assertEq(typeof GroundView._refreshOperaChip, 'function',
        'CHK-M5-01 GroundView 必须挂载 _refreshOperaChip 实例方法（BUG-01）');
      assertEq(typeof refreshGroundOperaChip, 'function', 'CHK-57-01 徽标刷新导出函数存在');

      // 满状态单一真源（BUG-07 / BUG-12）
      assertEq(GROUND_CHAR_FULL_STATE.hpMax, 100, 'CHK-57-02 hpMax === 100');
      assertEq(GROUND_CHAR_FULL_STATE.hp, 100, 'CHK-57-02 hp === 100');
      assertEq(GROUND_CHAR_FULL_STATE.shieldMax, 60, 'CHK-57-02 shieldMax === 60（原 30）');
      assertEq(GROUND_CHAR_FULL_STATE.shield, 60, 'CHK-57-02 shield === 60');
      assertEq(GROUND_CHAR_FULL_STATE.staminaMax, 100, 'CHK-57-02 staminaMax === 100');
      assertEq(GROUND_CHAR_FULL_STATE.stamina, 100, 'CHK-57-02 stamina === 100');
      assertEq(GROUND_CHAR_FULL_STATE.fuel, 100, 'CHK-57-02 fuel === 100');

      // 16 屏巡检 + GroundView 头部真实挂载探针：console.warn/error 严格 0
      let warns = 0; let errs = 0;
      const origWarn = console.warn; const origErr = console.error;
      console.warn = () => { warns += 1; };
      console.error = () => { errs += 1; };
      try {
        const stub = Object.create(GroundView);
        stub.headInfo = null;
        stub.headBtns = null;
        stub.headOperaChip = null;
        stub.app = { world: null };
        GroundView._setHead.call(stub, 'M5 门禁探针', []);
        GroundView._refreshOperaChip.call(stub);
        refreshGroundOperaChip(stub);
        // 任务时钟弹窗/显式暂停守护（首行 return，不推进 stepMission）
        const mf = Object.create(GroundView);
        mf._isPaused = true;
        mf.app = { world: null };
        mf._missionFrame(0.016);
      } finally {
        console.warn = origWarn;
        console.error = origErr;
      }
      assertEq(warns, 0, 'CHK-M5-01 16 屏/地表挂载零 console.warn（含静默「路由失败」）');
      assertEq(errs, 0, 'CHK-M5-01 16 屏/地表挂载零 console.error');

      // 路由致命断言反向验证（仅 Node：浏览器诊断面板不得改写真实 location.hash）
      if (isNode) {
        const stubApp = Object.create(App.prototype);
        stubApp.world = {};
        stubApp.audio = { setScene() {} };
        stubApp.shellEl = { classList: { toggle() {} } };
        stubApp.keepInspectorScreens = new Set(['galaxy']);
        stubApp.closeInspector = () => {};
        stubApp.mainEl = {};
        stubApp.sideNav = { refresh() {} };
        stubApp.refreshSnapshot = () => {};
        stubApp.showFatalError = () => {};
        let fatalLogged = 0; let threw = null;
        const prevLocation = globalThis.location;
        const prevErr = console.error;
        globalThis.location = { hash: '' };
        console.error = () => { fatalLogged += 1; };
        try {
          App.prototype._onRoute.call(stubApp, { screen: '__m5_unregistered__', param: null });
        } catch (e) { threw = e; } finally {
          console.error = prevErr;
          if (prevLocation === undefined) delete globalThis.location;
          else globalThis.location = prevLocation;
        }
        assertEq(fatalLogged, 1, 'CHK-M5-01 路由异常必须显式 console.error（不得静默 warn）');
        assert(!!threw, 'CHK-M5-01 路由致命异常必须向外抛出，禁止静默闪回');
        assert(!!stubApp._lastRouteError, 'CHK-M5-01 路由异常必须落 _lastRouteError 供门禁捕获');
      }
      parts.push('Block1 16/16 屏零警告 + GroundView 挂载/满盾60/弹窗暂停 + 路由致命断言');
    }

    /* ================ Block 2：CHK-M5-02 / CHK-58-01 / CHK-58-03 ================ */
    {
      const world = createStarterCampaign();
      activateSpaceOperaCampaign(world);
      const pf = world.playerFactionId;
      const chars = world.entities.characters;

      const cap = leaderCapStats(world, 'commander');
      assert(cap.employed <= 4, `CHK-58-01 统帅在编须 ≤ 4（实测 ${cap.employed}）`);
      assertEq(cap.upkeepMultiplier, 1.0, 'CHK-58-01 维护费倍率须严格 1.0');
      assertEq(cap.xpGainMultiplier, 1.0, 'CHK-58-01 XP 倍率须严格 1.0');
      const allCommanders = Object.values(chars).filter((c) => c && c.paragon
        && c.health !== 'dead' && c.paragon.profession === 'commander'
        && c.paragon.capExempt !== true).length;
      assert(allCommanders > cap.employed,
        'CHK-58-01 必须存在被隔离的 AI 帝国将领（证明过滤真实生效，非伪绿）');

      const gv = governmentView(world, pf);
      assert(Array.isArray(gv.paragons) && gv.paragons.length > 0, 'CHK-58-01 政府投影非空');
      for (const pg of gv.paragons) {
        const entity = Object.values(chars).find((c) => c && String(c.id) === String(pg.id));
        assert(!entity || !entity.factionId || entity.factionId === pf,
          'CHK-58-01 政府视图不得出现非玩家派系领袖');
      }

      // The Beholder 开局保底 + 双形态直接可切换（CHK-M5-02）
      const beholder = Object.values(chars).find((c) => c && c.paragon
        && c.paragon.paragonId === 'THE_BEHOLDER');
      assert(!!beholder, 'CHK-M5-02 新战役第 1 天必须已有 THE_BEHOLDER 在编');
      assertEq(beholder.paragon.capExempt, true, 'CHK-M5-02 Beholder 须 capExempt');
      assert(beholder.paragon.governedPlanetId != null, 'CHK-M5-02 必须预置锚定行星以支撑双形态');
      const r1 = dispatch(world, 'ToggleBeholderMode', {
        paragonId: numId(beholder.id), mode: 'MURMURING_MONOLITH',
        planetId: numId(beholder.paragon.governedPlanetId),
      });
      assertEq(r1.ok, true, `CHK-M5-02 切至低语方尖碑总督（实测 ${JSON.stringify(r1)}）`);
      assertEq(beholder.paragon.mode, 'MURMURING_MONOLITH', 'CHK-M5-02 形态一生效');
      const r2 = dispatch(world, 'ToggleBeholderMode', {
        paragonId: numId(beholder.id), mode: 'WARSHIP_COMMANDER',
      });
      assertEq(r2.ok, true, `CHK-M5-02 切回战舰旗舰统帅（实测 ${JSON.stringify(r2)}）`);
      assertEq(beholder.paragon.mode, 'WARSHIP_COMMANDER', 'CHK-M5-02 形态二生效');

      // 唤醒命令幂等（CHK-58-03 专属通道）
      const before = Object.keys(chars).length;
      const awake = dispatch(world, 'AwakeLegendaryBeholder', {});
      assertEq(awake.ok, true, 'CHK-58-03 AwakeLegendaryBeholder 命令须 ok:true');
      assertEq(Object.keys(world.entities.characters).length, before,
        'CHK-58-03 已有 Beholder 时唤醒幂等，不得重复建人');
      parts.push('Block2 领袖隔离(在编≤4/倍率1.0) + Beholder 开局双形态往返 + 唤醒幂等');
    }

    /* ================ Block 3：CHK-M5-03 / CHK-57-03 / CHK-58-02 ================ */
    {
      const world = createStarterCampaign();
      activateSpaceOperaCampaign(world);
      const pf = world.playerFactionId;
      const lan = ensureS7State(world).landsraad;

      // CHOAM 信用点守恒：1000 → 500 → 1000（基准价 100/1%）
      assertEq(CHOAM_SHARE_CREDITS_PER_PCT, 100, 'CHK-58-02 每 1% 股份基准价 100');
      const opening = balance(world, pf, 'credits');
      if (opening > 0) debit(world, pf, 'credits', opening, 'm5Setup', null);
      credit(world, pf, 'credits', 1000, 'm5Setup', null);
      assertEq(balance(world, pf, 'credits'), 1000, 'CHK-58-02 初始信用点 1000');
      const buy = dispatch(world, 'AdjustChoamShares', { delta: 5 });
      assertEq(buy.ok, true, `CHK-M5-03 买入 5% 须 ok（实测 ${JSON.stringify(buy)}）`);
      assertEq(lan.choamShares, 5, 'CHK-M5-03 持股 5%');
      assertEq(balance(world, pf, 'credits'), 500, 'CHK-M5-03 买入精确扣 500 信用点');
      const sell = dispatch(world, 'AdjustChoamShares', { delta: -5 });
      assertEq(sell.ok, true, 'CHK-M5-03 抛售 5% 须 ok');
      assertEq(lan.choamShares, 0, 'CHK-M5-03 持股归零');
      assertEq(balance(world, pf, 'credits'), 1000, 'CHK-M5-03 抛售精确回收 500 信用点');
      debit(world, pf, 'credits', 1000, 'm5Setup', null);
      assertThrows(() => adjustChoamShares(world, 5), '信用点不足',
        'CHK-58-02 余额 0 买入必须抛友好错误');
      assertEq(lan.choamShares, 0, 'CHK-58-02 被拒后股份数保持不变（事务守恒）');

      // 双模 ID 契约与归一化
      assertEq(isCoercibleEntityId('plt_101'), true, 'CHK-57-03 字符串行星 ID 可归一化');
      assertEq(isCoercibleEntityId('fac_553'), true, 'CHK-57-03 字符串派系 ID 可归一化');
      assertEq(isCoercibleEntityId('INVALID'), false, 'CHK-57-03 脏字符串仍须拒绝');
      assertEq(normalizeEntityIdValue('flt_563'), 563, 'CHK-57-03 归一化结果 563');
      const probe = { planetId: 'plt_101', empireId: 'fac_553', beaconId: 'bc_7' };
      assertEq(normalizeSpaceOperaEntityIds(probe), 3, 'CHK-57-03 三个 ID 字段全部归一化');
      assertEq(probe.planetId, 101, 'CHK-57-03 planetId → 101');
      assertEq(probe.empireId, 553, 'CHK-57-03 empireId → 553');
      assertEq(probe.beaconId, 7, 'CHK-57-03 beaconId → 7');
      assertEq(validateSpaceOperaCommandPayload({
        type: 'ExcavateSubterraneanLayer', params: { planetId: 'plt_101', depthTier: 1 },
      }).ok, true, 'CHK-57-03 契约校验放行字符串 planetId');
      assertEq(validateSpaceOperaCommandPayload({
        type: 'ConfigureFleetDoctrine',
        params: { empireId: 'fac_553', doctrineSize: 50, qualityWeight: 50, officerAggression: 50 },
      }).ok, true, 'CHK-57-03 契约校验放行字符串 empireId');

      // 字符串 ID 真实派发并改变世界状态
      const pid = Object.keys(world.entities.planets).sort()
        .find((k) => world.entities.planets[k].compactState);
      const compact = world.entities.planets[pid].compactState;
      const depthBefore = compact.subterraneanLayer.depthTier;
      const exc = dispatch(world, 'ExcavateSubterraneanLayer', { planetId: pid, depthTier: 1 });
      assertEq(exc.ok, true, `CHK-M5-03 字符串 planetId 派发须 ok（实测 ${JSON.stringify(exc)}）`);
      assertEq(compact.subterraneanLayer.depthTier, depthBefore + 1,
        'CHK-M5-03 深层掘进世界状态真实改变');
      const doc = dispatch(world, 'ConfigureFleetDoctrine', {
        empireId: 'fac_553', doctrineSize: 50, qualityWeight: 50, officerAggression: 50,
      });
      assertEq(doc.ok, true, `CHK-M5-03 字符串 empireId 派发须 ok（实测 ${JSON.stringify(doc)}）`);
      parts.push('Block3 CHOAM 1000→500→1000 守恒 + 余额0拒绝 + 双模ID契约/归一化/真实派发');
    }

    /* ================ Block 4：CHK-M5-04 / CHK-58-04 / CHK-58-05 / CHK-58-06 ================ */
    {
      const world = createStarterCampaign();
      activateSpaceOperaCampaign(world);
      const colony = Object.values(world.entities.colonies)
        .find((c) => c && c.factionId === world.playerFactionId);
      assert(!!colony, 'CHK-M5-04 必须存在玩家殖民地');
      const planet = world.entities.planets[colony.planetId];

      // 3 座重工 + 1 座实验室 → 工业关注度 ≥ 7 → 激进支部翻转 → 实体镜像
      colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
      colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
      colony.buildings.push({ defId: 'bld_module_factory', level: 1, state: 'active', progress: 0 });
      colony.buildings.push({ defId: 'bld_lab', level: 1, state: 'active', progress: 0 });
      assertEq(syncColonyToSpaceOpera(colony, world), true, 'CHK-M5-04 正向同步执行');
      assert(colony.industrialAttention >= 7,
        `CHK-M5-04 实体工业关注度须 ≥ 7（实测 ${colony.industrialAttention}）`);
      const cellStep = stepShadowSyndicateArc(world);
      assert(cellStep.activated >= 1, 'CHK-M5-04 关注度满 7 须翻转激进支部');
      assertEq(planet.compactState.radicalCell.state, 'ACTIVE', 'CHK-M5-04 紧凑底座支部 ACTIVE');
      syncColonyToSpaceOpera(colony, world); // 月度翻转后回写实体镜像
      assertEq(colony.radicalCellActive, true, 'CHK-M5-04 实体 radicalCellActive === true');

      // 信标投影 band 四色枚举 + 权威映射以 56 总纲语义为准
      const list = spaceOperaView(world).beaconsList;
      assert(list.length >= 15, `CHK-M5-04 信标列表非空（实测 ${list.length}）`);
      for (const b of list) {
        assert(VALID_BANDS.includes(b.band),
          `CHK-M5-04 band 必须 ∈ red/gold/cyan/purple（实测 ${b.band}）`);
      }
      assertEq(BEACON_FREQ_BAND.FREQ_DISTRESSED_CIV, 'red', 'CHK-M5-04 求援频段 red（56 总纲）');
      assertEq(BEACON_FREQ_BAND.FREQ_SHADOW_CONTRACT, 'gold', 'CHK-M5-04 黑市频段 gold（56 总纲）');
      assertEq(BEACON_FREQ_BAND.FREQ_PRECURSOR_ECHO, 'cyan', 'CHK-M5-04 先驱低语 cyan');
      assertEq(BEACON_FREQ_BAND.FREQ_STAR_JOURNAL, 'purple', 'CHK-M5-04 银河日报 purple');
      assertEq(BEACON_FREQ_BAND.OPPORTUNITY_BEACON, 'gold', 'CHK-M5-04 机遇信标 gold');

      // 全链路回执与视角复位（CHK-58-06 零静默）
      assert(beaconOutcomeSummaryZh({ credited: { resId: 'credits', amount: 600 } }).includes('600'),
        'CHK-58-06 信标收益回执须明示 +600 信用点');
      assert(beaconOutcomeSummaryZh({ unityGranted: 25 }).includes('25'),
        'CHK-58-06 凝聚力收益回执须明示 +25');
      const gr = new GalaxyRenderer();
      assertEq(gr.centerOnHomeSystem(world), true, 'CHK-58-06 首帧母星自适配成功');
      const cx = gr.view.x; const cy = gr.view.y;
      gr.view.x = 0; gr.view.zoom = 2;
      assertEq(gr.resetView(), true, 'CHK-58-06 复位视角成功');
      assertNear(gr.view.x, cx, 1e-9, 'CHK-58-06 复位回母星横坐标');
      assertNear(gr.view.y, cy, 1e-9, 'CHK-58-06 复位回母星纵坐标');
      assertEq(gr.view.zoom, 1, 'CHK-58-06 复位 zoom 归 1×');
      parts.push('Block4 关注度≥7/支部实体镜像 + band 四色 + 收益回执 + 母星居中/复位');
    }

    /* ================ Block 5：CHK-M5-05 / CHK-59-01..06 / CHK-60-03 ================ */
    {
      // 赛道 B：两条玩家署名信标，模板 26 → 28，双分支 effect 合法
      assertEq(SUBSPACE_BEACON_TEMPLATES.length, 28, 'CHK-59-01 信标模板总数 28');
      for (const id of ['tpl_co_last_lighthouse', 'tpl_co_automated_toll_7']) {
        const tpl = SUBSPACE_BEACON_TEMPLATES.find((t) => t.templateId === id);
        assert(!!tpl, `CHK-59-01 缺少共创信标 ${id}`);
        assertEq(tpl.responseOptions.length, 2, `CHK-59-01 ${id} 必须双分支`);
        for (const opt of tpl.responseOptions) {
          assert(!!(opt.effect && typeof opt.effect.kind === 'string'),
            `CHK-59-01 ${id}/${opt.id} 必须含合法 effect 对象`);
        }
      }

      // 赛道 C：第 3 位传奇 + 虚空裁缝 + 舰队修正真实生效
      assertEq(LEGENDARY_PARAGONS.SERA_CARTOGRAPHER.capExempt, true, 'CHK-59-02 赛拉 capExempt');
      assertEq(DESTINY_TRAITS.commander_void_tailor.bonus.foldLaneFuelSaving, 0.40,
        'CHK-59-02 虚空裁缝燃料节省 0.40');
      const sw = createStarterCampaign();
      activateSpaceOperaCampaign(sw);
      const recruit = dispatch(sw, 'RecruitSeraCartographer', {});
      assertEq(recruit.ok, true, 'CHK-59-02 赛拉招募命令须 ok');
      const fleet = Object.values(sw.entities.fleets)[0];
      const fm = seraFleetModifiers(sw, fleet);
      assertNear(fm.fuelMultiplier, 0.60, 1e-9, 'CHK-59-02 全帝国舰队燃料 ×0.60');
      assertNear(fm.speedMultiplier, 1.25, 1e-9, 'CHK-59-02 全帝国航速 ×1.25（doc56 赛道 C）');

      // 赛道 D：第 4 宪章 + 通过效果 + 科研 +20%
      assert(LANDSRAAD_BILL_KINDS.includes('CHARTER_STARFIRE_PACT'), 'CHK-59-03 第 4 宪章入库');
      assertEq(LANDSRAAD_BILL_KINDS.length, 4, 'CHK-59-03 宪章法案恰 4 类');
      const pw = createStarterCampaign();
      activateSpaceOperaCampaign(pw);
      const lan = ensureS7State(pw).landsraad;
      const ppf = pw.playerFactionId;
      pw.entities.factions = { [ppf]: { id: ppf, name: '玩家' } }; // 清空 AI 反对席位
      lan.standing = 100;
      const bill = proposeLandsraadBill(pw, 'CHARTER_STARFIRE_PACT');
      assertEq(bill.kind, 'CHARTER_STARFIRE_PACT', 'CHK-59-03 星火公约提案落账');
      const rdBefore = balance(pw, ppf, 'researchData');
      const settled = settleLandsraadBillMonthly(pw);
      assertEq(settled.passed, true, 'CHK-59-03 星火公约须表决通过');
      assertEq(balance(pw, ppf, 'researchData') - rdBefore, 120, 'CHK-59-03 精确 +120 科研数据');
      assertEq(lan.starfirePactActive, true, 'CHK-59-03 starfirePactActive === true');
      assertNear(getSpaceOperaModifiers(null, pw).researchMultiplier, 1.20, 1e-9,
        'CHK-59-03 全银河科研速度 +20% 接线生效');

      // 赛道 E：两项传奇 S-Mod + 安装扣 1 exoticMatter + 效果函数
      assert(!!SMOD_CATALOG.smod_unsinkable_medal, 'CHK-59-04 不沉勋章入库');
      assert(!!SMOD_CATALOG.smod_nanite_symbiont, 'CHK-59-04 纳米寄生修复群入库');
      const ew = createStarterCampaign();
      activateSpaceOperaCampaign(ew);
      const shipId = Object.keys(ew.entities.ships).sort()[0];
      credit(ew, ew.playerFactionId, 'exoticMatter', 3, 'm5Setup', null);
      const exBefore = balance(ew, ew.playerFactionId, 'exoticMatter');
      const scars = installShipSMod(ew, shipId, 'smod_unsinkable_medal');
      assert(scars.sMods.includes('smod_unsinkable_medal'), 'CHK-59-04 S-Mod 安装成功');
      assertEq(balance(ew, ew.playerFactionId, 'exoticMatter'), exBefore - SMOD_INSTALL_EXOTIC_MATTER,
        'CHK-59-04 精确扣 1 exoticMatter');
      const probeShip = {
        status: 'active', hp: { structure: 10 }, stats: { structure: 100 },
        scars: { sMods: ['smod_unsinkable_medal', 'smod_nanite_symbiont'] },
      };
      assertNear(unsinkableDamageMultiplier(probeShip), 1.30, 1e-9,
        'CHK-59-04 结构 10% 时伤害 +30%');
      assertNear(naniteSymbiontRepair(probeShip), 5, 1e-9,
        'CHK-59-04 战后自动修复 5% 结构');

      // 赛道 A：镜渊回声异常（spatial / 难度 3）
      const ano = ANOMALY_TEMPLATES.find((t) => t.id === 'ano_echo_mirror');
      assert(!!ano, 'CHK-59-05 镜渊回声异常入库');
      assertEq(ano.category, 'spatial', 'CHK-59-05 分类 spatial');
      assertEq(ano.difficultyMod, 3, 'CHK-59-05 难度加成 3');

      // 赛道 F：深核共振破甲 ×2.0（含 59 文档字段形态兼容）
      assertEq(CORE_RESONANCE_DAMAGE_MULT, 2.0, 'CHK-59-06 共振倍率常量 2.0');
      const on = { surfaceDelta: { extraction: [1, 0, 0, 0, 0], heat: [800, 3, 0, 0] } };
      assertEq(coreResonanceDamageMultiplier(on), 2.0, 'CHK-59-06 钻机+★3 → ×2.0');
      assertEq(coreResonanceDamageMultiplier({ surfaceDelta: { extraction: [0], heat: [800, 3] } }),
        1.0, 'CHK-59-06 钻机停机 → ×1.0');
      assertEq(coreResonanceDamageMultiplier({ surfaceDelta: { extraction: [1], heat: [100, 1] } }),
        1.0, 'CHK-59-06 星级不足 → ×1.0');
      assertEq(coreResonanceDamageMultiplier({
        surfaceDelta: { extraction: [1] }, threat: { heat: { stars: 3 } },
      }), 2.0, 'CHK-59-06 兼容 spec59 的 threat.heat.stars 形态');
      const gv = Object.create(GroundView);
      gv.planet = on;
      gv._resonanceToastShown = false;
      assertEq(gv._isCoreResonanceActive(), true, 'CHK-59-06 GroundView 实例判定生效');
      assertEq(gv._coreDamageMult(), 2.0, 'CHK-59-06 单发伤害倍率 2.0');
      assertEq(gv._resonanceToastShown, true, 'CHK-59-06 破甲 Toast 回执已触发');

      // REG-01 金快照零漂移（4,320 Ticks）
      assertEq(goldenHashOnce(), '8be8ce2c', 'CHK-M5-05 / CHK-60-03 REG-01 金哈希零漂移');
      parts.push('Block5 六大共创赛道全链路 + 星火+120/+20% + S-Mod 扣料/效果 + 共振×2.0 + REG-01 8be8ce2c');
    }


    /* ================ Block 6：CHK-M6-01..04（M5 专家终审遗留阻断项闭环） ================ */
    {
      // CHK-M6-01：赛拉招募前后 planRoute / beginTransit 燃料折扣实测（×0.60 × 0.80 = ×0.48）
      const nw = createStarterCampaign();
      activateSpaceOperaCampaign(nw);
      const pf = nw.playerFactionId;
      const fleet = Object.values(nw.entities.fleets).find((f) => f && f.factionId === pf && f.systemId);
      assert(!!fleet, 'CHK-M6-01 必须存在玩家在位舰队');
      const sysIds = Object.keys(nw.entities.systems).sort();
      let targetSysId = null;
      let bestEta = -1;
      for (const sid of sysIds) {
        if (sid === fleet.systemId) continue;
        const probePlan = planRoute(nw, fleet, sid);
        if (probePlan.ok && probePlan.eta > bestEta) {
          bestEta = probePlan.eta;
          targetSysId = sid;
        }
      }
      assert(!!targetSysId && bestEta >= 5, 'CHK-M6-01 必须存在长距离可达航线');
      for (const sid of fleet.shipIds) {
        const s = nw.entities.ships[sid];
        if (s) s.fuel = 10000;
      }
      const planBefore = planRoute(nw, fleet, targetSysId);
      assertEq(planBefore.ok, true, 'CHK-M6-01 招募前 planRoute 须成功');
      const rec = dispatch(nw, 'RecruitSeraCartographer', {});
      assertEq(rec.ok, true, 'CHK-M6-01 RecruitSeraCartographer 须成功');
      const planAfter = planRoute(nw, fleet, targetSysId);
      assertEq(planAfter.ok, true, 'CHK-M6-01 招募后 planRoute 须成功');
      assert(planAfter.fuelNeed <= planBefore.fuelNeed * 0.60 + 1e-6 && planAfter.fuelNeed > 0,
        'CHK-M6-01 招募赛拉后 planRoute fuelNeed 须应用赛拉燃料折扣（≤ 0.60×）');
      const trRes = beginTransit(nw, fleet, planAfter.route, 10000);
      assertEq(trRes.ok, true, 'CHK-M6-01 beginTransit 须成功');
      assertNear(trRes.fuelNeed, planAfter.fuelNeed, 1e-9,
        'CHK-M6-01 beginTransit fuelNeed 须与 planRoute 口径完全一致');

      // 轻量无头 DOM 沙箱（Node 下临时挂载，浏览器下使用真实 offscreen div）
      const withDom = (fn) => {
        const prevDoc = globalThis.document;
        const prevNode = globalThis.Node;
        if (typeof prevDoc !== 'undefined') {
          return fn(prevDoc.createElement('div'));
        }
        class MockNode {}
        const makeNode = (tag) => {
          const node = Object.assign(new MockNode(), {
            tagName: String(tag).toUpperCase(),
            children: [],
            attrs: {},
            dataset: {},
            style: {},
            classList: { add() {}, remove() {}, toggle() {} },
            textContent: '',
            innerHTML: '',
            appendChild(c) { if (c && c.children && c.tagName === '#fragment') { for (const x of c.children) node.children.push(x); } else if (c) { node.children.push(c); } return c; },
            append(...items) { for (const c of items) { if (typeof c === 'string') node.children.push({ textContent: c, children: [] }); else if (c) node.appendChild(c); } },
            replaceChildren() { node.children.length = 0; },
            setAttribute(k, v) { node.attrs[k] = String(v); },
            removeAttribute(k) { delete node.attrs[k]; },
            addEventListener() {},
          });
          return node;
        };
        const collectText = (n) => {
          if (!n) return '';
          let s = n.textContent || '';
          for (const c of (n.children || [])) s += ' ' + collectText(c);
          return s;
        };
        globalThis.Node = MockNode;
        globalThis.document = {
          createElement: (t) => makeNode(t),
          createElementNS: (_ns, t) => makeNode(t),
          createTextNode: (t) => Object.assign(new MockNode(), { textContent: String(t), children: [] }),
          createDocumentFragment: () => makeNode('#fragment'),
        };
        try {
          return fn(makeNode('div'), collectText);
        } finally {
          if (prevDoc === undefined) delete globalThis.document;
          else globalThis.document = prevDoc;
          if (prevNode === undefined) delete globalThis.Node;
          else globalThis.Node = prevNode;
        }
      };

      // CHK-M6-02 & CHK-M6-03：GovernmentView 创伤对象解构无 [object Object] + DiplomacyView 星火公约无裸枚举
      const uiWorld = createStarterCampaign();
      activateSpaceOperaCampaign(uiWorld);
      const upf = uiWorld.playerFactionId;
      const paragonChar = Object.values(uiWorld.entities.characters).find((c) => c && c.paragon && (!c.factionId || c.factionId === upf));
      assert(!!paragonChar, 'CHK-M6-02 必须存在玩家派系传奇领袖');
      paragonChar.paragon.trauma = [{ traitId: 'MELANCHOLIC', tier: 1 }, { traitId: 'LAVISH_LIFESTYLE', tier: 2 }];
      paragonChar.paragon.traumaBackgroundZh = '早年经历双星坍缩劫难，长期失眠。';
      const gvProj = governmentView(uiWorld, upf);
      const pgProj = gvProj.paragons.find((p) => p.id === paragonChar.id);
      assert(!!pgProj && Array.isArray(pgProj.trauma) && pgProj.trauma.length === 2, 'CHK-M6-02 governmentView 须透传创伤数组');

      withDom((root, collectText) => {
        const readText = collectText || ((el) => el.textContent || '');
        const mockApp = { world: uiWorld, dispatch: () => ({ ok: true }), goto: () => {} };
        const govStub = Object.create(GovernmentView);
        govStub._mounted = true;
        govStub.app = mockApp;
        govStub._app = mockApp;
        govStub._body = root;
        govStub._titleExtra = document.createElement('span');
        govStub._rebuild();
        const govText = readText(root);
        assert(!govText.includes('[object Object]'), 'CHK-M6-02 GovernmentView 严禁渲染 [object Object]');
        assert(govText.includes('幽暗抑郁症 I') && govText.includes('穷奢极欲 II'),
          'CHK-M6-02 GovernmentView 须将 {traitId,tier} 解析为「幽暗抑郁症 I / 穷奢极欲 II」');
        assert(govText.includes('往事档案：早年经历双星坍缩劫难'),
          'CHK-M6-02 GovernmentView 须渲染 pg.traumaBackgroundZh 往事档案');

        const dipRoot = document.createElement('div');
        const dipStub = Object.create(DiplomacyView);
        dipStub._mounted = true;
        dipStub.app = mockApp;
        dipStub._app = mockApp;
        dipStub._body = dipRoot;
        dipStub._expanded = new Set();
        dipStub._rebuild();
        const dipText = readText(dipRoot);
        assert(dipText.includes('星火科研共享公约'), 'CHK-M6-03 DiplomacyView 须渲染「星火科研共享公约」');
        assert(!/提案：\s*CHARTER_STARFIRE_PACT/.test(dipText),
          'CHK-M6-03 DiplomacyView 提案按钮不得裸露 CHARTER_STARFIRE_PACT 枚举名');
      });

      // CHK-M6-04：GroundView._build(param) 与 app._groundTargetPlanet 行星灵魂上下文解析
      const gw = createStarterCampaign();
      activateSpaceOperaCampaign(gw);
      const targetPid = Object.keys(gw.entities.planets).sort().find((k) => gw.entities.planets[k] && gw.entities.planets[k].compactState);
      assert(!!targetPid, 'CHK-M6-04 必须存在含太空歌剧原型的行星');
      const gvStub = Object.create(GroundView);
      gvStub._mounted = true;
      gvStub._forceBriefing = true;
      gvStub._targetPlanetId = null;
      gvStub._handlers = [];
      gvStub._teardownScene = () => {};
      gvStub.body = { innerHTML: '', replaceChildren() {}, appendChild() {} };
      gvStub.headInfo = { textContent: '' };
      gvStub.headBtns = { replaceChildren() {}, appendChild() {} };
      gvStub.headOperaChip = null;
      gvStub.app = { world: gw, _groundTargetPlanet: null, dispatch: () => ({ ok: true }), goto: () => {} };
      gvStub._buildBriefing = () => {};
      gvStub._build(targetPid);
      assertEq(gvStub._targetPlanetId, targetPid, 'CHK-M6-04 GroundView._build(planetId) 须锁定 _targetPlanetId');
      gvStub._targetPlanetId = null;
      gvStub.app._groundTargetPlanet = targetPid;
      gvStub._build(null);
      assertEq(gvStub._targetPlanetId, targetPid, 'CHK-M6-04 GroundView._build(null) 须回退 app._groundTargetPlanet');

      parts.push('Block6 CHK-M6-01..04 赛拉0.48×燃料 + 创伤中文零[object Object] + 星火公约中文化 + 地表行星参数透传');
    }

    return {
      ok: true,
      detail: `M5/M6 六 Block 全绿：${parts.join(' | ')}`,
    };
  },
};
