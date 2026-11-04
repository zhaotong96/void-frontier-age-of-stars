/**
 * tests/suites/theme-expansion.suite.js — THEME-04: 11 扩展主题渲染载荷 / 地貌剖面 / 玩法规则
 *
 * 覆盖（doc7 TASK-4.1/4.2，门禁 THEME-02 辨识度 + doc6 §4.5.8-4.5.18 主题规范）：
 *  (a) 11 个扩展主题 id 均可解析完整渲染载荷（buildThemePayload + dummy world
 *      {seed:24601}）：terrain(matColors/heatZones/themeFx/footsteps/sun/fog)、
 *      sky(zenith/horizon/ground/stars/skyMode)、weather(kind/density/wind)、顶层 sun/fog 镜像；
 *  (b) cloud_giant_atolls：landingMode='atmospheric'（严禁普通地表登陆）且无水体
 *      （waterLevel = WATERLEVEL_NONE 哨兵）、云海甲板特短视距、风暴高密度 dust；
 *  (c) cryomethane_sea：水层有限（waterLevel = -6 甲烷海）；
 *  (d) magnetar_aurora：skyMode 1 极光天空 + auroraStrength 强度有效；
 *  (e) fractured_moon：movementMod.gravityScale = 0.25（0.25g 低重力）+ 真空满星长视距；
 *  (f) 确定性：同输入（themeId + seed + planetId）两次构建 JSON 逐字节一致；
 *  (g) terrainProfiles：扩展主题 → THEME_PROFILE_MAP → TERRAIN_PROFILES 剖面存在，
 *      且具备 buildTriangulatedChunkMesh 兼容的剖面形状键（base/amp/ridge/seaLevel/
 *      materialPalette/biomeIds/hazardRule 与可选 trench/crater/mesa/dune/channel/shelf）；
 *  (h) THEME-02 成对辨识度抽检：11 载荷两两 JSON 互异；甲烷海 vs 碧渊海洋水位与
 *      雾色可一眼区分；云海短视距 vs 镜盐长视距；碎环月真空视距全场最长；
 *      扩展色板本地表与 planetThemes 注册表逐位一致（THEME-07 身份恒定）。
 *
 * 零 GL 依赖、零 galaxy 生成：纯数据层断言（<20s 预算内远低于上限）。
 */
import {
  buildThemePayload, FLAGSHIP_PALETTES, EXPANSION_GAMEPLAY, WATERLEVEL_NONE,
} from '../../src/render/gl/themePayload.js';
import {
  TERRAIN_PROFILES, THEME_PROFILE_MAP, profileForPlanet,
} from '../../src/content/terrainProfiles.js';
import { PLANET_THEMES } from '../../src/content/planetThemes.js';
import { assert, assertEq } from './assert.js';

const WORLD = Object.freeze({ seed: 24601 });
const PLANET_ID = 'planet_theme_expansion_probe';

/** doc7 §4.0 矩阵「扩展 P4」11 主题（引擎注册顺序） */
const EXPANSION_IDS = [
  'prism_crystal',
  'salt_mirror_desert',
  'cryomethane_sea',
  'tidal_lock_dusk',
  'cloud_giant_atolls',
  'fungal_catacombs',
  'ancient_megastructure',
  'glassstorm_barrens',
  'magnetar_aurora',
  'canopy_colossus',
  'fractured_moon',
];

/** 剖面危险规则合法值（terrainProfiles 头注 schema） */
const HAZARD_RULES = ['none', 'below_sea', 'crevasse', 'lowland_gas', 'lava_channel'];

/** buildTriangulatedChunkMesh 兼容剖面的可选嵌套形状键（terrainField 采样器消费） */
const NESTED_SHAPE = {
  trench: { depth: 'number', width: 'number' },
  crater: { count: 'number', radius: 'number', depth: 'number' },
  mesa: { fraction: 'number', step: 'number' },
  dune: { amp: 'number', wavelength: 'number', angle: 'number' },
  channel: { level: 'number', width: 'number' },
  shelf: { level: 'number', threshold: 'number' },
};

function isFinite3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
}

