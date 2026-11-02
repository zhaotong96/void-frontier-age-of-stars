/**
 * domain/world/World.js — 统一世界状态工厂（任务书 2.3）
 *
 * 单一世界模型：所有系统共享同一 World 实体容器与账本。
 * World 是纯数据对象（Plain Data），可 JSON 序列化；行为全部在系统模块。
 */

import { seedFromNumber } from '../../core/rng.js';

export const SCHEMA_VERSION = 1;
export const GAME_VERSION = '0.1.0';

/**
 * 创建空世界。config = { seed, difficulty?, galaxySize?, factionCount? }
 */
export function createWorld(config) {
  const seed = config.seed >>> 0;
  const world = {
    format: 'void-frontier-save',
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,

    seed,
    tick: 0,
    seq: 0,
    schedSeq: 0,
    rng: seedFromNumber(seed),

    difficulty: config.difficulty || 'standard',
    galaxySize: config.galaxySize || 'standard',

    playerFactionId: null,

    // 实体容器（Plain Data Entity，跨引用一律 ID）
    entities: {
      factions: {},
      systems: {},
      planets: {},
      colonies: {},
      stations: {},
      ships: {},
      fleets: {},
      characters: {},
      blueprints: {},
      anomalies: {},
      groundMissions: {},
      wars: {},
      treaties: {},
      crises: {},
      tradeRoutes: {},
      buildQueues: {},
    },

    // 关系（键为 relationKey 或专用结构）
    relations: {
      diplomacy: {}, // "facA|facB" → 多维关系
    },

    // 经济：阵营账本 + 每日记账 + 市场与交易流水
    economy: {
      ledgers: {},        // factionId → { balances:{res:n}, }
      daily: {},          // factionId → { res → {produced,consumed,imported,exported,loot,decay,transfer} }
      markets: {},        // systemId → 市场
      transactions: [],   // 有界流水
    },

    // 科研：factionId → { completed:{}, active:[], queue:[], points:{}, outputRate }
    research: {},

    // 事件
    events: {
      queue: [],
      log: {},
      chronicle: [],   // 战役纪年（重大事件，有界+归档）
    },

    // 调度队列（可序列化）
    scheduled: [],

    // 战斗实例与历史
    battles: {
      active: {},
      history: [],     // 战报（有界）
    },

    // 叙事：事件标记、故事线、全局 flag、待决抉择
    narrative: {
      fired: {},            // eventId → tick（一次性去重）
      arcs: {},             // arcId → { stage, vars }
      flags: {},            // 全局布尔/数值标记
      pendingChoices: [],   // 待玩家抉择的事件卡（有界）
    },

    // 文明 AI 状态：factionId → { personality, goals, cooldowns, lastEvalTick }
    ai: {},

    // 胜利与终局
    victory: {
      routes: {},      // routeId → { progress, done }
      ended: null,     // { routeId, endingId, tick }
    },

    // 命令日志（有界）与统计
    commandLog: [],
    stats: {
      commandsExecuted: 0,
      commandsByType: {},
      commandsFailed: {},
      ticksProcessed: 0,
    },

    // 玩家设置（影响模拟的难度项在 difficulty；这里是纯体验项）
    settings: {
      autosaveIntervalDays: 2,
      reducedEffects: false,
      masterVolume: 0.7,
      musicVolume: 0.5,
      sfxVolume: 0.8,
    },
  };
  return world;
}

/** 实体集合与类型映射（invariant 用） */
export const ENTITY_TYPES = {
  factions: 'faction',
  systems: 'system',
  planets: 'planet',
  colonies: 'colony',
  stations: 'station',
  ships: 'ship',
  fleets: 'fleet',
  characters: 'character',
  blueprints: 'blueprint',
  anomalies: 'anomaly',
  groundMissions: 'groundMission',
  wars: 'war',
  treaties: 'treaty',
  crises: 'crisis',
  tradeRoutes: 'tradeRoute',
  buildQueues: 'buildQueue',
};
