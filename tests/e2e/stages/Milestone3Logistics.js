/**
 * tests/e2e/stages/Milestone3Logistics.js — 里程碑 3：天地物流与第二殖民地（doc28 §3.3）
 *
 * doc28 行为链 → 真实代码映射：
 *  - 「地表部署电磁质量投射器 CatapultFeed」→ PlaceBuilding bld_freight_catapult
 *    （真机坡度校验 + 自动入 planet.ind 节点，commands.js:769-781）→
 *    CatapultFeed（50 单位/舱）→ stepCatapult 蓄能发射 → 轨道缓冲 → 市场销售
 *  - 「跨星系双城自动化物流网」→ 殖民地商业闭环 dailyColonyCommerce
 *    （盈余自动出售 + 税收上缴，colonyTrade.js:34）——运行态物流网即此管道
 *  - 「发射天地物流轨道货舱」→ planet.ind.catapult[CATAPULT_IDX.LAUNCHED] > 0
 *  - 「殖民飞船建立前哨 FoundOutpost」→ 殖民舰队赴邻接宜居行星 FoundOutpost
 */

import { balance } from '../../../src/domain/economy/ledger.js';
import { sampleTerrain } from '../../../src/domain/ground/surfaceQueries.js';
import { buildTerrainField } from '../../../src/domain/ground/terrainField.js';
import {
  assert, assertCmd, cmd, advance, assertWorldHealthy,
} from '../assertions/MilestoneStateAssertions.js';

/** 场域平整落点扫描（9 点近邻高差最小化；与 PlaceBuilding 坡度校验同源口径）。
 *  返回 [弹射井落点, 并网太阳能落点]——第二点须落在弹射井 20m 内
 *  （wireRadiusM 24 的并网半径，保证 UnionFind 合入同一电网）。 */
async function findFlatSpots(world, planetId) {
  // 用游戏自己的 9 点足迹坡度校验器做候选排序（与 PlaceBuilding 判定同源，
  // 消除简化梯度采样与真机校验的口径差——F-12 排障实录）
  const { checkBuildingPlacement } = await import('../../../src/domain/ground/terrainEdits.js');
  const field = buildTerrainField(world, planetId, {});
  const candidates = [];
  for (let z = -60; z <= 60; z += 4) {
    for (let x = -60; x <= 60; x += 4) {
      const chk = checkBuildingPlacement(field, x, z, { themeId: world.entities.planets[planetId].primaryThemeId });
      if (chk.ok) candidates.push({ x, z, slope: chk.maxSlopeDeg });
    }
  }
  candidates.sort((a, b) => a.slope - b.slope);
  const cat = candidates[0];
  const near = candidates
    .filter((c) => c !== cat && Math.hypot(c.x - cat.x, c.z - cat.z) <= 20)
    .sort((a, b) => a.slope - b.slope)[0];
  return [cat, near];
}

export class Milestone3Logistics {
  constructor(ctx) { this.ctx = ctx; }

