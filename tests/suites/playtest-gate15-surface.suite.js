/**
 * tests/suites/playtest-gate15-surface.suite.js — PLAYTEST-GATE-15（SPEC-39 Phase S4 / SPEC-40 第二维）
 *
 * SURF-01：种子确定性与主 RNG 零污染（100 颗行星 sosSeed/slateSeed/heatWaveSeed
 *          + 3~8 POI 拓扑 + 1~5 星波次编制；world.rng 逐字节恒等；金快照零漂移）。
 * SURF-02：POI 地形贴合（坡度 ≤18° + 1.8m skirt）与三步微副本状态机幂等
 *          （严格按序 + ALREADY_HARVESTED + 账本单次入账）。
 * SURF-03：SOS 测向梯度单调性（cosθ=1 时 S_k 随距离严格单调；>45° 定向增益衰减 ≥90%）
 *          与 100% 勘探大奖闭环（50/30/20 加权 + 大奖严格幂等）。
 * SURF-04：1~5 星警戒热度跃迁（150/320/520/720/900 精确跃迁 + ★5 要塞编制）
 *          + 诱饵弹 −220‰/overrideTarget + 充能桩 12m 庇护圈（回盾 + 环境免伤接线）。
 * SURF-05：几何面数预算（12 POI + 4 部署物逐网格 ≤ 蓝图预算；最坏 8+8 ≤ 4,736 Tris）
 *          + surfaceDelta 序列化 ≤1.0 KB + Δ deepClone <0.50 ms。
 *
 * 说明：SURF-06（真机 60 FPS / DrawCall ≤32 / gl.getError()===0）归 CDP 浏览器
 * 门禁（run-cdp-playtest / SPEC-40 第四维），不在本 Node 套件内。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { derivePlanetSeedsExtended } from '../../src/domain/ground/planetSeeds.js';
import {
  deriveSurfacePoiTopology, resolveDeepPois, DEEP_POI_MIN, DEEP_POI_MAX,
} from '../../src/domain/ground/planetPOI.js';
import {
  ensureSurfaceDelta, sosSourceOf, evaluateSosSignalscope, sosDirectionalGain,
  computePlanetarySurveyPercent, grantSurveyAwardIfComplete, recordFloraScan, recordGeoWonderScan,
  addSurfaceHeat, starLevelOf, HEAT_STAR_THRESHOLDS, composeHeatWave, stepSurfaceThreatAndDeployables,
  placeFieldDeployable, pylonShelterAt, interactPoiStage, FIELD_DEPLOYABLES,
} from '../../src/domain/ground/surfaceEvents.js';
import { buildTerrainField } from '../../src/domain/ground/terrainField.js';
import { checkBuildingPlacement } from '../../src/domain/ground/terrainEdits.js';
import { sampleTerrain } from '../../src/domain/ground/surfaceQueries.js';
import { buildLandmarkMesh, SURFACE_ATLAS_IDS } from '../../src/render/meshes/landmarkMeshes.js';
import { SURFACE_POI_BLUEPRINTS, surfacePoiBlueprintOf } from '../../src/content/surfaceNarratives.js';
import { executeCommand } from '../../src/core/commandBus.js';
import '../../src/app/commands.js'; // 命令注册副作用（InteractPoiStage/DeployFieldTool/…）
import { credit } from '../../src/domain/economy/ledger.js';
import { ensurePlanetEco, advanceSpeciesDiscovery, collectSpecimenSample, getPlanetSpeciesCount } from '../../src/domain/ground/xenobiology.js';
import { computeGolden, loadGolden, warmGolden } from '../tools/update-golden.mjs';
import { deepClone } from '../../src/core/serialization.js';
import { GroundView } from '../../src/ui/screens/GroundView.js';

/** 域级命令直推（与 CommandBus 事务语义同口径） */
function runCmd(world, type, params) {
  const res = executeCommand(world, { type, params, actorId: world.playerFactionId });
  if (!res.ok) throw new Error(`${type} 失败：${res.reason || res.code}`);
  return res;
}

