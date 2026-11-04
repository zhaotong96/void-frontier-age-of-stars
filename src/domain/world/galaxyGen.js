/**
 * domain/world/galaxyGen.js — 程序化星系生成（任务书 3.1 / 3.2 / 9.5 阶段02）
 *
 * 生成步骤（规范顺序）：
 *  1. 抖动网格采样星系坐标（带最小间距约束）
 *  2. k 近邻候选航路 + 长边剪除 + 连通性修复（UnionFind）
 *  3. 按空间区块分配恒星类型 / 资源带 / 危险度
 *  4. 生成行星槽位、环境与矿藏
 *  5. 异常点布置
 *  6. 文明出生点分配（贪心最远点 + 公平性验证，含扩张路径检查）
 *
 * 全程使用 world.rng（xoshiro128**），同种子同配置结果完全一致。
 */

import { RNG } from '../../core/rng.js';
import { clamp, dist, safeDivide } from '../../core/math.js';
import { kNearest, UnionFind, connectedComponents } from '../../core/spatial.js';
import { createEntity } from '../entities/registry.js';
import { BAL } from '../../content/constants.js';
import { generatePlanetPois } from '../ground/planetPOI.js';

export const STAR_TYPES = [
  { id: 'yellowDwarf', name: '黄矮星', weight: 34, habitZone: 1.0, energy: 1.0, danger: 0, scanNoise: 0.1 },
  { id: 'redDwarf', name: '红矮星', weight: 26, habitZone: 0.55, energy: 0.7, danger: 1, scanNoise: 0.2 },
  { id: 'blueGiant', name: '蓝巨星', weight: 8, habitZone: 2.4, energy: 1.6, danger: 3, scanNoise: 0.35 },
  { id: 'whiteDwarf', name: '白矮星', weight: 12, habitZone: 0.3, energy: 0.9, danger: 2, scanNoise: 0.25 },
  { id: 'neutronStar', name: '中子星', weight: 6, habitZone: 0.15, energy: 1.8, danger: 6, scanNoise: 0.7 },
  { id: 'pulsar', name: '脉冲星', weight: 5, habitZone: 0.2, energy: 1.7, danger: 5, scanNoise: 0.9 },
  { id: 'blackHole', name: '黑洞', weight: 4, habitZone: 0.05, energy: 1.2, danger: 8, scanNoise: 1.0 },
];

export const PLANET_CATEGORIES = [
  { id: 'rocky', name: '岩质行星', habitRange: [15, 55], deposit: 3.0, weight: 30 },
  { id: 'ocean', name: '海洋行星', habitRange: [25, 60], deposit: 1.6, weight: 10 },
  { id: 'ice', name: '冰封行星', habitRange: [5, 25], deposit: 2.2, weight: 16 },
  { id: 'desert', name: '沙漠行星', habitRange: [12, 40], deposit: 1.8, weight: 14 },
  { id: 'gasGiant', name: '气态巨行星', habitRange: [0, 0], deposit: 2.6, weight: 14 },
  { id: 'lava', name: '熔岩行星', habitRange: [0, 12], deposit: 4.2, weight: 9 },
  { id: 'toxic', name: '腐蚀大气行星', habitRange: [0, 15], deposit: 2.4, weight: 8 },
  { id: 'artificial', name: '人工改造天体', habitRange: [45, 75], deposit: 0.8, weight: 2 },
];

// 星系命名音节表（原创）
const NAME_A = ['泽', '维', '诺', '卡', '塞', '苍', '冥', '翎', '孤', '川', '岚', '珀', '烬', '泓', '曜', '桉', '湮', '缔', '穹', '犁'];
const NAME_B = ['尔', '拉', '昆', '瑟', '纳', '托', '菲', '隆', '伽', '希', '德', '穆', '叶', '瑞', '翁', '珞'];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function weightedPick(world, table) {
  let total = 0;
  for (const t of table) total += t.weight;
  let r = RNG.float(world) * total;
  for (const t of table) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return table[table.length - 1];
}

