/**
 * domain/economy/shadowSyndicateArc.js — S6 黑市网络、走私暗流与激进分子渗透弧
 * （SPEC-PLAN-045 阶段二 M2 Task 2.5；责任人：Eng-B）
 *
 * 职责（doc45 §Task 2.5 逐条契约）：
 *  1. 屏蔽货舱走私检定：seizureProbability(world, fleet, qtyContra) 复用
 *     blackMarket.js 的 fleetShieldedCargo（:83）与 bustProbability（:63）——
 *     Q_contra ≤ C_shield → 恒 0%；超出屏蔽容量部分按 bustProbability 结算；
 *     SMUGGLER_RUNNER 类舰队默认挂屏蔽货舱（SMUGGLER_RUNNER_SHIELDED_CARGO）。
 *  2. 犯罪辛迪加地下分部：establishSyndicateBranch(world, targetPlanetId, branchType)
 *     （EstablishSyndicateBranch 命令领域落点，handler 由 M2 集成阶段注入）——
 *     要求目标星 crime ≥ 10 或未签商贸协议，写入 compact.syndicateBranch =
 *     {type, sinceTick, shadyContacts:true}；intelBonus(world) 汇总每分部
 *     解密 +1 / 加密 +1（Shady Contacts）。
 *  3. 工业关注度（Radical Cell Infiltration）：ATTENTION_WEIGHTS 精确权重表；
 *     recomputeIndustrialAttention(compact) 扫描 256 Tile（矿脉 deposit 上的
 *     buildingId 1-15 → +1/座；buildingId 32-35 / 36-38 / 39-40 / 41-47 → +2/座；
 *     compact.urbanZones.industryMods 已装工业人工制品每件 +4）并写
 *     compact.colony.industrialAttention。
 *  4. 阈值 7 翻转（月度钩子）：attention < 7 → cell.state = 'DORMANT'；
 *     ≥ 7 → 立即 'ACTIVE'（首次翻转 emit RadicalCellActivated）。活跃态：
 *     每月 stability −3.0、每 6 个月确定性破坏一座工业建筑
 *     （deriveSeed(ARC_S6_SYNDICATE, compact.id, month) 选 tile）、
 *     radicalCell.raidSource = true（M3 海盗联动钩子读取）。
 *  5. 去文明化：stability 归零（值域 clamp ≥ 0，<= 0 即 === 0）连续 12 个月
 *     （colony.decivilMonths 计数）→ DECIVILIZED：ownerId = −1、epochStage = 4、
 *     urbanZones 清空、appendHistory、emit Decivilized。
 *  6. 清剿潜伏基地：purgeRadicalCell(world, planetId, useMilitaryForce)（
 *     PurgeRadicalCell 命令领域落点）——军事路线：体系内舰队总战力 ≥ 细胞防御阈值
 *     （CELL_DEFENSE_THRESHOLD = 50）才成功（不足 throw）；特工路线：3 个月潜伏期
 *     （PURGE_PENDING → 月度钩子结算）后成功；成功后 industrialAttention 保留但
 *     cell 回 DORMANT（阈值再破可复燃）、raidSource 清除。
 *  7. 私掠许可证：LETTERS_OF_MARQUE_HEIR_WEIGHT_BONUS = 40 —— 签发复用
 *     blackMarket.issueLetterOfMarque（:191）；继承权重加成由 M3 galacticParagons
 *     提督（Admiral）继承池消费（heirWeightBonusFor 供其读取）。
 *
 * 纪律（doc43 §1.4）：月度钩子首行守卫 world.spaceOperaState；未殖民/无 compactState
 * 行星零写入；零 Math.random / Date.now（破坏选址 deriveSeed(ARC_S6_SYNDICATE)）；
 * 不触世界主随机流；未触达世界（无 spaceOperaState）逐位零漂移。
 */

import { registerSituationMonthlyHook } from '../events/situationEngine.js';
import { fleetShieldedCargo, bustProbability } from './blackMarket.js';
import { packTile, unpackTile, appendHistory } from '../planets/planetStateSchema.js';
import { DOMAIN_SALTS, deriveSeed } from '../world/deterministicRng.js';
import { emit } from '../../core/eventBus.js';
import { TICKS_PER_MONTH } from '../../core/clock.js';

/* ============================== 屏蔽货舱走私检定（doc45 Task 2.5 §1） ============================== */

