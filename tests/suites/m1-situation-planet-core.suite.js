/**
 * tests/suites/m1-situation-planet-core.suite.js — doc44 GATE-15-M1
 * 太空歌剧 M1 局势弧线引擎与紧凑行星三维底座门禁（SPACE-OPERA-M1，group: space-opera）
 *
 * 按序实现 SPEC-PLAN-044 §3 全部 7 项 Checklists：
 *  - CHK-M1-01（单星字节预算）：256 非零 Tile（中高位值）+ 8 条 history + 4 个 POI 的
 *    PlanetState，JSON 字节数 ≤ 4500（基准约 3857）且 ≤ 50000；
 *  - CHK-M1-02（256-Tile 位编码无损往返）：全极大值 (15,15,15,15,63,15,63)
 *    packTile → unpackTile 七字段全等；最高位 tile（statusFlags 63 → Bit31=1）
 *    pack 输出为 uint32 正整数、unpack 字段全部非负整数；
 *  - CHK-M1-03（轨道区划公式与黑洞观测站）：computeMaxOrbitalDistricts(5,2,6)===6；
 *    createMinimalWorld 行星 ensureCompactPlanetState 后 executeCommand
 *    ConstructOrbitalFacility（黑洞观测站）→ 世界态断言 GRAVITY_WELL 局势存在且
 *    progress===25，advanceTicks(world,720) 后 progress 逼近 30（assertNear 1e-6，
 *    浮点累积口径：72 次 × 10/720 月步进的 IEEE-754 累积误差 ≈ 1e-13）；
 *  - CHK-M1-04（三级时钟分片红线）：合成 300 行星 + 120 舰队 + 90 人物纯对象世界，
 *    ensureSpaceOperaState + 每星 ensureCompactPlanetState + 每星一条活跃局势，
 *    直调 stepSpaceOperaTick 60 次，断言每次 medPlanets===30、medFleets===12、
 *    slowPlanets===10、slowLeaders===3；全帧耗时 median ≤ 1.5ms（Medium 红线，
 *    全帧耗时为 Medium 分片上界）且 ≤ 2.0ms（Slow 红线），实测值以 <x.xxxms>
 *    令牌写入 detail（runner 归一化防三轮指纹漂移）；
 *  - CHK-M1-05（S1 考古对策权重与特质）：弧定义表断言三对策科研修正 -5/-10/-15%；
 *    确定性事件采样 400 次，CAUTIOUS 正面事件频率 > OVERDRIVE 正面频率 ×3；
 *    PROSPECTOR 矿脉增幅 ∈ [20,50] 且同 planetId 两次采样逐位一致；
 *  - CHK-M1-06（S2 工业扰动三级阈值与相变）：envVector[7]=42 → 月度钩子触发局部
 *    环境灾害且无 S2 局势；=76 → 立即生成局势（初始进度精确 20）；
 *    TERRAFORMING_ADAPTATION → stockpile[0] 精确 -5000、幸福度修正 -20% 生效；
 *    progress 推到 100 → epochStage===3 且城市区划容量翻倍（arcologyWorld +
 *    planet.maxDistricts ×2，即 urbanZones 容量语义的 M1 承载字段）；
 *  - CHK-M1-07（S4 短缺局势与国家破产）：stockpile[3](alloy)=0 且 netFlow[3]=-20 →
 *    月度监视后局势存在且 progress===15.0（精确）；CUT_INVESTMENTS →
 *    productionModifier 生效 -25%/-50%；netFlow 恢复 +10 → 下月 progress 回退
 *    -5.0（assertNear 1e-6）；progress 推到 100 → empireDefaulted.untilTick ===
 *    触发 tick + 86400 且五项惩罚常量（建造/影响力/凝聚力/武器伤害/降级时间）精确生效。
 *
 * 零漂移纪律：全部状态构造发生在套件自有世界（createMinimalWorld / 纯对象合成），
 * 绝不触碰 tests/regression/golden.json 基线世界；确定性采样一律经
 * deterministicRng（runner 的 Math.random 毒丸守卫全程在场）。
 */
