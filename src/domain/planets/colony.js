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
    buildings: isOutpost ? [{ defId: 'bld_admin_post', level: 1, state: 'active', progress: 0 }] : [],
    stockpile: { food: 60, water: 60, ferro: 0, silicate: 0, powerCell: 4, medicine: 4 },
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

/** 计算殖民地能源平衡（发电 − 用电） */
export function powerBalance(colony) {
  let gen = 0;
  let use = 0;
  for (const b of colony.buildings) {
    const def = bldIndex.get(b.defId);
    if (!def || b.state !== 'active') continue;
    if (def.powerGen) gen += def.powerGen * (b.level || 1);
    if (def.powerUse) use += def.powerUse * (b.level || 1);
  }
  return gen - use;
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
 * 缺料 → state 'starved'；能源不足 → 按 powerFactor 降速。
 */
export function tickColonyProduction(world, colony) {
  const pf = powerFactor(colony);
  colony.powerBalance = powerBalance(colony);
  for (const b of colony.buildings) {
    const def = bldIndex.get(b.defId);
    if (!def) continue;
    if (!def.recipe) continue; // 非生产建筑（服务/军事/行政）
    if (b.state === 'suspended' || b.state === 'construction') continue;

    if (b.progress === undefined) b.progress = 0;
    // 周期开始：锁定原料（检查且扣款一次）
    if (b.progress === 0 && !b.cycleLocked) {
      let ok = true;
      for (const rid of Object.keys(def.recipe.inputs)) {
        const have = isRaw(rid) ? colonyStock(world, colony, rid) : (world.economy.ledgers[colony.factionId]?.balances?.[rid] ?? 0);
        if (have < def.recipe.inputs[rid]) {
          ok = false;
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
      b.progress += eff;
      if (b.progress >= def.recipe.hours) {
        b.progress = 0;
        b.cycleLocked = false;
        for (const rid of Object.keys(def.recipe.outputs)) {
          giveOutput(world, colony, rid, def.recipe.outputs[rid]);
        }
      }
    }
  }
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

  // 消耗
  const foodNeed = Math.max(1, Math.round(pop.total * BAL.population.foodPerPop * 100) / 100);
  const foodOK = debitColony(world, colony, 'food', Math.ceil(foodNeed), 'dailyFood', colony.id);
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
    // 饥荒：按规则死亡（无瞬时无因变化）
    const deaths = Math.max(1, Math.round(pop.total * 0.01));
    delta = -deaths;
    emit(world, 'ColonyFamine', { colonyId: colony.id, deaths }, 'colony');
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
