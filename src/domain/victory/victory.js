/**
 * domain/victory/victory.js — 胜利条件与软失败（任务书 5.11 / 9.14 阶段11）
 *
 * 六条胜利路线：科技跃迁 / 银河霸权 / 外交共同体 / 经济网络 /
 * 探索发现 / 危机终结。每年检查（SeasonalSystems）；失败采用软失败
 * （流亡继续）而非删除存档。
 */

import { registerYearly } from '../../simulation/TickPipeline.js';
import { emit, chronicle } from '../../core/eventBus.js';
import { balance } from '../economy/ledger.js';

export const VICTORY_ROUTES = [
  { id: 'tech', nameZh: '科技跃迁', descZh: '完成 45 项科技并持有足够古代数据' },
  { id: 'hegemony', nameZh: '银河霸权', descZh: '控制全银河 40% 的星系' },
  { id: 'diplomacy', nameZh: '外交共同体', descZh: '与 3 个以上文明缔结共同防御或贸易同盟，且危机已解除' },
  { id: 'economy', nameZh: '经济网络', descZh: '信用点储备 50000 且殖民地达到 8 个' },
  { id: 'exploration', nameZh: '探索发现', descZh: '勘测完成 90% 星系且解决 15 个异常' },
  { id: 'crisis', nameZh: '危机终结', descZh: '在主线终局抉择中定夺银河未来' },
];

/** 注册年度胜利检查（由 SeasonalSystems 显式调用） */
export function registerVictory() {
  registerYearly('victory', victoryYearly);
}

function victoryYearly(world) {
  if (world.victory.ended && !world.narrative.flags.sandbox_continue) return;
  checkSoftFailure(world);
  if (world.victory.ended) return;

  const pid = world.playerFactionId;
  const total = Object.keys(world.entities.systems).length;
  const owned = Object.values(world.entities.systems).filter((s) => s.ownerFactionId === pid).length;
  const rs = world.research[pid];
  const led = world.economy.ledgers[pid];
  const colonies = Object.values(world.entities.colonies).filter((c) => c.factionId === pid).length;
  const surveyedAll = Object.values(world.entities.systems).filter((s) => (s.surveyedBy[pid] ?? 0) >= 4).length;
  const anomaliesResolved = Object.values(world.entities.anomalies)
    .filter((a) => a.state === 'resolved' && a.discoveredBy === pid).length;
  const activeTreaties = Object.values(world.entities.treaties)
    .filter((t) => t.status === 'active' && t.parties.includes(pid) &&
      (t.kind === 'mutualDefense' || t.kind === 'trade')).length;
  const crisisResolved = world.narrative.arcs.arc_crisis?.resolved;
  const mainStage = world.narrative.arcs.arc_main?.stage || 0;

  // 进度记录（UI 显示）
  world.victory.routes = {
    tech: { progress: Math.min(1, ((rs?.completed.length || 0) / 45) * 0.7 + Math.min(1, (balance(world, pid, 'ancientData') || 0) / 20) * 0.3), done: false },
    hegemony: { progress: owned / Math.max(1, total * 0.4), done: false },
    diplomacy: { progress: Math.min(1, activeTreaties / 3) * (crisisResolved ? 1 : 0.8), done: false },
    economy: { progress: Math.min(1, (led?.balances?.credits || 0) / 50000) * 0.6 + Math.min(1, colonies / 8) * 0.4, done: false },
    exploration: { progress: (surveyedAll / Math.max(1, total)) * 0.6 + Math.min(1, anomaliesResolved / 15) * 0.4, done: false },
    crisis: { progress: crisisResolved ? 1 : mainStage / 4, done: false },
  };

  const win = (routeId, endingId, text) => {
    world.victory.ended = { routeId, endingId, tick: world.tick };
    world.victory.routes[routeId].done = true;
    world.narrative.flags.sandbox_continue = true; // 无尽沙盒：终局后可继续
    emit(world, 'VictoryAchieved', { routeId, endingId }, 'world');
    chronicle(world, 'victory', `胜利：${text}`, { routeId });
  };

  if ((rs?.completed.length || 0) >= 45 && (balance(world, pid, 'ancientData') || 0) >= 20) {
    win('tech', 'transcendence', '完成弦驱跃迁，文明扬帆深空（科技跃迁）');
    return;
  }
  if (owned >= total * 0.4) {
    win('hegemony', 'galactic_hegemon', '疆域横跨银河边域（银河霸权）');
    return;
  }
  if (activeTreaties >= 3 && crisisResolved) {
    win('diplomacy', 'concert_of_stars', '边域诸文明结成共同体（外交共同体）');
    return;
  }
  if ((led?.balances?.credits || 0) >= 50000 && colonies >= 8) {
    win('economy', 'merchant_republic', '贸易网络贯穿星海（经济网络）');
    return;
  }
  if (surveyedAll >= total * 0.9 && anomaliesResolved >= 15) {
    win('exploration', 'cartographer', '银河边域再无未测绘之地（探索发现）');
    return;
  }
  if (crisisResolved && mainStage >= 4) {
    const flags = world.narrative.flags;
    const ending =
      flags.ending_seal ? '守望者' :
      flags.ending_share ? '共同边疆' :
      flags.ending_harness ? '新霸权' :
      flags.ending_destroy ? '断弦' : '星海抉择';
    win('crisis', ending, `主线终局：${ending}`);
  }
}

/** 软失败：失去全部殖民地与舰船 → 流亡模式（存档继续，任务书 5.11） */
export function checkSoftFailure(world) {
  if (world.narrative.flags.exile_mode) return;
  const pid = world.playerFactionId;
  const colonies = Object.values(world.entities.colonies).filter((c) => c.factionId === pid).length;
  const fleets = Object.values(world.entities.fleets).filter((f) => f.factionId === pid && f.shipIds.length > 0).length;
  if (colonies === 0 && fleets === 0) {
    world.narrative.flags.exile_mode = world.tick;
    emit(world, 'ExileMode', { factionId: pid }, 'world');
    chronicle(world, 'world', '我方全部殖民地与舰队均已失去，残部进入流亡模式（存档继续）', {});
  }
}