/**
 * SMUGGLER_RUNNER 类舰队（M3 自主走私快船 fleetClass）默认屏蔽货舱容量（施工 notes
 * 裁决：doc46 §Task 3.3 自主走私快船未给容量数值，M2 在此固定缺省 100 单位供 M3 消费）。
 */
export const SMUGGLER_RUNNER_SHIELDED_CARGO = 100;

/**
 * 舰队有效屏蔽货舱容量：blackMarket.fleetShieldedCargo（mod_cargo_shielded 聚合）为基，
 * SMUGGLER_RUNNER 类舰队（fleetClass === 'SMUGGLER_RUNNER'）缺省挂默认屏蔽货舱（取 max，
 * 不与舰船词条重复计）。
 */
export function smugglerShieldedCapacity(world, fleet) {
  const base = fleetShieldedCargo(world, fleet);
  const isRunner = fleet && (fleet.fleetClass === 'SMUGGLER_RUNNER' || fleet.role === 'smuggler');
  return isRunner ? Math.max(base, SMUGGLER_RUNNER_SHIELDED_CARGO) : base;
}

/**
 * 巡逻队扫描查获概率（doc45 §Task 2.5 §1 契约）：
 *  - Q_contra ≤ C_shield（有效屏蔽货舱容量）→ 恒 0%；
 *  - 否则走 blackMarket.bustProbability（超容量部分 / 巡逻强度 / 嫌疑度）。
 * 巡逻强度/嫌疑度缺省与 blackMarket.tradeBlackMarket 同口径（market.patrolStrength ?? 45、
 * market.blackMarket.suspicion ?? 0），ctx 可显式覆写。
 *
 * @param {object} world - 世界根对象
 * @param {object} fleet - 舰队实体
 * @param {number} qtyContra - 违禁品装载量 Q_contra
 * @param {{securityLevel?: number, suspicion?: number}} [ctx] - 显式覆写（测试/上层口径）
 * @returns {number} 查获概率 [0, 0.95]
 */
export function seizureProbability(world, fleet, qtyContra, ctx = {}) {
  const q = Number.isFinite(qtyContra) && qtyContra > 0 ? qtyContra : 0;
  const cap = smugglerShieldedCapacity(world, fleet);
  if (q <= cap) return 0; // 100% 完美偷运（屏蔽货舱容量内恒 0%）
  const sysId = fleet ? fleet.systemId : null;
  const market = world && world.economy && world.economy.markets ? world.economy.markets[sysId] : null;
  const securityLevel = ctx.securityLevel != null
    ? ctx.securityLevel
    : ((market && market.patrolStrength != null ? market.patrolStrength : 45) / 100);
  const suspicion = ctx.suspicion != null
    ? ctx.suspicion
    : (market && market.blackMarket ? market.blackMarket.suspicion : 0);
  return bustProbability({ contraQty: q, shieldedCargo: cap, securityLevel, suspicion });
}

/* ============================== 辛迪加地下分部（doc45 Task 2.5 §1） ============================== */

/** 分部设立犯罪度门槛（目标星 crime ≥ 10 或未签商贸协议二选一） */
export const BRANCH_MIN_CRIME = 10;
/** 每分部 Shady Contacts 情报优势（解密/加密各 +1） */
export const INTEL_PER_BRANCH = 1;

/**
 * 目标殖民地所属派系是否存在生效中的商贸协议（world.entities.treaties kind='trade'）。
 * 桥接口径（施工 notes）：opera 层 colony.ownerId 为数字键、外交层派系为字符串 id ——
 * 双方 id 同型相等或 String 同值即视为签约；无主星球（ownerId < 0）恒视为未签。
 */
function hasTradeAgreement(world, ownerFactionId) {
  if (!Number.isFinite(ownerFactionId) || ownerFactionId < 0) return false;
  const treaties = world && world.entities && world.entities.treaties ? world.entities.treaties : {};
  for (const key of Object.keys(treaties).sort()) {
    const t = treaties[key];
    if (!t || t.status !== 'active' || t.kind !== 'trade' || !Array.isArray(t.parties)) continue;
    for (const p of t.parties) {
      if (p === ownerFactionId || String(p) === String(ownerFactionId)) return true;
    }
  }
  return false;
}

