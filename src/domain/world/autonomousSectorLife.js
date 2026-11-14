/**
 * domain/world/autonomousSectorLife.js — 5 类自主星区生态舰队（反孤独活体星区仿真）
 * （SPEC-PLAN-046 阶段三 M3 Task 3.3；责任人：Eng-C）
 *
 * 职责（doc46 §Task 3.3 §1 + doc42 总纲 §五.1 逐条契约）：
 *  舰队实例存 world.spaceOperaState.autonomousFleets，元素契约：
 *    { id, type, factionId, originSystemId, destSystemId,
 *      cargo: { resourceId, qty } | null, transitProgress, spawnedTick, interdicted,
 *      travelTicks, formationClass?, homePlanetId? }（后三者为 M3 派生附加字段，施工 notes 记录）。
 *  5 类派生规则（月度周期末 tick%720===0 确定性派生；deriveSeed(SECTOR_AUTONOMOUS,…)）：
 *   1. TRADE_CONVOY：净流>0 星 → 净流<0 同资源星（跨星系套利）；到港交付
 *      目的星 stockpile +qty 且源头 netFlow 扣减 -qty；途中同系统有敌对/海盗舰队 →
 *      interdicted：货物损失 + 目的星短缺进度推升（活跃 S4 局势 progress +3，
 *      否则 pendingSystemShocks['S4'] += 3）；
 *   2. SMUGGLER_RUNNER：向高关税（tariffRate ≥ 0.35）/ 叛乱前夕（活跃 PLANETARY_REVOLT）/
 *      高犯罪（crime ≥ 15）星运违禁品；到港入黑市库存；
 *   3. PATROL_FLOTILLA：有 patrolHQ 的星按 computeDoctrineTemplate 派生轻/中/重编队
 *      （每司令部常驻一支）；同系统反走私扫描（确定性查获，0.5 概率档）；
 *   4. MARKET_EXPEDITION：玩家某商品市场份额 > 40% → 霸权派系生成远征军指向玩家产区；
 *      玩家歼灭 → getRelation 调整 opinion −5 而绝不 declareWar（war.js 关系口径）；
 *   5. BOUNTY_HUNTER：响应赏金公会悬赏（world.economy.bounties / lettersOfMarque 在场）
 *      向敌对舰队所在星系游猎。
 *
 * 时钟接线裁决（与 Task 3.1 stepFleetReadiness 同款，见该文件头注释）：
 *  registerHourly('space-opera-autonomous-fleets', …) 由 SpaceOperaWiring.js 注册为每 tick 阶段，
 *  舰队桶按 numericEntityKey(fleet.id) % 10 === tick % 10 轮询（每支舰队每 10 tick 访问
 *  一次，访问即 transitProgress += 10 游戏小时 ≈ 1h/tick 摊销）——不经
 *  setClockHooks.fleetTick（该钩子按 world.entities.fleets 实体数每 tick 多调 12 次
 *  且零实体世界永不触发，直接注入会双重步进或失步，施工 notes 记录裁决）。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅注册时钟阶段与冻结常量；stepAutonomousFleets 首行守卫
 *    world.spaceOperaState（金快照世界零读取零写入）；
 *  - 确定性随机一律 deriveSeed/sampleFloat01/sampleWeightedIndex +
 *    DOMAIN_SALTS.SECTOR_AUTONOMOUS（0xD401）；零 Math.random / Date.now / world.rng；
 *  - ensureAutonomousFleets 幂等惰性挂载，仅供显式生命周期入口调用。
 */

import { DOMAIN_SALTS, deriveSeed, sampleFloat01, sampleWeightedIndex } from './deterministicRng.js';
import { ensureSpaceOperaState } from './worldMigration.js';
import { OPERA_RESOURCE_KEYS, numericEntityKey } from '../planets/planetStateSchema.js';
import { computeDoctrineTemplate } from '../fleets/fleetDoctrineAndScars.js';
import { ensureBlackMarket, CONTRABAND_IDS } from '../economy/blackMarket.js';
import { listActiveSituations } from '../events/situationEngine.js';
import { getRelation } from '../diplomacy/war.js';
import { emit, chronicle } from '../../core/eventBus.js';

/** 自主生态舰队确定性子流盐值（DOMAIN_SALTS 冻结表：自主舰队路由域） */
const SALT = DOMAIN_SALTS.SECTOR_AUTONOMOUS;

/** 5 类自主舰队类型枚举（冻结；顺序即派生优先序） */
export const AUTONOMOUS_FLEET_TYPES = Object.freeze([
  'TRADE_CONVOY',
  'SMUGGLER_RUNNER',
  'PATROL_FLOTILLA',
  'MARKET_EXPEDITION',
  'BOUNTY_HUNTER',
]);

/** 中立自主派系哨兵 ID（未注册派系默认视作海盗敌对；此二者豁免） */
export const AUTONOMOUS_NEUTRAL_FACTIONS = Object.freeze({
  fac_syndicate: true,
  fac_bounty_hunters: true,
});

