/**
 * tests/suites/m3-space-opera-drama-director.suite.js — doc46 GATE-17-M3
 * 太空歌剧 M3 反孤独生态 / S7 天灾 / 自适应戏剧导演门禁（SPACE-OPERA-M3，group: space-opera）
 *
 * 按序实现 SPEC-PLAN-046 §3 全部 7 项 Checklists：
 *  - CHK-M3-01（巡逻司令部、CR 与 D-Mods 折扣）：upgradePatrolHQ 精确扣 250000 credits；
 *    hammerhead 部署补给费 === 月维护费 === 10；D-Mod 1/2/3 → deploymentCostMultiplier
 *    精确 0.8/0.6/0.4（整商形式）且部署费/月维护费 ×0.8/×0.6/×0.4（assertNear 1e-9）；
 *    ConfigureFleetDoctrine 命令三滑块落账 + 编队模板重算；RestoreShipDMod 命令扣 500
 *    alloy 消除 −20% 档；
 *  - CHK-M3-02（领袖 XP 入账与超限软惩罚公式）：统治者 +12/月、总督 +5/月、竣工 +10、
 *    陆战 +100 + 0.25/军（实地入账断言）；upkeepMultiplier(6,4)===1.5、
 *    xpGainMultiplier(6,4)===0.7225（assertNear 1e-9）；AssignParagonDestinyTrait Lv8 固化；
 *  - CHK-M3-03（The Beholder 双形态与城邦导师撤离）：MURMURING_MONOLITH → 矿工岗位全转
 *    灵能合唱体（jobRoles {miner:0,telepath:n}）且产 energy（netFlow[0] +8.0×n/月）+
 *    unity（telepathUnity +6.0×n/月）；攻击城邦 → Lv5 导师从 world.characters 移除 +
 *    内阁议程 −20%（100 → 80）；
 *  - CHK-M3-04（子空间信标流密度不变量）：ensureSpaceOperaState 后连推 1000 逻辑帧
 *    （space-opera 时钟 + 信标流阶段逐帧驱动），每帧断言非帝国活跃叙事信标 ≥ 15；
 *  - CHK-M3-05（索林原虫净化与援军动态缩放）：感染星球轨道轰炸 devastation=99 抛错、
 *    =100 → 菌毯（overlayId=5）清除 + 还原荒芜（biome 0）+ meta.infested=false；
 *    PRETHORYN_REINFORCE_SCHEDULE 逐档断言 + 占比 10%/25%/45% 三档实地触发
 *    （年援军 2/3/4 支，reinforceMonths=12 累积口径）；
 *  - CHK-M3-06（戏剧导演高潮宣泄与 +18 机遇信标爆发）：G(c) 斜坡逐点；adaptDays 分段
 *    增速（59/60→+1.0、61→+0.5、100 封顶、负段 +3.0）；1 Killed 折算 == 5 Downed
 *    （扣减量与末态逐位相等）；EQUILIBRIUM_S 与 jacobian SYSTEM_EQUILIBRIUM 逐位互证；
 *    预算双因子逐项（1240/398 → W_base 819 → W_eff 573.3；封顶 10000）；T=78.0 月度
 *    收口触发 GRAND_CLIMAX → 结算瞬间 T===25.0、A===0.75、adaptDays===−50、宽限
 *    tick+2160、climaxCount===1、OPPORTUNITY_BEACON 新增恰 18 个；宽限期锁 0.75 与
 *    期满公式恢复（adaptDays=−50 → 0.825 / −47 → 0.8355）；
 *  - CHK-M3-07（全生命周期 24,000 Ticks 浸泡与金快照终审）：createMinimalWorld +
 *    ensureSpaceOperaState + 数条命令后 advanceTicks 24000：零未捕获异常、systemVector
 *    无 NaN、300 个 compactPlanetState 深拷贝（serialization.deepClone）median ≤ 250ms
 *    （<x.xxms> 令牌）；金快照零漂移由编排层另跑 REG-01 确认（套件内不复算）。
 *  - CHK-M3-08（doc42 总纲终审整改：终局天灾有机触发 + 巨兽凯旋大游行实战可达）：
 *    stepGalacticSenateMonthly 有机触发检定（month < 120 / 殖民占比 < 25% 双门槛零触发；
 *    达标后确定性触发 + 双胞胎世界触发月/种类逐位复现 + 活跃期不叠加）；
 *    reportLeviathanDefeated 巨兽击杀结算直连开启 LEVIATHAN_PARADE 局势（幂等不重复）。
 *  - CHK-M3-09（doc42 总纲终审整改：S7 第二幕命令与兰兹拉德宪章表决）：
 *    SignCommission/AdjustChoamShares/AdjustLandsraadStanding/UpgradePalaceEspionage/
 *    LayerUpSpyNetwork/PlantDoubleAgent/Assassinate/ProposeLandsraadBill/HireEnclaveMentor/
 *    AttackEnclave 十命令实战落账；proposeLandsraadBill → 月末 settleLandsraadBillMonthly
 *    standing 加权表决（MANDATE 通过 +5 授权 / SANCTION 通过制裁最敌对派系 / 否决 −2 反弹）。
 *  - CHK-M3-10（doc42 总纲终审整改：群像实战成长钩子）：finishBattle 双侧指挥官
 *    太空战役 XP（+5 +0.05×ShipSize×击毁 +0.025×ShipSize×迫退）与全灭旗舰创伤检定
 *    （镜像确定性 roll 逐位对拍）；finishMission 陆战 XP（+100 +0.25×歼灭）与惨败
 *    挚友阵亡创伤检定；tickColonyConstruction 竣工 +10 XP 归辖区总督；
 *    startArchaeologyDig 挂接首席科学家 → 考古晋幕 grantScientistXp + 高危灾难
 *    traumaCheck('archaeology_disaster')；stepLegendaryParagonRecruitment 传奇群像
 *    （TUBOREK 月龄 60 / THE_BEHOLDER 月龄 120 错峰确定性抵达 + capExempt + 幂等不复活）。
 *
 * 零漂移纪律：全部状态构造发生在套件自有世界（纯对象合成 / createMinimalWorld），
 * 绝不触碰 tests/regression/golden.json 基线世界；零 Math.random（runner 毒丸守卫在场）；
 * 性能断言 ≥30 次采样 median，耗时以 <x.xxms> 令牌写入 detail。
 */
// SPEC-PLAN-048 §Task 4.4 §1 / SPEC-PLAN-052 §Task 52.5 §1：补齐核心命令注册副作用导入，
// 确保本套件脱离 tests/suites/index.js 单独运行时 AppointOverseer 等核心命令 100% 在场
import '../../src/app/commands.js';
import { assert, assertEq, assertNear, assertThrows } from './assert.js';
import {
  PATROL_HQ_UPGRADE_CREDITS,
  SHIP_SUPPLY_COSTS,
  DMOD_RESTORE_ALLOY,
  SMOD_INSTALL_EXOTIC_MATTER,
  deploymentCostMultiplier,
  deploySupplyCost,
  monthlyMaintenanceCost,
  upgradePatrolHQ,
} from '../../src/domain/fleets/fleetDoctrineAndScars.js';
import {
  MONTHLY_XP,
  BUILD_COMPLETION_XP,
  GROUND_BATTLE_XP,
  TELEPATH_ENERGY_PER_POP_MONTH,
  TELEPATH_UNITY_PER_POP_MONTH,
  COUNCIL_AGENDA_PENALTY,
  upkeepMultiplier,
  xpGainMultiplier,
  ensureParagonProfile,
  lv8Offers,
  grantMonthlyXp,
  grantBuildXp,
  grantGroundXp,
  applyLegendaryParagon,
  toggleBeholderMode,
  hireEnclaveMentor,
  attackEnclaveConsequence,
  stepLegendaryParagonRecruitment,
  LEGENDARY_ARRIVAL_MIN_MONTH,
  LEGENDARY_ARRIVAL_MONTHLY_CHANCE,
} from '../../src/domain/characters/galacticParagons.js';
import {
  ensureSpaceOperaState,
} from '../../src/domain/world/worldMigration.js';
import {
  startEndgameCrisis,
  stepEndgameCrisisMonthly,
  stepGalacticSenateMonthly,
  stepEndgameCrisisOrganicTrigger,
  colonizedSystemShare,
  getActiveLandsraadBill,
  choamTradeDividendMult,
  hasEmbargoLeverage,
  spyNetwork,
  purifyInfestedWorld,
  prethorynReinforcementsPerYear,
  PRETHORYN_REINFORCE_SCHEDULE,
  galaxyShareOf,
  ENDGAME_CRISIS_KINDS,
  ENDGAME_CRISIS_MIN_MONTH,
  ENDGAME_CRISIS_MIN_COLONIZED_SHARE,
  LANDSRAAD_BILL_KINDS,
} from '../../src/domain/diplomacy/galacticSenateAndCrisisArc.js';
import {
  ensureCompactPlanetState,
  packTile,
  unpackTile,
  numericEntityKey,
} from '../../src/domain/planets/planetStateSchema.js';
import { reportLeviathanDefeated } from '../../src/domain/ground/planetaryThreat.js';
import { finishBattle } from '../../src/domain/combat/BattleSimulation.js';
import { finishMission } from '../../src/domain/ground/GroundMission.js';
import { tickColonyConstruction } from '../../src/domain/planets/colony.js';
import { startArchaeologyDig } from '../../src/domain/exploration/archaeologyArc.js';
import { relationKey } from '../../src/core/ids.js';
import { sampleFloat01, deriveSeed, DOMAIN_SALTS } from '../../src/domain/world/deterministicRng.js';
import { credit, balance } from '../../src/domain/economy/ledger.js';
import { stepSpaceOperaTick } from '../../src/simulation/SpaceOperaClock.js';
import { stepBeaconStream, countActiveNarrative, listActiveBeacons } from '../../src/domain/world/subspaceBeaconStream.js';
import {
  EQUILIBRIUM_S,
  graceSlopeG,
  computeDramaBudget,
  stepDramaAdaptationDaily,
  stepSpaceOperaDramaMonthly,
  resolveGrandClimax,
  reportDowned,
  reportKilled,
  deriveAdaptationFactor,
  ensureDramaMonthlyRegistered,
  CATHARSIS_OPPORTUNITY_BEACONS,
  RECOVERY_GRACE_TICKS,
  CATHARSIS_TENSION,
  CATHARSIS_ADAPTATION,
  CATHARSIS_ADAPT_DAYS,
  DOWNED_ADAPT_COST,
  KILLED_ADAPT_COST,
} from '../../src/simulation/dramaDirector.js';
import { SYSTEM_EQUILIBRIUM } from '../../src/simulation/jacobianCoupling.js';
import { ensureClockHooksInjected, stepSituationBucket, listActiveSituations } from '../../src/domain/events/situationEngine.js';
import { ensureLeaderHookInjected } from '../../src/domain/characters/galacticParagons.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { createMinimalWorld } from '../../src/devtools/scenarioFactory.js';
import { deepClone } from '../../src/core/serialization.js';
import { spaceOperaView } from '../../src/simulation/ViewModels.js';
import '../../src/app/commandsSpaceOpera.js'; // 副作用：18 命令注册 + M1/M2/M3 共 18 handler 注入 + 全弧/戏剧导演模块挂载

