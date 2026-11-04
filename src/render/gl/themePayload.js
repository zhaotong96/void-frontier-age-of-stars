/**
 * render/gl/themePayload.js — 主题 → 渲染载荷装配器（doc7 TASK-3.2/3.3/3.4）
 *
 * buildThemePayload(themeId, world, planetId, opts) 产出 PlanetSurfaceScene.setTheme
 * 消费的一揽子主题载荷（terrain/sky/weather + 顶层 sun/fog 便捷镜像），把 doc6 §4.4
 * 的九维色板 { base, shadow, highlight, danger, emissive, atmosphere }（sRGB HEX）
 * 翻译为渲染端 uniform 域（线性色、场域坐标热区、主题特效开关、天空模式、天气）。
 *
 * 载荷形态（与 PlanetTerrainMesh.setTheme / PlanetAtmosphere.setTheme 同形）：
 *   {
 *     themeId,                       // 解析后的主题 id（fallback 时为 null）
 *     terrain: {
 *       matColors: [4]×[r,g,b]线性, // 通道 0=base 地表 1=shadow 崖壁 2=highlight 生态 3=danger 道路/脉络
 *       heatZones: [{x,z,radius,intensity}],   // 场域坐标（permafrost：中央热源塔 + 中继站；opts.heatZones 可覆盖）
 *       themeFx:   { waterLevel, biolumePulse, lavaEmissive },
 *       footsteps: [],              // 运行时由视图层填（doc7 §4.1-6 压感涟漪）
 *       sun: { dir, color }, fog: { color, range },
 *     },
 *     sky:   { zenith, horizon, ground, stars, skyMode, auroraStrength?, gasHeight?, dustDensity? },
 *     weather: { kind, density, wind, boxHalf, boxHeight },
 *     sun:   { dir, color },   // 顶层镜像（scene 同时下发地形/大气）
 *     fog:   { color, range }, // 顶层镜像（scene 取作清屏基色）
 *   }
 *
 * 主题特化（doc7 §4.1 七大旗舰）：
 *   abyssal_ocean      水位 -4、短程水下雾 [18,140]、过滤蓝日光、海洋雪 motes；
 *   permafrost_furnace 低角度冷日、stars 0.4、snow 0.7、热区默认中央炉塔（场域中心）
 *                      + 双中继站（cosmeticSeed 确定散布）、whiteout 由运行时加倍密度；
 *   red_regolith       硬白高日、dust 天空 + 0.35 尘幕、长视距；
 *   dry_night_polar    0.35 强度暗紫日、stars 1.0、aurora 天空、干燥无雪（纪律红线）；
 *   sulfur_marsh       病绿日光、gas 天空 uGasHeight≈4.5m（海拔锁定毒气湖）；
 *   biolume_canopy     青绿日光、spores 0.3、biolumePulse=1（压感涟漪 + 荧光脉络）；
 *   obsidian_lava      暗橙低日、ash 0.25、lavaEmissive=1（谷底岩浆黑体）。
 *   扩展钩子：cryomethane_sea（水位 -6）/ glassstorm_barrens（dust）已预置载荷通路。
 *
 * 色板来源优先级：opts.palette → setThemePaletteSource 注册的外部注册表（D1 的
 * planetThemes.js 落地后由主代理接线）→ 本文件 FLAGSHIP_PALETTES（doc6 §4.4 最小
 * 本地映射）→ CATEGORY_PALETTES（themeless 行星按 category 兜底）→ generic 兜底。
 *
 * 确定性：world/planet 经 derivePlanetSeeds 派生，太阳方位/热区散布由 cosmeticSeed
 * 的 mulberry32 子流驱动；全程无 Math.random（任务书 1.5 / lint:static P0）。
 * 本模块为纯函数集（除可注入的色板源槽位外零状态）；Node 侧可安全 import。
 */

import { derivePlanetSeeds } from '../../domain/ground/planetSeeds.js';