/** (a) 载荷完备性：子对象与数值域逐项校验 */
function checkPayloadShape(id, p) {
  const tag = `[${id}]`;
  assertEq(p.themeId, id, `${tag} 载荷 themeId 不符`);

  // —— terrain ——
  const t = p.terrain;
  assert(!!t, `${tag} terrain 缺失`);
  assert(Array.isArray(t.matColors) && t.matColors.length === 4,
    `${tag} matColors 应为 4 通道`);
  for (let c = 0; c < 4; c++) {
    assert(isFinite3(t.matColors[c]), `${tag} matColors[${c}] 应为有限 [r,g,b]`);
    for (let i = 0; i < 3; i++) {
      assert(t.matColors[c][i] >= 0 && t.matColors[c][i] <= 1,
        `${tag} matColors[${c}][${i}] 应在线性 [0,1]`);
    }
  }
  assert(Array.isArray(t.heatZones), `${tag} heatZones 应为数组`);
  assert(Array.isArray(t.footsteps), `${tag} footsteps 应为数组`);
  const fx = t.themeFx;
  assert(!!fx, `${tag} themeFx 缺失`);
  for (const k of ['waterLevel', 'biolumePulse', 'lavaEmissive']) {
    assert(Number.isFinite(fx[k]), `${tag} themeFx.${k} 应为有限数`);
  }
  assert(fx.biolumePulse === 0 || fx.biolumePulse === 1, `${tag} biolumePulse 应为 0/1`);
  assert(fx.lavaEmissive === 0 || fx.lavaEmissive === 1, `${tag} lavaEmissive 应为 0/1`);

  // —— sun/fog（terrain 内 + 顶层镜像） ——
  for (const sun of [t.sun, p.sun]) {
    assert(!!sun && isFinite3(sun.dir) && isFinite3(sun.color), `${tag} sun.dir/color 应为有限 vec3`);
    const len = Math.hypot(sun.dir[0], sun.dir[1], sun.dir[2]);
    assert(Math.abs(len - 1) < 1e-6, `${tag} sun.dir 应为单位向量 (len=${len})`);
  }
  for (const fog of [t.fog, p.fog]) {
    assert(!!fog && isFinite3(fog.color), `${tag} fog.color 应为有限 vec3`);
    assert(Array.isArray(fog.range) && fog.range.length === 2
      && Number.isFinite(fog.range[0]) && Number.isFinite(fog.range[1])
      && fog.range[0] > 0 && fog.range[0] < fog.range[1],
      `${tag} fog.range 应为 [near,far] 且 near<far`);
  }
  assertEq(p.sun.dir, t.sun.dir, `${tag} 顶层 sun 应为 terrain.sun 镜像`);
  assertEq(p.fog.range, t.fog.range, `${tag} 顶层 fog 应为 terrain.fog 镜像`);

  // —— sky ——
  const sky = p.sky;
  assert(!!sky, `${tag} sky 缺失`);
  assert(isFinite3(sky.zenith) && isFinite3(sky.horizon) && isFinite3(sky.ground),
    `${tag} sky 三段色应为有限 vec3`);
  assert(Number.isFinite(sky.stars) && sky.stars >= 0 && sky.stars <= 1,
    `${tag} sky.stars 应在 [0,1]`);
  assert(Number.isInteger(sky.skyMode) && sky.skyMode >= 0 && sky.skyMode <= 3,
    `${tag} sky.skyMode 应为 0..3`);
  if (sky.skyMode === 1) assert(Number.isFinite(sky.auroraStrength), `${tag} 极光天空应带 auroraStrength`);
  if (sky.skyMode === 2) assert(Number.isFinite(sky.gasHeight) && sky.gasHeight > 0,
    `${tag} gas 天空应带正 gasHeight`);
  if (sky.skyMode === 3) assert(Number.isFinite(sky.dustDensity) && sky.dustDensity >= 0,
    `${tag} dust 天空应带 dustDensity`);

  // —— weather ——
  const w = p.weather;
  assert(!!w, `${tag} weather 缺失`);
  const KINDS = ['snow', 'ash', 'spores', 'dust', 'motes'];
  assert(KINDS.indexOf(w.kind) >= 0, `${tag} weather.kind 非法: ${w.kind}`);
  assert(Number.isFinite(w.density) && w.density >= 0 && w.density <= 1,
    `${tag} weather.density 应在 [0,1]`);
  assert(Array.isArray(w.wind) && w.wind.length === 2 && w.wind.every(Number.isFinite),
    `${tag} weather.wind 应为 vec2`);
  assert(Number.isFinite(w.boxHalf) && Number.isFinite(w.boxHeight), `${tag} weather 盒尺寸缺失`);
}