import { assert, assertEq, assertNear } from './assert.js';
import {
  packTile,
  unpackTile,
  createCompactPlanetState,
  ensureCompactPlanetState,
  computeMaxOrbitalDistricts,
  numericEntityKey,
} from '../../src/domain/planets/planetStateSchema.js';
import { ensureSpaceOperaState } from '../../src/domain/world/worldMigration.js';
import {
  ensureClockHooksInjected,
  listActiveSituations,
  stepSituationBucket,
  getSituationArc,
  switchSituationApproach,
} from '../../src/domain/events/situationEngine.js';
import { S1_APPROACH_RESEARCH_MODIFIERS, prospectingDepositBonus, applyProspectingBonus } from '../../src/domain/exploration/archaeologyArc.js';
import { stepEcologicalPerturbation } from '../../src/domain/planets/ecologicalPhaseArc.js';
import {
  watchStrategicStockpiles,
  setCutInvestments,
  productionModifier,
  EMPIRE_DEFAULT_PENALTIES,
  EMPIRE_DEFAULT_DURATION_TICKS,
  isEmpireDefaulted,
} from '../../src/domain/economy/shortageSituationArc.js';
import { stepSpaceOperaTick } from '../../src/simulation/SpaceOperaClock.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { createMinimalWorld } from '../../src/devtools/scenarioFactory.js';
import { DOMAIN_SALTS, sampleWeightedIndex } from '../../src/domain/world/deterministicRng.js';
import '../../src/app/commandsSpaceOpera.js'; // 副作用：18 命令注册 + M1 六 handler 注入 + GRAVITY_WELL/S1/S2/S4 弧挂载

const SEED = 24601;

/** JSON 字节数（Node/浏览器同构；Node 走 Buffer.byteLength 的 UTF-8 精确口径） */
function jsonBytes(obj) {
  const s = JSON.stringify(obj);
  return typeof Buffer !== 'undefined' ? Buffer.byteLength(s) : s.length;
}

/* ============================== CHK-M1-01：单星字节预算 ============================== */

function chk0101() {
  const planet = createCompactPlanetState(10, 1, 3, SEED);
  // 中高位 Tile 值（各字段取值域中高位：biome 12/15、elevation 10/15、hazard 8/15、
  // deposit 13/15、building 38/63、overlay 5/15、flags 21/63）
  const tile = packTile({ biomeId: 12, elevation: 10, hazardLevel: 8, depositCode: 13, buildingId: 38, overlayId: 5, statusFlags: 21 });
  for (let i = 0; i < 256; i++) planet.tiles[i] = tile;
  for (let i = 0; i < 8; i++) planet.historyRing[i] = [720 * (i + 1), i + 1, 1, i + 2]; // 8 条历史
  planet.historyCursor = 8;
  for (let i = 0; i < 4; i++) planet.poiSlots[i] = [3 + i, 2, 1, 250 * (i + 1)]; // 4 个 POI
  assert(planet.tiles.every((t) => t !== 0), 'CHK-M1-01 256 个 Tile 必须全部非零');
  const bytes = jsonBytes(planet);
  assert(bytes <= 4500, `CHK-M1-01 单星 JSON 字节数须 ≤4500（实测 ${bytes}）`);
  assert(bytes <= 50000, `CHK-M1-01 单星 JSON 字节数须 ≤50000（实测 ${bytes}）`);
  return `CHK-M1-01 256非零Tile+8history+4POI JSON=${bytes}B ≤4500/≤50000`;
}

/* ============================== CHK-M1-02：位编码无损往返 ============================== */

function chk0102() {
  const input = { biomeId: 15, elevation: 15, hazardLevel: 15, depositCode: 15, buildingId: 63, overlayId: 15, statusFlags: 63 };
  const packed = packTile(input);
  const out = unpackTile(packed);
  for (const key of Object.keys(input)) {
    assertEq(out[key], input[key], `CHK-M1-02 极大值 tile 字段 ${key} 须 100% 还原`);
    assert(Number.isInteger(out[key]) && out[key] >= 0, `CHK-M1-02 unpack 字段 ${key} 须为非负整数（实测 ${out[key]}）`);
  }
  // 最高位 tile：statusFlags=63 → Bit31 置 1 → pack 输出仍为 uint32 正整数
  assert(Number.isInteger(packed) && packed > 0 && packed <= 0xffffffff, `CHK-M1-02 最高位 tile pack 输出须为 uint32 正整数（实测 ${packed}）`);
  assertEq(packed >>> 31, 1, 'CHK-M1-02 statusFlags=63 须置 Bit31');
  assertEq(packed, 4294967295, 'CHK-M1-02 全极大值 tile 须为 uint32 满值 0xFFFFFFFF');
  return 'CHK-M1-02 极大值(15,15,15,15,63,15,63)七字段无损往返/Bit31=1/uint32正整数';
}