/**
 * 在目标殖民地建立犯罪辛迪加地下分部（EstablishSyndicateBranch 命令领域落点；
 * M2 集成阶段注入命令 handler）。前置：已殖民且（crime ≥ 10 或未签商贸协议）；
 * 每星至多一个分部。写入 compact.syndicateBranch = {type, sinceTick, shadyContacts:true}。
 * 业务失败抛 Error('SO:…') → 命令总线回滚。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} targetPlanetId - 目标行星 ID
 * @param {string} branchType - 分部类型（commandSchemas 契约 string；1-32 字符）
 * @returns {object} 新建的 compact.syndicateBranch 记录
 */
export function establishSyndicateBranch(world, targetPlanetId, branchType) {
  if (typeof branchType !== 'string' || branchType.length === 0 || branchType.length > 32) {
    throw new Error(`SO: branchType 必须为 1-32 字符字符串（实测 ${String(branchType)}）`);
  }
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[targetPlanetId] || planets[`plt_${targetPlanetId}`] || null;
  if (!planet) throw new Error(`SO: 分部目标行星不存在 ${String(targetPlanetId)}`);
  const compact = planet.compactState;
  const colony = compact && compact.colony;
  if (!compact || !colony) throw new Error(`SO: 行星 ${String(targetPlanetId)} 缺少紧凑态殖民地`);
  if (!(Number(colony.ownerId) >= 0)) throw new Error('SO: 辛迪加分部仅可设于已殖民星球');
  if (compact.syndicateBranch) throw new Error(`SO: 行星 ${String(targetPlanetId)} 已存在辛迪加分部`);

  const crime = Number(colony.crime);
  const crimeOk = Number.isFinite(crime) && crime >= BRANCH_MIN_CRIME;
  const tradeSigned = hasTradeAgreement(world, Number(colony.ownerId));
  if (!crimeOk && tradeSigned) {
    throw new Error(`SO: 目标星已签商贸协议且犯罪度不足 ${BRANCH_MIN_CRIME}（实测 crime ${String(colony.crime)}），禁止设立分部`);
  }

  compact.syndicateBranch = {
    type: branchType,
    sinceTick: Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0,
    shadyContacts: true,
  };
  return compact.syndicateBranch;
}

/**
 * 辛迪加分部情报优势汇总（Shady Contacts）：每分部解密 +1 / 加密 +1。
 *
 * @returns {{decryption: number, encryption: number}} 情报修正合计
 */
export function intelBonus(world) {
  const bonus = { decryption: 0, encryption: 0 };
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  for (const key of Object.keys(planets).sort()) {
    const branch = planets[key] && planets[key].compactState
      ? planets[key].compactState.syndicateBranch : null;
    if (branch && branch.shadyContacts === true) {
      bonus.decryption += INTEL_PER_BRANCH;
      bonus.encryption += INTEL_PER_BRANCH;
    }
  }
  return bonus;
}

/* ============================== 工业关注度（doc45 Task 2.5 §2） ============================== */

/** 各建筑与人工制品关注度权重精确表（doc45 §Task 2.5 §2） */
export const ATTENTION_WEIGHTS = Object.freeze({
  farming: 0, // 基础农业/轻纺区划（矿脉缺失格上的 buildingId 1-15）
  mining: 1, // 深层采矿区划（矿脉 deposit 上的 buildingId 1-15）
  heavyIndustry: 2, // buildingId 32-35 重工业
  orbitalWorks: 2, // buildingId 36-38 轨道船坞
  fuelProduction: 2, // buildingId 39-40 燃料精炼
  techMining: 2, // buildingId 41-47 科技采掘/研究
  researchLab: 2, // 研究实验室（表内权重位；Tile 段归 techMining 计）
  artifactMod: 4, // 已装工业人工制品每件 +4
});

/** 工业人工制品关注度（每件；与 ATTENTION_WEIGHTS.artifactMod 同源） */
export const ARTIFACT_MOD_ATTENTION = 4;

/**
 * 重算行星工业与禁忌科技关注度（纯扫描 + 单点落账）：
 *  - Tiles：buildingId 1-15 且 depositCode > 0（矿脉 deposit）→ mining +1/座；
 *    buildingId 1-15 且无矿脉 → farming +0；buildingId 32-35/36-38/39-40/41-47 →
 *    heavyIndustry/orbitalWorks/fuelProduction/techMining +2/座；
 *  - compact.urbanZones.industryMods（S4 installIndustryMod 写入）每件 artifactMod +4
 *    （doc45 §Task 2.5 §2「每件 +4」权威口径；施工 notes：INDUSTRY_MOD_DEFS.SYNCHROTRON
 *    安装期增量为 0 与本重算口径的差值由月度重算统一收敛）；
 *  - 结果写 compact.colony.industrialAttention（权威覆写，installIndustryMod 的增量记账
 *    被本全量重算取代，无双重计数）。
 *
 * @param {object} compact - 紧凑 PlanetState 容器
 * @returns {number} 重算后的关注度合计（≥ 0 整数）
 */
