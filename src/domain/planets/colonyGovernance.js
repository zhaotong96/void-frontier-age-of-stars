/**
 * domain/planets/colonyGovernance.js — 殖民聚落自治与社会微模拟（doc21 v0.8）
 *
 * 三级社会模拟架构（doc16 §4.19）：L1 人口统计（既有 colony 模拟保留）+
 * L2 居民群组代理（32 名具名代表，9 元组持久化）+ L3 关键角色（驻星总督）。
 *
 * 双轨社会心理（doc21 WP-2）：
 *   Φ（繁荣度）= clamp(0.40·H + 0.30·(100−D) + 0.15·S_svc + 0.15·η_power, 0, 100)
 *   H 希望 / D 不满 / S_svc 医疗娱乐覆盖率 / η_power 电网供电率。
 *
 * 四大聚落法典（doc21 WP-3.3，挂 planet.soc.edicts，与帝国政策互补）：
 *   emergency_shift 产出+35% 不满+6 健康−2 / double_rations 食物×1.8 希望+5 不满−4
 *   automata_shift conductor 维护 staffingEta 保底 0.85 希望上限−10 /
 *   quarantine_martial 疫情阻断 税基−30% 希望−3。
 *
 * 长期记忆（doc16 §4.21）：planet.soc.history 有界记录（≤20），后续事件可引用
 * 过去抉择；武装暴动临界（D≥90 且 H≤15 持续 7 日）→ gmt_suppress_rebellion。
 *
 * 确定性：困境抽取由 dilemmaSeed(tick) 派生；零 Math.random、零 world.rng。
 * 金快照零漂移：仅对 planet.soc 已初始化的行星生效（未触达星球零写入）。
 */

import { emit, chronicle } from '../../core/eventBus.js';
import { clamp } from '../../core/math.js';
import { derivePlanetSeedsExtended } from '../ground/planetSeeds.js';

/** 四大聚落法典定义（doc21 WP-3.3 契约表） */
export const COLONY_EDICTS = Object.freeze({
  edict_emergency_shift: {
    id: 'edict_emergency_shift', nameZh: '《应急双倍班次令》',
    outputMult: 1.35, discontentPerDay: 6, healthPerDay: -2, hopeCap: 0,
    desc: '全殖民地采掘与制造产出 +35%；代价为每日不满值 +6、健康度 −2',
  },
  edict_double_rations: {
    id: 'edict_double_rations', nameZh: '《双倍营养配给与津贴》',
    foodMult: 1.8, hopePerDay: 5, discontentPerDay: -4, popGrowthMult: 1.25, hopeCap: 0,
    desc: '每日食物消耗 ×1.8；换取希望值 +5、不满值 −4、人口增长率 +25%',
  },
  edict_automata_shift: {
    id: 'edict_automata_shift', nameZh: '《机偶混编作业法案》',
    upkeepConductor: 2, staffingFloor: 0.85, hopeCap: -10, desc: '消耗 conductor 维护费，用自治机器人填补 40% 岗位空缺；希望值上限降低 10 点',
  },
  edict_quarantine_martial: {
    id: 'edict_quarantine_martial', nameZh: '《生物隔离与检疫戒严》',
    taxMult: 0.70, hopePerDay: -3, blocksEpidemic: true, desc: '阻断异星孢子疫情扩散并将黑市损耗清零；商业税基暂时 −30%',
  },
});

/** 总督性格特质修正（doc21 WP-3.2） */
export const OVERSEER_TRAITS = Object.freeze({
  bookish: { researchMult: 1.20, desc: '科研产出 +20%，解锁疫情逆向制药选项' },
  iron_fisted: { discontentDecayMult: 2.0, hopeCap: -15, desc: '不满值自然衰减 ×2；希望值上限降低 15 点' },
  mercantile: { taxMult: 1.25, desc: '商业税基 +25%；走私风险微增' },
});

/** 暴动临界（doc21 WP-2.4：D≥90 且 H≤15 持续 7 天） */
export const REBELLION_DISCONTENT = 90;
export const REBELLION_HOPE = 15;
export const REBELLION_DAYS = 7;

/** 居民代理 9 元组下标（doc21 WP-1.2 契约） */
export const AGENT_IDX = Object.freeze({
  ID: 0, STRATUM: 1, HOME: 2, WORK: 3, SVC: 4, SHIFT: 5, MORALE: 6, HEALTH: 7, TRAIT: 8,
});

export const MAX_RESIDENT_AGENTS = 32;
/** 微缩昼夜循环（任务秒；180s = 24 战略 tick 的视图周期，doc21 WP-1.3） */
export const DAY_CYCLE_SECONDS = 180;

