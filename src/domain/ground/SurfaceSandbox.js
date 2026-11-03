/**
 * domain/ground/SurfaceSandbox.js — 行星地表体素沙盒数据层（返工 Phase R8）
 *
 * 纯逻辑层（无 DOM / 无 WebGL）：三维体素世界的确定性生成、挖掘/放置、
 * DDA 射线拾取、贪心共面合并（Mikola Lysenko / 0fps 算法，AO 感知）
 * 与地表寻路。渲染层 PlanetSurface3D 消费本模块的网格输出。
 *
 * 世界规格：
 *  - 64×24×64（X×Y×Z）单体素世界，分 4×4 个 16×16×24 列区块；
 *  - 材质 ID：0=air 1=surface 2=rock 3=ore_ferro 4=ore_silicate
 *    5=ore_rare 6=ore_heavy 7=bedrock 8=building；
 *  - 地貌：表面层（风化表土）/ 地下矿石层（岩层 + 矿脉）/ 基岩层（不可采）；
 *  - 按 planet.category（8 大类）差异化高度/山脊/洞穴/矿脉丰度；
 *  - planet.deposits 资量对数映射为确定性矿脉数量（Ore Voxel Veins）。
 *
 * 确定性（GROUND-01 兼容）：
 *  - 种子 = world.seed ^ hash32(planetId)，全部噪声/矿脉/采样由该种子派生；
 *  - 全程零 Math.random；同 seed 同输入 → 体素网格与网格化输出逐位一致。
 *
 * 本文件输出的顶点颜色已烘焙：材质基色 × 行星地表色调 × 逐角点 AO，
 * 渲染层只需叠加方向光与雾。
 */

import { seedFromNumber, nextU32, int } from '../../core/rng.js';

// ———— 常量 ————

/** 世界与分块尺寸（X×Y×Z = 64×24×64，区块 16×16 列 × 24 高） */
export const SURFACE_SIZE = {
  X: 64, Y: 24, Z: 64,
  CHUNK: 16,
  CHUNKS_X: 4, CHUNKS_Z: 4,
  CHUNK_COUNT: 16,
};

/** 体素材质 ID 表 */
export const SURFACE_MAT = {
  AIR: 0,
  SURFACE: 1,      // 表面层：风化表土/沙壤（按行星类别着色）
  ROCK: 2,         // 地下岩层
  ORE_FERRO: 3,    // 铁族矿脉
  ORE_SILICATE: 4, // 硅质矿脉
  ORE_RARE: 5,     // 稀土矿脉
  ORE_HEAVY: 6,    // 重金属矿脉
  BEDROCK: 7,      // 基岩：不可挖掘
  BUILDING: 8,     // 建筑结构体素
};

/** 材质基色（线性 RGB；index 即材质 ID）。surface 的色调由行星类别 tint 乘出 */
export const MATERIAL_COLORS = [
  [0.00, 0.00, 0.00], // 0 air（不渲染）
  [0.55, 0.47, 0.36], // 1 surface
  [0.40, 0.41, 0.45], // 2 rock
  [0.78, 0.46, 0.28], // 3 ore_ferro
  [0.52, 0.74, 0.76], // 4 ore_silicate
  [0.66, 0.42, 0.88], // 5 ore_rare
  [0.44, 0.72, 0.44], // 6 ore_heavy
  [0.15, 0.15, 0.18], // 7 bedrock
  [0.62, 0.64, 0.68], // 8 building
];

/** 矿脉材质 → 资源 id（挖掘入账映射） */
export const ORE_RESOURCE_BY_MAT = {
  3: 'ferro', 4: 'silicate', 5: 'rareEarth', 6: 'heavyMetal',
};

/** 面法线表（+x -x +y -y +z -z），贪心网格化的 normalIndex 引用 */
const NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * 8 大行星类别的地貌参数：
 *  base/amp  基准高度 / 噪声振幅（体素）
 *  ridge     山脊噪声权重（ice/lava 起伏最大）
 *  ore       矿脉数量系数
 *  cave      洞穴雕刻强度（0..0.25，3D 噪声阈值偏移）
 *  tint      表面材质色调（乘入顶点色）
 *  isle      true = 悬浮平台（气态巨行星：边缘之外为虚空）
 */
