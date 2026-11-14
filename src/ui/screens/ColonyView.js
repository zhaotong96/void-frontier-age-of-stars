/**
 * ui/screens/ColonyView.js — 殖民地管理视图（任务书 6.2 colonyDetail）
 *
 * 结构：.vf-view > .vf-view-head（标题 + 殖民地下拉 + 名称/标签 + 稳定度仪表
 *            + 3D 地表模式切换 + 升级按钮）
 *            + .vf-view-body.pad（三列 grid：人口与环境 / 建筑与建造 / 库存与账本）
 *
 * 数据来源：simulation/ViewModels.colonyDetail（只读）+ 快照 colonies 列表；
 * 命令：UpgradeColony / BuildOnColony（经 app.dispatch，失败由命令总线 toast 反馈）。
 * 刷新：onSnapshot 以 250ms 节流重建数据区；重建前后保留 .vf-view-body 的滚动位置。
 * 布局状态（选中殖民地、建筑行展开、下拉选项）只保存在视图实例上，绝不写入世界。
 * 生命周期：持久控件监听登记到 _handlers 由 unmount 统一移除；
 * 重建产生的子节点监听随节点从 DOM 移除一并释放（不悬挂在文档级）。
 */

import { el, clearEl } from '../components/dom.js';
import { dataTable, panel, kvList, statBar, progressBar } from '../components/index.js';
import { gauge, stackBar } from '../charts/index.js';
import { L } from '../../core/i18n.js';
import { dateStr } from '../../core/clock.js';
import { colonyDetail } from '../../simulation/ViewModels.js';
import { BUILDINGS } from '../../content/buildings.js';
import { RESOURCES } from '../../content/resources.js';
import { BAL } from '../../content/constants.js';
import { storageCapacity, buildingJobSlots } from '../../domain/planets/colony.js';
import { COLONY_EDICTS, MAX_RESIDENT_AGENTS } from '../../domain/planets/colonyGovernance.js';

/** 快照刷新节流间隔（与 App 的 4Hz 快照节奏对齐） */
const REFRESH_MS = 250;

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

/** 建筑状态 → [中文标签, vf-tag 色调] */
const BLD_STATE_ZH = {
  active: ['运行中', 'ok'],
  construction: ['建造中', 'accent'],
  starved: ['缺料', 'danger'],
  suspended: ['停摆', 'warn'],
};

/** 五态 runtimeStatus 诊断 → [彩色圆点+中文, vf-tag 色调]（doc5 §3.8 P2-02 / ECON-02） */
const RUNTIME_STATUS_ZH = {
  running: ['● 运行中', 'ok'],
  understaffed: ['● 劳力短缺', 'warn'],
  starved_input: ['● 断供', 'danger'],
  low_power: ['● 电力不足', 'warn'],
  storage_full: ['● 仓储满溢', 'danger'],
};

/** 四级流向看板分层（doc5 §3.8：矿脉采掘 → 仓储物流 → 精炼制造 → 船坞/轨道输出） */
const FLOW_TIERS = [
  { key: 'mining', title: '① 矿脉采掘', cats: ['mining'], hint: '矿井/气井按矿藏开采原矿，岗位短缺按 η 降产。' },
  { key: 'storage', title: '② 仓储物流', cats: ['energy'], hint: '原料入殖民地仓储（含供能设施）；满溢将阻塞上游周期启动。' },
  { key: 'refining', title: '③ 精炼制造', cats: ['refining', 'industry', 'agri', 'science'], hint: '精炼/制造/农业/科研消耗原矿与中间品，输出精炼品与科研数据。' },
  { key: 'output', title: '④ 船坞/轨道输出', cats: ['admin'], hint: '行政港/交易所承担轨道输出与贸易税收。' },
];

/** 建筑类别中文（表格列与建造面板分组；键序即展示序） */
const BLD_CAT_ZH = {
  mining: '采掘', refining: '精炼', industry: '工业', agri: '农业',
  science: '科研', service: '服务', military: '军事', admin: '行政', energy: '能源',
};

/** 人口阶层中文（stackBar 分段标签） */
const STRATA_ZH = {
  worker: '工人', farmer: '农民', engineer: '工程师', researcher: '研究员',
  administrator: '行政官', soldier: '士兵', trader: '商人', unemployed: '失业者',
};

/** 建造队列任务状态 → [中文, 色调] */
const JOB_STATE_ZH = {
  waiting: ['等待开工', 'warn'],
  building: ['建造中', 'accent'],
  'missing-material': ['缺料停工', 'danger'],
};

/** 建筑内容索引（只读：建造队列进度需要 buildHours） */
const BLD_DEFS = new Map(BUILDINGS.map((b) => [b.id, b]));
/** 资源定义索引（只读查询；未知 id 不抛错，回退显示原始 id） */
const RES_DEFS = new Map(RESOURCES.map((r) => [r.id, r]));

function buildingDef(defId) {
  return BLD_DEFS.get(defId);
}

/** 资源中文名：本地映射 → 定义 nameZh（内容扩展时）→ 原始 id */
function resName(rid) {
  const def = RES_DEFS.get(rid);
  return RES_NAME_ZH[rid] || (def && def.nameZh) || rid;
}

/** 数量缩写：>=1e4 缩写为 K/M/B，其余原样（保留两位小数） */
function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v * 100) / 100);
}

/** 带符号数值（能源平衡等） */
function fmtSigned(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v >= 0 ? `+${fmtQty(v)}` : String(Math.round(v * 100) / 100);
}

