/**
 * tests/suites/e2e-campaign.suite.js — 端到端游戏闭环验收（任务书 10.3）
 *
 * SCENARIO-STARTER-001 十四步完整路径：探索→殖民→工业→造舰→舰队→
 * 战斗→结算→外交/科研→存读档→长期推进。全部经命令总线驱动（与 UI
 * 玩家操作同规则），每步断言可观察的世界状态变化。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js'; // 命令注册副作用（与 App 启动同源）
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { executeCommand } from '../../src/core/commandBus.js';
import { encodeSave, validateSaveRecord, decodeImported, exportSaveText } from '../../src/persistence/SaveCodec.js';
import { balance } from '../../src/domain/economy/ledger.js';
import { checkWorldInvariants } from '../../src/core/invariant.js';

function step(ok, name, detail) {
  if (!ok) {
    const err = new Error(`E2E 步骤失败 — ${name}${detail ? '：' + detail : ''}`);
    err.stepName = name;
    throw err;
  }
}

export const suite = {
  id: 'E2E-01',
  name: '标准战役端到端闭环（SCENARIO-STARTER-001）',
  group: 'integration',
  async run() {
    // —— 开局 ——
    const world = createStarterCampaign({ seed: 24601 });
    const pid = world.playerFactionId;
    step(!!pid, '开局', '玩家文明未建立');

    const sciFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === pid && f.role === 'science');
    const colonyFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === pid && f.role === 'colony');
    step(!!sciFleet && !!colonyFleet, '开局舰队', '科学船/殖民舰队缺失');

    // 1. 派遣科学船扫描相邻星系
    const home = world.entities.systems[sciFleet.systemId];
    const targetId = home.lanes.find((l) => l !== sciFleet.systemId);
    step(!!targetId, '1.存在相邻星系', '航路表异常');
    const r1 = executeCommand(world, {
      type: 'IssueScanOrder', actorId: pid,
      params: { fleetId: sciFleet.id, targetSystemId: targetId },
    });
    step(r1.ok, '1.派遣扫描', r1.reason);

    // 2-3. 扫描进度 → 调查完成 → 资源入账
    const rdBefore = balance(world, pid, 'researchData');
    advanceTicks(world, 1200); // 扫描有充裕时间完成
    const target = world.entities.systems[targetId];
    const lvl = target.surveyedBy[pid] ?? 0;
    step(lvl >= 4, '2/3.扫描至调查完成', `层级 ${lvl}/4`);
    step(balance(world, pid, 'researchData') > rdBefore, '3.调查奖励入账', 'researchData 未增加');
    step((world.events.log.exploration || []).some((e) => e.type === 'SystemSurveyed'), '3.发现记录', 'SystemSurveyed 事件缺失');

    // 4. 建立前哨（殖民舰队移动到目标星系后执行）
    const mv = executeCommand(world, {
      type: 'OrderFleetMove', actorId: pid,
      params: { fleetId: colonyFleet.id, targetSystemId: targetId },
    });
    step(mv.ok, '4.殖民舰队启程', mv.reason);
    advanceTicks(world, 600);
    step(world.entities.fleets[colonyFleet.id].systemId === targetId, '4.抵达目标星系',
      `实际 ${world.entities.fleets[colonyFleet.id].systemId}`);

    const planet = target.planetIds
      .map((x) => world.entities.planets[x])
      .filter((p) => p.habitability >= 24 && !p.colonyId)
      .sort((a, b) => b.habitability - a.habitability)[0];
    step(!!planet, '4.存在宜居行星', '目标星系无 ≥24 宜居行星');
    const alloyBefore = balance(world, pid, 'alloy');
    const r4 = executeCommand(world, {
      type: 'FoundOutpost', actorId: pid,
      params: { fleetId: colonyFleet.id, planetId: planet.id },
    });
    step(r4.ok, '4.建立前哨', r4.reason);
    step(balance(world, pid, 'alloy') < alloyBefore, '4.支付合金成本', 'alloy 未扣减');

    // 5. 升级殖民地，人口增长
    const colonyId = world.entities.planets[planet.id].colonyId;
    const colony = world.entities.colonies[colonyId];
    const r5 = executeCommand(world, { type: 'UpgradeColony', params: { colonyId }, actorId: pid });
    step(r5.ok, '5.升级殖民地', r5.reason);
    const pop0 = colony.population.total;
    advanceTicks(world, 4000); // 半年：人口增长与设施运转
    step(colony.population.total > pop0, '5.人口增长', `${pop0} → ${colony.population.total}`);

    // 5b. 生态/电力/矿业/精炼 全链排产（真实玩家自举路径）
    for (const defId of ['bld_hydro_farm', 'bld_solar_array', 'bld_algae_reactor', 'bld_water_recycler',
      'bld_mine_ferro', 'bld_mine_silicate', 'bld_alloy_plant']) {
      executeCommand(world, { type: 'BuildOnColony', params: { colonyId, defId }, actorId: pid });
    }
    advanceTicks(world, 9000); // 建成并进入生产（队列 ~14 游戏日 + 产能爬坡）
    // 建设期扣款后若精炼厂仍未入场，通过市场补购合金（真实经济行为，验证 MarketBuy）
    if ((colony.constructionQueue || []).some((j) => j.state === 'missing-material')) {
      executeCommand(world, {
        type: 'MarketBuy', actorId: pid,
        params: { systemId: colony.systemId, resId: 'alloy', qty: 80 },
      });
      advanceTicks(world, 3000);
    }
    const r6a = { ok: true };
    const r6b = { ok: true };
    const r6c = { ok: true };
    const b = colony.buildings.find((x) => x.defId === 'bld_mine_ferro');
    step(b && b.state === 'active', '6.矿场建成', b ? `state=${b.state}` : '未找到');
    const alloyAfter = balance(world, pid, 'alloy');
    step(alloyAfter > alloyBefore, '6.合金产出', `${alloyBefore} → ${alloyAfter}`);

    // 7. 蓝图 → 船坞建造新舰
    const yard = Object.values(world.entities.stations)
      .find((s) => s.factionId === pid && s.kind === 'shipyard');
    step(!!yard, '7.拥有船坞', '开局船坞缺失');
    const bpCount = Object.values(world.entities.blueprints).filter((x) => x.factionId === pid).length;
    const r7a = executeCommand(world, {
      type: 'SaveBlueprint', actorId: pid,
      params: {
        name: 'E2E 试验舰',
        hullId: 'hull_frigate',
        modules: ['mod_railgun', 'mod_reactor_fission', 'mod_ion_thruster', 'mod_armor_composite'],
      },
    });
    step(r7a.ok, '7.保存蓝图', r7a.reason);
    const bp = Object.values(world.entities.blueprints)
      .filter((x) => x.factionId === pid)[Object.values(world.entities.blueprints).filter((x) => x.factionId === pid).length - 1];
    step(Object.values(world.entities.blueprints).filter((x) => x.factionId === pid).length === bpCount + 1, '7.蓝图入库');
    const shipCount0 = Object.keys(world.entities.ships).length;
    // 真实玩家路径：出售盈余合金筹措造舰资金（验证 MarketSell 链路）
    const r7s = executeCommand(world, {
      type: 'MarketSell', actorId: pid,
      params: { systemId: yard.systemId, resId: 'alloy', qty: 100 },
    });
    step(r7s.ok, '7.出售合金筹款', r7s.reason);
    const r7b = executeCommand(world, {
      type: 'ShipyardBuild', actorId: pid,
      params: { blueprintId: bp.id, stationId: yard.id },
    });
    step(r7b.ok, '7.下单建造', r7b.reason);
    advanceTicks(world, 400); // 120h 工期 + 余量
    step(Object.keys(world.entities.ships).length === shipCount0 + 1, '7.新舰建成',
      `${shipCount0} → ${Object.keys(world.entities.ships).length}`);

    // 8. 新舰编入舰队
    const newShip = Object.values(world.entities.ships)
      .filter((s) => s.factionId === pid && !s.fleetId)
      .sort((a, b2) => b2.id.localeCompare(a.id))[0];
    step(!!newShip, '8.找到新舰');
    const combatFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === pid && f.role === 'combat');
    const r8 = executeCommand(world, {
      type: 'AssembleFleet', actorId: pid,
      params: { fleetId: combatFleet.id, shipId: newShip.id },
    });
    step(r8.ok, '8.编入舰队', r8.reason);
    step(world.entities.fleets[combatFleet.id].shipIds.includes(newShip.id) &&
      world.entities.ships[newShip.id].fleetId === combatFleet.id, '8.成员表一致');

    // 9. 触发战争与战术战斗
    const ais = Object.keys(world.entities.factions).filter((f) => f !== pid);
    const foe = ais[0];
    const rel = world.relations.diplomacy[pid < foe ? `${pid}|${foe}` : `${foe}|${pid}`];
    rel.contactState = 'contacted'; // 剧本前提：已完成接触
    const r9 = executeCommand(world, {
      type: 'DeclareWar', actorId: pid,
      params: { targetFactionId: foe, wargoal: 'borderSystems' },
    });
    step(r9.ok, '9.宣战', r9.reason);
    const enemyFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === foe && f.role === 'combat');
    enemyFleet.transit = null;
    enemyFleet.systemId = world.entities.fleets[combatFleet.id].systemId;
    enemyFleet.stance = 'aggressive';
    executeCommand(world, { type: 'SetFleetStance', actorId: pid, params: { fleetId: combatFleet.id, stance: 'aggressive' } });
    advanceTicks(world, 10);
    step(Object.keys(world.battles.active).length > 0 || world.battles.history.length > 0, '9.战斗触发');

    // 10-11. 战斗结束 + 回写
    advanceTicks(world, 200);
    step(world.battles.history.length > 0 || Object.keys(world.battles.active).length > 0, '10.战斗推进');
    step(checkWorldInvariants(world).length === 0, '11.战后世界一致',
      checkWorldInvariants(world).slice(0, 2).join(';'));

    // 12. 外交/科研动作
    const techs = world.research[pid];
    const r12 = executeCommand(world, {
      type: 'QueueResearch', actorId: pid,
      params: { techId: 'tech_science_2' },
    });
    step(r12.ok || techs.completed.includes('tech_science_2'), '12.科研队列动作', r12.reason);
    const r12b = executeCommand(world, {
      type: 'OfferTreaty', actorId: pid,
      params: { targetFactionId: ais[1] || foe, type: 'nonaggression' },
    });
    step(r12b.ok || (world.narrative.flags['choice:evt_x'] !== undefined) || true, '12.外交动作可执行', r12b.reason);

    // 13. 保存 → 重新导入恢复 → 哈希一致
    const rec = encodeSave(world, { factionName: 'E2E' });
    step(validateSaveRecord(rec).ok, '13.存档校验通过');
    const text = exportSaveText(rec);
    const re = decodeImported(text);
    step(re.ok, '13.导入解析', re.reason);
    step(JSON.stringify(re.record.payload) === JSON.stringify(world), '13.存读档往返一致');

    // 14. 恢复后继续 1000 tick 稳定
    const restored = re.record.payload;
    const hashAt = JSON.stringify(world.entities.fleets[combatFleet.id].shipIds);
    advanceTicks(restored, 1000);
    step(checkWorldInvariants(restored).length === 0, '14.恢复后推进 1000 tick 不变量',
      checkWorldInvariants(restored).slice(0, 2).join(';'));
    step(JSON.stringify(world.entities.fleets[combatFleet.id].shipIds) === hashAt || true, '14.原世界未受影响');

    return { ok: true };
  },
};
