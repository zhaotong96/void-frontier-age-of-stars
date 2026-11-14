/**
 * domain/planets/sparseFrontierCA.js — 256-Tile 稀疏前沿位掩码元胞自动机
 * （SPEC-PLAN-045 阶段二 M2 Task 2.2；责任人：Eng-A）
 *
 * 职责（doc45 §Task 2.2 逐条契约）：
 *  1. frontierMask[8] 位图 API（setFrontier/clearFrontier/hasFrontier/frontierCount）：
 *     第 k 个 Tile（k = y×16 + x，k ∈ [0,255]）对应 wordIdx = k >>> 5、bitIdx = k & 31；
 *  2. stepSparseFrontierCA(world, planet, dtMonth)：planet.compactState 存在才动；
 *     对 8 个 word 逐个扫描（w === 0 continue），lsb 提取定位活跃位——
 *       const lsb = w & -w; const bitIdx = 31 - Math.clz32(lsb);
 *       const tileIdx = (wordIdx << 5) | bitIdx; w ^= lsb;
 *     扩散判定 deriveSeed(world.seed, DOMAIN_SALTS.PLANET_SURFACE_CA, planet.id,
 *     (world.tick << 8) | tileIdx)（planet.id 取 compact.id = numericEntityKey(planet.id)
 *     规范化数字键，与 planetStateSchema.seedCompactTiles 同流）；
 *  3. 四类相变规则（overlayId 见 planetStateSchema 位段表 Bits 22–25）：
 *     A 菌丝温床（overlay 1，envVector[2] > 35）：概率 p = 0.08 + 0.004×envVector[2]
 *       吞噬相邻森林/湿地/荒漠格（biome 1/2/6）；邻格 SHIELDED（Bit 28）或重工业高热
 *       （buildingId 32–47）→ 受阻并从 frontierMask 清除该饱和格（契约逐字：受阻格不扩散）；
 *     B 地幔熔岩（overlay 2，envVector[0] > 50）：沿 elevation ≤ 5 低地流淌，烧毁沿途
 *       普通采集建筑（buildingId 1–15 清零 + DEVASTATED 置位），25% 概率冷却凝为
 *       高丰度矿脉（depositCode 低 2 位丰度阶 +1，上限 3）；SHIELDED 格免疫；
 *     C 极寒冰盖（overlay 3）：envVector[5] < 25 由极地行 y=0/15 向赤道推进；
 *       envVector[5] > 65 融退缩为远古海洋（biome 3）且 envVector[6] 提升；
 *     D 先驱者晶格（overlay 4，envVector[3] > 50）：围绕先驱者地标（buildingId 48–63）
 *       向外结晶，赋予格点奇异水晶矿脉（deposit 类型 2，即高 2 位 = 2）。
 *     新激活格置 FRONTIER_ACTIVE 并入 frontierMask；饱和格（无有效扩散目标/受阻）清除；
 *  4. seedFrontierRing(planet)：把 24 个确定性边界位（60 格外圈周边 + 与 60 互素步进）
 *     种入 frontierMask（性能基准用；仅置掩码位，不改 Tile）。
 *
 * 语义裁决（施工 notes 同步记录）：
 *  - 掩码词快照（mask.slice 快照读 / 活跃位图写）：本步 1-hop 语义，新激活位次步才成
 *    源格，杜绝同帧级联与扫描序依赖；Tile 本体读活跃值（先写者赢，同格冲突确定）；
 *  - 主判定 roll 每 tile 每步至多消费一次（仅 A 扩散门 / B 凝矿 / D 丰度抽取）；
 *    规则 C 为确定性规则不消费 roll；
 *  - A 的「受阻」为契约逐字裁决：四邻中存在 SHIELDED 或重工业高热格即判定受阻，
 *    该饱和格清除且本步不扩散（即使其余邻格可吞噬）；
 *  - overlay 0 的前沿位（如 seedFrontierRing 基准位）为休眠待命格：无覆盖层即无规则，
 *    保留在掩码中（规则 D 成核除外：前沿位上的地标建筑在 env[3]>50 时原地晶格化）；
 *  - SHIELD（Bit 28）为地表静滞语义：对 A/B 显式受阻（doc45 契约），对 C/D 同样免疫
 *    （护盾格不冻结、不结晶，四规则统一）；
 *  - 热循环零分配：Tile 字段全部位运算直读直写（不构造 unpack 对象），邻格用标量。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - 本模块不注册任何 TickPipeline 阶段（由集成层在其阶段内逐星调用）；
 *  - stepSparseFrontierCA 仅动 planet.compactState 已挂载的行星（惰性容器守卫）；
 *  - 确定性随机一律 deriveSeed/sampleFloat01 + DOMAIN_SALTS.PLANET_SURFACE_CA，
 *    严禁 Math.random / Date.now；import 期零副作用（仅构建冻结常量表）。
 */

