/**
 * content/resources.js — 资源定义（任务书 4.4 / 13.3：不少于 18 种）
 *
 * 每种资源：id、nameKey、category、unit、basePrice、mass、volume、
 * storageClass、rarity、isTradeable、isStrategic、decayRule、sourceTypes、sinkTypes。
 * 所有计量为整数单位（显示层格式化 K/M/B —— 任务书 2.5）。
 */

export const RESOURCES = [
  // —— 基础矿物 ——
  { id: 'ferro', nameKey: 'res.ferro', category: 'baseMineral', unit: 't', basePrice: 4, mass: 1.0, volume: 0.35, storageClass: 'bulk', rarity: 1, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['mine'], sinkTypes: ['refine', 'build'] },
  { id: 'silicate', nameKey: 'res.silicate', category: 'baseMineral', unit: 't', basePrice: 3, mass: 1.0, volume: 0.4, storageClass: 'bulk', rarity: 1, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['mine'], sinkTypes: ['refine', 'build'] },
  { id: 'rareEarth', nameKey: 'res.rareEarth', category: 'baseMineral', unit: 't', basePrice: 18, mass: 1.0, volume: 0.25, storageClass: 'crate', rarity: 3, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['mine'], sinkTypes: ['refine', 'build'] },
  { id: 'heavyMetal', nameKey: 'res.heavyMetal', category: 'baseMineral', unit: 't', basePrice: 10, mass: 1.3, volume: 0.2, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['mine'], sinkTypes: ['refine'] },

  // —— 工业材料 ——
  { id: 'alloy', nameKey: 'res.alloy', category: 'industrial', unit: 't', basePrice: 22, mass: 1.0, volume: 0.3, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['refine'], sinkTypes: ['build', 'ship', 'repair'] },
  { id: 'polymer', nameKey: 'res.polymer', category: 'industrial', unit: 't', basePrice: 14, mass: 0.8, volume: 0.5, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['refine'], sinkTypes: ['build', 'ship'] },
  { id: 'composite', nameKey: 'res.composite', category: 'industrial', unit: 't', basePrice: 34, mass: 0.7, volume: 0.4, storageClass: 'crate', rarity: 3, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['factory'], sinkTypes: ['ship', 'module'] },
  { id: 'ceramic', nameKey: 'res.ceramic', category: 'industrial', unit: 't', basePrice: 20, mass: 0.9, volume: 0.35, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['factory'], sinkTypes: ['module'] },
  { id: 'conductor', nameKey: 'res.conductor', category: 'industrial', unit: 't', basePrice: 30, mass: 0.6, volume: 0.2, storageClass: 'crate', rarity: 3, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['factory'], sinkTypes: ['module', 'building'] },

  // —— 挥发物 ——
  { id: 'hydrogen', nameKey: 'res.hydrogen', category: 'volatile', unit: 't', basePrice: 2, mass: 0.1, volume: 1.2, storageClass: 'tank', rarity: 1, isTradeable: true, isStrategic: false, decayRule: { perDayPct: 0.1 }, sourceTypes: ['mine', 'gasGiant'], sinkTypes: ['fuel', 'refine'] },
  { id: 'helium3', nameKey: 'res.helium3', category: 'volatile', unit: 't', basePrice: 16, mass: 0.1, volume: 1.0, storageClass: 'tank', rarity: 2, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['gasGiant', 'mine'], sinkTypes: ['reactor'] },
  { id: 'deuterium', nameKey: 'res.deuterium', category: 'volatile', unit: 't', basePrice: 26, mass: 0.1, volume: 0.8, storageClass: 'tank', rarity: 3, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['refine'], sinkTypes: ['reactor', 'weapon'] },
  { id: 'inertGas', nameKey: 'res.inertGas', category: 'volatile', unit: 't', basePrice: 8, mass: 0.1, volume: 1.1, storageClass: 'tank', rarity: 1, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['gasGiant'], sinkTypes: ['refine', 'terraform'] },
  { id: 'reagents', nameKey: 'res.reagents', category: 'volatile', unit: 't', basePrice: 12, mass: 0.5, volume: 0.6, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: { perDayPct: 0.2 }, sourceTypes: ['factory'], sinkTypes: ['refine', 'medicine'] },

  // —— 生态资源 ——
  { id: 'food', nameKey: 'res.food', category: 'bio', unit: 't', basePrice: 3, mass: 1.0, volume: 0.9, storageClass: 'bulk', rarity: 1, isTradeable: true, isStrategic: false, decayRule: { perDayPct: 0.3 }, sourceTypes: ['farm'], sinkTypes: ['population'] },
  { id: 'water', nameKey: 'res.water', category: 'bio', unit: 't', basePrice: 1, mass: 1.0, volume: 0.9, storageClass: 'tank', rarity: 1, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['mine', 'recycler'], sinkTypes: ['population', 'farm', 'terraform'] },
  { id: 'oxygen', nameKey: 'res.oxygen', category: 'bio', unit: 't', basePrice: 2, mass: 0.1, volume: 1.3, storageClass: 'tank', rarity: 1, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['farm'], sinkTypes: ['population'] },
  { id: 'biomass', nameKey: 'res.biomass', category: 'bio', unit: 't', basePrice: 6, mass: 0.9, volume: 0.8, storageClass: 'bulk', rarity: 2, isTradeable: true, isStrategic: false, decayRule: { perDayPct: 0.3 }, sourceTypes: ['farm'], sinkTypes: ['medicine', 'terraform'] },
  { id: 'medicine', nameKey: 'res.medicine', category: 'bio', unit: '箱', basePrice: 24, mass: 0.3, volume: 0.3, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: { perDayPct: 0.2 }, sourceTypes: ['factory'], sinkTypes: ['population', 'groundMission'] },

  // —— 能源 ——
  { id: 'powerCell', nameKey: 'res.powerCell', category: 'energy', unit: '组', basePrice: 28, mass: 0.5, volume: 0.25, storageClass: 'crate', rarity: 2, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['factory'], sinkTypes: ['building', 'ship', 'groundMission'] },
  { id: 'reactorFuel', nameKey: 'res.reactorFuel', category: 'energy', unit: '组', basePrice: 40, mass: 0.4, volume: 0.3, storageClass: 'crate', rarity: 3, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['refine'], sinkTypes: ['ship', 'station'] },

  // —— 高级资源 ——
  { id: 'quantumCrystal', nameKey: 'res.quantumCrystal', category: 'advanced', unit: '克拉', basePrice: 120, mass: 0.1, volume: 0.05, storageClass: 'vault', rarity: 5, isTradeable: true, isStrategic: true, decayRule: null, sourceTypes: ['refine', 'anomaly'], sinkTypes: ['module', 'research'] },
  { id: 'darkMatter', nameKey: 'res.darkMatter', category: 'advanced', unit: '样本', basePrice: 400, mass: 0.0, volume: 0.02, storageClass: 'vault', rarity: 5, isTradeable: false, isStrategic: true, decayRule: null, sourceTypes: ['anomaly'], sinkTypes: ['research', 'crisis'] },
  { id: 'exoticMatter', nameKey: 'res.exoticMatter', category: 'advanced', unit: '样本', basePrice: 320, mass: 0.0, volume: 0.02, storageClass: 'vault', rarity: 5, isTradeable: false, isStrategic: true, decayRule: null, sourceTypes: ['anomaly', 'crisis'], sinkTypes: ['research', 'module'] },
  { id: 'ancientData', nameKey: 'res.ancientData', category: 'advanced', unit: '份', basePrice: 150, mass: 0.0, volume: 0.0, storageClass: 'vault', rarity: 4, isTradeable: false, isStrategic: false, decayRule: null, sourceTypes: ['anomaly', 'survey'], sinkTypes: ['research', 'story'] },

  // —— 经济资源 ——
  { id: 'credits', nameKey: 'res.credits', category: 'economic', unit: 'Cr', basePrice: 1, mass: 0, volume: 0, storageClass: 'abstract', rarity: 1, isTradeable: false, isStrategic: false, decayRule: null, sourceTypes: ['tax', 'trade', 'mission'], sinkTypes: ['build', 'ship', 'policy', 'diplomacy'] },
  { id: 'influence', nameKey: 'res.influence', category: 'economic', unit: '点', basePrice: 0, mass: 0, volume: 0, storageClass: 'abstract', rarity: 1, isTradeable: false, isStrategic: false, decayRule: null, sourceTypes: ['politics', 'events'], sinkTypes: ['policy', 'diplomacy', 'claims'] },
  { id: 'researchData', nameKey: 'res.researchData', category: 'economic', unit: '份', basePrice: 10, mass: 0, volume: 0, storageClass: 'abstract', rarity: 2, isTradeable: true, isStrategic: false, decayRule: null, sourceTypes: ['survey', 'anomaly', 'lab'], sinkTypes: ['research'] },
  { id: 'intelPoints', nameKey: 'res.intelPoints', category: 'economic', unit: '点', basePrice: 0, mass: 0, volume: 0, storageClass: 'abstract', rarity: 2, isTradeable: false, isStrategic: false, decayRule: null, sourceTypes: ['intel'], sinkTypes: ['intel', 'diplomacy'] },
];

const byId = new Map(RESOURCES.map((r) => [r.id, r]));

/** 读取资源定义（未知 id 抛错 —— 防止静默伪造资源） */
export function resourceDef(id) {
  const r = byId.get(id);
  if (!r) throw new Error(`未知资源: ${id}`);
  return r;
}

export function isResource(id) {
  return byId.has(id);
}

export function allResourceIds() {
  return RESOURCES.map((r) => r.id);
}

/** 可市场交易资源 */
export function tradeableResourceIds() {
  return RESOURCES.filter((r) => r.isTradeable).map((r) => r.id);
}
