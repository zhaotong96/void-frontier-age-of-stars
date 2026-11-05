/**
 * content/missionSites.js — MissionSiteBlueprint 登陆点蓝图注册表（doc7 TASK-2.1，纯数据）
 *
 * 数据契约（序列 6 §5.4 / doc7 §5）：
 *  - siteRadius 默认 160m；coreRadiusFactor 0.28 → 人工任务核心 0-45m；
 *    transitionRadiusFactor 0.26 → 人工过渡带 45-86m；其余为确定性程序化外围。
 *  - anchors 为 Site Local 坐标（原点 = 站点中心，米）；实例化时由
 *    domain/ground/missionSiteFactory.js 仿射变换（平移 + 1 缩放）到 Planet Local。
 *  - routes 至少含 route_main（wide_safe，宽 7m）与 route_flank（narrow_risky，宽 3.5m）
 *    两条差异化战术路线；route_secondary / route_extraction 为锚点服务路（wide_safe）。
 *    deckSegments: [起始, 结束]（全线弧长分数）标记桥梁甲板段（BRIDGE_DECK 旗）。
 *  - 每份蓝图必须回答序列 6 §5.5 的八个关卡设计问题（purposeZh..worldWritebackZh），
 *    并满足 SITE-01/02/08：主视觉地标在核心区内、撤离点开局即存在、首屏有焦点。
 *
 * 关卡设计八问：①为何来此 purposeZh ②首屏焦点 firstScreenZh ③建议方向 suggestedDirZh
 * ④主目标何在及其逻辑 primaryWhyZh ⑤路线风险收益 routeTradeoffZh ⑥主题改变战术 themeEffectZh
 * ⑦失败/撤离代价 failureCostZh ⑧世界回写 worldWritebackZh。
 *
 * 本文件零逻辑、零副作用、零依赖；查表请用 getSiteBlueprint / blueprintsForPlanet。
 */

