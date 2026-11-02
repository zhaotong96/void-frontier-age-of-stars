/**
 * tests/suites/core-scheduler.suite.js — CORE-06: 事件调度确定性
 *
 * 说明：registerScheduled 的 handler 表是模块级共享（Map.set 覆盖式注册，
 * 重复注册不抛错），套件每次运行用全新 world 与局部 fire 数组，无状态泄漏。
 */
import { registerScheduled, schedule, runDue, popDue } from '../../src/core/scheduler.js';
import { createWorld } from '../../src/domain/world/World.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'CORE-06',
  name: '事件调度确定性',
  group: 'core',
  async run() {
    try {
      const fired = [];
      registerScheduled('t1', (world, payload) => fired.push(payload.n));

      const world = createWorld({ seed: 1 });
      assertEq(world.scheduled.length, 0, '新世界调度队列应为空');

      schedule(world, 10, 't1', { n: 1 });
      schedule(world, 5, 't1', { n: 2 });
      schedule(world, 10, 't1', { n: 3 });
      assertEq(world.scheduled.length, 3, '应已安排 3 项');

      // 推进到 tick=10 后到期
      world.tick = 10;
      const due = popDue(world);
      const order = due.map((it) => it.payload.n);
      // tick 升序（5 先于 10），同 tick 按 seq（n1 先于 n3）
      assertEq(order, [2, 1, 3], '到期顺序应为 [n2, n1, n3]（tick 升序，同 tick 按 seq）');
      assertEq(world.scheduled.length, 0, '到期项出队后 world.scheduled 应为空');

      // runDue 执行 handler：再排一批验证执行路径
      schedule(world, 12, 't1', { n: 4 });
      world.tick = 12;
      const count = runDue(world);
      assertEq(count, 1, 'runDue 应执行 1 项');
      assertEq(fired, [4], 'handler 应按 (tick, seq) 顺序触发');

      // 未来项不出队
      schedule(world, 99, 't1', { n: 5 });
      world.tick = 20;
      assertEq(runDue(world), 0, '未到期项不应出队');
      assertEq(world.scheduled.length, 1, '未来项应保留在队列');
      assertEq(fired, [4], '未到期项不应触发 handler');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
