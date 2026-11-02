/**
 * content/policies.js — 政策与法令定义（任务书 4.1）
 *
 * 覆盖 4.1 规定的八类：外交立场、移民、殖民、贸易、军事动员、科研投资、
 * 人口权利、人工智能监管。每项定义：影响力成本、行政容量占用、持续时间
 * （永久政策 / 定期法令）、颁布冷却、效果算子（modifiers.getMod 消费）、
 * 预期影响文本（任务书 6.4 可解释性）。
 */

export const POLICIES = [
  // —— 外交立场（互斥对） ——
  {
    id: 'pol_detente',
    nameZh: '外交立场：睦邻缓和',
    nameEn: 'Détente',
    descZh: '主动降低边境姿态，换取谈判空间与信任积累。',
    category: 'diplomacy',
    mutexGroup: 'diplomacy_stance',
    cost: { influence: 20 },
    adminCost: 1,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'diplomacyTrustGain', mode: 'mult', value: 1.2 },
      { stat: 'warExhaustionResistance', mode: 'add', value: 5 },
    ],
    expectedZh: '预期：条约接受度上升，边境紧张自然衰退加快；军备威慑下降。',
  },
  {
    id: 'pol_deterrence',
    nameZh: '外交立场：前沿威慑',
    nameEn: 'Forward Deterrence',
    descZh: '边境舰队保持高度战备，以实力换取谈判筹码。',
    category: 'diplomacy',
    mutexGroup: 'diplomacy_stance',
    cost: { influence: 25 },
    adminCost: 2,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'damageReduction', mode: 'mult', value: 1.06 },
      { stat: 'hitChanceBonus', mode: 'add', value: 0.02 },
      { stat: 'diplomacyTrustGain', mode: 'mult', value: 0.85 },
    ],
    expectedZh: '预期：舰队生存与命中小幅提升；邻国信任积累放缓。',
  },

  // —— 移民（互斥对） ——
  {
    id: 'pol_migration_open',
    nameZh: '移民政策：门户开放',
    nameEn: 'Open Migration',
    descZh: '鼓励跨星系移民，殖民地人口快速增长，社会整合压力上升。',
    category: 'migration',
    mutexGroup: 'migration',
    cost: { influence: 15 },
    adminCost: 1,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'popGrowth', mode: 'mult', value: 1.15 },
      { stat: 'stabilityBonus', mode: 'add', value: -3 },
    ],
    expectedZh: '预期：人口增长 +15%；稳定度 −3（文化摩擦）。',
  },
  {
    id: 'pol_migration_closed',
    nameZh: '移民政策：定额管控',
    nameEn: 'Managed Quotas',
    descZh: '以配额审查取代自由流动，社会稳定但人口增长乏力。',
    category: 'migration',
    mutexGroup: 'migration',
    cost: { influence: 15 },
    adminCost: 1,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'stabilityBonus', mode: 'add', value: 4 },
      { stat: 'popGrowth', mode: 'mult', value: 0.9 },
    ],
    expectedZh: '预期：稳定度 +4；人口增长 −10%。',
  },

  // —— 殖民 ——
  {
    id: 'pol_colonial_charter',
    nameZh: '殖民特许状',
    nameEn: 'Colonial Charter',
    descZh: '向拓荒企业发放特许状，以行政背书换取扩张成本下降。',
    category: 'colonization',
    mutexGroup: null,
    cost: { influence: 30 },
    adminCost: 2,
    durationDays: null,
    cooldownDays: 60,
    effects: [
      { stat: 'colonizationCost', mode: 'mult', value: 0.82 },
      { stat: 'governanceLoad', mode: 'mult', value: 1.15 },
    ],
    expectedZh: '预期：前哨与殖民成本 −18%；治理负担 +15%。',
  },

  // —— 贸易 ——
  {
    id: 'poly_trade_regulation',
    nameZh: '贸易统制条例',
    nameEn: 'Trade Regulation',
    descZh: '官方特许船队统筹航路运力，贸易容量上升并附带价格信息优势。',
    category: 'trade',
    mutexGroup: null,
    cost: { influence: 25 },
    adminCost: 2,
    durationDays: null,
    cooldownDays: 45,
    effects: [
      { stat: 'tradeCapacity', mode: 'mult', value: 1.2 },
      { stat: 'marketPriceBonus', mode: 'mult', value: 1.05 },
    ],
    expectedZh: '预期：贸易容量 +20%，市场价格判断 +5%。',
  },

  // —— 军事动员（定期法令） ——
  {
    id: 'pol_mobilization',
    nameZh: '军事动员令',
    nameEn: 'Mobilization Decree',
    descZh: '船坞三班倒，造舰提速；代价是社会稳定与民心。',
    category: 'military',
    mutexGroup: null,
    cost: { influence: 35 },
    adminCost: 3,
    durationDays: 180,
    cooldownDays: 90,
    effects: [
      { stat: 'shipBuildSpeed', mode: 'mult', value: 1.25 },
      { stat: 'shipBuildCostReduction', mode: 'mult', value: 0.95 },
      { stat: 'stabilityBonus', mode: 'add', value: -5 },
    ],
    expectedZh: '预期：造舰速度 +25%、成本 −5%；稳定度 −5。180 日后自动失效。',
  },

  // —— 科研投资 ——
  {
    id: 'pol_research_funding',
    nameZh: '科研投资法案',
    nameEn: 'Research Funding Act',
    descZh: '公共预算向实验室倾斜，科研产出换取行政带宽。',
    category: 'research',
    mutexGroup: null,
    cost: { influence: 30 },
    adminCost: 2,
    durationDays: null,
    cooldownDays: 60,
    effects: [
      { stat: 'researchOutput', mode: 'mult', value: 1.15 },
      { stat: 'adminCapacity', mode: 'mult', value: 0.92 },
    ],
    expectedZh: '预期：科研产出 +15%；行政容量 −8%（学界挤占官僚编制）。',
  },

  // —— 人口权利 ——
  {
    id: 'pol_pop_rights',
    nameZh: '人口权利法案',
    nameEn: 'Populace Rights Act',
    descZh: '住房、医疗与工时保障写入宪章：民心所向，税基略减。',
    category: 'populace',
    mutexGroup: null,
    cost: { influence: 30 },
    adminCost: 2,
    durationDays: null,
    cooldownDays: 60,
    effects: [
      { stat: 'stabilityBonus', mode: 'add', value: 7 },
      { stat: 'popGrowth', mode: 'mult', value: 1.05 },
      { stat: 'taxRateBonus', mode: 'mult', value: 0.9 },
    ],
    expectedZh: '预期：稳定度 +7、人口增长 +5%；税收 ×0.9。',
  },

  // —— AI 监管（互斥对） ——
  {
    id: 'pol_ai_regulation',
    nameZh: '自治体监管框架',
    nameEn: 'Automata Oversight',
    descZh: '对民用自治体实施许可审计，风险可控但产出受限。',
    category: 'ai',
    mutexGroup: 'ai_policy',
    cost: { influence: 20 },
    adminCost: 1,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'adminCapacity', mode: 'mult', value: 1.08 },
      { stat: 'factoryOutput', mode: 'mult', value: 0.95 },
      { stat: 'stabilityBonus', mode: 'add', value: 2 },
    ],
    expectedZh: '预期：行政容量 +8%、稳定度 +2；工业产出 −5%。',
  },
  {
    id: 'pol_ai_liberal',
    nameZh: '自治体自由化',
    nameEn: 'Automata Liberalization',
    descZh: '放开自治体经营限制，工业与科研提速，稳定性风险上升。',
    category: 'ai',
    mutexGroup: 'ai_policy',
    cost: { influence: 25 },
    adminCost: 1,
    durationDays: null,
    cooldownDays: 30,
    effects: [
      { stat: 'factoryOutput', mode: 'mult', value: 1.15 },
      { stat: 'researchOutput', mode: 'mult', value: 1.05 },
      { stat: 'stabilityBonus', mode: 'add', value: -3 },
    ],
    expectedZh: '预期：工业产出 +15%、科研 +5%；稳定度 −3（监管真空）。',
  },

  // —— 战争经济（定期法令） ——
  {
    id: 'pol_war_economy',
    nameZh: '战争经济令',
    nameEn: 'War Economy',
    descZh: '全部产能向军工倾斜：合金激增，农田让位。',
    category: 'military',
    mutexGroup: 'war_economy',
    cost: { influence: 40 },
    adminCost: 3,
    durationDays: 180,
    cooldownDays: 90,
    effects: [
      { stat: 'alloyOutput', mode: 'mult', value: 1.18 },
      { stat: 'farmOutput', mode: 'mult', value: 0.92 },
      { stat: 'warExhaustionResistance', mode: 'add', value: 12 },
    ],
    expectedZh: '预期：合金 +18%、食物 −8%、战争疲劳抗性 +12。180 日后自动失效。',
  },
];

const byId = new Map(POLICIES.map((p) => [p.id, p]));

export function policyDef(id) {
  return byId.get(id);
}

export function allPolicies() {
  return POLICIES;
}
