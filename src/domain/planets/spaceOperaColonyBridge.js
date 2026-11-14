/**
 * domain/planets/spaceOperaColonyBridge.js — 双轨经济与殖民地双向同步桥
 * （SPEC-PLAN-048 §Task 4.2 / SPEC-PLAN-050 §Task 50.1；责任人：Eng-B；GAP-02 消除落点）
 *
 * 职责（doc50 §Task 50.1 逐条契约 + doc48 §Task 4.2 逆向赋能清单）：
 *  1. syncColonyToSpaceOpera(colony, world) 正向同步（主游戏 → 太空歌剧紧凑底座）：
 *     - 归属与人口：compact.colony.ownerId = colony.factionId、popTotal = population.total；
 *     - 资源槽位镜像（doc48 §1.3 映射表，8 维 stockpile 双向镜像的正向半程）；
 *     - 建筑活性映射：colony.buildings active 列表 → 256-Tile buildingId 镜像播种
 *       （采矿 +1 / 重工·船坞·精炼·科研 +2 / 纳米锻炉·同步加速器经 industryMods 通道 +4）
 *       → recomputeIndustrialAttention(compact) 全量重算 industrialAttention
 *       （满 7 由 S6 月度钩子 shadowSyndicateArc.js:398 自动触发激进支部激活）；
 *     - 重工业环境扰动：每月（tick % 720 === 0）envVector[7] += 0.05 × heavyCount
 *       （doc50 契约注释「每月增量推进」；同步函数每小时被调用，按月界门控防 720 倍放大）。
 *  2. syncSpaceOperaToColony(planet, world) 反向同步（太空歌剧 → 主游戏，显式 API）：
 *     8 维槽位 → colony.stockpile / 帝国账本（CHK-50-02「反之亦然」对称半程）。
 *  3. getSpaceOperaModifiers(colony, world) 逆向赋能（太空歌剧 → 主游戏结算）：
 *     - S3 稳定度产出倍率：1 + computeStabilityOutputMultiplier(stability)/100
 *       （colonySocialArc.js:128 返回百分点口径；stability 80 → 1.18 / 20 → 0.70 精确）；
 *     - S4 Cut Investments（该行星活跃 S4 局势 currentApproach === 'CUT_INVESTMENTS'）
 *       → 产出 ×0.75；Empire Defaulted（isEmpireDefaulted）→ 产出/科研/船坞 ×0.75、
 *       建造费 ×1.25（shortageSituationArc.js:244 EMPIRE_DEFAULT_PENALTIES 权威数值表）；
 *     - S1 考古对策科研修正：CAUTIOUS ×0.95 / STREAMLINED ×0.90 / OVERDRIVE ×0.85。
 *  4. applyBeholderPsychicConversion(world)：The Beholder MURMURING_MONOLITH 形态灵能
 *     矿工转化的帝国账本落账（每名矿工每月 credits +8 与 unityTreasury +6，
 *     galacticParagons.js TELEPATH_* 权威常量；doc48 §Task 4.2 逆向赋能第 5 条）。
 *
 * 纪律（doc43 §1.4 / doc50 红线）：
 *  - 全部函数首行守卫 world.spaceOperaState：金快照 8be8ce2c 世界零读取零写入零漂移；
 *  - 零 Math.random / Date.now / world.rng：确定性遍历一律 Object.keys(...).sort()
 *    或数组原始序（colony.buildings 下标即确定性键）；
 *  - 纯数据操作：import 期零副作用、不注册时钟阶段（接入由 HourlySystems 显式调用）。
 */

import { recomputeIndustrialAttention } from '../economy/shadowSyndicateArc.js';
import { computeStabilityOutputMultiplier } from '../politics/colonySocialArc.js';
import { isEmpireDefaulted } from '../economy/shortageSituationArc.js';
import { packTile, unpackTile, numericEntityKey } from './planetStateSchema.js';
import { buildingDef } from './colony.js';
import { credit } from '../economy/ledger.js';
import { grantUnity } from '../diplomacy/galacticSenateAndCrisisArc.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';
import {
  TELEPATH_ENERGY_PER_POP_MONTH,
  TELEPATH_UNITY_PER_POP_MONTH,
} from '../characters/galacticParagons.js';

