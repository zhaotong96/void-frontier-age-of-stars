/**
 * app/commandsSpaceOpera.js — doc43 太空歌剧 18 命令注册（CommandBus 契约壳）+ M1 handler 注入
 *
 * 职责：把 SPACE_OPERA_COMMANDS 的 18 条契约逐一 registerCommand 到命令总线；
 * 阶段业务处理器（situationEngine / colonySocialArc / fleetDoctrineAndScars …）
 * 经 registerSpaceOperaCommandHandler(type, fn) 注入，签名 fn(ctx, cmd)。
 * M1（SPEC-PLAN-044）六条命令 handler + GRAVITY_WELL 弧注册已在本文件 import 期注入；
 * M2（SPEC-PLAN-045）四条命令 handler（LockQuantumPhasePlanet / EnactColonyMartialLaw /
 * PurgeRadicalCell / EstablishSyndicateBranch）+ S3/S6 弧模块挂载已在本文件 import 期注入；
 * M3（SPEC-PLAN-046）八条命令 handler（ConfigureFleetDoctrine / RestoreShipDMod /
 * InstallShipSMod / SalvageBattleWreckHabitat / AssignParagonDestinyTrait / ToggleBeholderMode /
 * RespondSubspaceBeacon / ManageLeviathanParade）+ S5/群像/信标流/S7/戏剧导演模块挂载
 * 已在本文件 import 期注入。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - execute 首行 ensureSpaceOperaState(ctx.world)（幂等惰性挂载，零 world.rng 消费）；
 *  - 无 handler 时静默返回不做事 —— 阶段未施工属正常（M1/M2/M3 渐次注入），
 *    命令信封仍为 ok:true 且世界仅多挂一个空容器（双胞胎世界哈希仍一致）；
 *  - validate 只做参数存在性 + validateSpaceOperaCommandPayload 纯校验，不触状态；
 *  - handler 内业务失败请 throw Error('SO:原因') → 总线回滚并回
 *    { ok:false, code:'EXEC_ERROR' }（execute 返回值不透传，结果必须写入世界态）。
 */

import { registerCommand } from '../core/commandBus.js';
import { emit } from '../core/eventBus.js';
import { SPACE_OPERA_COMMANDS, validateSpaceOperaCommandPayload } from '../domain/world/commandSchemas.js';
import { ensureSpaceOperaState } from '../domain/world/worldMigration.js';
import {
  registerSituationArc,
  spawnSituation,
  switchSituationApproach,
  getSituation,
  listActiveSituations,
} from '../domain/events/situationEngine.js';
import {
  ensureCompactPlanetState,
  configureUrbanZone,
  excavateSubterranean,
  appendHistory,
  HISTORY_EVENT_CODES,
} from '../domain/planets/planetStateSchema.js';
import { setCutInvestments } from '../domain/economy/shortageSituationArc.js';
import { enactMartialLaw } from '../domain/politics/colonySocialArc.js';
import { purgeRadicalCell, establishSyndicateBranch } from '../domain/economy/shadowSyndicateArc.js';
import { applyArchetypeProfile, setQuantumPhaseLock } from '../domain/planets/archetypeMechanics.js';
// M3 领域模块挂载（import 副作用：S5 CR 时钟阶段 / 群像月度 XP 与 leader 桶钩子 /
// 信标流密度阶段 / S7 议会与天灾月度钩子 / 戏剧导演 GRAND_CLIMAX 弧与日·月时钟阶段）
import {
  setPatrolHQDoctrine,
  computeDoctrineTemplate,
  restoreShipDMod,
  installShipSMod,
  salvageBattleWreckHabitat,
  SMOD_CATALOG,
} from '../domain/fleets/fleetDoctrineAndScars.js';
import {
  assignParagonDestinyTrait,
  toggleBeholderMode,
} from '../domain/characters/galacticParagons.js';
import {
  listActiveBeacons,
  respondSubspaceBeacon,
} from '../domain/world/subspaceBeaconStream.js';
import { manageLeviathanParade } from '../domain/diplomacy/galacticSenateAndCrisisArc.js';
import {
  signCommission,
  adjustChoamShares,
  adjustLandsraadStanding,
  upgradePalaceEspionage,
  layerUpSpyNetwork,
  plantDoubleAgent,
  assassinate,
  proposeLandsraadBill,
  LANDSRAAD_BILL_KINDS,
} from '../domain/diplomacy/galacticSenateAndCrisisArc.js';
import {
  hireEnclaveMentor,
  attackEnclaveConsequence,
  ENCLAVE_TYPES,
} from '../domain/characters/galacticParagons.js';
import '../simulation/dramaDirector.js';
// 弧模块 import 期自注册（S1 考古 / S2 生态相变月度钩子 / S4 短缺监视月度钩子）：
// M1 集成负责把三大弧挂进命令模块图，保证游戏运行期弧定义与月度钩子在场；
// M2 集成补挂 S3 殖民地社会弧与 S6 黑市辛迪加弧（月度钩子经 registerSituationMonthlyHook
// 登记，由 SpaceOperaClock 月末触发，pendingSystemShocks 经雅可比收口消费）。
import '../domain/exploration/archaeologyArc.js';
import '../domain/planets/ecologicalPhaseArc.js';