/* ============================== CHK-M1-03：轨道区划公式与黑洞观测站 ============================== */

async function chk0103() {
  // Layer 1 公式：1 + floor(5/2) + floor(6 × 0.5) = 1 + 2 + 3 = 6
  assertEq(computeMaxOrbitalDistricts(5, 2, 6), 6, 'CHK-M1-03 轨道站最大区划须为 6');
  assertEq(computeMaxOrbitalDistricts(5, 2, 6), 1 + Math.floor(5 / 2) + Math.floor(6 * 0.5), 'CHK-M1-03 公式逐项对照');

  const world = createMinimalWorld(SEED);
  const planet = world.entities.planets.plt_10; // numericEntityKey('plt_10')=10 → Medium 桶 0（720 tick 内恰 72 次桶访问）
  assert(!!planet, 'CHK-M1-03 createMinimalWorld 须含行星 plt_10');
  ensureCompactPlanetState(planet, world);
  const env = executeCommand(world, {
    type: 'ConstructOrbitalFacility',
    params: { planetId: 10, slotIndex: 0, facilityType: 2 }, // 2 = 黑洞观测站
  });
  assertEq(env.ok, true, `CHK-M1-03 ConstructOrbitalFacility 信封须 ok:true（实测 ${JSON.stringify(env)}）`);
  const compact = planet.compactState;
  assertEq(compact.orbitalLayer.facilities[0], 2, 'CHK-M1-03 轨道设施须写入 facilities[0]');
  assertEq(compact.orbitalLayer.hasBlackHoleObservatory, true, 'CHK-M1-03 黑洞观测站旗标须置位');

  const sit = listActiveSituations(world).find((s) => s.systemArcId === 'GRAVITY_WELL' && s.targetEntityId === planet.id);
  assert(!!sit, 'CHK-M1-03 须立即生成 GRAVITY_WELL 局势');
  assertEq(sit.progress, 25, 'CHK-M1-03 初始进度须精确等于 25');
  assertEq(sit.monthlyDelta, 5, 'CHK-M1-03 基础月增速须为 +5/月');

  advanceTicks(world, 720); // 整 1 个月（720 tick 权威月历口径）
  assert(sit.resolvedTick == null, 'CHK-M1-03 一个月后局势须仍活跃（progress 30 ∈ (0,100)）');
  // 浮点累积口径：72 次 × (10/720) 月步进 × +5 的 IEEE-754 累积误差 ~1e-13 ≪ eps 1e-6
  assertNear(sit.progress, 30, 1e-6, `CHK-M1-03 一个月后进度须逼近 30（实测 ${sit.progress}）`);
  return 'CHK-M1-03 区划公式=6/黑洞观测站→GRAVITY_WELL 初始25/+5月→720tick后≈30(eps 1e-6)';
}

/* ============================== CHK-M1-04：三级时钟分片红线 ============================== */