// ———— 色板（doc6 §4.4 / doc7 §4.0；sRGB HEX，输出前统一转线性） ————

/** 七大旗舰主题最小本地色板（planetThemes.js 落地前的权威兜底；形状与其一致） */
export const FLAGSHIP_PALETTES = {
  abyssal_ocean: {
    base: '#087F95', shadow: '#042A46', highlight: '#5DEBDF', danger: '#B77BFF',
    emissive: '#5DEBDF', atmosphere: '#0A4E68',
  },
  permafrost_furnace: {
    base: '#EAF5FF', shadow: '#466D8A', highlight: '#91BBD1', danger: '#F2A85D',
    emissive: '#F2A85D', atmosphere: '#BFD3E0',
  },
  red_regolith_frontier: {
    base: '#C66B3B', shadow: '#8B4F36', highlight: '#D4A36A', danger: '#F0C78D',
    emissive: '#D4A36A', atmosphere: '#E3C39A',
  },
  dry_night_polar: {
    base: '#101421', shadow: '#090C14', highlight: '#D8DCE8', danger: '#77718F',
    emissive: '#BDA4FF', atmosphere: '#161C2E',
  },
  sulfur_marsh: {
    base: '#1D341B', shadow: '#101E0E', highlight: '#748F2B', danger: '#B7D84C',
    emissive: '#D9FF76', atmosphere: '#5F6E2E',
  },
  biolume_canopy: {
    base: '#082B3D', shadow: '#041A25', highlight: '#42D8C6', danger: '#007E91',
    emissive: '#A981FF', atmosphere: '#0E3C4C',
  },
  obsidian_lava: {
    base: '#160F14', shadow: '#0A0709', highlight: '#5B171D', danger: '#E54B24',
    emissive: '#FFAA3C', atmosphere: '#2A1210',
  },
  // —— 扩展主题预置（TASK-4.x 消费同一条载荷通路） ——
  cryomethane_sea: {
    base: '#167C87', shadow: '#082B32', highlight: '#56C6C2', danger: '#B8E7E2',
    emissive: '#56C6C2', atmosphere: '#29565E',
  },
  glassstorm_barrens: {
    base: '#9C735D', shadow: '#33262E', highlight: '#E2BE93', danger: '#F5E0BB',
    emissive: '#F5E0BB', atmosphere: '#8A6A5A',
  },
};

/** themeless 行星：按 planet.category 兜底（与 terrainProfiles 8 大类对齐 + generic） */
export const CATEGORY_PALETTES = {
  rocky: {
    base: '#8A7F6C', shadow: '#57503F', highlight: '#A99C7E', danger: '#C9B98F',
    emissive: '#C9B98F', atmosphere: '#B7A98D',
  },
  ocean: {
    base: '#0B5E7A', shadow: '#05304A', highlight: '#3FB7C4', danger: '#7FB6A2',
    emissive: '#3FB7C4', atmosphere: '#7FB0BE',
  },
  ice: {
    base: '#DDE9F2', shadow: '#7C97AB', highlight: '#BFD4E2', danger: '#9FB8CC',
    emissive: '#CFE6F5', atmosphere: '#B9CCDA',
  },
  desert: {
    base: '#C69A62', shadow: '#8A6640', highlight: '#E2C089', danger: '#EAD3A0',
    emissive: '#E2C089', atmosphere: '#DDBE8E',
  },
  lava: {
    base: '#1A1216', shadow: '#0D090B', highlight: '#5B171D', danger: '#E54B24',
    emissive: '#FFAA3C', atmosphere: '#331615',
  },
  toxic: {
    base: '#24371F', shadow: '#131F10', highlight: '#6E8A2E', danger: '#A9CC4B',
    emissive: '#CBE76A', atmosphere: '#5E6E33',
  },
  artificial: {
    base: '#5E6870', shadow: '#2B3238', highlight: '#8FA3AE', danger: '#42C3D6',
    emissive: '#42C3D6', atmosphere: '#6C7A82',
  },
  gasGiant: {
    base: '#C2925C', shadow: '#7A5A44', highlight: '#E5C89A', danger: '#D9B36B',
    emissive: '#F2D6AA', atmosphere: '#C7A87E',
  },
  generic: {
    base: '#8A7F6C', shadow: '#57503F', highlight: '#A99C7E', danger: '#C9B98F',
    emissive: '#C9B98F', atmosphere: '#B7A98D',
  },
};

