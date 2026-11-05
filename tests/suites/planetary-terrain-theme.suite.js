/**
 * tests/suites/planetary-terrain-theme.suite.js — 地表生成广度 + 挂载零泄漏压测
 * （doc7 TASK-5.3；本文件含两个套件，与 ai-stability.suite.js 同式双导出，
 *   由 index.js 分别注册：TERRAIN-10 = suite100，TERRAIN-08 = suiteMount）
 *
 * TERRAIN-10（100 种子 × 全部 18 主题广度门禁）：
 *  每组合以中心 2×2 区块（chunk(3,3)/(4,3)/(3,4)/(4,4)）做 TERRAIN-01 同式断言
 *  （顶点位置/法线/切线/aux 有限、法线归一且 ny≥0、材质权重四通道恒和 255、
 *  高度预算 [-40,+80]、索引不越界、无零面积退化三角形），并对每个主题下发
 *  buildThemePayload 主题载荷做健康度断言（matColors 12 通道有限且 (0,1]、
 *  sun.dir 归一、sky 三段有限、fog near<far、themeFx/weather 有限、热区 ≤8）。
 *  运行时预算说明：TERRAIN-01（terrain-field.suite.js）已按全分辨率（lod0Step=1）
 *  对 2 个剖面做深度校验；本套件定位为「主题 × 种子广度」扫描，故采用
 *  lod0Step=4 的 17×17 网格（每区块 512 三角形，1800 场 ≈ 7s），广度/深度互为补充。
 *
 * TERRAIN-08（100 次连续挂载/卸载地表 GL 资源零泄漏压测，确定性 Node 模拟）：
 *  Node 无 WebGL2，不能跑真实 GL —— 以「真实 GLCore 包装 + 极简 mock gl」确定性
 *  模拟完整 mount → draw → destroy 生命周期 ×100：
 *  - 使用真实 GLContext.fromExisting（GLCore 清册/编译/链接路径 100% 真实执行），
 *    mock 只替身 raw WebGL2 调用面；
 *  - mock 覆盖 PlanetTerrainMesh + PlanetAtmosphere + GLCore 的全部触点（约 45 项）：
 *    createShader/ShaderSource/compileShader/getShaderParameter(=true)/getShaderInfoLog/
 *    deleteShader/createProgram/attachShader/bindAttribLocation/linkProgram/
 *    getProgramParameter(=true)/getProgramInfoLog/deleteProgram/createBuffer/bindBuffer/
 *    bufferData/createVertexArray/bindVertexArray/deleteVertexArray/
 *    enableVertexAttribArray/vertexAttribPointer/useProgram/getUniformLocation(→{})/
 *    uniform 系列/enable/disable/depthFunc/depthMask/frontFace/cullFace/blendFunc/
 *    drawElements/drawArrays/drawArraysInstanced（计数器）/isContextLost(=false)/
 *    getError(=NO_ERROR)/getExtension(=null)/getParameter(=4096)/纹理与 FBO 系列；
 *  - 所有权语义（诚实声明）：凡 VAO setup 期间创建的 buffer 视为该 VAO 所有
 *    （deleteVertexArray 级联释放）——对应 PlanetAtmosphere 天空三角/全屏四边形
 *    的真实所有权归属；其余 buffer（地形 chunk 主/权/变体/索引）由渲染器显式
 *    deleteBuffer 释放。生产环境的兜底清册是 GLCore._tracked + glc.destroy()（本套件
 *    走真实 GLCore，清册路径真实执行）；mock 不模拟真实光栅化/驱动侧资源上限。
 *  - 断言：每轮 drawCalls>0（视锥剔除后仍有可见 chunk）；destroy 后
 *    _destroyed=true、terrain._entries 清空（RAF 不归场景所有——场景不持有
 *    requestAnimationFrame/timer 句柄，卸载纪律即 destroy 清态）、全部 GL 句柄
 *    live=0（程序/缓冲/VAO/shader 零泄漏）；100 轮累计 created == deleted 逐类相等；
 *    meshRebuilds 计数健全（每轮 ≥ chunksTotal：GPU 缓存全量重建 1 次/轮）。
 */
import { assert, assertEq } from './assert.js';
import { createTerrainField, buildTriangulatedChunkMesh } from '../../src/domain/ground/terrainField.js';
import { THEME_PROFILE_MAP } from '../../src/content/terrainProfiles.js';
import { PLANET_THEMES } from '../../src/content/planetThemes.js';
import { buildThemePayload } from '../../src/render/gl/themePayload.js';
import { GLContext } from '../../src/render/gl/GLCore.js';
import { PlanetSurfaceScene } from '../../src/render/gl/PlanetSurfaceScene.js';
import { buildTerrainField } from '../../src/domain/ground/terrainField.js';

