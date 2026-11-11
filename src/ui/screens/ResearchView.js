/**
 * ui/screens/ResearchView.js — 科研视图（任务书 6.2 researchView / TECH-01..03）
 *
 * 结构：.vf-view > .vf-view-head（标题 + 产出/小时 徽章）
 *            + .vf-view-body.pad（产出与项目摘要 + 搜索框 + 七列科技树）
 *
 * 数据来源：simulation/ViewModels.researchView（只读）；
 * 命令：StartResearch（available 节点点击；失败由命令总线 toast 反馈）。
 * 科技树：7 类固定列（propulsion/industry/energy/bio/computing/space/society），
 * 列内按 tier 升序；节点状态类 done/active/available/locked 由 styles.css 着色。
 * 搜索框过滤科技名（输入框在重建区之外，避免节流刷新丢失焦点）。
 * 刷新：onSnapshot 250ms 节流，保留 body 纵向与科技树横向滚动位置；
 * 监听随 unmount 清理（持久控件登记 _handlers，重建子节点随 DOM 移除释放）。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList, progressBar, resourceChip } from '../components/index.js';
import { L } from '../../core/i18n.js';
import { researchView } from '../../simulation/ViewModels.js';

/** 快照刷新节流间隔 */
const REFRESH_MS = 250;

/** 科技类别 → [键, 中文列名, 英文小注]（键序即列序） */
const TECH_CATS = [
  ['propulsion', '推进', 'PROPULSION'],
  ['industry', '工业', 'INDUSTRY'],
  ['energy', '能源', 'ENERGY'],
  ['bio', '生物', 'BIO'],
  ['computing', '计算', 'COMPUTING'],
  ['space', '深空', 'SPACE'],
  ['society', '社会', 'SOCIETY'],
];

/**
 * 科技效果 stat 键 → 中文映射（覆盖 content/technologies.js 全部 effects[].stat）。
 * 未收录的键回退显示原始键名，保证新增内容不至于空白。
 */
const STAT_ZH = {
  researchOutput: '研究速度',
  mineOutput: '采矿产率',
  alloyOutput: '合金产率',
  factoryOutput: '工厂产率',
  moduleOutput: '模块产率',
  farmOutput: '农业产率',
  buildSpeed: '建造速度',
  shipBuildSpeed: '舰船建造速度',
  shipBuildCostReduction: '舰船造价',
  popGrowth: '人口增长',
  habitabilityBonus: '宜居度加成',
  stabilityBonus: '稳定度加成',
  adminCapacity: '行政容量',
  governanceLoad: '治理负荷',
  taxRateBonus: '税率加成',
  influenceGain: '影响力获取',
  tradeCapacity: '贸易容量',
  marketPriceBonus: '市场价格加成',
  cargoCapacity: '货舱容量',
  hangarCapacity: '机库容量',
  fuelEfficiency: '燃料效率',
  strategicSpeed: '战略速度',
  maxShield: '护盾上限',
  shieldRegen: '护盾回复',
  armor: '装甲',
  weaponDamage: '武器伤害',
  weaponRange: '武器射程',
  trackingBonus: '追踪精度',
  hitChanceBonus: '命中加成',
  pdEfficiency: '点防效率',
  ewarStrength: '电子战强度',
  sensorStrength: '传感器强度',
  scanSpeed: '扫描速度',
  scanPrecision: '扫描精度',
  repairRate: '维修速度',
  damageReduction: '伤害减免',
  powerOutput: '发电输出',
  heatDissipation: '散热能力',
  anomalyChanceBonus: '异常发现率',
  intelEffectiveness: '情报效能',
  diplomacyTrustGain: '外交信任',
  warExhaustionResistance: '战争疲惫抗性',
  terraformSpeed: '环境改造速度',
  // [SPEC-39 Bug 5] 地表气象抗性补录（content/technologies.js 全量 stat 审计零缺漏）
  stormResist: '风暴抗性',
  stormResistAcid: '酸雨风暴抗性',
};

/** 单条效果格式化：mult → ×1.08；add → +0.03 / -0.02 */
function effectText(e) {
  if (!e) return '';
  const name = STAT_ZH[e.stat] || e.stat;
  if (e.mode === 'mult') return `${name} ×${e.value}`;
  return `${name} ${e.value >= 0 ? '+' : ''}${e.value}`;
}

/** 解释数值格式化（explainMod 的 value 可能是乘数或加数） */
function fmtModValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Math.round(n * 100) / 100 + '';
}

