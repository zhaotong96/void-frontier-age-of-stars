/**
 * domain/fleets/fleetDoctrineAndScars.js — S5 舰队学说、战备度（CR）与 D-Mods / S-Mods 战损伤痕弧
 * （SPEC-PLAN-046 阶段三 M3 Task 3.1；责任人：Eng-C）
 *
 * 职责（doc46 §Task 3.1 逐条契约）：
 *  1. 巡逻司令部（Patrol HQ）与舰队学说（Doctrine Tabs）：
 *     upgradePatrolHQ(world, colonyOrPlanetId) 精确扣 250000 credits（ledger.debit 走玩家派系账）
 *     → planet.patrolHQ = { level, doctrine:{shipSizeWeight,qualityWeight,officerAggression} }，
 *     不足 throw Error('SO:…')（命令总线事务回滚）；
 *     computeDoctrineTemplate(doctrine) 按三滑块输出轻/中/重编队配比（确定性公式，供 M3
 *     自主星区生态舰队的 PATROL_FLOTILLA 编队派生消费）。
 *  2. 指挥官分流加成：ADMIRAL_BONUS_PER_LEVEL / GENERAL_BONUS_PER_LEVEL（每级 +5% × 3 轨道），
 *     commanderModifiers(character) 汇总（level × 5 / 100 整商形式，杜绝 IEEE-754 累积尾差）。
 *  3. 战备度 CR ∈ [0,100]：fleet.scars = { cr, dMods, sMods, … } 惰性挂载（ensureFleetScars）；
 *     部署补给费 deploySupplyCost(ship) === 月度补给维护费（SHIP_SUPPLY_COSTS 表，hammerhead:10
 *     为门禁锚点）；风暴/高辐射/黑洞 transit 每 tick CR 流失（stepFleetReadiness 经
 *     registerHourly 'fleet-doctrine-readiness' 挂 clock fleet 10 桶语义）；CR < 40 →
 *     子系统故障旗标（deriveSeed(ARC_S5_DOCTRINE,…) 确定性选子系统）；
 *     ZERO_FLUX_MISSILES + officerAggression ≥ 0.8 → 爆发齐射旗标（alphaStrike）。
 *  4. D-Mods / S-Mods：DMOD_CATALOG 五项永久暗伤（每项部署补给费与月维护 −20%，封顶 3 项 −60%）；
 *     salvageShipWithDMods 确定性挂 1~3 项；restoreShipDMod 扣 500 alloy 移除；
 *     SMOD_CATALOG 传奇词条（installShipSMod 扣 1 exoticMatter，不占 OP，加成进 shipBonusSummary）。
 *  5. 战役残骸：recordEpicBattleWreck（capitalLosses ≥ 15 → world.spaceOperaState.wreckSites）；
 *     salvageBattleWreckHabitat → 残骸栖息地（永久军事凝聚力产出）或拆解资源回收。
 *
 * 时钟接线裁决：本模块 import 期经 registerHourly 注册 'fleet-doctrine-readiness' 阶段
 * （函数体首行守卫 world.spaceOperaState：金快照世界零读取零写入）；舰队桶按
 * numericEntityKey(fleet.id) % 10 === tick % 10 轮询（与 SpaceOperaClock Medium fleet 桶同款
 * 10 桶口径）。阶段注册序裁决：本阶段可能晚于 'space-opera' 注册（编排层 import 时点决定），
 * readiness 步进只写 fleet.scars / ship.scars，与局势步进无顺序耦合，阶段序扰动零语义影响。
 *
 * M3 命令 handler 注入裁决：ConfigureFleetDoctrine / RestoreShipDMod / InstallShipSMod /
 * SalvageBattleWreckHabitat 的 (ctx, cmd) 适配层由后续阶段编排层经
 * commandsSpaceOpera.registerSpaceOperaCommandHandler 注入（commandsSpaceOpera.js:10 契约），
 * 本模块只提供 (world, …) 领域落点 —— 与 M1/M2「弧模块不回注 app 层」的分层纪律一致。
 *
 * 纪律（doc43 §1.4 零漂移铁律）：
 *  - import 期仅注册时钟阶段与冻结常量，不改任何世界状态；
 *  - 阶段入口首行守卫 world.spaceOperaState；scars/patrolHQ 一律惰性 ensure、幂等；
 *  - 确定性随机一律 deriveSeed/sampleFloat01 + DOMAIN_SALTS.ARC_S5_DOCTRINE（0xC501，
 *    「S5 战舰 D-Mod 战损抽签与残骸生成」语义盐）；零 Math.random / Date.now；
 *  - 未触达世界（无 spaceOperaState、未调用任何命令）逐位零漂移。
 */

import { HULLS } from '../../content/hulls.js';
import { DOMAIN_SALTS, deriveSeed, sampleFloat01 } from '../world/deterministicRng.js';
import { ensureSpaceOperaState } from '../world/worldMigration.js';
import { numericEntityKey } from '../planets/planetStateSchema.js';
import { debit, credit } from '../economy/ledger.js';
import { emit } from '../../core/eventBus.js';

/** S5 确定性子流盐值（DOMAIN_SALTS 冻结表：S5 D-Mod 战损抽签与残骸生成域） */
const S5_SALT = DOMAIN_SALTS.ARC_S5_DOCTRINE;

