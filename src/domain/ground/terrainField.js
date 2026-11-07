/**
 * domain/ground/terrainField.js — 连续三角化地形场（doc7 TASK-1.1 / §8.1 蓝本）
 *
 * 正式地表主几何 = Triangulated Planetary Terrain（序列 6 §2 / doc7 §3）：
 *  - Planet Local 切平面 [-256,+256]m，512m×512m = 8×8 个 64m×64m 区块，高度预算 [-40,+80]m；
 *  - 每区块 65×65 顶点（LOD 0 步长 1.0m）规则格网 + 曲率自适应对角线切分；
 *  - 严格 CCW 索引（gl.CCW，外法线朝 +Y）+ 面积加权顶点法线 + 陡坡材质增强；
 *  - 顶点语义：position/normal/tangent/materialWeights(4ch)/biomeId/flags/aux(temp,moisture)。
 *
 * 确定性（doc7 红线 4）：全部噪声由 derivePlanetSeeds 子种子派生
 * （createSimplexNoise(macroTerrainSeed) 等），零 Math.random，绝不消费 world.rng；
 * 同 (world.seed, planetId, profile, siteModifier) 逐位可复现。
 *
 * 本文件为纯领域层：无 DOM / 无 WebGL；渲染侧（PlanetTerrainMesh）只消费只读快照。
 */

import { hash32, createSimplexNoise } from './SurfaceSandbox.js';
import { seedFromNumber, nextU32 } from '../../core/rng.js';
import { derivePlanetSeeds } from './planetSeeds.js';
import { profileForPlanet, TERRAIN_PROFILES } from '../../content/terrainProfiles.js';

// ———— 常量 ————

/**
 * 地表语义标记（Uint16 位掩码，序列 6 §2.3 / doc7 §3.2）：
 * ROAD=道路样条、FOUNDATION=建筑地基、CORE_PROTECTED=任务核心保护区、
 * HAZARD=危险表面、ORE=可采矿脉、BRIDGE_DECK=桥梁甲板。
 */
export const TERRAIN_FLAGS = {
  ROAD: 1,
  FOUNDATION: 2,
  CORE_PROTECTED: 4,
  HAZARD: 8,
  ORE: 16,
  BRIDGE_DECK: 32,
};

/** 高度预算（doc7 §3.1：Planet Local 高度 -40m ~ +80m） */
export const MIN_HEIGHT = -40;
export const MAX_HEIGHT = 80;

const CLIFF_NY = 0.86;      // 法线 y 分量低于此值视为陡坡
const CLIFF_RANGE = 0.38;   // 陡坡增强的过渡区间宽度
const SQRT2 = Math.SQRT2;

// ———— 小工具 ————

function num(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampInt(v, lo, hi) {
  return Math.floor(clamp(Math.floor(v), lo, hi));
}

/** 平滑阶跃（GLSL smoothstep 语义） */
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-12), 0, 1);
  return t * t * (3 - 2 * t);
}

function clampByte(v) {
  return clamp(Math.round(Number.isFinite(v) ? v : 0), 0, 255);
}

/** 分形布朗运动（2D）：octaves 个八度叠加，输出约 [-1,1] */
function fbm2(noise, x, y, octaves) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

// ———— 宏观地貌场（多尺度叠加，序列 6 §2.4 步骤 1/2） ————

/**
 * 创建剖面驱动的宏观地貌采样器。
 * 大陆 fBm（3 八度）+ 山脊分量 + 盆地/海沟/陨坑/桌山/沙纹/河道等剖面修饰。
 * 全部由 seeds 派生的独立噪声流驱动；陨坑散布使用 splitmix32 子种子。
 */
