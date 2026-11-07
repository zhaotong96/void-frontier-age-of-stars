/**
 * domain/ground/terrainEdits.js — 地形整形编辑层（doc7 TASK-5.1 / §6.5 地形整形器）
 *
 * 职责：
 *  - 编辑日志（ops）：raise / lower / smooth / flatten / restore 五类刷子 + plant / removePlant 植被移植；
 *  - 刷子生效不直接改 terrainField 数据，而是挂进 field.evalPoint 的 siteModifier 合成链
 *    （attachTerrainEdits：既有 siteModifier（GroundView._fieldSiteModifier 采掘凹陷等）先评估，
 *     编辑层后评估 —— flatten / restore 因此可以覆写采掘凹陷，回任自然地貌）；
 *  - 每次编辑仅把受影响 Chunk 标脏（TERRAIN-06：刷子半径 ≤ chunkMeters/2 → 至多 2×2 = 4 个区块），
 *    邻接区块由下一帧增量重建；高度预算 [-40,+80] 仍由 evalPoint 统一钳制；
 *  - 紧凑 JSON 编辑命令序列（serializeEdits / deserializeEdits）供存档确定性重放（SITE-07）；
 *  - 建筑落位 9 点三角网格投影校验（doc7 TASK-5.2 / §6.8 坡度阈值）与主题专属桩基类型。
 *
 * 确定性（doc7 红线 4）：零 Math.random、零 world.rng；smooth 的局部均值与 flatten 的
 * 目标高度均在 applyEdit 时用 _macro 纯宏观场按固定采样点预计算（缓存可由
 * deserializeEdits 重建，逐位一致）；植被 seed 由 hash32(内容串) 派生。
 * 本文件为纯领域层：无 DOM / 无 WebGL。
 */

import { MIN_HEIGHT, MAX_HEIGHT, buildTriangulatedChunkMesh } from './terrainField.js';
import { hash32 } from './SurfaceSandbox.js';
import { sampleTerrain, slopeAt } from './surfaceQueries.js';

// ———— 常量 ————

/** 编辑日志 schema 版本（存档兼容性标记） */
export const TERRAIN_EDITS_VERSION = 1;

/**
 * 刷子参数上限（TERRAIN-06 增量重建约束）：
 * 半径 ≤ chunkMeters/2 → 圆盘至多跨 2×2 区块（4 个）；强度上限防止一次刷穿高度预算。
 */
export const BRUSH_LIMITS = {
  maxRadiusM: 32,        // 米；512m 场默认 64m 区块 → 至多 4 区块受影响
  maxStrokeM: 8,         // raise/lower 单次行程上限（米）
  minStrength: 0.001,
};

/**
 * 建筑落位阈值（doc7:273 image17/18 阈值公式图不可读，按 GAME-05..08 门禁语义自定
 * 并在此文档化 —— 后续读回原文图片时仅需改这里）：
 *  - 建筑底面 9 点（中心 + 4 角 + 4 边中点）投影到三角网格；
 *  - 任一点坡度 > maxSlopeDeg(16°，与 surfaceQueries.isBuildableSlope 默认一致) → 拒绝 SLOPE_TOO_STEEP；
 *  - 9 点最大高差 > maxHeightDeltaM(2.2m) → 拒绝 HEIGHT_DELTA（要求先整地/桩基）；
 *  - 高差 ≤ foundationGradeDeltaM(0.4m) 直接平铺；否则自动地基承台（graded）并按主题选桩基。
 */
export const BUILDING_PLACEMENT = {
  maxSlopeDeg: 16,
  maxHeightDeltaM: 2.2,
  foundationGradeDeltaM: 0.4,
  footprintHalfM: 3, // 6m × 6m 占地
};

/** 主题专属桩基（doc7 TASK-5.2：浮台 / 隔热基座 / 耐酸桩；未列主题 → 标准承台） */
const THEME_PILING = {
  obsidian_lava: 'thermal_base',      // 隔热基座（熔岩地表）
  sulfur_marsh: 'acid_pile',          // 耐酸桩（毒雾沼泽）
  abyssal_ocean: 'pontoon',           // 浮台（海洋/潮汐带）
  cryomethane_sea: 'pontoon',
  prism_crystal: 'standard',
  permafrost_furnace: 'insulated_base', // 隔热基座（冻土热区）
  dry_night_polar: 'insulated_base',
};