/** 无水水位哨兵（PlanetTerrainMesh/PlanetWater 约定：<-90 视为无流体表面） */
export const WATERLEVEL_NONE = -1000.0;

// ———— 主题渲染特化表（doc7 §4.1 实施细则的渲染端投影） ————

const THEME_RENDER = {
  abyssal_ocean: {
    waterLevel: -4,
    fogRange: [18, 140],
    sky: { skyMode: 0, stars: 0 },
    sun: { az: 0.9, el: 0.85, color: [0.32, 0.52, 0.62] },
    weather: { kind: 'motes', density: 0.15, wind: [0.5, 0.3] },
    heat: false,
  },
  permafrost_furnace: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [30, 260],
    sky: { skyMode: 0, stars: 0.4 },
    sun: { az: 2.2, el: 0.3, color: [0.66, 0.78, 0.92] },
    weather: { kind: 'snow', density: 0.7, wind: [3.4, 1.2] },
    heat: true,
  },
  red_regolith_frontier: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [70, 480],
    sky: { skyMode: 3, stars: 0, dustDensity: 0.55 },
    sun: { az: 5.4, el: 1.05, color: [1.28, 1.22, 1.1] },
    weather: { kind: 'dust', density: 0.35, wind: [2.6, 0.7] },
    heat: false,
  },
  dry_night_polar: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [40, 300],
    sky: { skyMode: 1, stars: 1.0, auroraStrength: 1.0 },
    sun: { az: 1.4, el: 0.45, color: [0.3, 0.25, 0.44] },
    weather: { kind: 'motes', density: 0.15, wind: [0.4, 0.2] },
    heat: false,
  },
  sulfur_marsh: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [24, 180],
    sky: { skyMode: 2, stars: 0, gasHeightM: 4.5 },
    sun: { az: 3.6, el: 0.55, color: [0.44, 0.52, 0.22] },
    weather: { kind: 'ash', density: 0.15, wind: [0.8, 0.4] },
    heat: false,
  },
  biolume_canopy: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [45, 320],
    sky: { skyMode: 0, stars: 0 },
    sun: { az: 0.3, el: 0.72, color: [0.34, 0.58, 0.55] },
    weather: { kind: 'spores', density: 0.3, wind: [0.5, 0.35] },
    heat: false,
  },
  obsidian_lava: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [36, 240],
    sky: { skyMode: 0, stars: 0 },
    sun: { az: 4.4, el: 0.38, color: [0.58, 0.32, 0.16] },
    weather: { kind: 'ash', density: 0.25, wind: [1.4, 0.5] },
    heat: false,
  },
  cryomethane_sea: {
    waterLevel: -6,
    fogRange: [16, 120],
    sky: { skyMode: 0, stars: 0 },
    sun: { az: 1.9, el: 0.62, color: [0.3, 0.48, 0.55] },
    weather: { kind: 'motes', density: 0.15, wind: [0.6, 0.3] },
    heat: false,
  },
  glassstorm_barrens: {
    waterLevel: WATERLEVEL_NONE,
    fogRange: [50, 340],
    sky: { skyMode: 3, stars: 0, dustDensity: 0.7 },
    sun: { az: 5.9, el: 0.92, color: [1.1, 1.02, 0.88] },
    weather: { kind: 'dust', density: 0.5, wind: [3.8, 0.9] },
    heat: false,
  },
};