const SEED = 24601;

/** 合成太空歌剧世界（Plain Data；含事件总线 / 经济账本 / 战报 / 可选星系表） */
function makeOperaWorld(systemCount = 0) {
  const world = {
    seed: SEED,
    tick: 0,
    seq: 0,
    stats: {},
    commandLog: [],
    events: { queue: [], log: {}, chronicle: [] },
    entities: { planets: {}, fleets: {}, characters: {}, systems: {}, ships: {} },
    battles: { active: {}, history: [] },
    economy: { ledgers: {}, daily: {}, transactions: [] },
    research: {},
  };
  for (let i = 1; i <= systemCount; i++) world.entities.systems[`sys_${i}`] = { name: `测试星系${i}` };
  return world;
}

/** ≥30 次采样 median（上中位数，保守口径；与 CHK-M1-04 / CHK-M2-03 同构） */
function medianMs(fn, samples) {
  const arr = [];
  for (let n = 0; n < samples; n++) {
    const t0 = performance.now();
    fn();
    arr.push(performance.now() - t0);
  }
  arr.sort((a, b) => a - b);
  return arr[arr.length >> 1];
}

/* ============================== CHK-M3-01：巡逻司令部、CR 与 D-Mods 折扣 ============================== */

function chk0301() {
  // —— 巡逻司令部升级精确扣 250000 ——
  assertEq(PATROL_HQ_UPGRADE_CREDITS, 250000, 'CHK-M3-01 巡逻司令部升级费用须精确 250000');
  const world = makeOperaWorld(2);
  world.playerFactionId = 'fac_player';
  credit(world, 'fac_player', 'credits', 1000000, 'suiteSeed', null);
  const planet = { id: 7, systemId: 1, name: '巡逻星' };
  world.entities.planets[7] = planet;
  const before = balance(world, 'fac_player', 'credits');
  const hq = upgradePatrolHQ(world, 7);
  assertEq(balance(world, 'fac_player', 'credits'), before - 250000, 'CHK-M3-01 须精确扣除 250000 credits');
  assertEq(hq.doctrine.shipSizeWeight, 0.5, 'CHK-M3-01 学说滑块出厂默认 shipSize 0.5');
  assertEq(hq.doctrine.qualityWeight, 0.5, 'CHK-M3-01 学说滑块出厂默认 quality 0.5');
  assertEq(hq.doctrine.officerAggression, 0.5, 'CHK-M3-01 学说滑块出厂默认 aggression 0.5');

  // —— hammerhead 部署补给费 === 月度补给维护费 === 10 ——
  assertEq(SHIP_SUPPLY_COSTS.hammerhead, 10, 'CHK-M3-01 hammerhead 补给费表须精确 10');
  const bare = { hullId: 'hammerhead' };
  assertEq(deploySupplyCost(bare), 10, 'CHK-M3-01 hammerhead 单次实战部署须精确消耗 10 补给');
  assertEq(monthlyMaintenanceCost(bare), 10, 'CHK-M3-01 hammerhead 月维护须与部署费同口径 10');

  // —— D-Mod 1/2/3 → ×0.8/×0.6/×0.4（乘数整商逐位精确；乘积 assertNear 1e-9）——
  const EXPECTED = [[1, 0.8], [2, 0.6], [3, 0.4]];
  for (const [n, mult] of EXPECTED) {
    assertEq(deploymentCostMultiplier(n), mult, `CHK-M3-01 ${n} 项 D-Mod 部署费乘数须精确 ${mult}`);
    const ship = { hullId: 'hammerhead', scars: { cr: 100, dMods: new Array(n).fill('dmg_armor_belt'), sMods: [] } };
    assertNear(deploySupplyCost(ship), 10 * mult, 1e-9, `CHK-M3-01 ${n} 项 D-Mod 部署费须 ${10 * mult}`);
    assertNear(monthlyMaintenanceCost(ship), 10 * mult, 1e-9, `CHK-M3-01 ${n} 项 D-Mod 月维护须 ${10 * mult}`);
  }

  // —— ConfigureFleetDoctrine 命令路径：三滑块落账 + 编队模板重算 ——
  const env = executeCommand(world, {
    type: 'ConfigureFleetDoctrine',
    params: { empireId: 1, doctrineSize: 70, qualityWeight: 20, officerAggression: 80, planetId: 7 },
  });
  assertEq(env.ok, true, `CHK-M3-01 ConfigureFleetDoctrine 信封须 ok:true（实测 ${JSON.stringify(env)}）`);
  const d = planet.patrolHQ.doctrine;
  assertEq(d.shipSizeWeight, 0.7, 'CHK-M3-01 doctrineSize 70 → shipSizeWeight 0.7');
  assertEq(d.qualityWeight, 0.2, 'CHK-M3-01 qualityWeight 20 → 0.2');
  assertEq(d.officerAggression, 0.8, 'CHK-M3-01 officerAggression 80 → 0.8');
  const tpl = planet.patrolHQ.template;
  assertEq(tpl.heavy, 0.7, 'CHK-M3-01 重型列 = shipSizeWeight 0.7（重算模板）');
  assertNear(tpl.mid, 0.3 * (0.25 + 0.5 * 0.2) * (1 - 0.4 * 0.8), 1e-9, 'CHK-M3-01 中型屏卫份额公式');
  assertNear(tpl.light, 0.3 - tpl.mid, 1e-9, 'CHK-M3-01 轻型份额 = 屏卫总份额 − 中型');

  // —— RestoreShipDMod 命令路径：精确扣 500 alloy，消除 −20% 档 ——
  assertEq(DMOD_RESTORE_ALLOY, 500, 'CHK-M3-01 D-Mod 修复费用须精确 500 alloy');
  const ship = { id: 9, hullId: 'hammerhead', scars: { cr: 100, dMods: ['dmg_armor_belt'], sMods: [] } };
  world.entities.ships[9] = ship;
  credit(world, 'fac_player', 'alloy', 1000, 'suiteSeed', null);
  const alloyBefore = balance(world, 'fac_player', 'alloy');
  const env2 = executeCommand(world, { type: 'RestoreShipDMod', params: { shipId: 9, dModId: 'dmg_armor_belt' } });
  assertEq(env2.ok, true, `CHK-M3-01 RestoreShipDMod 信封须 ok:true（实测 ${JSON.stringify(env2)}）`);
  assertEq(ship.scars.dMods.length, 0, 'CHK-M3-01 修复后暗伤须移除');
  assertEq(deploySupplyCost(ship), 10, 'CHK-M3-01 修复后部署补给费须恢复 10（消除 −20% 档）');
  assertEq(balance(world, 'fac_player', 'alloy'), alloyBefore - 500, 'CHK-M3-01 修复须精确扣除 500 alloy');

  // —— InstallShipSMod 命令路径：扣 1 exoticMatter 焊死词条 ——
  assertEq(SMOD_INSTALL_EXOTIC_MATTER, 1, 'CHK-M3-01 S-Mod 安装费用须精确 1 exoticMatter');
  credit(world, 'fac_player', 'exoticMatter', 5, 'suiteSeed', null);
  const emBefore = balance(world, 'fac_player', 'exoticMatter');
  const env3 = executeCommand(world, { type: 'InstallShipSMod', params: { shipId: 9, moduleId: 'smod_hardened_subsystems' } });
  assertEq(env3.ok, true, `CHK-M3-01 InstallShipSMod 信封须 ok:true（实测 ${JSON.stringify(env3)}）`);
  assertEq(ship.scars.sMods, ['smod_hardened_subsystems'], 'CHK-M3-01 词条须永久焊死进 sMods');
  assertEq(balance(world, 'fac_player', 'exoticMatter'), emBefore - 1, 'CHK-M3-01 安装须精确扣除 1 exoticMatter');
  return 'CHK-M3-01 升级精确扣250000; hammerhead部署=月维护=10; D-Mod 1/2/3→×0.8/×0.6/×0.4; 学说三滑块+模板重算; 修复-500alloy/焊死-1exoticMatter';
}

/* ============================== CHK-M3-02：领袖 XP 入账与超限软惩罚公式 ============================== */

