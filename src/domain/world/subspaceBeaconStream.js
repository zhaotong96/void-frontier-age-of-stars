/**
 * domain/world/subspaceBeaconStream.js — 全频段子空间信标流（反孤独硬性不变量）
 * （SPEC-PLAN-046 阶段三 M3 Task 3.3；责任人：Eng-C）
 *
 * 职责（doc46 §Task 3.3 §2 + doc42 总纲 §五.3 逐条契约）：
 *  1. 常驻密度铁律：任何时刻非帝国官方动态叙事信标（kind='NARRATIVE'）活跃数必须 ≥
 *     BEACON_MIN_NARRATIVE(15)；stepBeaconStream 每帧先清过期、再按
 *     deriveSeed(world.seed, SUBSPACE_BEACON, world.tick, idx) 确定性补足到 15
 *     （频段 sampleWeightedIndex 四等权选一、系统确定性选、模板确定性选）；
 *  2. 信标实例契约：{ id, freqClass, systemId, text, spawnedTick, expiresTick,
 *     kind:'NARRATIVE'|'OPPORTUNITY', templateId, responseOptions:[{id,label,effectHint,effect}] }
 *     —— 存 world.spaceOperaState.subspaceBeacons（帝国官方信标 kind='OFFICIAL'，
 *     不计入 15 密度，由上层投放，本模块只做密度统计区分）；
 *  3. injectOpportunityBeacons(world, n)：追加 n 个 OPPORTUNITY_BEACON 机遇信标
 *     （戏剧导演高潮宣泄 +18 爆发的唯一投放口，doc46 §Task 3.5 §4）；
 *  4. respondSubspaceBeacon(world, beaconId, responseOptionId)：救援 → 资源奖励 /
 *     星海日报 → 临时增益 / 黑市合约 → blackMarket 交易窗口 / 先驱者低语 → researchData
 *     / 凝聚奖励 → unityTreasury / 难民 → 玩家殖民地人口；响应后信标从流中移除，
 *     结果写入 world.spaceOperaState.lastBeaconResponse（命令总线返回值不透传契约）。
 *
 * 时钟接线裁决：registerHourly('space-opera-beacon-stream', …) 由 SpaceOperaWiring.js 注册为每
 * tick（fast）阶段 —— 函数体首行守卫 world.spaceOperaState：未挂载容器（默认流程 /
 * 金快照 8be8ce2c 世界）零读取零写入，逐位零漂移。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅注册时钟阶段与冻结常量，不改任何世界状态、不 ensure 容器；
 *  - 密度补足 / 注入 / 响应全部确定性：deriveSeed/sampleWeightedIndex +
 *    DOMAIN_SALTS.SUBSPACE_BEACON（0xE501）；零 Math.random / Date.now / world.rng；
 *  - stepBeaconStream / injectOpportunityBeacons 守卫式读取（绝不 ensure）；
 *    ensureBeaconStream 仅由显式生命周期入口（集成层/套件）调用。
 */

import { DOMAIN_SALTS, deriveSeed, sampleWeightedIndex } from './deterministicRng.js';
import { ensureSpaceOperaState } from './worldMigration.js';
import {
  SUBSPACE_BEACON_TEMPLATES,
  OPPORTUNITY_BEACON_TEMPLATES,
  SUBSPACE_FREQ_CLASSES,
  FREQ_CLASS_WEIGHTS,
  OPPORTUNITY_FREQ_CLASS,
} from '../../content/spaceOperaBeacons.js';
import { ensureBlackMarket } from '../economy/blackMarket.js';
import { credit } from '../economy/ledger.js';
import { emit } from '../../core/eventBus.js';

/** 信标流确定性子流盐值（DOMAIN_SALTS 冻结表：信标流生成与频段调制域） */
const SALT = DOMAIN_SALTS.SUBSPACE_BEACON;

/** 密度铁律：非帝国叙事信标（kind='NARRATIVE'）常驻下限（doc46 精确值 15） */
export const BEACON_MIN_NARRATIVE = 15;

/** 流总量硬上限（机遇爆发叠加后的膨胀护栏；防长线漂移失控） */
export const BEACON_MAX_TOTAL = 96;

/** 叙事信标存续时长（360 tick = 15 游戏日；M3 裁决值，写入 notes） */
export const BEACON_NARRATIVE_LIFETIME_TICKS = 360;