/* ============================== Task 3.1 §1 巡逻司令部与舰队学说 ============================== */

/** 巡逻司令部升级精确费用（doc46 §Task 3.1 §1：250,000 信用点） */
export const PATROL_HQ_UPGRADE_CREDITS = 250000;

/** 学说三滑块出厂默认（doc46 §Task 3.1 §1 交付契约：三值精确 0.5） */
export const DEFAULT_DOCTRINE = Object.freeze({
  shipSizeWeight: 0.5,
  qualityWeight: 0.5,
  officerAggression: 0.5,
});

/** 三滑块合法域 [0,1]（内部口径；命令层 0..100 整数经 /100 归一） */
const CLAMP01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * 升级军事基地至巡逻司令部（250000 credits 精确扣账，走玩家派系账本）。
 * 目标行星解析两级回查（数字键直查 + 'plt_N' 前缀回查，与 commandsSpaceOpera 同构）。
 * 业务失败（行星不存在 / 玩家派系未定义 / 已存在巡逻司令部 / credits 不足）
 * 抛 Error('SO:…') → 命令总线事务回滚。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} colonyOrPlanetId - 殖民地或行星 ID（planetId 口径）
 * @returns {object} 新建的 planet.patrolHQ（{level, factionId, doctrine}）
 */
export function upgradePatrolHQ(world, colonyOrPlanetId) {
  const planet = resolvePlanetEntity(world, colonyOrPlanetId);
  if (!planet) throw new Error(`SO: 巡逻司令部目标行星不存在 ${String(colonyOrPlanetId)}`);
  const pf = world && world.playerFactionId;
  if (!pf) throw new Error('SO: 巡逻司令部升级需要已定义的玩家派系（world.playerFactionId）');
  if (planet.patrolHQ) throw new Error(`SO: 行星 ${String(planet.id)} 已存在巡逻司令部，禁止重复升级`);
  const ok = debit(world, pf, 'credits', PATROL_HQ_UPGRADE_CREDITS, 'patrolHQUpgrade', planet.id);
  if (!ok) {
    throw new Error(`SO: 信用点不足 ${PATROL_HQ_UPGRADE_CREDITS}，无法升级巡逻司令部`);
  }
  planet.patrolHQ = {
    level: 1,
    factionId: pf,
    doctrine: { ...DEFAULT_DOCTRINE },
  };
  emit(world, 'PatrolHQUpgraded', {
    planetId: planet.id,
    factionId: pf,
    credits: PATROL_HQ_UPGRADE_CREDITS,
    doctrine: planet.patrolHQ.doctrine,
  }, 'fleet');
  return planet.patrolHQ;
}

/**
 * 调整巡逻司令部学说三滑块（ConfigureFleetDoctrine 命令领域落点；M3 编排层注入 handler）。
 * 数值口径：入参为 0..100 整数滑块（commandSchemas 整数契约），内部 /100 归一到 [0,1]；
 * empireId 仅作契约透传（M3 无多帝国映射表，与 EmergencyDebtRestructure 同口径不参与匹配）。
 * 无 patrolHQ 的行星按出厂默认自动建站（学说面板可先于升级调节）。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} planetId - 巡逻司令部所在行星 ID
 * @param {{shipSizeWeight?: number, qualityWeight?: number, officerAggression?: number}} percentPatch - 0..100 滑块补丁
 * @returns {object} 更新后的 doctrine（[0,1] 归一口径）
 */
export function setPatrolHQDoctrine(world, planetId, percentPatch = {}) {
  const planet = resolvePlanetEntity(world, planetId);
  if (!planet) throw new Error(`SO: 学说目标行星不存在 ${String(planetId)}`);
  const hq = planet.patrolHQ
    || (planet.patrolHQ = { level: 1, factionId: world && world.playerFactionId || null, doctrine: { ...DEFAULT_DOCTRINE } });
  const pct = (v, fallback) => {
    if (!Number.isFinite(v)) return fallback;
    if (v < 0 || v > 100) throw new Error(`SO: 学说滑块必须为 0..100（实测 ${String(v)}）`);
    return v / 100;
  };
  const d = hq.doctrine;
  d.shipSizeWeight = pct(percentPatch.shipSizeWeight, d.shipSizeWeight);
  d.qualityWeight = pct(percentPatch.qualityWeight, d.qualityWeight);
  d.officerAggression = pct(percentPatch.officerAggression, d.officerAggression);
  emit(world, 'DoctrineReconfigured', { planetId: planet.id, doctrine: { ...d } }, 'fleet');
  return d;
}

/** 编队等级语义表（computeDoctrineTemplate 配比键 → 中文语义；供巡逻舰队派生消费） */
export const DOCTRINE_FORMATION_CLASSES = Object.freeze({
  light: '轻型护卫幕（多艘轻型护卫舰）',
  mid: '中型主力屏卫（驱逐/巡洋压制线）',
  heavy: '重型决战列（少量重型主力舰）',
});

