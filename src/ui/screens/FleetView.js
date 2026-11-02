/**
 * ui/screens/FleetView.js — 舰队管理视图（任务书 6.2 fleetDetail）
 *
 * 结构：.vf-view > .vf-view-head（标题 + 舰队下拉 + 名称/状态 + 姿态按钮组 + 战斗入口）
 *            + .vf-view-body.pad（两列 grid：舰船列表 / 命令面板）
 *
 * 数据来源：simulation/ViewModels.fleetDetail 与 shipSummary（只读）+ 快照
 * fleets/systems/battles 列表；「同星系无舰队舰船」通过 app.world 只读查询
 * entities.ships（绝不写世界字段）。
 * 命令：SetFleetStance / OrderFleetMove / IssueScanOrder / AssembleFleet。
 * 战斗处理约定：战斗在战斗视图进行——存在 active battle 时显示
 * 「战斗进行中 → 前往战斗视图」按钮（app.goto('combat', battleId)，battleId
 * 优先取本星系战斗，否则取 snapshot.battles[0]），本视图不直接下达撤退命令。
 * 刷新：onSnapshot 250ms 节流，重建前后保留滚动位置；全部监听随 unmount 清理。
 */

import { el, clearEl } from '../components/dom.js';
import { dataTable, panel, kvList, statBar, progressBar } from '../components/index.js';
import { L } from '../../core/i18n.js';
import { fleetDetail, shipSummary } from '../../simulation/ViewModels.js';

/** 快照刷新节流间隔 */
const REFRESH_MS = 250;

/** 交战姿态定义（键序即按钮序） */
const STANCE_DEFS = [
  ['hold', '固守'],
  ['patrol', '巡逻'],
  ['aggressive', '强攻'],
  ['escort', '护航'],
];

/** 舰队状态 → [中文, vf-tag 色调]（transit 状态在渲染时另行覆盖） */
const FLEET_STATUS_ZH = {
  idle: ['待命', 'ok'],
  in_transit: ['在途', 'accent'],
  engaged: ['交战中', 'danger'],
  stranded: ['失路', 'danger'],
  dissolved: ['已解散', 'danger'],
};

/** 舰船状态 → [中文, 色调] */
const SHIP_STATUS_ZH = {
  active: ['现役', 'ok'],
  disabled: ['失能', 'warn'],
  captured: ['被俘', 'danger'],
  destroyed: ['损毁', 'danger'],
};

/** 舰队角色中文 */
const ROLE_ZH = {
  combat: '战斗', science: '科学', mining: '采矿', trade: '贸易', colony: '殖民',
};

