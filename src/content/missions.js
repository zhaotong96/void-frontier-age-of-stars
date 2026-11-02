/**
 * content/missions.js — 行星地面行动模板（任务书 5.7 / GROUND-01）
 *
 * 每个模板描述一次地面行动：地图尺寸、敌人构成、目标清单、时限与结算奖励。
 * 约束：
 *  - rewards 的 resId 必须是 content/resources.js 中真实存在的资源 id；
 *  - enemyTypes 取自 ['grunt','heavy','turret','boss'] 的子集；
 *  - enemyDensity ∈ [0.1, 0.5]（相对可通行格面积的敌人密度系数）；
 *  - timeLimitSeconds 为 0 表示不限时。
 *
 * 目标类型（objectives[].type）：
 *   reach   — 全体存活队员进入撤离区（撤离结算）
 *   destroy — 摧毁 count 个目标物（武器打击，或接触后交互引导 3s 引爆）
 *   rescue  — 接应 count 名失踪人员（每名接触 2s）
 *   collect — 回收 count 件数据核心（接触拾取）
 *   escort  — 工程队 NPC 跟随小队并抵达撤离区
 *   survive — 在地表坚持 seconds 秒
 *   boss    — 击杀深渊体
 */

export const MISSION_TEMPLATES = [
  {
    id: 'gmt_relic_survey',
    nameZh: '遗迹调查', nameEn: 'Relic Survey',
    descZh: '先遣扫描在大气静电层之下捕捉到非人类构筑物的轮廓。回收三段数据核心，随后全员撤入撤离区。交火预期轻微，但废墟结构不稳定。',
    descEn: 'Orbital sweep caught the outline of a non-human structure beneath the ionosphere. Recover three data cores and withdraw. Light resistance expected; the ruins are unstable.',
    kind: 'survey',
    mapSize: [40, 32],
    enemyDensity: 0.12,
    enemyTypes: ['grunt', 'turret'],
    objectives: [
      { type: 'collect', count: 3 },
      { type: 'reach' },
    ],
    timeLimitSeconds: 0,
    rewards: [
      { resId: 'ancientData', amount: 4 },
      { resId: 'researchData', amount: 20 },
    ],
    riskLevel: 1,
    storyTag: 'relic_frontier',
  },
  {
    id: 'gmt_rescue_crew',
    nameZh: '救援失踪人员', nameEn: 'Lost Crew Recovery',
    descZh: '一艘补给船在着陆带以北失联，生命信标仍有三处激活信号。找到他们，确认体征，带活着的人回来。',
    descEn: 'A supply shuttle went dark north of the landing zone. Three life beacons still pulse. Locate the crew, confirm vitals, bring back whoever is still breathing.',
    kind: 'rescue',
    mapSize: [44, 34],
    enemyDensity: 0.25,
    enemyTypes: ['grunt', 'heavy'],
    objectives: [
      { type: 'rescue', count: 3 },
    ],
    timeLimitSeconds: 480,
    rewards: [
      { resId: 'medicine', amount: 6 },
      { resId: 'credits', amount: 350 },
    ],
    riskLevel: 2,
  },
  {
    id: 'gmt_destroy_aa',
    nameZh: '摧毁防空节点', nameEn: 'AA Node Demolition',
    descZh: '敌军防空网由三个相互衔接的火力节点构成，封锁了整个轨道走廊。炸掉它们，舰队才能进近。注意节点周边的固定炮塔。',
    descEn: 'The enemy air-defense net hinges on three linked fire-control nodes sealing the orbital corridor. Blow them open so the fleet can approach. Watch for fixed turrets.',
    kind: 'sabotage',
    mapSize: [46, 34],
    enemyDensity: 0.35,
    enemyTypes: ['grunt', 'heavy', 'turret'],
    objectives: [
      { type: 'destroy', count: 3 },
    ],
    timeLimitSeconds: 540,
    rewards: [
      { resId: 'alloy', amount: 30 },
      { resId: 'powerCell', amount: 6 },
      { resId: 'researchData', amount: 10 },
    ],
    riskLevel: 3,
  },
  {
    id: 'gmt_escort_engineers',
    nameZh: '护送工程队', nameEn: 'Engineer Escort',
    descZh: '工程队要在废弃精炼厂恢复一座地热井，预计地表作业三分钟。他们只会修机器，不会打仗——别让他们死在管廊里。',
    descEn: 'The engineering team is restarting a geothermal well in the derelict refinery. Three minutes of surface work. They fix machines, not fights — keep them out of body bags.',
    kind: 'escort',
    mapSize: [48, 36],
    enemyDensity: 0.30,
    enemyTypes: ['grunt', 'heavy'],
    objectives: [
      { type: 'escort' },
      { type: 'survive', seconds: 180 },
    ],
    timeLimitSeconds: 420,
    rewards: [
      { resId: 'ferro', amount: 60 },
      { resId: 'credits', amount: 300 },
    ],
    riskLevel: 2,
  },
  {
    id: 'gmt_liberate_colony',
    nameZh: '解放殖民设施', nameEn: 'Colony Liberation',
    descZh: '殖民设施已被占领：四个防御工事支撑着占领军的指挥链，平民代表被扣押在居住舱。拆除工事，接出人质，别留下任何一座哨塔。',
    descEn: 'The colony fell. Four fortifications anchor the occupation command chain, and a civilian liaison is held in the habitat block. Tear the fortifications down and pull the hostage out.',
    kind: 'liberate',
    mapSize: [48, 36],
    enemyDensity: 0.40,
    enemyTypes: ['grunt', 'heavy', 'turret'],
    objectives: [
      { type: 'destroy', count: 4 },
      { type: 'rescue', count: 1 },
    ],
    timeLimitSeconds: 600,
    rewards: [
      { resId: 'influence', amount: 8 },
      { resId: 'medicine', amount: 10 },
      { resId: 'alloy', amount: 25 },
    ],
    riskLevel: 3,
    storyTag: 'colony_liberated',
  },
  {
    id: 'gmt_purge_bio',
    nameZh: '清除危险生物', nameEn: 'Bio Purge',
    descZh: '废弃生化站的培育舱破裂后，掠食性集群沿着通风管网扩散。五个巢穴节点必须逐个烧毁。这不是狩猎，是消杀。',
    descEn: 'When the vat hall ruptured, predatory clusters spread through the vent grid. Five hive nodes have to burn, one by one. This is not a hunt; it is pest control.',
    kind: 'purge',
    mapSize: [40, 32],
    enemyDensity: 0.45,
    enemyTypes: ['grunt', 'heavy'],
    objectives: [
      { type: 'destroy', count: 5 },
    ],
    timeLimitSeconds: 480,
    rewards: [
      { resId: 'biomass', amount: 40 },
      { resId: 'medicine', amount: 8 },
    ],
    riskLevel: 3,
  },
  {
    id: 'gmt_sabotage_reactor',
    nameZh: '破坏敌方能源站', nameEn: 'Reactor Sabotage',
    descZh: '敌方前沿能源站为整个防区供电。炸掉两座主变电平台，然后在警戒部队合围之前活着坚持两分钟，等接应窗口打开。',
    descEn: 'The forward power station feeds the entire defensive grid. Crack both main converter platforms, then stay alive for two minutes before the cordon closes and the pickup window opens.',
    kind: 'sabotage',
    mapSize: [44, 34],
    enemyDensity: 0.40,
    enemyTypes: ['heavy', 'turret', 'grunt'],
    objectives: [
      { type: 'destroy', count: 2 },
      { type: 'survive', seconds: 120 },
    ],
    timeLimitSeconds: 420,
    rewards: [
      { resId: 'powerCell', amount: 10 },
      { resId: 'conductor', amount: 8 },
      { resId: 'deuterium', amount: 12 },
    ],
    riskLevel: 4,
    storyTag: 'grid_down',
  },
  {
    id: 'gmt_boss_encounter',
    nameZh: '深渊体遭遇', nameEn: 'Abyssal Contact',
    descZh: '地质钻探惊醒了沉睡在冰层下的东西。它的质量读数超出分类上限，且仍在增长。分级建议：接触、评估、撤离——顺序可以颠倒，撤离不能取消。',
    descEn: 'The drill woke something under the ice. Its mass reading exceeds the classification ceiling and is still climbing. Recommended protocol: engage, assess, withdraw. The withdrawal is not optional.',
    kind: 'boss',
    mapSize: [52, 38],
    enemyDensity: 0.18,
    enemyTypes: ['boss', 'grunt', 'turret'],
    objectives: [
      { type: 'boss' },
      { type: 'reach' },
    ],
    timeLimitSeconds: 600,
    rewards: [
      { resId: 'darkMatter', amount: 2 },
      { resId: 'exoticMatter', amount: 2 },
      { resId: 'ancientData', amount: 6 },
    ],
    riskLevel: 5,
    storyTag: 'abyssal_contact',
  },
];

/** 按模板 id 查找（未知的 id 返回 undefined，由领域层校验并抛错） */
export function findMissionTemplate(templateId) {
  return MISSION_TEMPLATES.find((t) => t.id === templateId) || null;
}
