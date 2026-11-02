/**
 * content/anomalies.js — 异常模板（任务书 3.5 / 13.3：首发 ≥20，当前为
 * 首批可测试子集，随叙事系统扩充到目标数量）
 *
 * rewards: [{resId, amount}]；risks: 描述性风险标签（调查失败惩罚由叙事层定义）。
 */

export const ANOMALY_TEMPLATES = [
  {
    id: 'ano_ancient_beacon',
    nameZh: '沉默信标', nameEn: 'Silent Beacon',
    descZh: '一枚仍在以极低功率重复广播的古代导航信标，编码方式不属于任何已知文明。',
    category: 'ancient', difficultyMod: 2,
    rewards: [{ resId: 'ancientData', amount: 6 }, { resId: 'researchData', amount: 12 }],
    risks: ['辐射残留'],
    storyTag: 'signal_frontier',
  },
  {
    id: 'ano_derelict_hulk',
    nameZh: '漂残舰骸', nameEn: 'Derelict Hulk',
    descZh: '一艘结构完整但反应堆早已熄灭的运输舰残骸，货舱处于真空封存状态。',
    category: 'derelict', difficultyMod: 1,
    rewards: [{ resId: 'alloy', amount: 40 }, { resId: 'conductor', amount: 8 }],
    risks: ['结构失稳'],
  },
  {
    id: 'ano_lost_probe',
    nameZh: '失踪探测器', nameEn: 'Lost Probe',
    descZh: '某支探索队半个世纪前失联的深空探测器，黑匣子仍在发送心跳信号。',
    category: 'derelict', difficultyMod: 1,
    rewards: [{ resId: 'researchData', amount: 10 }, { resId: 'intelPoints', amount: 5 }],
    risks: [],
  },
  {
    id: 'ano_xeno_flora',
    nameZh: '虚空花圃', nameEn: 'Void Flora',
    descZh: '在小行星内腔中靠恒星风生长的硅基聚落，代谢产物具有独特的材料价值。',
    category: 'life', difficultyMod: 2,
    rewards: [{ resId: 'biomass', amount: 30 }, { resId: 'quantumCrystal', amount: 2 }],
    risks: ['生物侵害'],
  },
  {
    id: 'ano_gravity_lens',
    nameZh: '引力透镜', nameEn: 'Gravity Lens',
    descZh: '一片天然引力透镜，可用于远距离观测，但会扭曲本地传感读数。',
    category: 'spatial', difficultyMod: 3,
    rewards: [{ resId: 'researchData', amount: 18 }],
    risks: ['导航畸变'],
  },
  {
    id: 'ano_signal_loop',
    nameZh: '循环信号', nameEn: 'Looping Signal',
    descZh: '一段每 41 小时精确重复的窄带信号，来源指向没有天体的空域。',
    category: 'signal', difficultyMod: 2,
    rewards: [{ resId: 'researchData', amount: 14 }, { resId: 'ancientData', amount: 2 }],
    risks: ['信息污染'],
    storyTag: 'signal_frontier',
  },
  {
    id: 'ano_dead_colony',
    nameZh: '无息殖民地', nameEn: 'Silent Colony',
    descZh: '一处大气循环仍在运转却没有任何生命应答的殖民地遗址。',
    category: 'ancient', difficultyMod: 3,
    rewards: [{ resId: 'ancientData', amount: 8 }, { resId: 'medicine', amount: 6 }, { resId: 'alloy', amount: 30 }],
    risks: ['未知病原'],
  },
  {
    id: 'ano_ai_remnant',
    nameZh: '自治体残响', nameEn: 'Automata Remnant',
    descZh: '一组仍在执行数百年前接收到的命令的工业自治单元。',
    category: 'automata', difficultyMod: 4,
    rewards: [{ resId: 'conductor', amount: 12 }, { resId: 'researchData', amount: 16 }],
    risks: ['敌对重启'],
    storyTag: 'crisis_automata',
  },
  {
    id: 'ano_wormhole_trace',
    nameZh: '虫洞残迹', nameEn: 'Wormhole Trace',
    descZh: '空间曲率留下的短暂痕迹，显示此处曾有通道开启又闭合。',
    category: 'spatial', difficultyMod: 4,
    rewards: [{ resId: 'exoticMatter', amount: 1 }, { resId: 'researchData', amount: 20 }],
    risks: ['空间失稳'],
    storyTag: 'signal_frontier',
  },
  {
    id: 'ano_pulsar_cache',
    nameZh: '脉冲缓存', nameEn: 'Pulsar Cache',
    descZh: '藏在脉冲星辐射盲区里的数据锚点，只有在辐射窗口期才能安全读取。',
    category: 'signal', difficultyMod: 3,
    rewards: [{ resId: 'researchData', amount: 22 }],
    risks: ['辐射灼伤'],
  },
];
