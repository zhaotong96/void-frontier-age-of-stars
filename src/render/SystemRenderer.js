/**
 * render/SystemRenderer.js — 星系轨道视图渲染器（纯 Canvas 2D，纯表现层）
 *
 * 职责：
 *  - 以中心恒星 + 轨道圆环 + 行星的方式呈现单个星系；
 *  - 行星按 orbitIndex 均分初相角，叠加 tick*0.0004 的缓慢公转（纯表现，不回写世界）；
 *  - 叠加在系舰队（小三角）与异常状态氛围；行星可被 pick 命中供视图联动行星卡。
 *
 * ⚠ 设计令牌同步声明：色板字面量与 styles.css `:root` 变量保持一致
 *   （--bg #070b12 / --accent #4fd8e8 / --ok #62d98a / --line #1d2a3a / --ink #c9d6e3），
 *   恒星与行星色板为任务书规定的固定映射；若调整设计令牌需两处同步。
 *
 * 约束：顶层无副作用、不触碰 DOM；渲染只读，不修改传入 data。
 */

/** 恒星类型 → 本体色 / 半径（px） */
const STAR_STYLES = {
  yellowDwarf: { color: '#ffd27a', r: 16 },
  redDwarf: { color: '#ff8a6a', r: 12 },
  blueGiant: { color: '#9ecbff', r: 22 },
  whiteDwarf: { color: '#e8f2ff', r: 13 },
  neutronStar: { color: '#b8e8ff', r: 9 },
  pulsar: { color: '#b8e8ff', r: 9 },
  blackHole: { color: '#111318', r: 14 },
};

/** 行星类别 → 本体色（任务书规定映射） */
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

/** 行星类别 → 本体半径（px） */
const PLANET_RADIUS = {
  rocky: 5, ocean: 5, ice: 4.5, desert: 5,
  gasGiant: 8, lava: 4.5, toxic: 5, artificial: 4,
};

/** 轨道半径：60 + orbitIndex*38；舰队停靠圈半径 */
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
    this._pickList = []; // 最近一帧的行星屏幕位置缓存（pick 用）
    this._w = 0;
    this._h = 0;
    this._bgKey = '';
    this._bgGrad = null;
  }

  /**
   * 渲染一帧轨道视图。
   * @param {CanvasRenderingContext2D} ctx 2D 上下文（已设定 dpr 变换）
   * @param {number} w 画布逻辑像素宽
   * @param {number} h 画布逻辑像素高
   * @param {object|null} data {
   *   system: { star:{typeId,name}, planets:[{id,name,category,habitability,colonyId,orbitIndex}] },
   *   fleets: [{name, factionId, color}],
   *   anomalies: [{state}],
   *   tick: number
   * }
   * @param {object} opts { selectedPlanetId, reducedEffects, time(秒，仅动画) }
   */
  render(ctx, w, h, data, opts = {}) {
    this._w = w;
    this._h = h;
    this._pickList = [];
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

  /** 中心恒星：类型着色 + 光晕；黑洞画吸积盘弧线；脉冲/中子星画十字光 */
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

  /** 单个行星：本体 + 殖民环旗 + 宜居度绿环 + 选中高亮 */
  _drawPlanet(ctx, p, px, py, isSelected, reduced, t) {
    const color = PLANET_COLORS[p.category] || '#a8937c';
    const r = PLANET_RADIUS[p.category] || 5;

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

  /**
   * 行星命中检测：返回命中的 planetId 或 null。
   * 依据最近一帧缓存的屏幕位置，命中半径 = max(10, 行星半径 + 6)。
   */
  pick(sx, sy) {
    let best = null;
    let bestD = Infinity;
    for (const p of this._pickList) {
      const d = Math.hypot(p.x - sx, p.y - sy);
      const hit = Math.max(10, p.r + 6);
      if (d <= hit && d < bestD) {
        best = p.id;
        bestD = d;
      }
    }
    return best;
  }
}
