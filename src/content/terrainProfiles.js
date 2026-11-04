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

  // ———— 扩展 P4 主题剖面（doc7 §4.0 矩阵 / doc6 §4.5.8-4.5.18，TASK-4.1/4.2） ————

  /** 棱镜晶原（rocky/ice）：六棱水晶山峰、几何折射峡谷、彩虹色散光带 */
  crystal_spire_fields: {
    id: 'crystal_spire_fields',
    label: '棱镜晶尖原野',
    base: 8, amp: 18, ridge: 0.75,
    seaLevel: null,
    basinDepth: 4,
    trench: { depth: 16, width: 0.05 },     // 折射光带峡谷
    glowVeins: 0.25,                         // 色散光斑（材质通道 3 微光）
    materialPalette: ['prism_quartz_ground', 'crystal_spire_strata', 'refraction_bloom', 'lattice_relay_road'],
    biomeIds: ['quartz_flats', 'spire_forest', 'refraction_canyon', 'dispersion_band'],
    hazardRule: 'none',
    flagsRule: 'none',
  },

  /** 镜盐荒原（desert）：乌尤尼式镜面盐壳、浅粉尘丘、孤立灰紫岩山，卤水腔塌陷危险 */
  salt_mirror_flats: {
    id: 'salt_mirror_flats',
    label: '镜面盐坪',
    base: 5, amp: 4, ridge: 0.08,            // 极平坦：天地镜像低频反射
    seaLevel: null,
    basinDepth: 2,
    mesa: { fraction: 0.10, step: 6 },       // 孤立灰紫岛山（inselberg 平台化）
    dune: { amp: 0.5, wavelength: 22, angle: 0.3 }, // 浅粉尘丘
    materialPalette: ['salt_crust_white', 'purple_rock_strata', 'pink_dust_scrub', 'brine_pipe_road'],
    biomeIds: ['mirror_salt_flat', 'inselberg_cliff', 'pink_dust_belt', 'brine_well'],
    hazardRule: 'crevasse',                  // 盐壳下卤水暗腔塌陷
    flagsRule: 'none',
  },

  /** 甲烷雾海（ice/ocean）：-6m 粘稠暗青液态甲烷海、蓝绿水冰海岸、浮冰航道 */
  methane_shelf_ice: {
    id: 'methane_shelf_ice',
    label: '甲烷冰架海岸',
    base: -12, amp: 7, ridge: 0.12,
    seaLevel: -6,                            // 与 themePayload THEME_RENDER waterLevel 一致
    basinDepth: 6,
    shelf: { level: 0.5, threshold: 0.16 },  // 蓝绿水冰海岸台地
    trench: { depth: 14, width: 0.045 },     // 浮冰航道（冰间水路）
    terrace: 3,                              // 冰岸阶地
    dune: { amp: 0.4, wavelength: 12, angle: 2.6 }, // 海底冰脊
    materialPalette: ['methane_ice_coast', 'frost_rock_strata', 'dark_hydrocarbon_sea', 'cryo_pipeline'],
    biomeIds: ['ice_shelf', 'frost_coast', 'methane_deep', 'lead_channel'],
    hazardRule: 'below_sea',                 // 海平面以下 = 低温烃海承压区
    flagsRule: 'none',
  },

  /** 晨昏环带（rocky/lava/ice）：狭长暮光带沿 X 轴温度梯度（昼侧灼金/夜侧蓝黑），
   *  断层裂谷带 + 融水河道；跨温区输能走廊沿裂谷两侧布局 */
  terminator_rift_band: {
    id: 'terminator_rift_band',
    label: '晨昏裂谷带',
    base: 7, amp: 13, ridge: 0.50,
    seaLevel: null,
    basinDepth: 6,
    trench: { depth: 18, width: 0.06 },      // 暮光带中央断层裂谷
    channel: { level: -1, width: 0.07 },     // 融水溪谷（夜侧冰缘融水）
    materialPalette: ['scorched_gold_regolith', 'twilight_strata', 'night_blue_ice', 'melt_road'],
    biomeIds: ['day_scorch_flats', 'terminator_band', 'night_frost_field', 'melt_valley'],
    hazardRule: 'none',                      // 温区危险由 EXPANSION_GAMEPLAY.hazardNote 承载
    flagsRule: 'none',
  },

  /** 菌海深渊（toxic/rocky）：双层结构 — 巨型菌盖穹顶层 + 幽暗低谷，发光菌丝网；
   *  双层地图高度意图：25m 菌盖穹顶层由 mesa 台地化表达，低谷为地下湖/孢子浓雾区 */
  fungal_dome_underscape: {
    id: 'fungal_dome_underscape',
    label: '菌盖穹顶地底',
    base: 4, amp: 10, ridge: 0.45,
    seaLevel: null,
    basinDepth: 12,                          // 幽暗低谷
    trench: { depth: 10, width: 0.06 },      // 菌盖间沟壑（地下湖谷）
    mesa: { fraction: 0.30, step: 8 },       // 巨型伞菌盖穹顶层（第二层平台面）
    glowVeins: 0.7,                          // 发光菌丝网
    hazardLevel: 3.5,                        // 低洼孢子浓雾区
    materialPalette: ['cave_underrock', 'fungal_cap_strata', 'spore_glow_mat', 'mycelium_road'],
    biomeIds: ['underscape_floor', 'dome_cap_tiers', 'spore_lake_basin', 'mycelium_grove'],
    hazardRule: 'lowland_gas',
    flagsRule: 'none',
  },

  /** 机械圣骸（artificial）：断裂沉降六角金属装甲板、输能脊、电路沟壑、不对称坍塌塔 */
  fractured_hex_plates: {
    id: 'fractured_hex_plates',
    label: '断裂六角装甲板',
    base: 9, amp: 5, ridge: 0.10,            // 大体平整但局部重力沉降错位
    seaLevel: null,
    mesa: { fraction: 0.55, step: 4 },       // 沉降装甲板平台面（高度错位）
    trench: { depth: 7, width: 0.05 },       // 电路沟壑
    crater: { count: 3, radius: 16, depth: 6 }, // 坍塌沉降坑
    glowVeins: 0.45,                         // 能量青输能脊微光
    materialPalette: ['hull_plate_dark', 'oxidized_steel_strata', 'energy_conduit_glow', 'conduit_road'],
    biomeIds: ['hex_plate_deck', 'sunken_plate_cliff', 'circuit_trench', 'energy_spine'],
    hazardRule: 'none',                      // 哨卫/电弧危险由 EXPANSION_GAMEPLAY 承载
    flagsRule: 'none',
  },

  /** 硅晶风暴（desert/rocky）：半透明熔融玻璃化沙丘、刀刃状硅质山脊（风蚀取向固定） */
  glass_dune_blades: {
    id: 'glass_dune_blades',
    label: '玻璃沙丘刃脊',
    base: 6, amp: 12, ridge: 0.70,
    seaLevel: null,
    basinDepth: 3,
    dune: { amp: 1.6, wavelength: 13, angle: 1.15 }, // 玻璃沙波纹（主导风向取向）
    trench: { depth: 9, width: 0.035 },      // 风蚀槽
    materialPalette: ['vitrified_sand_ground', 'silica_blade_strata', 'glass_glint_scrub', 'shelter_road'],
    biomeIds: ['glass_dune_field', 'blade_ridge_cliff', 'abrasion_flats', 'wind_shadow_basin'],
    hazardRule: 'none',                      // 风暴磨蚀/能见度由 EXPANSION_GAMEPLAY 承载
    flagsRule: 'none',
  },

  /** 磁暴极光荒原（rocky/artificial）：沿磁力线倾斜的螺旋磁铁矿丘、电弧地裂、极夜蓝黑 */
  magnetic_spire_tundra: {
    id: 'magnetic_spire_tundra',
    label: '磁螺尖丘苔原',
    base: 5, amp: 11, ridge: 0.60,
    seaLevel: null,
    basinDepth: 8,
    trench: { depth: 12, width: 0.04 },      // 电弧地裂（避雷屏蔽塔窗口路径）
    glowVeins: 0.5,                          // 磁暴青白电离微光
    materialPalette: ['magnetite_tundra', 'ionized_strata', 'aurora_glint_mat', 'shielded_conduit_road'],
    biomeIds: ['magnetite_mound', 'spire_cliff', 'arc_rift_floor', 'shielded_plaza'],
    hazardRule: 'crevasse',                  // 电弧裂隙危险
    flagsRule: 'none',
  },

  /** 巨木云冠（rocky）：底层幽暗根谷 + 树冠第二层（双层地图高度意图：百米巨木平展
   *  树冠为空中大陆，当前以高台/支柱根台地表达垂直落差，藤蔓桥由 Wave C SDF 写入） */
  giant_root_valleys: {
    id: 'giant_root_valleys',
    label: '巨木根谷',
    base: 6, amp: 14, ridge: 0.50,
    seaLevel: null,
    basinDepth: 14,                          // 幽暗根谷
    trench: { depth: 16, width: 0.055 },     // 根系峡谷
    mesa: { fraction: 0.18, step: 10 },      // 支柱根高台（树冠层落地锚点）
    crater: { count: 3, radius: 14, depth: 3 }, // 树桩坍陷洼地
    glowVeins: 0.25,                         // 孢子金微光
    materialPalette: ['root_valley_floor', 'bark_armor_strata', 'canopy_moss_glow', 'vine_bridge_road'],
    biomeIds: ['root_valley', 'buttress_cliff', 'canopy_grove', 'vine_way'],
    hazardRule: 'none',                      // 坠落/掠食者危险由 EXPANSION_GAMEPLAY 承载
    flagsRule: 'none',
  },

  /** 碎环月（rocky/ice）：0.25g 无大气断裂大峡谷、陨石坑群、坠毁舰船残骸场 */
  lowg_rift_field: {
    id: 'lowg_rift_field',
    label: '低重力裂谷场',
    base: 4, amp: 15, ridge: 0.55,
    seaLevel: null,
    basinDepth: 8,
    trench: { depth: 30, width: 0.08 },      // 巨大断裂峡谷（低重力喷气飞跃）
    crater: { count: 9, radius: 22, depth: 8 }, // 陨石坑采矿场
    materialPalette: ['lunar_regolith_ground', 'fracture_strata', 'wreck_alloy_glint', 'salvage_road'],
    biomeIds: ['regolith_flats', 'rift_wall_cliff', 'crater_basin', 'wreck_field'],
    hazardRule: 'crevasse',                  // 真空裂谷：坠落无声音警示
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

/** 主题 id → 剖面 id（doc7 §4.1 首批 7 大旗舰 + §4.0 扩展 11 主题） */
export const THEME_PROFILE_MAP = {
  abyssal_ocean: 'ocean_basin_reef_trench',
  permafrost_furnace: 'glacial_basin_crevasse',
  red_regolith_frontier: 'mesa_canyon_crater_steppe',
  dry_night_polar: 'dry_salt_polar',
  sulfur_marsh: 'fumarole_acid_terraces',
  biolume_canopy: 'biolume_rainforest',
  obsidian_lava: 'obsidian_ridge_lava',
  // —— 扩展 P4（TASK-4.1/4.2；云海浮岛无硬质地貌 → 复用气巨浮台剖面） ——
  prism_crystal: 'crystal_spire_fields',
  salt_mirror_desert: 'salt_mirror_flats',
  cryomethane_sea: 'methane_shelf_ice',
  tidal_lock_dusk: 'terminator_rift_band',
  cloud_giant_atolls: 'generic_gas_giant',
  fungal_catacombs: 'fungal_dome_underscape',
  ancient_megastructure: 'fractured_hex_plates',
  glassstorm_barrens: 'glass_dune_blades',
  magnetar_aurora: 'magnetic_spire_tundra',
  canopy_colossus: 'giant_root_valleys',
  fractured_moon: 'lowg_rift_field',
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
