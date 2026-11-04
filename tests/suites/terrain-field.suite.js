/**
 * tests/suites/terrain-field.suite.js — 连续三角化地形门禁（doc7 TASK-1.1/1.2）
 *
 * TERRAIN-01 三角网格生成有限值断言：固定种子批量生成 100+ 张主题地表，
 *   所有顶点位置/法线/切线有限、无零面积退化三角形、无越界索引、
 *   材质权重四通道恒和 255、高度预算 [-40,+80]m。
 * TERRAIN-02 三角绕序与背面剔除一致性：所有三角形 (v1-v0)×(v2-v0) 的 y 分量为正
 *   （自 +Y 俯视严格 CCW，与 gl.frontFace(CCW)+CULL_FACE 正面可见结果一致）；
 *   「已知朝上地面三角形」（面法线与顶点均权平均法线均 ny>0.7，两判据一致认定）
 *   满足 cross·外法线 > 0。仅用顶点平均法线判定会在崖缘折皱处误判：
 *   陡壁三角形的角点法线被对面墙体面片拽偏（heightfield 折叠），面法线与
 *   顶点法线两判据一致时才是可靠的「朝上地面」；全局绕序由 cross.y>0 单独保证。
 *   区块接缝共享边顶点位置逐位一致（水密）。
 * SITE-06 种子确定性与主 RNG 零污染：同 world.seed+planetId 两次全场构建
 *   position+indices 逐字节一致；不同种子高度不同；真实开局世界构建前后
 *   world.rng 状态逐位不变（derivePlanetSeeds/terrainField 零消费主 RNG）。
 *
 * 运行时预算说明（<60s）：TERRAIN-01 用 100 种子 × 2 剖面共 200 场，但每场仅
 * 构建中央 2×2 区块（chunk(3,3)/(4,3)/(3,4)/(4,4)，覆盖陨坑/桌山/海沟最密区）；
 * 全场 8×8 构建由 TERRAIN-02（1 场）与 SITE-06（3 场）覆盖。
 */

import { assert, assertNear, assertEq } from './assert.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import {
  TERRAIN_FLAGS, createTerrainField, buildTriangulatedChunkMesh, buildTerrainField,
} from '../../src/domain/ground/terrainField.js';
import {
  sampleTerrain, raycastTerrain, slopeAt, isBuildableSlope, findPathSurface,
} from '../../src/domain/ground/surfaceQueries.js';
import { derivePlanetSeeds } from '../../src/domain/ground/planetSeeds.js';
import { TERRAIN_PROFILES, profileForPlanet } from '../../src/content/terrainProfiles.js';

/** FNV-1a 字节摘要（typed array 视作字节流） */
function bytesDigest(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let acc = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    acc ^= bytes[i];
    acc = Math.imul(acc, 0x01000193);
  }
  return acc >>> 0;
}

/** 全场 position+indices 摘要（SITE-06 逐字节一致性对拍） */
function fieldDigest(field) {
  let pos = 0x811c9dc5;
  let idx = 0x811c9dc5;
  for (const chunk of field.chunks) {
    pos = (Math.imul(pos ^ bytesDigest(chunk.vertices.position), 0x01000193)) >>> 0;
    idx = (Math.imul(idx ^ bytesDigest(chunk.indices), 0x01000193)) >>> 0;
  }
  return { pos, idx };
}