export const CATEGORY_TERRAIN = {
  rocky:      { base: 9.0,  amp: 3.8, ridge: 0.50, ore: 1.0, cave: 0.10, tint: [1.00, 0.90, 0.76] },
  ocean:      { base: 6.5,  amp: 2.6, ridge: 0.15, ore: 0.7, cave: 0.05, tint: [0.58, 0.78, 0.72] },
  ice:        { base: 10.0, amp: 4.4, ridge: 0.70, ore: 0.9, cave: 0.08, terrace: 2, tint: [0.85, 0.92, 1.00] },
  desert:     { base: 8.0,  amp: 3.0, ridge: 0.20, ore: 1.1, cave: 0.08, tint: [1.00, 0.86, 0.58] },
  gasGiant:   { base: 11.0, amp: 2.0, ridge: 0.10, ore: 1.3, cave: 0.04, tint: [0.96, 0.82, 0.62], isle: true },
  lava:       { base: 9.0,  amp: 4.0, ridge: 0.55, ore: 1.5, cave: 0.10, terrace: 2, tint: [0.66, 0.46, 0.42] },
  toxic:      { base: 8.5,  amp: 3.8, ridge: 0.40, ore: 1.2, cave: 0.12, tint: [0.64, 0.76, 0.46] },
  artificial: { base: 9.5,  amp: 1.4, ridge: 0.06, ore: 0.6, cave: 0.04, tint: [0.80, 0.82, 0.88] },
};

// ———— 基础工具 ————

/** FNV-1a 32 位哈希：接受字符串或数字（planetId 兼容两种形态） */
export function hash32(v) {
  const s = String(v);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 确定性 [0,1) 浮点（仅用于形状扰动，绝不进模拟状态） */
function rngFloat(s) {
  return nextU32(s) / 4294967296;
}

/** [lo, hi] 闭区间整数的确定性取样 */
function rngIntRange(s, lo, hi) {
  return lo + int(s, hi - lo + 1);
}

/** 数值钳制 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ———— 确定性 Simplex 噪声（2D/3D，Gustavson 公版实现移植） ————

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

/** 12 个梯度方向（展开存储，g*3 取行） */
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/**
 * 创建种子派生的 2D/3D Simplex 噪声。
 * 置换表由 splitmix32 派生的 xoshiro128** 状态做 Fisher-Yates 洗牌 ——
 * 完全确定性，绝不触碰 Math.random。
 * @returns {{ noise2D:(x:number,y:number)=>number, noise3D:(x:number,y:number,z:number)=>number }}
 */
export function createSimplexNoise(seed) {
  const st = seedFromNumber(seed >>> 0);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = nextU32(st) % (i + 1);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const gi2 = (ii, jj) => (p[ii + p[jj]] % 12) * 3;
  const gi3 = (ii, jj, kk) => (p[ii + p[jj + p[kk]]] % 12) * 3;

  /** 2D Simplex，返回约 [-1,1] */
  function noise2D(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1; let j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = gi2(ii, jj);
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = gi2(ii + i1, jj + j1);
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = gi2(ii + 1, jj + 1);
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
    }
    return 70 * n;
  }

  /** 3D Simplex，返回约 [-1,1] */
  function noise3D(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    // 六面体排序确定两个角点（标准 Gustavson 分支）
    let i1; let j1; let k1; let i2; let j2; let k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = gi3(ii, jj, kk);
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = gi3(ii + i1, jj + j1, kk + k1);
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = gi3(ii + i2, jj + j2, kk + k2);
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = gi3(ii + 1, jj + 1, kk + 1);
      t3 *= t3;
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
    }
    return 32 * n;
  }

  return { noise2D, noise3D };
}

