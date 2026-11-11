#!/usr/bin/env node
/**
 * tests/tools/run-suites.mjs — 全生命周期确定性测试运行器（v2.0，doc24 §2.2 规范）
 *
 * 核心机制（doc24《全生命周期测试体系方案》第二部分）：
 * 1. REPEAT 默认 3 轮（Iron Discipline 1），对每套件连续 3 轮的返回指纹
 *    （ok / 归一化 detail / hash）执行严格比对，任何轮次间分歧判为
 *    NON_DETERMINISTIC_DRIFT 失败；
 * 2. 运行期挂载 Math.random 毒丸守卫——任何非受控随机调用当场抛错
 *    （确定性红线：禁止非受控 Math.random / 系统真实时钟参与世界演化）；
 * 3. 支持 --tier=0..5 / --group=<domain> / --id=<suiteId>（--suite= 为兼容别名）筛选；
 * 4. 兼容 tests/suites/index.js 统一聚合门面（47 个既有套件零改动直接纳入）。
 *
 * 指纹归一化说明（doc24 前提「不破坏既有 47 套件连续可测性」优先）：
 * 既有套件（playtest-gates / ground-playtest-physics / terrain-edits）会在 detail
 * 中嵌入 Date.now / performance.now 实测耗时（"<n>ms"）。毫秒计时天然逐轮波动，
 * 属于合法测量输出而非状态漂移，因此在指纹比对前剥离毫秒计时令牌；
 * ok / hash / 非计时 detail 仍参与逐位对拍，漂移检测语义不变。
 */
import { collectSuites } from '../suites/index.js';

const args = process.argv.slice(2);
const getArg = (prefix) => {
  const hit = args.find((a) => a.startsWith(`--${prefix}=`));
  return hit ? hit.slice(prefix.length + 3) : null;
};

const REPEAT = Math.max(1, Number(getArg('repeat') || 3));
const FILTER_TIER = getArg('tier') != null ? Number(getArg('tier')) : null;
const FILTER_GROUP = getArg('group');
const FILTER_ID = getArg('id') || getArg('suite'); // doc25 使用 --suite= 别名

/** 毫秒计时令牌剥离（仅用于指纹归一化，不改写输出文本） */
function normalizeDetail(detail) {
  return String(detail || '').replace(/\d+(?:\.\d+)?ms\b/g, '<ms>');
}

function installDeterminismGuard(suiteId) {
  const origRandom = Math.random;
  Math.random = () => {
    throw new Error(`[IRON-DISCIPLINE-1] 套件 ${suiteId} 违规调用 Math.random()`);
  };
  return () => { Math.random = origRandom; };
}

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function runSuitePass(s) {
  const restore = installDeterminismGuard(s.id);
  const t0 = performance.now();
  let res;
  try {
    res = await s.run();
  } catch (e) {
    res = { ok: false, detail: `未捕获异常: ${(e && e.stack) || e}` };
  } finally {
    restore();
  }
  const ms = performance.now() - t0;
  const ok = !!(res && res.ok);
  const detail = (res && res.detail) || '';
  return {
    ok,
    detail,
    fingerprint: JSON.stringify({ ok, detail: normalizeDetail(detail), hash: res?.hash ?? null }),
    ms,
  };
}

const allSuites = collectSuites().filter((s) => {
  if (FILTER_TIER != null && (s.tier ?? 1) !== FILTER_TIER) return false;
  if (FILTER_GROUP && s.group !== FILTER_GROUP) return false;
  if (FILTER_ID && s.id !== FILTER_ID) return false;
  return true;
});

if (allSuites.length === 0) {
  console.error('筛选条件未命中任何套件（--tier / --group / --id）。');
  process.exitCode = 1;
} else {
  console.log(`VOID FRONTIER 全生命周期质量运行器（v2.0）— 收集 ${allSuites.length} 套件 × 连续 ${REPEAT} 轮对拍`);

  const firstRoundFingerprints = new Map();
  const grand = { passCount: 0, failCount: 0, driftCount: 0, details: [] };

  for (let pass = 1; pass <= REPEAT; pass++) {
    console.log(`\n—— 第 ${pass}/${REPEAT} 轮 ——`);
    for (const s of allSuites) {
      const r = await runSuitePass(s);
      let ok = r.ok;
      let driftMsg = '';
      if (pass === 1) {
        firstRoundFingerprints.set(s.id, r.fingerprint);
      } else if (r.fingerprint !== firstRoundFingerprints.get(s.id)) {
        ok = false;
        grand.driftCount++;
        driftMsg = ` [确定性漂移: 第${pass}轮输出与第1轮不一致! R1=${firstRoundFingerprints.get(s.id)} vs R${pass}=${r.fingerprint}]`;
      }
      const tierTag = `T${s.tier ?? 1}`;
      const line = `${tierTag} ${String(s.id).padEnd(14)} ${ok ? 'PASS' : 'FAIL'} ${fmtMs(r.ms).padStart(9)} [${s.group}] ${s.name}`;
      console.log(line);
      if (ok) {
        grand.passCount++;
      } else {
        grand.failCount++;
        const msg = `${r.detail || '断言失败'}${driftMsg}`;
        grand.details.push(`(第${pass}轮) [${s.id}] ${msg}`);
        console.log(`   ↳ ${msg}`);
      }
    }
  }

  console.log(`\n==== 汇总: PASS ${grand.passCount} / FAIL ${grand.failCount} / DRIFT ${grand.driftCount}（${REPEAT} 轮 × ${allSuites.length} 套件 = ${REPEAT * allSuites.length} 轮次）====`);
  if (grand.failCount > 0 || grand.driftCount > 0) {
    for (const d of grand.details) console.log(`  ✗ ${d}`);
    process.exitCode = 1;
  } else {
    console.log('全生命周期确定性门禁 100% 通过（零状态泄漏、零时间漂移）。');
  }
}