/**
 * 按三滑块输出轻/中/重编队配比（纯函数、确定性；三分量恒和为 1）：
 *   sizeW = shipSizeWeight，q = qualityWeight，a = officerAggression（均 clamp [0,1]）
 *   heavy = sizeW
 *   screen = 1 − sizeW                        —— 屏卫总份额
 *   midBase = screen × (0.25 + 0.5q)          —— 精锐(q→1)偏中型主力屏卫，量产(q→0)偏轻型
 *   mid = midBase × (1 − 0.4a)                —— 鲁莽(a→1)军官把屏卫重心推向轻型游击
 *   light = screen − mid
 * 出厂默认 (0.5, 0.5, 0.5) → { light: 0.3, mid: 0.2, heavy: 0.5 }（逐位精确）。
 *
 * @param {object} doctrine - { shipSizeWeight, qualityWeight, officerAggression }（[0,1] 口径）
 * @returns {{light: number, mid: number, heavy: number, classes: Object<string,string>}} 配比与语义表
 */
export function computeDoctrineTemplate(doctrine) {
  const d = doctrine && typeof doctrine === 'object' ? doctrine : DEFAULT_DOCTRINE;
  const sizeW = CLAMP01(d.shipSizeWeight);
  const q = CLAMP01(d.qualityWeight);
  const a = CLAMP01(d.officerAggression);
  const heavy = sizeW;
  const screen = 1 - sizeW;
  const midBase = screen * (0.25 + 0.5 * q);
  const mid = midBase * (1 - 0.4 * a);
  const light = screen - mid;
  return {
    light,
    mid,
    heavy,
    classes: { ...DOCTRINE_FORMATION_CLASSES },
  };
}

/* ============================== Task 3.1 §2 指挥官分流加成 ============================== */

/** 舰队提督（Admiral）：每级舰队武器伤害/开火射速/紧急撤退成功率各 +5% */
export const ADMIRAL_BONUS_PER_LEVEL = Object.freeze({
  weaponDamage: 0.05,
  fireRate: 0.05,
  disengageChance: 0.05,
});

/** 陆战将军（General）：每级对星际基地伤害/轨道轰炸效率/地面陆军伤害各 +5% */
export const GENERAL_BONUS_PER_LEVEL = Object.freeze({
  baseDamage: 0.05,
  orbitalBombardment: 0.05,
  armyDamage: 0.05,
});

/**
 * 指挥官分流加成汇总（纯函数）：galacticParagons.paragon.commandPath
 * （'ADMIRAL' | 'GENERAL'，缺省按 fleetId 有无推断）× 每级 5%。
 * 数值用 (level × 5) / 100 整商形式：0.05×3 = 0.15000000000000002 的 IEEE 尾差规避。
 * 未挂 paragon 档案的普通人物按 fleetId 推断轨道、character.level 计级（零写入）。
 *
 * @param {object} character - 人物实体（crew.js 形态：level/traits/fleetId [+ paragon]）
 * @returns {{path: string, level: number, weaponDamage: number, fireRate: number,
 *            disengageChance: number, baseDamage: number, orbitalBombardment: number, armyDamage: number}}
 */
export function commanderModifiers(character) {
  const paragon = character && character.paragon;
  const path = paragon && (paragon.commandPath === 'GENERAL' || paragon.commandPath === 'ADMIRAL')
    ? paragon.commandPath
    : (character && character.fleetId ? 'ADMIRAL' : 'GENERAL');
  const level = Math.max(0, Math.trunc((character && Number.isFinite(character.level) ? character.level : 1)));
  // 整商形式（杜绝 IEEE 尾差）：0.05 → 5/100，level × 5 / 100 与字面量逐位相等
  const admiral = path === 'ADMIRAL';
  const pct = Math.round((admiral
    ? ADMIRAL_BONUS_PER_LEVEL.weaponDamage
    : GENERAL_BONUS_PER_LEVEL.baseDamage) * 100); // 5
  const mult = (level * pct) / 100;
  return {
    path,
    level,
    weaponDamage: admiral ? mult : 0,
    fireRate: admiral ? mult : 0,
    disengageChance: admiral ? mult : 0,
    baseDamage: !admiral ? mult : 0,
    orbitalBombardment: !admiral ? mult : 0,
    armyDamage: !admiral ? mult : 0,
  };
}

/* ============================== Task 3.1 §3 战备度（CR）与补给费 ============================== */

/**
 * 战舰补给费表（部署一次的 CR 折算补给 === 月度基础补给维护费）：
 *  - 'hammerhead': 10 为 CHK-M3-01 门禁锚点（doc46 §Task 3.1 §3 精确值）；
 *  - 其余船按 hulls.js 结构值导出：structure < 300 → 5（轻型），< 1000 → 10（中型），≥ 1000 → 20（重型）；
 *  - 未知船体缺省 5。
 */
export const DEFAULT_SUPPLY_COST = 5;

const SUPPLY_BY_HULL = Object.fromEntries(HULLS.map((h) => {
  const s = h.baseStats && h.baseStats.structure;
  const cost = !(s >= 300) ? 5 : (s < 1000 ? 10 : 20);
  return [h.id, cost];
}));

export const SHIP_SUPPLY_COSTS = Object.freeze({
  hammerhead: 10,
  ...SUPPLY_BY_HULL,
});

/** 零幅能导弹挂架（本模型中导弹/鱼雷为弹药消耗而非幅能消耗 → 零幅能挂架权威集） */
export const ZERO_FLUX_MISSILE_MODULES = Object.freeze(['mod_missile_rack', 'mod_torpedo_launcher']);

