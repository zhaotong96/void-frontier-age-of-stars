/**
 * ui/screens/MarketView.js — 星系市场视图（任务书 6.2 marketView / ECON-04）
 *
 * 结构：.vf-view > .vf-view-head（标题 + 玩家信用点余额）
 *            + .vf-view-body.pad（星系 tabs + 市场行情表：买/卖操作）
 *
 * 数据来源：simulation/ViewModels.marketView（只读）；
 * 命令：MarketBuy / MarketSell（失败由命令总线 toast 反馈，如「禁运中」「市场无货」）。
 * 价格趋势：世界不存历史价格，故以 当前价/基准价 对比箭头呈现（▲高于基准 / ▼低于基准）。
 * 数量输入：按 星系|资源|买卖 键保存在视图实例（纯 UI 状态）；数据区重建时若
 * 输入框持有焦点则跳过本轮刷新（命令后的强制刷新除外），避免打字被打断。
 * 刷新：onSnapshot 250ms 节流，保留滚动位置；监听随 unmount 清理。
 */

import { el, clearEl } from '../components/dom.js';
import { dataTable, tabs } from '../components/index.js';
import { L } from '../../core/i18n.js';
import { marketView } from '../../simulation/ViewModels.js';
import { RESOURCES } from '../../content/resources.js';

/** 快照刷新节流间隔 */
const REFRESH_MS = 250;

/** 数量输入默认值 */
const DEFAULT_QTY = '10';

/** 资源中文名映射（覆盖 content/resources.js 全部 id；未匹配时回退 id 本身） */
const RES_NAME_ZH = {
  ferro: '铁族金属', silicate: '硅质矿物', rareEarth: '稀土元素', heavyMetal: '重金属',
  alloy: '合金', polymer: '聚合物', composite: '复合材料', ceramic: '陶瓷', conductor: '超导材料',
  hydrogen: '氢', helium3: '氦-3', deuterium: '氘', inertGas: '惰性气体', reagents: '化学试剂',
  food: '食物', water: '水', oxygen: '氧气', biomass: '生物质', medicine: '医疗物资',
  powerCell: '动力电池', reactorFuel: '反应堆燃料',
  quantumCrystal: '量子晶体', darkMatter: '暗物质', exoticMatter: '奇异物质', ancientData: '远古数据',
  credits: '信用点', influence: '影响力', researchData: '科研数据', intelPoints: '情报点数',
};

/** 资源定义索引（只读查询；未知 id 不抛错，回退显示原始 id） */
const RES_DEFS = new Map(RESOURCES.map((r) => [r.id, r]));

/** 资源中文名：本地映射 → 定义 nameZh（内容扩展时）→ 原始 id */
function resName(rid) {
  const def = RES_DEFS.get(rid);
  return RES_NAME_ZH[rid] || (def && def.nameZh) || rid;
}

/** 大数缩写（余额/数量显示） */
function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v * 100) / 100);
}