/** 分形布朗运动（2D）：octaves 个八度叠加，输出约 [-1,1] */
function fbm2(noise, x, y, octaves, lac = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise2D(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/** 分形布朗运动（3D） */
function fbm3(noise, x, y, z, octaves, lac = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise3D(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

// ———— 世界创建 ————

/**
 * 创建行星地表体素世界（纯数据实体，可随存档序列化体素主数组）。
 * @param {object} world 世界实体（只读取 world.seed 与 entities 中的行星档案）
 * @param {string|number} planetId 行星实体 id
 * @param {{category?:string, deposits?:object, atmosphere?:string, starTypeId?:string}} [opts]
 *        行星档案缺失时的兜底输入（保持函数可独立测试）
 * @returns {object} surfaceWorld 实体
 */
export function createSurfaceWorld(world, planetId, opts = {}) {
  const { X, Y, Z, CHUNKS_X, CHUNKS_Z } = SURFACE_SIZE;
  const seed = (world.seed >>> 0) ^ hash32(planetId);

  // 行星档案：8 大类 + 矿脉储量 + 大气（缺省回落 rocky）
  const planet = world.entities && world.entities.planets ? world.entities.planets[planetId] : null;
  const system = planet && world.entities.systems ? world.entities.systems[planet.systemId] : null;
  const category = (opts.category || (planet && planet.category) || 'rocky');
  const deposits = opts.deposits || (planet && planet.deposits) || {};
  const atmosphere = opts.atmosphere || (planet && planet.atmosphere) || '';
  const starTypeId = opts.starTypeId || (system && system.star ? system.star.typeId : 'yellowDwarf');

  const sw = {
    kind: 'surfaceWorld',
    planetId,
    category,
    atmosphere,
    starTypeId,
    seed,
    sx: X, sy: Y, sz: Z,
    voxels: new Uint8Array(X * Y * Z),
    heights: new Int8Array(X * Z),           // 每列最高非空体素 y（-1 = 空列）
    chunks: [],
    spawn: { x: X / 2 + 0.5, y: Y - 2, z: Z / 2 + 0.5 },
    stats: { dug: 0, placed: 0, mined: {} },
  };
  for (let cz = 0; cz < CHUNKS_Z; cz++) {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      sw.chunks.push({ cx, cz, dirty: true });
    }
  }

  _generateTerrain(sw, deposits);
  sw.spawn = findSpawnPoint(sw);
  return sw;
}

/** 体素线性索引（y 主序：与渲染层共享布局） */
function idx(sw, x, y, z) {
  return (y * sw.sz + z) * sw.sx + x;
}

/**
 * 地形生成：fBm 大陆起伏 + 山脊噪声 + 3D 洞穴 + 分层材质 + 悬浮平台边缘衰减。
 * 噪声种子与矿脉 RNG 相互独立派生，保证增删矿脉不影响地貌。
 */
function _generateTerrain(sw, deposits) {
  const { X, Y, Z } = SURFACE_SIZE;
  const prof = CATEGORY_TERRAIN[sw.category] || CATEGORY_TERRAIN.rocky;
  const noise = createSimplexNoise((sw.seed ^ 0x1a2b3c4d) >>> 0);
  const v = sw.voxels;

  for (let z = 0; z < Z; z++) {
    for (let x = 0; x < X; x++) {
      // —— 高度场：大陆 fBm + 山脊（ridged）噪声（3 八度控制碎面数量） ——
      const cont = fbm2(noise, x * 0.042, z * 0.042, 3);
      let ridge = 1 - Math.abs(noise.noise2D(x * 0.021 + 37.2, z * 0.021 - 11.7));
      ridge = ridge * ridge;
      let h = prof.base + cont * prof.amp + ridge * prof.ridge * prof.amp;

      // 海洋类：洼地峡谷（低频负值区下切）；人工天体：台地量化；
      // 冰封/熔岩：阶地量化（梯田式平台显著改善贪心合并，兼具地貌辨识度）
      if (sw.category === 'ocean' && cont < -0.18) h -= 2.4;
      if (sw.category === 'artificial') h = Math.round(h / 3) * 3;
      if (prof.terrace) h = Math.floor(h / prof.terrace) * prof.terrace + 1;

      // 悬浮平台（气态巨行星）：Chebyshev 边缘 + 噪声海岸线之外的列为虚空
      if (prof.isle) {
        const d = Math.max(Math.abs(x - (X - 1) / 2), Math.abs(z - (Z - 1) / 2)) / ((X - 1) / 2);
        const edge = 0.80 + fbm2(noise, x * 0.09 + 91, z * 0.09 - 45, 2) * 0.10;
        if (d > edge) {
          sw.heights[z * X + x] = -1;
          continue;
        }
      }

      const top = clamp(Math.round(h), 3, SURFACE_SIZE.Y - 5);
      for (let y = 0; y <= top; y++) {
        let mat = SURFACE_MAT.ROCK;
        if (y === top) mat = SURFACE_MAT.SURFACE;
        else if (y <= 1) mat = SURFACE_MAT.BEDROCK;          // 基岩层（不可采）
        // —— 3D 洞穴雕刻（保留 2 层表壳与基岩完整；高阈值控制暴露面数量） ——
        if (y > 2 && y < top - 2 && prof.cave > 0) {
          const c = fbm3(noise, x * 0.085, y * 0.125, z * 0.085, 2);
          if (c > 0.68 - prof.cave) mat = SURFACE_MAT.AIR;
        }
        v[idx(sw, x, y, z)] = mat;
      }
      sw.heights[z * X + x] = top;
    }
  }

  // —— Ore Voxel Veins：planet.deposits 资量 → 确定性随机游走矿脉 ——
  _embedOreVeins(sw, deposits, prof);
}

/**
 * 矿脉嵌入：每种资源按 log2(储量) 生成矿脉条数（受类别 ore 系数与上限约束），
 * 每条矿脉为 5..16 步随机游走 + 1..2 体素半径团簇，只替换岩层（不动表面/基岩）。
 */
function _embedOreVeins(sw, deposits, prof) {
  const { X, Y, Z } = SURFACE_SIZE;
  const rng = seedFromNumber((sw.seed ^ 0x51ed270b) >>> 0);
  const v = sw.voxels;
  for (const resId of ['ferro', 'silicate', 'rareEarth', 'heavyMetal']) {
    const amount = deposits[resId];
    if (!(amount > 0)) continue;
    const matId = Number(Object.keys(ORE_RESOURCE_BY_MAT).find((k) => ORE_RESOURCE_BY_MAT[k] === resId));
    const veins = clamp(Math.round(Math.log2(amount + 2) * prof.ore), 2, 26);
    for (let n = 0; n < veins; n++) {
      let vx = int(rng, X);
      let vz = int(rng, Z);
      let vy = rngIntRange(rng, 3, Y - 6);      // 矿脉埋藏在地下层
      const steps = rngIntRange(rng, 5, 16);
      for (let s = 0; s < steps; s++) {
        const r = rngFloat(rng) < 0.35 ? 1 : 0; // 团簇半径（0=单块，1=3×3×3）
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              const bx = vx + dx;
              const by = vy + dy;
              const bz = vz + dz;
              if (bx < 0 || bx >= X || by < 2 || by >= Y || bz < 0 || bz >= Z) continue;
              const i = idx(sw, bx, by, bz);
              if (v[i] === SURFACE_MAT.ROCK) v[i] = matId; // 只侵入岩层
            }
          }
        }
        vx = clamp(vx + int(rng, 3) - 1, 0, X - 1);
        vy = clamp(vy + int(rng, 3) - 1, 2, Y - 4);
        vz = clamp(vz + int(rng, 3) - 1, 0, Z - 1);
      }
    }
  }
}