/** 18 条太空歌剧命令类型（顺序与 SPACE_OPERA_COMMANDS 一致） */
export const SPACE_OPERA_COMMAND_TYPES = SPACE_OPERA_COMMANDS.map((def) => def.type);

const KNOWN_TYPES = new Set(SPACE_OPERA_COMMAND_TYPES);

/** 阶段处理器注册表：type → fn(ctx, cmd)（编排层注入；未注入 = 阶段未施工） */
const handlers = new Map();

/**
 * 注入某条太空歌剧命令的阶段业务处理器（幂等覆盖：后注者生效）。
 *
 * @param {string} type - 命令类型（必须 ∈ SPACE_OPERA_COMMAND_TYPES）
 * @param {(ctx: {world: object, tick: number, actorId: string|null}, cmd: object) => void} fn - 处理器
 */
export function registerSpaceOperaCommandHandler(type, fn) {
  if (!KNOWN_TYPES.has(type)) throw new Error(`SO: 未知太空歌剧命令类型 ${String(type)}`);
  if (typeof fn !== 'function') throw new Error(`SO: ${type} 处理器必须为函数 fn(ctx, cmd)`);
  handlers.set(type, fn);
}

/** 18 条命令共用 validate：参数存在性 + 契约 Payload 严格校验（纯函数，不触状态） */
function validateSpaceOpera(ctx, cmd) {
  if (!cmd || !cmd.params || typeof cmd.params !== 'object' || Array.isArray(cmd.params)) {
    return { ok: false, code: 'BAD_PARAM', reason: '缺少 params 对象' };
  }
  const chk = validateSpaceOperaCommandPayload(cmd);
  if (!chk.ok) return { ok: false, code: 'BAD_PARAM', reason: chk.reason || 'Payload 契约校验失败' };
  return { ok: true };
}

/** 18 条命令共用 execute：幂等挂载容器 → 查阶段 handler；无 handler 静默不做事 */
function executeSpaceOpera(ctx, cmd) {
  const state = ensureSpaceOperaState(ctx.world);
  const fn = handlers.get(cmd.type);
  if (!fn) return state; // 阶段未施工属正常：编排层后续注入，此处零业务副作用
  fn(ctx, cmd);
  return state;
}

// 逐一注册 18 条契约命令（import 副作用；与 commands.js 的加载序正交）
for (const def of SPACE_OPERA_COMMANDS) {
  registerCommand(def.type, {
    desc: `太空歌剧 ${def.phase}（${def.module}）：${def.postCondition}`,
    validate: validateSpaceOpera,
    execute: executeSpaceOpera,
  });
}

/* ============================== GRAVITY_WELL 弧定义（M1 集成注册） ============================== */

/**
 * 引力井局势弧（doc44 Task 1.1 §4 Layer 1）：黑洞观测站过度逼近事件视界。
 *  - 进度 [0,100]；初始 25、月增 +5（由 ConstructOrbitalFacility handler spawn 时给定）；
 *  - 达 100（视界坍缩吞噬观测站）或归 0（安全撤离加固）时终结 —— 二者均为引擎
 *    stepSituationBucket 的内建收束路径（progressMax/0 夹逼 + resolveSituationClimax），
 *    M1 无对策表、无弧级 climax 钩子，终局记账由引擎默认路径完成。
 */
registerSituationArc('GRAVITY_WELL', {
  progressMax: 100,
  actBounds: [
    [0, 25],
    [25, 50],
    [50, 75],
    [75, 100],
  ],
  approaches: {},
});

/* ============================== M1 阶段 handler 注入区（SPEC-PLAN-044） ============================== */

/** 轨道设施类型（doc44 Task 1.1 §4 Layer 1；M1 枚举裁决） */
const FACILITY_HABITAT = 1; // 轨道居住站（Major Orbital）
const FACILITY_BLACK_HOLE_OBSERVATORY = 2; // 黑洞观测站（触发 GRAVITY_WELL 局势）

/** TriggerTerraformingPhase：大气重塑一次性扣减的能量槽（stockpile[0]）额度 */
const TERRAFORM_ENERGY_COST = 5000;
/** TriggerTerraformingPhase：envVector 向原始基线单次推进比例（M1 裁决：半程推进） */
const TERRAFORM_ENV_APPROACH_FRACTION = 0.5;
/** 原始（Pristine）8 维环境相空间基线 —— createCompactPlanetState 的 envVector 出厂值 */
const PRISTINE_ENV_BASELINE = Object.freeze([18.0, 8.0, 12.0, 5.0, 10.0, 20.0, 55.0, 15.0]);

