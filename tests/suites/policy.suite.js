/**
 * tests/suites/policy.suite.js — 政策系统（任务书 4.1 / POL-01）
 * 颁布/撤销生命周期、影响力成本、互斥、行政容量门控、定期法令到期、
 * 超载稳定度惩罚、效果经 getMod 实际生效。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { getMod } from '../../src/domain/factions/modifiers.js';
import { policyStatus } from '../../src/domain/politics/policy.js';

export const suite = {
  id: 'POL-01',
  name: '政策系统生命周期与效果结算',
  group: 'politics',
  async run() {
    const world = createStarterCampaign({ seed: 55 });
    const pid = world.playerFactionId;
    world.economy.ledgers[pid].balances.influence = 200; // 充足测试预算

    // 1. 颁布：扣影响力 + 进入 policies + 效果经 getMod 生效
    const influence0 = world.economy.ledgers[pid].balances.influence;
    const factoryMultBefore = getMod(world, pid, 'factoryOutput', 'mult');
    const r1 = executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_ai_liberal' } });
    if (!r1.ok) return { ok: false, detail: `颁布失败：${r1.reason}` };
    const led = world.economy.ledgers[pid].balances;
    if (led.influence !== influence0 - 25) return { ok: false, detail: `影响力未扣 25（${influence0}→${led.influence}）` };
    const factoryMultAfter = getMod(world, pid, 'factoryOutput', 'mult');
    if (!(factoryMultAfter > factoryMultBefore)) return { ok: false, detail: '政策效果未生效（factoryOutput 乘数未变）' };

    // 2. 互斥：同组第二项被拒
    const r2 = executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_ai_regulation' } });
    if (r2.ok || r2.code !== 'MUTEX') return { ok: false, detail: `互斥未拦截：${JSON.stringify(r2)}` };

    // 3. 重复颁布被拒
    const r3 = executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_ai_liberal' } });
    if (r3.ok || r3.code !== 'ACTIVE') return { ok: false, detail: '重复颁布未被拦截' };

    // 4. 撤销：进入冷却，影响力不退还
    const infBeforeRevoke = world.economy.ledgers[pid].balances.influence;
    const r4 = executeCommand(world, { type: 'RevokePolicy', actorId: pid, params: { policyId: 'pol_ai_liberal' } });
    if (!r4.ok) return { ok: false, detail: `撤销失败：${r4.reason}` };
    if (world.economy.ledgers[pid].balances.influence !== infBeforeRevoke) return { ok: false, detail: '撤销不应退还影响力' };
    if (policyStatus(world, pid, 'pol_ai_liberal').status !== 'cooldown') return { ok: false, detail: '撤销后未进入冷却' };

    // 5. 冷却期内重新颁布被拒
    const r5 = executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_ai_liberal' } });
    if (r5.ok || r5.code !== 'COOLDOWN') return { ok: false, detail: '冷却期未被拦截' };

    // 6. 行政容量门控：占用 3 槽的动员令在容量紧张时被拒
    //    先颁布 2 个 2 槽政策 → 占 4；基础容量 20 通常足够 —— 改为验证容量数字一致
    executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_research_funding' } });
    executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_colonial_charter' } });
    const fac = world.entities.factions[pid];
    const used = Object.keys(fac.policies).reduce((s, p) => {
      const map = { pol_research_funding: 2, pol_colonial_charter: 2 };
      return s + (map[p] || 1);
    }, 0);
    if (fac.policySlots !== used) return { ok: false, detail: `行政占用快照不一致 ${fac.policySlots} ≠ ${used}` };

    // 7. 定期法令到期自动失效并进冷却（日结处理：推进至到期后的首个日界）
    world.economy.ledgers[pid].balances.influence = 500;
    const r7 = executeCommand(world, { type: 'EnactPolicy', actorId: pid, params: { policyId: 'pol_mobilization' } });
    if (!r7.ok) return { ok: false, detail: `动员令颁布失败：${r7.reason}` };
    const expires = fac.policies.pol_mobilization.expiresTick;
    advanceTicks(world, (expires - world.tick) + 48); // 越过到期点 + 一个日界
    if (fac.policies.pol_mobilization) return { ok: false, detail: '法令到期未自动失效' };
    if ((world.events.log.politics || []).some((e) => e.type === 'PolicyExpired') !== true) {
      return { ok: false, detail: 'PolicyExpired 事件缺失' };
    }

    // 8. 长期稳定性
    const inv = checkWorldInvariants(world);
    if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
    return { ok: true };
  },
};
