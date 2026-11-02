/**
 * ui/screens/ChronicleView.js — 战役纪年视图（路由 #/chronicle）
 *
 * 布局：.vf-view > .vf-view-head（标题 + 导出按钮）+ .vf-view-body（可滚动）：
 *   1) 战役统计 kvList（chronicleView.stats：日期/命令数/战斗数/建立殖民地/造船数）；
 *   2) timeline 组件渲染纪年条目（chronicleView.entries；kind 由 type 映射：
 *      battle→danger、colony→good、tech→accent、其它→info。timeline 组件仅支持
 *      info|good|warn|danger，'accent' 会被其归一化为 info —— 按映射原样传递）；
 *   3) 导出按钮：把统计与纪年条目打包 JSON 下载（Blob，无外部依赖；
 *      文件名取战役日期，确定性生成，不使用随机数）。
 *
 * 数据来源纪律：只读消费 chronicleView（ViewModels）；纯展示 + 本地导出，
 * 无写操作、无监听、无 rAF；onSnapshot 250ms 节流重建；unmount 清引用。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { timeline } from '../charts/index.js';
import { L } from '../../core/i18n.js';
import { chronicleView } from '../../simulation/ViewModels.js';

/**
 * 纪年条目 type → timeline kind 映射。
 * timeline 组件合法 kind 为 info|good|warn|danger；'accent' 不在其中，
 * 会被 timeline 归一化为 info 展示 —— 依任务书映射原样传递。
 */
const CHRONICLE_KIND = {
  battle: 'danger',
  colony: 'good',
  tech: 'accent',
};

export const ChronicleView = {
  id: 'chronicle',
  title: '纪年',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;

    root.innerHTML = '';
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.chronicle') }));
    head.appendChild(el('span', { class: 'vf-grow' }));
    head.appendChild(el('button', {
      class: 'vf-btn small',
      text: '导出 JSON',
      title: '把战役统计与纪年条目导出为 JSON 文件下载',
      on: { click: () => this._exportJson() },
    }));

    this._body = el('div', { class: 'vf-view-body pad' });
    const wrap = el('div', { class: 'vf-view' }, [head, this._body]);
    root.appendChild(wrap);

    this._rebuild();
  },

  /** 快照推送：250ms 节流重建（纯展示） */
  onSnapshot() {
    if (!this._mounted) return;
    const now = performance.now();
    if (now - this._lastRefresh < 250) return;
    this._lastRefresh = now;
    this._rebuild();
  },

  /** 卸载：清引用（本视图无监听 / 无 rAF / 无画布） */
  unmount() {
    this._mounted = false;
    this.app = null;
    this._body = null;
  },

  // —— 内部实现 ——————————————————————————————————

  /** chronicleView 只读数据包 */
  _chronicle() {
    return chronicleView(this.app.world);
  },

  /** 整体重建：统计 → 纪年时间线 */
  _rebuild() {
    const body = this._body;
    if (!body) return;
    clearEl(body);
    const c = this._chronicle();
    const s = c.stats || {};

    // —— 1) 战役统计 ——
    const statsP = panel({ title: '战役统计', open: true });
    statsP.appendChild(kvList([
      ['当前日期', s.date || '—'],
      ['执行命令数', s.commands ?? 0],
      ['战斗数', s.battles ?? 0],
      ['建立殖民地', s.coloniesFounded ?? 0],
      ['造船数', s.shipsBuilt ?? 0],
    ]));
    body.appendChild(statsP);

    // —— 2) 纪年时间线（entries 最新在前；kind 按 CHRONICLE_KIND 映射） ——
    const entriesP = panel({ title: `纪年条目（${(c.entries || []).length}）`, open: true });
    entriesP.appendChild(timeline({
      entries: (c.entries || []).map((e) => ({
        tick: e.date,
        text: e.text,
        kind: CHRONICLE_KIND[e.type] || 'info',
      })),
      max: 200,
    }));
    body.appendChild(entriesP);

    // 成就（5.12：本地解锁记录）
    const { achievementsView } = ach();
    const achievements = achievementsView(this.app.world);
    const doneCount = achievements.filter((a) => a.unlockedAtTick).length;
    const achP = el('div', { class: 'vf-panel' });
    achP.appendChild(el('div', { class: 'vf-panel-head', text: `成就（${doneCount}/${achievements.length}）` }));
    const achBody = el('div', { class: 'vf-panel-body' });
    for (const a of achievements) {
      const row = el('div', { class: 'vf-row', style: { padding: '2px 0' } });
      row.appendChild(el('span', { class: a.unlockedAtTick ? 'vf-ok' : 'vf-faint', text: a.unlockedAtTick ? '★' : '☆' }));
      row.appendChild(el('span', { class: 'vf-grow vf-small', text: a.name }));
      row.appendChild(el('span', { class: 'vf-faint vf-small', text: a.unlockedAtTick ? dateStr(a.unlockedAtTick) : a.desc }));
      achBody.appendChild(row);
    }
    achP.appendChild(achBody);
    body.appendChild(achP);
  },

  /** 导出 JSON：统计 + 全部纪年条目 → Blob 下载（文件名由战役日期确定性生成） */
  _exportJson() {
    const c = this._chronicle();
    const payload = {
      exportedAtTick: (c.stats && c.stats.ticks) ?? null,
      stats: c.stats || {},
      entries: c.entries || [],
    };
    const safeDate = String((c.stats && c.stats.date) || 'unknown')
      .replace(/[^0-9.]/g, '')
      .replace(/\./g, '-');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `void-frontier-chronicle-${safeDate}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 释放对象 URL（下载发起后即可 revoke）
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};

import { achievementsView } from '../../domain/victory/achievements.js';
function ach() {
  return { achievementsView };
}