// ———— 体素访问 ————

/**
 * 读取体素材质。越界：y 超层返回 AIR；x/z 越界返回 AIR（世界边缘可视）。
 * @returns {number} 材质 ID
 */
export function getVoxel(sw, x, y, z) {
  const { X, Y, Z } = SURFACE_SIZE;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  if (yi < 0 || yi >= Y || xi < 0 || xi >= X || zi < 0 || zi >= Z) return SURFACE_MAT.AIR;
  return sw.voxels[(yi * sw.sz + zi) * sw.sx + xi];
}

/** 列顶扫描：重算 heights 缓存（在 set/dig 后调用） */
function _rescanColumn(sw, x, z) {
  const { X, Y } = SURFACE_SIZE;
  for (let y = Y - 1; y >= 0; y--) {
    if (sw.voxels[(y * sw.sz + z) * sw.sx + x] !== SURFACE_MAT.AIR) {
      sw.heights[z * X + x] = y;
      return;
    }
  }
  sw.heights[z * X + x] = -1;
}

/** 标记体素所属区块与（跨界时的）邻接区块为脏 */
function _markDirty(sw, x, z) {
  const { CHUNK, CHUNKS_X, CHUNKS_Z } = SURFACE_SIZE;
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const mark = (a, b) => {
    if (a < 0 || a >= CHUNKS_X || b < 0 || b >= CHUNKS_Z) return;
    sw.chunks[b * CHUNKS_X + a].dirty = true;
  };
  mark(cx, cz);
  const lx = x - cx * CHUNK;
  const lz = z - cz * CHUNK;
  if (lx === 0) mark(cx - 1, cz);
  if (lx === CHUNK - 1) mark(cx + 1, cz);
  if (lz === 0) mark(cx, cz - 1);
  if (lz === CHUNK - 1) mark(cx, cz + 1);
}

/**
 * 原始写体素（含边界检查，供挖掘/放置/直接改造共用）。
 * @returns {boolean} 是否实际写入
 */
export function setVoxel(sw, x, y, z, matId) {
  const { X, Y, Z } = SURFACE_SIZE;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  if (yi < 0 || yi >= Y || xi < 0 || xi >= X || zi < 0 || zi >= Z) return false;
  if (!Number.isInteger(matId) || matId < SURFACE_MAT.AIR || matId > SURFACE_MAT.BUILDING) return false;
  const i = (yi * sw.sz + zi) * sw.sx + xi;
  if (sw.voxels[i] === matId) return false;
  sw.voxels[i] = matId;
  _markDirty(sw, xi, zi);
  if (yi >= sw.heights[zi * X + xi]) {
    // 写入/删除当前顶面及以上：置顶或重扫该列
    if (matId !== SURFACE_MAT.AIR) sw.heights[zi * X + xi] = yi;
    else _rescanColumn(sw, xi, zi);
  }
  return true;
}

/**
 * 挖掘体素：基岩不可挖；矿脉按 ORE_RESOURCE_BY_MAT 入账。
 * @returns {{ matId:number, resourceDrop:{resId:string, amount:number}|null }}
 */
