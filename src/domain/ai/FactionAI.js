/**
 * domain/ai/FactionAI.js — 文明 AI：目标优先级 + 约束检查 + 行为状态机
 * （任务书 5.3 / AI-01..03）
 *
 * 可解释效用评分：U(a) = Σ w_i·score_i − Σ c_j·risk_j。
 * 每 24 tick（游戏日）错峰评估一次；全部行动经 CommandBus（与玩家同规则）。
 * 防空转：命令超时（HourlySystems orders 阶段）、同类冷却、并发上限。
 */

import { registerHourly } from '../../simulation/TickPipeline.js';
import { executeCommand } from '../../core/commandBus.js';
import { emit } from '../../core/eventBus.js';
import { getRelation } from '../diplomacy/war.js';
import { balance, colonyStock, canAfford } from '../economy/ledger.js';
import { BUILDINGS } from '../../content/buildings.js';

const BUILDING_COSTS = Object.fromEntries(BUILDINGS.map((b) => [b.id, b.cost]));
import { difficultyParam } from '../factions/modifiers.js';
import { TECHNOLOGIES } from '../../content/technologies.js';

const TECHNOLOGY_ORDER = TECHNOLOGIES.map((t) => t.id);

const PERSONALITY_WEIGHTS = {
  expansionist: { expand: 1.4, economy: 1.0, military: 1.2, research: 0.9, diplomacy: 0.7 },
  trader: { expand: 0.9, economy: 1.5, military: 0.7, research: 1.0, diplomacy: 1.4 },
  defensive: { expand: 0.7, economy: 1.1, military: 1.3, research: 1.1, diplomacy: 1.0 },
  scientist: { expand: 0.8, economy: 0.9, military: 0.6, research: 1.6, diplomacy: 1.0 },
  opportunist: { expand: 1.1, economy: 1.0, military: 1.2, research: 0.7, diplomacy: 0.8 },
  balanced: { expand: 1.0, economy: 1.0, military: 1.0, research: 1.0, diplomacy: 1.0 },
};

/** 注册 AI 每小时阶段（由 HourlySystems 在正确顺序处显式调用） */
export function registerAI() {
  registerHourly('ai', aiHourlyPhase);
}

/** AI 错峰评估：每 24 tick 每文明一次，按 (hash+index) 错开执行日 */
function aiHourlyPhase(world) {
  const ids = Object.keys(world.ai).sort();
  for (let i = 0; i < ids.length; i++) {
    const fid = ids[i];
    if (fid === world.playerFactionId) continue;
    const st = world.ai[fid];
    if (!st) continue;
    const offset = (hashFid(fid) + i) % 24;
    if ((world.tick + offset) % 24 !== 0) continue;
    if (world.victory.ended) continue;
    try {
      evaluateFaction(world, fid, st);
    } catch (e) {
      // AI 单文明失败不拖垮世界模拟；记录并冷却
      st.errorCooldown = world.tick + 72;
      emit(world, 'AIError', { factionId: fid, message: String(e && e.message) }, 'system');
    }
  }
}

function hashFid(fid) {
  let h = 0;
  for (let i = 0; i < fid.length; i++) h = (h * 31 + fid.charCodeAt(i)) >>> 0;
  return h % 97;
}

/** 单文明决策评估 */
export function evaluateFaction(world, fid, st) {
  if (st.errorCooldown && world.tick < st.errorCooldown) return;
  _evalWorld = world; // 供 recordOrder 记账
  const w = PERSONALITY_WEIGHTS[st.personality] || PERSONALITY_WEIGHTS.balanced;
  const aggression = difficultyParam(world, 'aiAggression');
  st.lastEvalTick = world.tick;
  st.cooldowns ||= {};
  st.orders ||= {};

  const activeOrders = Object.keys(st.orders).length;
  if (activeOrders >= 6) return;

  // —— 1. 关键经济（电力/水/食物/矿） ——
  if (aiCan(st, 'economy', world)) {
    if (aiEconomy(world, fid, st, w, true)) return;
  }

  // —— 2. 扩张决策（优先于工业链：领土是长线收益） ——
  if (aiCan(st, 'expand', world) && w.expand >= 0.9) {
    if (aiExpand(world, fid, st)) return;
  }

  // —— 3. 工业链补全 ——
  if (aiCan(st, 'economy', world)) {
    if (aiEconomy(world, fid, st, w, false)) return;
  }

  // —— 4. 科研决策 ——
  if (aiCan(st, 'research', world)) {
    if (aiResearch(world, fid, st, w)) return;
  }

  // —— 5. 探索决策（扫描未调查星系） ——
  if (aiCan(st, 'scan', world)) {
    if (aiExplore(world, fid, st)) return;
  }

  // —— 5. 军事决策 ——
  if (aiCan(st, 'military', world)) {
    if (aiMilitary(world, fid, st, w, aggression)) return;
  }

  // —— 6. 外交决策 ——
  if (aiCan(st, 'diplomacy', world)) {
    if (aiDiplomacy(world, fid, st, w)) return;
  }
}

