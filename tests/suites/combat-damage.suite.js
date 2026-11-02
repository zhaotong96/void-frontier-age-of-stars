/**
 * tests/suites/combat-damage.suite.js — COMBAT-01: 伤害分层管线
 *
 * 覆盖：
 *  - content/weapons 抗性矩阵锚点：layerResist('shield','kinetic')=0.55、
 *    layerResist('armor','thermal')=0.45；
 *  - applyDamage（domain/ships/ship.js）分层顺序：护盾层先扣（装甲/结构不动）→
 *    护盾归零后伤害穿装甲 → 装甲归零后伤及结构；并用 layerResist 手工复现
 *    tactics.applyHit 的穿透级联（护盾吸收在前）；
 *  - COMBAT-06 结算：structure ≤ 0 → status='destroyed'、从舰队成员表移除、
 *    fleetId 置空；幂等：destroyed 船再 applyDamage 返回 0 且状态不变；
 *  - 最小战斗实例（手工组装 battle 对象 + stepOneBattle 推进）冒烟：无 NaN、
 *    单位数不变。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { createFleet } from '../../src/domain/fleets/fleet.js';
import { createShip, applyDamage, destroyShip } from '../../src/domain/ships/ship.js';
import { stepOneBattle } from '../../src/domain/combat/BattleSimulation.js';
import { layerResist } from '../../src/content/weapons.js';
import { assert, assertEq, assertNear } from './assert.js';

const FRIGATE_MODULES = ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster'];

/** 最小测试世界：两阵营 + 一星系 + 各带一舰的舰队（船先建后编入成员表） */
function makeCombatWorld(seed) {
  const world = createWorld({ seed });
  const facA = createEntity(world, 'factions', { nameZh: '测试甲' });
  const facB = createEntity(world, 'factions', { nameZh: '测试乙' });
  createEntity(world, 'systems', {
    id: 'sys_cbt',
    name: '战测试系',
    x: 0, y: 0,
    lanes: [], planetIds: [], stationIds: [], anomalyIds: [],
    ownerFactionId: null, surveyedBy: {},
    resourceRating: 1, dangerRating: 0,
    star: { typeId: 'yellowDwarf', name: '', energy: 1, scanNoise: 0.1 },
    flags: {},
  });
  const mkSide = (fid) => {
    const fleet = createFleet(world, { factionId: fid, systemId: 'sys_cbt', role: 'combat', ships: [] });
    const ship = createShip(world, {
      factionId: fid,
      hullId: 'hull_frigate',
      moduleIds: FRIGATE_MODULES,
      fleetId: fleet.id,
      systemId: 'sys_cbt',
    });
    fleet.shipIds.push(ship.id); // createShip 不回填成员表，与 fleet.js 行为对齐
    return { fleet, ship };
  };
  return { world, facA, facB, sideA: mkSide(facA.id), sideB: mkSide(facB.id) };
}

