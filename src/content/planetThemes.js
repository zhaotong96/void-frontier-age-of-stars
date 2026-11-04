/**
 * content/planetThemes.js — 18 大行星主题注册表（doc6 §4.4/§10.1 / doc7 TASK-3.1）
 *
 * 主题是完整的世界身份而非颜色字段（doc6 §4.1）：每条目覆盖九维规范
 * （轮廓/地貌/材质/色板/光照/天气/地标/玩法/经济）。色板为 sRGB 十六进制
 * （doc6 §4.4 艺术指导起点），渲染前经 srgbToLinear 转线性空间。
 *
 * 红线（doc6 §4.3 / doc7 红线 4）：
 *  - assignTheme 只消费 derivePlanetSeeds(world, planetId).themeSeed 派生子流，
 *    绝不读写 world.rng、绝不 Math.random()（保 52/52 与金快照序列）。
 *  - 主题服从天体物理：categoryConstraints ∩ planet.category 为硬约束
 *    （例如海洋主题永远不会落在熔岩行星上）。
 *  - 同星系去重：galaxyGen 传入 per-system takenThemes Set，旗舰主题
 *    在仍有可用候选时绝不重复出现（doc7 THEME-06）。
 *
 * 类别口径：categoryConstraints 使用 galaxyGen.PLANET_CATEGORIES 的 8 个
 * 类别 id（rocky/ocean/ice/desert/gasGiant/lava/toxic/artificial）；
 * doc6 §4.4 表中的 "ice_moon" 规范化为 'ice'。
 */

import { seedFromNumber, float, int, chance } from '../core/rng.js';
import { derivePlanetSeeds } from '../domain/ground/planetSeeds.js';

/** 主题分配算法版本（进存档；语义变更必须递增） */
export const THEME_ASSIGNMENT_VERSION = 1;

/** sRGB hex(#rgb/#rrggbb) → 线性空间 [r,g,b] 浮点（pow 2.2 近似，doc7 §3.2/5）。
 *  解析失败回退中性灰；导出供测试与渲染侧共用。 */
