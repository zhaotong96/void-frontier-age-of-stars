/**
 * ui/screens/GovernmentView.js — 政府/政治视图（路由 #/government）
 *
 * 布局：.vf-view > .vf-view-head（标题）+ .vf-view-body（可滚动）：
 *   1) 概览面板：稳定度 gauge（各殖民地平均）+ 行政容量 vs 治理负担 statBar
 *      （超载时红色警告文案）+ 影响力/人口/殖民地数/星系数 kvList；
 *   2) 行政容量 explain 面板（governmentView.explainAdmin：逐项来源与数值）；
 *   3) 政策面板：当前已颁布政策（policies 为空显示「未颁布政策」）；
 *      可用政策为明确的禁用占位卡片——政策系统未实现，真实状态标注
 *      「政策系统将在后续版本开放」，不伪造可点击的按钮。
 *
 * 数据来源纪律：只读消费 governmentView（ViewModels）；本视图纯展示，
 * 无写操作、无监听、无 rAF；onSnapshot 250ms 节流重建；unmount 清引用。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { statBar } from '../components/bars.js';
import { gauge } from '../charts/index.js';
import { L } from '../../core/i18n.js';
import { governmentView } from '../../simulation/ViewModels.js';

/** 气质/人格中文标签（未知回退原文） */
const TAG_ZH = {
  trader: '商业至上', expansionist: '扩张主义', defensive: '防御型',
  scientist: '科研狂热', opportunist: '机会主义', militarist: '军国主义',
  isolationist: '孤立主义', diplomat: '外交型', aggressor: '侵略型',
};

