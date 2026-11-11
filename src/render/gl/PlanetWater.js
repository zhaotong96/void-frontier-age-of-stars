/**
 * render/gl/PlanetWater.js — 碧渊海洋五层水下光学管线 · 海面层（doc7 TASK-3.4 / §4.1-1）
 *
 * 五层管线分工（doc7 §4.1-1 ①..⑤；本渲染器承载 ① 海面层，②③④ 已内置于
 * PlanetTerrainMesh 的 TERRAIN_MESH_FS（RGB 波长吸收 exp(-depth*vec3(...)) +
 * 双波焦散 + 水深阳光衰减），⑤ 海洋雪/发光浮游由 PlanetAtmosphere 天气粒子
 * （themePayload: abyssal → motes）承载）：
 *  ① 海面双面波浪层 —— 本文件：场域全幅 96×96 单网格透明水面，VS 双波
 *     Gerstner 位移（水平收拢 + 解析法线），FS Fresnel 反射 + 太阳高光 +
 *     浅水染色 + 岸线浪花泡沫带 + 波峰白沫；双面（潜水员水下仰视可见）。
 *  岸线泡沫（水深 <0.8m 白色浪花，doc7）无深度纹理方案：sync() 经
 *     field.evalPoint 把地形高度逐顶点烘焙进 aAux.x 属性，FS 用插值地形高
 *     求水深 depth = waterLevel - terrY —— 潮汐涨落时泡沫带随水位自动贴岸。
 *
 * 性能守则（doc7 TASK-3.4 预算）：
 *  - ≤2 draw call：常态 1 次 drawElements；水位（潮汐）是 uWaterLevel uniform，
 *    网格永不因潮汐重建 —— 仅 field 网格修订（meshRevision/sourceRevision 变化，
 *    地形编辑/岸线漂移）时重建并重烘焙地形高度；
 *  - tier≥3 整体惰性（sync/draw 安全空操作）；无水主题（waterLevel ≤ -90，
 *    与地形 FS 同哨兵）draw 返回 0；
 *  - 渲染时机：不透明地形之后（深度测试遮挡岸上部分）、天气粒子之前；
 *    状态隔离：BLEND(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) + depthMask(false) +
 *    关剔除（双面），结束恢复进入前状态（doc6 §3.3 C / doc7 §2.2）。
 *
 * 潮汐（doc7：90 秒周期升降海平面 3.5m，控制海底洞穴通道开闭）：
 *    tideWaterLevel(baseLevel, time) = base + 3.5·sin(2π·time/90)
 *    调用方（GroundView/场景层）逐帧把结果作为 view.waterLevel 下发。
 *
 * 约束：顶层不触碰 document/window（Node 侧可安全 import）；全程确定性；
 * GLSL 为手写 GLSL ES 3.0（#version 行由 GLCore.createProgram 自动前置）；
 * 上下文丢失安全；destroy 对失效句柄删除为空操作。
 */

import { srgbToLinear } from './themePayload.js';

// ———— 常量 ————————————————

/** 潮汐周期（秒，doc7 §4.1-1：每 90 秒升降海平面 3.5m） */
export const TIDE_PERIOD_S = 90.0;
/** 潮汐振幅（米；相对任务基准水位对称升降） */
export const TIDE_AMPLITUDE_M = 3.5;
/** 水面网格细分（96×96 单元覆盖场域全幅 → 97×97 顶点 / 18432 三角形） */
export const WATER_GRID_CELLS = 96;
/** 默认场域尺寸（米；与 terrainField.createTerrainField 缺省一致） */
export const DEFAULT_FIELD_METERS = 512.0;
/** 无水哨兵（≤ 该值不产生 draw call；与 PlanetTerrainMesh uThemeFx.x 约定一致） */
export const WATERLEVEL_NONE = -1000.0;

/**
 * 潮汐水位：base + 3.5·sin(2π·time/90)（doc7 90 秒潮汐窗口）。
 * @param {number} baseLevel 任务基准水位（如 abyssal -4）
 * @param {number} time 场景时间（秒）
 * @returns {number} 当前海平面高程（米）
 */
