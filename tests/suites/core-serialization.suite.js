/**
 * tests/suites/core-serialization.suite.js — CORE-02: 序列化与确定性
 */
import { stableStringify, worldHash, deepClone } from '../../src/core/serialization.js';
import { createWorld } from '../../src/domain/world/World.js';
import { assertEq } from './assert.js';

export const suite = {
  id: 'CORE-02',
  name: '序列化与确定性',
  group: 'core',
  async run() {
    try {
      // stableStringify：键序无关
      assertEq(
        stableStringify({ a: 1, b: 2 }),
        stableStringify({ b: 2, a: 1 }),
        '键插入顺序不同应产生相同字符串'
      );
      assertEq(stableStringify({ a: 1, b: 2 }), '{"a":1,"b":2}', '键按字典序输出');

      // worldHash 稳定：同种子两个世界哈希一致；重复计算一致
      const w1 = createWorld({ seed: 5 });
      const w2 = createWorld({ seed: 5 });
      assertEq(worldHash(w1), worldHash(w2), '同种子(5)世界哈希应一致');
      assertEq(worldHash(w1), worldHash(w1), 'worldHash 重复计算应一致');
      const w3 = createWorld({ seed: 6 });
      if (worldHash(w1) === worldHash(w3)) {
        throw new Error('不同种子(5/6)世界哈希不应相同（实测相同）');
      }

      // deepClone：独立修改不影响原对象
      const obj = { a: { b: 1 }, list: [1, 2, { x: 3 }] };
      const c = deepClone(obj);
      c.a.b = 99;
      c.list[2].x = 77;
      c.list.push(4);
      assertEq(obj.a.b, 1, '克隆嵌套字段修改不应影响原对象');
      assertEq(obj.list[2].x, 3, '克隆数组内对象修改不应影响原对象');
      assertEq(obj.list.length, 3, '克隆数组增长不应影响原数组');
      assertEq(c.a.b, 99, '克隆自身修改应生效');

      // undefined 字段被丢弃（与 JSON 语义一致）
      assertEq(stableStringify({ a: 1, b: undefined }), '{"a":1}', '顶层 undefined 字段应被丢弃');
      assertEq(
        stableStringify({ a: 1, nested: { x: undefined, y: 2 } }),
        '{"a":1,"nested":{"y":2}}',
        '嵌套 undefined 字段应被丢弃'
      );
      assertEq(stableStringify([1, undefined, 2]).startsWith('[1,'), true, '数组内 undefined 不产生字段输出');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