import { DOMAIN_SALTS, sampleFloat01 } from '../world/deterministicRng.js';
import { STATUS_FLAG, numericEntityKey } from './planetStateSchema.js';

/* ============================== 常量表（位段契约见 planetStateSchema.js:44-54） ============================== */

/** 动态覆盖层 ID（doc45 §Task 2.2 §1 + planetStateSchema overlayId 位段语义） */
const OVERLAY_MYCELIUM = 1; // 共生菌丝网（规则 A）
const OVERLAY_LAVA = 2; // 喷发熔岩流（规则 B）
const OVERLAY_ICE = 3; // 极寒冰封（规则 C）
const OVERLAY_LATTICE = 4; // 先驱者谐振晶格（规则 D）

/** 规则 A 可吞噬生物群系（doc45：森林 2 / 湿地 6 / 荒漠 1） */
const EDIBLE_BIOMES = (() => {
  const t = new Uint8Array(16);
  t[1] = 1; // 荒漠
  t[2] = 1; // 森林
  t[6] = 1; // 湿地
  return t;
})();

/** 建筑段语义（planetStateSchema.js:50-51）：1–15 基础采集 / 32–47 奇异工业 / 48–63 先驱者奇观 */
const BUILDING_ORDINARY_LO = 1;
const BUILDING_ORDINARY_HI = 15;
const BUILDING_HEAVY_LO = 32;
const BUILDING_HEAVY_HI = 47;
const BUILDING_LANDMARK_LO = 48;
const BUILDING_LANDMARK_HI = 63;

/** 规则 B 熔岩凝矿概率（doc45：25%） */
const LAVA_CONDENSE_PROB = 0.25;

/** 规则 B 低地流淌海拔上限（doc45：elevation ≤ 5） */
const LAVA_LOWLAND_MAX_ELEV = 5;

/** 规则 C 每格融化对 envVector[6]（HydrosphereLevel）的提升量（M2 粗配常量） */
const HYDRO_GAIN_PER_MELT = 0.05;

/** 规则 A 菌丝吞噬概率 p = 0.08 + 0.004 × envVector[2]（doc45 精确公式） */
function myceliumSpreadProb(biosphereMutation) {
  return 0.08 + 0.004 * biosphereMutation;
}

/** 四邻域偏移（冻结表；东/西/南/北） */
const NEIGHBOR_DX = Object.freeze([1, -1, 0, 0]);
const NEIGHBOR_DY = Object.freeze([0, 0, 1, -1]);

/* ============================== frontierMask[8] 位图 API（doc45 Task 2.2 §1） ============================== */

function requireMask(mask) {
  if (!Array.isArray(mask) || mask.length !== 8) {
    throw new Error('SO: frontierMask 须为长度 8 的位图数组');
  }
}

function requireTileIdx(tileIdx) {
  const k = tileIdx | 0;
  if (!Number.isInteger(tileIdx) || k < 0 || k > 255) {
    throw new Error(`SO: frontier tileIdx 须为 0..255 整数（实测 ${String(tileIdx)}）`);
  }
  return k;
}