/** (g) 剖面形状键校验（buildTriangulatedChunkMesh 兼容前提） */
function checkProfileShape(id) {
  const tag = `[${id}]`;
  const pid = THEME_PROFILE_MAP[id];
  assert(typeof pid === 'string' && !!TERRAIN_PROFILES[pid],
    `${tag} THEME_PROFILE_MAP → ${pid} 不在 TERRAIN_PROFILES`);
  const prof = TERRAIN_PROFILES[pid];
  assertEq(prof.id, pid, `${tag} 剖面 id 与键名不一致`);
  for (const k of ['base', 'amp', 'ridge']) {
    assert(Number.isFinite(prof[k]), `${tag} 剖面.${k} 应为有限数`);
  }
  assert(prof.seaLevel === null || Number.isFinite(prof.seaLevel),
    `${tag} 剖面.seaLevel 应为 null 或有限数`);
  assert(Array.isArray(prof.materialPalette) && prof.materialPalette.length === 4
    && prof.materialPalette.every((m) => typeof m === 'string' && m.length > 0),
    `${tag} materialPalette 应为 4 通道语义材质 id`);
  assert(Array.isArray(prof.biomeIds) && prof.biomeIds.length === 4
    && prof.biomeIds.every((b) => typeof b === 'string' && b.length > 0),
    `${tag} biomeIds 应为 4 个生态分区 id`);
  assert(HAZARD_RULES.indexOf(prof.hazardRule) >= 0, `${tag} hazardRule 非法: ${prof.hazardRule}`);
  assertEq(prof.flagsRule, 'none', `${tag} flagsRule 应为 none`);
  if (prof.glowVeins != null) {
    assert(Number.isFinite(prof.glowVeins) && prof.glowVeins >= 0 && prof.glowVeins <= 1,
      `${tag} glowVeins 应在 [0,1]`);
  }
  if (prof.hazardLevel != null) assert(Number.isFinite(prof.hazardLevel), `${tag} hazardLevel 应有限`);
  for (const [key, shape] of Object.entries(NESTED_SHAPE)) {
    const node = prof[key];
    if (node == null) continue;
    for (const [k, typ] of Object.entries(shape)) {
      assert(typeof node[k] === typ && Number.isFinite(node[k]),
        `${tag} 剖面.${key}.${k} 应为有限 ${typ}`);
    }
  }
  // 主题优先查表：profileForPlanet 消费 primaryThemeId 命中专属剖面
  assertEq(profileForPlanet({ category: 'rocky', primaryThemeId: id }), prof,
    `${tag} profileForPlanet 未按 primaryThemeId 命中专属剖面`);
}

