/**
 * tests/suites/space-opera-foundation-contract.suite.js — doc43 GATE-15-P0
 * 太空歌剧 Phase 0 基建契约门禁（SPACE-OPERA-00，group: space-opera）
 *
 * 按序实现 SPEC-PLAN-043 §3 全部 5 项：
 *  - CHK-00-01（零原生随机）：动态 import('node:fs')/('node:path') 递归扫 src/ 全树 .js，
 *    跳过注释行（与 tests/tools/static-audit.mjs 同口径剥注释），断言 Math.random(
 *    全 src 零命中；Date.now( 在冻结白名单（既有 UI 壳层墙钟，只入 localStorage
 *    不入世界态）之外零命中。金快照基线的两处白名单（TabGuard 跨标签页租约心跳 /
 *    Tutorial 完成时间戳）属禁改既有文件，任何白名单之外的新命中即判失败。
 *  - CHK-00-02（位运算无符号保护）：mix32 关键输入域输出 uint32；负 entityId 与
 *    极大 step 下 deriveSeed 输出 uint32、三次调用逐位一致；不同盐值派生不同种子。
 *  - CHK-00-03（盐值唯一性）：new Set(Object.values(DOMAIN_SALTS)).size === 14。
 *  - CHK-00-04（容器幂等与零扰动）：ensureSpaceOperaState 两次调用同引用；容器
 *    字段与 doc43 Task 0.3 逐字段一致；world.rng 状态数组逐位不变；既有实体集合
 *    键集不变。（金快照零漂移由编排层另跑 REG-01 确认，本套件不复算 4320 tick。）
 *  - CHK-00-05（命令总线可序列化）：18 条命令逐一以 createMinimalWorld(seed 24601)
 *    造双胞胎世界 W1/W2，W1 派发原 payload、W2 派发 JSON.parse(JSON.stringify(payload))，
 *    断言 worldHash 逐位一致且命令信封 ok/code 一致；另附契约负样本拒收探针。
 */
import { assert, assertEq } from './assert.js';
import { DOMAIN_SALTS, mix32, deriveSeed } from '../../src/domain/world/deterministicRng.js';
import { SPACE_OPERA_COMMANDS, validateSpaceOperaCommandPayload } from '../../src/domain/world/commandSchemas.js';
import { SPACE_OPERA_SCHEMA_VERSION, ensureSpaceOperaState } from '../../src/domain/world/worldMigration.js';
import '../../src/app/commandsSpaceOpera.js'; // 副作用：18 条太空歌剧命令注册进命令总线
import { executeCommand, hasCommand } from '../../src/core/commandBus.js';
import { worldHash } from '../../src/core/serialization.js';
import { createMinimalWorld } from '../../src/devtools/scenarioFactory.js';

const SEED = 24601;

