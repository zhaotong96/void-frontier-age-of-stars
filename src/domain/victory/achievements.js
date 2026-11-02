/**
 * domain/victory/achievements.js — 成就（任务书 5.12）
 * 本地解锁（不连在线平台）；由世界状态判定；ChronicleView 展示。
 */

import { registerYearly } from '../../simulation/TickPipeline.js';

export const ACHIEVEMENTS = [
  { id: 'first_warp', nameZh: '初次跃迁', descZh: '舰队首次完成航路转移', check: (w) => (w.events.log.fleet || []).some((e) => e.type === 'FleetArrived') },
  { id: 'first_contact', nameZh: '初次接触', descZh: '与未知文明完成首次接触', check: (w) => Object.values(w.relations.diplomacy).some((r) => r.contactState === 'contacted') },
  { id: 'first_colony', nameZh: '边疆立足', descZh: '建立第一座殖民地', check: (w) => (w.stats.coloniesFounded || 0) >= 1 },
  { id: 'first_battleship', nameZh: '巨舰之首', descZh: '建成第一艘战列舰', check: (w) => Object.values(w.entities.ships).some((s) => s.hullId === 'hull_battleship' && s.status === 'active') },
  { id: 'first_alliance', nameZh: '盟约缔结', descZh: '首次签署条约', check: (w) => Object.keys(w.entities.treaties).length >= 1 },
  { id: 'surveyor', nameZh: '测绘者', descZh: '勘测完成 25 个星系', check: (w, pid) => Object.values(w.entities.systems).filter((s) => (s.surveyedBy[pid] ?? 0) >= 4).length >= 25 },
  { id: 'anomaly_hunter', nameZh: '解谜者', descZh: '解决 10 个异常', check: (w, pid) => Object.values(w.entities.anomalies).filter((a) => a.state === 'resolved' && a.discoveredBy === pid).length >= 10 },
  { id: 'crisis_contained', nameZh: '封锁成功', descZh: '化解一场银河级危机', check: (w) => Object.values(w.entities.crises).some((c) => c.outcome === 'contained') },
  { id: 'industrialist', nameZh: '工业巨擘', descZh: '单战役建造 10 艘舰船', check: (w) => (w.stats.shipsBuilt || 0) >= 10 },
  { id: 'victory_any', nameZh: '星海纪元', descZh: '达成任意胜利路线', check: (w) => !!w.victory.ended },
];

/** 年度检查（胜利检查后）；解锁记录入 world.achievements */
registerYearly('achievements', (world) => {
  world.achievements ||= {};
  const pid = world.playerFactionId;
  for (const a of ACHIEVEMENTS) {
    if (world.achievements[a.id]) continue;
    let ok = false;
    try {
      ok = a.check(world, pid);
    } catch { /* 判定异常跳过，下年重试 */ }
    if (ok) {
      world.achievements[a.id] = world.tick;
      world.events.chronicle.push({
        id: `evt_${++world.seq}`,
        tick: world.tick,
        type: 'achievement',
        text: `成就解锁：${a.nameZh}`,
        refs: { achievementId: a.id },
      });
    }
  }
});

/** 视图数据（ChronicleView 用） */
export function achievementsView(world) {
  world.achievements ||= {};
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    name: a.nameZh,
    desc: a.descZh,
    unlockedAtTick: world.achievements[a.id] || null,
  }));
}
