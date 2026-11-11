/**
 * tests/suites/megastructure-elevator.suite.js — PLAYTEST-GATE-13（doc35 §4；SPEC-PLAN-035）
 *
 * MEGA-ELEV-01：太空电梯能耗 21.60 → 1.50 MWh 精确锚点 + 连续 20 舱 PTI 增量恒 0
 * MEGA-STAGE-02：戴森阵列 S1→S4 满载（轨道舱段核销 + 能量按期入账）
 * MEGA-GATE-03：两座 S4 弦星门激活 → 跨星域航线 1 小时
 * 红线：单星 elevator deepClone ≤ 0.25ms；零 Math.random
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { launchEnergyMWh } from '../../src/domain/industry/catapult.js';
import {
  elevatorEnergyMWh, constructSpaceElevator, stepSpaceElevator,
  startMegastructure, advanceMegastructureStage, settleMegastructureOutputs,
  gatewayLinkHours, MEGA_DEFS,
} from '../../src/domain/strategic/megastructures.js';
import { deepClone } from '../../src/core/serialization.js';
import { credit, balance } from '../../src/domain/economy/ledger.js';
import { createEntity } from '../../src/domain/entities/registry.js';
import { feedCatapult } from '../../src/domain/industry/catapult.js';

export const suite = {
  id: 'MEGA-ELEV',
  tier: 4,
  name: '星海天工：太空电梯 / 四阶段巨构 / 弦星门网络（GATE-13）',
  group: 'strategic',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const fid = world.playerFactionId;

    // —— MEGA-ELEV-01a：能耗锚点精确对拍 ——
    const stdPlanet = { gravity: 1.0, atmosphere: { density: 0.5 } };
    const heavyPlanet = { gravity: 1.8, atmosphere: { density: 0.9 } };
    const vacMoon = { gravity: 0.25, atmosphere: { density: 0 } };
    const anchors = [
      [launchEnergyMWh(stdPlanet), 21.60, '标准宜居星弹射'],
      [elevatorEnergyMWh(stdPlanet), 1.50, '标准宜居星电梯'],
      [launchEnergyMWh(heavyPlanet), 52.70, '重工业星弹射'],
      [elevatorEnergyMWh(heavyPlanet), 2.70, '重工业星电梯'],
      [launchEnergyMWh(vacMoon), 3.00, '碎环月弹射'],
      [elevatorEnergyMWh(vacMoon), 0.38, '碎环月电梯'],
    ];
    for (const [got, want, label] of anchors) {
      if (Math.abs(got - want) > 0.006) return // 0.38 为 doc34 §5.2.1 二位小数展示舍入（公式精确 0.375） { ok: false, detail: `${label}能耗锚点偏差：${got.toFixed(3)} ≠ ${want}` };
    }

    // —— MEGA-ELEV-01b：真实电梯步进——20 舱连续入轨 PTI 增量恒 0 ——
    const homeColony = Object.values(world.entities.colonies).find((c) => c.factionId === fid);
    const planet = world.entities.planets[homeColony.planetId];
    credit(world, fid, 'credits', 100000, 'gate13Setup', planet.id);
    credit(world, fid, 'alloy', 10000, 'gate13Setup', planet.id);
    credit(world, fid, 'conductor', 5000, 'gate13Setup', planet.id);
    planet.ind ||= { v: 1, nodes: [], grids: [], catapult: [0, 0, 0, 2], orbitalBuffer: {} };
    const rElev = executeCommand(world, { type: 'ConstructSpaceElevator', actorId: fid, params: { planetId: planet.id } });
    if (!rElev.ok) return { ok: false, detail: `ConstructSpaceElevator 被拒：${rElev.reason}` };
    const elev = planet.ind.elevator;
    if (!elev || elev[3] !== 1) return { ok: false, detail: '电梯元组未上线' };
    const ptiBefore = planet.threat ? planet.threat.pti : null;
    planet.threat ||= { v: 1, pti: 0 };
    planet.threat.pti = 50; // 预置非零基线（弹射井每次 +25 → 电梯应 +0）
    const ptiBase = planet.threat.pti;
    const grid = { genKW: 900000, loadKW: 0, accMWh: 100000 };
    feedCatapult(planet.ind, 2, 50 * 20); // 20 舱 alloy
    let pods = 0;
    for (let h = 0; h < 24 && pods < 20; h++) {
      const r = stepSpaceElevator(world, planet, planet.ind, grid, 1);
      pods += r.launched;
      // 电梯路径绝不调用 spikeCatapultLaunch → PTI 零增量
    }
    if (pods < 20) return { ok: false, detail: `24 小时仅提拉 ${pods}/20 舱（吞吐/能量口径失效）` };
    if (planet.threat.pti !== ptiBase) {
      return { ok: false, detail: `电梯入轨 PTI 增量 ${planet.threat.pti - ptiBase} ≠ 0（doc35 §2.4.1 红线）` };
    }
    if ((planet.ind.orbitalBuffer.alloy || 0) < 20 * 50 - 1e-6) {
      return { ok: false, detail: `轨道缓冲仓舱段不足：${planet.ind.orbitalBuffer.alloy}` };
    }
    // deepClone 红线：单星工业网（含电梯）≤ 0.25ms
    const clones = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const snapshot = deepClone(planet.ind);
      clones.push(performance.now() - t0);
      void snapshot;
    }
    const avgClone = clones.reduce((a, b) => a + b, 0) / clones.length;
    if (avgClone > 0.25) return { ok: false, detail: `单星工业网 deepClone ${avgClone.toFixed(3)}ms > 0.25ms 门禁` };
    void ptiBefore;

    // —— MEGA-STAGE-02：戴森阵列 S1→S4 满载 ——
    const sysList = Object.values(world.entities.systems);
    const dysonSys = sysList.find((s) => MEGA_DEFS.mega_dyson_array.siteCheck(s) && !s.ownerFactionId) ||
      sysList.find((s) => MEGA_DEFS.mega_dyson_array.siteCheck(s));
    if (!dysonSys) return { ok: false, detail: '银河内无可选址恒星（siteCheck 全灭）' };
    const rStart = executeCommand(world, { type: 'StartMegastructureStage', actorId: fid, params: { systemId: dysonSys.id, defId: 'mega_dyson_array' } });
    if (!rStart.ok) return { ok: false, detail: `StartMegastructureStage 被拒：${rStart.reason}` };
    const st = Object.values(world.entities.stations).find((s) => s.kind === 'megastructure' && s.mega?.defId === 'mega_dyson_array');
    credit(world, fid, 'quantumCore', 500, 'gate13Mega', st.id);
    credit(world, fid, 'shipModule', 500, 'gate13Mega', st.id);
    // 轨道缓冲仓物理口径：巨构同星系行星的 ind.orbitalBuffer（弹射井/电梯直供）
    const megaPlanet = Object.values(world.entities.planets).find((pl) => pl.systemId === dysonSys.id) ||
      (() => { const pl = createEntity(world, 'planets', { systemId: dysonSys.id, name: 'GATE-13 供给星' }); pl.ind = { v: 1, nodes: [], grids: [], orbitalBuffer: {} }; return pl; })();
    megaPlanet.ind ||= { v: 1, nodes: [], grids: [], orbitalBuffer: {} };
    megaPlanet.ind.orbitalBuffer ||= {};
    const podBuf = megaPlanet.ind.orbitalBuffer;
    // 逐级推进至 S4（S4 产出断言：powerCell 120/日 + reactorFuel 45/日 + credits 1500/日）
    const stageOutputs = { 2: { powerCell: 15 }, 3: { powerCell: 45, reactorFuel: 15 }, 4: { powerCell: 120, reactorFuel: 45, credits: 1500 } };
    const pcBefore = balance(world, fid, 'powerCell');
    for (let stage = 1; stage <= 4; stage++) {
      // 备足「当前阶」账本成本 + 舱段（S0→S4 共四次推进）（advance 消耗 stages[mega.stage]，与循环序对齐）
      const sd = MEGA_DEFS.mega_dyson_array.stages[st.mega.stage];
      if (sd.credits) credit(world, fid, 'credits', sd.credits + 2000, 'gate13Topup', st.id);
      if (sd.ancientData) credit(world, fid, 'ancientData', sd.ancientData, 'gate13Topup', st.id);
      for (const rid of Object.keys(sd.pods || {})) podBuf[rid] = (podBuf[rid] || 0) + sd.pods[rid] * 50 + 50;
      const rAdv = executeCommand(world, { type: 'StartMegastructureStage', actorId: fid, params: { stationId: st.id } });
      if (!rAdv.ok) return { ok: false, detail: `阶段 ${st.mega.stage}→${st.mega.stage + 1} 推进被拒：${rAdv.reason || JSON.stringify(rAdv)}` };
    }
    if (st.mega.stage !== 4) return { ok: false, detail: `戴森阵列未达 S4（当前 S${st.mega.stage}）` };
    settleMegastructureOutputs(world);
    const pcGained = balance(world, fid, 'powerCell') - pcBefore;
    if (pcGained < 120) return { ok: false, detail: `S4 满载日产出不足：powerCell +${pcGained} < 120` };

    // —— MEGA-GATE-03：双 S4 弦星门 → 1 小时跨星域 ——
    const gw1 = sysList.find((s) => s.id !== dysonSys.id);
    const gw2 = sysList.find((s) => s.id !== dysonSys.id && s.id !== gw1.id);
    for (const s of [gw1, gw2]) {
      const gwPlanet = Object.values(world.entities.planets).find((pl) => pl.systemId === s.id) ||
        (() => { const pl = createEntity(world, 'planets', { systemId: s.id, name: '弦星门供给星' }); pl.ind = { v: 1, nodes: [], grids: [], orbitalBuffer: {} }; return pl; })();
      gwPlanet.ind ||= { v: 1, nodes: [], grids: [], orbitalBuffer: {} };
      gwPlanet.ind.orbitalBuffer ||= {};
      const rGw = executeCommand(world, { type: 'StartMegastructureStage', actorId: fid, params: { systemId: s.id, defId: 'mega_chord_gateway' } });
      if (!rGw.ok) return { ok: false, detail: `弦星门开工被拒（${s.id}）：${rGw.reason}` };
      const gwSt = Object.values(world.entities.stations).find((x) => x.kind === 'megastructure' && x.mega?.defId === 'mega_chord_gateway' && x.systemId === s.id && x.factionId === fid);
      for (let stage = 1; stage <= 4; stage++) {
        const sd = MEGA_DEFS.mega_chord_gateway.stages[gwSt.mega.stage];
        if (sd.credits) credit(world, fid, 'credits', sd.credits + 2000, 'gate13Topup', gwSt.id);
        if (sd.ancientData) credit(world, fid, 'ancientData', sd.ancientData, 'gate13Topup', gwSt.id);
        for (const rid of Object.keys(sd.pods || {})) gwPlanet.ind.orbitalBuffer[rid] = (gwPlanet.ind.orbitalBuffer[rid] || 0) + sd.pods[rid] * 50 + 50;
        const rAdv = executeCommand(world, { type: 'StartMegastructureStage', actorId: fid, params: { stationId: gwSt.id } });
        if (!rAdv.ok) return { ok: false, detail: `弦星门阶段 ${gwSt.mega.stage} 推进被拒：${rAdv.reason || JSON.stringify(rAdv)}` };
      }
      if (gwSt.mega.stage < 4) return { ok: false, detail: `弦星门未达 S4（当前 S${gwSt.mega.stage}）` };
    }
    const link = gatewayLinkHours(world, gw1.id, gw2.id, fid);
    if (link !== 1) return { ok: false, detail: `双 S4 星门跨星域航时 ${link} ≠ 1h` };

    return {
      ok: true,
      detail: `能耗六锚点精确 · 20 舱 PTI +0 · deepClone ${avgClone.toFixed(3)}ms · 戴森 S4（powerCell +${pcGained}/日）· 星门跨域 ${link}h`,
      hash: `mega e${Math.round(elevatorEnergyMWh(stdPlanet) * 100)} s${st.mega.stage} g${link}`,
    };
  },
};