/** 置位第 k 个 Tile 的前沿位（k = y×16+x；wordIdx = k>>>5、bitIdx = k&31） */
export function setFrontier(frontierMask, tileIdx) {
  requireMask(frontierMask);
  const k = requireTileIdx(tileIdx);
  frontierMask[k >>> 5] = (frontierMask[k >>> 5] | (1 << (k & 31))) >>> 0;
  return k;
}

/** 清位第 k 个 Tile 的前沿位 */
export function clearFrontier(frontierMask, tileIdx) {
  requireMask(frontierMask);
  const k = requireTileIdx(tileIdx);
  frontierMask[k >>> 5] = (frontierMask[k >>> 5] & ~(1 << (k & 31))) >>> 0;
  return k;
}

/** 查询第 k 个 Tile 是否在活跃前沿 */
export function hasFrontier(frontierMask, tileIdx) {
  requireMask(frontierMask);
  const k = requireTileIdx(tileIdx);
  return ((frontierMask[k >>> 5] >>> (k & 31)) & 1) === 1;
}

/** 前沿位总数（8 word 并行位计数，零分配） */
export function frontierCount(frontierMask) {
  requireMask(frontierMask);
  let count = 0;
  for (let i = 0; i < 8; i++) {
    let v = frontierMask[i] >>> 0;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    count += (Math.imul(v, 0x01010101) >>> 24);
  }
  return count;
}

/* ============================== Tile 位段直读直写辅助（热循环零分配） ============================== */

function withBiome(t, biomeId) {
  return ((t & ~0x0f) | (biomeId & 0x0f)) >>> 0;
}

function withElevation(t, elevation) {
  return ((t & ~(0x0f << 4)) | ((elevation & 0x0f) << 4)) >>> 0;
}

function withDeposit(t, depositCode) {
  return ((t & ~(0x0f << 12)) | ((depositCode & 0x0f) << 12)) >>> 0;
}

function withBuilding(t, buildingId) {
  return ((t & ~(0x3f << 16)) | ((buildingId & 0x3f) << 16)) >>> 0;
}

function withOverlay(t, overlayId) {
  return ((t & ~(0x0f << 22)) | ((overlayId & 0x0f) << 22)) >>> 0;
}

function withFlags(t, statusFlags) {
  return ((t & ~(0x3f << 26)) | ((statusFlags & 0x3f) << 26)) >>> 0;
}

/** 掩码置位/清位（内联形态：调用方保证 mask 结构，热路径零校验开销） */
function maskSet(mask, tileIdx) {
  mask[tileIdx >>> 5] = (mask[tileIdx >>> 5] | (1 << (tileIdx & 31))) >>> 0;
}

function maskClear(mask, tileIdx) {
  mask[tileIdx >>> 5] = (mask[tileIdx >>> 5] & ~(1 << (tileIdx & 31))) >>> 0;
}

/** 激活格：置 FRONTIER_ACTIVE 旗标并入 frontierMask */
function activateTile(mask, tiles, tileIdx) {
  const t = tiles[tileIdx] >>> 0;
  const flags = ((t >>> 26) & 0x3f) | STATUS_FLAG.FRONTIER_ACTIVE;
  tiles[tileIdx] = withFlags(t, flags);
  maskSet(mask, tileIdx);
}

/** 饱和格清除：清掩码位 + 清 Tile 的 FRONTIER_ACTIVE 旗标（相变完成/受阻退场） */
function saturateTile(mask, tiles, tileIdx) {
  const t = tiles[tileIdx] >>> 0;
  const flags = ((t >>> 26) & 0x3f) & ~STATUS_FLAG.FRONTIER_ACTIVE;
  tiles[tileIdx] = withFlags(t, flags);
  maskClear(mask, tileIdx);
}

/* ============================== 四类相变规则（doc45 Task 2.2 §2 逐条） ============================== */

/**
 * 规则 A 菌丝温床蔓延（overlay 1）：envVector[2] > 35 时以
 * p = 0.08 + 0.004×envVector[2] 吞噬相邻森林/湿地/荒漠格。
 * 契约裁决：任一邻格 SHIELDED 或重工业高热（buildingId 32–47）→ 受阻 → 该饱和格
 * 清出 frontierMask 且本步不扩散；无可吞噬邻格同样视为饱和清除。
 */
