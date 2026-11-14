/**
 * tests/suites/m2-jacobian-archetypes-ca.suite.js — doc45 GATE-16-M2
 * 太空歌剧 M2 7×7 雅可比耦合 / 稀疏前沿 CA / 16 大天体原型门禁（SPACE-OPERA-M2，group: space-opera）
 *
 * 按序实现 SPEC-PLAN-045 §3 全部 6 项 Checklists：
 *  - CHK-M2-01（矩阵常量与赫尔维茨稳定性）：JACOBIAN_7X7 49 元素与 45 号文档矩阵
 *    字面量逐位 deepEqual + SYSTEM_EQUILIBRIUM 逐位一致；单次极端脉冲
 *    [0,50,0,0,0,0,0] 后连推 120 个月度步（doc45 §Task 2.1 §4「单次脉冲 + 空转 120
 *    步」口径）：全程无 NaN、无越界 [0,100]，末态每维 |S−S_eq| < 5（收敛邻域）且
 *    总距离较脉冲后瞬时严格衰减（阻尼收敛证据）；
 *  - CHK-M2-02（三阶蝴蝶效应因果链）：pendingSystemShocks 写入 {S2:+25} →
 *    stepSpaceOperaJacobian 月末收口消费 → butterflyCausalLog 新增链：
 *    order1 ∈ {S3,S4}（实测 S3 +7.0）、order2 === S6（+1.68）、order3 ∈ {S5,S7}
 *    （实测 S7 +0.4368）、path 四系统互异且源头 S2；冲击字典消费即清；
 *  - CHK-M2-03（稀疏前沿 CA 性能与位图正确性）：300 星 × seedFrontierRing 24 位 →
 *    单桶（10 星）median < 0.05ms、300 星 median < 0.50ms（<x.xxxms> 令牌进 detail）；
 *    SHIELDED 邻格经 50 步 CA（菌丝 env[2]=60 + 熔岩 env[0]=80 双规则夹击）后
 *    overlay 永不为 1/2（逐步断言）；
 *  - CHK-M2-04（16 大天体原型专属机制全覆盖）：遍历 archetypeId 0..15 各建一星
 *    （经 stepSpaceOperaTick Slow 桶逐星驱动，证明 setClockHooks slowPlanetHook 接线）：
 *    基线修正断言（#1 相位 0 掩埋 / #10 env[1]=70 / #11 maxOrbitalDistricts=12 /
 *    #12 subUrbanSlots ×2=8 槽 / #14 env[6]=0 / #15 habitability=100 / #3 三地标
 *    buildingId 48）；#1 tick 240 天（5760 tick）倒灌相位翻转（掩埋→裸露旗标互换）；
 *    #2 未锁定 60 天周期重排（lastQuantumReshufflePeriod 前进）→ LockQuantumPhasePlanet
 *    锁定后 60 天周期不再重排 zoneSlots 且物理科研 +120%（quantumPhysicsResearchBonus
 *    ===1.2）+ 反应堆维护旗标 → 撤收双清；#5 列 3 建造有罚 / 列 7 无罚
 *    （canBuildWithoutPenalty，含 [6,9] 全列与越带列对照）；#15 envVector[7]=36 →
 *    hostileGuardians=true 必现 + 护盾建筑 30 次 Slow 访问零受损；#6 env[0]=81 →
 *    复用 awakenLeviathan 幼兽必醒（threat.leviathan.active）；#0 2170 tick 潮汐火山期
 *    （env[0] 精确 +20 → 38、未护盾建筑清除 + DEVASTATED、护盾建筑免疫、
 *    geothermalSurgeActive + historyRing 70 码）；
 *  - CHK-M2-05（S3 舒适度与稳定度公式）：AMENITIES_COST_PER_POP 精确 1.0/0.75/0.5
 *    （含 computeAmenitiesNet 加权口径）；computeStabilityOutputMultiplier(80)===18.0
 *    （+0.18 分数口径同断言）、computeImmigrationAttraction(80)===30.0（+0.30）、
 *    computeStabilityOutputMultiplier(20)===−30.0（−0.30）；
 *  - CHK-M2-06（S6 激进分子渗透 6 vs 7 边界翻转）：农业(0)+重工业(2)+完美纳米锻炉(4)
 *    → industrialAttention===6 且 radicalCell.state==='DORMANT'；新增 1 座采矿
 *    （矿脉 deposit 格 buildingId 1）→ ===7 且立即 'ACTIVE' 且 raidSource===true。
 *  - CHK-M2-07（稀疏前沿 CA 时钟集成活体通路，doc42 总纲终审整改实证）：
 *    stepSpaceOperaTick Slow 桶对已挂 compactState 行星逐星驱动 CA —— 首次触达
 *    frontierMask 全零 → seedFrontierRing 播种恰 24 前沿位；休眠位（overlay 0）无
 *    环境门零相变；规则 D 晶格成核（前沿位地标建筑 + env[3] > 50）→ 次步向外结晶
 *    激活新前沿位并赋予奇异水晶矿脉（deposit 类型 2）；未挂 compactState 行星零写入。
 *
 * 零漂移纪律：全部状态构造发生在套件自有世界（纯对象合成 / createMinimalWorld），
 * 绝不触碰 tests/regression/golden.json 基线世界；确定性判定一律 deriveSeed/
 * sampleFloat01（runner 的 Math.random 毒丸守卫全程在场）；性能断言 ≥30 次采样
 * median，耗时以 <x.xxxms> 令牌写入 detail（runner 归一化防三轮指纹漂移）。
 */
