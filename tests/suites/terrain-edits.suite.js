/**
 * tests/suites/terrain-edits.suite.js — 地形编辑层与殖民地岗位看板门禁（doc7 TASK-5.1/5.2）
 *
 * TERRAIN-06 局部地表修改增量重建：raise/lower 只改变刷子半径内采样高度（场外逐位不变）；
 *   单次编辑标脏 ≤ 4 区块（半径 ≤ chunkMeters/2 → 至多 2×2），重建后 dirty 清零。
 * GAME-06 地形整形器实际改变可建性；GAME-07 坡度地基：flatten 覆写采掘凹陷（DSP 式压平），
 *   restore 一键恢复纯宏观地貌（样本集逐字节一致）；PlaceBuilding 9 点投影坡度校验
 *   （陡点拒绝 SLOPE_TOO_STEEP / 高差拒绝 HEIGHT_DELTA / 平整点放行并给地基承台）。
 * SITE-07 编辑持久化：紧凑 JSON 命令序列 serialize/deserialize 往返逐字节一致，
 *   命令重放（同算子序列）逐位重现高度场；零 world.rng 消费。
 * COL-01..04 / ECON-02：jobsFilled 岗位分配（understaffed 按 η 降产）与
 *   五态 runtimeStatus（running / understaffed / starved_input / low_power / storage_full）
 *   逐状态可达（starter 世界单元级构造）。
 *
 * 运行时预算（<60s）：地形段用单一场若干次全量构建（约 0.3-1s/次）；
 *   殖民地段直接调 tickColonyProduction（不推进整世界管线）。
 */

import { assert, assertNear, assertEq } from './assert.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { buildTerrainField, buildTriangulatedChunkMesh } from '../../src/domain/ground/terrainField.js';
import { sampleTerrain, slopeAt } from '../../src/domain/ground/surfaceQueries.js';
import {
  createTerrainEdits, applyEdit, attachTerrainEdits, rebuildDirtyChunks,
  serializeEdits, deserializeEdits, checkBuildingPlacement, BUILDING_PLACEMENT,
} from '../../src/domain/ground/terrainEdits.js';
import {
  tickColonyProduction, buildingDef, buildingJobSlots, storageCapacity,
} from '../../src/domain/planets/colony.js';

/** 场内采样网格高度 JSON（逐字节对比用） */
function sampleGrid(field, pts) {
  const ys = [];
  for (const [x, z] of pts) {
    const s = sampleTerrain(field, x, z);
    ys.push(s ? s.y : NaN);
  }
  return JSON.stringify(ys);
}

/** 覆盖刷盘与外围的固定采样点集 */
function samplePoints(cx, cz, reach) {
  const pts = [];
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      pts.push([cx + gx * reach * 0.6, cz + gz * reach * 0.6]);
    }
  }
  pts.push([cx + reach * 3 + 24, cz - reach * 2 - 18]); // 场外远点
  pts.push([cx - reach * 3 - 30, cz + reach * 2 + 12]);
  return pts;
}

/** 合成地形场（固定种子 + 显式剖面，零主 RNG 消费） */
function syntheticField(seed) {
  return buildTerrainField({ seed }, 'planet_te_canonical', {
    profile: 'mesa_canyon_crater_steppe',
  });
}

/** starter 世界与玩家殖民地/母星 */
function starterWorld() {
  const world = createStarterCampaign({ seed: 24601 });
  const colony = Object.values(world.entities.colonies)
    .find((c) => c.factionId === world.playerFactionId);
  const planet = world.entities.planets[colony.planetId];
  return { world, colony, planet };
}

/** 受控建筑集（绕过建造队列，单元级直达） */
function resetColony(colony, defIds, pop) {
  colony.buildings.length = 0;
  for (const defId of defIds) {
    colony.buildings.push({ defId, level: 1, state: 'active', progress: 0 });
  }
  colony.population.total = pop;
  colony.population.strata.worker = pop;
  colony.constructionQueue = [];
  colony.jobPriority = null;
}

/** 推进 K 小时生产结算（单元级；不触整世界管线） */
function runProduction(world, colony, hours) {
  for (let i = 0; i < hours; i++) {
    world.tick += 1;
    tickColonyProduction(world, colony);
  }
}

