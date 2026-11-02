/**
 * render/SystemRenderer.js — 星系轨道视图渲染器（R3：WebGL2 三维恒星系 + Canvas 2D 兜底）
 *
 * 职责：
 *  - GL 路径（cm.hasGL && cm.tier<3 且 GL 资源就绪）：经 cm.beginGLFrame() →
 *    gl/System3D.js 绘制三维恒星系（环绕相机 / 恒星光球+日冕 / 脉冲星磁层 /
 *    黑洞全屏 raymarch / 8 类程序化行星球面 + 大气辉光 + 行星环 / 3D 轨道线 /
 *    舰队三角 / 异常信号弧）→ cm.endGLFrame()（HDR Bloom + ACES 合成），
 *    HUD 文字/选中环/宜居度环/殖民旗仍在本层 2D 画布（clearRect 后叠加）；
 *  - 2D 路径（无 GL / tier3 / GL 退化或异常）：既有 Canvas 2D 绘制原样保留为
 *    _render2D（含轨道环/行星小圆/星型光晕/殖民地环旗），作为 webglcontextlost
 *    与 Tier3 的保护路径，cm.hasGL=false 时平滑退化不抛错；
 *  - pick(sx, sy)：行星三维位置经 viewProj 投影缓存 _pickList（半径 12px 最近命中），
 *    行星球体本体经射线-球相交参与命中；GL 与 2D 两路径都填充 _pickList。
 *
 * GL 通道接入（公开 API 契约不变）：
 *  - init(canvasManager)：显式接线（与 BattleRenderer/GalaxyRenderer 同模式），
 *    cm.hasGL 时构建 System3D 并随 onGLStateChange 退化/重建；
 *  - 未接线时（SystemView 未改动）render() 内做一次惰性 DOM 发现：从传入 ctx.canvas
 *    （顶层 HUD 画布）的同容器 sibling 中取已持有 webgl2 上下文的 glCanvas
 *    （getContext('webgl2') 幂等返回既有上下文，不新建），自建 PostProcessor 等效
 *    beginGLFrame/endGLFrame 管线；任何失败都收敛为 2D 路径，绝不抛错。
 *
 * ⚠ 设计令牌同步声明：色板字面量与 styles.css `:root` 变量保持一致
 *   （--bg #070b12 / --accent #4fd8e8 / --ok #62d98a / --line #1d2a3a / --ink #c9d6e3），
 *   恒星与行星色板为任务书规定的固定映射；若调整设计令牌需两处同步。
 *
 * 约束：渲染只读，不修改传入 data；动画只经 opts.time；不使用任何全局随机源、
 * 不使用 gl.readPixels；渲染方法内 GL 异常一律收敛为 2D 兜底。
 */

import { GLContext } from './gl/GLCore.js';
import { PostProcessor } from './gl/PostProcessor.js';
import { System3D } from './gl/System3D.js';

/** 恒星类型 → 本体色 / 半径（px，2D 路径） */
const STAR_STYLES = {
  yellowDwarf: { color: '#ffd27a', r: 16 },
  redDwarf: { color: '#ff8a6a', r: 12 },
  blueGiant: { color: '#9ecbff', r: 22 },
  whiteDwarf: { color: '#e8f2ff', r: 13 },
  neutronStar: { color: '#b8e8ff', r: 9 },
  pulsar: { color: '#b8e8ff', r: 9 },
  blackHole: { color: '#111318', r: 14 },
};

/** 行星类别 → 本体色（任务书规定映射，2D 路径） */
const PLANET_COLORS = {
  rocky: '#a8937c',
  ocean: '#3f8fd8',
  ice: '#cfe8f5',
  desert: '#d8b86a',
  gasGiant: '#d89a5f',
  lava: '#e85f3f',
  toxic: '#9ad86a',
  artificial: '#8fd8e8',
};

/** 行星类别 → 本体半径（px，2D 路径） */
const PLANET_RADIUS = {
  rocky: 5, ocean: 5, ice: 4.5, desert: 5,
  gasGiant: 8, lava: 4.5, toxic: 5, artificial: 4,
};

/** 轨道半径：60 + orbitIndex*38；舰队停靠圈半径（2D 路径） */
const ORBIT_BASE = 60;
const ORBIT_STEP = 38;
const FLEET_RING = 36;

