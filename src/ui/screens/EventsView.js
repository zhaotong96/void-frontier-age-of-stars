/**
 * ui/screens/EventsView.js — 事件中心视图（路由 #/events）
 *
 * 布局：.vf-view > .vf-view-head（标题）+ .vf-view-body（可滚动）：
 *   1) 待决事件卡（app.snapshot.pendingEvent → world.narrative.pendingChoices[0]
 *      结构 {eventId, titleZh, bodyZh, choices:[{id,labelZh,hintZh}]}）：
 *      标题/正文/choices 按钮 → dispatch('ResolveEventChoice', {eventId, choiceId})。
 *      该命令由主工程后续实现：当前返回 UNKNOWN_COMMAND 时明确 toast
 *      「该事件系统即将上线」，不伪造成功；pendingEvent 为 null 时显示提示。
 *   2) 告警列表（snapshot.alerts）：优先级色点 + 文本 + 日期，可点击跳转
 *      （payload.systemId → select+goto galaxy；colonyId → colony；fleetId → fleet）。
 *   3) 近期事件日志（app.alertFeed() 前 50 条，类型中文映射见文件顶部）。
 *
 * 数据来源纪律：全部只读消费 snapshot / alertFeed / world 只读名称解析；
 * onSnapshot 250ms 节流重建（无输入件，安全整体重建）；unmount 清引用。
 */

import { el, clearEl } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { toast } from '../components/toast.js';
import { L } from '../../core/i18n.js';
import { dateStr } from '../../core/clock.js';

/**
 * 事件/告警类型中文映射（键 = eventBus emit 的 type；未知类型回退原文）。
 * 覆盖 SnapshotBuilder.buildAlerts 的告警集合与近期日志中出现的全部类型。
 */
const EVENT_TYPE_ZH = {
  BattleStarted: '战斗开始', BattleEnded: '战斗结束', ShipDestroyed: '舰船损失',
  WarDeclared: '宣战', TreatySigned: '条约缔结', TreatyBreached: '条约违约',
  TreatyExpired: '条约到期', TreatyRejected: '条约被拒', DiplomaticGift: '外交赠礼',
  FirstContact: '首次接触', FirstContactSignal: '接触信号',
  FleetStranded: '舰队受困', FleetFormed: '舰队编成', FleetArrived: '舰队抵达',
  FleetDeparted: '舰队出发', FleetDissolved: '舰队解散',
  ColonyFounded: '殖民地建立', ColonyLost: '殖民地失守', ColonyFamine: '殖民地饥荒',
  ColonyBlackout: '殖民地停电', ColonyShortage: '资源短缺',
  SystemSurveyed: '星系调查', SystemLocated: '星系定位', SystemClassified: '星系分类',
  AnomalyDetected: '发现异常', AnomalyResolved: '异常解决',
  TechCompleted: '科技完成', ShipCompleted: '舰船建成', BuildingCompleted: '建筑完成',
  EmbargoChanged: '禁运变化', CrisisPhase: '危机阶段', StoryFlag: '剧情标记',
  AIError: 'AI 异常',
};

/** 告警优先级：type → 档位（high 危急红 / mid 警示琥珀 / low 通报青） */
const ALERT_PRIORITY = {
  WarDeclared: 'high', ColonyLost: 'high', ColonyFamine: 'high', CrisisPhase: 'high',
  BattleStarted: 'high',
  BattleEnded: 'mid', TreatyBreached: 'mid', FleetStranded: 'mid', ColonyBlackout: 'mid',
  ShipDestroyed: 'mid', ColonyShortage: 'mid',
};
const PRIORITY_COLOR = { high: '#e85f5f', mid: '#e8b04f', low: '#4fd8e8' };