/** 军官狂热阈值：officerAggression ≥ 0.8 且挂零幅能导弹 → 爆发齐射旗标 */
export const ALPHA_STRIKE_AGGRESSION_THRESHOLD = 0.8;

/** CR 流失速率（每 tick；doc46 §Task 3.1 §3 无精确值 → M3 裁决，写入 notes） */
export const CR_DRAIN_PER_TICK = Object.freeze({
  hyperspaceStorm: 0.05,   // 超空间风暴 transit
  radiationNebula: 0.08,   // 高辐射星云
  blackHole: 0.15,         // 逼近黑洞视界
});

/** CR < 40 → 子系统故障旗标（doc46 精确阈值） */
export const CR_FAILURE_THRESHOLD = 40;

/** 子系统目录（确定性抽签池；CR < 40 时 deriveSeed 选中） */
export const SUBSYSTEM_CATALOG = Object.freeze([
  'weapons', 'engines', 'shields', 'sensors', 'life_support', 'fire_control',
]);

/**
 * 惰性挂载 fleet.scars（幂等；绝不消费 world.rng）。
 * 结构：{ cr: 100, dMods: [], sMods: [], lastCrTick: null, subsystemFault: null }
 */
export function ensureFleetScars(fleet) {
  if (!fleet || typeof fleet !== 'object') throw new Error('SO: ensureFleetScars 需要 fleet 实体');
  if (!fleet.scars || typeof fleet.scars !== 'object') {
    fleet.scars = { cr: 100, dMods: [], sMods: [], lastCrTick: null, subsystemFault: null };
  }
  if (!Number.isFinite(fleet.scars.cr)) fleet.scars.cr = 100;
  if (!Array.isArray(fleet.scars.dMods)) fleet.scars.dMods = [];
  if (!Array.isArray(fleet.scars.sMods)) fleet.scars.sMods = [];
  return fleet.scars;
}

/**
 * 惰性挂载 ship.scars（幂等；ship 级 D-Mods / S-Mods / 齐射旗标）。
 * 结构：{ cr: 100, dMods: [], sMods: [], alphaStrike: false }
 */
export function ensureShipScars(ship) {
  if (!ship || typeof ship !== 'object') throw new Error('SO: ensureShipScars 需要 ship 实体');
  if (!ship.scars || typeof ship.scars !== 'object') {
    ship.scars = { cr: 100, dMods: [], sMods: [], alphaStrike: false };
  }
  if (!Number.isFinite(ship.scars.cr)) ship.scars.cr = 100;
  if (!Array.isArray(ship.scars.dMods)) ship.scars.dMods = [];
  if (!Array.isArray(ship.scars.sMods)) ship.scars.sMods = [];
  return ship.scars;
}

/**
 * D-Mod 部署费乘数：deploymentCostMultiplier(n) = 1 − 0.2 × min(3, n)。
 * 精确性裁决（CHK-M3-01：1/2/3 → 0.8/0.6/0.4 逐位精确）：n=3 时 0.2×3 的 IEEE-754
 * 双精度为 0.6000000000000001，1 − 0.6000000000000001 = 0.3999999999999999 ≠ 0.4 ——
 * 故按整商形式 (10 − 2 × min(3,n)) / 10 计算：8/10、6/10、4/10 与字面量 0.8/0.6/0.4
 * 的最近双精度逐位相等。
 *
 * @param {number} n - D-Mod 数量
 * @returns {number} 乘数 ∈ {1, 0.8, 0.6, 0.4}
 */
export function deploymentCostMultiplier(n) {
  const k = Math.max(0, Math.min(3, Math.trunc(Number.isFinite(n) ? n : 0)));
  return (10 - 2 * k) / 10;
}

/** 船体补给费（SHIP_SUPPLY_COSTS 查表；未知船体缺省 5） */
export function supplyCostOfHull(hullId) {
  return SHIP_SUPPLY_COSTS[hullId] ?? DEFAULT_SUPPLY_COST;
}

/** ShipSize（XP 公式「×ShipSize」与编成等级共用口径 = 基础补给费 5/10/20） */
export function shipSizeOf(ship) {
  return supplyCostOfHull(ship && ship.hullId);
}

/**
 * 战舰部署补给费 === 月度补给维护费：
 *   deploySupplyCost(ship) = SHIP_SUPPLY_COSTS[hullId]（缺省 5）× deploymentCostMultiplier(|dMods|)
 */
export function deploySupplyCost(ship) {
  if (!ship || typeof ship !== 'object') return 0;
  const base = supplyCostOfHull(ship.hullId);
  const n = (ship.scars && Array.isArray(ship.scars.dMods)) ? ship.scars.dMods.length : 0;
  return base * deploymentCostMultiplier(n);
}

/** 月度补给维护费（与部署补给费同口径；doc46 §Task 3.1 §4 D-Mod 折扣同时作用于月维护） */
export function monthlyMaintenanceCost(ship) {
  return deploySupplyCost(ship);
}

