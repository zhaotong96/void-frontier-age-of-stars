/**
 * render/gl/GalaxyParticles.js — 确定性银河旋臂微粒数据生成器（纯 JS，无 DOM）
 *
 * 返工 Phase R3 资产层：为实例化银河渲染提供 40,000 粒子的确定性数据集。
 *
 * 导出：
 *  - generateGalaxyParticles({ count = 40000, seed = 20260101, worldScale = 1.0 })
 *      → { positions: Float32Array(count*3),   // 世界坐标（已乘 worldScale）
 *          colors:    Float32Array(count*3),   // HDR 线性 RGB（允许 >1）
 *          sizes:     Float32Array(count),     // 世界空间点半径（已乘 worldScale）
 *          seeds:     Float32Array(count) }    // 每粒子 [0,1) 随机相位（闪烁等）
 *    内置 mulberry32 风格确定性 PRNG（seed 派生），严禁 Math.random；
 *    同一 seed 两次生成的输出逐字节一致。
 *  - generateSupernovaSeeds(systems, worldScale = 1.0)
 *      → [{ x, y, z, seed, dangerRating, typeId }]
 *    给定星系实体数组（{ x, y, dangerRating, star: { typeId } }，策略坐标 0..1000），
 *    返回需要渲染超新星激波壳层的星系：dangerRating > 6 或
 *    star.typeId ∈ { pulsar, neutronStar, blackHole }；
 *    策略坐标映射为世界坐标：world = (strategy/1000·2 - 1)·worldScale（z=0 盘面）。
 *
 * 分布约定（世界半径归一 0..1，再乘 worldScale）：
 *  - 4 条对数旋臂 r = a·e^(b·θ)（a≈0.18, b≈0.32），沿臂高斯横截面散布
 *    （σ 随 r 增大），并叠加沿臂纵向抖动；
 *  - 核球区 r < 0.18 高密度球状分布（高斯球方向 × 幂律半径，轻微压扁）；
 *  - 银晕区 r > 0.75 稀疏球状分布；
 *  - 垂直厚度 z = gauss × H(r)，H(r) = H0·exp(-r/Rd) + 0.02（核球厚、盘面薄）；
 *  - 颜色：核球暖金 vec3(2.8,2.1,1.3)；旋臂区蓝巨星簇 vec3(0.8,1.6,3.5) 与
 *    H-II 粉紫 vec3(2.4,0.5,1.6) 沿臂周期性团块交错；银晕暗红矮星与冷蓝星尘；
 *    brightness 随密度（径向衰减）变化。
 *
 * 约束：顶层无副作用、不触碰 DOM；无任何随机源 Math.random。
 */

/** 区域配比：核球 / 旋臂 / 盘面弥散 / 银晕（和为 1） */
const REGION_BULGE = 0.26;
const REGION_ARM = 0.57;
const REGION_INTERARM = 0.10;

/** 对数旋臂参数：r = ARM_A·e^(ARM_B·θ) */
const ARM_COUNT = 4;
const ARM_A = 0.18;
const ARM_B = 0.32;
const GALAXY_R = 1.0;
const BULGE_R = 0.18;
const HALO_R0 = 0.75;

/** 盘面垂直标高参数：H(r) = H0·exp(-r/Rd) + 0.02 */
const H0 = 0.10;
const RD = 0.35;

/** 旋臂最大角：r=1 时 θ = ln(1/a)/b ≈ 5.36 rad（臂跨度略收短，为横截面散布留出余量） */
const THETA_MAX = Math.log(GALAXY_R / ARM_A) / ARM_B * 0.94;
const TAU = Math.PI * 2;

/** 高斯散布截断（±3σ）：防止极端离群点把粒子甩出归一化世界半径 */
const GAUSS_CLIP = 3.0;

/** 需要渲染超新星激波壳层的恒星类型 */
const SN_TYPE_IDS = ['pulsar', 'neutronStar', 'blackHole'];

