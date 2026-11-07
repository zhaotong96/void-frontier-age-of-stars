/**
 * persistence/MigrationRegistry.js — 存档版本迁移（任务书 8.2）
 *
 * 单向版本链 v1 → v2 → …；每个迁移函数接收 payload（世界数据）并
 * 原地升级到下一版本。迁移失败保留原记录不覆盖（SAVE-04）。
 */

// fromVersion -> fn(payload)[]（同版本多个迁移函数按注册顺序链式执行；
// doc7 TASK-5.3：SAVE-04 真实 v1→v2 迁移与回归套件的轻量探针共用 key 1，
// 链式注册让两者共存——后者不再覆盖前者，先注册者先执行）
const migrations = new Map();

/** 注册迁移：把 payload 从 version 升级到 version+1（同版本多次注册按序链接） */
export function registerMigration(fromVersion, fn) {
  const chain = migrations.get(fromVersion);
  if (chain) chain.push(fn);
  else migrations.set(fromVersion, [fn]);
}

/** 迁移到最新版本。返回 { ok, payload, applied:[], reason? } */
export function migratePayload(payload, fromVersion, latestVersion) {
  let v = fromVersion;
  let data = payload;
  const applied = [];
  while (v < latestVersion) {
    const chain = migrations.get(v);
    if (!chain || chain.length === 0) {
      return { ok: false, reason: `缺少迁移 v${v} → v${v + 1}`, applied };
    }
    try {
      for (const fn of chain) data = fn(data);
      v += 1;
      applied.push(v);
    } catch (e) {
      return { ok: false, reason: `迁移 v${v} 失败: ${e && e.message}`, applied };
    }
  }
  return { ok: true, payload: data, applied };
}

export function registeredMigrations() {
  return [...migrations.keys()].sort((a, b) => a - b);
}

// —— 已注册迁移 ————————————————————————————————
// v1 → v2（doc7 TASK-5.3 / spec6 §10.4）：旧体素地表存档迁移到连续三角地形 +
// 主题系统。迁移纪律（spec6 §10.4，SAVE-04 门禁）：
//  1) 识别 schemaVersion（由 SaveManager.load 以 rec.schemaVersion → SCHEMA_VERSION 驱动）
//     与地形 generator 版本（v1 地形 generatorVersion=1，v2 场仍为 1，字段结构换代）；
//  2) 保留 planet seed / 已采矿量 / 任务 / POI / 设施 —— 迁移只增不改（幂等）；
//  3) 已采掘体素归纳为兼容日志资源记录（不携带体素数组，按 seed 重建）；
//  4) 新字段（主题/POI/伴生天体/地形编辑）按确定性子流重建，绝不偷偷抽新随机值：
//     全部派生只消费 derivePlanetSeeds 子流，world.rng 主序列零消费；
//  5) 不能映射的旧字段进 compatLog 并给出迁移策略（保留原值），绝不静默丢弃。

import { ensurePlanetPois } from '../domain/ground/planetPOI.js';
import { assignTheme, THEME_ASSIGNMENT_VERSION } from '../content/planetThemes.js';
import { generatePlanetCelestials, generateSystemBelts } from '../domain/world/galaxyGen.js';

/** 体素存档中「可由 seed + generator 完全重建」的字段（spec6 §10.3：不随档携带） */
const VOXEL_REGENERABLE = ['voxels', 'heights', 'chunks'];
/** 体素存档中「已归纳转换」的字段（stats → 资源消耗记录；buildings → 兼容占位） */
const VOXEL_CONVERTED = ['stats', 'buildings'];

/**
 * v1 → v2 地表存档迁移（SaveManager.load 自动调用；也可作为 v2 档自愈重入——幂等）。
 * 对每个行星确保：pois / primaryThemeId / secondaryThemeModifiers / moons /
 * orbitPhase / terrainEdits；对每个星系确保 belts；对世界确保 entities.objectives、
 * narrative 容器与 compatLog；旧体素 surfaceWorld 归纳进兼容日志并剥离可重建数组。
 * @param {object} w 存档 payload（世界实体；原地升级并返回）
 * @returns {object} 升级后的世界实体
 */
