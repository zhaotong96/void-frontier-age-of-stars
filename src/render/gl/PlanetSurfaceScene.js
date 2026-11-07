/**
 * render/gl/PlanetSurfaceScene.js — 行星地表场景编排器（doc7 TASK-1.3，Phase 1 切片）
 *
 * 帧流水线（与 PlanetSurface3D 的状态隔离纪律一致，doc7 §2.2 / doc6 §3.2-3.3）：
 *   post.beginScene（防御性冗余清屏；清屏唯一所有者仍是 PostProcessor 8 步契约）
 *     → PlanetAtmosphere.drawSky（关深度天空，1 dc）
 *     → PlanetTerrainMesh.sync + draw（不透明地形，逐可见 Chunk 1 dc，≤64）
 *     → PlanetWater.draw（doc9 P0-3：五层水下光学海面层，潮汐实时水位同步下发
 *       地形 uThemeFx.x；无水主题 0 dc）
 *     → 对象占位 pass（actors.boxes/chars/decals —— Phase 1 为 null 安全空操作，
 *       后续对象 pass 波次在此接入真实实例化绘制）
 *     → PlanetAtmosphere.drawWeather（加性粒子，≤1 dc）
 *
 * sceneData 契约（全部字段可选，缺省安全跳过）：
 *   {
 *     time: 秒, dt: 秒,
 *     camera: { yaw, pitch, dist, target:[x,y,z] }     // 轨道相机（target 缺省场地中心）
 *           | { eye:[x,y,z], fwd:[x,y,z] , target? }   // 或直给眼位/朝向
 *     actors: { boxes:[], chars:[], decals:[] },        // 可选；本切片空数组安全跳过
 *     theme:  { terrain:{...}, sky:{...}, weather:{...} }, // 与 setTheme 同形（引用变更才下发）
 *     sun:    { dir:[x,y,z], color:[r,g,b] },           // 可选覆盖（同时下发地形/大气）
 *     fog:    { color:[r,g,b], range:[near,far] },      // 可选覆盖（地形 + 清屏基色）
 *   }
 * opts: { time?, dt? }
 *
 * 消费方式（后续 GroundView 接入，本类不自绑 GroundView）：
 *   import { PlanetSurfaceScene, buildDebugScene } from '.../PlanetSurfaceScene.js';
 *   const scene = new PlanetSurfaceScene(canvasManager);   // 或 buildDebugScene(...)
 *   scene.mount(field, planetInfo);                        // field 来自 terrainField
 *   const stats = scene.draw(gl, w, h, sceneData, opts);   // 每帧
 *   scene.destroy();                                       // 卸载（TERRAIN-08 清册零泄漏）
 *
 * stats API（getStats()）：{ drawCalls, chunksVisible, triangles, meshRebuilds,
 *   frameMs, chunksTotal, objectsQueued, debugMode } —— frameMs 为 30 帧滚动 EMA。
 *
 * 约束：顶层不触碰 document/window（Node 侧可安全 import，模块级零 DOM/WebGL）；
 * 全程确定性（无 Math.random）；不注册 window 诊断钩子（避免与 PlanetSurface3D 的
 * __vfSurfaceDebug 冲突，诊断接入由视图层决定）；上下文恢复经 rebuild() 重建内部
 * 渲染器（供 CanvasManager.onGLStateChange 的视图侧钩子调用）。
 */