export function tideWaterLevel(baseLevel, time) {
  const b = Number.isFinite(baseLevel) ? baseLevel : 0;
  const t = Number.isFinite(time) ? time : 0;
  return b + TIDE_AMPLITUDE_M * Math.sin((Math.PI * 2 * t) / TIDE_PERIOD_S);
}

// ———— GLSL ————————————————

const WATER_VS = `
layout(location = 0) in vec3 aPos;  /* (x, 0, z) 场域坐标；y 恒 0（水位走 uniform） */
layout(location = 1) in vec2 aAux;  /* x = 烘焙地形高（岸线泡沫/浅水染色），y 保留 */
uniform mat4 uVP;
uniform vec3 uWorldOffset;
uniform float uTime;
uniform float uWaterLevel;
out vec3 vWorldPos;
out vec3 vNormal;
out float vTerrY;
out float vCrest;
void main() {
  vec2 fxz = aPos.xz;
  vec2 wxz = fxz + uWorldOffset.xz;
  /* doc7 §4.1-1 ①：双波 Gerstner —— 两组不同波长/方向的行波叠加 */
  vec2 d1 = vec2(0.8620, 0.5069);
  vec2 d2 = vec2(-0.4856, 0.8742);
  float k1 = 0.2732; /* 2π/23m */
  float k2 = 0.5466; /* 2π/11.5m */
  float a1 = 0.34;
  float a2 = 0.18;
  float p1 = dot(wxz, d1) * k1 + uTime * 1.35;
  float p2 = dot(wxz, d2) * k2 + uTime * 2.10;
  float s1 = sin(p1);
  float c1 = cos(p1);
  float s2 = sin(p2);
  float c2 = cos(p2);
  float y = uWaterLevel + a1 * s1 + a2 * s2;
  /* Gerstner 水平收拢：波峰沿波向位移 -Q·A·cos（波峰变尖波谷变平） */
  wxz -= d1 * (0.55 * a1 * c1) + d2 * (0.45 * a2 * c2);
  /* 解析法线（双波叠加线性化；单位化后供 Fresnel/高光） */
  vec3 n = normalize(vec3(
    -d1.x * k1 * a1 * c1 - d2.x * k2 * a2 * c2,
    1.0,
    -d1.y * k1 * a1 * c1 - d2.y * k2 * a2 * c2));
  vec3 worldPos = vec3(wxz.x, y, wxz.y);
  vWorldPos = worldPos;
  vNormal = n;
  vTerrY = aAux.x;
  vCrest = y - uWaterLevel; /* 波峰高（泡沫用） */
  gl_Position = uVP * vec4(worldPos, 1.0);
}`;

const WATER_FS = `
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in float vTerrY;
in float vCrest;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uDeep;      /* 深水色（线性） */
uniform vec3 uShallow;   /* 浅水色（线性） */
uniform vec3 uFoamCol;   /* 浪花色（线性） */
uniform float uWaterLevel;
uniform float uTime;
uniform float uHdr;
out vec4 fragColor;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N; /* 双面：水下仰视仍正确照明 */
  vec3 V = normalize(uCamPos - vWorldPos);
  float depth = uWaterLevel - vTerrY; /* 烘焙地形高 → 水深（岸线泡沫核心判据） */
  float ndl = max(dot(N, uSunDir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  /* 浅水染色：浅滩透亮青绿 → 深处沉入深海蓝（②层吸收的表面侧近似） */
  vec3 body = mix(uDeep, uShallow, clamp(exp(-max(depth, 0.0) * 0.16), 0.0, 1.0));
  vec3 col = body * (0.35 + 0.65 * ndl);
  /* Fresnel 天光/太阳反射 + 高光 */
  vec3 refl = reflect(-V, N);
  float spec = pow(max(dot(refl, uSunDir), 0.0), 140.0) * 2.4;
  col = mix(col, uSunColor * 0.85, fres * 0.72);
  col += uSunColor * spec * ndl;
  /* 岸线浪花泡沫带（水深 <0.8m）+ 波峰白沫（噪声破碎） */
  float n1 = vnoise2(vWorldPos.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.22));
  float shore = smoothstep(0.85, 0.10, depth) * smoothstep(-0.05, 0.10, depth);
  float foam = shore * (0.35 + 0.65 * smoothstep(0.42, 0.78, n1));
  foam += smoothstep(0.28, 0.52, vCrest + n1 * 0.14) * 0.45;
  col = mix(col, uFoamCol, clamp(foam, 0.0, 1.0) * 0.85);
  /* 距离雾（与地形同 fog 参数；雾内 alpha 抬升使远处水面融入天幕） */
  float dist = distance(vWorldPos, uCamPos);
  float fogK = smoothstep(uFogRange.x, uFogRange.y, dist);
  col = mix(col, uFogColor, fogK);
  float alpha = 0.86 * smoothstep(-0.30, 0.10, depth); /* 岸上部分渐隐（深度测试双保险） */
  alpha = mix(alpha, 1.0, fogK * 0.9);
  fragColor = vec4(col * uHdr, clamp(alpha, 0.0, 1.0));
}`;