/* ============================== 槽位映射常量（doc48 §1.3 表） ============================== */

/** 主游戏殖民地建筑 → 256-Tile buildingId 槽段映射（doc48 §Task 4.2 权重表落位段） */
const TILE_SLOT_RANGE = Object.freeze({
  mining: Object.freeze([1, 15]),     // 采矿 +1（矿脉 deposit 上）/ 农业基础 +0（无矿脉格）
  refining: Object.freeze([39, 40]),  // 精炼 fuelProduction +2
  industry: Object.freeze([32, 35]),  // 重工 heavyIndustry +2
  science: Object.freeze([41, 47]),   // 科研 techMining +2
  orbitalWorks: Object.freeze([36, 38]), // 船坞 orbitalWorks +2
  farming: Object.freeze([1, 15]),    // 非工业建筑落 farming 段（+0，占位不推关注度）
});

/** 船坞建筑特判（bld_shipyard 归 orbitalWorks 槽段，权重 +2） */
const SHIPYARD_DEFS = /^(bld_shipyard)$/;

/** 纳米锻炉 / 同步加速器 defId 特判（industryMods 人工制品通道，每件 +4） */
const ARTIFACT_BUILDING_RE = /nanoforge|synchrotron/i;

/** bridge 镜像写入口 industryMods 键前缀（与 installIndustryMod 玩家安装键空间隔离） */
const BRIDGE_MOD_PREFIX = 'bridge:';

/** 重工业环境扰动月增量（doc50 §Task 50.1 §3：0.05 × heavyCount / 月） */
const HEAVY_ENV_MONTHLY_PER_BUILDING = 0.05;

/* ============================== 正向同步（主游戏 → 紧凑底座） ============================== */

/**
 * 将主游戏原生殖民地数据正向同步至太空歌剧 compactState（doc50 §Task 50.1 契约形态）。
 * HourlySystems production 阶段每 tick 逐殖民地调用；全部槽位为主游戏权威投影。
 *
 * @param {object} colony - 主游戏殖民地实体（world.entities.colonies[cid]）
 * @param {object} world - 世界根对象
 * @returns {boolean} 是否实际执行同步（容器缺失/未激活太空歌剧 → false 零写入）
 */
export function syncColonyToSpaceOpera(colony, world) {
  if (!colony || !world || !world.spaceOperaState) return false;
  const planets = world.entities && world.entities.planets;
  const planet = planets && planets[colony.planetId];
  if (!planet || !planet.compactState || !planet.compactState.colony) return false;

  const compact = planet.compactState;
  const cColony = compact.colony;
  const factionId = colony.factionId || 'player';

  // —— 1. 人口与归属同步 ——
  // ownerId 数字键语义（numericEntityKey('fac_553') → 553 / 'frontier_compact' → hash32）：
  // 歌剧层 promoteEpoch（SpaceOperaClock.js:252）/ S6 月度扫描（shadowSyndicateArc.js:385）/
  // Beholder 锚定（galacticParagons toggleBeholderMode）均以 Number(ownerId) >= 0 判定殖民 ——
  // 直写字符串 factionId 会被判为无主星球（CHK-50-01 激进支部翻转失效）。
  // doc50 契约字符串归属以伴生字段 ownerFactionId 保全（UI 层消费）。
  cColony.ownerId = numericEntityKey(factionId);
  cColony.ownerFactionId = factionId;
  cColony.popTotal = (colony.population && colony.population.total) || 0;

  // —— 2. 资源库存槽位镜像（doc48 §1.3 映射表逐槽投影）——
  const cStock = colony.stockpile || {};
  const ledger = world.economy && world.economy.ledgers && world.economy.ledgers[factionId];
  const credits = (ledger && ledger.balances && ledger.balances.credits) || 0;

  cColony.stockpile[0] = Math.max(0, credits); // energy ⟷ 帝国账本 credits
  cColony.stockpile[1] = Math.max(0, (cStock.ferro || 0) + (cStock.silicate || 0)); // mineral
  cColony.stockpile[2] = Math.max(0, cStock.food || 0); // food
  cColony.stockpile[3] = Math.max(0, cStock.alloy || 0); // alloy
  cColony.stockpile[4] = Math.max(0, cStock.polymer || 0); // consumer
  cColony.stockpile[5] = Math.max(0, cStock.exoticMatter || 0); // exotic
  cColony.stockpile[6] = Math.max(0, cStock.rareEarth || 0); // rareEarth
  cColony.stockpile[7] = Math.max(0, cStock.electronics || 0); // component

  // —— 3. 建筑活性映射 → 256-Tile buildingId 镜像播种 + 工业关注度全量重算 ——
  mirrorBuildingsToTiles(colony, compact);

  // —— 4. 重工业环境扰动每月增量推进（月界门控：tick % 720 === 0 恰好一次）——
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  if (compact.envVector && Array.isArray(compact.envVector) && tick > 0 && tick % TICKS_PER_MONTH === 0) {
    let heavyCount = 0;
    const bList = colony.buildings || [];
    for (let i = 0; i < bList.length; i++) {
      const b = bList[i];
      if (!b || b.state !== 'active' || !b.defId) continue;
      const def = buildingDef(b.defId);
      if (!def) continue;
      const heavy = def.category === 'industry' || def.category === 'refining'
        || SHIPYARD_DEFS.test(def.id) || ARTIFACT_BUILDING_RE.test(def.id);
      if (heavy) heavyCount++;
    }
    if (heavyCount > 0) {
      compact.envVector[7] = Math.min(100.0, compact.envVector[7] + heavyCount * HEAVY_ENV_MONTHLY_PER_BUILDING);
    }
  }
  return true;
}