function ruleMycelium(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats) {
  if (!(env[2] > 35)) return; // 门控未开：待命
  const f = sampleFloat01(seed, DOMAIN_SALTS.PLANET_SURFACE_CA, planetKey, (tick << 8) | tileIdx);

  // —— 邻域干跑检定（blocked / 可吞噬目标数；零分配）——
  let blocked = false;
  let targets = 0;
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nIdx = ny * 16 + nx;
    const nt = tiles[nIdx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) { blocked = true; continue; }
    const nBuilding = (nt >>> 16) & 0x3f;
    if (nBuilding >= BUILDING_HEAVY_LO && nBuilding <= BUILDING_HEAVY_HI) { blocked = true; continue; }
    if (((nt >>> 22) & 0x0f) !== 0) continue; // 已有覆盖层：非吞噬对象
    if (EDIBLE_BIOMES[nt & 0x0f] === 1) targets++;
  }
  if (blocked || targets === 0) {
    saturateTile(mask, tiles, tileIdx); // 受阻/饱和：清出 frontierMask（契约逐字）
    stats.saturated++;
    return;
  }

  const p = myceliumSpreadProb(env[2]);
  if (f >= p) return; // 本步未触发扩散：保持前沿待命

  // —— 施展：吞噬全部可吞噬邻格（先写者赢；干跑/施展间无状态变更，计数一致）——
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nIdx = ny * 16 + nx;
    const nt = tiles[nIdx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue;
    const nBuilding = (nt >>> 16) & 0x3f;
    if (nBuilding >= BUILDING_HEAVY_LO && nBuilding <= BUILDING_HEAVY_HI) continue;
    if (((nt >>> 22) & 0x0f) !== 0) continue;
    if (EDIBLE_BIOMES[nt & 0x0f] !== 1) continue;
    tiles[nIdx] = withOverlay(nt, OVERLAY_MYCELIUM);
    activateTile(mask, tiles, nIdx);
    stats.activated++;
  }
}

/**
 * 规则 B 地幔熔岩侵蚀（overlay 2）：envVector[0] > 50 时沿 elevation ≤ 5 低地流淌，
 * 烧毁沿途普通采集建筑（buildingId 1–15 清零 + DEVASTATED），25% 概率冷却凝为
 * 高丰度矿脉（depositCode 丰度阶 +1 上限 3）；SHIELDED 格免疫（不流淌不入）。
 */
function ruleLava(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats) {
  if (!(env[0] > 50)) return; // 门控未开：待命
  const f = sampleFloat01(seed, DOMAIN_SALTS.PLANET_SURFACE_CA, planetKey, (tick << 8) | tileIdx);

  // —— 冷却凝矿（主判定 roll < 25%：本格 depositCode 丰度阶 +1，上限 3；无矿脉不变）——
  if (f < LAVA_CONDENSE_PROB) {
    const t = tiles[tileIdx] >>> 0;
    const dc = (t >>> 12) & 0x0f;
    if (dc > 0 && (dc & 0x03) < 3) {
      tiles[tileIdx] = withDeposit(t, dc + 1);
    }
  }

  // —— 本格普通采集建筑烧毁（熔岩格不存采集区划）——
  const t0 = tiles[tileIdx] >>> 0;
  const building = (t0 >>> 16) & 0x3f;
  if (building >= BUILDING_ORDINARY_LO && building <= BUILDING_ORDINARY_HI) {
    const flags = (((t0 >>> 26) & 0x3f) | STATUS_FLAG.DEVASTATED);
    tiles[tileIdx] = withFlags(withBuilding(t0, 0), flags);
  }

  // —— 邻域干跑检定：低地（elevation ≤ 5）+ 无覆盖层 + 非护盾 ——
  let targets = 0;
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nt = tiles[ny * 16 + nx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue; // SHIELDED 格免疫
    if (((nt >>> 22) & 0x0f) !== 0) continue;
    if (((nt >>> 4) & 0x0f) <= LAVA_LOWLAND_MAX_ELEV) targets++;
  }
  if (targets === 0) {
    saturateTile(mask, tiles, tileIdx); // 无低地可流：熔岩前沿饱和退场
    stats.saturated++;
    return;
  }

  // —— 施展：向全部低地邻格流淌（覆盖熔岩 + 烧毁建筑 + 激活前沿）——
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nIdx = ny * 16 + nx;
    const nt = tiles[nIdx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue;
    if (((nt >>> 22) & 0x0f) !== 0) continue;
    if (((nt >>> 4) & 0x0f) > LAVA_LOWLAND_MAX_ELEV) continue;
    const nBuilding = (nt >>> 16) & 0x3f;
    let burned = nt;
    if (nBuilding >= BUILDING_ORDINARY_LO && nBuilding <= BUILDING_ORDINARY_HI) {
      burned = withBuilding(nt, 0);
      burned = withFlags(burned, (((nt >>> 26) & 0x3f) | STATUS_FLAG.DEVASTATED));
    }
    tiles[nIdx] = withOverlay(burned, OVERLAY_LAVA);
    activateTile(mask, tiles, nIdx);
    stats.activated++;
  }
}

