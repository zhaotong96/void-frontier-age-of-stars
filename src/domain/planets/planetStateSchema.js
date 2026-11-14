/**
 * domain/planets/planetStateSchema.js — 3.77KB 紧凑 PlanetState 三层垂直底座
 * （SPEC-PLAN-044 阶段一 M1 Task 1.1；责任人：Eng-A）
 *
 * 职责（doc44 §Task 1.1 逐条契约）：
 *  1. 256-Tile uint32 位段编码 packTile/unpackTile（16×16 地表网格，单 Tile 严禁膨胀为对象）；
 *  2. createCompactPlanetState：单星紧凑容器（五纪元 epochStage + 8D envVector +
 *     三层垂直空间 orbitalLayer/urbanZones/subterraneanLayer + poiSlots/colony/historyRing）；
 *  3. ensureCompactPlanetState：惰性挂载 planet.compactState（幂等，零 world.rng 消费）；
 *  4. seedCompactTiles：256 Tile 确定性地形播种（PLANET_SURFACE_CA 子流，逐 tile step 0..255）；
 *  5. 城市功能区配置 / 深层掘进 / 月度坍塌检定 / 环形历史写入。
 *
 * 纪律（doc43 §1.4 铁律）：
 *  - 零 Math.random / Date.now：一切采样经 deterministicRng 的 deriveSeed/sampleFloat01
 *    + DOMAIN_SALTS 盐值（PLANET_MASTER / PLANET_SURFACE_CA / PLANET_SUBTERRANEAN）；
 *  - 本模块全部函数纯数据操作：import 期零副作用、不改 TickPipeline、不触世界主随机流；
 *  - ensure/seed 幂等：同输入永远同输出，重复调用不产生漂移。
 */

import { DOMAIN_SALTS, deriveSeed, mix32, sampleFloat01 } from '../world/deterministicRng.js';
import { hash32 } from '../../core/serialization.js';

/* ============================== 位段契约（doc44 Task 1.1 §1） ============================== */

/**
 * Tile statusFlags 六位布尔标志（Bits 26–31，掩码 0x3F）：
 *  - 0x01 SURVEYED        已勘探（初探破译纪元晋升 0→1 的检定依据）
 *  - 0x02 ANOMALY_ACTIVE  存在活跃异象
 *  - 0x04 SHIELDED        行星护盾覆盖
 *  - 0x08 ROAD_LINKED     干线物流连通
 *  - 0x10 FRONTIER_ACTIVE 处于活跃演化前沿
 *  - 0x20 DEVASTATED      遭轨道轰炸损毁
 */
export const STATUS_FLAG = Object.freeze({
  SURVEYED: 0x01,
  ANOMALY_ACTIVE: 0x02,
  SHIELDED: 0x04,
  ROAD_LINKED: 0x08,
  FRONTIER_ACTIVE: 0x10,
  DEVASTATED: 0x20,
});

/**
 * 256-Tile uint32 位段布局（严格 doc44 Task 1.1 §1 位段表）：
 *  - Bits 0–3   biomeId      (tile & 0x0F)          基础地形与群落（0 荒芜岩床 … 15 坍塌深渊）
 *  - Bits 4–7   elevation    ((tile >>> 4) & 0x0F)  海拔与裂谷深度（0–3 深渊 / 4–7 平原 / 8–11 高原 / 12–15 绝壁）
 *  - Bits 8–11  hazardLevel  ((tile >>> 8) & 0x0F)  辐射与毒性强度（0 安全 / 1–5 轻度 / 6–10 中度 / 11–15 致命）
 *  - Bits 12–15 depositCode  ((tile >>> 12) & 0x0F) 高 2 位类型（0 矿物 / 1 能量 / 2 奇异暗质·水晶 / 3 先驱者纳米·遗物），
 *                                                   低 2 位丰度等级（0–3 对应产出倍率 0× / 1× / 2× / 4×）
 *  - Bits 16–21 buildingId   ((tile >>> 16) & 0x3F) 0 空置；1–15 基础采集区划；16–31 城市功能区；
 *                                                   32–47 奇异工业设施；48–63 先驱者奇观与防御工事
 *  - Bits 22–25 overlayId    ((tile >>> 22) & 0x0F) 动态覆盖层（0 无 / 1 共生菌丝网 / 2 喷发熔岩流 / 3 极寒冰封 /
 *                                                   4 先驱者晶格 / 5 索林虫族菌毯 / 6 工业毒雾 / 7 地下坍塌坑洞）
 *  - Bits 26–31 statusFlags  ((tile >>> 26) & 0x3F) 见 STATUS_FLAG（Bit 26=0x01 … Bit 31=0x20）
 */