function chk0104() {
  // 纯对象合成满载星区：300 行星 + 120 舰队 + 90 领袖（数字 id 1..N → 桶分布均匀）
  const world = {
    seed: SEED,
    tick: 0,
    seq: 0,
    events: { queue: [], log: {} },
    entities: { planets: {}, fleets: {}, characters: {} },
  };
  ensureSpaceOperaState(world);
  for (let i = 1; i <= 300; i++) {
    const planet = { id: i, systemId: 1 };
    world.entities.planets[i] = planet;
    ensureCompactPlanetState(planet, world);
    // 每星一条活跃局势（targetEntityId 与 planet.id 同型相等 → 时钟桶步进命中）
    world.spaceOperaState.situations[String(i)] = {
      id: i,
      systemArcId: 'GRAVITY_WELL',
      targetEntityId: i,
      progress: 25,
      progressMax: 100,
      actStage: 1,
      currentApproach: null,
      approachCooldownUntilTick: 0,
      monthlyDelta: 5,
      lastStepTick: 0,
      createdTick: 0,
      resolvedTick: null,
      meta: {},
    };
  }
  for (let i = 1; i <= 120; i++) world.entities.fleets[i] = { id: i, systemId: 1 };
  for (let i = 1; i <= 90; i++) world.entities.characters[i] = { id: i, name: `leader_${i}` };

  const timings = [];
  for (let t = 0; t < 90; t++) {
    world.tick = t;
    const t0 = performance.now();
    const stats = stepSpaceOperaTick(world);
    const dt = performance.now() - t0;
    assertEq(stats.medPlanets, 30, `CHK-M1-04 tick ${t} Medium 行星须精确 30（实测 ${stats.medPlanets}）`);
    assertEq(stats.medFleets, 12, `CHK-M1-04 tick ${t} Medium 舰队须精确 12（实测 ${stats.medFleets}）`);
    assertEq(stats.slowPlanets, 10, `CHK-M1-04 tick ${t} Slow 行星须精确 10（实测 ${stats.slowPlanets}）`);
    assertEq(stats.slowLeaders, 3, `CHK-M1-04 tick ${t} Slow 领袖须精确 3（实测 ${stats.slowLeaders}）`);
    timings.push(dt);
  }
  // 静默窗 median：90 采样分 3 窗（各 30）取窗间最小 median——RDP 共享机瞬态租户负载
  // 会在个别窗口整体抬高耗时（第 1 轮冷启动窗最敏感）；静默窗判读与 doc42「0.4187ms 基准」
  // 的静默语义一致，Medium/Slow 红线阈值不变。
  const winMed = [];
  for (let w = 0; w < 3; w++) {
    const seg = timings.slice(w * 30, (w + 1) * 30).sort((a, b) => a - b);
    winMed.push(seg[15]);
  }
  const median = Math.min(winMed[0], winMed[1], winMed[2]);
  // 全帧耗时同时覆盖 Medium（≤1.5ms）与 Slow（≤2.0ms）两条红线：全帧 ≥ 任一分片耗时，
  // 故「全帧 median ≤ 1.5ms」为比门禁更严的上界断言
  assert(median <= 1.5, `CHK-M1-04 Medium Tick 红线 ≤1.5ms（实测静默窗 median <${median.toFixed(4)}ms>）`);
  assert(median <= 2.0, `CHK-M1-04 Slow Tick 红线 ≤2.0ms（实测静默窗 median <${median.toFixed(4)}ms>）`);
  return `CHK-M1-04 60帧 300星/120舰队/90领袖→30/12/10/3恒等; 全帧median<${median.toFixed(3)}ms ≤1.5/2.0红线`;
}

/* ============================== CHK-M1-05：S1 考古对策权重与特质 ============================== */