/** TERRAIN-01 单区块有限值/索引/权重/高度预算断言 */
function assertChunkSane(chunk, ctx) {
  const N = chunk.gridSize;
  const nn = N * N;
  const pos = chunk.vertices.position;
  const nor = chunk.vertices.normal;
  const tan = chunk.vertices.tangent;
  const wgt = chunk.vertices.materialWeights;
  const aux = chunk.vertices.aux;
  const indices = chunk.indices;

  // 高度预算 [-40, +80]（doc7 §3.1）
  if (!(chunk.bounds.minY >= -40 && chunk.bounds.maxY <= 80)) {
    throw new Error(`${ctx}: 高度预算越界 [${chunk.bounds.minY}, ${chunk.bounds.maxY}]`);
  }

  for (let v = 0; v < nn; v++) {
    const o = v * 3;
    if (!Number.isFinite(pos[o]) || !Number.isFinite(pos[o + 1]) || !Number.isFinite(pos[o + 2])) {
      throw new Error(`${ctx}: position[${v}] 非有限`);
    }
    if (!Number.isFinite(nor[o]) || !Number.isFinite(nor[o + 1]) || !Number.isFinite(nor[o + 2])) {
      throw new Error(`${ctx}: normal[${v}] 非有限`);
    }
    const nLen = Math.hypot(nor[o], nor[o + 1], nor[o + 2]);
    if (Math.abs(nLen - 1) > 1e-3) {
      throw new Error(`${ctx}: normal[${v}] 未归一化 |n|=${nLen}`);
    }
    if (nor[o + 1] < 0) {
      throw new Error(`${ctx}: normal[${v}] ny<0（未强制朝上）`);
    }
    if (!Number.isFinite(tan[o]) || !Number.isFinite(tan[o + 1]) || !Number.isFinite(tan[o + 2])) {
      throw new Error(`${ctx}: tangent[${v}] 非有限`);
    }
    const wSum = wgt[v * 4] + wgt[v * 4 + 1] + wgt[v * 4 + 2] + wgt[v * 4 + 3];
    if (Math.abs(wSum - 255) > 1) {
      throw new Error(`${ctx}: materialWeights[${v}] 和 ${wSum} ≠ 255`);
    }
    if (!Number.isFinite(aux[v * 2]) || !Number.isFinite(aux[v * 2 + 1])) {
      throw new Error(`${ctx}: aux[${v}] 非有限`);
    }
  }

  // 索引范围 + 无零面积退化三角形（叉积长度 > 1e-9）
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k];
    const b = indices[k + 1];
    const c = indices[k + 2];
    if (!(a >= 0 && b >= 0 && c >= 0 && a < nn && b < nn && c < nn)) {
      throw new Error(`${ctx}: 越界索引 (${a},${b},${c})`);
    }
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const b1x = pos[b * 3] - ax, b1y = pos[b * 3 + 1] - ay, b1z = pos[b * 3 + 2] - az;
    const c1x = pos[c * 3] - ax, c1y = pos[c * 3 + 1] - ay, c1z = pos[c * 3 + 2] - az;
    const cx = b1y * c1z - b1z * c1y;
    const cy = b1z * c1x - b1x * c1z;
    const cz = b1x * c1y - b1y * c1x;
    const area2 = Math.hypot(cx, cy, cz);
    if (!(area2 > 1e-9)) {
      throw new Error(`${ctx}: 零面积退化三角形 @${k / 3} (|cross|=${area2})`);
    }
  }
}