function chk0302() {
  // —— 精确入账表常量 ——
  assertEq(MONTHLY_XP.ruler, 12.0, 'CHK-M3-02 统治者月 XP 须精确 +12.0');
  assertEq(MONTHLY_XP.councilOrGovernor, 5.0, 'CHK-M3-02 内阁/总督月 XP 须精确 +5.0');
  assertEq(BUILD_COMPLETION_XP, 10.0, 'CHK-M3-02 竣工 XP 须精确 +10.0');
  assertEq(GROUND_BATTLE_XP.base, 100.0, 'CHK-M3-02 陆战基础 XP 须精确 +100.0');
  assertEq(GROUND_BATTLE_XP.perArmy, 0.25, 'CHK-M3-02 每支陆军 XP 须精确 +0.25');

  // —— 超限软惩罚：C=4, N=6 → 1.5× / 0.7225× ——
  assertEq(upkeepMultiplier(6, 4), 1.5, 'CHK-M3-02 维护费倍率 6/4 须精确 1.5');
  assertNear(xpGainMultiplier(6, 4), 0.7225, 1e-9, 'CHK-M3-02 经验倍率 0.85^2 须精确 0.7225');
  assertNear(xpGainMultiplier(4, 4), 1.0, 1e-12, 'CHK-M3-02 未超编不衰减');
  assertNear(xpGainMultiplier(7, 4), 0.85 ** 3, 1e-9, 'CHK-M3-02 超编 3 人 → 0.85^3');

  // —— 实地入账：统治者/总督月度 XP + 竣工 XP ——
  const world = makeOperaWorld(2);
  world.playerFactionId = 'fac_player';
  world.entities.planets[7] = { id: 7, systemId: 1, name: '辖区星' };
  ensureCompactPlanetState(world.entities.planets[7], world); // 辖区行星（grantBuildXp governedPlanetId 扫描域）
  ensureSpaceOperaState(world);
  const ruler = { id: 'chr_1', name: '最高统治者', level: 1, xp: 0, traits: [], loyalty: 90, health: 'healthy' };
  const governor = { id: 'chr_2', name: '辖区总督', level: 1, xp: 0, traits: [], loyalty: 90, health: 'healthy' };
  const commander = { id: 'chr_3', name: '陆战指挥官', level: 1, xp: 0, traits: [], health: 'healthy' };
  world.entities.characters[ruler.id] = ruler;
  world.entities.characters[governor.id] = governor;
  world.entities.characters[commander.id] = commander;
  ensureParagonProfile(ruler, world).councilPosition = 'RULER';
  ensureParagonProfile(governor, world).governedPlanetId = 7;
  ensureParagonProfile(commander, world);

  grantMonthlyXp(world);
  assertEq(ruler.xp, 12, 'CHK-M3-02 统治者须实收 +12 XP/月');
  assertEq(governor.xp, 5, 'CHK-M3-02 总督须实收 +5 XP/月');

  const build = grantBuildXp(world, 7);
  assert(build && build.leaderId === governor.id, 'CHK-M3-02 竣工 XP 须归属辖区总督');
  assertEq(governor.xp, 15, 'CHK-M3-02 竣工 1 座建筑须实收 +10 XP');
  assertNear(build.gained, 10.0, 1e-9, 'CHK-M3-02 竣工 XP 返回值须精确 10.0');

  // —— 陆战：+100 + 0.25×4 = 101（容量未超编 → 全额入账）——
  const ground = grantGroundXp(world, 'chr_3', 4);
  assertNear(ground.gained, 100.0 + 0.25 * 4, 1e-9, 'CHK-M3-02 陆战胜利 4 支陆军须实收 101 XP');
  assertEq(commander.level, 2, 'CHK-M3-02 101 XP 须触发晋升 Lv2（1×100 阈值）');
  assertEq(commander.xp, 1, 'CHK-M3-02 晋级后余量 1 XP');

  // —— AssignParagonDestinyTrait 命令路径：Lv8 天命固化 ——
  const veteran = { id: 4, name: '百战老兵', level: 8, xp: 0, traits: [], loyalty: 80, health: 'healthy' };
  world.entities.characters[4] = veteran;
  ensureParagonProfile(veteran, world);
  const offers = lv8Offers(veteran);
  assertEq(offers.length, 3, 'CHK-M3-02 Lv8 天命须确定性派生三项');
  assertEq(new Set(offers).size, 3, 'CHK-M3-02 三项天命须互异');
  const env = executeCommand(world, { type: 'AssignParagonDestinyTrait', params: { leaderId: 4, destinyTraitId: offers[0] } });
  assertEq(env.ok, true, `CHK-M3-02 AssignParagonDestinyTrait 信封须 ok:true（实测 ${JSON.stringify(env)}）`);
  assertEq(veteran.paragon.destinyTrait, offers[0], 'CHK-M3-02 天命特质须固化');
  assertEq(veteran.paragon.destinyPending, false, 'CHK-M3-02 天命待决旗标须清除');
  return 'CHK-M3-02 统治者+12/总督+5/竣工+10/陆战+100+0.25×4=101实地入账; upkeep(6,4)=1.5/xp(6,4)=0.7225(eps 1e-9); Lv8天命三选一固化';
}

/* ============================== CHK-M3-03：The Beholder 双形态与城邦导师撤离 ============================== */

function chk0303() {
  const world = makeOperaWorld(2);
  world.playerFactionId = 'fac_player';
  const planet = { id: 9, systemId: 1, name: '方尖碑星' };
  world.entities.planets[9] = planet;
  ensureSpaceOperaState(world);
  const beholder = { id: 9, name: '全视凝视者', level: 9, xp: 0, traits: [], loyalty: 80, health: 'healthy' };
  world.entities.characters[9] = beholder;
  applyLegendaryParagon(world, 9, 'THE_BEHOLDER');

  // —— MURMURING_MONOLITH：矿工岗位全转灵能合唱体，产 energy + unity ——
  const colony = ensureCompactPlanetState(planet, world).colony;
  colony.ownerId = 0; // 已殖民
  colony.strata[2][0] = 10; // Workers 层 10 名矿工
  const netFlow0Before = colony.netFlow[0];
  toggleBeholderMode(world, 9, 'MURMURING_MONOLITH', 9); // 显式锚定行星 9
  assertEq(colony.jobRoles, { miner: 0, telepath: 10 }, 'CHK-M3-03 矿工岗位须全部转化为灵能合唱体');
  assertEq(colony.netFlow[0], netFlow0Before + TELEPATH_ENERGY_PER_POP_MONTH * 10, 'CHK-M3-03 能量通道须 +8.0×10/月');
  assertNear(colony.telepathUnity, TELEPATH_UNITY_PER_POP_MONTH * 10, 1e-9, 'CHK-M3-03 凝聚通道须 +6.0×10/月');
  assertEq(colony.beholderAnchored, true, 'CHK-M3-03 方尖碑扎根旗标须置位');

  // —— 命令路径切回 WARSHIP_COMMANDER：双通道精确回冲 + 火控/穿透旗标 ——
  const env = executeCommand(world, { type: 'ToggleBeholderMode', params: { paragonId: 9, mode: 'WARSHIP_COMMANDER' } });
  assertEq(env.ok, true, `CHK-M3-03 ToggleBeholderMode 信封须 ok:true（实测 ${JSON.stringify(env)}）`);
  assertEq(colony.jobRoles, { miner: 10, telepath: 0 }, 'CHK-M3-03 切回战舰形态须恢复矿工岗位');
  assertEq(colony.netFlow[0], netFlow0Before, 'CHK-M3-03 能量通道须精确回冲');
  assertNear(colony.telepathUnity, 0, 1e-9, 'CHK-M3-03 凝聚通道须精确回冲');
  assertEq(beholder.paragon.fleetControlFlags, { crossSpaceFireControl: true, psychicShieldPenetration: true },
    'CHK-M3-03 跨超空间火控/灵能护盾穿透旗标须置位');

  // —— 攻击中立城邦：Lv5 导师立即离职 + 内阁议程 −20% ——
  assertEq(COUNCIL_AGENDA_PENALTY, 20.0, 'CHK-M3-03 内阁议程惩罚须精确 −20%');
  const mentor = hireEnclaveMentor(world, 'curators');
  assertEq(mentor.level, 5, 'CHK-M3-03 城邦导师须为 Lv5');
  assertEq(mentor.paragon.capExempt, true, 'CHK-M3-03 城邦导师不占领袖容量');
  const res = attackEnclaveConsequence(world, mentor.id);
  assertEq(world.entities.characters[mentor.id], undefined, 'CHK-M3-03 导师须从 world.characters 移除');
  assertNear(res.councilAgendaProgress, 100 - 20, 1e-9, 'CHK-M3-03 内阁议程进度须倒扣 −20%（100 → 80）');
  assertNear(world.spaceOperaState.councilAgendaProgress, 80, 1e-9, 'CHK-M3-03 议程进度须落世界态');
  return 'CHK-M3-03 MONOLITH→矿工全转灵能合唱体(10岗)+energy+8.0×n/月+unity+6.0×n/月; 切回双通道精确回冲+火控/穿透旗标; 城邦导师离职+议程100→80';
}

/* ============================== CHK-M3-04：子空间信标流密度不变量 ============================== */

function chk0304() {
  const world = makeOperaWorld(3);
  ensureSpaceOperaState(world);
  assertEq(countActiveNarrative(world), 0, 'CHK-M3-04 初始信标流为空');
  for (let t = 1; t <= 1000; t++) {
    world.tick = t;
    stepSpaceOperaTick(world); // space-opera 时钟阶段（Medium/Slow 分桶）
    stepBeaconStream(world); // 信标流密度阶段
    const narrative = countActiveNarrative(world);
    assert(narrative >= 15, `CHK-M3-04 tick ${t} 非帝国活跃叙事信标须 ≥15（实测 ${narrative}）`);
  }
  const beacons = listActiveBeacons(world);
  const freqClasses = new Set(beacons.map((b) => b.freqClass));
  assert(freqClasses.size >= 2, `CHK-M3-04 1000 帧后频段覆盖须 ≥2（实测 ${freqClasses.size}）`);
  for (const b of beacons) {
    assert(Number.isFinite(b.expiresTick) && b.expiresTick > b.spawnedTick, `CHK-M3-04 信标 ${b.id} 存续期须合法`);
  }
  return `CHK-M3-04 1000 帧逐帧非帝国叙事信标 ≥15（末帧 ${countActiveNarrative(world)} 个/${beacons.length} 总量, ${freqClasses.size} 频段）`;
}

/* ============================== CHK-M3-05：索林原虫净化与援军动态缩放 ============================== */