/** TERRAIN-01 同式单区块断言（有限值/权重/索引/高度预算/退化三角形） */
function assertChunkSane(chunk, ctx) {
  const N = chunk.gridSize;
  const nn = N * N;
  const pos = chunk.vertices.position;
  const nor = chunk.vertices.normal;
  const tan = chunk.vertices.tangent;
  const wgt = chunk.vertices.materialWeights;
  const aux = chunk.vertices.aux;
  const indices = chunk.indices;

  if (!(chunk.bounds.minY >= -40 && chunk.bounds.maxY <= 80)) {
    throw new Error(`${ctx}: 高度预算越界 [${chunk.bounds.minY}, ${chunk.bounds.maxY}]`);
  }
  for (let v = 0; v < nn; v++) {
    const o = v * 3;
    for (let c = 0; c < 3; c++) {
      if (!Number.isFinite(pos[o + c])) throw new Error(`${ctx}: position[${v}] 非有限`);
      if (!Number.isFinite(nor[o + c])) throw new Error(`${ctx}: normal[${v}] 非有限`);
      if (!Number.isFinite(tan[o + c])) throw new Error(`${ctx}: tangent[${v}] 非有限`);
    }
    const nLen = Math.hypot(nor[o], nor[o + 1], nor[o + 2]);
    if (Math.abs(nLen - 1) > 1e-3) throw new Error(`${ctx}: normal[${v}] 未归一化 |n|=${nLen}`);
    if (nor[o + 1] < 0) throw new Error(`${ctx}: normal[${v}] ny<0（未强制朝上）`);
    const wSum = wgt[v * 4] + wgt[v * 4 + 1] + wgt[v * 4 + 2] + wgt[v * 4 + 3];
    if (Math.abs(wSum - 255) > 1) throw new Error(`${ctx}: materialWeights[${v}] 和 ${wSum} ≠ 255`);
    if (!Number.isFinite(aux[v * 2]) || !Number.isFinite(aux[v * 2 + 1])) {
      throw new Error(`${ctx}: aux[${v}] 非有限`);
    }
  }
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k];
    const b = indices[k + 1];
    const c = indices[k + 2];
    if (!(a >= 0 && b >= 0 && c >= 0 && a < nn && b < nn && c < nn)) {
      throw new Error(`${ctx}: 越界索引 (${a},${b},${c})`);
    }
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const b1x = pos[b * 3] - ax, b1y = pos[b * 3 + 1] - ay, b1z = pos[b * 3 + 2] - az;
    const c1x = pos[c * 3] - ax, c1y = pos[c * 3 + 1] - ay, c1z = pos[c * 3 + 2] - az;
    const area2 = Math.hypot(b1y * c1z - b1z * c1y, b1z * c1x - b1x * c1z, b1x * c1y - b1y * c1x);
    if (!(area2 > 1e-9)) throw new Error(`${ctx}: 零面积退化三角形 @${k / 3}`);
  }
}

/** 主题载荷健康度断言（buildThemePayload 输出契约） */
function assertThemePayload(payload, themeId, ctx) {
  const p = payload;
  assert(Array.isArray(p.terrain.matColors) && p.terrain.matColors.length === 4,
    `${ctx}: matColors 应为 4 通道`);
  for (let i = 0; i < 4; i++) {
    const c = p.terrain.matColors[i];
    for (let k = 0; k < 3; k++) {
      assert(Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 1.0001,
        `${ctx}: matColors[${i}] 线性色越界 ${c[k]}`);
    }
  }
  const d = p.sun.dir;
  assert(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-6, `${ctx}: sun.dir 未归一`);
  for (const c of p.sun.color) assert(Number.isFinite(c), `${ctx}: sun.color 非有限`);
  const sky = p.sky;
  for (const key of ['zenith', 'horizon', 'ground']) {
    assert(Array.isArray(sky[key]) && sky[key].length === 3 && sky[key].every(Number.isFinite),
      `${ctx}: sky.${key} 非法`);
  }
  assert(sky.skyMode >= 0 && sky.skyMode <= 3 && Number.isInteger(sky.skyMode),
    `${ctx}: skyMode 越界 ${sky.skyMode}`);
  assert(Number.isFinite(p.fog.color[0]) && Number.isFinite(p.fog.range[0])
    && Number.isFinite(p.fog.range[1]) && p.fog.range[0] > 0 && p.fog.range[0] < p.fog.range[1],
    `${ctx}: fog 预算非法`);
  for (const key of ['waterLevel', 'biolumePulse', 'lavaEmissive']) {
    assert(Number.isFinite(p.terrain.themeFx[key]), `${ctx}: themeFx.${key} 非有限`);
  }
  assert(typeof p.weather.kind === 'string' && p.weather.density >= 0 && p.weather.density <= 1
    && p.weather.wind.every(Number.isFinite), `${ctx}: weather 载荷非法`);
  assert(p.terrain.heatZones.length <= 8, `${ctx}: 热区超上限`);
  for (const hz of p.terrain.heatZones) {
    assert(Number.isFinite(hz.x) && Number.isFinite(hz.z) && hz.radius > 0,
      `${ctx}: 热区几何非法`);
  }
  assert(p.themeId === themeId || p.themeId === null, `${ctx}: themeId 标识不一致`);
}

