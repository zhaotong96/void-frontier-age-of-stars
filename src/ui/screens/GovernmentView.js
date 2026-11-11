/**
 * ui/screens/GovernmentView.js — 政府/政治视图（路由 #/government）
 *
 * 布局：.vf-view > .vf-view-head（标题）+ .vf-view-body（可滚动）：
 *   1) 概览面板：稳定度 gauge（各殖民地平均）+ 行政容量 vs 治理负担 statBar
 *      （超载时红色警告文案）+ 影响力/人口/殖民地数/星系数 kvList；
 *   2) 行政容量 explain 面板（governmentView.explainAdmin：逐项来源与数值）；
 *   3) 政策面板：当前已颁布政策（policies 为空显示「未颁布政策」）；
 *      政策颁布/撤销（EnactPolicy/RevokePolicy）与聚落法典（SignColonyEdict）
 *      均已闭环实装；生效法令真实概览见 _edictOverviewPanel（SPEC-39 Bug 4）。
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
import { COLONY_EDICTS } from '../../domain/planets/colonyGovernance.js';

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
    this._app = ctx.app;
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
    body.appendChild(this._edictOverviewPanel());
    body.appendChild(this._explainPanel(g));
    body.appendChild(this._policyPanel(g));
    body.appendChild(this._policiesPanel());
    body.appendChild(this._crewPanel());
  },

  /**
   * [SPEC-39 Bug 4] 生效法令概览栏（真实数据）：聚合全部殖民地当前生效的
   * 聚落法典（colonyGovernance.COLONY_EDICTS）——激活法令总数、每日维护费
   * （automata_shift 的 conductor 消耗，逐聚落 min(2, 库存) 口径）、以及希望/不满
   * 每日净修正率（hopePerDay/discontentPerDay 求和）。取代已过时的
   * 「政策系统尚未实装」静态免责横幅。
   */
  _edictOverviewPanel() {
    const w = this.app.world;
    const p = panel({ title: '生效法令概览', open: true, dense: true });
    const rows = [];
    let totalActive = 0;
    let totalUpkeep = 0;
    let hopeNet = 0;
    let discontentNet = 0;
    for (const c of Object.values(w.entities.colonies || {})) {
      if (c.factionId !== w.playerFactionId) continue;
      const planet = w.entities.planets[c.planetId];
      const soc = planet && planet.soc;
      if (!soc || !Array.isArray(soc.edicts) || soc.edicts.length === 0) continue;
      let colonyUpkeep = 0;
      for (const eid of soc.edicts) {
        const ed = COLONY_EDICTS[eid];
        if (!ed) continue;
        totalActive++;
        hopeNet += ed.hopePerDay || 0;
        discontentNet += ed.discontentPerDay || 0;
        if (ed.upkeepConductor) colonyUpkeep += ed.upkeepConductor;
      }
      if (colonyUpkeep > 0) {
        // 与 tickColonySociety 同口径：实际结算 min(维护费, conductor 库存)
        const led = w.economy.ledgers[w.playerFactionId];
        colonyUpkeep = Math.min(colonyUpkeep, (led && led.balances && led.balances.conductor) || 0);
        totalUpkeep += colonyUpkeep;
      }
      const edNames = soc.edicts.map((eid) => (COLONY_EDICTS[eid] || {}).nameZh || eid).join('、');
      rows.push([planet ? planet.name : c.planetId, `${soc.edicts.length} 项 · ${edNames}`]);
    }
    p.appendChild(kvList([
      ['激活法令总数', totalActive],
      ['每日维护费', `conductor −${totalUpkeep}/日`],
      ['希望净修正', `${hopeNet >= 0 ? '+' : ''}${hopeNet}/日`],
      ['不满净修正', `${discontentNet >= 0 ? '+' : ''}${discontentNet}/日`],
    ]));
    if (!rows.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '当前无聚落激活任何法令（进入行星地表并任命总督后可签署法典）。' }));
    } else {
      for (const [name, desc] of rows) {
        p.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '2px 0' } }, [
          el('span', { class: 'vf-grow vf-small', text: name }),
          el('span', { class: 'vf-dim vf-small', text: desc }),
        ]));
      }
    }
    return p;
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
   * 政策面板：当前已颁布政策（真实状态：政策系统已实装；
   * [SPEC-39 Bug 4] 陈旧「未实装」免责占位横幅已移除）。
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

    // [SPEC-39 Bug 4] 陈旧的「政策系统将在后续版本开放/尚未实现」免责占位横幅已移除——
    // 政策颁布/撤销（EnactPolicy/RevokePolicy）与聚落法典（SignColonyEdict）均已闭环实装；
    // 真实生效概览见 _edictOverviewPanel（激活法令数/日维护费/希望不满净修正）。
    return p;
  },

  /** 政策操作面板（任务书 4.1：颁布/撤销、成本/时长/冷却/预期影响可见） */
  _policiesPanel() {
    const app = this._app;
    const { policiesView } = policyApi();
    const pv = policiesView(app.world, app.world.playerFactionId);

    const p = el('div', { class: 'vf-panel' });
    p.appendChild(el('div', { class: 'vf-panel-head' }, [
      el('span', { text: '政策与法令' }),
      el('span', {
        class: `vf-small ${pv.usedSlots > pv.capacity ? 'vf-danger' : 'vf-dim'}`,
        style: { marginLeft: 'auto' },
        text: `行政占用 ${pv.usedSlots}/${pv.capacity} · 治理负担 ${pv.load}`,
      }),
    ]));
    const body = el('div', { class: 'vf-panel-body' });

    // 超载警告（4.1：行政容量不足产生实际后果）
    if (pv.load > pv.capacity) {
      body.appendChild(el('div', {
        class: 'vf-warn vf-small',
        text: `⚠ 治理负担超过行政容量：各殖民地稳定度将持续受损。请精简政策或提升行政能力。`,
      }));
    }

    for (const pol of pv.list) {
      const isActive = pol.status === 'active';
      const row = el('div', { style: { padding: '7px 0', borderBottom: '1px solid rgba(29,42,58,0.5)' } });
      const head = el('div', { class: 'vf-row' });
      head.appendChild(el('span', { class: 'vf-grow', text: pol.name }));
      // 状态标签
      const tagText = { active: pol.remainingDays != null ? `生效 · 余 ${pol.remainingDays} 日` : '生效中', cooldown: `冷却 · ${pol.remainingDays} 日`, available: '未颁布' }[pol.status] || pol.status;
      head.appendChild(el('span', { class: `vf-tag ${isActive ? 'ok' : pol.status === 'cooldown' ? 'warn' : ''}`, text: tagText }));
      head.appendChild(el('span', { class: 'vf-faint vf-small', text: `◈${pol.cost.influence} · 行政 ${pol.adminCost}` }));
      row.appendChild(head);

      row.appendChild(el('div', { class: 'vf-faint vf-small', text: pol.desc }));
      row.appendChild(el('div', { class: 'vf-dim vf-small', text: pol.expected }));
      const meta = [];
      meta.push(pol.durationDays ? `法令：${pol.durationDays} 日后失效` : '永久政策');
      meta.push(`冷却 ${pol.cooldownDays} 日`);
      meta.push(`效果：${pol.effects.map((e2) => `${e2.stat} ${e2.mode === 'mult' ? '×' + e2.value : (e2.value > 0 ? '+' : '') + e2.value}`).join('，')}`);
      row.appendChild(el('div', { class: 'vf-faint vf-small', text: meta.join(' · ') }));

      const btnRow = el('div', { class: 'vf-row mt-1' });
      const slotTight = pv.usedSlots + pol.adminCost > pv.capacity && !isActive;
      if (isActive) {
        btnRow.appendChild(el('button', {
          class: 'vf-btn small danger',
          text: '撤销',
          title: '撤销后进入冷却，影响力不退还',
          on: { click: () => app.dispatch('RevokePolicy', { policyId: pol.id }) },
        }));
      } else {
        const b = el('button', {
          class: 'vf-btn small primary',
          text: '颁布',
          disabled: pol.status === 'cooldown' || slotTight,
          title: pol.status === 'cooldown' ? `冷却中（余 ${pol.remainingDays} 日）` : slotTight ? `行政容量不足（需 ${pol.adminCost} 槽位）` : `花费影响力 ${pol.cost.influence}`,
          on: { click: () => app.dispatch('EnactPolicy', { policyId: pol.id }) },
        });
        btnRow.appendChild(b);
      }
      row.appendChild(btnRow);
      body.appendChild(row);
    }

    p.appendChild(body);
    return p;
  },

  /** 人物与船员面板（只读视图；任命经 AssignCharacter 命令） */
  _crewPanel() {
    const { crewView } = crewApi();
    const app = this._app;
    const crew = crewView(app.world, app.world.playerFactionId);
    const p = el('div', { class: 'vf-panel' });
    p.appendChild(el('div', { class: 'vf-panel-head', text: '人物与船员' }));
    const body = el('div', { class: 'vf-panel-body' });
    if (crew.length === 0) {
      body.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无人物记录。' }));
    }
    for (const c of crew.slice(0, 12)) {
      const row = el('div', { class: 'vf-row', style: { padding: '3px 0', borderBottom: '1px solid rgba(29,42,58,0.4)' } });
      row.appendChild(el('span', { class: 'vf-grow vf-small', text: `${c.name} · ${c.role} Lv${c.level}` }));
      row.appendChild(el('span', { class: `vf-tag ${c.health === 'healthy' ? 'ok' : c.health === 'dead' ? 'danger' : 'warn'}`, text: c.healthName }));
      if (c.fleetName) row.appendChild(el('span', { class: 'vf-faint vf-small', text: c.fleetName }));
      row.title = `忠诚 ${c.loyalty} · 压力 ${c.stress} · 特质 ${c.traits.join('、')}`;
      body.appendChild(row);
    }
    p.appendChild(body);
    return p;
  },
};

import { crewView as crewViewFn } from '../../domain/characters/crew.js';
function crewApi() {
  return { crewView: crewViewFn };
}

import { policiesView } from '../../domain/politics/policy.js';
function policyApi() {
  return { policiesView };
}