/**
 * 主游戏殖民地建筑 → compact 256-Tile buildingId 确定性镜像（重算关注度前的落位半程）：
 *  1. 清除上一轮 bridge 落位（compact.colony.bridgeTileMap 台账，其余位段无损保留）；
 *  2. 按 colony.buildings 数组原始序逐座落位（下标即确定性键）：
 *     - 纳米锻炉/同步加速器 → urbanZones.industryMods['bridge:*'] 人工制品通道（+4/件）；
 *     - 采矿/精炼/重工/科研/船坞 → 对应槽段首空闲 tile（采矿优先矿脉 depositCode>0 格）；
 *     - 其余建筑 → farming 段（1-15 非矿脉格，权重 0 占位）；
 *  3. recomputeIndustrialAttention(compact) 全量重算（shadowSyndicateArc.js:210 权威扫描）。
 * 同步幂等：同 (colony, compact) 输入恒同落位（bridgeTileMap 先清后置）。
 */
function mirrorBuildingsToTiles(colony, compact) {
  const tiles = compact.tiles;
  if (!Array.isArray(tiles) || !compact.colony || typeof compact.colony !== 'object') return;

  // —— 1. 清除上一轮落位（台账回滚；被 S6 破坏/违约清空的格自动归零态兼容）——
  const prevMap = compact.colony.bridgeTileMap;
  if (prevMap && typeof prevMap === 'object') {
    for (const key of Object.keys(prevMap).sort()) {
      const idx = prevMap[key];
      if (!Number.isInteger(idx) || idx < 0 || idx >= tiles.length) continue;
      const u = unpackTile(tiles[idx] >>> 0);
      if (u.buildingId !== 0) tiles[idx] = packTile({ ...u, buildingId: 0 });
    }
  }

  // —— 2. industryMods 通道：先清 bridge 键，再按当前建筑重置 ——
  if (!compact.urbanZones) compact.urbanZones = {};
  if (!compact.urbanZones.industryMods || typeof compact.urbanZones.industryMods !== 'object') {
    compact.urbanZones.industryMods = {};
  }
  const modsBag = compact.urbanZones.industryMods;
  for (const key of Object.keys(modsBag).sort()) {
    if (String(key).startsWith(BRIDGE_MOD_PREFIX)) delete modsBag[key];
  }

  /** 本轮落位台账：buildingIndex → tileIdx */
  const tileMap = {};
  /** 已占用 tile 集合（本轮去重） */
  const used = new Set();

  /** 首空闲 tile 搜索（确定性：槽段内下标升序；preferDeposit 时优先矿脉格） */
  const findFreeTile = (lo, hi, preferDeposit) => {
    let fallback = -1;
    for (let i = lo; i <= hi; i++) {
      if (i < 0 || i >= tiles.length) continue;
      const u = unpackTile(tiles[i] >>> 0);
      if (u.buildingId !== 0 || used.has(i)) continue;
      if (preferDeposit) {
        if (((u.depositCode >>> 2) & 0x03) !== 0 || (u.depositCode & 0x03) !== 0) {
          // depositCode > 0（类型高 2 位或丰度低 2 位任一非零 → 矿脉格）
          return i;
        }
        if (fallback < 0) fallback = i;
        continue;
      }
      return i;
    }
    return fallback;
  };

  const bList = colony.buildings || [];
  for (let bi = 0; bi < bList.length; bi++) {
    const b = bList[bi];
    if (!b || b.state !== 'active' || !b.defId) continue;
    const def = buildingDef(b.defId);
    if (!def) continue;

    // —— 纳米锻炉 / 同步加速器 → industryMods 通道（doc48：+4/件）——
    if (ARTIFACT_BUILDING_RE.test(def.id)) {
      modsBag[BRIDGE_MOD_PREFIX + def.id] = {
        installedAtTick: -1, // bridge 镜像记账（非 installIndustryMod 玩家安装路径）
        industrialAttention: 4,
        mirroredFrom: def.id,
      };
      continue; // 不占 tile 槽（人工制品挂 urbanZones）
    }

    // —— 槽段裁决 ——
    let range;
    if (SHIPYARD_DEFS.test(def.id)) range = TILE_SLOT_RANGE.orbitalWorks;
    else if (def.category === 'mining') range = TILE_SLOT_RANGE.mining;
    else if (def.category === 'refining') range = TILE_SLOT_RANGE.refining;
    else if (def.category === 'industry') range = TILE_SLOT_RANGE.industry;
    else if (def.category === 'science') range = TILE_SLOT_RANGE.science;
    else range = null; // 非工业建筑不落 tile（farming 段权重 0，占位无收益，省台账）

    if (!range) continue;
    const idx = findFreeTile(range[0], range[1], def.category === 'mining');
    if (idx < 0) continue; // 槽段满载 → 该座本轮不落位（下轮台账重扫）
    const u = unpackTile(tiles[idx] >>> 0);
    tiles[idx] = packTile({ ...u, buildingId: range[0] <= 15 ? Math.min(15, range[0]) : range[0] });
    used.add(idx);
    tileMap[bi] = idx;
  }
  compact.colony.bridgeTileMap = tileMap;

  // —— 3. 工业关注度全量重算（权威覆写；满 7 由 S6 月度钩子翻转激进支部）——
  recomputeIndustrialAttention(compact);
}

