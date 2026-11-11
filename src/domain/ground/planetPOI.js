/**
 * domain/ground/planetPOI.js — 持久化行星兴趣点（doc5 §3.7 / doc6 §6.6 / TASK-2.3）
 *
 * 每颗行星按物理类别与主题确定性地持有 1–3 个持久 POI（gasGiant 固定 1 个），
 * 挂 `planet.pois`（poiId → poi 纯数据表）随存档持久化。八类玩法与跨系统回写：
 *   ancient_ruin / crashed_ship / deep_vein / subsurface_ocean /
 *   bio_trace / magnetic_anomaly / lost_station / storm_vortex
 *
 * 确定性红线（doc6 §7.2）：
 *  - 生成只消费 derivePlanetSeeds(world, planetId).poiSeed(poiId) 派生的行星子流，
 *    绝不读写 world.rng（金快照 RNG 序列不受影响；同种子 POI 结构逐位一致）。
 *  - 严禁 Math.random()；position.y 故意不落盘（渲染时由地形场实时求值）。
 *
 * 幂等红线（SAVE-03）：rewardPaid === true 为严格发奖锁——重进星球/读档恢复
 * 绝不重复发奖；POI 完成后改变状态而非重新铸币（doc6 §6.6）。
 *
 * 依赖方向：本模块禁止 import galaxyGen（galaxyGen → planetPOI 单向）。
 */

