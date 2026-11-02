/**
 * tests/suites/economy-ledger.suite.js — ECON-01: 资源账本守恒
 *
 * 覆盖：credit/debit 基础记账、超额 debit 失败不改余额、pay 原子性（不足整体失败）、
 * verifyLedgerConsistency 守恒校验（dayFlow 按账本等式 S+P+I+L−C−E−D
 * 以「正向流出量」构造 —— daily 流水内部记录带符号增量，故流出项取相反数）、
 * transferBetween 双向记账（含失败方向）、decay 生效。
 */
import { createWorld } from '../../src/domain/world/World.js';
import {
  ensureLedger, credit, debit, balance, pay, canAfford,
  transferBetween, applyDecay, verifyLedgerConsistency,
} from '../../src/domain/economy/ledger.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'ECON-01',
  name: '资源账本守恒',
  group: 'economy',
  async run() {
    try {
      const world = createWorld({ seed: 9 });
      ensureLedger(world, 'f1');
      const opening = {}; // 期初余额：全部为 0

      // credit +100（reason 'tax'）
      credit(world, 'f1', 'credits', 100, 'tax');
      assertEq(balance(world, 'f1', 'credits'), 100, 'credit 100 后余额应为 100');

      // debit 30 成功
      assertEq(debit(world, 'f1', 'credits', 30, 'build'), true, 'debit 30 应成功');
      assertEq(balance(world, 'f1', 'credits'), 70, 'debit 30 后余额应为 70');

      // debit 999 → false 且余额不变
      assertEq(debit(world, 'f1', 'credits', 999, 'build'), false, '超额 debit 应返回 false');
      assertEq(balance(world, 'f1', 'credits'), 70, '超额 debit 后余额应保持 70');

      // pay 原子性：alloy 不足 → 整体失败，credits 未扣
      assertEq(balance(world, 'f1', 'alloy'), 0, 'alloy 期初应为 0');
      assertEq(canAfford(world, 'f1', { credits: 20, alloy: 5 }), false, 'canAfford 应为 false');
      assertEq(pay(world, 'f1', { credits: 20, alloy: 5 }, 'buy'), false, 'alloy 不足 pay 应失败');
      assertEq(balance(world, 'f1', 'credits'), 70, 'pay 失败后 credits 不应被扣（原子性）');
      assertEq(balance(world, 'f1', 'alloy'), 0, 'pay 失败后 alloy 不应入账');

      // 批量混合操作
      credit(world, 'f1', 'alloy', 40, 'refine');
      credit(world, 'f1', 'hydrogen', 100, 'import');
      assertEq(debit(world, 'f1', 'credits', 10, 'build'), true, '批量 debit 10 应成功');
      assertEq(transferBetween(world, 'f1', 'f2', 'credits', 10, 'gift'), true, 'transfer 应成功');
      applyDecay(world, 'f1', ['hydrogen'], { hydrogen: { perDayPct: 25 } });

      // 期末余额
      assertEq(balance(world, 'f1', 'credits'), 50, 'credits 应为 70−10−10 = 50');
      assertEq(balance(world, 'f1', 'alloy'), 40, 'alloy 应为 40');
      assertEq(balance(world, 'f1', 'hydrogen'), 75, 'decay 25% 后 hydrogen 应为 75');

      // transferBetween 双向记账（f2 进账）
      assertEq(balance(world, 'f2', 'credits'), 10, 'f2 应收到的 10 credits');
      // 反向不足 → false，双向余额均不变
      assertEq(transferBetween(world, 'f2', 'f1', 'credits', 999, 'gift'), false, 'f2 余额不足应失败');
      assertEq(balance(world, 'f1', 'credits'), 50, '失败 transfer 后 f1 余额不变');
      assertEq(balance(world, 'f2', 'credits'), 10, '失败 transfer 后 f2 余额不变');

      // decay 流水记录
      assertEq(world.economy.daily.f1.hydrogen.decay, -25, 'decay 应在 daily 流水记 −25');

      // 账本守恒：dayFlow = world.economy.daily.f1 换算为正向流出量
      const daily = world.economy.daily.f1;
      const dayFlow = {};
      for (const resId of Object.keys(daily)) {
        const f = daily[resId];
        dayFlow[resId] = {
          produced: f.produced || 0,
          imported: f.imported || 0,
          loot: f.loot || 0,
          transfer: f.transfer || 0,
          tax: f.tax || 0,
          consumed: -(f.consumed || 0),
          exported: -(f.exported || 0),
          decay: -(f.decay || 0),
        };
      }
      const problems = verifyLedgerConsistency(world, 'f1', opening, dayFlow);
      assertEq(problems.length, 0, `账本守恒校验应通过（实测: ${problems.join('; ')}）`);

      // 篡改流水应被检出（校验器有效性的反向验证）
      const bad = JSON.parse(JSON.stringify(dayFlow));
      bad.credits.produced += 5;
      assert(
        verifyLedgerConsistency(world, 'f1', opening, bad).length > 0,
        '篡改 dayFlow 后守恒校验应报不平'
      );

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
