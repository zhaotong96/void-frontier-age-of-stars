/**
 * tests/suites/regression-golden.suite.js — L4 回归：固定种子金快照
 * 基线由 tests/tools/update-golden.mjs 生成；规则有意变更后更新基线
 * 并在 CHANGELOG 记录（任务书 10.1 L4）。
 */

import { computeGolden, loadGolden, warmGolden, GOLDEN_CONFIG } from '../tools/update-golden.mjs';

export const suite = {
  id: 'REG-01',
  name: '固定种子金快照回归',
  group: 'regression',
  async run() {
    // [SPEC-39 Bug 1] 基线经 warmGolden 惰性装载（Node fs / 浏览器 fetch，同旧语义）
    await warmGolden();
    const base = loadGolden();
    if (!base) {
      // 首跑：生成基线而不是失败（先有基线再谈回归）
      const hash = computeGolden();
      return { ok: false, detail: `缺少基线 tests/regression/golden.json（当前哈希 ${hash}，请运行 npm run golden:update 生成）` };
    }
    if (base.seed !== GOLDEN_CONFIG.seed || base.ticks !== GOLDEN_CONFIG.ticks) {
      return { ok: false, detail: `基线配置漂移（基线 ${base.seed}/${base.ticks}，当前 ${GOLDEN_CONFIG.seed}/${GOLDEN_CONFIG.ticks}）` };
    }
    const hash = computeGolden();
    if (hash !== base.hash) {
      return { ok: false, detail: `哈希漂移：当前 ${hash} ≠ 基线 ${base.hash}。若无意的规则变更请排查；有意的平衡调整请更新基线并记录 CHANGELOG` };
    }
    return { ok: true };
  },
};
