/**
 * domain/economy/colonyTrade.js — 殖民地商业闭环（任务书 4.5 / ECON-05）
 *
 * 每日：殖民地把盈余资源按限价自动出售给本星系市场 → 换取信用点；
 * 按税率把信用点上缴阵营（账本可审计：marketSell / tax 流水分立）。
 * 这是"生产 → 市场 → 财政"主循环的核心，没有它经济就是死水。
 */

import { ensureMarket, marketUnitPrice } from './market.js';
import { tradeableResourceIds, resourceDef } from '../../content/resources.js';
import { BAL } from '../../content/constants.js';
import { emit } from '../../core/eventBus.js';
import { safeDivide, clamp } from '../../core/math.js';

/** 各类资源的殖民地保留库存（低于该值不出售） */
const RESERVE = {
  food: 80,
  water: 60,
  ferro: 40,
  silicate: 40,
  rareEarth: 10,
  heavyMetal: 10,
  hydrogen: 60,
  helium3: 20,
  alloy: 40,
  polymer: 20,
  medicine: 10,
  powerCell: 6,
};
const DEFAULT_RESERVE = 8;
const MAX_SELL_PER_DAY = 60; // 每资源每日自动出售上限（防市场冲击）

export function dailyColonyCommerce(world) {
  for (const cid of Object.keys(world.entities.colonies).sort()) {
    const colony = world.entities.colonies[cid];
    if (!colony.stockpile) continue;
    const systemId = colony.systemId;
    if (!systemId || !world.entities.systems[systemId]) continue;
    const market = ensureMarket(world, systemId);
    let grossIncome = 0;

    // 殖民补给线：食物/水低于生存线时用殖民地信用点自动从本星系市场购买
    for (const vitalId of ['food', 'water']) {
      const have = colony.stockpile[vitalId] ?? 0;
      const floor = vitalId === 'food' ? 40 : 30;
      if (have < floor && (colony.stockpile.credits ?? 0) > 120) {
        const want = Math.min(60, floor - have);
        const m = market;
        const stock = Math.floor(m.stock[vitalId] || 0);
        if (stock > 0) {
          const unit = marketUnitPrice(m, vitalId, want, 'buy') * 1.5; // 远征溢价
          const cost = Math.ceil(unit * want);
          if (cost <= (colony.stockpile.credits ?? 0)) {
            m.stock[vitalId] -= want;
            colony.stockpile.credits -= cost;
            colony.stockpile[vitalId] = have + want;
            colony.imports ||= {};
            colony.imports[vitalId] = (colony.imports[vitalId] || 0) + want;
          }
        }
      }
    }

    for (const rid of tradeableResourceIds()) {
      const have = colony.stockpile[rid] ?? 0;
      const reserve = RESERVE[rid] ?? DEFAULT_RESERVE;
      const surplus = have - reserve;
      if (surplus <= 0) continue;
      const qty = Math.min(surplus, MAX_SELL_PER_DAY);
      // 自动出售按市场价的 85%（散户折价；显式 MarketSell 命令全额）
      const unit = marketUnitPrice(market, rid, qty, 'sell') * 0.85;
      const gain = Math.max(1, Math.floor(unit * qty));
      colony.stockpile[rid] = have - qty;
      market.stock[rid] = (market.stock[rid] || 0) + qty;
      colony.stockpile.credits = (colony.stockpile.credits ?? 0) + gain;
      grossIncome += gain;
      colony.commerce ||= {};
      colony.commerce[rid] = (colony.commerce[rid] || 0) + gain;
    }

    // 需求注入：殖民地缺口转化为市场需求（影响价格，ECON-04）
    for (const [rid, reserve] of Object.entries(RESERVE)) {
      const have = colony.stockpile[rid] ?? 0;
      if (have < reserve * 0.5) {
        market.demand[rid] = (market.demand[rid] || 0) + Math.ceil(reserve * 0.2);
      }
    }

    // 税收上缴（税率受政策/文明修正）
    if (grossIncome > 0) {
      const rate = BAL.economy.taxRateColony * (colony.taxRateMult || 1);
      const tax = Math.floor(grossIncome * rate);
      if (tax > 0) {
        colony.stockpile.credits -= tax;
        const led = world.economy.ledgers[colony.factionId];
        if (led) {
          led.balances.credits = (led.balances.credits ?? 0) + tax;
          world.economy.transactions.push({
            tick: world.tick, factionId: colony.factionId, resId: 'credits',
            flow: 'tax', delta: tax, reason: `colonyTax:${colony.id}`, sourceId: colony.id,
          });
          if (world.economy.transactions.length > 400) {
            world.economy.transactions.splice(0, world.economy.transactions.length - 400);
          }
        }
        colony.taxPaidTotal = (colony.taxPaidTotal || 0) + tax;
      }
    }

    // 殖民地维护费（建筑 upkeep 从殖民地信用点扣，欠费降稳定度）
    let upkeep = 0;
    for (const b of colony.buildings || []) {
      const def = b.state === 'active' ? b : null;
      if (!def) continue;
      upkeep += 1; // 每活跃建筑 1 信用点/日 基础维护
    }
    if (upkeep > 0) {
      colony.stockpile.credits = Math.max(0, (colony.stockpile.credits ?? 0) - upkeep);
    }
  }
}

/** 市场对 AI/玩家的中立商队补充（月度）：基础库存回填 */
export function restockMarkets(world) {
  for (const systemId of Object.keys(world.economy.markets).sort()) {
    const m = world.economy.markets[systemId];
    for (const rid of tradeableResourceIds()) {
      const def = resourceDef(rid);
      const target = Math.round(def.basePrice * BAL.economy.marketBaseStockDays / 4);
      if ((m.stock[rid] || 0) < target) {
        m.stock[rid] = Math.min(target, (m.stock[rid] || 0) + Math.ceil(target * 0.1));
      }
    }
  }
}
