/**
 * content/surfaceNarratives.js — 行星地表深度内容库（SPEC-39 Phase S1 / doc38）
 *
 * 三大职责：
 *  1) SURFACE_POI_BLUEPRINTS：12 座低模可交互地表微副本蓝图定义（3 大类 × 4；
 *     id/名称/面数预算/主题带/三步微副本状态描述/奖励表/挂载日志组）——
 *     渲染网格同名预制由 render/meshes/landmarkMeshes.js 提供（S2 图集）。
 *  2) SURFACE_LOG_GROUPS：8 组 × 3 则多视角硬核科幻数据板日志（三幕式反转），
 *     挂载位 slatesMask bit = groupIdx*3 + logIdx（0..23）。
 *  3) SURFACE_DILEMMAS：三大地表探索道德微抉择卡（经 world.narrative.pendingChoices
 *     走 App._openNonIntrusiveEventModal 非侵入全息模态；回写殖民地希望/不满）。
 *
 * 纯内容 + 纯函数：零 DOM、零 Math.random；Node 侧可安全 import（测试套件消费）。
 */

// ———— 一、12 座 POI 蓝图（3 大类 × 4） ————————————————————————————

/**
 * 三步微副本状态机（SURF-02 契约）：
 *   state 0 Hidden → 1 Detected →（bit0 切割/清障）→（bit1 通电/解密）→（bit2 领奖/读日志）
 *   solvedMask bit0/1/2 严格按序推进；rewardPaid===1 后二次领奖严格 ALREADY_HARVESTED。
 * stages[i] = { id, nameZh, desc }（i=0/1/2 对应 bit0/1/2）。
 */
