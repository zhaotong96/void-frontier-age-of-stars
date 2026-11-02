/**
 * ui/screens/CombatView.js — 战术战斗视图（路由 #/combat/<battleId>）
 *
 * 布局：.vf-view > .vf-view-head（返回 + 标题 + 星系名/战斗时间 + 全局时间控制 +
 *       撤退按钮）+ .vf-view-body（左 2/3 战斗画布 BattleRenderer +
 *       右 1/3 信息列：单位检视 / 战斗事件时间线 / 双方损失）。
 *
 * 行为：
 *  - param 缺省时取 snapshot.battles[0]?.id；无战斗 → 「当前无战斗」+ 活跃战斗列表；
 *  - 战斗结束（battleView 返回 null）→ 「战斗已结束」+ world.battles.history
 *    只读摘要（优先匹配该 battleId，否则取最新一条）；
 *  - 时间控制复用 app.setSpeed（0–4 全局速度档），附「暂停战斗建议」提示文案；
 *  - 撤退：对玩家一侧舰队 dispatch('OrderFleetRetreat', {fleetId})；fleetId 从
 *    world.battles.active[id].fleetIds 按玩家 factionId 所在一侧只读取得
 *    （battleView 未暴露 fleetIds，此处经许可的只读世界查询补齐）；
 *  - 点击画布单位 → 右侧检视（名称/船体/护盾/装甲/结构/航向/命令）；
 *    悬停单位 → 画布名字标签（BattleRenderer）。
 *
 * 数据来源纪律：battleView / snapshot 只读消费；装甲与撤退蓄能等 battleView
 * 未暴露的字段经只读 world 查询补齐，绝不写世界状态。
 * onSnapshot 250ms 节流；unmount 停 rAF、移除画布监听并 dispose 画布。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { L } from '../../core/i18n.js';
import { parseHash } from '../../app/Router.js';
import { SPEEDS, dateStr } from '../../core/clock.js';
import { BAL } from '../../content/constants.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { BattleRenderer } from '../../render/BattleRenderer.js';
import { battleView } from '../../simulation/ViewModels.js';

/** 战斗事件类型中文映射（未知类型回退原文） */
const BATTLE_EVENT_ZH = {
  miss: '偏差',
  destroyed: '击毁',
  intercept: '拦截',
};

/** 单位命令中文映射 */
const ORDER_ZH = {
  engage: '交战', keepDistance: '保持距离', retreat: '撤退中', protect: '护航',
};