export function digVoxel(sw, x, y, z) {
  const matId = getVoxel(sw, x, y, z);
  if (matId === SURFACE_MAT.AIR || matId === SURFACE_MAT.BEDROCK) {
    return { matId, resourceDrop: null }; // 空气/基岩：不可挖掘
  }
  if (!setVoxel(sw, x, y, z, SURFACE_MAT.AIR)) {
    return { matId, resourceDrop: null };
  }
  sw.stats.dug++;
  let resourceDrop = null;
  const resId = ORE_RESOURCE_BY_MAT[matId];
  if (resId) {
    resourceDrop = { resId, amount: 1 };
    sw.stats.mined[resId] = (sw.stats.mined[resId] || 0) + 1;
  } else if (matId === SURFACE_MAT.BUILDING) {
    resourceDrop = { resId: 'alloy', amount: 1 }; // 拆除建筑结构回收合金
  }
  return { matId, resourceDrop };
}

/**
 * 放置体素：仅允许写入空气格（已有体素需先挖掘）。
 * @returns {boolean}
 */
export function placeVoxel(sw, x, y, z, matId) {
  if (getVoxel(sw, x, y, z) !== SURFACE_MAT.AIR) return false;
  if (!setVoxel(sw, x, y, z, matId)) return false;
  sw.stats.placed++;
  return true;
}

// ———— DDA 射线（Amanatides & Woo） ————

/**
 * 体素 DDA 射线步进：返回命中的体素坐标、进入面法线与材质。
 * @param {{x:number,y:number,z:number}} origin 射线起点（世界坐标）
 * @param {{x:number,y:number,z:number}|number[]} dir 单位方向
 * @param {number} maxDist 最大步进距离
 * @returns {{ hit:boolean, vx:number, vy:number, vz:number, nx:number, ny:number, nz:number, matId:number, t:number }}
 */
export function ddaRaycast(sw, origin, dir, maxDist = 8) {
  const ox = origin[0] !== undefined ? origin[0] : origin.x;
  const oy = origin[1] !== undefined ? origin[1] : origin.y;
  const oz = origin[2] !== undefined ? origin[2] : origin.z;
  const dx = dir[0] !== undefined ? dir[0] : dir.x;
  const dy = dir[1] !== undefined ? dir[1] : dir.y;
  const dz = dir[2] !== undefined ? dir[2] : dir.z;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  const miss = { hit: false, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0, matId: 0, t: Infinity };
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  // 起点即实体：零法线命中
  const m0 = getVoxel(sw, x, y, z);
  if (m0 !== SURFACE_MAT.AIR) {
    return { hit: true, vx: x, vy: y, vz: z, nx: 0, ny: 0, nz: 0, matId: m0, t: 0 };
  }
  for (let guard = 0; guard < 512; guard++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) break;
    const m = getVoxel(sw, x, y, z);
    if (m !== SURFACE_MAT.AIR) {
      return { hit: true, vx: x, vy: y, vz: z, nx, ny, nz, matId: m, t };
    }
  }
  return miss;
}

// ———— 地表查询 ————

/**
 * 列扫描最高非空体素 y（体素占据 [y, y+1)）。空列返回 -1。
 * @returns {number}
 */
export function getSurfaceHeight(sw, x, z) {
  const { X } = SURFACE_SIZE;
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  if (xi < 0 || xi >= SURFACE_SIZE.X || zi < 0 || zi >= SURFACE_SIZE.Z) return -1;
  return sw.heights[zi * X + xi];
}

/** 列是否可站立（存在顶面且顶面下有支撑） */
export function isStandable(sw, x, z) {
  return getSurfaceHeight(sw, x, z) >= 0;
}

/**
 * 出生点：自世界中心螺旋外扫，取第一个顶面平整（3×3 高差 ≤1）的列。
 * 返回世界坐标（列中心，脚底 = 顶面体素上沿）。
 * @returns {{x:number, y:number, z:number}}
 */
export function findSpawnPoint(sw) {
  const { X, Z } = SURFACE_SIZE;
  const cx = X >> 1;
  const cz = Z >> 1;
  let best = null;
  for (let r = 0; r <= 26 && !best; r++) {
    for (let dz = -r; dz <= r && !best; dz++) {
      for (let dx = -r; dx <= r && !best; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 2 || z < 2 || x >= X - 2 || z >= Z - 2) continue;
        const h0 = getSurfaceHeight(sw, x, z);
        if (h0 < 2 || h0 > SURFACE_SIZE.Y - 4) continue;
        // 3×3 邻域平整性：高差 ≤1，保证出生不卡在陡壁
        let flat = true;
        for (let qz = -1; qz <= 1 && flat; qz++) {
          for (let qx = -1; qx <= 1 && flat; qx++) {
            const h = getSurfaceHeight(sw, x + qx, z + qz);
            if (h < 0 || Math.abs(h - h0) > 1) flat = false;
          }
        }
        if (flat) best = { x: x + 0.5, y: h0 + 1, z: z + 0.5 };
      }
    }
  }
  // 兜底：中心列顶面（heights 全空时回落到 y=2 悬空点，理论不可达）
  if (!best) {
    const h = getSurfaceHeight(sw, cx, cz);
    return { x: cx + 0.5, y: (h >= 0 ? h + 1 : 2), z: cz + 0.5 };
  }
  return best;
}