/**
 * 行星实体解析（数字 planetId → 实体）：
 *  1. 数字键直查（合成测试世界 planets[id] = {id: n, …}）；
 *  2. 'plt_N' 前缀键回查（core/ids.js nextId 口径，game 世界 planets['plt_N']）。
 * 两级均未命中返回 null —— handler 按「目标不存在 → 静默无操作」处理
 * （保持无目标命令信封 ok:true、双胞胎世界哈希一致，与壳层静默契约同构）。
 */
function resolvePlanetEntity(world, planetId) {
  const bag = world && world.entities && world.entities.planets;
  if (!bag) return null;
  if (bag[planetId]) return bag[planetId];
  return bag[`plt_${planetId}`] || null;
}

/** SetSituationApproach → situationEngine.switchSituationApproach（冷却/未知对策抛 SO: → 回滚） */
function hSetSituationApproach(ctx, cmd) {
  const sit = getSituation(ctx.world, cmd.params.situationId);
  if (!sit) return; // 目标局势不存在 → 静默无操作（无目标 ≠ 业务失败）
  switchSituationApproach(ctx.world, cmd.params.situationId, cmd.params.approachId);
}

/** ConfigureUrbanZone → ensureCompactPlanetState + configureUrbanZone（非法槽/类型抛 SO: → 回滚） */
function hConfigureUrbanZone(ctx, cmd) {
  const planet = resolvePlanetEntity(ctx.world, cmd.params.planetId);
  if (!planet) return;
  const compact = ensureCompactPlanetState(planet, ctx.world);
  configureUrbanZone(compact, cmd.params.zoneSlot, cmd.params.zoneType);
}

/**
 * ConstructOrbitalFacility → 轨道设施写入 orbitalLayer.facilities[slotIndex]；
 * facilityType 为黑洞观测站时 hasBlackHoleObservatory = true，并立即 spawn
 * GRAVITY_WELL 局势（初始进度 25、月增 +5，doc44 Task 1.1 §4 Layer 1 契约值）。
 */
function hConstructOrbitalFacility(ctx, cmd) {
  const world = ctx.world;
  const planet = resolvePlanetEntity(world, cmd.params.planetId);
  if (!planet) return;
  const compact = ensureCompactPlanetState(planet, world);
  const slot = cmd.params.slotIndex;
  if (!Number.isInteger(slot) || slot < 0 || slot >= compact.orbitalLayer.facilities.length) {
    throw new Error(`SO: 轨道设施槽位越界 [0,${compact.orbitalLayer.facilities.length - 1}]（实测 ${String(slot)}）`);
  }
  const ft = cmd.params.facilityType;
  if (ft !== FACILITY_HABITAT && ft !== FACILITY_BLACK_HOLE_OBSERVATORY) {
    throw new Error(`SO: 未知轨道设施类型 ${String(ft)}（合法 1 居住站 | 2 黑洞观测站）`);
  }
  compact.orbitalLayer.facilities[slot] = ft;
  if (ft === FACILITY_BLACK_HOLE_OBSERVATORY) {
    compact.orbitalLayer.hasBlackHoleObservatory = true;
    const sit = spawnSituation(world, {
      arcId: 'GRAVITY_WELL',
      targetEntityId: planet.id,
      progress: 25, // doc44：逼近引力井初始进度精确 25
      monthlyDelta: 5, // 基础月增长率 +5/月
    });
    emit(world, 'GravityWellEvent', {
      planetId: planet.id,
      situationId: sit.id,
      progress: sit.progress,
      monthlyDelta: sit.monthlyDelta,
    }, 'world');
  }
}

/** ExcavateSubterraneanLayer → excavateSubterranean（逐层契约违规抛 SO: → 回滚） */
function hExcavateSubterraneanLayer(ctx, cmd) {
  const planet = resolvePlanetEntity(ctx.world, cmd.params.planetId);
  if (!planet) return;
  const compact = ensureCompactPlanetState(planet, ctx.world);
  excavateSubterranean(compact, cmd.params.depthTier);
}

/**
 * TriggerTerraformingPhase：扣 5000 能量槽（stockpile[0]）+ envVector 向原始基线
 * 半程推进（M1 无 per-archetype 环境表，原始出厂基线即 targetArchetype 基线的
 * M1 权威近似，targetArchetype 记入 historyRing impactCode）+ epochStage +1
 * （上限 3）+ appendHistory。能量不足抛 SO: → 事务回滚。
 */