/**
 * 打包单个 Tile 为 uint32（无符号化 >>> 0 保证 Bit 31 置 1 时仍为正整数）。
 * 与 doc44 Task 1.1 代码契约逐表达式一致。
 */
export function packTile({
  biomeId = 0,
  elevation = 4,
  hazardLevel = 0,
  depositCode = 0,
  buildingId = 0,
  overlayId = 0,
  statusFlags = 0,
} = {}) {
  return (
    ((biomeId & 0x0f) |
    ((elevation & 0x0f) << 4) |
    ((hazardLevel & 0x0f) << 8) |
    ((depositCode & 0x0f) << 12) |
    ((buildingId & 0x3f) << 16) |
    ((overlayId & 0x0f) << 22) |
    ((statusFlags & 0x3f) << 26)) >>> 0
  );
}

/**
 * 解包 uint32 Tile 为 7 字段对象（与 packTile 严格互逆，CHK-M1-02 无损往返）。
 */
export function unpackTile(tileUint32) {
  const t = tileUint32 >>> 0;
  return {
    biomeId: t & 0x0f,
    elevation: (t >>> 4) & 0x0f,
    hazardLevel: (t >>> 8) & 0x0f,
    depositCode: (t >>> 12) & 0x0f,
    buildingId: (t >>> 16) & 0x3f,
    overlayId: (t >>> 22) & 0x0f,
    statusFlags: (t >>> 26) & 0x3f,
  };
}

/* ============================== 槽位语义裁决（doc44 stockpile[8]/netFlow[8]） ============================== */

/**
 * 太空歌剧层 8 维资源槽位 key 裁决（S4 六大核心战略物资 + 2 高阶工业品）：
 *  [0]=energy 能量, [1]=mineral 矿物, [2]=food 食物, [3]=alloy 合金,
 *  [4]=consumer 消费品, [5]=exotic 奇异物质, [6]=rareEarth 稀土, [7]=component 组件。
 * 注意：这是太空歌剧层自有命名空间，与 src/content/resources.js 的资源 id
 * （无 'energy'/'mineral' key，见该文件全文）正交，映射关系记入施工 notes。
 */
export const OPERA_RESOURCE_KEYS = Object.freeze([
  'energy', 'mineral', 'food', 'alloy', 'consumer', 'exotic', 'rareEarth', 'component',
]);

/**
 * S4 资源短缺/国家破产弧的六大核心战略物资槽位
 * （doc44 Task 1.6：能量、矿物、食物、合金、消费品、奇异物质）。
 */
export const STRATEGIC_RESOURCE_INDEXES = Object.freeze([0, 1, 2, 3, 4, 5]);

/* ============================== 紧凑容器工厂（doc44 Task 1.1 代码契约） ============================== */

/**
 * 创建单星紧凑 PlanetState（目标 ≤ 3.77KB 序列化布局；字段与 doc44 代码契约逐字段一致）。
 *
 * @param {number} planetId     行星数字键（ensure 传 numericEntityKey(planet.id)）
 * @param {number} systemId     星系数字键
 * @param {number} archetypeId  天体原型 0–15
 * @param {number} worldSeed    世界主种子（M1 契约占位：本工厂不消费随机；M2 稀疏 CA 复核时使用）
 * @returns {object} 紧凑 PlanetState 纯数据容器
 */
