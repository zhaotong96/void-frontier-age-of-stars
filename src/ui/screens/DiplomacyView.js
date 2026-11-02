/**
 * ui/screens/DiplomacyView.js — 外交视图（路由 #/diplomacy）
 *
 * 布局：.vf-view > .vf-view-head（标题）+ .vf-view-body（可滚动）：
 *   1) 战争面板（diplomacyView.wars：双方/状态/战争目标/疲劳/已占领数/战斗数）；
 *   2) 文明卡列表（diplomacyView.factions）：色点 + 名称 + 人格 + 接触状态 tag；
 *      未接触（known=false）→「未知信号」灰卡并禁用全部操作；
 *      展开卡（点击切换）：关系五维 gauge 组（好感/信任/威胁/边境紧张/贸易依赖）
 *      + 条约列表（类型中文映射 + 状态 + 到期日）+ 情报摘要（intelView 置信度与
 *      估计区间）+ 操作按钮（赠送信用点 / 五类条约 / 宣战需 confirm）。
 *
 * 数据来源纪律：只读消费 diplomacyView / intelView + world 只读补齐条约 kind
 * （diplomacyView.treaties[].type 恒为实体类别 'treaty'，真实类型在实体 kind 字段）；
 * 写操作一律经 app.dispatch（ImproveRelations / OfferTreaty / DeclareWar）。
 * onSnapshot 250ms 节流重建（卡片内无原生输入件，可安全整体重建）；
 * unmount 清理引用（无监听 / 无 rAF）。
 */

import { el, clearEl } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { gauge } from '../charts/index.js';
import { L } from '../../core/i18n.js';
import { dateStr } from '../../core/clock.js';
import { diplomacyView, intelView } from '../../simulation/ViewModels.js';

/** 人格中文映射（未知回退原文） */
const PERSONALITY_ZH = {
  trader: '商业至上', expansionist: '扩张主义', defensive: '防御型',
  scientist: '科研狂热', opportunist: '机会主义', militarist: '军国主义',
  isolationist: '孤立主义', diplomat: '外交型', aggressor: '侵略型',
};

/** 接触状态中文映射 */
const CONTACT_ZH = {
  none: '无接触', signal: '未知信号', analyzing: '分析中', contacted: '已接触',
};

/** 条约类型中文映射（OfferTreaty 的 type 取值） */
const TREATY_ZH = {
  nonaggression: '互不侵犯', trade: '贸易协定', research: '科研交流',
  openBorders: '开放边境', mutualDefense: '共同防御',
};

/** 条约状态中文映射 */
const TREATY_STATUS_ZH = {
  active: '生效中', expired: '已到期', breached: '已违约',
};

/** 战争状态中文映射 */
const WAR_STATUS_ZH = {
  active: '进行中', ended: '已结束', peace: '和平',
};

/** 战争目标中文映射（与 DeclareWar 命令的合法取值一致） */
const WARGOAL_ZH = {
  borderSystems: '边境星系', haltExpansion: '遏制扩张', reparations: '战争赔偿',
  liberate: '解放', protectAlly: '保护盟友',
};

/** 条约提案按钮定义：type → 按钮文案 */
const TREATY_OFFERS = [
  { type: 'nonaggression', label: '互不侵犯' },
  { type: 'trade', label: '贸易协定' },
  { type: 'research', label: '科研交流' },
  { type: 'openBorders', label: '开放边境' },
  { type: 'mutualDefense', label: '共同防御' },
];

/** faction id → 名称（只读） */
function factionName(world, fid) {
  const f = world && world.entities.factions[fid];
  return (f && f.name) || fid || '未知';
}

