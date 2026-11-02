#!/usr/bin/env node
/**
 * tests/tools/run-suites.mjs — 测试套件运行器（Node）
 *
 * 用法:
 *   node tests/tools/run-suites.mjs
 *
 * 行为:
 *  - 从 tests/suites/index.js 收集全部套件（按 id 排序）；
 *  - 每个套件运行两轮（REPEAT=2），验证结果稳定、无状态泄漏；
 *  - 逐行打印 `ID  PASS/FAIL  耗时  (失败detail)`;
 *  - 汇总统计；任何 FAIL 则 process.exitCode = 1。
 */
import { collectSuites } from '../suites/index.js';

const REPEAT = 2;

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function runOnce(pass) {
  const suites = collectSuites();
  let passCount = 0;
  let failCount = 0;
  const details = [];
  for (const s of suites) {
    const t0 = performance.now();
    let res;
    try {
      res = await s.run();
    } catch (e) {
      res = { ok: false, detail: `运行器捕获未处理异常: ${(e && e.stack) || e}` };
    }
    const ms = performance.now() - t0;
    const ok = !!(res && res.ok);
    const line = `${String(s.id).padEnd(9)} ${ok ? 'PASS' : 'FAIL'}  ${fmtMs(ms).padStart(9)}  ${s.name}`;
    console.log(line);
    if (ok) {
      passCount++;
    } else {
      failCount++;
      const detail = (res && res.detail) || '无失败说明';
      details.push(`[${s.id}] ${detail}`);
      console.log(`          ↳ ${detail}`);
    }
  }
  return { passCount, failCount, total: suites.length, details };
}

console.log(`VOID FRONTIER 套件运行器 — 每套件运行 ${REPEAT} 轮`);
const grand = { passCount: 0, failCount: 0, details: [] };
let lastTotal = 0;
for (let pass = 1; pass <= REPEAT; pass++) {
  console.log(`\n—— 第 ${pass}/${REPEAT} 轮 ——`);
  const r = await runOnce(pass);
  grand.passCount += r.passCount;
  grand.failCount += r.failCount;
  grand.details.push(...r.details.map((d) => `(第${pass}轮) ${d}`));
  lastTotal = r.total;
}

console.log(`\n==== 汇总: PASS ${grand.passCount} / FAIL ${grand.failCount}（${REPEAT} 轮 × ${lastTotal} 套件）====`);
if (grand.failCount > 0) {
  console.log('失败明细:');
  for (const d of grand.details) console.log(`  ✗ ${d}`);
  process.exitCode = 1;
} else {
  console.log('全部通过。');
}