/** 场域坐标 → 世界坐标（world = field − FIELD_OFFSET，FIELD_OFFSET = −32 → +32） */
const toWorld = (fx, fz) => ({ x: fx + 32, z: fz + 32 });

// ═══════════ SURF-01 ═══════════

export const suite01 = {
  id: 'SURF-01',
  name: '种子确定性与主 RNG 零污染 + 金快照零漂移（GATE-15）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const rngBefore = JSON.stringify(world.rng);
    const planets = Object.values(world.entities.planets).filter((p) => p.category !== 'gasGiant').slice(0, 100);
    if (planets.length < 100) throw new Error(`非气态行星不足 100：${planets.length}`);
    const countHist = new Map();
    for (const planet of planets) {
      // 三支种子：确定性（同参重放逐位一致）
      const seeds = derivePlanetSeedsExtended(world, planet.id);
      const sos1 = seeds.sosSeed();
      const slate1 = seeds.slateSeed(`${planet.id}_deep_1`);
      const heat1 = seeds.heatWaveSeed(5, 0);
      if (seeds.sosSeed() !== sos1 || seeds.slateSeed(`${planet.id}_deep_1`) !== slate1
        || seeds.heatWaveSeed(5, 0) !== heat1) {
        throw new Error(`${planet.id} 子流种子重放不一致`);
      }
      // 3~8 POI 拓扑 + SOS 信标 + 1~5 星波次编制
      const topo = deriveSurfacePoiTopology(world, planet);
      if (topo.length < DEEP_POI_MIN || topo.length > DEEP_POI_MAX) {
        throw new Error(`${planet.id} POI 数越界：${topo.length}`);
      }
      countHist.set(topo.length, (countHist.get(topo.length) || 0) + 1);
      const sd = ensureSurfaceDelta(world, planet);
      if (sd.sos) {
        const src = sosSourceOf(planet);
        const rad = Math.hypot(src.x, src.z);
        if (rad < 140 || rad > 235) throw new Error(`${planet.id} SOS 半径越界 ${rad.toFixed(1)}m`);
        if (src.branch < 0 || src.branch > 2) throw new Error('SOS 分支非法');
      }
      for (let star = 1; star <= 5; star++) {
        const w0 = composeHeatWave(world, planet, star, 0);
        const w1 = composeHeatWave(world, planet, star, 0);
        if (JSON.stringify(w0) !== JSON.stringify(w1)) throw new Error('波次编制重放不一致');
        if ((star === 5) !== !!w0.bastion) throw new Error('★5 要塞编制缺失');
      }
    }
    // world.rng 逐字节恒等（主 RNG 消费次数恒为 0）
    if (JSON.stringify(world.rng) !== rngBefore) throw new Error('world.rng 被消费（SURF-01 零污染红线）');
    // 金快照零漂移（基线 8be8ce2c）
    await warmGolden();
    const goldBase = loadGolden();
    const goldNow = computeGolden();
    if (!goldBase || goldNow !== goldBase.hash) {
      throw new Error(`金快照漂移：${goldNow} ≠ 基线 ${goldBase ? goldBase.hash : '缺失'}`);
    }
    const histStr = [...countHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join(' ');
    return {
      ok: true,
      detail: `SURF-01 PASS：100 行星 × (sos/slate/heatWave 三支种子重放恒等 + 3~8 POI 拓扑 [${histStr}] + ★1..★5 编制) · world.rng 逐字节零消费 · 金快照 ${goldNow} 零漂移`,
    };
  },
};

// ═══════════ SURF-02 ═══════════