function setCooldown(st, kind, world, ticks = 72) {
  st.cooldowns[kind] = world.tick + ticks;
}

function aiCan(st, kind, world) {
  return (st.cooldowns[kind] ?? 0) <= world.tick;
}

// ———— 经济 ————

function aiEconomy(world, fid, st, w, criticalOnly = false) {
  const colonies = sortedColonies(world, fid);
  if (colonies.length === 0) return false;
  const home = colonies[0];

  // 需求驱动工业阶梯（每次评估只做一件事，按优先级）
  const ladder = [];

  // 1. 电力缺口
  if ((home.powerBalance ?? 0) < 0) ladder.push('bld_solar_array');
  // 2. 水循环（水培农场缺水的根因）
  if (hasBuilding(world, home, 'bld_hydro_farm') && colonyStock(world, home, 'water') < 30) {
    if (!hasBuilding(world, home, 'bld_water_recycler')) ladder.push('bld_water_recycler');
    if (!hasBuilding(world, home, 'bld_algae_reactor')) ladder.push('bld_algae_reactor');
  }
  // 3. 食物
  if (estimateFoodBalance(world, home) < 0 && colonyStock(world, home, 'food') < 60) {
    ladder.push('bld_hydro_farm');
  }
  // 4. 矿业
  if (!hasBuilding(world, home, 'bld_mine_ferro')) ladder.push('bld_mine_ferro');
  if (!hasBuilding(world, home, 'bld_mine_silicate')) ladder.push('bld_mine_silicate');

  if (criticalOnly) {
    for (const defId of ladder) {
      if (tryBuild(world, fid, home, defId, st)) return true;
    }
    return false;
  }

  // 5. 挥发物（化学/聚合物链的源头）
  if (!hasBuilding(world, home, 'bld_volatile_well')) ladder.push('bld_volatile_well');
  // 6. 精炼链
  if (hasBuilding(world, home, 'bld_mine_ferro') && hasBuilding(world, home, 'bld_mine_silicate')
      && !hasBuilding(world, home, 'bld_alloy_plant')) ladder.push('bld_alloy_plant');
  if (hasBuilding(world, home, 'bld_volatile_well') && !hasBuilding(world, home, 'bld_chem_plant')) {
    ladder.push('bld_chem_plant');
  }
  if (hasBuilding(world, home, 'bld_chem_plant') && !hasBuilding(world, home, 'bld_polymer_plant')) {
    ladder.push('bld_polymer_plant');
  }
  // 7. 科研
  if (!hasBuilding(world, home, 'bld_lab')) ladder.push('bld_lab');

  for (const defId of ladder) {
    if (tryBuild(world, fid, home, defId, st)) return true;
  }

  // 财政危机 → 卖合金
  const credits = balance(world, fid, 'credits');
  const alloy = balance(world, fid, 'alloy');
  if (credits < 150 && alloy > 60) {
    const r = executeCommand(world, {
      type: 'MarketSell', actorId: fid,
      params: { systemId: home.systemId, resId: 'alloy', qty: 40 },
    });
    if (r.ok) {
      recordOrder(st, 'economy', 'sell_alloy');
      return true;
    }
  }
  return false;
}

function tryBuild(world, fid, colony, defId, st) {
  // 队列与预算预检（防空转：不制造必败命令）
  if ((colony.constructionQueue || []).length >= 5) return false;
  const def = BUILDING_COSTS[defId];
  if (def && !canAfford(world, fid, def)) return false;
  const r = executeCommand(world, {
    type: 'BuildOnColony', actorId: fid,
    params: { colonyId: colony.id, defId },
  });
  if (r.ok) {
    recordOrder(st, 'economy', `build:${defId}`);
    setCooldown(st, 'economy', world, 12); // 短冷却让建设队列消化
    return true;
  }
  return false;
}