function createMacroField(profile, seeds) {
  const noise = createSimplexNoise(seeds.macroTerrainSeed);
  const detailNoise = createSimplexNoise((seeds.macroTerrainSeed ^ 0x51ed270b) >>> 0);
  const biomeNoise = createSimplexNoise(seeds.biomeSeed);

  const base = num(profile.base, 8);
  const amp = num(profile.amp, 10);
  const ridgeW = num(profile.ridge, 0);
  const basin = num(profile.basinDepth, 0);
  const shelf = profile.shelf || null;
  const trench = profile.trench || null;
  const mesa = profile.mesa || null;
  const terrace = num(profile.terrace, 0);
  const dune = profile.dune || null;
  const channel = profile.channel || null;

  // 陨坑群：子种子确定性散布（形状参数带限抖动）
  const craters = [];
  if (profile.crater && profile.crater.count > 0) {
    const st = seedFromNumber((seeds.macroTerrainSeed ^ hash32('crater')) >>> 0);
    const spread = 480;
    for (let k = 0; k < profile.crater.count; k++) {
      const r1 = nextU32(st) / 4294967296;
      const r2 = nextU32(st) / 4294967296;
      const r3 = nextU32(st) / 4294967296;
      const r4 = nextU32(st) / 4294967296;
      craters.push({
        x: (r1 - 0.5) * spread,
        z: (r2 - 0.5) * spread,
        r: num(profile.crater.radius, 20) * (0.6 + 0.8 * r3),
        d: num(profile.crater.depth, 5) * (0.6 + 0.7 * r4),
      });
    }
  }

  const duneCa = dune ? Math.cos(num(dune.angle, 0)) : 1;
  const duneSa = dune ? Math.sin(num(dune.angle, 0)) : 0;
  const duneAmp = dune ? num(dune.amp, 0.8) : 0;
  const duneWave = dune ? num(dune.wavelength, 16) : 16;
  const trenchW = trench ? num(trench.width, 0.05) : 0;
  const trenchD = trench ? num(trench.depth, 10) : 0;
  const mesaThr = mesa ? 1 - 2 * clamp(num(mesa.fraction, 0.3), 0, 0.9) : 0;
  const mesaStep = mesa ? Math.max(0.5, num(mesa.step, 2)) : 1;
  const chanEdge = channel ? 1 - clamp(num(channel.width, 0.1), 0.01, 0.9) : 1;
  const chanLevel = channel ? num(channel.level, -4) : 0;
  const shelfLevel = shelf ? num(shelf.level, 0) : 0;
  const shelfThr = shelf ? num(shelf.threshold, 0.2) : 0;

  /**
   * 宏观高度采样：返回 { y: 高度, channelK: 河道掩码强度, trenchK: 断层掩码强度 }。
   * y 尚未做高度预算钳制（由 evalPoint 统一钳制到 [-40, +80]）。
   */
  function heightAt(wx, wz) {
    // 1) 大陆 fBm（3 八度）
    let y = base + fbm2(noise, wx * 0.0055, wz * 0.0055, 3) * amp;
    // 2) 山脊分量（ridged：|n| 反相平方锐化）
    if (ridgeW > 0) {
      const r = 1 - Math.abs(noise.noise2D(wx * 0.0105 + 13.7, wz * 0.0105 - 7.3));
      y += amp * ridgeW * (r * r * 1.6 - 0.35);
    }
    // 3) 低频盆地下切
    if (basin > 0) {
      const b = fbm2(noise, wx * 0.0035 - 41.2, wz * 0.0035 + 17.8, 2);
      if (b > 0) y -= basin * b * b;
    }
    // 4) 浅海台地抬升（海盆剖面）
    if (shelf) {
      const s = fbm2(noise, wx * 0.004 + 91.3, wz * 0.004 - 33.8, 2);
      if (s > shelfThr) {
        const k = smoothstep(shelfThr, shelfThr + 0.22, s);
        y += (shelfLevel - y) * k * 0.9;
      }
    }
    // 5) 断层线掩码：海沟 / 裂隙 / 峡谷
    let trenchK = 0;
    if (trench) {
      const t = Math.abs(noise.noise2D(wx * 0.0062 + 101.3, wz * 0.0062 - 55.9));
      if (t < trenchW) {
        const k = 1 - t / trenchW;
        trenchK = k * k * (3 - 2 * k);
        y -= trenchD * trenchK;
      }
    }
    // 6) 陨坑碗 + 环形山肩
    for (let c = 0; c < craters.length; c++) {
      const cr = craters[c];
      const ddx = wx - cr.x;
      const ddz = wz - cr.z;
      const dd = Math.sqrt(ddx * ddx + ddz * ddz) / cr.r;
      if (dd < 1) {
        y -= cr.d * (1 - dd * dd);
      } else if (dd < 1.35) {
        const rim = 1 - (dd - 1) / 0.35;
        y += cr.d * 0.32 * rim * rim;
      }
    }
    // 7) 平顶桌山：平台掩码内高度量化（顶平壁陡）
    if (mesa) {
      const m = fbm2(noise, wx * 0.0045 + 77.7, wz * 0.0045 - 21.4, 2);
      if (m > mesaThr) {
        const k = smoothstep(mesaThr, mesaThr + 0.10, m);
        const q = Math.round(y / mesaStep) * mesaStep;
        y += (q - y) * k;
      }
    }
    // 8) 阶地量化（礁台/酸液阶地）
    if (terrace > 0) {
      const q = Math.round(y / terrace) * terrace;
      y += (q - y) * 0.85;
    }
    // 9) 风蚀沙波纹
    if (dune) {
      const mask = 0.5 + 0.5 * detailNoise.noise2D(wx * 0.02, wz * 0.02);
      y += duneAmp * Math.sin(((wx * duneCa + wz * duneSa) * 2 * Math.PI) / duneWave) * mask;
    }
    // 10) 低频谷掩码：熔岩河 / 河道
    let channelK = 0;
    if (channel) {
      const v = 1 - Math.abs(noise.noise2D(wx * 0.009 + 37.2, wz * 0.009 - 91.4));
      if (v > chanEdge) {
        channelK = smoothstep(chanEdge, 1, v);
        y += (chanLevel - y) * channelK;
      }
    }
    return { y, channelK, trenchK };
  }

  return { heightAt, noise, detailNoise, biomeNoise };
}