function hTriggerTerraformingPhase(ctx, cmd) {
  const world = ctx.world;
  const planet = resolvePlanetEntity(world, cmd.params.planetId);
  if (!planet) return;
  const compact = ensureCompactPlanetState(planet, world);
  const arch = cmd.params.targetArchetype;
  if (!Number.isInteger(arch) || arch < 0 || arch > 15) {
    throw new Error(`SO: targetArchetype 必须为 0-15（实测 ${String(arch)}）`);
  }
  const stock = compact.colony && Array.isArray(compact.colony.stockpile) ? compact.colony.stockpile : null;
  if (!stock) throw new Error('SO: 大气重塑需要殖民地能量槽');
  if (!(stock[0] >= TERRAFORM_ENERGY_COST)) {
    throw new Error(`SO: 能量槽库存不足 ${TERRAFORM_ENERGY_COST}，无法执行大气重塑（实测 ${String(stock[0])}）`);
  }
  stock[0] -= TERRAFORM_ENERGY_COST; // 精确扣除 5000
  for (let i = 0; i < compact.envVector.length && i < PRISTINE_ENV_BASELINE.length; i++) {
    const target = PRISTINE_ENV_BASELINE[i];
    const v = compact.envVector[i] + (target - compact.envVector[i]) * TERRAFORM_ENV_APPROACH_FRACTION;
    compact.envVector[i] = v < 0 ? 0 : v > 100 ? 100 : v;
  }
  if (compact.epochStage < 3) compact.epochStage = Math.min(3, compact.epochStage + 1); // 上限 3
  appendHistory(
    compact,
    world.tick,
    HISTORY_EVENT_CODES.EPOCH_TRANSFORMED,
    compact.colony ? compact.colony.ownerId : -1,
    arch, // targetArchetype 落 historyRing impactCode
  );
}

/**
 * EmergencyDebtRestructure → shortageSituationArc 的 Cut Investments 开关。
 * 目标局势裁决：活跃 S4 局势中 meta.resourceKey === resourceId 的最小 situationId 条目
 * （listActiveSituations 确定性升序；M1 无 empireId → 局势映射表，empireId 暂不参与匹配）。
 * 无匹配局势 → 静默无操作；冷却中（720 tick）抛 SO:approach cooldown → 回滚。
 */
function hEmergencyDebtRestructure(ctx, cmd) {
  const sit = listActiveSituations(ctx.world).find((s) => s.systemArcId === 'S4'
    && s.meta && s.meta.resourceKey === cmd.params.resourceId);
  if (!sit) return;
  setCutInvestments(ctx.world, sit.id, cmd.params.cutInvestment === true);
}

// M1 六条命令 handler 注入（import 副作用；幂等覆盖语义，后注者生效）
registerSpaceOperaCommandHandler('SetSituationApproach', hSetSituationApproach);
registerSpaceOperaCommandHandler('ConfigureUrbanZone', hConfigureUrbanZone);
registerSpaceOperaCommandHandler('ConstructOrbitalFacility', hConstructOrbitalFacility);
registerSpaceOperaCommandHandler('ExcavateSubterraneanLayer', hExcavateSubterraneanLayer);
registerSpaceOperaCommandHandler('TriggerTerraformingPhase', hTriggerTerraformingPhase);
registerSpaceOperaCommandHandler('EmergencyDebtRestructure', hEmergencyDebtRestructure);

/* ============================== M2 阶段 handler 注入区（SPEC-PLAN-045） ============================== */

/**
 * 舰队实体解析（数字 fleetId → 实体；与 resolvePlanetEntity 同构两级回查）：
 * 数字键直查 + 'flt_N' 前缀回查（core/ids.js PREFIXES.fleet='flt' 口径）。
 */
function resolveFleetEntity(world, fleetId) {
  const bag = world && world.entities && world.entities.fleets;
  if (!bag) return null;
  if (bag[fleetId]) return bag[fleetId];
  return bag[`flt_${fleetId}`] || null;
}

/**
 * LockQuantumPhasePlanet → #2 量子游离天体观测场锁定切换。
 * 前置（doc45 §Task 2.3 #2 + commandSchemas postCondition）：fleetId 存在（科研舰在场）
 * 才生效 —— 目标行星或舰队缺失 → 静默无操作（无目标 ≠ 业务失败，信封保持 ok:true）；
 * 存在则写 archetypeState.quantumLocked = engageLock 并同步反应堆维护旗标
 * reactorMaintenance（锁定 → 维护开启；撤收 → 双清），经 setQuantumPhaseLock 落账。
 * 命令结果全部写世界态（execute 返回值不透传契约）。
 */
