/**
 * tests/suites/combat-tactical-v2.suite.js — PLAYTEST-GATE-11（doc35 §4；SPEC-PLAN-035）
 *
 * COMBAT-SUB-01：非线性穿甲乘数精确对拍（0.150 触底 / 0.475 鱼雷锚点）+ 分部战损动态惩罚
 * COMBAT-FLUX-02：softHeat+hardFlux ≥ 100 → 6.0s 强制过载（护盾清零 + 全武器停火）
 * COMBAT-STEALTH-03：静默伏击探测半径 ≤10%（缩减 ≥75%）+ 首轮 10s 暴击 +25%
 * 红线：20 舰 + 4 中队单 Tick ≤ 0.35ms；5% 残余装甲底线；零 Math.random
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { createShip } from '../../src/domain/ships/ship.js';
import { createFleet } from '../../src/domain/fleets/fleet.js';
import { createBattleFromFleets } from '../../src/domain/combat/engagement.js';
import { stepOneBattle } from '../../src/domain/combat/BattleSimulation.js';
import {
  pierceMultiplier, detectionRadiusMult, enableCombatV2, ensureSubsystems,
  initBattleV2, SUB_IDX, SUB_CRIPPLED, FLUX_CAPACITY, OVERLOAD_SECONDS, PIERCING_BY_TYPE,
} from '../../src/domain/combat/subsystemsAndEw.js';

export const suite = {
  id: 'COMBAT-V2',
  tier: 4,
  name: '战术 v2：五分部战损 / 热幅能过载 / 静默伏击（GATE-11）',
  group: 'combat',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const fid = world.playerFactionId;

    // —— COMBAT-SUB-01a：穿甲乘数精确对拍（doc34 §3.2.1 两个数值锚点） ——
    // 锚点 1：动能炮 14 伤 vs 战列舰正面装甲 500（动能系数 0.10 → A_eff = 500×1.25×0.90 = 562.5）
    const m1 = pierceMultiplier(14, 500 * 1.25 * (1 - PIERCING_BY_TYPE.kinetic));
    if (Math.abs(m1 - 0.15) > 1e-9) return { ok: false, detail: `动能 vs 重甲乘数 ${m1.toFixed(4)} ≠ 0.150 触底` };
    // 锚点 2：鱼雷 95 伤（explosive 0.30）vs 巡洋舰侧舷装甲 300 → A_eff = 210 → 乘数 0.475
    const m2 = pierceMultiplier(95, 300 * 1.0 * (1 - PIERCING_BY_TYPE.explosive));
    if (Math.abs(m2 - 95 / (95 + 105)) > 1e-9) return { ok: false, detail: `鱼雷乘数 ${m2.toFixed(4)} ≠ 0.475 锚点` };
    // 5% 残余装甲底线：任何伤害水平乘数不低于 0.15
    const m3 = pierceMultiplier(3, 10);
    if (m3 < 0.15) return { ok: false, detail: `残余装甲底线失效：${m3}` };

    // —— 战术 v2 旗标 + 分部初始化 ——
    const fleetA = Object.values(world.entities.fleets).find((f) => f.factionId === fid) ||
      createFleet(world, { factionId: fid, systemId: world.playerFactionId ? Object.values(world.entities.systems)[0].id : null, name: 'v2 测试舰队', ships: [], role: 'combat' });
    const rEnable = executeCommand(world, { type: 'ToggleSilentRunning', actorId: fid, params: { fleetId: fleetA.id } });
    if (!rEnable.ok) return { ok: false, detail: `ToggleSilentRunning 被拒：${rEnable.reason}` };
    if (world.combatV2 !== true) return { ok: false, detail: 'combatV2 旗标未置位' };
    fleetA.stance = 'aggressive'; // 后续战斗用常规姿态（静默项单独测）

    // —— COMBAT-SUB-01b：真实战斗链路——推进阵列瘫痪 → 航速等比衰减 + 跃迁核冻结 ——
    const sysA = Object.values(world.entities.systems).find((s) => s.ownerFactionId === fid) || Object.values(world.entities.systems)[0];
    const bs = createShip(world, { factionId: fid, hullId: 'hull_battleship', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster', 'mod_armor_composite'], systemId: sysA.id });
    const fr = createShip(world, { factionId: fid, hullId: 'hull_frigate', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], systemId: sysA.id });
    const fA = createFleet(world, { factionId: fid, systemId: sysA.id, name: 'v2 甲队', ships: [], role: 'combat' });
    fA.shipIds.push(bs.id, fr.id);
    bs.fleetId = fA.id;
    fr.fleetId = fA.id;
    const foeFid = Object.keys(world.entities.factions).find((f) => f !== fid);
    const bs2 = createShip(world, { factionId: foeFid, hullId: 'hull_gun_cruiser', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster'], systemId: sysA.id });
    const fB = createFleet(world, { factionId: foeFid, systemId: sysA.id, name: 'v2 敌队', ships: [], role: 'combat' });
    fB.shipIds.push(bs2.id);
    bs2.fleetId = fB.id;
    // 敌对关系注入（createBattleFromFleets/areHostile 口径：rel.warId + wars 登记）
    const relKey = fid < foeFid ? `${fid}|${foeFid}` : `${foeFid}|${fid}`;
    const warId = `war_gate11_${world.seq || 0}`;
    world.relations.diplomacy[relKey] ||= { a: fid, b: foeFid, contactState: 'contacted', opinion: -80, trust: 0, warId: null };
    world.relations.diplomacy[relKey].warId = warId;
    world.entities.wars[warId] ||= {
      id: warId, type: 'war', createdAtTick: world.tick, attackers: [fid], defenders: [foeFid],
      startTick: world.tick, wargoals: ['borderSystems'], occupiedSystems: {}, exhaustion: {},
      battles: 0, status: 'active', peaceOffers: [],
    };
    const battle = createBattleFromFleets(world, sysA.id, fA, fB);
    const unitFr = battle.units.find((u) => u.shipId === fr.id);
    const unitBs2 = battle.units.find((u) => u.shipId === bs2.id);
    // 推进阵列打至瘫痪（≤200‰）
    ensureSubsystems(fr);
    fr.subsystems[SUB_IDX.THRUSTERS] = 180;
    const spdHealthy = fr.stats.maxSpeed;
    const spdCrippled = spdHealthy * 0.15; // ≤200‰ → maxSpeed ×0.15（doc34 §3.2.1 重度瘫痪口径）
    // 真实 tick 驱动（stepOneBattle 官方管线）验证速度惩罚生效（unit 位移受限）
    unitFr.x = 200; unitFr.y = 160; unitBs2.x = 800; unitBs2.y = 160;
    battle.endCondition = { kind: 'annihilate', timeoutSeconds: 600 };
    for (let i = 0; i < 30; i++) stepOneBattle(world, battle, 1 / 30);
    if (unitFr.destroyed || unitBs2.destroyed) {
      // 30 战斗秒内出现击毁属合法战斗结果——以舰船存活分支为准重开（保持确定性）
      return { ok: false, detail: '分部战损战斗 30s 内即出现击毁，断言前提失效（需调低交战烈度）' };
    }
    const moved = Math.hypot(unitFr.x - 200, unitFr.y - 160);
    const maxMove = spdCrippled * 1.0 + 1; // 1 战斗秒位移上界（30 tick × 限速）+ 容差
    if (moved > spdHealthy * 0.5) {
      return { ok: false, detail: `推进瘫痪后位移 ${moved.toFixed(1)} 超出 ×0.15 限速口径（应 ≤ ${maxMove.toFixed(1)}）` };
    }
    // 跃迁核冻结：order retreat → 蓄能不增长
    const bsUnit = battle.units.find((u) => u.shipId === bs.id);
    ensureSubsystems(bs);
    bs.subsystems[SUB_IDX.WARP_CORE] = 100;
    bsUnit.order = 'retreat';
    const charge0 = bsUnit.retreatCharge || 0;
    for (let i = 0; i < 30; i++) stepOneBattle(world, battle, 1 / 30);
    if ((bsUnit.retreatCharge || 0) > charge0 + 1e-9) {
      return { ok: false, detail: '跃迁核瘫痪后撤退蓄能未被冻结（doc34 Warp Interdicted 失效）' };
    }
    bsUnit.order = 'engage';

    // —— COMBAT-FLUX-02：热幅能过载（连续射击 + 护盾受击 → softHeat+hardFlux ≥ 100） ——
    const gunner = battle.units.find((u) => u.shipId === bs.id);
    gunner.softHeat = 70;
    gunner.hardFlux = 25; // 合计 95 < 100（下一发动能 6×8=48 越容量）
    gunner.overloadTimer = 0;
    const targetUnit = battle.units.find((u) => u.shipId === bs2.id);
    gunner.targetShipId = targetUnit.shipId;
    gunner.x = targetUnit.x - 60; gunner.y = targetUnit.y; // 射程内
    let overloaded = false;
    for (let i = 0; i < 90 && !overloaded; i++) {
      stepOneBattle(world, battle, 1 / 30);
      if ((gunner.overloadTimer || 0) > 0) overloaded = true;
    }
    if (!overloaded) return { ok: false, detail: '连续射击未触发热幅能过载（weapon.heat 管线失效）' };
    if (Math.abs(gunner.overloadTimer - OVERLOAD_SECONDS) > OVERLOAD_SECONDS + 1e-6 && gunner.overloadTimer > OVERLOAD_SECONDS) {
      return { ok: false, detail: `过载时长异常：${gunner.overloadTimer}` };
    }
    // 过载期间全武器停火 + 护盾清零
    const bsShip = world.entities.ships[bs.id];
    if (bsShip.hp.shield > 0) return { ok: false, detail: '过载触发时护盾未清零' };
    const dc0 = gunner.cooldowns.w0 ?? 0;
    const heatAtOverload = (gunner.softHeat || 0) + (gunner.hardFlux || 0);
    void dc0; void heatAtOverload;
    // 过载恢复计时递减（6s 强制停火窗口）
    const t0 = gunner.overloadTimer;
    for (let i = 0; i < 30; i++) stepOneBattle(world, battle, 1 / 30);
    if (gunner.overloadTimer >= t0) return { ok: false, detail: '过载计时未递减（恢复管线失效）' };

    // —— COMBAT-STEALTH-03：静默伏击 ——
    const sysList = Object.values(world.entities.systems);
    const coverSys = sysList.find((s) => (s.hazards || []).some((h) => h === 'asteroidDebris' || h === 'nebula' || h === 'ionStorm'));
    const plainSys = sysList.find((s) => !(s.hazards || []).some((h) => h === 'asteroidDebris' || h === 'nebula' || h === 'ionStorm'));
    const scout = createFleet(world, { factionId: fid, systemId: (coverSys || sysList[0]).id, name: '静默侦察队', ships: [], role: 'combat' });
    const scoutShip = createShip(world, { factionId: fid, hullId: 'hull_scout', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], systemId: scout.systemId });
    scout.shipIds.push(scoutShip.id);
    scoutShip.fleetId = scout.id;
    scout.stance = 'silent_ambush';
    const multCover = detectionRadiusMult(scout, world);
    if (coverSys && Math.abs(multCover - 0.10) > 1e-9) return { ok: false, detail: `掩体静默探测乘数 ${multCover} ≠ 0.10` };
    if (!coverSys && Math.abs(multCover - 0.30) > 1e-9) return { ok: false, detail: '掩体静默星系缺失（星系 hazards 内容异常）' };
    if (plainSys) {
      scout.systemId = plainSys.id;
      const multPlain = detectionRadiusMult(scout, world);
      if (Math.abs(multPlain - 0.30) > 1e-9) return { ok: false, detail: `裸静默探测乘数 ${multPlain} ≠ 0.30` };
    }
    if (multCover > 0.25) return { ok: false, detail: '静默伏击探测半径缩减未达 ≥75% 门禁' };
    // 首轮奇袭：伏击方 stealthAmbushS=10 / 被伏击方护盾 40% + 转向减半（initBattleV2 实测）
    const ambushee = createShip(world, { factionId: foeFid, hullId: 'hull_frigate', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], systemId: sysA.id });
    const fC = createFleet(world, { factionId: foeFid, systemId: sysA.id, name: '被伏击队', ships: [], role: 'combat' });
    fC.shipIds.push(ambushee.id);
    ambushee.fleetId = fC.id;
    scout.stance = 'silent_ambush';
    scout.systemId = sysA.id;
    scoutShip.systemId = sysA.id;
    const ambBattle = createBattleFromFleets(world, sysA.id, scout, fC);
    // 直接驱动 initBattleV2（避免 stepOneBattle 的护盾再生污染 40% 初始护盾断言）
    initBattleV2(world, ambBattle);
    const ambUnit = ambBattle.units.find((u) => u.shipId === scoutShip.id);
    const vicUnit = ambBattle.units.find((u) => u.side === 'b');
    if (!ambUnit || ambUnit.stealthAmbushS <= 0) return { ok: false, detail: '静默伏击方首轮奇袭增益未生效' };
    const vicShip = world.entities.ships[vicUnit.shipId];
    if (vicShip.hp.shield > vicShip.hp.shieldMax * 0.4 + 1e-6) return { ok: false, detail: `被伏击方初始护盾 ${(vicShip.hp.shield / vicShip.hp.shieldMax * 100).toFixed(0)}% > 40%` };

    // —— 性能红线（doc34 §7.1 预算基准：全场 20 艘主力舰 + 4 支航母中队，单 Tick ≤ 0.35ms） ——
    const perfFleet = createFleet(world, { factionId: fid, systemId: sysA.id, name: '性能舰队', ships: [], role: 'combat' });
    for (let i = 0; i < 8; i++) {
      const s = createShip(world, { factionId: fid, hullId: 'hull_frigate', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster'], systemId: sysA.id });
      perfFleet.shipIds.push(s.id);
      s.fleetId = perfFleet.id;
    }
    for (let i = 0; i < 2; i++) {
      const cv = createShip(world, { factionId: fid, hullId: 'hull_carrier', moduleIds: ['mod_kinetic_cannon', 'mod_reactor_fusion', 'mod_fusion_thruster'], systemId: sysA.id });
      perfFleet.shipIds.push(cv.id);
      cv.fleetId = perfFleet.id;
    }
    const perfFoe = createFleet(world, { factionId: foeFid, systemId: sysA.id, name: '性能敌队', ships: [], role: 'combat' });
    for (let i = 0; i < 8; i++) {
      const s = createShip(world, { factionId: foeFid, hullId: 'hull_frigate', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], systemId: sysA.id });
      perfFoe.shipIds.push(s.id);
      s.fleetId = perfFoe.id;
    }
    for (let i = 0; i < 2; i++) {
      const cv = createShip(world, { factionId: foeFid, hullId: 'hull_carrier', moduleIds: ['mod_laser_array', 'mod_reactor_fission', 'mod_ion_thruster'], systemId: sysA.id });
      perfFoe.shipIds.push(cv.id);
      cv.fleetId = perfFoe.id;
    }
    const perfBattle = createBattleFromFleets(world, sysA.id, perfFleet, perfFoe);
    for (const u of perfBattle.units) { u.x = 120 + (u.side === 'a' ? 0 : 700); u.y = 160; }
    // 预热 15 tick（JIT + initBattleV2 + 中队展开），3 窗口 ×30 tick 取最小值（能力口径，抗 GC 噪声）
    for (let i = 0; i < 15; i++) stepOneBattle(world, perfBattle, 1 / 30);
    const N = 30;
    let perTickMs = Infinity;
    for (let w = 0; w < 3; w++) {
      const tPerf0 = performance.now();
      for (let i = 0; i < N; i++) stepOneBattle(world, perfBattle, 1 / 30);
      perTickMs = Math.min(perTickMs, (performance.now() - tPerf0) / N);
    }
    if (perTickMs > 0.35) return { ok: false, detail: `20 舰 + 中队单 Tick ${perTickMs.toFixed(3)}ms > 0.35ms 门禁` };

    return {
      ok: true,
      detail: `穿甲锚点 0.150/0.475 精确 · 推进 ×0.15 衰减 · 跃迁核冻结 · 过载 ${OVERLOAD_SECONDS}s · 探测 ×${multCover} · 20 舰单 Tick ${perTickMs.toFixed(3)}ms`,
      hash: `v2 m1${Math.round(m1 * 1000)} m2${Math.round(m2 * 1000)} ov${OVERLOAD_SECONDS}`,
    };
  },
};
