/**
 * render/CanvasManager.js — 画布生命周期管理器（任务书 2.5 渲染基建 / R2 升级）
 *
 * 职责：
 *  - 在给定容器内创建包裹 div（class "vf-view-canvas"，复用 styles.css 的绝对定位布局），
 *    并搭建三层画布：
 *      底层 glCanvas —— WebGL2（GL 场景 + HDR Bloom 后处理输出）；
 *      顶层 hudCanvas —— 2D 画布（透明背景，仅画 HUD 文字/指示框），pointer-events:none，
 *                        不改变事件目标（鼠标事件仍落在 glCanvas 上，由调用方绑定）；
 *    两层绝对定位重合（zIndex 显式分层）。无 WebGL2 时只保留 2D 画布（行为与旧版一致）。
 *  - 处理 devicePixelRatio（上限 2.0），ResizeObserver 监听容器尺寸并同步三层物理像素，
 *    触发 onResize 回调并同步 PostProcessor 的渲染目标尺寸。
 *  - WebGL 上下文丢失（webglcontextlost）：preventDefault + 标记 glDegraded +
 *    隐藏 glCanvas（以 opacity:0 隐藏而非 display:none —— 保持事件目标不变，
 *    调用方已绑定在 glCanvas 上的交互在退化期间继续工作；2D 兜底照常绘制）；
 *    上下文恢复（webglcontextrestored）：自动重建 PostProcessor/GL 资源（rebuild 钩子，
 *    视图层可经 onGLStateChange 感知并重挂网格），失败则维持 2D 兜底，不抛错不白屏。
 *
 * 既有公开 API（100% 兼容，调用方无感知）：
 *  attach(container) → this；ctx / width / height / dpr / canvas；
 *  beginFrame()（HUD 2D setTransform(dpr,0,0,dpr,0,0)）；onResize(cb) → 注销函数；dispose()。
 * 新增（增量）：gl / glc / post / hasGL / glDegraded / tier；
 *  beginGLFrame() / endGLFrame(opts) / setTier(t) / onGLStateChange(cb) / rebuild()。
 *
 * 约束：顶层不触碰 document/window，仅类方法内部访问 DOM，可在 Node 侧安全 import。
 */

import { GLContext } from './gl/GLCore.js';
import { PostProcessor } from './gl/PostProcessor.js';

export class CanvasManager {
  constructor() {
    // —— 既有公开 API 字段 ——
    /** @type {HTMLCanvasElement|null} 事件目标画布（有 GL 时为底层 glCanvas，无 GL 时为 2D 画布）。
     *  hudCanvas 带 pointer-events:none 永不成为事件目标，调用方绑定在 canvas 上的
     *  鼠标事件因此保持与旧版完全一致的行为。 */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D|null} HUD 2D 上下文（顶层 hudCanvas） */
    this.ctx = null;
    /** CSS 逻辑像素宽度 */
    this.width = 0;
    /** CSS 逻辑像素高度 */
    this.height = 0;
    /** 实际使用的 devicePixelRatio（上限 2.0） */
    this.dpr = 1;

    // —— R2 新增公开字段 ——
    /** @type {HTMLCanvasElement|null} 底层 WebGL2 画布（无 GL 时为 null） */
    this.glCanvas = null;
    /** @type {HTMLCanvasElement|null} 顶层 2D HUD 画布 */
    this.hudCanvas = null;
    /** @type {WebGL2RenderingContext|null} */
    this.gl = null;
    /** @type {GLContext|null} GL 封装（托管资源清册） */
    this.glc = null;
    /** @type {PostProcessor|null} HDR Bloom 后处理管线 */
    this.post = null;
    /** 是否持有可用 WebGL2（false 时为纯 2D，行为与旧版一致） */
    this.hasGL = false;
    /** GL 上下文丢失/重建失败标记（true 时调用方可退回 this.ctx 画基础图形） */
    this.glDegraded = false;
    /** 渲染层级：1=完整管线；2=降级管线；3=纯 2D（GL 短路），经 setTier 调整 */
    this.tier = 1;