  async execute() {
    const world = this.ctx.world;
    const pid = world.playerFactionId;
    const home = Object.values(world.entities.colonies).find((c) => c.factionId === pid);
    const homePlanet = world.entities.planets[home.planetId];

    // 1. 地表部署货运弹射井（真机坡度校验 + 自动入工业节点）
    const spots = await findFlatSpots(world, homePlanet.id);
    assert(spots.length === 2 && spots[1], `弹射井 20m 内无可并网平整落点`);
    const spot = spots[0];
    await assertCmd(world, 'PlaceBuilding', {
      planetId: homePlanet.id, defId: 'bld_freight_catapult', x: spot.x, z: spot.z,
    }, pid);
    const ind = homePlanet.ind;
    assert(ind && ind.v === 1, 'planet.ind 未激活');
    // 节点解析（PlaceBuilding 自动双写工业节点；BUILDINGS 与命令总线同源）
    const { BUILDINGS } = await import('../../../src/content/buildings.js');
    const node = ind.nodes.find((n) => BUILDINGS[n[1]] && BUILDINGS[n[1]].catapult);
    assert(node, '弹射井工业节点未入账');
    const nodeId = node[0];

    // 1b. 并网发电节点：工业电网发电量取自 ind 节点（F-12 修复后 powerGen 计入
    //     genKW）——弹射井旁地表并网一座太阳能阵列（BuildOnColony 殖民建筑不入
    //     planet.ind，必须经 PlaceBuilding 双写工业节点）
    await assertCmd(world, 'PlaceBuilding', {
      planetId: homePlanet.id, defId: 'bld_solar_array', x: spots[1].x, z: spots[1].z,
    }, pid);

    // 2. 发射天地物流轨道货舱：采掘盈余（商业闭环 reserve 之上）每攒满
    //    50 单位汇集 1 舱；弹射井由并网太阳能逐时蓄能发射
    let g = 0;
    const launchedIdx = 2; // CATAPULT_IDX.LAUNCHED
    while ((ind.catapult ? (ind.catapult[launchedIdx] || 0) : 0) < 1 && g++ < 1800) {
      await advance(world, 6);
      if ((home.stockpile.ferro || 0) >= 50) {
        await assertCmd(world, 'CatapultFeed', { planetId: homePlanet.id, nodeId, units: 50, resId: 'ferro' }, pid);
      }
    }
    assert((ind.catapult ? (ind.catapult[launchedIdx] || 0) : 0) >= 1,
      `弹射井 1800 tick 未发射（charge=${ind.catapult ? ind.catapult[0] : 'null'} pods=${ind.catapult ? ind.catapult[1] : '-'} ferro=${home.stockpile.ferro}）`);

    // 3. 建造殖民飞船 → 邻接宜居行星建立第二殖民地
    const colonyFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === pid && f.role === 'colony');
    assert(colonyFleet, '殖民舰队缺失');
    const here = world.entities.systems[colonyFleet.systemId];
    const targetSystemId = here.lanes.find((l) => l !== here.id && world.entities.systems[l]);
    assert(targetSystemId, '无邻接星系可殖民');
    await assertCmd(world, 'OrderFleetMove', { fleetId: colonyFleet.id, targetSystemId }, pid);
    let g2 = 0;
    while (world.entities.fleets[colonyFleet.id].systemId !== targetSystemId && g2++ < 400) await advance(world, 1);
    const planets = (world.entities.systems[targetSystemId].planetIds || [])
      .map((x) => world.entities.planets[x])
      .filter((p) => !p.colonyId && p.habitability >= 20)
      .sort((a, b) => b.habitability - a.habitability);
    assert(planets.length > 0, '目标星系无可殖民宜居行星');
    await assertCmd(world, 'FoundOutpost', { fleetId: colonyFleet.id, planetId: planets[0].id }, pid);
    const colonies = Object.values(world.entities.colonies).filter((c) => c.factionId === pid);
    assert(colonies.length >= 2, `第二殖民地未建立（${colonies.length}）`);

    // 4. 跨星系双城自动化物流网贯通：商业闭环税收（月度窗验证；
    //    transactions 为 400 滚动环——按 tick 窗口过滤而非数组下标）
    const monthTicks = 720;
    const txMarkTick = world.tick;
    await advance(world, monthTicks);
    const taxFlows = (world.economy.transactions || [])
      .filter((t) => t.tick > txMarkTick && t.flow === 'tax' && t.resId === 'credits');
    assert(taxFlows.length > 0, '双城商业闭环零税收上缴（物流网未贯通）');
    assert(balance(world, pid, 'credits') > 0, '阵营信用点非正');

    await assertWorldHealthy(world, 'M3');
    return {
      success: true,
      detail: `弹射井落点(${spot.x},${spot.z}) · 发射 ${ind.catapult[launchedIdx]} 舱 · 双城 ${colonies.length} 座 · 税收流水 ${taxFlows.length} 笔`,
    };
  }
}