export function recomputeIndustrialAttention(compact) {
  if (!compact || typeof compact !== 'object' || !Array.isArray(compact.tiles)) {
    throw new Error('SO: recomputeIndustrialAttention 需要 compact PlanetState 容器');
  }
  const W = ATTENTION_WEIGHTS;
  let farming = 0;
  let mining = 0;
  let heavy = 0;
  let orbital = 0;
  let fuel = 0;
  let tech = 0;
  for (let i = 0; i < compact.tiles.length; i++) {
    const t = compact.tiles[i] >>> 0;
    const bid = (t >>> 16) & 0x3f;
    if (bid === 0) continue;
    if (bid <= 15) {
      if (((t >>> 12) & 0x0f) > 0) mining++; // 矿脉 deposit 上的采集区划
      else farming++; // 无矿脉格：基础农业/轻纺
    } else if (bid >= 32 && bid <= 35) heavy++;
    else if (bid >= 36 && bid <= 38) orbital++;
    else if (bid >= 39 && bid <= 40) fuel++;
    else if (bid >= 41 && bid <= 47) tech++;
    // buildingId 16-31 城市功能区 / 48-63 先驱者奇观与防御工事：不计关注度
  }
  const modsBag = compact.urbanZones && compact.urbanZones.industryMods;
  const mods = modsBag && typeof modsBag === 'object' ? Object.keys(modsBag).length : 0;
  const total = farming * W.farming
    + mining * W.mining
    + heavy * W.heavyIndustry
    + orbital * W.orbitalWorks
    + fuel * W.fuelProduction
    + tech * W.techMining
    + mods * W.artifactMod;
  if (compact.colony && typeof compact.colony === 'object') {
    compact.colony.industrialAttention = total;
  }
  return total;
}

/* ============================== 激进潜伏基地（Radical Cell） ============================== */

/** 激活硬阈值（doc45 §Task 2.5 §2：industrialAttention ≥ 7 → ACTIVE） */
export const RADICAL_ACTIVATION_THRESHOLD = 7;
/** 活跃态每月稳定度削减（doc45 §Task 2.5 §2：−3.0/月） */
export const ACTIVE_STABILITY_DRAIN = 3.0;
/** 活跃态确定性破坏工业建筑的周期（每 6 个月一座） */
export const SABOTAGE_INTERVAL_MONTHS = 6;
/** 特工（非军事）清剿潜伏期（3 个月后成功） */
export const AGENT_PURGE_LATENCY_MONTHS = 3;
/** 激进细胞防御阈值（体系内舰队总战力须 ≥ 50 方可军事清剿） */
export const CELL_DEFENSE_THRESHOLD = 50;
/** 无舰船实体数据时的单舰战力缺省（护卫舰档；structure+armor+shield 基准） */
export const SHIP_POWER_FALLBACK = 100;
/** 去文明化触发：stability 归零连续 12 个月 */
export const DECIVILIZED_MONTHS = 12;

/** 历史环负值段事件码（S6 家族；planetStateSchema 注释口径：负值段留给局势弧） */
const HIST_S6_DECIVILIZED = -601;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function monthOf(tick) {
  return Math.floor((Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) : 0) / TICKS_PER_MONTH);
}

/**
 * 惰性挂载 compact.radicalCell（幂等；绝不消费 world.rng）。
 * 结构：{state:'DORMANT'|'ACTIVE'|'PURGE_PENDING', sinceTick, raidSource,
 *        lastSabotageMonth, agentInsertionTick, everActivated, purgedAtTick, lastPurgeMethod}
 */
function ensureRadicalCell(compact, tick) {
  if (!isPlainObject(compact.radicalCell)) {
    compact.radicalCell = {
      state: 'DORMANT',
      sinceTick: Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) : 0,
      raidSource: false,
      lastSabotageMonth: null,
      agentInsertionTick: null,
      everActivated: false,
      purgedAtTick: null,
      lastPurgeMethod: null,
    };
  }
  return compact.radicalCell;
}