// ———— 渲染器 ————————————————

function locMap(gl, prog, names) {
  const m = {};
  for (const n of names) m[n] = gl.getUniformLocation(prog, n);
  return m;
}

export class PlanetWater {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例（CanvasManager.glc）
   * @param {number} tier 渲染层级 1|2|3（tier≥3 整体惰性：sync/draw 安全空操作）
   */
  constructor(glc, tier = 1) {
    if (!glc || !glc.gl) throw new Error('[PlanetWater] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    this.tier = tier;
    this._destroyed = false;
    this.stats = { drawCalls: 0, triangles: 0, meshRebuilds: 0 };

    this.progWater = glc.createProgram(WATER_VS, WATER_FS, {
      label: 'water:surface',
      attributes: { aPos: 0, aAux: 1 },
    });
    this._u = locMap(this.gl, this.progWater, [
      'uVP', 'uWorldOffset', 'uTime', 'uWaterLevel',
      'uCamPos', 'uSunDir', 'uSunColor', 'uFogColor', 'uFogRange',
      'uDeep', 'uShallow', 'uFoamCol', 'uHdr',
    ]);

    // —— 主题水位与色调（setTheme 同形字段可经 sync 注入；默认 abyssal 海色） ——
    this._waterLevel = -4.0;
    this._colors = {
      deep: srgbToLinear('#042A46'),
      shallow: srgbToLinear('#087F95'),
      foam: srgbToLinear('#DFF3F2'),
    };
    this._fogRange = [18.0, 140.0];
    this._worldOffset = [0, 0, 0];

    // —— 网格状态（惰性构建；仅 field 修订时重建，潮汐零重建） ——
    this._vao = null;
    this._ibo = null;
    this._indexCount = 0;
    this._builtFieldRev = null; // number | null
  }

  /** 世界平移（场域 → 视图空间；与 PlanetTerrainMesh 同语义：顶点 aPos + offset） */
  setWorldOffset(o) {
    if (Array.isArray(o) && o.length >= 3 && o.every(Number.isFinite)) {
      this._worldOffset = [o[0], o[1], o[2]];
    }
  }

  /** 当前水位（sync 最近一次记录；潮汐实时值以 draw 的 view.waterLevel 为准） */
  getWaterLevel() { return this._waterLevel; }

  /**
   * 主题/场景级 uniform 同步（可在 setTheme 后一次性下发；渲染循环内安全每帧调用）：
   *  - waterLevel: 基准水位（tideWaterLevel 的 base）
   *  - colors: { deep, shallow, foam } 各 [r,g,b] 线性
   *  - fogRange: [near, far]
   *  - field: terrainField 实体 → 重建 96×96 水面网格并逐顶点烘焙地形高
   *    （仅 field 修订变化时重建：sourceRevision/generatorVersion/ΣmeshRevision）
   * @param {{waterLevel?:number, colors?:object, fogRange?:Array<number>, field?:object}} [opts]
   * @returns {number} 本次调用重建的网格数（0/1）
   */
  sync(opts = {}) {
    if (this._destroyed || this.tier >= 3) return 0;
    const o = opts || {};
    if (Number.isFinite(o.waterLevel)) this._waterLevel = o.waterLevel;
    if (o.colors) {
      const c = o.colors;
      for (const k of ['deep', 'shallow', 'foam']) {
        if (Array.isArray(c[k]) && c[k].length >= 3 && c[k].every(Number.isFinite)) {
          this._colors[k] = [c[k][0], c[k][1], c[k][2]];
        }
      }
    }
    if (Array.isArray(o.fogRange) && o.fogRange.length >= 2
      && Number.isFinite(o.fogRange[0]) && Number.isFinite(o.fogRange[1])) {
      this._fogRange = [o.fogRange[0], o.fogRange[1]];
    }

    const field = o.field || null;
    let rev = null;
    if (field) {
      rev = ((field.sourceRevision | 0) * 1048576 + (field.generatorVersion | 0) * 4096) | 0;
      const chunks = Array.isArray(field.chunks) ? field.chunks : [];
      for (let i = 0; i < chunks.length; i++) {
        rev = (rev + (chunks[i] ? chunks[i].meshRevision | 0 : 0)) | 0;
      }
    }
    if (this._vao && rev === this._builtFieldRev) return 0;
    this._buildGrid(field);
    this._builtFieldRev = rev;
    this.stats.meshRebuilds++;
    return 1;
  }

  /**
   * 构建 96×96 水面网格（场域全幅单网格；aAux.x 逐顶点烘焙 field.evalPoint 地形高）。
   * 无 field 时（独立预览）以 waterLevel-6m 假想平坦海床（无岸线泡沫）。
   */
  _buildGrid(field) {
    const glc = this.glc;
    const gl = this.gl;
    const size = field && Number.isFinite(field.sizeMeters) ? field.sizeMeters : DEFAULT_FIELD_METERS;
    const ox = field && Number.isFinite(field.originX) ? field.originX : -size / 2;
    const oz = field && Number.isFinite(field.originZ) ? field.originZ : -size / 2;
    const N = WATER_GRID_CELLS;
    const step = size / N;
    const vn = N + 1;
    const pos = new Float32Array(vn * vn * 3);
    const aux = new Float32Array(vn * vn * 2);
    const fallbackTerr = (Number.isFinite(this._waterLevel) ? this._waterLevel : 0) - 6.0;
    for (let j = 0; j < vn; j++) {
      for (let i = 0; i < vn; i++) {
        const x = ox + i * step;
        const z = oz + j * step;
        const o = (j * vn + i) * 3;
        pos[o] = x;
        pos[o + 1] = 0;
        pos[o + 2] = z;
        let terrY = fallbackTerr;
        if (field && typeof field.evalPoint === 'function') {
          const s = field.evalPoint(x, z);
          if (s && Number.isFinite(s.y)) terrY = s.y;
        }
        const a = (j * vn + i) * 2;
        aux[a] = terrY;
        aux[a + 1] = 0;
      }
    }
    // 索引：行主序四边形 × 2 三角形，外向 CCW（+Y 俯视；关剔除时仍保正规绕序）
    const indices = new Uint32Array(N * N * 6);
    let ti = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v00 = j * vn + i;
        const v10 = v00 + 1;
        const v01 = v00 + vn;
        const v11 = v01 + 1;
        indices[ti] = v00; indices[ti + 1] = v01; indices[ti + 2] = v11;
        indices[ti + 3] = v00; indices[ti + 4] = v11; indices[ti + 5] = v10;
        ti += 6;
      }
    }