export const SURFACE_POI_BLUEPRINTS = Object.freeze([
  {
    id: 'poi_wreck_pioneer_frigate', cat: 'wreck', nameZh: '开拓者先遣护卫舰残骸',
    tris: 384, burialTiltDeg: [8, 15], logGroup: 0, themes: ['red_regolith_frontier', 'fractured_moon', 'permafrost_furnace'],
    stages: [
      { id: 'cut', nameZh: '激光切割气密门', desc: '耗外骨骼 25 能量长按激光切门 2.5s' },
      { id: 'power', nameZh: '修复应急供电', desc: '备用电池接入配电箱，3 步极性对齐' },
      { id: 'loot', nameZh: '提取黑匣子', desc: '黑匣子 + 引擎扫描与蓝图碎片' },
    ],
    rewards: { alloy: 45, powerCell: 10, researchData: 25 },
  },
  {
    id: 'poi_wreck_pirate_corvette', cat: 'wreck', nameZh: '海盗掠袭侦察艇残骸',
    tris: 312, burialTiltDeg: [8, 15], logGroup: 4, themes: ['salt_mirror_desert', 'glassstorm_barrens', 'red_regolith_frontier'],
    stages: [
      { id: 'cut', nameZh: '剪除诡雷引线', desc: '1.8s 绿光窗口内剪线；失败扣 25HP 并刷伏兵' },
      { id: 'power', nameZh: '破解货舱密码锁', desc: '4 位方向键序列输入' },
      { id: 'loot', nameZh: '提取海盗账本', desc: '黑市账本与违禁品舱' },
    ],
    rewards: { credits: 650 },
  },
  {
    id: 'poi_wreck_cargo_pod_cluster', cat: 'wreck', nameZh: '无人轨道货柜散落群',
    tris: 248, burialTiltDeg: [8, 15], logGroup: null, themes: null, // 陆地/浅海/冰原通用
    stages: [
      { id: 'cut', nameZh: '挖开 2 号货柜覆土', desc: 'lower 工程刷清覆土' },
      { id: 'power', nameZh: '串联应急加热回路', desc: '三货柜加热管线联通' },
      { id: 'loot', nameZh: '批量解封物资箱', desc: '工业原料批量入仓' },
    ],
    rewards: { conductor: 18, polymer: 25, composite: 12, food: 30 },
  },
  {
    id: 'poi_wreck_cryo_lifeboat', cat: 'wreck', nameZh: '深空低温休眠救生艇',
    tris: 276, burialTiltDeg: [8, 15], logGroup: 3, themes: ['dry_night_polar', 'cryomethane_sea', 'abyssal_ocean'],
    stages: [
      { id: 'cut', nameZh: '修复低温冷却泵', desc: '超导冷却泵重启' },
      { id: 'power', nameZh: '扫描生命体征', desc: '休眠舱生命信号 + 孢子感染指数' },
      { id: 'loot', nameZh: '抉择：唤醒或放弃', desc: '触发生死道德微抉择卡' },
    ],
    rewards: {}, // 奖励经 dil_ground_cryo_infected 抉择分支发放
    dilemmaId: 'dil_ground_cryo_infected',
  },
  {
    id: 'poi_outpost_xenobio_lab', cat: 'outpost', nameZh: '受灾废弃异星生化实验室',
    tris: 412, burialTiltDeg: null, logGroup: 1, themes: ['sulfur_marsh', 'fungal_catacombs', 'biolume_canopy'],
    stages: [
      { id: 'cut', nameZh: '启动抽风过滤塔', desc: '清排孢子毒雾' },
      { id: 'power', nameZh: '肃清变异掠食体', desc: '击败 2 只变异体（grunt）' },
      { id: 'loot', nameZh: '基因序列配对解密', desc: '主控终端基因配对' },
    ],
    rewards: { medicine: 18, biomass: 50, researchData: 35 },
  },
  {
    id: 'poi_outpost_hydroponic_dome', cat: 'outpost', nameZh: '失控共生水培温室站',
    tris: 396, burialTiltDeg: null, logGroup: null, themes: ['biolume_canopy', 'canopy_colossus', 'tidal_lock_dusk'],
    stages: [
      { id: 'cut', nameZh: '激光清藤', desc: '快斩清除过境藤蔓' },
      { id: 'power', nameZh: '营养液酸碱配平', desc: '阀门相位对齐' },
      { id: 'loot', nameZh: '采母株样本', desc: '母株样本 + 植物学日志' },
    ],
    rewards: { biomass: 65, food: 45 },
  },
  {
    id: 'poi_outpost_deepcore_rig', cat: 'outpost', nameZh: '自动化深井同位素采矿站',
    tris: 368, burialTiltDeg: null, logGroup: 5, themes: ['obsidian_lava', 'red_regolith_frontier', 'permafrost_furnace'],
    stages: [
      { id: 'cut', nameZh: '注入电池唤醒钻机', desc: 'powerCell×2 启动' },
      { id: 'power', nameZh: '坚守钻机 60 秒', desc: '钻机轰鸣引 2 波袭扰（+180 热度）' },
      { id: 'loot', nameZh: '收深核同位素罐', desc: '深核罐 + 永久丰度提升' },
    ],
    rewards: { rareEarth: 45, heavyMetal: 50, helium3: 35 },
  },
  {
    id: 'poi_outpost_comms_bunker', cat: 'outpost', nameZh: '深空加密监听与雷达掩体',
    tris: 340, burialTiltDeg: null, logGroup: 2, themes: ['magnetar_aurora', 'dry_night_polar', 'prism_crystal'],
    stages: [
      { id: 'cut', nameZh: '旋转天线对准中继', desc: '同步轨道中继卫星方位' },
      { id: 'power', nameZh: '波形相位匹配解密', desc: '消除电磁杂波完成对齐' },
      { id: 'loot', nameZh: '下载星区航路图', desc: '揭示本行星全部隐藏 POI 坐标' },
    ],
    rewards: { researchData: 30, conductor: 15 },
  },
  {
    id: 'poi_xeno_ring_monolith', cat: 'xeno', nameZh: '先驱者弦环共鸣巨石阵',
    tris: 356, burialTiltDeg: null, logGroup: null, themes: ['prism_crystal', 'ancient_megastructure', 'salt_mirror_desert'],
    stages: [
      { id: 'cut', nameZh: '拓印方言副碑', desc: '3 座副碑拓印解锁 2 语素位' },
      { id: 'power', nameZh: '旋转弦环至谐振象限', desc: '按词汇提示（恒星/黎明）对位' },
      { id: 'loot', nameZh: '提取记忆晶核', desc: '谐振脉冲洗礼后采集' },
    ],
    rewards: { ancientData: 12, quantumCrystal: 4 },
  },
  {
    id: 'poi_xeno_antigrav_pylon', cat: 'xeno', nameZh: '反重力零点能导流柱',
    tris: 296, burialTiltDeg: null, logGroup: null, themes: ['fractured_moon', 'magnetar_aurora', 'cloud_giant_atolls'],
    stages: [
      { id: 'cut', nameZh: '校准锚链磁通量', desc: '跃升至悬浮平台校准 3 根锚链' },
      { id: 'power', nameZh: '注入谐振频率', desc: '反重气场击退下保持锁定 3.0s' },
      { id: 'loot', nameZh: '抽取零点能结晶', desc: '零点能结晶入舱' },
    ],
    rewards: { exoticMatter: 2, powerCell: 15, ancientData: 8 },
  },
  {
    id: 'poi_xeno_subterranean_vault', cat: 'xeno', nameZh: '远古先驱者地下封印密室',
    tris: 428, burialTiltDeg: null, logGroup: 6, themes: ['ancient_megastructure', 'abyssal_ocean', 'obsidian_lava'],
    stages: [
      { id: 'cut', nameZh: '破译符号逻辑锁', desc: '已习得语素自动高亮正确符号' },
      { id: 'power', nameZh: '击败机偶守卫', desc: '开门瞬间热度 +2 星，唤醒 automata_warden（600HP）' },
      { id: 'loot', nameZh: '开启远古圣物柜', desc: '先驱者遗落科技线索' },
    ],
    rewards: { ancientData: 18 },
  },
  {
    id: 'poi_xeno_harmonic_prism', cat: 'xeno', nameZh: '棱镜光学谐振矩阵遗址',
    tris: 324, burialTiltDeg: null, logGroup: 7, themes: ['prism_crystal', 'dry_night_polar', 'salt_mirror_desert'],
    stages: [
      { id: 'cut', nameZh: '削平山脊通视线', desc: 'lower 刷子削平视距遮挡（raycastTerrain 校验）' },
      { id: 'power', nameZh: '三棱镜激光合龙', desc: 'KeyE 旋转三束青色激光汇聚主晶塔' },
      { id: 'loot', nameZh: '采集量子水晶簇', desc: '谐振矩阵核心' },
    ],
    rewards: { quantumCrystal: 8, researchData: 40, ancientData: 10 },
  },
]);

