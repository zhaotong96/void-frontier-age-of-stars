/**
 * ui/screens/DesignerView.js — 舰船设计器（路由 #/designer）
 *
 * 布局：.vf-view > .vf-view-head（标题 + 说明）+ .vf-view-body 三栏：
 *   左：船体列表（含解锁状态；锁定项禁选，title 显示所需科技）；
 *   中：槽位装配区（high/mid/low 三组：已装模块 chips 可点击移除 +
 *       「添加模块」下拉）+ 底部实时校验面板（fitPreview：ok/errors/stats/成本/工期）；
 *   右：蓝图列表（名称/船体/有效状态）+ 选中蓝图详情 +
 *       「保存设计」（名称 modal → SaveBlueprint）与
 *       「下单建造」（船坞 modal → ShipyardBuild，显示造价与余额不足原因）。
 *
 * 数据来源纪律：只读消费 simulation/ViewModels.js 的 designerView / fitPreview /
 * shipyardView + app.snapshot；写操作一律经 app.dispatch（SaveBlueprint /
 * ShipyardBuild）。装配交互状态（hullId/modules）为纯前端状态，绝不写 world。
 *
 * onSnapshot 250ms 节流：只重建左右两栏与校验面板（均为纯展示），
 * 中部槽位装配区仅在用户交互时重建，避免原生下拉被高频刷新打断。
 * unmount 清理引用（无监听 / 无 rAF）。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { showModal } from '../components/modal.js';
import { L } from '../../core/i18n.js';
import { designerView, fitPreview, shipyardView } from '../../simulation/ViewModels.js';
import { techDef } from '../../domain/research/research.js';

/** 槽位组顺序与中文名 */
const SLOT_GROUPS = [
  { key: 'high', label: '高槽（high）' },
  { key: 'mid', label: '中槽（mid）' },
  { key: 'low', label: '低槽（low）' },
];

/** 船体类别中文名（未知回退原文；[SPEC-39 Bug 5] 补 capital 等全类别） */
const HULL_CATEGORY_ZH = {
  combat: '作战', support: '支援', carrier: '航母', industrial: '工业', science: '科研',
  capital: '主力舰', cruiser: '巡洋', destroyer: '驱逐', frigate: '护卫', corvette: '护卫艇',
  transport: '运输', colony: '殖民', constructor: '工程',
};

/** 成本资源中文名（未知 id 回退原文） */
const COST_NAME_ZH = {
  credits: '信用点', alloy: '合金', polymer: '聚合物', composite: '复合材料',
  conductor: '超导体', ceramic: '陶瓷',
};

/** 成本对象 → "信用点X 合金Y" 文本（零值省略） */
function costText(cost) {
  if (!cost || typeof cost !== 'object') return '—';
  const parts = [];
  for (const key of Object.keys(cost).sort()) {
    const v = Number(cost[key]);
    if (!Number.isFinite(v) || v === 0) continue;
    parts.push(`${COST_NAME_ZH[key] || key}×${Math.round(v)}`);
  }
  return parts.length ? parts.join(' ') : '—';
}