function genSystemName(world, used) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const n = NAME_A[RNG.int(world, NAME_A.length)] + NAME_B[RNG.int(world, NAME_B.length)];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  // 兜底：加编号
  const n = NAME_A[RNG.int(world, NAME_A.length)] + '-' + RNG.intRange(world, 2, 99);
  used.add(n);
  return n;
}

/**
 * 生成银河。config = {
 *   systemCount: 96,
 *   factionConfigs: [{ id?, name, adjective, personality, ethosTag, color, homeName?, originType? }],
 *   storyMode: false
 * }
 * 返回 { systemIds, factionIds, warnings }
 */
export function generateGalaxy(world, config = {}) {
  const sizeKey = world.galaxySize || 'standard';
  const systemCount = clamp(config.systemCount ?? BAL.galaxy.sizes[sizeKey] ?? 96, 24, 256);
  const W = 1000; // 策略空间坐标范围（0..1000）
  const usedNames = new Set();

  // 1. 抖动网格采样 —— 间距约束保证不重叠
  const cols = Math.ceil(Math.sqrt(systemCount * 1.35));
  const cell = W / cols;
  const points = [];
  for (let gy = 0; gy < cols && points.length < systemCount; gy++) {
    for (let gx = 0; gx < cols && points.length < systemCount; gx++) {
      const jx = cell * (0.15 + 0.7 * RNG.float(world));
      const jy = cell * (0.15 + 0.7 * RNG.float(world));
      points.push({
        idx: points.length, // 确定性索引（航路表键）
        x: clamp(gx * cell + jx, 8, W - 8),
        y: clamp(gy * cell + jy, 8, W - 8),
      });
    }
  }

  // 2. k 近邻候选航路（以 idx 为键）
  const avgNNDist = meanNearestDist(points);
  const prune = avgNNDist * BAL.galaxy.lanePruneFactor;
  const laneSets = new Map(); // idx -> Set(idx)
  for (const p of points) {
    p.knn = kNearest(points, p.x, p.y, 6).filter((e) => e.point.idx !== p.idx); // 排除自身
    laneSets.set(p.idx, new Set());
  }
  for (const p of points) {
    for (const { point: q, dist: d } of p.knn) {
      if (d <= prune) {
        laneSets.get(p.idx).add(q.idx);
        laneSets.get(q.idx).add(p.idx);
      }
    }
  }

  // 2b. 连通性修复：分量间用最短可用边桥接
  repairConnectivity(points, laneSets);

  // 2c. 保证每节点度数下限
  for (const p of points) {
    const set = laneSets.get(p.idx);
    if (set.size < BAL.galaxy.lanesPerNodeMin) {
      for (const { point: q } of p.knn) {
        if (set.size >= BAL.galaxy.lanesPerNodeMin) break;
        if (q.idx === p.idx) continue;
        set.add(q.idx);
        laneSets.get(q.idx).add(p.idx);
      }
    }
  }

  // 3. 空间区块特征：资源带与危险簇
  const richnessCenters = [];
  for (let i = 0; i < 4; i++) richnessCenters.push({ x: RNG.range(world, 100, W - 100), y: RNG.range(world, 100, W - 100), s: RNG.range(world, 90, 200) });
  const dangerCenters = [];
  for (let i = 0; i < BAL.galaxy.dangerClusters; i++) {
    dangerCenters.push({ x: RNG.range(world, 100, W - 100), y: RNG.range(world, 100, W - 100), s: RNG.range(world, 120, 240) });
  }

  // 4. 创建星系实体（先全体建档获得 ID，再回填航路）
  const systemIds = [];
  const sysIdByIdx = [];
  const sysData = [];
  for (const p of points) {
    const star = weightedPick(world, STAR_TYPES);
    const rich = gaussField(p.x, p.y, richnessCenters) * (star.id === 'blackHole' ? 0.6 : 1.0);
    const danger = clamp(gaussField(p.x, p.y, dangerCenters) + star.danger * 0.35 + RNG.range(world, -0.8, 0.8), 0, 10);
    const sys = createEntity(world, 'systems', {
      name: genSystemName(world, usedNames),
      x: p.x,
      y: p.y,
      star: {
        typeId: star.id,
        name: star.name,
        energy: star.energy,
        scanNoise: star.scanNoise,
      },
      lanes: [], // 回填
      planetIds: [],
      stationIds: [],
      anomalyIds: [],
      ownerFactionId: null,
      surveyedBy: {},          // factionId → 0 未接触 / 1 侦测 / 2 分类 / 3 定位 / 4 调查完成
      resourceRating: Math.round(rich * 10) / 10,
      dangerRating: Math.round(danger * 10) / 10,
      hazards: genHazards(world, star),
      flags: {},
    });
    systemIds.push(sys.id);
    sysIdByIdx[p.idx] = sys.id;
    sysData.push({ sys, p, star });

    // 行星：2-8 个
    const nPlanets = RNG.intRange(world, 2, 8);
    for (let orbit = 0; orbit < nPlanets; orbit++) {
      const cat = weightedPick(world, PLANET_CATEGORIES);
      const hz = orbitToHabitability(world, orbit, nPlanets, star, cat);
      const planet = createEntity(world, 'planets', {
        systemId: sys.id,
        orbitIndex: orbit,
        name: `${sys.name} ${NUMERALS[orbit] || orbit + 1}`,
        category: cat.id,
        categoryName: cat.name,
        radiusClass: RNG.intRange(world, 1, 5),        // 1 小 — 5 巨
        gravity: Math.round(RNG.range(world, 0.3, 1.9) * 10) / 10,
        temperatureBand: tempBand(cat.id),
        atmosphere: genAtmosphere(world, cat.id),
        radiation: Math.round(clamp(star.danger * 0.3 + RNG.range(world, 0, 2), 0, 6) * 10) / 10,
        habitability: hz,
        water: cat.id === 'ocean' ? RNG.intRange(world, 70, 95) : cat.id === 'ice' ? RNG.intRange(world, 30, 60) : RNG.intRange(world, 0, 40),
        deposits: genDeposits(world, cat, rich),
        maxDistricts: clamp(3 + Math.round(hz / 18) + (cat.id === 'gasGiant' ? 0 : 1), 3, 10),
        colonyId: null,
        terraform: null,      // { stage, progress }
      });
      // 持久 POI（doc5 §3.7）：行星子流确定性生成，随存档持久化；
      // 只消费 derivePlanetSeeds 子流，不触碰 world.rng 主序列
      planet.pois = generatePlanetPois(world, planet, star);
      sys.planetIds.push(planet.id);
    }

    // 异常点槽位（异常实体由 exploration 阶段在扫描时揭示）
    if (RNG.chance(world, BAL.galaxy.anomalyBaseChance + rich * 0.06)) {
      sys.flags.hasAnomalySlot = true;
    }
  }
  // 回填航路（映射 idx → system id，确定性排序）
  for (const { sys, p } of sysData) {
    sys.lanes = [...laneSets.get(p.idx)].map((idx) => sysIdByIdx[idx]).sort();
  }

  // 5. 文明出生点
  const factionIds = [];
  const warnings = [];
  if (config.factionConfigs && config.factionConfigs.length > 0) {
    const spawned = spawnFactions(world, config.factionConfigs, systemIds);
    factionIds.push(...spawned.factionIds);
    warnings.push(...spawned.warnings);
  }

  return { systemIds, factionIds, warnings };
}

