/**
 * render/gl/Battle3D.js — 战术战斗 GL 资源构建与绘制（返工 Phase R4）
 *
 * 消费 BattleRenderer 传入的 battleView 数据（CPU 确定性坐标），将逻辑
 * 坐标 (x∈0..1000, y∈0..320) 映射至三维战术空间并绘制：
 *   三维舰体网格（12 船体，阵营色 Phong）+ 尾焰等离子锥 + 菲涅尔蜂窝
 *   护盾壳层（受击闪白）+ 相机对齐光束带 + 导弹光点尾迹 + 跃迁漏斗。
 * 动画时间仅作视觉 uniform，绝不触碰 world 状态。
 */

import {
  mat4, mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt,
  mat4Invert, mat4TRS, vec3ApplyMat4,
} from './Mat4.js';
import { buildHullMesh } from '../meshes/ShipMeshes.js';

/** 逻辑坐标 → 世界坐标（x 纵深为战列线，z 为横向展开） */
export function logicalToWorld(x, y, out = [0, 0, 0]) {
  out[0] = (y - 160) * 0.03;   // 逻辑纵向 → 世界 Z（战场纵深）
  out[1] = 0;                  // 战列基准面
  out[2] = (x - 500) * 0.022;  // 逻辑横向 → 世界 X
  return out;
}

const SHIP_VS = `
in vec3 aPos;
in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vWorldPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = uNormalMat * aNormal;
  gl_Position = uMVP * wp;
}`;

const SHIP_FS = `
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uCamPos;
uniform float uFlash;   // 受击闪白 0..1
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(vec3(0.4, 1.0, 0.55));
  vec3 V = normalize(uCamPos - vWorldPos);
  float diff = max(dot(N, L), 0.0) * 0.75 + 0.25;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.9;
  vec3 col = uColor * diff + vec3(1.0, 1.0, 1.05) * spec;
  // 阵营灯带：沿舰体边缘（世界 y 接近甲板高度）发暖光
  float stripe = smoothstep(0.015, 0.0, abs(vWorldPos.y - 0.05));
  col += uColor * stripe * 0.9;
  col = mix(col, vec3(2.2, 2.3, 2.6), uFlash);
  fragColor = vec4(col, 1.0);
}`;