/** themeless 行星渲染兜底（按 category；generic 为最终回退） */
const CATEGORY_RENDER = {
  rocky:     { waterLevel: WATERLEVEL_NONE, fogRange: [60, 420], sky: { skyMode: 0, stars: 0 }, sun: { az: 0.7, el: 0.8, color: [1.0, 0.96, 0.84] }, weather: { kind: 'motes', density: 0.15, wind: [0.6, 0.3] }, heat: false },
  ocean:     { waterLevel: -4,              fogRange: [26, 180], sky: { skyMode: 0, stars: 0 }, sun: { az: 0.7, el: 0.8, color: [0.55, 0.68, 0.75] }, weather: { kind: 'motes', density: 0.15, wind: [0.5, 0.3] }, heat: false },
  ice:       { waterLevel: WATERLEVEL_NONE, fogRange: [40, 300], sky: { skyMode: 0, stars: 0 }, sun: { az: 2.0, el: 0.5, color: [0.82, 0.88, 0.98] }, weather: { kind: 'snow', density: 0.35, wind: [1.8, 0.6] }, heat: false },
  desert:    { waterLevel: WATERLEVEL_NONE, fogRange: [70, 480], sky: { skyMode: 0, stars: 0 }, sun: { az: 5.2, el: 1.0, color: [1.2, 1.12, 0.95] }, weather: { kind: 'dust', density: 0.25, wind: [2.2, 0.6] }, heat: false },
  lava:      { waterLevel: WATERLEVEL_NONE, fogRange: [36, 240], sky: { skyMode: 0, stars: 0 }, sun: { az: 4.2, el: 0.45, color: [0.62, 0.36, 0.2] }, weather: { kind: 'ash', density: 0.25, wind: [1.2, 0.5] }, heat: false, lavaEmissive: 1 },
  toxic:     { waterLevel: WATERLEVEL_NONE, fogRange: [28, 190], sky: { skyMode: 2, stars: 0, gasHeightM: 3.5 }, sun: { az: 3.4, el: 0.6, color: [0.5, 0.55, 0.3] }, weather: { kind: 'ash', density: 0.15, wind: [0.8, 0.4] }, heat: false },
  artificial:{ waterLevel: WATERLEVEL_NONE, fogRange: [70, 420], sky: { skyMode: 0, stars: 0 }, sun: { az: 1.1, el: 0.75, color: [1.0, 0.98, 0.92] }, weather: { kind: 'motes', density: 0.15, wind: [0.4, 0.2] }, heat: false },
  gasGiant:  { waterLevel: WATERLEVEL_NONE, fogRange: [80, 520], sky: { skyMode: 0, stars: 0 }, sun: { az: 2.6, el: 0.7, color: [1.05, 0.9, 0.7] }, weather: { kind: 'motes', density: 0.15, wind: [1.0, 0.4] }, heat: false },
  generic:   { waterLevel: WATERLEVEL_NONE, fogRange: [60, 420], sky: { skyMode: 0, stars: 0 }, sun: { az: 0.7, el: 0.8, color: [1.0, 0.96, 0.84] }, weather: { kind: 'motes', density: 0.15, wind: [0.6, 0.3] }, heat: false },
};

// ———— 工具 ————————————————

/** FNV-1a 32 位字符串摘要（本地确定性；与 planetSeeds 的 hash32 语义对齐） */
function fnv32(v) {
  const s = String(v);
  let acc = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    acc ^= s.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193);
  }
  return acc >>> 0;
}

