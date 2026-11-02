/**
 * tests/suites/combat-hitmodel.suite.js — COMBAT-02: 命中模型与战斗生命周期
 *
 * hitProbability 未导出，按行为级验证：
 *  - 两舰（各 1 门导弹架，初始距离 160 在 optimal=340 内）手工组建战斗实例并
 *    挂入 world.battles.active，循环 stepOneBattle 1000 步（dt=1/30）：
 *      · 双方 cooldowns 都出现过非零（开火发生）；
 *      · damageDealt 有限、无 NaN、battle.units 数量不变。
 *  - 击杀路径：将一舰 hp.structure 置 5（护盾/装甲清零）再推进 → 出现
 *    destroyed 事件；finishBattle 后 world.battles.active 清空、history ≥ 1。
 *
 * 武器选型说明：导弹架（range 560 / optimal 340）的目标选择阈值
 * range×1.3=728 覆盖默认站位间距 400，可避免动能炮（阈值 325 < 400）在
 * 目标丢失后的永久僵局（该实现行为已记入问题清单）。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { createFleet } from '../../src/domain/fleets/fleet.js';
import { createShip } from '../../src/domain/ships/ship.js';
import { stepOneBattle } from '../../src/domain/combat/BattleSimulation.js';
import { assert, assertEq } from './assert.js';

const MISSILE_FRIGATE = ['mod_missile_rack', 'mod_reactor_fission', 'mod_ion_thruster'];
const DT = 1 / 30;

function makeDuel(seed) {
  const world = createWorld({ seed });
  const facA = createEntity(world, 'factions', { nameZh: '命中甲' });
  const facB = createEntity(world, 'factions', { nameZh: '命中乙' });
  const mkSide = (fid) => {
    const fleet = createFleet(world, { factionId: fid, systemId: null, role: 'combat', ships: [] });
    const ship = createShip(world, {
      factionId: fid,
      hullId: 'hull_frigate',
      moduleIds: MISSILE_FRIGATE,
      fleetId: fleet.id,
      cargo: { deuterium: 50 }, // 导弹弹药
    });
    fleet.shipIds.push(ship.id);
    return { fleet, ship };
  };
  const sideA = mkSide(facA.id);
  const sideB = mkSide(facB.id);

  const battle = {
    id: 'btl_cbt02',
    systemId: null,
    startedTick: world.tick,
    time: 0,
    status: 'active',
    sides: { a: facA.id, b: facB.id },
    units: [
      { idx: 0, shipId: sideA.ship.id, side: 'a', x: 400, y: 160, vx: 0, vy: 0, heading: 0, targetShipId: null, cooldowns: {}, retreatCharge: 0, destroyed: false, order: 'engage', isBig: false },
      { idx: 1, shipId: sideB.ship.id, side: 'b', x: 560, y: 160, vx: 0, vy: 0, heading: Math.PI, targetShipId: null, cooldowns: {}, retreatCharge: 0, destroyed: false, order: 'engage', isBig: false },
    ],
    projectiles: [],
    events: [],
    losses: { a: 0, b: 0 },
    damageDealt: { a: 0, b: 0 },
    endCondition: { kind: 'annihilate' },
  };
  world.battles.active[battle.id] = battle;
  return { world, battle, sideA, sideB };
}

/** 扫描战斗实例与单位数值域：不得出现 NaN/Infinity */
function assertFiniteBattle(battle) {
  for (const u of battle.units) {
    for (const k of ['x', 'y', 'vx', 'vy', 'heading', 'retreatCharge']) {
      assert(Number.isFinite(u[k]), `单位 ${u.shipId} 字段 ${k} 出现 NaN/Infinity（实测 ${u[k]}）`);
    }
    for (const [k, v] of Object.entries(u.cooldowns)) {
      assert(Number.isFinite(v), `冷却 ${k} 出现 NaN/Infinity（实测 ${v}）`);
    }
  }
  for (const side of ['a', 'b']) {
    assert(Number.isFinite(battle.damageDealt[side]), `damageDealt.${side} 应有限`);
  }
  assert(Number.isFinite(battle.time), 'battle.time 应有限');
}

export const suite = {
  id: 'COMBAT-02',
  name: '命中模型与战斗生命周期',
  group: 'combat',
  async run() {
    try {
      const { world, battle, sideA, sideB } = makeDuel(3);

      // —— 阶段 1：1000 步（≈33 战斗秒）对射 ——
      let firedA = false;
      let firedB = false;
      for (let i = 0; i < 1000 && battle.status === 'active'; i++) {
        stepOneBattle(world, battle, DT);
        for (const u of battle.units) {
          if ((u.cooldowns.w0 ?? 0) > 0) {
            if (u.side === 'a') firedA = true;
            if (u.side === 'b') firedB = true;
          }
        }
      }
      assert(firedA, 'A 侧应出现过非零冷却（开火发生）');
      assert(firedB, 'B 侧应出现过非零冷却（开火发生）');
      assert(battle.damageDealt.a >= 0 && battle.damageDealt.b >= 0, 'damageDealt 非负有限');
      assertFiniteBattle(battle);
      assertEq(battle.units.length, 2, '阶段 1 单位数量不变');
      assertEq(sideA.ship.status, 'active', '阶段 1 双方存活（对称火力）');
      assertEq(sideB.ship.status, 'active', '阶段 1 双方存活（对称火力）');

      // —— 阶段 2：击杀路径 ——
      // 把 B 舰打到只剩 5 结构（护盾/装甲清零）：任意一次命中即触发 destroyShip。
      sideB.ship.hp.shield = 0;
      sideB.ship.hp.armor = 0;
      sideB.ship.hp.structure = 5;

      let steps = 0;
      for (; steps < 1800 && battle.status === 'active'; steps++) {
        stepOneBattle(world, battle, DT);
      }
      assertEq(battle.status, 'done', `击杀阶段应在有限步内结束（已推进 ${steps} 步）`);
      assert(
        battle.events.some((e) => e.type === 'destroyed'),
        '战斗时间线应出现 destroyed 事件'
      );
      assertFiniteBattle(battle);

      // finishBattle 结算：active 清空、history 入账
      assertEq(Object.keys(world.battles.active).length, 0, '战斗结束后 battles.active 应清空');
      assert(world.battles.history.length >= 1, 'battles.history 应 ≥ 1');
      const report = world.battles.history[world.battles.history.length - 1];
      assertEq(report.id, battle.id, '战报对应本战斗实例');
      assert(report.winnerSide === 'a', '幸存方 a 应为胜者');

      // 舰船实体与舰队成员表回写（COMBAT-06 战斗侧路径）
      assertEq(sideB.ship.status, 'destroyed', '被击沉舰 status=destroyed');
      assertEq(sideB.fleet.shipIds.length, 0, '被击沉舰已移出舰队成员表');
      assertEq(sideB.ship.fleetId, null, '被击沉舰 fleetId 置空');
      assertEq(sideA.ship.status, 'active', '胜方舰存活');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