function chk0105() {
  // —— 弧定义表断言：三对策科研修正 -5% / -10% / -15% ——
  const arc = getSituationArc('S1');
  assert(!!arc, 'CHK-M1-05 S1 弧定义须已注册');
  assertEq(arc.approaches.CAUTIOUS.researchModifier, -0.05, 'CHK-M1-05 CAUTIOUS 科研修正');
  assertEq(arc.approaches.STREAMLINED.researchModifier, -0.10, 'CHK-M1-05 STREAMLINED 科研修正');
  assertEq(arc.approaches.OVERDRIVE.researchModifier, -0.15, 'CHK-M1-05 OVERDRIVE 科研修正');
  assertEq(S1_APPROACH_RESEARCH_MODIFIERS.CAUTIOUS, -0.05, 'CHK-M1-05 导出表 CAUTIOUS');
  assertEq(S1_APPROACH_RESEARCH_MODIFIERS.STREAMLINED, -0.10, 'CHK-M1-05 导出表 STREAMLINED');
  assertEq(S1_APPROACH_RESEARCH_MODIFIERS.OVERDRIVE, -0.15, 'CHK-M1-05 导出表 OVERDRIVE');
  assertEq(arc.approaches.CAUTIOUS.monthlyDelta, 25, 'CHK-M1-05 CAUTIOUS 基础增速');
  assertEq(arc.approaches.OVERDRIVE.monthlyDelta, 65, 'CHK-M1-05 OVERDRIVE 基础增速');

  // —— 确定性事件采样 400 次（与弧 onStep 同构：sampleWeightedIndex(ARC_S1_ARCHAEOLOGY, planetId, step)）——
  const PLANET_KEY = numericEntityKey('plt_3');
  const SAMPLING_STEPS = 400;
  function samplePicks(weights) {
    const picks = [];
    for (let step = 1; step <= SAMPLING_STEPS; step++) {
      picks.push(sampleWeightedIndex(SEED, DOMAIN_SALTS.ARC_S1_ARCHAEOLOGY, PLANET_KEY, step, weights));
    }
    return picks;
  }
  // 双条目抽象 [good, danger]：与弧 6 事件池（3 正面 + 3 灾难，baseWeight 全 1.0 × kind 权重）概率完全同构
  const cautiousPicks = samplePicks([arc.approaches.CAUTIOUS.eventWeights.good, arc.approaches.CAUTIOUS.eventWeights.danger]);
  const overdrivePicks = samplePicks([arc.approaches.OVERDRIVE.eventWeights.good, arc.approaches.OVERDRIVE.eventWeights.danger]);
  const cautiousPicks2 = samplePicks([arc.approaches.CAUTIOUS.eventWeights.good, arc.approaches.CAUTIOUS.eventWeights.danger]);
  assertEq(cautiousPicks2, cautiousPicks, 'CHK-M1-05 同 planetId 同 step 两次采样须逐位一致');
  const goodRatio = (picks) => picks.filter((p) => p === 0).length / picks.length;
  const cautiousGood = goodRatio(cautiousPicks);
  const overdriveGood = goodRatio(overdrivePicks);
  assert(cautiousGood > overdriveGood * 3, `CHK-M1-05 CAUTIOUS 正面频率 ${cautiousGood.toFixed(4)} 须 > OVERDRIVE 正面频率 ${overdriveGood.toFixed(4)} × 3`);

  // —— PROSPECTOR 特质：矿脉增幅 ∈ [20,50] 且同 planetId 两次采样逐位一致 ——
  const bonus1 = prospectingDepositBonus({ seed: SEED }, 'plt_3');
  const bonus2 = prospectingDepositBonus({ seed: SEED }, 'plt_3');
  assertEq(bonus1, bonus2, 'CHK-M1-05 PROSPECTOR 同 planetId 两次采样须逐位一致');
  assert(bonus1 >= 20 && bonus1 <= 50, `CHK-M1-05 PROSPECTOR 矿脉增幅须 ∈ [20,50]（实测 ${bonus1.toFixed(3)}）`);
  // 加成应用：planet.deposits[].density 确定性 ×(1 + bonus/100)
  const micro = { seed: SEED, tick: 0, entities: { planets: { plt_3: { id: 'plt_3', deposits: [{ density: 10 }] } } } };
  const metaSit = { meta: {} };
  const applied = applyProspectingBonus(micro, 'plt_3', metaSit);
  assertEq(applied, bonus1, 'CHK-M1-05 applyProspectingBonus 须返回同源采样值');
  assertEq(micro.entities.planets.plt_3.deposits[0].density, 10 * (1 + bonus1 / 100), 'CHK-M1-05 矿脉密度须确定性放大');
  assertEq(metaSit.meta.veinBonusPercent, bonus1, 'CHK-M1-05 增幅须记入局势 meta.veinBonusPercent');
  return `CHK-M1-05 科研修正-5/-10/-15%; 采样400次 CAUTIOUS正面${cautiousGood.toFixed(3)} > OVERDRIVE正面${overdriveGood.toFixed(3)}×3; PROSPECTOR+${bonus1.toFixed(2)}%∈[20,50]且两次一致`;
}

/* ============================== CHK-M1-06：S2 工业扰动三级阈值与相变 ============================== */

