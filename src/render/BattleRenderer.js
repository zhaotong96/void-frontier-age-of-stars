/**
 * render/BattleRenderer.js — 战术战斗渲染器（纯 Canvas 2D，只读渲染）
 *
 * 职责：
 *  - 把 battleView() 输出的战斗快照映射到画布：战场逻辑坐标 1000×320，
 *    统一缩放留边居中（顶部预留态势条带）；
 *  - 背景深空 + 确定性星点（hash：frac(sin(i*127.1)*43758.5453)，禁用 Math.random）
 *    + 中线虚线；
 *  - 单位按 side 着色（颜色由 opts.sideColors={a,b} 传入）：三角/箭头朝向 heading，
 *    结构比例 <50% 黄框、<25% 红框，护盾画半透明外圈弧（shield/shieldMax），
 *    order==='retreat' 画蓄能进度弧（进度数据经 opts.retreatCharges 传入），
 *    destroyed 不画；
 *  - 投射物：missile → 2px 光点 + 短尾迹；beamFx → x0,y0→x1,y1 渐隐线（life/maxLife）；
 *  - 选中单位高亮环，悬停单位名字小标签；
 *  - 顶部态势条：双方存活数 / 损失数 / 战斗时间；
 *  - pick(sx, sy)：屏幕坐标命中单位（半径 14 屏幕像素），返回 shipId 或 null。
 *
 * ⚠ 设计令牌同步声明：色板字面量为 styles.css `:root` 变量的手工副本
 *   （与 GalaxyRenderer 同源），调整 styles.css 变量需同步改这里。
 *   本渲染器不写任何世界/快照状态；顶层不触碰 document/window。
 */

/** 与 styles.css 同步的字面量色板 */
const C = {
  BG: '#070b12',
  FIELD_LINE: 'rgba(29, 42, 58, 0.55)',
  MID_LINE: 'rgba(113, 131, 154, 0.35)',
  INK: '#c9d6e3',
  INK_DIM: '#71839a',
  ACCENT: '#4fd8e8',
  WARN: '#e8b04f',
  DANGER: '#e85f5f',
  WHITE: '#e9f0f7',
};

/** 视图字体（与 styles.css --font 栈一致） */
const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** 战场逻辑尺寸（与任务书约定一致：1000×320） */
const FIELD_W = 1000;
const FIELD_H = 320;

/** 顶部态势条带高度（CSS 逻辑像素） */
const BAR_H = 26;

/** 周围边距（左右 / 底部） */
const PAD_X = 16;
const PAD_B = 12;

/** pick 命中半径（屏幕像素） */
const PICK_R = 14;

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