/** mulberry32 确定性子流（cosmeticSeed → 太阳抖动/热区散布；无 Math.random） */
function mulberry32(a) {
  let s = a >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * sRGB HEX → 线性 RGB（doc6 §4.4：Shader 需正确转换到线性空间；标准 sRGB EOTF）。
 * @param {string} hex '#RRGGBB'（'#' 可省略） @returns {[number,number,number]} 线性 [r,g,b]（非法输入回退黑色）
 */
export function srgbToLinear(hex) {
  const h = String(hex == null ? '' : hex).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    out.push(c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  }
  return out;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ———— 色板解析 ————————————————

/** 外部色板源槽位（D1 planetThemes.js 落地后由主代理注入；fn(themeId) → palette|null） */
let externalPaletteSource = null;

/**
 * 注册外部主题色板源（集成点：planetThemes.js 就绪后
 * `setThemePaletteSource((id) => planetThemes[id]?.palette ?? null)`）。
 * @param {((themeId:string)=>object|null)|null} fn
 */
export function setThemePaletteSource(fn) {
  externalPaletteSource = typeof fn === 'function' ? fn : null;
}

/** 色板查表：opts.palette → 外部源 → 旗舰本地表 → category 兜底 → generic */
function resolvePalette(themeId, category, opts) {
  if (opts && opts.palette) return opts.palette;
  if (themeId && externalPaletteSource) {
    const ext = externalPaletteSource(themeId);
    if (ext) return ext;
  }
  if (themeId && FLAGSHIP_PALETTES[themeId]) return FLAGSHIP_PALETTES[themeId];
  if (category && CATEGORY_PALETTES[category]) return CATEGORY_PALETTES[category];
  return CATEGORY_PALETTES.generic;
}

/** 渲染特化查表：旗舰表 → category 兜底 → generic */
function resolveRenderConfig(themeId, category) {
  if (themeId && THEME_RENDER[themeId]) return THEME_RENDER[themeId];
  if (category && CATEGORY_RENDER[category]) return CATEGORY_RENDER[category];
  return CATEGORY_RENDER.generic;
}

/** 行星类别解析：opts.category 显式 → world 实体档案 → null（generic 兜底） */
function resolveCategory(world, planetId, opts) {
  if (opts && opts.category) return String(opts.category);
  const planets = world && world.entities && world.entities.planets;
  const p = planets ? planets[planetId] : null;
  return p && p.category ? String(p.category) : null;
}

// ———— 载荷装配 ————————————————

/**
 * 构建 PlanetSurfaceScene.setTheme 主题载荷（详见文件头形态注释）。
 * @param {string|null} themeId 主题 id（doc6 §4.4；null/未知 → category/generic 兜底）
 * @param {{seed:number}|null} world 世界实体（只读取 seed；null 视为 seed 0）
 * @param {string|number|null} planetId 行星 id（参与子流派生）
 * @param {{
 *   palette?:object,                    // 色板覆盖（{base,shadow,highlight,danger,emissive,atmosphere}）
 *   category?:string,                   // 类别覆盖（themeless 兜底解析用）
 *   heatZones?:Array<{x:number,z:number,radius:number,intensity:number}>, // 覆盖默认热区（任务蓝图驱动）
 *   heatCenter?:[number,number],        // 默认热区中心（场域坐标；缺省 [0,0] = 场域中心）
 *   sunDir?:[number,number,number],     // 太阳方向覆盖（绕过确定性抖动）
 *   fogRange?:[number,number],          // 雾距覆盖
 * }} [opts]
 * @returns {object} 主题载荷（纯数据、可 JSON 序列化、逐位确定）
 */
export function buildThemePayload(themeId, world, planetId, opts = {}) {
  const o = opts || {};
  const seeds = derivePlanetSeeds(world || { seed: 0 }, planetId == null ? 'unknown' : planetId);
  const category = resolveCategory(world, planetId, o);
  const palette = resolvePalette(themeId, category, o);
  const cfg = resolveRenderConfig(themeId, category);
  const rng = mulberry32((seeds.cosmeticSeed ^ fnv32(themeId == null ? `cat:${category}` : themeId)) >>> 0);

  // —— 太阳：主题基准方位/仰角 + cosmeticSeed 确定性抖动（纯视觉相位） ——
  const az = cfg.sun.az + (rng() - 0.5) * 0.7;
  const el = Math.max(0.08, cfg.sun.el + (rng() - 0.5) * 0.2);
  const dir = o.sunDir ? norm3(o.sunDir)
    : norm3([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
  const sun = { dir, color: cfg.sun.color.slice() };

  // —— 线性色板 → 4 通道材质色 + 天空三段 + 雾 ——
  const base = srgbToLinear(palette.base);
  const shadow = srgbToLinear(palette.shadow);
  const highlight = srgbToLinear(palette.highlight);
  const danger = srgbToLinear(palette.danger);
  const atmosphere = srgbToLinear(palette.atmosphere);
  const matColors = [base, shadow, highlight, danger];
  const sky = {
    zenith: atmosphere,
    horizon: mix3(atmosphere, highlight, 0.32),
    ground: scale3(shadow, 0.6),
    stars: cfg.sky.stars,
    skyMode: cfg.sky.skyMode,
  };
  if (cfg.sky.skyMode === 1) sky.auroraStrength = cfg.sky.auroraStrength != null ? cfg.sky.auroraStrength : 1.0;
  if (cfg.sky.skyMode === 2) sky.gasHeight = cfg.sky.gasHeightM != null ? cfg.sky.gasHeightM : 4.5;
  if (cfg.sky.skyMode === 3) sky.dustDensity = cfg.sky.dustDensity != null ? cfg.sky.dustDensity : 0.5;

  const fog = {
    color: atmosphere,
    range: (Array.isArray(o.fogRange) && o.fogRange.length >= 2) ? [o.fogRange[0], o.fogRange[1]] : cfg.fogRange.slice(),
  };

  // —— 主题特效开关（doc7 §8.2 uThemeFx） ——
  const themeFx = {
    waterLevel: Number.isFinite(cfg.waterLevel) ? cfg.waterLevel : WATERLEVEL_NONE,
    biolumePulse: themeId === 'biolume_canopy' ? 1 : 0,
    lavaEmissive: (themeId === 'obsidian_lava' || cfg.lavaEmissive === 1) ? 1 : 0,
  };

  // —— 热区（permafrost 旗舰）：opts.heatZones 覆盖 > 默认中央炉塔 + 双中继站 ——
  let heatZones = [];
  if (Array.isArray(o.heatZones)) {
    for (const hz of o.heatZones) {
      if (hz && Number.isFinite(hz.x) && Number.isFinite(hz.z) && hz.radius > 0) {
        heatZones.push({ x: hz.x, z: hz.z, radius: hz.radius, intensity: Number.isFinite(hz.intensity) ? hz.intensity : 1.0 });
      }
    }
  } else if (cfg.heat) {
    const cx = Array.isArray(o.heatCenter) && Number.isFinite(o.heatCenter[0]) ? o.heatCenter[0] : 0;
    const cz = Array.isArray(o.heatCenter) && Number.isFinite(o.heatCenter[1]) ? o.heatCenter[1] : 0;
    const a0 = rng() * Math.PI * 2;
    heatZones = [
      { x: cx, z: cz, radius: 34, intensity: 1.0 },                                  // 中央热源塔（12m 地标同位）
      { x: cx + Math.cos(a0) * 78, z: cz + Math.sin(a0) * 78, radius: 16, intensity: 0.65 },          // 加热中继站 ×2
      { x: cx + Math.cos(a0 + 2.4) * 78, z: cz + Math.sin(a0 + 2.4) * 78, radius: 16, intensity: 0.65 },
    ];
  }

  const weather = {
    kind: cfg.weather.kind,
    density: cfg.weather.density,
    wind: cfg.weather.wind.slice(),
    boxHalf: 72.0,
    boxHeight: 40.0,
  };

  return {
    themeId: themeId && FLAGSHIP_PALETTES[themeId] ? themeId : (themeId || null),
    terrain: {
      matColors,
      heatZones,
      themeFx,
      footsteps: [],
      sun,
      fog,
    },
    sky,
    weather,
    sun,
    fog,
  };
}
