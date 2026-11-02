/**
 * persistence/SaveManager.js — 存档槽位管理（任务书 8.1 / 8.2 / 8.4）
 *
 * 槽位：manual-1..3、auto、quick。
 * 自动保存采用「写入临时记录 → 完整写入成功后标记」的两段式；
 * 校验失败不覆盖原存档。
 */

import { Database } from './Database.js';
import { encodeSave, validateSaveRecord, decodeImported, exportSaveText } from './SaveCodec.js';
import { migratePayload } from './MigrationRegistry.js';
import { checkWorldInvariants } from '../core/invariant.js';
import { SCHEMA_VERSION } from '../domain/world/World.js';
import { dateStr } from '../core/clock.js';

export const SLOTS = ['manual-1', 'manual-2', 'manual-3', 'auto', 'quick'];

export class SaveManager {
  /**
   * 开局检查点（App.startNewGame 调用；等价于 auto 槽保存）。
   * 持久化失败时静默降级（三级降级在 Database 内完成），绝不外抛。
   */
  async captureCheckpoint(world, name = '') {
    try {
      return await this.save(world, 'auto', name || '开局检查点');
    } catch (err) {
      console.warn('[VOID FRONTIER] 检查点保存降级为会话内存:', err && err.message);
      return { ok: false, degraded: true, reason: String(err && err.message || err) };
    }
  }

  /** 保存到指定槽位 */
  async save(world, slotId, name = '') {
    const rec = encodeSave(world, {
      factionName: world.entities.factions[world.playerFactionId]?.name || '',
      name: name || `${dateStr(world.tick)}`,
      slotId,
    });
    // 写入前快照校验：世界必须通过不变量（存档是产品核心）
    const problems = checkWorldInvariants(world);
    if (problems.length > 0) {
      return { ok: false, reason: `世界状态异常，拒绝保存: ${problems[0]}` };
    }
    await Database.putSave({ ...rec, slotId }); // keyPath 'slotId'（Database.js）
    await Database.setMeta('lastSlot', slotId);
    return { ok: true, record: rec };
  }

  async saveAuto(world) {
    return this.save(world, 'auto', `自动 · ${dateStr(world.tick)}`);
  }

  async saveQuick(world) {
    return this.save(world, 'quick', `快速 · ${dateStr(world.tick)}`);
  }

  /** 读取槽位：校验 → 迁移 → 不变量检查 */
  async load(slotId) {
    const rec = await Database.getSave(slotId);
    if (!rec) return { ok: false, reason: '槽位为空' };
    const v = validateSaveRecord(rec);
    if (!v.ok) return { ok: false, reason: v.reason };
    const mig = migratePayload(rec.payload, rec.schemaVersion, SCHEMA_VERSION);
    if (!mig.ok) return { ok: false, reason: mig.reason };
    const world = mig.payload;
    const problems = checkWorldInvariants(world);
    if (problems.length > 0) {
      return { ok: false, reason: `加载后不变量失败: ${problems[0]}` };
    }
    return { ok: true, world, record: rec };
  }

  async list() {
    const all = await Database.listSaves();
    return all;
  }

  async remove(slotId) {
    await Database.deleteSave(slotId);
  }

  /** 导入：返回待确认记录（不落库，由调用方确认后 commitImport） */
  importFromText(text) {
    const res = decodeImported(text);
    if (!res.ok) return res;
    return { ok: true, record: res.record };
  }

  async commitImport(record, slotId) {
    await Database.putSave({ ...record, slotId });
    return { ok: true };
  }

  exportText(record) {
    return exportSaveText(record);
  }
}