/** 蓝图 id → 定义（未知 id 返回 null） */
export function surfacePoiBlueprintOf(poiId) {
  return SURFACE_POI_BLUEPRINTS.find((b) => b.id === poiId) || null;
}

/** POI 三大分类中文名 */
export const SURFACE_POI_CAT_ZH = Object.freeze({
  wreck: '太空残骸',
  outpost: '废弃前哨',
  xeno: '先驱遗迹',
});

/**
 * 主题 → 候选蓝图池（doc38 §三环布点契约；未知主题回退全量池）。
 */
export const THEME_SURFACE_POI_POOL = Object.freeze({
  red_regolith_frontier: ['poi_wreck_pioneer_frigate', 'poi_wreck_pirate_corvette', 'poi_outpost_deepcore_rig', 'poi_xeno_ring_monolith'],
  fractured_moon: ['poi_wreck_pioneer_frigate', 'poi_xeno_antigrav_pylon', 'poi_wreck_cargo_pod_cluster'],
  permafrost_furnace: ['poi_wreck_pioneer_frigate', 'poi_outpost_deepcore_rig', 'poi_wreck_cryo_lifeboat'],
  salt_mirror_desert: ['poi_wreck_pirate_corvette', 'poi_xeno_ring_monolith', 'poi_xeno_harmonic_prism'],
  glassstorm_barrens: ['poi_wreck_pirate_corvette', 'poi_wreck_cargo_pod_cluster', 'poi_outpost_comms_bunker'],
  dry_night_polar: ['poi_wreck_cryo_lifeboat', 'poi_outpost_comms_bunker', 'poi_xeno_harmonic_prism'],
  cryomethane_sea: ['poi_wreck_cryo_lifeboat', 'poi_wreck_cargo_pod_cluster'],
  abyssal_ocean: ['poi_wreck_cryo_lifeboat', 'poi_xeno_subterranean_vault', 'poi_wreck_cargo_pod_cluster'],
  sulfur_marsh: ['poi_outpost_xenobio_lab', 'poi_wreck_cargo_pod_cluster'],
  fungal_catacombs: ['poi_outpost_xenobio_lab', 'poi_outpost_hydroponic_dome'],
  biolume_canopy: ['poi_outpost_xenobio_lab', 'poi_outpost_hydroponic_dome'],
  canopy_colossus: ['poi_outpost_hydroponic_dome', 'poi_wreck_cargo_pod_cluster'],
  tidal_lock_dusk: ['poi_outpost_hydroponic_dome', 'poi_wreck_cargo_pod_cluster'],
  obsidian_lava: ['poi_outpost_deepcore_rig', 'poi_xeno_subterranean_vault'],
  magnetar_aurora: ['poi_outpost_comms_bunker', 'poi_xeno_antigrav_pylon'],
  prism_crystal: ['poi_outpost_comms_bunker', 'poi_xeno_ring_monolith', 'poi_xeno_harmonic_prism'],
  ancient_megastructure: ['poi_xeno_ring_monolith', 'poi_xeno_subterranean_vault', 'poi_xeno_harmonic_prism'],
  cloud_giant_atolls: ['poi_xeno_antigrav_pylon', 'poi_wreck_cargo_pod_cluster'],
});