/** 编辑算子集合 */
const SHAPE_KINDS = new Set(['raise', 'lower', 'smooth', 'flatten', 'restore']);

// ———— 小工具 ————

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

/** 纯宏观场原始高度（不含 siteModifier 与编辑层）——smooth/flatten 的确定性基准 */
function pristineHeight(field, wx, wz) {
  const macro = field._macro;
  if (!macro || typeof macro.heightAt !== 'function') {
    throw new Error('terrainEdits: field 缺少 _macro 宏观场（须由 createTerrainField 构建）');
  }
  return clamp(macro.heightAt(wx, wz).y, MIN_HEIGHT, MAX_HEIGHT);
}

/** 平滑核：(1 - (d/r)^2)^2，d=r 处为 0（C1 连续，避免刷痕硬边） */
function brushFalloff(d, r) {
  if (d >= r) return 0;
  const t = 1 - (d * d) / (r * r);
  return t * t;
}

/**
 * 压平核：半径内圈（r/2）为全强度平台（建筑 9 点落位足印 ±3m 必须落在平芯内），
 * 外圈 (1-t²)² 平滑过渡到 0 —— 平芯 + 裙边，符合「压平建筑地基」的工具语义。
 */
function flattenFalloff(d, r) {
  const coreR = r * 0.5;
  if (d <= coreR) return 1;
  if (d >= r) return 0;
  const t = (d - coreR) / (r - coreR);
  const u = 1 - t * t;
  return u * u;
}

function chunkKeyOf(field, x, z) {
  const cx = clamp(Math.floor((x - field.originX) / field.chunkMeters), 0, field.chunksX - 1);
  const cz = clamp(Math.floor((z - field.originZ) / field.chunkMeters), 0, field.chunksZ - 1);
  return `${cx},${cz}`;
}

// ———— 编辑仓库 ————

/**
 * 创建编辑仓库（挂在一个地形场上，但只通过 siteModifier 合成链接入，
 * 不直接改写 terrainField 的任何缓冲）。
 */
export function createTerrainEdits(field) {
  if (!field || !Array.isArray(field.chunks)) {
    throw new Error('createTerrainEdits: 需要 createTerrainField 产出的地形场');
  }
  return {
    planetId: field.planetId,
    revision: 0,   // 每次成功 applyEdit +1（与存档快照 revision 对齐）
    seq: 0,        // 植被 id 序列（确定性 id 派生）
    ops: [],       // 时序编辑日志（内部规范形）
    byChunk: new Map(), // 'cx,cz' → [opIdx...]（按全局顺序追加；渲染增量重建索引）
    flora: [],     // 在场植被 [{ id, x, z, prefabId, seed }]
  };
}

/**
 * 预计算算子缓存（smooth 局部均值 / flatten 目标高度）。
 * 固定采样图案：中心 + 内环 8 点(0.55r) + 外环 8 点(0.92r)，全部取纯宏观场高度。
 * 缓存丢失（反序列化后）时惰性重建 —— 同输入逐位一致。
 */
function ensureOpCache(field, op) {
  if (op.kind === 'flatten') {
    if (op._targetY === undefined) op._targetY = pristineHeight(field, op.x, op.z);
    return;
  }
  if (op.kind === 'smooth') {
    if (op._avgY === undefined) {
      let sum = 0;
      let n = 0;
      sum += pristineHeight(field, op.x, op.z); n += 1;
      for (let ring = 0; ring < 2; ring++) {
        const rr = op.r * (ring === 0 ? 0.55 : 0.92);
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4;
          sum += pristineHeight(field, op.x + Math.cos(ang) * rr, op.z + Math.sin(ang) * rr);
          n += 1;
        }
      }
      op._avgY = sum / n;
    }
  }
}

/**
 * 应用一次编辑：校验 → 追加日志 → 标脏受影响区块（≤4）。
 * shape 算子 { kind, x, z, radius, strength }；plant { kind:'plant', x, z, prefabId, seed? }；
 * removePlant { kind:'removePlant', plantId }。
 * @returns {{ok:true, op:object, index:number, dirtyChunks:string[], floraId?:string}}
 * @throws {Error} 参数非法（命令层先行校验并映射错误码）
 */
