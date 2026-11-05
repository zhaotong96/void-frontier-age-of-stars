/**
 * tests/suites/save-migration.suite.js — SAVE-04：v1→v2 地表存档无损迁移（doc7 TASK-5.3）
 *
 * 构造 v1 形态世界（从开局战役剥离 v2 字段 + 注入旧体素 surfaceWorld 字段），
 * 经 MigrationRegistry（SaveManager.load 同路径：migratePayload(payload, 1, SCHEMA_VERSION)）：
 *  (a) 全部行星/星系补齐 pois / primaryThemeId / secondaryThemeModifiers /
 *      moons / orbitPhase / terrainEdits / belts 占位；资源账本、已采矿量
 *      （deposits/ledger）、任务（objectives）、POI 已耗尽状态、殖民地、
 *      world.rng 主序列逐字节保留（pre/post 稳定序列化对拍）；
 *  (b) 幂等：迁移两次 JSON 逐字节一致；同一 v1 输入重迁移也确定；
 *  (c) 兼容日志：voxelMiningSummary / voxelBuildingPlaceholders /
 *      unmappedVoxelFields 三类条目齐备，且旧体素字段零静默丢弃——
 *      每个 v1 surfaceWorld 字段都落入「可重建剥离 / 归纳转换 / 保留原值」三类之一；
 *  (d) SaveCodec 往返：迁移后 encodeSave（schemaVersion=2）→ 校验和通过 →
 *      JSON 导出 → decodeImported → payload 世界哈希稳定，且通过世界不变量。
 *
 * 决策说明：SaveManager.load 以 rec.schemaVersion → SCHEMA_VERSION 驱动版本链，
 * 因此 v2 采用正式版本晋升（World.js SCHEMA_VERSION=2 + registerMigration(1, …)），
 * 而非无版本自愈钩子。迁移全程零消费 world.rng（主题/POI/伴生天体只读
 * derivePlanetSeeds 子流），读档不污染模拟确定性。
 *
 * 环境说明：side-effect 导入 app/commands.js 并补 narrative.pendingChoices
 * （与 ai-stability.suite.js 同因）。MigrationRegistry 为模块级注册表，本套件
 * 的真实迁移与 save-roundtrip 的探针迁移按注册顺序链式共存（SAVE-02 套件
 * 期望其探针字段仍在——链式语义保证双方契约）。
 */
import '../../src/app/commands.js';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { migratePayload, registeredMigrations, migrate_v1_to_v2 } from '../../src/persistence/MigrationRegistry.js';
import { encodeSave, validateSaveRecord, decodeImported, exportSaveText } from '../../src/persistence/SaveCodec.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { worldHash, deepClone, stableStringify } from '../../src/core/serialization.js';
import { SCHEMA_VERSION } from '../../src/domain/world/World.js';
import { PLANET_THEMES } from '../../src/content/planetThemes.js';
import { assert, assertEq } from './assert.js';

/** v1 → v2 换代的行星新字段（v1 档缺失，迁移必须补齐） */
const PLANET_V2_FIELDS = [
  'pois', 'primaryThemeId', 'secondaryThemeModifiers', 'themeAssignmentVersion',
  'moons', 'orbitPhase', 'terrainEdits',
];

