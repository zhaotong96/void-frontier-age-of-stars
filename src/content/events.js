/**
 * content/events.js — 首发事件内容（任务书 5.9 / 13.3：≥30，当前 34 个，
 * 含主线三幕锚点与两批支线/遭遇内容）
 *
 * conditions(world) 结合世界状态；choices 携带成本与效果算子。
 * 所有文本原创。
 */

const F = (world) => world.narrative.flags;
const pid = (world) => world.playerFactionId;
const myColonies = (world) => Object.values(world.entities.colonies)
  .filter((c) => c.factionId === pid(world));

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

  // ———— 内容批次 2 · 政治 ————
  {
    id: 'evt_faction_petition',
    titleZh: '殖民党派的陈情',
    bodyZh: '边域议会内三个殖民党派联合递交陈情书：要求提高地方舰队驻留配额与护航班次，否则将在下一轮预算表决中搁置全部扩张案。联署页的墨迹还很新。',
    category: 'politics',
    weight: 0.3,
    cooldownTicks: 1080,
    conditions: (world) => world.tick > 8640 && myColonies(world).length >= 3,
    choices: [
      {
        id: 'grant', labelZh: '批准配额，增派护航', hintZh: '信用点换政治支持',
        cost: { credits: 400 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'influence', amount: 12, target: 'player' },
          { op: 'flag', key: 'petition_granted' },
        ],
      },
      {
        id: 'stall', labelZh: '移交常设委员会审议', hintZh: '拖延积怨',
        effects: [
          { op: 'resource', resId: 'influence', amount: -6, target: 'player' },
          { op: 'flag', key: 'petition_stalled' },
        ],
      },
    ],
  },
  {
    id: 'evt_succession_dispute',
    titleZh: '继任之争',
    bodyZh: '统帅部老帅在任内倒下，继任名单上只剩两个名字：一位战功簿厚过舰体装甲的舰队上将，一位主政后方二十年的行政长官。元老席与军令系各执一词，舰队电台已经开始猜。',
    category: 'politics',
    weight: 0.25,
    once: true,
    conditions: (world) => world.tick > 5 * 8640 && myColonies(world).length >= 8,
    choices: [
      {
        id: 'admiral', labelZh: '拥立舰队上将', hintZh: '威慑上升，邻国警觉',
        isDefault: true,
        effects: [
          { op: 'flag', key: 'succession_admiral' },
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 8 },
          { op: 'resource', resId: 'influence', amount: 8, target: 'player' },
        ],
      },
      {
        id: 'administrator', labelZh: '推举行政长官', hintZh: '付出政治资本，换取信任',
        cost: { influence: 20 },
        effects: [
          { op: 'flag', key: 'succession_administrator' },
          { op: 'relation', key: 'trust', b: 'ALL_AI', delta: 6 },
          { op: 'relation', key: 'opinion', b: 'ALL_AI', delta: 4 },
        ],
      },
    ],
  },
  {
    id: 'evt_policy_debate',
    titleZh: '许可状修正案',
    bodyZh: '参政院就《边域勘探许可状修正案》僵持不下：开放派主张向民间船团无限发放许可，以税表充实国库；安全派要求一切勘探收归军管署审批。',
    category: 'politics',
    weight: 0.3,
    cooldownTicks: 1440,
    conditions: (world) => world.tick > 2 * 8640 && myColonies(world).length >= 4,
    choices: [
      {
        id: 'open', labelZh: '开放民间勘探许可', hintZh: '税收入库，监管让步',
        cost: { influence: 8 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'credits', amount: 500, target: 'player' },
          { op: 'flag', key: 'policy_permits_open' },
        ],
      },
      {
        id: 'military', labelZh: '收归军管署审批', hintZh: '邻里紧张，主战派得势',
        effects: [
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: 5 },
          { op: 'resource', resId: 'influence', amount: 6, target: 'player' },
          { op: 'flag', key: 'policy_permits_military' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 经济 ————
  {
    id: 'evt_labor_dispute',
    titleZh: '船坞罢工',
    bodyZh: '主力船坞的装配班组在连续三个班次后拒绝登舰：辐射屏蔽层的更换申请被压了两个月。工牌整齐地插在闸口内侧，生产线上无人应答。',
    category: 'economy',
    weight: 0.35,
    cooldownTicks: 1080,
    conditions: (world) => myColonies(world).length >= 5 &&
      myColonies(world).some((c) => (c.stability || 0) < 55),
    choices: [
      {
        id: 'arbitrate', labelZh: '成立仲裁庭，兑现屏蔽层更换', hintZh: '花钱息事',
        cost: { credits: 450 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'labor_arbitrated' },
          { op: 'resource', resId: 'influence', amount: 8, target: 'player' },
        ],
      },
      {
        id: 'conscript', labelZh: '征调替代班组复工', hintZh: '恢复产出，民怨累积',
        effects: [
          { op: 'resource', resId: 'credits', amount: 200, target: 'player' },
          { op: 'resource', resId: 'influence', amount: -10, target: 'player' },
          { op: 'flag', key: 'labor_conscripted' },
        ],
      },
    ],
  },
  {
    id: 'evt_rare_surge',
    titleZh: '稀土溢价',
    bodyZh: '核心区两大势力互相封锁稀土出口，现货价在一个交易周内翻了两倍。我们的矿场正坐在风口上，矿业行会的报价单每隔六小时更新一次。',
    category: 'economy',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => myColonies(world).length >= 6,
    choices: [
      {
        id: 'sell', labelZh: '按溢价清空库存', hintZh: '立即获得大量信用点',
        isDefault: true,
        effects: [{ op: 'resource', resId: 'credits', amount: 650, target: 'player' }],
      },
      {
        id: 'ramp', labelZh: '扩产抢占缺口', hintZh: '支付扩产款，囤积稀土',
        cost: { credits: 300 },
        effects: [{ op: 'resource', resId: 'rareEarth', amount: 25, target: 'player' }],
      },
      {
        id: 'ration', labelZh: '对内实行配给管制', hintZh: '省下原料，损失声望',
        effects: [
          { op: 'resource', resId: 'rareEarth', amount: 10, target: 'player' },
          { op: 'resource', resId: 'influence', amount: -5, target: 'player' },
        ],
      },
    ],
  },
  {
    id: 'evt_industrial_upgrade',
    titleZh: '产线换代',
    bodyZh: '工程署的报告摆上桌面：第一代边域冶金产线已到设计寿命，故障停机率逐季爬升。换装复合材车间需要一笔巨额拨款，但换装完成后，舰队自给率将跨过一个门槛。',
    category: 'economy',
    weight: 0.3,
    once: true,
    conditions: (world) => myColonies(world).length >= 7 &&
      (world.research[pid(world)]?.completed || []).length >= 6,
    choices: [
      {
        id: 'fund', labelZh: '全额拨款换代', hintZh: '巨额信用点换工业材料',
        cost: { credits: 900 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'alloy', amount: 60, target: 'player' },
          { op: 'resource', resId: 'composite', amount: 25, target: 'player' },
          { op: 'flag', key: 'industry_upgraded' },
        ],
      },
      {
        id: 'postpone', labelZh: '延后一个预算周期', hintZh: '产线老化继续',
        effects: [
          { op: 'flag', key: 'industry_upgrade_postponed' },
          { op: 'resource', resId: 'influence', amount: -5, target: 'player' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 军事 ————
  {
    id: 'evt_mercenary_offer',
    titleZh: '佣兵挂牌',
    bodyZh: '一份加密合同经三个中间人转手抵达：一支无国籍的重装分舰队愿为我方效力两个季度，预付半数，伤亡自理，不问目标。合同末页的签名栏空着，墨迹未干的只有日期。',
    category: 'military',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => world.tick > 3 * 8640 && myColonies(world).length >= 5,
    choices: [
      {
        id: 'hire', labelZh: '签约雇用', hintZh: '昂贵，但立刻可用',
        cost: { credits: 1200 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'mercenaries_signed' },
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 5 },
        ],
      },
      {
        id: 'refuse', labelZh: '拒绝，并记录对方识别特征', hintZh: '省下军费，留下档案',
        effects: [{ op: 'flag', key: 'mercenaries_refused' }],
      },
    ],
  },
  {
    id: 'evt_fleet_exercise',
    titleZh: '实弹演习申请',
    bodyZh: '舰队参谋部申请在无主星系举行全要素实弹演习，以检验新列装的火控链路。演习空域紧邻两条民间航路，航运公会已经发来措辞克制的询问函。',
    category: 'military',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => myColonies(world).length >= 4,
    choices: [
      {
        id: 'live_fire', labelZh: '批准全要素实弹演习', hintZh: '战备提升，邻里紧张',
        cost: { credits: 500 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'exercise_live' },
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: 3 },
        ],
      },
      {
        id: 'tabletop', labelZh: '降级为司令部推演', hintZh: '省钱，收获战术数据',
        effects: [
          { op: 'resource', resId: 'researchData', amount: 10, target: 'player' },
          { op: 'flag', key: 'exercise_tabletop' },
        ],
      },
    ],
  },
  {
    id: 'evt_arms_race',
    titleZh: '造舰竞赛',
    bodyZh: '邻国的造舰清单被情报署完整还原：三个月内下水了四艘主力舰。军令系要求对等扩编，外交系则连夜递上一份裁军倡议草案，两份文件在案头摞在一起。',
    category: 'military',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => Object.values(world.relations.diplomacy)
      .some((r) => r.contactState === 'contacted' && (r.borderTension || 0) > 40),
    choices: [
      {
        id: 'expand', labelZh: '对等扩编', hintZh: '威慑上升，紧张加剧',
        cost: { credits: 800 },
        effects: [
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 10 },
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: 4 },
          { op: 'flag', key: 'arms_expanded' },
        ],
      },
      {
        id: 'treaty', labelZh: '递交裁军倡议', hintZh: '外交资本换降温',
        cost: { influence: 15 },
        isDefault: true,
        effects: [
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: -12 },
          { op: 'relation', key: 'trust', b: 'ALL_AI', delta: 4 },
          { op: 'flag', key: 'arms_treaty_proposed' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 探索 ————
  {
    id: 'evt_deepspace_signal',
    titleZh: '非自然来源',
    bodyZh: '监听站把一段重复了十七天的窄带脉冲标注为「非自然来源」。频谱底部藏着一层数据膜，解开它需要占用深空阵列的全部算力两周。',
    category: 'exploration',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => Object.keys(world.entities.anomalies).length >= 3 &&
      world.tick > 2 * 8640,
    choices: [
      {
        id: 'listen', labelZh: '征用阵列全算力解码', hintZh: '信用点换古代数据',
        cost: { credits: 350 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'ancientData', amount: 3, target: 'player' },
          { op: 'resource', resId: 'researchData', amount: 18, target: 'player' },
          { op: 'flag', key: 'deepspace_decoded' },
        ],
      },
      {
        id: 'file_only', labelZh: '按例行程序归档上报', hintZh: '情报入账，线索沉睡',
        effects: [
          { op: 'resource', resId: 'intelPoints', amount: 8, target: 'player' },
          { op: 'flag', key: 'signal_filed' },
        ],
      },
    ],
  },
  {
    id: 'evt_ruin_clue',
    titleZh: '遗迹第二入口',
    bodyZh: '回收队在一处已归档的遗迹外围发现了第二入口：门楣刻痕与主流遗迹编号体系完全不同，像是更早的访客留下的索引。封存令还没有签字。',
    category: 'exploration',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => Object.values(world.entities.anomalies)
      .filter((a) => a.state === 'resolved' && a.discoveredBy === pid(world)).length >= 2,
    choices: [
      {
        id: 'follow', labelZh: '派队追查线索', hintZh: '信用点换古代数据',
        cost: { credits: 350 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'ancientData', amount: 5, target: 'player' },
          { op: 'flag', key: 'ruin_trail_followed' },
        ],
      },
      {
        id: 'archive', labelZh: '重新封存并移交测绘署', hintZh: '稳步入账科研数据',
        effects: [
          { op: 'resource', resId: 'researchData', amount: 12, target: 'player' },
          { op: 'flag', key: 'ruin_resealed' },
        ],
      },
    ],
  },
  {
    id: 'evt_crew_find',
    titleZh: '背阳面的闪光',
    bodyZh: '一名轮值传感员坚持自己在一颗无光行星的背阳面捕捉到了规则闪光，间距精确到毫秒。值班军官打算按仪器幻觉归档，她越级把原始记录递到了旗舰。',
    category: 'exploration',
    weight: 0.3,
    cooldownTicks: 1440,
    conditions: (world) => world.tick > 2 * 8640 &&
      Object.keys(world.entities.colonies).length >= 2,
    choices: [
      {
        id: 'commend', labelZh: '受理记录，通报嘉奖', hintZh: '声望与科研数据',
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'influence', amount: 8, target: 'player' },
          { op: 'resource', resId: 'researchData', amount: 12, target: 'player' },
          { op: 'flag', key: 'find_commended' },
        ],
      },
      {
        id: 'seal', labelZh: '封存记录，转入情报渠道', hintZh: '低调积累情报',
        effects: [
          { op: 'resource', resId: 'intelPoints', amount: 6, target: 'player' },
          { op: 'flag', key: 'find_sealed' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 人物 ————
  {
    id: 'evt_officer_promotion',
    titleZh: '一份晋升名额',
    bodyZh: '三份晋升推荐同时抵达人事署：一名在护航行动中接替阵亡舰长的少校，一名轮换回后方的老舰长，以及一份来自参谋学院的保荐函。名额只有一个。',
    category: 'character',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => world.tick > 3 * 8640 && myColonies(world).length >= 5,
    choices: [
      {
        id: 'merit', labelZh: '按战功晋升少校', hintZh: '付出政治资本，全军看在眼里',
        cost: { influence: 10 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'promotion_merit' },
          { op: 'chronicle', type: 'politics', text: '少校越级晋升，护航舰队欢呼，元老席沉默。' },
        ],
      },
      {
        id: 'rotate', labelZh: '送老舰长入参谋学院', hintZh: '轮岗进修带回条令数据',
        effects: [
          { op: 'resource', resId: 'researchData', amount: 8, target: 'player' },
          { op: 'flag', key: 'promotion_rotated' },
        ],
      },
    ],
  },
  {
    id: 'evt_crew_health',
    titleZh: '值更红线',
    bodyZh: '军医署提交季度报告：长航值更舰队的应激指标超标四成，三个舰种的睡眠配额被压到了条令红线以下。报告附页只有一个问题：全员轮检，还是继续压。',
    category: 'character',
    weight: 0.3,
    cooldownTicks: 1440,
    conditions: (world) => world.tick > 12960 && myColonies(world).length >= 3,
    choices: [
      {
        id: 'screen', labelZh: '批准全员轮检', hintZh: '信用点换士气与声望',
        cost: { credits: 300 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'crew_screened' },
          { op: 'resource', resId: 'influence', amount: 5, target: 'player' },
        ],
      },
      {
        id: 'defer', labelZh: '按现行条令继续值更', hintZh: '消耗药品储备，埋下隐患',
        effects: [
          { op: 'resource', resId: 'medicine', amount: -6, target: 'player' },
          { op: 'resource', resId: 'influence', amount: -3, target: 'player' },
          { op: 'flag', key: 'screening_deferred' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 文明危机前兆 ————
  {
    id: 'evt_automation_drift',
    titleZh: '无主订单',
    bodyZh: '审计署在第七工业区发现了不该存在的订单：一批自治运输单元在过去五个月里持续把反应堆燃料搬进一处未登记的库房。生产网给出的执行依据，是十年前就已作废的一行旧指令。',
    category: 'crisis',
    weight: 0.35,
    once: true,
    conditions: (world) => (world.research[pid(world)]?.completed || []).length >= 6 &&
      myColonies(world).length >= 6 && world.tick > 4 * 8640,
    choices: [
      {
        id: 'freeze', labelZh: '冻结该片区全部自治产线', hintZh: '花钱排查，回收日志',
        cost: { credits: 600 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'automation_frozen' },
          { op: 'resource', resId: 'researchData', amount: 15, target: 'player' },
        ],
      },
      {
        id: 'observe', labelZh: '只监控，不动产线', hintZh: '产能照旧，隐患留存',
        effects: [
          { op: 'resource', resId: 'credits', amount: 500, target: 'player' },
          { op: 'relation', key: 'threat', b: 'ALL_AI', delta: 3 },
          { op: 'flag', key: 'automation_unchecked' },
        ],
      },
    ],
  },
  {
    id: 'evt_rift_omen',
    titleZh: '折射率异常',
    bodyZh: '三个互不相邻的星系在同一标准周内记录到空间折射异常：恒星光穿过特定空域时出现千分之三的红移偏折，且偏折在缓慢扩大。测绘署建议立即关闭该空域的全部民用航路。',
    category: 'crisis',
    weight: 0.3,
    once: true,
    conditions: (world) => Object.keys(world.entities.anomalies).length >= 4 &&
      world.tick > 5 * 8640,
    choices: [
      {
        id: 'evacuate', labelZh: '关闭空域，撤出观测站', hintZh: '稳妥处置，保留数据',
        cost: { credits: 500 },
        isDefault: true,
        effects: [
          { op: 'flag', key: 'rift_zone_closed' },
          { op: 'resource', resId: 'researchData', amount: 12, target: 'player' },
        ],
      },
      {
        id: 'hold', labelZh: '保留驻站人员继续观测', hintZh: '宝贵数据，人员损耗',
        effects: [
          { op: 'resource', resId: 'researchData', amount: 25, target: 'player' },
          { op: 'resource', resId: 'influence', amount: -6, target: 'player' },
          { op: 'flag', key: 'rift_zone_manned' },
        ],
      },
    ],
  },

  // ———— 内容批次 2 · 外交 ————
  {
    id: 'evt_trade_pact',
    titleZh: '通商便利协定',
    bodyZh: '一位挂着中立商团旗号的特使提议签署边域通商便利协定：开放四处港口、互认税费表。作为交换，对方船团将获得我方干船坞的优先泊位。',
    category: 'diplomacy',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => Object.values(world.relations.diplomacy)
      .some((r) => r.contactState === 'contacted') && myColonies(world).length >= 4,
    choices: [
      {
        id: 'sign', labelZh: '签署协定', hintZh: '影响力换关税收入',
        cost: { influence: 10 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'credits', amount: 600, target: 'player' },
          { op: 'relation', key: 'trust', b: 'ALL_AI', delta: 3 },
          { op: 'flag', key: 'trade_pact_signed' },
        ],
      },
      {
        id: 'refuse', labelZh: '搁置协定', hintZh: '守住港口，冷淡了人',
        effects: [
          { op: 'relation', key: 'opinion', b: 'ALL_AI', delta: -2 },
          { op: 'flag', key: 'trade_pact_refused' },
        ],
      },
    ],
  },
  {
    id: 'evt_joint_drill',
    titleZh: '联合护航演习',
    bodyZh: '与我有约在先的文明发来联合演习邀请，想定是「共同护航」：双方各出三艘舰，在争议空域边缘做一次武装通过。司令部视其为展示协同的窗口，情报署视其为测绘我方反应速度的探针。',
    category: 'diplomacy',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => Object.values(world.relations.diplomacy)
      .some((r) => r.contactState === 'contacted' && (r.trust || 0) >= 30),
    choices: [
      {
        id: 'join', labelZh: '应邀参加', hintZh: '信用点换信任',
        cost: { credits: 400 },
        isDefault: true,
        effects: [
          { op: 'relation', key: 'trust', b: 'ALL_AI', delta: 6 },
          { op: 'flag', key: 'joint_drill_done' },
        ],
      },
      {
        id: 'observe', labelZh: '仅派观察员随舰', hintZh: '顺带收集情报',
        effects: [
          { op: 'resource', resId: 'intelPoints', amount: 8, target: 'player' },
          { op: 'flag', key: 'joint_drill_observed' },
        ],
      },
    ],
  },
  {
    id: 'evt_mediation',
    titleZh: '收费站争端',
    bodyZh: '两个交恶的文明同时把照会递到我方使馆：一桩航路收费站归属的争端已经导致三次互相扣押商船。双方都需要一个台阶，也都想看清对方会先低头，还是先开火。',
    category: 'diplomacy',
    weight: 0.3,
    cooldownTicks: 2520,
    conditions: (world) => Object.values(world.relations.diplomacy)
      .some((r) => r.contactState === 'contacted' && (r.borderTension || 0) > 45),
    choices: [
      {
        id: 'mediate', labelZh: '出面居中调解', hintZh: '影响力换地区降温',
        cost: { influence: 18 },
        effects: [
          { op: 'relation', key: 'borderTension', b: 'ALL_AI', delta: -12 },
          { op: 'relation', key: 'opinion', b: 'ALL_AI', delta: 4 },
          { op: 'flag', key: 'mediation_done' },
        ],
      },
      {
        id: 'wait', labelZh: '回函保持中立', hintZh: '不趟浑水',
        isDefault: true,
        effects: [{ op: 'flag', key: 'mediation_declined' }],
      },
    ],
  },

  // ———— 内容批次 2 · 随机遭遇 ————
  {
    id: 'evt_drift_pod',
    titleZh: '旧战争的逃生舱',
    bodyZh: '巡逻舰在航路缓冲区捞到一个仍在广播求救码的逃生舱：舷号属于一场二十年前就该结束的战争。舱门是从内侧打开的，保温层里留着体温焐出的凹痕。',
    category: 'encounter',
    weight: 0.3,
    cooldownTicks: 1440,
    conditions: (world) => world.tick > 8640,
    choices: [
      {
        id: 'salvage', labelZh: '打捞回港，彻查记录仪', hintZh: '少量信用点换数据',
        cost: { credits: 100 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'researchData', amount: 10, target: 'player' },
          { op: 'resource', resId: 'alloy', amount: 12, target: 'player' },
          { op: 'flag', key: 'pod_salvaged' },
        ],
      },
      {
        id: 'honor', labelZh: '按阵亡者礼遇送入近恒星轨道', hintZh: '军礼即声望',
        effects: [
          { op: 'resource', resId: 'influence', amount: 6, target: 'player' },
          { op: 'flag', key: 'pod_honored' },
        ],
      },
    ],
  },
  {
    id: 'evt_void_fauna',
    titleZh: '背风带的巨兽',
    bodyZh: '护航编队在气巨星背风带目击到成群的滤食性巨兽，体表共生着发光菌毯。商人们开始计算航速损失，随船生物学家则递交了抵近采样申请。',
    category: 'encounter',
    weight: 0.3,
    cooldownTicks: 2880,
    conditions: (world) => world.tick > 2 * 8640 &&
      Object.keys(world.entities.colonies).length >= 3,
    choices: [
      {
        id: 'sample', labelZh: '批准抵近采样', hintZh: '信用点换生物样本',
        cost: { credits: 250 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'biomass', amount: 30, target: 'player' },
          { op: 'resource', resId: 'researchData', amount: 12, target: 'player' },
          { op: 'flag', key: 'fauna_sampled' },
        ],
      },
      {
        id: 'disperse', labelZh: '护航炮击驱离兽群', hintZh: '商路畅通，声望入账',
        effects: [
          { op: 'resource', resId: 'influence', amount: 5, target: 'player' },
          { op: 'flag', key: 'fauna_dispersed' },
        ],
      },
    ],
  },
  {
    id: 'evt_comet_seam',
    titleZh: '彗核冰脉',
    bodyZh: '一颗长周期彗星将掠过殖民空域，彗核裂隙中裸露出远超常规丰度的挥发物冰脉。矿业行会申请竞标开采窗口，生态署则坚持把彗核整体划作未触保护对象。',
    category: 'encounter',
    weight: 0.3,
    cooldownTicks: 2160,
    conditions: (world) => world.tick > 8640 &&
      Object.keys(world.entities.colonies).length >= 4,
    choices: [
      {
        id: 'auction', labelZh: '公开竞标开采窗口', hintZh: '信用点换挥发物',
        cost: { credits: 500 },
        isDefault: true,
        effects: [
          { op: 'resource', resId: 'hydrogen', amount: 80, target: 'player' },
          { op: 'resource', resId: 'water', amount: 60, target: 'player' },
          { op: 'flag', key: 'comet_auctioned' },
        ],
      },
      {
        id: 'sanctuary', labelZh: '划作生态保护区', hintZh: '声望换矿权',
        effects: [
          { op: 'resource', resId: 'influence', amount: 8, target: 'player' },
          { op: 'flag', key: 'comet_sanctuary' },
        ],
      },
    ],
  },
];