/* ============================== 反向同步（紧凑底座 → 主游戏，显式 API） ============================== */

/**
 * 反向同步（CHK-50-02「反之亦然」对称半程；显式调用 —— 供歌剧侧经济事件与门禁套件消费）：
 *  8 维槽位 → colony.stockpile 直投（mineral 槽按既有 ferro:silicate 比例劈分，双零归 ferro）；
 *  energy 槽 → 帝国账本 credits 增量入账（compact.colony.energyCreditsMirror 台账记账，
 *  直接覆写账本会破坏主经济守恒 —— 增量口径与 ledger.credit 流水兼容）。
 *
 * @param {object} planet - 目标行星（planet.compactState.colony 为歌剧侧权威源）
 * @param {object} world - 世界根对象
 * @returns {boolean} 是否实际执行同步
 */
export function syncSpaceOperaToColony(planet, world) {
  if (!planet || !world || !world.spaceOperaState) return false;
  const compact = planet.compactState;
  const cColony = compact && compact.colony;
  if (!cColony || !Array.isArray(cColony.stockpile)) return false;
  const colonies = world.entities && world.entities.colonies;
  const colony = colonies
    ? Object.values(colonies).find((cc) => cc && cc.planetId === planet.id)
    : null;
  if (!colony) return false;

  if (!colony.stockpile || typeof colony.stockpile !== 'object') colony.stockpile = {};
  const s = cColony.stockpile;
  const clamp0 = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

  colony.stockpile.alloy = clamp0(s[3]);
  colony.stockpile.food = clamp0(s[2]);
  colony.stockpile.polymer = clamp0(s[4]);
  colony.stockpile.exoticMatter = clamp0(s[5]);
  colony.stockpile.rareEarth = clamp0(s[6]);
  colony.stockpile.electronics = clamp0(s[7]);

  // mineral 槽劈分：按上轮 ferro:silicate 占比（双零 → 全 ferro），总和精确守恒
  const mineral = clamp0(s[1]);
  const ferro0 = clamp0(colony.stockpile.ferro);
  const silicate0 = clamp0(colony.stockpile.silicate);
  const total0 = ferro0 + silicate0;
  if (total0 > 0) {
    colony.stockpile.ferro = Math.round(mineral * (ferro0 / total0));
    colony.stockpile.silicate = Math.max(0, mineral - colony.stockpile.ferro);
  } else {
    colony.stockpile.ferro = mineral;
    colony.stockpile.silicate = 0;
  }

  // energy 槽 → credits 增量入账（台账差分；factionId 优先派系账本）
  const fid = colony.factionId || world.playerFactionId;
  if (fid) {
    const prev = Number.isFinite(cColony.energyCreditsMirror) ? cColony.energyCreditsMirror : s[0];
    const delta = Math.round(clamp0(s[0]) - Math.max(0, prev));
    if (delta > 0) credit(world, fid, 'credits', delta, 'soBridgeEnergy', planet.id);
    cColony.energyCreditsMirror = clamp0(s[0]);
  }
  return true;
}