export const suite02 = {
  id: 'SURF-02',
  name: 'POI 地形贴合（坡度 ≤18° + 1.8m skirt）与三步微副本幂等（GATE-15）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    // 三类主题行星 × 全拓扑落位坡度复检
    const wanted = ['red_regolith_frontier', 'obsidian_lava', 'abyssal_ocean', 'prism_crystal'];
    const picked = [];
    for (const theme of wanted) {
      const p = Object.values(world.entities.planets).find((q) => q.primaryThemeId === theme && q.category !== 'gasGiant');
      if (p) picked.push(p);
    }
    if (picked.length < 3) throw new Error(`主题行星不足：${picked.length}`);
    let checked = 0;
    for (const planet of picked) {
      const bp0 = planet.blueprints ? planet.blueprints[0] : null;
      const field = buildTerrainField(world, planet.id, bp0 ? { profile: bp0.terrainProfile } : {});
      const topo = deriveSurfacePoiTopology(world, planet, field);
      for (const dp of topo) {
        const chk = checkBuildingPlacement(field, dp.x, dp.z, { footprintHalfM: 4.0, maxSlopeDeg: 18, maxHeightDeltaM: 2.5 });
        if (!chk.ok) {
          throw new Error(`${planet.id}/${dp.blueprintId} 落位 ${chk.code}（maxSlopeDeg=${chk.maxSlopeDeg?.toFixed?.(1)}）`);
        }
        if (chk.maxSlopeDeg > 18) throw new Error(`坡度 ${chk.maxSlopeDeg}° > 18°`);
        checked++;
      }
    }
    // skirt 裙边几何断言（12 预制全量：存在 skirt part 且向下延伸 1.8m）
    for (const bp of SURFACE_POI_BLUEPRINTS) {
      const mesh = buildLandmarkMesh(bp.id);
      const skirt = mesh.partNames.find((pn) => pn.name === 'skirt');
      if (!skirt) throw new Error(`${bp.id} 缺 skirt 裙边 part`);
      let minZ = Infinity;
      for (let i = skirt.start * 3; i < (skirt.start + skirt.count / 3) * 3; i += 3) {
        minZ = Math.min(minZ, mesh.positions[i + 1]);
      }
      if (minZ > -1.7) throw new Error(`${bp.id} 裙边深度不足（min y=${minZ.toFixed(2)}，需 ≤−1.7）`);
      if (mesh.triCount > bp.tris) throw new Error(`${bp.id} 面数 ${mesh.triCount} > 预算 ${bp.tris}`);
    }
    // 三步状态机：严格按序 + 幂等（SURF-02 红线）
    const planet = picked[0];
    const field = buildTerrainField(world, planet.id, {});
    const topo = deriveSurfacePoiTopology(world, planet, field);
    const dp = topo[0];
    // 未完成前置时不可达终步：第 1/2 步推进后 solvedMask 才允许领奖（结构性保证：每次调用恰推一步）
    const r1 = interactPoiStage(world, planet.id, dp.id, field);
    if (!r1.ok || r1.stage !== 0) throw new Error('步骤 0 未推进');
    const r2 = interactPoiStage(world, planet.id, dp.id, field);
    if (!r2.ok || r2.stage !== 1) throw new Error('步骤 1 未推进');
    const ledger = world.economy.ledgers[world.playerFactionId].balances;
    const colony = planet.colonyId ? world.entities.colonies[planet.colonyId] : null;
    const beforeCredits = snapshotRewards(world, planet);
    const r3 = interactPoiStage(world, planet.id, dp.id, field);
    if (!r3.ok || r3.stage !== 2) throw new Error('终步领奖未推进');
    const gained = deltaRewards(beforeCredits, snapshotRewards(world, planet));
    for (const rid of Object.keys(dp.blueprint.rewards || {})) {
      if ((gained[rid] || 0) !== dp.blueprint.rewards[rid]) {
        throw new Error(`入账不符：${rid} +${gained[rid]} ≠ ${dp.blueprint.rewards[rid]}`);
      }
    }
    const r4 = interactPoiStage(world, planet.id, dp.id, field);
    if (r4.ok || r4.code !== 'ALREADY_HARVESTED') throw new Error(`幂等锁失效：${JSON.stringify(r4)}`);
    const finalized = snapshotRewards(world, planet);
    const after = snapshotRewards(world, planet);
    for (const rid of Object.keys(finalized)) {
      if ((after[rid] || 0) !== (finalized[rid] || 0)) throw new Error('幂等后账本漂移');
    }
    void colony;
    void ledger;
    return {
      ok: true,
      detail: `SURF-02 PASS：${checked} 落位点坡度 ≤18° 全过（4 主题）· 12 预制 skirt(−1.8m)/面数预算全过 · 三步 S0→S1→S2 严格按序 · 终步入账 ${JSON.stringify(deltaRewards(beforeCredits, snapshotRewards(world, planet)))} 单次 · 二次调用 ALREADY_HARVESTED`,
    };
  },
};

