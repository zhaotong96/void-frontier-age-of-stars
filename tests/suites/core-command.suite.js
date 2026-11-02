/**
 * tests/suites/core-command.suite.js — CORE-05: 命令事务性
 *
 * 事务语义验证：
 *  - validate 直接检查 world.economy.ledgers（账本存在性 + 参数合法性）；
 *  - execute 先 credit 副作用资源（alloy 5），再 debit 超量 credits 并 throw('boom')
 *    → 命令总线整世界回滚，alloy 不应存在、credits 不变；
 *  - 合法命令正常入账，stats.commandsExecuted 增加。
 *
 * 命令注册表是模块级共享且重复注册会抛错 —— 套件用 hasCommand + try/catch 容忍多次运行。
 */
import { registerCommand, hasCommand, executeCommand } from '../../src/core/commandBus.js';
import { createWorld } from '../../src/domain/world/World.js';
import { ensureLedger, credit, debit, balance } from '../../src/domain/economy/ledger.js';
import { assert, assertEq, assertThrows } from './assert.js';

const CMD = 'TestPay';

function ensureTestCommand() {
  if (hasCommand(CMD)) return;
  try {
    registerCommand(CMD, {
      desc: '测试支付命令（CORE-05）',
      validate: (ctx, cmd) => {
        const amount = cmd.params && cmd.params.amount;
        const led = ctx.world.economy.ledgers.facX; // 直接检查 world.economy.ledgers
        if (!led) return { ok: false, code: 'NO_LEDGER', reason: 'facX 账本不存在' };
        if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
          return { ok: false, code: 'BAD_AMOUNT', reason: `amount 非法: ${amount}` };
        }
        return { ok: true };
      },
      execute: (ctx, cmd) => {
        credit(ctx.world, 'facX', 'alloy', 5, 'TestPay:side-effect');
        if (!debit(ctx.world, 'facX', 'credits', cmd.params.amount, 'TestPay')) {
          throw new Error('boom');
        }
      },
    });
  } catch {
    // 并发/重复注册容忍（套件可能被运行多轮）
  }
}

export const suite = {
  id: 'CORE-05',
  name: '命令事务性',
  group: 'core',
  async run() {
    try {
      ensureTestCommand();
      assert(hasCommand(CMD), '命令 TestPay 应已注册');
      // 重复注册必须抛错（注册表守卫）
      assertThrows(() => registerCommand(CMD, { execute() {} }), '重复注册', '重复注册应抛错');

      const world = createWorld({ seed: 1 });
      ensureLedger(world, 'facX');
      credit(world, 'facX', 'credits', 10, 'init');
      assertEq(balance(world, 'facX', 'credits'), 10, '期初 credits 应为 10');
      assertEq(world.stats.commandsExecuted, 0, '期初 commandsExecuted 应为 0');

      // 1) 非法支付：execute 内 credit alloy 5 后 debit 999 失败并 throw → 整世界回滚
      const r1 = executeCommand(world, { type: CMD, params: { amount: 999 } });
      assertEq(r1.ok, false, '超量支付应返回 ok:false');
      assertEq(r1.code, 'EXEC_ERROR', `失败码应为 EXEC_ERROR（实测 ${r1.code}）`);
      assertEq(balance(world, 'facX', 'credits'), 10, '回滚后 credits 仍应为 10');
      assertEq(
        Object.prototype.hasOwnProperty.call(world.economy.ledgers.facX.balances, 'alloy'),
        false,
        '回滚后 alloy 不应存在（execute 的 credit 副作用被撤销）'
      );
      assertEq(world.stats.commandsExecuted, 0, '失败命令不应计入 commandsExecuted');
      assertEq(world.stats.commandsFailed.EXEC_ERROR, 1, '失败命令应记入 commandsFailed.EXEC_ERROR');

      // 2) 合法命令：ok:true 且 stats.commandsExecuted 增加为 1
      const r2 = executeCommand(world, { type: CMD, params: { amount: 5 } });
      assertEq(r2.ok, true, `合法支付应 ok:true（实测 ${JSON.stringify(r2)}）`);
      assertEq(world.stats.commandsExecuted, 1, 'commandsExecuted 应增加为 1');
      assertEq(balance(world, 'facX', 'credits'), 5, '合法支付后 credits = 10 − 5');
      assertEq(balance(world, 'facX', 'alloy'), 5, '合法支付的 credit 副作用应保留');
      assertEq(world.commandLog.length, 2, '命令日志应记录两条');

      // 3) 未知命令与格式非法
      const r3 = executeCommand(world, { type: 'NoSuchCmd' });
      assertEq(r3.ok, false, '未知命令应 ok:false');
      assertEq(r3.code, 'UNKNOWN_COMMAND', '未知命令失败码');
      assertEq(executeCommand(world, {}).ok, false, '缺 type 应 ok:false');
      assertEq(world.stats.commandsExecuted, 1, '失败命令不改变计数');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
