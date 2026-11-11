/**
 * domain/economy/tradeRoutes.js — 物理商队航线与破交断供传导（doc35 WP-P1-1）
 *
 * world.entities.tradeRoutes 此前为空预留集合（World.js:54）；本模块在
 * world.economy.tradeRoutesActive === true 时按确定性顺序生成跨星系航线，
 * 每战略日步进一支逻辑商队沿 shortestPath 航路移动；途经星系遭遇敌对舰队
 * （含持私掠证玩家）即被劫掠——货物入劫掠者货舱（FLOW.LOOT），目标星系
 * 市场库存扣减并注入双倍短缺需求，船坞造舰因缺料进入 stalled_shortage。
 *
 * 惰性挂载纪律：贸易航线激活由首个 v2 经济命令置位（doc35 §5.2 契约）
 * → 金快照 4320 tick 窗口字节零漂移。确定性：商队步进/劫掠判定零 RNG。
 */

import { mix32, SALT_BLACK_MARKET } from '../ground/planetSeeds.js';
import { hash32 } from '../ground/SurfaceSandbox.js';
import { credit, debit, FLOW } from './ledger.js';
import { addDemand, takeFromMarket } from './market.js';
import { createEntity } from '../entities/registry.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { areHostile } from '../combat/engagement.js';

/** 激活物理贸易航线（首个 v2 经济命令调用；幂等） */
export function activateTradeRoutes(world) {
  if (world.economy.tradeRoutesActive === true) return;
  world.economy.tradeRoutesActive = true;
  spawnInitialRoutes(world);
  emit(world, 'TradeRoutesActivated', { count: Object.keys(world.entities.tradeRoutes).length }, 'economy');
}

/** 工业物资航线池（承运类型与载量；doc34 §4.3 契约字段） */
const ROUTE_RES_POOL = ['alloy', 'conductor', 'composite', 'shipModule'];

/** 初始航线生成：各工业派系母星系 → 其船坞所在星系 / 相邻友方星系（确定性） */
function spawnInitialRoutes(world) {
  const byFaction = new Map();
  for (const s of Object.values(world.entities.systems)) {
    if (s.ownerFactionId && !byFaction.has(s.ownerFactionId)) byFaction.set(s.ownerFactionId, s.id);
  }
  let i = 0;
  for (const fid of [...byFaction.keys()].sort()) {
    const fromId = byFaction.get(fid);
    const sys = world.entities.systems[fromId];
    const lanes = (sys.lanes || []).map((l) => (typeof l === 'string' ? l : l.to)).filter(Boolean);
    const toId = lanes[0] || fromId;
    if (toId === fromId) continue;
    createEntity(world, 'tradeRoutes', {
      factionId: fid,
      fromSystemId: fromId,
      toSystemId: toId,
      path: [fromId, toId],
      currentLegIdx: 0,
      resId: ROUTE_RES_POOL[i % ROUTE_RES_POOL.length],
      qtyPerTrip: 40,
      escortPower: 120,
      status: 'in_transit',
      legProgressHours: 0,
    });
    i++;
  }
}

/** 航段耗时（小时）：简化口径 = 8 小时/航段（跨星系班轮节奏） */
export const LEG_HOURS = 8;

/**
 * 商队日步进（HourlySystems economy 相位调用；累计 LEG_HOURS 小时推进 1 航段）。
 * @returns {{raided:number, delivered:number}}
 */
export function stepTradeRoutes(world) {
  if (world.economy.tradeRoutesActive !== true) return { raided: 0, delivered: 0 };
  let raided = 0;
  let delivered = 0;
  for (const rid of Object.keys(world.entities.tradeRoutes).sort()) {
    const route = world.entities.tradeRoutes[rid];
    if (route.status !== 'in_transit') continue;
    route.legProgressHours += 1;
    const curSysId = route.path[Math.min(route.currentLegIdx, route.path.length - 1)];
    // 途经星系遭遇敌对舰队 → 破交劫掠（确定性顺序判定第一支敌对舰队）
    const raider = findRaider(world, route, curSysId);
    if (raider) {
      raidConvoy(world, route, raider);
      raided++;
      continue;
    }
    if (route.legProgressHours >= LEG_HOURS) {
      route.legProgressHours = 0;
      route.currentLegIdx += 1;
      if (route.currentLegIdx >= route.path.length - 1) {
        // 抵达：货物入目标星系市场
        deliverCargo(world, route);
        route.currentLegIdx = 0;
        route.deliveries = (route.deliveries || 0) + 1;
        delivered++;
      }
    }
  }
  return { raided, delivered };
}