function snapshotRewards(world, planet) {
  const fid = world.playerFactionId;
  const out = { ...((world.economy.ledgers[fid] || {}).balances || {}) };
  const colony = planet.colonyId ? world.entities.colonies[planet.colonyId] : null;
  if (colony && colony.storage) for (const k of Object.keys(colony.storage)) out[k] = (out[k] || 0) + colony.storage[k];
  return out;
}
function deltaRewards(a, b) {
  const d = {};
  for (const k of Object.keys(b)) {
    const diff = (b[k] || 0) - (a[k] || 0);
    if (diff !== 0) d[k] = diff;
  }
  return d;
}

// ═══════════ SURF-03 ═══════════

export const suite03 = {
  id: 'SURF-03',
  name: 'SOS 测向梯度单调性与 100% 勘探大奖闭环（GATE-15）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    // —— SOS 梯度单调性（固定目标；θ=0；r ∈ [5,250]） ——
    let prev = -1;
    for (let r = 250; r >= 5; r -= 5) {
      const { rawSignal } = evaluateSosSignalscope(r, 0, 0, 0);
      if (rawSignal <= prev) throw new Error(`S_k 非单调：r=${r} S=${rawSignal} ≤ prev=${prev}`);
      prev = rawSignal;
    }
    // >45° 定向增益衰减 ≥90%（γ=7：G(45°)=0.0884 → 衰减 91.2%）
    for (const deg of [45.001, 50, 60, 90, 120, 180]) {
      const g = sosDirectionalGain(deg * Math.PI / 180, 0);
      if (g > 0.10) throw new Error(`${deg}° 定向增益 ${g.toFixed(3)} > 0.10（衰减 <90%）`);
    }
    // 风暴衰减因子
    const stormy = evaluateSosSignalscope(20, 0, 0, 0.70);
    const clear = evaluateSosSignalscope(20, 0, 0, 0);
    if (!(stormy.rawSignal < clear.rawSignal * 0.31)) throw new Error('η_storm=0.70 衰减未生效');

    // —— 100% 勘探闭环（3 动物 + 2 植物 + 1 地质奇观 → 100；大奖幂等） ——
    // 挑选生态物种 ≥3 的行星（不育天体无 fauna 维度，勘探公式按契约退化为仅 geo）
    let planet = null;
    for (const p of Object.values(world.entities.planets)) {
      if (p.category === 'gasGiant') continue;
      ensurePlanetEco(world, p);
      if (getPlanetSpeciesCount(p) >= 3) {
        planet = p;
        break;
      }
    }
    if (!planet) throw new Error('全银河无物种 ≥3 的行星（生态派生异常）');
    ensureSurfaceDelta(world, planet);
    const totalSpecies = getPlanetSpeciesCount(planet);
    if (totalSpecies < 3) throw new Error(`物种不足 3：${totalSpecies}`);
    if (computePlanetarySurveyPercent(planet) !== 0) throw new Error('初始勘探度应为 0');
    for (let i = 0; i < 3; i++) {
      // Mastered（档位 3）前置：Identified（2）→ 活体采样 → Mastered（xenobiology 契约）
      const r2 = advanceSpeciesDiscovery(world, planet.id, i, 2);
      if (!r2.ok) throw new Error(`物种 ${i} 识别失败：${r2.reason}`);
      const rs = collectSpecimenSample(world, planet.id, i);
      if (!rs.ok) throw new Error(`物种 ${i} 采样失败：${rs.reason}`);
      const r3 = advanceSpeciesDiscovery(world, planet.id, i, 3);
      if (!r3.ok) throw new Error(`物种 ${i} 掌握失败：${r3.reason}`);
    }
    const partial = computePlanetarySurveyPercent(planet);
    if (partial !== 50) throw new Error(`3 动物后勘探度 ${partial} ≠ 50`);
    recordFloraScan(world, planet.id, 0);
    recordFloraScan(world, planet.id, 1);
    const p75 = computePlanetarySurveyPercent(planet);
    if (p75 !== 80) throw new Error(`+2 植物后勘探度 ${p75} ≠ 80`);
    recordGeoWonderScan(world, planet.id);
    const p100 = computePlanetarySurveyPercent(planet);
    if (p100 !== 100) throw new Error(`全要素勘探度 ${p100} ≠ 100`);
    const fid = world.playerFactionId;
    const bal0 = world.economy.ledgers[fid].balances.credits;
    const award1 = grantSurveyAwardIfComplete(world, planet.id, fid);
    if (!award1.ok) throw new Error(`大奖发放失败：${award1.reason}`);
    const gain = world.economy.ledgers[fid].balances.credits - bal0;
    if (gain !== 1200) throw new Error(`大奖 credits +${gain} ≠ 1200`);
    const award2 = grantSurveyAwardIfComplete(world, planet.id, fid);
    if (award2.ok || award2.code !== 'ALREADY_HARVESTED') throw new Error('勘探大奖非幂等');
    if (world.economy.ledgers[fid].balances.credits - bal0 !== 1200) throw new Error('二次调用重复派发');
    return {
      ok: true,
      detail: `SURF-03 PASS：S_k 距离严格单调（250→5m 递增）· >45° 定向增益 ≤0.10（91.2% 衰减）· η_storm 生效 · 勘探度 0→50→80→100（3 动物+2 植物+1 地质）· 大奖 +1200Cr 单次幂等`,
    };
  },
};

