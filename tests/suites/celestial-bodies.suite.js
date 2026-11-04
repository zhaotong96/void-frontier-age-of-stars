/**
 * tests/suites/celestial-bodies.suite.js — WORLD-02: 千种子天体构成分布（doc5 §5 / doc7 TASK-4.3）
 *
 * 覆盖（doc5 §3.2 处方 1 + §5 WORLD-02 门禁）：
 *  (a) 千种子批量：每星系行星数 ∈ [2,8]，全量均值 ≈5（±0.5）；
 *  (b) 伴生卫星：出现率聚合符合 doc5 表（gasGiant 0.85 / 其余 0.35，±0.08），
 *      gasGiant ≤3 颗，radiusRatio ∈ [0.22, 0.36]，kind/orbitRadius/速度域合法；
 *  (c) 小行星带：按恒星光谱出现率符合 doc5 表（±0.08）；
 *  (d) 确定性：同种子两次生成 moons/belts JSON 逐位一致；
 *  (e) RNG 纯度（B1 技术）：generatePlanetCelestials / generateSystemBelts
 *      不触碰 world.rng（调用前后主 RNG 状态逐位相同）；
 *  (f) JSON-serializability：全世界 JSON.stringify 往返一致（moons/belts 随档持久）。
 *
 * 零 GL 依赖；直接 import generateGalaxy 批量跑（systemCount 取下限 24 控制运行时 <45s）。
 */
import { createWorld } from '../../src/domain/world/World.js';
import {
  generateGalaxy, generatePlanetCelestials, generateSystemBelts,
  MOON_KINDS, BELT_CHANCE,
} from '../../src/domain/world/galaxyGen.js';
import { assert } from './assert.js';

const BATCH_SEEDS = 1000;
const SYSTEM_COUNT = 24; // generateGalaxy 下限（clamp 24..256），控制千种子运行时
const DET_SEEDS = [24601, 7, 97531];
const RATE_TOL = 0.08;

const BELT_TABLE = { ...BELT_CHANCE, __default: 0.55 }; // doc5 §3.2 默认光谱概率

function genWorld(seed) {
  const world = createWorld({ seed, galaxySize: 'story' });
  const res = generateGalaxy(world, { systemCount: SYSTEM_COUNT });
  return { world, res };
}