export function applyEdit(field, edits, op) {
  if (!field || !edits || !op || typeof op !== 'object') {
    throw new Error('applyEdit: 缺少 field/edits/op');
  }
  const x = num(op.x, NaN);
  const z = num(op.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error('applyEdit: 坐标非法');
  }

  const dirtyChunks = [];
  let entry;

  if (op.kind === 'plant' || op.kind === 'removePlant') {
    if (op.kind === 'plant') {
      if (typeof op.prefabId !== 'string' || op.prefabId.length === 0) {
        throw new Error('applyEdit: plant 需要 prefabId');
      }
      edits.seq += 1;
      const id = op.id || `flora_${edits.seq}`;
      const seed = Number.isFinite(op.seed) ? (op.seed >>> 0)
        : (hash32(`${field.planetId}|${id}|${x.toFixed(3)}|${z.toFixed(3)}|${op.prefabId}`) >>> 0);
      entry = { kind: 'plant', x, z, id, prefabId: op.prefabId, seed };
      edits.flora.push({ id, x, z, prefabId: op.prefabId, seed });
    } else {
      if (typeof op.plantId !== 'string') throw new Error('applyEdit: removePlant 需要 plantId');
      entry = { kind: 'removePlant', x, z, plantId: op.plantId };
      const before = edits.flora.length;
      edits.flora = edits.flora.filter((f) => f.id !== op.plantId);
      if (edits.flora.length === before) {
        throw new Error(`applyEdit: 植被不存在 ${op.plantId}`);
      }
    }
  } else {
    if (!SHAPE_KINDS.has(op.kind)) throw new Error(`applyEdit: 未知算子 ${op.kind}`);
    const radius = num(op.radius, 8);
    if (!(radius > 0) || radius > Math.max(BRUSH_LIMITS.maxRadiusM, field.chunkMeters / 2)) {
      throw new Error(`applyEdit: 半径越界（0,${Math.min(BRUSH_LIMITS.maxRadiusM, field.chunkMeters / 2)}]）`);
    }
    const strength = num(op.strength, op.kind === 'smooth' || op.kind === 'flatten' ? 1 : 2);
    if (!(strength >= BRUSH_LIMITS.minStrength)) throw new Error('applyEdit: 强度过小');
    if ((op.kind === 'raise' || op.kind === 'lower') && strength > BRUSH_LIMITS.maxStrokeM) {
      throw new Error(`applyEdit: 行程强度上限 ${BRUSH_LIMITS.maxStrokeM}m`);
    }
    if ((op.kind === 'smooth' || op.kind === 'flatten') && strength > 1) {
      throw new Error('applyEdit: smooth/flatten 强度为混合系数 (0,1]');
    }
    entry = { kind: op.kind, x, z, r: radius, s: strength };
    ensureOpCache(field, entry);
  }

  edits.ops.push(entry);
  const index = edits.ops.length - 1;

  // 标脏：圆盘 AABB 覆盖的区块（半径 ≤ chunkMeters/2 → 至多 2×2 = 4 个，TERRAIN-06）
  const reach = entry.kind === 'plant' || entry.kind === 'removePlant' ? 0.5 : entry.r;
  const cxMin = clamp(Math.floor((x - reach - field.originX) / field.chunkMeters), 0, field.chunksX - 1);
  const cxMax = clamp(Math.floor((x + reach - field.originX) / field.chunkMeters), 0, field.chunksX - 1);
  const czMin = clamp(Math.floor((z - reach - field.originZ) / field.chunkMeters), 0, field.chunksZ - 1);
  const czMax = clamp(Math.floor((z + reach - field.originZ) / field.chunkMeters), 0, field.chunksZ - 1);
  for (let cz = czMin; cz <= czMax; cz++) {
    for (let cx = cxMin; cx <= cxMax; cx++) {
      const key = `${cx},${cz}`;
      let list = edits.byChunk.get(key);
      if (!list) {
        list = [];
        edits.byChunk.set(key, list);
      }
      list.push(index);
      const chunk = field.chunks[cz * field.chunksX + cx];
      if (chunk) chunk.dirty = true;
      dirtyChunks.push(key);
    }
  }

  edits.revision += 1;
  return { ok: true, op: entry, index, dirtyChunks, floraId: entry.kind === 'plant' ? entry.id : undefined };
}

