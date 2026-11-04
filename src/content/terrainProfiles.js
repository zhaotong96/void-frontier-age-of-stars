/**
 * content/terrainProfiles.js — 行星地貌剖面注册表（doc7 TASK-1.1，纯数据）
 *
 * 每个剖面描述一种「宏观地貌场」的参数组合（序列 6 §2.4 / doc7 §4.1），
 * 由 src/domain/ground/terrainField.js 的宏观场采样器消费：
 *
 *  - base/amp/ridge        大陆 fBm 基准高度(m) / 振幅(m) / 山脊权重(0..1)
 *  - terrace?              阶地量化步长(m)；缺省 = 无阶地
 *  - seaLevel?             海平面高程(m)；null = 无流体表面
 *  - basinDepth?           低频盆地下切深度(m)
 *  - trench?               断层线/裂谷/海沟/峡谷掩码 { depth:m, width:0..0.2 }
 *  - crater?               陨石坑群 { count, radius:m, depth:m }（子种子散布）
 *  - mesa?                 平顶桌山/盐坪平台化 { fraction:0..1, step:m }
 *  - dune?                 风蚀沙波纹 { amp:m, wavelength:m, angle:rad }
 *  - channel?              熔岩河/河道谷掩码 { level:m, width:0..0.3 }
 *  - shelf?                浅海台地抬升 { level:m, threshold:-1..1 }
 *  - glowVeins?            生物荧光脉络强度(0..1)，写入材质通道 3
 *  - hazardLevel?          lowland_gas 危险规则的海拔阈值(m)
 *  - materialPalette       4 通道语义材质 id：0=地表/基底 1=崖壁/层理 2=生态/强调 3=道路/生物荧光
 *  - biomeIds              生态/地质分区 id（顶点 biomeId 存其下标）
 *  - hazardRule            危险标记规则：none|below_sea|crevasse|lowland_gas|lava_channel
 *  - flagsRule             附加语义标记规则（Phase 1 为 none；道路/桥面由 Wave C SDF 写入）
 *
 * 零逻辑、零副作用；仅 profileForPlanet 提供只读查表。
 */

