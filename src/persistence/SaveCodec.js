/**
 * persistence/SaveCodec.js — 存档编码、校验与完整性检查（任务书 8.2 / 8.3）
 *
 * 存档结构：
 * { format, schemaVersion, gameVersion, createdAt, savedAt, worldSeed,
 *   worldTick, checksum, summary, payload }
 * checksum 对 payload 规范化字符串做 FNV-1a，加载前验证（SAVE-03）。
 */

import { stableStringify, hash32 } from '../core/serialization.js';

export const SAVE_FORMAT = 'void-frontier-save';
export const MAX_IMPORT_BYTES = 24 * 1024 * 1024; // 24MB 导入上限

/** 从世界构建存档记录（不写库） */
export function encodeSave(world, summary = {}) {
  const payload = world; // World 本身就是纯数据
  return {
    format: SAVE_FORMAT,
    schemaVersion: world.schemaVersion,
    gameVersion: world.gameVersion,
    createdAt: world.createdAt || null,
    savedAt: new Date().toISOString(),
    worldSeed: world.seed,
    worldTick: world.tick,
    checksum: hash32(stableStringify(payload)).toString(16).padStart(8, '0'),
    summary: {
      factionName: summary.factionName || '',
      galaxySize: world.galaxySize,
      difficulty: world.difficulty,
      playTicks: world.tick,
      entityCounts: Object.fromEntries(
        Object.keys(world.entities).map((k) => [k, Object.keys(world.entities[k] || {}).length])
      ),
      ...summary,
    },
    payload,
  };
}

/** 校验存档记录结构（导入/读取共用）。返回 { ok, reason } */
export function validateSaveRecord(rec, { requireChecksum = true } = {}) {
  if (!rec || typeof rec !== 'object') return { ok: false, reason: '存档不是对象' };
  if (rec.format !== SAVE_FORMAT) return { ok: false, reason: `格式不符: ${rec.format}` };
  if (!Number.isInteger(rec.schemaVersion) || rec.schemaVersion < 1) {
    return { ok: false, reason: 'schemaVersion 非法' };
  }
  if (!Number.isInteger(rec.worldTick) || rec.worldTick < 0) return { ok: false, reason: 'worldTick 非法' };
  if (!rec.payload || typeof rec.payload !== 'object') return { ok: false, reason: 'payload 缺失' };
  const p = rec.payload;
  if (p.seed === undefined || p.tick === undefined || !p.entities) {
    return { ok: false, reason: 'payload 缺少必要字段（seed/tick/entities）' };
  }
  if (!Number.isInteger(p.seed) || !Number.isInteger(p.tick) || typeof p.entities !== 'object') {
    return { ok: false, reason: 'payload 字段类型非法（seed/tick 须为整数，entities 须为对象）' };
  }
  if (requireChecksum) {
    const expect = hash32(stableStringify(p)).toString(16).padStart(8, '0');
    if (rec.checksum !== expect) {
      return { ok: false, reason: `校验和不匹配（${rec.checksum} ≠ ${expect}）` };
    }
  }
  return { ok: true };
}

/** 导入文本 → 记录（全部视为不可信输入；不 eval，不执行代码） */
export function decodeImported(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: '空文件' };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: '文件超出大小上限' };
  let rec;
  try {
    rec = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'JSON 解析失败' };
  }
  const v = validateSaveRecord(rec);
  if (!v.ok) return v;
  return { ok: true, record: rec };
}

/** 导出为 JSON 文本 */
export function exportSaveText(rec) {
  return JSON.stringify(rec);
}

/** 尝试压缩导出（浏览器支持 CompressionStream 时）；退化纯 JSON */
export async function exportSaveCompressed(rec) {
  const text = exportSaveText(rec);
  if (typeof CompressionStream !== 'function') return { text, compressed: false };
  try {
    const cs = new CompressionStream('gzip');
    const blob = new Blob([text]);
    const stream = blob.stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { text: btoa(bin), compressed: true };
  } catch {
    return { text, compressed: false };
  }
}
