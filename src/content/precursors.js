/**
 * content/precursors.js — 五大先驱者断代文明与异象 DAG 模板（doc35 WP-P0-1）
 *
 * 融合专家甲（doc33 叙事范式：遗物被动常驻 + 主动激活 + 1800 日全局冷却）
 * 与专家乙（doc34 数学模型：mix32 确定性 d10 检定）的综合裁定（doc35 §2.1.1）。
 *
 * 五文明各占 32 位 lexiconMask 中连续 6 位语素段；集满 6 条线索触发母星系揭示。
 * 确定性红线：本文件为纯静态数据，零函数、零 Math.random。
 */

/** 先驱者文明定义（doc35 §2.1.1 五大文明，奖励结构对齐 doc34 §2.2 表） */
export const PRECURSORS = [
  {
    id: 'prec_chord_weavers',
    nameZh: '弦网织造者',
    nameEn: 'Chord Weavers',
    eraZh: '距今 140 万年 · 超空间弦拓扑与零点引力工程',
    demiseZh: '同步全银河 12 座主弦锚点跃入高维时引发真空相变反冲，全族被量子化抹除（crisis_rift 史前源头）',
    lexiconBits: [0, 5],          // 32 位语素掩码中的 6 个弦拓扑语素
    clueCount: 6,
    systemTraitZh: '双黑洞伴星系统 + 残破弦星门巨构',
    reward: { ancientData: 30 },
    techUnlock: 'tech_chord_phase_jump',
    techDescZh: '舰队无视航路直接点对点弦跃迁（冷却 15 天）',
    relic: {
      id: 'relic_chord_tuning_fork',
      nameZh: '织弦者星盘',
      passiveZh: '全舰队超空间航路时数 -15%、传感器强度 +20%',
      activeCost: { ancientData: 15 },
      activeEffect: 'phase_tailwind',   // 360 日全帝国跃迁零燃料消耗
      activeDays: 360,
    },
  },
  {
    id: 'prec_silicate_lattice',
    nameZh: '硅基谐振体',
    nameEn: 'Silicate Lattice',
    eraZh: '距今 42 万年 · 唯心硅基集体意识与恒星锻造',
    demiseZh: '晶格主脑推演宇宙终极公理时陷入哥德尔不完备死锁，底层机偶失控格式化主脑（crisis_automata 源头）',
    lexiconBits: [6, 11],
    clueCount: 6,
    systemTraitZh: 'ancient_megastructure 旗舰机械废墟星 + 沉睡无畏舰',
    reward: { quantumCrystal: 25 },
    techUnlock: 'tech_lattice_overclock',
    techDescZh: '全帝国科研产出 +20%、舰船算力上限 +25%',
    relic: {
      id: 'relic_lattice_prime_mold',
      nameZh: '初号逻辑母模',
      passiveZh: '全帝国 alloy 与 conductor 产出 +15%、船坞造舰速度 +20%',
      activeCost: { ferro: 500 },
      activeEffect: 'mass_convert',     // 瞌时转化 250 alloy + 50 quantumCore
      activeGain: { alloy: 250, quantumCore: 50 },
      activeDays: 0,
    },
  },
  {
    id: 'prec_mycelial_hive',
    nameZh: '万菌共生体',
    nameEn: 'Mycelial Hive',
    eraZh: '距今 85 万年 · 行星级菌丝神经网络与基因雕琢',
    demiseZh: '过度催发吞噬基因抵御硅基机偶扩张，母星菌丝网失控暴走进入万年休眠孢囊态',
    lexiconBits: [12, 17],
    clueCount: 6,
    systemTraitZh: 'biolume_canopy S 级活体母星',
    reward: { biomass: 200 },
    techUnlock: 'tech_living_hull_regen',
    techDescZh: '所有战舰每战斗秒自动回复 0.8% 结构与装甲，殖民地宜居度 +15',
    relic: {
      id: 'relic_hive_dormant_amber',
      nameZh: '休眠母株琥珀',
      passiveZh: '全殖民地宜居度 +10、人口增长率 +15%、生态污染自然衰减翻倍',
      activeCost: { biomass: 300 },
      activeEffect: 'terraboost',       // 目标宜居行星宜居度永久 +25
      activeDays: 0,
    },
  },
  {
    id: 'prec_cryo_eternals',
    nameZh: '永冻守望者',
    nameEn: 'Cryo Eternals',
    eraZh: '距今 210 万年 · 逆熵热寂逃逸与绝对零度工程',
    demiseZh: '三颗恒星包裹进吸热戴森冷壳后核心聚变抑制器故障，全族在极夜冰封休眠舱中永远失去唤醒信号',
    lexiconBits: [18, 23],
    clueCount: 6,
    systemTraitZh: '黑矮星（冷寂恒星）+ 巨型低温休眠母舰',
    reward: { exoticMatter: 10 },
    techUnlock: 'tech_zero_kelvin_sink',
    techDescZh: '战舰散热效率 +40%，电子战静默特征值 -35%',
    relic: {
      id: 'relic_cryo_black_dial',
      nameZh: '零度守望怀表',
      passiveZh: '全舰队热幅能容量 +25%、散热速率 +20%',
      activeCost: { exoticMatter: 4 },
      activeEffect: 'cryo_vent',        // 180 日全舰队散热速率 +100%
      activeDays: 180,
    },
  },
  {
    id: 'prec_void_meditators',
    nameZh: '虚空沉思者',
    nameEn: 'Void Meditators',
    eraZh: '距今 60 万年 · 超维精神拓印与意识网络',
    demiseZh: '集体意识升华投入超空间织网时发现织网深处盘踞高维吞噬者，全族意识被静默拖入织网深处',
    lexiconBits: [24, 29],
    clueCount: 6,
    systemTraitZh: '意识孤峰环形遗迹 + 灵能帷幕星云',
    reward: { ancientData: 20, darkMatter: 6 },
    techUnlock: 'tech_void_mindweb',
    techDescZh: '全舰队命中率 +10%，角色经验获取 +25%',
    relic: {
      id: 'relic_void_mind_lattice',
      nameZh: '虚空沉思棱镜',
      passiveZh: '全舰队命中率 +8%、闪避 +8%',
      activeCost: { ancientData: 10 },
      activeEffect: 'mind_veil',        // 360 日全舰队被探测特征值 -50%
      activeDays: 360,
    },
  },
];