export const TERRAIN_PROFILES = {
  /** 赤砾边疆（desert/rocky）：60% 干涸河床盆地 + 40% 平顶砂岩桌山、环形陨坑、风蚀沙波纹 */
  mesa_canyon_crater_steppe: {
    id: 'mesa_canyon_crater_steppe',
    label: '平顶峡谷陨坑草原',
    base: 8, amp: 14, ridge: 0.35,
    seaLevel: null,
    basinDepth: 4,
    trench: { depth: 14, width: 0.045 },   // 风蚀峡谷（断层掩码）
    crater: { count: 7, radius: 26, depth: 7 },
    mesa: { fraction: 0.40, step: 3 },     // 40% 面积顶平壁陡桌山
    dune: { amp: 0.8, wavelength: 18, angle: 0.6 },
    materialPalette: ['red_regolith', 'sandstone_strata', 'sand_gold_scrub', 'dust_road'],
    biomeIds: ['red_regolith_flats', 'mesa_strata', 'crater_basin', 'dune_field'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  /** 碧渊海洋（ocean）：海平面 -4m，浅海环礁台地、中层沙脊平原、-32m 深渊海沟 */
  ocean_basin_reef_trench: {
    id: 'ocean_basin_reef_trench',
    label: '海盆礁脊海沟',
    base: -12, amp: 9, ridge: 0.15,
    seaLevel: -4,
    basinDepth: 8,
    shelf: { level: 1.0, threshold: 0.18 }, // 浅海台地抬升至约 +1..+6m
    trench: { depth: 20, width: 0.05 },     // 沿断层骤降 → 约 -32m 深渊海沟
    terrace: 4,                              // 珊瑚礁阶地
    dune: { amp: 0.5, wavelength: 14, angle: 2.1 }, // 海底沙脊
    materialPalette: ['abyssal_sediment', 'basalt_cliff', 'reef_coral', 'glow_kelp_road'],
    biomeIds: ['shelf_reef', 'mid_plain', 'trench_dark', 'kelp_grove'],
    hazardRule: 'below_sea',                // 海平面以下 = 高压区
    flagsRule: 'none',
  },

  /** 永冬炉境（ice）：四周冰崖环抱的避风冰川盆地，外围 -25m 深冰裂隙 */
  glacial_basin_crevasse: {
    id: 'glacial_basin_crevasse',
    label: '冰川盆地裂隙',
    base: 6, amp: 12, ridge: 0.55,
    seaLevel: null,
    basinDepth: 16,
    trench: { depth: 25, width: 0.04 },     // 深冰蓝裂隙（仅可经加热钢桥通行）
    materialPalette: ['snow_ice_white', 'blue_ice_cliff', 'wet_frozen_soil', 'heated_road'],
    biomeIds: ['ice_basin', 'blue_cliff', 'crevasse_field', 'snow_drift'],
    hazardRule: 'crevasse',
    flagsRule: 'none',
  },

  /** 永夜晶荒（ice/rocky）：干燥黑岩冻原 + 月白盐晶盆地，严禁积雪冰川化 */
  dry_salt_polar: {
    id: 'dry_salt_polar',
    label: '干盐极夜荒原',
    base: 4, amp: 9, ridge: 0.30,
    seaLevel: null,
    basinDepth: 10,
    trench: { depth: 10, width: 0.035 },    // 断层脊线
    mesa: { fraction: 0.28, step: 2 },      // 盐晶壳平坦盆地
    glowVeins: 0.35,                         // 紫晶簇冷冽荧光
    materialPalette: ['dark_frozen_rock', 'grey_purple_strata', 'moon_white_salt', 'violet_beacon'],
    biomeIds: ['dark_tundra', 'fault_ridge', 'salt_basin', 'crystal_field'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  /** 硫雾沼泽（toxic）：焦黑岩柱平台 + 环状酸液阶地池，海拔 <4.5m 洼地为毒气湖 */
  fumarole_acid_terraces: {
    id: 'fumarole_acid_terraces',
    label: '喷气孔酸液阶地',
    base: 5, amp: 10, ridge: 0.40,
    seaLevel: null,
    basinDepth: 6,
    terrace: 2.5,                            // 环状酸液阶地
    trench: { depth: 8, width: 0.05 },
    hazardLevel: 4.5,
    materialPalette: ['charred_rock', 'altered_strata', 'sulfur_crust', 'acid_glow'],
    biomeIds: ['black_platform', 'acid_terraces', 'fumarole_cone', 'gas_basin'],
    hazardRule: 'lowland_gas',
    flagsRule: 'none',
  },

  /** 星辉生物圈（rocky/ocean）：潘多拉林冠湿地，生物荧光脉络即地形灯光 */
  biolume_rainforest: {
    id: 'biolume_rainforest',
    label: '星辉雨林',
    base: 7, amp: 13, ridge: 0.45,
    seaLevel: null,
    basinDepth: 8,
    trench: { depth: 12, width: 0.04 },     // 溪谷
    crater: { count: 3, radius: 18, depth: 4 }, // 坍陷洼池
    glowVeins: 1.0,
    materialPalette: ['deep_canopy_floor', 'wet_moss_cliff', 'glow_flora', 'biolume_vein'],
    biomeIds: ['moss_floor', 'root_cliff', 'spore_grove', 'glow_vein_net'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  /** 黑曜熔海（lava）：80% 熔岩黑山脊（高差约 +28m），谷底 -4m 岩浆河 */
  obsidian_ridge_lava: {
    id: 'obsidian_ridge_lava',
    label: '黑曜山脊熔海',
    base: 8, amp: 16, ridge: 0.85,
    seaLevel: null,
    basinDepth: 4,
    channel: { level: -4, width: 0.10 },    // 低频谷掩码 → 蜿蜒岩浆大河
    materialPalette: ['obsidian_black', 'basalt_hex_strata', 'scoria_red', 'obsidian_bridge'],
    biomeIds: ['obsidian_ridge', 'hex_pillar_cliff', 'lava_bank', 'bridge_deck'],
    hazardRule: 'lava_channel',
    flagsRule: 'none',
  },

  // ———— 通用兜底剖面（按 planet.category 回退） ————

  generic_rocky: {
    id: 'generic_rocky',
    label: '通用岩质高地',
    base: 8, amp: 12, ridge: 0.45,
    seaLevel: null,
    basinDepth: 6,
    crater: { count: 5, radius: 20, depth: 5 },
    materialPalette: ['regolith_ground', 'rock_strata', 'lichen_accent', 'gravel_road'],
    biomeIds: ['rock_flats', 'rock_cliff', 'boulder_field', 'dust_road'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  generic_ocean: {
    id: 'generic_ocean',
    label: '通用海洋盆地',
    base: -10, amp: 8, ridge: 0.15,
    seaLevel: -4,
    basinDepth: 6,
    shelf: { level: 0, threshold: 0.20 },
    trench: { depth: 18, width: 0.05 },
    materialPalette: ['ocean_sediment', 'sea_cliff', 'kelp_accent', 'causeway_road'],
    biomeIds: ['shallow_water', 'open_water', 'deep_floor', 'causeway'],
    hazardRule: 'below_sea',
    flagsRule: 'none',
  },

  generic_ice: {
    id: 'generic_ice',
    label: '通用冰封荒原',
    base: 6, amp: 11, ridge: 0.60,
    seaLevel: null,
    basinDepth: 10,
    trench: { depth: 18, width: 0.04 },
    materialPalette: ['packed_snow', 'glacier_blue_cliff', 'frost_lichen', 'icy_road'],
    biomeIds: ['snowfield', 'glacier_cliff', 'ice_field', 'frozen_road'],
    hazardRule: 'crevasse',
    flagsRule: 'none',
  },

  generic_desert: {
    id: 'generic_desert',
    label: '通用沙漠',
    base: 7, amp: 9, ridge: 0.25,
    seaLevel: null,
    basinDepth: 4,
    mesa: { fraction: 0.25, step: 3 },
    dune: { amp: 1.2, wavelength: 16, angle: 0.9 },
    crater: { count: 4, radius: 18, depth: 5 },
    materialPalette: ['dry_sand', 'sandstone_cliff', 'scrub_accent', 'caravan_road'],
    biomeIds: ['sand_flats', 'dune_belt', 'rocky_outcrop', 'caravan_road'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  generic_lava: {
    id: 'generic_lava',
    label: '通用熔岩高地',
    base: 7, amp: 14, ridge: 0.70,
    seaLevel: null,
    basinDepth: 4,
    channel: { level: -2, width: 0.09 },
    materialPalette: ['basalt_black', 'volcanic_strata', 'cinder_red', 'heat_shield_road'],
    biomeIds: ['basalt_flats', 'ridge_cliff', 'cinder_field', 'shielded_road'],
    hazardRule: 'lava_channel',
    flagsRule: 'none',
  },

  generic_toxic: {
    id: 'generic_toxic',
    label: '通用腐蚀大气洼地',
    base: 5, amp: 9, ridge: 0.35,
    seaLevel: null,
    basinDepth: 7,
    terrace: 3,
    hazardLevel: 3,
    materialPalette: ['corroded_soil', 'etched_cliff', 'acid_bloom', 'corrosion_road'],
    biomeIds: ['etched_flats', 'corroded_cliff', 'acid_pool', 'treated_road'],
    hazardRule: 'lowland_gas',
    flagsRule: 'none',
  },

  generic_artificial: {
    id: 'generic_artificial',
    label: '人工改造天体',
    base: 9, amp: 3, ridge: 0.08,
    seaLevel: null,
    mesa: { fraction: 0.50, step: 2 },      // 大面积整平平台
    trench: { depth: 4, width: 0.05 },      // 电路沟壑
    materialPalette: ['regolith_pad', 'hull_steel_strata', 'signal_accent', 'transit_road'],
    biomeIds: ['landing_pad', 'bulkhead_cliff', 'relay_yard', 'transit_way'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  generic_gas_giant: {
    id: 'generic_gas_giant',
    label: '气态巨行星浮台',
    base: 10, amp: 4, ridge: 0.10,
    seaLevel: null,
    mesa: { fraction: 0.60, step: 2 },      // 反重力环状岛链 ≈ 大面积浮空平台
    dune: { amp: 0.6, wavelength: 24, angle: 1.8 }, // 云瀑波纹
    materialPalette: ['cloud_deck', 'storm_strata', 'atoll_accent', 'skyway_road'],
    biomeIds: ['floating_atoll', 'storm_wall', 'cloud_garden', 'skyway'],
    hazardRule: 'none',
    flagsRule: 'none',
  },
};

/** 主题 id → 剖面 id（doc7 §4.1 首批 7 大旗舰主题） */
export const THEME_PROFILE_MAP = {
  abyssal_ocean: 'ocean_basin_reef_trench',
  permafrost_furnace: 'glacial_basin_crevasse',
  red_regolith_frontier: 'mesa_canyon_crater_steppe',
  dry_night_polar: 'dry_salt_polar',
  sulfur_marsh: 'fumarole_acid_terraces',
  biolume_canopy: 'biolume_rainforest',
  obsidian_lava: 'obsidian_ridge_lava',
};

/** planet.category → 兜底剖面 id（8 大行星类别，与 galaxyGen PLANET_CATEGORIES 对齐） */
export const CATEGORY_PROFILE_MAP = {
  rocky: 'generic_rocky',
  ocean: 'generic_ocean',
  ice: 'generic_ice',
  desert: 'generic_desert',
  lava: 'generic_lava',
  toxic: 'generic_toxic',
  artificial: 'generic_artificial',
  gasGiant: 'generic_gas_giant',
};

/**
 * 行星 → 地貌剖面查表：显式 themeId 优先，其次 planet.primaryThemeId，
 * 再次 planet.category 兜底，最终恒定回退 generic_rocky（绝不返回 undefined）。
 * @param {{category?:string, primaryThemeId?:string}|null} planet 行星实体（可为 null）
 * @param {string|null} [themeId] 显式主题 id（优先于行星档案）
 * @returns {object} TERRAIN_PROFILES 成员
 */
export function profileForPlanet(planet, themeId) {
  const tid = themeId || (planet && planet.primaryThemeId) || null;
  if (tid && THEME_PROFILE_MAP[tid]) {
    const themed = TERRAIN_PROFILES[THEME_PROFILE_MAP[tid]];
    if (themed) return themed;
  }
  const cat = planet && planet.category;
  if (cat && CATEGORY_PROFILE_MAP[cat]) {
    const byCat = TERRAIN_PROFILES[CATEGORY_PROFILE_MAP[cat]];
    if (byCat) return byCat;
  }
  return TERRAIN_PROFILES.generic_rocky;
}
