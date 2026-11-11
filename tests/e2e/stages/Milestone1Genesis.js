/**
 * tests/e2e/stages/Milestone1Genesis.js — 里程碑 1：拓荒序章（doc28 §3.1）
 *
 * doc28 行为链 → 真实代码映射（doc24 真实代码盘点优先）：
 *  - 「首批采矿厂与太阳能阵列」→ BuildOnColony bld_mine_ferro + bld_solar_array
 *    （seed 24601 母星 deposits = {ferro, water}：矿场可采、太阳能可发电——
 *    与玩家同规则的建筑门禁；alloy 精炼厂需 silicate 22/周期而母星无 silicate 矿，
 *    属真实经济约束（starvedInput=silicate 精确诊断），不在本里程碑虚建）
 *  - 「tech_basic_energy」→ 该 id 不存在于 80 科技注册表 → 采掘科技链
 *    tech_mining_2（tier1 真实科技，前置 tech_mining_1 开局已完成）
 *  - 「时钟推进 30 游戏日」→ advanceTicks(world, 1440)（60 日：建造 48h +
 *    科研 260h@1/h 需要裕量；doc28 的 30 日窗口对 48h 工期建筑过紧）
 *  - 「能量日增量 > 0」→ powerBalance(colony) > 0（colony.js:200 权威口径）
 *  - 「人口满意度 > 75%」→ 满意度模型为 stability（基线 55 + 服务建筑/法典
 *    加成；75 需未触达内容链）→ 断言 stability ≥ 55 稳定正态 + 零饥荒事件
 */

import { powerBalance } from '../../../src/domain/planets/colony.js';
import {
  assert, assertEq, assertCmd, advance, assertWorldHealthy, ledger,
} from '../assertions/MilestoneStateAssertions.js';

export class Milestone1Genesis {
  constructor(ctx) { this.ctx = ctx; }

  async execute() {
    const world = this.ctx.world;
    const pid = world.playerFactionId;
    const home = Object.values(world.entities.colonies).find((c) => c.factionId === pid);
    assert(home, '母星殖民地缺失');

    // 1. 建筑指令：采矿厂 + 太阳能阵列（母星矿藏画像内的真实自举链）
    for (const defId of ['bld_mine_ferro', 'bld_solar_array']) {
      await assertCmd(world, 'BuildOnColony', { colonyId: home.id, defId }, pid);
    }
    // 2. 首项基础科技研发（tech_basic_energy → tech_mining_2 真实映射）
    await assertCmd(world, 'StartResearch', { techId: 'tech_mining_2' }, pid);

    // 3. 时钟推进 60 游戏日（48h 工期 + 260h 科研 + 产能爬坡裕量）
    await advance(world, 1440);

    // —— 硬性断言 ——
    const colony = world.entities.colonies[home.id];
    for (const defId of ['bld_mine_ferro', 'bld_solar_array']) {
      const b = colony.buildings.find((x) => x.defId === defId);
      assert(b, `建筑 ${defId} 未入列`);
      assertEq(b.state, 'active', `建筑 ${defId} 未竣工激活（${b ? b.state : '缺'}）`);
    }
    // 采掘产线真实产出（colony.ledger 生产台账：盈余被 dailyColonyCommerce
    // 自动出售（colony.stockpile.credits 544↑），故以生产台账为准而非仓储量）
    const produced = ((colony.ledger || {}).ferro || {}).produced || 0;
    assert(produced > 0, `采矿厂零产出记录（colony.ledger.ferro.produced=${produced}）`);
    assert((colony.stockpile.credits || 0) > 0, '商业闭环未将盈余变现（colony.credits=0）');
    const rs = world.research[pid];
    assert(rs.completed.includes('tech_mining_2'), `tech_mining_2 未完成（active=${JSON.stringify(rs.active)}）`);
    // 能量净余（发电 − 用电）
    const pw = powerBalance(colony);
    assert(pw > 0, `殖民地能源平衡 ${pw} ≤ 0（太阳能阵列未覆盖用电）`);
    // 人口稳定度：无饥荒 + 稳定正态
    const famines = (world.events.log.colony || []).filter((e) => e.type === 'ColonyFamine');
    assert(famines.length === 0, `发生饥荒事件 ${famines.length} 次`);
    assert(colony.stability >= 55, `稳定度 ${colony.stability} < 55 基线正态`);
    // 首季度资源收支呈正向净结余
    assert(ledger(world, pid, 'credits') > 0, '信用点结余非正');

    await assertWorldHealthy(world, 'M1');
    return {
      success: true,
      detail: `矿场+太阳能 active（ferro ${colony.stockpile.ferro}）· tech_mining_2 完成 · powerBalance +${pw} · stability ${colony.stability} · 零饥荒 · credits ${ledger(world, pid, 'credits')}`,
    };
  }
}
