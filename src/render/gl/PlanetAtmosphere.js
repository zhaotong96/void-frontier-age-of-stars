/**
 * render/gl/PlanetAtmosphere.js — 行星地表天空穹顶 + 天气粒子渲染器（doc7 TASK-1.3）
 *
 * 天空（单程序 + uSkyMode 主题开关，避免着色器爆炸）：
 *  - 全屏三角反投影（inverse-VPP）解析渐变：zenith/horizon/ground 三段 + 太阳圆盘
 *    （高光晕双幂次）+ 无大气确定性星空（与 PlanetSurface3D 同式）；
 *  - uSkyMode=0 clear：纯渐变；
 *  - uSkyMode=1 aurora（dry_night_polar 极夜干燥极地）：地平线附近紫罗兰光幕，
 *    噪声调制的竖向帘幕 + 慢速相位射线；
 *  - uSkyMode=2 gas（sulfur_marsh 硫雾沼泽）：仰角低于 uGasHeight 的天空被噪声
 *    调制的黄绿毒气色调浸染（高度锁定体积感的近似）；
 *  - uSkyMode=3 dust（dust storm）：侧向拉伸噪声条纹（水平缓慢滚动）+ 近地平线
 *    尘幕，密度由 uModeParams.z 控制。
 * 天气粒子（≤512 实例化软圆点四边形，加性）：
 *  - 雪 / 灰烬 / 孢子 / 尘埃在相机周围盒域内随风向漂移；位置完全由
 *    hash(gl_InstanceID) + time 确定（wrap 取模，无随机数、无 CPU 粒子池）；
 *    密度>0 时才追加 1 次 draw call（drawArraysInstanced，gl_InstanceID 驱动）。
 *
 * 状态隔离（doc6 §3.2-3.3 / doc7 §2.2）：
 *  - 天空 pass 显式关 DEPTH_TEST + depthMask(false) + 关 BLEND + 关 CULL_FACE
 *    （单一全屏三角形无背面概念），结束恢复深度基线；
 *  - 天气粒子：BLEND(SRC_ALPHA, ONE) 加性、depthMask(false)、开深度测试被地形
 *    遮挡、关剔除，结束恢复。
 *
 * 约束：顶层不触碰 document/window（Node 侧可安全 import）；全程确定性；
 * GLSL 为手写 GLSL ES 3.0（#version 行由 GLCore 自动前置）；tier≥3 惰性。
 */

// ———— GLSL ————————————————

const SKY_VS = `
layout(location = 0) in vec3 aPos;
out vec2 vXY;
void main() {
  vXY = aPos.xy;
  gl_Position = vec4(aPos.xy, 0.99999, 1.0);
}`;

