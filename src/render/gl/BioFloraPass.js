/**
 * render/gl/BioFloraPass.js — 异星生态双通道实例化渲染器（doc18 v0.2 WP-4 / doc17 §3.4）
 *
 * 通道契约（doc18 红线 4：全图程序化植物与动物必须合流本通道，严格 2 次 Draw Call）：
 *   通道 A（植被风摆 1 DC）：单 VAO 图集 ≤1024 实例；VS 按 uTime/uWind 对
 *     y > 0.3m 顶点施加正弦摇摆 + 生物荧光呼吸脉冲（aGlow × uBiolumePulse）。
 *   通道 B（生物群落 1 DC）：单 VAO 图集 ≤128 实例；aLimb 编码肢体部位
 *     （0 躯干 / 1,2 足 / 3 头颈），四足迈步在 VS 内按 aSpeed × aPhase 代数求值，
 *     CPU 零骨骼更新负担（FFF #176 / 确定性相位插值纪律）。
 *
 * 确定性纪律：实例锚点（场域坐标）由 GroundView 从 xenobiology 物种名录确定性
 * 派生并在 sync() 一次性上传；游荡相位 CPU/GPU 同源（faunaPhaseOffset 纯函数
 * 与 VS 内同一公式），渲染层只消费快照、零 per-creature 对象。
 *
 * 性能守则：tier≥3 惰性（draw 0 dc 安全空操作）；无实例 0 dc；状态隔离
 * （进入前状态恢复，doc6 §3.3 C）；顶层不触碰 document/window（Node 可 import）；
 * 上下文丢失安全；destroy 对失效句柄删除为空操作。
 */

/** 通道 A 实例上限（植被） */
export const FLORA_MAX_INSTANCES = 1024;
/** 通道 B 实例上限（动物） */
export const FAUNA_MAX_INSTANCES = 128;

/**
 * 动物游荡相位偏移（CPU 口径；与 VS 内公式逐位同源——doc17 §2.1 确定性圆周方程）。
 * 锚点锁定第一营养级植物簇 12m 环带（调用方给定 anchor/radius）。
 * @param {number} anchorX 锚点场域 x
 * @param {number} anchorZ 锚点场域 z
 * @param {number} radius 游荡半径 m
 * @param {number} phase0 初相位（种子派生）
 * @param {number} speed 角速度 rad/s
 * @param {number} time 视觉时钟秒
 * @returns {{dx:number, dz:number, yaw:number}} 当前偏移与朝向（yaw = 行进方向）
 */
export function faunaPhaseOffset(anchorX, anchorZ, radius, phase0, speed, time) {
  const ph = phase0 + time * speed;
  const dx = Math.cos(ph) * radius;
  const dz = Math.sin(ph) * radius;
  const yaw = ph + Math.PI / 2; // 圆周切线方向
  return { dx, dz, yaw };
}

/** 通道 A 顶点着色器：十字双面片 × 风摆 + 荧光脉冲（GLSL ES 3.0，#version 由 GLCore.createProgram 注入） */
const FLORA_VS = `
layout(location=0) in vec2 aPos;        // 单位片 [-0.5..0.5]²（x 半区选十字片朝向）
layout(location=1) in vec3 iOffset;     // 实例锚点（场域坐标）
layout(location=2) in vec3 iParam;      // x: 高度 m, y: 相位, z: 朝向角
layout(location=3) in vec2 iExtra;      // x: hueIdx, y: glow(0..1)
uniform mat4 uVP;
uniform vec3 uWorldOffset;
uniform vec2 uWind;                     // x: 风向角, y: 风强 0..1
uniform float uTime;
uniform float uBiolumePulse;
out float vGlow;
out float vHue;
void main() {
  float h = iParam.x;
  // 十字双片：第二片（aPos.x > 0）绕 Y 轴再转 90°
  float ang = iParam.z + (aPos.x > 0.0 ? 0.0 : 1.5707963);
  float ca = cos(ang), sa = sin(ang);
  vec3 local = vec3(aPos.x * max(0.6, h * 0.5), aPos.y * max(0.4, h), 0.0);
  // 风摆：y > 0.3m 顶点按高度平方加权正弦偏移（doc18 通道 A 契约）
  float swayW = smoothstep(0.3, max(0.35, h), local.y) * (0.15 + 0.35 * uWind.y);
  float sway = sin(uTime * (1.6 + iParam.y * 0.13) + iParam.y) * swayW;
  local.x += sway;
  local.z += sway * 0.6;
  vec3 world = vec3(
    iOffset.x + local.x * ca - local.z * sa,
    iOffset.y + local.y,
    iOffset.z + local.x * sa + local.z * ca
  ) + uWorldOffset;
  vGlow = iExtra.y * (0.55 + 0.45 * sin(uTime * 2.1 + iParam.y)) * uBiolumePulse;
  vHue = iExtra.x;
  gl_Position = uVP * vec4(world, 1.0);
}
`;