/** 舰队月度维护合计（Σ 各舰 deploySupplyCost；集成层月度扣账消费） */
export function fleetMonthlyMaintenance(world, fleet) {
  if (!fleet || !Array.isArray(fleet.shipIds)) return 0;
  let total = 0;
  for (const sid of fleet.shipIds) {
    const ship = world && world.entities && world.entities.ships ? world.entities.ships[sid] : null;
    if (ship) total += deploySupplyCost(ship);
  }
  return total;
}

/* ============================== Task 3.1 §4 D-Mods / S-Mods ============================== */

/** D-Mod 目录（doc46 交付契约五项，冻结） */
export const DMOD_CATALOG = Object.freeze([
  'dmg_armor_belt',
  'dmg_reactor_conduit',
  'dmg_fire_control',
  'dmg_engine_housing',
  'dmg_weapon_rig',
]);

/** 每个 D-Mod 的折扣与封顶项数（−20%/项，最多 3 项 = −60%） */
export const DMOD_DISCOUNT_PER = 0.2;
export const DMOD_MAX_STACK = 3;

/** D-Mod 修复费用（500 alloy，doc46 交付契约精确值） */
export const DMOD_RESTORE_ALLOY = 500;

/**
 * S-Mod 传奇词条目录（≥4 条；含加成数值；不占 OP，加成进 shipBonusSummary）。
 * M3 裁决数值（doc46 未给精确值，按 Starsector 语义标定）。
 */
export const SMOD_CATALOG = Object.freeze({
  smod_hardened_subsystems: Object.freeze({ nameZh: '强化子系统', subsystemDamageResist: 0.25 }),
  smod_advanced_optics: Object.freeze({ nameZh: '先进光学阵列', weaponRange: 0.15, hitChanceBonus: 0.05 }),
  smod_flux_coil_overdrive: Object.freeze({ nameZh: '幅能线圈超驰', fireRate: 0.10, weaponDamage: 0.05 }),
  smod_aurora_armor_weave: Object.freeze({ nameZh: '极光装甲织网', armor: 0.15 }),
  smod_psychic_relay: Object.freeze({ nameZh: '灵能中继核', shieldRegen: 0.20, psychicShieldPenetration: true }),
});

/** S-Mod 安装费用（1 exoticMatter，doc46 交付契约精确值） */
export const SMOD_INSTALL_EXOTIC_MATTER = 1;

/** 行星实体解析（数字 planetId 直查 + 'plt_N' 前缀回查；与 commandsSpaceOpera 同构） */
function resolvePlanetEntity(world, planetId) {
  const bag = world && world.entities && world.entities.planets;
  if (!bag) return null;
  if (bag[planetId]) return bag[planetId];
  return bag[`plt_${planetId}`] || null;
}

/** 舰船实体解析（数字 shipId 直查 + 'shp_N' 前缀回查；ids.js PREFIXES.ship='shp' 口径） */
function resolveShipEntity(world, shipId) {
  const bag = world && world.entities && world.entities.ships;
  if (!bag) return null;
  if (bag[shipId]) return bag[shipId];
  return bag[`shp_${shipId}`] || null;
}

/** 玩家派系 ID（命令层扣账权威；未定义抛 SO） */
function playerFaction(world) {
  const pf = world && world.playerFactionId;
  if (!pf) throw new Error('SO: 需要已定义的玩家派系（world.playerFactionId）');
  return pf;
}

/**
 * 战后打捞修复：确定性挂载 1~3 项永久结构暗伤（D-Mods）。
 * 抽签 deriveSeed(world.seed, ARC_S5_DOCTRINE, shipKey, step=world.tick)：
 *   r0 ∈ [0,1) × 3 取整 → 项数 1..3；随后逐步派生抽取目录去重项。
 * 被击毁（status==='destroyed'）的战舰打捞后重新入役：structure 恢复 60%、
 * 装甲/护盾恢复满值（M3 裁决口径）。追加挂载以 DMOD_MAX_STACK 封顶。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} shipId - 战舰 ID
 * @returns {object} ship.scars（含 dMods）
 */
export function salvageShipWithDMods(world, shipId) {
  const ship = resolveShipEntity(world, shipId);
  if (!ship) throw new Error(`SO: 打捞目标战舰不存在 ${String(shipId)}`);
  const scars = ensureShipScars(ship);
  const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
  const key = numericEntityKey(ship.id);
  const step = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const count = 1 + Math.floor(sampleFloat01(seed, S5_SALT, key, step) * 3); // 1..3

  const pool = DMOD_CATALOG.filter((id) => !scars.dMods.includes(id));
  const added = [];
  for (let i = 0; i < count && pool.length > 0 && scars.dMods.length < DMOD_MAX_STACK; i++) {
    const idx = deriveSeed(seed, S5_SALT, key, step * 16 + i + 1) % pool.length;
    added.push(pool[idx]);
    scars.dMods.push(pool[idx]);
    pool.splice(idx, 1);
  }

  if (ship.status === 'destroyed') {
    const stats = ship.stats || {};
    ship.status = 'active';
    ship.hp = {
      structure: Math.max(1, Math.round((Number.isFinite(stats.structure) ? stats.structure : 100) * 0.6)),
      armor: Number.isFinite(stats.armor) ? stats.armor : 0,
      shield: Number.isFinite(stats.shield) ? stats.shield : 0,
      shieldMax: Number.isFinite(stats.shield) ? stats.shield : 0,
    };
  }
  emit(world, 'ShipSalvagedWithDMods', {
    shipId: ship.id,
    hullId: ship.hullId,
    added,
    dMods: scars.dMods.slice(),
    deployCostMult: deploymentCostMultiplier(scars.dMods.length),
  }, 'fleet');
  return scars;
}

