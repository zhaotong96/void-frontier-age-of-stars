/**
 * tests/suites/world-gen.suite.js — WORLD-01: 星系生成确定性
 *
 * 覆盖：同种子两次生成逐字段一致（含 worldHash）、ID 唯一、无 NaN 坐标、
 * 航路图连通（connectedComponents===1）、每文明扩张前沿 ≥ 2（WORLD-03 公平性，
 * 与生成器自身的 warning 判定一致：出生归属 + 未归属航路邻接统计）、
 * 恒星类型合法（WORLD-02 属性域）、行星宜居度 0–90 且气巨为 0（WORLD-04 属性范围）。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { generateGalaxy, STAR_TYPES } from '../../src/domain/world/galaxyGen.js';
import { connectedComponents } from '../../src/core/spatial.js';
import { worldHash } from '../../src/core/serialization.js';
import { assert, assertEq } from './assert.js';

const SEEDS = [7, 77, 777];
const FACTIONS = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
const STAR_IDS = new Set(STAR_TYPES.map((t) => t.id));

function gen(seed) {
  const world = createWorld({ seed, galaxySize: 'story' });
  const res = generateGalaxy(world, { systemCount: 64, factionConfigs: FACTIONS });
  return { world, res };
}

/** 结构校验（对生成结果逐项断言） */
function checkStructure(world, res, seed) {
  const S = world.entities.systems;
  const P = world.entities.planets;

  assertEq(res.systemIds.length, 64, `seed ${seed}: 星系数应为 64`);
  assertEq(res.factionIds.length, 3, `seed ${seed}: 文明数应为 3`);

  // ID 唯一（systems + planets + factions 合并查重）
  const ids = new Set();
  for (const id of Object.keys(S)) ids.add(id);
  for (const id of Object.keys(P)) ids.add(id);
  for (const id of res.factionIds) ids.add(id);
  const total = Object.keys(S).length + Object.keys(P).length + res.factionIds.length;
  assertEq(ids.size, total, `seed ${seed}: 实体 ID 应全局唯一`);

  // 无 NaN 坐标 + 恒星类型合法 + 航路指向存在
  for (const id of res.systemIds) {
    const s = S[id];
    assert(
      Number.isFinite(s.x) && Number.isFinite(s.y),
      `seed ${seed}: 星系 ${id} 坐标含 NaN/Infinity (${s.x}, ${s.y})`
    );
    assert(
      STAR_IDS.has(s.star.typeId),
      `seed ${seed}: 星系 ${id} 恒星类型 ${s.star.typeId} 不在 STAR_TYPES`
    );
    for (const lid of s.lanes) {
      assert(!!S[lid], `seed ${seed}: 星系 ${id} 航路指向不存在的星系 ${lid}`);
    }
  }

  // 连通性：分量数 === 1
  const edges = new Map();
  for (const id of res.systemIds) edges.set(id, new Set(S[id].lanes));
  const comps = connectedComponents(res.systemIds, edges);
  assertEq(comps.length, 1, `seed ${seed}: 航路图应全连通，实测分量数 ${comps.length}`);

  // 行星属性范围：habitability ∈ [0, 90]，gasGiant === 0
  for (const id of Object.keys(P)) {
    const p = P[id];
    assert(
      p.habitability >= 0 && p.habitability <= 90,
      `seed ${seed}: 行星 ${id}(${p.category}) habitability=${p.habitability} 超出 [0,90]`
    );
    if (p.category === 'gasGiant') {
      assertEq(p.habitability, 0, `seed ${seed}: 气态巨行星 ${id} habitability 应为 0`);
    }
  }

  // 文明出生与公平性（WORLD-03）：出生星系 ownerFactionId 有值；
  // 每文明全部归属星系的未归属航路邻接（扩张前沿）≥ 2。
  for (const fid of res.factionIds) {
    const fac = world.entities.factions[fid];
    const home = S[fac.homeSystemId];
    assertEq(home.ownerFactionId, fid, `seed ${seed}: 文明 ${fac.name} 出生星系归属应为自身`);
    assert(home.lanes.length >= 2, `seed ${seed}: 出生星系航路数应 ≥ 2，实测 ${home.lanes.length}`);
    let frontier = 0;
    for (const sid of res.systemIds) {
      if (S[sid].ownerFactionId !== fid) continue;
      for (const lid of S[sid].lanes) {
        if (S[lid].ownerFactionId === null) frontier++;
      }
    }
    assert(
      frontier >= 2,
      `seed ${seed}: 文明 ${fac.name} 扩张前沿（无主邻接航路）仅 ${frontier} < 2`
    );
  }
}

export const suite = {
  id: 'WORLD-01',
  name: '星系生成确定性',
  group: 'world',
  async run() {
    try {
      for (const seed of SEEDS) {
        const a = gen(seed);
        const b = gen(seed);

        // 实体数量一致
        assertEq(
          Object.keys(a.world.entities.systems).length,
          Object.keys(b.world.entities.systems).length,
          `seed ${seed}: 两次生成星系数不一致`
        );
        assertEq(
          Object.keys(a.world.entities.planets).length,
          Object.keys(b.world.entities.planets).length,
          `seed ${seed}: 两次生成行星数不一致`
        );
        assertEq(a.res.factionIds.length, b.res.factionIds.length, `seed ${seed}: 文明数不一致`);

        // 第一个星系 id/x/y 一致（浮点确定性逐位比较）
        const sa = a.world.entities.systems[a.res.systemIds[0]];
        const sb = b.world.entities.systems[b.res.systemIds[0]];
        assertEq(sa.id, sb.id, `seed ${seed}: 第一个星系 id 不一致`);
        assertEq(sa.x, sb.x, `seed ${seed}: 第一个星系 x 不一致`);
        assertEq(sa.y, sb.y, `seed ${seed}: 第一个星系 y 不一致`);

        // 整世界哈希一致（最强确定性断言）
        assertEq(worldHash(a.world), worldHash(b.world), `seed ${seed}: 两次生成 worldHash 不一致`);

        // 结构校验
        checkStructure(a.world, a.res, seed);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
