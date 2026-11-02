/**
 * tests/suites/economy-market.suite.js — ECON-04: 市场价格边界
 *
 * P = base × clamp(1 + α(D−S)/max(S,ε), 0.35, 3.2)，每日平滑。
 * 覆盖：供不应求价格上行但低于 base×3.2 上限、供过于求价格下行但高于
 * base×0.35 下限、连续 30 次单方向更新不溢出、marketBuy 库存不足 ok:false、
 * 买入后 stock 减少且 credits 经注入的 ledger debit/credit 扣减。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { ensureMarket, updateMarketPrices, marketBuy } from '../../src/domain/economy/market.js';
import { ensureLedger, credit, debit, balance } from '../../src/domain/economy/ledger.js';
import { BAL } from '../../src/content/constants.js';
import { resourceDef } from '../../src/content/resources.js';
import { assert, assertEq } from './assert.js';

const RID = 'alloy';

export const suite = {
  id: 'ECON-04',
  name: '市场价格边界',
  group: 'economy',
  async run() {
    try {
      const world = createWorld({ seed: 11 });
      const m = ensureMarket(world, 'sys1');
      const base = resourceDef(RID).basePrice; // 22
      const ceiling = base * BAL.economy.priceMaxFactor; // 3.2x
      const floor = base * BAL.economy.priceMinFactor; // 0.35x
      assertEq(m.price[RID], base, '初始价格应等于 basePrice');

      // 1) 供不应求：stock=0、demand=500 → 价格上行且 < base×3.2 + 0.01
      m.stock[RID] = 0;
      m.demand[RID] = 500;
      updateMarketPrices(world);
      assert(m.price[RID] > base, `供不应求后价格应高于 base，实测 ${m.price[RID]}`);
      assert(
        m.price[RID] < ceiling + 0.01,
        `价格 ${m.price[RID]} 应 < 上限 ${ceiling}+0.01`
      );

      // 2) 连续 30 次单方向（高价）更新：有限数、不溢出、不破上限
      for (let i = 0; i < 30; i++) {
        m.demand[RID] = 500; // 需求每日衰减 ×0.6，持续注入保持单方向压力
        updateMarketPrices(world);
        assert(
          Number.isFinite(m.price[RID]),
          `高价方向第 ${i + 1} 次更新后价格非有限值: ${m.price[RID]}`
        );
        assert(
          m.price[RID] < ceiling + 0.01,
          `高价方向第 ${i + 1} 次更新后价格 ${m.price[RID]} 破上限 ${ceiling}`
        );
      }

      // 3) 供过于求：stock 巨大、demand=0 → 价格下行且 > base×0.35 − 0.01
      m.stock[RID] = 1e9;
      m.demand[RID] = 0;
      assert(m.price[RID] > floor - 0.01, `价格 ${m.price[RID]} 应 > 下限 ${floor}−0.01`);
      for (let i = 0; i < 30; i++) {
        updateMarketPrices(world);
        assert(
          Number.isFinite(m.price[RID]),
          `低价方向第 ${i + 1} 次更新后价格非有限值: ${m.price[RID]}`
        );
        assert(
          m.price[RID] > floor - 0.01,
          `低价方向第 ${i + 1} 次更新后价格 ${m.price[RID]} 破下限 ${floor}`
        );
      }
      // 平滑收敛后应已低于 base（每日向目标价靠拢 35%）
      assert(m.price[RID] < base, `供过于求 30 次更新后价格应低于 base，实测 ${m.price[RID]}`);

      // 4) marketBuy：库存不足 → ok:false
      m.stock[RID] = 0;
      ensureLedger(world, 'facB');
      credit(world, 'facB', 'credits', 100000, 'init');
      const rNone = marketBuy(world, 'facB', 'sys1', RID, 10, { debit, credit });
      assertEq(rNone.ok, false, '库存不足 marketBuy 应返回 ok:false');
      assertEq(m.stock[RID], 0, '失败买单不应改变库存');
      assertEq(balance(world, 'facB', 'credits'), 100000, '失败买单不应扣款');

      // 5) 买入成功：stock 减少、credits 扣减（ledger 模块 debit/credit 注入）
      m.stock[RID] = 100;
      const before = balance(world, 'facB', 'credits');
      const r = marketBuy(world, 'facB', 'sys1', RID, 5, { debit, credit });
      assertEq(r.ok, true, `买入应成功（实测 ${JSON.stringify(r)}）`);
      assertEq(m.stock[RID], 95, `买入后库存应为 95（实测 ${m.stock[RID]}）`);
      assertEq(r.got, 5, '成交量应为 5');
      assert(r.spent > 0, `支出应 > 0，实测 ${r.spent}`);
      assertEq(balance(world, 'facB', 'credits'), before - r.spent, 'credits 应按 spent 扣减');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
