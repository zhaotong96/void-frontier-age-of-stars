/**
 * tests/suites/ship-fit.suite.js — SHIP-01: 装配校验与属性计算
 *
 * 覆盖（domain/ships/ship.js validateFit / computeShipStats）：
 *  - 合规装配（护卫舰 + 轨道炮/裂变堆/离子推进）→ ok 且无错误；
 *  - 槽位超限：3 门不同高槽武器上护卫舰（high=2）→ SLOT_OVERFLOW；
 *  - 无反应堆：全武器配置 → NO_REACTOR；高耗电组合同时触发 POWER_DEFICIT；
 *  - CPU 超限：高算力模块组合（cpu 50 > 护卫舰 45）→ CPU_DEFICIT；
 *  - computeShipStats 边界：未知模块 id 被跳过、stats 全数值有限、
 *    未知船体返回 null / NO_HULL。
 */
import { validateFit, computeShipStats, hullDef } from '../../src/domain/ships/ship.js';
import { MODULES } from '../../src/content/modules.js';
import { assert, assertEq } from './assert.js';

const VALID_FRIGATE = ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster'];

function hasCode(result, code) {
  return (result.errors || []).some((e) => e.code === code);
}

export const suite = {
  id: 'SHIP-01',
  name: '装配校验与属性计算',
  group: 'ships',
  async run() {
    try {
      // 0) 内容基线：任务书规格引用的模块/船体必须存在
      const moduleIds = new Set(MODULES.map((m) => m.id));
      for (const mid of VALID_FRIGATE) {
        assert(moduleIds.has(mid), `内容缺失：模块 ${mid} 应存在`);
      }

      // 1) 合规装配
      const ok = validateFit('hull_frigate', VALID_FRIGATE);
      assertEq(ok.ok, true, `合规装配应通过（实测 ${JSON.stringify(ok.errors)}）`);
      assertEq(ok.errors.length, 0, '合规装配无错误项');

      // 2) 槽位超限：3 门不同武器上护卫舰（high 槽 = 2）
      const overflow = validateFit('hull_frigate', [
        'mod_railgun', 'mod_laser_array', 'mod_missile_rack',
      ]);
      assertEq(overflow.ok, false, '超槽装配应失败');
      assert(hasCode(overflow, 'SLOT_OVERFLOW'), '应报 SLOT_OVERFLOW（high 3/2）');

      // 3) 无反应堆 + 功率缺口：全高耗电武器无反应堆
      //    船体 70 − 攻城28 − 等离子24 − 粒子20 − 轨道16 = −18 < 0
      const noReactor = validateFit('hull_frigate', [
        'mod_siege_cannon', 'mod_plasma_thrower', 'mod_particle_lance', 'mod_railgun',
      ]);
      assertEq(noReactor.ok, false, '无反应堆装配应失败');
      assert(hasCode(noReactor, 'NO_REACTOR'), '应报 NO_REACTOR');
      assert(hasCode(noReactor, 'POWER_DEFICIT'), '该组合同时应报 POWER_DEFICIT（功率缺口 18）');

      // 4) CPU 超限：高算力组合 cpu = 12+12+12+12+2 = 50 > 护卫舰 45
      //    （槽位与功率均合规，仅 CPU 一项失败 → 定向验证 CPU_DEFICIT）
      const cpuOut = validateFit('hull_frigate', [
        'mod_sensor_deepspace', 'mod_sensor_damper', 'mod_drone_weapon', 'mod_fighter_bay', 'mod_reactor_fission',
      ]);
      assertEq(cpuOut.ok, false, 'CPU 超限装配应失败');
      assert(hasCode(cpuOut, 'CPU_DEFICIT'), '应报 CPU_DEFICIT');
      assertEq(cpuOut.errors.length, 1, '该组合仅 CPU 一项失败');

      // 5) computeShipStats：未知模块 id 被跳过、stats 全有限
      const stats = computeShipStats('hull_frigate', ['mod_railgun', 'mod_no_such_module', 'mod_reactor_fission']);
      assert(stats, '已知船体的 stats 不应为 null');
      assertEq(stats.weapons.length, 1, '未知模块被跳过：仅轨道炮 1 门武器');
      assertEq(stats.cpu, 9, 'cpu = 轨道炮 7 + 裂变堆 2（未知模块不计）');
      for (const [k, v] of Object.entries(stats)) {
        if (typeof v === 'number') {
          assert(Number.isFinite(v), `stats.${k} 应有限（实测 ${v}）`);
        }
      }
      assert(stats.structure >= 1, '结构下限保护 ≥ 1');
      assertEq(stats.powerNet, 99, '功率净值 = (70+45) − 16（未知模块不参与功率结算）');

      // 5b) 合规组合的 stats.cpu ≤ 船体 cpu（任务书 SHIP-01 口径）
      const validStats = computeShipStats('hull_frigate', VALID_FRIGATE);
      assert(validStats.cpu <= 45, `合规装配 cpu ${validStats.cpu} 应 ≤ 船体 45`);

      // 6) 未知船体边界
      assertEq(computeShipStats('hull_nope', []), null, '未知船体 computeShipStats 返回 null');
      const noHull = validateFit('hull_nope', []);
      assertEq(noHull.ok, false, '未知船体校验失败');
      assert(hasCode(noHull, 'NO_HULL'), '应报 NO_HULL');
      assertEq(hullDef('hull_nope'), undefined, '未知船体定义查询为 undefined');

      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