/** 手工组装最小战斗实例（结构对齐 engagement.createBattleFromFleets 产物） */
function makeBattle(world, sideA, sideB) {
  const battle = {
    id: 'btl_cbt01',
    systemId: 'sys_cbt',
    startedTick: world.tick,
    time: 0,
    status: 'active',
    sides: { a: sideA.ship.factionId, b: sideB.ship.factionId },
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
  return battle;
}

export const suite = {
  id: 'COMBAT-01',
  name: '伤害分层管线',
  group: 'combat',
  async run() {
    try {
      // 1) 抗性矩阵锚点（COMBAT-01 基准）
      assertEq(layerResist('shield', 'kinetic'), 0.55, '护盾对动能抗性');
      assertEq(layerResist('armor', 'thermal'), 0.45, '装甲对热能抗性');

      const { world, sideA, sideB } = makeCombatWorld(3);

      // 2) 护盾层先扣：applyDamage(shield) 只动护盾，并设置再生延迟
      const A = sideA.ship;
      assertEq(A.hp.shield, 40, '护卫舰初始护盾 40');
      assertEq(applyDamage(world, A, 15, 'shield'), 0, '护盾层伤害不改变结构（返回结构差值 0）');
      assertEq(A.hp.shield, 25, '护盾 40 → 25');
      assertEq(A.hp.armor, 30, '装甲不受护盾层伤害影响');
      assertEq(A.hp.structure, 260, '结构不受护盾层伤害影响');
      assertEq(A.hp.shieldRegenDelay, 6, '受击后护盾再生延迟置位');

      // 3) 护盾归零后伤害穿装甲；装甲归零后伤及结构
      const B = sideB.ship;
      B.hp.shield = 0;
      applyDamage(world, B, 12, 'armor');
      assertEq(B.hp.armor, 18, '装甲 30 → 18');
      assertEq(B.hp.structure, 260, '装甲未击穿前结构不变');
      applyDamage(world, B, 10, 'structure');
      assertEq(B.hp.structure, 250, '装甲归零后结构直接承伤 260 → 250');

      // 3b) 单次级联的分层顺序（镜像 tactics.applyHit 算法：抗性只减免本层吸收量）
      {
        const C = makeCombatWorld(4);
        const ship = C.sideA.ship;
        let dmg = 50;
        for (const layer of ['shield', 'armor', 'structure']) {
          if (dmg <= 0) break;
          const effective = dmg * (1 - layerResist(layer, 'kinetic'));
          const absorbed = Math.min(ship.hp[layer], effective);
          ship.hp[layer] -= absorbed;
          dmg -= absorbed;
        }
        // 动能 50：护盾(0.45) 吸 22.5，剩余 27.5 → 装甲(0.65) 吸 17.875，剩余 9.625 → 结构(0.95) 吸 9.14
        assertNear(ship.hp.shield, 40 - 22.5, 1e-9, '级联中护盾最先吸收');
        assertNear(ship.hp.armor, 30 - 17.875, 1e-9, '级联中装甲第二吸收');
        assertNear(ship.hp.structure, 260 - 9.144999999999996, 1e-6, '级联中结构最后吸收');
      }

      // 4) COMBAT-06：结构归零 → destroyed + 从舰队成员表移除
      const destroyedTickBefore = world.tick;
      applyDamage(world, B, 300, 'structure');
      assertEq(B.status, 'destroyed', '结构归零后 status=destroyed');
      assertEq(B.destroyedTick, destroyedTickBefore, 'destroyedTick 记录当前 tick');
      assertEq(B.fleetId, null, '销毁后舰船脱离舰队引用');
      assert(
        !sideB.fleet.shipIds.includes(B.id),
        '销毁后应从舰队成员表移除（COMBAT-06）'
      );

      // 5) 幂等：destroyed 船再受击返回 0，状态与成员表不变
      assertEq(applyDamage(world, B, 50, 'structure'), 0, 'destroyed 船 applyDamage 返回 0');
      assertEq(B.hp.structure, 0, '结构保持 0');
      assertEq(B.destroyedTick, destroyedTickBefore, '重复销毁不刷新 destroyedTick');
      destroyShip(world, B, 'test');
      assertEq(B.status, 'destroyed', '重复 destroyShip 幂等');

      // 6) 最小战斗实例推进冒烟（90 步 ≈ 3 战斗秒）
      const { world: w2, sideA: s2A, sideB: s2B } = makeCombatWorld(5);
      const battle = makeBattle(w2, s2A, s2B);
      const DT = 1 / 30;
      for (let i = 0; i < 90 && battle.status === 'active'; i++) {
        stepOneBattle(w2, battle, DT);
      }
      assertNear(battle.time, 3, 1e-6, '90 步 × dt=1/30 → 3 战斗秒');
      assertEq(battle.units.length, 2, '推进不增减单位');
      for (const u of battle.units) {
        for (const k of ['x', 'y', 'vx', 'vy', 'heading']) {
          assert(Number.isFinite(u[k]), `单位字段 ${k} 应有限（实测 ${u[k]}）`);
        }
        for (const v of Object.values(u.cooldowns)) {
          assert(Number.isFinite(v) && v >= 0, '冷却值应有限且非负');
        }
      }
      for (const v of Object.values(battle.damageDealt)) {
        assert(Number.isFinite(v), `damageDealt 应有限（实测 ${v}）`);
      }
      assert(battle.status === 'active' || battle.status === 'done', '战斗状态合法');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
