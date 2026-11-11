/**
 * domain/economy/blackMarket.js — 动态黑市、屏蔽走私与私掠赏金（doc35 WP-P1-1）
 *
 * 数学模型（doc35 §2.3.1）：
 *   P_bm(r) = P_market(r) × (1 + Tariff×1.8 + max(0, 1−Stability))
 *   P_bust  = clamp( max(0, Q_contra − C_shield)/(Q_contra+1) × SecurityLevel × (1+Suspicion), 0, 0.95 )
 *   EV      = P_bm·(1−P_bust)·Q − P_buy·Q − Fine·P_bust·Q
 * 查获判定走 mix32(SALT_BLACK_MARKET) 确定性子流——零 Math.random、零 world.rng。
 *
 * 惰性挂载纪律：market.blackMarket / world.economy.bounties / fleet 旗标
 * 仅在首次 v2 经济命令（ToggleTransponder / TradeBlackMarket / IssueLetterOfMarque）
 * 时创建 → 金快照 4320 tick 窗口字节零漂移。
 */

import { mix32, SALT_BLACK_MARKET } from '../ground/planetSeeds.js';
import { hash32 } from '../ground/SurfaceSandbox.js';
import { clamp } from '../../core/math.js';
import { credit, debit, balance, FLOW } from './ledger.js';
import { price } from './market.js';
import { emit, chronicle } from '../../core/eventBus.js';

/** 四大违禁科技品（doc35 §2.3.2；与 content/resources.js 的定义 id 对齐） */
export const CONTRABAND_IDS = ['contra_ai_core', 'contra_neuro_stim', 'contra_xeno_serum', 'contra_heavy_arms'];
/** 违禁溢价乘数 1.0–1.8（doc34 §4.2.1 κ 系数） */
export const CONTRABAND_MULT = {
  contra_ai_core: 1.8,
  contra_neuro_stim: 1.2,
  contra_xeno_serum: 1.55,
  contra_heavy_arms: 1.4,
};
/** 查获罚金倍率（对货值的倍数，doc34 §4.2.1） */
export const BUST_FINE_MULT = 2.0;

/** 星系黑市结构惰性创建（挂 world.economy.markets[sysId].blackMarket） */
export function ensureBlackMarket(world, systemId) {
  const m = world.economy.markets[systemId];
  if (!m) return null;
  if (!m.blackMarket) {
    m.blackMarket = {
      unlocked: true,       // 高关税/禁运/低安定星系自发生成（doc35 GATE-12 ECON-BM-01）
      stock: {},
      price: {},
      suspicion: 0,         // 玩家在本星系累积嫌疑度 0..100，每日自然衰减 2
    };
  }
  return m.blackMarket;
}

/** 黑市单价（doc35 §2.3.1 方程；无市场结构时回退基础价 × 溢价下限） */
export function blackMarketPrice(world, systemId, resId, tariffRate = 0.25, stability = 0.5) {
  const def = world.contrabandDefs?.[resId];
  const base = price(world, systemId, resId) || def?.basePrice || 100;
  const kappa = CONTRABAND_MULT[resId] ?? 1.0;
  const premium = 1.0 + tariffRate * 1.8 + Math.max(0, 1.0 - stability);
  return Math.round(base * premium * kappa * 100) / 100;
}

/**
 * 查获概率（doc35 §2.3.1 方程）。
 * 屏蔽货舱容量内的违禁品恒不参与罚没计算（Q_contra ≤ C_shield → P_bust = 0）。
 * @param {{contraQty:number, shieldedCargo:number, securityLevel:number, suspicion:number}} arg
 */
export function bustProbability({ contraQty, shieldedCargo, securityLevel, suspicion }) {
  const exposed = Math.max(0, contraQty - (shieldedCargo || 0));
  if (exposed <= 0) return 0; // 100% 完美偷运
  return clamp((exposed / (contraQty + 1)) * (securityLevel || 0) * (1 + (suspicion || 0) / 100), 0, 0.95);
}

/** 走私期望净收益（EV；遥测/军师面板用，非结算路径） */
export function smugglingEV({ unitPrice, qty, bustProb, fineMult = BUST_FINE_MULT, buyCost = 0 }) {
  const gross = unitPrice * qty * (1 - bustProb);
  const fine = unitPrice * qty * fineMult * bustProb;
  return gross - buyCost - fine;
}

