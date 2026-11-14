/**
 * domain/world/deterministicRng.js — 确定性雪崩哈希与独立盐值子流注册表
 * （SPEC-PLAN-043 总控卷 Task 0.1；责任人：Eng-A）
 *
 * 职责：为太空歌剧七系统（S1–S7）、行星三维底座、自主舰队、群像英雄、
 * 子空间信标流与戏剧导演提供「无状态、零 world.rng 消费」的确定性随机源。
 *
 * 纪律（doc43 §1.4.1 零原生随机铁律）：
 *  - 严禁 Math.random / Date.now；一切随机采样必须经 deriveSeed 四元组派生；
 *  - 全部函数为纯函数：不改写任何入参、不读全局时钟、不挂模块级可变状态；
 *  - 盐值一律取自 DOMAIN_SALTS 冻结表，严禁各模块私自硬编码魔数盐值。
 *
 * 与 src/core/rng.js 的关系：core/rng 是「世界主随机流」（xoshiro128**，状态
 * 随存档走、被消费即漂移金快照）；本模块是「无状态旁路子流」（同一四元组
 * (worldSeed, domainSalt, entityId, step) 永远派生同一 uint32），二者互不干涉。
 */

/**
 * 全工程统一领域盐值注册表（冻结；14 个独立子流，两两互异）。
 * 高半字节按领域族分段：0x5xxx 行星底座 / 0xAxxx-S1/S2 / 0xBxxx-S3/S4 /
 * 0xCxxx-S5/S6/S7 / 0xDxxx 舰队与英雄 / 0xExxx 信标 / 0xFxxx 戏剧导演。
 */
export const DOMAIN_SALTS = Object.freeze({
  PLANET_MASTER:       0x5000, // 行星静态天体原型与初始地层生成
  PLANET_SURFACE_CA:   0x5001, // 行星地表 256-Tile 稀疏前沿元胞自动机演化
  PLANET_SUBTERRANEAN: 0x5002, // 深层地壳坍塌与地底遗迹激活检定
  ARC_S1_ARCHAEOLOGY:  0xA101, // S1 深空考古与先驱者事件链采样
  ARC_S2_ECOLOGY:      0xA201, // S2 行星生态相变与局部环境灾害触发
  ARC_S3_SOCIETY:      0xB201, // S3 殖民地阶级思潮漂移与叛乱事件采样
  ARC_S4_ECONOMY:      0xB401, // S4 宏观经济短缺波动与破产次生冲击
  ARC_S5_DOCTRINE:     0xC501, // S5 战舰 D-Mod 战损抽签与残骸生成
  ARC_S6_SYNDICATE:    0xC301, // S6 黑市走私查获检定与激进组织渗透袭击
  ARC_S7_CRISIS:       0xC701, // S7 议会刺杀检定与三大终局天灾裂隙选址
  SECTOR_AUTONOMOUS:   0xD401, // 自主星区生态舰队（商队/走私/巡逻/远征/赏金）路由
  PARAGON_DESTINY:     0xD801, // 星海群像英雄特质觉醒、创伤检定与政变判定
  SUBSPACE_BEACON:     0xE501, // 全频段子空间信标流生成与频段调制
  DRAMA_DIRECTOR:      0xF601, // 自适应太空歌剧戏剧导演高潮弧与机遇信标投放
});

/**
 * 32-bit 确定性无状态雪崩哈希混洗函数
 *
 * Math.imul 保证 JS 引擎 32 位有符号乘法精确截断（不丢失低位精度），
 * 每段异或移位后由 >>> 0 强制归一到无符号 32 位整数域。
 *
 * @param {number} h - 输入 32 位整数（可为负；内部 `h | 0` 截断）
 * @returns {number} 无符号 32 位整数 (0 ~ 4294967295)
 */
export function mix32(h) {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * 四元组确定性子流种子派生器（三段 mix32 级联雪崩）
 *
 * 同一 (worldSeed, domainSalt, entityId, step) 输入永远产出同一 uint32：
 * 帧回放、存档读档、双世界对拍均逐位可复现；不同领域盐值互不串流。
 *
 * @param {number} worldSeed - 世界主种子（world.seed）
 * @param {number} domainSalt - 领域隔离盐值（必须取自 DOMAIN_SALTS）
 * @param {number} entityId - 实体数字 ID（行星/舰队/领袖/局势 ID；可为负）
 * @param {number} step - 逻辑帧号或阶段序号（可为大整数）
 * @returns {number} 无符号 32 位派生种子 (0 ~ 4294967295)
 */
export function deriveSeed(worldSeed, domainSalt, entityId, step) {
  let h = mix32((worldSeed ^ domainSalt) >>> 0);
  h = mix32((h ^ Math.imul(entityId | 0, 0x9e3779b9)) >>> 0);
  h = mix32((h ^ Math.imul(step | 0, 0x7f4a7c15)) >>> 0);
  return h >>> 0;
}

/**
 * 确定性 [0, 1) 均匀分布双精度浮点采样
 *
 * uint32 种子除以 2^32 归一化；分母为常数 2^32 保证区间左闭右开。
 *
 * @param {number} worldSeed - 世界主种子
 * @param {number} domainSalt - 领域隔离盐值（DOMAIN_SALTS）
 * @param {number} entityId - 实体数字 ID
 * @param {number} step - 逻辑帧号或阶段序号
 * @returns {number} [0, 1) 双精度浮点
 */
export function sampleFloat01(worldSeed, domainSalt, entityId, step) {
  return deriveSeed(worldSeed, domainSalt, entityId, step) / 4294967296.0;
}

/**
 * 确定性加权离散采样器（线性走表）
 *
 * r = sampleFloat01(...) × 总权重，随后按权重累计表线性走查返回命中下标。
 * 非有限 / 非正权重按 0 计入（不命中）；空权重表或总权重 ≤ 0 时按契约返回 0。
 *
 * @param {number} worldSeed - 世界主种子
 * @param {number} domainSalt - 领域隔离盐值（DOMAIN_SALTS）
 * @param {number} entityId - 实体数字 ID
 * @param {number} step - 逻辑帧号或阶段序号
 * @param {number[]} weights - 权重表（正数生效；空表/全零表返回 0）
 * @returns {number} 命中的权重下标 (0 ~ weights.length-1；空表返回 0)
 */
export function sampleWeightedIndex(worldSeed, domainSalt, entityId, step, weights) {
  if (!Array.isArray(weights) || weights.length === 0) return 0;
  let total = 0;
  const table = new Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    const clamped = typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0;
    table[i] = clamped;
    total += clamped;
  }
  if (total <= 0) return 0; // 空权重 / 全零权重契约：返回 0
  const r = sampleFloat01(worldSeed, domainSalt, entityId, step) * total;
  let acc = 0;
  for (let i = 0; i < table.length; i++) {
    acc += table[i];
    if (r < acc) return i;
  }
  return table.length - 1;
}
