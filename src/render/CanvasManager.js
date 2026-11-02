/**
 * render/CanvasManager.js — 画布生命周期管理器（任务书 2.5 渲染基建）
 *
 * 职责：
 *  - 在给定容器内创建包裹 div（class "vf-view-canvas"，复用 styles.css 的绝对定位布局）
 *    与内部 <canvas>（绝对定位充满容器）；
 *  - 处理 devicePixelRatio（上限 2.0，避免高分屏过度绘制）；
 *  - 通过 ResizeObserver 监听容器尺寸变化，同步画布物理像素并触发 onResize 回调；
 *  - 每帧渲染前由视图调用 beginFrame()，把上下文变换重置为 dpr 缩放。
 *
 * 约束：顶层不触碰 document/window，仅类方法内部访问 DOM，可在 Node 侧安全 import。
 */

export class CanvasManager {
  constructor() {
    /** @type {HTMLCanvasElement|null} 内部画布节点 */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D|null} 2D 上下文 */
    this.ctx = null;
    /** CSS 逻辑像素宽度 */
    this.width = 0;
    /** CSS 逻辑像素高度 */
    this.height = 0;
    /** 实际使用的 devicePixelRatio（上限 2.0） */
    this.dpr = 1;

    this._wrap = null;          // 包裹 div（.vf-view-canvas）
    this._observer = null;      // ResizeObserver 实例
    this._resizeCbs = new Set(); // 尺寸变化回调集合
    this._onMeasure = null;     // 绑定后的观察回调
    this._onWinResize = null;   // window resize 兜底（捕捉 dpr 变化）
  }

  /**
   * 在容器内创建画布并开始观察尺寸。
   * @param {HTMLElement} container 容器元素（通常为 .vf-view-body 或其子容器）
   * @returns {CanvasManager} 返回自身，便于链式调用
   */
  attach(container) {
    if (!container) throw new Error('[CanvasManager] attach 需要容器元素');
    // 包裹层复用 styles.css 中 .vf-view-canvas { position:absolute; inset:0 }
    const wrap = document.createElement('div');
    wrap.className = 'vf-view-canvas';
    const canvas = document.createElement('canvas');
    // styles.css 仅约定 .vf-view-canvas canvas { display:block }，定位在此补齐
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._wrap = wrap;

    // 首次测量并应用尺寸
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

  /** 每帧渲染前调用：把上下文变换重置为 dpr 缩放（逻辑像素坐标系） */
  beginFrame() {
    if (!this.ctx) return;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** 释放：断开观察者、移除监听、注销回调并移除画布节点 */
  dispose() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    this._resizeCbs.clear();
    if (this._wrap && this._wrap.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    this._wrap = null;
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * 测量容器尺寸并同步画布物理像素；
   * 尺寸与 dpr 均未变化时跳过，避免 ResizeObserver 抖动导致的无谓重置。
   */
  _measure() {
    if (!this._wrap || !this.canvas) return;
    const rect = this._wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const rawDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const dpr = Math.min(2.0, rawDpr); // 上限 2.0：高分屏下控制填充率
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

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
