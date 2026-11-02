/**
 * ui/shell/BottomBar.js — 底部信息带（任务书 6.1）：命令队列 / 告警 / 日志
 */

import { el } from '../components/dom.js';
import { L } from '../../core/i18n.js';
import { dateStr } from '../../core/clock.js';

export class BottomBar {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = '';
    this.panels = {};
    const defs = [
      ['queues', '队列与生产'],
      ['alerts', '告警'],
      ['log', '事件日志'],
    ];
    for (const [key, title] of defs) {
      const p = el('div', { class: 'vf-panel' });
      p.appendChild(el('div', { class: 'vf-panel-head', text: title }));
      const body = el('div', { class: 'vf-panel-body' });
      p.appendChild(body);
      this.root.appendChild(p);
      this.panels[key] = body;
    }
  }

  refresh() {
    const app = this.app;
    if (!app.world) {
      for (const k of Object.keys(this.panels)) this.panels[k].innerHTML = '';
      return;
    }
    const snap = app.snapshot;
    if (!snap) return;
    this.renderQueues(snap);
    this.renderAlerts(snap);
    this.renderLog();
  }

  renderQueues(snap) {
    const w = this.app.world;
    const box = this.panels.queues;
    box.innerHTML = '';
    let count = 0;
    // 船坞队列
    for (const sid of Object.keys(w.entities.stations).sort()) {
      const st = w.entities.stations[sid];
      for (const job of st.buildQueue || []) {
        if (count++ > 6) break;
        box.appendChild(el('div', { class: 'vf-log-line', text: `船坞：${w.entities.blueprints[job.blueprintId]?.name || '?'}（剩余 ${job.remainingHours}h）` }));
      }
    }
    // 建造队列
    for (const cid of Object.keys(w.entities.colonies).sort()) {
      const c = w.entities.colonies[cid];
      for (const job of c.constructionQueue || []) {
        if (count++ > 8) break;
        box.appendChild(el('div', { class: 'vf-log-line', text: `建造：${job.defId} @ ${w.entities.planets[c.planetId]?.name || cid}（${job.state}）` }));
      }
    }
    // 在途舰队
    for (const f of snap.fleets) {
      if (f.inTransit && count++ <= 10) {
        box.appendChild(el('div', { class: 'vf-log-line', text: `航行：${f.name} → ETA ${f.transitInfo?.eta ?? '?'}h` }));
      }
    }
    if (count === 0) box.appendChild(el('div', { class: 'vf-log-line vf-faint', text: '无进行中的队列' }));
  }

  renderAlerts(snap) {
    const box = this.panels.alerts;
    box.innerHTML = '';
    if (snap.alerts.length === 0) {
      box.appendChild(el('div', { class: 'vf-log-line vf-faint', text: '暂无告警' }));
      return;
    }
    for (const a of snap.alerts.slice(0, 6)) {
      const row = el('div', { class: `vf-alert-row prio-${prioOf(a)}` });
      row.appendChild(el('span', { class: 'prio' }));
      row.appendChild(el('span', { text: alertText(a) }));
      row.appendChild(el('span', { class: 'vf-faint vf-small vf-grow', text: dateStr(a.tick), style: { textAlign: 'right' } }));
      row.addEventListener('click', () => jumpToAlert(this.app, a));
      box.appendChild(row);
    }
  }

  renderLog() {
    const box = this.panels.log;
    box.innerHTML = '';
    const feed = this.app.alertFeed().slice(0, 12);
    if (feed.length === 0) {
      box.appendChild(el('div', { class: 'vf-log-line vf-faint', text: '事件日志为空' }));
      return;
    }
    for (const e of feed) {
      const line = el('div', { class: `vf-log-line ${logTone(e.type)}` });
      line.appendChild(el('span', { class: 't', text: dateStr(e.tick).replace('星历', '') }));
      line.appendChild(el('span', { text: shortEventText(e) }));
      box.appendChild(line);
    }
  }
}

function prioOf(a) {
  if (['BattleStarted', 'WarDeclared', 'ColonyLost'].includes(a.type)) return 'high';
  if (['FleetStranded', 'ColonyFamine', 'TreatyBreached'].includes(a.type)) return 'mid';
  return 'low';
}

function alertText(a) {
  const w = null;
  switch (a.type) {
    case 'BattleStarted': return '战斗开始';
    case 'BattleEnded': return '战斗结束';
    case 'FleetStranded': return '舰队燃料耗尽受困';
    case 'ColonyFamine': return '殖民地饥荒';
    case 'ColonyLost': return '殖民地失联';
    case 'TreatyBreached': return '条约被违反';
    case 'TreatyExpired': return '条约到期';
    case 'WarDeclared': return '宣战';
    case 'AnomalyDetected': return '发现异常信号';
    case 'FirstContact': return '首次接触';
    case 'TechCompleted': return '科研完成';
    case 'ShipDestroyed': return '舰船损失';
    default: return a.type;
  }
}

function jumpToAlert(app, a) {
  const payload = a.payload || {};
  if (payload.systemId) {
    app.select('system', payload.systemId);
    app.goto('galaxy');
  } else if (payload.colonyId) {
    app.select('colony', payload.colonyId);
    app.goto('colony', payload.colonyId);
  } else if (payload.fleetId) {
    app.select('fleet', payload.fleetId);
    app.goto('fleet');
  }
}

function logTone(type) {
  if (['ShipDestroyed', 'ColonyLost', 'WarDeclared', 'ColonyFamine'].includes(type)) return 'danger';
  if (['FleetStranded', 'TreatyBreached', 'BattleStarted'].includes(type)) return 'warn';
  if (['TechCompleted', 'AnomalyResolved', 'ColonyFounded'].includes(type)) return 'good';
  return '';
}

function shortEventText(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'ColonyFounded': return `建立殖民地`;
    case 'FleetArrived': return `舰队抵达`;
    case 'FleetDeparted': return `舰队启程`;
    case 'SystemSurveyed': return `星系调查完成`;
    case 'AnomalyDetected': return `检测到异常`;
    case 'AnomalyResolved': return `异常调查完成`;
    case 'TechCompleted': return `科技完成`;
    case 'BuildingCompleted': return `建筑完工`;
    case 'ShipCompleted': return `舰船建成`;
    case 'TreatySigned': return `条约签署`;
    case 'WarDeclared': return `宣战`;
    case 'FirstContact': return `首次接触`;
    default: return e.type;
  }
}