/** uint32 值域判定（0 ~ 4294967295 的整数） */
function isUint32(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

/** CHK-00-05 标准测试 Payload（全部满足契约：整数 ID/字符串/布尔/合法枚举） */
const PAYLOADS = Object.freeze({
  SetSituationApproach: Object.freeze({ situationId: 1, approachId: 'cautious' }),
  ConfigureUrbanZone: Object.freeze({ planetId: 1, zoneSlot: 0, zoneType: 2 }),
  ConstructOrbitalFacility: Object.freeze({ planetId: 1, slotIndex: 0, facilityType: 1 }),
  ExcavateSubterraneanLayer: Object.freeze({ planetId: 1, depthTier: 3 }),
  TriggerTerraformingPhase: Object.freeze({ planetId: 1, targetArchetype: 7 }),
  EmergencyDebtRestructure: Object.freeze({ empireId: 1, resourceId: 'credits', cutInvestment: true }),
  LockQuantumPhasePlanet: Object.freeze({ planetId: 1, fleetId: 1, engageLock: true }),
  EnactColonyMartialLaw: Object.freeze({ planetId: 1, crackDownLevel: 2 }),
  PurgeRadicalCell: Object.freeze({ planetId: 1, useMilitaryForce: false }),
  EstablishSyndicateBranch: Object.freeze({ targetPlanetId: 1, branchType: 'smuggling' }),
  ConfigureFleetDoctrine: Object.freeze({ empireId: 1, doctrineSize: 60, qualityWeight: 30, officerAggression: 10 }),
  RestoreShipDMod: Object.freeze({ shipId: 1, dModId: 'dmod_degraded_armor' }),
  InstallShipSMod: Object.freeze({ shipId: 1, moduleId: 'smod_hardened_deck' }),
  SalvageBattleWreckHabitat: Object.freeze({ wreckEntityId: 1, convertToHabitat: true }),
  AssignParagonDestinyTrait: Object.freeze({ leaderId: 1, destinyTraitId: 'destiny_oracle' }),
  ToggleBeholderMode: Object.freeze({ paragonId: 1, mode: 'WARSHIP_COMMANDER' }),
  RespondSubspaceBeacon: Object.freeze({ beaconId: 1, responseOptionId: 'rescue_merchant' }),
  ManageLeviathanParade: Object.freeze({ situationId: 1, action: 'ENCOURAGE' }),
});

/**
 * CHK-00-01 Date.now 冻结白名单：金快照基线遗留的两处 UI 壳层墙钟
 * （跨标签页租约心跳 / 引导完成时间戳；仅写 localStorage，绝不进入世界态与模拟）。
 * 属禁改既有文件；白名单之外的任何 Date.now( 命中即判失败。
 */
const DATE_NOW_BASELINE_ALLOWLIST = Object.freeze([
  'src/persistence/TabGuard.js',
  'src/ui/shell/Tutorial.js',
]);

/** CHK-00-01：递归扫 src/ 全树 .js 文件（剥注释同 static-audit 口径） */
async function chk0001() {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const { readFileSync, readdirSync, statSync } = fsMod;
  const { join, relative } = pathMod;
  const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
  const SRC = join(ROOT, 'src');
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  })(SRC);

  const mathRandomHits = [];
  const dateNowHits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // 与 tests/tools/static-audit.mjs 同口径：先剥块注释与行注释，再逐行扫描
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '));
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    stripped.split('\n').forEach((line, i) => {
      if (/Math\.random\s*\(/.test(line)) mathRandomHits.push(`${rel}:${i + 1}`);
      if (/Date\.now\s*\(/.test(line)) dateNowHits.push(`${rel}:${i + 1}`);
    });
  }
  const offBaseline = dateNowHits.filter((h) => !DATE_NOW_BASELINE_ALLOWLIST.includes(h.slice(0, h.lastIndexOf(':'))));
  assertEq(mathRandomHits.length, 0, `CHK-00-01 Math.random 零命中（实测 ${mathRandomHits.join(', ')}）`);
  assertEq(offBaseline.length, 0, `CHK-00-01 白名单外 Date.now 零命中（实测 ${offBaseline.join(', ')}）`);
  return `CHK-00-01 扫描${files.length}文件:Math.random=0/白名单外Date.now=0`;
}

/** CHK-00-02：位运算无符号保护（uint32 值域 + 幂等派生 + 盐值分流） */
function chk0002() {
  const mixInputs = [0, -1, 0x7fffffff, 0xffffffff];
  for (const inp of mixInputs) {
    assert(isUint32(mix32(inp)), `CHK-00-02 mix32(${inp}) 输出须为 uint32（实测 ${mix32(inp)}）`);
  }
  const salts = Object.values(DOMAIN_SALTS);
  assertEq(salts.length, 14, 'CHK-00-02 盐表必须为 14 盐');
  for (const salt of salts) {
    const r1 = deriveSeed(SEED, salt, -5, 2147483647);
    const r2 = deriveSeed(SEED, salt, -5, 2147483647);
    const r3 = deriveSeed(SEED, salt, -5, 2147483647);
    assert(isUint32(r1), `CHK-00-02 deriveSeed(seed,${salt},-5,2147483647) 须为 uint32（实测 ${r1}）`);
    assertEq(r2, r1, `CHK-00-02 盐 ${salt} 第 2 次派生须逐位一致`);
    assertEq(r3, r1, `CHK-00-02 盐 ${salt} 第 3 次派生须逐位一致`);
  }
  // 不同盐值派生不同种子（两组 (entityId, step) 组合双重验证）
  for (const [eid, step] of [[42, 7], [-5, 2147483647]]) {
    const derived = new Set(salts.map((salt) => deriveSeed(SEED, salt, eid, step)));
    assertEq(derived.size, salts.length, `CHK-00-02 不同盐值必须派生不同种子（entityId=${eid}, step=${step}）`);
  }
  return 'CHK-00-02 mix32 uint32x4+14盐派生uint32/三次一致/互异';
}

