/**
 * devtools/scenarioFactory.js — 标准测试世界与战役生成器（任务书 10.3 / 13.4）
 *
 * SCENARIO-STARTER-001 / CAMPAIGN-01「边疆回声」：
 * 固定种子可复现；玩家文明 + 5 AI 文明；母星 + 初始舰队 + 初始资源。
 * 也提供 createMinimalWorld（阶段01 最小内核世界）供确定性测试。
 */

import { createWorld } from '../domain/world/World.js';
import { generateGalaxy } from '../domain/world/galaxyGen.js';
import { factionConfigs, FACTIONS } from '../content/factions.js';
import { initResearch } from '../domain/research/research.js';
import { ensureLedger, credit } from '../domain/economy/ledger.js';
import { ensureMarket } from '../domain/economy/market.js';
import { createFleet } from '../domain/fleets/fleet.js';
import { foundColony } from '../domain/planets/colony.js';
import { createEntity } from '../domain/entities/registry.js';
import { rebuildEffectIndex } from '../domain/research/research.js';

/** 标准战役：CAMPAIGN-01 边疆回声 */
export function createStarterCampaign(config = {}) {
  const seed = (config.seed ?? 24601) >>> 0;
  const world = createWorld({
    seed,
    difficulty: config.difficulty || 'standard',
    galaxySize: config.galaxySize || 'standard',
  });
  // 注意：真实时间戳只写入存档记录（SaveCodec），不进入世界状态，
  // 否则破坏确定性回归（同一命令流两次运行的哈希必须一致）。
  world.campaignName = config.campaignName || '边疆回声';

  const playerId = 'frontier_compact';
  const { systemIds, factionIds, warnings } = generateGalaxy(world, {
    factionConfigs: factionConfigs(playerId),
  });

  // 每个文明：科研状态、账本初始资源、母星殖民地、初始舰队、市场
  for (const fid of factionIds) {
    const fac = world.entities.factions[fid];
    initResearch(world, fid);
    const led = ensureLedger(world, fid);
    const isPlayer = fid === world.playerFactionId;
    const startMult = isPlayer ? 1 : difficultyMult(world.difficulty);
    led.balances.credits = Math.round((isPlayer ? 1800 : 1500) * startMult);
    led.balances.influence = 40;
    led.balances.alloy = Math.round(140 * startMult);
    led.balances.researchData = 20;

    // 母星殖民地
    const homePlanetId = fac.homePlanetId;
    if (homePlanetId) {
      const colony = foundColony(world, homePlanetId, fid, 10, false);
      colony.stockpile.food = 120;
      colony.stockpile.ferro = 40;
      colony.buildingSlots = 12;
      // 初始建筑：水培农场 + 行政中心（保证食物循环与治理）
      colony.buildings.push({ defId: 'bld_hydroponics', level: 1, state: 'active', progress: 0 });
      colony.buildings.push({ defId: 'bld_admin_center', level: 1, state: 'active', progress: 0 });
    }

    // 初始舰队：科学船 + 2 护卫舰（玩家）；AI 同规格保持公平
    const homeSystemId = fac.homeSystemId;
    ensureMarket(world, homeSystemId);
    createFleet(world, {
      factionId: fid,
      systemId: homeSystemId,
      name: isPlayer ? '远航-1 探索分队' : `${fac.name} 探索分队`,
      role: 'science',
      ships: [
        { hullId: 'hull_science', moduleIds: ['mod_sensor_array', 'mod_reactor_fission', 'mod_engine_ion'], name: '曙光号' },
      ],
    });
    createFleet(world, {
      factionId: fid,
      systemId: homeSystemId,
      name: isPlayer ? '边防-1 巡逻队' : `${fac.name} 巡逻队`,
      role: 'combat',
      stance: 'patrol',
      ships: [
        { hullId: 'hull_frigate', moduleIds: ['mod_railgun', 'mod_reactor_fission', 'mod_engine_ion', 'mod_armor_composite'], name: '守夜号' },
        { hullId: 'hull_frigate', moduleIds: ['mod_railgun', 'mod_reactor_fission', 'mod_engine_ion', 'mod_armor_composite'], name: '哨声号' },
      ],
    });

    // 初始已知科技：采矿与冶金 I（保证开局可建矿/精炼）
    const rs = world.research[fid];
    rs.completed.push('tech_mining_1', 'tech_alloy_1', 'tech_science_1');
    rebuildEffectIndex(world, fid);

    // 初始 AI 状态
    world.ai[fid] = {
      personality: fac.personality,
      goals: [],
      cooldowns: {},
      orders: {},
      lastEvalTick: 0,
    };
  }

  world.stats.startedAtTick = 0;
  world.warnings = warnings;
  return world;
}

function difficultyMult(difficulty) {
  switch (difficulty) {
    case 'story': return 0.7;
    case 'hard': return 1.4;
    default: return 1.0;
  }
}

/** 最小内核世界（阶段01 验收用：1 文明 1 星系 1 探索舰 1 命令） */
export function createMinimalWorld(seed = 1234) {
  const world = createWorld({ seed, difficulty: 'standard', galaxySize: 'story' });
  const { systemIds, factionIds } = generateGalaxy(world, {
    systemCount: 1,
    factionConfigs: factionConfigs('frontier_compact'),
  });
  const fid = factionIds[0];
  world.playerFactionId = fid;
  initResearch(world, fid);
  const led = ensureLedger(world, fid);
  led.balances.credits = 500;
  createFleet(world, {
    factionId: fid,
    systemId: factionIds.length ? world.entities.factions[fid].homeSystemId : systemIds[0],
    name: '最小世界探索舰',
    role: 'science',
    ships: [{ hullId: 'hull_science', moduleIds: ['mod_sensor_array', 'mod_reactor_fission', 'mod_engine_ion'] }],
  });
  world.ai[fid] = { personality: 'balanced', goals: [], cooldowns: {}, orders: {}, lastEvalTick: 0 };
  return world;
}
