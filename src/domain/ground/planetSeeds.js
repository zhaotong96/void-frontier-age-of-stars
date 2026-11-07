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
// —— WP-1（doc18 v0.2）：五大支柱扩展子流盐值（doc17 §3.1 契约，互不碰撞） ——
const SALT_FLORA = 0x9e3779b9;
const SALT_FAUNA = 0x7f4a7c15;
const SALT_RUIN = 0x6c8e9cf5;
const SALT_WEATHER = 0xb5297a4d;
const SALT_DILEMMA = 0x1b56c4e9;

/**
 * splitmix32 终态雪崩混淆器（WP-1：消除线性异或相关性，扩展子流专用）。
 * 既有 derivePlanetSeeds 的 base 不经 mix32（保持金快照 68462446 逐位不变）；
 * 扩展子流一律经本函数混淆，新旧两树互不影响。
 * @param {number} h 32 位无符号整数
 * @returns {number} 混淆后的 32 位无符号整数
 */
export function mix32(h) {
  let z = (h >>> 0);
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/**
 * 轻量级可复现 mulberry32 流发生器（WP-1：供生态/天气/困境纯函数局部消费）。
 * @param {number} seed32 混淆后的 32 位种子
 * @returns {()=>number} [0,1) 均匀浮点（确定性：同种子同序列）
 */
export function createSubRng(seed32) {
  let a = seed32 >>> 0;
  return function nextFloat() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/**
 * WP-1（doc18 v0.2）：五大支柱扩展确定性子流树（doc17 §5.1 原型 1A 契约）。
 * 纯函数 of (world.seed, planetId)：零 world.rng 消费、零 Math.random()；
 * base 经 mix32 雪崩混淆，与既有 derivePlanetSeeds（未混淆）互不影响，
 * 供生态（flora/fauna）、遗迹（ruin）、气象（weatherCycle）、治理困境（dilemma）消费。
 * @param {{seed:number}} world 世界实体（只读取 world.seed）
 * @param {string|number} planetId 行星实体 id
 * @returns {object} 扩展子流集合（planetSeed/themeSeed/…/dilemmaSeed(tick)）
 */
export function derivePlanetSeedsExtended(world, planetId) {
  const worldSeed = world && Number.isFinite(world.seed) ? world.seed >>> 0 : 0;
  const base = mix32(worldSeed ^ hash32(String(planetId)));
  return {
    planetSeed: base,
    themeSeed: mix32(base ^ hash32('theme')),
    macroTerrainSeed: mix32(base ^ hash32('macro')),
    biomeSeed: mix32(base ^ hash32('biome')),
    decorationSeed: mix32(base ^ hash32('deco')),
    cosmeticSeed: mix32(base ^ hash32('cosmetic')),
    missionSiteSeed(siteId, blueprintVersion = 1) {
      const v = Number.isFinite(blueprintVersion) ? blueprintVersion >>> 0 : 1;
      return mix32(base ^ hash32(`site:${siteId}`) ^ Math.imul(v || 1, SALT_SITE));
    },
    poiSeed(poiId) {
      return mix32(base ^ hash32(`poi:${poiId}`));
    },
    /** 支柱一：第 speciesIdx 种原生植物形态基因码子流 */
    floraSeed(speciesIdx) {
      return mix32(base ^ Math.imul((speciesIdx >>> 0) + 1, SALT_FLORA));
    },
    /** 支柱一：第 speciesIdx 种原生动物骨骼比例/营养级/相位子流 */
    faunaSeed(speciesIdx) {
      return mix32(base ^ Math.imul((speciesIdx >>> 0) + 1, SALT_FAUNA));
    },
    /** 支柱一：五阶段先驱者巨石遗址子流 */
    ruinSeed(siteId) {
      return mix32(base ^ hash32(`ruin:${siteId}`) ^ SALT_RUIN);
    },
    /** 支柱三：按游戏日（Math.floor(world.tick / 24)）派生的气象锋面子流 */
    weatherCycleSeed(dayIndex) {
      return mix32(base ^ Math.imul((dayIndex >>> 0) + 1, SALT_WEATHER));
    },
    /** 支柱四：聚落总督抉择事件子流（按战略 tick） */
    dilemmaSeed(tick) {
      return mix32(base ^ Math.imul((tick >>> 0) + 1, SALT_DILEMMA));
    },
  };
}