/** CHK-00-03：盐值唯一性 + 冻结 + 逐键对照冻结值 */
function chk0003() {
  assertEq(new Set(Object.values(DOMAIN_SALTS)).size, 14, 'CHK-00-03 14 盐两两互异');
  assertEq(Object.keys(DOMAIN_SALTS).length, 14, 'CHK-00-03 盐名数量必须为 14');
  assert(Object.isFrozen(DOMAIN_SALTS), 'CHK-00-03 DOMAIN_SALTS 必须为冻结表');
  const EXPECT = Object.freeze({
    PLANET_MASTER: 0x5000,
    PLANET_SURFACE_CA: 0x5001,
    PLANET_SUBTERRANEAN: 0x5002,
    ARC_S1_ARCHAEOLOGY: 0xA101,
    ARC_S2_ECOLOGY: 0xA201,
    ARC_S3_SOCIETY: 0xB201,
    ARC_S4_ECONOMY: 0xB401,
    ARC_S5_DOCTRINE: 0xC501,
    ARC_S6_SYNDICATE: 0xC301,
    ARC_S7_CRISIS: 0xC701,
    SECTOR_AUTONOMOUS: 0xD401,
    PARAGON_DESTINY: 0xD801,
    SUBSPACE_BEACON: 0xE501,
    DRAMA_DIRECTOR: 0xF601,
  });
  for (const k of Object.keys(EXPECT)) {
    assertEq(DOMAIN_SALTS[k], EXPECT[k], `CHK-00-03 盐值 ${k} 须等于冻结契约值`);
  }
  return 'CHK-00-03 盐集=14/冻结/逐键对照';
}

/** CHK-00-04：容器幂等 + 逐字段契约 + world.rng 与实体集合零扰动 */
function chk0004() {
  assertEq(SPACE_OPERA_SCHEMA_VERSION, 200, 'CHK-00-04 SPACE_OPERA_SCHEMA_VERSION 须为 200');
  const w = createMinimalWorld(SEED);
  const rngBefore = w.rng.slice();
  const colsBefore = Object.keys(w.entities).sort().join(',');
  const entityKeySetsBefore = {};
  for (const col of Object.keys(w.entities)) {
    entityKeySetsBefore[col] = Object.keys(w.entities[col]).sort().join(',');
  }

  const s1 = ensureSpaceOperaState(w);
  const s2 = ensureSpaceOperaState(w);
  assert(s1 === s2, 'CHK-00-04 两次调用必须幂等（同一引用）');
  assert(w.spaceOperaState === s1, 'CHK-00-04 容器必须挂载于 world.spaceOperaState');

  // 容器字段与 doc43 Task 0.3 逐字段一致
  assertEq(s1.schemaVersion, 200, 'CHK-00-04 schemaVersion');
  assertEq(s1.systemVector, [15, 15, 20, 15, 15, 10, 10], 'CHK-00-04 systemVector 七维初值');
  assertEq(s1.butterflyCausalLog, [], 'CHK-00-04 butterflyCausalLog 初值');
  assertEq(s1.situations, {}, 'CHK-00-04 situations 初值');
  assertEq(s1.nextSituationId, 1, 'CHK-00-04 nextSituationId 初值');
  assertEq(s1.autonomousFleets, [], 'CHK-00-04 autonomousFleets 初值');
  assertEq(s1.subspaceBeacons, [], 'CHK-00-04 subspaceBeacons 初值');
  assertEq(s1.dramaDirector.tension, 18, 'CHK-00-04 dramaDirector.tension');
  assertEq(s1.dramaDirector.adaptationFactor, 1, 'CHK-00-04 dramaDirector.adaptationFactor');
  assertEq(s1.dramaDirector.adaptDays, 0, 'CHK-00-04 dramaDirector.adaptDays');
  assertEq(s1.dramaDirector.climaxCount, 0, 'CHK-00-04 dramaDirector.climaxCount');
  assertEq(s1.dramaDirector.lastClimaxTick, -1, 'CHK-00-04 dramaDirector.lastClimaxTick');
  assertEq(s1.dramaDirector.recoveryGraceUntilTick, -1, 'CHK-00-04 dramaDirector.recoveryGraceUntilTick');
  assertEq(
    Object.keys(s1).sort().join(','),
    'autonomousFleets,butterflyCausalLog,dramaDirector,nextSituationId,schemaVersion,situations,subspaceBeacons,systemVector',
    'CHK-00-04 容器顶层键集须与文档逐字段一致'
  );
  assertEq(
    Object.keys(s1.dramaDirector).sort().join(','),
    'adaptDays,adaptationFactor,climaxCount,lastClimaxTick,recoveryGraceUntilTick,tension',
    'CHK-00-04 dramaDirector 键集须与文档逐字段一致'
  );

  // world.rng 状态数组逐位不变（零 world.rng 消费）
  assertEq(w.rng, rngBefore, 'CHK-00-04 world.rng 状态数组必须逐位不变');
  // world 既有实体集合键集不变
  assertEq(Object.keys(w.entities).sort().join(','), colsBefore, 'CHK-00-04 world.entities 顶层键集不变');
  for (const col of Object.keys(w.entities)) {
    assertEq(Object.keys(w.entities[col]).sort().join(','), entityKeySetsBefore[col], `CHK-00-04 实体集合 ${col} 键集不变`);
  }
  return 'CHK-00-04 容器幂等/逐字段一致/rng与实体键集零扰动';
}