function chk0305() {
  // —— (a) 净化法则：devastation 99 抛错 / 100 菌毯清除还原荒芜 ——
  const world = makeOperaWorld(20);
  ensureSpaceOperaState(world);
  const planet = { id: 501, systemId: 'sys_1', name: '感染星' }; // systemId 与星系键同型（infestNextSystem 匹配口径）
  world.entities.planets[501] = planet;
  const compact = ensureCompactPlanetState(planet, world);
  compact.colony.ownerId = 0; // 已殖民（虫群优先感染殖民星系）
  startEndgameCrisis(world, 'PRETHORYN');
  const crisis = world.spaceOperaState.endgameCrisis.active;
  assertEq(crisis.kind, 'PRETHORYN', 'CHK-M3-05 终局天灾须为索林原虫');
  stepEndgameCrisisMonthly(world); // 月占 1 星系（殖民星系优先 → systemId 1）
  assertEq(compact.meta.infested, true, 'CHK-M3-05 月度占领后行星须转为感染星球');
  assertEq(compact.tiles.every((t) => unpackTile(t >>> 0).overlayId === 5), true, 'CHK-M3-05 感染星球须 256 格全铺 overlayId=5 菌毯');

  assertThrows(() => purifyInfestedWorld(planet, 99), '未达 100', 'CHK-M3-05 破坏度 99 不得净化');
  const r = purifyInfestedWorld(planet, 100);
  assertEq(r.ok, true, 'CHK-M3-05 100% 破坏度须净化成功');
  assertEq(r.purifiedTiles, 256, 'CHK-M3-05 净化格数须为 256');
  assertEq(compact.tiles.every((t) => unpackTile(t >>> 0).overlayId === 0), true, 'CHK-M3-05 菌毯（overlayId=5）须全部清除');
  assertEq(compact.tiles.every((t) => unpackTile(t >>> 0).biomeId === 0), true, 'CHK-M3-05 行星须还原为可改造荒芜（biome 0）');
  assertEq(compact.meta.infested, false, 'CHK-M3-05 感染旗标须清除');

  // —— (b) 援军动态缩放：schedule 逐档断言 + 三档实地触发 ——
  assertEq(PRETHORYN_REINFORCE_SCHEDULE.map((s) => s.perYear), [2, 3, 4], 'CHK-M3-05 援军表须为 2/3/4 支每年');
  assertEq(PRETHORYN_REINFORCE_SCHEDULE.map((s) => s.minShare), [0, 0.2, 0.4], 'CHK-M3-05 援军档位阈值须为 0/20%/40%');
  assertEq(prethorynReinforcementsPerYear(0.10), 2, 'CHK-M3-05 占比 10% → 2 支/年');
  assertEq(prethorynReinforcementsPerYear(0.25), 3, 'CHK-M3-05 占比 25% → 3 支/年');
  assertEq(prethorynReinforcementsPerYear(0.45), 4, 'CHK-M3-05 占比 45% → 4 支/年');

  // 实地三档：月度钩子先占 1 星系再结算援军 → 预置 infested 使占后占比恰为 10%/25%/45%
  const TIERS = [[1, 0.10, 2], [4, 0.25, 3], [8, 0.45, 4]];
  for (const [preInfested, wantShare, wantPerYear] of TIERS) {
    const w = makeOperaWorld(20);
    ensureSpaceOperaState(w);
    startEndgameCrisis(w, 'PRETHORYN');
    const c = w.spaceOperaState.endgameCrisis.active;
    c.infestedSystemIds = Array.from({ length: preInfested }, (_, i) => String(i + 1));
    c.reinforceMonths = 11; // 本月步进后累积 12 个月 → due = floor(12×perYear/12) = perYear
    c.reinforcementsSpawned = 0;
    stepEndgameCrisisMonthly(w);
    const share = galaxyShareOf(w, c);
    assertNear(share, wantShare, 1e-12, `CHK-M3-05 预置 ${preInfested} 星系后实地占比须为 ${wantShare}`);
    assertEq(prethorynReinforcementsPerYear(share), wantPerYear, `CHK-M3-05 实地占比 ${wantShare} → ${wantPerYear} 支/年`);
    const evs = w.events.queue.filter((e) => e.type === 'PrethorynSwarmReinforced');
    assertEq(evs.length, wantPerYear, `CHK-M3-05 占比 ${wantShare} 实地年援军须恰 ${wantPerYear} 支`);
  }
  return 'CHK-M3-05 感染→256格菌毯overlay=5; 轰炸99抛错/100→菌毯清除+biome0荒芜+旗标清除; 10%/25%/45%→年援军2/3/4（表断言+三档实地12月累积）';
}

/* ============================== CHK-M3-06：戏剧导演高潮宣泄与 +18 机遇信标爆发 ============================== */

function chk0306() {
  // —— 均衡点常量逐位互证（dramaDirector 本地复制 ↔ jacobianCoupling 权威）——
  assertEq(EQUILIBRIUM_S, SYSTEM_EQUILIBRIUM, 'CHK-M3-06 EQUILIBRIUM_S 须与 jacobian SYSTEM_EQUILIBRIUM 逐位一致');

  // —— G(c) 早期宽限斜坡 ——
  assertEq(graceSlopeG(0), 0.70, 'CHK-M3-06 G(0) 须 0.70');
  assertEq(graceSlopeG(10), 0.70, 'CHK-M3-06 G(10) 须 0.70');
  assertNear(graceSlopeG(11), 0.71, 1e-9, 'CHK-M3-06 G(11) 须 0.70+0.30/30');
  assertNear(graceSlopeG(25), 0.85, 1e-9, 'CHK-M3-06 G(25) 须斜坡中点 0.85');
  assertNear(graceSlopeG(39), 0.99, 1e-9, 'CHK-M3-06 G(39) 须 0.99');
  assertEq(graceSlopeG(40), 1.00, 'CHK-M3-06 G(40) 须 1.00');
  assertEq(graceSlopeG(100), 1.00, 'CHK-M3-06 G(100) 封顶 1.00');

  // —— adaptDays 分段日增速与封顶 ——
  const w1 = makeOperaWorld(1);
  ensureSpaceOperaState(w1);
  const dd1 = w1.spaceOperaState.dramaDirector;
  w1.tick = 240; // 第 10 日（recoveryGraceUntilTick 默认 −1 → 不在宽限期）
  dd1.adaptDays = 59;
  assertEq(stepDramaAdaptationDaily(w1).adaptDays, 60, 'CHK-M3-06 adaptDays 59 → +1.0/天 → 60');
  assertEq(stepDramaAdaptationDaily(w1).adaptDays, 61, 'CHK-M3-06 adaptDays 60 → +1.0/天 → 61');
  assertNear(stepDramaAdaptationDaily(w1).adaptDays, 61.5, 1e-9, 'CHK-M3-06 adaptDays 61 > 60 → +0.5/天 → 61.5');
  dd1.adaptDays = 100;
  assertEq(stepDramaAdaptationDaily(w1).adaptDays, 100, 'CHK-M3-06 adaptDays 100 须封顶');
  dd1.adaptDays = -1;
  assertNear(stepDramaAdaptationDaily(w1).adaptDays, 2, 1e-9, 'CHK-M3-06 adaptDays < 0 → +3.0/天恢复');
  dd1.adaptDays = -50;
  assertNear(stepDramaAdaptationDaily(w1).adaptDays, -47, 1e-9, 'CHK-M3-06 恢复期 −50 → −47');

  // —— 1 Killed 折算 == 5 Downed（扣减量与末态逐位相等）——
  assertEq(KILLED_ADAPT_COST / DOWNED_ADAPT_COST, 5, 'CHK-M3-06 折算比 20/4 须精确 5');
  const wA = makeOperaWorld(1);
  const wB = makeOperaWorld(1);
  ensureSpaceOperaState(wA);
  ensureSpaceOperaState(wB);
  wA.spaceOperaState.dramaDirector.adaptDays = 100;
  wB.spaceOperaState.dramaDirector.adaptDays = 100;
  const killed = reportKilled(wA, 1);
  const downed = reportDowned(wB, 5);
  assertNear(killed.deducted, 20.0, 1e-9, 'CHK-M3-06 1 Killed 须扣 −20.0');
  assertNear(downed.deducted, 20.0, 1e-9, 'CHK-M3-06 5 Downed 须扣 −20.0');
  assertEq(killed.deducted, downed.deducted, 'CHK-M3-06 1 Killed 与 5 Downed 扣减量须逐位相等');
  assertEq(killed.adaptDays, downed.adaptDays, 'CHK-M3-06 末态 adaptDays 须逐位相等（100−20=80）');

  // —— 预算双因子逐项（pop/舰队/建筑/库存 → W_base → W_effective）——
  const w2 = makeOperaWorld(1);
  ensureSpaceOperaState(w2);
  for (const pid of [1, 2]) {
    const tiles = new Array(256).fill(0);
    tiles[0] = packTile({ buildingId: 5 });
    tiles[1] = packTile({ buildingId: 5 });
    w2.entities.planets[pid] = {
      id: pid, systemId: 1,
      compactState: { colony: { ownerId: 0, popTotal: 50, stockpile: [500, 500, 300, 200, 100, 50, 25, 10] }, tiles },
    };
  }
  w2.entities.fleets.flt_a = { id: 'flt_a', shipIds: [1, 2, 3] };
  w2.entities.fleets.flt_b = { id: 'flt_b', shipIds: [4, 5, 6] };
  w2.entities.fleets.flt_dead = { id: 'flt_dead', status: 'dissolved', shipIds: [7, 8] };
  const budget = computeDramaBudget(w2);
  assertEq(budget.popTotal, 100, 'CHK-M3-06 人口合计 100');
  assertEq(budget.shipCount, 6, 'CHK-M3-06 dissolved 舰队不计入舰船数');
  assertEq(budget.buildingTiles, 4, 'CHK-M3-06 buildingId≠0 格数 4');
  assertEq(budget.stockpileValue, 3370, 'CHK-M3-06 库存总值 1685×2=3370');
  assertEq(budget.popAndFleetScore, 100 * 10 + 6 * 40, 'CHK-M3-06 人口/舰队分项 1240');
  assertEq(budget.industrialWealthScore, 4 * 15 + 3370 / 10, 'CHK-M3-06 工业财富分项 397');
  assertNear(budget.wBase, 0.5 * 1240 + 0.5 * 397, 1e-9, 'CHK-M3-06 W_base 50/50 加权 818.5');
  assertNear(budget.wEffective, 818.5 * 0.70 * 1.0, 1e-9, 'CHK-M3-06 W_eff = W_base×G(0)×A = 572.95');
  // 封顶：超巨库存 + adaptDays=100（A=1.35）+ 第 40 周期（G=1.00）→ W_eff 封顶 10000
  w2.entities.planets[3] = {
    id: 3, systemId: 1,
    compactState: { colony: { ownerId: 0, popTotal: 0, stockpile: [5000000] }, tiles: new Array(256).fill(0) },
  };
  w2.spaceOperaState.dramaDirector.adaptDays = 100;
  w2.tick = 40 * 720;
  const capped = computeDramaBudget(w2);
  assertEq(capped.wBase, 10000, 'CHK-M3-06 W_base 硬上限 10000');
  assertEq(capped.wEffective, 10000, 'CHK-M3-06 W_eff = min(10000, 10000×1.00×1.35) 封顶 10000');

  // —— T=78.0 ≥ 75 → 月度收口触发 GRAND_CLIMAX → 结算宣泄 ——
  const w3 = makeOperaWorld(2);
  w3.tick = 500;
  ensureSpaceOperaState(w3);
  const dd3 = w3.spaceOperaState.dramaDirector;
  dd3.tension = 78.0;
  const oppBefore = listActiveBeacons(w3).filter((b) => b.kind === 'OPPORTUNITY').length;
  const step = stepSpaceOperaDramaMonthly(w3);
  assertEq(step.spawnedClimax, true, 'CHK-M3-06 T=78 ≥ 75 月度收口须触发高潮');
  const sit = listActiveSituations(w3).find((s) => s.systemArcId === 'GRAND_CLIMAX');
  assert(!!sit, 'CHK-M3-06 须生成活跃 GRAND_CLIMAX 局势');
  assertEq(sit.meta.tensionTop2.length, 2, 'CHK-M3-06 meta 须记录 tensionTop2 两条弧线');
  assert(Number.isFinite(sit.meta.wEffective), 'CHK-M3-06 meta 须记录 W_effective');
  assertEq(sit.progressMax, 100, 'CHK-M3-06 高潮局势四幕 progressMax=100');
  // 完成结算（progress 推满 → 引擎 climax → 弧钩子 resolveGrandClimax）
  sit.progress = 100;
  stepSituationBucket(w3, sit, 1 / 720);
  assert(sit.resolvedTick != null, 'CHK-M3-06 结算后局势须移入 resolved 历史');
  assertEq(dd3.tension, CATHARSIS_TENSION, 'CHK-M3-06 结算瞬间 T 须精确回落 25.0');
  assertEq(dd3.adaptationFactor, CATHARSIS_ADAPTATION, 'CHK-M3-06 结算瞬间 A 须精确回落 0.75');
  assertEq(dd3.adaptDays, CATHARSIS_ADAPT_DAYS, 'CHK-M3-06 结算瞬间 adaptDays 须 −50.0');
  assertEq(dd3.recoveryGraceUntilTick, w3.tick + RECOVERY_GRACE_TICKS, 'CHK-M3-06 宽限期须 tick+2160');
  assertEq(dd3.climaxCount, 1, 'CHK-M3-06 climaxCount 须 +1');
  assertEq(dd3.lastClimaxTick, w3.tick, 'CHK-M3-06 lastClimaxTick 须记账');
  const oppAfter = listActiveBeacons(w3).filter((b) => b.kind === 'OPPORTUNITY');
  assertEq(oppAfter.length - oppBefore, CATHARSIS_OPPORTUNITY_BEACONS, 'CHK-M3-06 OPPORTUNITY_BEACON 须新增恰 18 个');
  assert(!!w3.events.queue.find((e) => e.type === 'GrandClimaxResolved'), 'CHK-M3-06 须 emit GrandClimaxResolved');
  assert(!!w3.events.queue.find((e) => e.type === 'OpportunityBeaconsInjected'), 'CHK-M3-06 须 emit OpportunityBeaconsInjected');
  assertEq(resolveGrandClimax(w3, sit, 'climax'), null, 'CHK-M3-06 幂等：同一局势重复结算零重复宣泄');

  // —— 宽限期锁 0.75 与期满公式恢复（裁决：0.825 为期外推导值）——
  w3.tick += 24;
  const inGrace = stepDramaAdaptationDaily(w3);
  assertEq(inGrace.graceLocked, true, 'CHK-M3-06 宽限期内须锁 0.75');
  assertEq(inGrace.adaptationFactor, 0.75, 'CHK-M3-06 宽限期内 A 须恒 0.75（adaptDays 已回升至 −47）');
  assertNear(deriveAdaptationFactor(-50, false), 0.825, 1e-9, 'CHK-M3-06 期外公式推导：adaptDays=−50 → A=0.825');
  w3.spaceOperaState.dramaDirector.recoveryGraceUntilTick = w3.tick - 1; // 宽限期结束
  const afterGrace = stepDramaAdaptationDaily(w3);
  assertEq(afterGrace.graceLocked, false, 'CHK-M3-06 宽限期满须恢复公式推导');
  assertNear(afterGrace.adaptationFactor, 1 + 0.0035 * afterGrace.adaptDays, 1e-9, 'CHK-M3-06 期外 A 须回归公式值');
  return 'CHK-M3-06 G(c)斜坡逐点; adaptDays三段增速+100封顶+负段+3.0; 1Killed≡5Downed(−20.0); W_base818.5/W_eff572.95/封顶10000; T=78→GRAND_CLIMAX→结算T=25.0/A=0.75/adaptDays=−50/宽限+2160/OPPORTUNITY+18; 宽限锁0.75期满公式0.825';
}