// ———— 逐点评估（纯函数、确定性） ————

/**
 * 评估地表一点：高度 + 4 通道材质权重 + 生态 id + 语义标记 + 温度/湿度。
 * 纯函数 of (field 参数, wx, wz)：无副作用，同输入逐位一致。
 * 顺序：宏观场 → 材质/生态 → 危险标记 → siteModifier（Wave C SDF 挂点）→ 高度预算钳制。
 *
 * @param {object} field createTerrainField 返回的地形场
 * @param {number} wx Planet Local x（米）
 * @param {number} wz Planet Local z（米）
 * @returns {{ y:number, weights:number[4], biomeId:number, flags:number, temp:number, moisture:number }}
 */
export function evalPoint(field, wx, wz) {
  const macro = field._macro;
  const profile = field.profile;

  // 1) 宏观地貌
  const h = macro.heightAt(wx, wz);
  let y = h.y;

  // 2) 生态分区与材质权重
  const nBiomes = profile.biomeIds.length;
  const bMask = fbm2(macro.biomeNoise, wx * 0.011, wz * 0.011, 2);
  const b01 = bMask * 0.5 + 0.5;
  let biomeId = clampInt(Math.floor(b01 * nBiomes * 0.999), 0, nBiomes - 1);

  const glow = num(profile.glowVeins, 0);
  let w1 = 0; // 崖壁通道由网格构建器按陡坡注入
  let w2 = Math.round(clamp((b01 - 0.52) / 0.48, 0, 1) * 190); // 生态/强调
  let w3 = 0;
  if (glow > 0) {
    const veinRaw = Math.abs(macro.detailNoise.noise2D(wx * 0.028 - 5.1, wz * 0.028 + 9.7));
    const vein = smoothstep(0.72, 0.9, veinRaw) * glow;
    w3 = Math.round(vein * 235);
    if (vein > 0.55) biomeId = nBiomes - 1; // 荧光脉络专属生态
  }
  if (w2 + w3 > 250) w3 = Math.max(0, 250 - w2);
  let w0 = 255 - w2 - w3; // 地表/基底兜底，四通道恒和 255

  // 3) 温度 / 湿度（海拔递减 + 低频气候噪声）
  let temp = clamp(
    0.5 + 0.3 * macro.detailNoise.noise2D(wx * 0.004 + 501.7, wz * 0.004 - 303.1) - Math.max(0, y) * 0.006,
    0, 1,
  );
  let moisture = clamp(0.35 + 0.5 * b01, 0, 1);
  if (profile.seaLevel != null && y < profile.seaLevel) moisture = 1;

  // 4) 语义标记
  let flags = 0;
  const rule = profile.hazardRule;
  if (profile.seaLevel != null && y < profile.seaLevel) {
    flags |= TERRAIN_FLAGS.HAZARD; // 海平面以下 = 高压/淹没危险
  }
  if (rule === 'lowland_gas' && Number.isFinite(profile.hazardLevel) && y < profile.hazardLevel) {
    flags |= TERRAIN_FLAGS.HAZARD; // 低洼毒气湖
  }
  if (rule === 'lava_channel' && h.channelK > 0.35) {
    flags |= TERRAIN_FLAGS.HAZARD; // 岩浆河道
  }
  if (rule === 'crevasse' && h.trenchK > 0.5) {
    flags |= TERRAIN_FLAGS.HAZARD; // 冰裂隙
  }
  if (macro.detailNoise.noise2D(wx * 0.05 + 800.3, wz * 0.05 - 313.7) > 0.62) {
    flags |= TERRAIN_FLAGS.ORE; // 可采矿脉
  }

  // 5) 人工任务核心 SDF 挂点（Wave C MissionSiteBlueprint；默认无）
  if (field.siteModifier) {
    const mod = field.siteModifier(wx, wz, {
      y,
      weights: [w0, w1, w2, w3],
      biomeId,
      flags,
      temp,
      moisture,
    });
    if (mod) {
      if (Number.isFinite(mod.dy)) y += mod.dy;
      if (Number.isFinite(mod.biomeId)) biomeId = mod.biomeId;
      if (Number.isFinite(mod.flags)) flags |= mod.flags;
      if (Number.isFinite(mod.clearFlags)) flags &= ~mod.clearFlags; // 人工结构显式清除自然危险旗（P0-D）
      if (mod.weights) {
        let m0 = clampByte(mod.weights[0]);
        let m1 = clampByte(mod.weights[1]);
        let m2 = clampByte(mod.weights[2]);
        let m3 = clampByte(mod.weights[3]);
        let excess = m0 + m1 + m2 + m3 - 255;
        if (excess > 0) {
          const take0 = Math.min(m0, excess); m0 -= take0; excess -= take0;
        }
        if (excess > 0) { const take2 = Math.min(m2, excess); m2 -= take2; excess -= take2; }
        if (excess > 0) { const take1 = Math.min(m1, excess); m1 -= take1; excess -= take1; }
        w0 = m0; w1 = m1; w2 = m2; w3 = m3;
      }
    }
  }

  // 6) 高度预算（doc7 §3.1：[-40, +80]m，含 SDF 修正后统一钳制）
  y = clamp(y, MIN_HEIGHT, MAX_HEIGHT);

  return {
    y,
    weights: [w0, w1, w2, w3],
    biomeId: clamp(biomeId | 0, 0, 255),
    flags: flags & 0xffff,
    temp,
    moisture,
  };
}