import { derivePlanetSeeds, derivePlanetSeedsExtended } from './planetSeeds.js';
import { getEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { credit, creditColony, debit, balance } from '../economy/ledger.js';
import { createCharacter } from '../characters/crew.js';
import { checkAndProgressObjectives } from '../events/objectives.js';
import { checkBuildingPlacement } from './terrainEdits.js';
import { SURFACE_POI_BLUEPRINTS, THEME_SURFACE_POI_POOL } from '../../content/surfaceNarratives.js';

/** 八类 POI 展示名（UI/日志用） */
export const POI_KIND_ZH = {
  ancient_ruin: '远古先驱遗迹',
  crashed_ship: '坠毁星舰残骸',
  deep_vein: '超深层富集矿脉',
  subsurface_ocean: '冰下热泉生态圈',
  bio_trace: '异星掠食集群巢穴',
  magnetic_anomaly: '强磁单极子异常区',
  lost_station: '失联科考前哨',
  storm_vortex: '气态风暴超导涡流',
};

/** 物理类别 → POI 池（doc5 §3.7 表） */
export const CATEGORY_POI_POOLS = {
  rocky: ['crashed_ship', 'deep_vein', 'ancient_ruin', 'magnetic_anomaly'],
  ocean: ['subsurface_ocean', 'bio_trace', 'crashed_ship'],
  ice: ['subsurface_ocean', 'lost_station', 'deep_vein', 'crashed_ship'],
  desert: ['ancient_ruin', 'crashed_ship', 'lost_station'],
  gasGiant: ['storm_vortex'],
  lava: ['deep_vein', 'magnetic_anomaly'],
  toxic: ['bio_trace', 'lost_station'],
  artificial: ['ancient_ruin', 'magnetic_anomaly'],
};

/**
 * 主题 → POI 池（doc6 §6.6：POI 类型应与主题相关；18 主题全量覆盖，
 * 未知主题回退类别池）。只在池内引用八类既有玩法，不新铸玩法。
 */
export const THEME_POI_POOLS = {
  abyssal_ocean: ['subsurface_ocean', 'bio_trace', 'crashed_ship'],
  permafrost_furnace: ['subsurface_ocean', 'deep_vein', 'lost_station'],
  red_regolith_frontier: ['crashed_ship', 'deep_vein', 'ancient_ruin'],
  dry_night_polar: ['lost_station', 'crashed_ship', 'magnetic_anomaly'],
  sulfur_marsh: ['bio_trace', 'lost_station', 'magnetic_anomaly'],
  biolume_canopy: ['bio_trace', 'subsurface_ocean'],
  obsidian_lava: ['deep_vein', 'magnetic_anomaly', 'ancient_ruin'],
  prism_crystal: ['magnetic_anomaly', 'deep_vein', 'ancient_ruin'],
  salt_mirror_desert: ['ancient_ruin', 'crashed_ship', 'lost_station'],
  cryomethane_sea: ['subsurface_ocean', 'crashed_ship', 'lost_station'],
  tidal_lock_dusk: ['ancient_ruin', 'deep_vein', 'subsurface_ocean'],
  cloud_giant_atolls: ['storm_vortex'],
  fungal_catacombs: ['bio_trace', 'subsurface_ocean', 'ancient_ruin'],
  ancient_megastructure: ['ancient_ruin', 'magnetic_anomaly', 'lost_station'],
  glassstorm_barrens: ['crashed_ship', 'deep_vein', 'magnetic_anomaly'],
  magnetar_aurora: ['magnetic_anomaly', 'lost_station', 'ancient_ruin'],
  canopy_colossus: ['bio_trace', 'subsurface_ocean', 'ancient_ruin'],
  fractured_moon: ['crashed_ship', 'ancient_ruin', 'lost_station'],
};

/**
 * 恒星类型 → danger（与 galaxyGen.STAR_TYPES 同源的手工副本；
 * 因依赖方向禁止本模块 import galaxyGen，新增恒星类型时需同步）。
 */
const STAR_DANGER = {
  yellowDwarf: 0,
  redDwarf: 1,
  blueGiant: 3,
  whiteDwarf: 2,
  neutronStar: 6,
  pulsar: 5,
  blackHole: 8,
};

/** POI 所在程序化外围环带（Planet Local 米；frontier ring 内圈安全范围） */
const POI_RADIUS_MIN = 100;
const POI_RADIUS_SPAN = 141; // 100..240m

/** 数据类资源：只入阵营账本（科研/远古数据是文明级库存） */
const DATA_RESOURCES = new Set(['researchData', 'ancientData']);

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 行星 → 恒星危险度（ensure 路径用；galaxyGen 直呼时显式传 star） */
function starForPlanet(world, planet) {
  const sys = world.entities.systems[planet.systemId];
  const typeId = sys?.star?.typeId;
  const danger = STAR_DANGER[typeId] ?? sys?.dangerRating ?? 0;
  return { danger };
}

/** 行星 → 生效 POI 池（主题池优先，未知/缺主题回退类别池） */
export function poiPoolForPlanet(planet) {
  const theme = planet && planet.primaryThemeId;
  if (theme && THEME_POI_POOLS[theme]) return THEME_POI_POOLS[theme];
  return CATEGORY_POI_POOLS[planet.category] || CATEGORY_POI_POOLS.rocky;
}

/**
 * 生成一颗行星的持久 POI 表（纯函数：只读 world.seed 与实体字段）。
 * @returns {Object} poiId → poi（可直接挂 planet.pois）
 */
export function generatePlanetPois(world, planet, star) {
  const seeds = derivePlanetSeeds(world, planet.id);
  const pool = poiPoolForPlanet(planet);
  const danger = star && Number.isFinite(star.danger) ? star.danger : 0;
  const count = planet.category === 'gasGiant' ? 1 : 1 + ((seeds.planetSeed >>> 4) % 3); // 1..3
  const pois = {};
  const usedKinds = new Set();
  for (let i = 0; i < count; i++) {
    const poiId = `${planet.id}_poi_${i + 1}`;
    const ps = seeds.poiSeed(poiId);
    // 类别内去重：池不足以全部互异时允许重复（确定性尝试序列）
    let kind = pool[ps % pool.length];
    for (let attempt = 1; attempt < 8 && usedKinds.has(kind) && usedKinds.size < pool.length; attempt++) {
      kind = pool[seeds.poiSeed(`${poiId}#${attempt}`) % pool.length];
    }
    usedKinds.add(kind);
    const radius = POI_RADIUS_MIN + ((ps >>> 8) % POI_RADIUS_SPAN);
    const angle = (((ps >>> 18) % 4096) / 4096) * Math.PI * 2;
    pois[poiId] = {
      id: poiId,
      planetId: planet.id,
      themeId: planet.primaryThemeId || null,
      kind,
      siteId: null,
      state: 'unexplored',            // unexplored | explored（发奖状态锁）
      discoveryState: 'hidden',       // hidden | detected | localized | discovered | exhausted
      interactionState: 'available',
      threatLevel: clamp(Math.round(1 + danger * 0.35 + i * 0.8), 1, 5),
      position: {
        x: Math.round(Math.cos(angle) * radius * 10) / 10,
        z: Math.round(Math.sin(angle) * radius * 10) / 10,
        // y 故意不存：由地形场在渲染/交互时求值（doc6 §6.6）
      },
      seed: ps,
      rewardPaid: false,
      revision: 1,
    };
  }
  return pois;
}

/**
 * 惰性确保行星持有 POI（旧档兼容 + 新档幂等）。
 * 已存在则原样返回；缺失则按子流重建（结果与开局生成逐位一致）。
 */
export function ensurePlanetPois(world, planet) {
  if (planet.pois && typeof planet.pois === 'object' && Object.keys(planet.pois).length > 0) {
    return planet.pois;
  }
  planet.pois = generatePlanetPois(world, planet, starForPlanet(world, planet));
  return planet.pois;
}

// —— 奖励表（doc5 §3.7 八类收益） ————————————————————————————————————

/**
 * 结算单类 POI：返回 { rewards, post }。
 * rewards 为资源入账表；post 为额外副作用描述（由 harvestPlanetPoi 执行）。
 */
function resolveRewards(world, planet, poi, factionId) {
  switch (poi.kind) {
    case 'ancient_ruin':
      return { rewards: { ancientData: 4 + (poi.seed % 5), researchData: 25 } };
    case 'crashed_ship':
      return { rewards: { alloy: 35, powerCell: 8 } };
    case 'deep_vein': {
      const deps = planet.deposits || {};
      const resKey = deps.rareEarth > 0 ? 'rareEarth' : deps.heavyMetal > 0 ? 'heavyMetal' : 'rareEarth';
      return {
        rewards: { [resKey]: 40 },
        post: { type: 'depositBoost', resKey, mult: 1.35, grantIfAbsent: 60 },
      };
    }
    case 'subsurface_ocean':
      return {
        rewards: { biomass: 35, researchData: 20 },
        post: { type: 'habitability', delta: 8 },
      };
    case 'bio_trace':
      return {
        rewards: { medicine: 12, biomass: 45 },
        post: { type: 'crewXp', amount: 60 }, // 经验挂钩只发事件（人员选择归战斗/任务域）
      };
    case 'magnetic_anomaly':
      return { rewards: { conductor: 10, quantumCrystal: 3, researchData: 30 } };
    case 'lost_station':
      return { rewards: {}, post: { type: 'scientist', level: 2, trait: 'bookish', fallback: { researchData: 20 } } };
    case 'storm_vortex':
      return {
        rewards: { helium3: 50, deuterium: 20, researchData: 15 },
        post: { type: 'probeCost', resId: 'powerCell', amount: 2 },
      };
    default:
      return { rewards: { researchData: 10 } };
  }
}

/** 奖励入账：数据类入阵营账本；实体类优先殖民地仓储（无殖民地/非己方 → 阵营账本） */
function creditRewards(world, planet, factionId, rewards) {
  const colony = planet.colonyId ? getEntity(world, 'colonies', planet.colonyId) : null;
  const useColony = !!(colony && colony.factionId === factionId);
  for (const resId of Object.keys(rewards).sort()) {
    const amount = rewards[resId];
    if (!(amount > 0)) continue;
    if (!useColony || DATA_RESOURCES.has(resId)) {
      credit(world, factionId, resId, amount, 'poiHarvest', planet.id);
    } else {
      creditColony(world, colony, resId, amount, 'poiHarvest', planet.id);
    }
  }
  return { creditedToColony: useColony };
}

/**
 * 采样结算（HarvestPlanetPOI 命令执行体）。
 * 严格幂等：rewardPaid === true → { ok:false, code:'ALREADY_HARVESTED' }。
 * @returns {{ok:boolean, code?:string, reason?:string, rewards?:Object, scientistId?:string}}
 */
export function harvestPlanetPoi(world, planetId, poiId, actorId) {
  const planet = getEntity(world, 'planets', planetId);
  if (!planet) return { ok: false, code: 'NO_TARGET', reason: '行星不存在' };
  const pois = ensurePlanetPois(world, planet);
  const poi = pois[poiId];
  if (!poi) return { ok: false, code: 'NO_POI', reason: '兴趣点不存在' };
  const factionId = actorId || world.playerFactionId;
  if (!factionId) return { ok: false, code: 'NO_FACTION', reason: '无归属文明' };
  if (poi.rewardPaid) return { ok: false, code: 'ALREADY_HARVESTED', reason: '该兴趣点已采样结算' };

  const { rewards, post } = resolveRewards(world, planet, poi, factionId);

  // 气态探针成本：能量电池×2 不足则整体失败（不触碰状态，命令事务可回滚）
  if (post && post.type === 'probeCost' && balance(world, factionId, post.resId) < post.amount) {
    return { ok: false, code: 'NO_FUNDS', reason: `大气探针需要 ${post.resId}×${post.amount}` };
  }
  if (post && post.type === 'probeCost') {
    debit(world, factionId, post.resId, post.amount, 'poiProbe', planet.id);
  }

  creditRewards(world, planet, factionId, rewards);

  let scientistId = null;
  if (post && post.type === 'depositBoost') {
    planet.deposits ||= {};
    const cur = planet.deposits[post.resKey] || 0;
    planet.deposits[post.resKey] = cur > 0 ? Math.round(cur * post.mult) : post.grantIfAbsent;
  } else if (post && post.type === 'habitability') {
    planet.habitability = clamp((planet.habitability || 0) + post.delta, 0, 90);
  } else if (post && post.type === 'crewXp') {
    emit(world, 'PoiCrewXp', { planetId, poiId, amount: post.amount }, 'world');
  } else if (post && post.type === 'scientist') {
    // 失联科考前哨：幸存科学官加入文明人物池（bookish 特质 Lv2；人物名等
    // 随机项走 createCharacter 既有域路径，随后覆写为规定值）
    if (world.entities.factions[factionId]) {
      const c = createCharacter(world, factionId, 'science', `失联前哨幸存者（${planet.name}）`);
      c.traits = [post.trait];
      c.level = post.level;
      c.history.push({ tick: world.tick, event: '加入', note: '失联科考前哨撤离' });
      scientistId = c.id;
      emit(world, 'PoiScientistJoined', { planetId, poiId, characterId: c.id }, 'world');
    } else {
      Object.assign(rewards, post.fallback);
      creditRewards(world, planet, factionId, post.fallback);
    }
  }

  // 发奖锁 + 状态迁移（完成后改变状态，可通过地形刷新再访但绝不重发奖励）
  poi.state = 'explored';
  poi.discoveryState = 'exhausted';
  poi.interactionState = 'harvested';
  poi.rewardPaid = true;
  poi.revision = (poi.revision || 1) + 1;
  poi.harvestedTick = world.tick;

  emit(world, 'PoiHarvested', {
    planetId,
    poiId,
    kind: poi.kind,
    factionId,
    rewards: { ...rewards },
    scientistId,
  }, 'world');

  // WP-6：POI 采样推进行星锚定空间目标（按 targetPlanetId 匹配：行星勘探/殖民地救援，
  // 地表采样勘探即达成；rewardPaid 锁保证采样幂等，目标侧幂等由 status 迁移保证）
  checkAndProgressObjectives(world, (o) =>
    o.targetPlanetId === planetId && o.factionId === factionId);

  return { ok: true, rewards, scientistId };
}

/** 汇总行星未探索 POI 数（行星卡/径向菜单 lvl≥2 显示） */
export function unexploredPoiCount(planet) {
  if (!planet || !planet.pois) return 0;
  let n = 0;
  for (const id of Object.keys(planet.pois)) {
    if (planet.pois[id].state === 'unexplored') n++;
  }
  return n;
}

/** 建档期批量挂载（galaxyGen 行星循环调用；不消费 world.rng） */
export function attachPlanetPois(world, planet, star) {
  planet.pois = generatePlanetPois(world, planet, star);
  return planet.pois;
}

// ════════════════════════════════════════════════════════════════════════
// SPEC-39 Phase S1：3~8 深度地表 POI 拓扑层（惰性派生；金快照零漂移）
//
// 既有 planet.pois（1~3 座八类玩法）保持逐字节不变（galaxyGen 建档期挂载、
// 进金快照哈希）。深度地表微副本层为「确定性派生、按需求值」：
//   - 拓扑（数量/坐标/蓝图）是 (world.seed, planetId) 的纯函数，零存储；
//   - 可变状态仅收敛进 planet.surfaceDelta 的 deepSolvedMask/deepPaidMask
//     两个 32 位掩码（SURF-05 Δ 预算红线：8 POI 满进度仅 8 字节）；
//   - 仅命令触达（InteractPoiStage）或地表视图挂载时求值 → 主 RNG 零消费、
//     金快照 8be8ce2c 逐字节零漂移。
// ════════════════════════════════════════════════════════════════════════

/** 深度 POI 数量红线 */
export const DEEP_POI_MIN = 3;
export const DEEP_POI_MAX = 8;
/** 三环同心半径（米；场域坐标以 (0,0) 为着陆核心） */
export const DEEP_RING_M = Object.freeze({ core: [0, 75], transition: [80, 155], frontier: [160, 242] });
/** 同环 POI 最小间距（米）与黄金角螺旋候选步进 */
const DEEP_POI_MIN_GAP_M = 36;
const GOLDEN_ANGLE = 2.39996;
const MAX_CANDIDATES = 128;

/** 主题加成（doc38 §拓扑契约；指定主题 +1，obsidian_lava 0） */
const DEEP_THEME_BONUS = Object.freeze({
  ancient_megastructure: 1, fractured_moon: 1, red_regolith_frontier: 1, abyssal_ocean: 1,
  obsidian_lava: 0,
});

/**
 * 行星深度 POI 数量（纯函数）：clamp(3 + ⌊1.5×OrbitBand⌋ + ThemeBonus + (seed mod 3), 3, 8)。
 */
export function deepPoiCount(world, planet) {
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const band = Number.isFinite(planet.orbitIndex) ? clamp(Math.floor(planet.orbitIndex / 2), 0, 2) : 0;
  const bonus = DEEP_THEME_BONUS[planet.primaryThemeId] != null ? DEEP_THEME_BONUS[planet.primaryThemeId] : 0;
  const n = 3 + Math.floor(1.5 * band) + bonus + (seeds.planetSeed % 3);
  return clamp(n, DEEP_POI_MIN, DEEP_POI_MAX);
}

/** 蓝图类别 → 环带（残骸/巨石在外围，前哨在过渡环） */
function ringOfCat(cat) {
  return cat === 'outpost' ? DEEP_RING_M.transition : DEEP_RING_M.frontier;
}

/**
 * 深度地表 POI 拓扑派生（纯函数；零 world.rng / 零 Math.random）。
 *
 * @param {object} world 世界实体（只读 world.seed / 实体表）
 * @param {object} planet 行星实体
 * @param {object|null} field 场域（提供时按 checkBuildingPlacement 坡度 ≤18° 黄金角
 *   螺旋落位；null 时直接取极坐标理想点——SURF-01 纯种子口径）
 * @returns {Array<{idx,id,blueprintId,blueprint,cat,x,z,ring,tiltDeg,slopeDeg}>} 3~8 座
 */
export function deriveSurfacePoiTopology(world, planet, field = null) {
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const n = deepPoiCount(world, planet);
  const theme = planet.primaryThemeId || null;
  const themePool = (theme && THEME_SURFACE_POI_POOL[theme]) || SURFACE_POI_BLUEPRINTS.map((b) => b.id);
  const out = [];
  const usedBlueprints = [];
  for (let i = 0; i < n; i++) {
    const ps = seeds.slateSeed(`deep:${planet.id}:${i}`);
    // 蓝图抽选：主题池内确定性轮转 + 已用回避（池不足时允许重复）
    let blueprintId = themePool[ps % themePool.length];
    for (let attempt = 1; attempt < 8; attempt++) {
      const cat = (surfacePoiBlueprintById(blueprintId) || {}).cat;
      const dup = usedBlueprints.filter((x) => x === blueprintId).length;
      const sameCatDup = usedBlueprints.filter((bid) => (surfacePoiBlueprintById(bid) || {}).cat === cat).length;
      if (dup === 0 || (sameCatDup === 0 && usedBlueprints.length >= themePool.length)) break;
      blueprintId = themePool[seeds.slateSeed(`deep:${planet.id}:${i}#${attempt}`) % themePool.length];
    }
    usedBlueprints.push(blueprintId);
    const bp = surfacePoiBlueprintById(blueprintId);
    const ring = ringOfCat(bp.cat);
    const rMin = ring[0];
    const rSpan = Math.max(1, ring[1] - ring[0]);
    const ang0 = ((ps >>> 6) / 0x100000000) * Math.PI * 2;
    const rad0 = rMin + ((ps >>> 22) % rSpan);
    // 黄金角螺旋候选搜索（场域提供时执行坡度 ≤18° 与间距 ≥36m 双校验；
    // 128 候选 + 确定性半径抖动：rugged 环带内穷举密度足够，杜绝裸极坐标回退）
    let chosen = null;
    for (let k = 0; k < MAX_CANDIDATES; k++) {
      const ang = ang0 + k * GOLDEN_ANGLE;
      const rad = rad0 + (((k * 37) % 41) - 20) * 1.6; // ±32m 确定性抖动（仍锁环带内沿）
      const cx = Math.round(Math.cos(ang) * rad * 10) / 10;
      const cz = Math.round(Math.sin(ang) * rad * 10) / 10;
      const gapOk = out.every((p) => Math.hypot(p.x - cx, p.z - cz) >= DEEP_POI_MIN_GAP_M);
      if (!gapOk) continue;
      let slopeDeg = 0;
      if (field) {
        const chk = checkBuildingPlacement(field, cx, cz, { footprintHalfM: 4.0, maxSlopeDeg: 18, maxHeightDeltaM: 2.5 });
        if (!chk.ok) continue;
        slopeDeg = Number.isFinite(chk.maxSlopeDeg) ? chk.maxSlopeDeg : 0;
      }
      chosen = { x: cx, z: cz, slopeDeg };
      break;
    }
    if (!chosen && field) {
      // 兜底：环带内确定性极坐标网格穷举（步长 8m 极径 × 256 方位），首个过检点
      for (let ri = 0; ri <= Math.ceil(rSpan / 8) && !chosen; ri++) {
        const rad = rMin + ri * 8;
        for (let ai = 0; ai < 256; ai++) {
          const ang = ang0 + (ai / 256) * Math.PI * 2;
          const cx = Math.round(Math.cos(ang) * rad * 10) / 10;
          const cz = Math.round(Math.sin(ang) * rad * 10) / 10;
          const gapOk = out.every((p) => Math.hypot(p.x - cx, p.z - cz) >= DEEP_POI_MIN_GAP_M);
          if (!gapOk) continue;
          const chk = checkBuildingPlacement(field, cx, cz, { footprintHalfM: 4.0, maxSlopeDeg: 18, maxHeightDeltaM: 2.5 });
          if (chk.ok) {
            chosen = { x: cx, z: cz, slopeDeg: Number.isFinite(chk.maxSlopeDeg) ? chk.maxSlopeDeg : 0 };
            break;
          }
        }
      }
    }
    if (!chosen) {
      // 终极兜底（field 缺省或整环带不可建——理论上环带 8m 网格 256 方位不可能全陡）：
      // 取理想极坐标点并如实标注坡度（SURF-02 门禁将拒收 >18° 的任何落位）
      const cx = Math.round(Math.cos(ang0) * rad0 * 10) / 10;
      const cz = Math.round(Math.sin(ang0) * rad0 * 10) / 10;
      let slopeDeg = 0;
      if (field) {
        const chk = checkBuildingPlacement(field, cx, cz, { footprintHalfM: 4.0, maxSlopeDeg: 90, maxHeightDeltaM: 999 });
        slopeDeg = Number.isFinite(chk.maxSlopeDeg) ? chk.maxSlopeDeg : 0;
      }
      chosen = { x: cx, z: cz, slopeDeg };
    }
    const tiltDeg = bp.cat === 'wreck' && bp.burialTiltDeg
      ? bp.burialTiltDeg[0] + ((ps >>> 28) % (bp.burialTiltDeg[1] - bp.burialTiltDeg[0] + 1))
      : 0;
    out.push({
      idx: i,
      id: `${planet.id}_deep_${i + 1}`,
      blueprintId,
      blueprint: bp,
      cat: bp.cat,
      x: chosen.x,
      z: chosen.z,
      ring: ring === DEEP_RING_M.transition ? 1 : 2,
      tiltDeg,
      slopeDeg: chosen.slopeDeg,
    });
  }
  return out;
}

/** 蓝图 id → 定义（surfaceEvents 的 surfacePoiBlueprintOf 同名镜像；避免域→域反向依赖） */
function surfacePoiBlueprintById(id) {
  return SURFACE_POI_BLUEPRINTS.find((b) => b.id === id) || null;
}

/**
 * 深度 POI 求值（GroundView/命令侧入口）：拓扑 + surfaceDelta 掩码合成的只读视图。
 * @returns {Array<{...topo, stage:number, rewardPaid:boolean}>}
 */
export function resolveDeepPois(world, planet, field = null) {
  const topo = deriveSurfacePoiTopology(world, planet, field);
  const sd = planet.surfaceDelta || { deepSolvedMask: 0, deepPaidMask: 0 };
  return topo.map((t) => ({
    ...t,
    stage: (sd.deepSolvedMask >>> (t.idx * 3)) & 0b111,
    rewardPaid: !!((sd.deepPaidMask >>> t.idx) & 1),
  }));
}
