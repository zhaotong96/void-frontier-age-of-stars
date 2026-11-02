/**
 * tests/suites/core-clock.suite.js — CORE-02b: 战略时钟
 */
import {
  tickToDate, isDayStart, isMonthStart, isYearStart,
  TICKS_PER_DAY, TICKS_PER_MONTH, TICKS_PER_YEAR,
} from '../../src/core/clock.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'CORE-02b',
  name: '战略时钟',
  group: 'core',
  async run() {
    try {
      // 常量基线：1 tick = 1 游戏小时，24h/日，30日/月，12月/年
      assertEq(TICKS_PER_DAY, 24, 'TICKS_PER_DAY');
      assertEq(TICKS_PER_MONTH, 720, 'TICKS_PER_MONTH');
      assertEq(TICKS_PER_YEAR, 8640, 'TICKS_PER_YEAR');

      // tick → 日期
      assertEq(tickToDate(0), { year: 1, month: 1, day: 1, hour: 0 }, 'tick 0 = Y1.M1.D1 00:00');
      assertEq(tickToDate(24), { year: 1, month: 1, day: 2, hour: 0 }, 'tick 24 = 第2日');
      assertEq(tickToDate(720), { year: 1, month: 2, day: 1, hour: 0 }, 'tick 720 = 第2月');
      assertEq(tickToDate(8640), { year: 2, month: 1, day: 1, hour: 0 }, 'tick 8640 = Y2');
      assertEq(tickToDate(25), { year: 1, month: 1, day: 2, hour: 1 }, 'tick 25 = D2 01:00');

      // 日/月/年起点判定
      assert(isDayStart(24), 'isDayStart(24) 应为真');
      assert(isMonthStart(720), 'isMonthStart(720) 应为真');
      assert(isYearStart(8640), 'isYearStart(8640) 应为真');
      assertEq(isDayStart(0), false, 'isDayStart(0) 应为假（tick 0 非起点事件）');
      assertEq(isDayStart(25), false, 'isDayStart(25) 应为假');
      assertEq(isMonthStart(24), false, 'isMonthStart(24) 应为假');
      assertEq(isMonthStart(8640), true, 'isMonthStart(8640) 应为真（年起点也是月起点）');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
