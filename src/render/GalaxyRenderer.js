/**
 * render/GalaxyRenderer.js — 银河地图渲染器（纯 Canvas 2D，只读快照渲染）
 *
 * 职责：
 *  - 世界坐标（0..1000，与 galaxyGen 的策略空间一致）↔ 屏幕坐标双向映射与视图控制
 *    （panBy / zoomAt / screenToWorld / worldToScreen）；
 *  - 按图层开关绘制：背景星野、航路、势力范围、星系节点、舰队、标签与各叠加层；
 *  - pick(sx, sy) 命中检测（最近星系），供视图做选择 / 悬停 / 双击进入。
 *
 * ⚠ 设计令牌同步声明：本文件的色板字面量是 styles.css `:root` 变量的手工副本
 *   （读取 getComputedStyle 每帧开销过高），若调整 styles.css 的变量需同步改这里：
 *   --bg #070b12 / --panel #0e1520 / --line #1d2a3a / --ink #c9d6e3 / --ink-dim #71839a
 *   --ink-faint #46586e / --accent #4fd8e8 / --accent2 #7ea8ff / --warn #e8b04f
 *   --danger #e85f5f / --ok #62d98a
 *
 * 确定性约束：背景星点使用固定 hash 函数（禁止 Math.random），位置不随帧变化；
 * 本渲染器不写任何世界/快照状态。
 */

/** 与 styles.css 同步的字面量色板（见文件头同步声明） */
const C = {
  BG: '#070b12',
  BG_DEEP: '#0d1626',
  LINE: '#1d2a3a',
  INK: '#c9d6e3',
  INK_DIM: '#71839a',
  INK_FAINT: '#46586e',
  ACCENT: '#4fd8e8',
  ACCENT2: '#7ea8ff',
  WARN: '#e8b04f',
  DANGER: '#e85f5f',
  OK: '#62d98a',
  NODE_UNSEEN: '#39465a', // 未探索星系的暗灰点
  LABEL: '#e9f0f7',       // 标签近白色
};

/** 视图字体（与 styles.css --font 栈一致） */
const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** 恒星类型 → 地图节点本色（与 SystemRenderer 的恒星着色同源） */
const STAR_COLORS = {
  yellowDwarf: '#ffd27a',
  redDwarf: '#ff8a6a',
  blueGiant: '#9ecbff',
  whiteDwarf: '#e8f2ff',
  neutronStar: '#b8e8ff',
  pulsar: '#b8e8ff',
  blackHole: '#2a2f3a', // 本体近黑，靠吸积环辨识
};

/** 恒星类型 → 地图节点基准半径（逻辑像素，随 zoom 轻微缩放） */
const STAR_SIZES = {
  yellowDwarf: 3.4,
  redDwarf: 2.8,
  blueGiant: 5.0,
  whiteDwarf: 3.0,
  neutronStar: 2.8,
  pulsar: 3.0,
  blackHole: 3.6,
};

/** 世界坐标范围（与 galaxyGen 的 W=1000 一致） */
const WORLD = 1000;