function estimateFoodBalance(world, colony) {
  const pop = colony.population?.total || 0;
  let farms = 0;
  for (const b of colony.buildings) {
    if (b.defId === 'bld_hydro_farm' && b.state === 'active') farms++;
  }
  return farms * 10 - pop * 0.5;
}

function hasBuilding(world, colony, defId) {
  // 在建与排队都算「已有」——防止每日重复排队同一建筑直至队列塞满
  if (colony.buildings.some((b) => b.defId === defId)) return true;
  return (colony.constructionQueue || []).some((j) => j.defId === defId);
}

// ———— 科研 ————

const RESEARCH_PREF = {
  scientist: ['tech_science_2', 'tech_ai_1', 'tech_quantum_1', 'tech_science_1'],
  expansionist: ['tech_colonization_1', 'tech_shipyard_1', 'tech_warpdrive_1', 'tech_mining_1'],
  trader: ['tech_diplomacy_1', 'tech_colonization_1', 'tech_science_1'],
  defensive: ['tech_shield_1', 'tech_armor_1', 'tech_colonization_1'],
  opportunist: ['tech_warpdrive_1', 'tech_laser_1', 'tech_mining_1'],
  balanced: ['tech_colonization_1', 'tech_science_1', 'tech_shipyard_1'],
};

function aiResearch(world, fid, st, w) {
  const rs = world.research[fid];
  if (!rs || rs.active.length >= 1) return false;
  if (rs.queue.length >= 8) return false; // 队列满：不再制造失败命令（防空转）
  const prefs = RESEARCH_PREF[st.personality] || RESEARCH_PREF.balanced;
  for (const techId of prefs) {
    if (rs.completed.includes(techId)) continue;
    if (rs.queue.includes(techId)) continue;
    if (rs.active.some((a) => a.techId === techId)) continue;
    const r = executeCommand(world, { type: 'StartResearch', actorId: fid, params: { techId } });
    if (r.ok) {
      recordOrder(st, 'research', `start:${techId}`);
      return true;
    }
    // 前置不满足 → 排队后结束本次评估
    executeCommand(world, { type: 'QueueResearch', actorId: fid, params: { techId } });
    return true;
  }
  // 偏好清单耗尽：按表序补 tail（保持确定性）
  const all = TECHNOLOGY_ORDER;
  for (const techId of all) {
    if (rs.completed.includes(techId) || rs.queue.includes(techId)) continue;
    if (rs.active.some((a) => a.techId === techId)) continue;
    const r = executeCommand(world, { type: 'StartResearch', actorId: fid, params: { techId } });
    if (r.ok) return true;
    executeCommand(world, { type: 'QueueResearch', actorId: fid, params: { techId } });
    return true;
  }
  return false;
}

// ———— 探索 ————

function aiExplore(world, fid, st) {
  const sciFleet = Object.keys(world.entities.fleets).sort()
    .map((id) => world.entities.fleets[id])
    .find((f) => f.factionId === fid && f.role === 'science' && f.systemId && (!f.orders || f.orders.stage === 'done'));
  if (!sciFleet) return false;
  const here = world.entities.systems[sciFleet.systemId];
  // 找一个未完成调查的相邻星系
  for (const nid of here.lanes.slice().sort()) {
    const ns = world.entities.systems[nid];
    const lvl = ns.surveyedBy[fid] ?? 0;
    if (lvl < 4) {
      const r = executeCommand(world, {
        type: 'IssueScanOrder', actorId: fid,
        params: { fleetId: sciFleet.id, targetSystemId: nid },
      });
      if (r.ok) {
        recordOrder(st, 'scan', `scan:${nid}`);
        return true;
      }
    }
  }
  return false;
}

// ———— 扩张 ————