export function migrate_v1_to_v2(w) {
  if (!w || typeof w !== 'object') return w;

  // —— 世界容器 ensure（只增不改；未知字段一律原样保留） ——
  w.entities ||= {};
  w.entities.objectives ||= {};
  w.narrative ||= {};
  w.narrative.flags ||= {};
  w.narrative.fired ||= {};
  w.narrative.arcs ||= {};
  w.narrative.pendingChoices ||= [];
  w.compatLog ||= [];

  const systems = w.entities.systems || {};
  const planets = w.entities.planets || {};

  // —— 同星系主题去重集合：两趟遍历（先收集已有主题，再为缺失者补派生），
  //     已有主题参与 takenThemes，补派生确定性（themeSeed 子流），与开局分配同式 ——
  const takenBySystem = new Map();
  const planetIds = Object.keys(planets);
  for (const pid of planetIds) {
    const p = planets[pid];
    if (!p || typeof p !== 'object' || typeof p.primaryThemeId !== 'string' || !p.primaryThemeId) continue;
    const sid = p.systemId != null ? p.systemId : '__none__';
    if (!takenBySystem.has(sid)) takenBySystem.set(sid, new Set());
    takenBySystem.get(sid).add(p.primaryThemeId);
  }

  for (const pid of planetIds) {
    const p = planets[pid];
    if (!p || typeof p !== 'object') continue; // 引用完整性归 invariant 管，迁移不越权

    // 1) 主题：缺失 → assignTheme 确定性补派生（类别池 + 物理守卫 + 同星系去重）
    if (typeof p.primaryThemeId !== 'string' || !p.primaryThemeId) {
      const sys = p.systemId != null ? systems[p.systemId] : null;
      const star = {
        danger: sys && Number.isFinite(sys.dangerRating) ? sys.dangerRating : 0,
      };
      const taken = takenBySystem.get(p.systemId != null ? p.systemId : '__none__') || new Set();
      const pick = assignTheme(w, p, star, taken);
      p.primaryThemeId = pick.primaryThemeId;
      p.secondaryThemeModifiers = pick.secondaryThemeModifiers;
      p.themeAssignmentVersion = THEME_ASSIGNMENT_VERSION;
      taken.add(pick.primaryThemeId);
    } else {
      // 已有主题：只补缺省容器，绝不改值（幂等）
      if (!Array.isArray(p.secondaryThemeModifiers)) p.secondaryThemeModifiers = [];
      if (p.themeAssignmentVersion == null) p.themeAssignmentVersion = THEME_ASSIGNMENT_VERSION;
    }

    // 2) 持久 POI（ensurePlanetPois 语义：已有原样保留——已耗尽/已发奖状态不动；
    //    缺失按行星子流重建，与开局逐位一致）
    ensurePlanetPois(w, p);

    // 3) 伴生天体：缺失按行星子流重派生（纯函数，不消费 world.rng）
    if (!Array.isArray(p.moons) || !Number.isFinite(p.orbitPhase)) {
      const cel = generatePlanetCelestials(w, p);
      if (!Number.isFinite(p.orbitPhase)) p.orbitPhase = cel.orbitPhase;
      if (!Array.isArray(p.moons)) p.moons = cel.moons;
    }

    // 4) 地形编辑容器（F1 terrainEdits 契约 { revision, ops }；已有则原样保留）
    if (!p.terrainEdits || typeof p.terrainEdits !== 'object' || !Array.isArray(p.terrainEdits.ops)) {
      p.terrainEdits = { revision: 0, ops: [] };
    }

    // 5) 旧体素地表字段归纳（spec6 §10.4.3：采掘 → 资源记录；BUILDING → 兼容占位）
    if (p.surfaceWorld && typeof p.surfaceWorld === 'object') {
      migrateLegacySurfaceWorld(w, p, p.surfaceWorld);
    }
  }

  // —— 星系小行星带：缺失按恒星光谱子流重派生 ——
  //     富集度由持久化 resourceRating（= round(rich×10)/10）回推（误差 ≤0.05，
  //     仅影响 belt.density 第三位小数；v1 星系从未有 belts，无信息丢失）
  for (const sid of Object.keys(systems)) {
    const s = systems[sid];
    if (!s || typeof s !== 'object' || Array.isArray(s.belts)) continue;
    s.belts = generateSystemBelts(
      w, s,
      Number.isFinite(s.resourceRating) ? s.resourceRating / 10 : 0,
      Array.isArray(s.planetIds) ? s.planetIds.length : 0,
    );
  }

  // —— 世界级旧体素表面（个别 v1 档把 surfaceWorld 挂在世界根上） ——
  if (w.surfaceWorld && typeof w.surfaceWorld === 'object') {
    migrateLegacySurfaceWorld(w, { id: '__world__' }, w.surfaceWorld);
  }

  w.schemaVersion = 2;
  return w;
}

/**
 * 旧体素 surfaceWorld 归纳：stats.dug/mined → voxelMiningSummary 兼容记录；
 * buildings → voxelBuildingPlaceholders 兼容占位记录；voxels/heights/chunks
 * 为可重建字段（按 planet seed + generator 重建，不随档携带）；其余未知字段
 * 保留原值并写入 unmappedVoxelFields 记录（给出迁移策略：保留原值）。
 * 幂等：同源条目按 ref 键去重；已剥离字段不再产生新条目。
 * @param {object} w 世界实体（写 compatLog）
 * @param {{id:string}} owner 归属实体（行星实体或 {id:'__world__'}）
 * @param {object} sw 旧体素地表对象（原地剥离已归纳字段）
 */