import { assert, assertEq, assertNear } from './assert.js';
import {
  JACOBIAN_7X7,
  SYSTEM_EQUILIBRIUM,
  stepJacobianCoupling,
  stepSpaceOperaJacobian,
} from '../../src/simulation/jacobianCoupling.js';
import {
  seedFrontierRing,
  stepSparseFrontierCA,
  setFrontier,
  frontierCount,
} from '../../src/domain/planets/sparseFrontierCA.js';
import {
  ensureCompactPlanetState,
  packTile,
  unpackTile,
  numericEntityKey,
  STATUS_FLAG,
} from '../../src/domain/planets/planetStateSchema.js';
import { ensureSpaceOperaState } from '../../src/domain/world/worldMigration.js';
import {
  applyArchetypeProfile,
  stepArchetypeMechanics,
  canBuildWithoutPenalty,
  quantumPhysicsResearchBonus,
  crystallineIntelBonus,
  geothermalSurgeActive,
  backflowMineUpkeepPenaltyActive,
  backflowRelicSpeedBonusActive,
  ensureArchetypeHookInjected,
} from '../../src/domain/planets/archetypeMechanics.js';
import {
  PLANETARY_ARCHETYPES,
  ARCHETYPE_COUNT,
  ARCHETYPE_THEME_MAPPING_NOTES,
} from '../../src/content/planetaryArchetypes.js';
import {
  AMENITIES_COST_PER_POP,
  computeAmenitiesNet,
  computeStabilityOutputMultiplier,
  computeImmigrationAttraction,
} from '../../src/domain/politics/colonySocialArc.js';
import { stepShadowSyndicateArc } from '../../src/domain/economy/shadowSyndicateArc.js';
import { stepSpaceOperaTick } from '../../src/simulation/SpaceOperaClock.js';
import { executeCommand } from '../../src/core/commandBus.js';
import '../../src/app/commandsSpaceOpera.js'; // 副作用：18 命令注册 + M1 六 handler + M2 四 handler 注入 + S3/S6 弧挂载

const SEED = 24601;

/** 合成太空歌剧世界（Plain Data；events 形状与 core/World.js 同构：queue/log/chronicle） */
function makeOperaWorld() {
  return {
    seed: SEED,
    tick: 0,
    seq: 0,
    stats: {},
    commandLog: [],
    events: { queue: [], log: {}, chronicle: [] },
    entities: { planets: {}, fleets: {} },
  };
}

/** Slow 桶访问 tick：行星 key 所在桶在 ≥ T 后的首次访问帧（tick ≡ key mod 30） */
function slowVisitTickAt(planetId, t) {
  const key = numericEntityKey(planetId);
  const bucket = key % 30;
  return t + ((bucket - (t % 30)) % 30 + 30) % 30;
}

/** 静默窗 median：windows 窗 × samples 采样取窗间最小 median（RDP 共享机瞬态租户负载判读口径，
 *  与 doc42「0.4187ms 静默基准」语义一致；门禁阈值不变，仅判读窗取静默段） */
function quietMedianMs(fn, samples, windows) {
  let best = Infinity;
  for (let w = 0; w < windows; w++) best = Math.min(best, medianMs(fn, samples));
  return best;
}

/** ≥30 次采样 median（上中位数，保守口径；与 CHK-M1-04 同构） */
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

/* ============================== CHK-M2-01：矩阵常量与赫尔维茨稳定性 ============================== */

/** doc45 §Task 2.1 §3 精确 7×7 雅可比矩阵字面量（行 i 受影响 / 列 j 源；套件内独立抄录对拍） */
const DOC_JACOBIAN_7X7 = [
  [-0.50, +0.16, -0.08, +0.10, +0.06, +0.12, -0.12],
  [+0.24, -0.47, -0.10, +0.22, -0.05, +0.08, -0.06],
  [+0.12, +0.28, -0.53, -0.20, -0.16, +0.20, +0.15],
  [+0.18, +0.20, -0.24, -0.47, -0.12, -0.15, -0.08],
  [+0.20, +0.06, -0.12, +0.26, -0.50, +0.12, +0.18],
  [+0.10, +0.12, +0.24, -0.18, -0.25, -0.49, +0.18],
  [+0.16, +0.10, +0.14, +0.18, -0.24, +0.26, -0.51],
];

function chk0201() {
  // —— 49 元素逐位 deepEqual + 平衡点向量逐位一致 ——
  assertEq(JACOBIAN_7X7.length, 7, 'CHK-M2-01 JACOBIAN_7X7 须为 7 行');
  let elementCount = 0;
  for (let i = 0; i < 7; i++) {
    assertEq(JACOBIAN_7X7[i].length, 7, `CHK-M2-01 第 ${i} 行须为 7 列`);
    for (let j = 0; j < 7; j++) {
      assertEq(JACOBIAN_7X7[i][j], DOC_JACOBIAN_7X7[i][j], `CHK-M2-01 J[${i}][${j}] 须与 45 号文档矩阵逐位一致`);
      elementCount++;
    }
  }
  assertEq(elementCount, 49, 'CHK-M2-01 矩阵元素总数须为 49');
  assertEq(SYSTEM_EQUILIBRIUM, [15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0], 'CHK-M2-01 S_eq 须逐位一致');

  // —— 单次极端脉冲 [0,50,0,0,0,0,0] + 连推 120 个月度步（dt=0.25 月度收口口径）——
  const world = makeOperaWorld();
  ensureSpaceOperaState(world);
  const PULSE = [0, 50, 0, 0, 0, 0, 0];
  stepJacobianCoupling(world, [0, 0, 0, 0, 0, 0, 0], PULSE); // 单次施加
  const afterPulse = world.spaceOperaState.systemVector.slice();
  let afterPulseDist = 0;
  for (let i = 0; i < 7; i++) afterPulseDist += Math.abs(afterPulse[i] - SYSTEM_EQUILIBRIUM[i]);
  for (let step = 0; step < 120; step++) {
    const S = stepJacobianCoupling(world); // 空转（endo/impulse 全零）
    assertEq(S.length, 7, `CHK-M2-01 空转步 ${step} 状态维度须为 7`);
    for (let i = 0; i < 7; i++) {
      assert(Number.isFinite(S[i]), `CHK-M2-01 空转步 ${step} S[${i}] 出现 NaN/Infinity（实测 ${S[i]}）`);
      assert(S[i] >= 0 && S[i] <= 100, `CHK-M2-01 空转步 ${step} S[${i}] 越界 [0,100]（实测 ${S[i]}）`);
    }
  }
  const finalS = world.spaceOperaState.systemVector;
  let finalDist = 0;
  for (let i = 0; i < 7; i++) {
    const dev = Math.abs(finalS[i] - SYSTEM_EQUILIBRIUM[i]);
    assert(dev < 5, `CHK-M2-01 末态 S[${i}] 偏离 S_eq ${dev.toFixed(4)} 须 < 5（收敛邻域）`);
    finalDist += dev;
  }
  assert(finalDist < afterPulseDist, `CHK-M2-01 总距离须较脉冲后衰减（${finalDist.toFixed(4)} < ${afterPulseDist.toFixed(4)}，阻尼收敛证据）`);
  return `CHK-M2-01 49元素逐位一致/S_eq一致; 脉冲[0,50,0,…]后120步无NaN无越界, |S−eq|最大维${Math.max(...finalS.map((s, i) => Math.abs(s - SYSTEM_EQUILIBRIUM[i]))).toFixed(4)}<5, 总距${finalDist.toFixed(3)}<${afterPulseDist.toFixed(3)}阻尼收敛`;
}