/** CHK-00-05：18 条命令双胞胎可序列化对拍 + 契约负样本拒收 */
function chk0005() {
  assertEq(SPACE_OPERA_COMMANDS.length, 18, 'CHK-00-05 契约命令数量必须为 18');
  for (const def of SPACE_OPERA_COMMANDS) {
    assert(hasCommand(def.type), `CHK-00-05 ${def.type} 必须已注册到命令总线`);
    const payload = PAYLOADS[def.type];
    assert(payload && typeof payload === 'object', `CHK-00-05 ${def.type} 缺少标准测试 payload`);
    const w1 = createMinimalWorld(SEED);
    const w2 = createMinimalWorld(SEED);
    const rngBefore1 = w1.rng.slice();
    const env1 = executeCommand(w1, { type: def.type, params: payload });
    const env2 = executeCommand(w2, { type: def.type, params: JSON.parse(JSON.stringify(payload)) });
    assertEq(env1.ok, true, `CHK-00-05 ${def.type} 信封须 ok:true（W1 实测 ${JSON.stringify(env1)}）`);
    assertEq(env1.ok, env2.ok, `CHK-00-05 ${def.type} 双胞胎信封 ok 须一致`);
    assertEq(env1.code, env2.code, `CHK-00-05 ${def.type} 双胞胎信封 code 须一致`);
    assertEq(env1.eventCount, env2.eventCount, `CHK-00-05 ${def.type} 双胞胎 eventCount 须一致`);
    assertEq(worldHash(w1), worldHash(w2), `CHK-00-05 ${def.type} 双胞胎 worldHash 须逐位一致`);
    assertEq(w1.rng, rngBefore1, `CHK-00-05 ${def.type} 命令全路径须零 world.rng 消费`);
    assert(w1.spaceOperaState && w2.spaceOperaState, `CHK-00-05 ${def.type} execute 须完成容器惰性挂载`);
  }
  // 契约校验负样本（严格 typeof / 整数 / 枚举 / 缺字段 / 未知命令）
  assertEq(validateSpaceOperaCommandPayload({ type: 'ExcavateSubterraneanLayer', params: { planetId: 1, depthTier: 9 } }).ok, false, 'CHK-00-05 枚举外值须拒收');
  assertEq(validateSpaceOperaCommandPayload({ type: 'SetSituationApproach', params: { situationId: '1', approachId: 'cautious' } }).ok, false, 'CHK-00-05 number 字段传 string 须拒收');
  assertEq(validateSpaceOperaCommandPayload({ type: 'SetSituationApproach', params: { situationId: 1.5, approachId: 'x' } }).ok, false, 'CHK-00-05 非整数 number 须拒收');
  assertEq(validateSpaceOperaCommandPayload({ type: 'SetSituationApproach', params: { situationId: 1 } }).ok, false, 'CHK-00-05 缺必填字段须拒收');
  assertEq(validateSpaceOperaCommandPayload({ type: 'NoSuchSpaceOperaCmd', params: {} }).ok, false, 'CHK-00-05 未知太空歌剧命令须拒收');
  return 'CHK-00-05 18/18双胞胎哈希一致+信封一致+负样本拒收';
}

export const suite = {
  id: 'SPACE-OPERA-00',
  name: '太空歌剧 Phase 0 基建契约门禁（GATE-15-P0）',
  group: 'space-opera',
  async run() {
    const t0 = performance.now();
    try {
      const parts = [];
      parts.push(await chk0001());
      parts.push(chk0002());
      parts.push(chk0003());
      parts.push(chk0004());
      parts.push(chk0005());
      return { ok: true, detail: `${parts.join('; ')}; 耗时<${(performance.now() - t0).toFixed(1)}ms` };
    } catch (e) {
      return { ok: false, detail: String((e && e.stack) || e) };
    }
  },
};