/** 细胞回 DORMANT（清剿成功 / 自动休眠共用）：raidSource 与煽动旗标一并清除（阈值再破可复燃） */
function settleCellDormant(compact, colony, tick, method) {
  const cell = compact.radicalCell;
  cell.state = 'DORMANT';
  cell.raidSource = false;
  cell.lastSabotageMonth = null;
  cell.agentInsertionTick = null;
  cell.purgedAtTick = Number.isFinite(tick) ? Math.max(0, Math.trunc(tick)) : 0;
  cell.lastPurgeMethod = method || null;
  if (colony && typeof colony === 'object') colony.incitedByAgitators = false;
}

/**
 * 确定性破坏一座工业建筑（活跃细胞每 6 个月一次）：
 *  候选 = buildingId 32-47（奇异工业设施）优先，缺位回退 buildingId 1-15；
 *  选址 deriveSeed(world.seed, ARC_S6_SYNDICATE, compact.id, month) % 候选数；
 *  buildingId 清零、其余位段无损保留（与 clearHighMaintenanceBuildings 同口径）。
 *
 * @returns {number} 实际破坏座数（0/1）
 */
function sabotageIndustrialBuilding(world, compact, month) {
  const exotic = [];
  const ordinary = [];
  for (let i = 0; i < compact.tiles.length; i++) {
    const bid = (compact.tiles[i] >>> 16) & 0x3f;
    if (bid >= 32 && bid <= 47) exotic.push(i);
    else if (bid >= 1 && bid <= 15) ordinary.push(i);
  }
  const candidates = exotic.length > 0 ? exotic : ordinary;
  if (candidates.length === 0) return 0;
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const r = deriveSeed(seed, DOMAIN_SALTS.ARC_S6_SYNDICATE, compact.id, month);
  const idx = candidates[r % candidates.length];
  const u = unpackTile(compact.tiles[idx] >>> 0);
  compact.tiles[idx] = packTile({ ...u, buildingId: 0 });
  return 1;
}

/** 去文明化终局（doc45 §Task 2.5 §2）：主权归零 + 遗产废土态 + 城市清空 */
function decivilizePlanet(world, planet, compact, tick) {
  const colony = compact.colony;
  const prevOwner = Number(colony.ownerId);
  colony.ownerId = -1;
  colony.decivilMonths = 0;
  colony.incitedByAgitators = false;
  compact.epochStage = 4; // 五纪元跌入 4 遗产废土态
  if (compact.urbanZones && typeof compact.urbanZones === 'object') {
    if (Array.isArray(compact.urbanZones.buildingSlots)) {
      compact.urbanZones.buildingSlots = compact.urbanZones.buildingSlots.map(() => 0);
    }
    if (Array.isArray(compact.urbanZones.zoneSlots)) {
      compact.urbanZones.zoneSlots = compact.urbanZones.zoneSlots.map(() => 0);
    }
  }
  if (isPlainObject(compact.radicalCell)) {
    compact.radicalCell.state = 'DORMANT';
    compact.radicalCell.raidSource = false;
  }
  appendHistory(compact, tick, HIST_S6_DECIVILIZED, Number.isFinite(prevOwner) ? prevOwner : -1, Number(compact.colony.industrialAttention) | 0);
  emit(world, 'Decivilized', {
    planetId: planet.id,
    prevOwnerFactionId: Number.isFinite(prevOwner) ? prevOwner : -1,
    epochStage: 4,
  }, 'colony');
}

/* ============================== S6 月度钩子（阈值翻转 / 破坏 / 去文明化） ============================== */

/**
 * S6 月度钩子（经 registerSituationMonthlyHook 登记，月末 tick%720===0 触发）：
 * 关注度重算 → 细胞阈值翻转 → 活跃态稳定度抽取与周期破坏 → 特工清剿结算 →
 * 去文明化计数。首行守卫：world.spaceOperaState 缺失 → 零扫描零写入。
 *
 * @returns {{scanned: number, activated: number, dormancies: number, sabotages: number,
 *            agentPurges: number, decivilized: number}} 本月统计
 */