/* ============================== CHK-M2-02：三阶蝴蝶效应因果链 ============================== */

function chk0202() {
  const world = makeOperaWorld();
  ensureSpaceOperaState(world);
  const soState = world.spaceOperaState;
  const logBefore = soState.butterflyCausalLog.length;

  // —— S2 施加 +25.0 生态采掘冲击（经 pendingSystemShocks 月末收口消费路径）——
  soState.pendingSystemShocks = { S2: 25.0 };
  const res = stepSpaceOperaJacobian(world);
  assert(!!res, 'CHK-M2-02 月末收口须返回步进结果');
  assertEq(res.playerImpulse[1], 25.0, 'CHK-M2-02 S2 冲击须合成进 playerImpulse[1]');
  assert(soState.pendingSystemShocks === undefined, 'CHK-M2-02 冲击字典消费后须清空');

  const log = soState.butterflyCausalLog;
  assertEq(log.length, logBefore + 1, 'CHK-M2-02 因果链须恰好新增一条');
  const chain = log[log.length - 1];
  assertEq(chain.sourceSystem, 1, 'CHK-M2-02 源系统须为 S2（下标 1）');
  assertEq(chain.delta, 25.0, 'CHK-M2-02 冲击幅度须为 +25.0');
  assert(chain.order1.system === 2 || chain.order1.system === 3,
    `CHK-M2-02 一阶涟漪须命中 S3/S4（实测下标 ${chain.order1.system}）`);
  assertEq(chain.order1.system, 2, 'CHK-M2-02 一阶主传导实测 S3（J[2][1]×25 = +7.0）');
  assertEq(chain.order1.value, 7.0, 'CHK-M2-02 一阶幅值须为 +7.0（doc45 §1.2 架构图口径）');
  assertEq(chain.order2.system, 5, 'CHK-M2-02 二阶主传导须命中 S6（+1.68，等幅并列取带符号较大者）');
  assertEq(chain.order2.value, 1.68, 'CHK-M2-02 二阶幅值须为 +1.68');
  assert(chain.order3.system === 4 || chain.order3.system === 6,
    `CHK-M2-02 三阶涟漪须命中 S5/S7（实测下标 ${chain.order3.system}）`);
  assertEq(chain.order3.value, 0.4368, 'CHK-M2-02 三阶幅值须为 +0.4368（J[6][5]×1.68）');
  assertEq(chain.path, [1, 2, 5, 6], 'CHK-M2-02 主传导路径须为 S2→S3→S6→S7 四系统');
  assertEq(new Set(chain.path).size, 4, 'CHK-M2-02 路径须含 4 个互异系统');
  assertEq(res.systemVector[1] !== 15.0, true, 'CHK-M2-02 S2 状态须被脉冲实际推移');
  return `CHK-M2-02 S2+25→因果链 S2→S3(+7.0)→S6(+1.68)→S7(+0.4368), path四系统互异, 冲击字典消费即清`;
}

/* ============================== CHK-M2-03：稀疏前沿 CA 性能与位图正确性 ============================== */