function aiExpand(world, fid, st) {
  const credits = balance(world, fid, 'credits');
  const alloy = balance(world, fid, 'alloy');
  if (credits < 240 || alloy < 26) return false;
  // 找己方殖民地或探索舰所在星系附近的宜居无主行星
  const candidates = [];
  for (const pid of Object.keys(world.entities.planets).sort()) {
    const p = world.entities.planets[pid];
    if (p.colonyId || p.habitability < 24) continue;
    const sys = world.entities.systems[p.systemId];
    if (sys.ownerFactionId && sys.ownerFactionId !== fid) continue;
    const lvl = sys.surveyedBy[fid] ?? 0;
    if (lvl < 3) continue;
    // 距离己方最近领土
    let minDist = Infinity;
    for (const sid of Object.keys(world.entities.systems)) {
      const s = world.entities.systems[sid];
      if (s.ownerFactionId === fid) {
        minDist = Math.min(minDist, Math.hypot(s.x - sys.x, s.y - sys.y));
      }
    }
    if (!Number.isFinite(minDist) || minDist > 260) continue;
    candidates.push({ p, score: p.habitability * 2 - minDist * 0.1 + sys.resourceRating * 3 });
  }
  if (candidates.length === 0) return false;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const sys = world.entities.systems[best.p.systemId];

  // 己方舰队已在目标星系 → 直接建前哨
  const fleetHere = Object.keys(world.entities.fleets).sort()
    .map((id) => world.entities.fleets[id])
    .find((f) => f.factionId === fid && f.systemId === sys.id && f.shipIds.length > 0);
  if (fleetHere) {
    const r = executeCommand(world, {
      type: 'FoundOutpost', actorId: fid,
      params: { fleetId: fleetHere.id, planetId: best.p.id },
    });
    if (r.ok) {
      recordOrder(st, 'expand', `outpost:${best.p.id}`);
      return true;
    }
    setCooldown(st, 'expand', world, 120);
    return false;
  }

  // 否则派最近的空闲舰队前往（科学舰队优先，兼顾勘探）
  const idle = Object.keys(world.entities.fleets).sort()
    .map((id) => world.entities.fleets[id])
    .filter((f) => f.factionId === fid && f.systemId && !f.transit && (!f.orders || f.orders.kind === 'scan'))
    .sort((a, b) => {
      const sa = world.entities.systems[a.systemId];
      const sb = world.entities.systems[b.systemId];
      const da = Math.hypot(sa.x - sys.x, sa.y - sys.y);
      const db = Math.hypot(sb.x - sys.x, sb.y - sys.y);
      return da - db;
    })[0];
  if (!idle) return false;
  const r = executeCommand(world, {
    type: 'OrderFleetMove', actorId: fid,
    params: { fleetId: idle.id, targetSystemId: sys.id },
  });
  if (r.ok) {
    recordOrder(st, 'expand', `move:${sys.id}`);
    return true;
  }
  setCooldown(st, 'expand', world, 72);
  return false;
}

// ———— 军事 ————

function aiMilitary(world, fid, st, w, aggression) {
  const myFleets = combatFleets(world, fid);
  const threat = maxThreat(world, fid);

  // 防御优先：威胁高 → 舰队回防
  if (threat > 0.6 && myFleets.length > 0) {
    const home = homeSystemOf(world, fid);
    const far = myFleets.find((f) => f.systemId !== home.id && f.systemId);
    if (far) {
      const r = executeCommand(world, {
        type: 'OrderFleetMove', actorId: fid,
        params: { fleetId: far.id, targetSystemId: home.id },
      });
      if (r.ok) {
        recordOrder(st, 'military', `defend:${far.id}`);
        return true;
      }
    }
  }

  // 建军：有船坞且预算允许 → 建护卫舰
  const yard = Object.keys(world.entities.stations).sort()
    .map((sid) => world.entities.stations[sid])
    .find((s) => s.factionId === fid && s.kind === 'shipyard' && (s.buildQueue || []).length < 2);
  // 预算门槛（防 NO_FUNDS 刷屏）：造舰预留 1.5 倍基准护卫舰造价
  const credits = balance(world, fid, 'credits');
  const alloy = balance(world, fid, 'alloy');
  const funded = credits > 1400 && alloy > 90;
  if (yard && funded && myFleets.length < 3 + Math.floor(w.military * 2)) {
    const bp = Object.keys(world.entities.blueprints).sort()
      .map((bid) => world.entities.blueprints[bid])
      .find((b) => b.factionId === fid && b.hullId === 'hull_frigate');
    if (bp) {
      const r = executeCommand(world, {
        type: 'ShipyardBuild', actorId: fid,
        params: { blueprintId: bp.id, stationId: yard.id },
      });
      if (r.ok) {
        recordOrder(st, 'military', `build:${bp.id}`);
        return true;
      }
    }
  }

  // 进攻：好战人格 + 军力优势 + 敌对 → 攻击敌境
  if (w.military > 1.1 && aggression > 0.8 && myFleets.length >= 2) {
    const target = findWeakNeighbor(world, fid);
    if (target) {
      const r = executeCommand(world, {
        type: 'DeclareWar', actorId: fid,
        params: { targetFactionId: target, wargoal: 'borderSystems' },
      });
      if (r.ok) {
        recordOrder(st, 'military', `war:${target}`);
        setCooldown(st, 'military', world, 240);
        return true;
      }
    }
  }
  return false;
}

