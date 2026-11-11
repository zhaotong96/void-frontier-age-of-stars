/**
 * domain/economy/ledger.js — 统一经济账本（任务书 4.4 / ECON-01/02）
 *
 * 账本等式：S_{t+1} = S_t + P + I + L - C - E - D
 * （生产/进口/战利品转入；消耗/出口/损耗转出）
 * 每笔流量必须带 reason 与 sourceId，可审计追溯。
 * 库存使用安全整数；严禁负库存（违者抛出 —— RISK-15）。
 */

import { emit } from '../../core/eventBus.js';
import { safeInt } from '../../core/math.js';

/** 流量类别（写入 daily 流水的键；doc35 WP-P1-1 扩展 SMUGGLE/BOUNTY 为惰性键——
 *  ensureDaily 默认形状不变，仅实际发生该流水的世界才写入新键 → 金快照零漂移） */
export const FLOW = {
  PRODUCE: 'produced',
  CONSUME: 'consumed',
  IMPORT: 'imported',
  EXPORT: 'exported',
  LOOT: 'loot',
  DECAY: 'decay',
  TRANSFER: 'transfer', // 阵营/殖民地间划拨
  TAX: 'tax',
  SMUGGLE: 'smuggled',  // 黑市走私流水（doc35 WP-P1-1）
  BOUNTY: 'bounty',     // 私掠赏金流水（doc35 WP-P1-1）
};

/** 确保阵营账本存在 */
export function ensureLedger(world, factionId) {
  let led = world.economy.ledgers[factionId];
  if (!led) {
    led = { balances: {} };
    world.economy.ledgers[factionId] = led;
  }
  if (!world.economy.daily[factionId]) world.economy.daily[factionId] = {};
  return led;
}

function ensureDaily(world, factionId, resId) {
  const d = world.economy.daily[factionId];
  if (!d[resId]) d[resId] = { produced: 0, consumed: 0, imported: 0, exported: 0, loot: 0, decay: 0, transfer: 0, tax: 0 };
  return d[resId];
}

/** 读取余额 */
export function balance(world, factionId, resId) {
  return world.economy.ledgers[factionId]?.balances[resId] ?? 0;
}

/** 记一笔流水（内部） */
function record(world, factionId, resId, flow, delta, reason, sourceId) {
  const slot = ensureDaily(world, factionId, resId);
  slot[flow] = (slot[flow] || 0) + delta; // doc35 惰性流键（SMUGGLE/BOUNTY）NaN 防护

  world.economy.transactions.push({
    tick: world.tick,
    factionId,
    resId,
    flow,
    delta,
    reason: reason || '',
    sourceId: sourceId || null,
  });
  const cap = 400;
  if (world.economy.transactions.length > cap) {
    world.economy.transactions.splice(0, world.economy.transactions.length - cap);
  }
}

/** 入账：增加库存 */
export function credit(world, factionId, resId, amount, reason, sourceId, flow = FLOW.PRODUCE) {
  const amt = safeInt(amount, 0);
  if (amt <= 0) return;
  const led = ensureLedger(world, factionId);
  led.balances[resId] = (led.balances[resId] ?? 0) + amt;
  record(world, factionId, resId, flow, amt, reason, sourceId);
}

/** 出账：减少库存。不足时整体失败（返回 false），绝不产生负库存（ECON-02） */
export function debit(world, factionId, resId, amount, reason, sourceId, flow = FLOW.CONSUME) {
  const amt = safeInt(amount, 0);
  if (amt <= 0) return true;
  const led = ensureLedger(world, factionId);
  const cur = led.balances[resId] ?? 0;
  if (cur < amt) return false;
  led.balances[resId] = cur - amt;
  record(world, factionId, resId, flow, -amt, reason, sourceId);
  return true;
}

/** 批量出账：全部满足才扣（命令事务的原子支付原语） */
export function canAfford(world, factionId, costs) {
  for (const resId of Object.keys(costs)) {
    if (balance(world, factionId, resId) < costs[resId]) return false;
  }
  return true;
}

export function pay(world, factionId, costs, reason, sourceId) {
  if (!canAfford(world, factionId, costs)) return false;
  for (const resId of Object.keys(costs)) {
    debit(world, factionId, resId, costs[resId], reason, sourceId, FLOW.CONSUME);
  }
  return true;
}

export function refund(world, factionId, costs, reason, sourceId) {
  for (const resId of Object.keys(costs)) {
    credit(world, factionId, resId, costs[resId], reason, sourceId, FLOW.TRANSFER);
  }
}

/** 阵营→阵营转移（贸易、赔款、礼物；双向记账） */
export function transferBetween(world, fromFaction, toFaction, resId, amount, reason) {
  if (!debit(world, fromFaction, resId, amount, reason, toFaction, FLOW.EXPORT)) return false;
  credit(world, toFaction, resId, amount, reason, fromFaction, FLOW.IMPORT);
  return true;
}

/** 日结：汇总当日流量、重置日累计（由 DailySystems 调用） */
export function closeDailyLedgers(world) {
  const out = {};
  for (const fid of Object.keys(world.economy.daily).sort()) {
    out[fid] = world.economy.daily[fid];
    world.economy.daily[fid] = {};
  }
  return out; // 上一日流水（市场/统计可用）
}