// ———— 场创建 ————

/**
 * 解析 opts.profile：字符串 id → 注册表查表；对象 → 直接使用；缺省 → 行星查表。
 */
function resolveProfile(profileOpt, planet) {
  if (typeof profileOpt === 'string') {
    const p = TERRAIN_PROFILES[profileOpt];
    if (p) return p;
  }
  if (profileOpt && typeof profileOpt === 'object') return profileOpt;
  return profileForPlanet(planet, planet && planet.primaryThemeId);
}

/**
 * 创建连续地形场（分配 8×8 区块的 TerrainChunk 数据结构，但尚未构建网格）。
 * @param {{seed:number}} world 世界实体（只读取 world.seed）
 * @param {string|number} planetId 行星实体 id
 * @param {{
 *   profile?:string|object,            // 剖面覆盖（id 或对象）
 *   siteModifier?:(wx:number,wz:number,base:object)=>object|null, // Wave C SDF 挂点
 *   sizeMeters?:number,                // 默认 512
 *   chunkMeters?:number,               // 默认 64
 *   lod0Step?:number,                  // 默认 1（米/顶点）
 * }} [opts]
 */
export function createTerrainField(world, planetId, opts = {}) {
  const sizeMeters = num(opts.sizeMeters, 512);
  const chunkMeters = num(opts.chunkMeters, 64);
  const lod0Step = Math.max(0.25, num(opts.lod0Step, 1));
  const chunksX = Math.max(1, Math.round(sizeMeters / chunkMeters));
  const chunksZ = chunksX;
  const gridSize = Math.max(2, Math.round(chunkMeters / lod0Step) + 1);
  const originX = -sizeMeters / 2;
  const originZ = -sizeMeters / 2;

  const planet = (world && world.entities && world.entities.planets && world.entities.planets[planetId]) || null;
  const profile = resolveProfile(opts.profile, planet);
  const seeds = derivePlanetSeeds(world, planetId);

  const field = {
    planetId,
    seed: seeds.planetSeed,
    seeds,
    profile,
    generatorVersion: 1,
    sourceRevision: 1,
    sizeMeters,
    chunkMeters,
    lod0Step,
    chunksX,
    chunksZ,
    originX,
    originZ,
    siteModifier: typeof opts.siteModifier === 'function' ? opts.siteModifier : null,
    chunks: [],
    evalPoint: null, // 下方回填闭包
    _macro: createMacroField(profile, seeds),
  };
  field.evalPoint = (wx, wz) => evalPoint(field, wx, wz);

  const cells = gridSize - 1;
  const indexCount = cells * cells * 6;
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const id = `chunk_${cx}_${cz}`;
      const nn = gridSize * gridSize;
      field.chunks[cz * chunksX + cx] = {
        id,
        planetId,
        seed: (seeds.macroTerrainSeed ^ hash32(id)) >>> 0,
        lod: 0,
        cx,
        cz,
        gridSize,
        bounds: {
          minX: originX + cx * chunkMeters,
          maxX: originX + (cx + 1) * chunkMeters,
          minZ: originZ + cz * chunkMeters,
          maxZ: originZ + (cz + 1) * chunkMeters,
          minY: Infinity, // 构建时统计
          maxY: -Infinity,
        },
        vertices: {
          position: new Float32Array(nn * 3),
          normal: new Float32Array(nn * 3),
          tangent: new Float32Array(nn * 3),
          materialWeights: new Uint8Array(nn * 4),
          biomeId: new Uint8Array(nn),
          flags: new Uint16Array(nn),
          aux: new Float32Array(nn * 2), // [temp, moisture]
        },
        indices: new Uint32Array(indexCount),
        sourceRevision: 1,
        meshRevision: 0,
        dirty: true,
      };
    }
  }
  return field;
}