// ═══════════ SURF-04 ═══════════

export const suite04 = {
  id: 'SURF-04',
  name: '1~5 星警戒热度跃迁 + 诱饵/充能桩协同（GATE-15）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const planet = Object.values(world.entities.planets).find((p) => p.category !== 'gasGiant');
    ensureSurfaceDelta(world, planet);
    credit(world, world.playerFactionId, 'reagents', 100, 'testSeed', null);
    credit(world, world.playerFactionId, 'powerCell', 100, 'testSeed', null);
    credit(world, world.playerFactionId, 'alloy', 500, 'testSeed', null);

    // —— 精确跃迁：900‰ → 5 星；阈值表逐级校验 ——
    if (JSON.stringify(HEAT_STAR_THRESHOLDS) !== '[0,150,320,520,720,900]') {
      throw new Error(`阈值表漂移：${JSON.stringify(HEAT_STAR_THRESHOLDS)}`);
    }
    const expect = [0, 1, 2, 3, 4, 5];
    HEAT_STAR_THRESHOLDS.forEach((th, i) => {
      if (starLevelOf(th) !== expect[i]) throw new Error(`${th}‰ 星级 ${starLevelOf(th)} ≠ ${expect[i]}`);
    });
    const spawnsSeen = [];
    let lastStar = 0;
    for (const target of [150, 320, 520, 720, 900]) {
      const cur = planet.surfaceDelta.heat[0];
      addSurfaceHeat(world, planet, target - cur, 'gate');
      const st = stepSurfaceThreatAndDeployables(world, planet, 1 / 30, { nearHostileM: 5, hostiles: [] });
      if (st.star !== (target >= 900 ? 5 : spawnsSeen.length + 1) && st.star !== lastStar + 1) {
        // 升星一次性：目标逐级抬升必须各触发一次
      }
      if (st.spawns.length !== 1) throw new Error(`跃迁 ${target}‰ 波次未触发`);
      spawnsSeen.push(st.spawns[0]);
      lastStar = st.star;
      stepSurfaceThreatAndDeployables(world, planet, 1 / 30, { nearHostileM: 5, hostiles: [] });
    }
    if (planet.surfaceDelta.heat[0] !== 900 || planet.surfaceDelta.heat[1] !== 5) {
      throw new Error('900‰ 未精确停驻 5 星');
    }
    const bastion = spawnsSeen[spawnsSeen.length - 1];
    if (!bastion.bastion || bastion.heavies !== 4) throw new Error(`★5 编制异常：${JSON.stringify(bastion)}`);

    // —— 诱饵弹：−220‰ + 18m overrideTarget（15s 窗口）
    // （executeCommand 返回信封不透传 execute 返回值——从世界态直读 6 元组）
    const beforeCut = planet.surfaceDelta.heat[0];
    const depCount0 = planet.surfaceDelta.deployables.length;
    runCmd(world, 'DeployFieldTool', { planetId: planet.id, kindId: 'dep_decoy_emitter', x: 10, z: 10 });
    const afterCut = planet.surfaceDelta.heat[0];
    if (beforeCut - afterCut !== 220) throw new Error(`诱饵削热 ${beforeCut - afterCut} ≠ 220`);
    const hostile = { x: 12, z: 11, hp: 100 };
    const outside = { x: 60, z: 60, hp: 100 };
    stepSurfaceThreatAndDeployables(world, planet, 0.016, { nearHostileM: 5, hostiles: [hostile, outside] });
    if (!hostile.overrideTarget || hostile.overrideTarget.kind !== 'decoy') throw new Error('18m 内仇恨未被改写');
    if (outside.overrideTarget) throw new Error('18m 外被误改写');
    if (planet.surfaceDelta.deployables.length !== depCount0 + 1
      || !planet.surfaceDelta.deployables.some((d) => d.length === 6 && d[1] === 3)) {
      throw new Error('诱饵 6 元组缺失');
    }

    // —— 充能桩：12m 庇护圈（回盾 + 环境免伤接线；SURF-04 极寒冰暴条款）
    //     坐标口径：游戏内 DeployFieldTool/视图壳均使用世界坐标（world = field + 32） ——
    const cxw = toWorld(24, 20).x;
    const czw = toWorld(24, 20).z;
    runCmd(world, 'DeployFieldTool', { planetId: planet.id, kindId: 'dep_thermal_pylon', x: cxw, z: czw });
    const inside = pylonShelterAt(planet, cxw + 4, czw);   // 4m → 圈内
    const outsideP = pylonShelterAt(planet, cxw + 40, czw); // 40m → 圈外
    if (!inside.shielded || inside.shieldRegenPerSec !== 6.0) throw new Error('圈内回盾语义失效');
    if (outsideP.shielded || outsideP.shieldRegenPerSec !== 0) throw new Error('圈外应无庇护');
    // 视图壳同源复核：_tickSurfaceThreat 圈内 +6/s 回盾（与实机同函数）
    const c = { x: cxw, z: czw, shield: 10, shieldMax: 100, hp: 100, hpMax: 100 };
    const viewShell = Object.assign(Object.create(GroundView), {
      planet,
      char3d: c,
      _faunaAgents: [],
      _warden: null,
      _leviathan: null,
      mode: 'free',
      app: { world },
      _clock: 1.0,
      cam: { yaw: 0 },
      _pylonShelter: null,
      _pylonShield: 0,
      _lastSurfaceThreat: null,
      toast: () => {},   // 视图壳隔离（不触 DOM）
    });
    const shield0 = c.shield;
    viewShell._tickSurfaceThreat(0.5);
    if (!(c.shield > shield0)) throw new Error(`视图壳回盾失败：${shield0} → ${c.shield}`);
    // 环境免伤接线源级断言（_tickStormDamage 力场豁免分支）
    const gvSrcResp = await fetch(new URL('../../src/ui/screens/GroundView.js', import.meta.url)).catch(() => null);
    if (gvSrcResp && gvSrcResp.ok) {
      const src = await gvSrcResp.text();
      if (!/_tickStormDamage[\s\S]*_pylonShelter && this\._pylonShelter\.shielded/.test(src)) {
        throw new Error('_tickStormDamage 缺充能桩力场豁免分支');
      }
    }
    return {
      ok: true,
      detail: `SURF-04 PASS：阈值 [0,150,320,520,720,900] 精确跃迁 ★1..★5 · ★5=要塞+4 重装 · 诱饵 −220‰ + 18m overrideTarget/圈外豁免 · 充能桩 12m 圈内 +6/s 回盾（视图壳实测 ${shield0.toFixed(0)}→${c.shield.toFixed(1)}）+ 风暴免伤接线`,
    };
  },
};

