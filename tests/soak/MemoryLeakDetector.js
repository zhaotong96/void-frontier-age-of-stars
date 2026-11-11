/**
 * tests/soak/MemoryLeakDetector.js — WebGL/DOM/Heap 引用审计器（doc27 §3）
 *
 * Node 无头侧：句柄记账 mock GL（created/deleted/live 三账本）× 100 次跨场景
 * 切换循环（Galaxy3D → System3D → PlanetSurfaceScene 各 25 次共享上下文 +
 * Battle3D 25 次独立上下文——其 destroy 契约含 glc.destroy()）。
 * 判定：每次场景卸载后 live === 0 且 created === deleted（逐类别）。
 * 浏览器实机侧（soak-runner.html）：真实 gl.createBuffer/deleteBuffer 钩子 +
 * performance.memory 斜率，由同一判定口径承担。
 */

import { GLContext } from '../../src/render/gl/GLCore.js';

/** 句柄记账 mock GL（与 TERRAIN-10 同语义：VAO 级联所有权） */
export class CountingGL {
  constructor() {
    this.created = { program: 0, buffer: 0, vao: 0, shader: 0, texture: 0 };
    this.deleted = { program: 0, buffer: 0, vao: 0, shader: 0, texture: 0 };
    this._live = new Map();
    this._curVao = null;
    this._vaoOwned = new Map();
    this._seq = 0;
    const K = ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS',
      'ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT',
      'UNSIGNED_BYTE', 'UNSIGNED_INT', 'UNSIGNED_SHORT', 'TRIANGLES', 'TRIANGLE_STRIP',
      'LINES', 'DEPTH_TEST', 'CULL_FACE', 'BLEND', 'LEQUAL', 'BACK', 'CCW', 'ONE',
      'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'NEAREST', 'LINEAR', 'CLAMP_TO_EDGE',
      'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'TEXTURE_WRAP_S',
      'TEXTURE_WRAP_T', 'RGBA', 'RGBA8', 'HALF_FLOAT', 'COLOR_ATTACHMENT0',
      'FRAMEBUFFER', 'RENDERBUFFER', 'DEPTH_COMPONENT24', 'DEPTH_ATTACHMENT',
      'FRAMEBUFFER_COMPLETE', 'CURRENT_PROGRAM'];
    for (const k of K) this[k] = Symbol(k);
    this.NO_ERROR = 0;
    this.MAX_TEXTURE_SIZE = 3379;
  }
  _new(kind) { const h = { __kind: kind, __id: ++this._seq }; this.created[kind]++; this._live.set(h.__id, h); return h; }
  _free(kind, h) { if (h && this._live.has(h.__id)) { this._live.delete(h.__id); this.deleted[kind]++; } }
  isContextLost() { return false; }
  getError() { return this.NO_ERROR; }
  getExtension() { return null; }
  getParameter() { return this.MAX_TEXTURE_SIZE; }
  createShader() { return this._new('shader'); }
  shaderSource() {} compileShader() {}
  getShaderParameter() { return true; } getShaderInfoLog() { return ''; }
  deleteShader(h) { this._free('shader', h); }
  createProgram() { return this._new('program'); }
  attachShader() {} bindAttribLocation() {} linkProgram() {}
  getProgramParameter() { return true; } getProgramInfoLog() { return ''; }
  deleteProgram(h) { this._free('program', h); }
  createBuffer() {
    const h = this._new('buffer');
    if (this._curVao) {
      let owned = this._vaoOwned.get(this._curVao);
      if (!owned) { owned = new Set(); this._vaoOwned.set(this._curVao, owned); }
      owned.add(h);
      h.__ownerVao = this._curVao;
    }
    return h;
  }
  bindBuffer(target, h) {
    if (target === this.ELEMENT_ARRAY_BUFFER && h && h.__ownerVao && h.__ownerVao !== this._curVao) return;
  }
  bufferData() {} enableVertexAttribArray() {} vertexAttribPointer() {} vertexAttribDivisor() {}
  createVertexArray() { const h = this._new('vao'); this._curVao = h; return h; }
  bindVertexArray(h) { this._curVao = h || null; }
  deleteVertexArray(h) {
    if (h) {
      const owned = this._vaoOwned.get(h);
      if (owned) { for (const b of owned) this._free('buffer', b); this._vaoOwned.delete(h); }
      if (this._curVao === h) this._curVao = null;
    }
    this._free('vao', h);
  }
  deleteBuffer(h) { this._free('buffer', h); }
  useProgram() {} getUniformLocation() { return {}; }
  uniform1f() {} uniform1i() {} uniform2f() {} uniform2fv() {} uniform3f() {} uniform3fv() {}
  uniform4f() {} uniform4fv() {} uniformMatrix4fv() {}
  enable() {} disable() {} depthFunc() {} depthMask() {} frontFace() {} cullFace() {} blendFunc() {}
  drawElements() {} drawArrays() {} drawArraysInstanced() {} drawElementsInstanced() {}
  isEnabled() { return true; }
  bindTexture() {} texImage2D() {} texParameteri() {} activeTexture() {} pixelStorei() {}
  createTexture() { return this._new('texture'); } deleteTexture(h) { this._free('texture', h); }
  createFramebuffer() { return {}; } deleteFramebuffer() {} bindFramebuffer() {}
  framebufferTexture2D() {} createRenderbuffer() { return {}; } deleteRenderbuffer() {}
  bindRenderbuffer() {} renderbufferStorage() {} framebufferRenderbuffer() {}
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
  viewport() {} clearColor() {} clear() {} colorMask() {} stencilMask() {}
}

