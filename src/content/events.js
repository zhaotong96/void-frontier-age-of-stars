/**
 * content/events.js — 首发事件内容（任务书 5.9 / 13.3：≥30，当前为
 * 首批可测试子集：12 个，含主线三幕锚点；随内容批次扩充）
 *
 * conditions(world) 结合世界状态；choices 携带成本与效果算子。
 * 所有文本原创。
 */

const F = (world) => world.narrative.flags;
const pid = (world) => world.playerFactionId;

export const EVENT_DEFS = [
  // ———— 主线第一幕：边疆信号 ————
  {
    id: 'evt_signal_frontier',
    titleZh: '边疆的回声',
    bodyZh: '深空阵列截获一段无法归类的窄带信号。它的调制方式古老而精确，重复周期恰好等于边域航路的最小公倍数。信号源指向一片从未测绘的星域。',
    category: 'story',
    weight: 0.5,
    once: true,
    mutexGroup: 'main',
    conditions: (world) => !F(world).signal_frontier_received &&
      (world.narrative.arcs.arc_main?.stage || 0) >= 0 &&
      Object.keys(world.entities.anomalies).length >= 2,
    choices: [
      {
        id: 'investigate', labelZh: '组建调查编队，循信号溯源', hintZh: '开启主线第一幕',
        effects: [
          { op: 'flag', key: 'signal_frontier_received' },
          { op: 'arc', arcId: 'arc_main', stage: 1 },
          { op: 'resource', resId: 'researchData', amount: 20, target: 'player' },
        ],
      },
      {
        id: 'ignore', labelZh: '存档封存，专注眼前扩张', hintZh: '主线延后（可再次触发）',
        isDefault: true,
        effects: [
          { op: 'flag', key: 'signal_frontier_received' },
        ],
      },
    ],
  },
  {
    id: 'evt_ancient_map',
    titleZh: '星图残片',
    bodyZh: '调查队在遗迹数据库中发现一份部分损毁的星图：银河边缘被标注出数个「弦锚点」，它们构成一个巨大的、刻意设计的阵列。制图者的文明没有留下名字。',
    category: 'story',
    weight: 0.45,
    once: true,
    mutexGroup: 'main',
    conditions: (world) => F(world).signal_frontier_received &&
      (world.narrative.arcs.arc_main?.stage || 0) >= 1 &&
      Object.values(world.entities.anomalies).filter((a) => a.state === 'resolved').length >= 2,
    choices: [
      {
        id: 'decode', labelZh: '投入科研力量解读弦锚点坐标', hintZh: '需要科研数据',
        cost: { researchData: 30 },
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 2 },
          { op: 'flag', key: 'chord_anchors_known' },
          { op: 'resource', resId: 'ancientData', amount: 8, target: 'player' },
        ],
      },
      {
        id: 'sell', labelZh: '将坐标出售给出价最高的文明', hintZh: '获得信用点，但他国也将染指弦锚点',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 2 },
          { op: 'flag', key: 'chord_anchors_sold' },
          { op: 'resource', resId: 'credits', amount: 1500, target: 'player' },
        ],
      },
    ],
  },

  // ———— 主线第二幕：寂静回响 ————
  {
    id: 'evt_silent_echo',
    titleZh: '寂静回响',
    bodyZh: '多个文明几乎同时宣布在边域观测到「弦锚点」的激活征兆。关于这组古代阵列的用途，各方解读截然相反：武器、方舟、灯塔，或某种更陌生的东西。猜疑开始沿航路蔓延。',
    category: 'story',
    weight: 0.5,
    once: true,
    mutexGroup: 'main',
    conditions: (world) => (world.narrative.arcs.arc_main?.stage || 0) >= 2 &&
      world.tick > 4 * 8640,
    choices: [
      {
        id: 'summit', labelZh: '召集边域峰会，寻求共同调查框架', hintZh: '外交路线：提升各族信任',
        cost: { influence: 25 },
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 3 },
          { op: 'flag', key: 'summit_held' },
          { op: 'relation', key: 'trust', b: 'ALL_AI', delta: 8 },
        ],
      },
      {
        id: 'claim', labelZh: '抢先宣布对弦锚点的主权主张', hintZh: '军事压力路线',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 3 },
          { op: 'flag', key: 'anchors_claimed' },
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: 12 },
        ],
      },
    ],
  },

  // ———— 主线第三幕：星海抉择（终局由危机结算触发） ————
  {
    id: 'evt_final_choice_gate',
    titleZh: '星海抉择',
    bodyZh: '弦锚点阵列已可以由你掌控：封存、共享、利用，或彻底摧毁。这个决定将写进银河的记忆。',
    category: 'story',
    weight: 0.9,
    once: true,
    mutexGroup: 'main',
    conditions: (world) => (world.narrative.arcs.arc_main?.stage || 0) >= 3 &&
      (world.narrative.arcs.arc_crisis?.resolved || world.tick > 9 * 8640),
    choices: [
      {
        id: 'seal', labelZh: '封存阵列：让古代造物沉入永寂', hintZh: '结局：守望者',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 4 },
          { op: 'flag', key: 'ending_seal' },
        ],
      },
      {
        id: 'share', labelZh: '共享阵列：把星图交给所有文明', hintZh: '结局：共同边疆',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 4 },
          { op: 'flag', key: 'ending_share' },
          { op: 'relation', key: 'opinion', b: 'ALL_AI', delta: 20 },
        ],
      },
      {
        id: 'harness', labelZh: '由我方独占阵列', hintZh: '结局：新霸权',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 4 },
          { op: 'flag', key: 'ending_harness' },
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 25 },
        ],
      },
      {
        id: 'destroy', labelZh: '摧毁阵列：没人应该拥有这种力量', hintZh: '结局：断弦',
        effects: [
          { op: 'arc', arcId: 'arc_main', stage: 4 },
          { op: 'flag', key: 'ending_destroy' },
        ],
      },
    ],
  },

  // ———— 政治/经济事件 ————
  {
    id: 'evt_frontier_dispute',
    titleZh: '边境摩擦',
    bodyZh: '我方边防巡逻队与邻国舰队在无主星系边界对峙，双方都宣称拥有勘探优先权。',
    category: 'politics',
    weight: 0.3,
    cooldownTicks: 720,
    conditions: (world) => {
      const rels = Object.values(world.relations.diplomacy);
      return rels.some((r) => r.contactState === 'contacted' && (r.borderTension || 0) > 30);
    },
    choices: [
      {
        id: 'deescalate', labelZh: '主动后撤，划设缓冲区', hintZh: '紧张度下降',
        isDefault: true,
        effects: [{ op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: -10 }],
      },
      {
        id: 'escalate', labelZh: '增派巡逻，宣示存在', hintZh: '紧张度上升，威慑上升',
        cost: { credits: 200 },
        effects: [
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: 8 },
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 5 },
        ],
      },
    ],
  },
  {
    id: 'evt_market_boom',
    titleZh: '边域市场繁荣',
    bodyZh: '殖民潮带来旺盛的物资需求，边域几个星系的市场价格全线上扬。商人们敦促政府把握窗口抛售库存。',
    category: 'economy',
    weight: 0.35,
    cooldownTicks: 1440,
    conditions: (world) => Object.keys(world.entities.colonies).length >= 6,
    choices: [
      {
        id: 'sell', labelZh: '抛售战略储备', hintZh: '立即获得大量信用点',
        isDefault: true,
        effects: [{ op: 'resource', resId: 'credits', amount: 800, target: 'player' }],
      },
      {
        id: 'hold', labelZh: '囤积以待更高价', hintZh: '小幅影响力收益',
        effects: [{ op: 'resource', resId: 'influence', amount: 10, target: 'player' }],
      },
    ],
  },
  {
    id: 'evt_colony_unrest',
    titleZh: '殖民地骚动',
    bodyZh: '边境殖民地的工人代表递交请愿书：轮班过长、住房紧张、医疗配给不足。行政中心建议尽快回应。',
    category: 'politics',
    weight: 0.4,
    cooldownTicks: 1080,
    conditions: (world) => Object.values(world.entities.colonies)
      .some((c) => c.factionId === pid(world) && (c.stability || 0) < 45),
    choices: [
      {
        id: 'invest', labelZh: '拨款改善民生', hintZh: '信用点换稳定度',
        cost: { credits: 500 },
        effects: [{ op: 'flag', key: 'unrest_appeased' }],
      },
      {
        id: 'suppress', labelZh: '增派驻军维持秩序', hintZh: '省钱但积累民怨',
        isDefault: true,
        effects: [
          { op: 'flag', key: 'unrest_suppressed' },
          { op: 'resource', resId: 'influence', amount: -8, target: 'player' },
        ],
      },
    ],
  },
  {
    id: 'evt_scientist_defection',
    titleZh: '流亡科学家',
    bodyZh: '一艘小型研究船请求避难：船上的材料学家声称遭到母国政治审查，愿意以毕生研究换取庇护。',
    category: 'politics',
    weight: 0.3,
    once: true,
    conditions: (world) => (world.research[pid(world)]?.completed || []).length >= 8,
    choices: [
      {
        id: 'accept', labelZh: '给予庇护', hintZh: '科研数据入账，外交轻微受损',
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'researchData', amount: 40, target: 'player' },
          { op: 'relation', key: 'opinion', b: 'ALL_AI', delta: -4 },
        ],
      },
      {
        id: 'refuse', labelZh: '婉拒，避免外交麻烦', hintZh: '无事发生',
        effects: [{ op: 'flag', key: 'defection_refused' }],
      },
    ],
  },
  {
    id: 'evt_pirate_raid',
    titleZh: '航线劫掠',
    bodyZh: '一支无旗籍的劫掠舰队出现在边域航路，袭击了孤立商队。护航需求激增。',
    category: 'world',
    weight: 0.3,
    cooldownTicks: 1440,
    conditions: (world) => Object.keys(world.entities.colonies).length >= 4,
    choices: [
      {
        id: 'convoy', labelZh: '组织护航联盟', hintZh: '消耗信用点，稳定航路',
        cost: { credits: 400 },
        isDefault: true,
        effects: [{ op: 'flag', key: 'convoy_ok' }],
      },
      {
        id: 'risk', labelZh: '让商队自行规避', hintZh: '经济微量损失',
        effects: [
          { op: 'resource', resId: 'credits', amount: -250, target: 'player' },
        ],
      },
    ],
  },
  {
    id: 'evt_anomaly_offer',
    titleZh: '异常样本竞价',
    bodyZh: '考古行会秘密接触我方外交官：他们希望收购最近回收的异常造物，出价慷慨，但交易细节见不得光。',
    category: 'exploration',
    weight: 0.35,
    cooldownTicks: 2160,
    conditions: (world) => Object.values(world.entities.anomalies)
      .some((a) => a.state === 'resolved' && a.discoveredBy === pid(world)),
    choices: [
      {
        id: 'deal', labelZh: '私下成交', hintZh: '大量信用点',
        isDefault: true,
        effects: [{ op: 'resource', resId: 'credits', amount: 900, target: 'player' }],
      },
      {
        id: 'museum', labelZh: '移交公共档案馆', hintZh: '影响力与科研数据',
        effects: [
          { op: 'resource', resId: 'influence', amount: 12, target: 'player' },
          { op: 'resource', resId: 'researchData', amount: 15, target: 'player' },
        ],
      },
    ],
  },
  {
    id: 'evt_famine_relieef',
    titleZh: '饥荒求援',
    bodyZh: '邻近的中立前哨站发出求援广播：生态循环故障导致食物断供，请求紧急援助。',
    category: 'colony',
    weight: 0.3,
    cooldownTicks: 1080,
    conditions: (world) => true,
    choices: [
      {
        id: 'aid', labelZh: '运送救援物资', hintZh: '食物支出换影响力',
        cost: { credits: 300 },
        isDefault: true,
        effects: [{ op: 'resource', resId: 'influence', amount: 10, target: 'player' }],
      },
      {
        id: 'ignore2', labelZh: '保持沉默', hintZh: '无成本，亦无收获',
        effects: [{ op: 'flag', key: 'famine_ignored' }],
      },
    ],
  },
  {
    id: 'evt_ai_envoy',
    titleZh: '自治体使节',
    bodyZh: '公理协奏体的自治使节提议交换传感网络数据：它们对边域脉冲星的监测记录远比我们的完整。',
    category: 'diplomacy',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => {
      const axiom = Object.values(world.entities.factions).find((f) => f.traitId === 'axiom');
      if (!axiom) return false;
      const rel = world.relations.diplomacy[world.playerFactionId < axiom.id
        ? `${world.playerFactionId}|${axiom.id}` : `${axiom.id}|${world.playerFactionId}`];
      return rel && rel.contactState === 'contacted';
    },
    choices: [
      {
        id: 'exchange', labelZh: '对等交换', hintZh: '科研数据 + 信任',
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'researchData', amount: 18, target: 'player' },
        ],
      },
      {
        id: 'decline', labelZh: '婉拒共享', hintZh: '保持数据孤岛',
        effects: [{ op: 'flag', key: 'envoy_declined' }],
      },
    ],
  },
];