export const DiplomacyView = {
  id: 'diplomacy',
  title: '外交',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._lastRefresh = 0;
    this._expanded = new Set(); // 展开中的文明 factionId 集合

    root.innerHTML = '';
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.diplomacy') }));
    head.appendChild(el('span', { class: 'vf-grow' }));
    head.appendChild(el('span', { class: 'vf-dim vf-small', text: '点击文明卡展开关系与外交行动' }));

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
    // 已不存在的战争/文明引用在重建时自然消失；展开集合保持
    this._rebuild();
  },

  /** 卸载：清引用（本视图无监听 / 无 rAF / 无画布） */
  unmount() {
    this._mounted = false;
    this.app = null;
    this._body = null;
    this._expanded = new Set();
  },

  // —— 内部实现 ——————————————————————————————————

  /** diplomacyView 只读数据包 */
  _diplo() {
    const w = this.app.world;
    return diplomacyView(w, w.playerFactionId);
  },

  /** 整体重建：战争面板 → 文明卡列表 */
  _rebuild() {
    const body = this._body;
    if (!body) return;
    clearEl(body);
    const d = this._diplo();

    body.appendChild(this._warPanel(d.wars || []));

    const cards = panel({ title: `文明（${d.factions.length}）`, open: true });
    if (!d.factions.length) {
      cards.appendChild(el('div', { class: 'vf-faint vf-small', text: '星域中没有其他文明。' }));
    }
    for (const f of d.factions) {
      cards.appendChild(this._factionCard(f));
    }
    body.appendChild(cards);
  },

  // —— 战争面板 ——————————————————————————————————

  _warPanel(wars) {
    const w = this.app.world;
    const p = panel({ title: `战争（${wars.length}）`, open: wars.length > 0 });
    if (!wars.length) {
      p.appendChild(el('div', { class: 'vf-faint vf-small', text: '当前没有进行中的战争。' }));
      return p;
    }
    for (const war of wars) {
      const atk = war.attackers.map((fid) => factionName(w, fid)).join('、');
      const def = war.defenders.map((fid) => factionName(w, fid)).join('、');
      const goals = (war.wargoals || []).map((g) => WARGOAL_ZH[g] || g).join('、') || '—';
      // 疲劳：按参战方列出（exhaustion 为 factionId → 0..100）
      const fatigue = Object.keys(war.exhaustion || {}).sort()
        .map((fid) => `${factionName(w, fid)} ${Math.round(war.exhaustion[fid])}`)
        .join(' / ') || '—';
      p.appendChild(el('div', { class: 'vf-col', style: { borderBottom: '1px solid rgba(29,42,58,0.5)', padding: '4px 0' } }, [
        el('div', { class: 'vf-row' }, [
          el('span', { class: 'vf-mono', text: `${atk} ⚔ ${def}` }),
          el('span', { class: war.status === 'active' ? 'vf-tag danger' : 'vf-tag', text: WAR_STATUS_ZH[war.status] || war.status || '未知' }),
        ]),
        kvList([
          ['战争目标', goals],
          ['开战', dateStr(war.startTick)],
          ['战争疲劳', fatigue],
          ['已占领星系', String((war.occupiedSystems || []).length)],
          ['战斗次数', String(war.battles || 0)],
        ]),
      ]));
    }
    return p;
  },

  // —— 文明卡 ——————————————————————————————————

  _factionCard(f) {
    const w = this.app.world;
    const expanded = this._expanded.has(f.factionId);
    const atWar = !!f.atWar;

    const card = panel({
      title: el('span', { class: 'vf-row' }, [
        el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '5px', background: f.color || '#71839a' }, 'aria-hidden': 'true' }),
        el('span', { text: f.name }),
        el('span', { class: 'vf-faint vf-small', text: PERSONALITY_ZH[f.personality] || f.personality || '' }),
      ]),
      open: expanded,
      dense: true,
      tools: [{
        label: expanded ? '收起' : '展开',
        title: expanded ? '收起该文明的关系详情' : '展开该文明的关系详情与外交行动',
        onClick: () => {
          if (expanded) this._expanded.delete(f.factionId);
          else this._expanded.add(f.factionId);
          this._rebuild();
        },
      }],
    });

    // 头部状态行（面板体内常驻）
    const tagCls = atWar ? 'vf-tag danger' : f.known ? 'vf-tag accent' : 'vf-tag';
    card.appendChild(el('div', { class: 'vf-row' }, [
      el('span', { class: tagCls, text: CONTACT_ZH[f.contactState] || f.contactState || '未知' }),
      atWar ? el('span', { class: 'vf-tag danger', text: '交战中' }) : null,
    ]));

    // 未接触：未知信号灰卡 + 全部操作禁用说明
    if (!f.known) {
      const gray = el('div', {
        class: 'vf-faint vf-small',
        style: { border: '1px dashed rgba(113,131,154,0.4)', borderRadius: '4px', padding: '8px', color: 'var(--ink-faint)' },
        text: '未知信号：仅侦测到该文明的痕迹，尚未完成首次接触。完成接触前所有外交操作不可用。',
      });
      card.appendChild(gray);
      return card;
    }

    // —— 关系五维 gauge 组 ——
    const gauges = el('div', { class: 'vf-row', style: { justifyContent: 'space-around', flexWrap: 'wrap' } });
    // 方向语义：好感/信任/贸易依赖越高越好 → 不启用红档（阈值取到不可达）；
    // 威胁/边境紧张越高越危险 → 默认分档（≥0.6 琥珀、≥0.8 红）
    const gaugesDef = [
      { label: '好感', value: f.opinion, warn: 1.2, danger: 1.5 },
      { label: '信任', value: f.trust, warn: 1.2, danger: 1.5 },
      { label: '威胁', value: f.threat, warn: 0.6, danger: 0.8 },
      { label: '边境紧张', value: f.borderTension, warn: 0.6, danger: 0.8 },
      { label: '贸易依赖', value: f.tradeInterdependence, warn: 1.2, danger: 1.5 },
    ];
    for (const g of gaugesDef) {
      gauges.appendChild(gauge({ value: g.value ?? 0, max: 100, label: g.label, warn: g.warn, danger: g.danger, width: 116, height: 76 }));
    }
    card.appendChild(gauges);
    if (f.grievances) {
      card.appendChild(el('div', { class: 'vf-warn vf-small', text: `积怨记录：${f.grievances} 项` }));
    }

    // —— 条约列表（真实类型从条约实体 kind 只读补齐） ——
    const tp = panel({ title: `条约（${(f.treaties || []).length}）`, open: true, dense: true });
    if (!(f.treaties || []).length) {
      tp.appendChild(el('div', { class: 'vf-faint vf-small', text: '无有效条约。' }));
    }
    for (const t of f.treaties || []) {
      const entity = w.entities.treaties[t.id];
      const kind = (entity && entity.kind) || t.type; // 实体 kind 才是真实类型
      const status = TREATY_STATUS_ZH[t.status] || t.status || '未知';
      tp.appendChild(el('div', { class: 'vf-row', style: { borderBottom: '1px solid rgba(29,42,58,0.4)', padding: '2px 0' } }, [
        el('span', { text: TREATY_ZH[kind] || kind }),
        el('span', { class: t.status === 'active' ? 'vf-tag ok' : 'vf-tag', text: status }),
        el('span', { class: 'vf-faint vf-small vf-grow', style: { textAlign: 'right' }, text: t.expiryTick ? `到期 ${dateStr(t.expiryTick)}` : '永久' }),
      ]));
    }
    card.appendChild(tp);

    // —— 情报摘要（intelView：置信度与估计区间，非精确值） ——
    card.appendChild(this._intelBlock(f.factionId));

    // —— 操作按钮 ——
    card.appendChild(this._actionRow(f));
    return card;
  },

  /** 情报摘要块：intelView 的置信度与估计区间 */
  _intelBlock(targetFactionId) {
    const w = this.app.world;
    const intel = intelView(w, w.playerFactionId, targetFactionId);
    const p = panel({ title: '情报摘要', open: true, dense: true });
    const range = (r) => (r ? `${r.min} ~ ${r.max}` : '情报不足');
    p.appendChild(kvList([
      ['情报置信度', `${intel.confidence}%`],
      ['估计星系数', range(intel.estimatedSystems)],
      ['估计舰队数', range(intel.estimatedFleets)],
    ]));
    p.appendChild(el('div', { class: 'vf-faint vf-small', text: '估计值随置信度收敛；提升接触与侦察可改善情报质量。' }));
    return p;
  },

  /** 外交行动按钮行（未接触/战争状态的禁用原因在 title 说明） */
  _actionRow(f) {
    const app = this.app;
    const row = el('div', { class: 'vf-col mt-1' });
    const atWar = !!f.atWar;
    const contacted = f.contactState === 'contacted';

    // 赠送信用点 250
    row.appendChild(el('button', {
      class: 'vf-btn small primary',
      type: 'button',
      text: '赠送信用点 250',
      disabled: !contacted,
      title: !contacted
        ? '尚未完成首次接触，不能送礼'
        : '赠送 250 信用点改善关系（ImproveRelations）',
      on: { click: () => app.dispatch('ImproveRelations', { targetFactionId: f.factionId }) },
    }));

    // 五类条约提案
    const treatyRow = el('div', { class: 'vf-row' });
    for (const offer of TREATY_OFFERS) {
      treatyRow.appendChild(el('button', {
        class: 'vf-btn small',
        type: 'button',
        text: offer.label,
        disabled: !contacted || atWar,
        title: !contacted
          ? '尚未完成首次接触，不能缔约'
          : atWar
            ? '战争状态不能缔约（先停战）'
            : `提出「${offer.label}」条约（接受概率由关系与人格效用决定）`,
        on: { click: () => app.dispatch('OfferTreaty', { targetFactionId: f.factionId, type: offer.type }) },
      }));
    }
    row.appendChild(treatyRow);

    // 宣战（confirm 后执行）
    row.appendChild(el('button', {
      class: 'vf-btn small danger',
      type: 'button',
      text: '宣战',
      disabled: !contacted || atWar,
      title: !contacted
        ? '尚未完成首次接触，无法宣战'
        : atWar
          ? '已处于战争状态'
          : '确认后正式宣战（战争目标：边境星系）',
      on: {
        click: () => {
          app.confirm(
            '确认宣战？',
            `向 ${f.name} 正式宣战（战争目标：边境星系）。这将终止双方全部条约并恶化关系。`,
            () => app.dispatch('DeclareWar', { targetFactionId: f.factionId, wargoal: 'borderSystems' }),
          );
        },
      },
    }));
    return row;
  },
};