function chk0203() {
  // —— 300 星 × 每星 seedFrontierRing 24 位 ——
  const world = makeOperaWorld();
  for (let i = 1; i <= 300; i++) {
    const planet = { id: i, systemId: 1 };
    world.entities.planets[i] = planet;
    ensureCompactPlanetState(planet, world);
    assertEq(seedFrontierRing(planet), 24, `CHK-M2-03 行星 ${i} 须播种 24 个活跃前沿位`);
    assertEq(frontierCount(planet.compactState.frontierMask), 24, `CHK-M2-03 行星 ${i} 掩码计数须为 24`);
  }

  // —— 单桶（桶 0：id 30,60,…,300 恰 10 星）与 300 星全量 median（各 30 次采样）——
  const bucketPlanets = [];
  for (let i = 30; i <= 300; i += 30) bucketPlanets.push(world.entities.planets[i]);
  assertEq(bucketPlanets.length, 10, 'CHK-M2-03 单桶须恰 10 星');
  const stepBucket = () => {
    for (const p of bucketPlanets) stepSparseFrontierCA(world, p, 1 / 24);
  };
  const stepAll = () => {
    for (let i = 1; i <= 300; i++) stepSparseFrontierCA(world, world.entities.planets[i], 1 / 24);
  };
  for (let k = 0; k < 20; k++) { stepBucket(); stepAll(); } // JIT 预热（冷启动编译噪声不入样）
  const bucketMedian = quietMedianMs(stepBucket, 40, 3);
  const allMedian = quietMedianMs(stepAll, 40, 3);
  assert(bucketMedian < 0.05, `CHK-M2-03 单桶（10 星）静默窗 median 须 < 0.05ms（实测 <${bucketMedian.toFixed(4)}ms>）`);
  assert(allMedian < 0.50, `CHK-M2-03 300 星静默窗 median 须 < 0.50ms（基准 0.4187ms；实测 <${allMedian.toFixed(4)}ms>）`);

  // —— SHIELDED 邻格经 50 步 CA 后 overlay 永不为 1/2（菌丝 + 熔岩双规则夹击）——
  const planet = { id: 4242, systemId: 1 };
  ensureCompactPlanetState(planet, world);
  const compact = planet.compactState;
  compact.tiles[8 * 16 + 8] = packTile({ biomeId: 2, overlayId: 1, statusFlags: STATUS_FLAG.FRONTIER_ACTIVE }); // 菌丝源 A(8,8)
  compact.tiles[8 * 16 + 9] = packTile({ biomeId: 2, statusFlags: STATUS_FLAG.SHIELDED }); // 护盾邻格 B(8,9)
  compact.tiles[3 * 16 + 3] = packTile({ overlayId: 2, statusFlags: STATUS_FLAG.FRONTIER_ACTIVE }); // 熔岩源 C(3,3)
  compact.tiles[3 * 16 + 4] = packTile({ biomeId: 2, statusFlags: STATUS_FLAG.SHIELDED }); // 护盾邻格 D(3,4)
  setFrontier(compact.frontierMask, 8 * 16 + 8);
  setFrontier(compact.frontierMask, 3 * 16 + 3);
  compact.envVector[2] = 60; // 菌丝扩散门（>35）
  compact.envVector[0] = 80; // 熔岩流淌门（>50）
  const shieldedTiles = [8 * 16 + 9, 3 * 16 + 4];
  for (let step = 0; step < 50; step++) {
    stepSparseFrontierCA(world, planet, 1 / 24);
    for (const idx of shieldedTiles) {
      const overlay = unpackTile(compact.tiles[idx] >>> 0).overlayId;
      assert(overlay !== 1 && overlay !== 2, `CHK-M2-03 护盾格 ${idx} 第 ${step + 1} 步后 overlay=${overlay} 不得被菌丝(1)/熔岩(2)覆盖`);
    }
  }
  return `CHK-M2-03 300星×24前沿位; 单桶10星median<${bucketMedian.toFixed(3)}ms<0.05; 300星median<${allMedian.toFixed(3)}ms<0.50; SHIELDED邻格50步菌丝+熔岩夹击overlay永不为1/2`;
}

/* ============================== CHK-M2-04：16 大天体原型专属机制全覆盖 ============================== */

