/**
 * content/spaceOperaBeacons.js — 全频段子空间信标流中文词库
 * （SPEC-PLAN-046 阶段三 M3 Task 3.3；责任人：Eng-C 词库 / Eng-D HUD 消费）
 *
 * 职责（doc46 §Task 3.3 §2 + doc42 总纲 §五.3「让真空充满人间烟火」）：
 *  1. SUBSPACE_BEACON_TEMPLATES：26 条（≥24）非帝国动态叙事信标模板，四大频段全覆盖：
 *     FREQ_DISTRESSED_CIV（遇险民用）/ FREQ_STAR_JOURNAL（《星海日报》新闻广播）/
 *     FREQ_SHADOW_CONTRACT（黑市加密合约）/ FREQ_PRECURSOR_ECHO（先驱者低语遗言）；
 *  2. OPPORTUNITY_BEACON_TEMPLATES：12 条（≥10）机遇信标专用模板（战场打捞队 /
 *     流亡传奇科学家 / 中立佣兵团低价合约 / 星海战地记者专访 / 难民移民船队等），
 *     供戏剧导演高潮宣泄 +18 机遇信标爆发（doc46 §Task 3.5 §4）经
 *     subspaceBeaconStream.injectOpportunityBeacons 投放；
 *  3. 每条模板契约：{ templateId, freqClass, title, body,
 *     responseOptions: [{ id, label, effectHint, effect? }] }。
 *     effect 为机读效果对象（subspaceBeaconStream.respondSubspaceBeacon 消费）：
 *       { kind:'CREDIT', resId, amount }                        —— 资源奖励（救援/先驱者 researchData）
 *       { kind:'TEMP_BUFF', untilTicks, happinessPct }          —— 临时增益窗口（星海日报/专访/义演）
 *       { kind:'BLACK_MARKET_WINDOW', contrabandId, qty }       —— 黑市交易窗口开启（加密合约）
 *       { kind:'UNITY_GRANT', amount }                          —— 凝聚力入账（spaceOperaState.unityTreasury）
 *       { kind:'REFUGEE_POP', amount }                          —— 难民入殖（玩家殖民地 popTotal）
 *
 * 纯数据模块：零 import、零副作用、零 DOM —— Node/浏览器双端安全；
 * title/body 支持 {system}/{faction} 占位符（信标流 spawn 时按目标星系确定性替换）；
 * 全表 Object.freeze 冻结，spawn 侧深拷贝落信标实例。
 */

/** 四大叙事频段枚举（顺序即 sampleWeightedIndex 等权走表序；冻结） */
export const SUBSPACE_FREQ_CLASSES = Object.freeze([
  'FREQ_DISTRESSED_CIV',
  'FREQ_STAR_JOURNAL',
  'FREQ_SHADOW_CONTRACT',
  'FREQ_PRECURSOR_ECHO',
]);

/** 机遇信标专用频段类（kind = 'OPPORTUNITY'；不计入 15 密度，按 kind 区分） */
export const OPPORTUNITY_FREQ_CLASS = 'OPPORTUNITY_BEACON';

/** 频段等权权重表（doc46 未给频段偏置 → 四频段等概率；冻结） */
export const FREQ_CLASS_WEIGHTS = Object.freeze([1, 1, 1, 1]);

/* ============================== 非帝国动态叙事信标模板（26 条 ≥ 24） ============================== */