/** 成本对象 → 紧凑文本，如「400 信用点 · 合金×30」 */
function costText(cost) {
  if (!cost) return '—';
  const parts = [];
  for (const rid of Object.keys(cost).sort()) {
    const name = rid === 'credits' ? '信用点' : resName(rid);
    parts.push(`${cost[rid]} ${name}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

export const ColonyView = {
  id: 'colony',
  title: '殖民地',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._snap = app.snapshot || null;
    this._lastAt = -REFRESH_MS; // 负值哨兵：保证首次快照必刷（不受页面加载耗时影响）
    this._force = false;       // 命令后绕过节流的强制刷新标记
    this._expanded = new Set(); // 展开的建筑行（building.index）
    this._handlers = [];       // 持久监听登记：{ target, type, fn }

    // param 为空时取玩家第一个殖民地（在 _refresh 中兜底）
    this._colonyId = typeof ctx.param === 'string' && ctx.param ? ctx.param : null;

    root.innerHTML = '';

    // —— 头部：标题 + 殖民地下拉 + 动态区（名称/标签/仪表/升级按钮） ——
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.colony') }));
    this._selColony = el('select', { 'aria-label': '切换殖民地', style: { maxWidth: '180px' } });
    this._bind(this._selColony, 'change', () => {
      if (!this._selColony.value) return;
      this._colonyId = this._selColony.value;
      this._expanded.clear();
      // 检视器联动（只读 UI 状态）+ URL 同步；两者都会触发一次快照刷新
      app.select('colony', this._colonyId);
      app.goto('colony', this._colonyId);
    });
    head.appendChild(this._selColony);
    this._headDyn = el('div', { class: 'vf-row vf-grow', style: { gap: '10px' } });
    head.appendChild(this._headDyn);

    // —— 主体：三列 grid（列内为 vf-col 面板堆叠） ——
    const body = el('div', { class: 'vf-view-body pad' });
    this._bodyEl = body;
    this._grid = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr)',
        gap: '10px',
        alignItems: 'start',
      },
    });
    this._col1 = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });
    this._col2 = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });
    this._col3 = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });
    this._grid.append(this._col1, this._col2, this._col3);
    body.appendChild(this._grid);

    root.appendChild(el('div', { class: 'vf-view' }, [head, body]));

    // 挂载时若已有快照则立即渲染一次（onSnapshot 随后按节流接管）
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
    this._selColony = null;
    this._headDyn = null;
    this._bodyEl = null;
    this._grid = null;
    this._col1 = this._col2 = this._col3 = null;
  },

  /** 快照推送：250ms 节流；_force 时绕过节流（命令后的即时反馈） */
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

  /** 命令后的即时重绘：绕过节流并使用最新快照 */
  _forceRefresh() {
    this._force = true;
    this.onSnapshot(this.app.snapshot || this._snap);
  },

  /** 快照中的己方殖民地列表（只读过滤） */
  _ownColonies(snap) {
    const pid = this.app.world && this.app.world.playerFactionId;
    return (snap && Array.isArray(snap.colonies))
      ? snap.colonies.filter((c) => c.factionId === pid)
      : [];
  },

  /** 校正当前殖民地 id：param 失效（被摧毁等）时回退到第一个己方殖民地 */
  _ensureColonyId(snap) {
    const list = this._ownColonies(snap);
    if (!list.some((c) => c.id === this._colonyId)) {
      this._colonyId = list.length ? list[0].id : null;
    }
    return list;
  },

  /** 重建数据区：保留 .vf-view-body 滚动位置 */
  _refresh(snap) {
    if (!this._bodyEl) return;
    const savedTop = this._bodyEl.scrollTop;
    const savedLeft = this._bodyEl.scrollLeft;

    const list = this._ensureColonyId(snap);

    // 头部下拉选项（重建后恢复选中值）
    if (this._selColony) {
      clearEl(this._selColony);
      for (const c of list) {
        this._selColony.appendChild(el('option', { value: c.id, text: c.name }));
      }
      if (this._colonyId) this._selColony.value = this._colonyId;
      this._selColony.disabled = list.length === 0 ? true : null;
    }

    const detail = this._colonyId && this.app.world
      ? colonyDetail(this.app.world, this._colonyId)
      : null;

    this._renderHead(detail);
    clearEl(this._col1);
    clearEl(this._col2);
    clearEl(this._col3);

    if (!detail) {
      clearEl(this._bodyEl).appendChild(el('div', {
        class: 'vf-faint vf-center', style: { padding: '40px 0' },
        text: list.length === 0 ? '尚未拥有任何殖民地——派遣舰队建立前哨后即可在此管理。' : '目标殖民地已失效。',
      }));
      return;
    }
    this._bodyEl.appendChild(this._grid); // 空态替换后把 grid 挂回
    this._renderCol1(detail);
    this._renderCol2(detail);
    this._renderCol3(detail);
    // SPEC-PLAN-052 Task 52.2（M4 工位 D）：行星灵魂 / 16×16 热力图 / 三层垂直建造 /
    // 专项决策（colonyDetail.spaceOpera 投影缺失时 renderSpaceOperaColonyPanel 返回 null）
    const soPanel = renderSpaceOperaColonyPanel(this, detail);
    if (soPanel) this._col2.appendChild(soPanel);
    this._renderGovernancePanel(detail);

    this._bodyEl.scrollTop = savedTop;
    this._bodyEl.scrollLeft = savedLeft;
  },

  /** 头部动态区：名称 / 前哨标签 / 稳定度仪表 / 3D 地表切换 / 升级按钮 */
  _renderHead(detail) {
    if (!this._headDyn) return;
    clearEl(this._headDyn);
    if (!detail) return;

    this._headDyn.appendChild(el('strong', { text: detail.name }));
    this._headDyn.appendChild(el('span', { class: 'vf-dim vf-small', text: detail.systemName || '' }));
    this._headDyn.appendChild(el('span', {
      class: `vf-tag ${detail.isOutpost ? 'warn' : 'ok'}`,
      text: detail.isOutpost ? '前哨' : '完整殖民地',
    }));
    this._headDyn.appendChild(gauge({
      value: Math.round(detail.stability), max: 100, label: '稳定度', width: 132, height: 76,
    }));
    this._headDyn.appendChild(el('span', { class: 'vf-grow' }));

    // 头部 3D 地表切换：直达全 3D 行星地表视图（体素地形 + 第三人称 RPG）；
    // 目标行星经 app._groundTargetPlanet 传给 GroundView
    const app = this.app;
    const groundPlanetId = detail.planet ? detail.planet.id : null;
    this._headDyn.appendChild(el('button', {
      class: 'vf-btn primary',
      text: '🌍 3D 地表模式',
      title: '切换到全 3D 行星地表视图（体素地形 + 第三人称 RPG）',
      disabled: groundPlanetId ? null : true,
      on: {
        click: () => {
          // 设置 GroundView 的目标行星
          app._groundTargetPlanet = groundPlanetId;
          app.goto('ground');
        },
      },
    }));

    if (detail.isOutpost) {
      // 升级失败（资源不足等）由命令总线 toast 反馈
      this._headDyn.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: '升级为殖民地',
        title: '支付 合金×30 · 信用点×220，解锁完整人口增长与 10 住房',
        on: {
          click: () => {
            this.app.dispatch('UpgradeColony', { colonyId: detail.id });
            this._forceRefresh();
          },
        },
      }));
    }
  },

  /** 第一列：人口与环境 */
  _renderCol1(detail) {
    const pop = detail.population || { total: 0, strata: {} };

    // 人口构成（stackBar 悬停显示分段数值）
    const pPop = panel({ title: '人口', dense: true });
    const strataParts = Object.keys(pop.strata || {})
      .filter((st) => (pop.strata[st] || 0) > 0)
      .sort((a, b) => pop.strata[b] - pop.strata[a])
      .map((st) => ({ value: pop.strata[st], label: STRATA_ZH[st] || st }));
    pPop.appendChild(stackBar({ parts: strataParts, total: Math.max(pop.total, 1), height: 12 }));
    pPop.appendChild(el('div', {
      class: 'vf-faint vf-small',
      text: strataParts.map((p) => `${p.label} ${p.value}`).join(' · ') || '无人定居',
    }));
    const housingRatio = pop.total / Math.max(1, detail.housing || 1);
    pPop.appendChild(kvList([
      ['人口总数', String(pop.total)],
      ['住房', statBar({
        value: pop.total, max: Math.max(detail.housing || 1, 1),
        label: '住房', tone: housingRatio > 1 ? 'danger' : housingRatio > 0.85 ? 'warn' : null,
      })],
    ]));
    this._col1.appendChild(pPop);

    // 行星环境
    const pl = detail.planet;
    const pEnv = panel({ title: '行星环境', dense: true });
    pEnv.appendChild(kvList([
      ['所在星系', detail.systemName || '—'],
      ['类别', pl ? String(pl.categoryName ?? pl.category ?? '—') : '—'],
      ['宜居度', pl ? String(Math.round(pl.habitability)) : '—'],
      ['重力', pl ? `${pl.gravity} G` : '—'],
      ['大气', pl ? String(pl.atmosphere || '—') : '—'],
      ['辐射', pl ? String(pl.radiation) : '—'],
      ['建立日期', dateStr(detail.foundedTick)],
    ]));
    this._col1.appendChild(pEnv);

    // 食物存量与生产说明
    const ledger = detail.ledger || {};
    const foodLed = ledger.food || { produced: 0, consumed: 0 };
    const pFood = panel({ title: '食物', dense: true });
    pFood.appendChild(kvList([
      ['存量', fmtQty(detail.stock && detail.stock.food || 0)],
      ['本日产出', `+${fmtQty(foodLed.produced || 0)}`],
      ['本日消耗', `-${fmtQty(foodLed.consumed || 0)}`],
    ]));
    pFood.appendChild(el('div', {
      class: 'vf-faint vf-small',
      text: `人口每日按人均 ${BAL.population.foodPerPop} t 消耗食物；缺粮触发饥荒（人口死亡）并压低稳定度，住房超员也会停止增长。账本流水按游戏日清零。`,
    }));
    this._col1.appendChild(pFood);
  },

  /** 第二列：四级流向看板 + 建筑表（行展开配方）+ 建造面板 + 建造队列 */
  _renderCol2(detail) {
    this._col2.appendChild(this._flowPanel(detail));

    // 概要：能源平衡与槽位
    const pBld = panel({ title: '建筑', dense: true });
    const bal = Number(detail.powerBalance) || 0;
    pBld.appendChild(kvList([
      ['能源平衡', el('span', { class: bal < 0 ? 'vf-danger vf-mono' : 'vf-ok vf-mono', text: fmtSigned(bal) })],
      ['槽位', `${detail.buildings.length} / ${detail.buildingSlots}`],
    ]));
    pBld.appendChild(this._buildingTable(detail));
    if (this._expanded.size > 0) {
      pBld.appendChild(el('div', {
        class: 'vf-faint vf-small',
        text: '产出速度 = 能源系数 × 宜居度修正 × 类别加成；电力缺口时按比例降产（下限 30%），缺料则整周期暂停。',
      }));
    }
    this._col2.appendChild(pBld);

    this._col2.appendChild(this._buildPanel(detail));
    this._col2.appendChild(this._queuePanel(detail));
  },

  /** 活体殖民地实体（runtimeStatus / jobsFilled 在实体上，ViewModel 只读快照不含） */
  _liveColony() {
    const w = this.app && this.app.world;
    return (w && w.entities && w.entities.colonies && this._colonyId)
      ? w.entities.colonies[this._colonyId] || null
      : null;
  },

  /** 建筑运行状态徽章：五态 runtimeStatus 优先，缺省回退 building state（建造中/停摆） */
  _runtimeBadge(b) {
    if (b.runtimeStatus && RUNTIME_STATUS_ZH[b.runtimeStatus]) {
      const [text, tone] = RUNTIME_STATUS_ZH[b.runtimeStatus];
      const tip = b.runtimeStatus === 'starved_input' && b.starvedInput
        ? `断供原料：${resName(b.starvedInput)}` : undefined;
      return el('span', { class: `vf-tag ${tone}`, title: tip, text });
    }
    const [text, tone] = BLD_STATE_ZH[b.state] || [b.state || '—', ''];
    return el('span', { class: tone ? `vf-tag ${tone}` : 'vf-tag', text });
  },

  /**
   * 四级流向看板（doc5 §3.8 P2-01/02）：矿脉采掘 → 仓储物流 → 精炼制造 → 船坞/轨道输出。
   * 逐建筑 runtimeStatus 徽章 + 仓储容量条 + 瓶颈摘要；面板 id 稳定（UIStateStore 折叠记忆）。
   */
  _flowPanel(detail) {
    const p = panel({ title: '物流流向看板', dense: true, id: 'colony:flow' });
    const colony = this._liveColony();
    const buildings = colony && Array.isArray(colony.buildings) ? colony.buildings : [];

    // 顶层流向链
    p.appendChild(el('div', {
      class: 'vf-dim vf-small',
      style: { marginBottom: '4px', letterSpacing: '1px' },
      text: FLOW_TIERS.map((t) => t.title.replace(/^\S+\s/, '')).join('  ▸  '),
    }));

    const statusCount = {};
    for (const tier of FLOW_TIERS) {
      const sec = el('div', { class: 'vf-col', style: { gap: '2px', marginTop: '4px' } });
      sec.appendChild(el('div', { class: 'vf-dim vf-small', text: tier.title }));

      if (tier.key === 'storage') {
        // 仓储物流：原料存量概览 + 容量条（满溢预警）
        const cap = colony ? storageCapacity(colony) : 0;
        const stockRows = Object.keys(detail.stock || {})
          .filter((rid) => (Number(detail.stock[rid]) || 0) > 0)
          .sort((a, b) => detail.stock[b] - detail.stock[a])
          .slice(0, 5)
          .map((rid) => `${resName(rid)} ${fmtQty(detail.stock[rid])}`);
        sec.appendChild(el('div', {
          class: 'vf-small',
          text: stockRows.length ? stockRows.join(' · ') : '仓储为空',
        }));
        const peak = Math.max(1, ...Object.keys(detail.stock || {}).map((rid) => Number(detail.stock[rid]) || 0));
        sec.appendChild(statBar({
          value: Math.min(peak, cap), max: Math.max(cap, peak, 1),
          label: `仓储峰值 / 容量 ${cap}`, tone: peak >= cap ? 'danger' : peak >= cap * 0.85 ? 'warn' : null,
        }));
      }

      // 本层建筑徽章行
      const tierBlds = buildings.filter((b) => tier.cats.includes(buildingDef(b.defId)?.category));
      if (tier.key !== 'storage' && tierBlds.length === 0) {
        sec.appendChild(el('div', { class: 'vf-faint vf-small', text: '（本层暂无设施）' }));
      }
      for (const b of tierBlds) {
        const def = buildingDef(b.defId);
        const row = el('div', { class: 'vf-row', style: { gap: '6px' } });
        row.appendChild(el('span', { class: 'vf-grow vf-small', text: def ? def.nameZh : b.defId }));
        row.appendChild(el('span', { class: 'vf-faint vf-small vf-mono', text: `${b.jobsFilled ?? 0}/${buildingJobSlots(def)}岗` }));
        const badge = this._runtimeBadge(b);
        if (badge && b.runtimeStatus) {
          statusCount[b.runtimeStatus] = (statusCount[b.runtimeStatus] || 0) + 1;
        }
        row.appendChild(badge);
        sec.appendChild(row);
      }
      if (tier.hint && (tierBlds.length > 0 || tier.key === 'storage')) {
        sec.appendChild(el('div', { class: 'vf-faint vf-small', text: tier.hint }));
      }
      p.appendChild(sec);
    }

    // 瓶颈摘要（ECON-02：阻塞原因一眼可读）
    const issues = Object.keys(statusCount).filter((k) => k !== 'running');
    p.appendChild(el('div', {
      class: issues.length ? 'vf-warn vf-small' : 'vf-ok vf-small',
      style: { marginTop: '4px' },
      text: issues.length
        ? `产能瓶颈：${issues.map((k) => `${RUNTIME_STATUS_ZH[k][0].replace('● ', '')}×${statusCount[k]}`).join('，')}`
        : '全链路运行中，无阻塞。',
    }));
    return p;
  },

  /** 建筑 dataTable + 展开明细行（配方 inputs→outputs） */
  _buildingTable(detail) {
    const colony = this._liveColony();
    const rows = detail.buildings.map((b) => ({
      ...b,
      id: b.index,
      runtimeStatus: colony && colony.buildings[b.index] ? colony.buildings[b.index].runtimeStatus : null,
      starvedInput: colony && colony.buildings[b.index] ? colony.buildings[b.index].starvedInput : null,
      jobsFilled: colony && colony.buildings[b.index] ? colony.buildings[b.index].jobsFilled : null,
    }));
    const table = dataTable({
      dense: true,
      rows,
      emptyText: '没有任何建筑——从下方建造面板排入第一项工程。',
      onRowClick: (row) => {
        // 行展开为纯视图状态；再点一次收起
        if (this._expanded.has(row.index)) this._expanded.delete(row.index);
        else this._expanded.add(row.index);
        this._forceRefresh();
      },
      columns: [
        { key: 'name', label: '名称' },
        { key: 'category', label: '类别', render: (r) => BLD_CAT_ZH[r.category] || r.category || '—' },
        {
          key: 'state', label: '状态',
          render: (r) => this._runtimeBadge(r),
        },
        {
          key: 'progress', label: '进度',
          render: (r) => (r.state === 'construction' || !r.cycleHours)
            ? '—'
            : `${Math.min(100, Math.round((r.progress / r.cycleHours) * 100))}%`,
        },
        {
          key: 'jobs', label: '岗位',
          render: (r) => {
            const def = buildingDef(r.defId);
            const slots = buildingJobSlots(def);
            if (r.jobsFilled == null) return slots > 0 ? `—/${slots}` : '—';
            return `${r.jobsFilled}/${slots}`;
          },
        },
        {
          key: 'powerUse', label: '能耗',
          render: (r) => (r.powerGen > 0 ? `+${r.powerGen}` : (r.powerUse ? String(r.powerUse) : '—')),
        },
      ],
    });
    // 在展开行后插入明细行（colSpan 占满整行；dataTable 不支持嵌套行，这里后处理）
    const tbody = table.querySelector('tbody');
    for (const idx of [...this._expanded].sort((a, b) => a - b)) {
      const b = detail.buildings.find((x) => x.index === idx);
      const tr = tbody && tbody.querySelector(`tr[data-id="${idx}"]`);
      if (!b || !tr) continue;
      tr.after(this._detailRow(b));
    }
    return table;
  },

  /** 展开明细行：配方投入→产出 + 周期说明 */
  _detailRow(b) {
    const box = el('div', { class: 'vf-col vf-small', style: { padding: '4px 2px', gap: '2px' } });
    if (b.recipe) {
      const fmt = (m) => Object.keys(m || {}).sort().map((rid) => `${resName(rid)}×${m[rid]}`).join('、') || '无';
      box.appendChild(el('div', { text: `配方（${b.cycleHours}h/周期）：投入 ${fmt(b.recipe.inputs)} → 产出 ${fmt(b.recipe.outputs)}` }));
    } else {
      box.appendChild(el('div', { text: '非生产建筑：提供岗位/服务/加成，不运行生产配方。' }));
    }
    box.appendChild(el('div', {
      class: 'vf-faint',
      text: `本周期按小时推进（当前 ${Math.round(b.progress * 100) / 100}/${b.cycleHours ?? '—'}h）；能源系数由电力平衡决定：缺电按比例降产、最低 30%，不无因停摆。`,
    }));
    if (b.state === 'starved') {
      box.appendChild(el('div', { class: 'vf-warn', text: '原料不足：周期未开始，等待库存补充配方投入。' }));
    }
    if (b.state === 'suspended') {
      box.appendChild(el('div', { class: 'vf-warn', text: '已手动停摆：不投入原料、不产出。' }));
    }
    const td = el('td', { colspan: '6' }, [box]);
    td.style.background = 'rgba(79, 216, 232, 0.05)';
    return el('tr', { class: 'vf-bld-detail' }, [td]);
  },

  /** 建造面板：availableBuildings 按类别分组 + 建造按钮 */
  _buildPanel(detail) {
    const p = panel({ title: '建造', dense: true });
    const groups = new Map();
    for (const def of detail.availableBuildings || []) {
      const cat = BLD_CAT_ZH[def.category] || def.category || '其他';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(def);
    }
    if (groups.size === 0) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无可建造项目。' }));
      return p;
    }
    for (const [cat, items] of groups) {
      p.appendChild(el('div', { class: 'vf-dim vf-small', style: { marginTop: '4px' }, text: `${cat}（${items.length}）` }));
      for (const def of items) {
        const row = el('div', { class: 'vf-row', style: { gap: '6px' } });
        row.appendChild(el('span', { class: 'vf-grow', title: def.desc || '', text: def.name }));
        row.appendChild(el('span', { class: 'vf-faint vf-small vf-mono', text: costText(def.cost) }));
        row.appendChild(el('span', { class: 'vf-faint vf-small', text: `${def.buildHours}h` }));
        // blocked（槽位已满）→ 禁用并说明；其余失败场景（队列满/科技）由命令总线 toast
        row.appendChild(el('button', {
          class: 'vf-btn small',
          text: '建造',
          disabled: def.blocked ? true : null,
          title: def.blocked || '排入建造队列（开工时支付资源）',
          on: {
            click: () => {
              this.app.dispatch('BuildOnColony', { colonyId: detail.id, defId: def.defId });
              this._forceRefresh();
            },
          },
        }));
        p.appendChild(row);
      }
    }
    return p;
  },

  /** 建造队列：逐项进度条（进度对齐 buildHours） */
  _queuePanel(detail) {
    const p = panel({ title: `建造队列（${(detail.constructionQueue || []).length}）`, dense: true });
    const queue = detail.constructionQueue || [];
    if (queue.length === 0) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '队列空闲——同一时间只推进队首工程。' }));
      return p;
    }
    queue.forEach((job, i) => {
      const hours = (BLD_DEFS.get(job.defId) && BLD_DEFS.get(job.defId).buildHours) || 24;
      const wrap = el('div', { class: 'vf-col', style: { gap: '2px' } });
      const head = el('div', { class: 'vf-row', style: { gap: '6px' } });
      head.appendChild(el('span', { class: 'vf-grow vf-small', text: `${i + 1}. ${job.name}` }));
      const [text, tone] = JOB_STATE_ZH[job.state] || [job.state || '—', ''];
      head.appendChild(el('span', { class: tone ? `vf-tag ${tone}` : 'vf-tag', text }));
      wrap.appendChild(head);
      wrap.appendChild(progressBar({
        value: job.progress || 0, max: hours, kind: 'accent',
        detail: `${Math.round(job.progress || 0)}/${hours}h`,
      }));
      p.appendChild(wrap);
    });
    return p;
  },

  /** 第三列：库存全表（数量为 0 的隐藏）+ 账本流水摘要 */
  /**
   * doc21 WP-5：总督公署与法典全息子面板——希望/不满双轨进度条 + 繁荣度 +
   * 七大特化类型标签 + 四大法典签署/废止 + 困境裁决卡（非侵入式）。
   */
  _renderGovernancePanel(detail) {
    const planet = this._planetOf(detail);
    if (!planet) return;
    const soc = planet.soc || null;
    const fid = this.app.world.playerFactionId;
    const research = fid && this.app.world.research ? this.app.world.research[fid] : null;
    const panel = el('div', { class: 'vf-panel', style: { marginTop: '10px' } });
    panel.appendChild(el('div', { class: 'vf-panel-title', text: '总督公署与法典（v0.8）' }));

    if (!soc) {
      panel.appendChild(el('div', {
        class: 'vf-faint vf-small',
        text: '首次进入该行星地表后激活聚落治理微模拟（planet.soc）。',
      }));
      this._grid.appendChild(panel);
      return;
    }

    // 双轨进度条（希望/不满）+ 繁荣度
    const bar = (label, v, color) => {
      const w = el('div', { class: 'vf-row', style: { gap: '6px', alignItems: 'center', margin: '2px 0' } });
      w.appendChild(el('span', { class: 'vf-small vf-dim', text: label, style: { width: '52px' } }));
      const track = el('div', { style: { flex: '1', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' } });
      const fill = el('div', { style: { width: `${Math.max(0, Math.min(100, v))}%`, height: '100%', background: color } });
      track.appendChild(fill);
      w.appendChild(track);
      w.appendChild(el('span', { class: 'vf-small', text: `${Math.round(v)}`, style: { width: '28px', textAlign: 'right' } }));
      return w;
    };
    panel.appendChild(bar('希望', soc.hope, '#5ab8e0'));
    panel.appendChild(bar('不满', soc.discontent, '#e06a5a'));
    panel.appendChild(bar('繁荣度', soc.prosperity, '#7ee2a8'));
    panel.appendChild(el('div', {
      class: 'vf-small vf-dim',
      text: `Φ = 0.40·H + 0.30·(100−D) + 0.15·S_svc + 0.15·η_power = ${soc.prosperity}（税基 ×${(1 + Math.pow(soc.prosperity / 100, 2) * 1.5).toFixed(2)}）`,
    }));

    // 总督
    const overseerName = soc.overseerId && this.app.world.entities.characters[soc.overseerId]
      ? this.app.world.entities.characters[soc.overseerId].name : '（未任命）';
    panel.appendChild(el('div', { class: 'vf-small', text: `驻星总督：${overseerName}` }));

    // 法典签署/废止
    const edictsRow = el('div', { class: 'vf-row', style: { gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    for (const eid of Object.keys(COLONY_EDICTS)) {
      const ed = COLONY_EDICTS[eid];
      const signed = soc.edicts.includes(eid);
      edictsRow.appendChild(el('button', {
        class: signed ? 'vf-btn ok' : 'vf-btn',
        text: `${signed ? '✓ ' : ''}${ed.nameZh}`,
        title: ed.desc,
        onClick: () => {
          this.app.dispatch(signed ? 'RevokeColonyEdict' : 'SignColonyEdict', { planetId: planet.id, edictId: eid });
          this.refresh();
        },
      }));
    }
    panel.appendChild(edictsRow);

    // 困境裁决卡（非侵入式）
    if (soc.pendingDilemma) {
      const d = soc.pendingDilemma;
      const card = el('div', { class: 'vf-panel', style: { background: 'rgba(60,40,10,0.35)', margin: '4px 0' } });
      card.appendChild(el('div', { class: 'vf-small vf-strong', text: `治理困境：${d.id}` }));
      for (const ch of d.choices) {
        card.appendChild(el('button', {
          class: 'vf-btn vf-small',
          text: ch.nameZh,
          onClick: () => {
            const res = this.app.dispatch('ResolveColonyDilemma', { planetId: planet.id, choiceId: ch.id });
            if (!res.ok) toast(res.reason || '裁决失败', { kind: 'warn' });
            this.refresh();
          },
        }));
      }
      panel.appendChild(card);
    }

    // 暴动状态
    if (soc.rebellionActive) {
      panel.appendChild(el('div', {
        class: 'vf-small', style: { color: '#e06a5a' },
        text: '⚠ 武装暴动进行中：派遣地面小队执行 gmt_suppress_rebellion 平叛任务。',
      }));
    }

    panel.appendChild(el('div', {
      class: 'vf-faint vf-small',
      text: `居民代表 ${soc.agents.length}/${MAX_RESIDENT_AGENTS} 名 · 历史记忆 ${soc.history.length} 条 · 特化类型 ${detail.colonyType || '通用'}`,
    }));
    void research;
    this._grid.appendChild(panel);
  },

  /** 行星实体解析（detail.planetId → world 实体；缺失安全返回 null） */
  _planetOf(detail) {
    return detail && detail.planetId && this.app.world.entities.planets
      ? this.app.world.entities.planets[detail.planetId] : null;
  },

  _renderCol3(detail) {
    const stockRows = Object.keys(detail.stock || {})
      .filter((rid) => (Number(detail.stock[rid]) || 0) > 0)
      .map((rid) => ({ id: rid, rid, qty: Number(detail.stock[rid]) || 0 }))
      .sort((a, b) => b.qty - a.qty);
    const pStock = panel({ title: '库存', dense: true });
    pStock.appendChild(dataTable({
      dense: true,
      rows: stockRows,
      emptyText: '库存为空——检查生产链输入或从市场调运。',
      columns: [
        { key: 'rid', label: '资源', render: (r) => resName(r.rid) },
        { key: 'qty', label: '数量', align: 'right', render: (r) => fmtQty(r.qty) },
      ],
    }));
    this._col3.appendChild(pStock);

    const ledger = detail.ledger || {};
    const ledRows = Object.keys(ledger)
      .filter((rid) => (Number(ledger[rid].produced) || 0) !== 0 || (Number(ledger[rid].consumed) || 0) !== 0)
      .sort()
      .map((rid) => ({ id: rid, rid, produced: Number(ledger[rid].produced) || 0, consumed: Number(ledger[rid].consumed) || 0 }));
    const pLed = panel({ title: '账本摘要', dense: true });
    pLed.appendChild(el('div', { class: 'vf-faint vf-small', text: '本周期的 produced / consumed 流水，按游戏日清零。' }));
    pLed.appendChild(dataTable({
      dense: true,
      rows: ledRows,
      emptyText: '暂无流水。',
      columns: [
        { key: 'rid', label: '资源', render: (r) => resName(r.rid) },
        { key: 'produced', label: '产出', align: 'right', render: (r) => el('span', { class: 'vf-ok vf-mono', text: `+${fmtQty(r.produced)}` }) },
        { key: 'consumed', label: '消耗', align: 'right', render: (r) => el('span', { class: 'vf-danger vf-mono', text: `-${fmtQty(r.consumed)}` }) },
      ],
    }));
    this._col3.appendChild(pLed);
  },
};

/* ==================== SPEC-PLAN-052 Task 52.2：行星灵魂 / 16×16 热力图 / 三层垂直建造（M4 工位 D） ==================== */

import { unpackTile, URBAN_ZONE_TYPES } from '../../domain/planets/planetStateSchema.js';

/** 16×16 覆盖层（Bits 12–15 之外的 overlayId Bits 22–25）配色（doc52 §Task 52.2 §2） */
const OVERLAY_STYLE = [
  null,                          // 0 无
  ['#39c46a', '#e84fd8'],        // 1 共生菌丝网（墨绿/荧光粉）
  ['#ff5722', '#ff9800'],        // 2 喷发熔岩流（熔融橙红）
  ['#bfe8ff', '#7fd4ff'],        // 3 极寒冰封（苍白冰蓝）
  ['#a06bff', '#4fd8e8'],        // 4 先驱者晶格（棱镜青紫）
  ['#7a5cff', '#b0ff59'],        // 5 索林虫族菌毯
  ['#8d9a7f', '#c9d4b8'],        // 6 工业毒雾
  ['#5a4633', '#8a6d4d'],        // 7 地下坍塌坑洞
];

/** 五纪元徽章（doc52：Epoch 0 蛮荒 → 4 遗产） */
const EPOCH_ZH = ['蛮荒', '勘探', '工业', '觉醒', '遗产'];

/** envVector 8 维短标（doc44 位段表语义） */
const ENV_DIMS = ['构造应力', '水文活性', '大气密度', '辐射本底', '热流扰动', '矿物饱和', '生物繁茂度', '工业扰动'];

/** 轨道设施类型中文 */
const FACILITY_ZH = { 0: '空置', 1: '轨道居住站', 2: '黑洞观测站' };

/** 实体 id → 数字后缀（commandSchemas 整数 ID 契约） */
function numIdCv(id) {
  const m = /(\d+)$/.exec(String(id == null ? '' : id));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 太空歌剧行星灵魂面板（doc52 §Task 52.2 逐条契约；colonyDetail.spaceOpera 投影消费）：
 *  1. 行星灵魂头栏：16 原型中英文名 + 五纪元徽章 + 8D envVector 进度条条带 +
 *     工业关注度警示灯（0..6 翠绿稳态；>=7 高危红色警报闪烁）；
 *  2. 16×16 紧凑地表网格热力图（256 Tile 位掩码：地形/动态覆盖层/护盾/道路）；
 *  3. 三层垂直空间操作卡：轨道层 ConstructOrbitalFacility / 城市功能区
 *     ConfigureUrbanZone / 深层地壳 ExcavateSubterraneanLayer；
 *  4. 专项决策按钮：TriggerTerraformingPhase / EnactColonyMartialLaw /
 *     PurgeRadicalCell / LockQuantumPhasePlanet。
 * colonyDetail.spaceOpera 投影为 null（未激活太空歌剧/未触达行星）→ 返回 null（零侵入）。
 *
 * @param {object} view - ColonyView 实例（消费 view.app / view._forceRefresh）
 * @param {object} detail - colonyDetail 只读投影
 * @returns {Element|null} 面板根元素
 */
export function renderSpaceOperaColonyPanel(view, detail) {
  const app = view.app;
  const w = app.world;
  const so = detail && detail.spaceOpera;
  if (!w || !so) return null;
  const planetId = numIdCv(so.planetId || (detail.planet && detail.planet.id));
  const planet = w.entities.planets[detail.planet && detail.planet.id];

  const wrap = el('div', { class: 'vf-col', style: { minWidth: '0', gap: '10px' } });

  /* —— 1. 行星灵魂头栏 —— */
  const pSoul = panel({ title: '行星灵魂 · ' + (so.archetypeNameZh || '未知原型'), open: true, dense: true });
  const attention = so.industrialAttention | 0;
  const alert = attention >= 7;
  pSoul.appendChild(el('div', { class: 'vf-row' }, [
    el('span', { class: 'vf-tag accent', text: '#' + (so.archetypeId | 0) + ' ' + (so.archetypeNameZh || '') }),
    el('span', { class: alert ? 'vf-tag danger vf-flash' : 'vf-tag ok', text: alert
      ? '⚠ 工业关注度 ' + attention + '（激进支部已激活）'
      : '工业关注度 ' + attention + '（0..6 稳态）' }),
    el('span', { class: 'vf-tag', text: '纪元 ' + (so.epochStage | 0) + ' · ' + (EPOCH_ZH[so.epochStage | 0] || '—') }),
  ]));
  pSoul.appendChild(el('div', { class: 'vf-faint vf-small', text: alert
    ? '高危警报：激进潜伏支部处于 ACTIVE —— 建议执行「清剿激进潜伏支部」。'
    : '专属物理法则原型已生效；工业关注度满 7 将触发激进支部激活（红灯闪烁）。' }));
  // 8D envVector 微型进度条条带
  const envRow = el('div', { class: 'vf-row', style: { flexWrap: 'wrap', gap: '4px', marginTop: '4px' } });
  for (let i = 0; i < so.envVector.length; i++) {
    const v = Number(so.envVector[i]) || 0;
    envRow.appendChild(el('div', { class: 'vf-col', style: { flex: '1', minWidth: '64px' } }, [
      progressBarSO(v, 100, v >= 75 ? '#ff5722' : v >= 50 ? '#e8b04f' : '#4fd8e8'),
      el('div', { class: 'vf-faint', style: { fontSize: '9px', textAlign: 'center' }, text: ENV_DIMS[i] + ' ' + v.toFixed(0) }),
    ]));
  }
  pSoul.appendChild(envRow);
  wrap.appendChild(pSoul);

  /* —— 2. 16×16 紧凑地表网格热力图（256 Tile 位掩码） —— */
  const pGrid = panel({ title: '16×16 地表网格热力图（256 Tile 位掩码）', open: true, dense: true });
  pGrid.appendChild(buildHeatmap(so.tiles));
  const legend = el('div', { class: 'vf-row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '4px' } });
  const LEGEND = [
    ['#39c46a', '菌丝覆盖'], ['#ff5722', '熔岩相变'], ['#bfe8ff', '冰盖封冻'],
    ['#a06bff', '晶格侵蚀'], ['#7a5cff', '虫毯'], ['#7fd4ff', '护盾力场'], ['#d9c27a', '交通干线'],
  ];
  for (const [color, label] of LEGEND) {
    legend.appendChild(el('span', { class: 'vf-row', style: { gap: '3px' } }, [
      el('span', { style: { display: 'inline-block', width: '8px', height: '8px', background: color, borderRadius: '2px' } }),
      el('span', { class: 'vf-faint', style: { fontSize: '9px' }, text: label }),
    ]));
  }
  pGrid.appendChild(legend);
  wrap.appendChild(pGrid);

  /* —— 3. 三层垂直空间操作卡 —— */
  const pVert = panel({ title: '三层垂直空间建造（轨道 ⟷ 城市 ⟷ 深层地壳）', open: true, dense: true });
  // Layer 1：轨道层
  const facs = so.orbitalLayer && Array.isArray(so.orbitalLayer.facilities) ? so.orbitalLayer.facilities : [];
  pVert.appendChild(el('div', { class: 'vf-dim vf-small', text: 'Layer 1 · 轨道层（设施 ' + facs.filter((f) => f > 0).length + '/' + facs.length + '）' }));
  const orbitRow = el('div', { class: 'vf-row', style: { flexWrap: 'wrap', gap: '4px' } });
  for (let slot = 0; slot < Math.min(facs.length, 8); slot++) {
    orbitRow.appendChild(el('button', {
      class: 'vf-btn small',
      text: '槽 ' + slot + '：' + (FACILITY_ZH[facs[slot]] || '空置') + (facs[slot] > 0 ? '' : ' → 建居住站'),
      disabled: facs[slot] > 0,
      title: 'ConstructOrbitalFacility：在轨道槽 ' + slot + ' 建造轨道居住站（ORBITAL_HABITAT）',
      on: {
        click: () => {
          app.dispatch('ConstructOrbitalFacility', { planetId, slotIndex: slot, facilityType: 1 });
          view._forceRefresh();
        },
      },
    }));
  }
  pVert.appendChild(orbitRow);
  // Layer 2：城市功能区（2 个下拉选择器）
  const zones = so.urbanZones && Array.isArray(so.urbanZones.zoneSlots) ? so.urbanZones.zoneSlots : [0, 0];
  for (let zi = 0; zi < zones.length; zi++) {
    const sel = el('select', { 'aria-label': '城市功能区槽位 ' + zi, style: { maxWidth: '220px' } });
    for (const zt of [0, 1, 2, 3, 4]) {
      const opt = el('option', { value: String(zt), text: (URBAN_ZONE_TYPES[zt] || '空置') + '（' + zt + '）' });
      sel.appendChild(opt);
    }
    sel.value = String(zones[zi] | 0);
    const row = el('div', { class: 'vf-row', style: { gap: '6px', marginTop: '4px' } }, [
      el('span', { class: 'vf-dim vf-small', text: 'Layer 2 · 功能区槽 ' + zi }),
      sel,
      el('button', {
        class: 'vf-btn small',
        text: '配置',
        title: 'ConfigureUrbanZone：写入功能区并重算岗位容量/舒适度/犯罪率',
        on: {
          click: () => {
            app.dispatch('ConfigureUrbanZone', { planetId, zoneSlot: zi, zoneType: parseInt(sel.value, 10) });
            view._forceRefresh();
          },
        },
      }),
    ]);
    pVert.appendChild(row);
  }
  // Layer 3：深层地壳逐层掘进
  const depth = so.subterraneanLayer ? so.subterraneanLayer.depthTier : 0;
  pVert.appendChild(el('div', { class: 'vf-row', style: { gap: '6px', marginTop: '6px' } }, [
    el('span', { class: 'vf-dim vf-small', text: 'Layer 3 · 深层地壳（当前 Tier ' + depth + '/3 · 采掘应力 ' + (so.subterraneanLayer ? Math.round(so.subterraneanLayer.excavationStress) : 0) + '）' }),
    depth < 3 ? el('button', {
      class: 'vf-btn small',
      text: '掘进 Tier ' + (depth + 1),
      title: 'ExcavateSubterraneanLayer：逐层掘进（envVector[0] +8 / envVector[7] +12 / 应力 +25）',
      on: {
        click: () => {
          app.dispatch('ExcavateSubterraneanLayer', { planetId, depthTier: depth + 1 });
          view._forceRefresh();
        },
      },
    }) : el('span', { class: 'vf-tag ok', text: '已达 Tier 3（先驱者地宫层全解锁）' }),
  ]));
  wrap.appendChild(pVert);

  /* —— 4. 专项决策按钮 —— */
  const pAct = panel({ title: '行星专项决策', open: true, dense: true });
  const actRow1 = el('div', { class: 'vf-row', style: { flexWrap: 'wrap', gap: '4px' } });
  actRow1.appendChild(el('button', {
    class: 'vf-btn small',
    text: '气候重塑阶段跃迁（5000 能量）',
    title: 'TriggerTerraformingPhase：envVector 向原始基线半程推进 + 纪元 +1',
    on: {
      click: () => {
        app.dispatch('TriggerTerraformingPhase', { planetId, targetArchetype: so.archetypeId | 0 });
        view._forceRefresh();
      },
    },
  }));
  actRow1.appendChild(el('button', {
    class: 'vf-btn small',
    text: '戒严镇压（CRACK_DOWN）',
    title: 'EnactColonyMartialLaw：镇压或全面戒严（立即修正稳定度与幸福度）',
    on: {
      click: () => {
        app.dispatch('EnactColonyMartialLaw', { planetId, crackDownLevel: 1 });
        view._forceRefresh();
      },
    },
  }));
  actRow1.appendChild(el('button', {
    class: 'vf-btn small danger',
    text: '清剿激进潜伏支部',
    disabled: !alert,
    title: alert ? 'PurgeRadicalCell（军事路线：体系内舰队总战力 ≥ 50）' : '工业关注度未达 7，无活跃细胞可清剿',
    on: {
      click: () => {
        app.dispatch('PurgeRadicalCell', { planetId, useMilitaryForce: true });
        view._forceRefresh();
      },
    },
  }));
  // 量子相位锁定（仅量子游离天体 #2 可用）
  const isQuantum = (so.archetypeId | 0) === 2;
  actRow1.appendChild(el('button', {
    class: 'vf-btn small',
    text: '量子相位锁定',
    disabled: !isQuantum,
    title: isQuantum ? 'LockQuantumPhasePlanet：派遣科研舰锁定量子相位' : '仅量子游离天体（#2）可用',
    on: {
      click: () => {
        const fleetId = resolveScienceFleetId(w, planet);
        if (fleetId == null) return;
        app.dispatch('LockQuantumPhasePlanet', { planetId, fleetId, engageLock: true });
        view._forceRefresh();
      },
    },
  }));
  pAct.appendChild(actRow1);
  wrap.appendChild(pAct);
  return wrap;
}

/** 16×16 热力图 DOM 网格（unpackTile 位段解码：覆盖层/护盾/道路） */
function buildHeatmap(tiles) {
  const grid = el('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(16, 1fr)',
      gap: '1px',
      maxWidth: '320px',
      border: '1px solid rgba(113,131,154,0.4)',
      borderRadius: '4px',
      overflow: 'hidden',
    },
  });
  for (let i = 0; i < 256; i++) {
    const u = unpackTile((tiles && tiles[i]) >>> 0);
    const ov = OVERLAY_STYLE[u.overlayId] || null;
    const bg = ov ? ov[0] : 'rgba(113,131,154,0.15)';
    const shield = (u.statusFlags & 0x04) !== 0; // STATUS_FLAG.SHIELDED
    const road = (u.statusFlags & 0x08) !== 0; // STATUS_FLAG.ROAD_LINKED
    const cell = el('div', {
      title: 'Tile #' + i + ' · biome ' + u.biomeId + ' · elev ' + u.elevation
        + ' · hazard ' + u.hazardLevel + ' · deposit ' + u.depositCode
        + ' · building ' + u.buildingId + ' · overlay ' + u.overlayId,
      style: {
        aspectRatio: '1 / 1',
        background: bg,
        boxShadow: shield ? 'inset 0 0 0 1.5px #7fd4ff' : (road ? 'inset 0 0 0 1.5px #d9c27a' : 'none'),
      },
    });
    grid.appendChild(cell);
  }
  return grid;
}

/** 轻量进度条（ColonyView 局部 envVector 条带） */
function progressBarSO(value, max, color) {
  const pct = Math.max(0, Math.min(100, (Number(value) || 0) / Math.max(1, Number(max) || 1) * 100));
  const outer = el('div', { style: { height: '5px', background: 'rgba(113,131,154,0.25)', borderRadius: '3px', overflow: 'hidden' } });
  outer.appendChild(el('div', { style: { height: '100%', width: pct + '%', background: color } }));
  return outer;
}

/** 量子相位锁定用科研舰队解析（玩家派系、role science、驻防目标星系优先） */
function resolveScienceFleetId(w, planet) {
  const fleets = (w.entities && w.entities.fleets) || {};
  let fallback = null;
  for (const key of Object.keys(fleets).sort()) {
    const f = fleets[key];
    if (!f || f.factionId !== w.playerFactionId || f.role !== 'science') continue;
    if (planet && f.systemId === planet.systemId) return numIdCv(f.id);
    if (!fallback) fallback = f;
  }
  return fallback ? numIdCv(fallback.id) : null;
}