const SKY_FS = `
precision highp float;
in vec2 vXY;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
uniform float uHdr;
uniform int uSkyMode;      /* 0=clear 1=aurora 2=gas 3=dust */
uniform vec3 uModeParams;  /* x=auroraStrength y=gasHeight(仰角阈值) z=dustDensity */
/* doc20 WP-1.3：uStormFront = (cos(dir), sin(dir), frontAdvanceMeters, intensity 0..1) */
uniform vec4 uStormFront;
out vec4 fragColor;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
/* 2D value noise（f*f*(3-2f) 平滑） */
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
  vec4 p4 = uInvVP * vec4(vXY, 0.5, 1.0);
  /* 反投影分母非零保护（防 Inf/NaN 残留场景 FBO 被 bloom 逐帧放大） */
  float pw = abs(p4.w) < 1e-6 ? (p4.w >= 0.0 ? 1e-6 : -1e-6) : p4.w;
  vec3 dir = normalize(p4.xyz / pw - uCamPos);
  float up = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.30, up));
  float s = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(max(s, 1e-6), 800.0) * 3.2 + pow(max(s, 1e-6), 20.0) * 0.20);
  if (uStars > 0.5 && up > 0.02) {
    vec3 sp = floor(dir * 220.0);
    float st = hash13(sp);
    col += vec3(1.1, 1.15, 1.25) * step(0.9975, st) * (0.55 + 0.45 * sin(uTime * 2.0 + st * 40.0));
  }
  /* 方位角近似（条带域内稳定；极点附近由 band 权重压制） */
  float az = dir.x / (abs(dir.z) + 0.45);
  if (uSkyMode == 1) {
    /* 极夜紫罗兰光幕：地平线以上条带内噪声帘幕 + 慢速射线 */
    float band = smoothstep(0.02, 0.16, up) * smoothstep(0.80, 0.30, up);
    float curtain = vnoise2(vec2(az * 2.4 + uTime * 0.035, up * 2.6 - uTime * 0.012));
    curtain = pow(clamp(curtain * 1.35, 0.0, 1.0), 2.2);
    float ray = 0.55 + 0.45 * sin(uTime * 0.6 + az * 7.0 + curtain * 5.0);
    col += vec3(0.44, 0.18, 0.86) * band * curtain * ray * uModeParams.x * 1.5;
    col += vec3(0.16, 0.55, 0.52) * band * curtain * curtain * uModeParams.x * 0.5;
  } else if (uSkyMode == 2) {
    /* 硫雾低地：仰角低于 uGasHeight 的天空被黄绿毒气浸染（噪声翻滚） */
    float g = smoothstep(uModeParams.y + 0.10, uModeParams.y - 0.04, up);
    float churn = vnoise2(vec2(az * 3.0 + uTime * 0.05, up * 5.0 + uTime * 0.03));
    vec3 gasCol = mix(vec3(0.24, 0.42, 0.12), vec3(0.55, 0.78, 0.22), churn);
    col = mix(col, gasCol, g * (0.45 + 0.35 * churn));
  } else if (uSkyMode == 3) {
    /* 尘暴：侧向条纹（水平滚动）+ 近地平线尘幕，密度 uModeParams.z */
    float dens = clamp(uModeParams.z, 0.0, 1.0);
    float streak = vnoise2(vec2(az * 1.1 - uTime * 0.22, up * 9.0));
    streak = pow(streak, 2.0);
    float band = smoothstep(-0.05, 0.35, up) * smoothstep(0.9, 0.2, up);
    col = mix(col, mix(col, vec3(0.62, 0.47, 0.30), streak), dens * band * (0.35 + 0.65 * streak));
    col = mix(col, vec3(0.55, 0.42, 0.28), dens * smoothstep(0.12, -0.2, up) * 0.6);
  }
  /* doc20 WP-1.3：锋面方向天幕压暗（朝向锋面一侧；dir 由反投影重构） */
  if (uStormFront.w > 0.01) {
    float toStorm = clamp(dot(normalize(dir.xz), uStormFront.xy), 0.0, 1.0);
    float skyStorm = uStormFront.w * (0.35 + 0.65 * toStorm);
    col = mix(col, col * vec3(0.75, 0.62, 0.55), skyStorm * 0.75);
  }
  fragColor = vec4(col * uHdr, 1.0);
}`;

/** 天气粒子：实例 ID 哈希确定性漂移（盒域 wrap），相机基向量公告板 */
const WEATHER_VS = `
layout(location = 0) in vec2 aPos; /* 单位四边形角点 [-0.5,0.5]（TRIANGLE_STRIP） */
uniform mat4 uVP;
uniform vec3 uCamPos;
uniform vec3 uBox;      /* x=z 半径（米）, y=高度（米）, z 保留 */
uniform vec2 uWind;
uniform float uTime;
uniform float uFall;    /* 带符号归一化沉降速率（箱高/秒；负值上升，如孢子） */
uniform float uSize;    /* 基准尺寸（米） */
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out float vA;
float hash11(float n) {
  float p = fract(n * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
void main() {
  float id = float(gl_InstanceID);
  float h1 = hash11(id * 1.37 + 0.11);
  float h2 = hash11(id * 2.71 + 0.53);
  float h3 = hash11(id * 3.77 + 0.29);
  float h4 = hash11(id * 5.13 + 0.87);
  float drift = 0.7 + h2 * 0.6;
  float span = uBox.x * 2.0;
  float px = uCamPos.x + mod(h1 * span + uWind.x * uTime * drift, span) - uBox.x;
  float pz = uCamPos.z + mod(h3 * span + uWind.y * uTime * drift, span) - uBox.x;
  float tt = fract(h4 + uTime * uFall * drift); /* 0..1 生命周期相位（wrap） */
  float py = uCamPos.y + uBox.y * 0.55 - tt * uBox.y;
  vec3 w = vec3(px, py, pz) + (uRight * aPos.x + uUp * aPos.y) * uSize * (0.7 + h2 * 0.6);
  vUv = aPos;
  /* 盒域上下边界淡入淡出，隐藏 wrap 跳变 */
  vA = smoothstep(0.0, 0.08, tt) * smoothstep(1.0, 0.92, tt);
  gl_Position = uVP * vec4(w, 1.0);
}`;