export const EventsView = {
  id: 'events',
  title: '事件',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;

    root.innerHTML = '';
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.events') }));
    head.appendChild(el('span', { class: 'vf-grow' }));
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '待决事件需要裁决后才会恢复时间流动' }));

    this._body = el('div', { class: 'vf-view-body pad' });
    const wrap = el('div', { class: 'vf-view' }, [head, this._body]);
    root.appendChild(wrap);

    this._rebuild();
  },

  /** 快照推送：250ms 节流重建（无输入件，安全整体重建） */
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

  /** 整体重建：待决事件 → 告警 → 近期日志 */
  _rebuild() {
    const body = this._body;
    if (!body) return;
    clearEl(body);
    body.appendChild(this._pendingEventPanel());
    body.appendChild(this._alertsPanel());
    body.appendChild(this._feedPanel());
  },

  // —— 1) 待决事件卡 ————————————————————————————

  _pendingEventPanel() {
    const app = this.app;
    const ev = app.snapshot && app.snapshot.pendingEvent;
    const p = panel({ title: '待决事件', open: true });

    if (!ev) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '当前没有待裁决的事件。' }));
      return p;
    }

    p.appendChild(el('h3', { style: { margin: '4px 0', fontSize: '14px' }, text: ev.titleZh || '未命名事件' }));
    p.appendChild(el('div', {
      class: 'vf-dim vf-small',
      style: { whiteSpace: 'pre-wrap', marginBottom: '8px' },
      text: ev.bodyZh || '（无正文）',
    }));

    const choices = Array.isArray(ev.choices) ? ev.choices : [];
    if (!choices.length) {
      p.appendChild(el('div', { class: 'vf-warn vf-small', text: '该事件没有可选项（数据异常）。' }));
      return p;
    }
    for (const c of choices) {
      const btn = el('button', {
        class: 'vf-btn',
        type: 'button',
        style: { display: 'block', width: '100%', textAlign: 'left', marginTop: '6px' },
        title: '作出该裁决（ResolveEventChoice）',
        on: { click: () => this._resolveEvent(ev, c) },
      }, [
        el('div', { text: c.labelZh || c.id }),
        c.hintZh ? el('div', { class: 'vf-faint', style: { fontSize: '10px', textAlign: 'left' }, text: c.hintZh }) : null,
      ]);
      p.appendChild(btn);
    }
    return p;
  },

  /**
   * 事件裁决：dispatch('ResolveEventChoice', {eventId, choiceId})。
   * 命令尚未在主工程注册时 dispatch 返回 UNKNOWN_COMMAND —— 此时如实提示
   * 「该事件系统即将上线」，不伪造成功。
   */
  _resolveEvent(ev, choice) {
    const res = this.app.dispatch('ResolveEventChoice', {
      eventId: ev.eventId,
      choiceId: choice.id,
    });
    if (res && res.code === 'UNKNOWN_COMMAND') {
      toast('该事件系统即将上线', { kind: 'info' });
    }
  },

  // —— 2) 告警列表 ————————————————————————————

  _alertsPanel() {
    const snap = this.app.snapshot;
    const alerts = (snap && Array.isArray(snap.alerts)) ? snap.alerts : [];
    const p = panel({ title: `告警（${alerts.length}）`, open: true });

    if (!alerts.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '近 24 小时内无告警。' }));
      return p;
    }
    for (const a of alerts) {
      const level = ALERT_PRIORITY[a.type] || 'low';
      const row = el('div', {
        class: 'vf-row',
        role: 'button',
        tabindex: '0',
        style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '4px 2px', cursor: 'pointer' },
        title: this._jumpTitle(a.payload),
        on: { click: () => this._jumpFromPayload(a.payload) },
      }, [
        el('span', {
          style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '4px', background: PRIORITY_COLOR[level], flexShrink: '0' },
          'aria-hidden': 'true',
        }),
        el('span', { class: 'vf-tag', text: EVENT_TYPE_ZH[a.type] || a.type || '事件' }),
        el('span', { class: 'vf-small vf-grow', text: this._alertText(a) }),
        el('span', { class: 'vf-faint vf-small', text: dateStr(a.tick) }),
      ]);
      // 键盘激活（与点击一致）
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._jumpFromPayload(a.payload);
        }
      });
      p.appendChild(row);
    }
    return p;
  },

  /** 告警文本：类型 + payload 摘要（只读 world 解析名称） */
  _alertText(a) {
    const w = this.app.world;
    const pay = a.payload || {};
    const sysName = (id) => (w.entities.systems[id] && w.entities.systems[id].name) || id;
    const colonyName = (id) => {
      const c = w.entities.colonies[id];
      if (!c) return id;
      const planet = w.entities.planets[c.planetId];
      return (planet && planet.name) || id;
    };
    const facName = (id) => (w.entities.factions[id] && w.entities.factions[id].name) || id;
    switch (a.type) {
      case 'BattleStarted': return `${sysName(pay.systemId)} 爆发战斗`;
      case 'BattleEnded': return `${sysName(pay.systemId)} 的战斗已结束`;
      case 'WarDeclared': return `向 ${facName(pay.defenderId)} 宣战`;
      case 'ColonyLost': return `殖民地 ${colonyName(pay.colonyId)} 失守`;
      case 'ColonyFamine': return `殖民地 ${colonyName(pay.colonyId)} 发生饥荒`;
      case 'ColonyBlackout': return `殖民地 ${colonyName(pay.colonyId)} 电力中断`;
      case 'ColonyShortage': return `殖民地 ${colonyName(pay.colonyId)} 资源短缺`;
      case 'ColonyFounded': return `于 ${sysName(pay.systemId)} 建立殖民地`;
      case 'FleetStranded': return '舰队补给耗尽，就地受困';
      case 'ShipDestroyed': return '一艘舰船在战斗中被击毁';
      case 'TreatyBreached': return '条约被单方面违约';
      case 'TreatyExpired': return '一项条约已到期';
      case 'TreatySigned': return '一项条约已缔结';
      case 'AnomalyDetected': return `${sysName(pay.systemId)} 发现异常现象`;
      case 'FirstContact': return `与 ${facName(pay.factionId || pay.targetId)} 完成首次接触`;
      case 'TechCompleted': return `科技完成：${pay.techId || '未知'}`;
      default: return EVENT_TYPE_ZH[a.type] || a.type || '事件';
    }
  },

  /** 悬停提示：可跳转的目标类型说明 */
  _jumpTitle(payload) {
    const pay = payload || {};
    if (pay.systemId) return '点击定位该星系（银河地图）';
    if (pay.colonyId) return '点击打开该殖民地';
    if (pay.fleetId) return '点击打开该舰队';
    return '该告警无定位信息';
  },

  /** 告警跳转：systemId → select + goto galaxy；colonyId → colony；fleetId → fleet */
  _jumpFromPayload(payload) {
    const app = this.app;
    const pay = payload || {};
    if (pay.systemId) {
      app.select('system', pay.systemId);
      app.goto('galaxy');
      return;
    }
    if (pay.colonyId) {
      app.select('colony', pay.colonyId);
      app.goto('colony', pay.colonyId);
      return;
    }
    if (pay.fleetId) {
      app.select('fleet', pay.fleetId);
      app.goto('fleet', pay.fleetId);
    }
  },

  // —— 3) 近期事件日志 ————————————————————————————

  _feedPanel() {
    const feed = this.app.alertFeed() || []; // 最近在前（App 内已 reverse）
    const p = panel({ title: `近期事件（${Math.min(feed.length, 50)}）`, open: false });

    if (!feed.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无事件记录。' }));
      return p;
    }
    for (const e of feed.slice(0, 50)) {
      p.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.3)', padding: '2px 0' } }, [
        el('span', { class: 'vf-faint vf-small', text: dateStr(e.tick) }),
        el('span', { class: 'vf-tag', text: EVENT_TYPE_ZH[e.type] || e.type || '事件' }),
        el('span', { class: 'vf-dim vf-small vf-grow', style: { textAlign: 'right' }, text: e.category || '' }),
      ]));
    }
    return p;
  },
};