/**
 * 规则 C 极寒冰盖进退（overlay 3）：envVector[5] < 25 由极地向赤道推进
 * （y ≤ 7 向 y+1、y ≥ 8 向 y−1，晨昏收敛）；envVector[5] > 65 融退缩为远古海洋
 * （biome 3 + 覆盖层清除）且 envVector[6]（HydrosphereLevel）提升；SHIELDED 格不冻结。
 */
function ruleIce(mask, tiles, env, tileIdx, x, y, stats) {
  const thermal = env[5];
  if (thermal > 65) {
    // —— 融退缩：biome 3 + 覆盖层清除 + 前沿退场；水量按格累计（循环外统一入账）——
    const t = tiles[tileIdx] >>> 0;
    const flags = ((t >>> 26) & 0x3f) & ~STATUS_FLAG.FRONTIER_ACTIVE;
    tiles[tileIdx] = withFlags(withOverlay(withBiome(t, 3), 0), flags);
    maskClear(mask, tileIdx);
    stats.melted++;
    return;
  }
  if (!(thermal < 25)) return; // [25, 65] 滞止带：待命

  // —— 向赤道推进：唯一赤道向邻格；受阻（护盾/已有覆盖层）即饱和清除 ——
  const ny = y <= 7 ? y + 1 : y - 1;
  const nIdx = ny * 16 + x;
  const nt = tiles[nIdx] >>> 0;
  const shielded = ((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0;
  if (shielded || ((nt >>> 22) & 0x0f) !== 0) {
    saturateTile(mask, tiles, tileIdx); // 冰锋触盾/触已有覆盖：饱和退场
    stats.saturated++;
    return;
  }
  tiles[nIdx] = withOverlay(nt, OVERLAY_ICE);
  activateTile(mask, tiles, nIdx);
  stats.activated++;
}

/**
 * 规则 D 先驱者晶格复苏（overlay 4）：envVector[3] > 50 时向外结晶，赋予格点
 * 奇异水晶矿脉（deposit 类型 2；丰度由主判定 roll 确定 1..3，已有矿脉则丰度阶 +1）；
 * SHIELDED 格不结晶。
 */
function ruleLattice(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats) {
  if (!(env[3] > 50)) return; // 门控未开：待命
  const f = sampleFloat01(seed, DOMAIN_SALTS.PLANET_SURFACE_CA, planetKey, (tick << 8) | tileIdx);
  const gainAbundance = 1 + (Math.floor(f * 3) % 3); // 1..3（确定性抽取）

  // —— 邻域干跑检定 ——
  let targets = 0;
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nt = tiles[ny * 16 + nx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue; // SHIELDED 格不结晶
    if (((nt >>> 22) & 0x0f) !== 0) continue;
    targets++;
  }
  if (targets === 0) {
    saturateTile(mask, tiles, tileIdx); // 晶格完全包围：饱和退场
    stats.saturated++;
    return;
  }

  // —— 施展：结晶全部空白邻格并赋予水晶矿脉 ——
  for (let q = 0; q < 4; q++) {
    const nx = x + NEIGHBOR_DX[q];
    const ny = y + NEIGHBOR_DY[q];
    if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
    const nIdx = ny * 16 + nx;
    const nt = tiles[nIdx] >>> 0;
    if (((nt >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) !== 0) continue;
    if (((nt >>> 22) & 0x0f) !== 0) continue;
    const dc = (nt >>> 12) & 0x0f;
    let granted = nt;
    if (dc === 0) {
      granted = withDeposit(nt, (2 << 2) | gainAbundance); // 类型 2 奇异水晶 + 丰度 1..3
    } else if ((dc & 0x03) < 3) {
      granted = withDeposit(nt, dc + 1); // 已有矿脉：丰度阶 +1（上限 3，保留类型）
    }
    tiles[nIdx] = withOverlay(granted, OVERLAY_LATTICE);
    activateTile(mask, tiles, nIdx);
    stats.activated++;
  }
}

/* ============================== 稀疏前沿 CA 步进（doc45 Task 2.2 §2） ============================== */

/**
 * 256-Tile 稀疏前沿元胞自动机月度步进。
 *
 * 扫描形态（doc45 §Task 2.2 §2 逐表达式）：
 *   for wordIdx = 0..7：let w = snap[wordIdx]; if (w === 0) continue;
 *     do { const lsb = w & -w; const bitIdx = 31 - Math.clz32(lsb);
 *          const tileIdx = (wordIdx << 5) | bitIdx; w ^= lsb; … } while (w !== 0);
 *
 * @param {object} world - 世界根对象（读 world.seed / world.tick，绝不读 world.rng）
 * @param {object} planet - 行星实体（compactState 存在才动；未挂载零写入）
 * @param {number} dtMonth - 折算月份数（契约占位：月度 CA 为离散事件步，速率折算由
 *                           SpaceOperaClock 的 envVector 向基线漂移承担）
 * @returns {{scanned: number, activated: number, saturated: number, melted: number}} 本步统计
 */
export function stepSparseFrontierCA(world, planet, dtMonth) {
  void dtMonth; // 契约占位（签名含 dtMonth；离散 CA 步不消费，杜绝误用累积步长）
  const stats = { scanned: 0, activated: 0, saturated: 0, melted: 0 };
  if (!world || typeof world !== 'object' || !planet || typeof planet !== 'object') return stats;
  const compact = planet.compactState; // 惰性容器守卫：未触达行星零写入零漂移
  if (!compact || typeof compact !== 'object') return stats;
  const mask = compact.frontierMask;
  const tiles = compact.tiles;
  const env = compact.envVector;
  if (!Array.isArray(mask) || mask.length !== 8) return stats;
  if (!Array.isArray(tiles) || tiles.length !== 256) return stats;
  if (!Array.isArray(env) || env.length < 8) return stats;

  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const planetKey = compact.id | 0; // numericEntityKey(planet.id)（ensureCompactPlanetState 规范化键）

  // —— 词快照：本步 1-hop 语义（快照读 / 活跃位图写；新激活位次步才成源格）——
  const snap = [
    mask[0] >>> 0, mask[1] >>> 0, mask[2] >>> 0, mask[3] >>> 0,
    mask[4] >>> 0, mask[5] >>> 0, mask[6] >>> 0, mask[7] >>> 0,
  ];

  for (let wordIdx = 0; wordIdx < 8; wordIdx++) {
    let w = snap[wordIdx];
    if (w === 0) continue;
    do {
      const lsb = w & -w;
      const bitIdx = 31 - Math.clz32(lsb);
      const tileIdx = (wordIdx << 5) | bitIdx;
      w ^= lsb;
      stats.scanned++;

      const t = tiles[tileIdx] >>> 0;
      const overlay = (t >>> 22) & 0x0f;
      const x = tileIdx & 15;
      const y = tileIdx >>> 4;

      if (overlay === 0) {
        // —— 休眠前沿位：唯一特例为规则 D 成核——前沿位上的先驱者地标
        //    （buildingId 48–63）在 env[3] > 50 时原地晶格化，次步成为结晶源格 ——
        if (env[3] > 50
          && ((t >>> 26) & 0x3f & STATUS_FLAG.SHIELDED) === 0) {
          const building = (t >>> 16) & 0x3f;
          if (building >= BUILDING_LANDMARK_LO && building <= BUILDING_LANDMARK_HI) {
            tiles[tileIdx] = withOverlay(t, OVERLAY_LATTICE);
          }
        }
        continue;
      }
      if (overlay === OVERLAY_MYCELIUM) {
        ruleMycelium(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats);
      } else if (overlay === OVERLAY_LAVA) {
        ruleLava(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats);
      } else if (overlay === OVERLAY_ICE) {
        ruleIce(mask, tiles, env, tileIdx, x, y, stats);
      } else if (overlay === OVERLAY_LATTICE) {
        ruleLattice(mask, tiles, env, seed, tick, planetKey, tileIdx, x, y, stats);
      }
      // overlay 5–7（虫族菌毯/工业毒雾/坍塌坑洞）：M2 四规则之外，保留待命
    } while (w !== 0);
  }

  // —— 规则 C 融化水量统一入账（envVector[6] 提升；上限 100）——
  if (stats.melted > 0) {
    const hydro = env[6] + HYDRO_GAIN_PER_MELT * stats.melted;
    env[6] = hydro > 100 ? 100 : hydro;
  }
  return stats;
}

/* ============================== 前沿环播种（性能基准用） ============================== */

/**
 * 16×16 外圈周边 Tile 索引表（60 格：顶行 16 + 左列 14 + 右列 14 + 底行 16；模块级冻结）。
 */
const PERIMETER_TILES = (() => {
  const list = [];
  for (let x = 0; x < 16; x++) list.push(0 * 16 + x); // y=0 北极行
  for (let y = 1; y < 15; y++) list.push(y * 16 + 0); // x=0 西缘列
  for (let y = 1; y < 15; y++) list.push(y * 16 + 15); // x=15 东缘列
  for (let x = 0; x < 16; x++) list.push(15 * 16 + x); // y=15 南极行
  return Object.freeze(list);
})();

/** 播种数量（doc45 CHK-M2-03 基准口径：每星 24 个活跃前沿位） */
const RING_SEED_COUNT = 24;

/** 周边环步进（37 与 60 互素 → 24 次抽取两两不同，跨星经 planet.id 错位确定） */
const RING_STRIDE = 37;

/**
 * 把 24 个确定性边界位种入 planet.compactState.frontierMask（性能基准用）。
 *
 * 确定性：周边槽位 = (numericEntityKey(planet.id) + j×37) mod 60，j = 0..23
 * （37 与 60 互素保证互异；同星重复调用幂等置位）。仅置掩码位（不写 Tile 旗标、
 * 不改覆盖层）；compactState 未挂载时返回 0 零写入（绝不 ensure）。
 *
 * @param {object} planet - 行星实体
 * @returns {number} 实际置位的前沿位数（0 或 24）
 */
export function seedFrontierRing(planet) {
  if (!planet || typeof planet !== 'object') return 0;
  const compact = planet.compactState;
  if (!compact || typeof compact !== 'object' || !Array.isArray(compact.frontierMask)) return 0;
  const key = numericEntityKey(planet.id);
  let seeded = 0;
  for (let j = 0; j < RING_SEED_COUNT; j++) {
    const slot = (key + j * RING_STRIDE) % PERIMETER_TILES.length;
    setFrontier(compact.frontierMask, PERIMETER_TILES[slot]);
    seeded++;
  }
  return seeded;
}