/** 战斗时间（战斗秒）→ m:ss 文本 */
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 角度（弧度）→ 罗盘方位中文 */
function headingText(rad) {
  const deg = ((Number(rad) || 0) * 180) / Math.PI;
  const names = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${names[idx]}（${Math.round(((deg % 360) + 360) % 360)}°）`;
}

export const CombatView = {
  id: 'combat',
  title: '战斗',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;
    this._battleId = (ctx && ctx.param) || null;
    this._selectedShipId = null;
    this._hoverShipId = null;
    this._data = null;        // battleView() 只读数据缓存（onSnapshot 刷新）
    this._raf = 0;
    this._handlers = {};
    this._unsubResize = null;

    root.innerHTML = '';

    // —— 头部 ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('button', {
      class: 'vf-btn small',
      text: '← 返回',
      title: '返回银河地图',
      on: { click: () => app.goto('galaxy') },
    }));
    this._titleEl = el('h2', { text: L('ui.combat') });
    head.appendChild(this._titleEl);
    this._statusEl = el('span', { class: 'vf-dim vf-small', text: '' });
    head.appendChild(this._statusEl);
    head.appendChild(el('span', { class: 'vf-grow' }));

    // —— 时间控制：复用全局速度档（0-4），交战中建议暂停观察 ——
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '时间' }));
    this._speedBtns = [];
    SPEEDS.forEach((sp, idx) => {
      const b = el('button', {
        class: 'vf-btn small',
        text: sp.label,
        title: `全局时间倍率：${sp.label}（空格切换暂停）`,
        on: { click: () => app.setSpeed(idx) },
      });
      this._speedBtns.push(b);
      head.appendChild(b);
    });
    head.appendChild(el('span', { class: 'vf-faint vf-small', text: '提示：战斗持续进行，建议暂停逐帧观察' }));

    // —— 撤退按钮 ——
    this._retreatBtn = el('button', {
      class: 'vf-btn small danger',
      text: '全体撤退',
      title: '命令本方舰队跃迁撤离（蓄能后脱离战斗）',
      disabled: true,
      on: { click: () => this._orderRetreat() },
    });
    head.appendChild(this._retreatBtn);

    // —— 主体：左画布 + 右信息列 ——
    const body = el('div', { class: 'vf-view-body', style: { display: 'flex', overflow: 'hidden' } });
    const left = el('div', { style: { flex: '2 1 0', position: 'relative', minWidth: '0' } });
    this._infoCol = el('div', {
      style: { flex: '1 1 0', minWidth: '300px', overflowY: 'auto', padding: '10px', borderLeft: '1px solid var(--line)' },
    });
    body.appendChild(left);
    body.appendChild(this._infoCol);

    this._cm = new CanvasManager().attach(left);
    this._renderer = new BattleRenderer().init(this._cm);
    this._unsubResize = this._cm.onResize(() => {
      if (this._mounted) this._drawFrame();
    });

    const wrap = el('div', { class: 'vf-view' }, [head, body]);
    root.appendChild(wrap);

    // —— 画布交互：点击选中 / 悬停名字 ——
    const canvas = this._cm.canvas;
    const onCanvasClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = this._renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
      this._selectedShipId = hit || null;
      this._renderer.setSelection(hit);
      this._buildInfoColumn();
    };
    const onCanvasMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = this._renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
      if (hit !== this._hoverShipId) {
        this._hoverShipId = hit;
        this._renderer.setHover(hit);
      }
    };
    const onCanvasLeave = () => {
      this._hoverShipId = null;
      this._renderer.setHover(null);
    };
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousemove', onCanvasMove);
    canvas.addEventListener('mouseleave', onCanvasLeave);
    this._handlers = [
      { target: canvas, type: 'click', fn: onCanvasClick },
      { target: canvas, type: 'mousemove', fn: onCanvasMove },
      { target: canvas, type: 'mouseleave', fn: onCanvasLeave },
    ];

    this._resolveBattleId();
    this._refreshAll();

    // —— 渲染循环：仅 mounted 期间运行 ——
    const loop = () => {
      if (!this._mounted) return;
      this._raf = requestAnimationFrame(loop);
      this._drawFrame();
    };
    this._raf = requestAnimationFrame(loop);
  },

  /** 快照推送：路由参数变化时切换战斗；否则 250ms 节流刷新 */
  onSnapshot() {
    if (!this._mounted) return;
    const route = parseHash();
    if (route.screen === 'combat' && (route.param || null) !== this._battleId) {
      this._battleId = route.param || null;
      this._selectedShipId = null;
      this._refreshAll();
      return;
    }
    const now = performance.now();
    if (now - this._lastRefresh < 250) return;
    this._lastRefresh = now;
    this._refreshAll();
  },

  /** 卸载：停循环、移除监听、释放画布与引用 */
  unmount() {
    this._mounted = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    for (const h of this._handlers || []) {
      h.target.removeEventListener(h.type, h.fn);
    }
    this._handlers = [];
    if (this._unsubResize) {
      this._unsubResize();
      this._unsubResize = null;
    }
    if (this._cm) {
      this._cm.dispose();
      this._cm = null;
    }
    this._renderer = null;
    this._data = null;
    this._infoCol = null;
    this._speedBtns = [];
  },

  // —— 内部实现 ——————————————————————————————————

  /** 确定 battleId：param 缺省时回落到 snapshot.battles[0]?.id */
  _resolveBattleId() {
    if (this._battleId) return;
    const snap = this.app.snapshot;
    const first = snap && Array.isArray(snap.battles) ? snap.battles[0] : null;
    if (first) this._battleId = first.id;
  },

  /** 整体刷新：重建数据缓存 + 头部状态 + 右侧信息列 */
  _refreshAll() {
    this._resolveBattleId();
    const w = this.app.world;
    // battleView 对已结束/不存在的战斗返回 null（战斗结束判定依据）
    this._data = this._battleId ? battleView(w, this._battleId) : null;
    this._updateHead();
    this._buildInfoColumn();
  },

  /** 头部：标题/星系名/时间档高亮/撤退按钮可用性 */
  _updateHead() {
    const app = this.app;
    const d = this._data;
    if (d) {
      this._titleEl.textContent = `${L('ui.combat')} · ${d.systemName || '未知星系'}`;
      this._statusEl.textContent = `战斗时间 ${fmtTime(d.time)}`;
      const fleetId = this._playerFleetId();
      this._retreatBtn.disabled = !fleetId;
      this._retreatBtn.title = fleetId
        ? '命令本方舰队跃迁撤离（蓄能后脱离战斗）'
        : '本方舰队未参与该战斗';
    } else {
      this._titleEl.textContent = L('ui.combat');
      this._statusEl.textContent = this._battleId ? '战斗已结束' : '当前无战斗';
      this._retreatBtn.disabled = true;
      this._retreatBtn.title = '当前没有可撤退的参战舰队';
    }
    // 速度档高亮（复用全局 speedIdx）
    this._speedBtns.forEach((b, idx) => {
      b.classList.toggle('primary', idx === app.speedIdx);
    });
  },

  /** 玩家一侧的舰队 id：world.battles.active[id].fleetIds 按阵营只读匹配 */
  _playerFleetId() {
    const w = this.app.world;
    if (!w || !this._battleId) return null;
    const b = w.battles.active[this._battleId];
    if (!b || !b.fleetIds) return null;
    const side = b.sides && b.sides.a === w.playerFactionId ? 'a'
      : (b.sides && b.sides.b === w.playerFactionId ? 'b' : null);
    return side ? b.fleetIds[side] : null;
  },

  /** 撤退命令：对玩家一侧舰队下 OrderFleetRetreat */
  _orderRetreat() {
    const fleetId = this._playerFleetId();
    if (!fleetId) return;
    this.app.dispatch('OrderFleetRetreat', { fleetId });
  },

  /** 双方着色：玩家方用势力色，敌方红系；双方均非玩家（观战）时各用势力色 */
  _sideColors() {
    const w = this.app.world;
    const d = this._data;
    if (!w || !d) return { a: '#4fd8e8', b: '#e85f5f' };
    const pid = w.playerFactionId;
    const colorOf = (fid) => (w.entities.factions[fid] && w.entities.factions[fid].color) || '#71839a';
    const playerIn = d.sides.a === pid || d.sides.b === pid;
    if (!playerIn) return { a: colorOf(d.sides.a), b: colorOf(d.sides.b) };
    const playerColor = colorOf(pid);
    return {
      a: d.sides.a === pid ? playerColor : '#e85f5f',
      b: d.sides.b === pid ? playerColor : '#e85f5f',
    };
  },

  /** 撤退蓄能进度（battleView 未暴露，经只读 world 查询补齐；total 来自 BAL） */
  _retreatCharges() {
    const w = this.app.world;
    if (!w || !this._battleId) return {};
    const b = w.battles.active[this._battleId];
    if (!b || !Array.isArray(b.units)) return {};
    const total = (BAL.combat && BAL.combat.retreatChargeSeconds) || 0;
    const map = {};
    for (const u of b.units) {
      if (u && u.order === 'retreat' && !u.destroyed) {
        map[u.shipId] = { charge: Number(u.retreatCharge) || 0, total };
      }
    }
    return map;
  },

  /** 渲染一帧战斗视图（数据来自 onSnapshot 缓存） */
  _drawFrame() {
    const cm = this._cm;
    const r = this._renderer;
    if (!cm || !r || cm.width < 2 || cm.height < 2) return;
    cm.beginFrame();
    r.render(cm.ctx, cm.width, cm.height, this._data, {
      sideColors: this._sideColors(),
      selectedShipId: this._selectedShipId,
      hoverShipId: this._hoverShipId,
      retreatCharges: this._retreatCharges(),
    });
  },

  // —— 右侧信息列 ——————————————————————————————————

  _buildInfoColumn() {
    const col = this._infoCol;
    if (!col) return;
    clearEl(col);
    const d = this._data;
    const w = this.app.world;

    if (!d) {
      // —— 战斗结束 / 无战斗 ——
      col.appendChild(panel({
        title: this._battleId ? '战斗已结束' : '当前无战斗',
        content: el('div', { class: 'vf-faint vf-small', text: this._battleId
          ? '该战斗已脱离活跃列表（全歼 / 全员撤离 / 结算完成）。'
          : '当前星域没有正在进行的战斗。' }),
      }));
      this._buildHistorySummary(col);
      this._buildBattleList(col);
      return;
    }

    // —— 1) 单位检视 ——
    col.appendChild(this._unitPanel(d));

    // —— 2) 双方损失统计 ——
    const colorOf = (fid) => (w.entities.factions[fid] && w.entities.factions[fid].name) || fid;
    const lossP = panel({ title: '损失统计', open: true, dense: true });
    lossP.appendChild(kvList([
      [`${colorOf(d.sides.a)}（a 方）损失`, d.losses ? d.losses.a : 0],
      [`${colorOf(d.sides.b)}（b 方）损失`, d.losses ? d.losses.b : 0],
    ]));
    col.appendChild(lossP);

    // —— 3) 战斗事件时间线（最近 30 条） ——
    const evP = panel({ title: '战斗事件', open: true, dense: true });
    const evs = (d.events || []).slice(-30).reverse(); // 最新在上
    if (!evs.length) {
      evP.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无战斗事件。' }));
    }
    for (const e of evs) {
      const label = BATTLE_EVENT_ZH[e.type] || e.type || '事件';
      evP.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '2px 0' } }, [
        el('span', { class: 'vf-tag', text: label }),
        el('span', { class: 'vf-small', text: e.text || '' }),
        el('span', { class: 'vf-faint vf-small vf-grow', style: { textAlign: 'right' }, text: `${fmtTime(e.t)}` }),
      ]));
    }
    col.appendChild(evP);
  },

  /** 单位检视面板（点击画布选中后展示；装甲经只读 world 补齐） */
  _unitPanel(d) {
    const w = this.app.world;
    const p = panel({ title: '单位检视', open: true, dense: true });
    const u = this._selectedShipId
      ? (d.units || []).find((x) => x.shipId === this._selectedShipId)
      : null;
    if (!u) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '点击战场中的舰船查看详情。' }));
      return p;
    }
    // 装甲值 battleView 未提供：从舰船实体只读补齐
    const ship = w.entities.ships[u.shipId];
    const armor = ship ? Math.round(ship.hp.armor) : '—';
    const sideName = d.sides[u.side] || u.side;
    const facName = (w.entities.factions[sideName] && w.entities.factions[sideName].name) || sideName;
    p.appendChild(kvList([
      ['名称', u.name || '未知'],
      ['船体', u.hullName || '?'],
      ['所属', facName],
      ['护盾', `${u.shield} / ${u.shieldMax}`],
      ['装甲', armor],
      ['结构', `${u.structure} / ${u.structureMax}`],
      ['航向', headingText(u.heading)],
      ['命令', ORDER_ZH[u.order] || u.order || '—'],
    ]));
    return p;
  },

  /** 战报摘要：world.battles.history 只读（优先匹配当前 battleId，否则最新一条） */
  _buildHistorySummary(col) {
    const w = this.app.world;
    if (!w || !Array.isArray(w.battles.history) || !w.battles.history.length) return;
    const h = w.battles.history.find((x) => x.id === this._battleId)
      || w.battles.history[w.battles.history.length - 1];
    const p = panel({ title: `战报摘要 · ${h.id}`, open: true, dense: true });
    const sysName = (w.entities.systems[h.systemId] && w.entities.systems[h.systemId].name) || h.systemId;
    const nameOf = (fid) => (w.entities.factions[fid] && w.entities.factions[fid].name) || fid || '—';
    const winner = h.winnerSide
      ? `${nameOf(h.sides ? h.sides[h.winnerSide] : null)}（${h.winnerSide === 'a' ? 'a 方' : 'b 方'}）`
      : '无（超时 / 双方脱离）';
    p.appendChild(kvList([
      ['星系', sysName],
      ['开始', dateStr(h.startedTick)],
      ['结束', dateStr(h.endedTick)],
      ['历时', `${h.durationSeconds ?? '—'} 战斗秒`],
      ['获胜方', winner],
      ['初始兵力', `a×${(h.initial && h.initial.a) ?? '—'} / b×${(h.initial && h.initial.b) ?? '—'}`],
      ['损失', `a×${(h.losses && h.losses.a) ?? 0} / b×${(h.losses && h.losses.b) ?? 0}`],
      ['输出伤害', `a×${(h.damageDealt && h.damageDealt.a) ?? 0} / b×${(h.damageDealt && h.damageDealt.b) ?? 0}`],
    ]));
    col.appendChild(p);
  },

  /** 活跃战斗列表（snapshot.battles，可点击跳转） */
  _buildBattleList(col) {
    const snap = this.app.snapshot;
    const list = (snap && Array.isArray(snap.battles)) ? snap.battles : [];
    const p = panel({ title: `活跃战斗（${list.length}）`, open: true, dense: true });
    if (!list.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '当前没有活跃战斗。' }));
      col.appendChild(p);
      return;
    }
    const w = this.app.world;
    for (const b of list) {
      const sysName = (w.entities.systems[b.systemId] && w.entities.systems[b.systemId].name) || b.systemId;
      const isCurrent = b.id === this._battleId;
      p.appendChild(el('button', {
        class: 'vf-btn small' + (isCurrent ? ' primary' : ''),
        type: 'button',
        style: { display: 'block', width: '100%', textAlign: 'left', marginTop: '4px' },
        title: isCurrent ? '当前查看的战斗' : `跳转到该战斗（${sysName}）`,
        on: { click: () => this.app.goto('combat', b.id) },
      }, [`${b.id} · ${sysName} · ${fmtTime(b.time)}`]));
    }
    col.appendChild(p);
  },
};