export const ResearchView = {
  id: 'research',
  title: '科研',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._snap = app.snapshot || null;
    this._lastAt = -REFRESH_MS; // 负值哨兵：保证首次快照必刷（不受页面加载耗时影响）
    this._force = false;
    this._handlers = [];
    this._filter = ''; // 搜索过滤词（小写）

    root.innerHTML = '';

    // —— 头部 ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.research') }));
    this._headDyn = el('div', { class: 'vf-row vf-grow', style: { gap: '8px' } });
    head.appendChild(this._headDyn);

    // —— 主体 ——
    const body = el('div', { class: 'vf-view-body pad' });
    this._bodyEl = body;

    this._statsBox = el('div', { class: 'vf-col', style: { gap: '10px' } });
    body.appendChild(this._statsBox);

    // 搜索工具条（持久节点：不随节流重建，避免输入焦点丢失）
    const toolbar = el('div', { class: 'vf-row', style: { margin: '10px 0 2px' } });
    this._searchInput = el('input', {
      type: 'search', placeholder: '搜索科技名…', 'aria-label': '搜索科技名',
      style: { maxWidth: '220px' },
    });
    this._bind(this._searchInput, 'input', () => {
      this._filter = (this._searchInput.value || '').trim().toLowerCase();
      this._renderTree(this._research()); // 立即过滤（纯视图状态，不碰世界）
    });
    toolbar.appendChild(this._searchInput);
    this._searchHint = el('span', { class: 'vf-faint vf-small', text: '' });
    toolbar.appendChild(this._searchHint);
    body.appendChild(toolbar);

    this._treeBox = el('div', { style: { minWidth: '0' } });
    body.appendChild(this._treeBox);

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
    this._statsBox = null;
    this._treeBox = null;
    this._searchInput = null;
    this._searchHint = null;
  },

  /** 快照推送：250ms 节流；_force 绕过节流（启动研究后的即时反馈） */
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

  /** 当前科研视图数据（无科研状态返回 null） */
  _research() {
    const w = this.app.world;
    return w ? researchView(w, w.playerFactionId) : null;
  },

  /** 重建数据区：保留 body 纵向滚动与科技树横向滚动 */
  _refresh(snap) {
    if (!this._bodyEl) return;
    const savedTop = this._bodyEl.scrollTop;
    const oldGrid = this._treeBox && this._treeBox.firstElementChild;
    const savedLeft = oldGrid ? oldGrid.scrollLeft : 0;

    const rv = this._research();
    this._renderHead(rv);
    this._renderStats(rv);
    this._renderTree(rv);

    this._bodyEl.scrollTop = savedTop;
    const newGrid = this._treeBox && this._treeBox.firstElementChild;
    if (newGrid) newGrid.scrollLeft = savedLeft;
  },

  /** 头部：产出徽章 + 已完成计数 */
  _renderHead(rv) {
    if (!this._headDyn) return;
    clearEl(this._headDyn);
    if (!rv) {
      this._headDyn.appendChild(el('span', { class: 'vf-faint vf-small', text: '科研状态未初始化' }));
      return;
    }
    this._headDyn.appendChild(resourceChip({ label: '研究点/小时', value: rv.outputPerHour }));
    this._headDyn.appendChild(el('span', { class: 'vf-dim vf-small', text: `已完成 ${rv.completed.length} 项` }));
    this._headDyn.appendChild(el('span', { class: 'vf-grow' }));
    this._headDyn.appendChild(el('span', { class: 'vf-faint vf-small', text: '研究槽最多 2 项并行，队列项目在前置满足后自动开始' }));
  },

  /** 顶部统计：产出解释 + 进行中项目进度条 + 队列列表 */
  _renderStats(rv) {
    if (!this._statsBox) return;
    clearEl(this._statsBox);
    if (!rv) {
      this._statsBox.appendChild(el('div', {
        class: 'vf-faint vf-center', style: { padding: '40px 0' },
        text: '尚无科研数据——进入战役后在此规划研究路线。',
      }));
      return;
    }

    const p = panel({ title: '产出与项目', dense: true });

    // 产出解释（任务书 6.4：计算来源）
    const pairs = [['研究点/小时', String(rv.outputPerHour)]];
    for (const e of rv.explain || []) {
      pairs.push([e.source != null ? String(e.source) : '来源', fmtModValue(e.value)]);
    }
    if (!rv.explain || rv.explain.length === 0) {
      pairs.push(['修正来源', '无额外修正（基础产出）']);
    }
    p.appendChild(kvList(pairs));

    // 进行中项目
    p.appendChild(el('div', { class: 'vf-dim vf-small', style: { marginTop: '6px' }, text: '进行中' }));
    if (rv.active.length === 0) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '没有进行中的项目——在下方科技树点击 available 节点启动研究。' }));
    }
    for (const a of rv.active) {
      p.appendChild(progressBar({
        value: a.progress || 0, max: Math.max(a.cost || 1, 1),
        label: a.name || a.techId, kind: 'accent',
        detail: `${Math.round(a.progress || 0)}/${a.cost}`,
      }));
    }

    // 队列（只展示，不提供移除命令）
    const byId = new Map(rv.techs.map((t) => [t.id, t]));
    p.appendChild(el('div', { class: 'vf-dim vf-small', style: { marginTop: '6px' }, text: `队列（${rv.queue.length}）` }));
    if (rv.queue.length === 0) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '队列为空。' }));
    } else {
      const list = el('div', { class: 'vf-col', style: { gap: '2px' } });
      rv.queue.forEach((techId, i) => {
        const t = byId.get(techId);
        list.appendChild(el('div', { class: 'vf-small', text: `${i + 1}. ${t ? t.name : techId}` }));
      });
      p.appendChild(list);
    }

    this._statsBox.appendChild(p);
  },

  /** 科技树：7 列（类别），列内按 tier 升序；available 节点点击启动研究 */
  _renderTree(rv) {
    if (!this._treeBox) return;
    clearEl(this._treeBox);

    if (!rv) {
      this._treeBox.appendChild(el('div', { class: 'vf-faint vf-center', style: { padding: '24px 0' }, text: '暂无科技树数据。' }));
      if (this._searchHint) this._searchHint.textContent = '';
      return;
    }

    const q = this._filter;
    const grid = el('div', { class: 'vf-tech-grid' });
    let totalShown = 0;

    for (const [catKey, catName, catEn] of TECH_CATS) {
      const col = el('div', { class: 'vf-tech-col' });
      col.appendChild(el('div', { class: 'vf-dim vf-small', style: { letterSpacing: '1px' }, text: `${catName} · ${catEn}` }));

      // 类别内按 tier 升序（同 tier 按 id 稳定排序），再套用搜索过滤
      const techs = rv.techs
        .filter((t) => t.category === catKey)
        .filter((t) => !q || (t.name || '').toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
        .sort((a, b) => (a.tier - b.tier) || String(a.id).localeCompare(String(b.id)));

      if (techs.length === 0) {
        col.appendChild(el('div', { class: 'vf-faint vf-small', style: { padding: '6px 0' }, text: q ? '无匹配' : '—' }));
      }
      for (const t of techs) {
        col.appendChild(this._techNode(t, rv));
      }
      totalShown += techs.length;
      grid.appendChild(col);
    }

    this._treeBox.appendChild(grid);
    if (this._searchHint) {
      this._searchHint.textContent = q ? `匹配 ${totalShown} / ${rv.techs.length} 项` : `共 ${rv.techs.length} 项`;
    }
  },

  /** 单个科技节点卡片（状态类由 CSS 着色） */
  _techNode(t, rv) {
    const active = t.status === 'active';
    const available = t.status === 'available';
    const done = t.status === 'done';
    const locked = t.status === 'locked';

    // 悬停说明：描述 / 前置要求 / 研究中提示
    let title = t.desc || '';
    if (locked) {
      const byId = new Map(rv.techs.map((x) => [x.id, x]));
      const missing = (t.prereqs || []).filter((pid) => !rv.completed.includes(pid))
        .map((pid) => (byId.get(pid) ? byId.get(pid).name : pid));
      title = `需要前置：${missing.join('、') || '未知科技'}`;
    } else if (done) {
      title = '已研究完成';
    } else if (active) {
      title = '研究中';
    }

    const node = el('div', {
      class: `vf-tech-node ${t.status}`,
      title,
      ...(available ? {
        on: {
          click: () => {
            this.app.dispatch('StartResearch', { techId: t.id });
            this._forceRefresh();
          },
        },
      } : {}),
    });

    node.appendChild(el('div', { class: 'vf-small', text: t.name || t.id }));
    node.appendChild(el('div', { class: 'cat', text: `T${t.tier} · ${t.cost} 研究点` }));
    for (const e of t.effects || []) {
      const line = effectText(e);
      if (line) node.appendChild(el('div', { class: 'vf-faint vf-small', text: line }));
    }
    return node;
  },
};