import {
  mat4, mat4Multiply, mat4Perspective, mat4LookAt, mat4Invert,
} from './Mat4.js';
import { PlanetTerrainMesh } from './PlanetTerrainMesh.js';
import { PlanetAtmosphere } from './PlanetAtmosphere.js';
import { PlanetWater, tideWaterLevel, WATERLEVEL_NONE } from './PlanetWater.js';
import { buildTerrainField } from '../../domain/ground/terrainField.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class PlanetSurfaceScene {
  /**
   * @param {object} canvasManager CanvasManager 实例（消费其 glc/post/tier/hasGL）
   * @param {{tier?:number, planetRadiusMeters?:number}} [opts]
   */
  constructor(canvasManager, opts = {}) {
    if (!canvasManager) throw new Error('[PlanetSurfaceScene] 需要 CanvasManager 实例');
    this._cm = canvasManager;
    this.tier = opts.tier != null ? opts.tier : (canvasManager.tier != null ? canvasManager.tier : 1);
    this._destroyed = false;
    this._inited = false;

    // tier≥3 或无 GL：整体惰性（draw 返回空 stats，不抛错）
    const glc = canvasManager.glc;
    const canGL = !!(glc && glc.gl) && canvasManager.hasGL !== false && this.tier < 3;

    this._field = null;
    this._lastThemeRef = null;
    this._planetInfo = null;
    this._worldOffset = null;
    this._themePayload = null;   // WP-5：最近一次 setTheme 的载荷（水体主题色提取）
    this._fogColor = [0.62, 0.65, 0.70];
    this._fogRange = [60.0, 420.0];

    this._terrain = null;
    this._atmosphere = null;
    this._water = null;
    if (canGL) {
      this._terrain = new PlanetTerrainMesh(glc, this.tier);
      this._atmosphere = new PlanetAtmosphere(glc, this.tier);
      // —— doc9 P0-3：五层水下光学海面层挂载（地形之后、天气之前绘制） ——
      this._water = new PlanetWater(glc, this.tier);
      if (opts.planetRadiusMeters) this._terrain.setPlanetRadius(opts.planetRadiusMeters);
    }

    // —— 相机/矩阵草稿（零分配：渲染循环内不新建矩阵） ——
    this.camera = { eye: [0, 0, 0], target: [0, 0, 0], yaw: 0.8, pitch: 0.5, dist: 60 };
    this._m = { proj: mat4(), view: mat4(), vp: mat4(), invVp: mat4() };

    this._stats = {
      drawCalls: 0, chunksVisible: 0, triangles: 0, meshRebuilds: 0,
      frameMs: 0, chunksTotal: 0, objectsQueued: 0, debugMode: 0,
    };
    this._actorQueued = 0;
    this._lastFrameT = -1;
  }

  // ———— 挂载 / 主题 ————————————————

  /**
   * 绑定 terrainField 字段实体并应用行星主题。
   * @param {object} field terrainField.createTerrainField(world, planetId) 的返回实体
   * @param {object} [planetInfo] { visualRadiusMeters?, theme?: {terrain, sky, weather} }
   * @returns {PlanetSurfaceScene} this
   */
  mount(field, planetInfo) {
    if (this._destroyed) throw new Error('[PlanetSurfaceScene] 已销毁，不可再 mount');
    if (!field || !Array.isArray(field.chunks) || field.chunks.length === 0) {
      throw new Error('[PlanetSurfaceScene] mount 需要 terrainField 字段实体（含 chunks）');
    }
    this._field = field;
    this._planetInfo = planetInfo || null;
    this._stats.chunksTotal = field.chunks.length;
    const pi = this._planetInfo;
    if (pi && pi.visualRadiusMeters && this._terrain) {
      this._terrain.setPlanetRadius(pi.visualRadiusMeters);
    }
    this.setTheme(pi && pi.theme ? pi.theme : {});
    this._inited = true;
    return this;
  }

  /**
   * 主题下发（缺省字段保留现值）：
   *  terrain : PlanetTerrainMesh.setTheme 同形（matColors/heatZones/themeFx/footsteps/fog/sun）
   *  sky     : PlanetAtmosphere.setTheme 同形（zenith/horizon/ground/stars/skyMode/...）
   *  weather : { kind, density, wind, boxHalf, boxHeight }
   *  sun/fog : 顶层便捷覆盖（同时作用于地形与大气）
   * @param {object} [theme]
   */
  setTheme(theme) {
    const t = theme || {};
    if (this._terrain) {
      const tt = t.terrain || {};
      this._terrain.setTheme({
        matColors: tt.matColors,
        heatZones: tt.heatZones,
        themeFx: tt.themeFx,
        footsteps: tt.footsteps,
        sun: t.sun || tt.sun,
        fog: t.fog || tt.fog,
      });
    }
    if (this._atmosphere) {
      this._atmosphere.setTheme({
        sky: t.sky,
        weather: t.weather,
        sun: t.sun || (t.sky && t.sky.sun),
        fog: t.fog,
      });
    }
    if (t.fog) {
      if (Array.isArray(t.fog.color) && t.fog.color.length >= 3) {
        this._fogColor = [t.fog.color[0], t.fog.color[1], t.fog.color[2]];
      }
      if (Array.isArray(t.fog.range) && t.fog.range.length >= 2) {
        this._fogRange = [t.fog.range[0], t.fog.range[1]];
      }
    } else if (this._terrain) {
      this._fogColor = this._terrain.getFogColor().slice();
      this._fogRange = this._terrain.getFogRange().slice();
    }
    this._lastThemeRef = null; // 强制下一帧重新合并 sceneData.theme
  }

  /** 视觉行星半径（米）透传（默认 1800，doc7 曲率公式） */
  setPlanetRadius(r) {
    if (this._terrain) this._terrain.setPlanetRadius(r);
  }

  /**
   * 世界平移透传（场域 → 视图空间）：GroundView 集成中地形场域 512m 中心
   * (256,256) 需对齐体素空间 (32,32) → offset (-224,0,-224)。相机/对象 pass
   * 全部留在视图空间；热区/脚步主题载荷仍按场域坐标下发（渲染器内部平移）。
   * @param {Array<number>} o [x,y,z]
   * @returns {PlanetSurfaceScene} this
   */
  setWorldOffset(o) {
    this._worldOffset = (Array.isArray(o) && o.length >= 3) ? [o[0], o[1], o[2]] : null;
    if (this._terrain) this._terrain.setWorldOffset(o);
    if (this._water) this._water.setWorldOffset(o);
    return this;
  }

  /**
   * WP-5 P1-F：脚步压感涟漪注入（biolume_canopy uFootsteps 8 槽环形缓冲）。
   * @param {Float32Array|Array} ring 8 组 [x, z, triggerTime, strength] 四元组
   * @returns {PlanetSurfaceScene} this
   */
  setFootsteps(ring) {
    if (this._terrain) this._terrain.setTheme({ footsteps: ring });
    return this;
  }

  /** 地形背面剔除开关透传（默认 true；诊断对照视图用） */
  setCullEnabled(enabled) {
    if (this._terrain) this._terrain.setCullEnabled(enabled);
  }

  /**
   * 地形诊断模式透传（0=正式 1=unlit_nocull 2=法线+1m格线 3=绕序审计；
   * 模式 1/3 渲染器侧临时关剔除）。真线框（gl.LINES 覆盖层）属后续诊断波次，
   * 模式 2 的黄色 1m 格线即 wireframe_normal 档既定呈现。
   * @param {number} mode 0..3 @returns {number} 实际生效模式
   */
  setDebugMode(mode) {
    const m = this._terrain ? this._terrain.setDebugMode(mode) : 0;
    this._stats.debugMode = m;
    return m;
  }

  getDebugMode() { return this._terrain ? this._terrain.getDebugMode() : 0; }

  /**
   * 实时潮汐水位（doc9 P0-3/P2-1）：基准取地形主题 uThemeFx.x（setTheme 下发），
   * 经 tideWaterLevel 叠加 90s 潮汐。无水主题（基准 ≤ -90）返回 null。
   * @param {number} [time] 场景时间（秒）；缺省 0
   * @returns {number|null} 当前海平面高程（米）或 null（无水）
   */
  getWaterLevel(time) {
    const base = this._terrain && this._terrain._themeFx ? this._terrain._themeFx[0] : WATERLEVEL_NONE;
    if (!(base > -90.0)) return null;
    return tideWaterLevel(base, Number.isFinite(time) ? time : 0);
  }

  /** 内部渲染器访问（诊断/测试用；勿在渲染循环外持有） */
  get terrainRenderer() { return this._terrain; }
  get atmosphereRenderer() { return this._atmosphere; }

  // ———— 帧绘制 ————————————————

  /**
   * 绘制一帧地表场景。内部先 post.beginScene（防御性冗余清屏——清屏唯一所有者
   * 仍为 PostProcessor.beginScene 8 步契约，doc7 §2.2 允许的冗余防御），随后
   * 天空 → 地形 → 对象占位 → 天气。
   * @param {WebGL2RenderingContext} gl
   * @param {number} w 物理像素宽 @param {number} h 物理像素高
   * @param {object} [sceneData] 见文件头契约
   * @param {{time?:number, dt?:number}} [opts]
   * @returns {object} stats 快照（getStats 同形）
   */
  draw(gl, w, h, sceneData, opts = {}) {
    const st = this._stats;
    if (this._destroyed || !this._inited || !this._field) return this.getStats();
    if (!this._terrain || !this._atmosphere) return this.getStats(); // tier≥3 惰性
    if (!gl || gl.isContextLost()) return this.getStats();
    const rd = sceneData || {};
    const time = rd.time != null ? rd.time : (opts.time || 0);
    let dc = 0;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;

    // —— HDR 编码基准（PostProcessor RGBA8 模拟模式：场景预除 hdrRange 存储） ——
    const post = this._cm ? this._cm.post : null;
    const hdr = (post && post.hdrSimulated) ? 1.0 / Math.max(1e-3, post.hdrRange) : 1.0;

    // —— 主题（sceneData.theme 引用变更才全量合并；sun/fog 便捷覆盖逐帧合并） ——
    if (rd.theme && rd.theme !== this._lastThemeRef) {
      this.setTheme(rd.theme);
      this._lastThemeRef = rd.theme;
      this._themePayload = rd.theme;   // WP-5：保留载荷供水体主题色提取
    }
    if (rd.sun) this.setSunOnly(rd.sun);
    if (rd.fog) this.setFogOnly(rd.fog);

    // —— 相机 ——
    const cam = this._updateCamera(rd.camera, w, h, this._field);

    // —— 0. 场景 FBO 绑定 + 主题地平线色防御清屏 ——
    if (post && this.tier < 3) {
      post.beginScene([this._fogColor[0], this._fogColor[1], this._fogColor[2], 1.0]);
    }

    // —— 1. 天空（pass 状态隔离由 PlanetAtmosphere 自持） ——
    dc += this._atmosphere.drawSky(gl, { invVp: cam.invVp, eye: cam.eye, time, hdr });

    // —— 2. 地形：增量同步（脏重建 + LOD + geomorph）→ 视锥剔除绘制 ——
    this._terrain.sync(this._field, cam.eye, { time });
    const tr = this._terrain.draw(gl, { vp: cam.vp, eye: cam.eye, time, hdr });
    dc += tr.drawCalls;

    // —— 2.5 水面（doc9 P0-3：五层水下光学海面层；不透明地形之后、天气之前） ——
    //   潮汐：tideWaterLevel(base, time) 实时海平面 → 同时下发地形 uThemeFx.x
    //   （水下吸收/焦散随潮汐涨落）与 PlanetWater 海面 uniform。无水主题（≤-90）0 dc。
    const baseWl = this._terrain._themeFx ? this._terrain._themeFx[0] : WATERLEVEL_NONE;
    if (this._water && baseWl > -90.0) {
      const liveLv = tideWaterLevel(baseWl, time);
      this._terrain._themeFx[0] = liveLv;
      // WP-5 P1-F：水体主题色同步（deep=崖壁通道色 / shallow=地表基色 / foam=生态高光；
      // 此前从未传入 → 硫雾/甲烷海等全部渲染成默认亚特兰蒂斯亮蓝）
      const waterOpts = { field: this._field, waterLevel: baseWl, fogRange: this._fogRange };
      const mc = this._themePayload && this._themePayload.terrain
        && this._themePayload.terrain.matColors;
      if (Array.isArray(mc) && mc.length >= 3) {
        waterOpts.colors = { deep: mc[1], shallow: mc[0], foam: mc[2] };
      }
      this._water.sync(waterOpts);
      dc += this._water.draw(gl, {
        vp: cam.vp,
        eye: cam.eye,
        time,
        hdr,
        waterLevel: liveLv,
        sun: { dir: this._terrain._sunDir, color: this._terrain._sunColor },
        fogColor: this._fogColor,
        fogRange: this._fogRange,
      }).drawCalls;
    }

    // —— 3. 对象占位 pass（Phase 1 切片：空数组/未提供时安全跳过，0 dc；
    //      实例化绘制由后续对象 pass 波次在此接入） ——
    dc += this._drawActorPlaceholders(gl, rd.actors);

    // —— 4. 天气粒子（地形之后、深度测试遮挡、加性；密度 0 时不产生 dc） ——
    dc += this._atmosphere.drawWeather(gl, {
      vp: cam.vp, view: cam.view, eye: cam.eye, time, hdr,
    });

    // —— stats（frameMs：30 帧滚动 EMA） ——
    st.drawCalls = dc;
    st.chunksVisible = tr.chunksVisible;
    st.triangles = tr.triangles;
    st.meshRebuilds = this._terrain.stats.meshRebuilds;
    st.objectsQueued = this._actorQueued;
    if (t0 > 0) {
      const ms = (typeof performance !== 'undefined' && performance.now) ? performance.now() - t0 : 0;
      st.frameMs = this._lastFrameT < 0 ? ms : st.frameMs + (ms - st.frameMs) * 0.1;
      this._lastFrameT = t0;
    }
    return this.getStats();
  }

  /** 逐帧 sun 覆盖（引用无关，直接合并） */
  setSunOnly(sun) {
    const payload = { sun };
    if (this._terrain) this._terrain.setTheme(payload);
    if (this._atmosphere) this._atmosphere.setTheme(payload);
  }

  /** 逐帧 fog 覆盖（引用无关，直接合并） */
  setFogOnly(fog) {
    const payload = { fog };
    if (this._terrain) this._terrain.setTheme(payload);
    if (this._atmosphere) this._atmosphere.setTheme({ fog });
    if (Array.isArray(fog.color) && fog.color.length >= 3) {
      this._fogColor = [fog.color[0], fog.color[1], fog.color[2]];
    }
    if (Array.isArray(fog.range) && fog.range.length >= 2) {
      this._fogRange = [fog.range[0], fog.range[1]];
    }
  }

  /**
   * 轨道相机：yaw/pitch/dist/target → eye；或 sceneData.camera.eye/fwd 直给。
   * 透视 fov 1.05rad、near 0.1、far 1600（512m 场地 + 曲率地平线余量）。
   */
  _updateCamera(camData, w, h, field) {
    const c = camData || {};
    const m = this._m;
    const half = field && field.sizeMeters ? field.sizeMeters / 2 : 256;
    const eye = this.camera.eye;
    const target = this.camera.target;

    if (Array.isArray(c.eye) && c.eye.length >= 3) {
      eye[0] = c.eye[0]; eye[1] = c.eye[1]; eye[2] = c.eye[2];
      if (Array.isArray(c.target) && c.target.length >= 3) {
        target[0] = c.target[0]; target[1] = c.target[1]; target[2] = c.target[2];
      } else if (Array.isArray(c.fwd) && c.fwd.length >= 3) {
        const len = Math.hypot(c.fwd[0], c.fwd[1], c.fwd[2]) || 1;
        target[0] = eye[0] + c.fwd[0] / len * 10;
        target[1] = eye[1] + c.fwd[1] / len * 10;
        target[2] = eye[2] + c.fwd[2] / len * 10;
      } else {
        target[0] = eye[0]; target[1] = eye[1] - 1; target[2] = eye[2];
      }
    } else {
      // 轨道：与 PlanetSurface3D 同式的 yaw/pitch 约定（eye = target + dir*dist）
      if (Array.isArray(c.target) && c.target.length >= 3) {
        target[0] = c.target[0]; target[1] = c.target[1]; target[2] = c.target[2];
      } else {
        target[0] = half; target[1] = 6; target[2] = half;
      }
      const yaw = c.yaw != null ? c.yaw : 0.8;
      const pitch = clamp(c.pitch != null ? c.pitch : 0.5, 0.02, 1.50);
      const dist = clamp(c.dist != null ? c.dist : half, 1.5, 620);
      const cp = Math.cos(pitch);
      eye[0] = target[0] + Math.sin(yaw) * cp * dist;
      eye[1] = target[1] + Math.sin(pitch) * dist;
      eye[2] = target[2] + Math.cos(yaw) * cp * dist;
      this.camera.yaw = yaw;
      this.camera.pitch = pitch;
      this.camera.dist = dist;
    }

    mat4Perspective(m.proj, 1.05, Math.max(1, w) / Math.max(1, h), 0.1, 1600);
    mat4LookAt(m.view, eye, target, [0, 1, 0]);
    mat4Multiply(m.vp, m.proj, m.view);
    if (!mat4Invert(m.invVp, m.vp)) m.invVp.fill(0); // 奇异防御（天空反投影有 w 保护）
    return { eye, target, vp: m.vp, view: m.view, invVp: m.invVp };
  }

  /**
   * 对象占位 pass（Phase 1 切片）：null 安全清点 actors.boxes/chars/decals，
   * 不产生 draw call —— 真实实例化绘制（单位盒/角色/贴花）由后续对象 pass
   * 波次在本钩子处接入，帧流水线顺序已预留（地形之后、天气之前）。
   * @returns {number} 本 pass draw call 数（恒 0）
   */
  _drawActorPlaceholders(gl, actors) {
    const a = actors || {};
    const boxes = Array.isArray(a.boxes) ? a.boxes : [];
    const chars = Array.isArray(a.chars) ? a.chars : [];
    const decals = Array.isArray(a.decals) ? a.decals : [];
    this._actorQueued = boxes.length + chars.length + decals.length;
    void gl;
    return 0;
  }

  // ———— 上下文恢复 ————

  /**
   * 上下文恢复（webglcontextrestored）后重建内部渲染器并重放主题
   * （供视图侧 CanvasManager.onGLStateChange 钩子调用；字段实体无需重挂载，
   * Chunk GPU 缓存随渲染器重建，下一帧 sync 自动全量重建）。
   * @returns {boolean} 是否成功重建
   */
  rebuild() {
    if (this._destroyed) return false;
    const cm = this._cm;
    const glc = cm ? cm.glc : null;
    if (!glc || !glc.gl || (cm.hasGL === false) || this.tier >= 3) return false;
    if (this._terrain) { try { this._terrain.destroy(); } catch (_) { /* 失效句柄安全 */ } }
    if (this._atmosphere) { try { this._atmosphere.destroy(); } catch (_) { /* 同上 */ } }
    if (this._water) { try { this._water.destroy(); } catch (_) { /* 同上 */ } }
    this._terrain = new PlanetTerrainMesh(glc, this.tier);
    this._atmosphere = new PlanetAtmosphere(glc, this.tier);
    this._water = new PlanetWater(glc, this.tier);
    if (this._worldOffset) this._water.setWorldOffset(this._worldOffset);
    if (this._planetInfo && this._planetInfo.visualRadiusMeters) {
      this._terrain.setPlanetRadius(this._planetInfo.visualRadiusMeters);
    }
    this.setTheme(this._planetInfo && this._planetInfo.theme ? this._planetInfo.theme : {});
    return true;
  }

  // ———— 统计 / 生命周期 ————

  /** stats 快照（新增键向后兼容） */
  getStats() {
    const st = this._stats;
    return {
      drawCalls: st.drawCalls,
      chunksVisible: st.chunksVisible,
      triangles: st.triangles,
      meshRebuilds: st.meshRebuilds,
      frameMs: Math.round(st.frameMs * 100) / 100,
      chunksTotal: st.chunksTotal,
      objectsQueued: st.objectsQueued || 0,
      debugMode: st.debugMode,
    };
  }

  /** 释放内部渲染器持有的全部 GL 资源（glc.destroy() 仍会兜底清册回收） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._terrain) { try { this._terrain.destroy(); } catch (_) { /* 失效句柄安全 */ } }
    if (this._atmosphere) { try { this._atmosphere.destroy(); } catch (_) { /* 同上 */ } }
    if (this._water) { try { this._water.destroy(); } catch (_) { /* 同上 */ } }
    this._terrain = null;
    this._atmosphere = null;
    this._water = null;
    this._field = null;
    this._inited = false;
  }
}

/**
 * 调试场景工厂（gl-gate 式验证用；不触碰 GroundView）：
 * 经 terrainField.js 创建并全量构建字段（buildTerrainField），挂载到新场景。
 * @param {object} canvasManager CanvasManager 实例
 * @param {object} world 主世界实体（种子来源；与 createTerrainField 契约一致）
 * @param {string|number} planetId
 * @param {{field?:object, planetInfo?:object, tier?:number}} [opts]
 *   opts.field 直通 createTerrainField 的 opts（seed 覆盖等）
 * @returns {PlanetSurfaceScene} 已挂载字段的主题场景（scene._field 可取字段实体）
 */
export function buildDebugScene(canvasManager, world, planetId, opts = {}) {
  const field = buildTerrainField(world, planetId, opts.field || {});
  const scene = new PlanetSurfaceScene(canvasManager, { tier: opts.tier });
  scene.mount(field, opts.planetInfo || null);
  return scene;
}
