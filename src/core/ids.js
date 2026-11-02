/**
 * core/ids.js — 确定性 ID 生成（任务书 2.3）
 *
 * ID 由 world.seq 计数器派生（而非随机），保证同种子同命令流下 ID 完全一致，
 * 且随存档保存/恢复后继续单调。
 */

const PREFIXES = {
  faction: 'fac',
  system: 'sys',
  planet: 'plt',
  colony: 'col',
  station: 'stn',
  ship: 'shp',
  fleet: 'flt',
  character: 'chr',
  blueprint: 'blu',
  anomaly: 'ano',
  groundMission: 'gms',
  war: 'war',
  treaty: 'try',
  crisis: 'crs',
  battle: 'btl',
  researchProject: 'rsp',
  buildQueue: 'bld',
  productionQueue: 'prq',
  tradeRoute: 'trd',
  survey: 'srv',
  event: 'evt',
  command: 'cmd',
  scheduled: 'sch',
  diplomacy: 'dip',
  intel: 'int',
};

/** 校验/补全前缀映射 */
export function prefixOf(kind) {
  const p = PREFIXES[kind];
  if (!p) throw new Error(`ids: 未知实体类别 ${kind}`);
  return p;
}

/** 分配下一个 ID（推进 world.seq） */
export function nextId(world, kind) {
  world.seq = (world.seq || 0) + 1;
  return `${prefixOf(kind)}_${world.seq}`;
}

/** 反解序号（调试用） */
export function seqOf(id) {
  const i = id.lastIndexOf('_');
  return i >= 0 ? parseInt(id.slice(i + 1), 36) : NaN;
}

/** 两阵营关系的确定性键（无序对 → 规范序） */
export function relationKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
