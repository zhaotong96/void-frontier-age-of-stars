/**
 * render/gl/PlanetTerrainMesh.js — 3 级 LOD 分块连续地形渲染器（doc7 §8.2 / TASK-1.3）
 *
 * 消费 src/domain/ground/terrainField.js 的连续三角网格字段（field 契约见该文件）：
 *  - 8×8 = 64 个 64m×64m Chunk，每 Chunk 源数据 65×65 顶点（1m 步距）；
 *  - sync(field, camPos, opts) 按相机水平距离选 LOD：<96m → LOD0（65×65 原样），
 *    96–192m → LOD1（隔 2 取 1，33×33），≥192m → LOD2（隔 4 取 1，17×17）；
 *  - 仅当 (lod 变化 || chunk.dirty || meshRevision 变化) 时重建该 Chunk 的 GPU
 *    缓冲；字段侧脏标记触发 buildTriangulatedChunkMesh 增量重建（TERRAIN-06）；
 *  - LOD 接缝闭合（TERRAIN-04 零裂缝）三重保障：
 *      1. 共享边界采样点精确一致 —— 粗 LOD 顶点是细网格每隔 k 取样的子集（64 可被
 *         2/4 整除），共享边界顶点两侧取自同一 evalPoint 采样，高度逐位相同；
 *      2. 垂直裙边（skirt）—— 每 Chunk 四周附加 3.0m 向下裙边条带（复制边界顶点、
 *         y-3.0、同法线/权重/morph，三角形按外向 CCW 生成），T 形接缝残差被裙边
 *         从常规俯视角遮挡；裙边顶点参与 geomorph，与顶面保持贴合；
 *      3. Geomorph —— 顶点属性 aMorph（= 2k 粗格双线性高度 − 细格高度，按距 Chunk
 *         边缘 16m 渐变带衰减后烘焙）× 逐 Chunk uniform uMorphT（别名 uMorphLerp）
 *         在 LOD 切换 / 邻居变粗时 0.4s 确定性缓动；共享边上 band=1 且粗格双线性
 *         退化为精确线性插值，morphT=1 时细边顶点精确落在粗边折面上，T 形接缝闭合。
 *  - 视锥剔除：由 VP 构造 6 平面，Chunk AABB（含裙边 / morph / 曲率下沉余量）
 *    完全在某平面外侧即整块跳过；
 *  - 着色器：doc7 §8.2 TERRAIN_MESH_VS/FS 全特性（行星曲率 y-=distSq/(2R)、
 *    热区融雪凹陷 0.32m*积雪权重、4 通道材质、软硬边法线 smoothstep(0.82,0.55)、
 *    岩层理、热区辉光、生物荧光 + 脚步涟漪、岩浆黑体自发光、水下双波焦散 +
 *    RGB 波长吸收、距离雾、dbg==2 法线+1m 格线 / dbg==3 绕序审计）。
 *  - draw call 预算：地形 ≤64（视锥剔除后通常 ≤ ~30，由场景层再叠加天空/天气）。
 *
 * 约束：顶层不触碰 document/window（Node 侧可安全 import）；全程确定性（无
 * Math.random）；GLSL 为手写 GLSL ES 3.0（#version 行由 GLCore.createProgram
 * 自动前置）；tier≥3 时整体惰性（sync/draw 全部安全空操作）；上下文丢失安全
 * （isContextLost 时跳过，destroy 对失效句柄删除为空操作）。
 */

import { buildTriangulatedChunkMesh } from '../../domain/ground/terrainField.js';

// ———— 常量 ————————————————

/** LOD 距离阈值（相机到 Chunk AABB 最近点的水平距离，米） */
export const LOD0_MAX_DIST = 96.0;
export const LOD1_MAX_DIST = 192.0;
/** 垂直裙边深度（doc7 §2.5 / specs 6 §2.5：3.0m 向下裙边） */
export const SKIRT_DEPTH_M = 3.0;
/** Geomorph 渐变带宽度（距 Chunk 边缘 16m 内参与 morph） */
export const GEOMORPH_BAND_M = 16.0;
/** Geomorph 缓动时长（秒；确定性，由 time 驱动） */
export const GEOMORPH_DURATION_S = 0.4;
/** 视觉行星半径默认值（doc7：uPlanetCurveInv2R = 1/(2*1800)） */
export const DEFAULT_PLANET_RADIUS_M = 1800.0;

// ———— GLSL ————————————————

const TERRAIN_MESH_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aWeights; // 归一化 Uint8/255 → [0,1]
layout(location = 3) in vec2 aAux;     // (temp, moisture)
layout(location = 4) in float aMorph;  // geomorph 高度差（已烘焙 16m 边缘带）
uniform mat4 uVP;
uniform vec3 uCamPos;
uniform vec3 uWorldOffset;       // 场域 → 世界平移（GroundView 集成：(-224,0,-224) 对齐体素空间）
uniform float uPlanetCurveInv2R; // 1.0 / (2.0 * R)，默认 1.0/(2.0*1800.0)
uniform int uHeatZoneCount;
uniform vec4 uHeatZones[8];      // (x, z, radius, intensity)
uniform float uMorphT;           // 逐 Chunk geomorph 插值 [0,1]（uMorphLerp）
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vWeights;
out vec2 vAux;
out float vHeatField;
void main() {
  vec3 worldPos = aPos + uWorldOffset;
  /* Frostpunk 热区累积：核心（<=0.6r）全额，0.6r→r 平滑衰减 */
  float heat = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uHeatZoneCount) break;
    vec4 hz = uHeatZones[i];
    heat += hz.w * (1.0 - smoothstep(hz.z * 0.60, hz.z, distance(worldPos.xz, hz.xy)));
  }
  heat = clamp(heat, 0.0, 1.0);
  /* 融雪凹陷：0.32m，按材质通道 0（积雪）权重缩放 */
  worldPos.y -= heat * 0.32 * aWeights.x;
  /* Geomorph：LOD 切换 / 邻居变粗时向粗格形态缓动（共享边上精确闭合 T 缝） */
  worldPos.y += aMorph * uMorphT;
  /* DSP 行星曲率：y -= distSq / (2R)，远方沿星球弧度下沉没入地平线 */
  vec2 dCam = worldPos.xz - uCamPos.xz;
  float distSq = dot(dCam, dCam);
  vec3 curvedPos = vec3(worldPos.x, worldPos.y - distSq * uPlanetCurveInv2R, worldPos.z);
  vWorldPos = worldPos; /* 未弯曲世界坐标（雾 / 水下 / 格线均用平直空间） */
  vNormal = aNormal;
  vWeights = aWeights;
  vAux = aAux;
  vHeatField = heat;
  gl_Position = uVP * vec4(curvedPos, 1.0);
}`;

const TERRAIN_MESH_FS = `
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vWeights;
in float vHeatField;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform float uTime;
uniform float uHdr; /* 真 HDR=1.0；RGBA8 模拟模式=1/hdrRange（PostProcessor 约定） */
uniform vec3 uMatCol0;
uniform vec3 uMatCol1;
uniform vec3 uMatCol2;
uniform vec3 uMatCol3;
uniform vec4 uThemeFx;      /* x=waterLevel y=biolumePulse z=lavaEmissive w=debugMode */
uniform vec4 uFootsteps[8]; /* (x, z, triggerTime, strength) */
out vec4 fragColor;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 31.32);
  return fract((p.x + p.y) * p.z);
}
/* 三线性插值 value noise（f*f*(3-2f) 平滑） */
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}