export function createCompactPlanetState(planetId, systemId, archetypeId, worldSeed) {
  void worldSeed; // 契约占位（doc44 签名含 worldSeed；M1 不消费，杜绝误用 world.rng）
  return {
    id: planetId | 0,
    systemId: systemId | 0,
    archetypeId: (archetypeId & 0x0f) | 0, // 0 ~ 15
    epochStage: 0, // 0 ~ 4 五纪元状态（0 Pristine / 1 Surveyed / 2 Exploited / 3 Transformed / 4 Legacy）
    frontierMask: [0, 0, 0, 0, 0, 0, 0, 0], // 8 x uint32 = 256-bit 稀疏前沿掩码
    envVector: [18.0, 8.0, 12.0, 5.0, 10.0, 20.0, 55.0, 15.0], // 8D 环境相空间向量 (IndustrialPerturbation = 15.0)
    tiles: new Array(256).fill(0), // 256 x uint32 紧凑地表网格
    orbitalLayer: {
      majorOrbitals: 0,
      capitalLevel: 1,
      hasBlackHoleObservatory: false,
      maxOrbitalDistricts: 1,
      facilities: [0, 0, 0, 0, 0, 0, 0, 0], // 8 轨道设施槽
    },
    urbanZones: {
      buildingSlots: [0, 0, 0, 0, 0, 0], // 6 通用建筑槽
      zoneSlots: [0, 0], // 2 自定义功能区 (0 空 / 1 档案馆 / 2 重工 / 3 商贸港 / 4 堡垒)
    },
    subterraneanLayer: {
      depthTier: 0,
      excavationStress: 0.0,
      subUrbanSlots: [0, 0, 0, 0],
      vaultUnlockedMask: 0,
    },
    poiSlots: [
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], // [poiId, stage(0-4), approach, progress(0-1000)]
    ],
    colony: {
      ownerId: -1,
      popTotal: 0,
      stability: 65.0, // [0.0, 100.0]
      amenitiesNet: 5.0,
      crime: 5.0,
      industrialAttention: 0, // 激进渗透关注度累加值 (>=7 激活)
      strata: [
        [0, 60, 10], // Elites: [popCount, happiness, politicalWeight]
        [0, 55, 3], // Specialists
        [0, 50, 1], // Workers
      ],
      ethicsApproval: [50, 50, 50, 50, 50],
      stockpile: [500, 500, 300, 200, 100, 50, 25, 10],
      netFlow: [10, 12, 6, 4, 2, 1, 0, 0],
    },
    historyRing: [
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
    ],
    historyCursor: 0,
  };
}

/**
 * 实体 id → 非负确定性数字键（桶分片与种子派生共用）：
 *  - number：截断取整；
 *  - string：优先解析尾缀十进制数字（'plt_5' → 5，与 core/ids.js nextId 的 `${prefix}_${seq}` 口径一致）；
 *  - 无数字尾缀：FNV-1a hash32 确定性兜底（保证任意 id 都有稳定数字键，绝不返回负数）。
 */
export function numericEntityKey(id) {
  if (typeof id === 'number' && Number.isFinite(id)) {
    const n = Math.trunc(id) % 2147483647;
    return n < 0 ? n + 2147483647 : n; // 恒非负（负 id 也必须落入桶 0..N-1，绝不悬空）
  }
  if (typeof id === 'string' && id.length > 0) {
    const m = /(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n % 2147483647;
    }
    return hash32(id) % 2147483647;
  }
  return 0;
}

/** 惰性容器守卫（与 src/simulation/HourlySystems.js planet.fort?.v!==1 跳过模式同构） */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 惰性挂载 planet.compactState（幂等；绝不消费 world.rng）。
 *
 * archetypeId 派生链（doc44 Task 1.1(e)）：
 *  1. planet.archetypeId 为有限数值 → 直接取 0–15；
 *  2. 否则 planet.primaryThemeId 为非空字符串 →
 *     deriveSeed(world.seed, PLANET_MASTER, hash32(themeId), 0) % 16（同主题同原型，跨世界可复现）；
 *  3. 两者皆缺 → deriveSeed(world.seed, PLANET_MASTER, numericEntityKey(planet.id), 0) % 16。
 *
 * 附带裁决：ensure 时把 envVector 初始值快照存入 compact.envBaseline（doc44 Task 1.2(e)
 * Slow Tick 漂移基线；createCompactPlanetState 本体保持 doc 契约字段不额外膨胀）。
 *
 * @param {object} planet - 行星实体（Plain Data）
 * @param {object} world - 世界根对象（读 world.seed，绝不读 world.rng）
 * @returns {object} planet.compactState（幂等：两次调用同一引用）
 */