/** 机遇信标存续时长（720 tick = 1 真实月；机遇窗口更宽裕） */
export const BEACON_OPPORTUNITY_LIFETIME_TICKS = 720;

/** 单次密度补足最大尝试数（护栏：防词库耗尽/无星系时死循环） */
const MAX_FILL_PER_STEP = 32;

/* ============================== 惰性容器与只读查询 ============================== */

/**
 * 显式生命周期入口：幂等挂载信标流容器（ensureSpaceOperaState + 游标字段）。
 * 绝不消费 world.rng；重复调用同引用。默认 tick 流程不调用本函数。
 */
export function ensureBeaconStream(world) {
  const soState = ensureSpaceOperaState(world);
  if (!Number.isFinite(soState.nextSubspaceBeaconId)) soState.nextSubspaceBeaconId = 1;
  if (!Array.isArray(soState.subspaceBeacons)) soState.subspaceBeacons = [];
  return soState;
}

/** 活跃信标列表只读（容器缺失返回 []，绝不 ensure） */
export function listActiveBeacons(world) {
  const soState = world && world.spaceOperaState;
  return soState && Array.isArray(soState.subspaceBeacons) ? soState.subspaceBeacons : [];
}

/** 非帝国叙事信标活跃数（kind==='NARRATIVE'；只读；密度铁律断言口径） */
export function countActiveNarrative(world) {
  return listActiveBeacons(world).filter((b) => b && b.kind === 'NARRATIVE').length;
}

/* ============================== 确定性生成 ============================== */