export const MISSION_SITE_BLUEPRINTS = {
  /** 1. 赤砾边疆 — 平顶桌山遗迹发掘场 */
  site_regolith_relic_01: {
    id: 'site_regolith_relic_01',
    version: 1,
    themeTags: ['red_regolith_frontier'],
    siteKind: 'mesa_relic_dig',
    nameZh: '赤砾遗迹发掘场',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'mesa_canyon_crater_steppe',
    purposeZh: '先遣扫描在桌山背风面捕捉到非人类构筑物回波，派小队回收三段数据核心。',
    firstScreenZh: '着陆即见沙金桌山崖脚的巨型风蚀砂岩拱门，拱影正中便是主发掘区。',
    suggestedDirZh: '面向拱门沿主干道下坡推进，避开左侧陨坑环的活跃尘暴漏斗区。',
    primaryWhyZh: '遗物封存在桌山崖脚的坍塌层里，砂岩拱门是唯一未被流沙掩埋的入口标靶。',
    routeTradeoffZh: '主道宽阔有巨岩掩体但绕行陨坑；侧翼贴崖更近，却要横穿尘暴漏斗区。',
    themeEffectZh: '沙尘暴期间能见度骤降、太阳能出力暴跌，户外未防护人员持续受风沙磨蚀。',
    failureCostZh: '中止撤离将遗弃已就位的钻探平台，本区块扫描置信度下调并错失发掘窗口。',
    worldWritebackZh: '成功后回写远古数据与硅酸盐储量，行星矿藏丰度获得永久勘探修正。',
    primaryLandmarkPrefab: 'sandstone_arch',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: 26, z: -30 },
      secondaryObjective: { x: -32, z: 18 },
      extraction: { x: -46, z: -18 },
    },
    landmarks: [
      { prefabId: 'sandstone_arch', anchor: { x: 14, z: -38 }, rotation: 0.4 },
      { prefabId: 'relic_dig_rig', anchor: { x: 26, z: -30 }, rotation: 1.2 },
      { prefabId: 'old_mining_platform', anchor: { x: -32, z: 18 } },
      { prefabId: 'deep_well_water_tower', anchor: { x: -46, z: -18 }, rotation: 2.6 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 12, z: -6 }, { x: 20, z: -18 }] },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: -14, z: -10 }, { x: -24, z: -28 }, { x: -2, z: -44 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -14, z: 8 }, { x: -24, z: 14 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: 6, z: -44 }, { x: -24, z: -36 }] },
    ],
    objectiveGraph: 'objective_graph_relic_dig_01',
    extraction: { kind: 'dropzone_rally', radius: 8 },
    proceduralSeedSalt: 'regolith_relic_v1',
    coverPoints: [
      { x: 14, z: -8, kind: 'boulder' },
      { x: 18, z: -20, kind: 'mesa_shelf' },
      { x: 6, z: -28, kind: 'crater_rim' },
      { x: -12, z: -14, kind: 'ridge' },
      { x: -4, z: -40, kind: 'slab' },
    ],
    hazardZones: [
      { x: -26, z: -34, radius: 10, type: 'dust_devil' },
      { x: 36, z: -42, radius: 9, type: 'mesa_rockfall' },
    ],
    missionTemplateAffinity: ['gmt_relic_survey', 'gmt_escort_engineers'],
  },

  /** 2. 黑曜熔海 — 岩浆大河拱桥渡口争夺 */
  site_obsidian_bridge_01: {
    id: 'site_obsidian_bridge_01',
    version: 1,
    themeTags: ['obsidian_lava'],
    siteKind: 'lava_river_bridge_crossing',
    nameZh: '黑曜拱桥渡口',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'obsidian_ridge_lava',
    purposeZh: '岩浆大河是唯一未设防的渡口走廊，小队要夺取对岸的地热虹吸阵列。',
    firstScreenZh: '黑曜山脊之间灼橙岩浆河横贯视野，抛物线黑曜拱桥正对着陆点。',
    suggestedDirZh: '沿主干道直上拱桥桥面；或沿河岸向东寻断裂六棱柱渡口侧翼绕后。',
    primaryWhyZh: '对岸台地扼守岩浆虹吸电站，是全区重金属与稀土钻机的动力心脏。',
    routeTradeoffZh: '主桥稳固但重兵把守；侧翼断桥缺口更近，需工程枪架设临时跨接桥面。',
    themeEffectZh: '临近岩浆河热辐射持续累积，护盾过载后必须退回黑曜石背阴面冷却。',
    failureCostZh: '撤收时炸毁拱桥跨段，渡口重回封锁，下次行动须先消耗合金抢修桥面。',
    worldWritebackZh: '占领后回写重金属与稀土库存，并在河岸解锁地热发电设施建造。',
    primaryLandmarkPrefab: 'obsidian_arch_bridge',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: 34, z: 26 },
      secondaryObjective: { x: -30, z: 20 },
      extraction: { x: -44, z: -26 },
    },
    landmarks: [
      { prefabId: 'obsidian_arch_bridge', anchor: { x: 18, z: 11 }, rotation: 0.7 },
      { prefabId: 'basalt_hex_pillars', anchor: { x: -30, z: 20 } },
      { prefabId: 'lava_geothermal_siphon', anchor: { x: 34, z: 26 }, rotation: 1.9 },
      { prefabId: 'scoria_ore_rig', anchor: { x: -44, z: -26 }, rotation: 0.2 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 10, z: 4 }, { x: 18, z: 11 }, { x: 26, z: 19 }],
        deckSegments: [[0.3, 0.72]], deckLift: 3.5 },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 12, z: -4 }, { x: 18, z: -14 }, { x: 4, z: -20 }, { x: -8, z: -8 }, { x: -4, z: 8 }, { x: 10, z: 14 }, { x: 24, z: 20 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -10, z: 4 }, { x: -22, z: 12 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: 26, z: 19 }, { x: 18, z: 11 }, { x: 8, z: 2 }, { x: -8, z: -4 }, { x: -24, z: -12 }],
        deckSegments: [[0.02, 0.26]], deckLift: 3.5 },
    ],
    objectiveGraph: 'objective_graph_bridge_assault_01',
    extraction: { kind: 'skiff_rally', radius: 8 },
    proceduralSeedSalt: 'obsidian_bridge_v1',
    coverPoints: [
      { x: 8, z: 2, kind: 'pillar' },
      { x: 24, z: 17, kind: 'arch_stub' },
      { x: -2, z: -10, kind: 'scoria_mound' },
      { x: -18, z: 4, kind: 'hex_block' },
      { x: 28, z: 24, kind: 'ridge' },
    ],
    hazardZones: [
      { x: 14, z: -16, radius: 9, type: 'lava_crack' },
      { x: -36, z: -6, radius: 10, type: 'heat_vent' },
    ],
    missionTemplateAffinity: ['gmt_destroy_aa', 'gmt_sabotage_reactor'],
  },

  /** 3. 永冬炉境 — 中央热源塔盆地重启 */
  site_furnace_outpost_01: {
    id: 'site_furnace_outpost_01',
    version: 1,
    themeTags: ['permafrost_furnace'],
    siteKind: 'heat_tower_basin',
    nameZh: '炉境热源盆地',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'glacial_basin_crevasse',
    purposeZh: '暴风雪季前必须重启中央热源塔，把避风冰川盆地变成前哨生存半径。',
    firstScreenZh: '蓝白冰崖环抱的盆地中央，黑铁热源塔的琥珀暖光是唯一亮色。',
    suggestedDirZh: '顺着加热钢桁架桥的暖光路径，直奔热源塔基座阀门站。',
    primaryWhyZh: '热源塔是全盆地唯一热网枢纽，塔基阀门决定供暖半径能否重启。',
    routeTradeoffZh: '主道沿加热管桥稳健但绕远；侧翼横穿冰裂隙带，快却要赌融雪窗口。',
    themeEffectZh: '离开热源覆盖圈体温槽持续下降，白暴风雪期间所有热源半径收缩四成。',
    failureCostZh: '任务失败则前哨暖眠舱弃用，工程队冻伤减员，盆地取暖配额减半。',
    worldWritebackZh: '重启后回写富水冰储量与隔热超导科技点，前哨人口上限提升。',
    primaryLandmarkPrefab: 'central_furnace_tower',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: 0, z: -30 },
      secondaryObjective: { x: -28, z: 10 },
      extraction: { x: 34, z: 18 },
    },
    landmarks: [
      { prefabId: 'central_furnace_tower', anchor: { x: 0, z: -30 }, rotation: 0 },
      { prefabId: 'heated_span_bridge', anchor: { x: -14, z: -20 }, rotation: 1.1 },
      { prefabId: 'thermal_storage_vault', anchor: { x: -28, z: 10 } },
      { prefabId: 'snow_buried_outpost', anchor: { x: 34, z: 18 }, rotation: 2.2 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 8, z: -12 }, { x: 2, z: -22 }] },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 16, z: -2 }, { x: 26, z: -10 }, { x: 14, z: -24 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -12, z: 2 }, { x: -22, z: 6 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: -6, z: -18 }, { x: -14, z: -4 }, { x: 4, z: 6 }, { x: 20, z: 12 }] },
    ],
    objectiveGraph: 'objective_graph_heat_restart_01',
    extraction: { kind: 'heated_airlock', radius: 7 },
    proceduralSeedSalt: 'furnace_outpost_v1',
    coverPoints: [
      { x: 10, z: -6, kind: 'ice_block' },
      { x: -8, z: -14, kind: 'pipe_berm' },
      { x: -20, z: 2, kind: 'vault_wall' },
      { x: 14, z: -20, kind: 'crevasse_lip' },
      { x: 24, z: 6, kind: 'drift_ridge' },
    ],
    hazardZones: [
      { x: 26, z: -14, radius: 10, type: 'crevasse_breach' },
      { x: -16, z: -36, radius: 11, type: 'whiteout_pocket' },
    ],
    missionTemplateAffinity: ['gmt_rescue_crew', 'gmt_escort_engineers'],
  },

  /** 4. 永夜晶荒 — 盐晶盆地勘探布标 */
  site_night_salt_01: {
    id: 'site_night_salt_01',
    version: 1,
    themeTags: ['dry_night_polar'],
    siteKind: 'salt_crystal_survey',
    nameZh: '永夜盐晶盆地',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'dry_salt_polar',
    purposeZh: '极夜荒原的盐晶盆地析出高纯工业盐晶，小队标定晶脉并布设储能中继。',
    firstScreenZh: '永夜天幕下月白多边形盐壳向四方铺开，紫色极光正映在主晶簇尖顶。',
    suggestedDirZh: '朝极光最亮的东北晶簇推进，雷达信标会沿主道逐级点亮。',
    primaryWhyZh: '主晶簇是盆地盐脉的露头节点，采样数据决定热储能电池塔的选址。',
    routeTradeoffZh: '主道沿信标带安全但照明暴露行踪；侧翼借陨石散布区遮蔽，快而多险。',
    themeEffectZh: '常规太阳能完全失效，黑暗视野受限，须依靠热成像与反光信标推进。',
    failureCostZh: '撤离放弃即封存已布设的信标链，本区块扫描置信度回退一级。',
    worldWritebackZh: '回写工业盐晶与光学晶体库存，解锁储能科技与夜战涂层改装。',
    primaryLandmarkPrefab: 'salt_crystal_spire',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: 24, z: 18 },
      secondaryObjective: { x: -26, z: 6 },
      extraction: { x: -18, z: -36 },
    },
    landmarks: [
      { prefabId: 'salt_crystal_spire', anchor: { x: 24, z: 18 }, rotation: 0.9 },
      { prefabId: 'radar_beacon_station', anchor: { x: -26, z: 6 } },
      { prefabId: 'meteor_intercept_laser', anchor: { x: -18, z: -36 }, rotation: 2.8 },
      { prefabId: 'salt_survey_drone_dock', anchor: { x: 10, z: 8 }, rotation: 1.5 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 12, z: 10 }] },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 14, z: -2 }, { x: 30, z: -12 }, { x: 30, z: 4 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -12, z: 2 }, { x: -20, z: 4 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: 6, z: 8 }, { x: -6, z: -12 }, { x: -14, z: -26 }] },
    ],
    objectiveGraph: 'objective_graph_salt_survey_01',
    extraction: { kind: 'beacon_rally', radius: 8 },
    proceduralSeedSalt: 'night_salt_v1',
    coverPoints: [
      { x: 10, z: 6, kind: 'salt_shard' },
      { x: 18, z: 14, kind: 'crystal_spire' },
      { x: 20, z: -8, kind: 'ejecta_block' },
      { x: -12, z: -8, kind: 'ridge_shadow' },
      { x: -4, z: -24, kind: 'slab' },
    ],
    hazardZones: [
      { x: 36, z: -16, radius: 10, type: 'meteor_scatter' },
      { x: -34, z: -14, radius: 9, type: 'frost_quake' },
    ],
    missionTemplateAffinity: ['gmt_relic_survey', 'gmt_sabotage_reactor'],
  },

  /** 5. 硫雾沼泽 — 喷气锥封堵作业 */
  site_sulfur_vents_01: {
    id: 'site_sulfur_vents_01',
    version: 1,
    themeTags: ['sulfur_marsh'],
    siteKind: 'fumarole_capping',
    nameZh: '硫雾喷气锥群',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'fumarole_acid_terraces',
    purposeZh: '喷气锥的沼气烟柱正逼近风向观测塔，小队要在低地毒雾涨潮前封堵锥口。',
    firstScreenZh: '焦黑岩柱平台上黄绿气柱冲天，酸液阶地池在洼地里泛着毒荧绿光。',
    suggestedDirZh: '沿高处黑色岩脊向东北推进，全程保持高地以免坠入毒气湖面。',
    primaryWhyZh: '巨型喷气锥位于岩脊裂口，是沼气云的源头，冷凝封堵器只能就地安装。',
    routeTradeoffZh: '主道走岩脊高线稳但慢；侧翼穿酸池栈管近而险，防腐滤芯消耗翻倍。',
    themeEffectZh: '低洼毒雾持续腐蚀防腐层，浓沼气区使用明火武器会引发爆燃冲击波。',
    failureCostZh: '封堵失败则风向塔停机，全星区化工链减产并弃置已部署滤芯。',
    worldWritebackZh: '回写挥发性气体与硫化物库存，行星酸雾预警等级下调一级。',
    primaryLandmarkPrefab: 'giant_fumarole_cone',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: -8, z: 32 },
      secondaryObjective: { x: 30, z: 14 },
      extraction: { x: -40, z: -22 },
    },
    landmarks: [
      { prefabId: 'giant_fumarole_cone', anchor: { x: -8, z: 32 }, rotation: 0 },
      { prefabId: 'wind_observation_tower', anchor: { x: 30, z: 14 }, rotation: 1.7 },
      { prefabId: 'acid_pipe_bridge', anchor: { x: -16, z: 12 }, rotation: 2.4 },
      { prefabId: 'condenser_station', anchor: { x: -40, z: -22 } },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -4, z: 14 }, { x: -10, z: 24 }] },
      { id: 'route_flank', from: 'landing', to: 'secondaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 10, z: -6 }, { x: 18, z: -14 }, { x: 26, z: 0 }, { x: 28, z: 8 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 14, z: 4 }, { x: 24, z: 10 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: -22, z: 16 }, { x: -34, z: 0 }, { x: -40, z: -10 }] },
    ],
    objectiveGraph: 'objective_graph_vent_capping_01',
    extraction: { kind: 'gas_mask_rally', radius: 8 },
    proceduralSeedSalt: 'sulfur_vents_v1',
    coverPoints: [
      { x: -6, z: 10, kind: 'rock_spine' },
      { x: -12, z: 22, kind: 'cone_rim' },
      { x: 16, z: -2, kind: 'pipe_rack' },
      { x: 24, z: 8, kind: 'etched_wall' },
      { x: -28, z: -6, kind: 'charred_mound' },
    ],
    hazardZones: [
      { x: 14, z: -20, radius: 12, type: 'acid_pool' },
      { x: -24, z: 20, radius: 9, type: 'gas_plume' },
    ],
    missionTemplateAffinity: ['gmt_purge_bio', 'gmt_destroy_aa'],
  },

  /** 6. 星辉生物圈 — 灵魂母树共生采样 */
  site_biolume_grove_01: {
    id: 'site_biolume_grove_01',
    version: 1,
    themeTags: ['biolume_canopy'],
    siteKind: 'glow_grove_sampling',
    nameZh: '星辉灵魂母树林',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'biolume_rainforest',
    purposeZh: '灵魂母树的共生采样点进入昼夜窗口，小队要收集神经纤维药物前体。',
    firstScreenZh: '深海青林冠下荧光脉络如神经网络铺开，青绿光流正汇向灵魂母树。',
    suggestedDirZh: '跟着青色脉络的流向走，紫色螺旋植物会标出侧翼岔口。',
    primaryWhyZh: '灵魂母树是共生网络的根节点，树冠阴影里的采样点只在夜间活性达标。',
    routeTradeoffZh: '主道沿脉络光路平稳但足迹暴露；侧翼掠过掠食异虫巢穴边缘，快而凶险。',
    themeEffectZh: '踏步压感荧光涟漪会惊动林冠掠食者，昼夜窗口之外采样活性减半。',
    failureCostZh: '撤离弃采将触发群落应激休眠，本季度共生采样窗口关闭。',
    worldWritebackZh: '回写再生生物质与药物前体库存，殖民地解锁荧光植被移植。',
    primaryLandmarkPrefab: 'soul_willow_tree',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: -14, z: 28 },
      secondaryObjective: { x: 26, z: 12 },
      extraction: { x: 36, z: -24 },
    },
    landmarks: [
      { prefabId: 'soul_willow_tree', anchor: { x: -14, z: 28 }, rotation: 0.3 },
      { prefabId: 'magnetic_stone_arch', anchor: { x: 34, z: -6 }, rotation: 1.4 },
      { prefabId: 'glow_root_sampling_pod', anchor: { x: 26, z: 12 } },
      { prefabId: 'spore_grove_marker', anchor: { x: 36, z: -24 }, rotation: 2.1 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -6, z: 14 }] },
      { id: 'route_flank', from: 'landing', to: 'secondaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 12, z: -4 }, { x: 20, z: -2 }, { x: 26, z: 4 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 10, z: 4 }, { x: 20, z: 8 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: -2, z: 20 }, { x: 14, z: 6 }, { x: 28, z: -8 }] },
    ],
    objectiveGraph: 'objective_graph_grove_sampling_01',
    extraction: { kind: 'canopy_rally', radius: 8 },
    proceduralSeedSalt: 'biolume_grove_v1',
    coverPoints: [
      { x: -4, z: 10, kind: 'root_arch' },
      { x: -10, z: 20, kind: 'willow_root' },
      { x: 16, z: 0, kind: 'moss_mound' },
      { x: 22, z: 8, kind: 'spore_clump' },
      { x: 26, z: -12, kind: 'stone_shelf' },
    ],
    hazardZones: [
      { x: 14, z: -12, radius: 9, type: 'predator_hollow' },
      { x: -30, z: -10, radius: 10, type: 'spore_geyser' },
    ],
    missionTemplateAffinity: ['gmt_purge_bio', 'gmt_relic_survey'],
  },

  /** 7. 碧渊海洋 — 半埋海底穹顶 survey */
  site_abyssal_dome_01: {
    id: 'site_abyssal_dome_01',
    version: 1,
    themeTags: ['abyssal_ocean'],
    siteKind: 'submerged_dome_survey',
    nameZh: '碧渊珊瑚穹顶',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'ocean_basin_reef_trench',
    purposeZh: '半埋海底穹顶的碑文舱段随潮汐露出，小队要赶在潮位回升前完成采样。',
    firstScreenZh: '青白焦散光斑扫过珍珠白穹顶肋拱，荧光藻沿古桥两侧明明灭灭。',
    suggestedDirZh: '沿发光巨藻拱桥的青光向穹顶门厅推进，避开海沟断层一侧。',
    primaryWhyZh: '穹顶门厅是唯一未坍塌的入口，潮汐开闭的闸槽就在门厅两侧。',
    routeTradeoffZh: '主道沿珊瑚台地缓坡稳但绕行礁脊；侧翼贴海沟崖缘近而承受高压。',
    themeEffectZh: '水深超过八米进入高压区持续消耗耐压护盾，潮汐每九十秒升降三点五米。',
    failureCostZh: '潮位回升被迫弃潜，已暴露的碑文舱段重新淹没并错过潮汐窗口。',
    worldWritebackZh: '回写深海生物质与重氢库存，远古水下碑文数据入档研究队列。',
    primaryLandmarkPrefab: 'reef_dome_ruin',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: 22, z: -26 },
      secondaryObjective: { x: -28, z: -12 },
      extraction: { x: 0, z: 44 },
    },
    landmarks: [
      { prefabId: 'reef_dome_ruin', anchor: { x: 22, z: -26 }, rotation: 0.6 },
      { prefabId: 'tide_spire', anchor: { x: -28, z: -12 }, rotation: 1.8 },
      { prefabId: 'biolume_kelp_arch', anchor: { x: 10, z: -12 }, rotation: 2.9 },
      { prefabId: 'submersible_bay_beacon', anchor: { x: 0, z: 44 } },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 10, z: -12 }, { x: 16, z: -20 }] },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: -12, z: -6 }, { x: -16, z: -18 }, { x: -6, z: -28 }, { x: 6, z: -32 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -14, z: -4 }, { x: -22, z: -8 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: 12, z: -8 }, { x: 4, z: 16 }, { x: 0, z: 30 }] },
    ],
    objectiveGraph: 'objective_graph_dome_survey_01',
    extraction: { kind: 'submersible_bay', radius: 9 },
    proceduralSeedSalt: 'abyssal_dome_v1',
    coverPoints: [
      { x: 8, z: -8, kind: 'kelp_arch_foot' },
      { x: 16, z: -18, kind: 'reef_block' },
      { x: -10, z: -16, kind: 'spire_base' },
      { x: 2, z: -24, kind: 'coral_ridge' },
      { x: 8, z: 22, kind: 'shelf_rock' },
    ],
    hazardZones: [
      { x: -8, z: -36, radius: 11, type: 'trench_pressure' },
      { x: 34, z: 6, radius: 9, type: 'current_shear' },
    ],
    missionTemplateAffinity: ['gmt_relic_survey', 'gmt_rescue_crew'],
  },

  /** 8. 通用岩质 — 坠毁货船调查（兜底站点，themeTags 为空匹配任何行星回退） */
  site_rocky_crash_01: {
    id: 'site_rocky_crash_01',
    version: 1,
    themeTags: [],
    siteKind: 'crashed_ship_survey',
    nameZh: '坠毁货船残骸场',
    siteRadius: 160,
    coreRadiusFactor: 0.28,
    transitionRadiusFactor: 0.26,
    terrainProfile: 'generic_rocky',
    purposeZh: '一艘失联货船坠毁在岩质高地，小队要找回黑匣子与幸存补给。',
    firstScreenZh: '锈色岩原尽头，断裂的船体斜插在陨坑边缘，求救信标仍在闪烁。',
    suggestedDirZh: '沿信标主干道直奔船体主裂口，燃料泄漏区禁止携带明火靠近。',
    primaryWhyZh: '黑匣子封在主裂口后的驾驶舱段，只有那里还没被大火焚毁。',
    routeTradeoffZh: '主道绕开泄漏区稳妥；侧翼穿过燃料火区直取舱段，快但灼烧减员风险高。',
    themeEffectZh: '泄漏燃料间歇爆燃，气浪会掀翻低掩体，夜间火光暴露全队位置。',
    failureCostZh: '放弃搜索则黑匣子数据永久丢失，失联船员抚恤与保险理赔冻结。',
    worldWritebackZh: '回写合金与模块物资，失联船档案结案并解锁残骸回收工单。',
    primaryLandmarkPrefab: 'crashed_hull_freighter',
    anchors: {
      landing: { x: 0, z: 0 },
      primaryObjective: { x: -26, z: -14 },
      secondaryObjective: { x: 18, z: 24 },
      extraction: { x: 30, z: -28 },
    },
    landmarks: [
      { prefabId: 'crashed_hull_freighter', anchor: { x: -26, z: -14 }, rotation: 0.8 },
      { prefabId: 'scattered_cargo_pods', anchor: { x: 18, z: 24 }, rotation: 2.0 },
      { prefabId: 'escape_pod_beacon', anchor: { x: 30, z: -28 } },
      { prefabId: 'impact_crater_rim', anchor: { x: 2, z: -30 }, rotation: 1.3 },
    ],
    routes: [
      { id: 'route_main', from: 'landing', to: 'primaryObjective', kind: 'wide_safe',
        waypoints: [{ x: -12, z: -6 }] },
      { id: 'route_flank', from: 'landing', to: 'primaryObjective', kind: 'narrow_risky',
        waypoints: [{ x: 8, z: -12 }, { x: 2, z: -24 }, { x: -12, z: -30 }] },
      { id: 'route_secondary', from: 'landing', to: 'secondaryObjective', kind: 'wide_safe',
        waypoints: [{ x: 8, z: 12 }, { x: 14, z: 18 }] },
      { id: 'route_extraction', from: 'primaryObjective', to: 'extraction', kind: 'wide_safe',
        waypoints: [{ x: -8, z: -22 }, { x: 10, z: -28 }, { x: 22, z: -30 }] },
    ],
    objectiveGraph: 'objective_graph_crash_survey_01',
    extraction: { kind: 'skiff_beacon', radius: 8 },
    proceduralSeedSalt: 'rocky_crash_v1',
    coverPoints: [
      { x: -10, z: -4, kind: 'hull_plate' },
      { x: -20, z: -10, kind: 'cargo_stack' },
      { x: 6, z: -16, kind: 'engine_cowl' },
      { x: -4, z: -26, kind: 'blast_wall' },
      { x: 14, z: -30, kind: 'rim_rock' },
    ],
    hazardZones: [
      { x: 2, z: -30, radius: 10, type: 'fuel_fire' },
      { x: -38, z: 8, radius: 9, type: 'unstable_debris' },
    ],
    missionTemplateAffinity: ['gmt_rescue_crew', 'gmt_sabotage_reactor'],
  },
};