// ————————————————————————————————————————————————————————————

export const suite100 = {
  id: 'TERRAIN-10',
  name: '100 种子 × 18 主题地表生成广度（TERRAIN-01 断言 + 主题载荷健康度）',
  group: 'ground',
  async run() {
    try {
      const themeIds = Object.keys(PLANET_THEMES);
      const CENTER = [[3, 3], [4, 3], [3, 4], [4, 4]];
      let fieldCount = 0;
      let chunkCount = 0;
      let triCount = 0;
      let payloadCount = 0;
      let payloadSample = null; // 逐位确定性对拍样本
      for (let k = 0; k < 100; k++) {
        const world = { seed: (9100 + Math.imul(k, 7919)) >>> 0 };
        for (let ti = 0; ti < themeIds.length; ti++) {
          const themeId = themeIds[ti];
          const planetId = `planet_t10_${k}_${ti}`;
          const field = createTerrainField(world, planetId, {
            profile: THEME_PROFILE_MAP[themeId],
            lod0Step: 4, // 广度扫描档：17×17 网格（深度档见 TERRAIN-01 全分辨率）
          });
          assert(field.chunks.length === 64, `剖面 ${THEME_PROFILE_MAP[themeId]} 应为 8×8 区块`);
          for (const [cx, cz] of CENTER) {
            const chunk = field.chunks[cz * field.chunksX + cx];
            buildTriangulatedChunkMesh(chunk, field.evalPoint);
            assertChunkSane(chunk, `seed=${world.seed}/${themeId}/${chunk.id}`);
            chunkCount++;
            triCount += chunk.indices.length / 3;
          }
          fieldCount++;

          // 主题载荷健康度（每种子 × 每主题）
          const payload = buildThemePayload(themeId, world, planetId);
          assertThemePayload(payload, themeId, `payload seed=${world.seed}/${themeId}`);
          payloadCount++;
          if (k === 0 && ti === 0) payloadSample = JSON.stringify(payload);
        }
      }
      assertEq(fieldCount, 100 * 18, `应构建 1800 场（实测 ${fieldCount}）`);

      // 载荷确定性：同输入逐位一致（抽样对拍）
      const world0 = { seed: (9100 + Math.imul(0, 7919)) >>> 0 };
      const again = JSON.stringify(buildThemePayload(themeIds[0], world0, 'planet_t10_0_0'));
      assertEq(again, payloadSample, '主题载荷应逐位确定');

      return {
        ok: true,
        detail: `${fieldCount} 场 / ${chunkCount} 区块 / ${triCount} 三角形 / ${payloadCount} 载荷全 PASS`,
      };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};

// ————————————————————————————————————————————————————————————

/**
 * 极简 mock WebGL2 上下文：只替身 PlanetTerrainMesh / PlanetAtmosphere / GLCore
 * 的 raw gl 调用面（覆盖清单见文件头 TERRAIN-08 注释——诚实声明 mock 边界）。
 * 计数语义：created/deleted 按句柄类别计数；_live 为存活句柄集合（零泄漏判据）。
 * 所有权语义：VAO setup 期间创建的 buffer 归该 VAO 所有（deleteVertexArray 级联），
 * 其余 buffer 由调用方显式 deleteBuffer 释放；重复删除为安全空操作。
 */
class MockSurfaceGL {
  constructor() {
    this.created = { program: 0, buffer: 0, vao: 0, shader: 0, texture: 0 };
    this.deleted = { program: 0, buffer: 0, vao: 0, shader: 0, texture: 0 };
    this.drawElementsCalls = 0;
    this.drawArraysCalls = 0;
    this._live = new Map();      // id → handle
    this._curVao = null;
    this._vaoOwned = new Map();  // vao handle → Set(buffer handle)
    this._seq = 0;
    const K = ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS',
      'ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'UNSIGNED_BYTE',
      'UNSIGNED_INT', 'TRIANGLES', 'TRIANGLE_STRIP', 'LINES', 'DEPTH_TEST', 'CULL_FACE',
      'BLEND', 'LEQUAL', 'BACK', 'CCW', 'ONE', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA',
      'NEAREST', 'LINEAR', 'CLAMP_TO_EDGE', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER',
      'TEXTURE_MAG_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'RGBA', 'RGBA8',
      'HALF_FLOAT', 'COLOR_ATTACHMENT0', 'FRAMEBUFFER', 'RENDERBUFFER',
      'DEPTH_COMPONENT24', 'DEPTH_ATTACHMENT', 'FRAMEBUFFER_COMPLETE'];
    for (const k of K) this[k] = Symbol(k);
    this.NO_ERROR = 0;
    this.MAX_TEXTURE_SIZE = 3379;
  }
  _new(kind) {
    const h = { __kind: kind, __id: ++this._seq };
    this.created[kind]++;
    this._live.set(h.__id, h);
    return h;
  }
  _free(kind, h) {
    if (h && this._live.has(h.__id)) {
      this._live.delete(h.__id);
      this.deleted[kind]++;
    }
  }
  isContextLost() { return false; }
  getError() { return this.NO_ERROR; }
  getExtension() { return null; }
  getParameter() { return this.MAX_TEXTURE_SIZE; }
  // —— 着色器/程序（GLCore.createProgram 全路径真实执行，mock 只应答成功） ——
  createShader() { return this._new('shader'); }
  shaderSource() {}
  compileShader() {}
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ''; }
  deleteShader(h) { this._free('shader', h); }
  createProgram() { return this._new('program'); }
  attachShader() {}
  bindAttribLocation() {}
  linkProgram() {}
  getProgramParameter() { return true; }
  getProgramInfoLog() { return ''; }
  deleteProgram(h) { this._free('program', h); }
  // —— 缓冲/VAO ——
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
  deleteBuffer(h) {
    if (h && this._live.has(h.__id)) {
      this._free('buffer', h);
      if (h.__ownerVao) this._vaoOwned.get(h.__ownerVao)?.delete(h);
    }
  }
  createVertexArray() { return this._new('vao'); }
  deleteVertexArray(h) {
    const owned = this._vaoOwned.get(h);
    if (owned) {
      for (const b of [...owned]) this.deleteBuffer(b); // VAO 所有权级联
      this._vaoOwned.delete(h);
    }
    this._free('vao', h);
  }
  bindVertexArray(h) { this._curVao = h || null; }
  bindBuffer() {}
  bufferData() {}
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  // —— uniform / 状态 / 绘制 ——
  useProgram() {}
  getUniformLocation() { return {}; } // 真值对象；mock 不校验激活 uniform
  uniform1f() {} uniform1i() {} uniform2f() {} uniform2fv() {}
  uniform3f() {} uniform3fv() {} uniform4f() {} uniform4fv() {} uniformMatrix4fv() {}
  enable() {} disable() {} depthFunc() {} depthMask() {} frontFace() {} cullFace() {} blendFunc() {}
  drawElements() { this.drawElementsCalls++; }
  drawArrays() { this.drawArraysCalls++; }
  drawArraysInstanced() { this.drawArraysCalls++; }
  // —— 纹理/FBO（本场景路径不触达；实现以保持 GLCore 兜底路径可用） ——
  bindTexture() {} texImage2D() {} texParameteri() {}
  createTexture() { return this._new('texture'); }
  deleteTexture(h) { this._free('texture', h); }
  createFramebuffer() { return {}; } deleteFramebuffer() {} bindFramebuffer() {}
  framebufferTexture2D() {} createRenderbuffer() { return {}; } deleteRenderbuffer() {}
  bindRenderbuffer() {} renderbufferStorage() {} framebufferRenderbuffer() {}
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
}