/** 账本守恒校验（ECON-01：期末库存与流量等式一致） */
export function verifyLedgerConsistency(world, factionId, openingBalances, dayFlow) {
  const problems = [];
  const resIds = new Set([
    ...Object.keys(openingBalances || {}),
    ...Object.keys(dayFlow || {}),
    ...Object.keys(world.economy.ledgers[factionId]?.balances || {}),
  ]);
  for (const resId of resIds) {
    const open = openingBalances?.[resId] ?? 0;
    const f = dayFlow?.[resId] || {};
    // doc35 WP-P1-1：SMUGGLE/BOUNTY 为入账流（惰性键——未发生该流水的世界与旧口径逐位一致）
    const expected = open +
      (f.produced || 0) + (f.imported || 0) + (f.loot || 0) + (f.transfer || 0) + (f.tax || 0) +
      (f.smuggled || 0) + (f.bounty || 0) -
      ((f.consumed || 0) + (f.exported || 0) + (f.decay || 0));
    const actual = world.economy.ledgers[factionId]?.balances[resId] ?? 0;
    if (expected !== actual) {
      problems.push(`${resId}: 账本不平 ${actual} ≠ 期望 ${expected}`);
    }
  }
  return problems;
}

/** 资源损耗（decayRule，每日） */
export function applyDecay(world, factionId, resIds, decayRules) {
  for (const resId of resIds) {
    const rule = decayRules[resId];
    if (!rule || rule.perDayPct <= 0) continue;
    const cur = balance(world, factionId, resId);
    if (cur <= 0) continue;
    const loss = Math.max(0, Math.min(cur, Math.round(cur * rule.perDayPct / 100)));
    if (loss > 0) {
      debit(world, factionId, resId, loss, 'decay', null, FLOW.DECAY);
    }
  }
}

/** 税收（殖民地→阵营，源自殖民模块；doc21 WP-2.4 繁荣度平方级税基增幅挂钩） */
export function collectTax(world, colony, amount, reason = 'tax') {
  let effective = amount;
  const planet = world.entities && world.entities.planets ? world.entities.planets[colony.planetId] : null;
  if (planet && planet.soc && planet.soc.v === 1) {
    // 聚落繁荣度 TaxBonus = baseTax × (1 + (Φ/100)² × 1.5)，叠加法典/总督税基修正
    const phi = Math.max(0, Math.min(100, planet.soc.prosperity)) / 100;
    let mult = 1.0 + phi * phi * 1.5;
    for (const eid of planet.soc.edicts || []) {
      const ed = COLONY_EDICT_TAX_MULT[eid];
      if (ed) mult *= ed;
    }
    const soc = planet.soc;
    const overseer = soc.overseerId && world.entities.characters
      ? world.entities.characters[soc.overseerId] : null;
    if (overseer && Array.isArray(overseer.traits) && overseer.traits.includes('mercantile')) mult *= 1.25;
    effective = amount * mult;
  }
  const ok = debitColony(world, colony, 'credits', Math.round(effective), reason);
  if (ok) credit(world, colony.factionId, 'credits', Math.round(effective), reason, colony.id, FLOW.TAX);
  return ok;
}

/** doc21：法典税基修正速查（与 colonyGovernance.COLONY_EDICTS 同源常量） */
const COLONY_EDICT_TAX_MULT = { edict_quarantine_martial: 0.70 };

// —— 殖民地库存（行星级仓储，与阵营账本分离但可互转） ——

export function colonyStock(world, colony, resId) {
  return colony.stockpile?.[resId] ?? 0;
}

export function creditColony(world, colony, resId, amount, reason, sourceId) {
  const amt = safeInt(amount, 0);
  if (amt <= 0) return;
  colony.stockpile ||= {};
  colony.stockpile[resId] = (colony.stockpile[resId] ?? 0) + amt;
  recordColony(world, colony, resId, FLOW.PRODUCE, amt, reason, sourceId);
}

export function debitColony(world, colony, resId, amount, reason, sourceId) {
  const amt = safeInt(amount, 0);
  if (amt <= 0) return true;
  const cur = colony.stockpile?.[resId] ?? 0;
  if (cur < amt) return false;
  colony.stockpile[resId] = cur - amt;
  recordColony(world, colony, resId, FLOW.CONSUME, -amt, reason, sourceId);
  return true;
}

function recordColony(world, colony, resId, flow, delta, reason, sourceId) {
  colony.ledger ||= {};
  colony.ledger[resId] ||= { produced: 0, consumed: 0, transfer: 0, exported: 0, imported: 0 };
  const l = colony.ledger[resId];
  if (flow === FLOW.PRODUCE) l.produced += delta;
  else if (flow === FLOW.CONSUME) l.consumed += -delta;
  else l.transfer += delta;
  if (colony.ledgerTickCap === undefined) colony.ledgerTickCap = world.tick;
  // 殖民地账本按日清理由 DailySystems 执行；这里只累加
}

/** 殖民地→阵营 上缴（ minerals 等；阵营库存 +，殖民地 -） */
export function colonyToFaction(world, colony, resId, amount, reason) {
  if (!debitColony(world, colony, resId, amount, reason, colony.factionId)) return false;
  credit(world, colony.factionId, resId, amount, reason, colony.id, FLOW.IMPORT);
  return true;
}

export function factionToColony(world, colony, resId, amount, reason) {
  if (!debit(world, colony.factionId, resId, amount, reason, colony.id, FLOW.EXPORT)) return false;
  creditColony(world, colony, resId, amount, reason, colony.factionId);
  return true;
}

/** 短缺告警（COL-03：断供后果由殖民系统触发事件） */
export function shortageEvent(world, colony, resId) {
  emit(world, 'ColonyShortage', { colonyId: colony.id, resId }, 'colony');
}
