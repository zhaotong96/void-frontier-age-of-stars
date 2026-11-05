/**
 * domain/planets/colony.js — 殖民地、人口与建筑（任务书 4.2 / 4.3 / COL-01..04）
 *
 * 人口为分组整数模型：{ total, strata: { worker: n, ... } }，
 * 质量账本：期末 = 期初 + 出生 + 迁入 − 死亡 − 迁出（COL-02 严格守恒）。
 */

import { createEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { clamp, safeInt } from '../../core/math.js';
import { BAL } from '../../content/constants.js';
import { BUILDINGS } from '../../content/buildings.js';
import { getMod } from '../factions/modifiers.js';
import { pay } from '../economy/ledger.js';
import { colonyStock, creditColony, debitColony, credit, debit } from '../economy/ledger.js';

/** 原料类资源存于殖民地仓储；精炼品/战略资源存于阵营账本 */
const RAW_RESOURCES = new Set([
  'ferro', 'silicate', 'rareEarth', 'heavyMetal', 'hydrogen', 'helium3',
  'water', 'biomass', 'oxygen', 'food', 'inertGas', 'reagents', 'deuterium',
]);

function isRaw(rid) {
  return RAW_RESOURCES.has(rid);
}

/** 生产投入：原料取殖民地仓储，精炼品取阵营账本 */
function takeInput(world, colony, rid, qty) {
  if (isRaw(rid)) return debitColony(world, colony, rid, qty, 'cycle-input', colony.id);
  return debit(world, colony.factionId, rid, qty, `cycle-input:${colony.id}`, colony.id);
}

/** 生产产出：原料入殖民地仓储，精炼品入阵营账本 */
function giveOutput(world, colony, rid, qty) {
  if (isRaw(rid)) creditColony(world, colony, rid, qty, 'cycle-output', colony.id);
  else credit(world, colony.factionId, rid, qty, `cycle-output:${colony.id}`, colony.id);
}

const bldIndex = new Map(BUILDINGS.map((b) => [b.id, b]));
export function buildingDef(id) {
  return bldIndex.get(id);
}

// ———— 岗位分配与运行状态诊断（doc5 §3.8 P2-01/P2-02 / COL-01..04、ECON-02） ————

/**
 * 类别岗位定额兜底（doc5:873：采掘/精炼/制造 2、科研 2、农业 1、行政 1）。
 * 建筑定义自带 jobs（3-6）时优先采用 —— authored 定额是权威口径。
 */
const CATEGORY_JOB_SLOTS = {
  mining: 2, refining: 2, industry: 2, science: 2, agri: 1, admin: 1,
  energy: 1, service: 1, military: 1,
};

/** 建筑岗位槽位数：定义 jobs 优先，缺省回退类别定额 */
export function buildingJobSlots(def) {
  if (def && Number.isFinite(def.jobs) && def.jobs > 0) return def.jobs;
  return CATEGORY_JOB_SLOTS[def && def.category] || 1;
}

/** 殖民地仓储容量（原料资源；ECON-02 storage_full 诊断） */
const STORAGE_BASE_CAP = 600;
const STORAGE_PLANT_CAP = 500;

/** 仓储容量：基础 + 每座在役仓储平台加成 */
export function storageCapacity(colony) {
  let cap = STORAGE_BASE_CAP;
  for (const b of colony.buildings) {
    const def = buildingDef(b.defId);
    if (def && def.id === 'bld_storage_plant' && b.state === 'active') cap += STORAGE_PLANT_CAP;
  }
  return cap;
}

/**
 * 岗位分配（每小时随生产结算执行，确定性）：
 * 活跃建筑按「玩家优先级权重降序 → 建筑序号升序」从 population.total 依序填充槽位；
 * 每座建筑写入 jobsFilled（实配人数）与 staffingEta（η = 实配/定额，understaffed 降产系数）。
 * colony.jobPriority = { category: weight } 缺省逐类权重 1（均等）。
 * 汇总写入 colony.jobsFilled = { total, byCategory, unassigned }。
 */
export function assignJobs(world, colony) {
  const pop = colony.population || { total: 0 };
  const prio = colony.jobPriority && typeof colony.jobPriority === 'object' ? colony.jobPriority : {};
  let remaining = Math.max(0, Math.floor(pop.total || 0));
  const byCategory = {};

  const order = colony.buildings.map((b, i) => ({ b, i })).sort((A, B) => {
    const ca = buildingDef(A.b.defId)?.category;
    const cb = buildingDef(B.b.defId)?.category;
    const pa = Number.isFinite(prio[ca]) ? prio[ca] : 1;
    const pb = Number.isFinite(prio[cb]) ? prio[cb] : 1;
    if (pb !== pa) return pb - pa;
    return A.i - B.i;
  });

  for (const { b } of order) {
    const def = buildingDef(b.defId);
    const need = def && b.state === 'active' ? buildingJobSlots(def) : 0;
    const give = Math.min(need, remaining);
    remaining -= give;
    b.jobsFilled = give;
    b.staffingEta = need > 0 ? give / need : 1;
    if (give > 0) {
      const cat = def ? def.category : 'other';
      byCategory[cat] = (byCategory[cat] || 0) + give;
    }
  }

  colony.jobsFilled = { total: Math.max(0, Math.floor(pop.total || 0)) - remaining, byCategory, unassigned: remaining };
  return colony.jobsFilled;
}

/** 配方产出是否被仓储满溢阻塞（存在原料类产出、且全部原料产出都已到容量） */
function storageBlocked(world, colony, def) {
  if (!def.recipe) return false;
  const cap = storageCapacity(colony);
  let hasRawOut = false;
  for (const rid of Object.keys(def.recipe.outputs)) {
    if (!isRaw(rid)) continue; // 精炼品/战略资源入阵营账本，不受殖民仓储容量约束
    hasRawOut = true;
    if (colonyStock(world, colony, rid) < cap) return false;
  }
  return hasRawOut; // 产出全为精炼品 → 永不受殖民仓储约束
}

/**
 * 五态 runtimeStatus 诊断（doc5 §3.8 P2-02 / ECON-02）：
 *   storage_full > starved_input > low_power > understaffed > running（严重度优先）。
 * 建造中/手动停摆 → null（尚未投入运行）。starved_input 同时写 b.starvedInput（缺失原料 id）。
 */
function deriveRuntimeStatus(world, colony, pf) {
  for (const b of colony.buildings) {
    const def = buildingDef(b.defId);
    if (!def || b.state === 'construction' || b.state === 'suspended') {
      b.runtimeStatus = null;
      continue;
    }
    const need = buildingJobSlots(def);
    const eta = need > 0 ? (Number.isFinite(b.jobsFilled) ? b.jobsFilled : 0) / need : 1;
    b.staffingEta = eta;
    if (def.recipe && storageBlocked(world, colony, def)) {
      b.runtimeStatus = 'storage_full';
      continue;
    }
    if (def.recipe && b.state === 'starved') {
      b.runtimeStatus = 'starved_input';
      continue;
    }
    if (def.recipe && pf < 1) {
      b.runtimeStatus = 'low_power';
      continue;
    }
    if (eta < 1) {
      b.runtimeStatus = 'understaffed';
      continue;
    }
    b.runtimeStatus = 'running';
  }
}

/**
 * 建立殖民地（FoundOutpost/EstablishColony 命令执行体）。
 * colony = { planetId, factionId, population, buildings, stockpile, stability, ... }
 */
export function foundColony(world, planetId, factionId, initialPop = 6, isOutpost = false) {
  const planet = world.entities.planets[planetId];
  if (!planet) throw new Error('行星不存在');
  if (planet.colonyId) return world.entities.colonies[planet.colonyId];
  const hab = planet.habitability + (getMod(world, factionId, 'habitabilityBonus', 'add') || 0);
  const colony = createEntity(world, 'colonies', {
    planetId,
    factionId,
    systemId: planet.systemId,
    isOutpost,
    population: { total: initialPop, strata: { worker: initialPop } },
    housing: isOutpost ? 8 : 12,
    buildings: isOutpost ? [{ defId: 'bld_admin_center', level: 1, state: 'active', progress: 0 }] : [],
    stockpile: { food: 90, water: 70, ferro: 0, silicate: 0, powerCell: 4, medicine: 4 },
    stability: 60,
    powerBalance: 0,
    jobsFilled: {},
    foundedTick: world.tick,
    growthBuffer: 0,
    needs: { foodPerDay: 0, goodsPerDay: 0 },
  });
  planet.colonyId = colony.id;
  const sys = world.entities.systems[planet.systemId];
  if (sys && !sys.ownerFactionId) sys.ownerFactionId = factionId;
  emit(world, 'ColonyFounded', { colonyId: colony.id, planetId, factionId, outpost: isOutpost }, 'colony');
  return colony;
}

/** 计算殖民地能源平衡（发电 − 用电；powerUse 在内容侧为负值 → Σ 后即净余） */
export function powerBalance(colony) {
  let gen = 0;
  let use = 0;
  for (const b of colony.buildings) {
    const def = bldIndex.get(b.defId);
    if (!def || b.state !== 'active') continue;
    if (def.powerGen) gen += def.powerGen * (b.level || 1);
    if (def.powerUse) use += def.powerUse * (b.level || 1);
  }
  // 用电按负值累加，净平衡 = 发电 + 用电（负）；旧实现 gen-use 把缺口翻正成盈余，
  // 导致 low_power/缺电降产与 AI 扩电梯队永远不可达（五态诊断 low_power 的前置修复）。
  return gen + use;
}

/** 能源充足度系数（0.3-1.0）：缺电按比例降产（不出现无因停摆） */
export function powerFactor(colony) {
  const bal = powerBalance(colony);
  if (bal >= 0) return 1;
  const use = -bal;
  return clamp(1 - use / Math.max(use + 30, 60), 0.3, 1);
}

/** 宜居度→生产/增长修正 */
export function habitabilityFactor(world, colony) {
  const planet = world.entities.planets[colony.planetId];
  const hab = clamp((planet?.habitability ?? 30) + (getMod(world, colony.factionId, 'habitabilityBonus', 'add') || 0), 0, 100);
  return 0.5 + (hab / 100) * 0.7; // 0.5 - 1.2
}

/**
 * 每小时生产结算：有配方建筑按周期推进（原料检查在周期开始）。
 * 缺料 → state 'starved'（并记 starvedInput）；能源不足 → 按 powerFactor 降速；
 * 仓储满溢 → 周期不启动（storage_full）；岗位短缺 → 按 staffingEta 降产（P2-01）。
 * 每轮为全部建筑派生五态 runtimeStatus（P2-02）。
 */
export function tickColonyProduction(world, colony) {
  const pf = powerFactor(colony);
  colony.powerBalance = powerBalance(colony);
  assignJobs(world, colony);
  for (const b of colony.buildings) {
    const def = bldIndex.get(b.defId);
    if (!def) continue;
    if (!def.recipe) continue; // 非生产建筑（服务/军事/行政）
    if (b.state === 'suspended' || b.state === 'construction') continue;

    if (b.progress === undefined) b.progress = 0;
    // 周期开始：锁定原料（检查且扣款一次）
    if (b.progress === 0 && !b.cycleLocked) {
      if (storageBlocked(world, colony, def)) {
        b.state = 'active';
        continue; // 仓储满溢：不投入原料，等待物流消化（runtimeStatus=storage_full）
      }
      let ok = true;
      b.starvedInput = null;
      for (const rid of Object.keys(def.recipe.inputs)) {
        const have = isRaw(rid) ? colonyStock(world, colony, rid) : (world.economy.ledgers[colony.factionId]?.balances?.[rid] ?? 0);
        if (have < def.recipe.inputs[rid]) {
          ok = false;
          b.starvedInput = rid; // starved_input 诊断指明断供原料（doc5 §3.8）
          break;
        }
      }
      if (!ok) {
        b.state = 'starved';
        continue;
      }
      for (const rid of Object.keys(def.recipe.inputs)) {
        takeInput(world, colony, rid, def.recipe.inputs[rid]);
      }
      b.cycleLocked = true;
      b.state = 'active';
    }
    // 推进周期
    if (b.cycleLocked) {
      const eff = clamp(
        pf * habitabilityFactor(world, colony) * (b.efficiencyMult || 1) *
        getMod(world, colony.factionId, outputStatFor(def.category), 'mult'),
        0.1, 2.0
      );
      b.progress += eff * (Number.isFinite(b.staffingEta) ? b.staffingEta : 1); // understaffed 按 η 降产
      if (b.progress >= def.recipe.hours) {
        b.progress = 0;
        b.cycleLocked = false;
        for (const rid of Object.keys(def.recipe.outputs)) {
          giveOutput(world, colony, rid, def.recipe.outputs[rid]);
        }
      }
    }
  }
  deriveRuntimeStatus(world, colony, pf);
}

function outputStatFor(category) {
  const map = {
    mining: 'mineOutput',
    refining: 'alloyOutput',
    industry: 'factoryOutput',
    agri: 'farmOutput',
    science: 'researchOutput',
  };
  return map[category] || 'factoryOutput';
}

/** 建造队列推进（每小时） */
export function tickColonyConstruction(world, colony) {
  const q = colony.constructionQueue;
  if (!q || q.length === 0) return;
  const job = q[0];
  if (job.state === 'waiting' || job.state === 'missing-material') {
    // 建造成本从阵营账本支付（原子：不满足保持等待，不阻塞后续入队判定）
    const def = bldIndex.get(job.defId);
    if (!def) {
      q.shift();
      return;
    }
    if (!pay(world, colony.factionId, def.cost, `build:${def.id}`, colony.id)) {
      job.state = 'missing-material';
      return;
    }
    job.state = 'building';
    job.progress = 0;
    colony.buildings.push({ defId: job.defId, level: 1, state: 'construction', progress: 0 });
    job.buildingIndex = colony.buildings.length - 1;
  }
  if (job.state === 'building') {
    const speed = getMod(world, colony.factionId, 'buildSpeed', 'mult') || 1;
    job.progress += speed;
    const def = bldIndex.get(job.defId);
    if (job.progress >= (def?.buildHours || 24)) {
      const b = colony.buildings[job.buildingIndex];
      if (b) b.state = 'active';
      colony.constructionQueue = q.slice(1);
      emit(world, 'BuildingCompleted', { colonyId: colony.id, defId: job.defId }, 'colony');
    }
  }
}

/** 人口每日结算：食物/住房/增长/稳定度（COL-02/03） */
export function dailyPopulation(world, colony) {
  const pop = colony.population;
  const before = pop.total;

  // 消耗：小人口按「食物债务」累积取整（6 人口 ≈ 8 天耗 1 食物，防整数化过量消耗）
  const foodNeedFrac = pop.total * BAL.population.foodPerPop;
  colony.foodDebt = (colony.foodDebt || 0) + foodNeedFrac;
  let foodOK = true;
  if (colony.foodDebt >= 1) {
    const take = Math.floor(colony.foodDebt);
    foodOK = debitColony(world, colony, 'food', take, 'dailyFood', colony.id);
    if (foodOK) colony.foodDebt -= take;
    else colony.foodDebt = 0;
  }
  const goodsOK = debitColony(world, colony, 'powerCell', 0, 'noop', colony.id); // 消费品模型简化：暂扣 0
  const housingRatio = pop.total / Math.max(1, colony.housing);

  let delta = 0;
  if (foodOK && housingRatio < BAL.population.growthHousingBuffer) {
    const growth = pop.total * BAL.population.growthBase * habitabilityFactor(world, colony) *
      getMod(world, colony.factionId, 'popGrowth', 'mult');
    colony.growthBuffer += growth;
    if (colony.growthBuffer >= 1) {
      delta = Math.floor(colony.growthBuffer);
      colony.growthBuffer -= delta;
    }
  } else if (!foodOK) {
    // 饥荒：按比例死亡（小人口缓慢流失，不瞬时清零）
    const deaths = Math.round(pop.total * 0.01);
    delta = -deaths;
    if (deaths > 0) emit(world, 'ColonyFamine', { colonyId: colony.id, deaths }, 'colony');
  }
  if (housingRatio > 1.15 && delta > 0) delta = 0; // 住房不足停止增长

  pop.total = Math.max(0, pop.total + delta);
  // 阶层再分配（简化：新增人口入 worker）
  if (delta > 0) pop.strata.worker += delta;
  if (delta < 0) {
    let toRemove = -delta;
    for (const st of ['unemployed', 'worker', 'farmer', 'engineer', 'researcher', 'administrator', 'soldier', 'trader']) {
      const have = pop.strata[st] || 0;
      const take = Math.min(have, toRemove);
      pop.strata[st] = have - take;
      toRemove -= take;
      if (toRemove <= 0) break;
    }
    pop.strata.worker = Math.max(0, pop.strata.worker);
  }

  // 稳定度
  let stab = BAL.population.stabilityBase;
  if (!foodOK) stab += BAL.population.stabilityFromFoodShort * 10;
  if (housingRatio > 1) stab += BAL.population.stabilityFromHousingShort * (housingRatio - 1) * 10;
  stab += getMod(world, colony.factionId, 'stabilityBonus', 'add') || 0;
  stab += (colony.buildings.filter((b) => b.state === 'active' && buildingDef(b.defId)?.category === 'service').length) * 2;
  colony.stability = Math.round(clamp(colony.stability * 0.7 + stab * 0.3, 0, 100));

  return { before, after: pop.total, delta, foodOK };
}
