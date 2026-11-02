/**
 * domain/economy/market.js — 区域市场与供需价格（任务书 4.5 / ECON-04）
 *
 * P = base × clamp(1 + α(D−S)/max(S,ε), minFactor, maxFactor)，每日平滑。
 * 市场挂在星系上；库存/需求由殖民地、船坞、贸易路线与事件驱动。
 */

import { BAL } from '../../content/constants.js';
import { tradeableResourceIds, resourceDef } from '../../content/resources.js';
import { clamp, lerp } from '../../core/math.js';
import { emit } from '../../core/eventBus.js';

/** 确保星系市场存在 */
export function ensureMarket(world, systemId) {
  let m = world.economy.markets[systemId];
  if (!m) {
    const stock = {};
    const demand = {};
    const price = {};
    for (const rid of tradeableResourceIds()) {
      stock[rid] = Math.round(resourceDef(rid).basePrice * BAL.economy.marketBaseStockDays / 4);
      demand[rid] = 0;
      price[rid] = resourceDef(rid).basePrice;
    }
    m = { systemId, stock, demand, price, embargo: {}, riskFactor: 0 };
    world.economy.markets[systemId] = m;
  }
  return m;
}

/** 当前价格 */
export function price(world, systemId, resId) {
  const m = world.economy.markets[systemId];
  if (!m) return resourceDef(resId).basePrice;
  return m.price[resId] ?? resourceDef(resId).basePrice;
}

/** 每日价格更新（DailySystems 调用） */
export function updateMarketPrices(world) {
  for (const systemId of Object.keys(world.economy.markets).sort()) {
    const m = world.economy.markets[systemId];
    for (const rid of tradeableResourceIds()) {
      const def = resourceDef(rid);
      const s = Math.max(0, m.stock[rid]);
      const d = Math.max(0, m.demand[rid]);
      const ratio = (d - s) / Math.max(s, 25);
      const raw = 1 + BAL.economy.priceAlpha * ratio;
      const target = def.basePrice * clamp(raw, BAL.economy.priceMinFactor, BAL.economy.priceMaxFactor);
      m.price[rid] = Math.round(lerp(m.price[rid], target, BAL.economy.priceSmooth) * 100) / 100;
    }
    // 需求每日衰减（需求由当日活动重新注入）
    for (const rid of tradeableResourceIds()) {
      m.demand[rid] = Math.round(m.demand[rid] * 0.6);
    }
  }
}

/** 市场挂单需求注入（殖民地/船坞缺料时由其逻辑调用） */
export function addDemand(world, systemId, resId, amount) {
  const m = ensureMarket(world, systemId);
  m.demand[resId] = (m.demand[resId] || 0) + Math.max(0, Math.round(amount));
}

/**
 * 玩家/AI 市场买入：花 credits，取库存。
 * 返回 { ok, reason, spent, got }
 */
export function marketBuy(world, factionId, systemId, resId, amount, ledgerApi) {
  const m = ensureMarket(world, systemId);
  const qty = Math.min(amount, Math.floor(m.stock[resId] || 0));
  if (qty <= 0) return { ok: false, reason: '市场无货' };
  const embargo = m.embargo[factionId];
  if (embargo) return { ok: false, reason: '禁运中' };
  const unit = marketUnitPrice(m, resId, qty, 'buy');
  const cost = Math.ceil(unit * qty);
  if (!ledgerApi.debit(world, factionId, 'credits', cost, `marketBuy:${resId}`, systemId)) {
    return { ok: false, reason: '信用点不足' };
  }
  m.stock[resId] -= qty;
  return { ok: true, spent: cost, got: qty, unitPrice: unit };
}

/** 市场卖出 */
export function marketSell(world, factionId, systemId, resId, amount, ledgerApi) {
  const m = ensureMarket(world, systemId);
  if (m.embargo[factionId]) return { ok: false, reason: '禁运中' };
  const qty = Math.max(0, Math.round(amount));
  if (qty <= 0) return { ok: false, reason: '数量无效' };
  const unit = marketUnitPrice(m, resId, qty, 'sell');
  const gain = Math.floor(unit * qty);
  m.stock[resId] += qty;
  ledgerApi.credit(world, factionId, 'credits', gain, `marketSell:${resId}`, systemId);
  return { ok: true, gained: gain, unitPrice: unit };
}

/** 单价（买入贵 / 卖出贱 的价差模型） */
export function marketUnitPrice(m, resId, qty, side) {
  const p = m.price[resId] ?? resourceDef(resId).basePrice;
  const impact = 1 + clamp(qty / Math.max(200, (m.stock[resId] || 0) + qty), 0, 0.25) * (side === 'buy' ? 0.2 : -0.15);
  return Math.max(0.1, Math.round(p * impact * 100) / 100);
}

/** 禁运（外交命令调用） */
export function setEmbargo(world, systemId, factionId, on) {
  const m = ensureMarket(world, systemId);
  if (on) m.embargo[factionId] = true;
  else delete m.embargo[factionId];
  emit(world, 'EmbargoChanged', { systemId, factionId, on }, 'economy');
}

/** 贸易路线执行：把货物从殖民地搬到目标市场（由 convoy 逻辑每小时调用） */
export function deliverToMarket(world, systemId, resId, qty) {
  const m = ensureMarket(world, systemId);
  m.stock[resId] = (m.stock[resId] || 0) + qty;
}

export function takeFromMarket(world, systemId, resId, qty) {
  const m = ensureMarket(world, systemId);
  const take = Math.min(qty, Math.floor(m.stock[resId] || 0));
  m.stock[resId] -= take;
  return take;
}