export function ensureCompactPlanetState(planet, world) {
  if (!isPlainObject(planet)) throw new Error('SO: ensureCompactPlanetState 需要 planet 实体对象');
  if (!isPlainObject(world)) throw new Error('SO: ensureCompactPlanetState 需要 world 对象');
  if (planet.compactState) return planet.compactState;

  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const nPlanet = numericEntityKey(planet.id);
  const src = planet.archetypeId ?? planet.primaryThemeId;
  let archetypeId;
  if (typeof src === 'number' && Number.isFinite(src)) {
    archetypeId = Math.trunc(src) & 0x0f;
  } else if (typeof src === 'string' && src.length > 0) {
    archetypeId = deriveSeed(seed, DOMAIN_SALTS.PLANET_MASTER, hash32(src), 0) % 16;
  } else {
    archetypeId = deriveSeed(seed, DOMAIN_SALTS.PLANET_MASTER, nPlanet, 0) % 16;
  }

  const compact = createCompactPlanetState(
    nPlanet,
    numericEntityKey(planet.systemId),
    archetypeId,
    seed,
  );
  compact.envBaseline = compact.envVector.slice(); // Slow Tick 漂移基线快照（ensure 时初始值）
  planet.compactState = compact;
  return compact;
}

/* ============================== Layer 1：轨道区划公式（doc44 Task 1.1 §4） ============================== */

/**
 * 轨道居住站最大区划数：
 *   MaxDistricts = 1 + floor(DepositSize / 2) + floor(systemBodyCount × Δcapital)
 *   Δcapital 按首都建筑等级 Level 1–3 取 +0.25 / +0.50 / +0.75（向下取整结算）。
 * CHK-M1-03 基准：deposit=5, capitalLevel=2, bodies=6 → 1 + 2 + 3 = 6。
 */
const CAPITAL_BODY_BONUS = Object.freeze([0.25, 0.5, 0.75]);

export function computeMaxOrbitalDistricts(depositSize, capitalLevel, systemBodyCount) {
  const d = Number.isFinite(depositSize) && depositSize > 0 ? depositSize : 0;
  const lvl = Math.min(3, Math.max(1, Math.trunc(Number.isFinite(capitalLevel) ? capitalLevel : 1)));
  const bodies = Number.isFinite(systemBodyCount) && systemBodyCount > 0 ? systemBodyCount : 0;
  return 1 + Math.floor(d / 2) + Math.floor(bodies * CAPITAL_BODY_BONUS[lvl - 1]);
}

/* ============================== Layer 2 播种：256-Tile 确定性地形（doc44 Task 1.1(f)） ============================== */

/**
 * 16 大天体原型 × 生物群系粗配档案（M1 粗配；M2 planetaryArchetypes.js 落地后由 Eng-D 表接管）。
 * 每行 = [主导群系, 次导群系, 第三群系]（biomeId 0–15，doc44 位段表语义）。
 */
const ARCHETYPE_BIOME_DOMS = Object.freeze([
  [2, 10, 3], [1, 0, 11], [3, 12, 2], [4, 3, 14],
  [5, 11, 0], [6, 11, 8], [7, 14, 0], [8, 2, 6],
  [9, 13, 0], [13, 10, 9], [11, 14, 0], [12, 15, 5],
  [14, 15, 11], [6, 8, 3], [0, 1, 7], [15, 12, 9],
]);

/** 16 原型海拔偏置（粗配；负值偏深海盆地，正值偏高原绝壁） */
const ARCHETYPE_ELEV_BIAS = Object.freeze([0, 1, -2, 0, 3, -1, 1, 0, 2, 2, 1, 2, -2, 0, 1, -2]);

/** 16 原型矿脉存在概率（粗配；0–1） */
const ARCHETYPE_DEPOSIT_PROB = Object.freeze([0.35, 0.30, 0.25, 0.30, 0.35, 0.50, 0.30, 0.45, 0.40, 0.45, 0.25, 0.40, 0.50, 0.25, 0.35, 0.45]);