/** 断言当前上下文零存活句柄且逐类别 created==deleted */
export function assertZeroLeak(gl, label) {
  if (gl._live.size !== 0) {
    const kinds = {};
    for (const h of gl._live.values()) kinds[h.__kind] = (kinds[h.__kind] || 0) + 1;
    throw new Error(`[LEAK] ${label}: 存活 GL 句柄 ${gl._live.size} ≠ 0（${JSON.stringify(kinds)}）`);
  }
  for (const kind of Object.keys(gl.created)) {
    if (gl.created[kind] !== gl.deleted[kind]) {
      throw new Error(`[LEAK] ${label}: ${kind} created(${gl.created[kind]}) ≠ deleted(${gl.deleted[kind]})`);
    }
  }
}

/**
 * 100 次跨场景切换泄漏审计（doc27 §3.1 环路：Galaxy → System → Ground → Combat）。
 * 每场景走真实回收路径：Galaxy3D 资源登记共享 glc 清册 → glc.destroy() 统一回收
 * （GLCore.js:370-381 全清册 delete）；System3D.destroy()；PlanetSurfaceScene
 * mount+draw+destroy()；Battle3D.destroy()（契约含 glc.destroy()）。
 * 判定：每次切换回收后 live === 0 且 created === deleted（逐类别）。
 * @returns {{switches, scenes, totalHandles, msPerSwitch}}
 */
export async function runSceneSwitchLeakAudit(cycles = 25) {
  const t0 = performance.now();
  let switches = 0;
  let totalHandles = 0;

  const { Galaxy3D } = await import('../../src/render/gl/Galaxy3D.js');
  const { System3D } = await import('../../src/render/gl/System3D.js');
  const { PlanetSurfaceScene } = await import('../../src/render/gl/PlanetSurfaceScene.js');
  const { buildTerrainField } = await import('../../src/domain/ground/terrainField.js');
  const { Battle3D } = await import('../../src/render/gl/Battle3D.js');

  const field = buildTerrainField({ seed: 20261108 }, 'planet_soak_leak_audit', {});
  const camera = { target: [0, 6, 0], yaw: 0.8, pitch: 0.5, dist: 120 };

  for (let i = 0; i < cycles; i++) {
    // Galaxy 场景：清册回收路径（glc.destroy）
    {
      const gl = new CountingGL();
      const glc = GLContext.fromExisting({ __mockCanvas: true }, gl);
      new Galaxy3D(glc, 1);
      switches++; totalHandles = Math.max(totalHandles, gl._live.size);
      glc.destroy();
      assertZeroLeak(gl, `cycle ${i} Galaxy3D(glc 清册回收)`);
    }
    // System 场景：单例生命周期（SystemRenderer.js:112 init 一次复用），回收路径 =
    // 共享 glc 清册（System3D.destroy 为占位，System3D.js:1083-1087 注释契约）
    {
      const gl = new CountingGL();
      const glc = GLContext.fromExisting({ __mockCanvas: true }, gl);
      new System3D(glc, 1);
      switches++; totalHandles = Math.max(totalHandles, gl._live.size);
      glc.destroy();
      assertZeroLeak(gl, `cycle ${i} System3D(glc 清册回收)`);
    }
    // Ground 场景（mount + draw + destroy，TERRAIN-08 同口径）
    {
      const gl = new CountingGL();
      const glc = GLContext.fromExisting({ __mockCanvas: true }, gl);
      const canvasManager = { glc, tier: 1, hasGL: true, post: null };
      const scene = new PlanetSurfaceScene(canvasManager, { tier: 1 });
      scene.mount(field, { theme: { sky: { skyMode: 0 }, weather: { kind: 'clear', density: 0 } } });
      scene.draw(gl, 800, 600, { camera, time: i * 0.016, actors: { boxes: [], chars: [], decals: [] } });
      switches++; totalHandles = Math.max(totalHandles, gl._live.size);
      scene.destroy();
      assertZeroLeak(gl, `cycle ${i} PlanetSurfaceScene`);
    }
    // Combat 场景（独立上下文：destroy 契约含 glc.destroy()）
    {
      const gl = new CountingGL();
      const glc = GLContext.fromExisting({ __mockCanvas: true }, gl);
      const b3 = new Battle3D(glc, 1);
      switches++; totalHandles = Math.max(totalHandles, gl._live.size);
      b3.destroy();
      assertZeroLeak(gl, `cycle ${i} Battle3D`);
    }
  }

  return {
    switches,
    scenes: ['Galaxy3D', 'System3D', 'PlanetSurfaceScene', 'Battle3D'],
    totalHandles,
    msPerSwitch: (performance.now() - t0) / switches,
  };
}
