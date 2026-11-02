/**
 * ui/shell/Inspector.js — 右侧上下文检视器（任务书 6.4：所有重要数字可解释）
 */

import { el } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { progressBar } from '../components/progress.js';
import { L } from '../../core/i18n.js';
import { dateStr } from '../../core/clock.js';
import { getRelation } from '../../domain/diplomacy/war.js';

export class Inspector {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.root.innerHTML = '';
    this.body = el('div', { class: 'vf-col' });
    this.root.appendChild(this.body);
  }

  render(snap) {
    const app = this.app;
    if (!app.inGame || !snap) {
      this.body.innerHTML = '';
      this.body.appendChild(el('div', { class: 'vf-faint vf-center mt-3', text: '未进入战役' }));
      return;
    }
    const sel = app.selection;
    this.body.innerHTML = '';
    if (!sel) {
      this.body.appendChild(this.defaultPanel(snap));
      return;
    }
    const w = app.world;
    if (sel.kind === 'system') {
      const sys = w.entities.systems[sel.id];
      if (!sys) {
        this.body.appendChild(el('div', { class: 'vf-warn', text: '目标已失效' }));
        return;
      }
      this.renderSystem(sys, snap);
    } else if (sel.kind === 'fleet') {
      const fleet = w.entities.fleets[sel.id];
      if (!fleet) {
        this.body.appendChild(el('div', { class: 'vf-warn', text: '目标已失效' }));
        return;
      }
      this.renderFleet(fleet);
    } else if (sel.kind === 'colony') {
      const colony = w.entities.colonies[sel.id];
      if (colony) this.renderColony(colony);
    } else if (sel.kind === 'faction') {
      const fac = w.entities.factions[sel.id];
      if (fac) this.renderFaction(fac, snap);
    }
  }

  defaultPanel(snap) {
    const app = this.app;
    const wrap = el('div');
    wrap.appendChild(el('h3', { text: '总览' }));
    if (snap.player) {
      wrap.appendChild(kvList([
        ['文明', snap.player.name],
        ['星系数', `${snap.systems.length}`],
        ['已知舰队', `${snap.fleets.length}`],
        ['殖民地', `${snap.colonies.length}`],
      ]));
    }
    wrap.appendChild(el('div', { class: 'vf-faint vf-small mt-2', text: '在地图或列表中选择实体查看详情。' }));
    return wrap;
  }

  renderSystem(sys, snap) {
    const app = this.app;
    const w = app.world;
    const body = el('div');
    body.appendChild(el('h3', { text: `星系 · ${sys.name}` }));
    const lvl = sys.surveyedBy[w.playerFactionId] ?? 0;
    body.appendChild(kvList([
      ['恒星', sys.star.name],
      ['调查层级', ['未接触', '侦测', '分类', '定位', '调查完成'][lvl]],
      ['归属', sys.ownerFactionId ? w.entities.factions[sys.ownerFactionId]?.name : '无主'],
      ['行星', `${sys.planetIds.length}`],
      ['危险度', `${sys.dangerRating}/10`],
      ['资源评级', `${sys.resourceRating}/10`],
    ]));
    if (lvl >= 2) {
      // 行星列表
      const rows = sys.planetIds.map((pid) => w.entities.planets[pid]);
      for (const p of rows) {
        const pe = panel({
          title: `${p.name} · ${p.categoryName}`,
          open: false,
          dense: true,
        });
        const pb = pe.querySelector('.vf-panel-body') || pe.lastChild;
        pb.appendChild(kvList([
          ['宜居度', `${p.habitability}`],
          ['重力', `${p.gravity}g`],
          ['大气', p.atmosphere],
          ['殖民地', p.colonyId ? '已建立' : '无'],
        ]));
        if (p.colonyId) {
          pb.appendChild(el('button', {
            class: 'vf-btn small mt-1',
            text: '打开殖民地',
            on: { click: () => { app.select('colony', p.colonyId); app.goto('colony', p.colonyId); } },
          }));
        } else if (lvl >= 3 && p.habitability >= 20) {
          pb.appendChild(el('button', {
            class: 'vf-btn small mt-1 primary',
            text: '建立前哨（合金20 信用150）',
            on: { click: () => app.dispatch('FoundOutpost', { planetId: p.id }, null, {}) },
          }));
        }
        body.appendChild(pe);
      }
    }
    // 本星系舰队
    const fleets = Object.values(w.entities.fleets).filter((f) => f.systemId === sys.id);
    if (fleets.length) {
      body.appendChild(el('div', { class: 'vf-dim vf-small mt-2', text: `在系舰队：${fleets.map((f) => f.name).join('、')}` }));
    }
    this.body.appendChild(body);
  }

  renderFleet(fleet) {
    const app = this.app;
    const w = app.world;
    const body = el('div');
    body.appendChild(el('h3', { text: `舰队 · ${fleet.name}` }));
    body.appendChild(kvList([
      ['舰船数', `${fleet.shipIds.length}`],
      ['位置', fleet.systemId ? (w.entities.systems[fleet.systemId]?.name || '—') : '在途'],
      ['状态', fleet.status || 'idle'],
      ['姿态', fleet.stance],
      ['补给日', `${Math.round(fleet.supplyDays)}`],
    ]));
    if (fleet.transit) {
      body.appendChild(progressBar({
        value: fleet.transit.legProgress,
        max: fleet.transit.legEta,
        label: `航行中 → ${w.entities.systems[fleet.transit.path[fleet.transit.path.length - 1]]?.name || '?'}`,
      }));
    }
    // 命令按钮
    const btns = el('div', { class: 'vf-col mt-2' });
    if (fleet.systemId) {
      const here = w.entities.systems[fleet.systemId];
      for (const nid of here.lanes.slice(0, 4)) {
        const ns = w.entities.systems[nid];
        btns.appendChild(el('button', {
          class: 'vf-btn small',
          text: `移动 → ${ns.name}`,
          on: { click: () => app.dispatch('OrderFleetMove', { fleetId: fleet.id, targetSystemId: nid }) },
        }));
      }
      // 扫描相邻未调查星系
      for (const nid of here.lanes.slice(0, 3)) {
        const ns = w.entities.systems[nid];
        const lvl = ns.surveyedBy[w.playerFactionId] ?? 0;
        if (lvl < 4) {
          btns.appendChild(el('button', {
            class: 'vf-btn small primary',
            text: `扫描 ${ns.name}（层级 ${lvl}/4）`,
            on: { click: () => app.dispatch('IssueScanOrder', { fleetId: fleet.id, targetSystemId: nid }) },
          }));
          break;
        }
      }
    }
    body.appendChild(btns);
    this.body.appendChild(body);
  }

  renderColony(colony) {
    const app = this.app;
    const w = app.world;
    const body = el('div');
    const planet = w.entities.planets[colony.planetId];
    body.appendChild(el('h3', { text: `殖民地 · ${planet?.name || colony.id}` }));
    body.appendChild(kvList([
      ['人口', `${colony.population.total}`],
      ['住房', `${colony.housing}`],
      ['稳定度', `${colony.stability}`],
      ['能源平衡', `${colony.powerBalance ?? 0}`],
      ['类型', colony.isOutpost ? '前哨' : '殖民地'],
    ]));
    const stock = el('div', { class: 'vf-kv mt-2' });
    for (const rid of Object.keys(colony.stockpile || {}).sort()) {
      if ((colony.stockpile[rid] ?? 0) <= 0) continue;
      stock.appendChild(el('span', { class: 'k', text: rid }));
      stock.appendChild(el('span', { class: 'v', text: String(Math.round(colony.stockpile[rid])) }));
    }
    body.appendChild(stock);
    if (colony.isOutpost) {
      body.appendChild(el('button', {
        class: 'vf-btn primary mt-2',
        text: '升级为殖民地（合金30 信用220）',
        on: { click: () => app.dispatch('UpgradeColony', { colonyId: colony.id }) },
      }));
    }
    this.body.appendChild(body);
  }

  renderFaction(fac, snap) {
    const w = this.app.world;
    const body = el('div');
    body.appendChild(el('h3', { text: `文明 · ${fac.name}` }));
    const rel = getRelation(w, w.playerFactionId, fac.id);
    body.appendChild(kvList([
      ['人格', fac.personality],
      ['接触状态', rel.contactState],
      ['好感', `${Math.round(rel.opinion)}`],
      ['信任', `${Math.round(rel.trust)}`],
      ['威胁感知', `${Math.round(rel.threat)}`],
      ['边境紧张', `${Math.round(rel.borderTension)}`],
    ]));
    this.body.appendChild(body);
  }
}