/** 并存上限：全类型总数 / 单类型数（防长线膨胀，M3 裁决值） */
export const AUTONOMOUS_FLEET_CAP = 24;
export const AUTONOMOUS_FLEET_CAP_PER_TYPE = 6;

/** 舰队 10 桶轮询：每桶访问推进的 transit 游戏小时数（10 tick 周期 ≈ 1h/tick 摊销） */
export const FLEET_BUCKET_COUNT = 10;
export const TRANSIT_HOURS_PER_VISIT = 10;

/** 跨星系航程折算：1 星系坐标单位（=1LY，doc44 S4 裁决口径）× 2 小时，钳 [24,720] */
export const TRAVEL_TICKS_PER_LY = 2;
export const TRAVEL_MIN_TICKS = 24;
export const TRAVEL_MAX_TICKS = 720;

/** 商队货量（80–120 t 区间，M3 裁决） */
export const TRADE_CARGO_QTY_BASE = 80;
export const TRADE_CARGO_QTY_SPAN = 41;

/** 走私单次运量（24 单位违禁品，M3 裁决） */
export const SMUGGLER_CARGO_QTY = 24;

/** 巡逻反走私确定性查获概率档（0.5；deriveSeed 采样 < p 判查获） */
export const PATROL_BUST_PROBABILITY = 0.5;

/** 高关税走私目的地阈值（market.tariffRate ≥ 0.35，doc34 §4.2.1 黑市生成同源档） */
export const SMUGGLER_TARIFF_THRESHOLD = 0.35;

/** 高犯罪走私目的地阈值（colony.crime ≥ 15） */
export const SMUGGLER_CRIME_THRESHOLD = 15;

/** 市场份额远征阈值：玩家单一商品份额 > 40%（doc46 精确值） */
export const MARKET_SHARE_EXPEDITION_THRESHOLD = 0.4;

/** 玩家歼灭远征军的关系折价（−5，doc42 §五.1「每摧毁一支远征军关系降低 5 点」；绝不宣战） */
export const MARKET_EXPEDITION_RELATION_HIT = 5;

/** 截击推升目的星短缺局势进度的精确值（doc46 Task 3.3：progress +3） */
export const INTERDICT_SHORTAGE_PUSH = 3;

/** 每月度周期末派生的巡逻司令部数量上限（M3 裁决：防超大规模世界事件风暴） */
export const PATROL_DERIVE_CAP_PER_MONTH = 4;

/** 自主舰队派生起始月界（首个真实月末 tick=720 起；开局宽限，防 tick0 立即远征） */
export const DERIVE_START_TICK = 720;

/* ============================== 惰性容器与基础查询 ============================== */

/**
 * 显式生命周期入口：幂等挂载自主舰队容器（ensureSpaceOperaState + ID 游标）。
 * 绝不消费 world.rng；重复调用同引用。默认 tick 流程不调用本函数。
 */
export function ensureAutonomousFleets(world) {
  const soState = ensureSpaceOperaState(world);
  if (!Number.isFinite(soState.nextAutonomousFleetId)) soState.nextAutonomousFleetId = 1;
  if (!Array.isArray(soState.autonomousFleets)) soState.autonomousFleets = [];
  return soState;
}

/** 自主舰队列表只读（容器缺失返回 []，绝不 ensure） */
export function listAutonomousFleets(world) {
  const soState = world && world.spaceOperaState;
  return soState && Array.isArray(soState.autonomousFleets) ? soState.autonomousFleets : [];
}