/** 16 原型矿脉类型权重粗配 [矿物, 能量, 奇异暗质/水晶, 先驱者纳米/遗物] */
const ARCHETYPE_DEPOSIT_TYPE_WEIGHTS = Object.freeze([
  [8, 4, 1.5, 0.6], [9, 3, 1, 0.4], [6, 3, 1, 0.5], [5, 3, 2, 0.5],
  [7, 5, 1, 0.4], [5, 9, 2, 0.5], [6, 4, 2, 0.5], [5, 3, 6, 1],
  [4, 3, 3, 4], [4, 3, 2, 3], [6, 4, 1.5, 0.5], [7, 4, 2.5, 1],
  [6, 3, 3, 1], [4, 3, 5, 2], [5, 3, 3, 1.5], [5, 2, 4, 2.5],
]);

/**
 * 单 tile 主导群系粗配权重表：主导/次导/第三群系 10/6/3，其余群系基础 1
 * （「权重按 archetype 粗配」的 M1 落地；保持所有群系可达）。
 */
function biomeWeightsFor(archetypeId) {
  const base = new Array(16).fill(1);
  const doms = ARCHETYPE_BIOME_DOMS[archetypeId & 0x0f];
  base[doms[0]] += 9;
  base[doms[1]] += 5;
  base[doms[2]] += 2;
  return base;
}

/** [0,1) 浮点 → 加权离散下标（线性走表，语义与 deterministicRng.sampleWeightedIndex 一致） */
function weightedPick(f, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    total += typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0;
  }
  if (total <= 0) return 0;
  const r = (Number.isFinite(f) && f >= 0 ? f % 1 : 0) * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    acc += typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0;
    if (r < acc) return i;
  }
  return weights.length - 1;
}

// mix32 链键：复用 deterministicRng.js deriveSeed/mix32 内既有常数（0x9e3779b9 黄金比、
// 0x7f4a7c15 步进键、0x85ebca6b 雪崩乘数），保证逐 tile 单 uint32 可确定性展开为多字段，
// 不新增魔数、不触碰 DOMAIN_SALTS 盐值语义。
const MIX_KEY_ELEV = 0x9e3779b9;
const MIX_KEY_DEPOSIT = 0x7f4a7c15;
const MIX_KEY_TYPE = 0x85ebca6b;

/**
 * 逐 tile 确定性播种 256 格地表（biome/elevation/deposit 三字段；hazard/建筑/覆盖/旗标不动）。
 *
 * 每 tile 恰好消费一次 deriveSeed(world.seed, PLANET_SURFACE_CA, compact.id, t)（t = 0..255，
 * 严格 doc44 Task 1.1(f)「deriveSeed(PLANET_SURFACE_CA, planet.id, 0..255)」），
 * 随后经 mix32 链确定性展开 5 路独立子采样（biome / elevation / 矿脉存在 / 类型 / 丰度）。
 *
 * 幂等：同 (world.seed, planet) 重复调用产出逐位一致；重播种只覆盖地形三字段，
 * 保留既存 buildingId/overlayId/statusFlags（不抹玩家建设与事件痕迹）。
 * 调用纪律：仅在 ensureCompactPlanetState 之后由命令触达调用（doc44 Task 1.1(f)）。
 *
 * @returns {object} compact（便于命令链式续用）
 */