    // —— GL 资源（重建先释放旧句柄；对失效句柄删除为空操作） ——
    if (this._vao) this.glc.destroyVAO(this._vao); // F-09：连带装配期 inner buffer
    if (this._ibo) { gl.deleteBuffer(this._ibo); this._ibo = null; }

    // F-09：将 vboPos/vboAux 创建收纳进 createVAO 回调内部，回调内经
    // gl.createBuffer 拦截器建立的句柄记入 _vaoOwned —— destroyVAO 时
    // 自动级联释放，杜绝孤儿 VBO（此前装配在回调外，_vaoOwned 无法追溯）
    this._vao = glc.createVAO((g) => {
      const vboPos = glc.createBuffer(pos);
      const vboAux = glc.createBuffer(aux);
      const ibo = gl.createBuffer();
      glc._tracked.buffers.push(ibo);
      this._ibo = ibo;
      g.bindBuffer(g.ARRAY_BUFFER, vboPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 12, 0);
      g.bindBuffer(g.ARRAY_BUFFER, vboAux);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 2, g.FLOAT, false, 8, 0);
      g.bindBuffer(g.ARRAY_BUFFER, null);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, indices, g.STATIC_DRAW);
    });
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._indexCount = indices.length;
  }

  /**
   * 海面 pass（常态 1 次 drawElements；无水水位 / 未建网格时 0）。
   * 调用时机：不透明地形之后、天气粒子之前。状态隔离：BLEND(SRC_ALPHA,
   * ONE_MINUS_SRC_ALPHA) + depthMask(false) + 关剔除（双面），结束恢复进入前状态。
   * @param {WebGL2RenderingContext} gl
   * @param {{vp:Float32Array, eye:Array<number>, time:number, hdr:number,
   *          waterLevel?:number, sun?:{dir:Array<number>,color:Array<number>},
   *          fogColor?:Array<number>, fogRange?:Array<number>}} view
   * @returns {{drawCalls:number, triangles:number}}
   */
  draw(gl, view) {
    const out = { drawCalls: 0, triangles: 0 };
    if (this._destroyed || this.tier >= 3 || !gl || gl.isContextLost()) return out;
    const v = view || {};
    if (!v.vp || !this._vao) return out;
    const level = Number.isFinite(v.waterLevel) ? v.waterLevel : this._waterLevel;
    if (!(level > -90.0)) return out; // 无水主题哨兵（与地形 FS 同约定）

    const u = this._u;
    const sun = v.sun || {};
    const sunDir = Array.isArray(sun.dir) ? sun.dir : [0.42, 0.78, 0.32];
    const sunCol = Array.isArray(sun.color) ? sun.color : [1.0, 0.96, 0.84];
    const fogColor = Array.isArray(v.fogColor) ? v.fogColor : [0.03, 0.09, 0.16];
    const fogRange = Array.isArray(v.fogRange) && v.fogRange.length >= 2 ? v.fogRange : this._fogRange;
    const eye = v.eye || [0, 0, 0];
    const wo = this._worldOffset;
    const c = this._colors;

    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevCull = gl.isEnabled(gl.CULL_FACE);
    gl.useProgram(this.progWater);
    gl.uniformMatrix4fv(u.uVP, false, v.vp);
    gl.uniform3f(u.uWorldOffset, wo[0], wo[1], wo[2]);
    gl.uniform1f(u.uTime, v.time || 0);
    gl.uniform1f(u.uWaterLevel, level);
    gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(u.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
    gl.uniform3f(u.uSunColor, sunCol[0], sunCol[1], sunCol[2]);
    gl.uniform3f(u.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
    gl.uniform2f(u.uFogRange, fogRange[0], fogRange[1]);
    gl.uniform3f(u.uDeep, c.deep[0], c.deep[1], c.deep[2]);
    gl.uniform3f(u.uShallow, c.shallow[0], c.shallow[1], c.shallow[2]);
    gl.uniform3f(u.uFoamCol, c.foam[0], c.foam[1], c.foam[2]);
    gl.uniform1f(u.uHdr, v.hdr != null ? v.hdr : 1.0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE); /* 双面水面（潜水仰视） */
    gl.bindVertexArray(this._vao);
    gl.drawElements(gl.TRIANGLES, this._indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    if (!prevBlend) gl.disable(gl.BLEND);
    if (prevCull) gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    out.drawCalls = 1;
    out.triangles = this._indexCount / 3;
    this.stats.drawCalls = 1;
    this.stats.triangles = out.triangles;
    return out;
  }

  // —— 生命周期 ————

  /** 释放全部 GL 资源（glc.destroy() 仍会兜底清册回收） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const gl = this.gl;
    if (!gl) return;
    if (this._vao) this.glc.destroyVAO(this._vao); // F-09：连带装配期 inner buffer
    if (this._ibo) gl.deleteBuffer(this._ibo);
    if (this.progWater) gl.deleteProgram(this.progWater);
    this._vao = null;
    this._ibo = null;
    this.progWater = null;
  }
}
