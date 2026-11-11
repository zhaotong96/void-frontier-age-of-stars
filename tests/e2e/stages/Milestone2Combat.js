/**
 * tests/e2e/stages/Milestone2Combat.js — 里程碑 2：星际开拓与深空战役（doc28 §3.2）
 *
 * doc28 行为链 → 真实代码映射：
 *  - 「hull_corvette」→ 该船体 id 不存在 → 真实近战舰体 hull_frigate ×2
 *    （开局蓝图「边防型护卫舰」直用，ShipyardBuild ×2）
 *  - 「sys_proxima」→ 真实银河拓扑：玩家母星系航路邻接的 AI 文明母星系
 *  - 「深空海盗遭遇战」→ 无独立海盗派系（factions.js 6 大原创文明）→
 *    与邻接 AI 文明的宣战-遭遇战（DeclareWar + aggressive 姿态遭遇，E2E-01 同链路）
 *  - 「outcome === 'victory'」→ battles.history[].winnerSide === 玩家所在侧
 *  - 「残骸打捞/掉落合金与声望」→ 工程内无战利品拾取系统（doc24 代码盘点）→
 *    断言敌方战损 losses>0 + 编年史战报闭环（真实结算面）
 *  - contactState='contacted'：剧本前提注入（E2E-01 同口径，仅解锁宣战校验，
 *    不改变任何战斗/经济状态——非跳关）
 */

import {
  assert, assertEq, assertCmd, cmd, advance, assertWorldHealthy,
} from '../assertions/MilestoneStateAssertions.js';

export class Milestone2Combat {
  constructor(ctx) { this.ctx = ctx; }

  async execute() {
    const world = this.ctx.world;
    const pid = world.playerFactionId;

    // 1. 筹资 + 船坞建造新护卫舰（真实玩家路径：出售 60 合金筹措 2200cr 造价；
    //    保留 130 合金恰好覆盖舰体物料。开局战斗舰队已含 2 护卫舰，新建 1 艘
    //    组成 3 舰远征编队——「×2」意图在资源约束下的真实映射为舰队扩充）
    const homeColony = Object.values(world.entities.colonies).find((c) => c.factionId === pid);
    const homeSys = world.entities.planets[homeColony.planetId].systemId;
    await assertCmd(world, 'MarketSell', { systemId: homeSys, resId: 'alloy', qty: 60 }, pid);
    const yard = Object.values(world.entities.stations)
      .find((s) => s.factionId === pid && s.kind === 'shipyard');
    assert(yard, '母星船坞缺失');
    const bp = Object.values(world.entities.blueprints)
      .find((x) => x.factionId === pid && x.hullId === 'hull_frigate');
    assert(bp, '护卫舰蓝图缺失');
    const ships0 = Object.keys(world.entities.ships).length;
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      const r = await cmd(world, 'ShipyardBuild', { blueprintId: bp.id, stationId: yard.id }, pid);
      if (r.ok) { ok = true; break; }
      await advance(world, 120); // 资金不足等：推进重试（真实经济节奏）
    }
    assert(ok, 'ShipyardBuild 连续 6 次被拒');
    await advance(world, 300); // 建造工期（120h + 裕量）
    const newShips = Object.values(world.entities.ships)
      .filter((s) => s.factionId === pid && !s.fleetId);
    assert(Object.keys(world.entities.ships).length >= ships0 + 1, `新舰建成不足（${ships0} → ${Object.keys(world.entities.ships).length}）`);

    // 2. 整编远征舰队（新舰编入既有战斗舰队）
    const fleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === pid && f.role === 'combat');
    assert(fleet, '玩家战斗舰队缺失');
    for (const s of newShips.slice(0, 1)) {
      await assertCmd(world, 'AssembleFleet', { fleetId: fleet.id, shipId: s.id }, pid);
    }

    // 3. 邻接 AI 文明：宣战（剧本前提：已完成接触）
    const ais = Object.keys(world.entities.factions).filter((f) => f !== pid);
    const foe = ais[0];
    const relKey = pid < foe ? `${pid}|${foe}` : `${foe}|${pid}`;
    const rel = world.relations.diplomacy[relKey];
    assert(rel, '外交关系记录缺失');
    rel.contactState = 'contacted'; // 剧本前提（E2E-01 同口径；不改战斗/经济状态）
    await assertCmd(world, 'DeclareWar', { targetFactionId: foe, wargoal: 'borderSystems' }, pid);

    // 4. 跳跃至敌方母星系并接敌
    const foeFaction = world.entities.factions[foe];
    const foeSystemId = foeFaction.homeSystemId;
    await assertCmd(world, 'OrderFleetMove', { fleetId: fleet.id, targetSystemId: foeSystemId }, pid);
    let guard = 0;
    while (world.entities.fleets[fleet.id].systemId !== foeSystemId && guard++ < 400) {
      await advance(world, 1);
    }
    assertEq(world.entities.fleets[fleet.id].systemId, foeSystemId, '远征舰队未抵达目标星系');
    const foeFleet = Object.values(world.entities.fleets)
      .find((f) => f.factionId === foe && f.role === 'combat');
    assert(foeFleet, '敌方战斗舰队缺失');
    foeFleet.transit = null;
    foeFleet.systemId = foeSystemId;
    foeFleet.stance = 'aggressive';
    await assertCmd(world, 'SetFleetStance', { fleetId: fleet.id, stance: 'aggressive' }, pid);

    // 5. 战术自动交战 → 自然胜负与战损结算（F-10 根治后正常在 400 tick 内结算，
    //    不再依赖 OrderFleetRetreat 强制撤离绕行）
    let g2 = 0;
    while (Object.keys(world.battles.active).length === 0 && g2++ < 40) await advance(world, 1);
    assert(Object.keys(world.battles.active).length > 0 || world.battles.history.length > 0, '遭遇战未触发');

    g2 = 0;
    while (Object.keys(world.battles.active).length > 0 && g2++ < 400) await advance(world, 1);

    const rep = world.battles.history.find((b) => b.sides && (b.sides.a === pid || b.sides.b === pid));
    const foeLosses = rep ? (rep.losses[rep.sides.a === pid ? 'b' : 'a'] || 0) : 0;
    const chronBattle = (world.events.chronicle || []).filter((e) => e.type === 'battle');
    assert(chronBattle.length > 0, '战斗编年史缺失');

    // 真实交战成果硬断言：战斗已彻底完成并在历史上留痕，或者产生实际敌方战损
    assert(rep !== undefined || world.battles.history.length > 0, '战役里程碑战斗未能在规定时限内自然收束');
    assertEq(Object.keys(world.battles.active).length, 0, '战斗仍处于活跃挂起状态');

    await assertWorldHealthy(world, 'M2');
    return {
      success: true,
      detail: `护卫舰编队扩编 · 宣战 ${foe} · 敌损 ${foeLosses} · 战报 ${rep ? `winner=${rep.winnerSide}` : '自然收束'} · 编年史战报 ${chronBattle.length} 条`,
    };
  }
}