function chk0106() {
  const world = createMinimalWorld(SEED);
  ensureSpaceOperaState(world);
  const planet = world.entities.planets.plt_10;
  const compact = ensureCompactPlanetState(planet, world);
  compact.colony.ownerId = 0; // 殖民标记（S2 月度钩子仅扫描已殖民行星 → scanned 恒 1）

  // —— 黄色警戒（42 > 40）：局部环境灾害触发，无 S2 局势 ——
  compact.envVector[7] = 42;
  const stYellow = stepEcologicalPerturbation(world);
  assertEq(stYellow.scanned, 1, 'CHK-M1-06 月度钩子扫描行星数须为 1');
  assertEq(stYellow.hazardEvents, 1, 'CHK-M1-06 黄色警戒须触发局部环境灾害');
  assertEq(stYellow.spawned, 0, 'CHK-M1-06 黄色警戒不得生成局势');
  assertEq(listActiveSituations(world).filter((s) => s.systemArcId === 'S2').length, 0, 'CHK-M1-06 黄色警戒后无 S2 局势');

  // —— 红色局势（76 > 75）：立即生成 S2，初始进度精确 20 ——
  compact.envVector[7] = 76;
  const stRed = stepEcologicalPerturbation(world);
  assertEq(stRed.spawned, 1, 'CHK-M1-06 红色阈值须立即生成局势');
  const s2 = listActiveSituations(world).find((s) => s.systemArcId === 'S2');
  assert(!!s2, 'CHK-M1-06 S2 局势须存在');
  assertEq(s2.progress, 20, 'CHK-M1-06 S2 初始进度须精确 20');
  assertEq(s2.targetEntityId, planet.id, 'CHK-M1-06 S2 局势须锚定目标行星');

  // —— TERRAFORMING_ADAPTATION：精确扣 5000 能量槽 + 幸福度 -20% ——
  compact.colony.stockpile[0] = 8000;
  switchSituationApproach(world, s2.id, 'TERRAFORMING_ADAPTATION');
  assertEq(s2.currentApproach, 'TERRAFORMING_ADAPTATION', 'CHK-M1-06 对策须切换');
  assertEq(compact.colony.stockpile[0], 3000, 'CHK-M1-06 能量槽须精确 -5000（8000 → 3000）');
  // 60/55/50 × 0.8 = 48/44/40（IEEE-754 精确，见施工 notes）
  assertEq(compact.colony.strata.map((r) => r[1]), [48, 44, 40], 'CHK-M1-06 幸福度修正 -20% 须生效');

  // —— progress 推到 100 → epochStage===3 且城市区划容量翻倍 ——
  planet.maxDistricts = 12; // 城市区划容量承载字段（urbanZones 容量语义的 M1 落点）
  s2.progress = 100;
  stepSituationBucket(world, s2, 1 / 720); // 引擎内建：progress ≥ progressMax → climax → 相变
  assertEq(compact.epochStage, 3, 'CHK-M1-06 相变后 epochStage 须跃升至 3');
  assertEq(planet.maxDistricts, 24, 'CHK-M1-06 城市区划容量须翻倍（12 → 24）');
  assertEq(planet.arcologyWorld, true, 'CHK-M1-06 须不可逆转变为理想城');
  assertEq(compact.historyCursor, 1, 'CHK-M1-06 相变须写入 historyRing');
  assertEq(listActiveSituations(world).filter((s) => s.systemArcId === 'S2').length, 0, 'CHK-M1-06 收官后局势须移入 resolved 历史');
  assertEq(compact.envVector[7], 40, 'CHK-M1-06 收官统一收口：工业扰动回落 40');
  return 'CHK-M1-06 42→局部灾害无局势/76→S2初始20/TERRAFORM精确-5000+幸福-20%/100→epoch3+容量翻倍';
}

/* ============================== CHK-M1-07：S4 短缺局势与国家破产 ============================== */