export const PRECURSOR_BY_ID = Object.fromEntries(PRECURSORS.map((p) => [p.id, p]));

/**
 * 异象 DAG 节点模板（doc34 §2.2.1 四级 DAG + doc33 §2.2 分支抉择范式）。
 * 每节点：id、titleZh、difficulty(2..8)、choices（受挫赌注选项）；
 * 线索位：节点完成时点亮的先驱者语素位索引（对应 lexiconBits 内 0..5 相对序）。
 * 纯静态数据；分支确定性：同一 (seed, anomalyId, stageIdx, attempts) 恒定。
 */
export const ANOMALY_DAG_TEMPLATES = {
  dag_ancient_gallery: {
    id: 'dag_ancient_gallery',
    nameZh: '远古星图回廊',
    rootId: 'n1',
    nodes: {
      n1: { id: 'n1', stage: 1, titleZh: '外环残垣辨识', difficulty: 3, clueBit: 0,
        choices: [
          { id: 'overload', nameZh: '强行过载破障', cost: { powerCell: 4 }, effect: 'clues3' },
          { id: 'caution', nameZh: '谨慎规避重测', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '激进强拆', cost: null, effect: 'close_alloy' },
        ] },
      n2: { id: 'n2', stage: 2, titleZh: '非欧几何方程碑', difficulty: 4, clueBit: 1,
        choices: [
          { id: 'overload', nameZh: '注入电力重启投影', cost: { powerCell: 6 }, effect: 'clues3' },
          { id: 'caution', nameZh: '记录后绕行', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '切割取样', cost: null, effect: 'close_alloy' },
        ] },
      n3: { id: 'n3', stage: 3, titleZh: '深层核心密室', difficulty: 6, clueBit: 2,
        choices: [
          { id: 'overload', nameZh: '过载激活远古反应堆', cost: { conductor: 10 }, effect: 'clues3' },
          { id: 'caution', nameZh: '保守测绘', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '定向爆破', cost: null, effect: 'close_alloy' },
        ] },
      n4: { id: 'n4', stage: 4, titleZh: '先驱者语素核心', difficulty: 8, clueBit: 3,
        choices: [
          { id: 'overload', nameZh: '逆向注入解密脚本', cost: { ancientData: 5 }, effect: 'clues3' },
          { id: 'caution', nameZh: '等待缓释译解', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '强拆核心', cost: null, effect: 'close_alloy' },
        ] },
    },
  },
  dag_tidal_rift: {
    id: 'dag_tidal_rift',
    nameZh: '潮汐裂隙',
    rootId: 'n1',
    nodes: {
      n1: { id: 'n1', stage: 1, titleZh: '引力透镜时间偏移测量', difficulty: 3, clueBit: 0,
        choices: [
          { id: 'overload', nameZh: '投入奇异物质稳固虫洞', cost: { exoticMatter: 2 }, effect: 'clues3' },
          { id: 'caution', nameZh: '远距观测', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '引爆引力结收割暗物质', cost: null, effect: 'close_darkmatter' },
        ] },
      n2: { id: 'n2', stage: 2, titleZh: '半透明折叠前哨', difficulty: 5, clueBit: 1,
        choices: [
          { id: 'overload', nameZh: '相位潜入', cost: { powerCell: 8 }, effect: 'clues3' },
          { id: 'caution', nameZh: '环绕扫描', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '拆解前哨', cost: null, effect: 'close_alloy' },
        ] },
      n3: { id: 'n3', stage: 3, titleZh: '弦锚双结引力井', difficulty: 7, clueBit: 2,
        choices: [
          { id: 'overload', nameZh: '谐振对光', cost: { ancientData: 4 }, effect: 'clues3' },
          { id: 'caution', nameZh: '被动接收', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '切断锚链', cost: null, effect: 'close_alloy' },
        ] },
      n4: { id: 'n4', stage: 4, titleZh: '相变视界薄膜', difficulty: 8, clueBit: 3,
        choices: [
          { id: 'overload', nameZh: '定量投送暗物质', cost: { darkMatter: 2 }, effect: 'clues3' },
          { id: 'caution', nameZh: '等待潮汐窗口', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '撤离并封存', cost: null, effect: 'close_alloy' },
        ] },
    },
  },
  dag_silent_forest: {
    id: 'dag_silent_forest',
    nameZh: '永夜晶荒',
    rootId: 'n1',
    nodes: {
      n1: { id: 'n1', stage: 1, titleZh: '超流体氦湖勘察', difficulty: 2, clueBit: 0,
        choices: [
          { id: 'overload', nameZh: '热能井钻探', cost: { powerCell: 3 }, effect: 'clues3' },
          { id: 'caution', nameZh: '表层取样', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '贪婪抽取', cost: null, effect: 'close_alloy' },
        ] },
      n2: { id: 'n2', stage: 2, titleZh: '吸热黑体独石', difficulty: 5, clueBit: 1,
        choices: [
          { id: 'overload', nameZh: '逆向馈能读数', cost: { powerCell: 6 }, effect: 'clues3' },
          { id: 'caution', nameZh: '黑体测温', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '凿取样本', cost: null, effect: 'close_alloy' },
        ] },
      n3: { id: 'n3', stage: 3, titleZh: '零热辐射幽灵探测器', difficulty: 6, clueBit: 2,
        choices: [
          { id: 'overload', nameZh: '唤醒协议注入', cost: { ancientData: 3 }, effect: 'clues3' },
          { id: 'caution', nameZh: '静默跟随', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '捕获拆解', cost: null, effect: 'close_alloy' },
        ] },
      n4: { id: 'n4', stage: 4, titleZh: '液态甲烷海底休眠方舟', difficulty: 8, clueBit: 3,
        choices: [
          { id: 'overload', nameZh: '破冰深潜', cost: { conductor: 12 }, effect: 'clues3' },
          { id: 'caution', nameZh: '声呐测绘', cost: null, effect: 'clues0' },
          { id: 'demolish', nameZh: '切割舱门', cost: null, effect: 'close_alloy' },
        ] },
    },
  },
};

export const DAG_TEMPLATE_IDS = Object.keys(ANOMALY_DAG_TEMPLATES);