/** 惰性初始化 planet.soc（幂等；GroundView 首次进入殖民星 / ColonyView 打开时调用） */
export function ensurePlanetSoc(planet) {
  if (planet.soc && planet.soc.v === 1) return planet.soc;
  planet.soc = {
    v: 1,
    overseerId: null,
    edicts: [],
    agents: [],
    history: [],
    pendingDilemma: null,
    hope: 50,
    discontent: 10,
    prosperity: 50,
    crisisDays: 0,
    rebellionActive: false,
  };
  return planet.soc;
}

/**
 * 派生 32 名代表性居民代理（doc21 WP-1.2；确定性）。
 * 节点表：colony.buildings 逐建筑（住宅/生产/服务三类）；每人代表 1~5 统计人口。
 * @returns {Array<Array<number>>} 9 元组数组（≤32）
 */
export function deriveColonyAgents(world, planet, colony) {
  const soc = ensurePlanetSoc(planet);
  if (soc.agents.length > 0) return soc.agents;
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const blds = (colony && colony.buildings) || [];
  const homes = [];
  const works = [];
  const svcs = [];
  for (let i = 0; i < blds.length; i++) {
    const cat = String(blds[i].defId || '');
    if (cat === 'bld_housing') homes.push(i);
    else if (cat.startsWith('bld_mine') || ['bld_alloy_plant', 'bld_chem_plant', 'bld_polymer_plant', 'bld_module_factory', 'bld_electronics_plant', 'bld_arc_smelter', 'bld_coil_assembler'].includes(cat)) works.push(i);
    else if (['bld_medical_center', 'bld_entertainment_center', 'bld_admin_center', 'bld_education_center'].includes(cat)) svcs.push(i);
  }
  const pop = (colony && colony.population) || 6;
  const nAgents = Math.min(MAX_RESIDENT_AGENTS, Math.max(4, Math.ceil(pop / 2)));
  const agents = [];
  for (let i = 0; i < nAgents; i++) {
    const s = seeds.dilemmaSeed(i * 13 + 1);
    const stratum = i % 4; // 0 工人 1 工程师 2 科学家 3 士兵（错峰均衡）
    agents.push([
      i + 1,
      stratum,
      homes.length ? homes[i % homes.length] : 0,
      works.length ? works[i % works.length] : (homes.length ? homes[0] : 0),
      svcs.length ? svcs[i % svcs.length] : 0,
      s % 3,               // shiftPhase 0/1/2 三班倒
      70 + (s % 30),       // morale 初值 70..99
      80 + ((s >>> 4) % 20), // health 初值 80..99
      (s >>> 8) & 0xff,    // traitMask
    ]);
  }
  soc.agents = agents;
  return agents;
}

/**
 * 居民四时相行为状态机（doc21 WP-1.3；τ ∈ [0,1)）：
 *   0.00-0.12 通勤上岗 → 0.12-0.55 作业生产 → 0.55-0.75 休闲医疗 → 0.75-1.00 归家休憩
 * @param {number} tau 归一化时间（missionSeconds / DAY_CYCLE_SECONDS + shiftPhase 错峰）
 * @returns {number} 0..3 行为段
 */
export function residentPhaseOf(tau) {
  const t = ((tau % 1) + 1) % 1;
  if (t < 0.12) return 0;
  if (t < 0.55) return 1;
  if (t < 0.75) return 2;
  return 3;
}

