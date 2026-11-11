/**
 * tests/e2e/stages/Milestone4Victory.js — 里程碑 4：巨构工程与星海霸权（doc28 §3.4）
 *
 * doc28 行为链 → 真实代码映射（doc24 真实代码盘点优先）：
 *  - 「高阶星门/戴森球巨构」→ 工程内巨构终局内容为先驱者遗落科技链
 *    （hull_titan/bld_quantum_lattice，需巨石遗迹破译解锁）；本战役可达的
 *    「巨构工程」= 天地物流巨构体系（M3 弹射井）+ 星海科技霸权：
 *    胜利路线 = victory.js 六路线中的 tech 科技跃迁（45 科技 + ancientData≥20）
 *  - 「world.victoryState.achieved」→ world.victory.ended = {routeId, endingId, tick}
 *    （victory.js:83 真实口径；yearly 检查于 isYearStart 触发）
 *  - 「编年史条目 ≥ 4」→ world.events.chronicle + ChronicleView 数据契约
 *  - 「化解全域危机」分支为叙事弧终局（arc_crisis），不由本战役强制——
 *    六路线任一达成即真实胜利结算，本战役锁定 tech 路线
 *
 * 行为链：5×遗迹调查任务（ancientData+4/次 → ≥20）→ 每殖民地实验室
 * （科研速率 1+1.5×labs/h）→ 45 科技拓扑序队列（总量 15,310 点）→
 * 推进至第 1 年结算（tick 8640）→ victoryYearly 判定 tech 路线达成。
 */

import { balance } from '../../../src/domain/economy/ledger.js';
import { driveMissionToCompletion, activeMissionOf } from '../../agent/FivePhaseActionDriver.js';
import { getMissionField } from '../../../src/domain/ground/GroundMission.js';
import {
  assert, assertEq, assertCmd, cmd, advance, assertWorldHealthy, assertChronicleShape,
} from '../assertions/MilestoneStateAssertions.js';

/** 45 科技拓扑序（prereq 闭合最廉价计划；techplan.mjs 预计算，总量 15,310 点） */
const TECH_PLAN = [
  'tech_propulsion_1', 'tech_propulsion_2', 'tech_propulsion_3', 'tech_fuel_1', 'tech_fuel_2',
  'tech_mining_2', 'tech_mining_3', 'tech_alloy_2', 'tech_polymer_1', 'tech_industry_1',
  'tech_industry_2', 'tech_industry_3', 'tech_shipyard_1', 'tech_shipyard_2', 'tech_energy_1',
  'tech_energy_2', 'tech_reactor_1', 'tech_reactor_2', 'tech_reactor_3', 'tech_fuelcell_1',
  'tech_shield_1', 'tech_shield_2', 'tech_heat_1', 'tech_bio_1', 'tech_bio_2',
  'tech_med_1', 'tech_computing_1', 'tech_science_2', 'tech_science_3', 'tech_sensors_1',
  'tech_sensors_2', 'tech_ai_1', 'tech_ai_2', 'tech_ewar_1', 'tech_ewar_2',
  'tech_quantum_1', 'tech_signal_decipher', 'tech_survey_1', 'tech_kinetic_1', 'tech_kinetic_2',
  'tech_laser_1', 'tech_laser_2', 'tech_particle_1', 'tech_plasma_1', 'tech_missile_1',
];
const MISSIONS = 5; // gmt_relic_survey：ancientData +4/次 → 20
const YEAR_TICKS = 8640;

export class Milestone4Victory {
  constructor(ctx) { this.ctx = ctx; }

