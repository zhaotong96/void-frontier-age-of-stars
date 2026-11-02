/**
 * content/constants.js — 全局平衡常量与规则参数（任务书 src/content/constants.js）
 *
 * 数值是初始平衡基线，后续按标准场景批量模拟调参（任务书 13.5）。
 */

export const BAL = {
  // —— 星系生成 ——
  galaxy: {
    sizes: {
      story: 64,       // 新手局
      standard: 96,    // 基准战役
      large: 160,
      huge: 256,
    },
    lanesPerNodeMin: 2,
    lanesPerNodeTarget: 3.2, // 平均航路边
    lanePruneFactor: 1.9,    // 超过 kNN 均距 × 因子的候选边被剪除
    dangerClusters: 3,
    anomalyBaseChance: 0.34, // 每星系至少一个异常的基准概率（资源带修正）
  },

  // —— 经济 ——
  economy: {
    transactionLogCap: 400,     // 流水留存条数
    priceAlpha: 0.55,           // 价格供需敏感度
    priceMinFactor: 0.35,       // 价格下限 = base × 0.35
    priceMaxFactor: 3.2,        // 价格上限 = base × 3.2
    priceSmooth: 0.35,          // 价格向目标值平滑系数（每日）
    marketBaseStockDays: 40,    // 市场基准库存（按基准需求的“天”数）
    taxRateColony: 0.22,        // 殖民地税基比例
  },

  // —— 人口 ——
  population: {
    growthBase: 0.011,          // 日基础增长率（食物充足、住房富余时）
    foodPerPop: 0.020,          // 每人每日食物消耗（吨）
    goodsPerPop: 0.012,         // 每人每日消费品消耗
    housingPerPop: 1,           // 每人需住房单位
    jobSeekOrder: ['farmer', 'worker', 'engineer', 'researcher', 'administrator', 'soldier', 'trader', 'unemployed'],
    stabilityFromHousingShort: -0.9,
    stabilityFromFoodShort: -1.4,
    stabilityBase: 55,
    growthHousingBuffer: 1.12,  // 住房利用率超过该阈值停止增长
  },

  // —— 舰船与战斗 ——
  combat: {
    tickBattleSeconds: 30,      // 1 战略 tick 推进 30 战斗秒（设计约定）
    dt: 1 / 30,                 // 战术固定步长
    maxProjectiles: 600,
    retreatChargeSeconds: 25,   // 跃迁撤离蓄能时间
    hitAngleBase: 1.0,
    critChance: 0.08,
    critMult: 1.8,
    critMultMin: 0.5,
    shieldRegenDelay: 6,        // 受击后护盾恢复延迟（战斗秒）
    heatDissipation: 12,        // 每秒散热
    overheatThreshold: 100,
    supplyDrainPerShipPerHour: 0.5, // 后备补给消耗
  },

  // —— 舰队航行 ——
  navigation: {
    laneSpeedDivisor: 55,       // 航路小时数 = 距离(策略单位) / (舰队速度 × 除数)
    fuelPerLaneHour: 1.0,       // 每航路小时燃料消耗（舰队级基准）
    strandedRepairHours: 48,    // 受困舰队就地修复时长
    supplyRangeHours: 240,      // 补给线有效时长
  },

  // —— AI ——
  ai: {
    evalEveryTicks: 24,         // 每游戏日评估一次
    maxActiveOrders: 6,         // 同一 AI 并发命令上限（防空转）
    commandTimeoutTicks: 480,   // 命令超时（20 游戏日）
    maxReplan: 3,               // 同目标重规划上限
    cooldownTicks: 72,
  },

  // —— 事件/危机 ——
  narrative: {
    dailyEventCheckChance: 0.42,
    eventCooldownTicks: 360,
    crisisPhaseCheck: 'monthly',
    chronicleCap: 800,
  },

  // —— 存档 ——
  persistence: {
    autosaveIntervalDays: 2,
    battleHistoryCap: 24,
    transactionCap: 400,
  },
};

/** 资源类别（4.4 表格） */
export const RESOURCE_CATEGORIES = ['baseMineral', 'industrial', 'volatile', 'bio', 'energy', 'advanced', 'economic'];

/** 难度修正（影响 AI 资源起点、事件频率、经济修正等 —— 任务书 6.5） */
export const DIFFICULTY = {
  story: {
    aiStartResourceMult: 0.7,
    aiAggression: 0.6,
    eventFrequencyMult: 0.7,
    playerEconomyMult: 1.15,
    crisisSpeedMult: 0.7,
    warLossMult: 0.7,
  },
  standard: {
    aiStartResourceMult: 1.0,
    aiAggression: 1.0,
    eventFrequencyMult: 1.0,
    playerEconomyMult: 1.0,
    crisisSpeedMult: 1.0,
    warLossMult: 1.0,
  },
  hard: {
    aiStartResourceMult: 1.4,
    aiAggression: 1.35,
    eventFrequencyMult: 1.2,
    playerEconomyMult: 0.9,
    crisisSpeedMult: 1.3,
    warLossMult: 1.2,
  },
  sandbox: {
    aiStartResourceMult: 1.0,
    aiAggression: 1.0,
    eventFrequencyMult: 1.0,
    playerEconomyMult: 1.0,
    crisisSpeedMult: 1.0,
    warLossMult: 1.0,
  },
};