function hLockQuantumPhasePlanet(ctx, cmd) {
  const world = ctx.world;
  const planet = resolvePlanetEntity(world, cmd.params.planetId);
  if (!planet) return; // 目标行星不存在 → 静默无操作
  const fleet = resolveFleetEntity(world, cmd.params.fleetId);
  if (!fleet) return; // 科研舰队不存在 → 静默无操作（fleetId 存在且 engageLock 才生效）
  const compact = applyArchetypeProfile(planet, world); // ensure + 原型基线幂等应用
  setQuantumPhaseLock(compact, cmd.params.engageLock === true);
  const st = compact.archetypeState;
  emit(world, 'QuantumPhaseLockToggled', {
    planetId: planet.id,
    fleetId: fleet.id,
    engageLock: st.quantumLocked,
    reactorMaintenance: st.reactorMaintenance,
  }, 'world');
}

/**
 * EnactColonyMartialLaw → S3 叛乱对策处置（colonySocialArc.enactMartialLaw 领域落点）：
 * crackDownLevel 1 → CRACK_DOWN 族执行镇压（stability +10、全阶层幸福度 −10）；
 * crackDownLevel 2 → Total Crackdown 全面戒严（须已解锁且驻防战力 ≥ 25 → 清零局势
 * + 10 年免疫）。业务失败（无活跃叛乱/未解锁/驻防不足）由领域函数抛 Error('SO:…')
 * → 命令总线回滚 {ok:false, code:'EXEC_ERROR'}。目标行星缺失 → 静默无操作。
 */
function hEnactColonyMartialLaw(ctx, cmd) {
  const planet = resolvePlanetEntity(ctx.world, cmd.params.planetId);
  if (!planet) return; // 目标行星不存在 → 静默无操作
  enactMartialLaw(ctx.world, cmd.params.planetId, cmd.params.crackDownLevel);
}

/**
 * PurgeRadicalCell → S6 激进潜伏基地清剿（shadowSyndicateArc.purgeRadicalCell 领域落点）：
 * useMilitaryForce=true 军事路线（体系内舰队总战力 ≥ 50 方可成功）| false 特工渗透
 * （3 个月潜伏期后由月度钩子结算）。业务失败（无活跃细胞/战力不足）抛 Error('SO:…')
 * → 回滚。目标行星缺失 → 静默无操作。
 */
function hPurgeRadicalCell(ctx, cmd) {
  const planet = resolvePlanetEntity(ctx.world, cmd.params.planetId);
  if (!planet) return; // 目标行星不存在 → 静默无操作
  purgeRadicalCell(ctx.world, cmd.params.planetId, cmd.params.useMilitaryForce === true);
}

/**
 * EstablishSyndicateBranch → S6 犯罪辛迪加地下分部（shadowSyndicateArc.
 * establishSyndicateBranch 领域落点）：前置已殖民且（crime ≥ 10 或未签商贸协议），
 * 写 compact.syndicateBranch = {type, sinceTick, shadyContacts:true}（+1 解密/加密）。
 * 业务失败（已存在分部/前置不满足）抛 Error('SO:…') → 回滚。目标行星缺失 → 静默无操作。
 */
function hEstablishSyndicateBranch(ctx, cmd) {
  const planet = resolvePlanetEntity(ctx.world, cmd.params.targetPlanetId);
  if (!planet) return; // 目标行星不存在 → 静默无操作
  establishSyndicateBranch(ctx.world, cmd.params.targetPlanetId, cmd.params.branchType);
}

// M2 四条命令 handler 注入（import 副作用；幂等覆盖语义，后注者生效）
registerSpaceOperaCommandHandler('LockQuantumPhasePlanet', hLockQuantumPhasePlanet);
registerSpaceOperaCommandHandler('EnactColonyMartialLaw', hEnactColonyMartialLaw);
registerSpaceOperaCommandHandler('PurgeRadicalCell', hPurgeRadicalCell);
registerSpaceOperaCommandHandler('EstablishSyndicateBranch', hEstablishSyndicateBranch);

/* ============================== M3 阶段 handler 注入区（SPEC-PLAN-046） ============================== */

/**
 * 舰船实体解析（数字 shipId → 实体；与 resolveFleetEntity 同构两级回查）：
 * 数字键直查 + 'shp_N' 前缀回查（core/ids.js PREFIXES.ship='shp' 口径）。
 */
function resolveShipEntity(world, shipId) {
  const bag = world && world.entities && world.entities.ships;
  if (!bag) return null;
  if (bag[shipId]) return bag[shipId];
  return bag[`shp_${shipId}`] || null;
}

/** 人物实体解析（数字 leaderId → 实体；'chr_N' 前缀回查，与 galacticParagons 同构） */
function resolveCharacterEntity(world, leaderId) {
  const bag = world && world.entities && world.entities.characters;
  if (!bag) return null;
  if (bag[leaderId]) return bag[leaderId];
  return bag[`chr_${leaderId}`] || null;
}