// ———— 寻路（地表 A*） ————

const SQRT2 = Math.SQRT2;
const PATH_DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * 地表 A* 寻路：2D 栅格 8 向，可通行条件为两侧列均可站立且顶面高差 ≤ climb。
 * 对角移动要求两个正交邻格同样可通行（禁止切角）。
 * 堆序以 (f, node) 双关键字保证确定性。
 * @param {number} sx,sz 起点格坐标    @param {number} tx,tz 终点格坐标
 * @param {{climb?:number, maxIter?:number}} [opts]
 * @returns {Array<{x:number,y:number,z:number}>|null} 世界坐标路径（含起终点）；不可达为 null
 */
export function findPath(sw, sx, sz, tx, tz, opts = {}) {
  const { X, Z } = SURFACE_SIZE;
  const climb = opts.climb == null ? 1 : opts.climb;
  const maxIter = opts.maxIter || 6000;
  const inb = (v) => Number.isInteger(v) && v >= 0 && v < X;
  if (!inb(sx) || !inb(sz) || !inb(tx) || !inb(tz) || sz >= Z || tz >= Z) return null;
  if (!isStandable(sw, sx, sz) || !isStandable(sw, tx, tz)) return null;

  const N = X;
  const start = sz * N + sx;
  const goal = tz * N + tx;
  if (start === goal) return [{ x: sx + 0.5, y: getSurfaceHeight(sw, sx, sz) + 1, z: sz + 0.5 }];

  const gScore = new Float32Array(N * Z).fill(Infinity);
  const from = new Int32Array(N * Z).fill(-1);
  const closed = new Uint8Array(N * Z);
  const heapF = [];
  const heapN = [];

  const hOf = (x, z) => sw.heights[z * N + x];
  const heur = (x, z) => {
    const dx = Math.abs(x - tx);
    const dz = Math.abs(z - tz);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz); // 八向一致启发
  };
  const heapPush = (f, node) => {
    heapF.push(f);
    heapN.push(node);
    let i = heapF.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] < heapF[i] || (heapF[p] === heapF[i] && heapN[p] <= heapN[i])) break;
      const tf = heapF[i]; heapF[i] = heapF[p]; heapF[p] = tf;
      const tn = heapN[i]; heapN[i] = heapN[p]; heapN[p] = tn;
      i = p;
    }
  };
  const heapPop = () => {
    const topN = heapN[0];
    const lastF = heapF.pop();
    const lastN = heapN.pop();
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapN[0] = lastN;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heapF.length && (heapF[l] < heapF[m] || (heapF[l] === heapF[m] && heapN[l] < heapN[m]))) m = l;
        if (r < heapF.length && (heapF[r] < heapF[m] || (heapF[r] === heapF[m] && heapN[r] < heapN[m]))) m = r;
        if (m === i) break;
        const tf = heapF[i]; heapF[i] = heapF[m]; heapF[m] = tf;
        const tn = heapN[i]; heapN[i] = heapN[m]; heapN[m] = tn;
        i = m;
      }
    }
    return topN;
  };

  gScore[start] = 0;
  heapPush(heur(sx, sz), start);
  let iter = 0;
  let found = false;
  while (heapF.length > 0 && iter++ < maxIter) {
    const cur = heapPop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cxp = cur % N;
    const czp = (cur / N) | 0;
    const hc = hOf(cxp, czp);
    for (let d = 0; d < 8; d++) {
      const nxp = cxp + PATH_DIRS[d][0];
      const nzp = czp + PATH_DIRS[d][1];
      if (nxp < 0 || nxp >= N || nzp < 0 || nzp >= Z) continue;
      const ni = nzp * N + nxp;
      if (closed[ni]) continue;
      const hn = hOf(nxp, nzp);
      if (hn < 0 || Math.abs(hn - hc) > climb) continue;
      // 对角禁切角：两个正交邻格须可站立且高差同样合规
      if (d >= 4) {
        const h1 = hOf(cxp + PATH_DIRS[d][0], czp);
        const h2 = hOf(cxp, czp + PATH_DIRS[d][1]);
        if (h1 < 0 || Math.abs(h1 - hc) > climb || h2 < 0 || Math.abs(h2 - hc) > climb) continue;
      }
      const ng = gScore[cur] + PATH_DIRS[d][2];
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        from[ni] = cur;
        heapPush(ng + heur(nxp, nzp), ni);
      }
    }
  }
  if (!found) return null;
  // 回溯（终点 → 起点），输出世界坐标
  const path = [];
  let node = goal;
  while (node !== -1) {
    const px = node % N;
    const pz = (node / N) | 0;
    path.push({ x: px + 0.5, y: hOf(px, pz) + 1, z: pz + 0.5 });
    node = from[node];
  }
  path.reverse();
  return path;
}