const WEATHER_FS = `
precision highp float;
in vec2 vUv;
in float vA;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uHdr;
out vec4 fragColor;
void main() {
  float m = smoothstep(0.5, 0.12, length(vUv));
  float a = vA * uAlpha * m;
  if (a < 0.004) discard;
  fragColor = vec4(uColor * uHdr, a);
}`;

// ———— 天气类型表（确定性；颜色线性域） ————————

const WEATHER_KINDS = {
  snow:   { color: [0.92, 0.96, 1.00], fall: 0.10, size: 0.10, alpha: 0.55 },
  ash:    { color: [0.60, 0.55, 0.52], fall: 0.06, size: 0.14, alpha: 0.50 },
  spores: { color: [0.30, 0.95, 0.80], fall: -0.05, size: 0.08, alpha: 0.65 },
  spore:  { color: [0.30, 0.95, 0.80], fall: -0.05, size: 0.08, alpha: 0.65 },
  dust:   { color: [0.78, 0.64, 0.42], fall: 0.03, size: 0.12, alpha: 0.45 },
  motes:  { color: [0.42, 0.90, 0.95], fall: 0.02, size: 0.06, alpha: 0.40 },
};

const WEATHER_CAP = 512;

// ———— 渲染器 ————————————————

function locMap(gl, prog, names) {
  const m = {};
  for (const n of names) m[n] = gl.getUniformLocation(prog, n);
  return m;
}

export class PlanetAtmosphere {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例
   * @param {number} tier 渲染层级 1|2|3（tier≥3 惰性；1 时粒子密度减半）
   */
  constructor(glc, tier = 1) {
    if (!glc || !glc.gl) throw new Error('[PlanetAtmosphere] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    this.tier = tier;
    this._destroyed = false;
    this.stats = { drawCalls: 0, weatherCount: 0 };
    // doc20：风暴锋面状态（setStormFront；缺省 = 无风暴）
    this._stormFront = [0, 0, -400, 0.0];
    const gl = this.gl;

    this.progSky = glc.createProgram(SKY_VS, SKY_FS, { label: 'atmosphere:sky', attributes: { aPos: 0 } });
    this.progWeather = glc.createProgram(WEATHER_VS, WEATHER_FS, { label: 'atmosphere:weather', attributes: { aPos: 0 } });
    this._uSky = locMap(gl, this.progSky, [
      'uInvVP', 'uCamPos', 'uZenith', 'uHorizon', 'uGround', 'uSunDir', 'uSunColor',
      'uStars', 'uTime', 'uHdr', 'uSkyMode', 'uModeParams', 'uStormFront',
    ]);
    this._uWx = locMap(gl, this.progWeather, [
      'uVP', 'uCamPos', 'uBox', 'uWind', 'uTime', 'uFall', 'uSize', 'uRight', 'uUp',
      'uColor', 'uAlpha', 'uHdr',
    ]);

    // —— 天空全屏三角（与 PlanetSurface3D 同式） ——
    // 注意：raw gl.createBuffer 不接受数据参数（GLCore.createBuffer 才会同时
    // bufferData），此处必须显式 bindBuffer + bufferData，否则三角顶点为空。
    this._skyVao = glc.createVAO((g) => {
      const buf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), g.STATIC_DRAW);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    });
    // —— 天气粒子四边形（GLCore 单位条带四边形：aPos vec2 × 4） ——
    this._wxVao = glc.createFullscreenVAO();