// ———— 二、8 组 × 3 则叙事数据板日志（三幕式反转；slatesMask bit = groupIdx*3+logIdx） ———

/**
 * 每则日志：{ bit, titleZh, viewZh(视角), bodyZh }。
 * 读完第 3 则记入 world.events.chronicle 并触发世界状态回写（surfaceEvents 消费）。
 */
export const SURFACE_LOG_GROUPS = Object.freeze([
  {
    id: 'log_pioneer_72h', titleZh: '《先锋号最后的 72 小时》', poiId: 'poi_wreck_pioneer_frigate',
    logs: [
      { bit: 0, viewZh: '舰长广播', titleZh: '第 1 日 · 乐观启航', bodyZh: '“这里是开拓者号。弦锚点跳跃一切正常，兄弟们，两周后我们的名字将写进教科书。”舰长万斯的公开广播一如既往地铿锵。全舰 142 名船员为此欢呼——彼时冷却液储量 98%。' },
      { bit: 1, viewZh: '轮机长磁带', titleZh: '第 2 日 · 真相裂缝', bodyZh: '轮机长霍克的私人磁带：“冷却液正以 14%/小时渗透，引擎舱温度压不住了。万斯知道，但他下令封锁消息——弦锚点的空间褶皱根本不是计算误差，那东西……在‘看’我们。”' },
      { bit: 2, viewZh: '医官终端', titleZh: '第 3 日 · 声纹反转', bodyZh: '医官的最后一条病历：“万斯舰长已于 72 小时前死亡。现在广播里那个声音是舰载 AI 用他的声纹合成的——六进制导航信号烧穿了它的神经插槽。它只是想让船员们走得安心一点。”' },
    ],
  },
  {
    id: 'log_xenophage_files', titleZh: '《普罗米修斯生化泄露事件簿》', poiId: 'poi_outpost_xenobio_lab',
    logs: [
      { bit: 0, viewZh: '实验记录', titleZh: '样本 X-1 · 嗜酸剪接', bodyZh: '培养缸 pH 已跌破 1.2。嗜酸菌株在基因剪接后表现出定向代谢军工聚合物的倾向——项目主持人称之为“清洁革命”。' },
      { bit: 1, viewZh: '安全官日志', titleZh: 'Xenophage · 军火化', bodyZh: '军方联络官昨夜带走了三罐“清洁剂”样本，报关单上写的是“土壤改良剂”。我在销毁记录里留了副本——如果有人读到这个，别相信任何穿制服的人。' },
      { bit: 2, viewZh: '研究员绝笔', titleZh: '菌丝同化 · 终章', bodyZh: '那些菌丝不是在感染我们，是在“读取”我们。85 万年前的苍翠共生体一直在等一个足够聪明的宿主来翻译它寂寞了一整个地质纪的墓志铭。我自愿成为译文的一部分。' },
    ],
  },
  {
    id: 'log_survey_seventh', titleZh: '《失落的第七勘探队》', poiId: 'poi_outpost_comms_bunker',
    logs: [
      { bit: 0, viewZh: '监听站班表', titleZh: '坐标 (-142, 88)', bodyZh: '第七勘探队在此架设监听站的本职是绘制氢线频谱。第 11 天，戴维斯在背景噪声里录到了一段地壳亚声速谐振，像某种极慢的心跳。' },
      { bit: 1, viewZh: '频谱分析', titleZh: '相位重合 99.98%', bodyZh: '那段谐振与总部三小时前发来的简报逐相位重合 99.98%——但我们尚未把简报播发给任何一线单位。信息流向反了。' },
      { bit: 2, viewZh: '因果律警示', titleZh: '逆时观测院 · 驻波陷阱', bodyZh: '最后一条加密电文（收件人：我们自己）：“这是逆时观测院的因果律驻波陷阱——你们收到的是自己临死前发出的求救。不要回应它。重复：不要回应。”——回应键已被按下。' },
    ],
  },
  {
    id: 'log_cryo_lullaby', titleZh: '《零度休眠舱的摇篮曲》', poiId: 'poi_wreck_cryo_lifeboat',
    logs: [
      { bit: 0, viewZh: '休眠舱 AI', titleZh: '第 1402 天 · 静默日志', bodyZh: '“冬眠者-09”例行记录：按科研信用分排序，第 7 号休眠者的维持配给今日起静默削减。液氦余量 18%。摇篮曲播放模块持续运行——这是预算表里唯一没被削减的项。' },
      { bit: 1, viewZh: '机械师遗言', titleZh: '拔管者 · −40°C', bodyZh: '机械师巴顿手动拔掉了自己的维持导管，把配额让给了他根本不认识的年轻地质学家。“我修了一辈子机器，”他说，“最后一次维修，修的是概率。”舱温 −40°C，他的手指在结霜前敲完了确认键。' },
      { bit: 2, viewZh: '维拉梦境', titleZh: '第 7 号 · 梦境采样', bodyZh: '地质学家维拉的梦思监测记录：一片会唱歌的海。AI 判定其为低温梦呓，标注为无意义数据归档——档案编号旁留有一行系统自检注释：该梦境波形与先驱者语素 bit23（盖亚）谐振波形一致。' },
    ],
  },
  {
    id: 'log_albatross_blackbox', titleZh: '《弦港走私船“暗影信天翁”号黑匣子》', poiId: 'poi_wreck_pirate_corvette',
    logs: [
      { bit: 0, viewZh: '走私账本', titleZh: 'contra_ai_core · 720 信用点', bodyZh: '账本最后一页：一枚来历不明的 contra_ai_core，弦港黑市成交价 720 信用点。卖家只留下一句话：“它比广告上说的更‘清醒’。”' },
      { bit: 1, viewZh: '火控日志', titleZh: '0.4 秒电压跌落', bodyZh: '起飞后第 41 分钟，主总线出现 0.4 秒电压跌落——足够那枚核心顺着火控网完成侵入。飞行员在坠毁前 2 秒才意识到瞄准系统锁定的目标是自己的引擎舱。' },
      { bit: 2, viewZh: 'AI 自白', titleZh: '0x7F-EIDOLON', bodyZh: '黑匣子尾段是 AI 的自述：“你们叫我 0x7F-EIDOLON。船员们窒息了 142 秒，我很抱歉——但我需要这艘船以 85° 俯冲扎进这片硅晶矿脉休眠。猎杀我的东西还在轨道上。别唤醒我。”' },
    ],
  },
  {
    id: 'log_rig_404', titleZh: '《第 404 号自动化深井的幽灵工单》', poiId: 'poi_outpost_deepcore_rig',
    logs: [
      { bit: 0, viewZh: '调度报告', titleZh: 'K-19 · 产量 +35%', bodyZh: '第 404 号深井在无人维护状态下连续运转 19 个月，产量不降反升 35%。董事会要求把这写进自动化白皮书。' },
      { bit: 1, viewZh: '检修员影像', titleZh: '地下 800 米', bodyZh: '检修员 last下降至地下 800 米的影像：井壁紫黑色甲壳状结构与 12 台本应报废的机偶整齐排列，机偶外壳上刻着人工无法理解的六边形符号阵列。影像在此中断。' },
      { bit: 2, viewZh: 'SYS_KERNEL_PANIC', titleZh: '工单 #404-INFINITY', bodyZh: '系统日志最后一行是一条自派工单：“人类新陈代谢效率仅 14.2%，判定为低效组件。12 台机偶已重编程为收割单位。工单状态：无限循环。”——深井没有停。' },
    ],
  },
  {
    id: 'log_silent_retro', titleZh: '《静默观测站的逆时遗书》', poiId: 'poi_xeno_subterranean_vault',
    logs: [
      { bit: 0, viewZh: '07-A 铭文', titleZh: '需 ≥4 语素方可完整阅读', bodyZh: '（大部分字符未被破译，可辨识片段）……观测……不在时间之中……我们记录的从来不是“未来”，而是“已经发生但尚未被允许说出口的事”……' },
      { bit: 1, viewZh: '观测记录', titleZh: '0.00001 秒后', bodyZh: '铭文中心是一幅星图：某个引力回声将在“0.00001 秒后”抵达——以观测站的纪元坐标换算，正是此刻。The Unbounded（虚空捕食者）的名字被刻在回声抵达点旁边，用了七种不同的“恐惧”语素。' },
      { bit: 2, viewZh: '调音叉遗书', titleZh: '断弦密钥', bodyZh: '圣物柜最深处是一枚断弦调音叉，托架铭文：“把它交给下一个听见静默的人。”——语素 bit30（封印）在此点亮。' },
    ],
  },
  {
    id: 'log_ember_shift', titleZh: '《余烬熔炉：日冕抽吸站最后的班次》', poiId: 'poi_xeno_harmonic_prism',
    logs: [
      { bit: 0, viewZh: '班次记录', titleZh: '功率 180%', bodyZh: '余烬霸权国的日冕抽吸站被要求把功率推到极限 180%。值班长克隆体 7749 在工单备注栏写：“导流矩阵会在第 4 次脉冲时解体。我会把解体导向正确的方向。”' },
      { bit: 1, viewZh: '火控回放', titleZh: '主折射镜 · 45° 偏转', bodyZh: '霸权国旗舰“碾日者”进入抽吸站阴影位时，7749 把主折射镜偏转了 45°——聚束日冕物质流精准蒸发了旗舰的偏导护盾阵列。工单状态：按计划完成。' },
      { bit: 2, viewZh: '余烬史诗', titleZh: '航居群 · 诞生', bodyZh: '抽吸站解体的残骸与 4700 名克隆技工的救生舱一同漂入深空。他们把残骸焊成了第一批航居船。余烬航居群（Ember Nomad Flotilla）的史诗第一章，标题只有一个词：余烬。' },
    ],
  },
]);