/**
 * ConfigureFleetDoctrine → 巡逻司令部学说三滑块重算（fleetDoctrineAndScars 领域落点）。
 * 目标裁决：显式 params.planetId（commandSchemas 宽松透传）> 全银河键序第一座 patrolHQ；
 * 皆无 → 静默无操作（无目标 ≠ 业务失败）。doctrineSize 槽映射 shipSizeWeight 滑块。
 * 三滑块落账后经 computeDoctrineTemplate 重算轻/中/重编队模板，写 planet.patrolHQ.template
 * （自主星区生态舰队 PATROL_FLOTILLA 派生与 UI 消费的世界态落点）。
 * 滑块越界（非 0..100）由领域层抛 Error('SO:…') → 命令总线回滚。
 */
function hConfigureFleetDoctrine(ctx, cmd) {
  const world = ctx.world;
  let planetId = cmd.params.planetId != null ? cmd.params.planetId : null;
  if (planetId == null) {
    const planets = world.entities && world.entities.planets ? world.entities.planets : {};
    for (const key of Object.keys(planets).sort()) {
      const planet = planets[key];
      if (planet && planet.patrolHQ) {
        planetId = planet.id;
        break;
      }
    }
  }
  if (planetId == null) return; // 全银河无巡逻司令部 → 静默无操作
  const planet = resolvePlanetEntity(world, planetId);
  if (!planet) return; // 目标行星不存在 → 静默无操作
  const doctrine = setPatrolHQDoctrine(world, planet.id, {
    shipSizeWeight: cmd.params.doctrineSize,
    qualityWeight: cmd.params.qualityWeight,
    officerAggression: cmd.params.officerAggression,
  });
  if (planet.patrolHQ) {
    planet.patrolHQ.template = computeDoctrineTemplate(doctrine); // 三滑块重算编队模板
  }
}

/**
 * RestoreShipDMod → 战舰暗伤修复（restoreShipDMod 领域落点）。
 * 存在性门控：舰船不存在 / 未挂载该暗伤 → 静默无操作（无目标 ≠ 业务失败）；
 * 合金不足（500）由领域层抛 Error('SO:…') → 回滚。
 */
function hRestoreShipDMod(ctx, cmd) {
  const ship = resolveShipEntity(ctx.world, cmd.params.shipId);
  if (!ship) return;
  const scars = ship.scars;
  const mounted = !!(scars && Array.isArray(scars.dMods) && scars.dMods.includes(cmd.params.dModId));
  if (!mounted) return; // 无此暗伤可修 → 静默无操作
  restoreShipDMod(ctx.world, ship.id, cmd.params.dModId);
}

/**
 * InstallShipSMod → 传奇改装焊死（installShipSMod 领域落点）。
 * 存在性门控：舰船不存在 / 未知词条（不在 SMOD_CATALOG）/ 已安装 → 静默无操作；
 * 奇异物质不足（1）由领域层抛 Error('SO:…') → 回滚。
 */
function hInstallShipSMod(ctx, cmd) {
  const ship = resolveShipEntity(ctx.world, cmd.params.shipId);
  if (!ship) return;
  if (!SMOD_CATALOG[cmd.params.moduleId]) return; // 未知词条 → 静默无操作
  const scars = ship.scars;
  if (scars && Array.isArray(scars.sMods) && scars.sMods.includes(cmd.params.moduleId)) return; // 幂等静默
  installShipSMod(ctx.world, ship.id, cmd.params.moduleId);
}

/**
 * SalvageBattleWreckHabitat → 战役残骸处置（salvageBattleWreckHabitat 领域落点）。
 * 存在性门控：残骸不存在（wreckSites 无匹配 id）→ 静默无操作；
 * 已处置由领域层抛 Error('SO:…') → 回滚。
 */
function hSalvageBattleWreckHabitat(ctx, cmd) {
  const soState = ctx.world && ctx.world.spaceOperaState;
  const sites = soState && Array.isArray(soState.wreckSites) ? soState.wreckSites : [];
  const wreck = sites.find((w) => w
    && (w.id === cmd.params.wreckEntityId || String(w.id) === String(cmd.params.wreckEntityId)));
  if (!wreck) return; // 残骸不存在 → 静默无操作
  salvageBattleWreckHabitat(ctx.world, cmd.params.wreckEntityId, cmd.params.convertToHabitat === true);
}

/**
 * AssignParagonDestinyTrait → Lv8 天命特质固化（assignParagonDestinyTrait 领域落点）。
 * 存在性门控：领袖不存在 / 已有 destinyOffer 且特质不在本届三选项 → 静默无操作；
 * 未达 Lv8 / 未知特质由领域层抛 Error('SO:…') → 回滚。
 */
function hAssignParagonDestinyTrait(ctx, cmd) {
  const leader = resolveCharacterEntity(ctx.world, cmd.params.leaderId);
  if (!leader) return;
  const p = leader.paragon;
  if (p && Array.isArray(p.destinyOffer) && !p.destinyOffer.includes(cmd.params.destinyTraitId)) {
    return; // 不在本届三选项 → 静默无操作
  }
  assignParagonDestinyTrait(ctx.world, leader.id, cmd.params.destinyTraitId);
}