export const GovernmentView = {
  id: 'government',
  title: '政府',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;

    root.innerHTML = '';
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.government') }));
    this._titleExtra = el('span', { class: 'vf-dim vf-small', text: '' });
    head.appendChild(this._titleExtra);

    this._body = el('div', { class: 'vf-view-body pad' });
    const wrap = el('div', { class: 'vf-view' }, [head, this._body]);
    root.appendChild(wrap);

    this._rebuild();
  },

  /** 快照推送：250ms 节流重建（纯展示，无输入件） */
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
    this._titleExtra = null;
  },

  // —— 内部实现 ——————————————————————————————————

  /** governmentView 只读数据包 */
  _gov() {
    const w = this.app.world;
    return governmentView(w, w.playerFactionId);
  },

  /** 整体重建：概览 → 行政容量解释 → 政策面板 */
  _rebuild() {
    const body = this._body;
    if (!body) return;
    clearEl(body);
    const g = this._gov();
    if (!g) {
      body.appendChild(el('div', { class: 'vf-faint vf-center mt-3', text: '政府数据不可用（玩家文明缺失）。' }));
      return;
    }
    this._titleExtra.textContent = `${g.name} · ${TAG_ZH[g.personality] || g.personality || ''}`;

    body.appendChild(this._overviewPanel(g));
    body.appendChild(this._explainPanel(g));
    body.appendChild(this._policyPanel(g));
  },

  /** 概览面板：稳定度 gauge + 行政容量 statBar + 基础 kvList */
  _overviewPanel(g) {
    const p = panel({ title: '概览', open: true });

    // —— 稳定度（各殖民地平均值，0–100；低稳定 → 红档） ——
    const top = el('div', { class: 'vf-row', style: { alignItems: 'flex-start', flexWrap: 'wrap' } });
    top.appendChild(gauge({
      value: g.stability ?? 0, max: 100, label: '稳定度（平均）',
      warn: 0.4, danger: 0.2, // 方向语义：越低越危险（gauge 分档按比值，此处手动翻转阈值）
      width: 150, height: 90,
    }));

    // —— 行政容量 vs 治理负担 ——
    const adminBox = el('div', { class: 'vf-col vf-grow', style: { minWidth: '220px' } });
    const cap = Math.max(0, Number(g.adminCapacity) || 0);
    const load = Math.max(0, Number(g.governanceLoad) || 0);
    const overloaded = load > cap;
    adminBox.appendChild(statBar({
      label: '治理负担 / 行政容量',
      value: load,
      max: Math.max(cap, load, 1), // 超载时仍完整显示负担条
      tone: overloaded ? 'danger' : 'auto',
    }));
    adminBox.appendChild(kvList([
      ['行政容量', cap],
      ['治理负担', load],
      ['余量', cap - load],
    ]));
    if (overloaded) {
      // 超载红色警告文案（真实状态：负担已超过容量）
      adminBox.appendChild(el('div', {
        class: 'vf-warn vf-small',
        text: `警告：治理负担（${load}）已超过行政容量（${cap}）——超载状态。`,
      }));
    } else {
      adminBox.appendChild(el('div', { class: 'vf-faint vf-small', text: '治理负担在行政容量范围内。' }));
    }
    top.appendChild(adminBox);
    p.appendChild(top);

    // —— 基础指标 ——
    p.appendChild(kvList([
      ['文明', g.name],
      ['气质', TAG_ZH[g.personality] || g.personality || '—'],
      ['起源', g.originType || '—'],
      ['影响力', g.influence ?? 0],
      ['总人口', g.totalPopulation ?? 0],
      ['殖民地数', g.colonyCount ?? 0],
      ['星系数', g.systemCount ?? 0],
    ]));
    return p;
  },

  /** 行政容量 explain 面板（逐项来源：文明特质 / 科技 / 政策） */
  _explainPanel(g) {
    const p = panel({ title: '行政容量 · 计算来源', open: true, dense: true });
    const rows = Array.isArray(g.explainAdmin) ? g.explainAdmin : [];
    if (!rows.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '无修正来源（仅基础容量）。' }));
    }
    for (const r of rows) {
      p.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '2px 0' } }, [
        el('span', { class: 'vf-grow', text: r.source || '未知来源' }),
        el('span', { class: 'vf-mono vf-small', text: `${Number(r.value) > 0 ? '+' : ''}${r.value}` }),
      ]));
    }
    p.appendChild(el('div', { class: 'vf-faint vf-small mt-1', text: '基础容量 20；每座行政类建筑 +10（数值乘以文明特质/科技修正）。' }));
    return p;
  },

  /**
   * 政策面板：当前已颁布政策 + 可用政策占位（真实状态：政策系统未实现）。
   * 占位卡片必须可见且明确说明锁定原因，不伪造可交互按钮。
   */
  _policyPanel(g) {
    const p = panel({ title: '政策', open: true });

    // —— 当前政策 ——
    const cur = el('div', { class: 'vf-col' });
    const policyIds = Object.keys(g.policies || {}).sort();
    if (!policyIds.length) {
      cur.appendChild(el('div', { class: 'vf-faint vf-small', text: '未颁布政策。' }));
    }
    for (const pid of policyIds) {
      const pol = g.policies[pid] || {};
      const name = pol.nameZh || pid;
      const effects = Array.isArray(pol.effects)
        ? pol.effects.map((e) => `${e.stat || '?'} ${Number(e.value) > 0 ? '+' : ''}${e.value}`).join('；')
        : '';
      cur.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '2px 0' } }, [
        el('span', { class: 'vf-tag accent', text: name }),
        el('span', { class: 'vf-dim vf-small vf-grow', text: effects || '（无效果条目）' }),
      ]));
    }
    p.appendChild(cur);

    // —— 可用政策占位（禁用卡片，明确锁定说明） ——
    const locked = el('div', {
      class: 'vf-col mt-2',
      style: {
        border: '1px dashed rgba(113,131,154,0.45)', borderRadius: '4px',
        padding: '10px', opacity: '0.75', background: 'rgba(113,131,154,0.05)',
      },
    }, [
      el('div', { class: 'vf-dim', text: '政策系统将在后续版本开放' }),
      el('div', { class: 'vf-faint vf-small', text: '政策颁布、切换与效果结算尚未实现；当前版本仅展示已存在的政策数据，无可用操作。' }),
    ]);
    p.appendChild(locked);
    return p;
  },
};
