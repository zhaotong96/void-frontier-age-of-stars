/**
 * content/factions.js — 原创文明定义与特质（任务书 13.1）
 *
 * 六个首发文明：差异必须体现在规则参数上，而非只有名字与颜色。
 * traitId → modifiers.getMod 可读取的 stat 集合。
 */

export const FACTIONS = [
  {
    id: 'frontier_compact',
    nameZh: '边境联合体',
    nameEn: 'Frontier Compact',
    traitId: 'frontier_compact',
    personality: 'trader',
    ethosTag: 'council',
    color: '#5ad1e6',
    originType: 'homeworld',
    descZh: '多殖民地协商议会，扩张依赖贸易与自治协议。',
  },
  {
    id: 'forge_tide',
    nameZh: '铸潮执政局',
    nameEn: 'Forge-Tide Directorate',
    traitId: 'forge_tide',
    personality: 'expansionist',
    ethosTag: 'military',
    color: '#e8b04f',
    originType: 'homeworld',
    descZh: '工业军政体，合金与造船效率出众，热衷边境压制。',
  },
  {
    id: 'chordport',
    nameZh: '弦港自由协约',
    nameEn: 'Chordport Free Accord',
    traitId: 'chordport',
    personality: 'trader',
    ethosTag: 'mercantile',
    color: '#62d98a',
    originType: 'homeworld',
    descZh: '多港口商贸联盟，市场信息灵通，信用融资发达。',
  },
  {
    id: 'vesper',
    nameZh: '维斯珀生态共同体',
    nameEn: 'Vesper Biosphere Union',
    traitId: 'vesper',
    personality: 'defensive',
    ethosTag: 'ecology',
    color: '#8fd97a',
    originType: 'homeworld',
    descZh: '生态互助共同体，人口健康与生物材料生产优秀。',
  },
  {
    id: 'axiom',
    nameZh: '公理协奏体',
    nameEn: 'Axiom Concordance',
    traitId: 'axiom',
    personality: 'scientist',
    ethosTag: 'automation',
    color: '#7ea8ff',
    originType: 'homeworld',
    descZh: '高度自动化的研究议会，传感器与无人系统见长。',
  },
  {
    id: 'ember_nomad',
    nameZh: '余烬航居群',
    nameEn: 'Ember Nomad Flotilla',
    traitId: 'ember_nomad',
    personality: 'opportunist',
    ethosTag: 'nomad',
    color: '#e88a5f',
    originType: 'flotilla',
    descZh: '舰队迁徙式社会，远航补给与游击撤离作战老练。',
  },
];

/**
 * 特质 → stat 修正表（getMod 聚合）。
 * 均为可验证机制差异（任务书 13.1：不只是颜色和名字）。
 */
export const FACTION_TRAITS = {
  frontier_compact: {
    governanceLoad: { mode: 'mult', value: 0.8 },      // 自治协议降低治理负担
    colonizationCost: { mode: 'mult', value: 0.85 },   // 殖民扩张成本更低
    tradeCapacity: { mode: 'mult', value: 1.1 },
  },
  forge_tide: {
    alloyOutput: { mode: 'mult', value: 1.15 },        // 合金产率高
    shipBuildSpeed: { mode: 'mult', value: 1.15 },     // 造船快
    shipBuildCostReduction: { mode: 'mult', value: 0.92 },
    stabilityBonus: { mode: 'add', value: -3 },        // 军工动员的社会压力
  },
  chordport: {
    tradeCapacity: { mode: 'mult', value: 1.3 },       // 贸易容量大
    marketPriceBonus: { mode: 'mult', value: 1.08 },   // 市场信息优势
    influenceGain: { mode: 'mult', value: 1.15 },      // 贸易网络转化为影响力
    adminCapacity: { mode: 'mult', value: 1.1 },
  },
  vesper: {
    popGrowth: { mode: 'mult', value: 1.12 },          // 人口更健康
    habitabilityBonus: { mode: 'add', value: 5 },      // 生态适应
    farmOutput: { mode: 'mult', value: 1.15 },
    groundCombatBonus: { mode: 'mult', value: 1.15 },  // 地表战优势
  },
  axiom: {
    researchOutput: { mode: 'mult', value: 1.15 },     // 科研强
    jobNeeds: { mode: 'mult', value: 0.8 },            // 自动化降低岗位需求
    sensorStrength: { mode: 'mult', value: 1.2 },      // 传感器强
    ewarStrength: { mode: 'mult', value: 1.15 },
    powerOutput: { mode: 'mult', value: 1.1 },
  },
  ember_nomad: {
    fuelEfficiency: { mode: 'mult', value: 1.2 },      // 远航补给强
    strategicSpeed: { mode: 'mult', value: 1.1 },
    repairRate: { mode: 'mult', value: 1.15 },
    hitChanceBonus: { mode: 'add', value: 0.04 },      // 游击战术
    tradeCapacity: { mode: 'mult', value: 0.9 },
  },
};

/** 文明配置（供 scenarioFactory / 新游戏界面） */
export function factionConfigs(isPlayerId) {
  return FACTIONS.map((f) => ({
    id: f.id,
    name: f.nameZh,
    traitId: f.traitId,
    personality: f.personality,
    ethosTag: f.ethosTag,
    color: f.color,
    originType: f.originType,
    isPlayer: f.id === isPlayerId,
  }));
}