function meanNearestDist(points) {
  let sum = 0;
  let n = 0;
  for (const p of points) {
    const nn = kNearest(points, p.x, p.y, 2);
    if (nn.length >= 2) {
      sum += nn[1].dist;
      n++;
    }
  }
  return safeDivide(sum, n, 60);
}

function repairConnectivity(points, laneSets) {
  const uf = new UnionFind(points.map((p) => p.idx));
  for (const [a, set] of laneSets) for (const b of set) uf.union(a, b);
  let comps = uf.components();
  let guard = 0;
  while (comps.length > 1 && guard++ < 64) {
    // 找分量间最短点对桥接（确定性：按 (dist, idxA, idxB) 排序）
    let best = null;
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        for (const ia of comps[i]) {
          const A = points.find((p) => p.idx === ia);
          for (const ib of comps[j]) {
            const B = points.find((p) => p.idx === ib);
            const d = dist(A.x, A.y, B.x, B.y);
            if (!best || d < best.d) best = { d, a: ia, b: ib };
          }
        }
      }
    }
    if (!best) break;
    laneSets.get(best.a).add(best.b);
    laneSets.get(best.b).add(best.a);
    uf.union(best.a, best.b);
    comps = uf.components();
  }
}

function gaussField(x, y, centers) {
  let v = 0;
  for (const c of centers) {
    const d = dist(x, y, c.x, c.y);
    v += Math.exp(-(d * d) / (2 * c.s * c.s));
  }
  return clamp(v, 0, 1.6);
}