export function seedCompactTiles(planet, world) {
  const compact = ensureCompactPlanetState(planet, world);
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const archetypeId = compact.archetypeId & 0x0f;
  const weights = biomeWeightsFor(archetypeId);
  const typeWeights = ARCHETYPE_DEPOSIT_TYPE_WEIGHTS[archetypeId];
  const depProb = ARCHETYPE_DEPOSIT_PROB[archetypeId];
  const elevBias = ARCHETYPE_ELEV_BIAS[archetypeId];

  for (let t = 0; t < 256; t++) {
    const r = deriveSeed(seed, DOMAIN_SALTS.PLANET_SURFACE_CA, compact.id, t);
    const fB = r / 4294967296.0; // [0,1) 生物群系子采样
    const rE = mix32(r ^ MIX_KEY_ELEV);
    const fE = rE / 4294967296.0; // 海拔子采样
    const rD = mix32(rE ^ MIX_KEY_DEPOSIT);
    const fD = rD / 4294967296.0; // 矿脉存在子采样
    const rT = mix32(rD ^ MIX_KEY_TYPE);
    const fT = rT / 4294967296.0; // 矿脉类型子采样
    const rA = mix32(rT ^ MIX_KEY_DEPOSIT);
    const fA = rA / 4294967296.0; // 矿脉丰度子采样

    const biomeId = weightedPick(fB, weights);
    const elevation = Math.min(15, Math.max(0, Math.floor(fE * 16) + elevBias));
    let depositCode = 0;
    if (fD < depProb) {
      const type = weightedPick(fT, typeWeights) & 0x03; // 高 2 位：0 矿物 / 1 能量 / 2 奇异 / 3 先驱者
      const abundance = 1 + (Math.floor(fA * 3) % 3); // 低 2 位：1–3 → 产出倍率 1×/2×/4×
      depositCode = ((type << 2) | abundance) & 0x0f;
    }

    const cur = unpackTile(compact.tiles[t] >>> 0);
    compact.tiles[t] = packTile({
      biomeId,
      elevation,
      hazardLevel: cur.hazardLevel,
      depositCode,
      buildingId: cur.buildingId,
      overlayId: cur.overlayId,
      statusFlags: cur.statusFlags,
    });
  }
  return compact;
}

/* ============================== Layer 2：城市功能区（doc44 Task 1.1(g)） ============================== */

/**
 * 城市功能区类型语义（doc44 Task 1.1 §4 Layer 2）：
 *  1 档案馆科技与凝聚力区 / 2 重工合金精炼区 / 3 商业贸易港与舒适度区 / 4 堡垒防御与治安区（0 = 清空）。
 */
export const URBAN_ZONE_TYPES = Object.freeze({
  0: '空置',
  1: '档案馆科技与凝聚力区',
  2: '重工合金精炼区',
  3: '商业贸易港与舒适度区',
  4: '堡垒防御与治安区',
});

/** 功能区岗位容量粗配（M1 岗位重算基准；M1 UI/经济层消费） */
const URBAN_ZONE_JOBS = Object.freeze({
  1: Object.freeze({ specialist: 2, worker: 0 }),
  2: Object.freeze({ specialist: 1, worker: 3 }),
  3: Object.freeze({ specialist: 0, worker: 2 }),
  4: Object.freeze({ specialist: 0, worker: 1 }),
});

/**
 * 重算城市岗位容量（纯函数）：6 通用建筑槽每非空槽 +2 工人岗位，
 * 2 功能区槽按 URBAN_ZONE_JOBS 叠加专家/工人岗位。
 */
export function computeUrbanJobCapacity(compact) {
  let specialist = 0;
  let worker = 0;
  const slots = compact.urbanZones.buildingSlots;
  for (let i = 0; i < slots.length; i++) {
    if ((slots[i] | 0) !== 0) worker += 2;
  }
  for (let i = 0; i < compact.urbanZones.zoneSlots.length; i++) {
    const prof = URBAN_ZONE_JOBS[compact.urbanZones.zoneSlots[i] | 0];
    if (prof) {
      specialist += prof.specialist;
      worker += prof.worker;
    }
  }
  return { specialist, worker };
}

/**
 * 配置行星城市区划自定义功能区（zoneSlot ∈ {0,1}；zoneType 0 清空 / 1–4 见 URBAN_ZONE_TYPES）。
 * 写入后重算殖民地舒适度净额（商贸港 +2/区）与犯罪率（堡垒 −2/区，下限 0）并返回岗位容量。
 * 业务失败（非法槽位/类型/容器）抛 Error('SO:…') → 命令总线回滚。
 */