/** 通用兜底站点 id（themeTags 为空 = 匹配不到主题时使用） */
export const GENERIC_SITE_BLUEPRINT_ID = 'site_rocky_crash_01';

/** 按 id 查找蓝图（未知 id 返回 null） */
export function getSiteBlueprint(id) {
  if (!id) return null;
  return MISSION_SITE_BLUEPRINTS[id] || null;
}

/**
 * 行星 → 适配蓝图列表：themeTags 命中显式 themeId 或 planet.primaryThemeId 者优先，
 * 全部落空时回退通用站点（doc6 §5.4：查表永不返回空集）。
 * @param {{primaryThemeId?:string, secondaryThemeModifiers?:string[]}|null} planet 行星实体（可为 null）
 * @param {string|null} [themeId] 显式主题 id（优先于行星档案）
 * @returns {object[]} 蓝图数组（注册表声明序，确定性）
 */
export function blueprintsForPlanet(planet, themeId) {
  const tids = [];
  if (themeId) tids.push(themeId);
  if (planet && planet.primaryThemeId) tids.push(planet.primaryThemeId);
  if (planet && Array.isArray(planet.secondaryThemeModifiers)) {
    for (const t of planet.secondaryThemeModifiers) tids.push(t);
  }
  const hits = [];
  for (const key of Object.keys(MISSION_SITE_BLUEPRINTS)) {
    const bp = MISSION_SITE_BLUEPRINTS[key];
    if (bp.themeTags.some((t) => tids.indexOf(t) >= 0)) hits.push(bp);
  }
  if (hits.length > 0) return hits;
  const generic = getSiteBlueprint(GENERIC_SITE_BLUEPRINT_ID);
  return generic ? [generic] : [];
}