function orbitToHabitability(world, orbit, total, star, cat) {
  // 宜居带中心随恒星类型移动；气态/熔岩行星不叠加宜居
  const zoneCenter = (total - 1) * star.habitZone * 0.42;
  const d = Math.abs(orbit - zoneCenter);
  const base = clamp(80 - d * 26 - star.danger * 3 + RNG.range(world, -12, 12), 0, 90);
  if (cat.habitRange[1] === 0) return 0; // 气态巨行星不可直接殖民
  return Math.round(clamp(base, cat.habitRange[0], cat.habitRange[1]));
}

function tempBand(catId) {
  const bands = {
    rocky: 'temperate', ocean: 'temperate', ice: 'cold', desert: 'hot',
    gasGiant: 'cold', lava: 'inferno', toxic: 'hot', artificial: 'temperate',
  };
  return bands[catId] || 'temperate';
}

function genAtmosphere(world, catId) {
  const table = {
    rocky: ['薄氮氧', '二氧化碳型', '稀薄'],
    ocean: ['湿润氮氧', '高湿'],
    ice: ['稀薄', '无大气'],
    desert: ['干燥二氧化碳', '尘暴型'],
    gasGiant: ['氢氦主导'],
    lava: ['硫化物', '高压'],
    toxic: ['酸性', '氯系'],
    artificial: ['受控生境'],
  };
  const arr = table[catId] || ['未知'];
  return arr[RNG.int(world, arr.length)];
}

const DEPOSIT_RESOURCES = ['ferro', 'silicate', 'rareEarth', 'heavyMetal', 'hydrogen', 'helium3', 'water'];
const DEPOSIT_PROFILE = {
  rocky: { ferro: 2.0, silicate: 2.2, heavyMetal: 0.8, rareEarth: 0.4 },
  ocean: { water: 3.0, ferro: 0.4, hydrocarbon: 0 },
  ice: { water: 2.4, hydrogen: 1.2, helium3: 0.6 },
  desert: { silicate: 1.8, rareEarth: 1.0, ferro: 0.8 },
  gasGiant: { hydrogen: 3.2, helium3: 2.2 },
  lava: { heavyMetal: 2.6, ferro: 2.0, rareEarth: 0.6 },
  toxic: { ferro: 1.0, heavyMetal: 1.2, hydrogen: 0.8 },
  artificial: { ferro: 0.4, silicate: 0.4 },
};

function genDeposits(world, cat, richness) {
  const prof = DEPOSIT_PROFILE[cat.id] || {};
  const out = {};
  for (const resId of DEPOSIT_RESOURCES) {
    const base = prof[resId] || 0;
    if (base > 0) {
      out[resId] = Math.round(base * (0.6 + richness) * RNG.range(world, 60, 160));
    }
  }
  return out;
}