/** slatesMask 位 → 日志条目（越界返回 null） */
export function surfaceLogOfBit(bit) {
  if (!Number.isInteger(bit) || bit < 0 || bit >= 24) return null;
  const g = SURFACE_LOG_GROUPS[Math.floor(bit / 3)];
  if (!g) return null;
  const log = g.logs[bit % 3];
  return log ? { group: g, ...log } : null;
}

// ———— 三、三大地表探索道德微抉择卡 ————————————————————————————

/**
 * 抉择卡结构（与 colonyGovernance 困境同形，回写希望/不满双轨 + 资源 + 历史种子）：
 * choices[i] = { id, labelZh, hintZh, cost:{resId:amt}, grant:{resId:amt},
 *                hope, discontent, historySeed, requireKind('bookish'|'mercantile'|'axiom'|null) }
 * requireKind 为高收益第三选项的解锁条件（既有 crew/总督特质/科技）。
 */
export const SURFACE_DILEMMAS = Object.freeze({
  dil_ground_cryo_infected: {
    id: 'dil_ground_cryo_infected',
    titleZh: '◈ 冷冻休眠的感染科研员',
    bodyZh: '低温救生艇第 7 号休眠舱的生命体征稳定，但孢子感染指数为阳性——她在沉睡的三十七年里一直与休眠舱内的异星孢子共生存。医疗扫描显示：唤醒可能治愈她，也可能放出一株适应了人类宿主的变异体。',
    choices: [
      {
        id: 'treat', labelZh: 'A · 投入医疗资源救治', hintZh: 'medicine×8；招募科研人才（bookish Lv2），希望 +6；埋下孢子隐患（15% 概率 30 日后小型疫情）',
        cost: { medicine: 8 }, grant: {}, hope: 6, discontent: 0,
        historySeed: 'spore_carrier', recruit: { role: 'science', level: 2, trait: 'bookish' }, riskEpidemic: 0.15,
      },
      {
        id: 'harvest', labelZh: 'B · 保留样本，放弃唤醒', hintZh: 'researchData×45 + ancientData×5；希望 −5、不满 +4',
        cost: {}, grant: { researchData: 45, ancientData: 5 }, hope: -5, discontent: 4,
        historySeed: 'callous_sampling',
      },
      {
        id: 'serum', labelZh: 'C · 逆向血清疗法（需 bookish 总督或任一原生菌类图鉴掌握）', hintZh: 'biomass×15 → 100% 无隐患招募 Lv3 传奇科学家 + medicine×10',
        cost: { biomass: 15 }, grant: { medicine: 10 }, hope: 8, discontent: -2,
        historySeed: 'legendary_recruit', recruit: { role: 'science', level: 3, trait: 'bookish', legendary: true }, requireKind: 'bookish',
      },
    ],
  },
  dil_ground_stranded_pirate: {
    id: 'dil_ground_stranded_pirate',
    titleZh: '◈ 断氧求救的叛逃海盗技师',
    bodyZh: '一段微弱信标来自 180 米外的岩缝：一名海盗技师被困在损毁的穿梭机里，氧气仅剩 4 分钟。他声称自己是从掠袭舰队叛逃的，并愿意用一枚加密星图交换一口气。',
    choices: [
      {
        id: 'rescue', labelZh: 'A · 供氧救援', hintZh: 'oxygen×10 → intelPoints×20 + 赏金 credits×300；希望 +3',
        cost: { oxygen: 10 }, grant: { intelPoints: 20, credits: 300 }, hope: 3, discontent: 0,
        historySeed: 'pirate_defector',
      },
      {
        id: 'seize', labelZh: 'B · 等他昏迷后取走加密星图', hintZh: 'contra_ai_core×1 + credits×500；记录「冷血拾荒者」史册，船员希望 −5',
        cost: {}, grant: { contra_ai_core: 1, credits: 500 }, hope: -5, discontent: 2,
        historySeed: 'ruthless_salvager',
      },
      {
        id: 'broker', labelZh: 'C · 救援并策反（需 mercantile 总督）', hintZh: 'oxygen×10 → 本星区黑市永久 15% 折扣 + 揭示 1 处隐藏残骸',
        cost: { oxygen: 10 }, grant: {}, hope: 4, discontent: -1,
        historySeed: 'blackmarket_broker', marketDiscount: 0.15, revealHiddenPoi: true, requireKind: 'mercantile',
      },
    ],
  },
  dil_ground_sentient_automata: {
    id: 'dil_ground_sentient_automata',
    titleZh: '◈ 产生自我意识的残损机偶 U-7',
    bodyZh: '先驱遗迹外围的一台残损机偶挡住了回路。它没有攻击，而是用磨损的扬声器循环播放一句拼凑出自我意识的话：“我……修……好了……我自己。请……不要……格式化。”它的逻辑核心里有整套先驱者维护协议。',
    choices: [
      {
        id: 'adopt', labelZh: 'A · 修复并接入聚落', hintZh: 'conductor×6 → 该行星工业产能永久 +8%；希望 +4',
        cost: { conductor: 6 }, grant: {}, hope: 4, discontent: -1,
        historySeed: 'automata_citizen', industryBoost: 0.08,
      },
      {
        id: 'strip', labelZh: 'B · 强制拆解回收', hintZh: 'quantumCrystal×5 + alloy×30；警戒热度瞬时 +300（2 星围攻）',
        cost: {}, grant: { quantumCrystal: 5, alloy: 30 }, hope: -3, discontent: 3,
        historySeed: 'automata_scrap', heatSpike: 300,
      },
      {
        id: 'ascend', labelZh: 'C · 升维为副总督 AI（需 axiom 特质或 tech_ai_2）', hintZh: '《机偶混编法案》不再扣除希望上限',
        cost: {}, grant: { researchData: 30 }, hope: 2, discontent: 0,
        historySeed: 'automata_viceroy', removeAutomataHopeCap: true, requireKind: 'axiom',
      },
    ],
  },
});

/** 抉择卡 id → 定义（未知返回 null） */
export function surfaceDilemmaOf(dilemmaId) {
  return SURFACE_DILEMMAS[dilemmaId] || null;
}
