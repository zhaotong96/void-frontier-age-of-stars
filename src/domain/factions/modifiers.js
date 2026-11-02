/**
 * domain/factions/modifiers.js — 统一修正器聚合（任务书 4.1 / 4.7 / 13.1）
 *
 * 最终修正 = 文明特质 × 科技效果 × 政策 × 难度。
 * 系统层一律通过 getMod() 取值，禁止各自散落硬编码。
 */

import { DIFFICULTY } from '../../content/constants.js';
import { FACTION_TRAITS } from '../../content/factions.js';

/** 文明特质（文明 id → { stat: value 或 {mode,value} }） */
const _traitCache = new Map();

/**
 * 取修正值。mode: 'mult' 返回乘数（默认 1），'add' 返回加数（默认 0）。
 * 聚合顺序（确定性）：特质 → 科技 → 政策。
 */
export function getMod(world, factionId, stat, mode = 'mult') {
  let acc = mode === 'mult' ? 1 : 0;
  const apply = (v, m) => {
    if (m === 'mult') acc *= v;
    else acc += v;
  };

  // 1. 文明特质
  const fac = world.entities.factions[factionId];
  if (fac) {
    const traits = FACTION_TRAITS[fac.traitId] || {};
    const t = traits[stat];
    if (t !== undefined) apply(typeof t === 'object' ? t.value : t, typeof t === 'object' ? t.mode : 'mult');
  }

  // 2. 科技
  const rs = world.research[factionId];
  if (rs && rs.effectIndex) {
    const list = rs.effectIndex[stat];
    if (list) for (const e of list) apply(e.value, e.mode);
  }

  // 3. 政策
  if (fac && fac.policies) {
    for (const pid of Object.keys(fac.policies).sort()) {
      const pol = fac.policies[pid];
      if (!pol || !pol.effects) continue;
      for (const e of pol.effects) {
        if (e.stat === stat) apply(e.value, e.mode);
      }
    }
  }

  return acc;
}

/** 难度参数（玩家与 AI 各取所需） */
export function difficultyParam(world, key) {
  return (DIFFICULTY[world.difficulty] || DIFFICULTY.standard)[key] ?? 1;
}

/** 实际产出 = 基础 × 修正（乘数） + 加数 */
export function applyMods(base, mult, add = 0) {
  return base * mult + add;
}

/** 修正来源解释（任务书 6.4：所有重要数字可解释） */
export function explainMod(world, factionId, stat) {
  const parts = [];
  const fac = world.entities.factions[factionId];
  if (fac) {
    const traits = FACTION_TRAITS[fac.traitId] || {};
    if (traits[stat] !== undefined) {
      const t = traits[stat];
      parts.push({ source: '文明特质', value: typeof t === 'object' ? t.value : t });
    }
  }
  const rs = world.research[factionId];
  if (rs && rs.effectIndex && rs.effectIndex[stat]) {
    for (const e of rs.effectIndex[stat]) {
      const tech = findTech(world, e.techId);
      parts.push({ source: `科技：${tech ? tech.nameZh : e.techId}`, value: e.value });
    }
  }
  if (fac && fac.policies) {
    for (const pid of Object.keys(fac.policies).sort()) {
      const pol = fac.policies[pid];
      if (!pol || !pol.effects) continue;
      for (const e of pol.effects) {
        if (e.stat === stat) parts.push({ source: `政策：${pol.nameZh || pid}`, value: e.value });
      }
    }
  }
  return parts;
}

function findTech(world, techId) {
  // 科技定义在 content 模块；通过世界缓存查找
  world._techIndex ||= null;
  return world._techIndex?.[techId] || null;
}
