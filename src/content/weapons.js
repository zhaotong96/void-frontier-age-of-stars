/**
 * content/weapons.js — 伤害类型与防护抗性矩阵（任务书 5.5.2）
 *
 * 伤害类型：动能/热能/电磁/爆破/穿透/干扰。
 * 防护层：护盾/装甲/结构。各层对各类伤害有独立抗性（0-0.85），
 * 抗性叠加后由战斗系统 clamp（防无敌/负伤害 —— 任务书 5.5.2）。
 */

export const DAMAGE_TYPES = ['kinetic', 'thermal', 'em', 'explosive', 'piercing', 'jammer'];

export const DAMAGE_TYPE_NAMES = {
  kinetic: '动能', thermal: '热能', em: '电磁',
  explosive: '爆破', piercing: '穿透', jammer: '干扰',
};

/** 抗性矩阵 [防护层][伤害类型] → 抗性比例 */
export const RESIST_MATRIX = {
  shield: { kinetic: 0.55, thermal: 0.15, em: 0.35, explosive: 0.45, piercing: 0.1, jammer: 0.0 },
  armor: { kinetic: 0.35, thermal: 0.45, em: 0.15, explosive: 0.3, piercing: 0.55, jammer: 0.0 },
  structure: { kinetic: 0.05, thermal: 0.05, em: 0.05, explosive: 0.1, piercing: 0.0, jammer: 0.0 },
};

export const LAYER_NAMES = { shield: '护盾', armor: '装甲', structure: '结构' };

/** 单层有效抗性（clamp 0-0.85） */
export function layerResist(layer, damageType) {
  const r = RESIST_MATRIX[layer]?.[damageType] ?? 0;
  return Math.max(0, Math.min(0.85, r));
}