/* ============================== 逆向赋能修正（歌剧 → 主游戏结算） ============================== */

/** S1 考古对策 → 科研倍率（doc50 §1.4 §3 精确值表） */
const S1_RESEARCH_MULT = Object.freeze({
  CAUTIOUS: 0.95,
  STREAMLINED: 0.90,
  OVERDRIVE: 0.85,
});

/** S4 国家违约惩罚（shortageSituationArc.EMPIRE_DEFAULT_PENALTIES 同源口径） */
const S4_DEFAULT_OUTPUT_MULT = 0.75;
const S4_DEFAULT_BUILD_COST_MULT = 1.25;

/** S4 Cut Investments 产出惩罚（shortageSituationArc.S4_CUT_ARTISAN_OUTPUT_MULT 同源） */
const S4_CUT_OUTPUT_MULT = 0.75;

/**
 * 计算指定殖民地当前所受的太空歌剧多系统宏观综合修正倍率（doc50 §Task 50.1 契约形态）。
 * colony 传 null 时仅结算帝国级修正（违约 / S1 考古）—— 供 research/shipyard 全局阶段消费。
 *
 * @param {object|null} colony - 主游戏殖民地实体（null → 跳过殖民地级修正）
 * @param {object} world - 世界根对象
 * @returns {Object} { productionMultiplier, researchMultiplier, shipyardMultiplier,
 *                     buildingCostMultiplier, stabilityBonus }
 */