/** world.seed 归一（与 fleetDoctrineAndScars / planetStateSchema 同款守卫） */
function worldSeedOf(world) {
  return (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
}

/** tick 归一 */
function tickOf(world) {
  return Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
}

/**
 * 派系身份桥接（opera 层 colony.ownerId 数字键 / 外交层字符串 id，双口径同型匹配；
 * 与 shadowSyndicateArc.hasTradeAgreement 的 String 同值口径一致）。
 */
function matchesFaction(ownerId, factionId) {
  if (ownerId === factionId) return true;
  if (String(ownerId) === String(factionId)) return true;
  return numericEntityKey(ownerId) === numericEntityKey(factionId);
}

/** 派系注册解析：返回 entities.factions 的真实键（未注册返回 null） */
function resolveFactionKey(world, factionId) {
  const factions = world && world.entities && world.entities.factions ? world.entities.factions : {};
  for (const k of Object.keys(factions)) {
    if (matchesFaction(k, factionId)) return k;
  }
  return null;
}

/**
 * 两派系敌对判定（截击/游猎目标共用口径）：
 *  - 同派系 → 不敌对；
 *  - 危机派系（fac_crisis）敌视一切；
 *  - 未注册派系（海盗/天灾集群）敌对，唯 AUTONOMOUS_NEUTRAL_FACTIONS 哨兵豁免；
 *  - 注册派系间：存在 active 战争（relations.diplomacy[relationKey].warId）才敌对。
 */
function factionHostile(world, a, b) {
  if (a == null || b == null || matchesFaction(a, b)) return false;
  if (a === 'fac_crisis' || b === 'fac_crisis') return true;
  const keyA = resolveFactionKey(world, a);
  const keyB = resolveFactionKey(world, b);
  if (!keyA || !keyB) {
    // 至少一方未注册：中立哨兵豁免，其余（海盗等）敌对
    const neutralA = !keyA && AUTONOMOUS_NEUTRAL_FACTIONS[a] === true;
    const neutralB = !keyB && AUTONOMOUS_NEUTRAL_FACTIONS[b] === true;
    return !(neutralA || neutralB);
  }
  const rel = world.relations && world.relations.diplomacy
    ? world.relations.diplomacy[relationKey(keyA, keyB)]
    : null;
  if (!rel || !rel.warId) return false;
  const war = world.entities && world.entities.wars ? world.entities.wars[rel.warId] : null;
  return !!war && war.status === 'active';
}

/** 星系坐标（缺省 null；1 坐标单位 = 1 LY，doc44 S4 裁决） */
function systemPos(world, systemId) {
  const sys = world && world.entities && world.entities.systems
    ? world.entities.systems[systemId] : null;
  return sys && Number.isFinite(sys.x) && Number.isFinite(sys.y) ? { x: sys.x, y: sys.y } : null;
}

/** 跨星系航程折算 tick（TRAVEL_TICKS_PER_LY × LY，钳 [24,720]；无坐标回退下限） */
export function travelTicksFor(world, originSystemId, destSystemId) {
  const a = systemPos(world, originSystemId);
  const b = systemPos(world, destSystemId);
  if (!a || !b) return TRAVEL_MIN_TICKS;
  const ly = Math.hypot(a.x - b.x, a.y - b.y) * 1.0;
  const t = Math.round(ly * TRAVEL_TICKS_PER_LY);
  return Math.max(TRAVEL_MIN_TICKS, Math.min(TRAVEL_MAX_TICKS, t));
}

/** 舰队当前位置：半程前在起点星系、半程后算抵达星系（截击判定口径） */
export function currentSystemIdOf(fleet) {
  if (!fleet) return null;
  const half = (Number.isFinite(fleet.travelTicks) ? fleet.travelTicks : 0) / 2;
  return (Number.isFinite(fleet.transitProgress) && fleet.transitProgress < half)
    ? fleet.originSystemId
    : fleet.destSystemId;
}

/** 已殖民行星确定性收集（含 compactState + colony + 8 维数组；键序升序） */
function colonizedPlanets(world) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const out = [];
  for (const key of Object.keys(planets).sort()) {
    const p = planets[key];
    const compact = p && p.compactState;
    const colony = compact && compact.colony;
    if (compact && colony && Array.isArray(colony.stockpile) && Array.isArray(colony.netFlow)) {
      out.push(p);
    }
  }
  return out;
}

/** 星系内第一颗已殖民行星（数值键升序；无则 null） */
function firstColonizedPlanetInSystem(world, systemId) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  const found = [];
  for (const key of Object.keys(planets)) {
    const p = planets[key];
    if (p && p.systemId === systemId && p.compactState && p.compactState.colony) {
      found.push({ num: numericEntityKey(p.id), p });
    }
  }
  found.sort((a, b) => a.num - b.num);
  return found.length > 0 ? found[0].p : null;
}

/** 待决系统冲击写入（jacobianCoupling.consumePendingShocks 消费契约；同键累加） */
function pushSystemShock(world, key, delta) {
  const soState = world && world.spaceOperaState;
  if (!soState) return;
  if (!soState.pendingSystemShocks || typeof soState.pendingSystemShocks !== 'object') {
    soState.pendingSystemShocks = {};
  }
  soState.pendingSystemShocks[key] = (Number(soState.pendingSystemShocks[key]) || 0) + delta;
}

/* ============================== 派生与登记 ============================== */

/**
 * 登记一支自主舰队（容量护栏：全类型 24 / 单类型 6，超限返回 null）。
 * @param {object} spec - { type, factionId, originSystemId, destSystemId, cargo?, travelTicks?, formationClass?, homePlanetId? }
 */
export function spawnAutonomousFleet(world, spec) {
  if (!world || !world.spaceOperaState) return null;
  const soState = ensureAutonomousFleets(world);
  const fleets = soState.autonomousFleets;
  if (fleets.length >= AUTONOMOUS_FLEET_CAP) return null;
  if (!AUTONOMOUS_FLEET_TYPES.includes(spec.type)) return null;
  if (fleets.filter((f) => f.type === spec.type).length >= AUTONOMOUS_FLEET_CAP_PER_TYPE) return null;
  const fleet = {
    id: soState.nextAutonomousFleetId++,
    type: spec.type,
    factionId: spec.factionId != null ? spec.factionId : null,
    originSystemId: spec.originSystemId != null ? spec.originSystemId : null,
    destSystemId: spec.destSystemId != null ? spec.destSystemId : spec.originSystemId,
    cargo: spec.cargo ? { resourceId: spec.cargo.resourceId, qty: spec.cargo.qty } : null,
    transitProgress: 0,
    spawnedTick: tickOf(world),
    interdicted: false,
    travelTicks: Number.isFinite(spec.travelTicks) ? spec.travelTicks : travelTicksFor(world, spec.originSystemId, spec.destSystemId),
  };
  if (spec.formationClass) fleet.formationClass = spec.formationClass;
  if (spec.homePlanetId != null) fleet.homePlanetId = spec.homePlanetId;
  fleets.push(fleet);
  return fleet;
}