/** world.seed 归一（与 fleetDoctrineAndScars / planetStateSchema 同款守卫） */
function worldSeedOf(world) {
  return (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
}

/** 系统键确定性序（sortedEntityKeys 同款：字符串键字典序） */
function sortedSystemKeys(world) {
  const systems = world && world.entities && world.entities.systems ? world.entities.systems : {};
  return Object.keys(systems).sort();
}

/** {system}/{faction} 占位符替换（确定性：占位值全部来自实体字段） */
function fillText(text, systemName, factionName) {
  return String(text)
    .split('{system}').join(systemName)
    .split('{faction}').join(factionName);
}

/**
 * 生成一条叙事信标（kind='NARRATIVE'；step 契约严格按 doc46：
 * deriveSeed(SUBSPACE_BEACON, world.tick, idx) → 频段/模板/系统三路子采样）。
 *
 * @returns {object|null} 信标实例（无星系可挂载时返回 null）
 */
function spawnNarrativeBeacon(world, tick, idx) {
  const seed = worldSeedOf(world);
  const sysKeys = sortedSystemKeys(world);
  if (sysKeys.length === 0) return null;

  const freqIdx = sampleWeightedIndex(seed, SALT, tick, idx * 16 + 1, FREQ_CLASS_WEIGHTS);
  const freqClass = SUBSPACE_FREQ_CLASSES[freqIdx] || SUBSPACE_FREQ_CLASSES[0];
  const pool = SUBSPACE_BEACON_TEMPLATES.filter((t) => t.freqClass === freqClass);
  if (pool.length === 0) return null;
  const tpl = pool[deriveSeed(seed, SALT, tick, idx * 16 + 2) % pool.length];
  const sysKey = sysKeys[deriveSeed(seed, SALT, tick, idx * 16 + 3) % sysKeys.length];
  const sys = world.entities.systems[sysKey];
  const systemName = (sys && sys.name) ? sys.name : `星系 ${sysKey}`;
  const owner = sys && sys.ownerFactionId && world.entities.factions[sys.ownerFactionId];
  const factionName = (owner && owner.name) || '自治殖民地';

  return {
    id: world.spaceOperaState.nextSubspaceBeaconId++,
    freqClass,
    systemId: sysKey,
    text: fillText(`${tpl.title}：${tpl.body}`, systemName, factionName),
    spawnedTick: tick,
    expiresTick: tick + BEACON_NARRATIVE_LIFETIME_TICKS,
    kind: 'NARRATIVE',
    templateId: tpl.templateId,
    responseOptions: tpl.responseOptions.map((o) => ({ ...o })),
  };
}

/**
 * 生成一条机遇信标（kind='OPPORTUNITY'；injectOpportunityBeacons 与高潮宣泄消费）。
 * 子采样 step 与叙事流（idx*16 段）正交（900000 偏移段），互不串流。
 */
function spawnOpportunityBeacon(world, tick, i) {
  const seed = worldSeedOf(world);
  const sysKeys = sortedSystemKeys(world);
  if (sysKeys.length === 0 || OPPORTUNITY_BEACON_TEMPLATES.length === 0) return null;
  const tpl = OPPORTUNITY_BEACON_TEMPLATES[
    deriveSeed(seed, SALT, tick, 900000 + i * 4 + 1) % OPPORTUNITY_BEACON_TEMPLATES.length
  ];
  const sysKey = sysKeys[deriveSeed(seed, SALT, tick, 900000 + i * 4 + 2) % sysKeys.length];
  const sys = world.entities.systems[sysKey];
  const systemName = (sys && sys.name) ? sys.name : `星系 ${sysKey}`;
  const owner = sys && sys.ownerFactionId && world.entities.factions[sys.ownerFactionId];
  const factionName = (owner && owner.name) || '自治殖民地';

  return {
    id: world.spaceOperaState.nextSubspaceBeaconId++,
    freqClass: OPPORTUNITY_FREQ_CLASS,
    systemId: sysKey,
    text: fillText(`${tpl.title}：${tpl.body}`, systemName, factionName),
    spawnedTick: tick,
    expiresTick: tick + BEACON_OPPORTUNITY_LIFETIME_TICKS,
    kind: 'OPPORTUNITY',
    templateId: tpl.templateId,
    responseOptions: tpl.responseOptions.map((o) => ({ ...o })),
  };
}

/* ============================== 每帧步进（密度铁律） ============================== */

/**
 * 信标流每 tick 步进（registerHourly 'space-opera-beacon-stream' 注册形态）：
 *  1. 首行守卫 world.spaceOperaState（金快照世界零读取零写入）；
 *  2. 过期清除（expiresTick ≤ world.tick，帝国官方信标同规则老化）；
 *  3. 密度铁律：kind==='NARRATIVE' 活跃数 < 15 → 确定性补足到 15。
 *
 * @returns {{activeBeacons: number, narrativeBeacons: number, expired: number, filled: number}}
 */
export function stepBeaconStream(world) {
  if (!world || !world.spaceOperaState) {
    return { activeBeacons: 0, narrativeBeacons: 0, expired: 0, filled: 0 };
  }
  const soState = world.spaceOperaState;
  if (!Array.isArray(soState.subspaceBeacons)) soState.subspaceBeacons = [];
  if (!Number.isFinite(soState.nextSubspaceBeaconId)) soState.nextSubspaceBeaconId = 1;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;

  // —— 1) 过期清除（保留顺序遍历，确定性）——
  let expired = 0;
  const kept = [];
  for (let i = 0; i < soState.subspaceBeacons.length; i++) {
    const b = soState.subspaceBeacons[i];
    if (b && Number.isFinite(b.expiresTick) && b.expiresTick <= tick) {
      expired++;
      continue;
    }
    kept.push(b);
  }
  soState.subspaceBeacons = kept;

  // —— 2) 密度铁律补足（确定性派生；每次生成消费独立 idx 防同帧串流）——
  let filled = 0;
  for (let idx = 0; idx < MAX_FILL_PER_STEP; idx++) {
    if (countActiveNarrative(world) >= BEACON_MIN_NARRATIVE) break;
    if (soState.subspaceBeacons.length >= BEACON_MAX_TOTAL) break;
    const beacon = spawnNarrativeBeacon(world, tick, idx);
    if (beacon) {
      soState.subspaceBeacons.push(beacon);
      filled++;
    }
  }

  return {
    activeBeacons: soState.subspaceBeacons.length,
    narrativeBeacons: countActiveNarrative(world),
    expired,
    filled,
  };
}

// —— 时钟阶段注册已收拢至 src/simulation/SpaceOperaWiring.js（SPEC-PLAN-049 §Task 49.3
//    唯一注册点：registerHourly('space-opera-beacon-stream', …)）。原 import 期副作用注册
//    拆除，消除模块图求值顺序对注册序的脆弱依赖；stepBeaconStream 首行自守卫
//    world.spaceOperaState（金快照世界零读取零写入）。——

/* ============================== 机遇信标投放（高潮宣泄入口） ============================== */

/**
 * 注入 n 个机遇信标（OPPORTUNITY_BEACON；戏剧导演 catharsis +18 的唯一投放口）。
 * 守卫式读取：容器未挂载（金快照世界）返回 0，绝不 ensure（零漂移铁律）。
 *
 * @param {object} world - 世界根对象
 * @param {number} n - 注入数量（非有限/负数按 0；上限单次 36 护栏）
 * @returns {number} 实际注入条数
 */
export function injectOpportunityBeacons(world, n) {
  if (!world || !world.spaceOperaState) return 0;
  const soState = world.spaceOperaState;
  if (!Array.isArray(soState.subspaceBeacons)) soState.subspaceBeacons = [];
  if (!Number.isFinite(soState.nextSubspaceBeaconId)) soState.nextSubspaceBeaconId = 1;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const want = Number.isFinite(n) ? Math.max(0, Math.min(36, Math.trunc(n))) : 0;
  let injected = 0;
  for (let i = 0; i < want; i++) {
    if (soState.subspaceBeacons.length >= BEACON_MAX_TOTAL) break;
    const beacon = spawnOpportunityBeacon(world, tick, i);
    if (beacon) {
      soState.subspaceBeacons.push(beacon);
      injected++;
    }
  }
  if (injected > 0) {
    emit(world, 'OpportunityBeaconsInjected', {
      count: injected,
      tick,
    }, 'world');
  }
  return injected;
}

/* ============================== 信标响应（RespondSubspaceBeacon 领域落点） ============================== */

/** 玩家派系 ID（信标响应奖励入账权威；未定义抛 SO 由命令总线回滚） */
function playerFaction(world) {
  const pf = world && world.playerFactionId;
  if (!pf) throw new Error('SO: 信标响应需要已定义的玩家派系（world.playerFactionId）');
  return pf;
}

/** TEMP_BUFF / 携带 unityGrant 的复合效果入账 */
function applyTempBuff(world, soState, tick, effect, result) {
  soState.beaconJournalBuff = {
    untilTick: tick + (Number.isFinite(effect.untilTicks) ? effect.untilTicks : 2160),
    happinessPct: Number.isFinite(effect.happinessPct) ? effect.happinessPct : 0,
    sourceBeaconId: result.beaconId,
  };
  if (Number.isFinite(effect.unityGrant) && effect.unityGrant > 0) {
    applyUnityGrant(world, soState, effect.unityGrant);
    result.unityGranted = effect.unityGrant;
  }
  result.buff = { untilTick: soState.beaconJournalBuff.untilTick, happinessPct: soState.beaconJournalBuff.happinessPct };
}

/** 凝聚力入账（spaceOperaState.unityTreasury；权威 API 为 galacticSenateAndCrisisArc.grantUnity） */
function applyUnityGrant(world, soState, amount) {
  if (!Number.isFinite(soState.unityTreasury)) soState.unityTreasury = 0;
  soState.unityTreasury += amount;
}

/** 难民入殖：首个玩家殖民地 popTotal 增员；无殖民地 → 折算资源入账 */
function applyRefugeePop(world, soState, tick, effect, result) {
  const pf = playerFaction(world);
  const planets = world.entities && world.entities.planets ? world.entities.planets : {};
  const keys = Object.keys(planets).sort();
  for (const key of keys) {
    const planet = planets[key];
    const colony = planet && planet.compactState && planet.compactState.colony;
    if (!colony) continue;
    const same = colony.ownerId === pf || String(colony.ownerId) === String(pf);
    if (!same) continue;
    colony.popTotal = (Number.isFinite(colony.popTotal) ? colony.popTotal : 0)
      + (Number.isFinite(effect.amount) ? effect.amount : 1);
    result.refugeePlanetId = planet.id;
    return;
  }
  // 无玩家殖民地 → 确定性折算：默认食物 +50
  const resId = effect.fallbackResId || 'food';
  const amount = Number.isFinite(effect.fallbackAmount) ? effect.fallbackAmount : 50;
  if (world.economy) {
    credit(world, pf, resId, amount, 'beaconRefugeeFallback', result.beaconId);
  }
  result.fallbackCredit = { resId, amount };
}

/**
 * 响应子空间信标（RespondSubspaceBeacon 命令领域落点；M3 编排层注入 handler）。
 * 效果按机读 effect 分派（CREDIT / TEMP_BUFF / BLACK_MARKET_WINDOW / UNITY_GRANT /
 * REFUGEE_POP）；响应后信标从流中移除，结果写入 soState.lastBeaconResponse
 * （命令总线 execute 返回值不透传契约 → 套件从世界态断言）。
 *
 * 业务失败（信标不存在 / 选项不存在 / 无玩家派系）抛 Error('SO:…') → 总线回滚。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} beaconId - 信标 ID
 * @param {string} responseOptionId - 响应选项 ID
 * @returns {object} 响应结果（同时落 soState.lastBeaconResponse）
 */
export function respondSubspaceBeacon(world, beaconId, responseOptionId) {
  if (!world || !world.spaceOperaState) throw new Error('SO: 信标流容器未挂载（须先 ensureSpaceOperaState）');
  const soState = world.spaceOperaState;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;

  const beacon = listActiveBeacons(world).find((b) => b && (b.id === beaconId || String(b.id) === String(beaconId)));
  if (!beacon) throw new Error(`SO: 信标不存在或已过期 ${String(beaconId)}`);
  const option = (beacon.responseOptions || []).find((o) => o && o.id === responseOptionId);
  if (!option) {
    throw new Error(`SO: 信标 ${String(beacon.id)} 无响应选项 ${String(responseOptionId)}`);
  }

  const result = {
    beaconId: beacon.id,
    templateId: beacon.templateId || null,
    responseOptionId,
    effectApplied: false,
    tick,
  };

  const effect = option.effect;
  if (effect && typeof effect === 'object') {
    switch (effect.kind) {
      case 'CREDIT': {
        const pf = playerFaction(world);
        credit(world, pf, effect.resId, effect.amount, 'beaconResponse', beacon.id);
        result.credited = { resId: effect.resId, amount: effect.amount };
        result.effectApplied = true;
        break;
      }
      case 'TEMP_BUFF':
        applyTempBuff(world, soState, tick, effect, result);
        result.effectApplied = true;
        break;
      case 'BLACK_MARKET_WINDOW': {
        const bm = ensureBlackMarket(world, beacon.systemId);
        if (bm) {
          bm.unlocked = true; // 合约成立 → 该星系黑市交易窗口开启
          bm.stock[effect.contrabandId] = (bm.stock[effect.contrabandId] || 0)
            + (Number.isFinite(effect.qty) ? effect.qty : 0);
          result.blackMarket = { systemId: beacon.systemId, contrabandId: effect.contrabandId, qty: effect.qty };
          result.effectApplied = true;
        } else {
          // 目标星系无市场结构 → 确定性折算情报报酬（合约情报兜底）
          const pf = playerFaction(world);
          credit(world, pf, 'intelPoints', 8, 'beaconContractFallback', beacon.id);
          result.fallbackCredit = { resId: 'intelPoints', amount: 8 };
          result.effectApplied = true;
        }
        break;
      }
      case 'UNITY_GRANT':
        applyUnityGrant(world, soState, effect.amount);
        result.unityGranted = effect.amount;
        result.effectApplied = true;
        break;
      case 'REFUGEE_POP':
        applyRefugeePop(world, soState, tick, effect, result);
        result.effectApplied = true;
        break;
      default:
        break; // 未知 effect kind → 仅移除信标（零副作用）
    }
  }

  // —— 响应即消费：从流中移除（密度铁律由下一帧步进自动补足）——
  soState.subspaceBeacons = soState.subspaceBeacons.filter((b) => b !== beacon);
  soState.lastBeaconResponse = result;
  emit(world, 'SubspaceBeaconResponded', {
    beaconId: beacon.id,
    templateId: beacon.templateId,
    freqClass: beacon.freqClass,
    responseOptionId,
    effectApplied: result.effectApplied,
  }, 'world');
  return result;
}

/**
 * 活跃临时增益查询（集成层幸福度/士气结算消费；只读，未激活返回 null）。
 */
export function activeJournalBuff(world) {
  const soState = world && world.spaceOperaState;
  if (!soState || !soState.beaconJournalBuff) return null;
  const buff = soState.beaconJournalBuff;
  const tick = Number.isFinite(world.tick) ? world.tick : 0;
  if (!(Number.isFinite(buff.untilTick) && tick < buff.untilTick)) return null;
  return buff;
}