// ———— evalPoint 合成链挂点 ————

/**
 * 编辑层逐点求值。restore 覆盖点重置此前全部编辑影响与 siteModifier 影响
 * （DSP 式「一键恢复自然地貌」）。
 * @param {number} siteDyIn 既有 siteModifier 已算得的 dy（先于编辑层评估）
 * @returns {number} 合成总 dy（0 = 无影响；无相关列表时原样透传 siteDyIn）
 */
function evalEditsDy(field, edits, wx, wz, baseY, siteDyIn) {
  const key = chunkKeyOf(field, wx, wz);
  const list = edits.byChunk.get(key);
  if (!list || list.length === 0) return siteDyIn;

  let siteApplied = siteDyIn; // 既有 siteModifier 影响（restore 可清零）
  let extra = 0;              // 编辑层累计

  for (let i = 0; i < list.length; i++) {
    const op = edits.ops[list[i]];
    const dx = wx - op.x;
    const dz = wz - op.z;
    const d = Math.sqrt(dx * dx + dz * dz);

    if (op.kind === 'restore') {
      if (d <= op.r) {
        // 一键恢复：清空此前编辑叠加 + siteModifier 叠加，回到纯宏观地貌
        extra = 0;
        siteApplied = 0;
      }
      continue;
    }

    const fall = op.kind === 'flatten' ? flattenFalloff(d, op.r) : brushFalloff(d, op.r);
    if (fall <= 0) continue;
    ensureOpCache(field, op);

    if (op.kind === 'raise') extra += op.s * fall;
    else if (op.kind === 'lower') extra -= op.s * fall;
    else if (op.kind === 'smooth') {
      // 盒式模糊语义：向预计算的局部均值收敛（applyEdit 时对纯宏观场采样）
      extra += (op._avgY - (baseY + siteApplied + extra)) * op.s * fall;
    } else if (op.kind === 'flatten') {
      // 压平：向算子中心纯宏观高度收敛 → 覆写采掘凹陷（凹陷先于编辑层计入运行高度）
      extra += (op._targetY - (baseY + siteApplied + extra)) * op.s * fall;
    }
  }
  return siteApplied + extra;
}

/**
 * 把编辑仓库接入 field.evalPoint 的 siteModifier 合成链：
 *   最终 dy = 既有 siteModifier dy（先评估；可被 restore 清零） + 编辑层 dy（后评估）。
 * 可重复调用（幂等）；再次 attach 会保留最初的地基 siteModifier（GroundView 凹陷等）。
 * @returns {Function} 合成后的 siteModifier（field.siteModifier）
 */
export function attachTerrainEdits(field, edits) {
  if (!field || !edits) throw new Error('attachTerrainEdits: 缺少 field/edits');
  if (field.__terrainEdits === edits && typeof field.siteModifier === 'function' && field.siteModifier.__terrainEdits) {
    return field.siteModifier; // 已挂接同一仓库
  }
  const underlying = field.__baseSiteModifier !== undefined ? field.__baseSiteModifier : field.siteModifier;
  field.__baseSiteModifier = underlying; // 保留地基（首次 attach 时为 GroundView/_digDents 链）

  const composed = (fx, fz, base) => {
    const baseY = num(base && base.y, 0);
    // 1) 既有 siteModifier（任务核心 SDF / 采掘凹陷）
    let siteDy = 0;
    let baseRes = null;
    if (typeof underlying === 'function') {
      baseRes = underlying(fx, fz, base);
      if (baseRes && Number.isFinite(baseRes.dy)) siteDy = baseRes.dy;
    }
    // 2) 编辑层（后评估：flatten/restore 可覆写凹陷；restore 清零 siteDy）
    const total = edits.ops.length === 0
      ? siteDy
      : evalEditsDy(field, edits, fx, fz, baseY, siteDy);
    if (!baseRes && total === 0) return null;
    // WP-0（doc18 v0.1.1）：语义旗透传——增量重建区块时保留路面材质与 clearFlags 安全豁免位
    return {
      ...(baseRes || null),
      dy: total,
      flags: (baseRes && baseRes.flags) || 0,
      clearFlags: (baseRes && baseRes.clearFlags) || 0,
      weights: (baseRes && baseRes.weights) || null,
      biomeId: (baseRes && baseRes.biomeId) != null ? baseRes.biomeId : null,
    };
  };
  composed.__terrainEdits = true;

  field.siteModifier = composed;
  field.__terrainEdits = edits;
  return composed;
}