export const FleetView = {
  id: 'fleet',
  title: '舰队',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._snap = app.snapshot || null;
    this._lastAt = -REFRESH_MS; // 负值哨兵：保证首次快照必刷（不受页面加载耗时影响）
    this._force = false;
    this._handlers = [];

    // param 为空时在 _refresh 中回退到玩家第一支舰队
    this._fleetId = typeof ctx.param === 'string' && ctx.param ? ctx.param : null;

    root.innerHTML = '';

    // —— 头部 ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.fleet') }));
    this._selFleet = el('select', { 'aria-label': '切换舰队', style: { maxWidth: '180px' } });
    this._bind(this._selFleet, 'change', () => {
      if (!this._selFleet.value) return;
      this._fleetId = this._selFleet.value;
      app.select('fleet', this._fleetId); // 检视器联动（只读 UI 状态）
      app.goto('fleet', this._fleetId);   // URL 同步 + 触发刷新
    });
    head.appendChild(this._selFleet);
    this._headDyn = el('div', { class: 'vf-row vf-grow', style: { gap: '8px' } });
    head.appendChild(this._headDyn);

    // —— 主体：两列 grid ——
    const body = el('div', { class: 'vf-view-body pad' });
    this._bodyEl = body;
    this._grid = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: '10px',
        alignItems: 'start',
      },
    });
    this._colShips = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });
    this._colCmd = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });
    this._grid.append(this._colShips, this._colCmd);
    body.appendChild(this._grid);

    root.appendChild(el('div', { class: 'vf-view' }, [head, body]));

    if (this._snap) {
      this.onSnapshot(this._snap);
    }
  },

  /** 卸载：移除持久监听并释放引用 */
  unmount() {
    this._mounted = false;
    for (const { target, type, fn } of this._handlers) {
      target.removeEventListener(type, fn);
    }
    this._handlers = [];
    this._snap = null;
    this._selFleet = null;
    this._headDyn = null;
    this._bodyEl = null;
    this._grid = null;
    this._colShips = this._colCmd = null;
  },

  /** 快照推送：250ms 节流；_force 绕过节流（命令后即时反馈） */
  onSnapshot(snap) {
    if (!this._mounted) return;
    this._snap = snap || this._snap;
    const now = performance.now();
    if (!this._force && now - this._lastAt < REFRESH_MS) return;
    this._lastAt = now;
    this._force = false;
    this._refresh(this._snap);
  },

  // —— 内部实现 ——————————————————————————————————

  /** 登记持久监听（unmount 时统一移除） */
  _bind(target, type, fn) {
    target.addEventListener(type, fn);
    this._handlers.push({ target, type, fn });
  },

  /** 命令后的即时重绘 */
  _forceRefresh() {
    this._force = true;
    this.onSnapshot(this.app.snapshot || this._snap);
  },

  /** 快照中的己方舰队（只读过滤） */
  _ownFleets(snap) {
    const pid = this.app.world && this.app.world.playerFactionId;
    return (snap && Array.isArray(snap.fleets))
      ? snap.fleets.filter((f) => f.factionId === pid)
      : [];
  },

  /** 校正当前舰队 id（舰队解散/失效时回退到第一支） */
  _ensureFleetId(snap) {
    const list = this._ownFleets(snap);
    if (!list.some((f) => f.id === this._fleetId)) {
      this._fleetId = list.length ? list[0].id : null;
    }
    return list;
  },

  /** 重建数据区：保留滚动位置 */
  _refresh(snap) {
    if (!this._bodyEl) return;
    const savedTop = this._bodyEl.scrollTop;
    const savedLeft = this._bodyEl.scrollLeft;

    const list = this._ensureFleetId(snap);

    if (this._selFleet) {
      clearEl(this._selFleet);
      for (const f of list) {
        this._selFleet.appendChild(el('option', { value: f.id, text: f.name }));
      }
      if (this._fleetId) this._selFleet.value = this._fleetId;
      this._selFleet.disabled = list.length === 0 ? true : null;
    }

    const detail = this._fleetId && this.app.world
      ? fleetDetail(this.app.world, this._fleetId)
      : null;

    this._renderHead(detail, list);
    clearEl(this._colShips);
    clearEl(this._colCmd);

    if (!detail) {
      clearEl(this._bodyEl).appendChild(el('div', {
        class: 'vf-faint vf-center', style: { padding: '40px 0' },
        text: list.length === 0 ? '没有可指挥的舰队——在船坞建造舰船后自动编组。' : '目标舰队已失效。',
      }));
      return;
    }
    this._bodyEl.appendChild(this._grid);
    this._renderShips(detail);
    this._renderCommands(detail, snap);

    this._bodyEl.scrollTop = savedTop;
    this._bodyEl.scrollLeft = savedLeft;
  },

  /** 头部动态区：名称 / 状态标签 / 姿态按钮组 / 战斗入口 */
  _renderHead(detail, list) {
    if (!this._headDyn) return;
    clearEl(this._headDyn);
    if (!detail) return;

    this._headDyn.appendChild(el('strong', { text: detail.name }));
    this._headDyn.appendChild(el('span', { class: 'vf-dim vf-small', text: detail.systemName || '深空' }));

    // 状态标签：在途优先于常驻状态
    const inTransit = !!detail.transit;
    const [stText, stTone] = inTransit
      ? ['在途', 'accent']
      : (FLEET_STATUS_ZH[detail.status] || [detail.status || '—', '']);
    this._headDyn.appendChild(el('span', { class: `vf-tag ${stTone}`.trim(), text: stText }));

    // 姿态按钮组：当前姿态高亮（primary）
    for (const [stance, label] of STANCE_DEFS) {
      this._headDyn.appendChild(el('button', {
        class: detail.stance === stance ? 'vf-btn small primary' : 'vf-btn small',
        text: label,
        title: `将交战姿态设为「${label}」`,
        on: {
          click: () => {
            this.app.dispatch('SetFleetStance', { fleetId: detail.id, stance });
            this._forceRefresh();
          },
        },
      }));
    }
    this._headDyn.appendChild(el('span', { class: 'vf-grow' }));

    // 战斗入口：战斗一律在战斗视图处理（本视图不下达撤退命令）
    const battles = (this._snap && Array.isArray(this._snap.battles)) ? this._snap.battles : [];
    if (battles.length > 0) {
      const battle = battles.find((b) => b.systemId === detail.systemId) || battles[0];
      this._headDyn.appendChild(el('button', {
        class: 'vf-btn small danger',
        text: '战斗进行中 → 前往战斗视图',
        title: '舰队正处交战状态；撤退命令请在该战斗的操作面板中下达',
        on: { click: () => this.app.goto('combat', battle.id) },
      }));
    } else {
      this._headDyn.appendChild(el('button', {
        class: 'vf-btn small',
        text: '撤退',
        disabled: true,
        title: '当前没有进行中的战斗，无需撤退',
      }));
    }
    void list; // list 仅用于 _ensureFleetId 校正
  },

  /** 第一列：舰船列表（点击行送检视器） */
  _renderShips(detail) {
    const p = panel({ title: `舰船（${detail.ships.length}）`, dense: true });
    const rows = detail.ships.map((s) => ({ ...s }));
    p.appendChild(dataTable({
      dense: true,
      rows,
      emptyText: '舰队没有舰船——可在下方「编组」面板编入本星系的独立舰船。',
      onRowClick: (row) => this.app.select('ship', row.id), // 检视器不支持 ship 时显示默认面板（可接受）
      columns: [
        { key: 'name', label: '名称' },
        { key: 'hullName', label: '船体' },
        {
          key: 'shield', label: '护盾',
          render: (r) => statBar({
            value: r.hp.shield, max: Math.max(r.hp.shieldMax || 1, 1),
            tone: r.hp.shield <= 0 ? 'danger' : null, showNumbers: false,
          }),
        },
        { key: 'armor', label: '装甲', align: 'right', render: (r) => String(r.hp.armor) },
        {
          key: 'structure', label: '结构',
          render: (r) => statBar({
            value: r.hp.structure, max: Math.max(r.hp.structureMax || 1, 1),
            tone: r.hp.structure / Math.max(r.hp.structureMax || 1, 1) < 0.4 ? 'warn' : null,
            showNumbers: false,
          }),
        },
        { key: 'fuel', label: '燃料', align: 'right', render: (r) => `${r.fuel}/${r.fuelCap}` },
        {
          key: 'status', label: '状态',
          render: (r) => {
            const [text, tone] = SHIP_STATUS_ZH[r.status] || [r.status || '—', ''];
            return el('span', { class: `vf-tag ${tone}`.trim(), text });
          },
        },
      ],
    }));
    p.appendChild(el('div', { class: 'vf-faint vf-small', text: '点击行可在右侧检视器查看舰船详情。' }));
    this._colShips.appendChild(p);
  },

  /** 第二列：舰队状态 + 航行（移动/扫描/在途）+ 编组 */
  _renderCommands(detail, snap) {
    // —— 舰队状态 ——
    const pState = panel({ title: '状态', dense: true });
    pState.appendChild(kvList([
      ['所在星系', detail.systemName || '深空'],
      ['姿态', (STANCE_DEFS.find(([k]) => k === detail.stance) || [null, detail.stance])[1]],
      ['角色', ROLE_ZH[detail.role] || detail.role || '—'],
      ['补给', `${detail.supplyDays} 天`],
      ['士气', String(Math.round(detail.morale))],
    ]));
    this._colCmd.appendChild(pState);

    // —— 航行命令 ——
    const pNav = panel({ title: '航行', dense: true });
    if (detail.transit) {
      // 在途：transit 进度条 + 预计剩余 tick（不提供新命令）
      pNav.appendChild(progressBar({
        value: detail.transit.legProgress || 0,
        max: Math.max(detail.transit.legEta || 1, 1),
        label: `前往 ${detail.transit.destName || '目标星系'}`,
        detail: `${Math.round(detail.transit.legProgress)}/${Math.round(detail.transit.legEta)} tick`,
        kind: 'accent',
      }));
      pNav.appendChild(kvList([
        ['预计剩余', `${Math.max(0, Math.round(detail.transit.totalEta))} tick`],
        ['新命令', '在途舰队无法接受新航路'],
      ]));
    } else if (detail.systemId) {
      this._fillMoveList(pNav, detail, snap);
      this._fillScanList(pNav, detail, snap);
    } else {
      pNav.appendChild(el('div', { class: 'vf-faint vf-small', text: '舰队未停靠任何星系，无法接受移动/扫描命令。' }));
    }
    this._colCmd.appendChild(pNav);

    // —— 编组：同星系己方无舰队舰船（只读查询 entities.ships） ——
    this._colCmd.appendChild(this._assemblyPanel(detail));
  },

  /** 当前星系的相邻星系条目（来自快照 systems.lanes，只读） */
  _neighborEntries(detail, snap) {
    const here = (snap.systems || []).find((s) => s.id === detail.systemId);
    if (!here || !Array.isArray(here.lanes)) return [];
    const byId = new Map((snap.systems || []).map((s) => [s.id, s]));
    const facById = new Map((snap.factions || []).map((f) => [f.id, f]));
    return here.lanes
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))
      .map((s) => {
        const owner = s.ownerFactionId ? facById.get(s.ownerFactionId) : null;
        return {
          id: s.id,
          name: s.name,
          level: s.surveyedLevel ?? 0,
          ownerLabel: owner ? (owner.isPlayer ? '己方' : owner.name) : '未探明',
          mine: !!(owner && owner.isPlayer),
        };
      });
  },

  /** 相邻星系移动列表（ETA 出发后计算） */
  _fillMoveList(pNav, detail, snap) {
    pNav.appendChild(el('div', { class: 'vf-dim vf-small', style: { marginTop: '4px' }, text: '相邻星系移动' }));
    const neighbors = this._neighborEntries(detail, snap);
    if (neighbors.length === 0) {
      pNav.appendChild(el('div', { class: 'vf-faint vf-small', text: '当前星系没有相邻航路。' }));
      return;
    }
    for (const n of neighbors) {
      const row = el('div', { class: 'vf-row', style: { gap: '6px' } });
      row.appendChild(el('span', { class: 'vf-grow', text: n.name }));
      row.appendChild(el('span', { class: n.mine ? 'vf-tag ok' : 'vf-tag', text: n.ownerLabel }));
      row.appendChild(el('span', { class: 'vf-faint vf-small', text: 'ETA 出发后计算' }));
      row.appendChild(el('button', {
        class: 'vf-btn small',
        text: '前往',
        title: `沿航路移动至 ${n.name}`,
        on: {
          click: () => {
            this.app.dispatch('OrderFleetMove', { fleetId: detail.id, targetSystemId: n.id });
            this._forceRefresh();
          },
        },
      }));
      pNav.appendChild(row);
    }
  },

  /** 相邻未满级星系扫描列表（满级 = 情报 L4） */
  _fillScanList(pNav, detail, snap) {
    pNav.appendChild(el('div', { class: 'vf-dim vf-small', style: { marginTop: '6px' }, text: '扫描命令' }));
    const candidates = this._neighborEntries(detail, snap).filter((n) => n.level < 4);
    if (candidates.length === 0) {
      pNav.appendChild(el('div', { class: 'vf-faint vf-small', text: '相邻星系情报均已满级（L4）。' }));
      return;
    }
    for (const n of candidates) {
      const row = el('div', { class: 'vf-row', style: { gap: '6px' } });
      row.appendChild(el('span', { class: 'vf-grow', text: n.name }));
      row.appendChild(el('span', { class: 'vf-faint vf-small', text: `情报 L${n.level}` }));
      row.appendChild(el('button', {
        class: 'vf-btn small',
        text: '扫描',
        title: `开始/继续对 ${n.name} 的扫描任务（需舰队具备传感器）`,
        on: {
          click: () => {
            this.app.dispatch('IssueScanOrder', { fleetId: detail.id, targetSystemId: n.id });
            this._forceRefresh();
          },
        },
      }));
      pNav.appendChild(row);
    }
  },

  /** 编组面板：列出同星系己方无舰队舰船，逐船「编入本舰队」 */
  _assemblyPanel(detail) {
    const p = panel({ title: '编组', dense: true });
    const w = this.app.world;
    if (detail.transit || !detail.systemId) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '舰队在途/未停靠，编组暂不可用。' }));
      return p;
    }
    const pid = w && w.playerFactionId;
    const loose = w
      ? Object.keys(w.entities.ships).sort()
          .map((sid) => w.entities.ships[sid])
          .filter((s) => s.factionId === pid && !s.fleetId && s.status === 'active' && s.systemId === detail.systemId)
          .map((s) => shipSummary(w, s.id))
          .filter(Boolean)
      : [];
    if (loose.length === 0) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '本星系没有可编入的独立舰船。' }));
      return p;
    }
    for (const s of loose) {
      const row = el('div', { class: 'vf-row', style: { gap: '6px' } });
      row.appendChild(el('span', { class: 'vf-grow', text: s.name }));
      row.appendChild(el('span', { class: 'vf-faint vf-small', text: s.hullName }));
      row.appendChild(el('button', {
        class: 'vf-btn small',
        text: '编入本舰队',
        title: `将 ${s.name} 编入 ${detail.name}`,
        on: {
          click: () => {
            this.app.dispatch('AssembleFleet', { fleetId: detail.id, shipId: s.id });
            this._forceRefresh();
          },
        },
      }));
      p.appendChild(row);
    }
    return p;
  },
};