export function configureUrbanZone(compact, zoneSlot, zoneType) {
  if (!isPlainObject(compact) || !isPlainObject(compact.urbanZones) || !isPlainObject(compact.colony)) {
    throw new Error('SO: configureUrbanZone 需要 compact PlanetState 容器');
  }
  if (zoneSlot !== 0 && zoneSlot !== 1) {
    throw new Error(`SO: configureUrbanZone zoneSlot 必须为 0|1（实测 ${String(zoneSlot)}）`);
  }
  const zt = zoneType | 0;
  if (!URBAN_ZONE_TYPES[zt]) {
    throw new Error(`SO: configureUrbanZone zoneType 必须为 0|1|2|3|4（实测 ${String(zoneType)}）`);
  }
  compact.urbanZones.zoneSlots[zoneSlot] = zt;
  // —— 岗位容量与功能区派生修正重算 ——
  const tradePorts = compact.urbanZones.zoneSlots.filter((z) => (z | 0) === 3).length;
  const fortresses = compact.urbanZones.zoneSlots.filter((z) => (z | 0) === 4).length;
  compact.colony.amenitiesNet = 5.0 + tradePorts * 2.0;
  compact.colony.crime = Math.max(0, 5.0 - fortresses * 2.0);
  return {
    zoneType: zt,
    jobs: computeUrbanJobCapacity(compact),
    amenitiesNet: compact.colony.amenitiesNet,
    crime: compact.colony.crime,
  };
}

/* ============================== Layer 3：深层地壳（doc44 Task 1.1 §4 / Task 1.5） ============================== */

/**
 * 掘进深层地壳（命令 ExcavateSubterraneanLayer 的领域落点）：
 *  - depthTier 为目标层（1|2|3，与契约枚举一致）；必须逐层顺序掘进
 *    （= 当前层 +1，即「depthTier+1（上限 3）」——枚举上限 3 天然封顶）；
 *  - envVector[0] 构造应力 +8.0、envVector[7] 工业扰动 +12.0（doc44 Task 1.5：每次掘进一次性推高）；
 *  - excavationStress 采掘应力 +25.0；
 *  - 解锁对应地下城市槽 subUrbanSlots[tier-1] 与先驱者地宫层 vaultUnlockedMask 位。
 * 业务失败抛 Error('SO:…') → 命令总线回滚。
 */
export function excavateSubterranean(compact, depthTier) {
  if (!isPlainObject(compact) || !isPlainObject(compact.subterraneanLayer) || !Array.isArray(compact.envVector)) {
    throw new Error('SO: excavateSubterranean 需要 compact PlanetState 容器');
  }
  const tier = depthTier | 0;
  const sub = compact.subterraneanLayer;
  if (!Number.isInteger(depthTier) || tier < 1 || tier > 3) {
    throw new Error(`SO: excavateSubterranean depthTier 必须为 1|2|3（实测 ${String(depthTier)}）`);
  }
  if (tier !== sub.depthTier + 1) {
    throw new Error(`SO: 深层掘进必须逐层进行（当前层 ${sub.depthTier}，目标层须为 ${sub.depthTier + 1}，实测 ${tier}）`);
  }
  sub.depthTier = tier;
  compact.envVector[0] = Math.min(100, compact.envVector[0] + 8.0); // TectonicStress
  compact.envVector[7] = Math.min(100, compact.envVector[7] + 12.0); // IndustrialPerturbation（doc44 Task 1.5）
  sub.excavationStress += 25.0;
  sub.subUrbanSlots[tier - 1] = 1;
  sub.vaultUnlockedMask = (sub.vaultUnlockedMask | (1 << (tier - 1))) >>> 0;
  return sub;
}

/**
 * 坍塌/喷发事件编码（historyRing[2] eventTypeId；模块内私有枚举，负值段留给局势弧）。
 */
export const HISTORY_EVENT_CODES = Object.freeze({
  EPOCH_SURVEYED: 1, // 纪元 0→1 初探破译
  EPOCH_COLONY_ESTABLISHED: 2, // 纪元 1→2 殖民地建立
  EPOCH_TRANSFORMED: 3, // 纪元 2→3 奇观蜕变（局势弧触发，M1 集成）
  EPOCH_LEGACY: 4, // 纪元 3→4 史诗遗产（遗产事件触发）
  SUBTERRANEAN_COLLAPSE: 5, // 深层过度挖掘 → 边缘坍塌
  SUBTERRANEAN_ERUPTION: 6, // 深层过度挖掘 → 地幔熔岩喷发
});