// ———— 增量重建 ————

/**
 * 重建全部脏区块（meshRevision 对齐、dirty 清零）；返回重建数量。
 * GroundView 的帧同步也可只消费 chunk.dirty 自行重建 —— 本函数供域侧/测试复用。
 */
export function rebuildDirtyChunks(field) {
  if (!field || !Array.isArray(field.chunks)) return 0;
  let n = 0;
  for (let i = 0; i < field.chunks.length; i++) {
    const ch = field.chunks[i];
    if (ch && ch.dirty) {
      buildTriangulatedChunkMesh(ch, field.evalPoint);
      n += 1;
    }
  }
  return n;
}

// ———— 存档序列化（SITE-07：紧凑命令序列，确定性重放） ————

/**
 * 序列化为紧凑 JSON 字符串（键序固定 → 逐字节可复现；不含运行期缓存 _avgY/_targetY）。
 */
export function serializeEdits(edits) {
  if (!edits || !Array.isArray(edits.ops)) throw new Error('serializeEdits: 非法编辑仓库');
  const ops = [];
  for (const op of edits.ops) {
    if (op.kind === 'plant') {
      ops.push({ kind: 'plant', x: op.x, z: op.z, id: op.id, prefabId: op.prefabId, seed: op.seed });
    } else if (op.kind === 'removePlant') {
      ops.push({ kind: 'removePlant', x: op.x, z: op.z, plantId: op.plantId });
    } else {
      ops.push({ kind: op.kind, x: op.x, z: op.z, r: op.r, s: op.s });
    }
  }
  return JSON.stringify({ v: TERRAIN_EDITS_VERSION, rev: edits.revision, seq: edits.seq, ops });
}

/**
 * 反序列化（接受 JSON 字符串或已解析的 plain 对象）→ 活体编辑仓库。
 * 空串/缺字段 → 新仓库；shape 算子缓存由 ensureOpCache 在求值时确定性重建。
 */
export function deserializeEdits(json, field) {
  let plain = json;
  if (typeof json === 'string') {
    plain = json.trim().length === 0 ? null : JSON.parse(json);
  }
  const edits = field ? createTerrainEdits(field) : {
    planetId: null,
    revision: 0,
    seq: 0,
    ops: [],
    byChunk: new Map(),
    flora: [],
  };
  if (!plain || typeof plain !== 'object') return edits;
  edits.revision = Number.isFinite(plain.rev) ? plain.rev : 0;
  edits.seq = Number.isFinite(plain.seq) ? plain.seq : 0;
  const ops = Array.isArray(plain.ops) ? plain.ops : [];
  if (!field) {
    // 轻载模式：仅回放日志与植被（无场可标脏）
    for (const raw of ops) {
      const op = { ...raw };
      edits.ops.push(op);
      if (op.kind === 'plant') edits.flora.push({ id: op.id, x: op.x, z: op.z, prefabId: op.prefabId, seed: op.seed });
    }
    return edits;
  }
  // 带场重放：逐条 applyEdit 重建 byChunk 索引与脏标记（确定性；revision/seq 以日志为准）
  for (const raw of ops) {
    if (raw && (SHAPE_KINDS.has(raw.kind) || raw.kind === 'plant' || raw.kind === 'removePlant')) {
      edits.revision = Math.max(0, edits.revision - 1); // applyEdit 会 +1，维持存档 revision
      if (raw.kind === 'plant') edits.seq = Math.max(0, edits.seq - 1); // applyEdit 会 +1
      // 紧凑键 (r/s) → applyEdit 规范键 (radius/strength)
      applyEdit(field, edits, {
        kind: raw.kind,
        x: raw.x,
        z: raw.z,
        radius: raw.r,
        strength: raw.s,
        id: raw.id,
        prefabId: raw.prefabId,
        seed: raw.seed,
        plantId: raw.plantId,
      });
    }
  }
  if (Number.isFinite(plain.rev)) edits.revision = plain.rev;
  if (Number.isFinite(plain.seq)) edits.seq = plain.seq;
  return edits;
}

