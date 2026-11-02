/**
 * tests/suites/assert.js — 极小断言工具（Node / 浏览器同构，零依赖）
 *
 * 约定：所有断言失败一律抛出 Error，消息内含「失败说明 + 实测值」，
 * 由各 suite 的 run() 捕获并转为 { ok:false, detail }。
 */

/** 稳定值序列化：对象键排序、原始值带类型标签（深比较用）。
 *  语义：1 与 '1' 不相等；NaN 与 NaN 深比较相等；undefined/function 参与比较。 */
function stableValue(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'function';
  if (v === null) return 'null';
  if (typeof v !== 'object') {
    if (typeof v === 'number' && Number.isNaN(v)) return 'number:NaN';
    return `${typeof v}:${JSON.stringify(v)}`;
  }
  if (Array.isArray(v)) return `[${v.map(stableValue).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableValue(v[k])}`).join(',')}}`;
}

/** 截断展示值，避免失败信息过长 */
function short(v) {
  const s = stableValue(v);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

/** 断言为真，失败抛 Error(msg) */
export function assert(cond, msg) {
  if (!cond) {
    throw new Error(`断言失败${msg ? ' — ' + msg : ''}`);
  }
}

/** 深比较相等（键序无关；原始值区分类型） */
export function assertEq(actual, expected, msg) {
  if (stableValue(actual) !== stableValue(expected)) {
    throw new Error(
      `断言失败${msg ? ' — ' + msg : ''}: 实际=${short(actual)} 期望=${short(expected)}`
    );
  }
}

/** 数值近似相等：|a−b| ≤ eps */
export function assertNear(a, b, eps, msg) {
  if (!(typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps)) {
    const d = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) : NaN;
    throw new Error(
      `断言失败${msg ? ' — ' + msg : ''}: |${a} − ${b}| = ${d} > eps=${eps}`
    );
  }
}

/** 同步断言抛错：fn 必须抛出；msgContains 非空时错误消息必须包含它 */
export function assertThrows(fn, msgContains, msg) {
  let err = null;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  if (!threw) {
    throw new Error(`断言失败${msg ? ' — ' + msg : ''}: 期望抛出异常但未抛出`);
  }
  if (msgContains != null && !String((err && err.message) || err).includes(msgContains)) {
    throw new Error(
      `断言失败${msg ? ' — ' + msg : ''}: 异常消息 "${(err && err.message) || err}" 不包含 "${msgContains}"`
    );
  }
}