/** 构造 v1 形态世界：剥离 v2 字段 + 注入旧体素 surfaceWorld（含已知与未知字段） */
function buildV1World(seed) {
  const world = createStarterCampaign({ seed });
  world.narrative.pendingChoices ||= [];
  const planetIds = Object.keys(world.entities.planets);
  const keptPoiPlanetId = planetIds[0]; // 保留 POI 的行星（校验已耗尽状态透传）
  const legacyPlanets = [planetIds[1], planetIds[2]]; // 注入体素字段的行星

  // 剥离 v2 新字段 → v1 形态（kept 行星保留 pois：模拟 v1 档已存在 POI 状态）
  for (const pid of planetIds) {
    const p = world.entities.planets[pid];
    for (const f of PLANET_V2_FIELDS) {
      if (f === 'pois' && pid === keptPoiPlanetId) continue; // 保留已耗尽 POI
      delete p[f];
    }
  }
  for (const sid of Object.keys(world.entities.systems)) delete world.entities.systems[sid].belts;
  delete world.narrative.flags;
  delete world.compatLog;
  world.schemaVersion = 1;

  // 保留行星：POI 采样/发奖/耗尽状态（迁移绝不重置，spec6 §10.4.2）
  const kept = world.entities.planets[keptPoiPlanetId];
  const poiIds = Object.keys(kept.pois);
  kept.pois[poiIds[0]].state = 'explored';
  kept.pois[poiIds[0]].rewardPaid = true;
  kept.pois[poiIds[0]].discoveryState = 'exhausted';
  kept.pois[poiIds[0]].harvestedTick = 1234;

  // 旧体素字段（spec6 §10.4：surfaceWorld.voxels/heights/chunks/stats）：
  //  - planetIds[1]：全量形态（stats+体素数组+BUILDING 体素+未知字段）
  //  - planetIds[2]：纯采掘形态（stats+体素数组，无建筑）
  //  - 世界根：v1 个别档把 surfaceWorld 挂世界级
  world.entities.planets[legacyPlanets[0]].surfaceWorld = {
    voxels: new Array(64).fill(0).map((_, i) => ({ x: i % 8, y: i % 5, z: (i / 8) | 0, solid: true })),
    heights: { '0,0': 12.5, '1,0': 11.0 },
    chunks: [{ cx: 0, cz: 0, dugCells: 3 }, { cx: 1, cz: 0, dugCells: 1 }],
    stats: { dug: 123, mined: { ferro: 40, silicate: 12 }, buildingsPlaced: 2 },
    buildings: [{ kind: 'BUILDING', x: 3, z: 4 }, { kind: 'BUILDING', x: 7, z: 9 }],
    mysteryField: { legacyProp: 1 }, // 未映射字段：必须保留原值 + 兼容日志
  };
  world.entities.planets[legacyPlanets[1]].surfaceWorld = {
    voxels: [1, 2, 3],
    heights: { '2,2': 5 },
    chunks: [],
    stats: { dug: 5, mined: { water: 3 } },
  };
  world.surfaceWorld = {
    voxels: [0, 0],
    heights: {},
    stats: { dug: 7, mined: { water: 3 } },
  };

  return {
    world,
    keptPoiPlanetId,
    legacyPlanets,
    pre: {
      ledger: stableStringify(world.economy.ledgers),
      objectives: stableStringify(world.entities.objectives),
      deposits: stableStringify(Object.values(world.entities.planets).map((p) => p.deposits)),
      colonies: stableStringify(world.entities.colonies),
      keptPois: stableStringify(world.entities.planets[keptPoiPlanetId].pois),
      rng: stableStringify(world.rng),
    },
  };
}

