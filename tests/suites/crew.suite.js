/**
 * tests/suites/crew.suite.js — 人物系统（任务书 5.8）
 * 经验/升级/特质、舰船损失命运结算幂等、指派命令、舰队加成。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';
import { gainXp, assignToFleet, fleetCommanderBonus, onShipDestroyed, crewView } from '../../src/domain/characters/crew.js';
import { executeCommand } from '../../src/core/commandBus.js';
import '../../src/app/commands.js';

export const suite = {
  id: 'CREW-01',
  name: '船员人物系统',
  group: 'characters',
  async run() {
    const world = createStarterCampaign({ seed: 31 });
    const pid = world.playerFactionId;
    const chars = Object.values(world.entities.characters).filter((c) => c.factionId === pid);
    if (chars.length < 3) return { ok: false, detail: `初始人物不足：${chars.length}` };

    // 经验/升级
    const c = chars[0];
    const lv0 = c.level;
    gainXp(world, c.id, 150, 'test');
    if (c.level !== lv0 + 1) return { ok: false, detail: `经验升级失败 ${lv0}→${c.level}` };

    // 指派（命令总线）
    const fleet = Object.values(world.entities.fleets).find((f) => f.factionId === pid);
    const free = chars.find((x) => x.id !== c.id && x.health === 'healthy');
    const r = executeCommand(world, { type: 'AssignCharacter', actorId: pid, params: { characterId: free.id, fleetId: fleet.id } });
    if (!r.ok) return { ok: false, detail: `任命失败：${r.reason}` };
    if (world.entities.fleets[fleet.id].commanderId !== free.id) return { ok: false, detail: 'commanderId 未回写' };

    // 加成
    const bonus = fleetCommanderBonus(world, world.entities.fleets[fleet.id]);
    if (!bonus || bonus.level < 1) return { ok: false, detail: '指挥官加成缺失' };

    // 命运结算幂等：同一舰船重复销毁只结算一次
    const ship = Object.values(world.entities.ships).find((s) => s.factionId === pid && s.fleetId === fleet.id);
    onShipDestroyed(world, ship);
    const histLen = world.entities.characters[free.id].history.length;
    onShipDestroyed(world, ship); // ship 已 destroyed，二次不重复
    const healths = ['dead', 'wounded', 'missing'];
    const after = world.entities.characters[free.id];
    if (healths.includes(after.health) && after.history.length > histLen) {
      return { ok: false, detail: '命运结算不幂等（重复追加）' };
    }

    // 长期稳定性
    advanceTicks(world, 4320);
    const inv = checkWorldInvariants(world);
    if (inv.length > 0) return { ok: false, detail: inv.slice(0, 2).join(';') };
    const view = crewView(world, pid);
    if (view.length === 0) return { ok: false, detail: 'crewView 为空' };
    return { ok: true };
  },
};