export const suite01 = {
  id: 'TERRAIN-01',
  name: '三角网格生成有限值断言（100 种子 × 2 剖面 × 中央 2×2 区块）',
  group: 'ground',
  async run() {
    try {
      const PROFILES = ['mesa_canyon_crater_steppe', 'obsidian_ridge_lava'];
      let fieldCount = 0;
      let chunkCount = 0;
      let triCount = 0;
      for (let k = 0; k < 100; k++) {
        // 固定种子表（可复现；seed 派生跨 k 充分散开）
        const world = { seed: (9100 + Math.imul(k, 7919)) >>> 0 };
        for (const profileId of PROFILES) {
          const field = createTerrainField(world, `planet_t01_${k}`, { profile: profileId });
          // 中央 2×2 区块（全场 8×8 构建由 TERRAIN-02/SITE-06 覆盖，控制运行时）
          for (const [cx, cz] of [[3, 3], [4, 3], [3, 4], [4, 4]]) {
            const chunk = field.chunks[cz * field.chunksX + cx];
            buildTriangulatedChunkMesh(chunk, field.evalPoint);
            assertChunkSane(chunk, `seed=${world.seed}/${profileId}/${chunk.id}`);
            chunkCount++;
            triCount += chunk.indices.length / 3;
          }
          fieldCount++;
        }
      }
      if (fieldCount < 100) return { ok: false, detail: `仅构建 ${fieldCount} 场（<100）` };
      return { ok: true, detail: `${fieldCount} 场 / ${chunkCount} 区块 / ${triCount} 三角形全部有限值 PASS` };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};

export const suite02 = {
  id: 'TERRAIN-02',
  name: '三角绕序与背面剔除一致性（全场 CCW + 接缝水密）',
  group: 'ground',
  async run() {
    try {
      // 典型主题场（含陨坑/桌山量化/沙纹/峡谷陡壁，绕序压力最大）
      const world = { seed: 20261105 };
      const field = buildTerrainField(world, 'planet_t02_canonical', {
        profile: 'mesa_canyon_crater_steppe',
      });

      let upChecked = 0;
      let faceUpChecked = 0;
      for (const chunk of field.chunks) {
        const pos = chunk.vertices.position;
        const nor = chunk.vertices.normal;
        const indices = chunk.indices;
        for (let k = 0; k < indices.length; k += 3) {
          const a = indices[k] * 3;
          const b = indices[k + 1] * 3;
          const c = indices[k + 2] * 3;
          const b1x = pos[b] - pos[a], b1y = pos[b + 1] - pos[a + 1], b1z = pos[b + 2] - pos[a + 2];
          const c1x = pos[c] - pos[a], c1y = pos[c + 1] - pos[a + 1], c1z = pos[c + 2] - pos[a + 2];
          const cx = b1y * c1z - b1z * c1y;
          const cy = b1z * c1x - b1x * c1z;
          const cz = b1x * c1y - b1y * c1x;
          // 全局绕序一致：自 +Y 俯视严格 CCW → 叉积 y 分量恒正（含竖直壁面）
          if (!(cy > 0)) {
            throw new Error(`${chunk.id} tri@${k / 3}: cross.y=${cy} ≤ 0（绕序非 CCW）`);
          }
          // 朝上地面三角形（面法线 ny>0.7）：顶点均权平均法线必未翻转（ny>0）
          let nx = nor[a] + nor[b] + nor[c];
          let ny = nor[a + 1] + nor[b + 1] + nor[c + 1];
          let nz = nor[a + 2] + nor[b + 2] + nor[c + 2];
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const cl = Math.hypot(cx, cy, cz) || 1;
          if (cy / cl > 0.7) {
            faceUpChecked++;
            if (!(ny > 0)) {
              throw new Error(`${chunk.id} tri@${k / 3}: 朝上面片顶点平均法线翻转 ny=${ny}`);
            }
            // 两判据一致认定「朝上地面」时：cross·外法线恒正（doc7 §2.2 单测语义）
            if (ny > 0.7) {
              const dot = cx * nx + cy * ny + cz * nz;
              if (!(dot > 0)) {
                throw new Error(`${chunk.id} tri@${k / 3}: cross·normal=${dot} ≤ 0`);
              }
              upChecked++;
            }
          }
        }
      }

      // 区块接缝：相邻区块共享边界顶点位置逐位一致（水密，零裂缝）
      const CM = field.chunkMeters;
      const EPS = 1e-6;
      let seamVerts = 0;
      for (let cz = 0; cz < field.chunksZ; cz++) {
        for (let cx = 0; cx < field.chunksX - 1; cx++) {
          const left = field.chunks[cz * field.chunksX + cx];
          const right = field.chunks[cz * field.chunksX + cx + 1];
          const N = left.gridSize;
          for (let j = 0; j < N; j++) {
            const lv = (j * N + (N - 1)) * 3;
            const rv = (j * N) * 3;
            const lp = left.vertices.position;
            const rp = right.vertices.position;
            if (Math.abs(lp[lv] - rp[rv]) > EPS || Math.abs(lp[lv + 1] - rp[rv + 1]) > EPS
              || Math.abs(lp[lv + 2] - rp[rv + 2]) > EPS) {
              throw new Error(`接缝 X ${left.id}↔${right.id} j=${j} 位置不连续`);
            }
            seamVerts++;
          }
        }
      }
      for (let cz = 0; cz < field.chunksZ - 1; cz++) {
        for (let cx = 0; cx < field.chunksX; cx++) {
          const bot = field.chunks[cz * field.chunksX + cx];
          const top = field.chunks[(cz + 1) * field.chunksX + cx];
          const N = bot.gridSize;
          const base = (N - 1) * N;
          for (let i = 0; i < N; i++) {
            const bp = bot.vertices.position;
            const tp = top.vertices.position;
            const bv = (base + i) * 3;
            const tv = i * 3;
            if (Math.abs(bp[bv] - tp[tv]) > EPS || Math.abs(bp[bv + 1] - tp[tv + 1]) > EPS
              || Math.abs(bp[bv + 2] - tp[tv + 2]) > EPS) {
              throw new Error(`接缝 Z ${bot.id}↔${top.id} i=${i} 位置不连续`);
            }
            seamVerts++;
          }
        }
      }

      // 接缝边界格元绕序抽检（与全局 CCW 一致；对角线选择逐格独立）
      for (const [cx, cz] of [[0, 0], [7, 0], [0, 7], [7, 7], [3, 4]]) {
        const chunk = field.chunks[cz * field.chunksX + cx];
        const N = chunk.gridSize;
        const pos = chunk.vertices.position;
        const cells = N - 1;
        const cellsToCheck = [
          [cells - 1, 0], [0, cells - 1], [cells - 1, cells - 1], [0, 0],
        ];
        for (const [i, j] of cellsToCheck) {
          const v00 = (j * N + i) * 3;
          const v10 = (j * N + i + 1) * 3;
          const v01 = ((j + 1) * N + i) * 3;
          const v11 = ((j + 1) * N + i + 1) * 3;
          // 与格元第一三角形 (v00,v01,v10/v11) 同向：(v01-v00)×(v10-v00) 的 y 分量
          const b1x = pos[v01] - pos[v00], b1y = pos[v01 + 1] - pos[v00 + 1], b1z = pos[v01 + 2] - pos[v00 + 2];
          const c1x = pos[v10] - pos[v00], c1y = pos[v10 + 1] - pos[v00 + 1], c1z = pos[v10 + 2] - pos[v00 + 2];
          const wy = b1z * c1x - b1x * c1z;
          if (!(wy > 0)) {
            throw new Error(`${chunk.id} 边界格 (${i},${j}) 绕序异常 cross.y=${wy}`);
          }
        }
      }

      return { ok: true, detail: `全场绕序 CCW；朝上面片 ${faceUpChecked}（双判据 ${upChecked} 点积为正）；接缝顶点 ${seamVerts} 对逐位一致` };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};

export const suite03 = {
  id: 'SITE-06',
  name: '种子确定性与主 RNG 零污染（SITE-06a/RNG 纯净/地表查询冒烟）',
  group: 'ground',
  async run() {
    try {
      // ———— SITE-06a：同 world.seed + planetId 逐字节一致；不同种子高度不同 ————
      const fieldA = buildTerrainField({ seed: 777001 }, 'planet_site06', {
        profile: 'mesa_canyon_crater_steppe',
      });
      const digestA = fieldDigest(fieldA);
      const fieldB = buildTerrainField({ seed: 777001 }, 'planet_site06', {
        profile: 'mesa_canyon_crater_steppe',
      });
      const digestB = fieldDigest(fieldB);
      assertEq(digestA.pos, digestB.pos, '同种子两场 position 摘要不一致');
      assertEq(digestA.idx, digestB.idx, '同种子两场 indices 摘要不一致');

      const fieldC = buildTerrainField({ seed: 777002 }, 'planet_site06', {
        profile: 'mesa_canyon_crater_steppe',
      });
      const digestC = fieldDigest(fieldC);
      assert(digestA.pos !== digestC.pos, '不同种子 position 摘要完全相同（确定性检验失效）');
      assert(
        fieldA.chunks[27].bounds.minY !== fieldC.chunks[27].bounds.minY
        || fieldA.chunks[27].bounds.maxY !== fieldC.chunks[27].bounds.maxY,
        '不同种子区块高度完全相同',
      );

      // ———— 主 RNG 零污染：真实开局世界构建前后 world.rng 状态逐位不变 ————
      const world = createStarterCampaign({ seed: 88123 });
      const rngBefore = JSON.stringify(world.rng);
      const planetIds = Object.keys(world.entities.planets);
      assert(planetIds.length >= 2, '开局世界行星数不足');
      buildTerrainField(world, planetIds[0], { profile: 'obsidian_ridge_lava' });
      buildTerrainField(world, planetIds[1], { profile: 'ocean_basin_reef_trench' });
      derivePlanetSeeds(world, planetIds[0]);
      const rngAfter = JSON.stringify(world.rng);
      assertEq(rngAfter, rngBefore, 'world.rng 状态被地表生成消费/漂移');

      // ———— 主题查表：themeId 优先，category 兜底，恒有回退 ————
      assertEq(profileForPlanet(null, 'obsidian_lava').id, 'obsidian_ridge_lava');
      assertEq(profileForPlanet({ category: 'desert' }, null).id, 'generic_desert');
      assertEq(profileForPlanet(null, 'unknown_theme').id, 'generic_rocky');
      for (const id of Object.keys(TERRAIN_PROFILES)) {
        const p = TERRAIN_PROFILES[id];
        assertEq(p.id, id, `剖面 ${id} id 字段不一致`);
        assert(p.materialPalette.length === 4, `剖面 ${id} materialPalette 非 4 通道`);
        assert(p.biomeIds.length >= 2, `剖面 ${id} biomeIds 不足`);
      }

      // ———— 地表查询冒烟（sampleTerrain/slopeAt/raycast/寻路，确定性 + 物理合理） ————
      const field = fieldA;
      const chunk = field.chunks[3 * field.chunksX + 3];
      const N = chunk.gridSize;
      // 采样 = 顶点精确值（格点上重心退化为单点）
      const vi = 10; const vj = 20;
      const vx = chunk.bounds.minX + vi;
      const vz = chunk.bounds.minZ + vj;
      const sV = sampleTerrain(field, vx, vz);
      assert(sV, '场内格点采样返回 null');
      assertNear(sV.y, chunk.vertices.position[(vj * N + vi) * 3 + 1], 1e-9, '格点采样高度 ≠ 顶点高度');
      assertNear(
        sV.weights[0] + sV.weights[1] + sV.weights[2] + sV.weights[3], 255, 1.5,
        '采样材质权重和 ≠ 255',
      );
      assert(sV.biomeId >= 0 && sV.biomeId < field.profile.biomeIds.length, 'biomeId 越界');
      // 半格采样落在四角高度范围内
      const sM = sampleTerrain(field, vx + 0.5, vz + 0.5);
      assert(sM, '半格采样返回 null');
      const yMin = Math.min(
        chunk.vertices.position[(vj * N + vi) * 3 + 1],
        chunk.vertices.position[(vj * N + vi + 1) * 3 + 1],
        chunk.vertices.position[((vj + 1) * N + vi) * 3 + 1],
        chunk.vertices.position[((vj + 1) * N + vi + 1) * 3 + 1],
      );
      const yMax = Math.max(
        chunk.vertices.position[(vj * N + vi) * 3 + 1],
        chunk.vertices.position[(vj * N + vi + 1) * 3 + 1],
        chunk.vertices.position[((vj + 1) * N + vi) * 3 + 1],
        chunk.vertices.position[((vj + 1) * N + vi + 1) * 3 + 1],
      );
      assert(sM.y >= yMin - 1e-9 && sM.y <= yMax + 1e-9, '半格采样高度越出四角包络');
      // 场地外返回 null
      assert(sampleTerrain(field, 9999, 0) === null, '场地外采样应返回 null');

      // 坡度与可建性
      const deg = slopeAt(field, vx, vz);
      assert(Number.isFinite(deg) && deg >= 0 && deg <= 90, `坡度异常: ${deg}`);
      assertEq(isBuildableSlope(field, vx, vz, 16), deg <= 16, 'isBuildableSlope 与 slopeAt 不一致');

      // 射线：垂直下击必命中且贴合采样高度；平飞（dir.y=0）稳健返回
      const rc = raycastTerrain(field, [vx, 120, vz], [0, -1, 0], 300);
      assert(rc.hit, '垂直射线未命中地形');
      assertNear(rc.point[0], vx, 1e-6, '命中点 x 漂移');
      assertNear(rc.point[2], vz, 1e-6, '命中点 z 漂移');
      assertNear(rc.point[1], sV.y, 0.02, '命中高度偏离采样高度');
      assert(rc.normal[1] > 0, '命中法线未朝上');
      const rcH = raycastTerrain(field, [0, 60, 0], [1, 0, 0], 200);
      assert(rcH && typeof rcH.hit === 'boolean', '平飞射线未返回结果对象');
      if (rcH.hit) assert(Number.isFinite(rcH.t) && rcH.t > 0, '平飞命中 t 非法');
      const rcMiss = raycastTerrain(field, [vx, 120, vz], [0, 1, 0], 64);
      assert(!rcMiss.hit, '朝天射线不应命中');

      // 寻路：平缓自定义场（amp 0.5 → 坡度近 0）内必达且确定性
      const flatField = createTerrainField({ seed: 501 }, 'planet_flat', {
        profile: {
          id: 'test_flat', label: '平缓测试场',
          base: 2, amp: 0.5, ridge: 0,
          materialPalette: ['a', 'b', 'c', 'd'],
          biomeIds: ['b0', 'b1'],
          hazardRule: 'none', flagsRule: 'none',
        },
      });
      buildTriangulatedChunkMesh(flatField.chunks[3 * flatField.chunksX + 3], flatField.evalPoint);
      buildTriangulatedChunkMesh(flatField.chunks[4 * flatField.chunksX + 4], flatField.evalPoint);
      const p1 = findPathSurface(flatField, -40, -40, 40, 40);
      assert(p1 && Array.isArray(p1.path) && p1.path.length >= 2, '平缓场寻路失败');
      assertNear(p1.path[0].x, -40, 1, '路径起点 x 偏移');
      assertNear(p1.path[p1.path.length - 1].x, 40, 1, '路径终点 x 偏移');
      assertNear(p1.path[p1.path.length - 1].z, 40, 1, '路径终点 z 偏移');
      assert(p1.cost >= 79 && p1.cost <= 200, `路径代价异常: ${p1.cost}`);
      for (const pt of p1.path) {
        assert(Number.isFinite(pt.x) && Number.isFinite(pt.z) && Number.isFinite(pt.y), '路径点非有限');
      }
      const p2 = findPathSurface(flatField, -40, -40, 40, 40);
      assertEq(JSON.stringify(p1), JSON.stringify(p2), '寻路两次结果不一致（确定性破坏）');

      // TERRAIN_FLAGS 位语义自检（BRIDGE_DECK/ROAD 越坡通行由寻路消费）
      assert(TERRAIN_FLAGS.BRIDGE_DECK === 32 && TERRAIN_FLAGS.ROAD === 1, 'TERRAIN_FLAGS 位值漂移');

      return { ok: true, detail: `SITE-06a 逐字节一致；RNG 零污染；查询冒烟通过（digest pos=${digestA.pos}）` };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};