export const SUBSPACE_BEACON_TEMPLATES = Object.freeze([
  // —— 频段一：FREQ_DISTRESSED_CIV 遇险民用（求救电波 / 泄漏漂流舱 / 讨薪罢工电台）——
  Object.freeze({
    templateId: 'bc_civ_reactor_leak',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '反应堆泄漏漂流舱求救',
    body: '「这里是自由矿船「铁蕨号」……主反应堆第二回路破裂，{system} 外缘漂流中，生命维持只剩 40 小时，任何收到本信号的船只……求求你们……」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'rescue', label: '定向救援信标并派出拖船', effectHint: '救援成功 → 信用点报酬 600', effect: Object.freeze({ kind: 'CREDIT', resId: 'credits', amount: 600 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_freight_sos',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '遇险民用货船求救信号',
    body: '「Mayday，Mayday——独立货船「麦穗七号」在{system}遭遇海盗掠袭，货舱破口，船体倾斜 12 度，全体船员 14 人等待援助！」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'rescue', label: '响应求救并护送入港', effectHint: '救援成功 → 信用点报酬 800', effect: Object.freeze({ kind: 'CREDIT', resId: 'credits', amount: 800 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_miner_strike',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '矿工讨薪罢工电台',
    body: '「{faction}的钻探队已经 90 天没领到薪金！我们占领了{system}三号井架，除非欠薪结清，否则所有稀土停运——劳资代表恳请任何调解方介入。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'mediate', label: '公开声援调解并担保欠薪', effectHint: '调解成立 → 影响力 +5', effect: Object.freeze({ kind: 'CREDIT', resId: 'influence', amount: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_storm_rogue',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '超空间风暴偏航船队呼救',
    body: '「移民船队「新黎明」被超空间风暴吹离航道 11 光年，现于{system}深空失速漂流，食品与淡水仅够 9 天，恳请转发本信标！」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'rescue', label: '引导船队就近入港', effectHint: '救援成功 → 信用点报酬 700', effect: Object.freeze({ kind: 'CREDIT', resId: 'credits', amount: 700 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_med_quarantine',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '医疗隔离舱求援广播',
    body: '「{system}中转站出现未知孢子热疫情，医疗舱已超容 300%，急缺广谱药剂——若有船队携带医药储备，请立即联络站控中心！」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'aid', label: '调拨医药储备驰援', effectHint: '驰援成功 → 医药 -20（信用点等价入账）', effect: Object.freeze({ kind: 'CREDIT', resId: 'medicine', amount: 20 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_cadet_ship',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '失联实习商船微弱信号',
    body: '「……练习舰「初羽号」导航计算机故障，学员们正在手动推算航向……{system}信标台若收到，请回复坐标确认……我们不想放弃这次结业航行。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'guide', label: '回传导航坐标并远程引导', effectHint: '引航成功 → 信用点报酬 500', effect: Object.freeze({ kind: 'CREDIT', resId: 'credits', amount: 500 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_civ_colony_blackout',
    freqClass: 'FREQ_DISTRESSED_CIV',
    title: '殖民地全面停电求援',
    body: '「{faction}在{system}的定居点主电网跳闸，聚变机组联锁失效，冻舱药品开始失温——急需动力电池组，恳请邻近殖民点驰援！」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'aid', label: '空投动力电池组', effectHint: '驰援成功 → 动力电池 +10 备案入账', effect: Object.freeze({ kind: 'CREDIT', resId: 'powerCell', amount: 10 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),

  // —— 频段二：FREQ_STAR_JOURNAL 《星海日报》全息新闻通讯社 ——
  Object.freeze({
    templateId: 'bc_news_frontline',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》前线战损特别报道',
    body: '「全息联播：{system}航道昨日爆发主力舰级交火，双方确认战损逾两位数。《星海日报》随军记者提醒各船队绕行交战区，并为本报前线供稿渠道保持畅通。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'subscribe', label: '接收战况简报并安抚船员', effectHint: '临时增益：全殖民地幸福度窗口 +5%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_industry_rumor',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》工业关注度流言专栏',
    body: '「流言板：有商队声称{system}某殖民地工业关注度逼近警戒线 7，激进渗透细胞或已潜伏。《星海日报》未获官方证实，但建议巡查队加强反渗透扫描。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'subscribe', label: '订阅流言专栏稳定民心动向', effectHint: '临时增益：全殖民地幸福度窗口 +5%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_market_surge',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》大宗商品行情快讯',
    body: '「行情台：{system}现货合约遭遇暴涨暴跌，套利船队连夜调仓。本报提醒：高关税星域黑市溢价已攀至 1.8 倍临界，请贸易商审慎评估违禁品敞口。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'subscribe', label: '订阅行情快讯稳定贸易预期', effectHint: '临时增益：全殖民地幸福度窗口 +5%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_paragon_interview',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》星海群像英雄专访',
    body: '「人物版：今日《星海日报》专访在{system}单骑退敌的传奇指挥官——「星际不是孤独的，因为总有人把航道点亮。」全息纪念版限时免费领取。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'celebrate', label: '全频道转播专访激励军民', effectHint: '临时增益：全殖民地幸福度窗口 +6%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 6 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_senate_bill',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》大议会法案辩论直播',
    body: '「政治版：星际共同体大议会就《_CHOAM 贸易分红透明化法案_》展开马拉松辩论，持股 30% 阈值条款成为攻防焦点。直播信号覆盖至{system}中继站。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'listen', label: '旁听议会直播研判风向', effectHint: '临时增益：全殖民地幸福度窗口 +4%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 4 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_leviathan_sighting',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》巨兽目击实录',
    body: '「科学版：{system}外缘再次捕捉到超巨型利维坦的热信号尾迹。讨伐悬赏已挂至赏金公会，本报将持续追踪猎杀舰队动向直至战果确认。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'track', label: '收录目击数据备航', effectHint: '临时增益：全殖民地幸福度窗口 +5%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_news_refugee_column',
    freqClass: 'FREQ_STAR_JOURNAL',
    title: '《星海日报》难民船队纪实连载',
    body: '「深度版：从{system}边境涌出的难民船队已绵延 40 光年，《星海日报》记者随船记录——「我们不是入侵者，我们只是想在天亮前找到一颗行星。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'relay', label: '转发纪实唤起公益驰援', effectHint: '临时增益：全殖民地幸福度窗口 +5%（720×3 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),

  // —— 频段三：FREQ_SHADOW_CONTRACT 黑市辛迪加加密合约 ——
  Object.freeze({
    templateId: 'bc_sh_arms_bid',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '辛迪加加密军火标书',
    body: '「（加密信道）{system}封锁区急需重装军火，验货后信用点十倍结算。屏蔽货舱自备，扫码接头，倒计时 15 日。——K」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '竞标承接军火合约', effectHint: '合约成立 → {system} 黑市交易窗口开启（重装军火 ×10 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_heavy_arms', qty: 10 }) }),
      Object.freeze({ id: 'dismiss', label: '焚毁标书', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_sh_pirate_code',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '私掠悬赏暗语接头',
    body: '「（暗语频道）红隼衔环，月圆三更——{system}外缘有批「红茶」待接，巡逻队换岗间隙 20 分钟，老规矩，货损自担。——渡鸦」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '应下暗语接头', effectHint: '接头成立 → {system} 黑市交易窗口开启（神经麻醉剂 ×12 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_neuro_stim', qty: 12 }) }),
      Object.freeze({ id: 'dismiss', label: '焚毁暗语', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_sh_ai_core_auction',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '违禁 AI 核心黑市拍卖预告',
    body: '「（一次性密钥）{system}残骸带打捞出未注册 AI 核心 ×4，明夜子时暗拍，只收硬通货。肃正协议复盘者勿扰。——拍品人 77」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '报名暗拍通道', effectHint: '通道开启 → {system} 黑市交易窗口开启（AI 核心 ×4 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_ai_core', qty: 4 }) }),
      Object.freeze({ id: 'dismiss', label: '销毁密钥', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_sh_xeno_serum',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '异种血清竞标邀约',
    body: '「（医学暗网）{system}隔离舱流出的异种血清 ×8 寻求买家，疗效未验证、副作用未知——但绝症者等不起伦理委员会。——白手套」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '接下血清竞标', effectHint: '竞标成立 → {system} 黑市交易窗口开启（异种血清 ×8 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_xeno_serum', qty: 8 }) }),
      Object.freeze({ id: 'dismiss', label: '销毁邀约', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_sh_fence_network',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '销赃网络分账接头',
    body: '「（分账信道）上季{system}掠获清单已出：赃物三成寻稳定买家分销，承诺零追索。信誉担保人：老码头秤房。——灰账房」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '挂名分销渠道', effectHint: '渠道开启 → {system} 黑市交易窗口开启（神经麻醉剂 ×6 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_neuro_stim', qty: 6 }) }),
      Object.freeze({ id: 'dismiss', label: '销毁信道', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_sh_blockade_run',
    freqClass: 'FREQ_SHADOW_CONTRACT',
    title: '封锁线突破合约悬赏',
    body: '「（军火信道）{system}遭舰队封锁，守军急缺穿甲重械 ×14，愿意以战时三倍价结算——敢闯封锁线的船长，此单够你退休。——前线军需官（被除名）」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'bid', label: '接下破封锁合约', effectHint: '合约成立 → {system} 黑市交易窗口开启（重装军火 ×14 入库）', effect: Object.freeze({ kind: 'BLACK_MARKET_WINDOW', contrabandId: 'contra_heavy_arms', qty: 14 }) }),
      Object.freeze({ id: 'dismiss', label: '焚毁合约', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),

  // —— 频段四：FREQ_PRECURSOR_ECHO 先驱者遗言与低语 ——
  Object.freeze({
    templateId: 'bc_pre_first_wave_testament',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '第一波拓荒考察队自动遗言信标',
    body: '「……三百年了，若有人收到：我们是第一波拓荒队，反应堆在{system}熄灭于第 4021 个安息日。请告诉地球，我们没有回头。——拓荒船「创世纪-7」全体」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'decode', label: '破译遗言数据包归档', effectHint: '破译成功 → 科研数据 +8', effect: Object.freeze({ kind: 'CREDIT', resId: 'researchData', amount: 8 }) }),
      Object.freeze({ id: 'dismiss', label: '静默致哀', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_pre_math_whisper',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '先驱者数学背景辐射低语',
    body: '「……4, 9, 25, 49……平方素数链在{system}背景辐射中重复第 10^9 次……这不是自然信号，这是先驱者留给能听懂之人的入场券……」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'decode', label: '投入算力解析低语序列', effectHint: '解析成功 → 科研数据 +10', effect: Object.freeze({ kind: 'CREDIT', resId: 'researchData', amount: 10 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_pre_ancient_sos',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '三百年前殖民船求救信标残响',
    body: '「（循环第 2.6 亿次）这里是殖民船「拓荒者之愿」……{system}跃迁失败，全员转入冷冻……若后来者寻获，请把我们的星图带走，别浪费……」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'salvage', label: '打捞遗存星图数据', effectHint: '打捞成功 → 远古数据 +2', effect: Object.freeze({ kind: 'CREDIT', resId: 'ancientData', amount: 2 }) }),
      Object.freeze({ id: 'dismiss', label: '静默致哀', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_pre_grave_song',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '殖民船坟场挽歌广播',
    body: '「（自动放送）{system}坟场环带安息着 17 艘第一代殖民船。每周此刻，遗骸信标阵列会齐唱同一首老地球摇篮曲——愿航行者们路过时降速致意。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'archive', label: '录制挽歌声纹归档', effectHint: '归档成功 → 科研数据 +6', effect: Object.freeze({ kind: 'CREDIT', resId: 'researchData', amount: 6 }) }),
      Object.freeze({ id: 'dismiss', label: '静默致哀', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_pre_lattice_hum',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '先驱者晶格共振回响',
    body: '「（谐波共振）{system}深处的先驱者晶格正在以 11 赫兹嗡鸣——每次帝国的战火靠近，频率就升高一分。它们在害怕，或者……在等待。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'study', label: '架设谐振采集阵列', effectHint: '采集成功 → 远古数据 +1', effect: Object.freeze({ kind: 'CREDIT', resId: 'ancientData', amount: 1 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'bc_pre_star_chart',
    freqClass: 'FREQ_PRECURSOR_ECHO',
    title: '破损星图残段循环广播',
    body: '「（数据残段）……航线末端坐标缺失……但{system}以内的三代星图完整可用……拿去吧，后来的航海者，别再撞上我们撞过的暗礁……」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'decode', label: '拼接残段星图', effectHint: '拼接成功 → 科研数据 +12', effect: Object.freeze({ kind: 'CREDIT', resId: 'researchData', amount: 12 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
]);

/* ============================== 机遇信标专用模板（12 条 ≥ 10） ============================== */

export const OPPORTUNITY_BEACON_TEMPLATES = Object.freeze([
  Object.freeze({
    templateId: 'ob_salvage_crew',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '战场打捞队捞获分账邀约',
    body: '「（机遇频道）{system}战场残骸带刚冷却，我们的打捞队已经捞满了三层货舱——合金按市价七成分账，手快有手慢无。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '入伙分账打捞', effectHint: '分账成立 → 合金 +120', effect: Object.freeze({ kind: 'CREDIT', resId: 'alloy', amount: 120 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_exile_scientist',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '流亡传奇科学家投奔意向',
    body: '「（加密学术频道）我是被{faction}学术法庭除名的第七席院士，带着未发表的跃迁修正模型流亡至今——贵方若愿提供实验室，我愿倾尽所学。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '接纳流亡科学家', effectHint: '投奔成立 → 科研数据 +30', effect: Object.freeze({ kind: 'CREDIT', resId: 'researchData', amount: 30 }) }),
      Object.freeze({ id: 'dismiss', label: '婉拒并保密其行踪', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_mercenary_cheap',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '中立佣兵团低价合约邀约',
    body: '「（雇佣频道）红盾佣兵团淡季特惠：整建制中队月饷六折，{system}防务空窗期先到先得——我们只在非交战状态接单，信誉可查。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '签下淡季佣兵合约', effectHint: '临时增益：全殖民地幸福度（士气）窗口 +8%（720×2 tick）', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 1440, happinessPct: 8 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_war_correspondent',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '星海战地记者专访邀约',
    body: '「（传媒频道）《星海日报》年度特稿入选舰队已定！随军专访名额仅剩一位——受访舰队将获得头版报道与全银河声望加成。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '接受随军专访', effectHint: '专访刊出 → 临时增益：幸福度窗口 +5%（720×3 tick）+ 凝聚力 +120', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2160, happinessPct: 5, unityGrant: 120 }) }),
      Object.freeze({ id: 'dismiss', label: '婉拒专访', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_refugee_fleet',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '难民移民船队入殖请求',
    body: '「（民用频道）我们是{system}内战中流散的三千平民，船队燃料只够最后一跳——贵方任何一颗宜居殖民地，我们都愿以劳力偿还船票。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '批准船队入殖', effectHint: '入殖成立 → 玩家殖民地人口 +2（无殖民地时折算食物 +50）', effect: Object.freeze({ kind: 'REFUGEE_POP', amount: 2, fallbackResId: 'food', fallbackAmount: 50 }) }),
      Object.freeze({ id: 'dismiss', label: '补给燃料后婉拒', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_hulk_tow',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '废弃船体拖航合约',
    body: '「（机遇频道）{system}轨道外漂着一艘完整断核巡洋舰残骸，拖航费我们出，拆解合金五五分——需要一艘有牵引级的船。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '承接拖航拆解', effectHint: '合约成立 → 合金 +90', effect: Object.freeze({ kind: 'CREDIT', resId: 'alloy', amount: 90 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_antique_dealer',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '先驱者古董商清仓甩卖',
    body: '「（收藏频道）老头子我要退休啦！{system}中转站最后的先驱者残片全套甩卖——三件起售，送鉴权证书，假一赔十。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '包圆清仓残片', effectHint: '收购成立 → 远古数据 +3', effect: Object.freeze({ kind: 'CREDIT', resId: 'ancientData', amount: 3 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_colonist_charter',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '殖民特许权廉价转让',
    body: '「（政务频道）{faction}财政吃紧，愿以市场半价转让{system}一份未激活殖民特许权——附完整勘探档案，过时不候。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '受让殖民特许权', effectHint: '受让成立 → 影响力 +12', effect: Object.freeze({ kind: 'CREDIT', resId: 'influence', amount: 12 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_escort_gig',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '贵重船队护航溢价单',
    body: '「（商务频道）{system}至外环贵重晶簇船队急招护航舰两艘，全程 30 日，报酬预付四成——劫掠高峰期，价高者得。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '接单护航', effectHint: '护航成立 → 信用点 +1200', effect: Object.freeze({ kind: 'CREDIT', resId: 'credits', amount: 1200 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_data_broker',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '情报掮客打包出售',
    body: '「（情报频道）{system}三个大型派系的边防轮值表、巡逻盲区图，打包一份价——只卖一次，售后即焚。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '买断情报包', effectHint: '交易成立 → 情报点 +15', effect: Object.freeze({ kind: 'CREDIT', resId: 'intelPoints', amount: 15 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_hazard_pay',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '险区勘探预售合约',
    body: '「（科研频道）{system}高辐射星云深处探测到奇异物质回波，勘探权预售——装备损耗自理，采出即归你，我们只要 5% 采样权。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '买断勘探权', effectHint: '预售成立 → 奇异物质 +2', effect: Object.freeze({ kind: 'CREDIT', resId: 'exoticMatter', amount: 2 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
  Object.freeze({
    templateId: 'ob_orphan_fund',
    freqClass: OPPORTUNITY_FREQ_CLASS,
    title: '战争孤儿抚助义演联播',
    body: '「（公益频道）{system}中转站义演今晚开锣，全银河为战争孤儿募捐——冠名方将获得史诗级声望叙事，孩子们会记得每一束打过来的光。」',
    responseOptions: Object.freeze([
      Object.freeze({ id: 'accept', label: '冠名赞助义演', effectHint: '临时增益：幸福度窗口 +6%（720×4 tick）+ 凝聚力 +80', effect: Object.freeze({ kind: 'TEMP_BUFF', untilTicks: 2880, happinessPct: 6, unityGrant: 80 }) }),
      Object.freeze({ id: 'dismiss', label: '静默标记航路', effectHint: '无效果，仅标记', effect: null }),
    ]),
  }),
]);

/* ============================== 词库自检辅助（纯函数） ============================== */

/** 全部叙事模板（含机遇表）条数（套件与 HUD 断言用） */
export function countBeaconTemplates() {
  return SUBSPACE_BEACON_TEMPLATES.length + OPPORTUNITY_BEACON_TEMPLATES.length;
}

/** 按 templateId 查模板（未命中返回 null；纯只读） */
export function beaconTemplateById(templateId) {
  return SUBSPACE_BEACON_TEMPLATES.find((t) => t.templateId === templateId)
    || OPPORTUNITY_BEACON_TEMPLATES.find((t) => t.templateId === templateId)
    || null;
}
