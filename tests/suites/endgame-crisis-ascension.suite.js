/**
 * tests/suites/endgame-crisis-ascension.suite.js — PLAYTEST-GATE-14（doc35 §4；SPEC-PLAN-035）
 *
 * CRISIS-HUB-01：维度固定锚全存 → 裂隙传送门无敌（伤害恒 0）；拔除全部锚点后方可击破
 * CRISIS-COUNCIL-02：紧急事态 → 监护人选举 → gdfPool 整编星海联军
 * VICTORY-ASCEND-03：视界之针 3 殖民地意识拓印 → 驶入黑洞 → endingId=cosmogenesis + 编年史闭环
 * 红线：金快照 8be8ce2c 零漂移（本套件全部走命令驱动，不触碰未启用特性的世界）
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { credit } from '../../src/domain/economy/ledger.js';
import {
  enableCrisisV2, deployCrisisHubs, crisisNexusInvulnerable,
  applyCrisisStationDamage, triggerGalacticEmergency, ASCENSION_DEFS,
} from '../../src/domain/events/crisis.js';
import { grantPrecursorClue } from '../../src/domain/exploration/precursorDag.js';
import { PRECURSORS } from '../../src/content/precursors.js';

export const suite = {
  id: 'ENDGAME-V2',
  tier: 4,
  name: '终局 v2：天灾空间枢纽 / 统战监护人 / 四维飞升（GATE-14）',
  group: 'endgame',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const fid = world.playerFactionId;

    // —— 危机实体（真实危机状态机产物；crisisMonthly 触发口径由既有套件覆盖） ——
    const crisis = createEntity(world, 'crises', {
      kind: 'crisis_rift',
      nameZh: '弦裂高维吞噬者',
      descZh: 'GATE-14 驱动危机',
      phase: 'outbreak',
      progress: 45,
      status: 'active',
      startedTick: world.tick,
      contributed: {},
      threatSystemIds: [],
    });
    enableCrisisV2(world);
    if (world.crisisV2 !== true) return { ok: false, detail: 'crisisV2 旗标未置位' };

    // —— CRISIS-HUB-01：空间枢纽布设 → 主脑无敌 → 逐一拔除 → 可击破 ——
    deployCrisisHubs(world, crisis);
    if (!crisis.hubStationIds || crisis.hubStationIds.length !== 4) {
      return { ok: false, detail: `维度固定锚数量 ${crisis.hubStationIds?.length} ≠ 4` };
    }
    if (!crisisNexusInvulnerable(world, crisis)) return { ok: false, detail: '锚点全存时主脑未进入无敌态' };
    const nexus = world.entities.stations[crisis.nexusStationId];
    const hpBefore = nexus.hp;
    const dealt = applyCrisisStationDamage(world, crisis, nexus, 9999);
    if (dealt !== 0 || nexus.hp !== hpBefore) {
      return { ok: false, detail: `无敌态主脑承受伤害：dealt=${dealt} hp ${hpBefore}→${nexus.hp}（CRISIS-HUB-01 前半失效）` };
    }
    // 拔除全部锚点（真实战果入账通道）
    for (const hid of crisis.hubStationIds.slice()) {
      const hub = world.entities.stations[hid];
      applyCrisisStationDamage(world, crisis, hub, 99999);
    }
    if (crisisNexusInvulnerable(world, crisis)) return { ok: false, detail: '锚点拔除后主脑仍无敌' };
    const dealt2 = applyCrisisStationDamage(world, crisis, nexus, 99999);
    if (nexus.hp !== 0) return { ok: false, detail: `锚点拔除后主脑仍未被击破（hp=${nexus.hp}，dealt=${dealt2}）` };

    // —— CRISIS-COUNCIL-02：紧急事态 → 监护人选举 → GDF 整编 ——
    triggerGalacticEmergency(world, crisis);
    const council = world.galacticCouncil;
    if (!council?.active) return { ok: false, detail: '紧急事态未激活统战理事会' };
    if (!council.emergencyDirectives.includes('dir_open_borders')) return { ok: false, detail: '《全星海戒严与无障碍通行令》未生效' };
    credit(world, fid, 'credits', 50000, 'gate14Setup', crisis.id);
    const rProp = executeCommand(world, { type: 'ProposeSenateResolution', actorId: fid, params: {} });
    if (!rProp.ok) return { ok: false, detail: `ProposeSenateResolution 被拒：${rProp.reason}` };
    if (council.custodianFactionId !== fid) {
      return { ok: false, detail: `监护人选举异常：${council.custodianFactionId} ≠ 玩家（动议 +250 信任票口径失效）` };
    }
    credit(world, fid, 'alloy', 5000, 'gate14GDF', crisis.id);
    const rMuster = executeCommand(world, { type: 'MusterGalacticDefenseForce', actorId: fid, params: {} });
    if (!rMuster.ok) return { ok: false, detail: `MusterGalacticDefenseForce 被拒：${rMuster.reason || JSON.stringify(rMuster)}` };
    const gdfFleetId = council.unitedFleetIds[council.unitedFleetIds.length - 1];
    const gdfFleet = gdfFleetId ? world.entities.fleets[gdfFleetId] : null;
    if (!gdfFleet || !gdfFleet.isUnitedFrontFleet || gdfFleet.shipIds.length === 0) {
      return { ok: false, detail: '星海联军特遣队未整编或空编' };
    }
    if (!world.narrative.flags) void 0;

    // —— VICTORY-ASCEND-03：宇宙创生飞升闭环 ——
    const ascDef = ASCENSION_DEFS.ascension_mind_transcendence;
    if (!ascDef) return { ok: false, detail: '宇宙创生飞升定义缺失' };
    // 阶段 1：先驱者破译（6 线索 → 母星揭示）
    const civ = PRECURSORS[0];
    for (let bit = 0; bit < 6; bit++) grantPrecursorClue(world, civ.id, fid, bit);
    // 阶段 2：45 项科技（直接置研究态——研究管线由既有套件覆盖）
    world.research[fid] ||= { completed: [], current: null };
    world.research[fid].completed = Array.from({ length: 45 }, (_, i) => `tech_gate14_${i}`);
    // 阶段 3：三殖民地意识拓印（命令子动作）
    let colonies = Object.values(world.entities.colonies).filter((c) => c.factionId === fid);
    // starter 局仅 1 殖民地：补建 2 个拓印目标（真实实体；FoundOutpost 命令链路由既有套件覆盖）
    while (colonies.length < 3) {
      const pl = Object.values(world.entities.planets).find((pp) =>
        !Object.values(world.entities.colonies).some((cc) => cc.planetId === pp.id));
      if (!pl) break;
      colonies.push(createEntity(world, 'colonies', { planetId: pl.id, factionId: fid, foundedTick: world.tick }));
      colonies = Object.values(world.entities.colonies).filter((cc) => cc.factionId === fid);
    }
    if (colonies.length < 3) return { ok: false, detail: `玩家殖民地 ${colonies.length} < 3（拓印前提缺失）` };
    for (const c of colonies) {
      const r = executeCommand(world, { type: 'ExecuteAscensionProject', actorId: fid, params: { pathId: 'ascension_mind_transcendence', imprintColonyId: c.id } });
      if (!r.ok) return { ok: false, detail: `意识拓印被拒（${c.id}）：${r.reason}` };
    }
    // 终段：视界之针驶入黑洞
    const bhSys = Object.values(world.entities.systems).find((s) => s.star?.typeId === 'blackHole');
    if (!bhSys) return { ok: false, detail: '银河内无黑洞星系（飞升终段前提缺失）' };
    const rAsc = executeCommand(world, { type: 'ExecuteAscensionProject', actorId: fid, params: { pathId: 'ascension_mind_transcendence', blackHoleSystemId: bhSys.id } });
    if (!rAsc.ok) return { ok: false, detail: `黑洞跃迁飞升被拒：${rAsc.reason}` };
    if (world.victory.ended?.endingId !== 'cosmogenesis') {
      return { ok: false, detail: `胜利终局异常：${JSON.stringify(world.victory.ended)} ≠ cosmogenesis` };
    }
    const chronicleVictory = (world.events.chronicle || []).filter((e) => e.type === 'victory');
    if (chronicleVictory.length === 0) return { ok: false, detail: '编年史胜利条目缺失（叙事闭环断裂）' };

    return {
      ok: true,
      detail: `枢纽无敌→拔除→击破闭环 · 监护人 ${council.custodianFactionId} · GDF ${gdfFleet.shipIds.length} 舰 · endingId=cosmogenesis · 编年史 +${chronicleVictory.length}`,
      hash: `end hub${crisis.hubStationIds.length} end${world.victory.ended.endingId}`,
    };
  },
};