// ———— 贪心网格化（0fps 算法，AO 感知共面合并） ————

/** 经典 0fps 逐角点 AO：s1/s2 为两侧邻接，c 为对角 */
function vertexAO(s1, s2, c) {
  if (s1 && s2) return 0;
  return 3 - (s1 + s2 + c);
}

/**
 * 贪心网格化一个 16×16 列区块（y 全高 24）。
 * 算法（Mikola Lysenko / 0fps）：
 *  1. 对 3 个轴向 × 每层切片构建二值截面 mask：键 = ±(材质+1)
 *     （正号 = 法线朝 +轴，负号朝 -轴；相邻体素一对 solid/air 才产生面）；
 *  2. 每个 mask 单元同时计算 4 角点 AO（面外侧 8 邻域占用）；
 *  3. 矩形最大化：沿 u 向扩张 width、沿 w 向扩张 height，
 *     要求键与 4 角 AO 全部一致（AO 不一致处断开合并，避免插值破绽）；
 *  4. 输出四边形按朝向确定三角形绕序，顶点位置为区块原点偏移的世界坐标。
 * 顶点颜色 = 材质基色 × 行星地表色调(surface) × AO 亮度(0.55..1.0)。
 *
 * @param {object} sw surfaceWorld
 * @param {number} cx 区块 X 索引 0..3  @param {number} cz 区块 Z 索引 0..3
 * @returns {{positions:Float32Array, normals:Float32Array, colors:Float32Array,
 *            quadCount:number, triCount:number}}
 */
