/**
 * tests/suites/save-roundtrip.suite.js — SAVE-02/03/04: 存档确定性、迁移与损坏校验
 *
 * 覆盖：
 *  - SAVE-02 中断续推一致性：createStarterCampaign(seed 77) 推进 500 tick →
 *    snapshotHashA=worldHash；深克隆世界为快照；原世界续推 500 tick → hash1；
 *    从克隆快照续推 500 tick → hash2；断言 hash1 === hash2（且克隆点哈希
 *    与 snapshotHashA 一致）。
 *  - SAVE-04 迁移：registerMigration(1, p=>{p.migrated4=true; return p;})
 *    （try/catch 容忍重复注册——模块级注册表被 SAVE-01 套件共用）→
 *    migratePayload(payload, 1, 2) ok 且 payload.migrated4 === true。
 *  - SAVE-03 复验：损坏 tick（记录级 worldTick 字符串；payload 篡改被
 *    checksum 捕获）→ validateSaveRecord false。
 *
 * 环境说明：side-effect 导入 app/commands.js 并补 narrative.pendingChoices
 * （见 ai-stability.suite.js 头注）。
 */
import '../../src/app/commands.js';
import { createWorld, SCHEMA_VERSION } from '../../src/domain/world/World.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { worldHash, deepClone } from '../../src/core/serialization.js';
import { encodeSave, validateSaveRecord, SAVE_FORMAT } from '../../src/persistence/SaveCodec.js';
import { registerMigration, migratePayload } from '../../src/persistence/MigrationRegistry.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'SAVE-02',
  name: '存档中断续推一致性与迁移',
  group: 'persistence',
  async run() {
    try {
      // —— SAVE-02：中断续推一致性 ——
      const world = createStarterCampaign({ seed: 77 });
      world.narrative.pendingChoices ||= [];
      advanceTicks(world, 500);
      const snapshotHashA = worldHash(world);

      const snapshot = deepClone(world);
      assertEq(worldHash(snapshot), snapshotHashA, '深克隆快照应与原世界逐字节一致');

      advanceTicks(world, 500); // 原世界续推
      const hash1 = worldHash(world);
      advanceTicks(snapshot, 500); // 从中断点（克隆）续推
      const hash2 = worldHash(snapshot);
      assertEq(hash1, hash2, `中断续推 500 tick 后哈希应一致（${hash1} ≠ ${hash2}）`);
      assert(hash1 !== snapshotHashA, '续推应实际推进世界状态');

      // —— SAVE-04：迁移注册与执行 ——
      try {
        registerMigration(1, (p) => {
          p.migrated4 = true;
          return p;
        });
      } catch {
        // 容忍重复注册（注册表为模块级共享）
      }
      const payload = { seed: 1, tick: 0, entities: {} };
      const mr = migratePayload(payload, 1, 2);
      assertEq(mr.ok, true, `迁移 v1→v2 应成功（实测 ${JSON.stringify(mr).slice(0, 120)}）`);
      assertEq(mr.applied, [2], 'applied 应为 [2]');
      assertEq(mr.payload.migrated4, true, '迁移函数应写入 migrated4');

      // —— SAVE-03 复验：损坏记录被拒绝 ——
      // (a) 记录级 worldTick 为字符串 → 结构校验失败
      const base = encodeSave(createWorld({ seed: 5 }));
      const badTick = deepClone(base);
      badTick.worldTick = '500';
      const v1 = validateSaveRecord(badTick);
      assertEq(v1.ok, false, 'worldTick 为字符串应校验失败');
      assert(String(v1.reason).includes('worldTick'), `失败原因应指向 worldTick（实测 ${v1.reason}）`);

      // (b) payload.tick 被篡改为字符串 → 结构/校验和任一捕获（语义：篡改必被拒绝）
      const badPayload = deepClone(base);
      badPayload.payload.tick = 'tampered';
      const v2 = validateSaveRecord(badPayload);
      assertEq(v2.ok, false, 'payload.tick 篡改应校验失败');
      assert(
        String(v2.reason).includes('校验和不匹配') || String(v2.reason).includes('类型非法'),
        `篡改应被结构类型校验或校验和捕获（实测 ${v2.reason}）`
      );
      // (b2) 数值型篡改（保持整数）→ 必须由校验和捕获
      const badPayload2 = deepClone(base);
      badPayload2.payload.tick = (typeof base.payload.tick === 'number' ? base.payload.tick : 0) + 7;
      const v3 = validateSaveRecord(badPayload2);
      assertEq(v3.ok, false, '整数 tick 篡改应由校验和捕获');
      assert(String(v3.reason).includes('校验和不匹配'), `数值篡改原因应为校验和不匹配（实测 ${v3.reason}）`);

      // (c) 基线：完好记录通过
      assertEq(validateSaveRecord(base).ok, true, '未损坏记录应通过校验');
      assertEq(base.schemaVersion, SCHEMA_VERSION, '记录 schemaVersion 与世界一致');
      assertEq(base.format, SAVE_FORMAT, '记录格式标识');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