export const suite = {
  id: 'THEME-04',
  name: '11 扩展主题渲染载荷/地貌剖面/玩法规则（THEME-02/04，doc7 TASK-4.1/4.2）',
  group: 'WORLD',
  async run() {
    try {
      // ———— (a) 11 扩展主题 → 完整渲染载荷 ————
      const payloads = {};
      for (const id of EXPANSION_IDS) {
        const p = buildThemePayload(id, WORLD, PLANET_ID, {});
        checkPayloadShape(id, p);
        payloads[id] = p;
      }

      // ———— (b) cloud_giant_atolls：大气登陆 + 无水 + 云甲板短视距 ————
      const cg = EXPANSION_GAMEPLAY.cloud_giant_atolls;
      assertEq(cg.landingMode, 'atmospheric', '云海浮岛必须为 atmospheric 登陆模式（严禁普通地表登陆）');
      assertEq(payloads.cloud_giant_atolls.terrain.themeFx.waterLevel, WATERLEVEL_NONE,
        '云海浮岛不得有水体表面（无 waterLevel）');
      const cgFog = payloads.cloud_giant_atolls.fog.range;
      assert(cgFog[1] <= 200, `云海浮岛云甲板视距应特短 (far=${cgFog[1]} > 200)`);
      const cgW = payloads.cloud_giant_atolls.weather;
      assert(cgW.kind === 'dust' && cgW.density >= 0.5,
        `云海浮岛应为高密度风暴 (kind=${cgW.kind}, density=${cgW.density})`);
      // 其它 10 主题均为常规地表登陆
      for (const id of EXPANSION_IDS) {
        if (id === 'cloud_giant_atolls') continue;
        assertEq(EXPANSION_GAMEPLAY[id].landingMode, 'surface', `[${id}] 应为常规地表登陆`);
      }

      // ———— (c) cryomethane_sea：甲烷海水位有限 ————
      const cmLevel = payloads.cryomethane_sea.terrain.themeFx.waterLevel;
      assert(Number.isFinite(cmLevel) && cmLevel < 0,
        `甲烷雾海应有有限负水位（实测 ${cmLevel}）`);
      assertEq(cmLevel, -6, '甲烷雾海水位应为 -6m');

      // ———— (d) magnetar_aurora：强极光天空 ————
      const mgSky = payloads.magnetar_aurora.sky;
      assertEq(mgSky.skyMode, 1, '磁暴极光荒原应为极光天空 (skyMode 1)');
      assert(Number.isFinite(mgSky.auroraStrength) && mgSky.auroraStrength >= 1.0,
        `磁暴极光强度应 ≥1.0（实测 ${mgSky.auroraStrength}）`);

      // ———— (e) fractured_moon：0.25g 低重力 + 真空满星 ————
      assertEq(EXPANSION_GAMEPLAY.fractured_moon.movementMod.gravityScale, 0.25,
        '碎环月重力倍率应为 0.25g');
      assertEq(payloads.fractured_moon.sky.stars, 1.0, '碎环月真空天幕应为满星');
      assert(payloads.fractured_moon.fog.range[0] >= 150,
        `碎环月真空应特长视距 (near=${payloads.fractured_moon.fog.range[0]})`);

      // ———— (f) 确定性：同输入两次构建 JSON 逐字节一致 ————
      for (const id of EXPANSION_IDS) {
        const again = buildThemePayload(id, { seed: 24601 }, PLANET_ID, {});
        assertEq(JSON.stringify(again), JSON.stringify(payloads[id]),
          `[${id}] 同输入载荷应逐字节一致（确定性违例）`);
      }

      // ———— (g) 扩展主题地貌剖面存在 + 形状键齐备 ————
      for (const id of EXPANSION_IDS) checkProfileShape(id);
      // 云海浮岛复用气巨浮台剖面（无硬质地貌）
      assertEq(THEME_PROFILE_MAP.cloud_giant_atolls, 'generic_gas_giant',
        '云海浮岛应映射气巨浮台剖面');
      // 表规模守恒：18 主题全覆盖 + 地貌剖面总数
      assertEq(Object.keys(THEME_PROFILE_MAP).length, 18, 'THEME_PROFILE_MAP 应覆盖 18 主题');
      assertEq(Object.keys(TERRAIN_PROFILES).length, 25,
        'TERRAIN_PROFILES 应为 7 旗舰 + 10 扩展 + 8 兜底 剖面');

      // ———— (h) THEME-02 成对辨识度抽检 ————
      const jsons = EXPANSION_IDS.map((id) => JSON.stringify(payloads[id]));
      for (let i = 0; i < jsons.length; i++) {
        for (let j = i + 1; j < jsons.length; j++) {
          assert(jsons[i] !== jsons[j],
            `[${EXPANSION_IDS[i]}] 与 [${EXPANSION_IDS[j]}] 载荷完全相同（THEME-02 辨识度违例）`);
        }
      }
      // 甲烷雾海 vs 碧渊海洋：水位与雾色必须一眼区分（doc6 §4.5.10）
      const abyss = buildThemePayload('abyssal_ocean', WORLD, PLANET_ID, {});
      assert(payloads.cryomethane_sea.terrain.themeFx.waterLevel !== abyss.terrain.themeFx.waterLevel,
        '甲烷雾海与碧渊海洋水位应不同');
      assert(JSON.stringify(payloads.cryomethane_sea.fog.color) !== JSON.stringify(abyss.fog.color),
        '甲烷雾海与碧渊海洋雾色应不同');
      // 云甲板短视距 vs 镜盐长视距
      assert(payloads.cloud_giant_atolls.fog.range[1] < payloads.salt_mirror_desert.fog.range[1],
        '云海浮岛视距应显著短于镜盐荒原');
      // 碎环月真空视距全场最长
      for (const id of EXPANSION_IDS) {
        if (id === 'fractured_moon') continue;
        assert(payloads.fractured_moon.fog.range[1] > payloads[id].fog.range[1],
          `[${id}] 视距不应超过真空碎环月`);
      }
      // 硅晶风暴风推修正 vs 碎环月低重力修正（movementMod 语义互异）
      assert(Number.isFinite(EXPANSION_GAMEPLAY.glassstorm_barrens.movementMod.windPush),
        '硅晶风暴应提供 windPush 移动修正');
      assertEq(Object.keys(EXPANSION_GAMEPLAY).length, 11, 'EXPANSION_GAMEPLAY 应覆盖 11 扩展主题');

      // ———— THEME-07 身份恒定：扩展色板本地表 = planetThemes 注册表（逐位） —————
      for (const id of EXPANSION_IDS) {
        const local = FLAGSHIP_PALETTES[id];
        assert(!!local, `[${id}] FLAGSHIP_PALETTES 缺少扩展色板兜底`);
        const reg = PLANET_THEMES[id].palette;
        for (const k of ['base', 'shadow', 'highlight', 'danger', 'emissive', 'atmosphere']) {
          assertEq(local[k], reg[k], `[${id}] 本地色板.${k} 与 planetThemes 注册表漂移`);
        }
      }

      return {
        ok: true,
        detail: `${EXPANSION_IDS.length} 扩展主题载荷/剖面/玩法规则全通过；两两互异 ${jsons.length * (jsons.length - 1) / 2} 对`,
      };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
