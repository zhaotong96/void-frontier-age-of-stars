/**
 * ui/screens/SettingsView.js — 设置：语言、音量、动效、自动保存间隔
 * 设置保存在 localStorage（轻量项），不写世界状态（任务书 8.1）。
 */

import { el } from '../components/dom.js';
import { panel, kvList } from '../components/panels.js';
import { L, setLanguage, getLanguage } from '../../core/i18n.js';

const LS_KEY = 'vf-settings-v1';

export function loadLocalSettings() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveLocalSettings(patch) {
  try {
    const cur = loadLocalSettings();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* 隐私模式等场景下忽略 */ }
}

export const SettingsView = {
  id: 'settings',
  title: '设置',

  mount(ctx) {
    const { root, app } = ctx;
    root.innerHTML = '';
    const wrap = el('div', { class: 'vf-view' });
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.settings') }));
    wrap.appendChild(head);
    const body = el('div', { class: 'vf-view-body pad' });

    const p1 = panel({ title: '语言 / Language', open: true });
    const langSel = el('select');
    for (const lang of ['zh-CN', 'en-US']) {
      const opt = el('option', { value: lang, text: lang === 'zh-CN' ? '简体中文' : 'English' });
      if (getLanguage() === lang) opt.selected = true;
      langSel.appendChild(opt);
    }
    langSel.addEventListener('change', () => {
      setLanguage(langSel.value);
      saveLocalSettings({ language: langSel.value });
      // 重建 shell 文本
      app.buildShell();
      app.sideNav.refresh();
    });
    p1.appendChild(langWrap(langSel));
    body.appendChild(p1);

    const p2 = panel({ title: '音频', open: true });
    const settings = loadLocalSettings();
    const master = rangeRow('主音量', settings.masterVolume ?? 0.7, (v) => {
      saveLocalSettings({ masterVolume: v });
      app.audio.setVolume('master', v);
    });
    const sfx = rangeRow('音效', settings.sfxVolume ?? 0.8, (v) => {
      saveLocalSettings({ sfxVolume: v });
      app.audio.setVolume('sfx', v);
    });
    p2.appendChild(master);
    p2.appendChild(sfx);
    body.appendChild(p2);

    const p3 = panel({ title: '体验', open: true });
    const reduced = el('input', { type: 'checkbox' });
    reduced.checked = !!settings.reducedEffects;
    reduced.addEventListener('change', () => {
      saveLocalSettings({ reducedEffects: reduced.checked });
      if (app.world) app.world.settings.reducedEffects = reduced.checked;
    });
    const autoRow = el('div', { class: 'vf-row' });
    const autoDays = el('input', { type: 'number', min: '1', max: '10', value: String(settings.autosaveDays ?? 2) });
    autoDays.addEventListener('change', () => {
      const days = Math.max(1, Math.min(10, parseInt(autoDays.value, 10) || 2));
      saveLocalSettings({ autosaveDays: days });
      if (app.world) app.world.settings.autosaveIntervalDays = days;
    });
    autoRow.appendChild(el('span', { class: 'vf-dim', text: '自动存档间隔（游戏日）' }));
    autoRow.appendChild(autoDays);
    p3.appendChild(checkboxWrap('减少动效', reduced));
    p3.appendChild(autoRow);
    body.appendChild(p3);

    const p4 = panel({ title: '快捷键', open: true });
    p4.appendChild(kvList([
      ['空格', '暂停 / 继续'],
      ['1 / 2 / 3 / 4', '时间倍率 1× / 2× / 4× / 8×'],
      ['G', '回到银河地图'],
      ['N', '跳到下一个事件'],
      ['Esc', '关闭弹窗'],
    ]));
    body.appendChild(p4);

    wrap.appendChild(body);
    root.appendChild(wrap);

    // 全局键盘快捷键（App 级，一次绑定）
    if (!app._keysBound) {
      app._keysBound = true;
      window.addEventListener('keydown', (e) => {
        if (!app.inGame) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.code === 'Space') {
          e.preventDefault();
          app.togglePause();
        } else if (e.key >= '1' && e.key <= '4') {
          app.setSpeed(parseInt(e.key, 10));
        } else if (e.key === 'g' || e.key === 'G') {
          app.goto('galaxy');
        }
      });
    }
  },

  unmount() {},
  onSnapshot() {},
};

function labelWrap(label, control) {
  const wrap = el('label', { class: 'vf-col' });
  wrap.appendChild(el('span', { class: 'vf-dim vf-small', text: label }));
  wrap.appendChild(control);
  return wrap;
}
const langWrap = labelWrap;

function rangeRow(label, value, onChange) {
  const row = el('div', { class: 'vf-row' });
  const r = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(value) });
  r.addEventListener('input', () => onChange(parseFloat(r.value)));
  row.appendChild(el('span', { class: 'vf-dim', text: label, style: { width: '70px' } }));
  row.appendChild(r);
  return row;
}

function checkboxWrap(label, control) {
  const row = el('label', { class: 'vf-row' });
  row.appendChild(control);
  row.appendChild(el('span', { text: label }));
  return row;
}