/**
 * mulberry32 风格 32 位确定性 PRNG：返回 [0,1) 浮点序列。
 * 闭包内推进状态，不依赖任何全局随机源。
 * @param {number} seed 任意 32 位种子
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 标准正态采样（Box-Muller，两次确定性采样；u 防零重采样） */
function gauss(rand) {
  let u = rand();
  while (u <= 1e-12) {
    u = rand();
  }
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/** 盘面垂直标高：核球厚、盘面薄 */
function scaleHeight(r) {
  return H0 * Math.exp(-r / RD) + 0.02;
}

/** 归一化世界尺度参数（非法值回退 1.0） */
function normScale(worldScale) {
  return Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1.0;
}

/**
 * 生成确定性银河旋臂微粒数据。
 * @param {{count?: number, seed?: number, worldScale?: number}} [opts]
 * @returns {{positions: Float32Array, colors: Float32Array, sizes: Float32Array, seeds: Float32Array}}
 */
export function generateGalaxyParticles(opts = {}) {
  const count = Number(opts.count != null ? opts.count : 40000);
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const seed = Number(opts.seed != null ? opts.seed : 20260101);
  const ws = normScale(opts.worldScale);

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const seeds = new Float32Array(n);
  if (n === 0) {
    return { positions, colors, sizes, seeds };
  }

  const rand = mulberry32(Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 0);

  for (let idx = 0; idx < n; idx++) {
    // —— 区域抽取（确定性调用顺序：区域 → 形态 → 垂直 → 颜色 → 尺寸 → seed） ——
    const regionRoll = rand();
    let x = 0;
    let y = 0;
    let z = 0;
    let region = 'arm';
    let armIdx = 0;
    let theta = 0;

    if (regionRoll < REGION_BULGE) {
      // 核球：r<0.18 高密度球状（高斯球方向 × 幂律半径，轻微压扁）
      region = 'bulge';
      const gx = gauss(rand);
      const gy = gauss(rand);
      const gz = gauss(rand);
      const len = Math.hypot(gx, gy, gz) || 1;
      const rb = BULGE_R * Math.pow(rand(), 1.7);
      x = (gx / len) * rb;
      y = (gy / len) * rb;
      z = (gz / len) * rb * 0.85;
    } else if (regionRoll < REGION_BULGE + REGION_ARM) {
      // 旋臂：对数螺线 + 沿臂高斯横截面（σ 随 r 增大）+ 纵向抖动
      region = 'arm';
      armIdx = Math.floor(rand() * ARM_COUNT) % ARM_COUNT;
      theta = rand() * THETA_MAX;
      const armPhase = armIdx * (TAU / ARM_COUNT);
      const rArm = ARM_A * Math.exp(ARM_B * theta);
      const sigma = 0.018 + 0.055 * rArm;
      // 臂切向 ∝ dP/dθ = b·r·(cosθ,sinθ) + r·(-sinθ,cosθ)，取单位法向散布
      const cx = Math.cos(theta + armPhase);
      const sx = Math.sin(theta + armPhase);
      const tx = ARM_B * cx - sx;
      const ty = ARM_B * sx + cx;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      const off = Math.max(-GAUSS_CLIP * sigma, Math.min(GAUSS_CLIP * sigma, gauss(rand) * sigma));
      const th2 = theta + gauss(rand) * 0.02;
      const r2 = ARM_A * Math.exp(ARM_B * th2);
      x = r2 * Math.cos(th2 + armPhase) + nx * off;
      y = r2 * Math.sin(th2 + armPhase) + ny * off;
    } else if (regionRoll < REGION_BULGE + REGION_ARM + REGION_INTERARM) {
      // 盘面弥散：臂间老年星（面积均匀采样）
      region = 'interarm';
      const rMin = BULGE_R;
      const rMax = 0.92;
      const rr = Math.sqrt(rMin * rMin + (rMax * rMax - rMin * rMin) * rand());
      const th = rand() * TAU;
      x = rr * Math.cos(th);
      y = rr * Math.sin(th);
    } else {
      // 银晕：r>0.75 稀疏球状（三维半径直接落在 0.75..1.0）
      region = 'halo';
      const gx = gauss(rand);
      const gy = gauss(rand);
      const gz = gauss(rand);
      const len = Math.hypot(gx, gy, gz) || 1;
      const rh = HALO_R0 + (GALAXY_R - HALO_R0) * Math.pow(rand(), 1.4);
      x = (gx / len) * rh;
      y = (gy / len) * rh;
      z = (gz / len) * rh;
    }

    // —— 垂直厚度：z = gauss × H(r)（核球/银晕已在各自分支给出三维坐标） ——
    if (region === 'arm' || region === 'interarm') {
      const rr = Math.hypot(x, y);
      z = gauss(rand) * scaleHeight(rr) * (region === 'interarm' ? 1.15 : 1.0);
    }

    // —— 颜色（HDR 线性，允许 >1）与亮度（随密度变化） ——
    const rF = Math.hypot(x, y);
    let cr = 0;
    let cg = 0;
    let cb = 0;
    let size = 1.0;
    let bright = 1.0;

    if (region === 'bulge') {
      // 核球暖金
      const v = 0.75 + 0.5 * rand();
      cr = 2.8 * v;
      cg = 2.1 * v;
      cb = 1.3 * v;
      size = 1.6 + 1.4 * rand();
      bright = 1.05 * Math.exp(-rF * 1.4) + 0.35;
    } else if (region === 'arm') {
      // 沿臂周期性团块：蓝巨星簇 与 H-II 粉紫 交错
      const chunk = Math.sin(theta * 2.6 + armIdx * 1.9)
        + 0.6 * Math.sin(theta * 6.1 + armIdx * 4.2);
      const cluster = 0.5 + 0.5 * Math.sin(chunk * 2.2);   // 0..1 团块相位
      if (cluster > 0.62) {
        // H-II 粉紫电离氢区团块
        const v = 0.9 + 0.7 * rand();
        cr = 2.4 * v;
        cg = 0.5 * v;
        cb = 1.6 * v;
        size = 1.8 + 1.8 * rand();
        bright = 1.25 + (cluster - 0.62) * 1.3;
      } else {
        // 蓝巨星簇 / 亮蓝星
        const v = 0.65 + 0.55 * rand();
        cr = 0.8 * v;
        cg = 1.6 * v;
        cb = 3.5 * v;
        size = 1.1 + 1.5 * rand();
        bright = 0.85 + 0.35 * cluster + 0.3 * rand();
      }
    } else if (region === 'interarm') {
      // 臂间弥散：暗黄白老年星
      const v = 0.4 + 0.35 * rand();
      cr = 1.6 * v;
      cg = 1.35 * v;
      cb = 0.95 * v;
      size = 0.8 + 0.9 * rand();
      bright = 0.45 + 0.2 * Math.exp(-rF * 2.0);
    } else {
      // 银晕：暗红矮星 与 冷蓝星尘
      if (rand() < 0.6) {
        const v = 0.35 + 0.3 * rand();
        cr = 1.1 * v;
        cg = 0.42 * v;
        cb = 0.25 * v;
      } else {
        const v = 0.4 + 0.35 * rand();
        cr = 0.5 * v;
        cg = 0.72 * v;
        cb = 1.25 * v;
      }
      size = 0.6 + 0.8 * rand();
      bright = 0.4 + 0.25 * rand();
    }

    // brightness 随密度变化：径向衰减加权
    const b = bright * (Math.exp(-rF * 1.1) * 0.5 + 0.5);

    positions[idx * 3] = x * ws;
    positions[idx * 3 + 1] = y * ws;
    positions[idx * 3 + 2] = z * ws;
    colors[idx * 3] = cr * b;
    colors[idx * 3 + 1] = cg * b;
    colors[idx * 3 + 2] = cb * b;
    sizes[idx] = size * 0.006 * ws;   // 世界空间点半径
    seeds[idx] = rand();
  }

  return { positions, colors, sizes, seeds };
}

/**
 * 挑选需要渲染超新星激波壳层的星系并给出确定性种子。
 * @param {Array<{x:number, y:number, dangerRating?:number, star?:{typeId?:string}}>} systems
 * @param {number} [worldScale=1.0]
 * @returns {Array<{x:number, y:number, z:number, seed:number, dangerRating:number, typeId:string|null}>}
 */
export function generateSupernovaSeeds(systems, worldScale = 1.0) {
  const list = Array.isArray(systems) ? systems : [];
  const ws = normScale(worldScale);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || typeof s !== 'object') {
      continue;
    }
    const typeId = s.star && typeof s.star === 'object' ? s.star.typeId : undefined;
    const danger = Number(s.dangerRating);
    const byDanger = Number.isFinite(danger) && danger > 6;
    const byType = typeof typeId === 'string' && SN_TYPE_IDS.indexOf(typeId) >= 0;
    if (!byDanger && !byType) {
      continue;
    }
    const sx = Number(s.x);
    const sy = Number(s.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      continue;
    }
    // 策略坐标 0..1000 → 世界坐标 [-ws, +ws]（z=0 盘面）
    const x = ((sx / 1000) * 2 - 1) * ws;
    const y = ((sy / 1000) * 2 - 1) * ws;
    // 确定性种子：由策略坐标与索引派生（mulberry32 首个输出），同输入必同种子
    const base = (Math.imul(Math.round(sx * 64) | 0, 0x27220a95)
      ^ Math.imul(Math.round(sy * 64) | 0, 0x85ebca77)
      ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
    const seed = mulberry32(base)();
    out.push({
      x,
      y,
      z: 0,
      seed,
      dangerRating: Number.isFinite(danger) ? danger : 0,
      typeId: typeof typeId === 'string' ? typeId : null,
    });
  }
  return out;
}