const FLORA_FS = `
precision mediump float;
in float vGlow;
in float vHue;
uniform vec3 uColA;      // 主题植被基色（linear）
uniform vec3 uColB;      // 植被强调色（linear）
uniform float uHdr;
out vec4 fragColor;
void main() {
  vec3 base = mix(uColA, uColB, clamp(vHue / 5.0, 0.0, 1.0));
  vec3 col = base + vec3(0.35, 1.0, 0.85) * vGlow;   // 生物荧光呼吸（青绿谱）
  fragColor = vec4(col * uHdr, 1.0);
}
`;

/** 通道 B 顶点着色器：盒体躯干 × aLimb 肢体部位四足迈步代数（CPU 零骨骼） */
const FAUNA_VS = `
layout(location=0) in vec3 aPos;        // 单位盒 [-0.5..0.5]³
layout(location=1) in vec3 iAnchor;     // 游荡锚点（场域坐标）
layout(location=2) in vec4 iParam;      // x: 体长 m, y: 相位, z: 角速度, w: 游荡半径
layout(location=3) in vec2 iExtra;      // x: hueIdx, y: limb 编码（0 躯干/1,2 足/3 头）
uniform mat4 uVP;
uniform vec3 uWorldOffset;
uniform float uTime;
out float vHue;
out float vLimb;
void main() {
  // 游荡圆周相位方程（与 CPU faunaPhaseOffset 同源，doc17 §2.1）
  float ph = iParam.y + uTime * iParam.z;
  vec2 wander = vec2(cos(ph), sin(ph)) * iParam.w;
  float yaw = ph + 1.5707963;
  float ca = cos(yaw), sa = sin(yaw);
  vec3 local = aPos * max(0.3, iParam.x);
  // 四足迈步：足部（limb 1/2）按相位 ±π 交替抬升；躯干轻微起伏
  float limb = iExtra.y;
  if (limb > 0.5 && limb < 2.5) {
    float side = limb > 1.5 ? 3.14159265 : 0.0;
    float stepPh = ph * 4.0 + side + (limb > 1.5 ? 1.5707963 : 0.0);
    local.y += max(0.0, sin(stepPh)) * iParam.x * 0.18;
    local.z += cos(stepPh) * iParam.x * 0.10;
    local.x *= 0.22; local.y *= 0.5; // 足部细柱
  } else if (limb > 2.5) {
    local *= 0.32;                   // 头颈
    local.z += iParam.x * 0.55;
  }
  vec3 world = vec3(
    iAnchor.x + wander.x + local.x * ca - local.z * sa,
    iAnchor.y + local.y,
    iAnchor.z + wander.y + local.x * sa + local.z * ca
  ) + uWorldOffset;
  vHue = iExtra.x;
  vLimb = limb;
  gl_Position = uVP * vec4(world, 1.0);
}
`;

const FAUNA_FS = `
precision mediump float;
in float vHue;
in float vLimb;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uHdr;
out vec4 fragColor;
void main() {
  vec3 base = mix(uColA, uColB, clamp(vHue / 5.0, 0.0, 1.0));
  vec3 col = base * (vLimb > 2.5 ? 1.25 : 1.0);      // 头部提亮
  fragColor = vec4(col * uHdr, 1.0);
}
`;

/** 单位十字片几何：2 片 × 4 角 = 8 顶点（vec2 x,y；x 半区选片），4 三角 = 12 索引 */
const FLORA_QUAD_VERTS = new Float32Array([
  // 片 1（x < 0）
  -0.5, 0.0, 0.5, 0.0, -0.5, 1.0, 0.5, 1.0,
  // 片 2（x > 0）
  -0.5, 0.0, 0.5, 0.0, -0.5, 1.0, 0.5, 1.0,
]);
const FLORA_IDX = new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);

/** 单位盒体（24 顶点 12 面 → 肢体编码由实例属性注入；6 顶点条带式简化盒） */
const FAUNA_CUBE_VERTS = new Float32Array([
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
]);
const FAUNA_IDX = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
  0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
  0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
]);