/** 确定性查获判定（同一 (seed, sysId, tick, qty) 恒定） */
export function deterministicBust(world, systemId, tick, contraQty) {
  const h = mix32((world.seed >>> 0) ^ hash32(`bust:${systemId}`) ^ Math.imul(tick | 0, 0x85ebca77) ^ (contraQty | 0) ^ SALT_BLACK_MARKET);
  return (h % 10000) / 10000;
}

/** 舰队屏蔽货舱容量（mod_cargo_shielded 的 stats.shieldedCargo 聚合） */
export function fleetShieldedCargo(world, fleet) {
  let cap = 0;
  for (const sid of fleet?.shipIds || []) {
    const ship = world.entities.ships[sid];
    if (ship && ship.status === 'active') cap += ship.stats?.shieldedCargo || 0;
  }
  return cap;
}

/**
 * 黑市交易（TradeBlackMarket 命令执行体）。
 * side='sell'：舰队货舱违禁品 → 黑市；side='buy'：黑市 → 货舱。
 * @returns {{ok:boolean, reason?:string, gained?:number, busted?:boolean, fine?:number}}
 */
export function tradeBlackMarket(world, factionId, systemId, resId, qty, side, fleetId = null) {
  const bm = ensureBlackMarket(world, systemId);
  if (!bm || !bm.unlocked) return { ok: false, reason: '该星系未解锁黑市' };
  if (!CONTRABAND_IDS.includes(resId) && !(bm.stock[resId] > 0)) return { ok: false, reason: '黑市不收售该物资' };
  const m = world.economy.markets[systemId];
  const tariff = m?.tariffRate ?? 0.25;
  const stability = m?.riskFactor != null ? clamp(1 - m.riskFactor / 100, 0, 1) : 0.5;
  const unit = blackMarketPrice(world, systemId, resId, tariff, stability);
  const fleet = fleetId ? world.entities.fleets[fleetId] : null;

  if (side === 'sell') {
    const held = fleet ? fleetCargoCount(world, fleet, resId) : 0;
    const sellQty = Math.min(qty, held);
    if (sellQty <= 0) return { ok: false, reason: '舰队货舱无该违禁品' };
    const shieldCap = fleetShieldedCargo(world, fleet);
    const security = m?.patrolStrength ?? 45;
    const pBust = bustProbability({ contraQty: sellQty, shieldedCargo: shieldCap, securityLevel: security / 100, suspicion: bm.suspicion });
    const bust = deterministicBust(world, systemId, world.tick, sellQty) < pBust;
    if (bust) {
      const fine = Math.round(unit * sellQty * BUST_FINE_MULT);
      debit(world, factionId, 'credits', Math.min(fine, balance(world, factionId, 'credits')), 'smuggleBust', systemId, FLOW.SMUGGLE);
      removeCargo(world, fleet, resId, sellQty); // 货物罚没
      bm.suspicion = Math.min(100, bm.suspicion + 15);
      emit(world, 'SmuggleBusted', { systemId, factionId, resId, qty: sellQty, fine }, 'economy');
      return { ok: true, busted: true, fine, lost: sellQty };
    }
    removeCargo(world, fleet, resId, sellQty);
    const gain = Math.floor(unit * sellQty);
    credit(world, factionId, 'credits', gain, `smuggle:${resId}`, systemId, FLOW.SMUGGLE);
    bm.suspicion = Math.min(100, bm.suspicion + 4);
    emit(world, 'SmuggleTraded', { systemId, factionId, resId, qty: sellQty, gained: gain }, 'economy');
    return { ok: true, gained: gain, unitPrice: unit, bustProb: pBust };
  }
  // buy：黑市库存 → 货舱
  const stock = bm.stock[resId] || 0;
  const buyQty = Math.min(qty, stock);
  if (buyQty <= 0) return { ok: false, reason: '黑市无货' };
  const cost = Math.ceil(unit * buyQty);
  if (balance(world, factionId, 'credits') < cost) return { ok: false, reason: '信用点不足' };
  debit(world, factionId, 'credits', cost, `bmBuy:${resId}`, systemId, FLOW.CONSUME);
  bm.stock[resId] -= buyQty;
  if (fleet) addCargo(world, fleet, resId, buyQty);
  emit(world, 'BlackMarketBought', { systemId, factionId, resId, qty: buyQty, cost }, 'economy');
  return { ok: true, cost, qty: buyQty, unitPrice: unit };
}