function migrateLegacySurfaceWorld(w, owner, sw) {
  const ref = `v1voxel:${owner.id}`;
  const log = w.compatLog;
  const already = log.some((e) => e && e.ref === ref);
  if (already) return; // 幂等：同源体素归纳只记一次

  const stripped = [];   // 可重建而剥离的字段
  let mined = null;
  let dug = null;
  if (sw.stats && typeof sw.stats === 'object') {
    dug = Number.isFinite(sw.stats.dug) ? sw.stats.dug : null;
    mined = sw.stats.mined && typeof sw.stats.mined === 'object' ? { ...sw.stats.mined } : {};
    stripped.push('stats');
  }
  for (const k of VOXEL_REGENERABLE) {
    if (k in sw) stripped.push(k);
  }
  if (stripped.length > 0) {
    log.push({
      kind: 'voxelMiningSummary',
      ref,
      owner: owner.id,
      dug,
      mined: mined || {},
      voxelFieldsStripped: stripped,
      strategy: 'regenerate', // 体素数组按 planet seed + generator v2 重建，不随档携带
      atTick: w.tick ?? null,
    });
  }

  // BUILDING 体素 → 兼容占位记录（明确列位，不静默丢弃）
  if (Array.isArray(sw.buildings)) {
    log.push({
      kind: 'voxelBuildingPlaceholders',
      ref,
      owner: owner.id,
      count: sw.buildings.length,
      items: sw.buildings.map((b, i) => ({
        slot: i,
        kind: b && typeof b === 'object' ? (b.kind || 'BUILDING') : 'BUILDING',
        x: b && Number.isFinite(b.x) ? b.x : null,
        z: b && Number.isFinite(b.z) ? b.z : null,
      })),
      strategy: 'compat_placeholder', // 位置级占位；连续地形下由玩家重定 foundation
      atTick: w.tick ?? null,
    });
    stripped.push('buildings');
  }

  // 未知字段：保留原值 + 兼容日志（绝不静默丢弃）
  const unmapped = Object.keys(sw).filter(
    (k) => !VOXEL_REGENERABLE.includes(k) && !VOXEL_CONVERTED.includes(k),
  );
  if (unmapped.length > 0) {
    log.push({
      kind: 'unmappedVoxelFields',
      ref,
      owner: owner.id,
      fields: unmapped,
      strategy: 'preserved_verbatim', // 原样保留在 surfaceWorld 上，待后续版本映射
      atTick: w.tick ?? null,
    });
  }

  // 剥离已归纳字段（可重建数组不携带；未知字段保留）
  for (const k of stripped) delete sw[k];
  if (Object.keys(sw).length === 0) {
    delete owner.surfaceWorld; // 空壳移除；有未知字段则整体保留
  }
}

registerMigration(1, migrate_v1_to_v2);

/**
 * doc22 v1.0 WP-4：紧凑 Schema v3 历史存档无损升维。
 * 为全部行星初始化五大支柱紧凑元组容器（eco/ind/threat/soc/fort）；
 * 幂等（saveVersion ≥ 3 直接返回）；不改动任何既有字段语义（无损迁移）。
 * @param {object} w 世界实体
 * @returns {object} world（同一引用）
 */
export function migrate_v2_to_v3(w) {
  if (w.saveVersion >= 3) return w;

  for (const planetId in (w.entities && w.entities.planets ? w.entities.planets : {})) {
    const planet = w.entities.planets[planetId];
    if (!planet.eco) {
      planet.eco = { v: 1, speciesCount: 0, discoveryMask: 0, sampleMask: 0, patches: [], surveyAwarded: false, ruin: null };
    }
    if (!planet.ind) {
      planet.ind = { v: 1, nodes: [], belts: [], grids: [], splitterParity: {}, catapult: null, orbitalBuffer: {} };
    }
    if (!planet.threat) {
      planet.threat = { v: 1, pti: 0, tier: 0, waveCdTicks: 0, leviathan: null, storm: null };
    }
    if (!planet.soc) {
      planet.soc = { v: 1, overseerId: null, edicts: [], agents: [], history: [], pendingDilemma: null, hope: 50, discontent: 10, prosperity: 50, crisisDays: 0, rebellionActive: false };
    }
    if (!planet.fort) {
      planet.fort = { v: 1, ionBatteries: [], planetaryShield: null, supportCd: {} };
    }
  }

  w.saveVersion = 3;
  return w;
}

registerMigration(2, migrate_v2_to_v3);