/**
 * ToggleBeholderMode → 传奇灵能机械核心双形态切换（toggleBeholderMode 领域落点）。
 * 存在性门控：人物不存在 → 静默无操作；非 THE_BEHOLDER / 非法形态 / 无锚定行星 /
 * 未殖民由领域层抛 Error('SO:…') → 回滚。params.planetId 为宽松透传的显式锚定行星。
 */
function hToggleBeholderMode(ctx, cmd) {
  const leader = resolveCharacterEntity(ctx.world, cmd.params.paragonId);
  if (!leader) return;
  toggleBeholderMode(ctx.world, leader.id, cmd.params.mode,
    cmd.params.planetId != null ? cmd.params.planetId : null);
}

/**
 * RespondSubspaceBeacon → 子空间信标响应（respondSubspaceBeacon 领域落点）。
 * 存在性门控：信标不存在/已过期 / 无此响应选项 → 静默无操作；
 * 玩家派系未定义由领域层抛 Error('SO:…') → 回滚。响应结果写
 * world.spaceOperaState.lastBeaconResponse（execute 返回值不透传契约）。
 */
function hRespondSubspaceBeacon(ctx, cmd) {
  const beacon = listActiveBeacons(ctx.world).find((b) => b
    && (b.id === cmd.params.beaconId || String(b.id) === String(cmd.params.beaconId)));
  if (!beacon) return; // 信标不存在/已过期 → 静默无操作
  const hasOption = (beacon.responseOptions || []).some((o) => o && o.id === cmd.params.responseOptionId);
  if (!hasOption) return; // 无此响应选项 → 静默无操作
  respondSubspaceBeacon(ctx.world, cmd.params.beaconId, cmd.params.responseOptionId);
}

/**
 * ManageLeviathanParade → 利维坦凯旋大游行动作（manageLeviathanParade 领域落点）：
 * ENCOURAGE（+6/月 + 全殖民地幸福度 +15%）/ SUPPRESS（−4/月）/ REORGANIZE
 * （扣 1000 凝聚力迁址，targetPlanetId 为宽松透传的显式目标）。
 * 存在性门控：局势不存在 / 已收束 / 非 LEVIATHAN_PARADE 弧 → 静默无操作；
 * 冷却中 / 凝聚力不足 / 迁址目标非法由领域层抛 Error('SO:…') → 回滚。
 */
function hManageLeviathanParade(ctx, cmd) {
  const sit = getSituation(ctx.world, cmd.params.situationId);
  if (!sit || sit.resolvedTick != null || sit.systemArcId !== 'LEVIATHAN_PARADE') return;
  manageLeviathanParade(ctx.world, cmd.params.situationId, cmd.params.action,
    cmd.params.targetPlanetId != null ? cmd.params.targetPlanetId : null);
}

// M3 八条命令 handler 注入（import 副作用；幂等覆盖语义，后注者生效）
registerSpaceOperaCommandHandler('ConfigureFleetDoctrine', hConfigureFleetDoctrine);
registerSpaceOperaCommandHandler('RestoreShipDMod', hRestoreShipDMod);
registerSpaceOperaCommandHandler('InstallShipSMod', hInstallShipSMod);
registerSpaceOperaCommandHandler('SalvageBattleWreckHabitat', hSalvageBattleWreckHabitat);
registerSpaceOperaCommandHandler('AssignParagonDestinyTrait', hAssignParagonDestinyTrait);
registerSpaceOperaCommandHandler('ToggleBeholderMode', hToggleBeholderMode);
registerSpaceOperaCommandHandler('RespondSubspaceBeacon', hRespondSubspaceBeacon);
registerSpaceOperaCommandHandler('ManageLeviathanParade', hManageLeviathanParade);

/* ============================== S7 第二幕命令（doc42 总纲 §二.7 实战可达整改） ============================== */
// 十条 S7 玩家交互命令经通用 registerCommand 注册（SPACE_OPERA_COMMANDS 18 条契约
// 为冻结面，CHK-00-05 逐条断言 18 —— S7 命令不入契约表，注册副作用仍在本模块）。
// 业务失败（重复签署/情报点不足/网络不足/standing 不足等）由领域函数抛 Error('SO:…')
// → 命令总线回滚 {ok:false, code:'EXEC_ERROR'}。

/** 必填字符串参数存在性校验（非空 string） */
function requireStringParam(cmd, name) {
  const v = cmd.params ? cmd.params[name] : undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`SO: 参数 ${name} 须为非空 string（实测 ${String(v)}）`);
  }
  return v;
}