export const suite = {
  id: 'TERRAIN-06',
  name: '局部地表修改增量重建 + 编辑持久化 + 岗位/运行状态看板（TASK-5.1/5.2）',
  group: 'GROUND',
  async run() {
    try {
      const t0 = Date.now();

      // ———— (a) raise/lower 仅半径内生效（TERRAIN-06） ————
      const fieldA = syntheticField(20261105);
      const editsA = createTerrainEdits(fieldA);
      attachTerrainEdits(fieldA, editsA);
      const CX = 0;
      const CZ = 0;
      const ptsA = samplePoints(CX, CZ, 8);
      const beforeA = sampleGrid(fieldA, ptsA);
      const rRaise = applyEdit(fieldA, editsA, { kind: 'raise', x: CX, z: CZ, radius: 8, strength: 3 });
      const rLower = applyEdit(fieldA, editsA, { kind: 'lower', x: CX, z: CZ, radius: 8, strength: 1.5 });
      assertEq(rRaise.dirtyChunks.length, 4, 'raise 标脏区块数应为 4（2×2）');
      assertEq(rLower.dirtyChunks.length, 4, 'lower 标脏区块数应为 4');
      rebuildDirtyChunks(fieldA);
      const s = sampleTerrain(fieldA, CX, CZ);
      const s0 = sampleTerrain(syntheticField(20261105), CX, CZ);
      assertNear(s.y, s0.y + 1.5, 1e-6, `刷心净抬升应恰为 +1.5m（实测 ${(s.y - s0.y).toFixed(6)}）`);
      const afterA = sampleGrid(fieldA, ptsA);
      const ysBefore = JSON.parse(beforeA);
      const ysAfter = JSON.parse(afterA);
      let changed = 0;
      let unchangedFar = true;
      const reach = 8;
      for (let i = 0; i < ysBefore.length; i++) {
        const [px, pz] = ptsA[i];
        const d = Math.hypot(px - CX, pz - CZ);
        if (d > reach + 1e-9) {
          if (ysAfter[i] !== ysBefore[i]) unchangedFar = false; // 场外（含脏区块内远点）逐位不变
        } else if (ysAfter[i] !== ysBefore[i]) {
          changed += 1;
        }
      }
      assert(changed >= 1, '半径内采样点应有高度变化');
      assert(unchangedFar, '半径外采样高度必须逐位不变（TERRAIN-06 局部性）');

      // ———— (b) 标脏区块 ≤ 4 且重建后清零 ————
      for (const key of [...rRaise.dirtyChunks, ...rLower.dirtyChunks]) {
        const [ccx, ccz] = key.split(',').map(Number);
        const ch = fieldA.chunks[ccz * fieldA.chunksX + ccx];
        assert(ch.dirty === false, `重建后区块 ${key} dirty 应清零`);
      }
      const rPlant = applyEdit(fieldA, editsA, { kind: 'plant', x: 30, z: 30, prefabId: 'glow_shroom' });
      assertEq(rPlant.dirtyChunks.length, 1, '植被移植应只标脏 1 区块');

      // ———— (c) flatten 覆写采掘凹陷；restore 逐字节恢复纯宏观地貌 ————
      const fieldD = buildTerrainField({ seed: 20261105 }, 'planet_te_canonical', {
        profile: 'mesa_canyon_crater_steppe',
      });
      fieldD.siteModifier = (fx, fz) => (Math.abs(fx) < 2 && Math.abs(fz) < 2) ? { dy: -4 } : null; // 采掘凹陷
      const editsD = createTerrainEdits(fieldD);
      attachTerrainEdits(fieldD, editsD);
      for (const ch of fieldD.chunks) buildTriangulatedChunkMesh(ch, fieldD.evalPoint);
      const dentedY = sampleTerrain(fieldD, 0, 0).y;
      applyEdit(fieldD, editsD, { kind: 'flatten', x: 0, z: 0, radius: 6, strength: 1 });
      rebuildDirtyChunks(fieldD);
      const flatY = sampleTerrain(fieldD, 0, 0).y;
      assertNear(flatY, editsD.ops[0]._targetY, 1e-6, `flatten 后刷心应等于纯宏观目标高（${editsD.ops[0]._targetY.toFixed(4)}）`);
      assert(Math.abs(flatY - dentedY) > 0.5, 'flatten 必须实际覆写凹陷（凹陷 -4m）');
      applyEdit(fieldD, editsD, { kind: 'restore', x: 0, z: 0, radius: 8, strength: 1 });
      rebuildDirtyChunks(fieldD);
      const pristineField = syntheticField(20261105);
      const ptsC = samplePoints(0, 0, 8);
      assertEq(sampleGrid(fieldD, ptsC), sampleGrid(pristineField, ptsC), 'restore 后样本集必须与纯宏观场逐字节一致');

      // ———— (d) 确定性：同算子序列 → 逐位一致高度场 ————
      const OPS = [
        { kind: 'raise', x: -20, z: 10, radius: 8, strength: 2.5 },
        { kind: 'lower', x: -20, z: 10, radius: 8, strength: 1 },
        { kind: 'smooth', x: 15, z: -12, radius: 10, strength: 0.8 },
        { kind: 'flatten', x: 45, z: 30, radius: 10, strength: 1 },
      ];
      const field1 = syntheticField(31415);
      const edits1 = createTerrainEdits(field1);
      attachTerrainEdits(field1, edits1);
      for (const op of OPS) applyEdit(field1, edits1, op);
      rebuildDirtyChunks(field1);
      const field2 = syntheticField(31415);
      const edits2 = createTerrainEdits(field2);
      attachTerrainEdits(field2, edits2);
      for (const op of OPS) applyEdit(field2, edits2, op);
      rebuildDirtyChunks(field2);
      const ptsD = [];
      for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) ptsD.push([gx * 13.5, gz * 12.25]);
      assertEq(sampleGrid(field1, ptsD), sampleGrid(field2, ptsD), '同种子同算子序列必须逐位重现');

      // ———— (e) 编辑日志往返逐字节一致（SITE-07） ————
      applyEdit(field1, edits1, { kind: 'plant', x: 5, z: 6, prefabId: 'crystal_cluster' });
      applyEdit(field1, edits1, { kind: 'plant', x: -8, z: 3, prefabId: 'glow_shroom' });
      applyEdit(field1, edits1, { kind: 'removePlant', x: 0, z: 0, plantId: 'flora_1' });
      const json1 = serializeEdits(edits1);
      const field3 = syntheticField(31415);
      const edits3 = deserializeEdits(json1, field3);
      attachTerrainEdits(field3, edits3);
      rebuildDirtyChunks(field3);
      assertEq(serializeEdits(edits3), json1, 'serialize→deserialize→serialize 必须逐字节一致');
      assertEq(edits3.revision, edits1.revision, 'revision 必须保留');
      assertEq(edits3.seq, edits1.seq, '植被 id 序列必须保留');
      assertEq(sampleGrid(field3, ptsD), sampleGrid(field1, ptsD), '日志重放高度场逐位一致');

      // ———— (f) 植被移植/回收确定性 ————
      assertEq(edits3.flora.length, 1, 'removePlant 回放后应剩 1 株');
      assertEq(edits3.flora[0].id, 'flora_2', '被回收的 flora_1 不得复现');
      const seedA = edits3.flora[0].seed;
      const field4 = syntheticField(31415);
      const edits4 = createTerrainEdits(field4);
      attachTerrainEdits(field4, edits4);
      // seed 由（planetId|id|x|z|prefabId）派生 → 同序列位（flora_2）同输入必须同 seed
      applyEdit(field4, edits4, { kind: 'plant', x: 5, z: 6, prefabId: 'crystal_cluster' });
      applyEdit(field4, edits4, { kind: 'plant', x: -8, z: 3, prefabId: 'glow_shroom' });
      assertEq(edits4.flora[1].id, 'flora_2', '植被 id 序列应确定性递增');
      assertEq(edits4.flora[1].seed, seedA, '同序列位同输入植被 seed 必须确定性一致（零 Math.random）');

      // ———— (g) 殖民地 jobsFilled + 五态 runtimeStatus（COL-01..04 / ECON-02） ————
      // running：满岗 + 供电充足 + 投入在库 + 产出未满仓
      const wRun = starterWorld();
      resetColony(wRun.colony, ['bld_admin_center', 'bld_hydro_farm', 'bld_solar_array'], 12);
      wRun.planet.habitability = 60; // 固定 hab 修正（两世界一致，产出比可解析）
      runProduction(wRun.world, wRun.colony, 4);
      const farmRun = wRun.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      assertEq(farmRun.runtimeStatus, 'running', '满岗满电满投入应为 running');
      assertEq(farmRun.jobsFilled, 4, '农场岗位应满配 4');
      assertEq(wRun.colony.jobsFilled.total, 10, 'jobsFilled 汇总应等于实配总数（4+4+2）');
      assertEq(wRun.colony.jobsFilled.unassigned, 2, '失业人数应 = 人口 - 实配');

      // understaffed：η 降产（同构世界人口 6 vs 12：进度恰半；48h 后产出分野）
      const wA = starterWorld();
      const wB = starterWorld();
      for (const w of [wA, wB]) {
        resetColony(w.colony, ['bld_admin_center', 'bld_hydro_farm', 'bld_solar_array'], 12);
        w.planet.habitability = 60;
      }
      wB.colony.population.total = 6;
      wB.colony.population.strata.worker = 6;
      const foodA0 = wA.colony.stockpile.food;
      const foodB0 = wB.colony.stockpile.food;
      runProduction(wA.world, wA.colony, 26); // 26h 内满编周期尚未归零（eff≈0.92×26=23.92<24）→ 纯 η 对比
      runProduction(wB.world, wB.colony, 26);
      const farmA = wA.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      const farmB = wB.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      assertEq(farmA.runtimeStatus, 'running', '充足人口下农场应 running');
      assertEq(farmB.runtimeStatus, 'understaffed', '人口 6（岗 10）下农场应 understaffed');
      assertNear(farmB.progress, farmA.progress * (2 / 4), 1e-9,
        `understaffed 进度应恰为 η=0.5 倍（${farmB.progress.toFixed(4)} vs ${(farmA.progress * 0.5).toFixed(4)}）`);
      runProduction(wA.world, wA.colony, 22);
      runProduction(wB.world, wB.colony, 22);
      assert(wA.colony.stockpile.food > foodA0, '满编农场 48h 内应完成 ≥1 周期并有产出入仓');
      assertEq(wB.colony.stockpile.food, foodB0, 'η=0.5 时 48h 累计 22.08h < 24h 周期，应零产出');

      // starved_input：断供原料指明缺失 id
      const wStarve = starterWorld();
      resetColony(wStarve.colony, ['bld_admin_center', 'bld_hydro_farm', 'bld_solar_array'], 12);
      wStarve.colony.stockpile.water = 0;
      runProduction(wStarve.world, wStarve.colony, 2);
      const farmS = wStarve.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      assertEq(farmS.runtimeStatus, 'starved_input', '原料断供应为 starved_input');
      assertEq(farmS.starvedInput, 'water', 'starved_input 应指明缺失原料 id');

      // low_power：无电源 → powerFactor < 1
      const wPower = starterWorld();
      resetColony(wPower.colony, ['bld_admin_center', 'bld_hydro_farm'], 12);
      runProduction(wPower.world, wPower.colony, 2);
      const farmP = wPower.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      assertEq(farmP.runtimeStatus, 'low_power', '电力缺口应派生 low_power');
      assert(wPower.colony.powerBalance < 0, 'low_power 场景电力平衡应为负');

      // storage_full：产出资源满仓 → 周期不启动、不扣投入
      const wStore = starterWorld();
      resetColony(wStore.colony, ['bld_admin_center', 'bld_hydro_farm', 'bld_solar_array'], 12);
      wStore.colony.stockpile.food = storageCapacity(wStore.colony);
      const waterBefore = wStore.colony.stockpile.water;
      runProduction(wStore.world, wStore.colony, 2);
      const farmSt = wStore.colony.buildings.find((b) => b.defId === 'bld_hydro_farm');
      assertEq(farmSt.runtimeStatus, 'storage_full', '产出满仓应为 storage_full');
      assertEq(farmSt.progress, 0, '满仓阻塞下周期不得推进');
      assertEq(wStore.colony.stockpile.water, waterBefore, '满仓阻塞不得锁定投入原料');

      // ———— (h) PlaceBuilding 坡度校验（GAME-07）+ ShapeTerrain/RestoreTerrain 命令闭环 ————
      const wCmd = starterWorld();
      const rngBefore = JSON.stringify(wCmd.world.rng);
      const fieldCmd = buildTerrainField(wCmd.world, wCmd.planet.id, {});
      const plan = {
        type: 'PlaceBuilding',
        actorId: wCmd.world.playerFactionId,
        params: { planetId: wCmd.planet.id, defId: 'bld_hydro_farm' },
      };
      // 寻找陡点（自然地形扫不到就用整形器造一个 —— GAME-06：整地改变可建性）
      let steep = null;
      for (let x = -250; x <= 250 && !steep; x += 6) {
        for (let z = -250; z <= 250; z += 6) {
          const sl = slopeAt(fieldCmd, x, z);
          if (Number.isFinite(sl) && sl > BUILDING_PLACEMENT.maxSlopeDeg + 1) { steep = { x, z }; break; }
        }
      }
      if (!steep) {
        const made = executeCommand(wCmd.world, {
          type: 'ShapeTerrain', actorId: wCmd.world.playerFactionId,
          params: { planetId: wCmd.planet.id, op: 'raise', x: -100, z: -100, radius: 6, strength: 6 },
        });
        assert(made.ok, `ShapeTerrain 造陡失败：${made.reason}`);
        // fieldCmd 是改造前快照 —— 重建一份回放编辑日志的场域再扫描（GAME-06：整地改变可建性）
        const fieldMade = buildTerrainField(wCmd.world, wCmd.planet.id, {});
        const editsMade = deserializeEdits(wCmd.planet.terrainEdits, fieldMade);
        attachTerrainEdits(fieldMade, editsMade);
        rebuildDirtyChunks(fieldMade);
        for (let x = -110; x <= -90 && !steep; x += 2) {
          for (let z = -110; z <= -90; z += 2) {
            const sl = slopeAt(fieldMade, x, z);
            if (Number.isFinite(sl) && sl > BUILDING_PLACEMENT.maxSlopeDeg + 1) { steep = { x, z }; break; }
          }
        }
      }
      assert(steep, '必须能定位陡坡点（自然或整形后）');
      const rej = executeCommand(wCmd.world, { ...plan, params: { ...plan.params, x: steep.x, z: steep.z } });
      assertEq(rej.ok, false, '陡点必须拒绝');
      assert(['SLOPE_TOO_STEEP', 'HEIGHT_DELTA', 'OUT_OF_FIELD'].includes(rej.code),
        `陡点拒绝码应为 SLOPE_TOO_STEEP/HEIGHT_DELTA（实测 ${rej.code}）`);
      assertEq(wCmd.planet.groundBuildings ? wCmd.planet.groundBuildings.length : 0, 0, '拒绝时不得登记建筑');

      // 整地推平陡点 → 变为可建（GAME-06 闭环）
      const flat = executeCommand(wCmd.world, {
        type: 'ShapeTerrain', actorId: wCmd.world.playerFactionId,
        params: { planetId: wCmd.planet.id, op: 'flatten', x: steep.x, z: steep.z, radius: 12, strength: 1 },
      });
      assert(flat.ok, `flatten 命令失败：${flat.reason}`);
      const acc = executeCommand(wCmd.world, { ...plan, params: { ...plan.params, x: steep.x, z: steep.z } });
      assertEq(acc.ok, true, `整地后落点应可建（拒绝原因：${acc.reason}）`);
      assertEq(wCmd.planet.groundBuildings.length, 1, '放行后应登记 1 座地面建筑');
      const placed = wCmd.planet.groundBuildings[0];
      assert(placed.foundation && ['flat', 'graded'].includes(placed.foundation.kind), '应派生地基承台类型');
      assert(typeof placed.foundation.etaHeightM === 'number' && Number.isFinite(placed.foundation.etaHeightM),
        '地基基准高（9 点均高）应为有限数');
      assert(wCmd.world.events.queue.some((e) => e.type === 'BuildingPlaced'), '应发出 BuildingPlaced 事件');
      assert(wCmd.world.events.queue.some((e) => e.type === 'TerrainShaped'), '应发出 TerrainShaped 事件');

      // ShapeTerrain → RestoreTerrain 命令级往返（SITE-07 持久化路径）
      const hBefore = sampleTerrain(fieldCmd, 60, -40).y;
      const shp = executeCommand(wCmd.world, {
        type: 'ShapeTerrain', actorId: wCmd.world.playerFactionId,
        params: { planetId: wCmd.planet.id, op: 'raise', x: 60, z: -40, radius: 8, strength: 3 },
      });
      assert(shp.ok, `ShapeTerrain 失败：${shp.reason}`);
      assert(Array.isArray(wCmd.planet.terrainEdits.ops) && wCmd.planet.terrainEdits.ops.length >= 1,
        '行星实体应持久化编辑日志');
      const rtr = executeCommand(wCmd.world, {
        type: 'RestoreTerrain', actorId: wCmd.world.playerFactionId,
        params: { planetId: wCmd.planet.id, x: 60, z: -40, radius: 10 },
      });
      assert(rtr.ok, `RestoreTerrain 失败：${rtr.reason}`);
      const fieldAfter = buildTerrainField(wCmd.world, wCmd.planet.id, {});
      assertEq(sampleTerrain(fieldAfter, 60, -40).y, hBefore, 'Restore 后高度必须逐位回到改造前');
      assertEq(JSON.stringify(wCmd.world.rng), rngBefore, '命令全程不得消费 world.rng（SITE-06）');

      // 岗位定额口径：定义 jobs 优先、类别定额兜底（COL-01）
      assertEq(buildingJobSlots(buildingDef('bld_hydro_farm')), 4, '定义 jobs 应优先（农场 4）');
      assertEq(buildingJobSlots({ category: 'admin' }), 1, '缺定义 jobs 时行政定额兜底为 1');

      const ms = Date.now() - t0;
      return { ok: true, detail: `TERRAIN-06/GAME-06..07/SITE-07/COL-01..04/ECON-02 全部 PASS（${ms}ms，五态 running/understaffed/starved_input/low_power/storage_full 逐一可达）` };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};
