/**
 * tests/suites/core-math.suite.js — CORE-02a: 数学算子边界
 */
import {
  clamp, safeDivide, normalizeAngle, angleDelta,
  stableSortBy, sortedKeys, assertFinite,
} from '../../src/core/math.js';
import { assert, assertEq, assertNear, assertThrows } from './assert.js';

export const suite = {
  id: 'CORE-02a',
  name: '数学算子边界',
  group: 'core',
  async run() {
    try {
      // clamp
      assertEq(clamp(5, 0, 3), 3, 'clamp(5,0,3) 上界');
      assertEq(clamp(-1, 0, 3), 0, 'clamp(-1,0,3) 下界');
      assertEq(clamp(2, 0, 3), 2, 'clamp(2,0,3) 区间内');
      assertEq(clamp(NaN, 0, 3), 0, 'clamp(NaN,0,3) 返回 min');

      // safeDivide：零/近零/非有限分母 → fallback
      assertEq(safeDivide(10, 2), 5, 'safeDivide(10,2) 正常除法');
      assertEq(safeDivide(10, 0), 0, 'safeDivide(10,0) 默认 fallback=0');
      assertEq(safeDivide(10, 0, -1), -1, 'safeDivide(10,0,-1) 自定义 fallback');
      assertEq(safeDivide(10, 1e-12, -2), -2, 'safeDivide 近零分母 → fallback');
      assertEq(safeDivide(1, Infinity, -3), -3, 'safeDivide(1,Infinity,-3) 非有限分母 → fallback');

      // normalizeAngle：归一化到 [0, 2π)
      assert(normalizeAngle(-1) > 0, `normalizeAngle(-1) 应 > 0，实测 ${normalizeAngle(-1)}`);
      assertNear(normalizeAngle(-1), Math.PI * 2 - 1, 1e-9, 'normalizeAngle(-1) = 2π−1');
      assertEq(normalizeAngle(0), 0, 'normalizeAngle(0) = 0');
      const na = normalizeAngle(Math.PI * 4 + 0.5);
      assert(na >= 0 && na < Math.PI * 2, `normalizeAngle 应落在 [0,2π)，实测 ${na}`);

      // angleDelta：有符号角差，范围 [-π, π]
      const pairs = [[0, 0.1], [0, Math.PI * 1.5], [3, -3], [10, 100], [-5, 5]];
      for (const [a, b] of pairs) {
        const d = angleDelta(a, b);
        assert(
          d >= -Math.PI - 1e-12 && d <= Math.PI + 1e-12,
          `angleDelta(${a},${b}) = ${d} 超出 [-π,π]`
        );
      }
      assertNear(angleDelta(0, 0.1), 0.1, 1e-12, 'angleDelta(0,0.1)');
      assertNear(angleDelta(0, Math.PI * 1.5), -Math.PI * 0.5, 1e-12, 'angleDelta(0,1.5π) = −0.5π');

      // 稳定排序：相同键保持原序
      const arr = [{ k: 2, tag: 'a' }, { k: 1, tag: 'b' }, { k: 2, tag: 'c' }];
      const out = stableSortBy(arr, (x) => x.k);
      assertEq(out.map((x) => x.tag), ['b', 'a', 'c'], 'stableSortBy 相同键(2)应保持 a 在 c 之前');
      assertEq(arr.map((x) => x.tag), ['a', 'b', 'c'], 'stableSortBy 不应改变原数组');

      // sortedKeys：确定性键序
      assertEq(sortedKeys({ b: 1, a: 2, c: 3 }), ['a', 'b', 'c'], 'sortedKeys 字典序');

      // assertFinite：非有限值抛错
      assertThrows(() => assertFinite(Infinity, 'test'), 'assertFinite', 'Infinity 应抛出');
      assertThrows(() => assertFinite(NaN, 'test'), 'assertFinite', 'NaN 应抛出');
      assertEq(assertFinite(3.5, 'test'), 3.5, '有限值原样返回');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