/** Catmull-Rom 基函数（与 GroundView._buildConveyorPaths 同式） */
function cr(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/**
 * 通勤样条预烘焙（doc21 WP-1：地面道路 4~6 控制点；GroundView._layoutColony 调用）。
 * 纯函数 of (homePos, workPos, svcPos, field)：高度逐点贴合 sampleTerrain。
 * @returns {Array<Array<number>>} 控制点 [x,y,z]×5
 */
export function bakeCommuteSpline(homePos, workPos, svcPos, field, sampleTerrainFn) {
  const p0 = [homePos.x, homePos.y, homePos.z];
  const p3 = [workPos.x, workPos.y, workPos.z];
  const p1 = [p0[0] + (p3[0] - p0[0]) * 0.3, p0[1], p0[2] + (p3[2] - p0[2]) * 0.3];
  const p2 = [p0[0] + (p3[0] - p0[0]) * 0.7, p3[1], p0[2] + (p3[2] - p0[2]) * 0.7];
  const pts = [[p0[0], Number.isFinite(sampleTerrainFn(field, p0[0], p0[2]) && sampleTerrainFn(field, p0[0], p0[2]).y) ? sampleTerrainFn(field, p0[0], p0[2]).y + 0.05 : p0[1], p0[2]]];
  for (let k = 1; k <= 3; k++) {
    const t = k / 4;
    const x = cr(p0[0], p1[0], p2[0], p3[0], t);
    const z = cr(p0[2], p1[2], p2[2], p3[2], t);
    const sy = cr(p0[1], p1[1], p2[1], p3[1], t);
    const h = sampleTerrainFn(field, x, z);
    pts.push([x, Number.isFinite(h && h.y) ? h.y + 0.05 : sy, z]);
  }
  const hEnd = sampleTerrainFn(field, p3[0], p3[2]);
  pts.push([p3[0], Number.isFinite(hEnd && hEnd.y) ? hEnd.y + 0.05 : p3[1], p3[2]]);
  void svcPos;
  return pts;
}

/**
 * 样条代数相位插值（doc21 WP-1：60Hz 渲染层纯代数求值，零寻路零分配）。
 * @param {Array<Array<number>>} pts bakeCommuteSpline 控制点
 * @param {number} tau [0,1) 弧长参数
 * @returns {{x:number,y:number,z:number}} 位置（SOC-01 断言零穿地零悬空）
 */
export function sampleSplinePos(pts, tau) {
  // clamp 语义：tau=1 精确锚定终点（ residentTau 恒 ∈ [0,1)，显式 1 用于相位驻留）
  const t = Math.min(1, Math.max(0, tau));
  const segs = pts.length - 1;
  const s = Math.min(segs - 1e-9, Math.max(0, t * segs));
  const seg = Math.floor(s);
  const lt = s - seg;
  const a = pts[seg];
  const b = pts[seg + 1];
  return {
    x: a[0] + (b[0] - a[0]) * lt,
    y: a[1] + (b[1] - a[1]) * lt,
    z: a[2] + (b[2] - a[2]) * lt,
  };
}

/** 居民 τ（含三班倒错峰相位） */
export function residentTau(agent, missionSeconds) {
  const shiftOffset = agent[AGENT_IDX.SHIFT] / 3;
  return (missionSeconds / DAY_CYCLE_SECONDS + shiftOffset) % 1;
}

/**
 * 每日社会结算（DailySystems population 阶段后调用；仅 planet.soc 已初始化的行星）。
 * @returns {{hope:number, discontent:number, prosperity:number, rebellion:boolean}}
 */
export function tickColonySociety(world, planet, colony) {
  const soc = planet.soc;
  if (!soc || soc.v !== 1) return null;
  const fid = (colony && colony.factionId) || world.playerFactionId;

  // 1) 法典日结算
  let hopeCap = 100;
  let hopeDelta = 0;
  let discontentDelta = 0;
  let healthDelta = 0;
  let staffingFloor = 0;
  for (const eid of soc.edicts) {
    const ed = COLONY_EDICTS[eid];
    if (!ed) continue;
    hopeDelta += ed.hopePerDay || 0;
    discontentDelta += ed.discontentPerDay || 0;
    healthDelta += ed.healthPerDay || 0;
    if (ed.hopeCap) hopeCap += ed.hopeCap;
    if (ed.staffingFloor) staffingFloor = Math.max(staffingFloor, ed.staffingFloor);
  }
  if (staffingFloor > 0 && colony) {
    colony.staffingEta = Math.max(colony.staffingEta || 0, staffingFloor);
    // 机偶维护费（conductor 账本扣减）
    const led = world.economy.ledgers[fid];
    if (led) led.balances.conductor = Math.max(0, (led.balances.conductor || 0) - 2);
  }

  // 2) 总督特质
  const overseer = soc.overseerId ? world.entities.characters[soc.overseerId] : null;
  // 角色实体 traits 为数组（crew.js 口径）：取首个命中的治理特质
  const trait = overseer && Array.isArray(overseer.traits)
    ? overseer.traits.find((t) => OVERSEER_TRAITS[t]) || null : null;
  const tDef = trait ? OVERSEER_TRAITS[trait] : null;
  if (tDef && tDef.hopeCap) hopeCap += tDef.hopeCap;

  // 3) 双轨演化：希望（食物/医疗/科研驱动）与不满（危险/风暴/加班驱动）
  const foodOk = colony && (colony.stockpile || {}).food !== undefined ? (colony.stockpile.food > 0) : true;
  const medCov = serviceCoverage(planet, colony);
  hopeDelta += foodOk ? 1 : -4;         // 食物配给
  hopeDelta += medCov >= 0.5 ? 2 : -2;  // 医疗覆盖
  discontentDelta += 1;                  // 危险作业基线
  if (trait === 'iron_fisted') {
    discontentDelta *= tDef.discontentDecayMult; // 铁腕：不满衰减 ×2（负值放大）
    if (discontentDelta > 0) discontentDelta /= tDef.discontentDecayMult;
  }
  soc.hope = Math.round(clamp(soc.hope + hopeDelta, 0, Math.max(0, hopeCap)));
  soc.discontent = Math.round(clamp(soc.discontent + discontentDelta, 0, 100));
  // 居民代理 morale/health 漂移（群体代表口径）
  for (const ag of soc.agents) {
    ag[AGENT_IDX.MORALE] = Math.round(clamp(ag[AGENT_IDX.MORALE] + Math.sign(hopeDelta) * 2, 0, 100));
    ag[AGENT_IDX.HEALTH] = Math.round(clamp(ag[AGENT_IDX.HEALTH] + healthDelta, 0, 100));
  }

  // 4) 繁荣度方程（doc21 WP-2.2）
  const etaPower = powerEtaOf(world, planet);
  soc.prosperity = Math.round(clamp(
    0.40 * soc.hope + 0.30 * (100 - soc.discontent) + 0.15 * medCov * 100 + 0.15 * etaPower,
    0, 100,
  ));

  // 5) 暴动临界判定（D≥90 且 H≤15 持续 7 日）
  if (soc.discontent >= REBELLION_DISCONTENT && soc.hope <= REBELLION_HOPE) {
    soc.crisisDays++;
    if (soc.crisisDays >= REBELLION_DAYS && !soc.rebellionActive) {
      soc.rebellionActive = true;
      chronicle(world, 'crisis', `行星 ${planet.name} 聚落陷入武装暴动：gmt_suppress_rebellion 任务生成`, { planetId: planet.id });
      emit(world, 'ColonyRebellionTriggered', { planetId: planet.id }, 'ground');
    }
  } else {
    soc.crisisDays = Math.max(0, soc.crisisDays - 1);
  }
  return { hope: soc.hope, discontent: soc.discontent, prosperity: soc.prosperity, rebellion: soc.rebellionActive };
}

/** 服务设施人口覆盖率（医疗+娱乐岗位 / 人口；S_svc ∈ 0..1） */
export function serviceCoverage(planet, colony) {
  const blds = (colony && colony.buildings) || [];
  const svc = blds.filter((b) => ['bld_medical_center', 'bld_entertainment_center'].includes(b.defId)).length;
  const pop = (colony && colony.population) || 6;
  return clamp(svc * 8 / pop, 0, 1);
}

/** 所属子电网平均供电充足率（无工业层 = 1.0 基线） */
function powerEtaOf(world, planet) {
  void world;
  if (!planet.ind || !Array.isArray(planet.ind.grids) || planet.ind.grids.length === 0) return 1.0;
  const sum = planet.ind.grids.reduce((a, g) => a + (g.etaPermille || 1000), 0);
  return sum / planet.ind.grids.length / 1000;
}

/**
 * 4X 战略收益转化（doc21 WP-2.4）：帝国每日税基平方级增幅。
 * TaxBonus = baseTax × (1 + (Φ/100)² × 1.5)；黄金繁荣态（Φ≥75）科研注入。
 * @returns {{tax:number, bonus:number, goldenResearch:number}}
 */
export function prosperityTaxMultiplier(soc, baseTax) {
  if (!soc) return { tax: baseTax, bonus: 0, goldenResearch: 0 };
  const phi = clamp(soc.prosperity, 0, 100) / 100;
  const mult = 1.0 + phi * phi * 1.5;
  // 法典/总督税基修正
  let edictMult = 1.0;
  for (const eid of soc.edicts) {
    const ed = COLONY_EDICTS[eid];
    if (ed && ed.taxMult) edictMult *= ed.taxMult;
  }
  const goldenResearch = soc.prosperity >= 75 ? 3 : 0;
  return {
    tax: baseTax * mult * edictMult,
    bonus: baseTax * (mult - 1) * edictMult,
    goldenResearch,
  };
}

/**
 * 治理困境触发（doc21 WP-4.2；dilemmaSeed(tick) 确定性抽取）。
 * 条件：不满 ≥ 55 或疫情/走私环境满足；非侵入式全息汇报卡（pendingDilemma）。
 */
export function maybeTriggerDilemma(world, planet, colony) {
  const soc = planet.soc;
  if (!soc || soc.pendingDilemma) return null;
  if (soc.discontent < 55) return null;
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const s = seeds.dilemmaSeed(world.tick);
  const pool = ['dil_labor_strike', 'dil_xenophage_outbreak', 'dil_smuggler_ring'];
  const id = pool[s % pool.length];
  const overseer = soc.overseerId ? world.entities.characters[soc.overseerId] : null;
  const bookish = overseer && Array.isArray(overseer.traits) && overseer.traits.includes('bookish');
  const dilemma = {
    id,
    tick: world.tick,
    choices: dilemmaChoicesOf(id, bookish),
  };
  soc.pendingDilemma = dilemma;
  emit(world, 'ColonyDilemmaTriggered', { planetId: planet.id, dilemmaId: id }, 'ground');
  return dilemma;
}

/** 困境选项表（bookish 总督解锁高收益第三项——doc21 WP-4.2） */
export function dilemmaChoicesOf(dilemmaId, bookish) {
  if (dilemmaId === 'dil_labor_strike') {
    const c = [
      { id: 'allowance', nameZh: '提高安全津贴', costCredits: 400, hope: 6, discontent: -8 },
      { id: 'crackdown', nameZh: '铁腕复工', hope: -5, discontent: 10, historySeed: 'extreme_workers_org' },
    ];
    if (bookish) c.push({ id: 'consult', nameZh: '学者斡旋', hope: 4, discontent: -4 });
    return c;
  }
  if (dilemmaId === 'dil_xenophage_outbreak') {
    const c = [
      { id: 'isolate', nameZh: '就地物理隔离', health: -3, discontent: 4 },
      { id: 'serum', nameZh: '调派科考队研发血清', researchData: 40, hope: 5 },
    ];
    if (bookish) c.push({ id: 'reverse_pharma', nameZh: '疫情逆向制药', credits: 600, hope: 6 });
    return c;
  }
  return [
    { id: 'crackdown_smuggle', nameZh: '严厉查抄', discontent: 6, credits: 300 },
    { id: 'tolerate', nameZh: '默许抽成分润', credits: 700, discontent: -3, historySeed: 'smuggle_ring' },
  ];
}

/** 裁决执行（ResolveColonyDilemma 命令执行体；写 history 长期记忆） */
export function resolveColonyDilemma(world, planet, colony, choiceId) {
  const soc = planet.soc;
  if (!soc || !soc.pendingDilemma) return { ok: false, reason: 'NoPendingDilemma' };
  const d = soc.pendingDilemma;
  const choice = d.choices.find((x) => x.id === choiceId);
  if (!choice) return { ok: false, reason: 'BadChoice' };
  const fid = world.playerFactionId;
  const led = fid ? world.economy.ledgers[fid] : null;
  if (choice.costCredits && led) {
    if ((led.balances.credits || 0) < choice.costCredits) return { ok: false, reason: 'NO_FUNDS' };
    led.balances.credits -= choice.costCredits;
  }
  if (choice.credits && led) led.balances.credits = (led.balances.credits || 0) + choice.credits;
  if (choice.researchData && led) led.balances.researchData = (led.balances.researchData || 0) + choice.researchData;
  soc.hope = clamp(soc.hope + (choice.hope || 0), 0, 100);
  soc.discontent = clamp(soc.discontent + (choice.discontent || 0), 0, 100);
  // 长期记忆：historySeed 埋下后续回响（≤20 有界；doc16 §4.21）
  soc.history.push({ tick: world.tick, dilemmaId: d.id, choiceId: choice.id, seed: choice.historySeed || null });
  if (soc.history.length > 20) soc.history.splice(0, soc.history.length - 20);
  soc.pendingDilemma = null;
  emit(world, 'ColonyDilemmaResolved', { planetId: planet.id, dilemmaId: d.id, choiceId: choice.id }, 'ground');
  return { ok: true, choice };
}

/** 平叛战果回执（gmt_suppress_rebellion 成功）：重置不满/暴动态 */
export function reportRebellionSuppressed(world, planet) {
  const soc = planet.soc;
  if (!soc) return { ok: false, reason: 'NoSoc' };
  soc.rebellionActive = false;
  soc.discontent = Math.min(soc.discontent, 40);
  soc.crisisDays = 0;
  soc.history.push({ tick: world.tick, dilemmaId: 'gmt_suppress_rebellion', choiceId: 'victory', seed: null });
  emit(world, 'ColonyRebellionSuppressed', { planetId: planet.id }, 'ground');
  return { ok: true };
}