/** 舰队货舱违禁品计数（fleet.shipIds 聚合；sell 口径） */
export function fleetCargoCount(world, fleet, resId) {
  let n = 0;
  for (const sid of fleet?.shipIds || []) {
    const ship = world.entities.ships[sid];
    if (ship) n += ship.cargo?.[resId] || 0;
  }
  return n;
}

function removeCargo(world, fleet, resId, qty) {
  let remain = qty;
  for (const sid of fleet?.shipIds || []) {
    if (remain <= 0) break;
    const ship = world.entities.ships[sid];
    const have = ship?.cargo?.[resId] || 0;
    if (have > 0) {
      const take = Math.min(have, remain);
      ship.cargo[resId] = have - take;
      remain -= take;
    }
  }
}

function addCargo(world, fleet, resId, qty) {
  for (const sid of fleet?.shipIds || []) {
    const ship = world.entities.ships[sid];
    if (!ship) continue;
    ship.cargo ||= {};
    ship.cargo[resId] = (ship.cargo[resId] || 0) + qty;
    return;
  }
}

/** 嫌疑度每日自然衰减（DailySystems 调用；仅遍历已生成黑市的星系） */
export function decayBlackMarketSuspicion(world) {
  for (const sysId of Object.keys(world.economy.markets).sort()) {
    const bm = world.economy.markets[sysId].blackMarket;
    if (bm && bm.suspicion > 0) bm.suspicion = Math.max(0, bm.suspicion - 2);
  }
}

// ———— 私掠许可证与赏金公会（doc35 §2.3.2） ————

/**
 * 私掠许可证签发（IssueLetterOfMarque 命令执行体；仅对处于战争状态的派系有效）。
 * world.economy.lettersOfMarque[factionId] = { targetFactionId, issuedTick, notorietyFreezeUntil }
 */
export function issueLetterOfMarque(world, issuerFactionId, targetFactionId) {
  const war = Object.values(world.entities.wars || {}).find((w) => w.status === 'active' &&
    ((w.attackers.includes(issuerFactionId) && w.defenders.includes(targetFactionId)) ||
     (w.attackers.includes(targetFactionId) && w.defenders.includes(issuerFactionId))));
  if (!war) return { ok: false, reason: '仅战时可签发私掠许可证' };
  world.economy.lettersOfMarque ||= {};
  world.economy.lettersOfMarque[issuerFactionId] = {
    targetFactionId,
    warId: war.id,
    issuedTick: world.tick,
    notorietyFreezeUntil: world.tick + 180 * 24, // 180 日豁免
  };
  emit(world, 'LetterOfMarqueIssued', { issuerFactionId, targetFactionId, warId: war.id }, 'economy');
  chronicle(world, 'economy', `私掠许可证签发：针对 ${(world.entities.factions[targetFactionId] || {}).name || targetFactionId} 的破交行动合法化`, { factionId: issuerFactionId });
  return { ok: true };
}

/** 恶名增长判定：持有效私掠证劫掠指定敌国 → 恶名零增长（doc35 GATE-12 ECON-MARQUE-04） */
export function raidNotorietyDelta(world, factionId, victimFactionId) {
  const marque = world.economy.lettersOfMarque?.[factionId];
  if (marque && marque.targetFactionId === victimFactionId && marque.notorietyFreezeUntil > world.tick) return 0;
  return 1;
}

/**
 * 私掠赏金结算（击沉敌舰/截获物资时调用）：发证国账本自动支取分成赏金（FLOW.BOUNTY）。
 */
export function payPrivateerBounty(world, factionId, targetFactionId, credits) {
  const marque = world.economy.lettersOfMarque?.[factionId];
  if (!marque || marque.targetFactionId !== targetFactionId || marque.notorietyFreezeUntil <= world.tick) return 0;
  const amount = Math.round(credits * 0.4); // 发证国支付 40% 战利品等值赏金
  if (amount <= 0) return 0;
  credit(world, factionId, 'credits', amount, `privateerBounty:${targetFactionId}`, marque.warId, FLOW.BOUNTY);
  return amount;
}
