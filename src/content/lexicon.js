/**
 * content/lexicon.js — 先驱者 32 词根语素字典（SPEC-39 Phase S1 / doc38 §词典）
 *
 * 四大语义域 × 8 词根，bit 0..31 与 world.narrative.lexiconMask（doc18 五阶段遗迹
 * dialect 通路）严格咬合：
 *   bit 00..07【能量与弦拓扑】（弦律织造者）—— 每词深空异象 DAG +0.25 永久线索；
 *   bit 08..15【公理与智械】（公理铸魂者）—— 每词 POI-11 终端自动排除 1 个干扰项；
 *   bit 16..23【生命与菌网】（苍翠共生体）—— 每词扫描锁定耗时 −5%（最高 −40%）；
 *   bit 24..31【时序与毁灭】（逆时观测院/余烬航居群）—— 三大终局天灾史前真相拼凑。
 *
 * translateAncientText(text, lexiconMask) 为纯函数：标记语法
 * `{lex:25|⟦0x9F·Δ·Ω⟧|毁灭}` —— mask 位为 0 渲染未破译异星符号，为 1 渲染中文词根。
 * 顶层禁止 document/window（Node 侧可安全 import）。
 */

/** 语素六元组：[bit, 词根中文, 拉丁转写, 异星符号样例, 语义域, 破译增益描述] */
export const LEXICON_ROOTS = Object.freeze([
  // —— 域一【能量与弦拓扑】bit 0..7 ——
  { bit: 0, zh: '能量', latin: 'Energia', glyph: '⟦0x11·Ξ⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 1, zh: '驻波', latin: 'Stasis-Wave', glyph: '⟦0x12·ΨΩ⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 2, zh: '锚点', latin: 'Anchor', glyph: '⟦0x13·Δ⌖⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 3, zh: '折叠', latin: 'Fold', glyph: '⟦0x14·∇λ⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 4, zh: '相位', latin: 'Phase', glyph: '⟦0x15·Φ⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 5, zh: '谐振', latin: 'Resonance', glyph: '⟦0x16·ωω⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 6, zh: '星门', latin: 'Gateway', glyph: '⟦0x17·Θ◈⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  { bit: 7, zh: '奇点', latin: 'Singularity', glyph: '⟦0x18·Ω0⟧', domain: 'string', perk: '深空异象线索 +0.25' },
  // —— 域二【公理与智械】bit 8..15 ——
  { bit: 8, zh: '逻辑', latin: 'Logikos', glyph: '⟦0x21·Λ¬⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 9, zh: '机偶', latin: 'Automata', glyph: '⟦0x22·ΠΞ⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 10, zh: '死锁', latin: 'Deadlock', glyph: '⟦0x23·⊘Σ⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 11, zh: '熔炉', latin: 'Forge', glyph: '⟦0x24· Feuer⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 12, zh: '算力', latin: 'Compute', glyph: '⟦0x25·≡²⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 13, zh: '灵魂', latin: 'Anima', glyph: '⟦0x26·Ψ✧⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 14, zh: '格式', latin: 'Format', glyph: '⟦0x27·▚∅⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  { bit: 15, zh: '归零', latin: 'Omega-Zero', glyph: '⟦0x28·Ω∅⟧', domain: 'axiom', perk: '遗迹终端排除 1 干扰项' },
  // —— 域三【生命与菌网】bit 16..23 ——
  { bit: 16, zh: '母株', latin: 'Mother-Spore', glyph: '⟦0x31·❀⊥⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 17, zh: '共生', latin: 'Symbiosis', glyph: '⟦0x32·∞♮⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 18, zh: '吞噬', latin: 'Devour', glyph: '⟦0x33·.omg⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 19, zh: '进化', latin: 'Evolve', glyph: '⟦0x34·⤴⤴⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 20, zh: '净化', latin: 'Purge', glyph: '⟦0x35·✚∇⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 21, zh: '基因', latin: 'Genome', glyph: '⟦0x36·⌬⌬⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 22, zh: '休眠', latin: 'Hibernation', glyph: '⟦0x37·zzΩ⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  { bit: 23, zh: '盖亚', latin: 'Gaia', glyph: '⟦0x38·⊕❀⟧', domain: 'symbiont', perk: '扫描锁定耗时 −5%' },
  // —— 域四【时序与毁灭】bit 24..31 ——
  { bit: 24, zh: '造物主', latin: 'Architects', glyph: '⟦0x41·△▴⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 25, zh: '毁灭', latin: 'Annihilation', glyph: '⟦0x42·Ø✖⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 26, zh: '逆时', latin: 'Retro-Time', glyph: '⟦0x43·⧖◀⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 27, zh: '视界', latin: 'Horizon', glyph: '⟦0x44·▬◯⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 28, zh: '猎手', latin: 'Hunters', glyph: '⟦0x45·➤➤⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 29, zh: '天罚', latin: 'Wrath', glyph: '⟦0x46·⚡▼⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 30, zh: '封印', latin: 'Seal', glyph: '⟦0x47·▣⊞⟧', domain: 'chronicle', perk: '终局天灾史前线索' },
  { bit: 31, zh: '飞升', latin: 'Ascension', glyph: '⟦0x48·↑∞⟧', domain: 'chronicle', perk: '终局飞升核心条件' },
]);

/** 语义域 → 中文名（词典面板分组标题） */
export const LEXICON_DOMAIN_ZH = Object.freeze({
  string: '能量与弦拓扑',
  axiom: '公理与智械',
  symbiont: '生命与菌网',
  chronicle: '时序与毁灭',
});

/** bit → 语素定义（越界返回 null） */
export function lexiconRootOf(bit) {
  if (!Number.isInteger(bit) || bit < 0 || bit > 31) return null;
  return LEXICON_ROOTS[bit] || null;
}

/** 已破译语素计数（popcount of mask；0..32） */
export function lexiconProgress(mask) {
  let m = (Number(mask) || 0) >>> 0;
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

/**
 * 先驱者文本动态破译（纯函数）。
 * 标记语法：`{lex:bit|未破译符号|已破译词根}`；
 * (lexiconMask >>> bit) & 1 === 1 → 返回【已破译词根】，否则返回未破译符号。
 * 未标记片段原样透传；bit 越界按未破译处理。
 * @param {string} text 带标记的先驱者文本
 * @param {number} lexiconMask world.narrative.lexiconMask
 * @returns {string} 渲染文本
 */
export function translateAncientText(text, lexiconMask) {
  const src = String(text == null ? '' : text);
  const mask = (Number(lexiconMask) || 0) >>> 0;
  return src.replace(/\{lex:(\d+)\|([^|]*)\|([^}]*)\}/g, (_all, bitS, undecoded, decoded) => {
    const bit = Number(bitS) | 0;
    const unlocked = bit >= 0 && bit <= 31 && ((mask >>> bit) & 1) === 1;
    return unlocked ? `【${decoded}】` : String(undecoded);
  });
}

/**
 * 词典破译度面板行（"先驱者语素破译度：14 / 32" 口径；纯函数）。
 */
export function lexiconProgressLabel(mask) {
  return `先驱者语素破译度：${lexiconProgress(mask)} / 32`;
}