  async execute() {
    const world = this.ctx.world;
    const pid = world.playerFactionId;

    // 1. 殖民地实验室（科研速率 1 + 1.5×labs /h）
    let labs = 0;
    for (const colony of Object.values(world.entities.colonies).filter((c) => c.factionId === pid)) {
      const r = await cmd(world, 'BuildOnColony', { colonyId: colony.id, defId: 'bld_lab' }, pid);
      if (r.ok) labs++;
    }

    // 2. 科技队列首补（8 上限；拓扑序，队列耗尽前周期性续补）
    await this.topUpQueue(world, pid);

    // 3. 5×遗迹调查任务（与世界 tick 并行：任务推演独立于战略时钟）。
    //    站点可达性因种子/星系规模而异——任务失败（卡滞/小队覆没）时
    //    abortMission 换下一候选行星重试（官方中止通道，无奖励无副作用）。
    const candidates = Object.values(world.entities.planets)
      .filter((p) => p.primaryThemeId && p.category !== 'gasGiant')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    assert(candidates.length > 0, '无候选任务行星');
    let done = 0;
    let ci = 0;
    const failures = [];
    const missionT0 = performance.now();
    while (done < MISSIONS && ci < candidates.length) {
      const planetId = candidates[ci].id;
      ci++;
      const chars = Object.values(world.entities.characters)
        .filter((c) => c.factionId === pid).slice(0, 2).map((c) => c.id);
      const r = await cmd(world, 'BeginGroundMission', {
        templateId: 'gmt_relic_survey', planetId, squadCharacterIds: chars,
      }, pid);
      if (!r.ok) { failures.push(`${planetId}:${r.code}`); continue; }
      const mission = activeMissionOf(world, planetId);
      assert(mission, `任务实体缺失 @${planetId}`);
      const drive = await driveMissionToCompletion(
        world, mission, pid, 4000, { field: getMissionField(world, planetId) },
      );
      if (drive.status === 'success') {
        done++;
      } else {
        failures.push(`${planetId}:${drive.status}(${drive.steps}步)`);
        await cmd(world, 'AbortGroundMission', { missionId: mission.id }, pid);
      }
    }
    this.telemetry = { missionsMs: performance.now() - missionT0, missionAttempts: ci };
    assert(done >= MISSIONS,
      `遗迹任务仅 ${done}/${MISSIONS} 达成（候选 ${candidates.length}，失败: ${failures.slice(0, 4).join('; ')}）`);
    assert(balance(world, pid, 'ancientData') >= 20,
      `ancientData ${balance(world, pid, 'ancientData')} < 20（${MISSIONS} 次遗迹调查）`);

    // 4. 推进至第 1 年结算（队列续补 + 第二研究槽并行）
    //    性能口径：topUpQueue 经命令总线派发（每命令全宇宙事务快照）——仅在
    //    队列将耗尽时续补（<2），否则 6,000+ tick 的逐 30 日续补会成为
    //    doc28 §5.2 30s 门禁的主要超时源。
    const yearT0 = performance.now();
    let guard = 0;
    while (world.tick < YEAR_TICKS && guard++ < 20000) {
      await advance(world, 30);
      const rs = world.research[pid];
      if (rs.queue.length < 2) await this.topUpQueue(world, pid);
      if (rs.active.length < 2 && rs.queue.length > 0) {
        const next = rs.queue[0];
        const r = await cmd(world, 'StartResearch', { techId: next }, pid);
        if (r.ok) { /* 双槽并行 */ } else { await cmd(world, 'QueueResearch', { techId: next }, pid); }
      }
    }
    this.telemetry.yearMs = performance.now() - yearT0;
    assert(world.tick >= YEAR_TICKS, `年度结算未抵达（tick ${world.tick}）`);

    // 5. 胜利断言（world.victory.ended 真实口径）
    const victory = world.victory;
    assert(victory && victory.ended, `第 1 年结算未达成胜利（routes=${JSON.stringify(victory && victory.routes).slice(0, 200)}）`);
    assertEq(victory.ended.routeId, 'tech', '胜利路线非科技跃迁');
    assert(balance(world, pid, 'ancientData') >= 20, '胜利时 ancientData 不足');

    // 6. 编年史闭环 + 成就结算
    const chron = assertChronicleShape(world, 4);
    assert(chron.some((e) => e.type === 'victory'), '编年史缺胜利封存条目');
    assert(world.achievements && Object.keys(world.achievements).length > 0, '年度成就结算为空');

    await assertWorldHealthy(world, 'M4');
    return {
      success: true,
      detail: `科技跃迁胜利：${(world.research[pid].completed || []).length} 项科技完成（任务 ${this.telemetry.missionsMs.toFixed(0)}ms/${this.telemetry.missionAttempts} 次尝试 + 年推 ${this.telemetry.yearMs.toFixed(0)}ms）· ancientData ${balance(world, pid, 'ancientData')} · ` +
        `ending=${victory.ended.endingId} @tick${victory.ended.tick} · 编年史 ${chron.length} 条 · 成就 ${Object.keys(world.achievements).length} 项`,
    };
  }

  /** 队列续补：按计划序填入未完成且队列外/未激活的科技（≤8） */
  async topUpQueue(world, pid) {
    const rs = world.research[pid];
    const done = new Set([...(rs.completed || []), ...rs.active.map((a) => a.techId), ...rs.queue]);
    for (const techId of TECH_PLAN) {
      if (rs.queue.length >= 8) break;
      if (done.has(techId)) continue;
      done.add(techId);
      await cmd(world, 'QueueResearch', { techId }, pid);
    }
  }
}