export class BioFloraPass {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例（CanvasManager.glc）
   * @param {number} tier 渲染档位（≥3 整体惰性）
   */
  constructor(glc, tier) {
    this._glc = glc;
    this.tier = tier;
    this._destroyed = false;
    this._progFlora = null;
    this._progFauna = null;
    this._vaoFlora = null;
    this._vaoFauna = null;
    this._floraCount = 0;   // 实例数（0 = 跳过 draw → 0 dc）
    this._faunaCount = 0;
    if (glc && glc.gl && tier < 3) this._init(glc.gl);
  }

  _init(gl) {
    const glc = this._glc;
    this._progFlora = glc.createProgram(FLORA_VS, FLORA_FS, { label: 'bioflora:flora' });
    this._progFauna = glc.createProgram(FAUNA_VS, FAUNA_FS, { label: 'bioflora:fauna' });
    if (!this._progFlora || !this._progFauna) return;
    const uf = (prog, names) => {
      const o = {};
      for (const n of names) o[n] = gl.getUniformLocation(prog, n);
      return o;
    };
    this._uFlora = uf(this._progFlora, ['uVP', 'uWorldOffset', 'uWind', 'uTime', 'uBiolumePulse', 'uColA', 'uColB', 'uHdr']);
    this._uFauna = uf(this._progFauna, ['uVP', 'uWorldOffset', 'uTime', 'uColA', 'uColB', 'uHdr']);

    // —— 通道 A VAO：单位片 + 实例属性（offset vec3 / param vec3 / extra vec2） ——
    this._vaoFlora = glc.createVAO(() => {
      this._vboFloraQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFloraQuad);
      gl.bufferData(gl.ARRAY_BUFFER, FLORA_QUAD_VERTS, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      this._iboFlora = gl.createBuffer();
      // 注意本机 ANGLE 坑：索引缓冲必须以 ELEMENT 目标直传（memory: browser-automation-gotchas）
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._iboFlora);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FLORA_IDX, gl.STATIC_DRAW);
      this._vboFloraInst = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFloraInst);
      // 3 + 3 + 2 = 8 floats/instance，容量上限预分配（sync 时 bufferSubData 覆盖）
      gl.bufferData(gl.ARRAY_BUFFER, FLORA_MAX_INSTANCES * 8 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 32, 24);
      gl.vertexAttribDivisor(3, 1);
    });
    // —— 通道 B VAO：单位盒 + 实例属性（anchor vec3 / param vec4 / extra vec2） ——
    this._vaoFauna = glc.createVAO(() => {
      this._vboFaunaQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFaunaQuad);
      gl.bufferData(gl.ARRAY_BUFFER, FAUNA_CUBE_VERTS, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      this._iboFauna = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._iboFauna);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FAUNA_IDX, gl.STATIC_DRAW);
      this._vboFaunaInst = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFaunaInst);
      gl.bufferData(gl.ARRAY_BUFFER, FAUNA_MAX_INSTANCES * 9 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 12);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 36, 28);
      gl.vertexAttribDivisor(3, 1);
    });
    // CPU 侧暂存（sync 直传用；渲染循环零分配）
    this._floraStaging = new Float32Array(FLORA_MAX_INSTANCES * 8);
    this._faunaStaging = new Float32Array(FAUNA_MAX_INSTANCES * 9);
  }

  /**
   * 上传实例集（场域坐标锚点；实例数超限截断到通道上限）。
   * @param {{flora:Float32Array, floraCount:number, fauna:Float32Array, faunaCount:number}} inst
   */
  sync(inst) {
    if (this._destroyed || this.tier >= 3 || !this._progFlora) return this;
    const gl = this._glc.gl;
    if (!gl || gl.isContextLost()) return this;
    if (inst && inst.flora && inst.floraCount > 0) {
      const n = Math.min(inst.floraCount, FLORA_MAX_INSTANCES);
      this._floraStaging.set(inst.flora.subarray(0, n * 8));
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFloraInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._floraStaging.subarray(0, n * 8));
      this._floraCount = n;
    } else {
      this._floraCount = 0;
    }
    if (inst && inst.fauna && inst.faunaCount > 0) {
      const n = Math.min(inst.faunaCount, FAUNA_MAX_INSTANCES);
      this._faunaStaging.set(inst.fauna.subarray(0, n * 9));
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboFaunaInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._faunaStaging.subarray(0, n * 9));
      this._faunaCount = n;
    } else {
      this._faunaCount = 0;
    }
    return this;
  }

  /**
   * 双通道绘制（严格 ≤2 drawArraysInstanced；深度测试沿用场景状态，植被关背面剔除）。
   * @param {WebGL2RenderingContext} gl
   * @param {{vp:Float32Array, eye:Array<number>, time:number, hdr:number, worldOffset:Array<number>, colA:Array<number>, colB:Array<number>, biolumePulse:number, windAngle:number, windStrength:number}} view
   * @returns {{drawCalls:number}}
   */
  draw(gl, view) {
    const out = { drawCalls: 0 };
    if (this._destroyed || this.tier >= 3 || !gl || gl.isContextLost()) return out;
    if (!this._progFlora || !this._progFauna) return out;
    const v = view || {};
    if (this._floraCount === 0 && this._faunaCount === 0) return out;
    const wo = v.worldOffset || [0, 0, 0];
    const glc = this._glc;

    gl.disable(gl.CULL_FACE);                       // 十字双面片
    const depthOn = gl.isEnabled(gl.DEPTH_TEST);
    if (!depthOn) gl.enable(gl.DEPTH_TEST);
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);

    if (this._floraCount > 0) {
      gl.useProgram(this._progFlora);
      const u = this._uFlora;
      gl.uniformMatrix4fv(u.uVP, false, v.vp);
      gl.uniform3f(u.uWorldOffset, wo[0], wo[1], wo[2]);
      gl.uniform2f(u.uWind, v.windAngle || 0, v.windStrength != null ? v.windStrength : 0.4);
      gl.uniform1f(u.uTime, v.time || 0);
      gl.uniform1f(u.uBiolumePulse, v.biolumePulse != null ? v.biolumePulse : 1);
      const ca = v.colA || [0.24, 0.42, 0.22];
      const cb = v.colB || [0.45, 0.60, 0.30];
      gl.uniform3f(u.uColA, ca[0], ca[1], ca[2]);
      gl.uniform3f(u.uColB, cb[0], cb[1], cb[2]);
      gl.uniform1f(u.uHdr, v.hdr != null ? v.hdr : 1.0);
      gl.bindVertexArray(this._vaoFlora);
      gl.drawElementsInstanced(gl.TRIANGLES, 12, gl.UNSIGNED_SHORT, 0, this._floraCount);
      out.drawCalls++;
    }
    if (this._faunaCount > 0) {
      gl.useProgram(this._progFauna);
      const u = this._uFauna;
      gl.uniformMatrix4fv(u.uVP, false, v.vp);
      gl.uniform3f(u.uWorldOffset, wo[0], wo[1], wo[2]);
      gl.uniform1f(u.uTime, v.time || 0);
      const ca = v.colA || [0.35, 0.30, 0.24];
      const cb = v.colB || [0.55, 0.44, 0.30];
      gl.uniform3f(u.uColA, ca[0], ca[1], ca[2]);
      gl.uniform3f(u.uColB, cb[0], cb[1], cb[2]);
      gl.uniform1f(u.uHdr, v.hdr != null ? v.hdr : 1.0);
      gl.bindVertexArray(this._vaoFauna);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, this._faunaCount);
      out.drawCalls++;
    }

    gl.bindVertexArray(null);
    gl.useProgram(prevProg);
    if (depthOn) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    void glc;
    return out;
  }

  /** 释放全部 GL 资源（TERRAIN-08 清册纪律；失效句柄安全） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    const glc = this._glc;
    if (!glc || !glc.gl) return;
    const gl = glc.gl;
    for (const key of ['_progFlora', '_progFauna']) {
      if (this[key]) { try { gl.deleteProgram(this[key]); } catch (_) { /* 失效句柄 */ } this[key] = null; }
    }
    // F-09：VAO 由 glc.createVAO 创建（_tracked.vaos / _vaoOwned 清册内），
    // 优先走 destroyVAO 注销清册，原生 deleteVertexArray 会遗留孤儿句柄
    if (this._vaoFlora) {
      try { if (this._glc) this._glc.destroyVAO(this._vaoFlora); else gl.deleteVertexArray(this._vaoFlora); } catch (_) { /* 失效句柄 */ }
      this._vaoFlora = null;
    }
    if (this._vaoFauna) {
      try { if (this._glc) this._glc.destroyVAO(this._vaoFauna); else gl.deleteVertexArray(this._vaoFauna); } catch (_) { /* 失效句柄 */ }
      this._vaoFauna = null;
    }
    for (const key of ['_vboFloraQuad', '_iboFlora', '_vboFloraInst', '_vboFaunaQuad', '_iboFauna', '_vboFaunaInst']) {
      if (this[key]) { try { gl.deleteBuffer(this[key]); } catch (_) { /* 失效句柄 */ } this[key] = null; }
    }
  }
}