export function stepShadowSyndicateArc(world) {
  const stats = { scanned: 0, activated: 0, dormancies: 0, sabotages: 0, agentPurges: 0, decivilized: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const month = monthOf(tick);

  for (const key of Object.keys(planets).sort()) {
    const planet = planets[key];
    const compact = planet && planet.compactState;
    const colony = compact && compact.colony;
    if (!compact || !colony || !(Number(colony.ownerId) >= 0)) continue; // 未殖民行星零写入
    stats.scanned++;

    const attention = recomputeIndustrialAttention(compact);
    const cell = ensureRadicalCell(compact, tick);

    // —— 特工清剿潜伏期结算（不受阈值翻转影响）——
    if (cell.state === 'PURGE_PENDING') {
      const insertMonth = monthOf(Number(cell.agentInsertionTick));
      if (month - insertMonth >= AGENT_PURGE_LATENCY_MONTHS) {
        settleCellDormant(compact, colony, tick, 'AGENT');
        stats.agentPurges++;
      }
    } else if (attention >= RADICAL_ACTIVATION_THRESHOLD) {
      // —— ≥ 7：立即 ACTIVE（首次翻转 emit RadicalCellActivated）——
      if (cell.state !== 'ACTIVE') {
        const firstActivation = cell.everActivated !== true;
        cell.state = 'ACTIVE';
        cell.everActivated = true;
        cell.raidSource = true; // M3 海盗联动钩子读取
        colony.incitedByAgitators = true; // S3 叛乱弧煽动旗标（立即触发 PLANETARY_REVOLT）
        if (cell.lastSabotageMonth == null) cell.lastSabotageMonth = month;
        emit(world, 'RadicalCellActivated', {
          planetId: planet.id,
          industrialAttention: attention,
          firstActivation,
        }, 'economy');
        stats.activated++;
      }
    } else {
      // —— < 7：安全休眠态（doc45：激进组织不建立活跃破坏网）——
      if (cell.state === 'ACTIVE') stats.dormancies++;
      cell.state = 'DORMANT';
      cell.raidSource = false;
      colony.incitedByAgitators = false;
      cell.lastSabotageMonth = null;
    }

    // —— 活跃态：每月 stability −3.0 + 每 6 个月确定性破坏一座工业建筑 ——
    if (cell.state === 'ACTIVE') {
      const s = Number(colony.stability);
      colony.stability = Math.max(0, (Number.isFinite(s) ? s : 0) - ACTIVE_STABILITY_DRAIN);
      if (cell.lastSabotageMonth != null && month - cell.lastSabotageMonth >= SABOTAGE_INTERVAL_MONTHS) {
        stats.sabotages += sabotageIndustrialBuilding(world, compact, month);
        cell.lastSabotageMonth = month;
      }
    }

    // —— 去文明化计数：stability 归零（clamp ≥ 0，<= 0 即 === 0）连续 12 个月 ——
    const stability = Number(colony.stability);
    if (Number.isFinite(stability) && stability <= 0) {
      colony.decivilMonths = (colony.decivilMonths | 0) + 1;
      if ((colony.decivilMonths | 0) >= DECIVILIZED_MONTHS) {
        decivilizePlanet(world, planet, compact, tick);
        stats.decivilized++;
      }
    } else {
      colony.decivilMonths = 0;
    }
  }
  return stats;
}

// import 副作用：登记 S6 月度钩子（经动态 import SpaceOperaClock → setClockHooks 注入，
// 与 shortageSituationArc 的接线方式一致）
registerSituationMonthlyHook(stepShadowSyndicateArc);

/* ============================== 清剿潜伏基地（doc45 Task 2.5 §2） ============================== */

/** 单舰战力（structure + armor + shield；无实体数据回退 SHIP_POWER_FALLBACK） */
function shipCombatPower(ship) {
  const stats = ship && typeof ship === 'object' ? ship.stats : null;
  if (!stats || typeof stats !== 'object') return SHIP_POWER_FALLBACK;
  const structure = Number.isFinite(stats.structure) ? stats.structure : 0;
  const armor = Number.isFinite(stats.armor) ? stats.armor : 0;
  const shield = Number.isFinite(stats.shieldMax) ? stats.shieldMax : (Number.isFinite(stats.shield) ? stats.shield : 0);
  return structure + armor + shield;
}

/**
 * 体系内（目标行星所属星系）舰队总战力：Σ 舰队(shipIds) 逐舰 shipCombatPower。
 * 口径裁决（施工 notes）：doc45 §Task 2.5 §2 为「体系内舰队总战力」，M2 取星系内全部
 * 舰队（不限派系 —— opera 层 ownerId 数字键与外交层派系字符串 id 尚无桥接）。
 */
function systemFleetCombatPower(world, planet) {
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  const ships = world.entities && world.entities.ships ? world.entities.ships : null;
  let power = 0;
  for (const key of Object.keys(fleets).sort()) {
    const fleet = fleets[key];
    if (!fleet || typeof fleet !== 'object' || fleet.systemId !== planet.systemId) continue;
    for (const sid of fleet.shipIds || []) {
      power += ships ? shipCombatPower(ships[sid]) : SHIP_POWER_FALLBACK;
    }
  }
  return power;
}

/**
 * 清剿行星激进潜伏基地（PurgeRadicalCell 命令领域落点；M2 集成阶段注入命令 handler）。
 *  - 军事路线（useMilitaryForce === true）：体系内舰队总战力 ≥ CELL_DEFENSE_THRESHOLD(50)
 *    才成功，不足抛 Error('SO:…')（→ 命令总线回滚）；
 *  - 特工路线：cell 置 PURGE_PENDING 并记 agentInsertionTick，3 个月潜伏期后由月度钩子
 *    结算成功；
 *  - 成功后 industrialAttention 保留、cell 回 DORMANT（阈值再破可复燃）、raidSource 清除。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} planetId - 目标行星 ID
 * @param {boolean} useMilitaryForce - true 军事清剿 | false 特工渗透
 * @returns {object} 清剿后的 compact.radicalCell
 */
export function purgeRadicalCell(world, planetId, useMilitaryForce) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const planet = planets[planetId] || planets[`plt_${planetId}`] || null;
  if (!planet) throw new Error(`SO: 清剿目标行星不存在 ${String(planetId)}`);
  const compact = planet.compactState;
  const colony = compact && compact.colony;
  if (!compact || !colony) throw new Error(`SO: 行星 ${String(planetId)} 缺少紧凑态殖民地`);
  const cell = ensureRadicalCell(compact, world.tick);
  if (cell.state !== 'ACTIVE' && cell.state !== 'PURGE_PENDING') {
    throw new Error(`SO: 行星 ${String(planetId)} 无活跃激进细胞可清剿（实测 ${String(cell.state)}）`);
  }

  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  if (useMilitaryForce === true) {
    const power = systemFleetCombatPower(world, planet);
    if (!(power >= CELL_DEFENSE_THRESHOLD)) {
      throw new Error(`SO: 体系内舰队总战力 ${power} 低于激进细胞防御阈值 ${CELL_DEFENSE_THRESHOLD}，军事清剿失败`);
    }
    settleCellDormant(compact, colony, tick, 'MILITARY'); // 摧毁活跃细胞 + raidSource 清除
  } else {
    cell.state = 'PURGE_PENDING';
    cell.agentInsertionTick = tick; // 3 个月潜伏期后由月度钩子结算
  }
  return cell;
}