export function getSpaceOperaModifiers(colony, world) {
  const base = {
    productionMultiplier: 1.0,
    researchMultiplier: 1.0,
    shipyardMultiplier: 1.0,
    buildingCostMultiplier: 1.0,
    stabilityBonus: 0.0,
  };

  if (!world || !world.spaceOperaState) return base;

  const soState = world.spaceOperaState;
  const planets = world.entities && world.entities.planets;
  const planet = colony && planets ? planets[colony.planetId] : null;
  const compact = planet && planet.compactState;
  const cColony = compact && compact.colony;

  // —— 1. S3 稳定度倍率（百分点 → 倍率：(100 + pct) / 100 整数商保证 CHK-50-03 精确值）——
  if (cColony && typeof cColony.stability === 'number' && Number.isFinite(cColony.stability)) {
    const stabPct = computeStabilityOutputMultiplier(cColony.stability);
    base.productionMultiplier *= (100 + stabPct) / 100;
  }

  // —— 2. S4 削减投资（该行星活跃 S4 局势 approach === CUT_INVESTMENTS）——
  if (cColony && compact) {
    const sitBag = soState.situations && typeof soState.situations === 'object' ? soState.situations : {};
    for (const key of Object.keys(sitBag).sort()) {
      const sit = sitBag[key];
      if (!sit || sit.resolvedTick != null || sit.systemArcId !== 'S4') continue;
      // 目标匹配三级回查：planet.id 原型 / 字符串同型 / compact 数字键（numericEntityKey 口径）
      const hit = sit.targetEntityId === planet.id
        || String(sit.targetEntityId) === String(planet.id)
        || (planet.id != null && typeof sit.targetEntityId === 'number'
          && Number.isFinite(sit.targetEntityId) && sit.targetEntityId === compact.id);
      if (!hit) continue;
      if (sit.currentApproach === 'CUT_INVESTMENTS') base.productionMultiplier *= S4_CUT_OUTPUT_MULT;
      break; // 每星至多一条活跃 S4（watchStrategicStockpiles 派生契约）
    }
  }

  // —— 3. S4 国家违约五项惩罚（帝国级；shortageSituationArc:256 isEmpireDefaulted 权威判定）——
  if (isEmpireDefaulted(world)) {
    base.productionMultiplier *= S4_DEFAULT_OUTPUT_MULT;
    base.researchMultiplier *= S4_DEFAULT_OUTPUT_MULT;
    base.shipyardMultiplier *= S4_DEFAULT_OUTPUT_MULT;
    base.buildingCostMultiplier *= S4_DEFAULT_BUILD_COST_MULT;
  }

  // —— 4. S1 考古对策科研修正（帝国级；活跃 S1 局势 currentApproach 权威值）——
  const sitBag2 = soState.situations && typeof soState.situations === 'object' ? soState.situations : {};
  for (const key of Object.keys(sitBag2).sort()) {
    const sit = sitBag2[key];
    if (!sit || sit.resolvedTick != null || sit.systemArcId !== 'S1') continue;
    const mult = S1_RESEARCH_MULT[sit.currentApproach];
    if (mult != null) base.researchMultiplier *= mult;
    break; // 每星系至多一条活跃 S1（archaeologyArc 派生契约）
  }

  return base;
}

/* ============================== The Beholder 灵能矿工转化落账 ============================== */

/**
 * The Beholder MURMURING_MONOLITH 形态灵能矿工转化的帝国账本月度落账
 * （doc48 §Task 4.2 逆向赋能第 5 条；HourlySystems 月界 tick%720===0 调用）：
 *  - 每名转化矿工：玩家派系账本 credits += TELEPATH_ENERGY_PER_POP_MONTH(8.0)；
 *  - 每名转化矿工：帝国凝聚力金库 unityTreasury += TELEPATH_UNITY_PER_POP_MONTH(6.0)
 *    （grantUnity 幂等 ensure；歌剧侧 netFlow/telepathUnity 通道由 toggleBeholderMode
 *    既有落账承担 —— 本函数为主游戏帝国账本的 M4 增量落点）。
 * 首行守卫 world.spaceOperaState；无 THE_BEHOLDER / 非 MONOLITH 形态 → 零写入。
 *
 * @param {object} world - 世界根对象
 * @returns {{converted: number, credits: number, unity: number}} 本月落账统计
 */
export function applyBeholderPsychicConversion(world) {
  const stats = { converted: 0, credits: 0, unity: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const characters = world.entities && world.entities.characters ? world.entities.characters : {};
  const pf = world.playerFactionId;
  for (const key of Object.keys(characters).sort()) {
    const ch = characters[key];
    const p = ch && typeof ch === 'object' ? ch.paragon : null;
    if (!p || p.paragonId !== 'THE_BEHOLDER' || p.mode !== 'MURMURING_MONOLITH') continue;
    const conv = p.beholderConversion;
    const miners = conv && Number.isFinite(conv.miners) ? Math.max(0, Math.trunc(conv.miners)) : 0;
    if (miners <= 0) continue;
    stats.converted += miners;
    if (pf) {
      const energy = TELEPATH_ENERGY_PER_POP_MONTH * miners;
      credit(world, pf, 'credits', energy, 'beholderPsychicMiners', ch.id);
      stats.credits += energy;
    }
    const unity = TELEPATH_UNITY_PER_POP_MONTH * miners;
    grantUnity(world, unity);
    stats.unity += unity;
  }
  return stats;
}