/* ============================== CHK-M3-07：全生命周期 24,000 Ticks 浸泡与金快照终审 ============================== */

async function chk0307() {
  // —— 微型浸泡：createMinimalWorld + ensure + 数条命令 + advanceTicks 24000 ——
  const world = createMinimalWorld(SEED);
  ensureSpaceOperaState(world);
  const envs = [
    executeCommand(world, { type: 'ConfigureUrbanZone', params: { planetId: 10, zoneSlot: 0, zoneType: 2 } }),
    executeCommand(world, { type: 'ConstructOrbitalFacility', params: { planetId: 10, slotIndex: 1, facilityType: 1 } }),
    executeCommand(world, { type: 'ExcavateSubterraneanLayer', params: { planetId: 10, depthTier: 1 } }),
    executeCommand(world, { type: 'ConfigureFleetDoctrine', params: { empireId: 1, doctrineSize: 60, qualityWeight: 40, officerAggression: 20 } }),
    executeCommand(world, { type: 'RespondSubspaceBeacon', params: { beaconId: 999, responseOptionId: 'rescue_merchant' } }),
    executeCommand(world, { type: 'ManageLeviathanParade', params: { situationId: 999, action: 'ENCOURAGE' } }),
  ];
  for (let i = 0; i < envs.length; i++) {
    assertEq(envs[i].ok, true, `CHK-M3-07 浸泡前置命令 ${i + 1} 信封须 ok:true（实测 ${JSON.stringify(envs[i])}）`);
  }
  // 300 星满载（deepClone 基准对象同时参与浸泡推演）
  for (let i = 1; i <= 300; i++) {
    const planet = { id: i, systemId: 1 };
    world.entities.planets[i] = planet;
    ensureCompactPlanetState(planet, world);
  }
  advanceTicks(world, 24000); // 零未捕获异常由 run() 兜底断言（此行抛错即 FAIL）

  // —— systemVector 无 NaN 污染 ——
  const sv = world.spaceOperaState.systemVector;
  assertEq(sv.length, 7, 'CHK-M3-07 systemVector 须为七维');
  for (let i = 0; i < 7; i++) {
    assert(Number.isFinite(sv[i]), `CHK-M3-07 systemVector[${i}] 出现 NaN/Infinity（实测 ${sv[i]}）`);
    assert(sv[i] >= 0 && sv[i] <= 100, `CHK-M3-07 systemVector[${i}] 越界 [0,100]（实测 ${sv[i]}）`);
  }
  const dd = world.spaceOperaState.dramaDirector;
  for (const key of ['tension', 'adaptationFactor', 'adaptDays', 'climaxCount']) {
    assert(Number.isFinite(dd[key]), `CHK-M3-07 dramaDirector.${key} 出现 NaN/Infinity`);
  }
  assert(world.spaceOperaState.subspaceBeacons.length <= 96, 'CHK-M3-07 信标流总量须受 96 上限护栏约束');

  // —— 300 个 compactPlanetState 深拷贝 median ≤ 250ms ——
  const compactStates = [];
  for (let i = 1; i <= 300; i++) compactStates.push(world.entities.planets[i].compactState);
  assertEq(compactStates.length, 300, 'CHK-M3-07 深拷贝基准须为 300 个 compactPlanetState');
  for (let k = 0; k < 3; k++) deepClone(compactStates); // JIT 预热（冷启动噪声不入样）
  const median = medianMs(() => deepClone(compactStates), 30);
  assert(median <= 250, `CHK-M3-07 300 星深拷贝 median 须 ≤250ms（实测 ${median.toFixed(2)}ms）`);

  // —— 只读投影烟测（零领域写入；SnapshotBuilder/REG-01 金快照零漂移由编排层另行守护）——
  const view = spaceOperaView(world);
  assert(!!view, 'CHK-M3-07 spaceOperaView 须返回投影');
  assertEq(view.systemVector.length, 7, 'CHK-M3-07 投影 systemVector 须七维');
  assert(!!view.drama && Number.isFinite(view.drama.tension), 'CHK-M3-07 投影 drama.tension 须有限');
  return `CHK-M3-07 6命令+300星 advanceTicks 24000 零异常; systemVector 七维无 NaN; 300星深拷贝 median <${median.toFixed(2)}ms ≤250ms; 投影/信标护栏在位（金快照零漂移交 REG-01）`;
}

/* ============================== CHK-M3-08：天灾有机触发与巨兽凯旋大游行实战可达 ============================== */

/** 合成已殖民行星（colony.ownerId = 0 → colonizedSystemShare 命中） */
function seedColonizedPlanet(world, planetId, systemId) {
  const planet = { id: planetId, systemId, name: `殖民星${planetId}` };
  world.entities.planets[planetId] = planet;
  ensureCompactPlanetState(planet, world);
  planet.compactState.colony.ownerId = 0;
  return planet;
}

