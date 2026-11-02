/**
 * tests/suites/fleet-nav.suite.js — FLEET-01: 航路规划与舰队转移
 *
 * 覆盖（domain/fleets/navigation.js planRoute / beginPlannedTransit /
 * advanceFleets + OrderFleetMove 命令全流程）：
 *  - 手工航路图：A—B—C 链 + 两个不连通的孤立星系 D、E；
 *  - planRoute 同星系 → SAME_SYSTEM；
 *  - 相邻星系 → ok 且 eta ≥ 1、fuelNeed > 0；
 *  - 不可达（孤立星系）→ NO_ROUTE；
 *  - 燃料耗尽：船 fuel=0.5 走 fuelNeed=2 的路线 → NO_FUEL 且不产生部分状态
 *    （transit 仍为 null、位置不变、燃料不变）；
 *  - OrderFleetMove 命令 → transit 建立 → advanceTicks 5 后抵达 C 且
 *    FleetArrived 事件存在于 world.events.log.fleet。
 */
import '../../src/app/commands.js';
import { createWorld } from '../../src/domain/world/World.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { createFleet } from '../../src/domain/fleets/fleet.js';
import { planRoute } from '../../src/domain/fleets/navigation.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { assert, assertEq } from './assert.js';

const A = 'sys_nav_a';
const B = 'sys_nav_b';
const C = 'sys_nav_c';
const D = 'sys_nav_d';
const E = 'sys_nav_e';

export const suite = {
  id: 'FLEET-01',
  name: '航路规划与舰队转移',
  group: 'fleets',
  async run() {
    try {
      const world = createWorld({ seed: 3 });
      world.narrative.pendingChoices ||= [];
      const fac = createEntity(world, 'factions', { nameZh: '导航测试文明', personality: 'balanced' });
      const mkSys = (id, x, y, lanes) => createEntity(world, 'systems', {
        id, name: `系${id}`,
        x, y, lanes,
        planetIds: [], stationIds: [], anomalyIds: [],
        ownerFactionId: null, surveyedBy: {},
        resourceRating: 1, dangerRating: 0,
        star: { typeId: 'yellowDwarf', name: '', energy: 1, scanNoise: 0.1 },
        flags: {},
      });
      mkSys(A, 0, 0, [B]);
      mkSys(B, 100, 0, [A, C]);
      mkSys(C, 200, 0, [B]);
      mkSys(D, 500, 500, []); // 孤立
      mkSys(E, 600, 600, []); // 孤立

      const fleet = createFleet(world, {
        factionId: fac.id, systemId: A, role: 'combat',
        ships: [{ hullId: 'hull_frigate', moduleIds: ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster'] }],
      });

      // 1) 同星系
      const same = planRoute(world, fleet, A);
      assertEq(same.ok, false, '同星系规划应拒绝');
      assertEq(same.code, 'SAME_SYSTEM', `失败码 SAME_SYSTEM（实测 ${same.code}）`);

      // 2) 相邻星系：ok、eta ≥ 1、fuelNeed > 0
      const adj = planRoute(world, fleet, B);
      assertEq(adj.ok, true, `相邻星系规划应成功（实测 ${JSON.stringify(adj).slice(0, 120)}）`);
      assert(adj.eta >= 1, `eta 应 ≥ 1（实测 ${adj.eta}）`);
      assert(adj.fuelNeed > 0, `fuelNeed 应 > 0（实测 ${adj.fuelNeed}）`);
      assertEq(adj.route.path, [A, B], '相邻航线为 A→B');

      // 3) 不可达：孤立星系
      const iso = planRoute(world, fleet, D);
      assertEq(iso.ok, false, '孤立星系应不可达');
      assertEq(iso.code, 'NO_ROUTE', `失败码 NO_ROUTE（实测 ${iso.code}）`);

      // 4) 燃料耗尽：fuel=0.5 走 2 航段（fuelNeed=2）→ NO_FUEL，无部分状态
      const poorFleet = createFleet(world, {
        factionId: fac.id, systemId: A, role: 'combat',
        ships: [{ hullId: 'hull_frigate', moduleIds: ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster'], fuel: 0.5 }],
      });
      const poorShip = world.entities.ships[poorFleet.shipIds[0]];
      const noFuel = planRoute(world, poorFleet, C);
      assertEq(noFuel.ok, false, '燃料不足应拒绝');
      assertEq(noFuel.code, 'NO_FUEL', `失败码 NO_FUEL（实测 ${noFuel.code}）`);
      assert(noFuel.fuelNeed > 0.5, `fuelNeed ${noFuel.fuelNeed} 应 > 0.5`);
      assertEq(poorFleet.transit, null, 'NO_FUEL 不产生 transit（无部分状态）');
      assertEq(poorFleet.systemId, A, '舰队位置不变');
      assertEq(poorShip.fuel, 0.5, '燃料未被预扣');

      // 5) OrderFleetMove 命令全流程：A →（B）→ C
      const r = executeCommand(world, {
        type: 'OrderFleetMove', actorId: fac.id,
        params: { fleetId: fleet.id, targetSystemId: C },
      });
      assertEq(r.ok, true, `OrderFleetMove 应成功（实测 ${JSON.stringify(r)}）`);
      assert(fleet.transit, 'transit 应建立');
      assertEq(fleet.transit.path, [A, B, C], '航路 A→B→C');
      assertEq(fleet.systemId, null, '起航后舰队在途（systemId 置空）');

      // 6) advanceTicks 5（航程 eta=2）后抵达且 FleetArrived 入档
      advanceTicks(world, 5);
      assertEq(fleet.systemId, C, '舰队应抵达目标星系 C');
      assertEq(fleet.transit, null, '抵达后 transit 清除');
      assertEq(fleet.status, 'idle', '抵达后恢复 idle');
      const arrived = (world.events.log.fleet || []).filter((e) => e.type === 'FleetArrived');
      assert(arrived.length >= 1, 'FleetArrived 事件应存在于 fleet 事件日志');
      assert(
        arrived.some((e) => e.payload.fleetId === fleet.id && e.payload.systemId === C),
        'FleetArrived 事件指向本舰队与目标星系'
      );

      // 7) 低燃料舰队不受推进影响（仍受困原地）
      assertEq(poorFleet.systemId, A, '低燃料舰队仍在 A');
      assertEq(poorShip.fuel, 0.5, '无可补给处燃料不变');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