export const suite = {
  id: 'SAVE-04',
  name: 'v1→v2 地表存档无损迁移（POI/主题/天体补齐 + 体素兼容日志 + 编解码往返）',
  group: 'persistence',
  async run() {
    try {
      assert(registeredMigrations().includes(1), '注册表应含 v1→v2 迁移步骤');

      // —— (a) v1 形态构造 + 迁移 + 字段补齐 + 保留键对拍 ——
      const { world: v1, keptPoiPlanetId, legacyPlanets, pre } = buildV1World(20261105);
      const planetIds = Object.keys(v1.entities.planets);
      const mig = migratePayload(v1, 1, SCHEMA_VERSION);
      assertEq(mig.ok, true, `迁移应成功（实测 ${mig.ok ? '' : mig.reason}）`);
      assert(mig.applied.includes(2), `applied 应含版本 2（实测 [${mig.applied}]）`);
      const m = mig.payload;

      assertEq(m.schemaVersion, 2, '迁移后 payload.schemaVersion 应为 2');
      for (const pid of planetIds) {
        const p = m.entities.planets[pid];
        for (const f of PLANET_V2_FIELDS) {
          assert(p[f] != null, `行星 ${pid} 缺少 v2 字段 ${f}`);
        }
        assert(Array.isArray(p.secondaryThemeModifiers), `${pid} secondaryThemeModifiers 应为数组`);
        assert(Array.isArray(p.moons), `${pid} moons 应为数组`);
        assert(Number.isFinite(p.orbitPhase), `${pid} orbitPhase 应为有限数`);
        assertEq(
          typeof p.primaryThemeId === 'string' && !!PLANET_THEMES[p.primaryThemeId],
          true,
          `${pid} primaryThemeId 应为已知主题（实测 ${p.primaryThemeId}）`,
        );
        assert(
          p.terrainEdits && Array.isArray(p.terrainEdits.ops),
          `${pid} terrainEdits 应为 { revision, ops } 形态`,
        );
        assert(p.pois && Object.keys(p.pois).length > 0, `${pid} 应有持久 POI`);
      }
      for (const sid of Object.keys(m.entities.systems)) {
        assert(Array.isArray(m.entities.systems[sid].belts), `星系 ${sid} 缺少 belts 占位`);
      }
      assert(!!m.narrative.flags && !!m.entities.objectives, 'narrative.flags / entities.objectives 应 ensure');

      // 保留键：资源账本 / 任务 / 已采矿量（deposits）/ 殖民地 / POI 耗尽态 / world.rng
      assertEq(stableStringify(m.economy.ledgers), pre.ledger, '资源账本应逐字节保留');
      assertEq(stableStringify(m.entities.objectives), pre.objectives, '任务记录应逐字节保留');
      assertEq(
        stableStringify(Object.values(m.entities.planets).map((p) => p.deposits)),
        pre.deposits,
        '矿藏（已采矿量底账）应逐字节保留',
      );
      assertEq(stableStringify(m.entities.colonies), pre.colonies, '殖民地/设施应逐字节保留');
      assertEq(
        stableStringify(m.entities.planets[keptPoiPlanetId].pois),
        pre.keptPois,
        '已耗尽 POI 状态（state/rewardPaid/discoveryState/harvestedTick）应逐字节保留',
      );
      const keptPoi = m.entities.planets[keptPoiPlanetId].pois;
      const firstPoi = keptPoi[Object.keys(keptPoi)[0]];
      assertEq(firstPoi.rewardPaid, true, 'POI 发奖锁不得重置（奖励幂等前提）');
      assertEq(firstPoi.state, 'explored', 'POI 采样状态不得重置');
      assertEq(stableStringify(m.rng), pre.rng, '迁移零消费 world.rng 主序列');

      // —— (c) 兼容日志：三类条目 + 零静默丢弃 ——
      const kinds = new Set(m.compatLog.map((e) => e.kind));
      assert(kinds.has('voxelMiningSummary'), '体素采掘摘要条目缺失');
      assert(kinds.has('voxelBuildingPlaceholders'), 'BUILDING 体素兼容占位条目缺失');
      assert(kinds.has('unmappedVoxelFields'), '未映射字段兼容条目缺失');

      // 零静默丢弃：v1 注入的每个 surfaceWorld 字段都必须被三类处置之一覆盖
      const minedSum = m.compatLog
        .filter((e) => e.kind === 'voxelMiningSummary')
        .reduce((acc, e) => {
          for (const [res, n] of Object.entries(e.mined || {})) acc[res] = (acc[res] || 0) + n;
          return acc;
        }, {});
      assertEq(minedSum.ferro, 40, '已采矿量 ferro 应归纳进兼容记录');
      assertEq(minedSum.silicate, 12, '已采矿量 silicate 应归纳进兼容记录');
      assertEq(minedSum.water, 3 + 3, '世界级+行星级水采掘量都应归纳（不遗漏）');
      const buildingEntry = m.compatLog.find((e) => e.kind === 'voxelBuildingPlaceholders');
      assertEq(buildingEntry.count, 2, 'BUILDING 体素应占位记录 2 处');

      const accounted = new Set([
        ...m.compatLog.flatMap((e) => e.voxelFieldsStripped || []),
        ...(m.compatLog.filter((e) => e.kind === 'voxelBuildingPlaceholders').map(() => 'buildings')),
        ...m.compatLog.flatMap((e) => e.fields || []),
      ]);
      const injected = ['voxels', 'heights', 'chunks', 'stats', 'buildings', 'mysteryField'];
      for (const f of injected) {
        assert(accounted.has(f), `旧体素字段 ${f} 未被任何处置类别记账（静默丢弃？）`);
      }
      // 可重建数组不得随档携带（spec6 §10.3：按 seed 重建）
      assert(!('voxels' in (m.surfaceWorld || {})), '世界级体素数组不得携带');
      assert(
        !m.entities.planets[legacyPlanets[1]].surfaceWorld
          || !('voxels' in m.entities.planets[legacyPlanets[1]].surfaceWorld),
        '行星体素数组不得携带',
      );
      // 未映射字段保留原值（preserved_verbatim 策略）
      const mysteryOwner = m.entities.planets[legacyPlanets[0]].surfaceWorld;
      assert(mysteryOwner && mysteryOwner.mysteryField && mysteryOwner.mysteryField.legacyProp === 1,
        '未映射字段应保留原值（不静默丢弃）');

      // —— (b) 幂等：迁移两次 → 逐字节一致；同一 v1 输入重迁移确定 ——
      const again = stableStringify(migrate_v1_to_v2(deepClone(m)));
      assertEq(stableStringify(m), again, 'v2 世界二次迁移（自愈重入）应逐字节幂等');
      const reA = migratePayload(buildV1World(20261105).world, 1, SCHEMA_VERSION);
      const reB = migratePayload(buildV1World(20261105).world, 1, SCHEMA_VERSION);
      assertEq(stableStringify(reA.payload), stableStringify(reB.payload), '同一 v1 输入重迁移应确定一致');

      // —— (d) SaveCodec 往返：迁移后编码 → 校验 → 导出 → 导入 → 哈希稳定 ——
      assertEq(checkWorldInvariants(m).length, 0, '迁移后世界应通过不变量');
      const rec = encodeSave(m, {});
      assertEq(rec.schemaVersion, 2, '迁移后存档记录 schemaVersion 应为 2');
      assertEq(validateSaveRecord(rec).ok, true, '迁移后存档应通过校验和校验');
      const rt = decodeImported(exportSaveText(rec));
      assertEq(rt.ok, true, `JSON 导出→导入应成功（实测 ${rt.ok ? '' : rt.reason}）`);
      assertEq(worldHash(rt.record.payload), worldHash(m), '往返后世界哈希应稳定');
      assertEq(validateSaveRecord(rt.record).ok, true, '导入记录应再次通过校验');

      return {
        ok: true,
        detail: `${planetIds.length} 行星补齐 7 项 v2 字段 / ${m.compatLog.length} 条兼容日志 / 幂等+往返 PASS`,
      };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
