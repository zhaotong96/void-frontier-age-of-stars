/**
 * render/AudioManager.js — Web Audio 合成音效管理器（任务书 6.8 / 1.3）
 *
 * 全部程序化合成（无音频文件）；首次用户交互后 resume；
 * 音量总线：master → { sfx }；静音不影响任何游戏规则。
 */

const LS_KEY = 'vf-audio-v1';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volumes = { master: 0.7, sfx: 0.8 };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved && typeof saved.master === 'number') this.volumes = saved;
    } catch { /* ignore */ }
    // 首次交互解锁
    const unlock = () => {
      this._ensureCtx();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _ensureCtx() {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.enabled = false;
    }
  }

  setVolume(bus, v) {
    this.volumes[bus] = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.volumes));
    } catch { /* ignore */ }
  }

  /** UI 提示音（确定性合成） */
  blip(kind = 'ok') {
    if (!this.enabled) return;
    this._ensureCtx();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const freqs = { ok: 660, deny: 220, pause: 330 };
    const f = freqs[kind] || 440;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = kind === 'deny' ? 'square' : 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12 * this.volumes.master * this.volumes.sfx, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /** 战斗事件音（更重的合成音） */
  boom(intensity = 1) {
    if (!this.enabled) return;
    this._ensureCtx();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(90 + intensity * 30, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.25 * this.volumes.master * this.volumes.sfx * intensity, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  }
}