function chk0308() {
  assertEq(ENDGAME_CRISIS_MIN_MONTH, 120, 'CHK-M3-08 天灾有机触发月龄门槛须精确 120');
  assertEq(ENDGAME_CRISIS_MIN_COLONIZED_SHARE, 0.25, 'CHK-M3-08 殖民占比门槛须精确 0.25');

  // —— (a) 占比门槛：2/20 = 0.1 < 0.25 → 零触发 ——
  const wShare = makeOperaWorld(20);
  wShare.playerFactionId = 'fac_player';
  ensureSpaceOperaState(wShare);
  seedColonizedPlanet(wShare, 1, 'sys_1');
  seedColonizedPlanet(wShare, 2, 'sys_2');
  wShare.tick = 300 * 720;
  assertNear(colonizedSystemShare(wShare), 0.1, 1e-12, 'CHK-M3-08 占比统计须为 2/20');
  const gShare = stepGalacticSenateMonthly(wShare);
  assertEq(gShare.crisisTriggered, false, 'CHK-M3-08 占比不足零触发');
  assertEq(wShare.spaceOperaState.endgameCrisis.active, null, 'CHK-M3-08 不得开启天灾');

  // —— (b) 月龄门槛：8/20 = 0.4 达标但 month 100 < 120 → 零触发 ——
  const wMonth = makeOperaWorld(20);
  wMonth.playerFactionId = 'fac_player';
  ensureSpaceOperaState(wMonth);
  for (let pid = 1; pid <= 8; pid++) seedColonizedPlanet(wMonth, pid, `sys_${pid}`);
  wMonth.tick = 100 * 720;
  const gMonth = stepGalacticSenateMonthly(wMonth);
  assertEq(gMonth.crisisTriggered, false, 'CHK-M3-08 月龄不足零触发');

  // —— (c) 达标后逐月确定性检定：触发月/种类逐位可复现（种子 24601 → 月 122 PRETHORYN）——
  const scanCrisis = (world) => {
    ensureSpaceOperaState(world);
    for (let pid = 1; pid <= 8; pid++) seedColonizedPlanet(world, pid, `sys_${pid}`);
    world.tick = ENDGAME_CRISIS_MIN_MONTH * 720;
    for (let m = 0; m < 240; m++) {
      const s = stepGalacticSenateMonthly(world);
      if (s.crisisTriggered) return { offset: m, kind: s.crisisKind };
      world.tick += 720;
    }
    return { offset: -1, kind: null };
  };
  const w1 = makeOperaWorld(20);
  w1.playerFactionId = 'fac_player';
  const hit1 = scanCrisis(w1);
  assert(hit1.offset >= 0, `CHK-M3-08 达标后 240 月内须确定性触发（实测 offset ${hit1.offset}）`);
  assertEq(hit1.kind, 'PRETHORYN', `CHK-M3-08 种子 24601 首触发种类须为 PRETHORYN（实测 ${hit1.kind}）`);
  assertEq(w1.spaceOperaState.endgameCrisis.active.kind, 'PRETHORYN', 'CHK-M3-08 有机触发须落 endgameCrisis.active');
  assert(w1.events.queue.some((e) => e.type === 'EndgameCrisisStarted'), 'CHK-M3-08 有机触发须 emit EndgameCrisisStarted');
  // 活跃期不再叠加触发
  w1.tick += 720;
  const gActive = stepGalacticSenateMonthly(w1);
  assertEq(gActive.crisisTriggered, false, 'CHK-M3-08 活跃天灾期间不得叠加触发');
  // 双胞胎世界逐位复现
  const w2 = makeOperaWorld(20);
  w2.playerFactionId = 'fac_player';
  const hit2 = scanCrisis(w2);
  assertEq(hit2.offset, hit1.offset, 'CHK-M3-08 双胞胎世界触发月须逐位一致');
  assertEq(hit2.kind, hit1.kind, 'CHK-M3-08 双胞胎世界天灾种类须逐位一致');

  // —— (d) 巨兽击杀结算直连凯旋大游行（reportLeviathanDefeated → onLeviathanDefeated）——
  const w4 = makeOperaWorld(2);
  w4.playerFactionId = 'fac_player';
  ensureSpaceOperaState(w4);
  const levPlanet = seedColonizedPlanet(w4, 601, 'sys_1');
  levPlanet.threat = {
    v: 1, pti: 1000, tier: 4, waveCdTicks: 0, storm: null,
    leviathan: { active: true, archetype: 'lev_magma_colossus', hpPermille: 0, wx: 0, wz: 0, phase: 1, backCoreBroken: 0, toxinSacsBroken: 0, staggerT: 0 },
  };
  const killRes = reportLeviathanDefeated(w4, levPlanet);
  assertEq(killRes.ok, true, 'CHK-M3-08 巨兽讨伐上报须成功');
  const parades = listActiveSituations(w4).filter((s) => s.systemArcId === 'LEVIATHAN_PARADE');
  assertEq(parades.length, 1, 'CHK-M3-08 巨兽击杀结算处须直连开启恰 1 场凯旋大游行');
  assertEq(parades[0].targetEntityId, 601, 'CHK-M3-08 大游行目标须为击杀星系殖民地');
  assertEq(parades[0].meta.systemId, 'sys_1', 'CHK-M3-08 大游行 meta 须记录击杀星系');
  // 幂等：同星系再次击杀不重复开启
  levPlanet.threat.leviathan.active = true;
  reportLeviathanDefeated(w4, levPlanet);
  assertEq(listActiveSituations(w4).filter((s) => s.systemArcId === 'LEVIATHAN_PARADE').length, 1,
    'CHK-M3-08 同星系重复击杀须幂等复用现有大游行局势');
  return `CHK-M3-08 有机触发双门槛(0.1占比/month100)零触发; 达标种子24601→月${ENDGAME_CRISIS_MIN_MONTH * 720 / 720 + hit1.offset}触发${hit1.kind}+双胞胎逐位复现+活跃期不叠加; 击杀直连大游行1场+幂等`;
}

/* ============================== CHK-M3-09：S7 第二幕命令与兰兹拉德宪章表决 ============================== */