// ———— 建筑落位校验（doc7 TASK-5.2 / §6.8；doc7:188） ————

/** 主题 → 桩基类型（未列主题回退标准承台） */
export function foundationTypeForTheme(themeId) {
  return THEME_PILING[themeId] || 'standard';
}

/**
 * 建筑底面 9 点三角网格投影校验：
 * 采样点 = 中心 + 4 角 + 4 边中点（footprintHalfM 正方形），逐点 sampleTerrain。
 * @returns {{ ok:boolean, code?:'SLOPE_TOO_STEEP'|'HEIGHT_DELTA'|'OUT_OF_FIELD',
 *             maxSlopeDeg:number, maxHeightDeltaM:number,
 *             foundation?:{ kind:'flat'|'graded', piling:string, etaHeightM:number } }}
 * 通过时 foundation.etaHeightM = 9 点均高（承台基准高），piling 按主题解析。
 */
/**
 * doc22 WP-2：地形显著度（Topographic Prominence）严苛物理校验扩展。
 * 对空离子加农炮严禁在盆地低洼处盲目落位：
 *   1) 落位基准高程必须 ≥ 场域平均海拔 + 14.0m（平顶桌山/高脊）；
 *   2) 上方 60° 锥角视界内无更高山体遮挡（checkSkyOcclusionCone）。
 * @returns {{ok:boolean, reason?:string, code?:string, maxSlopeDeg?:number, maxHeightDeltaM?:number}}
 */
export function checkBuildingPlacementExtended(field, x, z, opts = {}) {
  const baseCheck = checkBuildingPlacement(field, x, z, opts);
  if (!baseCheck.ok) return baseCheck;

  if (opts.defId === 'bld_ion_battery') {
    const centerS = sampleTerrain(field, x, z);
    const centerElev = centerS && Number.isFinite(centerS.y) ? centerS.y : 0.0;
    const meanElev = fieldMeanElevation(field);

    // 1. 相对高程必须高出全图平均海拔 14.0 米以上（平顶桌山或高脊）
    if (centerElev < meanElev + 14.0) {
      return {
        ok: false,
        code: 'ProminenceTooLow',
        reason: `ProminenceTooLow: 必须修筑在平顶桌山或高脊之上（${centerElev.toFixed(1)}m < 均值 ${meanElev.toFixed(1)}m + 14m）`,
      };
    }

    // 2. 上方 60 度锥角视界校验（无更高山体遮挡射界）
    const blocked = fieldSkyOcclusionCone(field, x, z, centerElev, 60.0);
    if (blocked) {
      return { ok: false, code: 'SkyObstructed', reason: 'SkyObstructed: 射界被上方高耸山体阻挡' };
    }
  }
  return { ok: true };
}

/** 场域平均海拔（4m 步长抽样；确定性 O(N)） */
export function fieldMeanElevation(field) {
  if (!field) return 0.0;
  let sum = 0;
  let n = 0;
  for (let z = field.originZ + 8; z < field.originZ + field.sizeMeters; z += 16) {
    for (let x = field.originX + 8; x < field.originX + field.sizeMeters; x += 16) {
      const s = sampleTerrain(field, x, z);
      if (s && Number.isFinite(s.y)) { sum += s.y; n++; }
    }
  }
  return n > 0 ? sum / n : 0.0;
}

/** 60° 天顶锥角遮挡校验（8 方向 × 逐 8m 步进射线，任一方向仰角阻挡即 true） */
export function fieldSkyOcclusionCone(field, x, z, elevM, coneDeg) {
  const tanHalf = Math.tan((coneDeg / 2) * Math.PI / 180);
  const maxDist = 96;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    for (let d = 8; d <= maxDist; d += 8) {
      const s = sampleTerrain(field, x + dx * d, z + dz * d);
      if (s && Number.isFinite(s.y) && s.y > elevM + tanHalf * d) return true;
    }
  }
  return false;
}