function combatFleets(world, fid) {
  return Object.keys(world.entities.fleets).sort()
    .map((id) => world.entities.fleets[id])
    .filter((f) => f.factionId === fid && f.role === 'combat' && f.shipIds.length > 0);
}

function homeSystemOf(world, fid) {
  const fac = world.entities.factions[fid];
  return world.entities.systems[fac.homeSystemId];
}

function maxThreat(world, fid) {
  let t = 0;
  for (const key of Object.keys(world.relations.diplomacy)) {
    const rel = world.relations.diplomacy[key];
    if (!rel.parties.includes(fid)) continue;
    t = Math.max(t, (rel.threat || 0) / 100);
  }
  return t;
}

function findWeakNeighbor(world, fid) {
  // 效用评估：军力比 > 1.6、边境紧张高、非玩家优先
  let best = null;
  let bestU = -Infinity;
  for (const otherId of Object.keys(world.entities.factions).sort()) {
    if (otherId === fid) continue;
    const rel = getRelation(world, fid, otherId);
    if (rel.warId) continue;
    if (rel.contactState !== 'contacted') continue;
    const myPower = factionPower(world, fid);
    const theirPower = factionPower(world, otherId);
    const ratio = myPower / Math.max(1, theirPower);
    const u = ratio * 10 + (rel.borderTension || 0) * 0.2 - (rel.opinion || 0) * 0.1 +
      (otherId === world.playerFactionId ? -6 : 0); // 玩家初始保护倾向
    if (u > bestU && ratio > 1.5 && (rel.borderTension || 0) > 25) {
      bestU = u;
      best = otherId;
    }
  }
  return best;
}

function factionPower(world, fid) {
  let p = 0;
  for (const sid of Object.keys(world.entities.ships)) {
    const s = world.entities.ships[sid];
    if (s.factionId !== fid || s.status !== 'active') continue;
    p += (s.stats?.structure || 0) / 100 + (s.stats?.weapons || []).length;
  }
  return p;
}

// ———— 外交 ————

function aiDiplomacy(world, fid, st, w) {
  // 对高威胁邻国提议互不侵犯；对高信任盟友提议贸易
  for (const otherId of Object.keys(world.entities.factions).sort()) {
    if (otherId === fid) continue;
    const rel = getRelation(world, fid, otherId);
    if (rel.contactState !== 'contacted' || rel.warId) continue;
    if ((rel.treaties || []).length > 0) continue;
    const threat = rel.threat || 0;
    const trust = rel.trust || 0;
    if (threat > 55 && trust > 25) {
      const r = executeCommand(world, {
        type: 'OfferTreaty', actorId: fid,
        params: { targetFactionId: otherId, type: 'nonaggression' },
      });
      if (r.ok) {
        recordOrder(st, 'diplomacy', `treaty:${otherId}`);
        return true;
      }
    }
    if (trust > 45 && w.diplomacy > 1.1) {
      const r = executeCommand(world, {
        type: 'OfferTreaty', actorId: fid,
        params: { targetFactionId: otherId, type: 'trade' },
      });
      if (r.ok) {
        recordOrder(st, 'diplomacy', `trade:${otherId}`);
        return true;
      }
    }
  }
  return false;
}

let _evalWorld = null;
function recordOrder(st, kind, detail) {
  const oid = `${kind}:${detail}:${st._oid = (st._oid || 0) + 1}`;
  st.orders[oid] = { kind, detail, createdTick: _evalWorld ? _evalWorld.tick : 0 };
  if (Object.keys(st.orders).length > 12) {
    const oldest = Object.keys(st.orders).sort((a, b) => st.orders[a].createdTick - st.orders[b].createdTick)[0];
    delete st.orders[oldest];
  }
}

// ————

function sortedColonies(world, fid) {
  return Object.keys(world.entities.colonies).sort()
    .map((cid) => world.entities.colonies[cid])
    .filter((c) => c.factionId === fid);
}
