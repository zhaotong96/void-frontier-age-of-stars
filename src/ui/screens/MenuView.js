/**
 * ui/screens/MenuView.js — 主菜单（R7 全屏沉浸式重构）
 *
 * 结构：.boot-screen（全屏 3D 背景叠加层，见 styles.css）
 *   ├─ CanvasManager 三层画布（glCanvas + hud2D）→ GalaxyRenderer 绘制银河
 *   ├─ .vf-menu-titleblock 标题块
 *   ├─ .vf-menu-panel 毛玻璃菜单舱（新战役表单 / 继续战役 / 设置入口）
 *   └─ .vf-menu-foot 版本脚注
 *
 * 银河背景：复用 GalaxyRenderer + CanvasManager（与银河地图同源渲染管线），
 * 传入合成空快照 {systems:[],factions:[]} —— 仅程序化星盘粒子 + 体积星云 +
 * 超新星球壳，不依赖任何战役数据；rAF 循环内缓慢递增相机 yaw 实现自动环绕运镜
 * （约 100 秒/圈，pitch 固定微俯），reducedEffects 时停用旋转与动画。
 *
 * 菜单面板为毛玻璃叠加层，无 ERP 式包围框架；交互仍走 app.startNewGame /
 * app.loadGame / app.goto 既有通道。
 */

import { el } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { L } from '../../core/i18n.js';
import { seedFromString } from '../../core/rng.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { GalaxyRenderer } from '../../render/GalaxyRenderer.js';
import { loadLocalSettings } from './SettingsView.js';

/** 合成空银河快照：GL 路径只要求 systems 为数组（程序化星盘/星云与快照无关） */
const EMPTY_GALAXY = { systems: [], factions: [] };

/** 自动环绕运镜角速度（弧度/秒）——缓慢巡游，约 100 秒一整圈 */
const ORBIT_SPEED = 0.062;
/** 菜单相机俯仰角（弧度，约 52°，微俯银河盘面） */
const MENU_PITCH = 0.92;