export function srgbToLinear(hex) {
  let h = String(hex || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return [0.5, 0.5, 0.5];
  const c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return c.map((v) => Math.pow(v, 2.2));
}

/** 组装 paletteLinear（模块加载期一次性预计算，运行时零解析开销） */
function linearize(pal) {
  return {
    base: srgbToLinear(pal.base),
    shadow: srgbToLinear(pal.shadow),
    highlight: srgbToLinear(pal.highlight),
    danger: srgbToLinear(pal.danger),
    emissive: srgbToLinear(pal.emissive),
    atmosphere: srgbToLinear(pal.atmosphere),
  };
}

/* ========================= 18 主题注册表（doc6 §4.4 全表） ========================= */

export const PLANET_THEMES = {
  /* ———— 首批 P3 旗舰七主题（doc7 §4.1） ———— */

  abyssal_ocean: {
    id: 'abyssal_ocean',
    version: 1,
    labelZh: '碧渊海洋',
    tier: 'flagship',
    categoryConstraints: ['ocean', 'ice'],
    palette: {
      base: '#042A46', shadow: '#021522', highlight: '#5DEBDF',
      danger: '#E6A34A', emissive: '#B77BFF', atmosphere: '#087F95',
    },
    geomorphology: 'ocean_basin_reef_trench',
    materials: ['abyssal_sediment', 'reef_coral', 'basalt_cliff', 'glow_kelp', 'pearl_alloy'],
    atmosphereProfile: 'dense_blue_scattering',
    weatherProfile: 'tidal_storms',
    landmarkSet: ['reef_dome_ruin', 'tide_spire', 'biolume_kelp_arch'],
    poiPool: ['subsurface_ocean', 'bio_trace', 'crashed_ship'],
    gameplayProfile: 'underwater_pressure_expedition',
    buildingKit: 'abyssal_outpost',
    audioProfile: 'abyssal_deep_ocean',
    orbital: {
      bandColors: ['#087F95', '#042A46', '#5DEBDF'],
      iceCap: 0.25, cloudCover: 0.55, cloudColor: '#DFF4F2',
      nightLights: 0.30, ringChance: 0.0,
      glow: { tint: '#087F95', power: 0.95, shellScale: 1.06 },
    },
    hazardMechanism: '水深>8m 进入高压区持续消耗耐压护盾，潮汐窗口每 90 秒升降海平面控制通道开闭',
    economyHook: '产深海生物质、重氢与耐压材料科技',
  },

  permafrost_furnace: {
    id: 'permafrost_furnace',
    version: 1,
    labelZh: '永冬炉境',
    tier: 'flagship',
    categoryConstraints: ['ice'],
    palette: {
      base: '#EAF5FF', shadow: '#14293E', highlight: '#91BBD1',
      danger: '#466D8A', emissive: '#F2A85D', atmosphere: '#91BBD1',
    },
    geomorphology: 'glacial_basin_crevasse',
    materials: ['snow_ice_white', 'blue_ice_cliff', 'wet_frozen_soil', 'heated_steel'],
    atmosphereProfile: 'cold_clear_thin',
    weatherProfile: 'whiteout_blizzards',
    landmarkSet: ['central_furnace_tower', 'heated_span_bridge', 'buried_outpost'],
    poiPool: ['subsurface_ocean', 'deep_vein', 'lost_station'],
    gameplayProfile: 'heat_network_survival',
    buildingKit: 'thermal_hearth_hold',
    audioProfile: 'frostwind_hum_embers',
    orbital: {
      bandColors: ['#EAF5FF', '#91BBD1', '#466D8A'],
      iceCap: 0.85, cloudCover: 0.50, cloudColor: '#F2F7FB',
      nightLights: 0.35, ringChance: 0.0,
      glow: { tint: '#9FC4E8', power: 0.50, shellScale: 1.05 },
    },
    hazardMechanism: '离开热源覆盖圈体温槽下降并冻伤，Whiteout 暴风雪期间热源半径收缩 40%',
    economyHook: '产富水冰、冷冻基因样本与超导隔热合金科技',
  },

  red_regolith_frontier: {
    id: 'red_regolith_frontier',
    version: 1,
    labelZh: '赤砾边疆',
    tier: 'flagship',
    categoryConstraints: ['desert', 'rocky'],
    palette: {
      base: '#C66B3B', shadow: '#5A2E1C', highlight: '#D4A36A',
      danger: '#8B4F36', emissive: '#F0C78D', atmosphere: '#D4A36A',
    },
    geomorphology: 'mesa_canyon_crater_steppe',
    materials: ['red_regolith', 'sandstone_strata', 'sand_gold_scrub', 'iron_dust'],
    atmosphereProfile: 'thin_dust_haze',
    weatherProfile: 'red_dust_storms',
    landmarkSet: ['sandstone_arch', 'mesa_overlook_platform', 'deepwell_tower'],
    poiPool: ['crashed_ship', 'deep_vein', 'ancient_ruin'],
    gameplayProfile: 'frontier_mining_expansion',
    buildingKit: 'frontier_dome_yard',
    audioProfile: 'dry_gale_regolith',
    orbital: {
      bandColors: ['#C66B3B', '#8B4F36', '#D4A36A'],
      iceCap: 0.08, cloudCover: 0.12, cloudColor: '#E8C79A',
      nightLights: 0.05, ringChance: 0.0,
      glow: { tint: '#D8A15E', power: 0.38, shellScale: 1.05 },
    },
    hazardMechanism: '沙尘暴来袭能见度骤降、太阳能出力跌至 15%，户外人员机械受风沙磨损',
    economyHook: '产铁族金属、硅酸盐与基础工业产能',
  },

  dry_night_polar: {
    id: 'dry_night_polar',
    version: 1,
    labelZh: '永夜晶荒',
    tier: 'flagship',
    categoryConstraints: ['ice', 'rocky'],
    palette: {
      base: '#101421', shadow: '#070A12', highlight: '#D8DCE8',
      danger: '#77718F', emissive: '#BDA4FF', atmosphere: '#77718F',
    },
    geomorphology: 'dry_salt_polar',
    materials: ['dark_frozen_rock', 'moon_white_salt', 'grey_purple_strata', 'violet_beacon'],
    atmosphereProfile: 'airless_night_static',
    weatherProfile: 'meteor_nights',
    landmarkSet: ['salt_polygon_basin', 'radar_beacon_spire', 'aurora_intercept_laser'],
    poiPool: ['lost_station', 'crashed_ship', 'magnetic_anomaly'],
    gameplayProfile: 'dark_energy_storage_ops',
    buildingKit: 'polar_salt_vault',
    audioProfile: 'polar_silence_hum',
    orbital: {
      bandColors: ['#101421', '#77718F', '#D8DCE8'],
      iceCap: 0.15, cloudCover: 0.03, cloudColor: '#6A6E86',
      nightLights: 0.12, ringChance: 0.0,
      glow: { tint: '#BDA4FF', power: 0.75, shellScale: 1.05 },
    },
    hazardMechanism: '极夜无光热依赖储能设施，缺大气保护偶发高能陨石坠落需激光网拦截',
    economyHook: '产工业盐晶、稀有同位素与低温超导元件',
  },

  sulfur_marsh: {
    id: 'sulfur_marsh',
    version: 1,
    labelZh: '硫雾沼泽',
    tier: 'flagship',
    categoryConstraints: ['toxic'],
    palette: {
      base: '#1D341B', shadow: '#0B160A', highlight: '#B7D84C',
      danger: '#B7D84C', emissive: '#D9FF76', atmosphere: '#748F2B',
    },
    geomorphology: 'fumarole_acid_terraces',
    materials: ['charred_rock', 'sulfur_crust', 'acid_pool', 'altered_strata'],
    atmosphereProfile: 'acid_green_haze',
    weatherProfile: 'fumarole_gas_jets',
    landmarkSet: ['giant_fumarole_cone', 'acid_pipe_bridge', 'corroded_drill_rig'],
    poiPool: ['bio_trace', 'lost_station', 'magnetic_anomaly'],
    gameplayProfile: 'chemical_hazard_chemistry',
    buildingKit: 'acid_proof_stilt_base',
    audioProfile: 'marsh_bubble_hiss',
    orbital: {
      bandColors: ['#1D341B', '#748F2B', '#B7D84C'],
      iceCap: 0.0, cloudCover: 0.70, cloudColor: '#9BB83B',
      nightLights: 0.06, ringChance: 0.0,
      glow: { tint: '#8FAE33', power: 1.35, shellScale: 1.09 },
    },
    hazardMechanism: '低洼毒气湖持续腐蚀防护层与地基，浓沼气遇明火爆燃',
    economyHook: '产挥发性气体、硫化物与化工链产物',
  },

  biolume_canopy: {
    id: 'biolume_canopy',
    version: 1,
    labelZh: '星辉生物圈',
    tier: 'flagship',
    categoryConstraints: ['rocky', 'ocean'],
    palette: {
      base: '#082B3D', shadow: '#03141E', highlight: '#42D8C6',
      danger: '#A981FF', emissive: '#42D8C6', atmosphere: '#007E91',
    },
    geomorphology: 'biolume_rainforest',
    materials: ['deep_canopy_floor', 'wet_moss_cliff', 'glow_flora', 'biolume_vein'],
    atmosphereProfile: 'humid_blue_cyan',
    weatherProfile: 'biolume_rain_pulses',
    landmarkSet: ['magnetic_stone_arch', 'soul_willow_tree', 'glow_root_bridge'],
    poiPool: ['bio_trace', 'subsurface_ocean'],
    gameplayProfile: 'reactive_ecology_sampling',
    buildingKit: 'biolume_grove_camp',
    audioProfile: 'biolume_night_choir',
    orbital: {
      bandColors: ['#082B3D', '#007E91', '#42D8C6'],
      iceCap: 0.05, cloudCover: 0.45, cloudColor: '#A8D8E0',
      nightLights: 0.50, ringChance: 0.0,
      glow: { tint: '#3AA8B8', power: 0.70, shellScale: 1.06 },
    },
    hazardMechanism: '夜间荧光生态有掠食者语义，压感涟漪会暴露小队行踪',
    economyHook: '产再生生物质、神经纤维与医疗前体',
  },

  obsidian_lava: {
    id: 'obsidian_lava',
    version: 1,
    labelZh: '黑曜熔海',
    tier: 'flagship',
    categoryConstraints: ['lava'],
    palette: {
      base: '#160F14', shadow: '#0A0709', highlight: '#E54B24',
      danger: '#E54B24', emissive: '#FFAA3C', atmosphere: '#5B171D',
    },
    geomorphology: 'obsidian_ridge_lava',
    materials: ['obsidian_black', 'basalt_hex_strata', 'scoria_red', 'magma_glow'],
    atmosphereProfile: 'ash_ember_thin',
    weatherProfile: 'lava_eruption_cycles',
    landmarkSet: ['obsidian_arch_bridge', 'basalt_hex_pillars', 'lava_geothermal_siphon'],
    poiPool: ['deep_vein', 'magnetic_anomaly', 'ancient_ruin'],
    gameplayProfile: 'bridge_route_engineering',
    buildingKit: 'obsidian_basalt_forge',
    audioProfile: 'magma_rumble_crack',
    orbital: {
      bandColors: ['#160F14', '#5B171D', '#E54B24'],
      iceCap: 0.0, cloudCover: 0.08, cloudColor: '#3A2226',
      nightLights: 0.02, ringChance: 0.0,
      glow: { tint: '#E0561F', power: 0.55, shellScale: 1.05 },
    },
    hazardMechanism: '岩浆河谷热辐射防护，拱桥断裂需工程抢修才能通行',
    economyHook: '产重金属、稀土与耐热装甲',
  },

  /* ———— 扩展 P4 十一主题（doc7 §4.0 矩阵） ———— */

  prism_crystal: {
    id: 'prism_crystal',
    version: 1,
    labelZh: '棱镜晶原',
    tier: 'expansion',
    categoryConstraints: ['rocky', 'ice'],
    palette: {
      base: '#DCEFF7', shadow: '#5A7484', highlight: '#56CBE5',
      danger: '#9A83D8', emissive: '#FFB7EC', atmosphere: '#56CBE5',
    },
    geomorphology: 'generic_rocky',
    materials: ['crystal_quartz', 'prism_strata', 'refraction_sand', 'lattice_road'],
    atmosphereProfile: 'crystalline_cold_clear',
    weatherProfile: 'refraction_light_bands',
    landmarkSet: ['hex_crystal_spire', 'refraction_canyon', 'resonance_relay'],
    poiPool: ['magnetic_anomaly', 'deep_vein', 'ancient_ruin'],
    gameplayProfile: 'resonance_optics_ops',
    buildingKit: 'prism_lattice_works',
    audioProfile: 'crystal_ring_resonance',
    orbital: {
      bandColors: ['#DCEFF7', '#56CBE5', '#9A83D8'],
      iceCap: 0.30, cloudCover: 0.20, cloudColor: '#EAF6FB',
      nightLights: 0.15, ringChance: 0.15,
      glow: { tint: '#8FD8EC', power: 0.60, shellScale: 1.06 },
    },
    hazardMechanism: '晶体干扰无线电，折射光路需谐振校准导航',
    economyHook: '产量子水晶、光学晶体与高能激光组件',
  },

  salt_mirror_desert: {
    id: 'salt_mirror_desert',
    version: 1,
    labelZh: '镜盐荒原',
    tier: 'expansion',
    categoryConstraints: ['desert'],
    palette: {
      base: '#E8E1CD', shadow: '#8A8270', highlight: '#C7A8A2',
      danger: '#8B6C88', emissive: '#D9B86C', atmosphere: '#C7A8A2',
    },
    geomorphology: 'generic_desert',
    materials: ['salt_crust_white', 'pink_dust', 'mirror_brine', 'purple_rock'],
    atmosphereProfile: 'bright_mirror_haze',
    weatherProfile: 'salt_mirage_static',
    landmarkSet: ['mirror_salt_flat', 'brine_extraction_plant', 'lone_inselberg'],
    poiPool: ['ancient_ruin', 'crashed_ship', 'lost_station'],
    gameplayProfile: 'brine_solar_concentration',
    buildingKit: 'mirror_concentrator_array',
    audioProfile: 'mirror_flat_winds',
    orbital: {
      bandColors: ['#E8E1CD', '#C7A8A2', '#D9B86C'],
      iceCap: 0.05, cloudCover: 0.10, cloudColor: '#F2E9D8',
      nightLights: 0.04, ringChance: 0.0,
      glow: { tint: '#E0C9A0', power: 0.40, shellScale: 1.05 },
    },
    hazardMechanism: '强反光造成光学测距误差，卤水壳下暗藏塌陷水腔',
    economyHook: '产轻金属、高能蓄电池与聚光太阳能',
  },

  cryomethane_sea: {
    id: 'cryomethane_sea',
    version: 1,
    labelZh: '甲烷雾海',
    tier: 'expansion',
    categoryConstraints: ['ice', 'ocean'],
    palette: {
      base: '#082B32', shadow: '#031418', highlight: '#56C6C2',
      danger: '#B8E7E2', emissive: '#B8E7E2', atmosphere: '#167C87',
    },
    geomorphology: 'generic_ocean',
    materials: ['methane_ice_coast', 'dark_hydrocarbon_sea', 'frost_rock', 'fog_band'],
    atmosphereProfile: 'cryo_hydrocarbon_fog',
    weatherProfile: 'cryo_fog_drifts',
    landmarkSet: ['methane_floating_platform', 'ice_shelf_harbor', 'cryo_pipeline'],
    poiPool: ['subsurface_ocean', 'crashed_ship', 'lost_station'],
    gameplayProfile: 'cryo_hydrocarbon_ops',
    buildingKit: 'cryo_hull_dock',
    audioProfile: 'cryosea_fog_drone',
    orbital: {
      bandColors: ['#082B32', '#167C87', '#56C6C2'],
      iceCap: 0.45, cloudCover: 0.50, cloudColor: '#B8E7E2',
      nightLights: 0.05, ringChance: 0.0,
      glow: { tint: '#4FA8AC', power: 0.60, shellScale: 1.06 },
    },
    hazardMechanism: '薄冰承重随机断裂，低温使外骨骼与船体性能衰减',
    economyHook: '产液态甲烷燃料、重氢与推进剂',
  },

  tidal_lock_dusk: {
    id: 'tidal_lock_dusk',
    version: 1,
    labelZh: '晨昏环带',
    tier: 'expansion',
    categoryConstraints: ['rocky', 'lava', 'ice'],
    palette: {
      base: '#E2A05A', shadow: '#31445F', highlight: '#CDA978',
      danger: '#CDA06B', emissive: '#80BCD5', atmosphere: '#80BCD5',
    },
    geomorphology: 'generic_rocky',
    materials: ['scorched_regolith', 'twilight_sand', 'night_ice', 'melt_water'],
    atmosphereProfile: 'banded_twilight_gradient',
    weatherProfile: 'terminator_winds',
    landmarkSet: ['terminator_strip_city', 'dual_zone_powerline', 'dusk_farmland'],
    poiPool: ['ancient_ruin', 'deep_vein', 'subsurface_ocean'],
    gameplayProfile: 'dual_zone_thermal_logistics',
    buildingKit: 'dusk_belt_terminus',
    audioProfile: 'dusk_belt_breeze',
    orbital: {
      bandColors: ['#E2A05A', '#CDA978', '#31445F'],
      iceCap: 0.20, cloudCover: 0.35, cloudColor: '#D9C9A8',
      nightLights: 0.20, ringChance: 0.0,
      glow: { tint: '#C8A878', power: 0.55, shellScale: 1.06 },
    },
    hazardMechanism: '昼侧灼热夜侧深寒，跨温区输送必须沿暮光带布局',
    economyHook: '产温差热电与双极特殊矿物',
  },

  cloud_giant_atolls: {
    id: 'cloud_giant_atolls',
    version: 1,
    labelZh: '云海浮岛',
    tier: 'expansion',
    categoryConstraints: ['gasGiant'],
    palette: {
      base: '#E5A65A', shadow: '#6E4A2E', highlight: '#F2D6AA',
      danger: '#5D618F', emissive: '#C87E67', atmosphere: '#F2D6AA',
    },
    geomorphology: 'generic_gas_giant',
    materials: ['cloud_deck', 'storm_strata', 'atoll_hull', 'skyway'],
    atmosphereProfile: 'deep_storm_layers',
    weatherProfile: 'storm_wall_rotation',
    landmarkSet: ['floating_atoll_ring', 'sky_gondola', 'storm_probe_station'],
    poiPool: ['storm_vortex'],
    gameplayProfile: 'high_altitude_platform_ops',
    buildingKit: 'sky_atoll_mooring',
    audioProfile: 'storm_altitude_roar',
    orbital: {
      bandColors: ['#E5A65A', '#C87E67', '#F2D6AA'],
      iceCap: 0.0, cloudCover: 1.0, cloudColor: '#F2D6AA',
      nightLights: 0.03, ringChance: 0.55,
      glow: { tint: '#E0B070', power: 0.60, shellScale: 1.09 },
    },
    hazardMechanism: '严禁常规地表登陆，风暴墙周期性撕毁浮台锚链',
    economyHook: '独占高产氦-3 与氘采集',
  },

  fungal_catacombs: {
    id: 'fungal_catacombs',
    version: 1,
    labelZh: '菌海深渊',
    tier: 'expansion',
    categoryConstraints: ['toxic', 'rocky'],
    palette: {
      base: '#160F2C', shadow: '#0A0716', highlight: '#9B4DCA',
      danger: '#9B4DCA', emissive: '#5AD3A8', atmosphere: '#4B2A71',
    },
    geomorphology: 'generic_toxic',
    materials: ['cave_rock', 'fungal_mat', 'spore_glow', 'mycelium_net'],
    atmosphereProfile: 'spore_purple_haze',
    weatherProfile: 'spore_falls',
    landmarkSet: ['giant_cap_dome', 'spore_falls', 'mycelium_lift'],
    poiPool: ['bio_trace', 'subsurface_ocean', 'ancient_ruin'],
    gameplayProfile: 'spore_filter_caving',
    buildingKit: 'spore_sanctum',
    audioProfile: 'spore_cave_drip',
    orbital: {
      bandColors: ['#160F2C', '#4B2A71', '#9B4DCA'],
      iceCap: 0.0, cloudCover: 0.55, cloudColor: '#7A5CA0',
      nightLights: 0.35, ringChance: 0.0,
      glow: { tint: '#8A5CB8', power: 0.85, shellScale: 1.07 },
    },
    hazardMechanism: '孢子浓雾需过滤通风，巨菌盖崩落封闭通道',
    economyHook: '产特效药物、生物质与菌丝材料',
  },

  ancient_megastructure: {
    id: 'ancient_megastructure',
    version: 1,
    labelZh: '机械圣骸',
    tier: 'expansion',
    categoryConstraints: ['artificial'],
    palette: {
      base: '#161F29', shadow: '#0A0F14', highlight: '#6D7F8C',
      danger: '#6D7F8C', emissive: '#42C3D6', atmosphere: '#42C3D6',
    },
    geomorphology: 'generic_artificial',
    materials: ['hull_plate', 'oxidized_steel', 'energy_conduit', 'relay_alloy'],
    atmosphereProfile: 'controlled_venting',
    weatherProfile: 'dormant_vent_cycles',
    landmarkSet: ['sunken_hex_armor', 'energy_spine_ridge', 'collapsed_turbine_tower'],
    poiPool: ['ancient_ruin', 'magnetic_anomaly', 'lost_station'],
    gameplayProfile: 'ancient_grid_reactivation',
    buildingKit: 'relic_salvage_yard',
    audioProfile: 'machine_requiem_drone',
    orbital: {
      bandColors: ['#161F29', '#6D7F8C', '#42C3D6'],
      iceCap: 0.0, cloudCover: 0.02, cloudColor: '#3A4A56',
      nightLights: 0.60, ringChance: 0.35,
      glow: { tint: '#42C3D6', power: 0.45, shellScale: 1.05 },
    },
    hazardMechanism: '古代哨卫机甲与协议锁仍在线，能源脊短路电弧伤人',
    economyHook: '产远古数据、现成合金与奇异物质',
  },

  glassstorm_barrens: {
    id: 'glassstorm_barrens',
    version: 1,
    labelZh: '硅晶风暴',
    tier: 'expansion',
    categoryConstraints: ['desert', 'rocky'],
    palette: {
      base: '#33262E', shadow: '#15100F', highlight: '#9C735D',
      danger: '#E2BE93', emissive: '#F5E0BB', atmosphere: '#9C735D',
    },
    geomorphology: 'generic_desert',
    materials: ['vitrified_sand', 'silica_ridge', 'glass_dust', 'etched_rock'],
    atmosphereProfile: 'abrasive_silica_wind',
    weatherProfile: 'glassstorm_gales',
    landmarkSet: ['vitrified_dune_field', 'blade_silica_ridge', 'wind_shelter_bunker'],
    poiPool: ['crashed_ship', 'deep_vein', 'magnetic_anomaly'],
    gameplayProfile: 'abrasion_storm_tactics',
    buildingKit: 'glass_etched_bunker',
    audioProfile: 'glass_sand_barrage',
    orbital: {
      bandColors: ['#33262E', '#9C735D', '#E2BE93'],
      iceCap: 0.0, cloudCover: 0.25, cloudColor: '#D8C4A8',
      nightLights: 0.03, ringChance: 0.0,
      glow: { tint: '#C8A888', power: 0.42, shellScale: 1.05 },
    },
    hazardMechanism: '高速碎玻璃风暴磨蚀装备，顺风逆风移速差异显著',
    economyHook: '产高纯光学硅晶与装甲玻璃',
  },

  magnetar_aurora: {
    id: 'magnetar_aurora',
    version: 1,
    labelZh: '磁暴极光荒原',
    tier: 'expansion',
    categoryConstraints: ['rocky', 'artificial'],
    palette: {
      base: '#091729', shadow: '#040B16', highlight: '#1A3F69',
      danger: '#6A56C4', emissive: '#B9FFEB', atmosphere: '#6A56C4',
    },
    geomorphology: 'generic_rocky',
    materials: ['magnetite_hill', 'arc_crack', 'ionized_rock', 'shielded_road'],
    atmosphereProfile: 'magnetosphere_curtains',
    weatherProfile: 'periodic_magnetic_pulses',
    landmarkSet: ['spiral_magnetite_hill', 'lightning_shield_tower', 'arc_rift'],
    poiPool: ['magnetic_anomaly', 'lost_station', 'ancient_ruin'],
    gameplayProfile: 'pulse_window_operations',
    buildingKit: 'faraday_redoubt',
    audioProfile: 'aurora_pulse_whine',
    orbital: {
      bandColors: ['#091729', '#1A3F69', '#6A56C4'],
      iceCap: 0.12, cloudCover: 0.06, cloudColor: '#2A3A5A',
      nightLights: 0.10, ringChance: 0.0,
      glow: { tint: '#6A56C4', power: 0.90, shellScale: 1.06 },
    },
    hazardMechanism: '磁暴脉冲峰值期电子护盾与喷气背包静默，需依托屏蔽塔窗口行动',
    economyHook: '产超导体与磁性矿',
  },

  canopy_colossus: {
    id: 'canopy_colossus',
    version: 1,
    labelZh: '巨木云冠',
    tier: 'expansion',
    categoryConstraints: ['rocky'],
    palette: {
      base: '#123D32', shadow: '#081B16', highlight: '#2F8D69',
      danger: '#2F8D69', emissive: '#F4D979', atmosphere: '#2F8D69',
    },
    geomorphology: 'generic_rocky',
    materials: ['bark_armor', 'canopy_platform', 'root_valley', 'vine_bridge'],
    atmosphereProfile: 'wet_green_canopy',
    weatherProfile: 'canopy_updrafts',
    landmarkSet: ['colossal_canopy_deck', 'vine_suspension_bridge', 'canopy_elevator'],
    poiPool: ['bio_trace', 'subsurface_ocean', 'ancient_ruin'],
    gameplayProfile: 'vertical_canopy_logistics',
    buildingKit: 'canopy_arbor_station',
    audioProfile: 'canopy_leaf_swell',
    orbital: {
      bandColors: ['#123D32', '#2F8D69', '#A9C85B'],
      iceCap: 0.04, cloudCover: 0.40, cloudColor: '#C8E0C0',
      nightLights: 0.18, ringChance: 0.0,
      glow: { tint: '#4FA07A', power: 0.60, shellScale: 1.06 },
    },
    hazardMechanism: '林冠掠食者沿树冠巡逻，垂直落差坠落即死',
    economyHook: '产高强度生物木质复合材料',
  },

  fractured_moon: {
    id: 'fractured_moon',
    version: 1,
    labelZh: '碎环月',
    tier: 'expansion',
    categoryConstraints: ['rocky', 'ice'],
    palette: {
      base: '#39414B', shadow: '#181C22', highlight: '#8B7967',
      danger: '#D99A62', emissive: '#B6C4D9', atmosphere: '#8A98AC',
    },
    geomorphology: 'generic_rocky',
    materials: ['lunar_regolith', 'rubble_slope', 'fracture_ice', 'alloy_wreck'],
    atmosphereProfile: 'airless_vacuum',
    weatherProfile: 'micrometeor_showers',
    landmarkSet: ['great_rift_chasm', 'wreck_field', 'shattered_ring_overhead'],
    poiPool: ['crashed_ship', 'ancient_ruin', 'lost_station'],
    gameplayProfile: 'lowg_salvage_ops',
    buildingKit: 'wreck_orbit_yard',
    audioProfile: 'vacuum_bone_conduction',
    orbital: {
      bandColors: ['#39414B', '#8B7967', '#B6C4D9'],
      iceCap: 0.10, cloudCover: 0.0, cloudColor: '#888888',
      nightLights: 0.02, ringChance: 0.85,
      glow: { tint: '#8A98AC', power: 0.20, shellScale: 1.04 },
    },
    hazardMechanism: '0.25g 低重力跳跃过冲，真空中无声音警示只有骨传导',
    economyHook: '产合金、模块与氦-3',
  },
};

// 模块加载期预计算线性色板（paletteLinear 为派生字段，不进存档）
for (const id of Object.keys(PLANET_THEMES)) {
  const t = PLANET_THEMES[id];
  t.paletteLinear = linearize(t.palette);
}

/* ========================= 查表与分配（纯函数，只读 world.seed） ========================= */

/** 主题 id → 主题条目（未知 id 返回 null） */
export function getTheme(id) {
  return (id && PLANET_THEMES[id]) || null;
}

/** 类别 → 兼容主题条目数组（约束交集；确定性顺序 = 注册表键序） */
export function themesForCategory(cat) {
  const out = [];
  for (const id of Object.keys(PLANET_THEMES)) {
    if (PLANET_THEMES[id].categoryConstraints.indexOf(cat) >= 0) out.push(PLANET_THEMES[id]);
  }
  return out;
}

/**
 * 主题-天体物理相容守卫（doc6 §4.3：主题服从基础天体参数）。
 * categoryConstraints 是第一道硬约束；此处追加物理参数级守卫。
 * 全部为「否决式」检查——守卫永不至于清空候选池（每类别至少一个无守卫主题）。
 */
function themePhysicsOk(theme, planet) {
  const water = Number(planet.water) || 0;
  const hab = Number(planet.habitability) || 0;
  if ((theme.id === 'abyssal_ocean' || theme.id === 'cryomethane_sea') && water < 30) return false;
  if ((theme.id === 'biolume_canopy' || theme.id === 'canopy_colossus') && hab < 15) return false;
  return true;
}

/**
 * 次级修饰器池（doc6 §4.6 配对示例：永夜+晶柱、海洋+硫喷口、荒原+远古巨构等）。
 * id 与主题 id 同名者（prism_crystal/ancient_megastructure/magnetar_aurora）
 * 表示该主题以次级身份叠加；其余为独立地貌修饰。
 */
export const SECONDARY_MODIFIERS = [
  { id: 'sulfur_vents', labelZh: '硫化喷口', categories: ['ocean', 'toxic', 'rocky'] },
  { id: 'ancient_megastructure', labelZh: '远古巨构残骸', categories: ['rocky', 'desert', 'ice', 'artificial'] },
  { id: 'prism_crystal', labelZh: '折射晶柱群', categories: ['ice', 'rocky'] },
  { id: 'glassstorm', labelZh: '硅玻璃风暴带', categories: ['desert', 'rocky'] },
  { id: 'magnetar_aurora', labelZh: '磁暴极光幕', categories: ['rocky', 'ice', 'ocean', 'artificial'] },
];

/** 旗舰权重 / 扩展权重（doc6 §4.3 生成权重） */
const TIER_WEIGHT = { flagship: 3.0, expansion: 1.0 };

/**
 * 为行星确定性地抽取主主题 + 0-2 个次级修饰器。
 *
 * 确定性契约（doc7 红线 4 / SITE-06）：
 *  - 只消费 derivePlanetSeeds(world, planet.id).themeSeed → seedFromNumber 子流；
 *    绝不读写 world.rng（主 RNG 消费顺序不受影响）。
 *  - 纯函数 of (world.seed, planet 字段, star.danger, takenThemes)。
 *
 * 同星系去重（doc7 THEME-06）：takenThemes 为 galaxyGen 维护的 per-system
 * Set；已抽中的旗舰主题在「仍存在其他候选」时被整体移出候选池。
 *
 * @param {{seed:number}} world 世界实体（只读 world.seed）
 * @param {{id:string|number, category:string, water?:number, habitability?:number}} planet 行星档案
 * @param {{danger?:number}|null} [star] 恒星档案（高危险恒星微幅加权磁暴主题）
 * @param {Set<string>} [takenThemes] 本星系已分配主题 id（可省略）
 * @returns {{primaryThemeId:string, secondaryThemeModifiers:string[]}}
 */
export function assignTheme(world, planet, star, takenThemes) {
  const seeds = derivePlanetSeeds(world, planet.id);
  const sub = seedFromNumber(seeds.themeSeed);
  const cat = String((planet && planet.category) || 'rocky');

  // 1) 类别约束交集（硬约束）
  let pool = themesForCategory(cat);
  if (pool.length === 0) pool = [PLANET_THEMES.red_regolith_frontier]; // 兜底（8 类均有覆盖，实际不可达）

  // 2) 物理守卫否决；全灭则回退未守卫池
  const guarded = pool.filter((t) => themePhysicsOk(t, planet));
  if (guarded.length > 0) pool = guarded;

  // 3) 同星系旗舰去重：已被抽中的旗舰主题让位（仅当仍有替代候选）
  if (takenThemes && takenThemes.size > 0 && pool.length > 1) {
    const alt = pool.filter((t) => !(t.tier === 'flagship' && takenThemes.has(t.id)));
    if (alt.length > 0) pool = alt;
  }

  // 4) 加权抽选：旗舰 ×3；高危险恒星（danger≥5）磁暴主题 ×2 微偏置
  const danger = star && Number.isFinite(star.danger) ? star.danger : 0;
  let total = 0;
  const weights = pool.map((t) => {
    let w = TIER_WEIGHT[t.tier] || 1.0;
    if (t.id === 'magnetar_aurora' && danger >= 5) w += TIER_WEIGHT.flagship;
    total += w;
    return w;
  });
  let r = float(sub) * total;
  let primary = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) { primary = pool[i]; break; }
  }

  // 5) 次级修饰器 0-2 个（与主主题去重；类别相容者中确定性抽选）
  const modifiers = [];
  const compatibleMods = SECONDARY_MODIFIERS.filter(
    (m) => m.categories.indexOf(cat) >= 0 && m.id !== primary.id
  );
  if (compatibleMods.length > 0 && chance(sub, 0.34)) {
    modifiers.push(compatibleMods[int(sub, compatibleMods.length)].id);
    if (chance(sub, 0.42)) {
      const rest = compatibleMods.filter((m) => m.id !== modifiers[0]);
      if (rest.length > 0) modifiers.push(rest[int(sub, rest.length)].id);
    }
  }

  return { primaryThemeId: primary.id, secondaryThemeModifiers: modifiers };
}