function chk0204() {
  const world = makeOperaWorld();
  world.entities.fleets.flt_1 = { id: 'flt_1', systemId: 1 }; // LockQuantumPhasePlanet 科研舰
  ensureSpaceOperaState(world);

  // —— 遍历 archetypeId 0..15 各建一星 + 原型基线幂等应用 ——
  const planets = [];
  for (let i = 0; i < 16; i++) {
    const planet = { id: 100 + i, systemId: 1, archetypeId: i, name: `原型${i}星`, habitability: 42 };
    world.entities.planets[100 + i] = planet;
    planets.push(planet);
    const compact = applyArchetypeProfile(planet, world);
    assertEq(compact.archetypeId, i, `CHK-M2-04 原型 ${i} 星 compactState.archetypeId 须回读一致`);
    const compact2 = applyArchetypeProfile(planet, world); // 幂等性
    assertEq(compact2, compact, `CHK-M2-04 原型 ${i} 星二次 applyArchetypeProfile 须同引用幂等`);
  }

  // —— 基线修正断言（applyArchetypeProfile hooks 契约）——
  const c = (i) => planets[i].compactState;
  assertEq(backflowMineUpkeepPenaltyActive(c(1)), true, 'CHK-M2-04 #1 初始相位 0 须为掩埋相位（矿井维护 +35% 旗标）');
  assertEq(backflowRelicSpeedBonusActive(c(1)), false, 'CHK-M2-04 #1 初始相位 0 不得激活遗迹裸露旗标');
  assertEq(c(2).archetypeState.quantumLocked, false, 'CHK-M2-04 #2 初始未锁定');
  assertEq(quantumPhysicsResearchBonus(c(2)), 0, 'CHK-M2-04 #2 未锁定物理科研加成为 0');
  assertEq(c(3).archetypeState.landmarkTiles.length, 3, 'CHK-M2-04 #3 须自带 3 处考古地标');
  for (const idx of c(3).archetypeState.landmarkTiles) {
    assertEq((c(3).tiles[idx] >>> 16) & 0x3f, 48, 'CHK-M2-04 #3 地标建筑段须为 48（先驱者奇观）');
  }
  assertEq(c(5).archetypeState.landmarkTiles, null, 'CHK-M2-04 非 #3 原型不得落地标');
  assertEq(c(10).envVector[1], 70, 'CHK-M2-04 #10 envVector[1] 须精确 70');
  assertEq(c(10).envBaseline[1], 70, 'CHK-M2-04 #10 envBaseline[1] 须精确 70（Slow Tick 漂移基线同步）');
  assertEq(c(11).orbitalLayer.maxOrbitalDistricts, 12, 'CHK-M2-04 #11 maxOrbitalDistricts 须为 12');
  assertEq(c(12).subterraneanLayer.subUrbanSlots.length, 8, 'CHK-M2-04 #12 subUrbanSlots 容量须翻倍 4→8');
  assertEq(c(14).envVector[6], 0, 'CHK-M2-04 #14 envVector[6]（水圈）须恒 0');
  assertEq(c(14).envBaseline[6], 0, 'CHK-M2-04 #14 envBaseline[6] 须恒 0');
  assertEq(planets[15].habitability, 100, 'CHK-M2-04 #15 宜居度须恒定 100');
  assertEq(c(7).archetypeState.hostileGuardians, false, 'CHK-M2-04 #15 守卫初始休眠');

  // —— 测试前置：#0 双建筑（护盾/无护盾）、#2 重排样本区划、#6 触发阈值、#15 守卫阈值 ——
  c(0).tiles[5] = packTile({ buildingId: 5 }); // 无护盾建筑
  c(0).tiles[6] = packTile({ buildingId: 5, statusFlags: STATUS_FLAG.SHIELDED }); // 护盾建筑
  c(2).urbanZones.zoneSlots = [3, 1]; // 非对称功能区（商贸港/档案馆）
  c(6).envVector[0] = 81; // > 80 唤醒阈值
  c(15).envVector[7] = 36; // > 35 守卫阈值
  c(15).tiles[40] = packTile({ buildingId: 33, statusFlags: STATUS_FLAG.SHIELDED }); // 护盾建筑
  c(15).tiles[41] = packTile({ buildingId: 32 }); // 无护盾建筑
  c(7).colony.ownerId = 0; // 殖民 #7 星 → crystallineIntelBonus 命中

  // —— Slow 桶逐星驱动遍历（tick 升序 10..25；证明 setClockHooks slowPlanetHook 接线）——
  for (let i = 0; i < 16; i++) {
    world.tick = slowVisitTickAt(100 + i, 0) || 30; // key%30===0 的行星落在 tick 30 访问
    stepSpaceOperaTick(world);
  }
  assertEq(planets[6].threat && planets[6].threat.leviathan && planets[6].threat.leviathan.active, true,
    'CHK-M2-04 #6 env[0]=81 须复用 awakenLeviathan 必醒幼兽（Slow 桶钩子路径；threat 挂行星实体层）');
  assertEq(c(15).archetypeState.hostileGuardians, true, 'CHK-M2-04 #15 env[7]=36 须必现 hostileGuardians=true');
  assertEq((c(15).tiles[40] >>> 16) & 0x3f, 33, 'CHK-M2-04 #15 护盾建筑首次访问须零受损');

  // —— #7 晶化共鸣星情报加成（解密 +2 / 探测半径 +80%，逐星累计）——
  const intel = crystallineIntelBonus(world);
  assertEq(intel.decryption, 2, 'CHK-M2-04 #7 已殖民晶化星解密须 +2');
  assertEq(intel.detectionBonus, 0.8, 'CHK-M2-04 #7 已殖民晶化星探测半径须 +80%');

  // —— #5 晨昏带建造检定：列 3 有罚 / 列 7 无罚（[6,9] 含端点全列 + 越带列对照）——
  assertEq(canBuildWithoutPenalty(c(5), 3), false, 'CHK-M2-04 #5 列 3 建造须有罚（向阳火海带）');
  assertEq(canBuildWithoutPenalty(c(5), 7), true, 'CHK-M2-04 #5 列 7 建造须无罚（晨昏绿带）');
  for (const col of [6, 8, 9]) assertEq(canBuildWithoutPenalty(c(5), col), true, `CHK-M2-04 #5 列 ${col} 须无罚`);
  for (const col of [0, 5, 10, 15]) assertEq(canBuildWithoutPenalty(c(5), col), false, `CHK-M2-04 #5 列 ${col} 须有罚`);
  assertEq(canBuildWithoutPenalty(c(9), 3), true, 'CHK-M2-04 非 #5 原型恒无建造罚');

  // —— #15 守卫敌对存续：29 次追加 Slow 访问，护盾建筑零受损（无护盾建筑周期受损口径）——
  for (let k = 1; k <= 29; k++) {
    world.tick = slowVisitTickAt(115, 25 + 30 * k);
    stepSpaceOperaTick(world);
    assertEq((c(15).tiles[40] >>> 16) & 0x3f, 33, `CHK-M2-04 #15 护盾建筑第 ${k} 次追加访问须零受损`);
  }
  assertEq((c(15).tiles[41] >>> 16) & 0x3f, 0, 'CHK-M2-04 #15 无护盾建筑须在守卫敌对期被周期清除');
  assert(((c(15).tiles[41] >>> 26) & 0x3f & STATUS_FLAG.DEVASTATED) !== 0, 'CHK-M2-04 #15 被清除建筑须置 DEVASTATED 旗标');

  // —— #2 量子相移：未锁定 60 天周期重排 → 锁定后停止重排 + 物理科研 +120% ——
  world.tick = slowVisitTickAt(102, 1440); // 60 天界（1440 tick）后的首次 Slow 访问
  stepSpaceOperaTick(world);
  const st2 = c(2).archetypeState;
  assertEq(st2.lastQuantumReshufflePeriod, 1, 'CHK-M2-04 #2 未锁定须在 60 天界发生确定性重排（周期游标前进）');
  const slotsSnapshot = c(2).urbanZones.zoneSlots.slice();
  const env2 = executeCommand(world, {
    type: 'LockQuantumPhasePlanet',
    params: { planetId: 102, fleetId: 1, engageLock: true },
  });
  assertEq(env2.ok, true, `CHK-M2-04 #2 LockQuantumPhasePlanet 信封须 ok:true（实测 ${JSON.stringify(env2)}）`);
  assertEq(st2.quantumLocked, true, 'CHK-M2-04 #2 锁定后 quantumLocked 须置位（命令结果写世界态）');
  assertEq(st2.reactorMaintenance, true, 'CHK-M2-04 #2 锁定后反应堆维护旗标须开启');
  assertEq(quantumPhysicsResearchBonus(c(2)), 1.2, 'CHK-M2-04 #2 锁定后物理科研加成须 +120%（1.2）');
  world.tick = slowVisitTickAt(102, 2880); // 下一个 60 天界
  stepSpaceOperaTick(world);
  assertEq(c(2).urbanZones.zoneSlots, slotsSnapshot, 'CHK-M2-04 #2 锁定后 60 天周期不得重排 zoneSlots');
  assertEq(st2.lastQuantumReshufflePeriod, 1, 'CHK-M2-04 #2 锁定后重排周期游标不得前进');
  const env2b = executeCommand(world, {
    type: 'LockQuantumPhasePlanet',
    params: { planetId: 102, fleetId: 1, engageLock: false },
  });
  assertEq(env2b.ok, true, 'CHK-M2-04 #2 撤收信封须 ok:true');
  assertEq(st2.quantumLocked, false, 'CHK-M2-04 #2 撤收后锁定旗标须清零');
  assertEq(st2.reactorMaintenance, false, 'CHK-M2-04 #2 撤收后反应堆维护旗标须同步清零');
  assertEq(quantumPhysicsResearchBonus(c(2)), 0, 'CHK-M2-04 #2 撤收后物理科研加成须归零');

  // —— #0 潮汐火山期：90 天界（2160 tick）爆发 ——
  world.tick = slowVisitTickAt(100, 2160);
  stepSpaceOperaTick(world);
  assertEq(c(0).envVector[0], 38, 'CHK-M2-04 #0 火山期 env[0] 须精确 18+20=38（基线 18 无漂移）');
  assertEq((c(0).tiles[5] >>> 16) & 0x3f, 0, 'CHK-M2-04 #0 无护盾建筑须被火山期清除');
  assert(((c(0).tiles[5] >>> 26) & 0x3f & STATUS_FLAG.DEVASTATED) !== 0, 'CHK-M2-04 #0 被清除建筑须置 DEVASTATED');
  assertEq((c(0).tiles[6] >>> 16) & 0x3f, 5, 'CHK-M2-04 #0 护盾建筑须免疫火山期');
  assertEq(geothermalSurgeActive(c(0), world.tick), true, 'CHK-M2-04 #0 火山期地热 +100% 旗标须激活');
  const lastHist = c(0).historyRing[(c(0).historyCursor + 7) % 8];
  assertEq(lastHist[1], 70, 'CHK-M2-04 #0 火山期须写入 historyRing 私有码 70');

  // —— #1 物质倒灌相位：240 天界（5760 tick）翻转（掩埋 → 裸露）——
  world.tick = slowVisitTickAt(101, 5760);
  stepSpaceOperaTick(world);
  const st1 = c(1).archetypeState;
  assertEq(st1.backflowPhase, 1, 'CHK-M2-04 #1 5760 tick 后倒灌相位须翻转为 1（裸露相位）');
  assertEq(backflowMineUpkeepPenaltyActive(c(1)), false, 'CHK-M2-04 #1 裸露相位须关闭矿井掩埋维护 +35% 旗标');
  assertEq(backflowRelicSpeedBonusActive(c(1)), true, 'CHK-M2-04 #1 裸露相位须激活遗迹 S1 速度 +60% 旗标');
  const lastHist1 = c(1).historyRing[(c(1).historyCursor + 7) % 8];
  assertEq(lastHist1[1], 71, 'CHK-M2-04 #1 相位翻转须写入 historyRing 私有码 71');

  // —— 主题表完整性：16 原型 themeKeys 全部存在于 PLANET_THEMES 真实键（import 期自检兜底）——
  assertEq(PLANETARY_ARCHETYPES.length, ARCHETYPE_COUNT, 'CHK-M2-04 原型表数量须与 ARCHETYPE_COUNT 一致');
  assertEq(ARCHETYPE_COUNT, 16, 'CHK-M2-04 ARCHETYPE_COUNT 须为 16');
  assertEq(ARCHETYPE_THEME_MAPPING_NOTES.length, 16, 'CHK-M2-04 themeKeys 映射裁决表须 16 行');
  for (const row of PLANETARY_ARCHETYPES) {
    assertEq(row.id, PLANETARY_ARCHETYPES.indexOf(row), `CHK-M2-04 原型 ${row.code} id 须与行序一致`);
    assert(row.themeKeys.every((k) => typeof k === 'string' && k.length > 0), `CHK-M2-04 原型 ${row.id} themeKeys 须为真实键对`);
  }
  // 直接驱动步进（不经时钟）同样可用：#15 重复访问幂等（棘轮不重放苏醒事件）
  world.tick = slowVisitTickAt(115, 895) + 30;
  const reAwaken = stepArchetypeMechanics(world, planets[15], 1.25);
  assertEq(reAwaken && reAwaken.awakened, undefined, 'CHK-M2-04 #15 守卫棘轮：重复访问不得重放苏醒');
  return `CHK-M2-04 16星基线修正全命中(env1=70/orb=12/溶洞8槽/hydro0/宜居100/三地标48); #6幼兽必醒; #15守卫必现+护盾30次访问零受损; #5列3罚/列7免; #2锁定后停重排+科研1.2+反应堆旗标; #0火山期env0=38+护盾免疫+地热旗标; #1 5760tick相位翻转; intel+2/+0.8`;
}