    // —— 主题载荷（setTheme 合并；默认晴空） ——
    this._zenith = [0.30, 0.42, 0.62];
    this._horizon = [0.72, 0.66, 0.55];
    this._ground = [0.36, 0.33, 0.28];
    this._stars = 0.0;
    this._skyMode = 0;
    this._modeParams = [1.0, 0.12, 0.5]; // aurora 强度 / gas 高度仰角 / dust 密度
    this._sunDir = [0.42, 0.78, 0.32];
    this._sunColor = [1.0, 0.96, 0.84];
    this._weather = {
      kind: 'snow',
      density: 0.0,          // 0..1（0 = 无天气粒子）
      wind: [0.6, 0.2],
      boxHalf: 72.0,         // 相机周围盒域半宽
      boxHeight: 40.0,
    };
  }

  /**
   * 主题合并（缺省保留现值）：
   *  sky    : { zenith, horizon, ground, stars(0/1), skyMode(0..3),
   *             auroraStrength, gasHeight, dustDensity }
   *  sun    : { dir, color }
   *  weather: { kind('snow'|'ash'|'spores'|'dust'|'motes'), density(0..1),
   *             wind:[x,z], boxHalf, boxHeight }
   * @param {object} [theme]
   */
  setTheme(theme) {
    const t = theme || {};
    const sky = t.sky || t;
    if (Array.isArray(sky.zenith) && sky.zenith.length >= 3) {
      this._zenith = [sky.zenith[0], sky.zenith[1], sky.zenith[2]];
    }
    if (Array.isArray(sky.horizon) && sky.horizon.length >= 3) {
      this._horizon = [sky.horizon[0], sky.horizon[1], sky.horizon[2]];
    }
    if (Array.isArray(sky.ground) && sky.ground.length >= 3) {
      this._ground = [sky.ground[0], sky.ground[1], sky.ground[2]];
    }
    if (sky.stars != null) this._stars = sky.stars ? 1.0 : 0.0;
    if (sky.skyMode != null) {
      const m = Math.round(Number(sky.skyMode));
      this._skyMode = m >= 0 && m <= 3 ? m : 0;
    }
    if (sky.auroraStrength != null) this._modeParams[0] = sky.auroraStrength;
    if (sky.gasHeight != null) this._modeParams[1] = sky.gasHeight;
    if (sky.dustDensity != null) this._modeParams[2] = sky.dustDensity;
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
    if (t.weather) {
      const w = t.weather;
      if (w.kind != null && WEATHER_KINDS[w.kind]) this._weather.kind = w.kind;
      if (w.density != null) this._weather.density = Math.min(1, Math.max(0, Number(w.density) || 0));
      if (Array.isArray(w.wind) && w.wind.length >= 2) this._weather.wind = [w.wind[0], w.wind[1]];
      if (w.boxHalf != null) this._weather.boxHalf = Math.max(16, Number(w.boxHalf) || 72);
      if (w.boxHeight != null) this._weather.boxHeight = Math.max(8, Number(w.boxHeight) || 40);
    }
  }

  /** 当前天空基色（场景层取地平线色作 beginScene 清屏基色） */
  getHorizonColor() { return this._horizon; }

  // ———— 绘制 ————————————————

  /**
   * 天空 pass（1 次 draw call）。调用方应在场景 FBO 内、任何不透明几何之前调用。
   * 状态隔离：关深度/不写深度/关混合/关剔除；结束恢复深度基线（LEQUAL + 写深度）。
   * @param {WebGL2RenderingContext} gl
   * @param {{invVp:Float32Array, eye:Array<number>, time:number, hdr:number}} view
   */
  /**
   * doc20 WP-1.3：风暴锋面天幕 uniform（[cos(dir), sin(dir), frontM, intensity]）。
   * @private 状态槽在构造器初始化
   */
  setStormFront(v) {
    if (Array.isArray(v) && v.length >= 4 && v.every(Number.isFinite)) {
      this._stormFront = [v[0], v[1], v[2], v[3]];
    }
    return this;
  }

  drawSky(gl, view) {
    if (this._destroyed || this.tier >= 3 || !gl || gl.isContextLost()) return 0;
    const v = view || {};
    if (!v.invVp) return 0;
    const u = this._uSky;
    const eye = v.eye || [0, 0, 0];

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.progSky);
    gl.uniformMatrix4fv(u.uInvVP, false, v.invVp);
    gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3fv(u.uZenith, this._zenith);
    gl.uniform3fv(u.uHorizon, this._horizon);
    gl.uniform3fv(u.uGround, this._ground);
    gl.uniform3fv(u.uSunDir, this._sunDir);
    gl.uniform3fv(u.uSunColor, this._sunColor);
    gl.uniform1f(u.uStars, this._stars);
    gl.uniform1f(u.uTime, v.time || 0);
    gl.uniform1f(u.uHdr, v.hdr != null ? v.hdr : 1.0);
    gl.uniform1i(u.uSkyMode, this._skyMode);
    gl.uniform3fv(u.uModeParams, this._modeParams);
    if (u.uStormFront) {
      gl.uniform4f(u.uStormFront, this._stormFront[0], this._stormFront[1], this._stormFront[2], this._stormFront[3]);
    }
    gl.bindVertexArray(this._skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    // 恢复深度基线（混合/剔除由后续 pass 自行声明）
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    this.stats.drawCalls = 1;
    return 1;
  }

  /**
   * 天气粒子 pass（密度>0 时 1 次 draw call，否则 0）。
   * BLEND(SRC_ALPHA, ONE) 加性、深度测试开启（被地形遮挡）、不写深度、关剔除。
   * @param {WebGL2RenderingContext} gl
   * @param {{vp:Float32Array, view:Float32Array, eye:Array<number>, time:number, hdr:number}} view
   * @returns {number} 实际 draw call 数
   */
  drawWeather(gl, view) {
    if (this._destroyed || this.tier >= 3 || !gl || gl.isContextLost()) return 0;
    const w = this._weather;
    if (!(w.density > 0.001)) return 0;
    const v = view || {};
    if (!v.vp || !v.view) return 0;

    // 密度 → 实例数（tier 1 减半，tier 2 ×0.75；上限 512）
    const tierK = this.tier <= 1 ? 0.5 : (this.tier === 2 ? 0.75 : 1.0);
    const count = Math.min(WEATHER_CAP, Math.round(w.density * WEATHER_CAP * tierK));
    if (count <= 0) return 0;

    const kind = WEATHER_KINDS[w.kind] || WEATHER_KINDS.snow;
    // 列主序视图矩阵的行向量 = 相机基（右/上），公告板对齐
    const right = [v.view[0], v.view[4], v.view[8]];
    const up = [v.view[1], v.view[5], v.view[9]];
    const eye = v.eye || [0, 0, 0];

    gl.useProgram(this.progWeather);
    const u = this._uWx;
    gl.uniformMatrix4fv(u.uVP, false, v.vp);
    gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(u.uBox, w.boxHalf, w.boxHeight, 0.0);
    gl.uniform2f(u.uWind, w.wind[0], w.wind[1]);
    gl.uniform1f(u.uTime, v.time || 0);
    gl.uniform1f(u.uFall, kind.fall);
    gl.uniform1f(u.uSize, kind.size);
    gl.uniform3f(u.uRight, right[0], right[1], right[2]);
    gl.uniform3f(u.uUp, up[0], up[1], up[2]);
    gl.uniform3fv(u.uColor, kind.color);
    gl.uniform1f(u.uAlpha, kind.alpha);
    gl.uniform1f(u.uHdr, v.hdr != null ? v.hdr : 1.0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this._wxVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.stats.weatherCount = count;
    return 1;
  }

  // ———— 生命周期 ————

  /** 释放全部 GL 资源（glc.destroy() 仍会兜底清册回收） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const gl = this.gl;
    if (!gl) return;
    if (this._skyVao) gl.deleteVertexArray(this._skyVao);
    if (this._wxVao) gl.deleteVertexArray(this._wxVao);
    if (this.progSky) gl.deleteProgram(this.progSky);
    if (this.progWeather) gl.deleteProgram(this.progWeather);
    this._skyVao = null;
    this._wxVao = null;
    this.progSky = null;
    this.progWeather = null;
  }
}