/** 与 styles.css 一致的字体栈 */
const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** hex → rgba 字符串（解析失败回退灰） */
function rgba(hex, a) {
  let h = String(hex || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return `rgba(113,131,154,${a})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export class SystemRenderer {
  constructor() {
    this._pickList = [];      // 最近一帧的行星命中条目（pick 用；GL/2D 两路径都填充）
    this._pickCache = null;   // GL 路径相机缓存（射线-球相交用；2D 为 null）
    this._w = 0;
    this._h = 0;
    this._bgKey = '';
    this._bgGrad = null;

    // —— GL 通道状态 ——
    this._cm = null;          // 显式接线（init）
    this._own = null;         // 惰性 DOM 发现的自有管线 { canvas, gl, glc, post, lost }
    this._s3d = null;         // System3D 实例（GL 资源与绘制）
    this._glDead = false;     // GL 构建/帧绘制硬失败 → 本会话永久走 2D（防编译风暴）
  }

  /**
   * 可选显式接线（不改变既有 render/pick 契约）。cm.hasGL 时构建三维场景资源；
   * 上下文丢失经 onGLStateChange 平滑退化 2D，恢复时重建。
   * @param {import('./CanvasManager.js').CanvasManager} canvasManager
   * @returns {SystemRenderer} 自身（链式）
   */
  init(canvasManager) {
    this._cm = canvasManager || null;
    if (this._cm && this._cm.hasGL && this._cm.glc) {
      try {
        this._s3d = new System3D(this._cm.glc, this._cm.tier || 1);
      } catch (e) {
        console.warn('[SystemRenderer] System3D 初始化失败，退化 Canvas 2D:', e && e.message);
        this._s3d = null;
      }
      this._cm.onGLStateChange((degraded) => {
        if (degraded) {
          this._s3d = null; // webglcontextlost → 平滑退化 2D
        } else if (this._cm && this._cm.hasGL && this._cm.glc && !this._s3d) {
          try {
            this._s3d = new System3D(this._cm.glc, this._cm.tier || 1);
          } catch (e) {
            console.warn('[SystemRenderer] System3D 重建失败，保持 2D:', e && e.message);
            this._s3d = null;
          }
        }
      });
    }
    return this;
  }

  /**
   * 渲染一帧轨道视图。
   * @param {CanvasRenderingContext2D} ctx 2D 上下文（HUD 层，已设定 dpr 变换）
   * @param {number} w 画布逻辑像素宽
   * @param {number} h 画布逻辑像素高
   * @param {object|null} data {
   *   system: { star:{typeId,name}, planets:[{id,name,category,habitability,colonyId,orbitIndex}] },
   *   fleets: [{name, factionId, color}],
   *   anomalies: [{state}],
   *   tick: number
   * }
   * @param {object} opts { selectedPlanetId, reducedEffects, time(秒，仅动画), yaw?(附加偏航) }
   */
  render(ctx, w, h, data, opts = {}) {
    this._w = w;
    this._h = h;
    this._pickList = [];
    this._pickCache = null;
    const reduced = !!opts.reducedEffects;
    const t = Number(opts.time) || 0;

    // 未显式接线时惰性发现 GL 通道（已建管线或已判死则跳过；无候选时逐帧零成本重试）
    if (!this._cm && !this._own && !this._glDead) {
      this._tryDiscoverGL(ctx);
    }

    if (this._glActive() && data && data.system && data.system.star) {
      try {
        if (this._render3D(ctx, w, h, data, opts, t, reduced)) return;
      } catch (e) {
        console.warn('[SystemRenderer] GL 帧绘制失败，退化 Canvas 2D:', e && e.message);
        this._dropGL();
      }
    }
    this._render2D(ctx, w, h, data, opts);
  }

  /**
   * 行星命中检测：返回命中的 planetId 或 null。
   * GL 路径：投影位置半径 12px 最近命中 + 行星球体本体射线-球相交参与命中；
   * 2D 路径：最近一帧缓存屏幕位置，命中半径 = max(10, 行星半径 + 6)。
   */
  pick(sx, sy) {
    const px = Number(sx);
    const py = Number(sy);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of this._pickList) {
      const d = Math.hypot(p.x - px, p.y - py);
      let hit = d <= Math.max(12, (p.r || 0) + 6); // 半径 12px 最近命中
      if (!hit && this._pickCache && p.world) {
        hit = this._raySphereHit(px, py, p); // 球体本体命中（射线-球相交）
      }
      if (hit && d < bestD) {
        best = p.id;
        bestD = d;
      }
    }
    return best;
  }

  // —————————————————————————— GL 通道管理 ——————————————————————————

  /**
   * 惰性 DOM 发现：SystemView 未调用 init 时，从 HUD 2D 画布的包裹容器中找到
   * CanvasManager 已建好的 glCanvas（getContext('webgl2') 幂等返回既有上下文，
   * 不新建上下文），自建 GLContext/PostProcessor 等效管线。
   * 无候选元素时零成本返回（下帧重试，覆盖首帧恰逢上下文丢失的情况）；
   * 构建（着色器/资源）硬失败 → _glDead，本会话永久走 2D（防逐帧编译风暴）。
   */
  _tryDiscoverGL(ctx) {
    try {
      const hud = ctx && ctx.canvas;
      const wrap = hud && hud.parentElement;
      if (!wrap || !wrap.children) return;
      const children = wrap.children; // HTMLCollection（活集合，不快照分配）
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child === hud || child.tagName !== 'CANVAS') continue;
        const gl = child.getContext('webgl2'); // 已持有 → 原样返回；无 → null
        if (gl && !gl.isContextLost()) {
          const glc = GLContext.fromExisting(child, gl);
          const post = new PostProcessor(glc);
          post.resize(Math.max(1, child.width), Math.max(1, child.height));
          this._s3d = new System3D(glc, 1); // 失败 → catch → _glDead
          this._own = { canvas: child, gl, glc, post, lost: false };
          return;
        }
      }
    } catch (e) {
      console.warn('[SystemRenderer] GL 通道构建失败，本会话保持 Canvas 2D:', e && e.message);
      this._own = null;
      this._s3d = null;
      this._glDead = true;
    }
  }

  /** GL 路径当前是否可用（cm 接线路径 / DOM 发现路径共用判定） */
  _glActive() {
    if (this._cm) {
      if (!this._s3d) return false;
      const cm = this._cm;
      return !!(cm.hasGL && !cm.glDegraded && (cm.tier || 1) < 3 && cm.post && cm.gl);
    }
    if (this._own) {
      const own = this._own;
      const lost = !own.gl || own.gl.isContextLost();
      if (lost && !own.lost) {
        own.lost = true; // 上下文丢失 → 下帧起走 2D，等恢复后重建
        this._s3d = null;
        return false;
      }
      if (!lost && own.lost) {
        // webglcontextrestored → 重建自有管线资源（失败收敛 2D）
        try {
          own.glc.resetTracking();
          own.post.rebuild();
          own.post.resize(Math.max(1, own.canvas.width), Math.max(1, own.canvas.height));
          this._s3d = new System3D(own.glc, 1);
          own.lost = false;
        } catch (e) {
          console.warn('[SystemRenderer] GL 恢复重建失败，本会话保持 2D:', e && e.message);
          this._own = null;
          this._s3d = null;
          this._glDead = true;
        }
      }
      return !!this._s3d;
    }
    return false;
  }

  /** GL 帧内硬异常后的降级：丢弃管线并标记 _glDead（本会话永久走 2D，防逐帧重试） */
  _dropGL() {
    this._s3d = null;
    if (this._own) {
      try { this._own.post.destroy(); } catch (_) { /* 忽略销毁异常 */ }
      this._own = null;
    }
    this._glDead = true;
  }

  /**
   * 三维路径：beginGLFrame → System3D.frame → endGLFrame；HUD 2D 叠加。
   * @returns {boolean} 是否成功走完 GL 帧（false 时调用方退回 _render2D）
   */
  _render3D(ctx, w, h, data, opts, t, reduced) {
    let target = null;
    let gl = null;
    let tier = 1;
    let hdrRange = 1;

    if (this._cm) {
      target = this._cm.beginGLFrame();
      if (!target) return false;
      gl = this._cm.gl;
      tier = this._cm.tier || 1;
      hdrRange = this._cm.post.hdrRange || 1;
      this._s3d.setTier(tier);
      gl.depthMask(true); // 前序 post pass 可能留下 depthMask=false，保证清屏生效
      gl.clearColor(0.008, 0.014, 0.028, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this._s3d.frame(gl, target.width, target.height, data, {
        time: t,
        reducedEffects: reduced,
        selectedPlanetId: opts.selectedPlanetId || null,
        yaw: Number(opts.yaw) || 0,
        hdrRange,
        sceneFbo: target.fbo,
      });
      this._cm.endGLFrame({ bloom: 1.0, exposure: 1.02, time: t });
    } else {
      const own = this._own;
      const cw = Math.max(1, own.canvas.width);
      const ch = Math.max(1, own.canvas.height);
      if (own.post.width !== cw || own.post.height !== ch) own.post.resize(cw, ch);
      target = own.post.beginScene();
      if (!target) return false;
      gl = own.gl;
      hdrRange = own.post.hdrRange || 1;
      gl.depthMask(true); // 前序 post pass 可能留下 depthMask=false，保证清屏生效
      gl.clearColor(0.008, 0.014, 0.028, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this._s3d.frame(gl, target.width, target.height, data, {
        time: t,
        reducedEffects: reduced,
        selectedPlanetId: opts.selectedPlanetId || null,
        yaw: Number(opts.yaw) || 0,
        hdrRange,
        sceneFbo: target.fbo,
      });
      own.post.endScene({ bloom: 1.0, exposure: 1.02, time: t });
    }

    // —— 拾取缓存（物理像素 → CSS 逻辑像素）并填充 _pickList ——
    const pd = this._s3d.pickData;
    if (pd && target.width > 0) {
      const k = w / target.width; // CSS / 物理像素比
      this._pickCache = {
        w, h, tanY: pd.tanY, aspect: pd.aspect,
        eye: pd.eye, right: pd.right, up: pd.up, fwd: pd.fwd,
      };
      for (let i = 0; i < pd.count; i++) {
        const e = pd.entries[i];
        this._pickList.push({
          id: e.id,
          x: e.sx * k,
          y: e.sy * k,
          r: Math.max(3, e.rpx * k),
          world: e.world,
          radius: e.radius,
        });
      }
    }

    // —— HUD 2D 层：清空后叠加选中环/宜居度环/殖民旗/名字（与 2D 路径同风格） ——
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      const planets = (data.system && Array.isArray(data.system.planets))
        ? data.system.planets : [];
      for (const p of planets) {
        const e = this._pickList.find((x) => x.id === p.id);
        if (!e) continue;
        const rPix = Math.max(3, e.r);
        const isSel = opts.selectedPlanetId === p.id;
        this._drawPlanetOverlays(ctx, p, e.x, e.y, rPix, isSel, reduced, t);
      }
    }
    return true;
  }

  /** GL 路径拾取的射线-球相交：屏幕点 → 相机射线 → 与行星球求交 */
  _raySphereHit(sx, sy, entry) {
    const c = this._pickCache;
    const world = entry.world;
    if (!c || !world) return false;
    const ndcX = (sx / Math.max(1, c.w)) * 2 - 1;
    const ndcY = 1 - (sy / Math.max(1, c.h)) * 2;
    // 像素 → 世界射线（与透视投影一致：dir = fwd + right·ndcX·tanY·aspect + up·ndcY·tanY）
    let dx = c.fwd[0] + c.right[0] * ndcX * c.tanY * c.aspect + c.up[0] * ndcY * c.tanY;
    let dy = c.fwd[1] + c.right[1] * ndcX * c.tanY * c.aspect + c.up[1] * ndcY * c.tanY;
    let dz = c.fwd[2] + c.right[2] * ndcX * c.tanY * c.aspect + c.up[2] * ndcY * c.tanY;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const ox = c.eye[0] - world[0];
    const oy = c.eye[1] - world[1];
    const oz = c.eye[2] - world[2];
    const b = dx * ox + dy * oy + dz * oz;
    const rr = entry.radius || 0;
    const cc = ox * ox + oy * oy + oz * oz - rr * rr;
    const disc = b * b - cc;
    if (disc < 0) return false;
    return -b - Math.sqrt(disc) > 0; // 相机恒在球外：近交点存在即命中
  }

  // —————————————————————————— 2D 兜底路径（既有行为，原样保留） ——————————————————————————

  /** 2D 全量绘制：背景 + 恒星 + 轨道环 + 行星小圆 + 舰队 + 异常弧（webglcontextlost/Tier3 保护） */
  _render2D(ctx, w, h, data, opts = {}) {
    this._pickCache = null;
    const reduced = !!opts.reducedEffects;
    const t = Number(opts.time) || 0;

    this._drawBackground(ctx, w, h);
    if (!data || !data.system || !data.system.star) {
      this._drawEmptyHint(ctx, w, h);
      return;
    }

    const cx = w / 2;
    const cy = h / 2;
    const star = STAR_STYLES[data.system.star.typeId] || { color: '#ffd27a', r: 14 };
    const planets = Array.isArray(data.system.planets) ? data.system.planets : [];
    const tick = Number(data.tick) || 0;

    // —— 中心恒星（类型着色 + 光晕） ——
    this._drawStar(ctx, cx, cy, data.system.star.typeId, star, reduced);

    // —— 轨道环 + 行星 ——
    const n = Math.max(1, planets.length);
    for (const p of planets) {
      const orbit = Math.max(0, Number(p.orbitIndex) || 0);
      const R = ORBIT_BASE + orbit * ORBIT_STEP;
      // 轨道圆环（选中行星的轨道稍亮）
      const isSelected = opts.selectedPlanetId === p.id;
      ctx.strokeStyle = isSelected ? 'rgba(79,216,232,0.28)' : 'rgba(79,216,232,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // 均分初相角（按 orbitIndex）+ tick*0.0004 缓慢公转（纯表现）
      const angle = (orbit / n) * Math.PI * 2 + tick * 0.0004;
      const px = cx + Math.cos(angle) * R;
      const py = cy + Math.sin(angle) * R;
      this._drawPlanet(ctx, p, px, py, isSelected, reduced, t);
      // 记录可命中位置（pick 用）
      this._pickList.push({ id: p.id, x: px, y: py, r: PLANET_RADIUS[p.category] || 5 });
    }

    // —— 在系舰队（内圈停靠环上均布小三角） ——
    const fleets = Array.isArray(data.fleets) ? data.fleets : [];
    for (let i = 0; i < fleets.length; i++) {
      const f = fleets[i];
      const angle = (i / Math.max(1, fleets.length)) * Math.PI * 2 + tick * 0.0004;
      const fx = cx + Math.cos(angle) * FLEET_RING;
      const fy = cy + Math.sin(angle) * FLEET_RING;
      ctx.beginPath();
      ctx.moveTo(fx, fy - 4.5);
      ctx.lineTo(fx - 4, fy + 3.5);
      ctx.lineTo(fx + 4, fy + 3.5);
      ctx.closePath();
      ctx.fillStyle = rgba(f.color || '#4fd8e8', 0.95);
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,11,18,0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // —— 异常氛围：存在未解决异常时外缘画淡紫信号弧（纯提示，不含状态细节） ——
    const anomalies = Array.isArray(data.anomalies) ? data.anomalies : [];
    if (anomalies.some((a) => a && a.state !== 'resolved')) {
      const maxR = ORBIT_BASE + Math.max(0, planets.length) * ORBIT_STEP + 26;
      ctx.strokeStyle = 'rgba(126,168,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, t * 0.4, t * 0.4 + Math.PI * 1.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** 背景：深空径向渐变（按尺寸缓存） */
  _drawBackground(ctx, w, h) {
    const key = `${w}x${h}`;
    if (this._bgKey !== key) {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, '#0d1626');
      g.addColorStop(1, '#070b12');
      this._bgGrad = g;
      this._bgKey = key;
    }
    ctx.fillStyle = this._bgGrad;
    ctx.fillRect(0, 0, w, h);
  }

  /** 空数据提示（未选中/未找到星系） */
  _drawEmptyHint(ctx, w, h) {
    ctx.fillStyle = 'rgba(113,131,154,0.8)';
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('未选中星系 —— 在银河地图双击星系进入', w / 2, h / 2);
  }

  /** 中心恒星：类型着色 + 光晕；黑洞画吸积盘弧线；脉冲/中子星画十字光（2D） */
  _drawStar(ctx, cx, cy, typeId, star, reduced) {
    if (typeId === 'blackHole') {
      // 吸积盘：两段暖色弧 + 暗核
      ctx.strokeStyle = 'rgba(232,176,79,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, star.r + 5, 0.15 * Math.PI, 1.05 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,138,106,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, star.r + 9, 1.2 * Math.PI, 1.95 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(cx, cy, star.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // 光晕（径向渐变；reduced 时降为淡平涂）
    const gr = star.r * 3.2;
    if (reduced) {
      ctx.fillStyle = rgba(star.color, 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(cx, cy, star.r * 0.4, cx, cy, gr);
      g.addColorStop(0, rgba(star.color, 0.4));
      g.addColorStop(1, rgba(star.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 脉冲星 / 中子星：十字光束
    if (typeId === 'pulsar' || typeId === 'neutronStar') {
      ctx.strokeStyle = rgba(star.color, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - star.r * 4.5, cy);
      ctx.lineTo(cx + star.r * 4.5, cy);
      ctx.moveTo(cx, cy - star.r * 4.5);
      ctx.lineTo(cx, cy + star.r * 4.5);
      ctx.stroke();
    }

    // 本体
    ctx.fillStyle = star.color;
    ctx.beginPath();
    ctx.arc(cx, cy, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 单个行星：本体 + 微明暗（2D）；选中环/宜居度环/殖民旗/名字走 _drawPlanetOverlays */
  _drawPlanet(ctx, p, px, py, isSelected, reduced, t) {
    const color = PLANET_COLORS[p.category] || '#a8937c';
    const r = PLANET_RADIUS[p.category] || 5;

    // 本体
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    // 微弱明暗（上半球提亮的简易立体感）
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(px - r * 0.25, py - r * 0.25, r * 0.62, 0, Math.PI * 2);
    ctx.fill();

    // 选中呼吸光环 / 宜居度绿环 / 殖民环旗 / 名字（GL 路径 HUD 亦复用）
    this._drawPlanetOverlays(ctx, p, px, py, r, isSelected, reduced, t);
  }

  /**
   * 行星 2D 覆盖层（2D 与 GL-HUD 共用）：选中呼吸光环、宜居度绿环、
   * 殖民环旗标记、选中行星名字。
   */
  _drawPlanetOverlays(ctx, p, px, py, r, isSelected, reduced, t) {
    if (isSelected && !reduced) {
      // 选中呼吸光环（先画，位于行星之下）
      const pulse = Math.sin(t * 3) * 1.5;
      ctx.strokeStyle = 'rgba(79,216,232,0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px, py, r + 6 + pulse, 0, Math.PI * 2);
      ctx.stroke();
    } else if (isSelected) {
      // 减少动效：静态选中环
      ctx.strokeStyle = 'rgba(79,216,232,0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px, py, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 宜居度 > 45：绿色细环
    if ((p.habitability ?? 0) > 45) {
      ctx.strokeStyle = 'rgba(98,217,138,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 殖民地：环旗标记（环绕细环 + 旗杆三角旗）
    if (p.colonyId) {
      ctx.strokeStyle = 'rgba(79,216,232,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      const topY = py - r - 2.5;
      ctx.strokeStyle = 'rgba(233,240,247,0.9)';
      ctx.beginPath();
      ctx.moveTo(px + r * 0.5, topY);
      ctx.lineTo(px + r * 0.5, topY - 9);
      ctx.stroke();
      ctx.fillStyle = 'rgba(79,216,232,0.95)';
      ctx.beginPath();
      ctx.moveTo(px + r * 0.5, topY - 9);
      ctx.lineTo(px + r * 0.5 + 7, topY - 6.5);
      ctx.lineTo(px + r * 0.5, topY - 4);
      ctx.closePath();
      ctx.fill();
    }

    if (isSelected && !reduced) {
      // 选中行星的名字（便于与右侧行星卡对应）
      ctx.fillStyle = 'rgba(233,240,247,0.92)';
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(p.name || ''), px, py + r + 9);
    }
  }
}