function chk0309() {
  assertEq(LANDSRAAD_BILL_KINDS.length, 3, 'CHK-M3-09 宪章法案种类须为 3');
  const w = makeOperaWorld(4);
  w.playerFactionId = 'fac_player';
  w.relations = { diplomacy: {} };
  ensureSpaceOperaState(w);
  w.entities.factions = {
    fac_player: { id: 'fac_player', name: '玩家', isPlayer: true },
    fac_a: { id: 'fac_a', name: '派系甲', isPlayer: false },
    fac_b: { id: 'fac_b', name: '派系乙', isPlayer: false },
  };
  w.entities.characters['chr_b1'] = { id: 'chr_b1', name: '乙首脑', factionId: 'fac_b', level: 3, traits: [], health: 'healthy' };
  credit(w, 'fac_player', 'credits', 50000, 'suiteSeed', null);
  credit(w, 'fac_player', 'intelPoints', 100, 'suiteSeed', null);

  // —— SignCommission：签署 + 重复签署回滚 ——
  const e1 = executeCommand(w, { type: 'SignCommission', params: { factionId: 'fac_a' } });
  assertEq(e1.ok, true, `CHK-M3-09 SignCommission 信封须 ok:true（实测 ${JSON.stringify(e1)}）`);
  assert(w.spaceOperaState.commissions.fac_a && w.spaceOperaState.commissions.fac_a.militaryHullAccess === true,
    'CHK-M3-09 委任状须落 commissions 且解锁军用船体购买权');
  const e1b = executeCommand(w, { type: 'SignCommission', params: { factionId: 'fac_a' } });
  assertEq(e1b.ok, false, 'CHK-M3-09 重复签署须被命令总线回滚');

  // —— CHOAM 股份杠杆：+40 → 分红 ×1.15；+15 → 55 禁运杠杆 ——
  assertEq(executeCommand(w, { type: 'AdjustChoamShares', params: { delta: 40 } }).ok, true, 'CHK-M3-09 AdjustChoamShares 信封须 ok');
  assertEq(choamTradeDividendMult(w), 1.15, 'CHK-M3-09 股份 40 ≥ 30 须激活贸易分红 ×1.15');
  assertEq(hasEmbargoLeverage(w), false, 'CHK-M3-09 股份 40 < 50 不得有禁运杠杆');
  assertEq(executeCommand(w, { type: 'AdjustChoamShares', params: { delta: 15 } }).ok, true, 'CHK-M3-09 追加股份信封须 ok');
  assertEq(hasEmbargoLeverage(w), true, 'CHK-M3-09 股份 55 ≥ 50 须激活禁运杠杆');

  // —— standing 加权表决（MANDATE）：playerWeight 2.0×1.15×1.15=2.645 + fac_a 席位 1.0 ——
  assertEq(executeCommand(w, { type: 'AdjustLandsraadStanding', params: { delta: 100 } }).ok, true, 'CHK-M3-09 AdjustLandsraadStanding 信封须 ok');
  assertEq(executeCommand(w, { type: 'ProposeLandsraadBill', params: { kind: 'CHARTER_MANDATE' } }).ok, true, 'CHK-M3-09 ProposeLandsraadBill 信封须 ok');
  assertEq(getActiveLandsraadBill(w).kind, 'CHARTER_MANDATE', 'CHK-M3-09 提案须落 activeBill');
  const monthly1 = stepGalacticSenateMonthly(w);
  assertEq(monthly1.billSettled, true, 'CHK-M3-09 月末收口须结算宪章法案');
  assertEq(monthly1.billPassed, true, 'CHK-M3-09 standing 100 + 委任状席位须通过 MANDATE');
  assertNear(w.spaceOperaState.landsraad.lastBill.support, 2.0 * 1.15 * 1.15 + 1.0, 1e-9,
    'CHK-M3-09 玩家票权 2.0×分红×禁运杠杆 + 委任状席位 1.0 须逐位命中');
  assertEq(w.spaceOperaState.landsraad.standing, 100, 'CHK-M3-09 MANDATE 通过 +5 须 100 封顶');
  assertEq(w.spaceOperaState.landsraad.activeBill, null, 'CHK-M3-09 表决后 activeBill 须清空');

  // —— SANCTION 通过：制裁最敌对派系（预置 fac_b opinion −50）——
  w.relations.diplomacy[relationKey('fac_player', 'fac_b')] = { key: relationKey('fac_player', 'fac_b'), parties: ['fac_b', 'fac_player'], opinion: -50, trust: 10, grievances: 0, warId: null };
  assertEq(executeCommand(w, { type: 'AdjustLandsraadStanding', params: { delta: -50 } }).ok, true, 'CHK-M3-09 standing 回调信封须 ok');
  assertEq(executeCommand(w, { type: 'ProposeLandsraadBill', params: { kind: 'CHARTER_SANCTION' } }).ok, true, 'CHK-M3-09 SANCTION 提案信封须 ok');
  const monthly2 = stepGalacticSenateMonthly(w);
  assertEq(monthly2.billPassed, true, 'CHK-M3-09 standing 50 + 委任状席位须通过 SANCTION');
  assertEq(w.spaceOperaState.landsraad.lastBill.sanctionTarget, 'fac_b', 'CHK-M3-09 制裁目标须为最敌对派系 fac_b');
  const relB = w.relations.diplomacy[relationKey('fac_player', 'fac_b')];
  assertEq(relB.opinion, -60, 'CHK-M3-09 制裁通过须 opinion −10（−50→−60）');
  assertEq(relB.grievances, 1, 'CHK-M3-09 制裁通过须 grievances +1');

  // —— 否决路径：无委任状/无间谍网 world，month 2 双席位确定性反对（镜像 roll 0.8684/0.7497）
  //    → support 0.2（standing 10 基本票权）< oppose 2.0 → 否决 −2 反弹 ——
  const wVeto = makeOperaWorld(4);
  wVeto.playerFactionId = 'fac_player';
  ensureSpaceOperaState(wVeto);
  wVeto.entities.factions = {
    fac_player: { id: 'fac_player', name: '玩家', isPlayer: true },
    fac_a: { id: 'fac_a', name: '派系甲', isPlayer: false },
    fac_b: { id: 'fac_b', name: '派系乙', isPlayer: false },
  };
  wVeto.tick = 2 * 720; // voteMonth = 2：fac_a/fac_b 均确定性投反对票
  assertEq(executeCommand(wVeto, { type: 'AdjustLandsraadStanding', params: { delta: 10 } }).ok, true, 'CHK-M3-09 否决世界 standing 信封须 ok');
  assertEq(executeCommand(wVeto, { type: 'ProposeLandsraadBill', params: { kind: 'CHARTER_SUBSIDY' } }).ok, true, 'CHK-M3-09 否决世界提案信封须 ok');
  const monthlyVeto = stepGalacticSenateMonthly(wVeto);
  assertEq(monthlyVeto.billSettled, true, 'CHK-M3-09 月末须结算');
  assertEq(monthlyVeto.billPassed, false, 'CHK-M3-09 support 0.2 < oppose 2.0 须否决');
  assertEq(wVeto.spaceOperaState.landsraad.standing, 8, 'CHK-M3-09 否决反弹须 standing −2（10→8）');

  // —— 间谍/刺杀链：间谍翼升级 → 3 层间谍网 → 双面间谍 → 终极刺杀 ——
  const creditsBefore = balance(w, 'fac_player', 'credits');
  assertEq(executeCommand(w, { type: 'UpgradePalaceEspionage' }).ok, true, 'CHK-M3-09 UpgradePalaceEspionage 信封须 ok');
  assertEq(balance(w, 'fac_player', 'credits'), creditsBefore - 8000, 'CHK-M3-09 间谍翼升级须精确扣 8000 信用点');
  for (let i = 0; i < 3; i++) {
    assertEq(executeCommand(w, { type: 'LayerUpSpyNetwork', params: { targetFactionId: 'fac_b' } }).ok, true,
      `CHK-M3-09 间谍网升层 ${i + 1}/3 信封须 ok`);
  }
  assertEq(executeCommand(w, { type: 'PlantDoubleAgent', params: { targetFactionId: 'fac_b' } }).ok, true, 'CHK-M3-09 PlantDoubleAgent 信封须 ok');
  assertEq(spyNetwork(w, 'fac_b'), { layers: 3, doubleAgent: true }, 'CHK-M3-09 间谍网须满 3 层 + 双面间谍');
  assertEq(executeCommand(w, { type: 'Assassinate', params: { targetFactionId: 'fac_b' } }).ok, true, 'CHK-M3-09 Assassinate 信封须 ok');
  assertEq(w.entities.characters['chr_b1'], undefined, 'CHK-M3-09 刺杀须移除目标派系首脑');
  assertEq(spyNetwork(w, 'fac_b'), { layers: 0, doubleAgent: false }, 'CHK-M3-09 刺杀后网络曝光焚毁');

  // —— 城邦导师雇佣/攻击离职 ——
  assertEq(executeCommand(w, { type: 'HireEnclaveMentor', params: { enclaveType: 'curators' } }).ok, true, 'CHK-M3-09 HireEnclaveMentor 信封须 ok');
  const mentor = Object.values(w.entities.characters).find((c) => c.paragon && c.paragon.enclaveMentor === 'curators');
  assert(!!mentor, 'CHK-M3-09 城邦导师须落 characters（Lv5 capExempt）');
  assertEq(mentor.level, 5, 'CHK-M3-09 城邦导师须为 Lv5');
  assertEq(executeCommand(w, { type: 'AttackEnclave', params: { mentorId: mentor.id } }).ok, true, 'CHK-M3-09 AttackEnclave 信封须 ok');
  assertEq(w.entities.characters[mentor.id], undefined, 'CHK-M3-09 攻击城邦须导师离职');
  assertNear(w.spaceOperaState.councilAgendaProgress, 80, 1e-9, 'CHK-M3-09 攻击城邦须内阁议程 −20%（100→80）');
  return 'CHK-M3-09 十命令落账: 委任状+重复回滚/CHOAM 1.15+禁运/宪章 MANDATE+SANCTION 逐位通过/否决-2反弹/刺杀焚网/城邦导师离职-20%议程';
}

/* ============================== CHK-M3-10：群像实战成长钩子（战役/陆战/竣工/考古/传奇） ============================== */