/** 途经星系的敌对舰队（私掠证持有者按合法目标优先） */
function findRaider(world, route, systemId) {
  for (const fid of Object.keys(world.entities.fleets).sort()) {
    const f = world.entities.fleets[fid];
    if (f.systemId !== systemId || f.status === 'retreated') continue;
    if (!areHostile(world, f.factionId, route.factionId)) continue;
    return f;
  }
  return null;
}

/**
 * 劫掠结算：货物入劫掠者阵营账本（FLOW.LOOT）→ 目标市场库存扣减 + 双倍短缺需求注入
 * → 船坞造舰缺料停摆（stalled_shortage）。
 */
export function raidConvoy(world, route, raiderFleet) {
  const qty = route.qtyPerTrip;
  const raiderFid = raiderFleet.factionId;
  // 1) 货物入劫掠者账本
  credit(world, raiderFid, route.resId, qty, `convoyRaid:${route.id}`, route.id, FLOW.LOOT);
  // 2) 私掠赏金（持有效私掠证时发证国支付分成）
  const marque = world.economy.lettersOfMarque?.[raiderFid];
  if (marque && marque.targetFactionId === route.factionId && marque.notorietyFreezeUntil > world.tick) {
    credit(world, raiderFid, 'credits', 400, `marqueBounty:${route.id}`, route.id, FLOW.BOUNTY);
  }
  // 3) 目标星系市场断供传导
  const m = world.economy.markets[route.toSystemId];
  if (m) {
    takeFromMarket(world, route.toSystemId, route.resId, Math.min(qty, m.stock[route.resId] || 0));
    addDemand(world, route.toSystemId, route.resId, qty * 2); // 双倍短缺需求
  }
  // 4) 船坞缺料停摆：目标星系己方船坞建造队列冻结
  const yard = Object.values(world.entities.stations || {})
    .find((st) => st.kind === 'shipyard' && st.systemId === route.toSystemId && st.factionId === route.factionId);
  if (yard && yard.buildQueue && yard.buildQueue.length > 0) {
    yard.buildState = 'stalled_shortage';
    yard.stalledResId = route.resId;
  }
  route.status = 'raided';
  route.raidTick = world.tick;
  emit(world, 'TradeRouteRaided', { routeId: route.id, raiderFactionId: raiderFid, resId: route.resId, qty }, 'economy');
  chronicle(world, 'economy', `商队被劫：${route.resId}×${qty} 断供传导至目标星系船坞`, { routeId: route.id, systemId: route.toSystemId });
}

/** 货物交付：目标市场入库 + 承运阵营运费（FLOW.PRODUCE） */
function deliverCargo(world, route) {
  const qty = route.qtyPerTrip;
  // 承运物资源自发货星系市场库存（物理承载：先扣后运）
  const picked = takeFromMarket(world, route.fromSystemId, route.resId, Math.min(qty, world.economy.markets[route.fromSystemId]?.stock[route.resId] || 0));
  if (picked <= 0) {
    route.status = 'in_transit';
    return;
  }
  const m = world.economy.markets[route.toSystemId];
  if (m) m.stock[route.resId] = (m.stock[route.resId] || 0) + picked;
  credit(world, route.factionId, 'credits', Math.round(picked * 2), `freightFare:${route.id}`, route.id, FLOW.PRODUCE);
  route.status = 'in_transit';
  emit(world, 'TradeRouteDelivered', { routeId: route.id, resId: route.resId, qty: picked }, 'economy');
}

/** 航线自愈：被劫/搁置航线 7 日后重组（MonthlySystems 调用；确定性） */
export function recoverRaidedRoutes(world) {
  if (world.economy.tradeRoutesActive !== true) return 0;
  let n = 0;
  for (const route of Object.values(world.entities.tradeRoutes)) {
    if (route.status === 'raided' && world.tick - (route.raidTick || 0) >= 7 * 24) {
      route.status = 'in_transit';
      route.currentLegIdx = 0;
      route.legProgressHours = 0;
      const yard = Object.values(world.entities.stations || {})
        .find((st) => st.kind === 'shipyard' && st.systemId === route.toSystemId && st.factionId === route.factionId);
      if (yard && yard.buildState === 'stalled_shortage') {
        yard.buildState = 'normal';
        yard.stalledResId = null;
      }
      n++;
    }
  }
  return n;
}