/** 收集一个世界全部行星/星系的天体数据（确定性键序） */
function extractCelestials(world, res) {
  const systems = res.systemIds.slice().sort().map((sid) => {
    const s = world.entities.systems[sid];
    return {
      id: s.id,
      star: s.star.typeId,
      belts: (s.belts || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
      planets: s.planetIds.slice().sort().map((pid) => {
        const p = world.entities.planets[pid];
        return {
          id: p.id,
          category: p.category,
          radiusClass: p.radiusClass,
          orbitPhase: p.orbitPhase,
          moons: (p.moons || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
        };
      }),
    };
  });
  return systems;
}

export const suite = {
  id: 'WORLD-02',
  name: '千种子天体构成分布（卫星/小行星带）',
  group: 'WORLD',
  async run() {
    try {
      let sysTotal = 0;
      let planetTotal = 0;
      let moonPlanetsGas = 0;
      let gasGiants = 0;
      let moonPlanetsOther = 0;
      let others = 0;
      let moonCountTotal = 0;
      const beltHits = {};   // typeId → [withBelt, total]
      let maxGasMoons = 0;

      // —— (a)(b)(c) 千种子批量统计 ——
      for (let i = 0; i < BATCH_SEEDS; i++) {
        const seed = 1000 + i * 7919; // 确定性伪随机种子游程（同批可复现）
        const { world, res } = genWorld(seed);
        const E = world.entities;
        for (const sid of res.systemIds) {
          const s = E.systems[sid];
          sysTotal++;
          const nPlanets = s.planetIds.length;
          assert(nPlanets >= 2 && nPlanets <= 8,
            `seed ${seed}: 星系 ${sid} 行星数 ${nPlanets} 超出 [2,8]`);
          planetTotal += nPlanets;
          const hasBelt = (s.belts || []).length > 0;
          const t = beltHits[s.star.typeId] || (beltHits[s.star.typeId] = [0, 0]);
          t[1]++;
          if (hasBelt) t[0]++;
          for (const pid of s.planetIds) {
            const p = E.planets[pid];
            const moons = p.moons || [];
            moonCountTotal += moons.length;
            // —— (b) 卫星域断言 ——
            if (p.category === 'gasGiant') {
              gasGiants++;
              if (moons.length > 0) moonPlanetsGas++;
              maxGasMoons = Math.max(maxGasMoons, moons.length);
            } else {
              others++;
              if (moons.length > 0) moonPlanetsOther++;
            }
            for (const m of moons) {
              assert(MOON_KINDS.indexOf(m.kind) >= 0, `卫星 ${m.id} kind 非法: ${m.kind}`);
              assert(m.radiusRatio >= 0.22 && m.radiusRatio <= 0.36,
                `卫星 ${m.id} radiusRatio ${m.radiusRatio} 超出 [0.22, 0.36]`);
              assert(m.orbitRadius >= 1.65 - 1e-9 && m.orbitRadius <= 2.75 + 1e-9,
                `卫星 ${m.id} orbitRadius ${m.orbitRadius} 超出 [1.65, 2.75]`);
              assert(m.orbitSpeed > 0, `卫星 ${m.id} orbitSpeed 应为正`);
              assert(Number.isFinite(m.orbitPhase) && m.orbitPhase >= 0 && m.orbitPhase < Math.PI * 2 + 1e-9,
                `卫星 ${m.id} orbitPhase 越界: ${m.orbitPhase}`);
            }
          }
        }
      }

      const meanPlanets = planetTotal / sysTotal;
      assert(Math.abs(meanPlanets - 5) <= 0.5,
        `行星均值 ${meanPlanets.toFixed(3)} 偏离 5 超过 ±0.5`);
      assertEq2(maxGasMoons <= 3, true, `气巨卫星数 ${maxGasMoons} 超过上限 3`);

      const gasRate = moonPlanetsGas / Math.max(1, gasGiants);
      const otherRate = moonPlanetsOther / Math.max(1, others);
      assert(Math.abs(gasRate - 0.85) <= RATE_TOL,
        `气巨卫星出现率 ${gasRate.toFixed(3)} 偏离 0.85 超过 ±${RATE_TOL}（n=${gasGiants}）`);
      assert(Math.abs(otherRate - 0.35) <= RATE_TOL,
        `非气巨卫星出现率 ${otherRate.toFixed(3)} 偏离 0.35 超过 ±${RATE_TOL}（n=${others}）`);

      for (const typeId of Object.keys(beltHits)) {
        const [hits, total] = beltHits[typeId];
        const expected = BELT_TABLE[typeId] != null ? BELT_TABLE[typeId] : BELT_TABLE.__default;
        const rate = hits / total;
        assert(Math.abs(rate - expected) <= RATE_TOL,
          `光谱 ${typeId} 带出现率 ${rate.toFixed(3)} 偏离 ${expected} 超过 ±${RATE_TOL}（n=${total}）`);
      }

      // —— (d) 确定性：同种子 moons/belts JSON 逐位一致 ——
      for (const seed of DET_SEEDS) {
        const wa = genWorld(seed);
        const wb = genWorld(seed);
        const ja = JSON.stringify(extractCelestials(wa.world, wa.res));
        const jb = JSON.stringify(extractCelestials(wb.world, wb.res));
        assert(ja === jb, `seed ${seed}: 两次生成的 moons/belts JSON 不一致`);
      }

      // —— (e) RNG 纯度（B1 技术）：纯生成器不触碰 world.rng ——
      {
        const w = createWorld({ seed: 12345 });
        const before = JSON.stringify(w.rng);
        for (let i = 0; i < 200; i++) {
          generatePlanetCelestials(w, { id: `plt_pur_${i}`, category: i % 2 ? 'gasGiant' : 'rocky', radiusClass: 1 + (i % 5), orbitIndex: i % 8 });
          generateSystemBelts(w, { id: `sys_pur_${i}`, star: { typeId: Object.keys(BELT_CHANCE)[i % 7] } }, 0.4 + (i % 10) * 0.12, 5);
        }
        assert(JSON.stringify(w.rng) === before, '天体生成器消费了主 world.rng（RNG 纯度违例）');
      }

      // —— (f) JSON 往返一致（全含 moons/belts 的世界） ——
      for (const seed of DET_SEEDS) {
        const { world } = genWorld(seed);
        const text1 = JSON.stringify(world);
        const text2 = JSON.stringify(JSON.parse(text1));
        assert(text1 === text2, `seed ${seed}: 世界 JSON 往返不一致`);
      }

      return { ok: true, stats: { meanPlanets: Number(meanPlanets.toFixed(3)), gasRate: Number(gasRate.toFixed(3)), otherRate: Number(otherRate.toFixed(3)), moonCountTotal } };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};

/** 本文件局部 deep-eq 断言（避免引入 assertEq 之外的工具） */
function assertEq2(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`断言失败${msg ? ' — ' + msg : ''}: 实际=${actual} 期望=${expected}`);
  }
}