/**
 * 环形历史写入（doc44 Task 1.1(h)）：historyRing[historyCursor % 8] = [tick, eventTypeId, actorFactionId, impactCode]。
 */
export function appendHistory(compact, tick, eventTypeId, actorFactionId, impactCode) {
  if (!isPlainObject(compact) || !Array.isArray(compact.historyRing)) {
    throw new Error('SO: appendHistory 需要 compact PlanetState 容器');
  }
  const num = (v) => (Number.isFinite(v) ? Math.trunc(v) : 0);
  compact.historyRing[compact.historyCursor % 8] = [
    num(tick), num(eventTypeId), num(actorFactionId), num(impactCode),
  ];
  compact.historyCursor = (compact.historyCursor + 1) >>> 0;
}

/** 是否存在已勘探 Tile（statusFlags Bit 26 SURVEYED；五纪元 0→1 晋升检定用） */
export function hasSurveyedTile(compact) {
  if (!isPlainObject(compact) || !Array.isArray(compact.tiles)) return false;
  for (let i = 0; i < compact.tiles.length; i++) {
    if (((compact.tiles[i] >>> 26) & STATUS_FLAG.SURVEYED) !== 0) return true;
  }
  return false;
}

/**
 * 月度深层坍塌检定（doc44 Task 1.1 §4 Layer 3）：
 *  excavationStress > 80 且 envVector[0]（TectonicStress）> 70 时，对 16×16 边缘带
 *  （外圈 60 Tile）逐格以 deriveSeed(PLANET_SUBTERRANEAN) 确定性采样：
 *    r < 0.30 → 坍塌深渊（biomeId=15 + overlayId=7）；
 *    0.30 ≤ r < 0.40 → 喷发熔岩流（overlayId=2，biome 保留）；
 *    其余 → 该格本轮免检。
 * 采样 step = world.tick × 256 + tileIndex（同月同格可复现，跨月推进）。
 *
 * @returns {{triggered: boolean, collapseTiles: number, lavaTiles: number}} 本轮受影响格数
 */
export function checkSubterraneanCollapse(planet, world) {
  const NOOP = { triggered: false, collapseTiles: 0, lavaTiles: 0 };
  if (!isPlainObject(planet) || !isPlainObject(world)) return NOOP;
  const compact = planet.compactState;
  if (!isPlainObject(compact) || !isPlainObject(compact.subterraneanLayer) || !Array.isArray(compact.tiles)) return NOOP;
  const sub = compact.subterraneanLayer;
  const stress = sub.excavationStress;
  const tectonic = Array.isArray(compact.envVector) ? compact.envVector[0] : 0;
  if (!(stress > 80) || !(tectonic > 70)) return NOOP; // 双阈值检定（doc44 Layer 3 契约）

  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const baseStep = tick * 256;
  let collapseTiles = 0;
  let lavaTiles = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (x !== 0 && x !== 15 && y !== 0 && y !== 15) continue; // 仅边缘带
      const idx = y * 16 + x;
      const r = sampleFloat01(seed, DOMAIN_SALTS.PLANET_SUBTERRANEAN, compact.id, baseStep + idx);
      if (r < 0.30) {
        const u = unpackTile(compact.tiles[idx] >>> 0);
        compact.tiles[idx] = packTile({ ...u, biomeId: 15, overlayId: 7 }); // 坍塌深渊 + 坑洞覆盖
        collapseTiles++;
      } else if (r < 0.40) {
        const u = unpackTile(compact.tiles[idx] >>> 0);
        compact.tiles[idx] = packTile({ ...u, overlayId: 2 }); // 喷发熔岩流
        lavaTiles++;
      }
    }
  }
  if (collapseTiles > 0) {
    appendHistory(compact, tick, HISTORY_EVENT_CODES.SUBTERRANEAN_COLLAPSE, compact.colony ? compact.colony.ownerId : -1, collapseTiles);
  }
  if (lavaTiles > 0) {
    appendHistory(compact, tick, HISTORY_EVENT_CODES.SUBTERRANEAN_ERUPTION, compact.colony ? compact.colony.ownerId : -1, lavaTiles);
  }
  return { triggered: collapseTiles + lavaTiles > 0, collapseTiles, lavaTiles };
}