/** 有限数防御：非法回退 fallback */
function fin(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 战斗秒 → m:ss 文本 */
function fmtBattleTime(sec) {
  const s = Math.max(0, Math.floor(fin(sec, 0)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class BattleRenderer {
  constructor() {
    /** @type {import('./CanvasManager.js').CanvasManager|null} 画布管理器 */
    this.cm = null;
    /** 选中单位 shipId（渲染高亮环；视图可经 setSelection 更新） */
    this.selectedShipId = null;
    /** 悬停单位 shipId（渲染名字标签；视图可经 setHover 更新） */
    this.hoverShipId = null;
    /** 最近一次 render 的视图变换：{ scale, ox, oy }（pick 用） */
    this._view = null;
    /** 最近一次 render 的存活单位列表（pick 用） */
    this._units = [];
    /** 背景星点缓存键（w×h 变化时重建） */
    this._starKey = '';
    this._stars = null;
  }

  /** 绑定画布管理器（复用 CanvasManager 的尺寸/dpr/上下文） */
  init(canvasManager) {
    this.cm = canvasManager;
    return this;
  }

  /** 更新选中单位（无参清除） */
  setSelection(shipId) {
    this.selectedShipId = shipId || null;
  }

  /** 更新悬停单位（无参清除） */
  setHover(shipId) {
    this.hoverShipId = shipId || null;
  }

  /**
   * 屏幕坐标 → 单位 shipId 命中检测（半径 14 屏幕像素，取最近者）。
   * @returns {string|null} shipId 或 null
   */
  pick(sx, sy) {
    const v = this._view;
    if (!v || v.scale <= 0) return null;
    const px = fin(sx, NaN);
    const py = fin(sy, NaN);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    let best = null;
    let bestD = PICK_R * PICK_R;
    for (const u of this._units) {
      const ux = v.ox + u.x * v.scale;
      const uy = v.oy + u.y * v.scale;
      const d = (ux - px) * (ux - px) + (uy - py) * (uy - py);
      if (d <= bestD) {
        bestD = d;
        best = u.shipId;
      }
    }
    return best;
  }

  /**
   * 渲染一帧战斗视图。
   * @param {CanvasRenderingContext2D} ctx 上下文（调用方已 beginFrame 设置 dpr 变换）
   * @param {number} w CSS 逻辑像素宽
   * @param {number} h CSS 逻辑像素高
   * @param {object|null} data battleView() 输出（null 时绘制占位提示）
   * @param {object} opts { sideColors:{a,b}, selectedShipId, hoverShipId,
   *                        retreatCharges: { [shipId]: { charge, total } } }
   */
  render(ctx, w, h, data, opts = {}) {
    if (!ctx) return;
    const vw = fin(w, 0);
    const vh = fin(h, 0);
    if (vw < 2 || vh < 2) return;

    const sideColors = {
      a: (opts.sideColors && opts.sideColors.a) || C.ACCENT,
      b: (opts.sideColors && opts.sideColors.b) || C.DANGER,
    };
    const selected = (opts.selectedShipId != null ? opts.selectedShipId : this.selectedShipId) || null;
    const hover = (opts.hoverShipId != null ? opts.hoverShipId : this.hoverShipId) || null;

    // —— 背景：深空底色 + 确定性星点 ——
    ctx.fillStyle = C.BG;
    ctx.fillRect(0, 0, vw, vh);
    this._drawStars(ctx, vw, vh);

    if (!data || !Array.isArray(data.units)) {
      // 无战斗数据：居中占位提示
      ctx.fillStyle = C.INK_DIM;
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无战斗数据', vw / 2, vh / 2);
      this._view = null;
      this._units = [];
      return;
    }

    // —— 战场变换：统一缩放居中，顶部为态势条预留空间 ——
    const scale = Math.min((vw - PAD_X * 2) / FIELD_W, (vh - BAR_H - PAD_B) / FIELD_H);
    const ox = (vw - FIELD_W * scale) / 2;
    const oy = BAR_H + (vh - BAR_H - PAD_B - FIELD_H * scale) / 2;
    this._view = { scale, ox, oy };
    // pick 用单位集：只保留存活单位（与绘制一致）
    this._units = data.units.filter((u) => u && !u.destroyed);

    // —— 战场边框与中线虚线 ——
    ctx.strokeStyle = C.FIELD_LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, FIELD_W * scale, FIELD_H * scale);
    ctx.save();
    ctx.strokeStyle = C.MID_LINE;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(ox + (FIELD_W / 2) * scale, oy);
    ctx.lineTo(ox + (FIELD_W / 2) * scale, oy + FIELD_H * scale);
    ctx.stroke();
    ctx.restore();

    // —— 投射物（先画，位于单位下层） ——
    this._drawProjectiles(ctx, data.projectiles || [], sideColors, scale);

    // —— 单位 ——
    const retreatCharges = opts.retreatCharges || {};
    for (const u of this._units) {
      this._drawUnit(ctx, u, sideColors[u.side] || C.INK_DIM, scale, ox, oy, retreatCharges[u.shipId] || null);
    }

    // —— 选中高亮环 / 悬停名字标签（最上层） ——
    if (selected) this._drawSelection(ctx, selected, scale);
    if (hover) this._drawHoverLabel(ctx, hover, scale);

    // —— 顶部态势条 ——
    this._drawStatus(ctx, vw, data, sideColors);
  }

  // —————————————————————————————————— 内部绘制 ——————————————————————————————————

  /** 背景星点：位置/亮度全部来自确定性 hash，尺寸不变时不重建 */
  _drawStars(ctx, w, h) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (this._starKey !== key || !this._stars) {
      const stars = [];
      for (let i = 0; i < 90; i++) {
        stars.push({
          x: hash01(i * 2.7 + 1) * w,
          y: hash01(i * 3.1 + 7) * h,
          a: 0.12 + 0.45 * hash01(i * 5.3 + 13),
        });
      }
      this._stars = stars;
      this._starKey = key;
    }
    for (const st of this._stars) {
      ctx.fillStyle = `rgba(201, 214, 227, ${st.a.toFixed(3)})`;
      ctx.fillRect(st.x, st.y, 1, 1);
    }
  }

  /** 投射物：missile 光点 + 尾迹；beamFx 渐隐线 */
  _drawProjectiles(ctx, projectiles, sideColors, scale) {
    for (const p of projectiles) {
      if (!p) continue;
      const color = sideColors[p.side] || C.INK_DIM;
      const x = fin(p.x, 0) * scale;
      const y = fin(p.y, 0) * scale;
      if (p.kind === 'beamFx') {
        // 能束：x0,y0 → x1,y1 渐隐线，透明度 = life/maxLife（缺省按 1）
        const lifeRatio = (Number.isFinite(Number(p.life)) && Number.isFinite(Number(p.maxLife)) && Number(p.maxLife) > 0)
          ? Math.max(0, Math.min(1, Number(p.life) / Number(p.maxLife)))
          : 1;
        const x1 = fin(p.x1, fin(p.x0, 0)) * scale;
        const y1 = fin(p.y1, fin(p.y0, 0)) * scale;
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.65 * lifeRatio;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fin(p.x0, 0) * scale, fin(p.y0, 0) * scale);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      // 默认（含 missile）：2px 光点 + 朝 (x0,y0) 反方向的短尾迹
      ctx.save();
      ctx.fillStyle = '#ffe9b8';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.4, 2 * scale), 0, Math.PI * 2);
      ctx.fill();
      let dx = x - fin(p.x0, x - 8) * scale;
      let dy = y - fin(p.y0, y) * scale;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        dx /= len;
        dy /= len;
      } else {
        dx = 1;
        dy = 0;
      }
      const tail = 10 * Math.max(scale, 0.6);
      const grad = ctx.createLinearGradient(x, y, x - dx * tail, y - dy * tail);
      grad.addColorStop(0, rgba(color, 0.7));
      grad.addColorStop(1, rgba(color, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - dx * tail, y - dy * tail);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 单个单位：箭头船体 + 结构框 + 护盾弧 + 撤退蓄能弧 */
  _drawUnit(ctx, u, color, scale, ox, oy, retreatCharge) {
    const sx = ox + fin(u.x, 0) * scale;
    const sy = oy + fin(u.y, 0) * scale;
    const r = ((fin(u.structureMax, 0) > 600 ? 13 : 10)) * Math.max(scale, 0.55);

    // —— 船体箭头（heading 旋转；heading=0 朝 +x，与 engagement.js 布局一致） ——
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(fin(u.heading, 0));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r * 0.9, -r * 0.75);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r * 0.9, r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // —— 结构比例框：<25% 红、<50% 黄（红优先） ——
    const sMax = fin(u.structureMax, 0);
    const ratio = sMax > 0 ? Math.max(0, Math.min(1, fin(u.structure, 0) / sMax)) : 1;
    if (ratio < 0.5) {
      ctx.save();
      ctx.strokeStyle = ratio < 0.25 ? C.DANGER : C.WARN;
      ctx.lineWidth = 1.2;
      const box = r * 2.4;
      ctx.strokeRect(sx - box / 2, sy - box / 2, box, box);
      ctx.restore();
    }

    // —— 护盾外圈弧：扫角 ∝ shield/shieldMax，半透明 ——
    const shMax = fin(u.shieldMax, 0);
    if (shMax > 0) {
      const shRatio = Math.max(0, Math.min(1, fin(u.shield, 0) / shMax));
      if (shRatio > 0.01) {
        ctx.save();
        ctx.strokeStyle = rgba(color, 0.45);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shRatio);
        ctx.stroke();
        ctx.restore();
      }
    }

    // —— 撤退蓄能弧：有进度数据按比例，无数据画虚线圆表示「蓄能中」 ——
    if (u.order === 'retreat') {
      ctx.save();
      ctx.strokeStyle = rgba(C.WARN, 0.85);
      ctx.lineWidth = 1.6;
      const rr = r + 8;
      const total = retreatCharge && Number.isFinite(Number(retreatCharge.total)) ? Number(retreatCharge.total) : 0;
      const charge = retreatCharge ? fin(retreatCharge.charge, 0) : 0;
      if (total > 0) {
        const t = Math.max(0, Math.min(1, charge / total));
        ctx.beginPath();
        ctx.arc(sx, sy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
        ctx.stroke();
      } else {
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 选中单位：白色高亮环 + 四向刻度 */
  _drawSelection(ctx, shipId, scale) {
    const u = this._units.find((x) => x.shipId === shipId);
    if (!u) return;
    const sx = this._view.ox + fin(u.x, 0) * scale;
    const sy = this._view.oy + fin(u.y, 0) * scale;
    const rr = ((fin(u.structureMax, 0) > 600 ? 13 : 10)) * Math.max(scale, 0.55) + 7;
    ctx.save();
    ctx.strokeStyle = rgba(C.WHITE, 0.9);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, rr, 0, Math.PI * 2);
    ctx.stroke();
    // 四向刻度线
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(sx + dx * (rr + 1), sy + dy * (rr + 1));
      ctx.lineTo(sx + dx * (rr + 6), sy + dy * (rr + 6));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 悬停单位：名字小标签（名称 · 船体） */
  _drawHoverLabel(ctx, shipId, scale) {
    const u = this._units.find((x) => x.shipId === shipId);
    if (!u) return;
    const sx = this._view.ox + fin(u.x, 0) * scale;
    const sy = this._view.oy + fin(u.y, 0) * scale;
    const label = `${u.name || '未知舰船'}${u.hullName ? ` · ${u.hullName}` : ''}`;
    ctx.save();
    ctx.font = `11px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const bx = sx + 12;
    const by = sy - 22;
    ctx.fillStyle = 'rgba(7, 11, 18, 0.82)';
    ctx.strokeStyle = C.FIELD_LINE;
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, tw + 10, 17);
    ctx.strokeRect(bx, by, tw + 10, 17);
    ctx.fillStyle = C.INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 5, by + 9);
    ctx.restore();
  }

  /** 顶部态势条：左=side a 存活/损失，右=side b，中间战斗时间 */
  _drawStatus(ctx, vw, data, sideColors) {
    const units = Array.isArray(data.units) ? data.units : [];
    const alive = (side) => units.filter((u) => u && u.side === side && !u.destroyed).length;
    const losses = data.losses || {};
    ctx.save();
    // 半透明背板 + 底部分隔线
    ctx.fillStyle = 'rgba(7, 11, 18, 0.72)';
    ctx.fillRect(0, 0, vw, BAR_H - 1);
    ctx.strokeStyle = C.FIELD_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, BAR_H - 1);
    ctx.lineTo(vw, BAR_H - 1);
    ctx.stroke();

    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';

    // side a（左对齐）
    ctx.fillStyle = sideColors.a;
    ctx.fillRect(10, BAR_H / 2 - 4, 8, 8);
    ctx.fillStyle = C.INK;
    ctx.textAlign = 'left';
    ctx.fillText(`存活 ${alive('a')}   损失 ${fin(losses.a, 0)}`, 24, BAR_H / 2);

    // 战斗时间（居中）
    ctx.fillStyle = C.INK_DIM;
    ctx.textAlign = 'center';
    ctx.fillText(`战斗时间 ${fmtBattleTime(data.time)}`, vw / 2, BAR_H / 2);

    // side b（右对齐）
    const rightText = `存活 ${alive('b')}   损失 ${fin(losses.b, 0)} `;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.INK;
    ctx.fillText(rightText, vw - 28, BAR_H / 2);
    ctx.fillStyle = sideColors.b;
    ctx.fillRect(vw - 18, BAR_H / 2 - 4, 8, 8);
    ctx.restore();
  }
}
