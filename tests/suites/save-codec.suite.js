/**
 * tests/suites/save-codec.suite.js — SAVE-01: 存档编码与校验
 *
 * 覆盖：encodeSave → validateSaveRecord 通过、JSON 往返、篡改 payload.tick
 * 被 checksum 捕获、decodeImported 拒绝非 JSON / 格式不符 / 空输入、
 * MigrationRegistry 迁移 v1→v2（applied=[2]）、payload 缺 entities 校验失败（SAVE-03）。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { encodeSave, validateSaveRecord, decodeImported, exportSaveText, SAVE_FORMAT } from '../../src/persistence/SaveCodec.js';
import { registerMigration, migratePayload } from '../../src/persistence/MigrationRegistry.js';
import { deepClone } from '../../src/core/serialization.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'SAVE-01',
  name: '存档编码与校验',
  group: 'persistence',
  async run() {
    try {
      const world = createWorld({ seed: 5 });
      const rec = encodeSave(world);

      // 1) 编码记录通过校验
      assertEq(validateSaveRecord(rec).ok, true, 'encodeSave 产物应通过 validateSaveRecord');
      assertEq(rec.format, SAVE_FORMAT, 'format 字段');
      assertEq(rec.worldSeed, 5, 'worldSeed 字段');

      // 2) 导出文本 → 导入解析往返
      const rt = decodeImported(exportSaveText(rec));
      assertEq(rt.ok, true, `JSON 往返应成功（实测 ${JSON.stringify(rt).slice(0, 120)}）`);
      assertEq(rt.record.worldSeed, 5, '往返后 worldSeed 保持');

      // 3) 篡改 payload.tick += 1 → checksum 捕获（用克隆避免污染原 world）
      const recT = deepClone(rec);
      recT.payload.tick += 1;
      const v = validateSaveRecord(recT);
      assertEq(v.ok, false, '篡改 payload.tick 后校验应失败');
      assert(
        String(v.reason).includes('校验和不匹配'),
        `失败原因应为校验和不匹配，实测: ${v.reason}`
      );

      // 4) decodeImported 拒绝非法输入
      assertEq(decodeImported('not json').ok, false, '非 JSON 文本应 ok:false');
      assertEq(decodeImported('').ok, false, '空文本应 ok:false');
      assertEq(decodeImported('{"format":"wrong"}').ok, false, 'format 不符应 ok:false');

      // 5) MigrationRegistry：注册 v1→v2 并迁移（重复注册容忍，set 覆盖不抛错但兜底 try/catch）
      try {
        registerMigration(1, (p) => {
          p.entities.newField = {};
          return p;
        });
      } catch {
        // 容忍重复注册
      }
      const mr = migratePayload({ entities: {} }, 1, 2);
      assertEq(mr.ok, true, `迁移 v1→v2 应成功（实测 ${JSON.stringify(mr).slice(0, 120)}）`);
      assertEq(mr.applied, [2], 'applied 应为 [2]');
      assertEq(mr.payload.entities.newField, {}, '迁移应写入 newField');

      // 6) SAVE-03：payload 缺 entities → validate false
      const noEntities = {
        format: SAVE_FORMAT,
        schemaVersion: 1,
        worldTick: 0,
        payload: { seed: 1, tick: 0 },
        checksum: '00000000',
      };
      const v2 = validateSaveRecord(noEntities);
      assertEq(v2.ok, false, 'payload 缺 entities 应校验失败');
      // 缺 worldTick 同样失败
      const noTick = {
        format: SAVE_FORMAT,
        schemaVersion: 1,
        payload: { seed: 1, tick: 0, entities: {} },
        checksum: '00000000',
      };
      assertEq(validateSaveRecord(noTick).ok, false, '缺 worldTick 应校验失败');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