/** 单类型/总量计数（派生护栏） */
function countByType(fleets, type) {
  return fleets.filter((f) => f && f.type === type).length;
}

/**
 * 月度周期末派生（tick%720===0 且 tick ≥ DERIVE_START_TICK；stepAutonomousFleets 内联调用，
 * 亦可被套件直调）。5 类规则逐一按 deriveSeed(SECTOR_AUTONOMOUS,…) 确定性执行。
 *
 * @returns {{derived: number, byType: Object<string, number>}}
 */
export function deriveAutonomousFleets(world) {
  const stats = { derived: 0, byType: {} };
  if (!world || !world.spaceOperaState) return stats;
  const tick = tickOf(world);
  if (tick < DERIVE_START_TICK) return stats; // 开局宽限：首个真实月末（720）起派生
  const seed = worldSeedOf(world);
  const soState = world.spaceOperaState;
  const fleets = Array.isArray(soState.autonomousFleets) ? soState.autonomousFleets : [];
  const planets = colonizedPlanets(world);
  if (planets.length === 0) return stats;

  // —— 1) TRADE_CONVOY：净流>0 星 → 净流<0 同资源星（跨星系套利）——
  {
    const srcs = [];
    const dsts = [];
    const weights = [];
    for (let i = 0; i < OPERA_RESOURCE_KEYS.length; i++) {
      const s = planets.filter((p) => Number(p.compactState.colony.netFlow[i]) > 0);
      const d = planets.filter((p) => Number(p.compactState.colony.netFlow[i]) < 0);
      srcs.push(s);
      dsts.push(d);
      weights.push(s.length * d.length);
    }
    const idx = sampleWeightedIndex(seed, SALT, tick, 11, weights);
    if (weights[idx] > 0 && srcs[idx].length > 0 && dsts[idx].length > 0) {
      const src = srcs[idx][deriveSeed(seed, SALT, tick, 21 + idx) % srcs[idx].length];
      const dst = dsts[idx][deriveSeed(seed, SALT, tick, 31 + idx) % dsts[idx].length];
      if (src.systemId !== dst.systemId && countByType(fleets, 'TRADE_CONVOY') < AUTONOMOUS_FLEET_CAP_PER_TYPE) {
        const qty = TRADE_CARGO_QTY_BASE + (deriveSeed(seed, SALT, tick, 41 + idx) % TRADE_CARGO_QTY_SPAN);
        const fleet = spawnAutonomousFleet(world, {
          type: 'TRADE_CONVOY',
          factionId: src.compactState.colony.ownerId,
          originSystemId: src.systemId,
          destSystemId: dst.systemId,
          cargo: { resourceId: OPERA_RESOURCE_KEYS[idx], qty },
        });
        if (fleet) bump(stats, 'TRADE_CONVOY');
      }
    }
  }

  // —— 2) SMUGGLER_RUNNER：高关税 / 叛乱前夕 / 高犯罪星 ——
  {
    const revoltTargets = new Set(
      listActiveSituations(world)
        .filter((s) => s.systemArcId === 'PLANETARY_REVOLT' && s.resolvedTick == null)
        .map((s) => String(s.targetEntityId)),
    );
    const dsts = planets.filter((p) => {
      const market = world.economy && world.economy.markets
        ? world.economy.markets[p.systemId] : null;
      const tariff = market && Number.isFinite(market.tariffRate) ? market.tariffRate : 0;
      const crime = Number(p.compactState.colony.crime);
      return tariff >= SMUGGLER_TARIFF_THRESHOLD
        || (Number.isFinite(crime) && crime >= SMUGGLER_CRIME_THRESHOLD)
        || revoltTargets.has(String(p.id));
    });
    if (dsts.length > 0 && countByType(fleets, 'SMUGGLER_RUNNER') < AUTONOMOUS_FLEET_CAP_PER_TYPE) {
      const sysKeys = Object.keys(world.entities.systems || {}).sort();
      if (sysKeys.length > 0) {
        const dst = dsts[deriveSeed(seed, SALT, tick, 51) % dsts.length];
        const origins = sysKeys.filter((k) => k !== dst.systemId);
        const origin = origins.length > 0
          ? origins[deriveSeed(seed, SALT, tick, 52) % origins.length]
          : dst.systemId;
        const resIdx = deriveSeed(seed, SALT, tick, 53) % CONTRABAND_IDS.length;
        const fleet = spawnAutonomousFleet(world, {
          type: 'SMUGGLER_RUNNER',
          factionId: 'fac_syndicate',
          originSystemId: origin,
          destSystemId: dst.systemId,
          cargo: { resourceId: CONTRABAND_IDS[resIdx], qty: SMUGGLER_CARGO_QTY },
        });
        if (fleet) bump(stats, 'SMUGGLER_RUNNER');
      }
    }
  }

  // —— 3) PATROL_FLOTILLA：patrolHQ 星按 computeDoctrineTemplate 派生轻/中/重编队 ——
  {
    const hqPlanets = planets
      .filter((p) => p.patrolHQ && p.patrolHQ.doctrine)
      .slice(0, PATROL_DERIVE_CAP_PER_MONTH);
    for (const p of hqPlanets) {
      const already = fleets.some((f) => f.type === 'PATROL_FLOTILLA' && f.homePlanetId === p.id);
      if (already) continue; // 每司令部常驻一支巡逻编队
      const tpl = computeDoctrineTemplate(p.patrolHQ.doctrine);
      const clsIdx = sampleWeightedIndex(
        seed, SALT, numericEntityKey(p.id), 61,
        [tpl.light, tpl.mid, tpl.heavy],
      );
      const formationClass = ['light', 'mid', 'heavy'][clsIdx] || 'light';
      const fleet = spawnAutonomousFleet(world, {
        type: 'PATROL_FLOTILLA',
        factionId: p.patrolHQ.factionId,
        originSystemId: p.systemId,
        destSystemId: p.systemId,
        cargo: null,
        travelTicks: TRAVEL_MIN_TICKS,
        formationClass,
        homePlanetId: p.id,
      });
      if (fleet) bump(stats, 'PATROL_FLOTILLA');
    }
  }

  // —— 4) MARKET_EXPEDITION：玩家单一商品份额 > 40% → 霸权派系远征军指向玩家产区 ——
  {
    const pf = world.playerFactionId;
    if (pf) {
      const totals = new Array(OPERA_RESOURCE_KEYS.length).fill(0);
      const playerTotals = new Array(OPERA_RESOURCE_KEYS.length).fill(0);
      for (const p of planets) {
        const stock = p.compactState.colony.stockpile;
        const isPlayer = matchesFaction(p.compactState.colony.ownerId, pf);
        for (let i = 0; i < totals.length; i++) {
          const v = Number.isFinite(Number(stock[i])) ? Math.max(0, Number(stock[i])) : 0;
          totals[i] += v;
          if (isPlayer) playerTotals[i] += v;
        }
      }
      let bestIdx = -1;
      let bestShare = 0;
      for (let i = 0; i < totals.length; i++) {
        if (totals[i] <= 0) continue;
        const share = playerTotals[i] / totals[i];
        if (share > MARKET_SHARE_EXPEDITION_THRESHOLD && share > bestShare) {
          bestShare = share;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && countByType(fleets, 'MARKET_EXPEDITION') < AUTONOMOUS_FLEET_CAP_PER_TYPE) {
        // 霸权派系：键序首个非玩家注册派系（确定性）
        const factions = world.entities.factions || {};
        let hegemon = null;
        for (const k of Object.keys(factions).sort()) {
          if (!matchesFaction(k, pf)) { hegemon = k; break; }
        }
        if (hegemon) {
          // 玩家产区：该商品库存最高的玩家殖民星（tie 数值键升序）
          let dest = null;
          let destNum = Infinity;
          let destStock = -1;
          for (const p of planets) {
            if (!matchesFaction(p.compactState.colony.ownerId, pf)) continue;
            const v = Math.max(0, Number(p.compactState.colony.stockpile[bestIdx]) || 0);
            const num = numericEntityKey(p.id);
            if (v > destStock || (v === destStock && num < destNum)) {
              destStock = v;
              destNum = num;
              dest = p;
            }
          }
          if (dest) {
            const hegFac = factions[hegemon];
            const originSystemId = (hegFac && hegFac.homePlanetId
              && world.entities.planets[hegFac.homePlanetId])
              ? world.entities.planets[hegFac.homePlanetId].systemId
              : dest.systemId;
            const fleet = spawnAutonomousFleet(world, {
              type: 'MARKET_EXPEDITION',
              factionId: hegemon,
              originSystemId,
              destSystemId: dest.systemId,
              cargo: { resourceId: OPERA_RESOURCE_KEYS[bestIdx], qty: 60 },
            });
            if (fleet) bump(stats, 'MARKET_EXPEDITION');
          }
        }
      }
    }
  }

  // —— 5) BOUNTY_HUNTER：赏金公会悬赏在场 → 向敌对舰队星系游猎 ——
  {
    const hasBounty = !!(world.economy && world.economy.bounties)
      || !!(world.economy && world.economy.lettersOfMarque
        && Object.keys(world.economy.lettersOfMarque).length > 0);
    if (hasBounty && countByType(fleets, 'BOUNTY_HUNTER') < AUTONOMOUS_FLEET_CAP_PER_TYPE) {
      const pf = world.playerFactionId;
      const hostileSystems = [];
      const seen = new Set();
      const fleetsAll = world.entities && world.entities.fleets ? world.entities.fleets : {};
      for (const key of Object.keys(fleetsAll).sort()) {
        const f = fleetsAll[key];
        if (!f || f.role !== 'combat' || f.status === 'dissolved' || f.systemId == null) continue;
        if (seen.has(f.systemId)) continue;
        if (factionHostile(world, pf, f.factionId)) {
          hostileSystems.push(f.systemId);
          seen.add(f.systemId);
        }
      }
      if (hostileSystems.length > 0) {
        hostileSystems.sort((a, b) => String(a).localeCompare(String(b)));
        const dest = hostileSystems[deriveSeed(seed, SALT, tick, 71) % hostileSystems.length];
        const sysKeys = Object.keys(world.entities.systems || {}).sort().filter((k) => k !== dest);
        const origin = sysKeys.length > 0 ? sysKeys[deriveSeed(seed, SALT, tick, 72) % sysKeys.length] : dest;
        const fleet = spawnAutonomousFleet(world, {
          type: 'BOUNTY_HUNTER',
          factionId: 'fac_bounty_hunters',
          originSystemId: origin,
          destSystemId: dest,
          cargo: null,
        });
        if (fleet) bump(stats, 'BOUNTY_HUNTER');
      }
    }
  }

  return stats;
}

/** 派生统计累加（内部） */
function bump(stats, type) {
  stats.derived++;
  stats.byType[type] = (stats.byType[type] || 0) + 1;
}

/* ============================== 截击与到港结算 ============================== */

/** 同系统敌方战斗舰队存在判定（截击口径；见 factionHostile） */
function hostileFleetInSystem(world, fleet, systemId) {
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  for (const key of Object.keys(fleets).sort()) {
    const f = fleets[key];
    if (!f || f.systemId !== systemId) continue;
    if (f.status === 'dissolved') continue;
    if ((f.role || 'combat') !== 'combat') continue;
    if (factionHostile(world, fleet.factionId, f.factionId)) return f;
  }
  return null;
}

/**
 * 截击结算（TRADE_CONVOY / SMUGGLER_RUNNER 途中检定）：
 * 货物损失 + 目的星短缺进度推升（活跃 S4 局势 progress +3，否则 pendingSystemShocks['S4'] += 3）。
 * 舰队置 interdicted=true 后于下次桶访问移除（世界态可观测窗口）。
 */
function settleInterdiction(world, fleet, tick) {
  fleet.interdicted = true;
  emit(world, 'AutonomousFleetInterdicted', {
    fleetId: fleet.id,
    type: fleet.type,
    factionId: fleet.factionId,
    systemId: currentSystemIdOf(fleet),
    cargoLost: fleet.cargo ? { ...fleet.cargo } : null,
  }, 'fleet');
  chronicle(world, 'fleet', `自主${fleetTypeName(fleet.type)}在途遭截击，货物尽失`, { fleetId: fleet.id });

  // —— 目的星短缺进度推升（断供后果，doc46 §Task 3.3 §1）——
  const dstPlanet = firstColonizedPlanetInSystem(world, fleet.destSystemId);
  if (dstPlanet) {
    const sit = listActiveSituations(world).find((s) => s.systemArcId === 'S4'
      && (s.targetEntityId === dstPlanet.id || String(s.targetEntityId) === String(dstPlanet.id)));
    if (sit) {
      sit.progress = Math.min(
        Number.isFinite(sit.progressMax) ? sit.progressMax : 100,
        (Number.isFinite(sit.progress) ? sit.progress : 0) + INTERDICT_SHORTAGE_PUSH,
      );
      emit(world, 'ConvoyInterdictShortagePushed', {
        fleetId: fleet.id,
        planetId: dstPlanet.id,
        situationId: sit.id,
        pushed: INTERDICT_SHORTAGE_PUSH,
      }, 'economy');
    } else {
      pushSystemShock(world, 'S4', INTERDICT_SHORTAGE_PUSH);
    }
  }
}

/** 中文类型名（事件文案） */
function fleetTypeName(type) {
  return {
    TRADE_CONVOY: '套利商队',
    SMUGGLER_RUNNER: '走私快船',
    PATROL_FLOTILLA: '治安巡逻队',
    MARKET_EXPEDITION: '市场份额远征军',
    BOUNTY_HUNTER: '赏金猎人',
  }[type] || type;
}

/** 巡逻队同系统反走私扫描（确定性查获：sampleFloat01 < PATROL_BUST_PROBABILITY） */
function patrolAntiSmugglingScan(world, patrol, tick) {
  const seed = worldSeedOf(world);
  const fleets = listAutonomousFleets(world);
  const patrolSystem = currentSystemIdOf(patrol);
  let busted = 0;
  for (const s of fleets) {
    if (!s || s.type !== 'SMUGGLER_RUNNER' || s.interdicted) continue;
    if (currentSystemIdOf(s) !== patrolSystem) continue;
    const roll = sampleFloat01(seed, SALT, numericEntityKey(s.id), tick * 13 + 7);
    if (roll < PATROL_BUST_PROBABILITY) {
      s.interdicted = true;
      busted++;
      emit(world, 'SmugglerBustedByPatrol', {
        smugglerId: s.id,
        patrolId: patrol.id,
        systemId: patrolSystem,
        cargoSeized: s.cargo ? { ...s.cargo } : null,
      }, 'fleet');
    }
  }
  return busted;
}

/** 到港结算（按类型分派；返回 true = 舰队已移除） */
function settleArrival(world, fleet, tick) {
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const idx = fleet.cargo ? OPERA_RESOURCE_KEYS.indexOf(fleet.cargo.resourceId) : -1;

  switch (fleet.type) {
    case 'TRADE_CONVOY': {
      const dstPlanet = firstColonizedPlanetInSystem(world, fleet.destSystemId);
      const srcPlanet = firstColonizedPlanetInSystem(world, fleet.originSystemId);
      if (dstPlanet && idx >= 0) {
        dstPlanet.compactState.colony.stockpile[idx] += fleet.cargo.qty; // 到港交付
      }
      if (srcPlanet && idx >= 0) {
        srcPlanet.compactState.colony.netFlow[idx] -= fleet.cargo.qty; // 源头净流扣减
      }
      emit(world, 'TradeConvoyDelivered', {
        fleetId: fleet.id,
        originSystemId: fleet.originSystemId,
        destSystemId: fleet.destSystemId,
        cargo: fleet.cargo ? { ...fleet.cargo } : null,
        delivered: !!dstPlanet && idx >= 0,
      }, 'economy');
      return true;
    }
    case 'SMUGGLER_RUNNER': {
      const bm = ensureBlackMarket(world, fleet.destSystemId);
      if (bm && fleet.cargo) {
        bm.stock[fleet.cargo.resourceId] = (bm.stock[fleet.cargo.resourceId] || 0) + fleet.cargo.qty;
      }
      emit(world, 'SmugglerRunDelivered', {
        fleetId: fleet.id,
        destSystemId: fleet.destSystemId,
        cargo: fleet.cargo ? { ...fleet.cargo } : null,
        marketPresent: !!bm,
      }, 'economy');
      return true;
    }
    case 'PATROL_FLOTILLA': {
      patrolAntiSmugglingScan(world, fleet, tick);
      const home = fleet.homePlanetId != null ? planets[fleet.homePlanetId] || planets[`plt_${fleet.homePlanetId}`] : null;
      if (!home || !home.patrolHQ) return true; // 司令部撤编 → 巡逻队解散
      fleet.transitProgress = 0; // 常驻编队：重置航程继续巡逻
      return false;
    }
    case 'MARKET_EXPEDITION': {
      const dstPlanet = firstColonizedPlanetInSystem(world, fleet.destSystemId);
      if (dstPlanet && idx >= 0) {
        const stock = dstPlanet.compactState.colony.stockpile;
        stock[idx] = Math.max(0, stock[idx] - fleet.cargo.qty); // 袭击产区掠获
      }
      emit(world, 'MarketExpeditionRaided', {
        fleetId: fleet.id,
        factionId: fleet.factionId,
        destSystemId: fleet.destSystemId,
        cargo: fleet.cargo ? { ...fleet.cargo } : null,
      }, 'economy');
      chronicle(world, 'politics', `霸权市场份额远征军袭击玩家产区（${fleetTypeName(fleet.type)}）`, { fleetId: fleet.id });
      return true;
    }
    case 'BOUNTY_HUNTER': {
      emit(world, 'BountyHuntSettled', {
        fleetId: fleet.id,
        destSystemId: fleet.destSystemId,
      }, 'fleet');
      return true;
    }
    default:
      return true;
  }
}

/* ============================== 每 tick 桶步进 ============================== */

/**
 * 自主生态舰队每 tick 步进（registerHourly 'space-opera-autonomous-fleets' 注册形态）。
 * 首行守卫 world.spaceOperaState（未挂载容器 → 金快照世界零读取零写入）；
 * 舰队桶：numericEntityKey(fleet.id) % 10 === tick % 10；月度周期末（tick%720===0 且
 * tick ≥ 720）触发 5 类派生规则。
 *
 * @returns {{visited: number, arrived: number, interdicted: number, derived: number}}
 */
export function stepAutonomousFleets(world) {
  const stats = { visited: 0, arrived: 0, interdicted: 0, derived: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const soState = world.spaceOperaState;
  if (!Array.isArray(soState.autonomousFleets)) soState.autonomousFleets = [];
  if (!Number.isFinite(soState.nextAutonomousFleetId)) soState.nextAutonomousFleetId = 1;
  const tick = tickOf(world);

  // —— 月度周期末：5 类派生规则 ——
  if (tick > 0 && tick % 720 === 0) {
    const d = deriveAutonomousFleets(world);
    stats.derived = d.derived;
  }

  const fleets = soState.autonomousFleets;
  const bucket = tick % FLEET_BUCKET_COUNT;
  for (let i = fleets.length - 1; i >= 0; i--) {
    const fleet = fleets[i];
    if (!fleet || typeof fleet !== 'object') {
      fleets.splice(i, 1);
      continue;
    }
    if (numericEntityKey(fleet.id) % FLEET_BUCKET_COUNT !== bucket) continue;
    stats.visited++;

    // —— 截击善后：上轮置 interdicted 的舰队本轮移除（世界态可观测窗口 10 tick）——
    if (fleet.interdicted) {
      fleets.splice(i, 1);
      stats.interdicted++;
      continue;
    }

    // —— 截击检定（商队/走私船在途；同系统出现敌对/海盗战斗舰队）——
    if (fleet.type === 'TRADE_CONVOY' || fleet.type === 'SMUGGLER_RUNNER') {
      const cur = currentSystemIdOf(fleet);
      if (cur != null && hostileFleetInSystem(world, fleet, cur)) {
        settleInterdiction(world, fleet, tick);
        continue;
      }
    }

    // —— 航线推进（每桶访问 +10 游戏小时）——
    fleet.transitProgress = (Number.isFinite(fleet.transitProgress) ? fleet.transitProgress : 0)
      + TRANSIT_HOURS_PER_VISIT;

    // —— 到港结算 ——
    if (fleet.transitProgress >= (Number.isFinite(fleet.travelTicks) ? fleet.travelTicks : TRAVEL_MIN_TICKS)) {
      const removed = settleArrival(world, fleet, tick);
      if (removed) {
        fleets.splice(i, 1);
        stats.arrived++;
      }
    }
  }
  return stats;
}

// —— 时钟阶段注册已收拢至 src/simulation/SpaceOperaWiring.js（SPEC-PLAN-049 §Task 49.3
//    唯一注册点：registerHourly('space-opera-autonomous-fleets', …)）。原 import 期副作用
//    注册拆除；stepAutonomousFleets 首行自守卫 world.spaceOperaState（金快照世界零读取零写入）。——

/* ============================== 玩家歼灭结算（远征军关系折价） ============================== */

/**
 * 自主舰队被玩家歼灭（战斗层/命令路径上报的领域落点）：
 *  - MARKET_EXPEDITION：getRelation 调整 opinion −5（MARKET_EXPEDITION_RELATION_HIT），
 *    **绝不调用 declareWar**（doc42 §五.1：摧毁远征军仅关系降低 5 点，不触发全面宣战）；
 *  - 其余类型：仅移除并记账。
 * 目标不存在返回 { ok:false, reason }；成功返回歼灭记录（同时落 soState.lastAutonomousFleetKill）。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} fleetId - 自主舰队 ID
 * @param {string|number} [byFactionId] - 动手方派系（缺省按玩家派系）
 */
export function onAutonomousFleetDestroyed(world, fleetId, byFactionId) {
  if (!world || !world.spaceOperaState) return { ok: false, reason: 'SO: 自主舰队容器未挂载' };
  const soState = world.spaceOperaState;
  const fleets = Array.isArray(soState.autonomousFleets) ? soState.autonomousFleets : [];
  const pos = fleets.findIndex((f) => f && (f.id === fleetId || String(f.id) === String(fleetId)));
  if (pos < 0) return { ok: false, reason: `SO: 自主舰队不存在 ${String(fleetId)}` };
  const fleet = fleets[pos];
  fleets.splice(pos, 1);

  const actor = byFactionId != null ? byFactionId : world.playerFactionId;
  const record = {
    fleetId: fleet.id,
    type: fleet.type,
    factionId: fleet.factionId,
    byFactionId: actor != null ? actor : null,
    relationHit: 0,
    tick: tickOf(world),
  };

  if (fleet.type === 'MARKET_EXPEDITION' && actor != null) {
    const keyA = resolveFactionKey(world, actor);
    const keyB = resolveFactionKey(world, fleet.factionId);
    if (keyA && keyB && keyA !== keyB) {
      // war.js getRelation 惰性取关系并震荡 −5；
      // 刻意绕开 war.declareWar —— 商业远征摩擦不构成宣战理由（doc42 §五.1）
      const rel = getRelation(world, keyA, keyB);
      rel.opinion = Math.max(-100, (Number.isFinite(rel.opinion) ? rel.opinion : 0) - MARKET_EXPEDITION_RELATION_HIT);
      record.relationHit = -MARKET_EXPEDITION_RELATION_HIT;
    }
    emit(world, 'MarketExpeditionDestroyed', {
      fleetId: fleet.id,
      hegemonFactionId: fleet.factionId,
      byFactionId: record.byFactionId,
      opinionDelta: record.relationHit,
      warDeclared: false,
    }, 'diplomacy');
    chronicle(world, 'diplomacy', '市场份额远征军遭伏击歼灭——商业摩擦仅折损关系 5 点，未构成宣战', { fleetId: fleet.id });
  } else {
    emit(world, 'AutonomousFleetDestroyed', {
      fleetId: fleet.id,
      type: fleet.type,
      byFactionId: record.byFactionId,
    }, 'fleet');
  }

  soState.lastAutonomousFleetKill = record;
  return { ok: true, record };
}