/** 确定性 hash：f(i) = frac(sin(i*127.1)*43758.5453)，禁用 Math.random */
function hash01(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** hex(#rgb/#rrggbb) → rgba 字符串；解析失败回退灰 */
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

export class GalaxyRenderer {
  constructor() {
    /** 视图状态：x/y 为屏幕中心的世界坐标，zoom 为屏/世界缩放比 */
    this.view = { x: WORLD / 2, y: WORLD / 2, zoom: 1 };
    /** @type {import('./CanvasManager.js').CanvasManager|null} */
    this.cm = null;
    /** 最新快照引用（视图通过 setSnapshot 更新；渲染循环读最新值） */
    this._snapshot = null;
    /** 悬停命中的星系 id（视图直接写 renderer._hoverId 或调用 setHover） */
    this._hoverId = null;
    this._bgKey = '';    // 背景渐变缓存键（w×h）
    this._bgGrad = null; // 背景渐变缓存
    this._stars = null;  // 程序化静态星点（世界坐标，懒构建一次）
  }

  /** 绑定画布管理器（提供 width/height 供坐标换算） */
  init(canvasManager) {
    this.cm = canvasManager;
    return this;
  }

  /** 更新渲染用的最新快照引用（不复制、不修改） */
  setSnapshot(snap) {
    this._snapshot = snap || null;
  }

  /** 更新悬停星系 id */
  setHover(id) {
    this._hoverId = id || null;
  }

  // —— 视图变换 ——————————————————————————————————

  /** 当前视口宽（逻辑像素） */
  _vw() { return this.cm ? this.cm.width : 0; }
  /** 当前视口高（逻辑像素） */
  _vh() { return this.cm ? this.cm.height : 0; }

  /** 屏幕坐标 → 世界坐标 */
  screenToWorld(sx, sy) {
    const z = this.view.zoom;
    return {
      x: (sx - this._vw() / 2) / z + this.view.x,
      y: (sy - this._vh() / 2) / z + this.view.y,
    };
  }

  /** 世界坐标 → 屏幕坐标（返回 [sx, sy]） */
  worldToScreen(wx, wy) {
    const z = this.view.zoom;
    return [
      (wx - this.view.x) * z + this._vw() / 2,
      (wy - this.view.y) * z + this._vh() / 2,
    ];
  }

  /** 按屏幕像素平移视图（dx/dy 为屏幕位移，内部换算为世界位移） */
  panBy(dx, dy) {
    const z = this.view.zoom || 1;
    // 软边界：防止把星图拖丢（世界 0..1000，放宽 ±200）
    this.view.x = Math.min(WORLD + 200, Math.max(-200, this.view.x - dx / z));
    this.view.y = Math.min(WORLD + 200, Math.max(-200, this.view.y - dy / z));
  }

  /** 以屏幕点 (sx,sy) 为锚缩放（factor>1 放大），zoom clamp 0.5–4 */
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy); // 光标下的世界点（缩放前后不动）
    const z = Math.min(4, Math.max(0.5, this.view.zoom * factor));
    this.view.zoom = z;
    this.view.x = before.x - (sx - this._vw() / 2) / z;
    this.view.y = before.y - (sy - this._vh() / 2) / z;
    this._clampView();
  }

  /** 视图中心软边界约束 */
  _clampView() {
    this.view.x = Math.min(WORLD + 200, Math.max(-200, this.view.x));
    this.view.y = Math.min(WORLD + 200, Math.max(-200, this.view.y));
  }

  // —— 命中检测 ——————————————————————————————————

  /**
   * 屏幕点命中检测：返回命中的星系 id 或 null。
   * 命中半径 = max(10, 14/zoom) 逻辑像素，取最近距离者。
   */
  pick(sx, sy) {
    const snap = this._snapshot;
    if (!snap || !Array.isArray(snap.systems)) return null;
    const r = Math.max(10, 14 / this.view.zoom);
    let best = null;
    let bestD = Infinity;
    for (const s of snap.systems) {
      const [px, py] = this.worldToScreen(s.x, s.y);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= r && d < bestD) {
        best = s.id;
        bestD = d;
      }
    }
    return best;
  }

  // —— 渲染 ——————————————————————————————————

  /**
   * 渲染一帧。
   * @param {CanvasRenderingContext2D} ctx 2D 上下文（已由 CanvasManager.beginFrame 设定 dpr 变换）
   * @param {number} w 画布逻辑像素宽
   * @param {number} h 画布逻辑像素高
   * @param {object} snapshot App 快照（snapshot.systems / fleets / factions / battles）
   * @param {object} layers 图层开关 { lanes, ownership, claims, resources, danger,
   *                                 fleets, surveys, colonies, trade, fronts }
   * @param {object} opts { selectedId, hoverId, playerFactionId, reducedEffects,
   *                        time(秒，仅动画), marketSystemIds(Set|Array，trade 层用) }
   */
  render(ctx, w, h, snapshot, layers, opts = {}) {
    const snap = snapshot || this._snapshot;
    if (snap) this._snapshot = snap;
    this._w = w;
    this._h = h;

    const reduced = !!opts.reducedEffects;
    const t = Number(opts.time) || 0;
    const L = { lanes: true, ownership: true, claims: false, resources: false, danger: false,
      fleets: true, surveys: true, colonies: true, trade: false, fronts: true, ...(layers || {}) };

    // 1) 背景深空渐变 + 程序化静态星点
    this._drawBackground(ctx, w, h);

    if (!snap || !Array.isArray(snap.systems)) return;
    const byId = new Map(snap.systems.map((s) => [s.id, s]));
    const facColor = new Map((snap.factions || []).map((f) => [f.id, f.color || C.ACCENT]));

    // 2) 航路（两端 surveyedLevel>=1 实线 0.25，否则 0.08）
    if (L.lanes) this._drawLanes(ctx, snap, byId);

    // 3) 势力范围光晕
    if (L.ownership) this._drawOwnership(ctx, snap, facColor, reduced);

    // 4) 星系节点（含 claims / danger / surveys / colonies / trade 叠加层）
    this._drawSystems(ctx, snap, byId, facColor, L, opts, reduced, t);

    // 5) 舰队图标（同系多队横向偏移）
    if (L.fleets) this._drawFleets(ctx, snap, facColor);

    // 6) 标签（zoom<0.8 时按 y 贪心抽稀）
    this._drawLabels(ctx, snap, facColor);

    // 7) 战争前线（战斗星系脉冲环，置于最上）
    if (L.fronts) this._drawFronts(ctx, snap, reduced, t);
  }

  /** 背景深空渐变 + 世界锚定的静态星点 */
  _drawBackground(ctx, w, h) {
    const key = `${w}x${h}`;
    if (this._bgKey !== key) {
      const g = ctx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h / 2, Math.max(w, h) * 0.78);
      g.addColorStop(0, C.BG_DEEP);
      g.addColorStop(1, C.BG);
      this._bgGrad = g;
      this._bgKey = key;
    }
    ctx.fillStyle = this._bgGrad;
    ctx.fillRect(0, 0, w, h);

    if (!this._stars) {
      // 世界锚定星点：一次构建，随视图平移缩放，位置永不随帧漂移
      const stars = [];
      const N = 260;
      for (let i = 0; i < N; i++) {
        stars.push({
          x: hash01(i) * WORLD,
          y: hash01(i * 1.37 + 7.31) * WORLD,
          r: 0.5 + hash01(i * 2.11 + 13.7) * 1.3,
          a: 0.12 + hash01(i * 3.73 + 29.1) * 0.5,
        });
      }
      this._stars = stars;
    }
    const m = 60; // 视口外剔除边距
    for (const st of this._stars) {
      const [sx, sy] = this.worldToScreen(st.x, st.y);
      if (sx < -m || sy < -m || sx > w + m || sy > h + m) continue;
      ctx.fillStyle = `rgba(201,214,227,${st.a})`;
      ctx.fillRect(sx - st.r / 2, sy - st.r / 2, st.r, st.r);
    }
  }

  /** 航路：两端均已侦测(surveyedLevel>=1) → 0.25 实线，否则 0.08 */
  _drawLanes(ctx, snap, byId) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    let knownPath = false;
    // 分两批描边，减少状态切换：先画已知（亮），再画未知（暗）
    const dimSegs = [];
    for (const s of snap.systems) {
      for (const laneId of s.lanes || []) {
        if (laneId <= s.id) continue; // 字符串序去重：每条航路只画一次
        const other = byId.get(laneId);
        if (!other) continue;
        const known = (s.surveyedLevel ?? 0) >= 1 && (other.surveyedLevel ?? 0) >= 1;
        if (known) {
          const [ax, ay] = this.worldToScreen(s.x, s.y);
          const [bx, by2] = this.worldToScreen(other.x, other.y);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by2);
          knownPath = true;
        } else {
          dimSegs.push([s.x, s.y, other.x, other.y]);
        }
      }
    }
    if (knownPath) {
      ctx.strokeStyle = rgba(C.ACCENT, 0.25);
      ctx.stroke();
    }
    ctx.beginPath();
    for (const [ax, ay, bx, by2] of dimSegs) {
      const [x1, y1] = this.worldToScreen(ax, ay);
      const [x2, y2] = this.worldToScreen(bx, by2);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = rgba(C.ACCENT, 0.08);
    ctx.stroke();
  }

  /** 势力范围：每个有主星系画一层大半径径向渐变（faction.color, alpha 0.05） */
  _drawOwnership(ctx, snap, facColor, reduced) {
    const R = 90; // 世界单位半径
    for (const s of snap.systems) {
      if (!s.ownerFactionId) continue;
      const color = facColor.get(s.ownerFactionId) || C.ACCENT;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      const sr = R * this.view.zoom;
      if (sx < -sr || sy < -sr || sx > this._w + sr || sy > this._h + sr) continue;
      if (reduced) {
        // 减少动效：以平涂替代径向渐变
        ctx.fillStyle = rgba(color, 0.04);
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        g.addColorStop(0, rgba(color, 0.05));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 星系节点主体。
   * surveyedLevel 0 → 暗灰小点（无名字）；1–3 → 按恒星类型的星点（黑洞吸积环 / 脉冲星十字光）；
   * 4 → 全亮（带辉光）；外圈 = 归属势力色（无主灰）；选中呼吸圈；danger>6 红色细环。
   */
  _drawSystems(ctx, snap, byId, facColor, L, opts, reduced, t) {
    const z = this.view.zoom;
    const sizeK = Math.min(1.5, Math.max(0.8, z)); // 节点随缩放的轻微尺寸响应
    const markets = opts.marketSystemIds || null;
    const hasMarket = (id) => markets && typeof markets.has === 'function' ? markets.has(id) : false;
    const M = 60; // 视口外剔除边距

    for (const s of snap.systems) {
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      if (sx < -M || sy < -M || sx > this._w + M || sy > this._h + M) continue;
      const lvl = s.surveyedLevel ?? 0;
      const ownerColor = s.ownerFactionId ? (facColor.get(s.ownerFactionId) || C.ACCENT) : C.INK_DIM;

      // —— 星点本体 ——
      if (lvl === 0) {
        // 未探索：暗灰小点，无任何额外信息
        ctx.fillStyle = C.NODE_UNSEEN;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2 * sizeK, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const typeId = s.star && s.star.typeId;
        const baseR = (STAR_SIZES[typeId] || 3.2) * sizeK;
        const color = STAR_COLORS[typeId] || C.INK;
        if (lvl >= 4) {
          // 全亮：低配辉光（大半透明圆垫底）
          ctx.fillStyle = rgba(color, 0.18);
          ctx.beginPath();
          ctx.arc(sx, sy, baseR * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (typeId === 'blackHole') {
          // 黑洞：暗核 + 吸积环
          ctx.fillStyle = '#111318';
          ctx.beginPath();
          ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(C.WARN, 0.85);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR + 1.8, 0, Math.PI * 2);
          ctx.stroke();
        } else if (typeId === 'pulsar' || typeId === 'neutronStar') {
          // 脉冲星：十字光 + 亮核
          ctx.strokeStyle = rgba(color, 0.65);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx - baseR * 3, sy);
          ctx.lineTo(sx + baseR * 3, sy);
          ctx.moveTo(sx, sy - baseR * 3);
          ctx.lineTo(sx, sy + baseR * 3);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR * 0.9, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // —— 外圈（归属势力色 / 无主灰） ——
      ctx.strokeStyle = rgba(ownerColor, 0.9);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, 7 * sizeK, 0, Math.PI * 2);
      ctx.stroke();

      // —— 悬停圈 ——
      if (opts.hoverId && opts.hoverId === s.id) {
        ctx.strokeStyle = rgba(C.INK, 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 9.5 * sizeK, 0, Math.PI * 2);
        ctx.stroke();
      }

      // —— 选中：高亮圈 + 呼吸动画（reduced 时静止） ——
      if (opts.selectedId === s.id) {
        const pulse = reduced ? 0 : Math.sin(t * 3) * 1.6;
        ctx.strokeStyle = rgba(C.ACCENT, 0.95);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sx, sy, (11 + pulse) * sizeK, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = rgba(C.ACCENT, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, (14 + pulse) * sizeK, 0, Math.PI * 2);
        ctx.stroke();
      }

      // —— danger > 6：红色细环（常显，不依赖 danger 图层） ——
      if ((s.dangerRating ?? 0) > 6) {
        ctx.strokeStyle = rgba(C.DANGER, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 9 * sizeK, 0, Math.PI * 2);
        ctx.stroke();
      }

      // —— 叠加层（按图层开关） ——
      if (L.claims && s.ownerFactionId) {
        // 领土主张：势力色虚线边界圈
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = rgba(ownerColor, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 15 * sizeK, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (L.resources && lvl >= 1) {
        // 资源富集：节点下色条 + 评级小字（resourceRating 0..10）
        const rating = Math.min(10, Math.max(0, s.resourceRating ?? 0));
        const bw = 14;
        ctx.fillStyle = rgba(C.LINE, 0.9);
        ctx.fillRect(sx - bw / 2, sy + 10, bw, 2.5);
        ctx.fillStyle = rgba(C.OK, 0.35 + rating / 10 * 0.65);
        ctx.fillRect(sx - bw / 2, sy + 10, bw * (rating / 10), 2.5);
        ctx.fillStyle = rgba(C.INK_FAINT, 0.95);
        ctx.font = `8px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(rating.toFixed(1), sx + bw / 2 + 3, sy + 7.5);
      }
      if (L.danger) {
        // 危险度色环：warn(低) → danger(高)
        const d = Math.min(10, Math.max(0, s.dangerRating ?? 0));
        if (d > 0.5) {
          const col = d <= 4 ? C.WARN : C.DANGER;
          ctx.strokeStyle = rgba(col, Math.min(0.85, 0.15 + d / 10));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, 10.5 * sizeK, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (L.surveys && lvl >= 1) {
        // 扫描覆盖：调查层级进度弧（lvl/4 圆周）
        ctx.strokeStyle = rgba(C.ACCENT, lvl >= 4 ? 0.9 : 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 13 * sizeK, -Math.PI / 2, -Math.PI / 2 + (Math.min(4, lvl) / 4) * Math.PI * 2);
        ctx.stroke();
      }
      if (L.colonies && (s.colonyCount ?? 0) > 0) {
        // 殖民状态：白色方旗标记 + 数量
        ctx.fillStyle = rgba(C.INK, 0.95);
        ctx.fillRect(sx + 7, sy - 12, 5, 5);
        ctx.strokeStyle = rgba('#070b12', 0.8);
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 7, sy - 12, 5, 5);
        if (s.colonyCount > 1) {
          ctx.fillStyle = rgba(C.INK, 0.9);
          ctx.font = `8px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(s.colonyCount), sx + 13, sy - 12);
        }
      }
      if (L.trade && hasMarket(s.id)) {
        // 贸易流：有市场星系画 ◇（琥珀色菱形轮廓）
        const r = 4;
        ctx.strokeStyle = rgba(C.WARN, 0.9);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 14 - r);
        ctx.lineTo(sx + r, sy - 14);
        ctx.lineTo(sx, sy - 14 + r);
        ctx.lineTo(sx - r, sy - 14);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  /** 舰队图标：systemId 非空（在系停靠）的舰队画 ▲ 小三角，同系多队横向偏移 */
  _drawFleets(ctx, snap, facColor) {
    // 按 systemId 分组（保持确定性顺序）
    const groups = new Map();
    for (const f of snap.fleets || []) {
      if (!f.systemId) continue; // 在途舰队 systemId 为空，不上图
      if (!groups.has(f.systemId)) groups.set(f.systemId, []);
      groups.get(f.systemId).push(f);
    }
    for (const [systemId, list] of groups) {
      const sys = (snap.systems || []).find((s) => s.id === systemId);
      if (!sys) continue;
      const [sx, sy] = this.worldToScreen(sys.x, sys.y);
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const f = list[i];
        const x = sx + (i - (n - 1) / 2) * 9;
        const y = sy + 14;
        const color = facColor.get(f.factionId) || C.ACCENT;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x - 4, y + 3);
        ctx.lineTo(x + 4, y + 3);
        ctx.closePath();
        ctx.fillStyle = rgba(color, 0.95);
        ctx.fill();
        ctx.strokeStyle = rgba(C.BG, 0.8); // 深色描边保证与背景分离
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  /**
   * 标签：surveyedLevel>=1 显示名字；zoom<0.8 时按 y 排序做贪心抽稀
   * （纵向间距 <12px 的后者隐藏）。名字白色 10px，有主星系在名字前加 owner 色点。
   */
  _drawLabels(ctx, snap, facColor) {
    const showAll = this.view.zoom >= 0.8;
    const candidates = [];
    for (const s of snap.systems) {
      if ((s.surveyedLevel ?? 0) < 1) continue; // 未探索无名字
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      if (sx < -30 || sy < -16 || sx > this._w + 30 || sy > this._h + 16) continue;
      candidates.push({ s, sx, sy });
    }
    candidates.sort((a, b) => a.sy - b.sy); // 按 y 排序

    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lastY = -Infinity;
    for (const c of candidates) {
      if (!showAll) {
        // 贪心抽稀：与上一个已显示标签纵向间距 <12px 则隐藏
        if (c.sy - lastY < 12) continue;
        lastY = c.sy;
      }
      const ownerColor = c.s.ownerFactionId ? (facColor.get(c.s.ownerFactionId) || C.ACCENT) : null;
      let tx = c.sx + 12;
      if (ownerColor) {
        ctx.fillStyle = rgba(ownerColor, 0.95);
        ctx.beginPath();
        ctx.arc(c.sx + 8, c.sy, 2, 0, Math.PI * 2);
        ctx.fill();
        tx = c.sx + 13;
      }
      ctx.fillStyle = rgba(C.LABEL, 0.92);
      ctx.fillText(String(c.s.name || ''), tx, c.sy);
    }
  }

  /** 战争前线：有进行中战斗的星系画红色脉冲环 */
  _drawFronts(ctx, snap, reduced, t) {
    const battles = snap.battles || [];
    const byId = new Map((snap.systems || []).map((s) => [s.id, s]));
    for (const b of battles) {
      const sys = byId.get(b.systemId);
      if (!sys) continue;
      const [sx, sy] = this.worldToScreen(sys.x, sys.y);
      const pulse = reduced ? 0 : Math.sin(t * 4) * 2;
      ctx.strokeStyle = rgba(C.DANGER, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 14 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.DANGER, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 19 + pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