    this._wrap = null;           // 包裹 div（.vf-view-canvas）
    this._observer = null;       // ResizeObserver 实例
    this._resizeCbs = new Set(); // 尺寸变化回调集合
    this._glStateCbs = new Set();// GL 状态变化回调集合（参数 degraded:boolean）
    this._onMeasure = null;      // 绑定后的观察回调
    this._onWinResize = null;    // window resize 兜底（捕捉 dpr 变化）
    this._onGLLost = null;       // webglcontextlost 监听
    this._onGLRestored = null;   // webglcontextrestored 监听
  }

  /**
   * 在容器内创建三层画布并开始观察尺寸。
   * @param {HTMLElement} container 容器元素（通常为 .vf-view-body 或其子容器）
   * @returns {CanvasManager} 返回自身，便于链式调用
   */
  attach(container) {
    if (!container) throw new Error('[CanvasManager] attach 需要容器元素');
    // 包裹层复用 styles.css 中 .vf-view-canvas { position:absolute; inset:0 }
    const wrap = document.createElement('div');
    wrap.className = 'vf-view-canvas';
    const hudCanvas = document.createElement('canvas');
    const glCanvas = document.createElement('canvas');

    // —— 尝试取得 WebGL2（画布无需先入 DOM 即可 getContext）——
    let gl = null;
    try {
      gl = this._tryGetGL(glCanvas);
    } catch (e) {
      gl = null;
    }

    if (gl) {
      // GL 管线初始化失败（如着色器编译异常）同样退化为纯 2D
      try {
        this.gl = gl;
        this.glc = GLContext.fromExisting(glCanvas, gl);
        this.post = new PostProcessor(this.glc);
        this.hasGL = true;
      } catch (e) {
        console.error('[CanvasManager] GL 管线初始化失败，退化为纯 2D:', e);
        try { if (this.glc) this.glc.destroy(); } catch (_) { /* 忽略销毁异常 */ }
        this.gl = null;
        this.glc = null;
        this.post = null;
        this.hasGL = false;
      }
    }

    if (this.hasGL) {
      // 底层：WebGL2 画布（接收鼠标事件，zIndex 0）
      this._applyCanvasStyle(glCanvas, 0);
      wrap.appendChild(glCanvas);
      this.glCanvas = glCanvas;
      this.canvas = glCanvas;
      this._bindGLLifecycle(glCanvas);
      // 顶层 HUD 画布透明且不拦截事件：事件目标保持为 glCanvas
      hudCanvas.style.pointerEvents = 'none';
    } else {
      // 无 GL：2D 画布保持默认事件目标（与旧版行为一致）
      hudCanvas.style.pointerEvents = '';
    }

    // 顶层：HUD 2D 画布（透明背景，仅画文字/指示框，zIndex 1）
    this._applyCanvasStyle(hudCanvas, 1);
    wrap.appendChild(hudCanvas);
    this.hudCanvas = hudCanvas;
    this.ctx = hudCanvas.getContext('2d');
    this._wrap = wrap;
    container.appendChild(wrap);

    // 首次测量并应用尺寸（内部会同步 post.resize）
    this._measure();

    // 尺寸观察：容器尺寸变化 → 重新测量
    this._onMeasure = () => this._measure();
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._onMeasure);
      this._observer.observe(wrap);
    }
    // window resize 兜底：跨屏拖动 / 浏览器缩放导致的 dpr 变化不会触发 ResizeObserver
    if (typeof window !== 'undefined') {
      this._onWinResize = () => this._measure();
      window.addEventListener('resize', this._onWinResize);
    }
    return this;
  }

  /**
   * 注册尺寸变化回调（参数为 CSS 逻辑像素宽高）。
   * @param {(w:number,h:number)=>void} cb 回调
   * @returns {()=>void} 注销函数
   */
  onResize(cb) {
    if (typeof cb !== 'function') return () => {};
    this._resizeCbs.add(cb);
    return () => this._resizeCbs.delete(cb);
  }

  /**
   * 注册 GL 状态变化回调（可选；参数 degraded:boolean）。
   * 上下文丢失/恢复/重建失败时触发，视图层可借此重挂 GL 网格或提示降级。
   * @param {(degraded:boolean)=>void} cb 回调
   * @returns {()=>void} 注销函数
   */
  onGLStateChange(cb) {
    if (typeof cb !== 'function') return () => {};
    this._glStateCbs.add(cb);
    return () => this._glStateCbs.delete(cb);
  }

  /** 每帧渲染前调用：把 HUD 2D 上下文变换重置为 dpr 缩放（逻辑像素坐标系） */
  beginFrame() {
    if (!this.ctx) return;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * 开始 GL 帧（有 GL 且 tier<3 时）：设置 viewport 到物理像素并绑定场景 FBO。
   * @returns {{fbo:Object, width:number, height:number}|null} 场景目标信息；无 GL/降级/目标未就绪时为 null
   */
  beginGLFrame() {
    if (!this.hasGL || !this.post || this.glDegraded || this.tier >= 3) return null;
    const glCanvas = this.glCanvas;
    this.gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    return this.post.beginScene();
  }

  /**
   * 结束 GL 帧：执行 HDR Bloom 后处理并合成到默认帧缓冲。
   * @param {{bloom?:number, exposure?:number, time?:number}} [opts] 透传 post.endScene
   */
  endGLFrame(opts) {
    if (!this.hasGL || !this.post || this.glDegraded || this.tier >= 3) return;
    this.post.endScene(opts);
  }

  /**
   * 设置渲染层级（同步本管理器与 PostProcessor）。
   * 1=完整管线；2=降级管线（2 级金字塔）；3=纯 2D（GL 调用全部短路）。
   * @param {number} t
   * @returns {number} 实际生效层级
   */
  setTier(t) {
    if (this.post) {
      this.tier = this.post.setTier(t);
      return this.tier;
    }
    const n = Math.round(Number(t));
    this.tier = Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1;
    return this.tier;
  }

  /**
   * 重建 GL 管线资源（rebuild 钩子）：
   *  - webglcontextrestored 后自动调用；视图层亦可手动触发；
   *  - 重建 PostProcessor 的程序/VAO/FBO（尺寸沿用当前物理像素），视图层可监听
   *    onGLStateChange(false) 重挂自身网格/几何；
   *  - 任何异常都收敛为降级状态：不抛错、不白屏（HUD 2D 兜底照常）。
   * @returns {boolean} 是否重建成功
   */
  rebuild() {
    if (!this.hasGL || !this.post || !this.glc) return false;
    try {
      this.glc.resetTracking();          // 旧句柄已随上下文失效，清空清册防膨胀
      this.post.rebuild();               // 重建程序 / VAO / 场景与金字塔目标
      if (this.glCanvas) {
        this.glCanvas.style.opacity = '';            // 恢复 GL 画面
        this.glCanvas.style.display = '';
      }
      if (this.hudCanvas) this.hudCanvas.style.pointerEvents = 'none'; // 事件目标交还 glCanvas
      this.glDegraded = false;
      this._syncGLSize();                // 视口与目标尺寸对齐当前物理像素
      this._fireGLStateChange(false);
      return true;
    } catch (e) {
      console.error('[CanvasManager] GL 上下文恢复重建失败，保持 2D 兜底:', e);
      this._enterDegraded();
      return false;
    }
  }

  /** 释放：断开观察者、移除监听、销毁 GL 管线并移除画布节点 */
  dispose() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    if (this.glCanvas && this._onGLLost) {
      this.glCanvas.removeEventListener('webglcontextlost', this._onGLLost);
      this.glCanvas.removeEventListener('webglcontextrestored', this._onGLRestored);
      this._onGLLost = null;
      this._onGLRestored = null;
    }
    this._resizeCbs.clear();
    this._glStateCbs.clear();
    // GL 资源回收：post 先释放自身目标，glc 统一回收清册并经 lose_context 丢弃上下文
    if (this.post) {
      try { this.post.destroy(); } catch (e) { console.error('[CanvasManager] post.destroy 异常:', e); }
      this.post = null;
    }
    if (this.glc) {
      try { this.glc.destroy(); } catch (e) { console.error('[CanvasManager] glc.destroy 异常:', e); }
      this.glc = null;
    }
    this.gl = null;
    this.hasGL = false;
    this.glDegraded = false;
    if (this._wrap && this._wrap.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    this._wrap = null;
    this.canvas = null;
    this.ctx = null;
    this.glCanvas = null;
    this.hudCanvas = null;
  }

  // —— 内部实现 ——————————————————————————————————————————————

  /** 请求 webgl2 上下文（属性固定：不透明 + 抗锯齿 + 深度 + 高性能偏好） */
  _tryGetGL(canvas) {
    return canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance',
    });
  }

  /** 三层画布共用的绝对定位样式（styles.css 仅约定 display:block，定位在此补齐） */
  _applyCanvasStyle(canvas, z) {
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = String(z);
  }

  /** 绑定 WebGL 上下文丢失/恢复监听 */
  _bindGLLifecycle(glCanvas) {
    this._onGLLost = (e) => {
      // 必须 preventDefault，否则浏览器不会派发 webglcontextrestored
      e.preventDefault();
      console.warn('[CanvasManager] WebGL 上下文丢失，切换 2D 兜底');
      this._enterDegraded();
    };
    this._onGLRestored = () => {
      this.rebuild(); // 失败时 rebuild 内部已自行降级，不会抛错
    };
    glCanvas.addEventListener('webglcontextlost', this._onGLLost);
    glCanvas.addEventListener('webglcontextrestored', this._onGLRestored);
  }

  /** 进入 GL 降级态：隐藏 glCanvas 画面、放开 HUD 事件、广播 degraded=true */
  _enterDegraded() {
    this.glDegraded = true;
    if (this.glCanvas) {
      // 以 opacity:0 隐藏而非 display:none：保持 glCanvas 为事件目标，
      // 调用方已绑定的交互（拖拽/单击/滚轮）在退化期间继续工作
      this.glCanvas.style.opacity = '0';
    }
    if (this.hudCanvas) this.hudCanvas.style.pointerEvents = ''; // 2D 兜底期间接收事件
    this._fireGLStateChange(true);
  }

  /** 广播 GL 状态变化（快照遍历，允许回调内注销自身） */
  _fireGLStateChange(degraded) {
    for (const cb of [...this._glStateCbs]) {
      try {
        cb(degraded);
      } catch (e) {
        console.error('[CanvasManager] onGLStateChange 回调异常:', e);
      }
    }
  }

  /** 按当前逻辑尺寸 + dpr 同步 glCanvas 物理像素与 post 渲染目标 */
  _syncGLSize() {
    if (!this.hasGL || !this.post) return;
    const pw = Math.max(1, Math.round(this.width * this.dpr));
    const ph = Math.max(1, Math.round(this.height * this.dpr));
    if (this.glCanvas) {
      this.glCanvas.width = pw;
      this.glCanvas.height = ph;
    }
    this.post.resize(pw, ph);
  }

  /**
   * 测量容器尺寸并同步三层画布物理像素与 post 目标；
   * 尺寸与 dpr 均未变化时跳过，避免 ResizeObserver 抖动导致的无谓重置。
   */
  _measure() {
    if (!this._wrap || !this.hudCanvas) return;
    const rect = this._wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const rawDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const dpr = Math.min(2.0, rawDpr); // 上限 2.0：高分屏下控制填充率
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    this.hudCanvas.width = pw;
    this.hudCanvas.height = ph;
    this._syncGLSize();

    // 通知回调（快照遍历，允许回调内注销自身）
    for (const cb of [...this._resizeCbs]) {
      try {
        cb(this.width, this.height);
      } catch (e) {
        console.error('[CanvasManager] onResize 回调异常:', e);
      }
    }
  }
}
