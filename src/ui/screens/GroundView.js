/**
 * ui/screens/GroundView.js — 行星行动视图（任务书 5.7 / 6.2）
 *
 * 键鼠控制：WASD/方向键移动、J 轻击、K 重击、L 射击、Shift 格挡、
 * 空格闪避、E 交互、Tab 切换单位。输入作为「输入流」每帧写入
 * mission.input（瞬态控制通道，非世界状态变更，见 ARCHITECTURE.md）。
 */

import { el } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { progressBar } from '../components/progress.js';
import { showModal } from '../components/index.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { GroundRenderer } from '../../render/GroundRenderer.js';
import { MISSION_TEMPLATES, findMissionTemplate } from '../../content/missions.js';
import { L } from '../../core/i18n.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export const GroundView = {
  id: 'ground',
  title: '行星行动',

  mount(ctx) {
    const { root, app, param } = ctx;
    this.app = app;
    this.keys = new Set();
    this._handlers = [];
    root.innerHTML = '';

    const wrap = el('div', { class: 'vf-view' });
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.ground') }));
    this.headRight = el('div', { class: 'vf-row vf-grow' });
    head.appendChild(this.headRight);
    wrap.appendChild(head);
    const body = el('div', { class: 'vf-view-body' });
    wrap.appendChild(body);
    root.appendChild(wrap);
    this.body = body;
    this.param = param;

    this._build(param);
  },

  _build(param) {
    const app = this.app;
    const w = app.world;
    this.body.innerHTML = '';
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;

    // 活动任务查找（param 可为 missionId 或 planetId）
    const missions = Object.values(w.entities.groundMissions).filter((m) => m.state === 'active');
    let mission = null;
    if (param) mission = missions.find((m) => m.id === param || m.planetId === param) || null;
    else mission = missions[0] || null;

    if (!mission) {
      this._buildBriefing();
      return;
    }
    this._buildMission(mission);
  },

  /** 任务简报：行星 + 模板选择 */
  _buildBriefing() {
    const app = this.app;
    const w = app.world;
    const box = el('div', { class: 'pad vf-col' });
    const p1 = panel({ title: '发起地面行动', open: true });
    const planetSel = el('select', { 'aria-label': '目标行星' });
    for (const c of Object.values(w.entities.colonies)) {
      if (c.factionId !== w.playerFactionId) continue;
      const planet = w.entities.planets[c.planetId];
      const opt = el('option', { value: c.planetId, text: planet ? planet.name : c.id });
      planetSel.appendChild(opt);
    }
    p1.appendChild(el('label', { class: 'vf-col' }, [
      el('span', { class: 'vf-dim vf-small', text: '目标行星' }),
      planetSel,
    ]));

    const tplBox = el('div', { class: 'mt-2' });
    for (const tpl of MISSION_TEMPLATES) {
      const row = el('div', { class: 'vf-row', style: { padding: '5px 0', borderBottom: '1px solid var(--line)' } });
      row.appendChild(el('div', { class: 'vf-grow' }, [
        el('div', { text: tpl.nameZh }),
        el('div', { class: 'vf-faint vf-small', text: tpl.descZh }),
        el('div', { class: 'vf-faint vf-small', text: `风险 ${tpl.riskLevel}/5 · 目标 ${tpl.objectives.map((o) => o.type).join('/')} · 奖励 ${tpl.rewards.map((r) => `${r.resId}×${r.amount}`).join(' ')}` }),
      ]));
      row.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: '开始行动',
        on: {
          click: () => {
            const res = app.dispatch('BeginGroundMission', {
              planetId: planetSel.value,
              templateId: tpl.id,
            });
            if (res.ok) this._build();
          },
        },
      }));
      tplBox.appendChild(row);
    }
    p1.appendChild(tplBox);
    box.appendChild(p1);
    // 已结束任务结果列表
    const done = Object.values(this.app.world.entities.groundMissions).filter((m) => m.state !== 'active');
    if (done.length > 0) {
      const p2 = panel({ title: '既往行动记录', open: false });
      for (const m of done.slice(-8)) {
        const tpl = findMissionTemplate(m.templateId);
        p2.appendChild(el('div', { class: 'vf-log-line' }, [
          el('span', { text: `${tpl?.nameZh || m.templateId} — ${({ success: '成功', failed: '失败', aborted: '中止' })[m.state] || m.state}` }),
        ]));
      }
      box.appendChild(p2);
    }
    this.body.appendChild(box);
    this.headRight.innerHTML = '';
  },

  /** 进行中任务：画布 + 控制 + HUD */
  _buildMission(mission) {
    const app = this.app;
    const tpl = findMissionTemplate(mission.templateId);
    this.headRight.innerHTML = '';
    this.headRight.appendChild(el('span', { class: 'vf-accent', text: tpl ? tpl.nameZh : mission.templateId }));
    this.headRight.appendChild(el('button', {
      class: 'vf-btn small danger',
      text: '中止行动',
      on: {
        click: () => app.confirm('中止行动', '确认中止当前地面行动？（无奖励）', () => {
          app.dispatch('AbortGroundMission', { missionId: mission.id });
          this._build();
        }),
      },
    }));

    // 画布区
    const canvasWrap = el('div', { class: 'vf-view-canvas', style: { position: 'absolute', inset: '0 260px 0 0' } });
    this.body.appendChild(canvasWrap);
    this.cm = new CanvasManager().attach(canvasWrap);
    this.renderer = new GroundRenderer();
    this.renderer.init(this.cm);

    // HUD 侧栏
    const hud = el('div', {
      style: {
        position: 'absolute', top: '0', right: '0', bottom: '0', width: '260px',
        background: 'var(--bg2)', borderLeft: '1px solid var(--line)',
        padding: '10px', overflowY: 'auto',
      },
    });
    this.body.appendChild(hud);
    this.hud = hud;

    // 目标说明
    hud.appendChild(panel({ title: '任务目标', content: el('div', { class: 'vf-small vf-dim', text: tpl ? tpl.descZh : '' }) }));
    this.objectivesBox = el('div');
    hud.appendChild(this.objectivesBox);
    this.logBox = el('div', { class: 'mt-2' });
    hud.appendChild(panel({ title: '行动日志', content: this.logBox }));
    hud.appendChild(el('div', { class: 'vf-faint vf-small mt-2', text: 'WASD 移动 · J 轻击 K 重击 L 射击 · 空格闪避 · Shift 格挡 · E 交互 · Tab 切换单位' }));

    // 键盘
    const onKey = (e, down) => {
      if (KEYMAP[e.code]) {
        this.keys[KEYMAP[e.code]] = down;
        e.preventDefault();
      } else if (down) {
        if (e.code === 'Space') this._oneShot.dodge = true;
        else if (e.code === 'KeyJ') this._oneShot.attack = 'light';
        else if (e.code === 'KeyK') this._oneShot.attack = 'heavy';
        else if (e.code === 'KeyL') this._oneShot.attack = 'ranged';
        else if (e.code === 'KeyE') this._oneShot.interact = true;
        else if (e.code === 'Tab') this._oneShot.switchUnit = true;
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.block = true;
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.keys.block = false;
      }
    };
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this._handlers.push(['keydown', kd], ['keyup', ku]);
    this._oneShot = {};

    // 帧循环：读 mission → 渲染 + 写输入流（瞬态控制通道）
    this.missionId = mission.id;
    const loop = () => {
      if (!this._raf) return;
      const w2 = this.app.world;
      const m = w2.entities.groundMissions[this.missionId];
      if (!m || m.state !== 'active') {
        this._raf = null;
        // 任务结束：显示结算并返回简报
        this._showResult(m);
        return;
      }
      // 写输入流（不经过命令总线的瞬态控制数据）
      const dx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      const dy = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      const input = m.input = m.input || {};
      input.moveDir = { x: dx / len, y: dy / len };
      input.sprint = !!this.keys.sprint;
      input.block = !!this.keys.block;
      if (this._oneShot.dodge) { input.dodgeDir = { x: dx / len, y: dy / len }; this._oneShot.dodge = false; }
      if (this._oneShot.attack) { input.attack = this._oneShot.attack; this._oneShot.attack = null; }
      if (this._oneShot.interact) { input.interactTarget = 'nearest'; this._oneShot.interact = false; }
      if (this._oneShot.switchUnit) { input.switchUnit = 'next'; this._oneShot.switchUnit = false; }

      // 渲染
      const { getMissionView } = groundViewApi();
      const view = getMissionView(m);
      this.cm.beginFrame();
      this.renderer.render(this.cm.ctx, this.cm.width, this.cm.height, view, {});
      this._renderHud(view);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  },

  _renderHud(view) {
    if (!this.objectivesBox) return;
    this.objectivesBox.innerHTML = '';
    for (const o of view.objectives || []) {
      const row = el('div', { class: 'vf-row', style: { padding: '2px 0' } });
      row.appendChild(el('span', { class: o.done ? 'vf-ok' : 'vf-dim', text: o.done ? '✓' : '○' }));
      row.appendChild(el('span', { class: 'vf-small vf-grow', text: o.text || o.type }));
      this.objectivesBox.appendChild(row);
    }
    this.logBox.innerHTML = '';
    for (const line of (view.log || []).slice(-6)) {
      this.logBox.appendChild(el('div', { class: 'vf-log-line', text: line }));
    }
  },

  _showResult(m) {
    const results = (m && m.results) || { outcome: 'failed' };
    showModal({
      title: '行动结束',
      body: el('div', { class: 'vf-col' }, [
        el('div', { class: 'vf-accent', text: ({ success: '任务完成', failed: '任务失败', aborted: '行动中止' })[results.outcome] || results.outcome }),
        el('div', { class: 'vf-small vf-dim mt-1', text: results.rewardsPaid ? `奖励已入账：${JSON.stringify(results.rewardsPaid)}` : '无奖励结算' }),
      ]),
      actions: [{ label: L('ui.confirm'), kind: 'primary', onClick: (close) => { close(); this._build(); } }],
    });
  },

  onSnapshot() {},

  unmount() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    for (const [name, fn] of this._handlers) window.removeEventListener(name, fn);
    this._handlers = [];
    if (this.cm) this.cm.dispose();
    this.cm = null;
    this.app = null;
  },
};

import { getMissionView } from '../../domain/ground/GroundMission.js';
function groundViewApi() {
  return { getMissionView };
}