export const MenuView = {
  id: 'menu',
  title: '主菜单',

  mount(ctx) {
    const { root, app } = ctx;
    this.app = app;
    this._mounted = true;
    this._raf = 0;
    this._lastT = 0;
    this._yaw = 0;
    this._reduced = !!loadLocalSettings().reducedEffects;

    root.innerHTML = '';

    // —— 全屏叠加层容器（.boot-screen：3D 背景之上的暗角渐变，pointer-events:none）——
    const wrap = el('div', { class: 'boot-screen' });
    root.appendChild(wrap);
    this._wrap = wrap;

    // —— 底层：3D 银河画布（复用银河地图渲染管线）——
    this._cm = new CanvasManager().attach(wrap);
    this._renderer = new GalaxyRenderer();
    this._renderer.init(this._cm);
    this._renderer.setSnapshot(EMPTY_GALAXY);
    this._renderer.view.zoom = 0.9; // 略拉远：整盘入画，边缘留出深空

    // —— 上层：标题块 ——
    const titleblock = el('div', { class: 'vf-menu-titleblock' }, [
      el('div', { class: 'boot-title', text: 'VOID FRONTIER' }),
      el('div', { class: 'boot-sub', text: '无垠边疆 · 星海纪元' }),
    ]);
    wrap.appendChild(titleblock);

    // —— 上层：毛玻璃菜单舱 ——
    const panelBox = el('div', { class: 'vf-menu-panel' });

    // 新战役
    const p1 = panel({ title: L('ui.newGameTitle'), open: true });
    const form = el('div', { class: 'vf-col' });
    const nameInput = el('input', { type: 'text', value: '边疆回声', 'aria-label': L('ui.campaignName') });
    const seedInput = el('input', { type: 'text', value: '24601', 'aria-label': L('ui.seed') });
    const diffSelect = el('select', { 'aria-label': L('ui.difficulty') });
    for (const [v, k] of [['story', 'ui.difficulty.story'], ['standard', 'ui.difficulty.standard'], ['hard', 'ui.difficulty.hard'], ['sandbox', 'ui.difficulty.sandbox']]) {
      const opt = el('option', { value: v, text: L(k) });
      if (v === 'standard') opt.selected = true;
      diffSelect.appendChild(opt);
    }
    const sizeSelect = el('select', { 'aria-label': '星系规模' });
    for (const [v, label] of [['story', '紧凑（64 星系）'], ['standard', '标准（96 星系）'], ['large', '大型（160 星系）']]) {
      const opt = el('option', { value: v, text: label });
      if (v === 'standard') opt.selected = true;
      sizeSelect.appendChild(opt);
    }
    form.appendChild(labelWrap(L('ui.campaignName'), nameInput));
    form.appendChild(labelWrap(L('ui.seed'), seedInput));
    form.appendChild(labelWrap(L('ui.difficulty'), diffSelect));
    form.appendChild(labelWrap('星系规模', sizeSelect));
    const startBtn = el('button', {
      class: 'vf-btn primary mt-2',
      text: `${L('ui.start')} ▸`,
      on: {
        click: async () => {
          startBtn.disabled = true;
          try {
            const seedText = seedInput.value.trim() || '24601';
            const seed = /^\d+$/.test(seedText) ? parseInt(seedText, 10) : seedFromString(seedText);
            await app.startNewGame({
              seed,
              difficulty: diffSelect.value,
              galaxySize: sizeSelect.value,
              campaignName: nameInput.value.trim() || '边疆回声',
            });
          } finally {
            startBtn.disabled = false;
          }
        },
      },
    });
    form.appendChild(startBtn);
    p1.appendChild(form);
    panelBox.appendChild(p1);

    // 继续战役（存在存档时）
    const p2 = panel({ title: L('ui.load'), open: true });
    const contBox = el('div', { class: 'vf-col' });
    p2.appendChild(contBox);
    panelBox.appendChild(p2);
    this._refreshSaves(contBox, app);

    // 设置 / 诊断入口（战役外白名单路由）
    const actions = el('div', { class: 'vf-menu-actions' });
    actions.appendChild(el('button', {
      class: 'vf-btn small',
      text: `${L('ui.settings')} ⚒`,
      title: '语言 / 音频 / 体验设置',
      on: { click: () => app.goto('settings') },
    }));
    actions.appendChild(el('button', {
      class: 'vf-btn small',
      text: `${L('ui.diagnostics')} ✓`,
      title: '运行诊断与性能面板',
      on: { click: () => app.goto('diagnostics') },
    }));
    panelBox.appendChild(actions);

    wrap.appendChild(panelBox);
    wrap.appendChild(el('div', { class: 'vf-menu-foot', text: 'AGE OF STARS · 纯本地单机 · 无远程依赖' }));

    // —— 渲染循环：自动缓慢环绕运镜（仅 mounted 期间运行）——
    const loop = (now) => {
      if (!this._mounted) return;
      this._raf = requestAnimationFrame(loop);
      const dt = this._lastT ? Math.min(0.1, (now - this._lastT) / 1000) : 0.016;
      this._lastT = now;
      if (!this._reduced) {
        this._yaw += dt * ORBIT_SPEED; // 缓慢环绕：仅表现动画，不进模拟
        const r = this._renderer;
        if (r) {
          r._cam.yaw = this._yaw;
          r._cam.pitch = MENU_PITCH;
        }
      }
      this._drawFrame();
    };
    this._raf = requestAnimationFrame(loop);
  },

  /** 快照推送：主菜单无战役数据，无需刷新 */
  onSnapshot() {},

  /** 卸载：停循环、释放画布与引用（语言切换重挂前也会先走这里） */
  unmount() {
    this._mounted = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (this._cm) {
      this._cm.dispose();
      this._cm = null;
    }
    this._renderer = null;
    this._wrap = null;
    this._lastT = 0;
    this.app = null;
  },

  // —— 内部实现 ——————————————————————————————————

  /** 渲染一帧银河背景（合成空快照：星盘粒子 / 星云 / 球壳，无节点航路） */
  _drawFrame() {
    const cm = this._cm;
    const r = this._renderer;
    if (!cm || !r || cm.width < 2 || cm.height < 2) return;
    cm.beginFrame();
    r.render(cm.ctx, cm.width, cm.height, EMPTY_GALAXY, {}, {
      time: performance.now() / 1000, // 仅表现动画，不进模拟
      reducedEffects: this._reduced,
    });
  },

  /** 存档列表（与旧版一致：读取 / 删除，均走 app 既有通道） */
  async _refreshSaves(box, app) {
    box.innerHTML = '';
    let list = [];
    try {
      list = await app.saveManager.list();
    } catch (e) {
      console.warn('[MenuView] 存档列表读取失败:', e);
    }
    if (!box) return;
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无存档' }));
      return;
    }
    for (const rec of list) {
      const row = el('div', { class: 'vf-row' });
      row.appendChild(el('span', { class: 'vf-grow vf-small', text: `${rec.slotId} · ${rec.summary?.name || ''} · T${rec.worldTick}` }));
      row.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: L('ui.load'),
        on: { click: () => app.loadGame(rec.slotId) },
      }));
      row.appendChild(el('button', {
        class: 'vf-btn small danger',
        text: L('ui.delete'),
        on: { click: () => app.confirm('删除存档', `确认删除槽位 ${rec.slotId}？`, async () => { await app.saveManager.remove(rec.slotId); this._refreshSaves(box, app); }) },
      }));
      box.appendChild(row);
    }
  },
};

function labelWrap(label, control) {
  const wrap = el('label', { class: 'vf-col' });
  wrap.appendChild(el('span', { class: 'vf-dim vf-small', text: label }));
  wrap.appendChild(control);
  return wrap;
}