function chk0310() {
  const SALT = DOMAIN_SALTS.PARAGON_DESTINY;
  const SEED = 24601;

  // —— (a) 太空战役结算：双侧指挥官 XP + 全灭旗舰创伤（Tier II SUBSTANCE_ABUSER 镜像）——
  const w = makeOperaWorld(1);
  w.playerFactionId = 'fac_player';
  w.relations = { diplomacy: {} };
  ensureSpaceOperaState(w);
  w.entities.ships = {};
  w.entities.characters['chr_10'] = { id: 'chr_10', name: '指挥官', level: 1, xp: 0, traits: [], health: 'healthy', fleetId: 'flt_1' };
  w.entities.fleets['flt_1'] = { id: 'flt_1', commanderId: 'chr_10', status: 'engaged', factionId: 'fac_player', shipIds: ['shp_1'] };
  w.entities.fleets['flt_2'] = { id: 'flt_2', commanderId: null, status: 'engaged', factionId: 'fac_enemy', shipIds: [] };
  w.entities.ships['shp_1'] = { id: 'shp_1', hullId: 'hammerhead', status: 'active' }; // ShipSize 10
  const battle = {
    id: 'bt_1', systemId: 'sys_1', startedTick: 0, status: 'active',
    sides: { a: 'fac_player', b: 'fac_enemy' }, fleetIds: { a: 'flt_1', b: 'flt_2' },
    units: [
      { shipId: 'shp_1', side: 'a', destroyed: true, order: 'engage' },
      { shipId: 'shp_2', side: 'b', destroyed: false, order: 'retreat' },
      { shipId: 'shp_3', side: 'b', destroyed: true, order: 'engage' },
    ],
    losses: { a: 1, b: 2 }, events: [],
  };
  finishBattle(w, battle, 'a');
  const c10 = w.entities.characters['chr_10'];
  assertNear(c10.xp, 5.0 + 0.05 * 10 * 2 + 0.025 * 10 * 1, 1e-9,
    'CHK-M3-10 太空战役 XP 须为 5 + 0.05×10×2击毁 + 0.025×10×1迫退 = 6.25');
  assertEq(c10.paragon.trauma.length, 1, 'CHK-M3-10 本侧全灭 1/1 须触发旗舰被毁创伤检定（key10 r0=0.0455<Tier II 阈 0.30）');
  assertEq(c10.paragon.trauma[0].traitId, 'SUBSTANCE_ABUSER', 'CHK-M3-10 key10 @tick0 旗舰创伤须抽中 SUBSTANCE_ABUSER');
  assertEq(c10.paragon.trauma[0].tier, 2, 'CHK-M3-10 r0 < 0.30 须为 Tier II');
  assert(c10.traits.includes('SUBSTANCE_ABUSER'), 'CHK-M3-10 创伤特质须追加 leader.traits');

  // —— (b) 陆战结算：+100 + 0.25×4 歼灭 + 惨败挚友阵亡创伤 ——
  const w2 = makeOperaWorld(1);
  w2.playerFactionId = 'fac_player';
  w2.relations = { diplomacy: {} };
  ensureSpaceOperaState(w2);
  w2.entities.characters['chr_11'] = { id: 'chr_11', name: '陆战队长', level: 1, xp: 0, traits: [], health: 'healthy' };
  const mission = {
    id: 'gm_1', templateId: '__suite__', planetId: null, status: 'active', rewardPaid: false,
    storyTag: null, log: [], idSeq: 0,
    playerUnits: [{ characterId: 'chr_11', state: 'alive' }, { characterId: 'chr_12', state: 'dead' }],
    stats: { kills: 4 }, objectives: [], time: 5, results: null,
  };
  finishMission(w2, mission, 'failed', 'squads_lost');
  const g11 = w2.entities.characters['chr_11'];
  assertNear(g11.xp, 1, 1e-9,
    'CHK-M3-10 陆战 101 XP（100 + 0.25×4）入账后跨 Lv2 阈值须余 1 XP');
  assertEq(g11.level, 2, 'CHK-M3-10 101 XP 须晋升 Lv2');
  assertEq(g11.paragon.trauma.length, 1, 'CHK-M3-10 任务失败 + 1 伤亡须触发挚友阵亡创伤检定（key11 r0=0.1316<Tier II 阈）');
  assertEq(g11.paragon.trauma[0].traitId, ['MELANCHOLIC', 'SUBSTANCE_ABUSER'][deriveSeed(SEED, SALT, 11, 1) % 2],
    'CHK-M3-10 key11 @tick0 挚友阵亡创伤须与镜像抽样逐位一致');

  // —— (c) 竣工 XP：tickColonyConstruction 完工 → 辖区总督 +10 ——
  const w3 = makeOperaWorld(1);
  w3.playerFactionId = 'fac_player';
  w3.relations = { diplomacy: {} };
  ensureSpaceOperaState(w3);
  w3.entities.factions = { fac_player: { id: 'fac_player', name: '玩家', isPlayer: true } };
  w3.entities.characters['chr_gov'] = { id: 'chr_gov', name: '辖区总督', level: 1, xp: 0, traits: [], health: 'healthy' };
  const govPlanet = { id: 'plt_50', systemId: 'sys_1', name: '辖区星' };
  w3.entities.planets['plt_50'] = govPlanet;
  govPlanet.soc = { overseerId: 'chr_gov' };
  const colony = {
    id: 'col_1', planetId: 'plt_50', factionId: 'fac_player',
    buildings: [{ defId: 'bld_x', level: 1, state: 'construction', progress: 0 }],
    constructionQueue: [{ defId: 'bld_x', state: 'building', progress: 999, buildingIndex: 0 }],
  };
  w3.entities.colonies = { col_1: colony };
  tickColonyConstruction(w3, colony);
  assertEq(colony.buildings[0].state, 'active', 'CHK-M3-10 完工建筑须转 active');
  assertNear(w3.entities.characters['chr_gov'].xp, BUILD_COMPLETION_XP, 1e-9, 'CHK-M3-10 竣工 1 座须辖区总督 +10 XP');
  assert(w3.events.queue.some((e) => e.type === 'BuildingCompleted'), 'CHK-M3-10 完工须 emit BuildingCompleted');

  // —— (d) 考古晋幕 XP + 高危灾难创伤（startArchaeologyDig 挂接首席科学家）——
  const w4 = makeOperaWorld(1);
  w4.playerFactionId = 'fac_player';
  w4.relations = { diplomacy: {} };
  ensureSpaceOperaState(w4);
  w4.entities.characters['chr_sci'] = { id: 'chr_sci', name: '首席科学家', level: 1, xp: 0, traits: [], health: 'healthy', role: 'science' };
  w4.entities.planets['plt_60'] = { id: 'plt_60', systemId: 'sys_1', name: '考古星' };
  const sit = startArchaeologyDig(w4, 'plt_60', 'OVERDRIVE', null, 'chr_sci');
  assertEq(sit.meta.scientistId, 'chr_sci', 'CHK-M3-10 考古局势须挂接首席科学家');
  sit.progress = 250; // 幕界 [0,250]/[251,650]：一步 +65（OVERDRIVE）跨入第 2 幕
  stepSituationBucket(w4, sit, 1); // onStep 观察幕 1 → 推进至 315（幕 2）
  stepSituationBucket(w4, sit, 1); // onStep 观察幕 2 > 游标 1 → 晋幕入账
  const sciXp = w4.entities.characters['chr_sci'].xp;
  assert(sciXp >= 25 && sciXp <= 120, `CHK-M3-10 晋幕科学家 XP 须 ∈ [25,120]（实测 ${sciXp.toFixed(2)}）`);
  assertEq(sit.meta.lastActStage, 2, 'CHK-M3-10 晋幕游标须推进至第 2 幕');
  // 高危灾难（OVERDRIVE danger 权重 ×5）：钉住第 1 幕逐月采样至命中 → traumaCheck
  let sawDanger = false;
  for (let m = 0; m < 24 && !sawDanger; m++) {
    w4.tick += 720;
    sit.progress = 200; // 钉在第 1 幕：隔离晋幕 XP，专注月度事件采样
    stepSituationBucket(w4, sit, 1);
    sawDanger = ((sit.meta.dangerEvents | 0) >= 1);
  }
  assert(sawDanger, 'CHK-M3-10 OVERDRIVE 24 月内须确定性采样到高危灾难事件');
  const sci = w4.entities.characters['chr_sci'];
  assert(sci.paragon.trauma.length >= 1, 'CHK-M3-10 高危灾难须对首席科学家执行考古惨剧创伤检定');
  assert(sci.paragon.trauma.some((t) => ['MELANCHOLIC', 'DESTRUCTIVE'].includes(t.traitId)),
    'CHK-M3-10 考古惨剧创伤池须为 MELANCHOLIC/DESTRUCTIVE');

  // —— (e) 传奇群像确定性抵达（TUBOREK 月龄 60 → THE_BEHOLDER 月龄 128）+ 幂等不复活 ——
  const w5 = makeOperaWorld(2);
  w5.playerFactionId = 'fac_player';
  ensureSpaceOperaState(w5);
  w5.tick = LEGENDARY_ARRIVAL_MIN_MONTH.TUBOREK * 720;
  let firstArrival = null;
  for (let m = 0; m < 600 && !firstArrival; m++) {
    const s = stepLegendaryParagonRecruitment(w5);
    if (s.arrived) firstArrival = s.arrived;
    else w5.tick += 720;
  }
  assertEq(firstArrival, 'TUBOREK', 'CHK-M3-10 月龄 60 门槛后首位抵达须为 TUBOREK（THE_BEHOLDER 门槛 120 未到）');
  const tuborek = w5.entities.characters[w5.spaceOperaState.legendaryParagons.TUBOREK.leaderId];
  assertEq(tuborek.paragon.paragonId, 'TUBOREK', 'CHK-M3-10 传奇授任须落 paragonId');
  assertEq(tuborek.paragon.capExempt, true, 'CHK-M3-10 传奇不占领袖容量');
  assertEq(tuborek.paragon.buildSpeedBonus, 1.0, 'CHK-M3-10 TUBOREK 须携带建设加速 1.0');
  w5.tick = Math.max(w5.tick, LEGENDARY_ARRIVAL_MIN_MONTH.THE_BEHOLDER * 720);
  let secondArrival = null;
  for (let m = 0; m < 600 && !secondArrival; m++) {
    const s = stepLegendaryParagonRecruitment(w5);
    if (s.arrived) secondArrival = s.arrived;
    else w5.tick += 720;
  }
  assertEq(secondArrival, 'THE_BEHOLDER', 'CHK-M3-10 月龄 120 门槛后须抵达 THE_BEHOLDER');
  const beholder = w5.entities.characters[w5.spaceOperaState.legendaryParagons.THE_BEHOLDER.leaderId];
  assertEq(beholder.paragon.dualMode, true, 'CHK-M3-10 THE_BEHOLDER 须携带双形态旗标');
  assertEq(Object.keys(w5.spaceOperaState.legendaryParagons).length, 2, 'CHK-M3-10 抵达记录须恰 2 条');
  w5.tick += 12 * 720;
  for (let m = 0; m < 12; m++) {
    const s = stepLegendaryParagonRecruitment(w5);
    assertEq(s.arrived, null, 'CHK-M3-10 传奇一次性抵达后不得复活');
  }
  // —— (f) 总督政治免职创伤（AppointOverseer 换任路径；镜像确定性 roll 双分支）——
  const w6 = makeOperaWorld(1);
  w6.playerFactionId = 'fac_player';
  w6.relations = { diplomacy: {} };
  ensureSpaceOperaState(w6);
  w6.entities.factions = { fac_player: { id: 'fac_player', name: '玩家', isPlayer: true } };
  w6.entities.characters['chr_old'] = { id: 'chr_old', name: '旧总督', level: 2, xp: 0, traits: [], health: 'healthy' };
  w6.entities.characters['chr_new'] = { id: 'chr_new', name: '新总督', level: 1, xp: 0, traits: [], health: 'healthy' };
  w6.entities.planets['plt_70'] = { id: 'plt_70', systemId: 'sys_1', name: '免职星' };
  assertEq(executeCommand(w6, { type: 'AppointOverseer', params: { planetId: 'plt_70', characterId: 'chr_old' } }).ok, true,
    'CHK-M3-10 初任总督信封须 ok');
  const rDismissal = sampleFloat01(SEED, SALT, numericEntityKey('chr_old'), 0);
  assertEq(executeCommand(w6, { type: 'AppointOverseer', params: { planetId: 'plt_70', characterId: 'chr_new' } }).ok, true,
    'CHK-M3-10 换任信封须 ok');
  const dismissed = w6.entities.characters['chr_old'];
  const poolDismissal = ['LAVISH_LIFESTYLE', 'CORRUPT', 'MELANCHOLIC'];
  if (rDismissal < 0.65) {
    assertEq(dismissed.paragon.trauma.length, 1, 'CHK-M3-10 政治免职创伤须挂载（镜像 roll 命中）');
    assertEq(dismissed.paragon.trauma[0].traitId, poolDismissal[deriveSeed(SEED, SALT, numericEntityKey('chr_old'), 1) % 3],
      'CHK-M3-10 政治免职创伤特质须与镜像抽样逐位一致');
  } else {
    assertEq(dismissed.paragon.trauma.length, 0, 'CHK-M3-10 免职检定免检（镜像 roll ≥ 0.65）不得挂创伤');
  }
  return `CHK-M3-10 战役XP6.25+旗舰创伤T2/陆战101+晋升Lv2+挚友创伤/竣工总督+10/考古晋幕+灾难创伤/免职创伤(镜像r=${rDismissal.toFixed(3)})/传奇 TUBOREK@${LEGENDARY_ARRIVAL_MIN_MONTH.TUBOREK}+BEHOLDER@${LEGENDARY_ARRIVAL_MIN_MONTH.THE_BEHOLDER} 错峰抵达+幂等`;
}

/* ============================== 套件门面 ============================== */

export const suite = {
  id: 'SPACE-OPERA-M3',
  name: '太空歌剧 M3 反孤独生态/S7天灾/自适应戏剧导演门禁（GATE-17-M3）',
  group: 'space-opera',
  async run() {
    const t0 = performance.now();
    try {
      // 同步 import 后立即跑时钟/月度收口的调用方必须先等动态钩子注入完成
      // （situationEngine stepSituation + paragons leaderTick + dramaDirector 月末收口链）
      await ensureClockHooksInjected();
      await ensureLeaderHookInjected();
      await ensureDramaMonthlyRegistered();
      const parts = [];
      parts.push(chk0301());
      parts.push(chk0302());
      parts.push(chk0303());
      parts.push(chk0304());
      parts.push(chk0305());
      parts.push(chk0306());
      parts.push(await chk0307());
      parts.push(chk0308());
      parts.push(chk0309());
      parts.push(chk0310());
      return { ok: true, detail: `${parts.join('; ')}; 耗时<${(performance.now() - t0).toFixed(1)}ms` };
    } catch (e) {
      return { ok: false, detail: String((e && e.stack) || e) };
    }
  },
};