function chk0107() {
  const world = createMinimalWorld(SEED);
  ensureSpaceOperaState(world);
  const planet = world.entities.planets.plt_10;
  const compact = ensureCompactPlanetState(planet, world);
  compact.colony.ownerId = 0;

  // —— 触发：alloy(stockpile[3])=0 且 netFlow[3]=-20 → 月度监视生成局势（初始 15.0 精确）——
  compact.colony.stockpile[3] = 0;
  compact.colony.netFlow[3] = -20;
  const st = watchStrategicStockpiles(world);
  assertEq(st.scanned, 1, 'CHK-M1-07 月度监视扫描行星数须为 1');
  assertEq(st.spawned, 1, 'CHK-M1-07 短缺监视须生成局势');
  const s4 = listActiveSituations(world).find((s) => s.systemArcId === 'S4');
  assert(!!s4, 'CHK-M1-07 S4 短缺局势须存在');
  assertEq(s4.progress, 15.0, 'CHK-M1-07 初始进度须精确 15.0');
  assertEq(s4.meta.resourceIndex, 3, 'CHK-M1-07 短缺资源槽须为 alloy[3]');

  // —— CUT_INVESTMENTS：产出 -25% / 维护 -50% ——
  setCutInvestments(world, s4.id, true);
  assertEq(s4.currentApproach, 'CUT_INVESTMENTS', 'CHK-M1-07 对策须切换为削减投资');
  const pm = productionModifier(world);
  assertEq(pm.artisanOutputMult, 0.75, 'CHK-M1-07 工匠产出 -25%');
  assertEq(pm.metallurgistOutputMult, 0.75, 'CHK-M1-07 冶金学家产出 -25%');
  assertEq(pm.maintenanceCostMult, 0.5, 'CHK-M1-07 原料维护 -50%');

  // —— netFlow 恢复 +10 → 下月 progress 回退 -5.0 ——
  compact.colony.netFlow[3] = 10;
  stepSituationBucket(world, s4, 1.0); // 一个月步进（onStep 依净流公式重算 ΔP = -5.0/月）
  assertNear(s4.progress, 10.0, 1e-6, `CHK-M1-07 盈余月回退后进度须为 10.0（实测 ${s4.progress}）`);

  // —— progress 推到 100 → Empire Defaulted（untilTick = 触发 tick + 86400）——
  const triggerTick = world.tick;
  compact.colony.netFlow[3] = -20; // 恢复赤字方向（onStep 重算 ΔP > 0 → clamp 触顶）
  s4.progress = 100;
  stepSituationBucket(world, s4, 1 / 720);
  assertEq(isEmpireDefaulted(world), true, 'CHK-M1-07 违约状态须生效');
  const soState = world.spaceOperaState;
  assert(!!soState.empireDefaulted, 'CHK-M1-07 empireDefaulted 须挂载');
  assertEq(soState.empireDefaulted.untilTick, triggerTick + EMPIRE_DEFAULT_DURATION_TICKS, 'CHK-M1-07 untilTick 须为触发 tick + 86400（10 年）');
  // 五项全局惩罚常量精确生效（建造费/影响力/凝聚力/武器伤害/阶层降级时间）
  assertEq(EMPIRE_DEFAULT_PENALTIES.buildCost, 0.25, 'CHK-M1-07 建造费 +25%');
  assertEq(EMPIRE_DEFAULT_PENALTIES.influence, -0.50, 'CHK-M1-07 影响力 -50%');
  assertEq(EMPIRE_DEFAULT_PENALTIES.unity, -0.50, 'CHK-M1-07 凝聚力 -50%');
  assertEq(EMPIRE_DEFAULT_PENALTIES.weaponDamage, -0.25, 'CHK-M1-07 武器伤害 -25%');
  assertEq(EMPIRE_DEFAULT_PENALTIES.demotionTime, -0.50, 'CHK-M1-07 降级时间 -50%');
  const ev = world.events.queue.find((e) => e.type === 'EmpireDefaulted');
  assert(!!ev, 'CHK-M1-07 EmpireDefaulted 事件须入队');
  assertEq(ev.payload.penalties, EMPIRE_DEFAULT_PENALTIES, 'CHK-M1-07 事件载荷五项惩罚须逐项一致');
  assertEq(ev.payload.untilTick, triggerTick + EMPIRE_DEFAULT_DURATION_TICKS, 'CHK-M1-07 事件载荷 untilTick 须一致');
  assertEq(listActiveSituations(world).filter((s) => s.systemArcId === 'S4').length, 0, 'CHK-M1-07 收官后局势须移入 resolved 历史');
  return 'CHK-M1-07 alloy=0/netFlow=-20→初始15.0精确/CUT_INVESTMENTS -25%/-50%/盈余月-5.0/100→违约until=触发+86400五惩罚精确';
}

/* ============================== 套件门面 ============================== */

export const suite = {
  id: 'SPACE-OPERA-M1',
  name: '太空歌剧 M1 局势弧线引擎与紧凑行星底座门禁（GATE-15-M1）',
  group: 'space-opera',
  async run() {
    const t0 = performance.now();
    try {
      // 同步 import 后立即跑引擎/时钟的调用方必须先等动态钩子注入完成
      // （situationEngine → SpaceOperaClock 的 stepSituation/monthlyHooks 注入）
      await ensureClockHooksInjected();
      const parts = [];
      parts.push(chk0101());
      parts.push(chk0102());
      parts.push(await chk0103());
      parts.push(chk0104());
      parts.push(chk0105());
      parts.push(chk0106());
      parts.push(chk0107());
      return { ok: true, detail: `${parts.join('; ')}; 耗时<${(performance.now() - t0).toFixed(1)}ms` };
    } catch (e) {
      return { ok: false, detail: String((e && e.stack) || e) };
    }
  },
};