/** 必填整数参数校验（有限整数） */
function requireIntParam(cmd, name) {
  const v = cmd.params ? cmd.params[name] : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`SO: 参数 ${name} 须为有限整数（实测 ${String(v)}）`);
  }
  return v;
}

registerCommand('SignCommission', {
  desc: 'S7 签署雇佣委任状（月饷按舰队规模领取 + 军用船体购买权；42 号 §二.7 第二幕）',
  validate(ctx, cmd) { requireStringParam(cmd, 'factionId'); return { ok: true }; },
  execute(ctx, cmd) { signCommission(ctx.world, cmd.params.factionId); },
});

registerCommand('AdjustChoamShares', {
  desc: 'S7 调整 CHOAM 星际垄断联合体股份（clamp [0,100]；≥30 贸易分红 ×1.15 / ≥50 禁运杠杆）',
  validate(ctx, cmd) { requireIntParam(cmd, 'delta'); return { ok: true }; },
  execute(ctx, cmd) { adjustChoamShares(ctx.world, cmd.params.delta); },
});

registerCommand('AdjustLandsraadStanding', {
  desc: 'S7 调整兰兹拉德大议会选票（standing clamp [0,100]；法案提案与表决票权来源）',
  validate(ctx, cmd) { requireIntParam(cmd, 'delta'); return { ok: true }; },
  execute(ctx, cmd) { adjustLandsraadStanding(ctx.world, cmd.params.delta); },
});

registerCommand('UpgradePalaceEspionage', {
  desc: 'S7 升级宫殿间谍翼（精确扣 8000 信用点 → 特工招募速度 ×1.5）',
  validate() { return { ok: true }; },
  execute(ctx) { upgradePalaceEspionage(ctx.world); },
});

registerCommand('LayerUpSpyNetwork', {
  desc: 'S7 间谍网升层（0→3；每层扣 10 情报点；≥2 层使目标派系在兰兹拉德表决弃权）',
  validate(ctx, cmd) { requireStringParam(cmd, 'targetFactionId'); return { ok: true }; },
  execute(ctx, cmd) { layerUpSpyNetwork(ctx.world, cmd.params.targetFactionId); },
});

registerCommand('PlantDoubleAgent', {
  desc: 'S7 植入双面间谍（前置满 3 层间谍网；扣 20 情报点；表决强制赞成 + 刺杀前置）',
  validate(ctx, cmd) { requireStringParam(cmd, 'targetFactionId'); return { ok: true }; },
  execute(ctx, cmd) { plantDoubleAgent(ctx.world, cmd.params.targetFactionId); },
});

registerCommand('Assassinate', {
  desc: 'S7 终极刺杀（满 3 层 + 双面间谍 → 目标派系首脑移除 + 关系震荡 + 网络曝光焚毁）',
  validate(ctx, cmd) { requireStringParam(cmd, 'targetFactionId'); return { ok: true }; },
  execute(ctx, cmd) { assassinate(ctx.world, cmd.params.targetFactionId); },
});

registerCommand('ProposeLandsraadBill', {
  desc: `S7 提出兰兹拉德宪章法案（standing ≥ 10 提案席位；月末 standing 加权表决；合法 ${LANDSRAAD_BILL_KINDS.join('|')}）`,
  validate(ctx, cmd) {
    const kind = requireStringParam(cmd, 'kind');
    if (!LANDSRAAD_BILL_KINDS.includes(kind)) {
      return { ok: false, code: 'BAD_BILL_KIND', reason: `未知宪章法案 ${kind}` };
    }
    return { ok: true };
  },
  execute(ctx, cmd) { proposeLandsraadBill(ctx.world, cmd.params.kind); },
});

registerCommand('HireEnclaveMentor', {
  desc: `S7 雇佣中立星际城邦 Lv5 导师（capExempt 不占领袖容量；合法 ${ENCLAVE_TYPES.join('|')}）`,
  validate(ctx, cmd) {
    const t = requireStringParam(cmd, 'enclaveType');
    if (!ENCLAVE_TYPES.includes(t)) {
      return { ok: false, code: 'BAD_ENCLAVE', reason: `未知城邦类型 ${t}` };
    }
    return { ok: true };
  },
  execute(ctx, cmd) { hireEnclaveMentor(ctx.world, cmd.params.enclaveType); },
});

registerCommand('AttackEnclave', {
  desc: 'S7 攻击中立城邦（该城邦雇佣导师立即愤然离职 + 内阁议程进度 −20%）',
  validate(ctx, cmd) {
    const v = cmd.params ? cmd.params.mentorId : undefined;
    if (v == null || (typeof v !== 'string' && typeof v !== 'number')) {
      throw new Error('SO: 参数 mentorId 须为人物 ID');
    }
    return { ok: true };
  },
  execute(ctx, cmd) { attackEnclaveConsequence(ctx.world, cmd.params.mentorId); },
});
