/**
 * domain/ground/planetSeeds.js — 行星随机子流隔离树（doc7 TASK-1.1）
 *
 * 规范（序列 6 §7.2 / doc7 红线 4）：行星地貌、装饰、任务场景、POI、生态与
 * 粒子相位一律使用可复现子随机流；严禁消费主 world.rng（保 52/52 测试与
 * 金快照哈希不漂移），严禁 Math.random()。
 *
 * 子流树：
 *   worldSeed
 *    └─ planetSeed(planetId) = (world.seed ^ hash32(planetId))
 *        ├─ themeSeed        主题抽选与主题参数
 *        ├─ macroTerrainSeed 宏观地貌高度场
 *        ├─ biomeSeed        生态/地质分区
 *        ├─ decorationSeed   外围装饰（按 regionId 再派生）
 *        ├─ cosmeticSeed     纯视觉相位（不进模拟状态）
 *        ├─ missionSiteSeed(siteId, blueprintVersion)  登陆点蓝图实例
 *        └─ poiSeed(poiId)   外围持久化兴趣点
 *
 * 本模块为纯函数：只读 world.seed，绝不读写 world.rng，无任何内部可变状态。
 */

import { hash32 } from './SurfaceSandbox.js';

/** 子流 salt 的混淆常数（splitmix32 黄金比例常数，防止直接异或撞流） */
const SALT_SITE = 0x85ebca6b;

/**
 * 派生一颗行星的确定性随机子流树。
 * 纯函数 of (world.seed, planetId)：同输入逐位一致，且不触碰 world.rng。
 * @param {{seed:number}} world 世界实体（只读取 world.seed）
 * @param {string|number} planetId 行星实体 id
 * @returns {{
 *   planetSeed:number,
 *   themeSeed:number,
 *   macroTerrainSeed:number,
 *   biomeSeed:number,
 *   decorationSeed:number,
 *   cosmeticSeed:number,
 *   missionSiteSeed:(siteId:string|number, blueprintVersion?:number)=>number,
 *   poiSeed:(poiId:string|number)=>number,
 * }}
 */
export function derivePlanetSeeds(world, planetId) {
  const worldSeed = world && Number.isFinite(world.seed) ? world.seed >>> 0 : 0;
  const base = (worldSeed ^ hash32(planetId)) >>> 0;
  return {
    planetSeed: base,
    themeSeed: (base ^ hash32('theme')) >>> 0,
    macroTerrainSeed: (base ^ hash32('macro')) >>> 0,
    biomeSeed: (base ^ hash32('biome')) >>> 0,
    decorationSeed: (base ^ hash32('deco')) >>> 0,
    cosmeticSeed: (base ^ hash32('cosmetic')) >>> 0,
    /** 登陆点蓝图子流：siteId 与蓝图版本共同决定（蓝图升级不漂移旧档语义） */
    missionSiteSeed(siteId, blueprintVersion = 1) {
      const v = Number.isFinite(blueprintVersion) ? blueprintVersion >>> 0 : 1;
      return (base ^ hash32(`site:${siteId}`) ^ Math.imul(v || 1, SALT_SITE)) >>> 0;
    },
    /** 外围持久化 POI 子流：poiId 独立派生，增删 POI 不影响其他子流 */
    poiSeed(poiId) {
      return (base ^ hash32(`poi:${poiId}`)) >>> 0;
    },
  };
}