export function greedyMeshChunk(sw, cx, cz) {
  const { X, Y, Z, CHUNK } = SURFACE_SIZE;
  const dims = [CHUNK, Y, CHUNK];
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;
  const prof = CATEGORY_TERRAIN[sw.category] || CATEGORY_TERRAIN.rocky;
  const tint = prof.tint;
  const voxels = sw.voxels;

  // 填充读取：区块内直查，越界回世界（世界外为空气）
  const getPadded = (x, y, z) => {
    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y >= 0 && y < Y) {
      return voxels[(y * Z + (oz + z)) * X + (ox + x)];
    }
    return getVoxel(sw, ox + x, y, oz + z);
  };
  const solid = (m) => m !== SURFACE_MAT.AIR;

  const positions = [];
  const normals = [];
  const colors = [];
  let quadCount = 0;

  const maskW = Math.max(dims[1], dims[2]);
  const maskH = Math.max(dims[1], dims[2]);
  const maskKey = new Int32Array(maskW * maskH);
  const maskAO = new Uint8Array(maskW * maskH * 4);

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[axis] = 1;
    const mw = dims[u];
    const mh = dims[w];

    for (x[axis] = -1; x[axis] < dims[axis];) {
      // —— 1. 构建截面 mask（键 + 4 角 AO） ——
      let n = 0;
      for (x[w] = 0; x[w] < mh; x[w]++) {
        for (x[u] = 0; x[u] < mw; x[u]++, n++) {
          const a = getPadded(x[0], x[1], x[2]);
          const b = getPadded(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          const solidA = solid(a);
          if (solidA === solid(b)) { maskKey[n] = 0; continue; }
          const type = solidA ? a : b;
          maskKey[n] = solidA ? (type + 1) : -(type + 1);

          // AO 采样面：法线一侧的邻接层
          const faceShift = solidA ? 1 : -1;
          const bx = x[0] + q[0] * faceShift;
          const by = x[1] + q[1] * faceShift;
          const bz = x[2] + q[2] * faceShift;
          const duX = u === 0 ? 1 : 0;
          const duY = u === 1 ? 1 : 0;
          const duZ = u === 2 ? 1 : 0;
          const dwX = w === 0 ? 1 : 0;
          const dwY = w === 1 ? 1 : 0;
          const dwZ = w === 2 ? 1 : 0;
          const occ = (uu, ww) => (solid(getPadded(
            bx + duX * uu + dwX * ww,
            by + duY * uu + dwY * ww,
            bz + duZ * uu + dwZ * ww,
          )) ? 1 : 0);
          const s1u = occ(1, 0);
          const s1d = occ(-1, 0);
          const s2u = occ(0, 1);
          const s2d = occ(0, -1);
          const cuu = occ(1, 1);
          const cud = occ(1, -1);
          const cdu = occ(-1, 1);
          const cdd = occ(-1, -1);
          // 角序：(0,0) (1,0) (1,1) (0,1) —— (u,w) 单元局部坐标
          maskAO[n * 4 + 0] = vertexAO(s1d, s2d, cdd);
          maskAO[n * 4 + 1] = vertexAO(s1u, s2d, cud);
          maskAO[n * 4 + 2] = vertexAO(s1u, s2u, cuu);
          maskAO[n * 4 + 3] = vertexAO(s1d, s2u, cdu);
        }
      }

      x[axis]++;
      if (x[axis] < 0) continue;

      // —— 2. 矩形最大化（键 + AO 全等才合并） ——
      n = 0;
      for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw;) {
          const key = maskKey[n];
          if (key === 0) { i++; n++; continue; }
          const ao0 = maskAO[n * 4];
          const ao1 = maskAO[n * 4 + 1];
          const ao2 = maskAO[n * 4 + 2];
          const ao3 = maskAO[n * 4 + 3];
          let width = 1;
          while (i + width < mw) {
            const k2 = maskKey[n + width];
            if (k2 !== key) break;
            const b2 = (n + width) * 4;
            if (maskAO[b2] !== ao0 || maskAO[b2 + 1] !== ao1
              || maskAO[b2 + 2] !== ao2 || maskAO[b2 + 3] !== ao3) break;
            width++;
          }
          let height = 1;
          outer: while (j + height < mh) {
            for (let kk = 0; kk < width; kk++) {
              const i2 = n + kk + height * mw;
              if (maskKey[i2] !== key) break outer;
              const b2 = i2 * 4;
              if (maskAO[b2] !== ao0 || maskAO[b2 + 1] !== ao1
                || maskAO[b2 + 2] !== ao2 || maskAO[b2 + 3] !== ao3) break outer;
            }
            height++;
          }

          // —— 3. 发射四边形（世界坐标顶点 + AO 烘焙颜色） ——
          const type = Math.abs(key) - 1;
          const dirPositive = key > 0;
          const pos = [0, 0, 0];
          pos[axis] = x[axis];
          pos[u] = i;
          pos[w] = j;
          const normalIndex = axis === 0 ? (dirPositive ? 0 : 1)
            : axis === 1 ? (dirPositive ? 2 : 3) : (dirPositive ? 4 : 5);
          const nxv = NORMALS[normalIndex][0];
          const nyv = NORMALS[normalIndex][1];
          const nzv = NORMALS[normalIndex][2];

          const base = MATERIAL_COLORS[type];
          const aoBright = [0.55 + 0.15 * ao0, 0.55 + 0.15 * ao1, 0.55 + 0.15 * ao2, 0.55 + 0.15 * ao3];
          // 顶点基色（surface 乘行星色调）
          const tr = type === SURFACE_MAT.SURFACE ? base[0] * tint[0] : base[0];
          const tg = type === SURFACE_MAT.SURFACE ? base[1] * tint[1] : base[1];
          const tb = type === SURFACE_MAT.SURFACE ? base[2] * tint[2] : base[2];

          const corner = (du, dv, aoB) => {
            const p = [pos[0], pos[1], pos[2]];
            p[u] += du;
            p[w] += dv;
            positions.push(ox + p[0], p[1], oz + p[2]);
            normals.push(nxv, nyv, nzv);
            colors.push(tr * aoB, tg * aoB, tb * aoB);
          };
          const v00 = [0, 0, aoBright[0]];
          const v10 = [width, 0, aoBright[1]];
          const v11 = [width, height, aoBright[2]];
          const v01 = [0, height, aoBright[3]];
          const emit = (A, B, C) => { corner(A[0], A[1], A[2]); corner(B[0], B[1], B[2]); corner(C[0], C[1], C[2]); };
          if (dirPositive) {
            emit(v00, v10, v11);
            emit(v00, v11, v01);
          } else {
            emit(v00, v11, v10);
            emit(v00, v01, v11);
          }
          quadCount++;

          // 消费区域清零
          for (let dj = 0; dj < height; dj++) {
            for (let di = 0; di < width; di++) {
              maskKey[n + di + dj * mw] = 0;
            }
          }
          i += width;
          n += width;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    quadCount,
    triCount: quadCount * 2,
  };
}