export const DesignerView = {
  id: 'designer',
  title: '舰船设计',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;
    // —— 纯前端装配状态（不碰 world） ——
    this.hullId = null;          // 当前装配的船体 id
    this.modules = [];           // 已装模块 id 数组（同一模块可多次装入）
    this.selectedBlueprintId = null; // 右栏选中的蓝图 id

    root.innerHTML = '';

    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.designer') }));
    head.appendChild(el('span', { class: 'vf-grow' }));
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '左选船体 → 中装配模块 → 保存为蓝图 → 指定船坞建造' }));

    const body = el('div', { class: 'vf-view-body', style: { display: 'flex', overflow: 'hidden' } });

    // —— 左：船体列表 ——
    this._hullBox = el('div', {
      style: { width: '240px', flexShrink: '0', overflowY: 'auto', padding: '10px', borderRight: '1px solid var(--line)' },
    });
    // —— 中：槽位装配 + 实时校验 ——
    this._midBox = el('div', { style: { flex: '1 1 0', minWidth: '0', overflowY: 'auto', padding: '10px' } });
    this._slotBox = el('div');   // 槽位装配区（仅交互时重建）
    this._fitBox = el('div');    // 实时校验面板（快照可安全重建）
    this._midBox.appendChild(this._slotBox);
    this._midBox.appendChild(this._fitBox);
    // —— 右：蓝图列表 + 详情 + 操作 ——
    this._bpBox = el('div', {
      style: { width: '300px', flexShrink: '0', overflowY: 'auto', padding: '10px', borderLeft: '1px solid var(--line)' },
    });

    body.appendChild(this._hullBox);
    body.appendChild(this._midBox);
    body.appendChild(this._bpBox);

    const wrap = el('div', { class: 'vf-view' }, [head, body]);
    root.appendChild(wrap);

    this._rebuildHulls();
    this._rebuildSlots();
    this._rebuildBlueprints();
    this._updateFitPanel();
  },

  /** 快照推送：250ms 节流；只重建展示性区域（船体解锁/蓝图列表/校验面板） */
  onSnapshot() {
    if (!this._mounted) return;
    const now = performance.now();
    if (now - this._lastRefresh < 250) return;
    this._lastRefresh = now;
    this._rebuildHulls();
    this._rebuildBlueprints();
    this._updateFitPanel();
    // 选中蓝图可能已被外部删除（读档等）：纠正引用
    const bps = this._designer().blueprints;
    if (this.selectedBlueprintId && !bps.some((b) => b.id === this.selectedBlueprintId)) {
      this.selectedBlueprintId = null;
      this._rebuildBlueprints();
    }
  },

  /** 卸载：停引用（本视图无监听 / 无 rAF / 无画布） */
  unmount() {
    this._mounted = false;
    this.app = null;
    this._hullBox = null;
    this._midBox = null;
    this._slotBox = null;
    this._fitBox = null;
    this._bpBox = null;
  },

  // —— 内部实现 ——————————————————————————————————

  /** designerView 只读数据包 */
  _designer() {
    const w = this.app && this.app.world;
    return designerView(w, w.playerFactionId);
  },

  /** 当前船体定义（designerView.hulls 中查找） */
  _hullDef() {
    if (!this.hullId) return null;
    return this._designer().hulls.find((h) => h.id === this.hullId) || null;
  },

  /** 当前实时校验结果（fitPreview 纯函数，输入为本视图前端状态） */
  _fit() {
    if (!this.hullId) return null;
    return fitPreview(this.hullId, this.modules);
  },

  // —— 左栏：船体列表 ————————————————————————————

  _rebuildHulls() {
    const box = this._hullBox;
    if (!box) return;
    clearEl(box);
    const d = this._designer();
    const list = panel({ title: `船体（${d.hulls.length}）`, open: true });
    for (const h of d.hulls) {
      const locked = !h.unlocked;
      const row = el('button', {
        class: 'vf-btn small' + (this.hullId === h.id ? ' primary' : ''),
        type: 'button',
        disabled: locked,
        title: locked
          ? `需科技: ${(() => { const t = h.techReq ? techDef(h.techReq) : null; return (t && t.nameZh) || '未知科技'; })()}` // [SPEC-39 Bug 5] 显示中文名而非原始 techId
          : `选择该船体开始装配（${costText(h.cost)} · 工期 ${h.buildHours}h）`,
        style: { display: 'block', width: '100%', textAlign: 'left', marginTop: '4px' },
        on: {
          click: () => {
            if (this.hullId === h.id) return; // 同船体不重置已装模块
            this.hullId = h.id;
            this.modules = [];                // 换船体清空装配
            this._rebuildHulls();
            this._rebuildSlots();
            this._updateFitPanel();
          },
        },
      }, [
        el('div', { text: h.name }),
        el('div', { class: 'vf-faint', style: { fontSize: '10px' }, text: `${HULL_CATEGORY_ZH[h.category] || h.category} · 高${h.slots.high} 中${h.slots.mid} 低${h.slots.low}` }),
      ]);
      list.appendChild(row);
    }
    box.appendChild(list);
  },

  // —— 中栏：槽位装配区 ————————————————————————————

  _rebuildSlots() {
    const box = this._slotBox;
    if (!box) return;
    clearEl(box);
    const hull = this._hullDef();

    if (!hull) {
      box.appendChild(el('div', { class: 'vf-faint vf-center mt-3', text: '请先在左侧选择一个已解锁的船体' }));
      return;
    }

    const intro = panel({ title: `装配 · ${hull.name}`, open: true, dense: true });
    intro.appendChild(el('div', { class: 'vf-dim vf-small', text: `${HULL_CATEGORY_ZH[hull.category] || hull.category}船体 · ${hull.descZh}` }));
    intro.appendChild(kvList([['船体造价', costText(hull.cost)], ['建造工期', `${hull.buildHours} 小时`]]));
    box.appendChild(intro);

    const d = this._designer();
    for (const g of SLOT_GROUPS) {
      const installed = this.modules
        .map((mid, idx) => ({ mid, idx }))
        .filter((x) => (d.modules.find((m) => m.id === x.mid) || {}).slotType === g.key);
      const total = hull.slots[g.key] ?? 0;
      const remaining = total - installed.length;

      const group = panel({ title: `${g.label}　已用 ${installed.length}/${total}`, open: true, dense: true });

      // 已装模块 chips（点击移除）
      const chips = el('div', { class: 'vf-row' });
      if (!installed.length) {
        chips.appendChild(el('span', { class: 'vf-faint vf-small', text: '（空）' }));
      }
      for (const { mid, idx } of installed) {
        const m = d.modules.find((x) => x.id === mid);
        chips.appendChild(el('button', {
          class: 'vf-btn small',
          type: 'button',
          title: '点击移除该模块',
          on: {
            click: () => {
              this.modules.splice(idx, 1);
              this._rebuildSlots();
              this._updateFitPanel();
            },
          },
        }, [`${(m && m.name) || mid} ×`]));
      }
      group.appendChild(chips);

      // 「添加模块」下拉：过滤 slotType 匹配 + 已解锁 + 剩余槽位 > 0
      const sel = el('select', {
        disabled: remaining <= 0,
        title: remaining <= 0 ? '该槽位组已满' : '选择要装入的模块（仅列出类型匹配且已解锁的）',
        style: { maxWidth: '100%' },
      });
      sel.appendChild(el('option', { value: '', text: remaining <= 0 ? '槽位已满' : '+ 添加模块…' }));
      for (const m of d.modules) {
        if (m.slotType !== g.key || !m.unlocked) continue;
        const label = `${m.name}（${m.power >= 0 ? '+' : ''}${m.power}电 / ${m.cpu}算力）`;
        sel.appendChild(el('option', { value: m.id, text: label }));
      }
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        this.modules.push(sel.value);
        sel.value = '';
        this._rebuildSlots();
        this._updateFitPanel();
      });
      group.appendChild(sel);
      box.appendChild(group);
    }
  },

  // —— 中栏：实时校验面板 ————————————————————————————

  _updateFitPanel() {
    const box = this._fitBox;
    if (!box) return;
    clearEl(box);
    const fit = this._fit();
    const p = panel({ title: '装配校验（实时）', open: true, dense: true });

    if (!fit) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '未选择船体，暂无校验结果。' }));
      box.appendChild(p);
      return;
    }

    // 校验结论 / 错误列表
    if (fit.ok) {
      p.appendChild(el('div', { class: 'vf-ok vf-small', text: '✔ 校验通过，可保存为蓝图' }));
    } else {
      p.appendChild(el('div', { class: 'vf-warn vf-small', text: '✖ 校验未通过：' }));
      const errs = Array.isArray(fit.errors) ? fit.errors : [];
      for (const e of errs) {
        p.appendChild(el('div', { class: 'vf-warn vf-small', style: { paddingLeft: '12px' }, text: `· ${(e && e.reason) || String(e)}` }));
      }
    }

    // 属性与成本（ok 时才有 stats）
    if (fit.stats) {
      const s = fit.stats;
      p.appendChild(kvList([
        ['结构', s.structure],
        ['护盾', s.shield],
        ['装甲', s.armor],
        ['功率净额', `${s.power - s.powerUsed}（发电 ${s.power} / 耗电 ${s.powerUsed}）`],
        ['算力', s.cpu],
        ['战略速度', s.strategicSpeed],
        ['武器数', (s.weapons || []).length],
        ['传感', s.sensor],
        ['货舱', s.cargo],
        ['造价', costText(s.cost)],
        ['工期', `${s.buildHours ?? '—'} 小时`],
      ]));
      if ((s.weapons || []).length) {
        const lines = s.weapons.map((w) => `${w.name}：伤害 ${w.damage} / 射程 ${w.range} / ${w.kind}`);
        p.appendChild(el('div', { class: 'vf-dim vf-small mt-1', text: lines.join('；') }));
      }
    } else {
      p.appendChild(el('div', { class: 'vf-faint vf-small mt-1', text: '校验通过后显示舰船属性与成本。' }));
    }
    box.appendChild(p);
  },

  // —— 右栏：蓝图列表 + 详情 + 操作 ————————————————————————

  _rebuildBlueprints() {
    const box = this._bpBox;
    if (!box) return;
    clearEl(box);
    const app = this.app;
    const d = this._designer();

    // —— 蓝图列表 ——
    const listP = panel({ title: `蓝图（${d.blueprints.length}）`, open: true });
    if (!d.blueprints.length) {
      listP.appendChild(el('div', { class: 'vf-faint vf-small', text: '尚无蓝图：装配完成后点击「保存设计」。' }));
    }
    for (const b of d.blueprints) {
      const row = el('button', {
        class: 'vf-btn small' + (this.selectedBlueprintId === b.id ? ' primary' : ''),
        type: 'button',
        title: '查看蓝图详情',
        style: { display: 'block', width: '100%', textAlign: 'left', marginTop: '4px' },
        on: {
          click: () => {
            this.selectedBlueprintId = this.selectedBlueprintId === b.id ? null : b.id;
            this._rebuildBlueprints();
          },
        },
      }, [
        el('div', null, [
          el('span', { text: b.name }),
          el('span', { class: b.valid ? 'vf-ok vf-small' : 'vf-warn vf-small', style: { float: 'right' }, text: b.valid ? '有效' : '失效' }),
        ]),
        el('div', { class: 'vf-faint', style: { fontSize: '10px', textAlign: 'left' }, text: `${b.hullName || b.hullId} · 模块×${b.modules.length}` }),
      ]);
      listP.appendChild(row);
    }
    box.appendChild(listP);

    // —— 选中蓝图详情 ——
    const bp = d.blueprints.find((b) => b.id === this.selectedBlueprintId) || null;
    if (bp) {
      const detail = panel({ title: `蓝图详情 · ${bp.name}`, open: true, dense: true });
      const hull = d.hulls.find((h) => h.id === bp.hullId) || null;
      const modNames = bp.modules
        .map((mid) => (d.modules.find((m) => m.id === mid) || {}).name || mid)
        .join('、');
      detail.appendChild(kvList([
        ['船体', bp.hullName || bp.hullId],
        ['模块清单', modNames || '（空）'],
        ['有效状态', bp.valid ? '有效' : `失效（${(bp.errors || []).join('；') || '未知原因'}）`],
      ]));
      if (bp.stats) {
        detail.appendChild(kvList([
          ['结构', bp.stats.structure],
          ['护盾', bp.stats.shield],
          ['装甲', bp.stats.armor],
          ['功率净额', bp.stats.powerNet],
          ['算力', bp.stats.cpu],
          ['战略速度', bp.stats.strategicSpeed],
          ['武器数', bp.stats.weapons],
        ]));
      }
      if (hull) {
        detail.appendChild(el('div', { class: 'vf-dim vf-small mt-1', text: `本设计造价：${costText(hull.cost)} · 工期 ${hull.buildHours} 小时` }));
      }

      // —— 操作按钮：保存设计 / 下单建造 ——
      const btns = el('div', { class: 'vf-row mt-2' });
      const fit = this._fit();
      btns.appendChild(el('button', {
        class: 'vf-btn small primary',
        type: 'button',
        text: '保存当前装配为蓝图',
        disabled: !this.hullId || !fit || !fit.ok,
        title: !this.hullId
          ? '尚未选择船体'
          : !fit || !fit.ok
            ? '装配校验未通过，无法保存'
            : '弹出名称输入框并保存为蓝图',
        on: { click: () => this._openSaveModal() },
      }));
      const stations = this._shipyards();
      btns.appendChild(el('button', {
        class: 'vf-btn small',
        type: 'button',
        text: '下单建造',
        disabled: !bp || !stations.length,
        title: !bp
          ? '未选择蓝图'
          : !stations.length
            ? '没有可用的轨道船坞（kind=shipyard）'
            : '选择船坞并按该蓝图下单建造',
        on: { click: () => this._openBuildModal(bp, hull) },
      }));
      detail.appendChild(btns);
      box.appendChild(detail);
    }
  },

  /** 玩家的轨道船坞列表（shipyardView 只读） */
  _shipyards() {
    const w = this.app && this.app.world;
    return shipyardView(w, w.playerFactionId).stations.filter((s) => s.kind === 'shipyard');
  },

  /** 保存设计 modal：输入名称 → dispatch('SaveBlueprint', {hullId, modules, name}) */
  _openSaveModal() {
    const app = this.app;
    const fit = this._fit();
    if (!this.hullId || !fit || !fit.ok) return; // 双保险（按钮已禁用）
    let nameInput = null;
    showModal({
      title: '保存设计',
      body: (box) => {
        box.appendChild(el('div', { class: 'vf-col' }, [
          el('span', { class: 'vf-dim vf-small', text: '蓝图名称' }),
          (nameInput = el('input', { type: 'text', placeholder: '如：巡逻型护卫舰 A1', maxLength: '32' })),
        ]));
        box.appendChild(el('div', { class: 'vf-faint vf-small mt-1', text: `船体：${(this._hullDef() || {}).name || this.hullId} · 模块×${this.modules.length}` }));
        setTimeout(() => nameInput && nameInput.focus(), 0);
      },
      actions: [
        {
          label: '保存',
          kind: 'primary',
          onClick: (close) => {
            const name = (nameInput && nameInput.value.trim()) || '未命名设计';
            const res = app.dispatch('SaveBlueprint', { hullId: this.hullId, modules: this.modules.slice(), name });
            if (res && res.ok) close();
            return false; // 失败时保持打开（失败原因已由 dispatch toast 提示）
          },
        },
        { label: '取消', kind: 'ghost' },
      ],
    });
  },

  /** 下单建造 modal：选择船坞 → dispatch('ShipyardBuild', {blueprintId, stationId}) */
  _openBuildModal(bp, hull) {
    const app = this.app;
    const stations = this._shipyards();
    if (!bp || !stations.length) return;

    // 余额核对（只读）：逐项给出不足提示；实际扣费以命令校验为准
    const w = app.world;
    const balances = shipyardView(w, w.playerFactionId).balances || {};
    const shortages = [];
    if (hull && hull.cost) {
      for (const key of Object.keys(hull.cost).sort()) {
        const need = Number(hull.cost[key]) || 0;
        const have = Number(balances[key]);
        if (Number.isFinite(have) && have < need) {
          shortages.push(`${COST_NAME_ZH[key] || key}不足（需 ${need}，现有 ${Math.round(have)}）`);
        }
      }
    }

    let sel = null;
    showModal({
      title: `下单建造 · ${bp.name}`,
      wide: true,
      body: (box) => {
        box.appendChild(el('div', { class: 'vf-col' }, [
          el('span', { class: 'vf-dim vf-small', text: '选择轨道船坞' }),
          (sel = el('select', null, stations.map((s) => el('option', {
            value: s.id,
            text: `${s.systemName || s.systemId} · 等级 ${s.level} · 队列 ${s.queue.length} 项`,
          })))),
        ]));
        box.appendChild(el('div', { class: 'vf-dim vf-small mt-1', text: `造价：${hull ? costText(hull.cost) : '—'} · 工期：${hull ? hull.buildHours + ' 小时' : '—'}` }));
        if (shortages.length) {
          box.appendChild(el('div', { class: 'vf-warn vf-small mt-1', text: `余额不足：${shortages.join('；')}（下单将被拒绝）` }));
        } else {
          box.appendChild(el('div', { class: 'vf-ok vf-small mt-1', text: '余额满足该设计的账面造价（实际以命令结算为准）。' }));
        }
      },
      actions: [
        {
          label: '下单',
          kind: 'primary',
          onClick: (close) => {
            if (!sel || !sel.value) return false;
            const res = app.dispatch('ShipyardBuild', { blueprintId: bp.id, stationId: sel.value });
            if (res && res.ok) close();
            return false; // 失败保持打开
          },
        },
        { label: '取消', kind: 'ghost' },
      ],
    });
  },
};