/**
 * 修复一项 D-Mod（RestoreShipDMod 命令领域落点）：精确扣 500 alloy（玩家派系账）→
 * 从 ship.scars.dMods 移除该项，恢复部署补给成本（消除 −20% 折扣档）。
 * 业务失败（舰船不存在 / 无该项暗伤 / alloy 不足）抛 Error('SO:…') → 事务回滚。
 */
export function restoreShipDMod(world, shipId, dModId) {
  const ship = resolveShipEntity(world, shipId);
  if (!ship) throw new Error(`SO: 修复目标战舰不存在 ${String(shipId)}`);
  const scars = ensureShipScars(ship);
  const pos = scars.dMods.indexOf(dModId);
  if (pos < 0) throw new Error(`SO: 战舰 ${String(ship.id)} 未挂载暗伤 ${String(dModId)}`);
  const pf = playerFaction(world);
  if (!debit(world, pf, 'alloy', DMOD_RESTORE_ALLOY, 'restoreDMod', ship.id)) {
    throw new Error(`SO: 合金不足 ${DMOD_RESTORE_ALLOY}，无法修复暗伤 ${String(dModId)}`);
  }
  scars.dMods.splice(pos, 1);
  emit(world, 'ShipDModRestored', {
    shipId: ship.id,
    dModId,
    dMods: scars.dMods.slice(),
    deployCostMult: deploymentCostMultiplier(scars.dMods.length),
  }, 'fleet');
  return scars;
}

/**
 * 安装传奇改装（InstallShipSMod 命令领域落点）：精确扣 1 exoticMatter（玩家派系账）→
 * 词条永久焊死进 ship.scars.sMods（不占装配点 OP；加成经 shipBonusSummary 读取）。
 * 业务失败（舰船不存在 / 未知词条 / 已安装 / exoticMatter 不足）抛 Error('SO:…') → 回滚。
 */
export function installShipSMod(world, shipId, moduleId) {
  const ship = resolveShipEntity(world, shipId);
  if (!ship) throw new Error(`SO: 安装目标战舰不存在 ${String(shipId)}`);
  const def = SMOD_CATALOG[moduleId];
  if (!def) {
    throw new Error(`SO: 未知传奇改装词条 ${String(moduleId)}（合法集 ${Object.keys(SMOD_CATALOG).join('|')}）`);
  }
  const scars = ensureShipScars(ship);
  if (scars.sMods.includes(moduleId)) throw new Error(`SO: 战舰 ${String(ship.id)} 已安装词条 ${String(moduleId)}`);
  const pf = playerFaction(world);
  if (!debit(world, pf, 'exoticMatter', SMOD_INSTALL_EXOTIC_MATTER, 'installSMod', ship.id)) {
    throw new Error(`SO: 奇异物质不足 ${SMOD_INSTALL_EXOTIC_MATTER}，无法安装词条 ${String(moduleId)}`);
  }
  scars.sMods.push(moduleId);
  emit(world, 'ShipSModInstalled', { shipId: ship.id, moduleId, sMods: scars.sMods.slice() }, 'fleet');
  return scars;
}

/** 战舰是否挂载零幅能导弹挂架（ZERO_FLUX_MISSILES 权威集） */
export function hasZeroFluxMissiles(ship) {
  const mods = ship && Array.isArray(ship.modules) ? ship.modules : [];
  return mods.some((m) => ZERO_FLUX_MISSILE_MODULES.includes(m));
}

/**
 * 战舰加成汇总（集成层战斗结算 / UI 消费）：
 *  - sMods 词条数值加成按键累加、布尔旗标按或聚合；
 *  - dMods 计数 → deployCostMult / supplyCost（= deploySupplyCost，含 D-Mod 折扣）；
 *  - 可选 doctrine：officerAggression ≥ 0.8 且挂零幅能导弹 → alphaStrike 爆发齐射旗标。
 */
export function shipBonusSummary(ship, doctrine = null) {
  const summary = {};
  const scars = ship && ship.scars;
  if (scars && Array.isArray(scars.sMods)) {
    for (const id of scars.sMods) {
      const def = SMOD_CATALOG[id];
      if (!def) continue;
      for (const k of Object.keys(def)) {
        if (k === 'nameZh') continue;
        const v = def[k];
        if (typeof v === 'boolean') summary[k] = summary[k] === true || v === true;
        else if (Number.isFinite(v)) summary[k] = (summary[k] || 0) + v;
      }
    }
  }
  summary.dMods = scars && Array.isArray(scars.dMods) ? scars.dMods.slice() : [];
  summary.dModCount = summary.dMods.length;
  summary.deployCostMult = deploymentCostMultiplier(summary.dModCount);
  summary.supplyCost = ship ? deploySupplyCost(ship) : 0;
  summary.hasZeroFluxMissiles = hasZeroFluxMissiles(ship);
  summary.alphaStrike = summary.hasZeroFluxMissiles
    && !!doctrine
    && Number.isFinite(doctrine.officerAggression)
    && doctrine.officerAggression >= ALPHA_STRIKE_AGGRESSION_THRESHOLD;
  return summary;
}

