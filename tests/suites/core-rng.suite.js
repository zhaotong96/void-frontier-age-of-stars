/**
 * tests/suites/core-rng.suite.js — CORE-01: Seeded PRNG 确定性
 */
import { seedFromNumber, nextU32, float, int, validateState } from '../../src/core/rng.js';
import { assert, assertEq, assertThrows } from './assert.js';

export const suite = {
  id: 'CORE-01',
  name: 'Seeded PRNG 确定性',
  group: 'core',
  async run() {
    try {
      // 1) 同一种子连续 nextU32 取 10000 个值两次，逐个相等
      const s1 = seedFromNumber(42);
      const first = [];
      for (let i = 0; i < 10000; i++) first.push(nextU32(s1));
      const s2 = seedFromNumber(42);
      for (let i = 0; i < 10000; i++) {
        const v = nextU32(s2);
        if (v !== first[i]) {
          throw new Error(`同种子(42)序列不一致 @${i}: 实际 ${v} ≠ 首轮 ${first[i]}`);
        }
      }

      // 2) 不同种子（42/43）序列不同（前 100 个内必须出现分歧）
      const sA = seedFromNumber(42);
      const sB = seedFromNumber(43);
      let differs = false;
      for (let i = 0; i < 100; i++) {
        if (nextU32(sA) !== nextU32(sB)) { differs = true; break; }
      }
      assert(differs, '种子 42 与 43 的 nextU32 序列应不同');

      // 3) float() 落在 [0,1)
      const s3 = seedFromNumber(7);
      for (let i = 0; i < 2000; i++) {
        const f = float(s3);
        if (!(f >= 0 && f < 1 && Number.isFinite(f))) {
          throw new Error(`float() 越界: 实测 ${f}`);
        }
      }

      // 4) int(s,7) 采样 7000 次后各桶均 > 700（统计可区分性；期望均值 1000/桶）
      const s4 = seedFromNumber(99);
      const buckets = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 7000; i++) buckets[int(s4, 7)]++;
      for (let b = 0; b < 7; b++) {
        if (!(buckets[b] > 700)) {
          throw new Error(`int(s,7) 桶 ${b} 样本数 ${buckets[b]} ≤ 700，分布异常（全部=${JSON.stringify(buckets)}）`);
        }
      }

      // 5) validateState 拒绝全零
      assertEq(validateState([0, 0, 0, 0]), false, 'validateState 应拒绝全零状态');
      assertEq(validateState(seedFromNumber(1)), true, 'validateState 应接受合法状态');
      assertEq(validateState([1, 2, 3]), false, 'validateState 应拒绝长度≠4的状态');
      assertThrows(() => int(s4, 0), 'n 必须为正整数', 'int(s,0) 应抛错');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