export const MarketView = {
  id: 'market',
  title: '市场',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._snap = app.snapshot || null;
    this._lastAt = -REFRESH_MS; // 负值哨兵：保证首次快照必刷（不受页面加载耗时影响）
    this._force = false;
    this._handlers = [];
    this._qty = new Map();      // 数量输入暂存：`${systemId}|${resId}|buy|sell` → 文本
    this._tabKeys = '';         // 上次 tabs 的市场 id 串（变化才重建 tabs）
    this._tabsEl = null;

    // param 可选：直接定位某星系市场
    this._activeSystem = typeof ctx.param === 'string' && ctx.param ? ctx.param : null;

    root.innerHTML = '';

    // —— 头部 ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.market') }));
    this._headDyn = el('div', { class: 'vf-row vf-grow', style: { gap: '8px' } });
    head.appendChild(this._headDyn);

    // —— 主体 ——
    const body = el('div', { class: 'vf-view-body pad' });
    this._bodyEl = body;
    this._tabsBox = el('div', { style: { marginBottom: '8px' } });
    body.appendChild(this._tabsBox);
    this._marketBox = el('div', { style: { minWidth: '0' } });
    body.appendChild(this._marketBox);

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
    this._headDyn = null;
    this._bodyEl = null;
    this._tabsBox = null;
    this._marketBox = null;
    this._tabsEl = null;
    this._qty.clear();
  },

  /** 快照推送：250ms 节流；_force 绕过节流（成交后的即时反馈） */
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

  /** 当前市场视图数据 */
  _marketData() {
    const w = this.app.world;
    return w ? marketView(w, w.playerFactionId) : { markets: [], credits: 0 };
  },

  /** 重建数据区：保留滚动位置；输入框持有焦点时跳过（强制刷新除外） */
  _refresh(snap) {
    if (!this._bodyEl || !this._marketBox) return;
    const ae = document.activeElement;
    if (!this._force && ae && this._marketBox.contains(ae)) return; // 打字中：本轮不重建
    const savedTop = this._bodyEl.scrollTop;

    const mv = this._marketData();

    // 头部余额
    if (this._headDyn) {
      clearEl(this._headDyn);
      this._headDyn.appendChild(el('span', { class: 'vf-dim vf-small', text: '玩家余额' }));
      this._headDyn.appendChild(el('strong', { class: 'vf-mono vf-accent', text: `${fmtQty(mv.credits)} 信用点` }));
      this._headDyn.appendChild(el('span', { class: 'vf-grow' }));
      this._headDyn.appendChild(el('span', {
        class: 'vf-faint vf-small',
        text: '价格箭头：▲ 高于基准（宜卖）· ▼ 低于基准（宜买）；成交价含市场冲击',
      }));
    }

    // 星系选择 tabs（集合变化才重建，避免点击间隙被替换）
    const markets = mv.markets || [];
    if (markets.length > 0) {
      if (!markets.some((m) => m.systemId === this._activeSystem)) {
        this._activeSystem = markets[0].systemId;
      }
      const keys = markets.map((m) => m.systemId).join('|');
      if (keys !== this._tabKeys || !this._tabsEl) {
        clearEl(this._tabsBox);
        this._tabsEl = tabs({
          items: markets.map((m) => ({
            id: m.systemId,
            label: m.owned ? `${m.systemName} ◆` : m.systemName,
          })),
          activeId: this._activeSystem,
          onChange: (id) => {
            this._activeSystem = id;
            this._renderMarket(); // 切换立即生效（纯视图状态）
          },
        });
        this._tabsBox.appendChild(this._tabsEl);
        this._tabKeys = keys;
      } else if (this._tabsEl && typeof this._tabsEl._setActive === 'function') {
        this._tabsEl._setActive(this._activeSystem);
      }
    } else {
      clearEl(this._tabsBox);
      this._tabsEl = null;
      this._tabKeys = '';
    }

    this._renderMarket();
    this._bodyEl.scrollTop = savedTop;
  },

  /** 渲染当前星系市场（tabs 切换也走这里，无需等下一轮快照） */
  _renderMarket() {
    if (!this._marketBox) return;
    // 手动点击切换时不抢占输入焦点：输入中直接跳过
    const ae = document.activeElement;
    if (!this._force && ae && this._marketBox.contains(ae)) return;

    const mv = this._marketData();
    const markets = mv.markets || [];
    clearEl(this._marketBox);

    if (markets.length === 0) {
      this._marketBox.appendChild(el('div', {
        class: 'vf-faint vf-center', style: { padding: '40px 0' },
        text: '星域中尚无市场——市场随殖民与船坞投产而形成。',
      }));
      return;
    }
    const m = markets.find((x) => x.systemId === this._activeSystem) || markets[0];
    this._activeSystem = m.systemId;

    // —— 市场头：归属与禁运状态 ——
    const headRow = el('div', { class: 'vf-row', style: { gap: '8px', marginBottom: '6px' } });
    headRow.appendChild(el('strong', { text: `${m.systemName} 市场` }));
    headRow.appendChild(el('span', { class: m.owned ? 'vf-tag ok' : 'vf-tag', text: m.owned ? '己方市场' : '中立市场' }));
    const embargo = !!(m.rows && m.rows[0] && m.rows[0].embargo);
    headRow.appendChild(el('span', {
      class: embargo ? 'vf-tag danger' : 'vf-tag ok',
      text: embargo ? '禁运中：无法交易' : '开放交易',
    }));
    headRow.appendChild(el('span', { class: 'vf-faint vf-small', text: `商品 ${(m.rows || []).length} 种` }));
    this._marketBox.appendChild(headRow);

    // —— 行情表：资源 / 价格 / 库存 / 需求 / 买入 / 卖出 ——
    const rows = (m.rows || []).map((r) => ({ ...r, id: r.resId }));
    this._marketBox.appendChild(dataTable({
      dense: true,
      rows,
      emptyText: '该市场暂无挂牌商品。',
      columns: [
        { key: 'resId', label: '资源', render: (r) => el('span', { title: r.resId, text: resName(r.resId) }) },
        {
          key: 'price', label: '价格（vs 基准）', align: 'right',
          render: (r) => {
            const arrow = r.price > r.base
              ? el('span', { class: 'vf-warn', text: ' ▲' })
              : r.price < r.base
                ? el('span', { class: 'vf-ok', text: ' ▼' })
                : el('span', { class: 'vf-faint', text: ' —' });
            return el('span', { class: 'vf-mono', title: `基准价 ${r.base}`, text: String(r.price) }, [arrow]);
          },
        },
        { key: 'stock', label: '库存', align: 'right', render: (r) => fmtQty(r.stock) },
        { key: 'demand', label: '需求', align: 'right', render: (r) => fmtQty(r.demand) },
        { key: 'buy', label: '买入', render: (r) => this._tradeCell(m.systemId, r, 'buy') },
        { key: 'sell', label: '卖出', render: (r) => this._tradeCell(m.systemId, r, 'sell') },
      ],
    }));
    this._marketBox.appendChild(el('div', {
      class: 'vf-faint vf-small', style: { marginTop: '4px' },
      text: '买入按当前库存逐量抬价（市场冲击），卖出逐量压价；成交量上限受市场库存约束。',
    }));
  },

  /** 单元格：数量输入 + 买/卖按钮（禁用态均给 title 说明原因） */
  _tradeCell(systemId, r, side) {
    const key = `${systemId}|${r.resId}|${side}`;
    const input = el('input', {
      type: 'number', min: '1', step: '1',
      value: this._qty.get(key) != null ? this._qty.get(key) : DEFAULT_QTY,
      'aria-label': `${side === 'buy' ? '买入' : '卖出'} ${resName(r.resId)} 数量`,
      style: { width: '64px' },
    });
    input.addEventListener('input', () => this._qty.set(key, input.value));

    const n = Math.floor(Number(input.value));
    const qtyOk = Number.isFinite(n) && n > 0;
    let disabled = !qtyOk;
    let title = '数量必须为正整数';
    if (r.embargo) {
      disabled = true;
      title = '禁运中，无法交易';
    } else if (side === 'buy' && r.stock <= 0) {
      disabled = true;
      title = '市场无货';
    } else if (qtyOk) {
      title = side === 'buy' ? `以当前市价买入 ${n} ${resName(r.resId)}` : `以当前市价卖出 ${n} ${resName(r.resId)}`;
    }

    const btn = el('button', {
      class: 'vf-btn small',
      text: side === 'buy' ? '买' : '卖',
      disabled: disabled ? true : null,
      title,
      on: {
        click: () => {
          const qty = Math.floor(Number(input.value));
          if (!Number.isFinite(qty) || qty <= 0) return; // 双保险：输入非法直接忽略
          const res = side === 'buy'
            ? this.app.dispatch('MarketBuy', { systemId, resId: r.resId, qty })
            : this.app.dispatch('MarketSell', { systemId, resId: r.resId, qty });
          if (res && res.ok) this._forceRefresh();
        },
      },
    });

    const cell = el('span', { class: 'vf-row', style: { gap: '4px', flexWrap: 'nowrap' } });
    cell.append(input, btn);
    return cell;
  },
};
