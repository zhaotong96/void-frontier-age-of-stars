/**
 * core/rng.js — 确定性伪随机数（xoshiro128**）
 *
 * 规范要求（任务书 1.5 / 2.5）：
 *  - 模拟逻辑严禁 Math.random()；RNG 状态必须可序列化并纳入存档。
 *  - 状态为 4 个 uint32，直接存于 world.rng 数组，随世界一起序列化。
 *  - 所有函数同步改变传入状态数组（原地突变），保证“推进 N tick 两次结果一致”。
 */

/** 32 位循环左移 */
function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** 推进状态并返回一个 uint32（核心 next 函数，xoshiro128**） */
export function nextU32(s) {
  const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return r;
}

/** splitmix32：把任意数值种子扩展为 4 个 uint32 的初始状态 */
export function seedFromNumber(seed) {
  let x = seed >>> 0;
  const sm = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  const s = [sm(), sm(), sm(), sm()];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1; // 全零为非法状态
  return s;
}

/** 从字符串派生数字种子（仅用于开局命名世界等入口，不入模拟） */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** [0,1) 浮点 */
export function float(s) {
  return nextU32(s) / 4294967296;
}

/** 无偏 [0, n) 整数（拒绝采样） */
export function int(s, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('rng.int: n 必须为正整数');
  const lim = 4294967296 - (4294967296 % n);
  let v = nextU32(s);
  while (v >= lim) v = nextU32(s);
  return v % n;
}

/** [min, max) 浮点 */
export function range(s, min, max) {
  return min + float(s) * (max - min);
}

/** [min, max] 闭区间整数 */
export function intRange(s, min, max) {
  return min + int(s, max - min + 1);
}

/** 概率 p ∈ [0,1] 判定 */
export function chance(s, p) {
  return float(s) < p;
}

/** 从非空数组中确定性选取一个元素 */
export function pick(s, arr) {
  if (!arr || arr.length === 0) throw new Error('rng.pick: 空数组');
  return arr[int(s, arr.length)];
}

/** 原地 Fisher–Yates 洗牌（确定性） */
export function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(s, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** 面向 world 的便捷封装：直接读写 world.rng，保证状态随世界序列化 */
export const RNG = {
  next: (world) => nextU32(world.rng),
  float: (world) => float(world.rng),
  int: (world, n) => int(world.rng, n),
  range: (world, a, b) => range(world.rng, a, b),
  intRange: (world, a, b) => intRange(world.rng, a, b),
  chance: (world, p) => chance(world.rng, p),
  pick: (world, arr) => pick(world.rng, arr),
  shuffle: (world, arr) => shuffle(world.rng, arr),
  /** 用世界 RNG 派生一条独立的临时流（不改变主状态顺序之外的用途时慎用） */
  fork: (world, salt) => {
    const s = [world.rng[0], world.rng[1], world.rng[2], world.rng[3]];
    s[0] = (s[0] ^ Math.imul(salt >>> 0, 0x9e3779b9)) >>> 0;
    nextU32(s);
    return s;
  },
};

/** 校验状态合法（反序列化后调用） */
export function validateState(s) {
  return (
    Array.isArray(s) && s.length === 4 &&
    s.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff) &&
    (s[0] | s[1] | s[2] | s[3]) !== 0
  );
}