// ———— 网格构建（doc7 §8.1 蓝本，逐条实现） ————

/**
 * 构建单个区块的三角化网格：采样 → 曲率自适应对角线 + 严格 CCW 索引 →
 * 面积加权法线 + 切线 + 陡坡材质增强。零外部依赖；同输入逐位一致。
 *
 * @param {object} chunk createTerrainField 产出的区块（vertices 缓冲就绪）
 * @param {(wx:number, wz:number)=>{y:number, weights:number[], biomeId:number, flags:number, temp:number, moisture:number}} evalPoint
 *        已融合宏观地貌 + MissionSiteBlueprint SDF 的高度评估函数
 * @returns {object} 同一 chunk（meshRevision 已对齐 sourceRevision，dirty=false）
 */
export function buildTriangulatedChunkMesh(chunk, evalPoint) {
  const N = chunk.gridSize;
  const cells = N - 1;
  const step = (chunk.bounds.maxX - chunk.bounds.minX) / cells;
  const ox = chunk.bounds.minX;
  const oz = chunk.bounds.minZ;
  const verts = chunk.vertices;
  const pos = verts.position;
  const nor = verts.normal;
  const tan = verts.tangent;
  const wgt = verts.materialWeights;
  const bio = verts.biomeId;
  const flg = verts.flags;
  const aux = verts.aux;
  const nn = N * N;
  const yArr = new Float32Array(nn); // 采样高度暂存（对角线选择用）

  chunk.bounds.minY = Infinity;
  chunk.bounds.maxY = -Infinity;

  // 步骤 1：采样 N×N 顶点（y 非有限 → 0.0；aux = temp/moisture；统计 minY/maxY）
  for (let j = 0; j < N; j++) {
    const wz = oz + j * step;
    for (let i = 0; i < N; i++) {
      const vIdx = j * N + i;
      const wx = ox + i * step;
      const s = evalPoint(wx, wz);
      let y = s.y;
      if (!Number.isFinite(y)) y = 0.0;
      yArr[vIdx] = y;
      pos[vIdx * 3] = wx;
      pos[vIdx * 3 + 1] = y;
      pos[vIdx * 3 + 2] = wz;
      const w = s.weights;
      wgt[vIdx * 4] = clampByte(w ? w[0] : 255);
      wgt[vIdx * 4 + 1] = clampByte(w ? w[1] : 0);
      wgt[vIdx * 4 + 2] = clampByte(w ? w[2] : 0);
      wgt[vIdx * 4 + 3] = clampByte(w ? w[3] : 0);
      bio[vIdx] = (s.biomeId || 0) & 255;
      flg[vIdx] = (s.flags || 0) & 0xffff;
      aux[vIdx * 2] = Number.isFinite(s.temp) ? s.temp : 0.5;
      aux[vIdx * 2 + 1] = Number.isFinite(s.moisture) ? s.moisture : 0.0;
      if (y < chunk.bounds.minY) chunk.bounds.minY = y;
      if (y > chunk.bounds.maxY) chunk.bounds.maxY = y;
    }
  }

  // 步骤 2：曲率自适应对角线切分 + 严格 CCW（自 +Y 俯视逆时针，外法线朝 +Y）
  const indices = chunk.indices;
  let t = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const v00 = j * N + i;
      const v10 = v00 + 1;
      const v01 = (j + 1) * N + i;
      const v11 = v01 + 1;
      // 奇偶交替微偏置，消除全图单一方向对角线纹理
      const checkerboardBias = (((i + j) & 1) === 0) ? -0.02 : 0.02;
      const diffDiagA = Math.abs(yArr[v00] - yArr[v11]) + checkerboardBias;
      const diffDiagB = Math.abs(yArr[v10] - yArr[v01]);
      if (diffDiagA <= diffDiagB) {
        indices[t++] = v00; indices[t++] = v01; indices[t++] = v11;
        indices[t++] = v00; indices[t++] = v11; indices[t++] = v10;
      } else {
        indices[t++] = v00; indices[t++] = v01; indices[t++] = v10;
        indices[t++] = v10; indices[t++] = v01; indices[t++] = v11;
      }
    }
  }

  // 步骤 3：面积加权法线累积 + 归一化 + 切线 + 陡坡材质增强
  nor.fill(0);
  for (let k = 0; k < indices.length; k += 3) {
    const ia = indices[k] * 3;
    const ib = indices[k + 1] * 3;
    const ic = indices[k + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const b1x = pos[ib] - ax, b1y = pos[ib + 1] - ay, b1z = pos[ib + 2] - az;
    const c1x = pos[ic] - ax, c1y = pos[ic + 1] - ay, c1z = pos[ic + 2] - az;
    const nx = b1y * c1z - b1z * c1y; // (B-A)×(C-A)，面积加权
    const ny = b1z * c1x - b1x * c1z;
    const nz = b1x * c1y - b1y * c1x;
    nor[ia] += nx; nor[ia + 1] += ny; nor[ia + 2] += nz;
    nor[ib] += nx; nor[ib + 1] += ny; nor[ib + 2] += nz;
    nor[ic] += nx; nor[ic + 1] += ny; nor[ic + 2] += nz;
  }
  for (let v = 0; v < nn; v++) {
    const o = v * 3;
    const len = Math.hypot(nor[o], nor[o + 1], nor[o + 2]) || 1.0;
    let nx = nor[o] / len;
    let ny = nor[o + 1] / len;
    let nz = nor[o + 2] / len;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // 强制朝上
    nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    // 切线 = (ny, -nx, 0) 归一化
    const tl = Math.hypot(ny, -nx) || 1.0;
    tan[o] = ny / tl;
    tan[o + 1] = -nx / tl;
    tan[o + 2] = 0;
    // 陡坡增强：崖壁权重注入通道 1，并归一到 255 总和
    if (ny < CLIFF_NY) {
      const cliffFactor = Math.min(1.0, (CLIFF_NY - ny) / CLIFF_RANGE);
      const addG = Math.round(cliffFactor * 200);
      const k4 = v * 4;
      let w0 = wgt[k4];
      let w1 = Math.min(255, wgt[k4 + 1] + addG);
      let w2 = wgt[k4 + 2];
      // 归一：超出的权重从基底/生态通道等比让出，保证 w3 = 255 - 前三通道 有效
      let excess = w0 + w1 + w2 - 255;
      if (excess > 0) {
        const total = w0 + w2;
        if (total > 0) {
          const take0 = Math.min(w0, Math.ceil((excess * w0) / total));
          w0 -= take0;
          excess -= take0;
        }
        if (excess > 0) {
          const take2 = Math.min(w2, excess);
          w2 -= take2;
          excess -= take2;
        }
        if (excess > 0) w1 = Math.max(0, w1 - excess);
      }
      wgt[k4] = w0;
      wgt[k4 + 1] = w1;
      wgt[k4 + 2] = w2;
      wgt[k4 + 3] = Math.max(0, 255 - w0 - w1 - w2);
    }
  }

  chunk.meshRevision = chunk.sourceRevision;
  chunk.dirty = false;
  return chunk;
}

// ———— 便捷构建 ————

/**
 * 创建 + 构建全部 8×8 区块（meshRevision 对齐、dirty 清零）。
 * 高度预算 [-40,+80]m 在 evalPoint 统一钳制。
 */
export function buildTerrainField(world, planetId, opts = {}) {
  const field = createTerrainField(world, planetId, opts);
  for (let i = 0; i < field.chunks.length; i++) {
    buildTriangulatedChunkMesh(field.chunks[i], field.evalPoint);
  }
  return field;
}