export function checkBuildingPlacement(field, x, z, opts = {}) {
  const half = num(opts.footprintHalfM, BUILDING_PLACEMENT.footprintHalfM);
  const maxSlope = num(opts.maxSlopeDeg, BUILDING_PLACEMENT.maxSlopeDeg);
  const maxDelta = num(opts.maxHeightDeltaM, BUILDING_PLACEMENT.maxHeightDeltaM);

  const offs = [[0, 0], [half, half], [-half, half], [half, -half], [-half, -half],
    [half, 0], [-half, 0], [0, half], [0, -half]];
  let maxY = -Infinity;
  let minY = Infinity;
  let sum = 0;
  let n = 0;
  let maxSlopeSeen = 0;

  for (const [ox, oz] of offs) {
    const px = x + ox;
    const pz = z + oz;
    const s = sampleTerrain(field, px, pz);
    if (!s) {
      return { ok: false, code: 'OUT_OF_FIELD', maxSlopeDeg: NaN, maxHeightDeltaM: NaN };
    }
    const sl = slopeAt(field, px, pz);
    if (Number.isFinite(sl) && sl > maxSlopeSeen) maxSlopeSeen = sl;
    maxY = Math.max(maxY, s.y);
    minY = Math.min(minY, s.y);
    sum += s.y;
    n += 1;
  }

  const delta = maxY - minY;
  if (maxSlopeSeen > maxSlope) {
    return { ok: false, code: 'SLOPE_TOO_STEEP', maxSlopeDeg: maxSlopeSeen, maxHeightDeltaM: delta };
  }
  if (delta > maxDelta) {
    return { ok: false, code: 'HEIGHT_DELTA', maxSlopeDeg: maxSlopeSeen, maxHeightDeltaM: delta };
  }
  return {
    ok: true,
    maxSlopeDeg: maxSlopeSeen,
    maxHeightDeltaM: delta,
    foundation: {
      kind: delta > BUILDING_PLACEMENT.foundationGradeDeltaM ? 'graded' : 'flat',
      piling: foundationTypeForTheme(opts.themeId),
      etaHeightM: sum / n,
    },
  };
}

// ———— P1-2 殖民地等高线感知布局规划器（doc8 §3.2 议题 B2 仲裁落地） ————

/** 黄金角（与 doc8 B2 一致）与过渡环带半径（22m–75m） */
export const COLONY_LAYOUT = { goldenAngle: 2.399963229728653, ringMinM: 22, ringMaxM: 75, footprintHalfM: 2.2, maxSlopeDeg: 16, maxHeightDeltaM: 2.2, minSpacingM: 6, skirtDepthM: 1.8 };

/**
 * 等高线感知的殖民地布局规划（纯函数、确定性、无 DOM）：
 *  - groundBuildings（PlaceBuilding 已定三维坐标）原样保留；
 *  - 未定坐标建筑在过渡环带（22–75m）内按黄金角候选序列搜索
 *    checkBuildingPlacement（9 点坡度 ≤16°、高差 ≤2.2m）的平坦台地；
 *  - mining 类优先吸附 TERRAIN_FLAGS.ORE 标记点；
 *  - 基准高程 = 9 点最高点 × 0.35 + 均高 × 0.65（防止任何一角插入山体）；
 *  - 朝向对齐等高线切线（梯度垂线）。
 * @param {object} field terrainField 场域
 * @param {{entries:Array<{defId:string,state?:string}>, groundBuildings?:Array, center:[number,number], categoryOf:(defId:string)=>string, themeId?:string}} opts
 * @returns {Array<{defId:string,state:string,fx:number,fz:number,y:number,rotY:number,category:string,placement:Object|null}>}
 */
