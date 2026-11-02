/**
 * tests/suites/ship-build.suite.js — SHIP-02: 蓝图 + 船坞建造全流程
 *
 * 覆盖（命令总线全流程，命令注册来自 src/app/commands.js）：
 *  - 手工 setup：单阵营账本 credits 50000 / alloy 1000 / polymer 200 + 单星系；
 *  - SaveBlueprint（合规装配）→ 蓝图实体入册；
 *  - 造 station {kind:'shipyard'} → ShipyardBuild ok：账本按护卫舰造价精确扣减
 *    （credits −2200 / alloy −130 / polymer −25）且 buildQueue 入队 120 小时；
 *  - advanceTicks 200 → 新舰出现（ships +1）、buildQueue 清空、蓝图回链正确；
 *  - 缺料路径：清空账本再 ShipyardBuild → NO_FUNDS 且队列不新增
 *    （validate 拒绝、无部分状态 —— CORE-05 语义）。
 *
 * 环境补丁说明：World 工厂未初始化 narrative.pendingChoices（实现缺口，见
 * 测试报告），日结 narrative 阶段会崩溃 —— 测试在世界实例上补空数组，
 * 不修改 src/。
 */
import '../../src/app/commands.js';
import { createWorld } from '../../src/domain/world/World.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { ensureLedger, balance } from '../../src/domain/economy/ledger.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { assert, assertEq } from './assert.js';

export const suite = {
  id: 'SHIP-02',
  name: '蓝图与船坞建造流程',
  group: 'ships',
  async run() {
    try {
      const world = createWorld({ seed: 11 });
      world.narrative.pendingChoices ||= [];
      const fac = createEntity(world, 'factions', {
        nameZh: '造船测试文明', personality: 'balanced', homeSystemId: null, homePlanetId: null,
      });
      const led = ensureLedger(world, fac.id);
      led.balances.credits = 50000;
      led.balances.alloy = 1000;
      led.balances.polymer = 200;
      const sys = createEntity(world, 'systems', {
        id: 'sys_shipyard',
        name: '造船测试系',
        x: 100, y: 100,
        lanes: [], planetIds: [], stationIds: [], anomalyIds: [],
        ownerFactionId: fac.id, surveyedBy: {},
        resourceRating: 5, dangerRating: 0,
        star: { typeId: 'yellowDwarf', name: '', energy: 1, scanNoise: 0.1 },
        flags: {},
      });

      // 1) 保存蓝图（合规装配）
      const rBp = executeCommand(world, {
        type: 'SaveBlueprint', actorId: fac.id,
        params: { hullId: 'hull_frigate', modules: ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster'], name: '测试护卫设计' },
      });
      assertEq(rBp.ok, true, `SaveBlueprint 应成功（实测 ${JSON.stringify(rBp)}）`);
      const bpIds = Object.keys(world.entities.blueprints);
      assertEq(bpIds.length, 1, '蓝图应入册 1 份');
      const bp = world.entities.blueprints[bpIds[0]];
      assertEq(bp.hullId, 'hull_frigate', '蓝图船体');
      assertEq(bp.factionId, fac.id, '蓝图归属');

      // 2) 造船坞 + 建造命令
      const station = createEntity(world, 'stations', {
        kind: 'shipyard', systemId: sys.id, factionId: fac.id, level: 1, buildQueue: [],
      });
      const rBuild = executeCommand(world, {
        type: 'ShipyardBuild', actorId: fac.id,
        params: { blueprintId: bp.id, stationId: station.id },
      });
      assertEq(rBuild.ok, true, `ShipyardBuild 应成功（实测 ${JSON.stringify(rBuild)}）`);

      // 3) 账本扣减（hull_frigate 造价，无修正乘数）
      assertEq(balance(world, fac.id, 'credits'), 47800, 'credits 50000 − 2200');
      assertEq(balance(world, fac.id, 'alloy'), 870, 'alloy 1000 − 130');
      assertEq(balance(world, fac.id, 'polymer'), 175, 'polymer 200 − 25');
      assertEq(station.buildQueue.length, 1, 'buildQueue 应有 1 个任务');
      assertEq(station.buildQueue[0].blueprintId, bp.id, '队列任务指向蓝图');
      assertEq(station.buildQueue[0].remainingHours, 120, '护卫舰建造工期 120 小时');

      // 4) 缺料路径：清空账本 → NO_FUNDS，队列不新增（无部分状态）
      led.balances.credits = 0;
      led.balances.alloy = 0;
      led.balances.polymer = 0;
      const rFail = executeCommand(world, {
        type: 'ShipyardBuild', actorId: fac.id,
        params: { blueprintId: bp.id, stationId: station.id },
      });
      assertEq(rFail.ok, false, '缺料建造应失败');
      assertEq(rFail.code, 'NO_FUNDS', `失败码应为 NO_FUNDS（实测 ${rFail.code}）`);
      assertEq(station.buildQueue.length, 1, '失败命令不新增队列任务');
      assertEq(balance(world, fac.id, 'alloy'), 0, '失败命令不改变账本');

      // 5) 推进 200 tick：船坞产出新舰、队列清空
      led.balances.credits = 50000;
      led.balances.alloy = 1000;
      led.balances.polymer = 200;
      const shipsBefore = Object.keys(world.entities.ships).length;
      advanceTicks(world, 200);
      const shipsAfter = Object.keys(world.entities.ships).length;
      assertEq(shipsAfter, shipsBefore + 1, '推进 200 tick 后应新建 1 艘舰');
      assertEq(station.buildQueue.length, 0, '建造完成后 buildQueue 清空');
      const built = world.entities.ships[Object.keys(world.entities.ships).sort()[0]];
      assertEq(built.hullId, 'hull_frigate', '新舰船体');
      assertEq(built.factionId, fac.id, '新舰归属建造文明');
      assertEq(built.blueprintId, bp.id, '新舰回链蓝图');
      assertEq(built.systemId, sys.id, '新舰在船坞星系下水');
      assertEq(built.status, 'active', '新舰状态 active');
      assert(built.stats && Number.isFinite(built.stats.structure), '新舰 stats 已推导');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