const THRUST_VS = `
in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

const THRUST_FS = `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
out vec4 fragColor;
void main() { fragColor = vec4(uColor * uIntensity, 1.0); }`;

const SHIELD_VS = `
in vec3 aPos;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vLocal;
out vec3 vWorldPos;
void main() {
  vLocal = aPos;
  vec4 wp = uModel * vec4(aPos * 1.6, 1.0); // 包络放大
  vWorldPos = wp.xyz;
  gl_Position = uMVP * wp;
}`;

const SHIELD_FS = `
precision highp float;
in vec3 vLocal;
in vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uCamPos;
uniform float uPower;    // 护盾比 0..1
uniform float uFlash;    // 受击闪白 0..1
uniform float uHex;      // 1=蜂窝细节（tier1），0=素壳
out vec4 fragColor;
void main() {
  vec3 N = normalize(vLocal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float fres = pow(1.0 - abs(dot(N, V)), 2.4);
  float hex = 1.0;
  if (uHex > 0.5) {
    // 蜂窝六边形网格（局部坐标平面投影近似）
    vec2 p = vLocal.xz * 14.0 + vLocal.yx * 5.0;
    vec2 g = vec2(1.7320508 * p.x, p.y + 0.8660254 * abs(mod(p.x, 2.0) - 1.0));
    vec2 f = abs(fract(g) - 0.5);
    hex = smoothstep(0.42, 0.5, max(f.x, f.y)) * 0.8 + 0.2;
  }
  float a = fres * (0.25 + uPower * 0.5) * hex + uFlash * 0.55;
  vec3 col = uColor * (1.6 + uFlash * 2.5) + vec3(0.6) * uFlash;
  fragColor = vec4(col * a, clamp(a, 0.0, 0.85));
}`;

const QUAD_VS = `
in vec3 aPos;
in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const BEAM_FS = `
precision highp float;
in vec2 vUV;             // u: 沿光束 0..1；v: 横向 -1..1
uniform vec3 uColor;
uniform float uTime;
out vec4 fragColor;
void main() {
  float core = exp(-vUV.y * vUV.y * 9.0);
  float glow = exp(-vUV.y * vUV.y * 2.2) * 0.5;
  float pulse = 0.85 + 0.15 * sin(uTime * 40.0 + vUV.x * 30.0);
  vec3 col = vec3(2.6, 2.7, 3.0) * core + uColor * glow;
  float endFade = smoothstep(0.0, 0.06, vUV.x) * smoothstep(1.0, 0.94, vUV.x);
  fragColor = vec4(col * pulse * endFade, clamp(core + glow, 0.0, 0.9) * endFade);
}`;

const GLOW_FS = `
precision highp float;
in vec2 vUV;             // -1..1
uniform vec3 uColor;
uniform float uIntensity;
out vec4 fragColor;
void main() {
  float d = exp(-dot(vUV, vUV) * 4.5);
  fragColor = vec4(uColor * d * uIntensity, d * 0.8);
}`;

const WARP_FS = `
precision highp float;
in vec2 vUV;             // -1..1（锥面展开）
uniform float uCharge;   // 0..1 蓄能比
out vec4 fragColor;
void main() {
  // 不断坍缩聚焦的蓝紫色切伦科夫空间扭曲漏斗
  float rings = fract(vUV.x * 3.0 - uCharge * 6.0);
  float ring = smoothstep(0.0, 0.25, rings) * smoothstep(0.75, 0.5, rings);
  float body = exp(-abs(vUV.y) * 3.5) * (0.4 + uCharge);
  vec3 col = mix(vec3(0.4, 0.9, 3.2), vec3(1.6, 0.5, 3.4), vUV.x);
  float a = (body * (0.5 + ring) ) * uCharge;
  fragColor = vec4(col * a * 2.4, clamp(a, 0.0, 0.9));
}`;

const BG_VS = `
in vec3 aPos;
out vec2 vXY;
void main() { vXY = aPos.xy; gl_Position = vec4(aPos.xy, 0.9999, 1.0); }`;

const BG_FS = `
precision highp float;
in vec2 vXY;
uniform float uTime;
uniform float uHue;
out vec4 fragColor;
/* 确定性哈希与 3D fBm 星云背景（返工 R3 规范：5 八度 + 域扭曲） */
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2D(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise2D(p); p = p * 2.03 + vec2(11.3, 7.7); a *= 0.5; }
  return v;
}
void main() {
  vec3 col = vec3(0.010, 0.014, 0.024);
  vec2 q = vXY * 2.4 + vec2(uTime * 0.004, 0.0);
  float warp = fbm(q);
  float neb = fbm(q + warp * 1.4 + uHue * 7.0);
  vec3 nebA = vec3(0.30, 0.10, 0.42);
  vec3 nebB = vec3(0.05, 0.22, 0.38);
  col += mix(nebA, nebB, uHue) * pow(max(neb - 0.42, 0.0), 1.6) * 1.15;
  // 远景恒星
  vec2 sp = vXY * 160.0;
  float star = pow(hash21(floor(sp)), 40.0) * smoothstep(0.5, 0.05, length(fract(sp) - 0.5));
  col += vec3(1.5, 1.6, 1.9) * star;
  fragColor = vec4(col, 1.0);
}`;

/** 相机基（每帧由 BattleRenderer 计算传入） */
export function makeCamera(aspect) {
  const proj = mat4();
  const view = mat4();
  const vp = mat4();
  return { proj, view, vp, aspect };
}

export class Battle3D {
  /**
   * @param glc GLContext 实例（CanvasManager.glc）
   * @param tier LOD 档位 1|2
   */
  constructor(glc, tier = 1) {
    this.glc = glc;
    this.tier = tier;
    this._buildResources();
    this._unitCache = new Map();   // shipId → { prevShield, flashUntil }
    this._scratch = {
      mvp: mat4(), model: mat4(), view2: mat4(), tmp: mat4(),
      proj: mat4(), view: mat4(),
      camPos: [0, 0, 0], inv: mat4(),
    };
  }

  _buildResources() {
    const glc = this.glc;
    const gl = glc.gl;
    this.progShip = glc.createProgram(SHIP_VS, SHIP_FS, { label: 'battle:ship' });
    this.progShield = glc.createProgram(SHIELD_VS, SHIELD_FS, { label: 'battle:shield' });
    this.progFlat = glc.createProgram(THRUST_VS, THRUST_FS, { label: 'battle:flat' });
    this.progQuad = glc.createProgram(QUAD_VS, BEAM_FS, { label: 'battle:beam', attributes: { aPos: 0, aUV: 1 } });
    this.progGlow = glc.createProgram(QUAD_VS, GLOW_FS, { label: 'battle:glow', attributes: { aPos: 0, aUV: 1 } });
    this.progWarp = glc.createProgram(QUAD_VS, WARP_FS, { label: 'battle:warp', attributes: { aPos: 0, aUV: 1 } });
    this.progBg = glc.createProgram(BG_VS, BG_FS, { label: 'battle:bg', attributes: { aPos: 0 } });

    // 单位四边形（光束/光斑/漏斗通用，aPos xy 平面 + aUV）
    const quad = new Float32Array([
      -1, -1, 0, 0, 1,
      1, -1, 0, 1, 1,
      1, 1, 0, 1, 0,
      -1, -1, 0, 0, 1,
      1, 1, 0, 1, 0,
      -1, 1, 0, 0, 0,
    ]);
    this.quadBuf = glc.createBuffer(quad);
    this.quadVAO = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, this.quadBuf);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 20, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 2, g.FLOAT, false, 20, 12);
    });

    // 背景全屏三角形
    this.bgBuf = glc.createBuffer(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]));
    this.bgVAO = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, this.bgBuf);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    });

    // 船体网格 → VAO（含位置/法线）
    this.hullVAOs = new Map();
    for (const hullId of ['hull_scout', 'hull_interceptor', 'hull_frigate', 'hull_destroyer',
      'hull_gun_cruiser', 'hull_aa_cruiser', 'hull_battleship', 'hull_carrier',
      'hull_industrial', 'hull_miner', 'hull_science', 'hull_supply']) {
      const mesh = buildHullMesh(hullId);
      const vboP = glc.createBuffer(mesh.positions);
      const vboN = glc.createBuffer(mesh.normals);
      const vao = glc.createVAO((g) => {
        g.bindBuffer(g.ARRAY_BUFFER, vboP);
        g.enableVertexAttribArray(0);
        g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
        g.bindBuffer(g.ARRAY_BUFFER, vboN);
        g.enableVertexAttribArray(1);
        g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      });
      this.hullVAOs.set(hullId, { vao, triCount: mesh.triCount });
    }

    // 护盾球（低模球 5×5 段）
    const sb = new MeshBuilderLite();
    sphereTo(sb, 0, 0, 0, 1, 5);
    const shieldMesh = sb.build();
    this.shieldVAO = glc.createVAO(((vboP) => (g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vboP);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    })(glc.createBuffer(shieldMesh.positions)));
    this.shieldTriCount = shieldMesh.triCount;

    gl.checkError && glc.checkError('Battle3D.build');
  }

  /**
   * 绘制一帧战斗场景（在 cm.beginGLFrame() 之后调用）。
   * @param data battleView 数据
   * @param opts { time, camPos, camTarget, tier }
   */
  draw(gl, width, height, data, opts) {
    const s = this._scratch;
    const time = opts.time || 0;
    const tier = this.tier;

    // —— 相机 ——
    mat4Perspective(s.proj, Math.PI / 4, width / Math.max(1, height), 0.1, 120);
    mat4LookAt(s.view, opts.camPos, opts.camTarget, [0, 1, 0]);
    mat4Multiply(s.mvp, s.proj, s.view);
    s.inv.set(s.proj);
    mat4Invert(s.tmp, s.view);

    // —— 背景（关深度写） ——
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progBg);
    gl.bindVertexArray(this.bgVAO);
    gl.uniform1f(gl.getUniformLocation(this.progBg, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(this.progBg, 'uHue'), Math.abs(Math.sin((data.systemId || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0))) * 0.8);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    // —— 舰体 ——
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.progShip);
    const uShipMVP = gl.getUniformLocation(this.progShip, 'uMVP');
    const uShipModel = gl.getUniformLocation(this.progShip, 'uModel');
    const uShipColor = gl.getUniformLocation(this.progShip, 'uColor');
    const uShipFlash = gl.getUniformLocation(this.progShip, 'uFlash');
    const uCam = gl.getUniformLocation(this.progShip, 'uCamPos');
    gl.uniform3fv(uCam, opts.camPos);

    const sideColors = {
      a: [0.31, 0.85, 0.91],
      b: [0.91, 0.42, 0.38],
    };
    if (data.sides) {
      // 玩家侧按阵营主色；敌侧固定红系（数据里无颜色则用默认）
    }

    const visible = (data.units || []).filter((u) => !u.destroyed);
    for (const u of visible) {
      const w = logicalToWorld(u.x, u.y);
      // 横滚：按航向角与逻辑朝向的耦合做视觉侧倾（CPU 坐标不改）
      const bank = Math.sin((u.heading || 0)) * 0.35;
      mat4TRS(s.model, w[0], w[1], w[2], 0, -(u.heading || 0), bank, 0.9);
      mat4Multiply(s.mvp, s.view, s.model);
      mat4Multiply(s.mvp, s.proj, s.mvp);

      const flash = this._flashOf(u);
      const hullKey = guessHull(u);
      const hv = this.hullVAOs.get(hullKey) || this.hullVAOs.get('hull_frigate');
      gl.useProgram(this.progShip);
      gl.uniformMatrix4fv(uShipMVP, false, s.mvp);
      gl.uniformMatrix4fv(uShipModel, false, s.model);
      gl.uniform3fv(uShipColor, sideColors[u.side] || sideColors.a);
      gl.uniform1f(uShipFlash, flash);
      gl.bindVertexArray(hv.vao);
      gl.drawArrays(gl.TRIANGLES, 0, hv.triCount);

      // 尾焰等离子锥（推进中更亮）
      if (tier <= 2) {
        const speed = Math.abs(Math.sin(u.heading || 0)) + Math.abs(Math.cos(u.heading || 0));
        this._drawFlat(gl, s, u, -0.55, 0.16, [1.2, 3.2, 6.5], 0.9 + speed * 0.4, Math.PI / 2);
      }

      // 菲涅尔蜂窝护盾壳层
      if ((u.shieldMax || 0) > 0 && u.shield > 0) {
        gl.useProgram(this.progShield);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.progShield, 'uMVP'), false, s.mvp);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.progShield, 'uModel'), false, s.model);
        gl.uniform3fv(gl.getUniformLocation(this.progShield, 'uColor'), sideColors[u.side] || sideColors.a);
        gl.uniform3fv(gl.getUniformLocation(this.progShield, 'uCamPos'), opts.camPos);
        gl.uniform1f(gl.getUniformLocation(this.progShield, 'uPower'), u.shield / Math.max(1, u.shieldMax));
        gl.uniform1f(gl.getUniformLocation(this.progShield, 'uFlash'), flash);
        gl.uniform1f(gl.getUniformLocation(this.progShield, 'uHex'), tier === 1 ? 1 : 0);
        gl.depthMask(false);
        gl.bindVertexArray(this.shieldVAO);
        gl.drawArrays(gl.TRIANGLES, 0, this.shieldTriCount);
        gl.depthMask(true);
      }

      // 撤退跃迁漏斗
      if (u.order === 'retreat') {
        const charge = Math.min(1, (u.retreatCharge || 0) / 25);
        this._drawQuad(gl, s, u, 0.9, 0.0, 1.2 + charge, 0.8, this.progWarp, { uCharge: charge });
      }
    }

    // —— 光束带 / 导弹光点 ——
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // 加性
    gl.depthMask(false);
    for (const p of data.projectiles || []) {
      if (p.kind === 'beamFx') {
        this._drawBeam(gl, s, p, time);
      } else if (p.kind === 'missile') {
        const w = logicalToWorld(p.x, p.y);
        this._drawGlow(gl, s, w, [2.6, 2.2, 1.2], 0.85, 0.5);
      }
    }
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _drawFlat(gl, s, u, offX, size, color, intensity, rotY) {
    const w = logicalToWorld(u.x, u.y);
    const cx = w[0] - Math.cos(0) * 0; // 尾部
    mat4TRS(s.model, w[0] - 0.55, w[1], w[2], 0, Math.PI / 2, 0, size);
    mat4Multiply(s.mvp, s.view, s.model);
    mat4Multiply(s.mvp, s.proj, s.mvp);
    gl.useProgram(this.progFlat);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progFlat, 'uMVP'), false, s.mvp);
    gl.uniform3fv(gl.getUniformLocation(this.progFlat, 'uColor'), color);
    gl.uniform1f(gl.getUniformLocation(this.progFlat, 'uIntensity'), intensity);
    gl.bindVertexArray(this.shieldVAO);
    gl.drawArrays(gl.TRIANGLES, 0, this.shieldTriCount);
  }

  _drawBeam(gl, s, p, time) {
    const a = logicalToWorld(p.x0, p.y0);
    const b = logicalToWorld(p.x1, p.y1);
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[2] + b[2]) / 2;
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 0.001;
    const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
    mat4TRS(s.model, mx, 0.06, mz, 0, -ang, 0, len * 0.5);
    mat4Multiply(s.mvp, s.view, s.model);
    mat4Multiply(s.mvp, s.proj, s.mvp);
    gl.useProgram(this.progQuad);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progQuad, 'uMVP'), false, s.mvp);
    gl.uniform3fv(gl.getUniformLocation(this.progQuad, 'uColor'), p.side === 'a' ? [0.5, 1.6, 2.8] : [2.8, 0.7, 0.4]);
    gl.uniform1f(gl.getUniformLocation(this.progQuad, 'uTime'), time);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawGlow(gl, s, w, color, intensity, size) {
    mat4TRS(s.model, w[0], 0.08, w[2], 0, 0, 0, size);
    mat4Multiply(s.mvp, s.view, s.model);
    mat4Multiply(s.mvp, s.proj, s.mvp);
    gl.useProgram(this.progGlow);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progGlow, 'uMVP'), false, s.mvp);
    gl.uniform3fv(gl.getUniformLocation(this.progGlow, 'uColor'), color);
    gl.uniform1f(gl.getUniformLocation(this.progGlow, 'uIntensity'), intensity);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawQuad(gl, s, u, offX, height, size, alphaFrac, prog, extraUniforms = {}) {
    const w = logicalToWorld(u.x, u.y);
    mat4TRS(s.model, w[0] + offX, height, w[2], 0, Math.PI / 2, 0, size);
    mat4Multiply(s.mvp, s.view, s.model);
    mat4Multiply(s.mvp, s.proj, s.mvp);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, s.mvp);
    for (const [k, v] of Object.entries(extraUniforms)) {
      gl.uniform1f(gl.getUniformLocation(prog, k), v);
    }
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** 受击闪白：按护盾/结构下降检测（渲染层视觉缓存，不触碰世界） */
  _flashOf(u) {
    const now = performance.now() / 1000;
    let c = this._unitCache.get(u.shipId);
    if (!c) {
      c = { prevShield: u.shield, prevStruct: u.structure, flashUntil: 0 };
      this._unitCache.set(u.shipId, c);
    }
    if (u.shield < c.prevShield - 0.5 || u.structure < c.prevStruct - 0.5) {
      c.flashUntil = now + 0.35;
    }
    c.prevShield = u.shield;
    c.prevStruct = u.structure;
    if (u.destroyed) this._unitCache.delete(u.shipId);
    return Math.max(0, Math.min(1, (c.flashUntil - now) / 0.35));
  }

  /** 屏幕拾取：把每个存活单位投影到屏幕空间 */
  buildPickList(gl, width, height, data, opts) {
    const s = this._scratch;
    mat4Perspective(s.proj, Math.PI / 4, width / Math.max(1, height), 0.1, 120);
    mat4LookAt(s.view, opts.camPos, opts.camTarget, [0, 1, 0]);
    mat4Multiply(s.vp, s.proj, s.view);
    const list = [];
    for (const u of data.units || []) {
      if (u.destroyed) continue;
      const w = logicalToWorld(u.x, u.y);
      const out = [0, 0, 0];
      vec3ApplyMat4(out, s.vp, [w[0], w[1], w[2]]);
      const sx = (out[0] * 0.5 + 0.5) * width;
      const sy = (0.5 - out[1] * 0.5) * height;
      if (out[2] >= 0 && out[2] <= 1) list.push({ shipId: u.shipId, sx, sy });
    }
    return list;
  }

  destroy() {
    this.glc.destroy();
  }
}

/** 极简几何累积器（护盾球专用） */
class MeshBuilderLite {
  constructor() {
    this.positions = [];
  }

  tri(a, b, c) {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  build() {
    return { positions: new Float32Array(this.positions), triCount: this.positions.length / 9 };
  }
}

function sphereTo(sb, cx, cy, cz, r, seg) {
  const at = (i, j) => {
    const phi = (i / seg) * Math.PI;
    const theta = (j / seg) * Math.PI * 2;
    return [
      cx + r * Math.sin(phi) * Math.cos(theta),
      cy + r * Math.cos(phi),
      cz + r * Math.sin(phi) * Math.sin(theta),
    ];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      sb.tri(at(i, j), at(i + 1, j), at(i + 1, j + 1));
      sb.tri(at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
}

/** 由战斗数据推测船体（hullId 未在 battleView 中时按尺寸分级） */
function guessHull(u) {
  const ratio = u.structureMax || 100;
  if (ratio > 1800) return 'hull_battleship';
  if (ratio > 900) return 'hull_carrier';
  if (ratio > 500) return 'hull_gun_cruiser';
  if (ratio > 260) return 'hull_destroyer';
  if (ratio < 140) return 'hull_scout';
  return 'hull_frigate';
}