void main() {
  int dbg = int(uThemeFx.w + 0.5);
  vec2 xz = vWorldPos.xz;
  float y = vWorldPos.y;

  /* 4 通道材质权重归一 */
  float wTotal = vWeights.x + vWeights.y + vWeights.z + vWeights.w;
  vec4 w = vWeights / max(wTotal, 1e-4);

  /* 岩层理 + 4 通道混合 */
  float detailXZ = noise3D(vec3(xz.x * 0.8, 0.0, xz.y * 0.8));
  float strata = 0.82 + 0.36 * sin(y * 2.6 + detailXZ * 2.2);
  vec3 baseCol = uMatCol0 * (0.88 + 0.24 * detailXZ);
  if (vHeatField > 0.01) {
    /* 热区湿润冻土 */
    baseCol = mix(baseCol, vec3(0.14, 0.10, 0.08), smoothstep(0.15, 0.65, vHeatField));
  }
  vec3 cliffCol = uMatCol1 * strata;
  vec3 biomeCol = uMatCol2 * (0.85 + 0.30 * noise3D(vWorldPos * 1.4));
  vec3 roadCol = uMatCol3;
  vec3 albedo = baseCol * w.x + cliffCol * w.y + biomeCol * w.z + roadCol * w.w;

  /* ———— 诊断分支（doc7 §2.2 三档 / §8.2） ———— */
  if (dbg == 3) {
    /* 绕序审计：gl_FrontFacing 正面翠绿 / 背面洋红（渲染器侧需临时关剔除） */
    fragColor = gl_FrontFacing ? vec4(0.1, 0.9, 0.3, 1.0) : vec4(1.0, 0.0, 0.8, 1.0);
    return;
  }
  if (dbg == 1) {
    /* unlit_nocull：无光照纯反照率（剔除由渲染器侧临时关闭） */
    fragColor = vec4(albedo, 1.0);
    return;
  }
  if (dbg == 2) {
    /* 法线 RGB + 1m 世界格线（黄，权重 0.6） */
    vec3 dbgCol = normalize(vNormal) * 0.5 + 0.5;
    vec3 fw = abs(fract(vWorldPos) - 0.5);
    float line = max(smoothstep(0.02, 0.06, fw.x),
                     max(smoothstep(0.02, 0.06, fw.y), smoothstep(0.02, 0.06, fw.z)));
    dbgCol = mix(dbgCol, vec3(1.0, 0.9, 0.2), line * 0.6);
    fragColor = vec4(dbgCol, 1.0);
    return;
  }

  /* 软硬边法线：陡崖（smoothN.y 越低越硬）向屏幕空间导数平面法线混合 */
  vec3 smoothN = normalize(vNormal);
  vec3 flatN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  float hardBlend = smoothstep(0.82, 0.55, smoothN.y);
  vec3 N = normalize(mix(smoothN, flatN, hardBlend * 0.65));

  float ndl = max(dot(N, uSunDir), 0.0);
  float hemi = 0.38 + 0.24 * (N.y * 0.5 + 0.5);
  vec3 lit = albedo * (uSunColor * ndl * 0.82 + hemi);
  /* 热区辉光 */
  lit += albedo * vec3(1.85, 0.82, 0.24) * vHeatField * 0.95;

  /* ———— 生物荧光（Avatar 压感生态） ———— */
  if (uThemeFx.y > 0.5) {
    float pulse = 0.55 + 0.45 * sin(length(xz) * 0.35 - uTime * 2.2);
    float bioVein = smoothstep(0.62, 0.88, noise3D(vWorldPos * 1.9)) * w.z;
    lit += uMatCol3 * bioVein * pulse * 1.6;
    /* 脚步压感荧光涟漪：3.5s 内 4.2m/s 扩散的高斯环 */
    for (int i = 0; i < 8; i++) {
      vec4 fp = uFootsteps[i];
      float age = uTime - fp.z;
      if (fp.w > 0.01 && age >= 0.0 && age < 3.5) {
        float dFoot = distance(xz, fp.xy);
        float rRing = age * 4.2;
        float dd = dFoot - rRing;
        /* 高斯环：(dFoot-rRing)^2 显式平方（pow 负底数在 GLSL 中未定义） */
        float ring = exp(-dd * dd / 0.20) * exp(-age * 1.1) * fp.w;
        lit += vec3(0.26, 0.95, 0.82) * ring * 2.2;
      }
    }
  }

  /* ———— 黑曜熔海裂隙黑体自发光 ———— */
  if (uThemeFx.z > 0.5 && y < -1.5) {
    float flow = noise3D(vec3(xz.x * 0.55 + uTime * 0.35, y, xz.y * 0.55));
    float crack = smoothstep(0.42, 0.78, flow);
    vec3 lavaCol = mix(vec3(0.90, 0.16, 0.04), vec3(2.80, 1.35, 0.22), crack);
    lit = mix(lit, lavaCol, smoothstep(-1.5, -3.2, y));
  }

  /* ———— AquaMan 水下双波焦散 + RGB 波长吸收 ———— */
  float waterLv = uThemeFx.x;
  if (waterLv > -90.0 && y < waterLv) {
    float depth = waterLv - y;
    vec2 uv1 = xz * 0.38 + vec2(uTime * 0.18, uTime * 0.11);
    vec2 uv2 = xz * 0.42 - vec2(uTime * 0.14, uTime * 0.19);
    float c1 = abs(sin(uv1.x * 3.14159) * cos(uv1.y * 3.14159));
    float c2 = abs(sin(uv2.x * 3.14159) * cos(uv2.y * 3.14159));
    float caustic = pow(1.0 - min(c1, c2), 4.0) * exp(-depth * 0.08) * ndl;
    lit += vec3(0.25, 0.92, 0.88) * caustic * 1.35;
    lit *= exp(-depth * vec3(0.12, 0.038, 0.014)); /* 红衰减最快，蓝青穿透最深 */
  }

  /* ———— 距离雾 ———— */
  float fog = smoothstep(uFogRange.x, uFogRange.y, distance(vWorldPos, uCamPos));
  fragColor = vec4(mix(lit, uFogColor, fog) * uHdr, 1.0);
}`;

// ———— 工具 ————————————————

/** 缓存程序 uniform 位置表 */
function locMap(gl, prog, names) {
  const m = {};
  for (const n of names) m[n] = gl.getUniformLocation(prog, n);
  return m;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ———— 渲染器 ————————————————

export class PlanetTerrainMesh {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例（CanvasManager.glc）
   * @param {number} tier 渲染层级 1|2|3（tier≥3 整体惰性：sync/draw 安全空操作）
   */
  constructor(glc, tier = 1) {
    if (!glc || !glc.gl) throw new Error('[PlanetTerrainMesh] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    this.tier = tier;
    this._destroyed = false;

    this.stats = { triangles: 0, drawCalls: 0, chunksVisible: 0, meshRebuilds: 0 };

    // —— 诊断：0=正式 1=unlit_nocull 2=wireframe_normal 3=winding_audit ——
    // cullEnabled 为公开字段（默认 true；网格已验证 CCW，诊断 1/3 渲染器侧临时关闭）
    this.cullEnabled = true;
    this._debugMode = 0;

    // —— 主题 uniform 载荷（setTheme 增量合并；渲染循环内零分配） ——
    this._matCols = [
      [0.78, 0.80, 0.86], // 通道 0：积雪 / 基岩表
      [0.34, 0.31, 0.28], // 通道 1：崖壁（×岩层理）
      [0.28, 0.42, 0.22], // 通道 2：生物群系表
      [0.44, 0.40, 0.36], // 通道 3：道路 / 荧光脉络色源
    ];
    this._heatZones = new Float32Array(32);
    this._heatZoneCount = 0;
    this._themeFx = new Float32Array([-1000.0, 0.0, 0.0, 0.0]); // 水位默认关闭（<-90 视为无水）
    this._footsteps = new Float32Array(32);
    this._fogColor = [0.62, 0.65, 0.70];
    this._fogRange = [60.0, 420.0];
    this._sunDir = [0.42, 0.78, 0.32];
    this._sunColor = [1.0, 0.96, 0.84];
    this._curveInv2R = 1.0 / (2.0 * DEFAULT_PLANET_RADIUS_M);
    this._time = 0;

    // —— 程序（与 PlanetSurface3D 一致：构造期建立，GLCore 自动前置 #version） ——
    const gl = this.gl;
    this.progTerrain = glc.createProgram(TERRAIN_MESH_VS, TERRAIN_MESH_FS, {
      label: 'terrain:mesh',
      attributes: { aPos: 0, aNormal: 1, aWeights: 2, aAux: 3, aMorph: 4 },
    });
    this._u = locMap(gl, this.progTerrain, [
      'uVP', 'uCamPos', 'uWorldOffset', 'uPlanetCurveInv2R', 'uHeatZoneCount', 'uHeatZones', 'uMorphT',
      'uSunDir', 'uSunColor', 'uFogColor', 'uFogRange', 'uTime', 'uHdr',
      'uMatCol0', 'uMatCol1', 'uMatCol2', 'uMatCol3', 'uThemeFx', 'uFootsteps',
    ]);

    // —— 逐 Chunk GPU 缓存（sync 惰性填充；下标 = cx*4096+cz 不可靠（外部数组序），
    // 用 Map：key = cx*4096+cz） ——
    this._entries = new Map(); // key → { lod, meshRevision, vao, vboMain, vboW, vboMor, ibo, indexCount, aabb, morphTarget, morphFlipAt, morphT }

    // —— 视锥 6 平面草稿（零分配；相机与 VP 由场景层每帧下发） ——
    this._frustum = new Float32Array(24);
    // —— 世界平移（场域 → 视图空间；GroundView 集成用 (-224,0,-224) 对齐体素空间） ——
    this._worldOffset = [0, 0, 0];
  }

  /**
   * 世界平移：顶点着色器 worldPos = aPos + uWorldOffset，视锥 AABB 与热区/
   * 脚步 uniform 同步平移（热区/脚步仍以场域坐标下发）。
   * GroundView 集成：offset (-224,0,-224) → 场域中心 (256,256) 对齐体素 (32,32)。
   * @param {Array<number>} o [x,y,z]
   */
  setWorldOffset(o) {
    if (Array.isArray(o) && o.length >= 3 && o.every(Number.isFinite)) {
      this._worldOffset = [o[0], o[1], o[2]];
    }
  }

  // —— 主题 / 配置 API ————————————————

  /**
   * 主题 uniform 合并（缺省字段保留现值）：
   *  matColors : [4]×vec3 linear        —— 4 通道材质基色
   *  heatZones : [{x,z,radius,intensity}]（≤8，radius<=0 的项忽略）
   *  themeFx   : { waterLevel, biolumePulse, lavaEmissive }（debugMode 走 setDebugMode）
   *  footsteps : [8]×{x,z,time,strength} 或 [x,z,time,s] 四元组（不足补零）
   *  fog       : { color:[r,g,b], range:[near,far] }
   *  sun       : { dir:[x,y,z], color:[r,g,b] }（dir 自动归一化）
   * @param {object} [theme]
   */
  setTheme(theme) {
    const t = theme || {};
    if (Array.isArray(t.matColors)) {
      for (let i = 0; i < 4 && i < t.matColors.length; i++) {
        const c = t.matColors[i];
        if (Array.isArray(c) && c.length >= 3) {
          this._matCols[i][0] = c[0]; this._matCols[i][1] = c[1]; this._matCols[i][2] = c[2];
        }
      }
    }
    if (Array.isArray(t.heatZones)) {
      this._heatZones.fill(0);
      let n = 0;
      for (const hz of t.heatZones) {
        if (n >= 8) break;
        if (!hz || !(hz.radius > 0.01) || !(Math.abs(hz.intensity || 0) > 1e-3)) continue;
        const o = n * 4;
        this._heatZones[o] = hz.x || 0;
        this._heatZones[o + 1] = hz.z || 0;
        this._heatZones[o + 2] = hz.radius;
        this._heatZones[o + 3] = hz.intensity || 0;
        n++;
      }
      this._heatZoneCount = n;
    }
    const fx = t.themeFx;
    if (fx) {
      if (fx.waterLevel != null) this._themeFx[0] = fx.waterLevel;
      if (fx.biolumePulse != null) this._themeFx[1] = fx.biolumePulse;
      if (fx.lavaEmissive != null) this._themeFx[2] = fx.lavaEmissive;
    }
    if (Array.isArray(t.footsteps)) {
      this._footsteps.fill(0);
      for (let i = 0; i < 8 && i < t.footsteps.length; i++) {
        const f = t.footsteps[i];
        if (!f) continue;
        const o = i * 4;
        if (Array.isArray(f)) {
          this._footsteps[o] = f[0] || 0; this._footsteps[o + 1] = f[1] || 0;
          this._footsteps[o + 2] = f[2] || 0; this._footsteps[o + 3] = f[3] || 0;
        } else {
          this._footsteps[o] = f.x || 0; this._footsteps[o + 1] = f.z || 0;
          this._footsteps[o + 2] = f.time != null ? f.time : 0;
          this._footsteps[o + 3] = f.strength || 0;
        }
      }
    }
    if (t.fog) {
      if (Array.isArray(t.fog.color) && t.fog.color.length >= 3) {
        this._fogColor = [t.fog.color[0], t.fog.color[1], t.fog.color[2]];
      }
      if (Array.isArray(t.fog.range) && t.fog.range.length >= 2) {
        this._fogRange = [t.fog.range[0], t.fog.range[1]];
      }
    }
    if (t.sun) {
      if (Array.isArray(t.sun.dir) && t.sun.dir.length >= 3) {
        const d = t.sun.dir;
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        this._sunDir = [d[0] / len, d[1] / len, d[2] / len];
      }
      if (Array.isArray(t.sun.color) && t.sun.color.length >= 3) {
        this._sunColor = [t.sun.color[0], t.sun.color[1], t.sun.color[2]];
      }
    }
  }

  /** 视觉行星半径（米）→ uPlanetCurveInv2R = 1/(2R) */
  setPlanetRadius(r) {
    const rad = Number(r);
    if (Number.isFinite(rad) && rad > 1) this._curveInv2R = 1.0 / (2.0 * rad);
  }

  /**
   * 地表诊断模式（与 PlanetSurface3D F3 三档对齐）：
   *  0=正式  1=unlit_nocull（渲染器侧临时关剔除）  2=法线+1m 格线  3=绕序审计（临时关剔除）
   * 注：真线框（gl.LINES 覆盖层）属后续诊断波次；模式 2 的 1m 黄色格线即
   * wireframe_normal 档的既定呈现。
   * @param {number} mode 0..3（越界回退 0） @returns {number} 实际生效模式
   */
  setDebugMode(mode) {
    const n = Math.round(Number(mode));
    this._debugMode = n >= 0 && n <= 3 && Number.isFinite(n) ? n : 0;
    return this._debugMode;
  }

  getDebugMode() { return this._debugMode; }

  /**
   * 背面剔除开关（默认 true；网格 CCW 已验证，诊断对照视图可临时关闭）。
   * 亦可直接读写公开字段 cullEnabled（与 PlanetSurface3D 同约定）。
   * @param {boolean} enabled
   */
  setCullEnabled(enabled) {
    this.cullEnabled = !!enabled;
  }

  /** 主题雾色 / 雾距（场景层取其作 beginScene 清屏基色与统计） */
  getFogColor() { return this._fogColor; }
  getFogRange() { return this._fogRange; }

  // ———— CPU 侧：LOD 决策 + GPU 缓冲构建 ————————————————

  /**
   * 逐帧同步：字段脏重建（增量）→ LOD 决策 → 受影响 Chunk 重建 GPU 缓冲 →
   * geomorph 状态推进。仅在需要时产生 CPU/GPU 开销，可每帧安全调用。
   * @param {object} field terrainField.createTerrainField 的返回实体
   * @param {Array<number>} camPos 相机世界坐标 [x,y,z]
   * @param {{time?:number}} [opts]
   */
  sync(field, camPos, opts = {}) {
    if (this._destroyed || this.tier >= 3 || !field || !Array.isArray(field.chunks)) return;
    const time = opts.time || 0;
    this._time = time;
    const wo = this._worldOffset;
    // 相机给到的是视图（平移后）空间坐标；LOD 距离按场域坐标求值（field = view - wo）
    const cx0 = camPos ? camPos[0] - wo[0] : 0;
    const cz0 = camPos ? camPos[2] - wo[2] : 0;

    let rebuilds = 0;
    // —— pass 1：字段网格增量重建 + LOD 决策 + GPU 缓冲按需重建（本帧 LOD 快照） ——
    const lodNow = new Map(); // key → 本帧 LOD（pass 2 邻居判定用，免受遍历序影响）
    for (const ch of field.chunks) {
      if (!ch) continue;
      const key = ch.cx * 4096 + ch.cz;

      // —— 1. 字段网格增量重建（仅脏 Chunk；TERRAIN-06） ——
      const vs = ch.vertices;
      const needFieldBuild = !!(ch.dirty
        || ch.meshRevision !== ch.sourceRevision
        || !vs || !vs.position || vs.position.length === 0);
      if (needFieldBuild) {
        buildTriangulatedChunkMesh(ch, field.evalPoint);
        rebuilds++;
      }

      // —— 2. LOD 决策（水平距离 → Chunk AABB 最近点） ——
      const b = ch.bounds;
      const nx = clamp(cx0, b.minX, b.maxX);
      const nz = clamp(cz0, b.minZ, b.maxZ);
      const dist = Math.hypot(cx0 - nx, cz0 - nz);
      const lod = dist < LOD0_MAX_DIST ? 0 : (dist < LOD1_MAX_DIST ? 1 : 2);

      // —— 3. GPU 缓冲按需重建 ——
      let ent = this._entries.get(key);
      if (!ent || ent.lod !== lod) {
        const prevLod = ent ? ent.lod : lod;
        if (ent) this._freeEntry(key);
        ent = this._buildChunkGpu(ch, lod);
        if (!ent) continue;
        ent.lod = lod;
        if (lod < prevLod) {
          // 变细（相机逼近）：新网格从粗形态(aMorph 全额)缓动显化到细形态
          ent.morphT = 1;
          ent.morphTarget = 0;
          ent.morphFrom = 1;
          ent.morphFlipAt = time;
        } else {
          // 变粗（远离）：aMorph 目标为更低一级粗格，无平滑可用（pop 由裙边+距离
          // 遮蔽）；首次构建同路径。稳态 0，交由邻居状态机按需抬升。
          ent.morphT = 0;
          ent.morphTarget = 0;
          ent.morphFrom = 0;
          ent.morphFlipAt = time - GEOMORPH_DURATION_S;
        }
        this._entries.set(key, ent);
        rebuilds++;
      } else if (ent.meshRevision !== ch.meshRevision) {
        // 内容编辑：同 LOD 重传，无 morph 瞬态（新旧形态采样一致）
        const keepT = ent.morphT;
        this._freeEntry(key);
        ent = this._buildChunkGpu(ch, lod);
        if (!ent) { this._entries.delete(key); continue; }
        ent.lod = lod;
        ent.morphT = keepT;
        ent.morphFrom = keepT;
        ent.morphTarget = keepT;
        ent.morphFlipAt = time - GEOMORPH_DURATION_S;
        this._entries.set(key, ent);
        rebuilds++;
      }
      lodNow.set(key, lod);
    }

    // —— pass 2：Geomorph 状态机（from→target 线性缓动 0.4s，time 驱动确定性）：
    //      邻居（按本帧 LOD 快照判定）更粗时 target=1 —— 共享边 T 缝精确闭合驻留；
    //      邻居回细后 target=0 恢复全细节。 ——
    for (const ch of field.chunks) {
      if (!ch) continue;
      const key = ch.cx * 4096 + ch.cz;
      const ent = this._entries.get(key);
      if (!ent) continue;
      let hasCoarser = false;
      if (ent.lod < 2) {
        const nbLod = [lodNow.get((ch.cx + 1) * 4096 + ch.cz), lodNow.get((ch.cx - 1) * 4096 + ch.cz),
          lodNow.get(ch.cx * 4096 + (ch.cz + 1)), lodNow.get(ch.cx * 4096 + (ch.cz - 1))];
        for (const nl of nbLod) {
          if (nl != null && nl > ent.lod) { hasCoarser = true; break; }
        }
      }
      const wantT = hasCoarser ? 1 : 0;
      if (wantT !== ent.morphTarget) {
        ent.morphFrom = ent.morphT;
        ent.morphTarget = wantT;
        ent.morphFlipAt = time;
      }
      const mt = clamp((time - ent.morphFlipAt) / GEOMORPH_DURATION_S, 0, 1);
      ent.morphT = ent.morphFrom + (ent.morphTarget - ent.morphFrom) * mt;
    }

    if (rebuilds > 0) this.stats.meshRebuilds += rebuilds;
  }

  /** 释放单个 Chunk 的 GPU 缓存（对失效句柄删除为空操作，上下文丢失安全） */
  _freeEntry(key) {
    const gl = this.gl;
    const ent = this._entries.get(key);
    if (!ent) return;
    if (ent.vboMain) gl.deleteBuffer(ent.vboMain);
    if (ent.vboW) gl.deleteBuffer(ent.vboW);
    if (ent.vboMor) gl.deleteBuffer(ent.vboMor);
    if (ent.ibo) gl.deleteBuffer(ent.ibo);
    if (ent.vao) gl.deleteVertexArray(ent.vao);
    this._entries.delete(key);
  }

  /**
   * 由 Chunk 源数据（65×65）构建某 LOD 的交错顶点 + 权重 + morph + 索引并上传。
   * 布局：主网格 nd×nd 顶 + 4 边裙边（每边 nd 顶 × 2：top/bottom 交错）。
   * 顶点交错 [x,y,z, nx,ny,nz, aux0,aux1]（stride 8 float）；
   * 权重 Uint8×4（normalized）；morph float×1；索引 Uint32（WebGL2 核心）。
   * @returns {object|null} entry（源数据不足时 null）
   */
  _buildChunkGpu(chunk, lod) {
    const gl = this.gl;
    const glc = this.glc;
    const N = chunk.gridSize || 65;
    const k = 1 << lod;                  // 1 / 2 / 4
    const nd = ((N - 1) / k | 0) + 1;    // 65 / 33 / 17
    const vs = chunk.vertices;
    if (!vs || !vs.position || vs.position.length < N * N * 3) return null;
    const pos = vs.position;
    const nor = vs.normal;
    const wgt = vs.materialWeights;
    const aux = vs.aux;
    const b = chunk.bounds;
    const stepM = (b.maxX - b.minX) / (N - 1); // 数据格步距（米）

    const vc = nd * nd;
    const totalV = vc + 8 * nd;          // 4 边 × nd 顶 × (top+bottom)
    const main = new Float32Array(totalV * 8);
    const wb = new Uint8Array(totalV * 4);
    const mor = new Float32Array(totalV);

    const lattice = 2 * k;               // geomorph 目标粗格（低一级 LOD 的采样距）
    const band = GEOMORPH_BAND_M;
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;

    /** 数据格高度（非有限防御归零，TERRAIN-01 精神） */
    const yAt = (I, J) => {
      const y = pos[(J * N + I) * 3 + 1];
      return Number.isFinite(y) ? y : 0.0;
    };

    for (let jj = 0; jj < nd; jj++) {
      for (let ii = 0; ii < nd; ii++) {
        const I = ii * k;
        const J = jj * k;
        const src = J * N + I;
        const o = (jj * nd + ii) * 8;
        const y = yAt(I, J);
        main[o] = pos[src * 3];
        main[o + 1] = y;
        main[o + 2] = pos[src * 3 + 2];
        // 法线缺省回退朝上（字段侧缺失时仍可渲染）
        let nx = 0; let ny = 1; let nz = 0;
        if (nor && nor.length >= src * 3 + 3) {
          nx = Number.isFinite(nor[src * 3]) ? nor[src * 3] : 0;
          ny = Number.isFinite(nor[src * 3 + 1]) ? nor[src * 3 + 1] : 1;
          nz = Number.isFinite(nor[src * 3 + 2]) ? nor[src * 3 + 2] : 0;
        }
        main[o + 3] = nx; main[o + 4] = ny; main[o + 5] = nz;
        if (aux && aux.length >= src * 2 + 2) {
          main[o + 6] = aux[src * 2];
          main[o + 7] = aux[src * 2 + 1];
        } else {
          main[o + 6] = 0.5; main[o + 7] = 0.0;
        }
        const wo = src * 4;
        for (let c = 0; c < 4; c++) {
          wb[(jj * nd + ii) * 4 + c] = wgt && wgt.length >= wo + 4 ? wgt[wo + c] : 0;
        }

        // —— geomorph 高度差：2k 粗格双线性（共享边上退化为精确线性插值） ——
        const i0 = I - (I % lattice);
        const j0 = J - (J % lattice);
        const i1 = Math.min(i0 + lattice, N - 1);
        const j1 = Math.min(j0 + lattice, N - 1);
        const fx = (I - i0) / lattice;
        const fz = (J - j0) / lattice;
        const yA = yAt(i0, j0);
        const yB = yAt(i1, j0);
        const yC = yAt(i0, j1);
        const yD = yAt(i1, j1);
        const south = yA + (yB - yA) * fx;
        const north = yC + (yD - yC) * fx;
        const coarseY = south + (north - south) * fz;
        const dEdge = Math.min(I, J, N - 1 - I, N - 1 - J) * stepM;
        const bandK = Math.max(0.0, 1.0 - dEdge / band);
        mor[jj * nd + ii] = (coarseY - y) * bandK;

        if (main[o] < minX) minX = main[o];
        if (y > maxY) maxY = y;
        if (main[o + 2] > maxZ) maxZ = main[o + 2];
        if (main[o] > maxX) maxX = main[o];
        if (y < minY) minY = y;
        if (main[o + 2] < minZ) minZ = main[o + 2];
      }
    }

    // —— 裙边顶点：复制边界顶点（同法线/权重/morph），y-3.0，top/bottom 交错 ——
    const edgeSrc = [
      (q) => q,                          // S：J=0 行，ii 升序，外向 (0,0,-1)
      (q) => (nd - 1) * nd + q,          // N：J=nd-1 行，外向 (0,0,1)
      (q) => q * nd,                     // W：I=0 列，jj 升序，外向 (-1,0,0)
      (q) => q * nd + (nd - 1),          // E：I=nd-1 列，外向 (1,0,0)
    ];
    for (let e = 0; e < 4; e++) {
      const base = vc + e * 2 * nd;
      for (let q = 0; q < nd; q++) {
        const m = edgeSrc[e](q);
        const dstT = base + q * 2;
        const dstB = dstT + 1;
        for (let f = 0; f < 8; f++) main[dstT * 8 + f] = main[m * 8 + f];
        main[dstB * 8] = main[m * 8];
        main[dstB * 8 + 1] = main[m * 8 + 1] - SKIRT_DEPTH_M;
        main[dstB * 8 + 2] = main[m * 8 + 2];
        main[dstB * 8 + 3] = main[m * 8 + 3];
        main[dstB * 8 + 4] = main[m * 8 + 4];
        main[dstB * 8 + 5] = main[m * 8 + 5];
        main[dstB * 8 + 6] = main[m * 8 + 6];
        main[dstB * 8 + 7] = main[m * 8 + 7];
        for (let c = 0; c < 4; c++) wb[dstT * 4 + c] = wb[m * 4 + c];
        for (let c = 0; c < 4; c++) wb[dstB * 4 + c] = wb[m * 4 + c];
        mor[dstT] = mor[m];
        mor[dstB] = mor[m];
        if (main[dstB * 8 + 1] < minY) minY = main[dstB * 8 + 1];
      }
    }

    // —— 索引：曲率自适应对角线（与 terrainField §8.1 同式，数据格 (I0+J0) 棋盘） ——
    const cellCount = (nd - 1) * (nd - 1);
    const skirtTri = 4 * (nd - 1);
    const indices = new Uint32Array((cellCount * 2 + skirtTri) * 3);
    let ti = 0;
    for (let jj = 0; jj < nd - 1; jj++) {
      for (let ii = 0; ii < nd - 1; ii++) {
        const v00 = jj * nd + ii;
        const v10 = v00 + 1;
        const v01 = v00 + nd;
        const v11 = v01 + 1;
        const I0 = ii * k;
        const J0 = jj * k;
        const checkerboardBias = (((I0 + J0) & 1) === 0 ? -0.02 : 0.02);
        const y00 = main[v00 * 8 + 1];
        const y10 = main[v10 * 8 + 1];
        const y01 = main[v01 * 8 + 1];
        const y11 = main[v11 * 8 + 1];
        const diffDiagA = Math.abs(y00 - y11) + checkerboardBias;
        const diffDiagB = Math.abs(y10 - y01);
        if (diffDiagA <= diffDiagB) {
          indices[ti] = v00; indices[ti + 1] = v01; indices[ti + 2] = v11;
          indices[ti + 3] = v00; indices[ti + 4] = v11; indices[ti + 5] = v10;
        } else {
          indices[ti] = v00; indices[ti + 1] = v01; indices[ti + 2] = v10;
          indices[ti + 3] = v10; indices[ti + 4] = v01; indices[ti + 5] = v11;
        }
        ti += 6;
      }
    }

    // —— 裙边索引：每段外向 CCW（以首段叉积与外向的符号确定整边绕序并翻转） ——
    const outward = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
    for (let e = 0; e < 4; e++) {
      const base = vc + e * 2 * nd;
      const ow = outward[e];
      const a = base;                    // top0
      const bq = base + 2;               // top1
      const c = base + 3;                // bottom1
      const e1x = main[bq * 8] - main[a * 8];
      const e1y = main[bq * 8 + 1] - main[a * 8 + 1];
      const e1z = main[bq * 8 + 2] - main[a * 8 + 2];
      const e2x = main[c * 8] - main[a * 8];
      const e2y = main[c * 8 + 1] - main[a * 8 + 1];
      const e2z = main[c * 8 + 2] - main[a * 8 + 2];
      const gnx = e1y * e2z - e1z * e2y;
      const gny = e1z * e2x - e1x * e2z;
      const gnz = e1x * e2y - e1y * e2x;
      const flip = (gnx * ow[0] + gny * ow[1] + gnz * ow[2]) < 0;
      for (let q = 0; q < nd - 1; q++) {
        const ta = base + q * 2;
        const tb = ta + 2;
        const ba = ta + 1;
        const bb = tb + 1;
        if (!flip) {
          indices[ti] = ta; indices[ti + 1] = tb; indices[ti + 2] = bb;
          indices[ti + 3] = ta; indices[ti + 4] = bb; indices[ti + 5] = ba;
        } else {
          indices[ti] = ta; indices[ti + 1] = bb; indices[ti + 2] = tb;
          indices[ti + 3] = ta; indices[ti + 4] = ba; indices[ti + 5] = bb;
        }
        ti += 6;
      }
    }

    // —— 上传 + VAO（位置/法线/aux 交错 float；权重 Uint8 归一化；morph float） ——
    const vboMain = glc.createBuffer(main);
    const vboW = glc.createBuffer(wb);
    const vboMor = glc.createBuffer(mor);
    // 索引缓冲必须直接经 ELEMENT_ARRAY_BUFFER 目标上传：本机 ANGLE 实现中，
    // 经 ARRAY_BUFFER 上传过的 buffer 再绑 ELEMENT_ARRAY_BUFFER 会被静默丢弃
    // （bindBuffer 不报错但 VAO 记录为空 → drawElements INVALID_OPERATION 零输出）。
    const ibo = gl.createBuffer();
    this.glc._tracked.buffers.push(ibo);
    const vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vboMain);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 32, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 32, 12);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 2, g.FLOAT, false, 32, 24);
      g.bindBuffer(g.ARRAY_BUFFER, vboW);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 4, g.UNSIGNED_BYTE, true, 4, 0);
      g.bindBuffer(g.ARRAY_BUFFER, vboMor);
      g.enableVertexAttribArray(4);
      g.vertexAttribPointer(4, 1, g.FLOAT, false, 4, 0);
      // 先脱离 ARRAY 绑定点再挂 ELEMENT，并直接经 ELEMENT 目标上传索引数据
      // （本机 ANGLE：经 ARRAY 上传过的 buffer 绑 ELEMENT 会被静默丢弃）
      g.bindBuffer(g.ARRAY_BUFFER, null);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, indices, g.STATIC_DRAW);
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // —— AABB（含裙边 + morph + 曲率下沉余量；只放宽不收紧，剔除安全） ——
    const aabb = [
      minX - 2.0, minY - 28.0, minZ - 2.0,
      maxX + 2.0, maxY + 6.0, maxZ + 2.0,
    ];

    return {
      lod, meshRevision: chunk.meshRevision, vao, vboMain, vboW, vboMor, ibo,
      indexCount: indices.length, aabb,
      morphTarget: 0, morphFrom: 0, morphFlipAt: -1e9, morphT: 0,
    };
  }

  // ———— 视锥剔除 ————————————————

  /** 由列主序 VP 提取 6 平面（left/right/bottom/top/near/far = row3±rowi） */
  _computeFrustum(vp) {
    const f = this._frustum;
    for (let p = 0; p < 6; p++) {
      const s = (p & 1) !== 0 ? -1 : 1;
      const r = p >> 1;
      f[p * 4] = vp[3] + s * vp[r];
      f[p * 4 + 1] = vp[7] + s * vp[4 + r];
      f[p * 4 + 2] = vp[11] + s * vp[8 + r];
      f[p * 4 + 3] = vp[15] + s * vp[12 + r];
    }
    return f;
  }

  /** AABB 完全在某平面外侧（正顶点 dot < 0）→ 剔除 */
  _aabbOutside(f, aabb) {
    for (let p = 0; p < 6; p++) {
      const a = f[p * 4];
      const b = f[p * 4 + 1];
      const c = f[p * 4 + 2];
      const d = f[p * 4 + 3];
      const px = a >= 0 ? aabb[3] : aabb[0];
      const py = b >= 0 ? aabb[4] : aabb[1];
      const pz = c >= 0 ? aabb[5] : aabb[2];
      if (a * px + b * py + c * pz + d < 0) return true;
    }
    return false;
  }

  // ———— 帧绘制 ————————————————

  /**
   * 绘制全部视锥内 Chunk（每可见 Chunk 1 次 drawElements）。
   * @param {WebGL2RenderingContext} gl
   * @param {{vp:Float32Array, eye:Array<number>, time:number, hdr:number}} view
   * @returns {{drawCalls:number, chunksVisible:number, triangles:number}}
   */
  draw(gl, view) {
    const out = { drawCalls: 0, chunksVisible: 0, triangles: 0 };
    if (this._destroyed || this.tier >= 3 || !gl || gl.isContextLost()) return out;
    const v = view || {};
    const vp = v.vp;
    const eye = v.eye || [0, 0, 0];
    const time = v.time || 0;
    const hdr = v.hdr != null ? v.hdr : 1.0;
    if (!vp) return out;

    gl.useProgram(this.progTerrain);
    const u = this._u;
    const wo = this._worldOffset;
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(u.uWorldOffset, wo[0], wo[1], wo[2]);
    gl.uniform1f(u.uPlanetCurveInv2R, this._curveInv2R);
    gl.uniform1i(u.uHeatZoneCount, this._heatZoneCount);
    if (wo[0] || wo[2]) {
      // 主题热区/脚步涟漪以场域坐标定义（doc7 §8.2）；世界平移后同步平移上传
      const hz = this._heatZones;
      const hzShift = new Float32Array(hz.length);
      for (let i = 0; i < hz.length; i += 4) {
        hzShift[i] = hz[i] + wo[0];
        hzShift[i + 1] = hz[i + 1] + wo[2];
        hzShift[i + 2] = hz[i + 2];
        hzShift[i + 3] = hz[i + 3];
      }
      gl.uniform4fv(u.uHeatZones, hzShift);
      const fs = this._footsteps;
      const fsShift = new Float32Array(fs.length);
      for (let i = 0; i < fs.length; i += 4) {
        fsShift[i] = fs[i] + wo[0];
        fsShift[i + 1] = fs[i + 1] + wo[2];
        fsShift[i + 2] = fs[i + 2];
        fsShift[i + 3] = fs[i + 3];
      }
      gl.uniform4fv(u.uFootsteps, fsShift);
    } else {
      gl.uniform4fv(u.uHeatZones, this._heatZones);
      gl.uniform4fv(u.uFootsteps, this._footsteps);
    }
    gl.uniform3fv(u.uSunDir, this._sunDir);
    gl.uniform3fv(u.uSunColor, this._sunColor);
    gl.uniform3fv(u.uFogColor, this._fogColor);
    gl.uniform2f(u.uFogRange, this._fogRange[0], this._fogRange[1]);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uHdr, hdr);
    const mc = this._matCols;
    gl.uniform3f(u.uMatCol0, mc[0][0], mc[0][1], mc[0][2]);
    gl.uniform3f(u.uMatCol1, mc[1][0], mc[1][1], mc[1][2]);
    gl.uniform3f(u.uMatCol2, mc[2][0], mc[2][1], mc[2][2]);
    gl.uniform3f(u.uMatCol3, mc[3][0], mc[3][1], mc[3][2]);
    const fx = this._themeFx;
    gl.uniform4f(u.uThemeFx, fx[0], fx[1], fx[2], this._debugMode);
    // uFootsteps 已在上方随 uHeatZones 一并上传（含世界平移同步）

    // —— 不透明基线（TERRAIN-02：CCW + BACK 剔除；诊断 1/3 渲染器侧临时关闭） ——
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.frontFace(gl.CCW);
    const cullOpaque = this.cullEnabled && this._debugMode !== 1 && this._debugMode !== 3;
    if (cullOpaque) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    const frustum = this._computeFrustum(vp);
    const woff = this._worldOffset;
    const offAabb = (woff[0] || woff[1] || woff[2])
      ? [0, 0, 0, 0, 0, 0]
      : null;
    let dc = 0;
    let visible = 0;
    let tris = 0;
    for (const ent of this._entries.values()) {
      if (!ent || !ent.vao) continue;
      if (offAabb) {
        // 场域坐标 AABB → 视图（平移后）空间再做剔除：worldPos = aPos + wo
        offAabb[0] = ent.aabb[0] + woff[0];
        offAabb[1] = ent.aabb[1] + woff[1];
        offAabb[2] = ent.aabb[2] + woff[2];
        offAabb[3] = ent.aabb[3] + woff[0];
        offAabb[4] = ent.aabb[4] + woff[1];
        offAabb[5] = ent.aabb[5] + woff[2];
        if (this._aabbOutside(frustum, offAabb)) continue;
      } else if (this._aabbOutside(frustum, ent.aabb)) {
        continue;
      }
      gl.bindVertexArray(ent.vao);
      gl.uniform1f(u.uMorphT, ent.morphT);
      gl.drawElements(gl.TRIANGLES, ent.indexCount, gl.UNSIGNED_INT, 0);
      dc++;
      visible++;
      tris += ent.indexCount / 3;
    }
    gl.bindVertexArray(null);

    out.drawCalls = dc;
    out.chunksVisible = visible;
    out.triangles = tris;
    this.stats.drawCalls = dc;
    this.stats.chunksVisible = visible;
    this.stats.triangles = tris;
    return out;
  }

  // —— 生命周期 ————

  /** 释放全部 GL 资源（glc.destroy() 仍会兜底清册回收） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const gl = this.gl;
    if (!gl) return;
    for (const key of Array.from(this._entries.keys())) this._freeEntry(key);
    this._entries.clear();
    if (this.progTerrain) gl.deleteProgram(this.progTerrain);
    this.progTerrain = null;
  }
}