export function planColonyLayout(field, opts = {}) {
  const L = COLONY_LAYOUT;
  const entries = opts.entries || [];
  const ground = opts.groundBuildings || [];
  const center = opts.center || [0, 0];
  const categoryOf = opts.categoryOf || (() => 'default');
  const out = [];
  const placed = [];
  for (const gb of ground) {
    if (!gb || !Number.isFinite(gb.x) || !Number.isFinite(gb.z)) continue;
    placed.push({ x: gb.x, z: gb.z });
    const chk = checkBuildingPlacement(field, gb.x, gb.z, { footprintHalfM: L.footprintHalfM, maxSlopeDeg: L.maxSlopeDeg, maxHeightDeltaM: L.maxHeightDeltaM });
    out.push({ defId: gb.defId || 'default', state: gb.state || 'built', fx: gb.x, fz: gb.z, y: gb.y != null ? gb.y : (Number.isFinite(chk.baseY) ? chk.baseY : 0), rotY: gb.rotY || 0, category: categoryOf(gb.defId || 'default'), placement: chk });
  }
  for (let i = 0; i < entries.length && out.length < 24; i++) {
    const e = entries[i];
    const cat = categoryOf(e.defId);
    let chosen = null;
    let lastChk = null;
    let chosenMaxY = 0;
    let chosenAvgY = 0;
    // 黄金角候选序列：过渡环带内的确定性平地寻址（最多 1200 候选；崎岖主题如熔岩/黑曜平坦台地稀疏，需大搜索量）
    for (let k = 0; k < 1200 && !chosen; k++) {
      const a = k * L.goldenAngle;
      const r = L.ringMinM + (L.ringMaxM - L.ringMinM) * ((k * 0.6180339887) % 1);
      const fx = center[0] + Math.cos(a) * r;
      const fz = center[1] + Math.sin(a) * r;
      const chk = checkBuildingPlacement(field, fx, fz, { footprintHalfM: L.footprintHalfM, maxSlopeDeg: L.maxSlopeDeg, maxHeightDeltaM: L.maxHeightDeltaM });
      lastChk = chk;
      if (!chk.ok) continue;
      // 自采样 9 点：chk 不外露 maxY/avgY/flags，布局器自行求基准高程与 ORE 判定
      const offs = [[0, 0], [2.2, 2.2], [-2.2, 2.2], [2.2, -2.2], [-2.2, -2.2], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]];
      let maxY = -Infinity; let sum = 0; let flagsAny = 0; let n = 0;
      for (const [ox, oz] of offs) {
        const sp = sampleTerrain(field, fx + ox, fz + oz);
        if (!sp) continue;
        maxY = Math.max(maxY, sp.y); sum += sp.y; flagsAny |= sp.flags; n++;
      }
      if (!n) continue;
      const avgY = sum / n;
      chosenMaxY = maxY;
      chosenAvgY = avgY;
      // 间距：距已落位建筑 ≥ minSpacingM
      let spaced = true;
      for (const q of placed) {
        if (Math.hypot(q.x - fx, q.z - fz) < L.minSpacingM) { spaced = false; break; }
      }
      if (!spaced) continue;
      // mining 优先 ORE 标记点（前 60 个候选内未命中 ORE 则放宽，保证必然落位）
      if (cat === 'mining' && k < 200 && !(flagsAny & 16)) continue;
      chosen = { fx, fz, chk };
    }
    if (!chosen && lastChk && lastChk.ok) chosen = { fx: center[0], fz: center[1], chk: lastChk };
    if (!chosen) continue; // 生成质量门禁未过 → 该建筑本轮不落位（绝不盲盒撒点）
    placed.push({ x: chosen.fx, z: chosen.fz });
    const chk = chosen.chk;
    // 基准高程：最高点 0.35 + 均高 0.65 加权（doc8 B2 公式）
    const y = chosenMaxY * 0.35 + chosenAvgY * 0.65;
    // 朝向：等高线切线 = 梯度垂线
    const gx = (sampleTerrain(field, chosen.fx + 2, chosen.fz).y - sampleTerrain(field, chosen.fx - 2, chosen.fz).y) || 0;
    const gz = (sampleTerrain(field, chosen.fx, chosen.fz + 2).y - sampleTerrain(field, chosen.fx, chosen.fz - 2).y) || 0;
    const rotY = Math.abs(gx) + Math.abs(gz) > 1e-6 ? Math.atan2(gz, gx) + Math.PI / 2 : (i * 0.618) % 1 * Math.PI * 2;
    out.push({ defId: e.defId, state: e.state || 'built', fx: chosen.fx, fz: chosen.fz, y, rotY, category: cat, placement: chk });
  }
  return out;
}