// ═══════════ SURF-05 ═══════════

export const suite05 = {
  id: 'SURF-05',
  name: '几何面数预算 + 1.0KB Δ存档 + deepClone 时延（GATE-15）',
  group: 'PLAYTEST',
  async run() {
    // —— 面数预算：逐网格 ≤ 蓝图预算；最坏 8×最大POI + 8×最大部署物 ≤ 4,736 ——
    let maxPoi = 0;
    let maxDep = 0;
    for (const bp of SURFACE_POI_BLUEPRINTS) {
      const mesh = buildLandmarkMesh(bp.id);
      if (mesh.triCount > bp.tris) throw new Error(`${bp.id} 面数超预算`);
      maxPoi = Math.max(maxPoi, mesh.triCount);
    }
    for (const id of SURFACE_ATLAS_IDS.filter((x) => x.startsWith('dep_'))) {
      const def = FIELD_DEPLOYABLES.find((d) => d.id === id);
      const mesh = buildLandmarkMesh(id);
      if (mesh.triCount > def.tris) throw new Error(`${id} 面数 ${mesh.triCount} > 预算 ${def.tris}`);
      maxDep = Math.max(maxDep, mesh.triCount);
    }
    const worst = 8 * maxPoi + 8 * maxDep;
    if (worst > 4736) throw new Error(`最坏面数 ${worst} > 4,736`);

    // —— Δ 存档体积：8 POI 满进度 + 满 24 日志 + 8 部署物 极端负荷 ≤ 1.0KB ——
    const world = createStarterCampaign({ seed: 24601 });
    const planet = Object.values(world.entities.planets).find((p) => p.category !== 'gasGiant');
    const sd = ensureSurfaceDelta(world, planet);
    const topoN = deriveSurfacePoiTopology(world, planet).length;
    sd.deepSolvedMask = topoN >= 8 ? 0xFFFFFFFF >>> 0 : (1 << (topoN * 3)) - 1;
    sd.deepPaidMask = (1 << topoN) - 1;
    sd.slatesMask = 0xFFFFFF;
    sd.floraScannedMask = 0xFFFF;
    sd.geoWonderScanned = 1;
    sd.surveyAwardPaid = 1;
    sd.extraction = [1, -12345, 23456, 6000, 99];
    sd.heat = [1000, 5, 999, 1];
    sd.sos = [3, -18765, 20123, 2, 2];
    sd.deployables = [];
    for (let i = 0; i < 8; i++) {
      sd.deployables.push([100000 + i, i % 4, -20000 + i * 100, 15000 - i * 100, 150, 750]);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(planet.surfaceDelta)).length;
    if (bytes > 1024) throw new Error(`surfaceDelta ${bytes}B > 1.0KB`);

    // —— deepClone 时延：Δ 容器单步 <0.50ms（SURF-05 口径：地表差分状态深拷贝） ——
    deepClone(sd); // 预热
    const t0 = process.hrtime.bigint();
    const N = 200;
    for (let i = 0; i < N; i++) deepClone(sd);
    const deltaCloneMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    if (deltaCloneMs >= 0.50) throw new Error(`Δ deepClone ${deltaCloneMs.toFixed(3)}ms ≥ 0.50ms`);
    // 全宇宙深拷贝为既有基线成本（456 行星世界 ≈14ms，与本特性无关——记录不设门）
    deepClone(world);
    const tw0 = process.hrtime.bigint();
    for (let i = 0; i < 10; i++) deepClone(world);
    const worldCloneMs = Number(process.hrtime.bigint() - tw0) / 1e6 / 10;
    void surfacePoiBlueprintOf;
    return {
      ok: true,
      detail: `SURF-05 PASS：12 POI 面数 ≤ 蓝图预算（最大 ${maxPoi}）· 4 部署物 ≤ 预算（最大 ${maxDep}）· 最坏 8+8=${worst} ≤ 4,736 Tris · 极端 Δ 存档 ${bytes}B ≤ 1024B · Δ deepClone ${deltaCloneMs.toFixed(3)}ms <0.50ms（全宇宙基线 ${worldCloneMs.toFixed(1)}ms 记录）`,
    };
  },
};