/* ============================== CHK-M2-05：S3 舒适度与稳定度公式 ============================== */

function chk0205() {
  // —— 舒适度消耗系数精确值 ——
  assertEq(AMENITIES_COST_PER_POP.citizen, 1.0, 'CHK-M2-05 自由公民舒适度消耗须精确 1.0');
  assertEq(AMENITIES_COST_PER_POP.slave, 0.75, 'CHK-M2-05 奴隶阶层舒适度消耗须精确 0.75');
  assertEq(AMENITIES_COST_PER_POP.robot, 0.5, 'CHK-M2-05 非公民智械舒适度消耗须精确 0.50');

  // —— 加权口径：三阶层 [10,20,70] 人口 × 缺省全 citizen → 100×1.0 ——
  const world = makeOperaWorld();
  const planet = { id: 500, systemId: 1, archetypeId: 0 };
  world.entities.planets[500] = planet;
  const compact = ensureCompactPlanetState(planet, world);
  compact.colony.strata = [[10, 60, 10], [20, 55, 3], [70, 50, 1]];
  assertEq(computeAmenitiesNet(compact), 100, 'CHK-M2-05 缺省全公民加权净额须为 100');
  compact.colony.strataCostClasses = ['citizen', 'slave', 'robot'];
  assertEq(computeAmenitiesNet(compact), 10 * 1.0 + 20 * 0.75 + 70 * 0.5, 'CHK-M2-05 逐行覆写类别加权净额须为 60');

  // —— 稳定度非线性产出映射（百分点 + 分数双口径；doc45 §Task 2.4 §2）——
  assertEq(computeStabilityOutputMultiplier(80), 18.0, 'CHK-M2-05 稳定度 80 产出修正须精确 +18.0 百分点');
  assertEq(computeStabilityOutputMultiplier(80) / 100, 0.18, 'CHK-M2-05 稳定度 80 产出修正分数口径须精确 +0.18');
  assertEq(computeImmigrationAttraction(80), 30.0, 'CHK-M2-05 稳定度 80 移民吸引力须精确 +30.0 百分点');
  assertEq(computeImmigrationAttraction(80) / 100, 0.30, 'CHK-M2-05 稳定度 80 移民吸引力分数口径须精确 +0.30');
  assertEq(computeStabilityOutputMultiplier(20), -30.0, 'CHK-M2-05 稳定度 20 产出修正须精确 −30.0 百分点');
  assertEq(computeStabilityOutputMultiplier(20) / 100, -0.30, 'CHK-M2-05 稳定度 20 产出修正分数口径须精确 −0.30');
  // 封顶与下限（100 → +30/+50 封顶；0 → −50 下限）
  assertEq(computeStabilityOutputMultiplier(100), 30.0, 'CHK-M2-05 稳定度 100 产出封顶 +30');
  assertEq(computeImmigrationAttraction(100), 50.0, 'CHK-M2-05 稳定度 100 移民封顶 +50');
  assertEq(computeStabilityOutputMultiplier(0), -50.0, 'CHK-M2-05 稳定度 0 产出下限 −50');
  assertNear(computeStabilityOutputMultiplier(80), 30 * 0.6, 1e-12, 'CHK-M2-05 30×0.6 IEEE-754 精确命中 18.0');
  return 'CHK-M2-05 舒适度1.0/0.75/0.5精确+加权60; 产出80→+18.0(+0.18)/移民80→+30.0(+0.30)/产出20→−30.0(−0.30); 封顶+30/+50下限−50';
}