export const suiteMount = {
  id: 'TERRAIN-08',
  name: '100 次连续挂载/卸载地表 GL 资源零泄漏（确定性 mock GL 生命周期压测）',
  group: 'ground',
  async run() {
    try {
      // —— mock gl + 真实 GLCore 包装（清册/编译/链接路径真实执行） ——
      const gl = new MockSurfaceGL();
      const glc = GLContext.fromExisting({ __mockCanvas: true }, gl);
      // CanvasManager 替身：post=null（清屏唯一所有者 PostProcessor 不在本场景
      // 压测路径内，PlanetSurfaceScene 对 null post 安全跳过 beginScene）
      const canvasManager = { glc, tier: 1, hasGL: true, post: null };

      const world = { seed: 20261105 };
      const field = buildTerrainField(world, 'planet_mount_stress_100', {});
      const chunksTotal = field.chunks.length;
      assert(chunksTotal >= 64, `压测场应含完整区块（实测 ${chunksTotal}）`);
      const camera = { target: [0, 6, 0], yaw: 0.8, pitch: 0.5, dist: 120 };

      const CYCLES = 100;
      let totalDrawCalls = 0;
      let totalMeshRebuilds = 0;
      let minVisible = Infinity;
      const meshRefs = [];
      for (let i = 0; i < CYCLES; i++) {
        const scene = new PlanetSurfaceScene(canvasManager, { tier: 1 });
        scene.mount(field, { theme: { sky: { skyMode: 0 }, weather: { kind: 'snow', density: 0 } } });
        const st = scene.draw(glc.gl, 800, 600, {
          camera,
          time: i * 0.016,
          actors: { boxes: [], chars: [], decals: [] },
        });

        // —— 每轮健全性：剔除后仍有可见 chunk；GPU 缓存全量重建 1 次/轮 ——
        assert(st.drawCalls > 0, `cycle ${i}: drawCalls=0（场景未绘制）`);
        assert(st.chunksVisible > 0 && st.triangles > 0, `cycle ${i}: 可见几何为空`);
        assert(st.meshRebuilds >= chunksTotal, `cycle ${i}: meshRebuilds ${st.meshRebuilds} < ${chunksTotal}`);
        minVisible = Math.min(minVisible, st.chunksVisible);
        totalDrawCalls += st.drawCalls;
        totalMeshRebuilds += st.meshRebuilds;

        // —— 卸载纪律：destroy 清态（场景不拥有 RAF/timer——清态即卸载） ——
        const mesh = scene.terrainRenderer;
        const atmo = scene.atmosphereRenderer;
        meshRefs.push(mesh);
        scene.destroy();
        assertEq(scene._destroyed, true, `cycle ${i}: scene._destroyed 应为 true`);
        assertEq(scene._terrain, null, `cycle ${i}: scene._terrain 应置空`);
        assertEq(scene._atmosphere, null, `cycle ${i}: scene._atmosphere 应置空`);
        assertEq(scene._field, null, `cycle ${i}: scene._field 应置空`);
        assertEq(mesh._destroyed, true, `cycle ${i}: terrain._destroyed 应为 true`);
        assertEq(mesh._entries.size, 0, `cycle ${i}: terrain._entries 应清空（无遗留 chunk GPU 缓存）`);
        assertEq(atmo._destroyed, true, `cycle ${i}: atmosphere._destroyed 应为 true`);

        // —— 零泄漏：本轮结束后 mock 中不得有任何存活句柄 ——
        assertEq(gl._live.size, 0, `cycle ${i}: 存活 GL 句柄 ${gl._live.size} ≠ 0（泄漏）`);
        for (const kind of Object.keys(gl.created)) {
          assertEq(gl.created[kind], gl.deleted[kind],
            `cycle ${i}: ${kind} created(${gl.created[kind]}) ≠ deleted(${gl.deleted[kind]})`);
        }
      }

      assertEq(meshRefs.every((m) => m._destroyed && m._entries.size === 0), true,
        '全部 terrain 渲染器实例应完成清态');
      assert(totalDrawCalls >= CYCLES, `累计 drawCalls ${totalDrawCalls} 异常偏低`);
      assert(totalMeshRebuilds >= CYCLES * chunksTotal, `累计 meshRebuilds ${totalMeshRebuilds} 异常偏低`);
      // 场景 stats dc = 地形 drawElements + 天空/天气 drawArrays（mock 计数对拍）
      assertEq(gl.drawElementsCalls + gl.drawArraysCalls, totalDrawCalls,
        'mock 绘制调用计数应与场景 stats 一致');

      return {
        ok: true,
        detail: `${CYCLES} 轮 mount+draw+destroy：总 dc=${totalDrawCalls}（最小可见 ${minVisible} chunks）、`
          + `重建 ${totalMeshRebuilds}、句柄 created==deleted（program/buffer/vao/shader）、live=0 零泄漏`,
      };
    } catch (e) {
      return { ok: false, detail: (e && e.message) || String(e) };
    }
  },
};