function genHazards(world, star) {
  const h = [];
  if (star.id === 'neutronStar' || star.id === 'pulsar') h.push('pulsarInterference');
  if (star.id === 'blackHole') h.push('gravityWell');
  if (star.id === 'blueGiant' || star.id === 'whiteDwarf') h.push('radiationFlare');
  if (RNG.chance(world, 0.12)) h.push('asteroidDebris');
  return h;
}

/**
 * 出生点分配：贪心最远点采样 + 公平性验证。
 * 每个文明获得：母星系（必含一颗宜居≥45 行星）+ 邻近 1-2 系归属。
 */
function spawnFactions(world, configs, systemIds) {
  const S = world.entities.systems;
  const warnings = [];
  // 候选：宜居星系（有 hz>=45 行星），按资源降序为次序参考
  const candidates = systemIds
    .map((id) => S[id])
    .filter((s) => s.planetIds.some((pid) => world.entities.planets[pid].habitability >= 45));
  if (candidates.length < configs.length) {
    // 放宽标准
    candidates.length = 0;
    for (const id of systemIds) {
      const s = S[id];
      if (s.planetIds.some((pid) => world.entities.planets[pid].habitability >= 25)) candidates.push(s);
    }
    warnings.push('宜居候选不足，已放宽到 25 阈值');
  }
  candidates.sort((a, b) => b.resourceRating - a.resourceRating || (a.id < b.id ? -1 : 1));

  // 贪心最远点：先取资源最好者，之后每次取“距已选出生点最小距离最大”者
  const chosen = [];
  const pool = [...candidates];
  while (chosen.length < configs.length && pool.length > 0) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const minD = chosen.length === 0 ? Infinity : Math.min(...chosen.map((s) => dist(s.x, s.y, c.x, c.y)));
      const score = Math.min(minD, 9999) + c.resourceRating * 8;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
  }

  const factionIds = [];
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const home = chosen[i % chosen.length];
    const fac = createEntity(world, 'factions', {
      name: cfg.name,
      adjective: cfg.adjective || cfg.name,
      personality: cfg.personality || 'balanced',
      ethosTag: cfg.ethosTag || null,
      color: cfg.color || '#5ad1e6',
      originType: cfg.originType || 'homeworld',
      homeSystemId: home.id,
      isPlayer: !!cfg.isPlayer,
      policySlots: 3,
      policies: {},
    });
    factionIds.push(fac.id);
    if (cfg.isPlayer) world.playerFactionId = fac.id;

    // 母星系归属 + 找一颗宜居行星登记为母星
    home.ownerFactionId = fac.id;
    home.surveyedBy[fac.id] = 4;
    const homePlanet = home.planetIds
      .map((pid) => world.entities.planets[pid])
      .filter((p) => p.habitability >= 25)
      .sort((a, b) => b.habitability - a.habitability)[0];
    if (homePlanet) {
      fac.homePlanetId = homePlanet.id;
      homePlanet.homeOfFactionId = fac.id;
    }

    // 归属 1-2 个近邻
    const neighbors = home.lanes
      .map((lid) => S[lid])
      .filter((s) => s.ownerFactionId === null)
      .sort((a, b) => dist(home.x, home.y, a.x, a.y) - dist(home.x, home.y, b.x, b.y));
    const claimN = Math.min(neighbors.length, RNG.intRange(world, 1, 2));
    for (let k = 0; k < claimN; k++) neighbors[k].ownerFactionId = fac.id;
  }

  // 公平性：每个文明至少 2 条可扩张路径（含未归属航路邻接）
  for (const fid of factionIds) {
    const fac = world.entities.factions[fid];
    const owned = systemIds.map((id) => S[id]).filter((s) => s.ownerFactionId === fid);
    let frontier = 0;
    for (const s of owned) {
      for (const lid of s.lanes) if (S[lid].ownerFactionId === null) frontier++;
    }
    if (frontier < 2) warnings.push(`文明 ${fac.name} 扩张路径不足（${frontier}）`);
  }
  return { factionIds, warnings };
}