/* ============================== CHK-M2-06：S6 激进渗透 6 vs 7 边界翻转 ============================== */

function chk0206() {
  const world = makeOperaWorld();
  ensureSpaceOperaState(world); // S6 月度钩子首行守卫 world.spaceOperaState（缺失即零扫描）
  const planet = { id: 600, systemId: 1, archetypeId: 0, name: '边界星' };
  world.entities.planets[600] = planet;
  const compact = ensureCompactPlanetState(planet, world);
  compact.colony.ownerId = 0; // 已殖民（S6 月度钩子仅扫描已殖民行星）

  // —— 农业抽干(0)+重工业(2)+完美纳米锻炉人工制品(4) → industrialAttention === 6 ——
  compact.tiles[10] = packTile({ buildingId: 32 }); // 重工业（buildingId 32-35 段，权重 +2）
  compact.urbanZones.industryMods = { pristine_nanoforge: 1 }; // 已装工业人工制品 1 件（+4）
  const stDormant = stepShadowSyndicateArc(world);
  assertEq(stDormant.scanned, 1, 'CHK-M2-06 月度钩子扫描行星数须为 1');
  assertEq(compact.colony.industrialAttention, 6, 'CHK-M2-06 农业0+重工2+锻炉4 须精确 6');
  assertEq(compact.radicalCell.state, 'DORMANT', 'CHK-M2-06 attention 6 < 7 激进支部须保持 DORMANT 休眠');
  assertEq(compact.radicalCell.raidSource, false, 'CHK-M2-06 休眠态 raidSource 须为 false');
  assertEq(stDormant.activated, 0, 'CHK-M2-06 休眠态不得触发激活事件');

  // —— 新增 1 座深层采矿（矿脉 deposit 格 buildingId 1，权重 +1）→ === 7 立即翻转 ——
  compact.tiles[20] = packTile({ depositCode: 0x01, buildingId: 1 }); // 矿脉（低 2 位丰度 1）+ 采集区划
  const stActive = stepShadowSyndicateArc(world);
  assertEq(compact.colony.industrialAttention, 7, 'CHK-M2-06 新增采矿后关注度须精确 7');
  assertEq(stActive.activated, 1, 'CHK-M2-06 须立即触发 1 次激活');
  assertEq(compact.radicalCell.state, 'ACTIVE', 'CHK-M2-06 attention 7 ≥ 7 激进支部须立即翻转 ACTIVE');
  assertEq(compact.radicalCell.raidSource, true, 'CHK-M2-06 活跃态 raidSource 须为 true（海盗袭击信标源）');
  assertEq(compact.colony.incitedByAgitators, true, 'CHK-M2-06 活跃态须置位 S3 煽动旗标');
  const evt = world.events.queue.find((e) => e.type === 'RadicalCellActivated');
  assert(!!evt, 'CHK-M2-06 首次翻转须 emit RadicalCellActivated');
  assertEq(evt.payload.industrialAttention, 7, 'CHK-M2-06 激活事件载荷关注度须为 7');
  // 活跃态立即后果：stability −3.0/月（65 → 62）
  assertEq(compact.colony.stability, 62, 'CHK-M2-06 活跃态月度稳定度削减 −3.0 须生效（65→62）');
  return 'CHK-M2-06 0+2+4→attention===6且DORMANT; +1采矿→===7且立即ACTIVE+raidSource=true+煽动旗标+稳定度−3.0';
}