/* ============================== 私掠许可证（doc45 Task 2.5 §3） ============================== */

/**
 * 私掠许可证 → 帝国继承人选拔池中提督（Admiral）阶层继承权重加成（+40）。
 * 签发复用 blackMarket.issueLetterOfMarque（仅战时可签，180 日豁免窗口）；
 * 本常量由 M3 galacticParagons 继承池消费（施工 notes：M2 仅定义权重契约值与读取口）。
 */
export const LETTERS_OF_MARQUE_HEIR_WEIGHT_BONUS = 40;

/**
 * 指定派系当前生效私掠证对应的继承人权重加成（M3 继承池读取口）：
 * world.economy.lettersOfMarque[factionId] 存在且豁免窗口未到期（notorietyFreezeUntil >
 * tick）→ +LETTERS_OF_MARQUE_HEIR_WEIGHT_BONUS，否则 0。
 */
export function heirWeightBonusFor(world, factionId) {
  const marque = world && world.economy && world.economy.lettersOfMarque
    ? world.economy.lettersOfMarque[factionId] : null;
  if (!marque) return 0;
  const tick = Number.isFinite(world.tick) ? world.tick : 0;
  return Number.isFinite(marque.notorietyFreezeUntil) && marque.notorietyFreezeUntil > tick
    ? LETTERS_OF_MARQUE_HEIR_WEIGHT_BONUS
    : 0;
}

/* —— SPEC-PLAN-049 Task 49.3 别名导出（doc49 导入名 ≙ M2 权威实现；零行为增量）—— */
export { stepShadowSyndicateArc as stepShadowSyndicateMonthly };