/* ============================== Task 3.1 §5 战役残骸与残骸栖息地 ============================== */

/** 史诗会战残骸阈值：主力舰损失 ≥ 15 艘（doc46 精确值） */
export const EPIC_BATTLE_WRECK_THRESHOLD = 15;

/** 残骸栖息地永久军事凝聚力产出（每月；M3 裁决值） */
export const WRECK_HABITAT_UNITY_PER_MONTH = 20.0;

/** 拆解回收：每艘主力舰残骸回收 alloy / credits（M3 裁决线性式） */
export const WRECK_SALVAGE_ALLOY_PER_CAPITAL = 80;
export const WRECK_SALVAGE_CREDITS_PER_CAPITAL = 600;

/**
 * 记录史诗会战残骸（集成层战役结算调用）：capitalLosses ≥ 15 →
 * world.spaceOperaState.wreckSites.push({id, systemId, capitalLosses, tick})（幂等自增 id）。
 * 低于阈值零写入（无残骸）。
 *
 * @param {object} world - 世界根对象
 * @param {number|string} systemId - 会战星系 ID
 * @param {number} capitalLosses - 主力舰损失数
 * @returns {object|null} 新建的残骸记录（未达阈值返回 null）
 */
export function recordEpicBattleWreck(world, systemId, capitalLosses) {
  if (!Number.isFinite(capitalLosses) || capitalLosses < EPIC_BATTLE_WRECK_THRESHOLD) return null;
  const soState = ensureSpaceOperaState(world);
  if (!Array.isArray(soState.wreckSites)) soState.wreckSites = [];
  if (!Number.isFinite(soState.nextWreckSiteId)) soState.nextWreckSiteId = 1;
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const record = {
    id: soState.nextWreckSiteId,
    systemId,
    capitalLosses: Math.trunc(capitalLosses),
    tick,
    converted: null,
  };
  soState.nextWreckSiteId += 1;
  soState.wreckSites.push(record);
  emit(world, 'EpicBattleWreckRecorded', {
    wreckId: record.id,
    systemId,
    capitalLosses: record.capitalLosses,
  }, 'fleet');
  return record;
}

/**
 * 战役残骸处置（SalvageBattleWreckHabitat 命令领域落点）：
 *  - convertToHabitat = true → 改造为永久「残骸栖息地」：converted = 'habitat'，
 *    habitatYield = { unityPerMonth: WRECK_HABITAT_UNITY_PER_MONTH }（永久军事凝聚力产出实体语义）；
 *  - false → 拆解回收：converted = 'salvaged'，玩家派系入账
 *    alloy = 80 × capitalLosses、credits = 600 × capitalLosses（FLOW.LOOT 口径）。
 * 业务失败（残骸不存在 / 已处置）抛 Error('SO:…') → 事务回滚。
 *
 * @returns {object} 处置后的残骸记录
 */
export function salvageBattleWreckHabitat(world, wreckEntityId, convertToHabitat) {
  const soState = ensureSpaceOperaState(world);
  const sites = Array.isArray(soState.wreckSites) ? soState.wreckSites : [];
  const wreck = sites.find((w) => w && (w.id === wreckEntityId || String(w.id) === String(wreckEntityId)));
  if (!wreck) throw new Error(`SO: 战役残骸不存在 ${String(wreckEntityId)}`);
  if (wreck.converted) throw new Error(`SO: 残骸 ${String(wreck.id)} 已处置为 ${String(wreck.converted)}`);
  const pf = playerFaction(world);
  wreck.converted = convertToHabitat === true ? 'habitat' : 'salvaged';
  if (wreck.converted === 'habitat') {
    wreck.habitatYield = { unityPerMonth: WRECK_HABITAT_UNITY_PER_MONTH };
    emit(world, 'WreckHabitatConverted', {
      wreckId: wreck.id,
      systemId: wreck.systemId,
      unityPerMonth: WRECK_HABITAT_UNITY_PER_MONTH,
    }, 'fleet');
  } else {
    const alloy = WRECK_SALVAGE_ALLOY_PER_CAPITAL * wreck.capitalLosses;
    const credits = WRECK_SALVAGE_CREDITS_PER_CAPITAL * wreck.capitalLosses;
    // 资源回收走战利品流水（FLOW.LOOT 口径；来源确定性，无随机量）
    credit(world, pf, 'alloy', alloy, 'wreckSalvage', wreck.id);
    credit(world, pf, 'credits', credits, 'wreckSalvage', wreck.id);
    emit(world, 'WreckSalvaged', {
      wreckId: wreck.id,
      systemId: wreck.systemId,
      alloy,
      credits,
    }, 'fleet');
  }
  return wreck;
}

/* ============================== CR 步进（clock fleet 桶语义） ============================== */

/**
 * 学说查找：舰队归属派系名下第一座（键序确定性）巡逻司令部的 doctrine；
 * 无 patrolHQ → 出厂默认 doctrine（0.5/0.5/0.5）。纯读，零写入。
 */