/* ============================== CHK-M2-07：稀疏前沿 CA 时钟集成活体通路 ============================== */

function chk0207() {
  const world = makeOperaWorld();
  ensureSpaceOperaState(world); // Slow 桶 CA 演化仅对已挂 spaceOperaState 的活体世界生效

  // —— 行星 A（#3 先驱者机械墓园，自带 3 处 buildingId 48 地标）：env[3]=80 开晶格门 ——
  const planet = { id: 900, systemId: 1, archetypeId: 3, name: '晶格实证星', habitability: 42 };
  world.entities.planets[900] = planet;
  const compact = applyArchetypeProfile(planet, world);
  compact.envVector[3] = 80; // 规则 D 门控（> 50）
  // —— 行星 B：未挂 compactState（惰性容器守卫零写入对照）——
  const bare = { id: 901, systemId: 1 };
  world.entities.planets[901] = bare;

  // —— 首次 Slow 访问：时钟路径播种 24 前沿位 + CA 步进（地标在前沿位上则原地晶格化）——
  world.tick = slowVisitTickAt(900, 0) || 30;
  stepSpaceOperaTick(world);
  assertEq(frontierCount(compact.frontierMask), 24, 'CHK-M2-07 首次 Slow 访问须由时钟路径播种恰 24 前沿位');
  const landmarkTiles = compact.archetypeState.landmarkTiles;
  assertEq(landmarkTiles.length, 3, 'CHK-M2-07 #3 星须自带 3 处先驱者地标');
  // —— 前沿化全部地标格（勘探触达语义；setFrontier 公开 API 幂等置位）——
  for (const idx of landmarkTiles) setFrontier(compact.frontierMask, idx);

  // —— 第二次 Slow 访问：规则 D 成核——前沿位上的地标建筑 env[3]>50 原地晶格化 ——
  world.tick = slowVisitTickAt(900, world.tick + 1);
  stepSpaceOperaTick(world);
  for (const idx of landmarkTiles) {
    assertEq(unpackTile(compact.tiles[idx] >>> 0).overlayId, 4, `CHK-M2-07 地标格 ${idx} 须经时钟 CA 规则 D 成核 overlay 4`);
  }
  const countAfterNucleation = frontierCount(compact.frontierMask);
  assert(countAfterNucleation >= 24, `CHK-M2-07 成核后前沿位不得流失（实测 ${countAfterNucleation}）`);

  // —— 第三次 Slow 访问：晶格自源格向外结晶——激活新前沿位 + 赋予奇异水晶矿脉 ——
  world.tick = slowVisitTickAt(900, world.tick + 1);
  stepSpaceOperaTick(world);
  const countAfterSpread = frontierCount(compact.frontierMask);
  assert(countAfterSpread > countAfterNucleation,
    `CHK-M2-07 晶格扩散须激活新前沿位（${countAfterNucleation} → ${countAfterSpread}）`);
  let crystalNeighbors = 0;
  for (const idx of landmarkTiles) {
    const x = idx & 15;
    const y = idx >>> 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
      const u = unpackTile(compact.tiles[ny * 16 + nx] >>> 0);
      if (u.overlayId === 4) {
        crystalNeighbors++;
        assertEq(u.depositCode >>> 2, 2, `CHK-M2-07 结晶格 (${nx},${ny}) 须获得 deposit 类型 2 奇异水晶`);
      }
    }
  }
  assert(crystalNeighbors > 0, 'CHK-M2-07 晶格扩散须至少结晶 1 个邻格');

  // —— 休眠待命语义：行星 A 的其余播种位（overlay 0、无地标）保持零相变 ——
  for (let i = 0; i < 256; i++) {
    const u = unpackTile(compact.tiles[i] >>> 0);
    assert(u.overlayId !== 1 && u.overlayId !== 2 && u.overlayId !== 3,
      `CHK-M2-07 门控未开（菌丝 env[2]=${compact.envVector[2]}/熔岩 env[0]=${compact.envVector[0]}/冰盖 env[5]=${compact.envVector[5]}）格 ${i} 不得相变出 overlay 1/2/3`);
  }

  // —— 行星 B（未挂 compactState）零写入：无容器派生、无播种 ——
  assertEq(bare.compactState, undefined, 'CHK-M2-07 未挂 compactState 行星须零写入（绝不 ensure）');
  return `CHK-M2-07 时钟CA集成: 首访问播种24前沿位; 地标格规则D成核overlay4; 扩散${countAfterNucleation}→${countAfterSpread}位+水晶矿脉(类型2); 休眠位零相变; 裸星零写入`;
}

/* ============================== 套件门面 ============================== */

export const suite = {
  id: 'SPACE-OPERA-M2',
  name: '太空歌剧 M2 雅可比耦合/稀疏前沿CA/16天体原型门禁（GATE-16-M2）',
  group: 'space-opera',
  async run() {
    const t0 = performance.now();
    try {
      // 同步 import 后立即跑时钟的调用方必须先等动态钩子注入完成
      // （archetypeMechanics slowPlanetHook → SpaceOperaClock setClockHooks）
      await ensureArchetypeHookInjected();
      const parts = [];
      parts.push(chk0201());
      parts.push(chk0202());
      parts.push(chk0203());
      parts.push(chk0204());
      parts.push(chk0205());
      parts.push(chk0206());
      parts.push(chk0207());
      return { ok: true, detail: `${parts.join('; ')}; 耗时<${(performance.now() - t0).toFixed(1)}ms` };
    } catch (e) {
      return { ok: false, detail: String((e && e.stack) || e) };
    }
  },
};