function doctrineForFleet(world, fleet) {
  const planets = world && world.entities && world.entities.planets ? world.entities.planets : {};
  for (const key of Object.keys(planets).sort()) {
    const hq = planets[key] && planets[key].patrolHQ;
    if (hq && hq.doctrine && (hq.factionId === fleet.factionId)) return hq.doctrine;
  }
  return DEFAULT_DOCTRINE;
}

/** 单舰队 CR 步进（返回是否产生流失；stats 聚合由调用方完成） */
function stepFleetScars(world, fleet, tick, stats) {
  const scars = ensureFleetScars(fleet);
  const last = Number.isFinite(scars.lastCrTick) ? scars.lastCrTick : tick;
  scars.lastCrTick = tick; // 首遇即对齐节奏（dt=0），杜绝注入后的追涨突刺
  const dt = Math.max(0, tick - last);

  // —— 风暴 / 高辐射 / 黑洞 transit 每 tick CR 流失（dt 折算）——
  let rate = 0;
  let hazard = null;
  if (fleet.transit) {
    hazard = 'hyperspaceStorm';
    rate = CR_DRAIN_PER_TICK.hyperspaceStorm;
  } else {
    const sys = world.entities && world.entities.systems ? world.entities.systems[fleet.systemId] : null;
    const hazards = sys && Array.isArray(sys.hazards) ? sys.hazards : [];
    if (hazards.includes('gravityWell')) {
      hazard = 'blackHole';
      rate = CR_DRAIN_PER_TICK.blackHole;
    } else if (hazards.includes('radiationFlare')) {
      hazard = 'radiationNebula';
      rate = CR_DRAIN_PER_TICK.radiationNebula;
    }
  }
  if (rate > 0 && dt > 0) {
    scars.cr = Math.max(0, Math.min(100, scars.cr - rate * dt));
    stats.drained += 1;
  }

  // —— CR < 40 → 子系统故障旗标（确定性抽签）；≥ 40 恢复清除 ——
  if (scars.cr < CR_FAILURE_THRESHOLD) {
    if (!scars.subsystemFault) {
      const seed = (typeof world.seed === 'number' && Number.isFinite(world.seed)) ? world.seed >>> 0 : 0;
      const key = numericEntityKey(fleet.id);
      const id = SUBSYSTEM_CATALOG[deriveSeed(seed, S5_SALT, key, tick) % SUBSYSTEM_CATALOG.length];
      scars.subsystemFault = { id, sinceTick: tick };
      stats.faults += 1;
      emit(world, 'FleetSubsystemFault', { fleetId: fleet.id, cr: scars.cr, subsystem: id }, 'fleet');
    }
  } else if (scars.subsystemFault) {
    scars.subsystemFault = null;
  }

  // —— ZERO_FLUX_MISSILES + officerAggression ≥ 0.8 → 爆发齐射旗标（舰上每舰评估）——
  const doctrine = doctrineForFleet(world, fleet);
  const ships = world.entities && world.entities.ships ? world.entities.ships : {};
  if (Array.isArray(fleet.shipIds)) {
    for (const sid of fleet.shipIds) {
      const ship = ships[sid];
      if (!ship || typeof ship !== 'object') continue;
      const ss = ensureShipScars(ship);
      ss.alphaStrike = hasZeroFluxMissiles(ship)
        && Number.isFinite(doctrine.officerAggression)
        && doctrine.officerAggression >= ALPHA_STRIKE_AGGRESSION_THRESHOLD;
    }
  }
}

/**
 * 战备度步进（clock fleet 10 桶语义；registerHourly 'fleet-doctrine-readiness' 注册形态）。
 * 首行守卫 world.spaceOperaState（未挂载容器 → 金快照世界零读取零写入）；
 * 桶命中：numericEntityKey(fleet.id) % 10 === tick % 10（每舰队每 10 tick 访问一次）。
 *
 * @param {object} world - 世界根对象
 * @returns {{visited: number, drained: number, faults: number}} 本帧桶统计
 */
export function stepFleetReadiness(world) {
  const stats = { visited: 0, drained: 0, faults: 0 };
  if (!world || !world.spaceOperaState) return stats;
  const fleets = world.entities && world.entities.fleets ? world.entities.fleets : {};
  const tick = Number.isFinite(world.tick) ? Math.max(0, Math.trunc(world.tick)) : 0;
  const bucket = tick % 10;
  for (const key of Object.keys(fleets).sort()) {
    const fleet = fleets[key];
    if (!fleet || typeof fleet !== 'object') continue;
    const idNum = fleet.id !== undefined ? numericEntityKey(fleet.id) : numericEntityKey(key);
    if (idNum % 10 !== bucket) continue;
    stats.visited += 1;
    stepFleetScars(world, fleet, tick, stats);
  }
  return stats;
}

// —— 时钟阶段注册已收拢至 src/simulation/SpaceOperaWiring.js（SPEC-PLAN-049 §Task 49.3
//    唯一注册点：registerHourly('space-opera-fleet-readiness', …)，阶段 ID 自本文件原
//    'fleet-doctrine-readiness' 归一为 doc49 契约名）。原 import 期副作用注册拆除；
//    stepFleetReadiness 首行自守卫 world.spaceOperaState（金快照世界零读取零写入）。——
