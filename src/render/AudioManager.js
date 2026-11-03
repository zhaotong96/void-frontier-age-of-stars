/**
 * render/AudioManager.js — Web Audio 合成音效管理器（任务书 6.8 / 1.3；R9 环境音扩展）
 *
 * 全部程序化合成（无音频文件）；首次用户交互后 resume；
 * 音量总线：master → { sfx（短音直连总输出）, music（环境音总线） }；静音不影响任何游戏规则。
 *
 * R9 多场景程序化环境音层（startAmbient / stopAmbient / setScene / setMusicVolume）：
 *  - 每个场景一条持续合成音底：振荡器 + 滤波器 + LFO + 噪声源，全部 Web Audio 实时合成；
 *  - 场景层经独立 GainNode（交叉淡化包络）接入 musicVolume 音乐总线再出总输出；
 *  - 场景切换 / 停止均为 1.5s 线性交叉淡化；
 *  - ground 场景的偶发鸟鸣/机械短音由确定性整数哈希触发（绝不使用 Math.random）；
 *  - 本模块顶层不触碰 document/window：AudioContext 与定时器均延迟到方法调用中创建。
 */

const LS_KEY = 'vf-audio-v1';

/** 场景交叉淡化时长（秒） */
const AMBIENT_XFADE_SEC = 1.5;

/** 各场景环境音层的目标电平（交叉淡化终点；经 musicVolume 总线二次缩放） */
const SCENE_LEVEL = {
  deepSpace: 0.55,
  starCorona: 0.32,
  planet: 0.45,
  combat: 0.3,
  ground: 0.5,
  menu: 0.5,
};

/** 确定性整数哈希 → [0,1)（ground 偶发事件触发源；绝不使用 Math.random） */
function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h / 4294967296;
}

/** 确定性 xorshift32 伪随机流（噪声缓冲填充；种子固定 → 波形可复现） */
function xorshift32(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 软削波失真曲线（combat 场景 WaveShaper；确定性生成） */
function distortionCurve(k = 24) {
  const n = 256;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

/**
 * 场景环境音配方（全部 Web Audio 实时合成，无采样文件；全程确定性，无 Math.random）。
 * kit: { stops: 需 stop 的源[], timers: 需 clearInterval 的定时器[], noise: 共享噪声缓冲 }
 */
const AMBIENT_BUILDERS = {
  /** deepSpace：低频正弦 55Hz + 慢速 LFO 音高调制 + 白噪声 lowpass 200Hz（星海嗡鸣） */
  deepSpace(ctx, out, kit) {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 55;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    sub.connect(subGain).connect(out);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07; // 慢速漂移
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 9;    // 音高摆动 ±9Hz
    lfo.connect(lfoDepth).connect(sub.frequency);
    const noise = ctx.createBufferSource();
    noise.buffer = kit.noise;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.18;
    noise.connect(lp).connect(noiseGain).connect(out);
    sub.start();
    lfo.start();
    noise.start();
    kit.stops.push(sub, lfo, noise);
  },

  /** starCorona：中频锯齿 110Hz → bandpass 800Hz + 快速 LFO 幅度调制（日冕等离子涌动） */
  starCorona(ctx, out, kit) {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 110;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 2.2;
    const amp = ctx.createGain();
    amp.gain.value = 0.55;
    saw.connect(bp).connect(amp).connect(out);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.4; // 快速涌动
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.26;
    lfo.connect(lfoDepth).connect(amp.gain);
    saw.start();
    lfo.start();
    kit.stops.push(saw, lfo);
  },

  /** planet：噪声 bandpass 400–1200Hz 缓慢扫掠 + 缓慢音量摆动（行星风声） */
  planet(ctx, out, kit) {
    const noise = ctx.createBufferSource();
    noise.buffer = kit.noise;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800; // 400–1200 中点
    bp.Q.value = 0.9;
    const wind = ctx.createGain();
    wind.gain.value = 0.6;
    noise.connect(bp).connect(wind).connect(out);
    const sweep = ctx.createOscillator();
    sweep.type = 'sine';
    sweep.frequency.value = 0.05;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 400; // ±400Hz → 通带 400..1200Hz
    sweep.connect(sweepDepth).connect(bp.frequency);
    const sway = ctx.createOscillator();
    sway.type = 'sine';
    sway.frequency.value = 0.031;
    const swayDepth = ctx.createGain();
    swayDepth.gain.value = 0.22; // 缓慢音量摆动
    sway.connect(swayDepth).connect(wind.gain);
    noise.start();
    sweep.start();
    sway.start();
    kit.stops.push(noise, sweep, sway);
  },

  /** combat：低频 80Hz 方波脉冲 → WaveShaper 失真 + 快速 LFO 幅度脉动 */
  combat(ctx, out, kit) {
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.value = 80;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve();
    shaper.oversample = '2x';
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    sq.connect(shaper).connect(amp).connect(out);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6.0; // 快速脉动
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.28;
    lfo.connect(lfoDepth).connect(amp.gain);
    sq.start();
    lfo.start();
    kit.stops.push(sq, lfo);
  },

  /** ground：噪声 lowpass 600Hz + 中速 LFO + 确定性偶发高频短音（鸟鸣/机械哨声） */
  ground(ctx, out, kit) {
    const noise = ctx.createBufferSource();
    noise.buffer = kit.noise;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const amp = ctx.createGain();
    amp.gain.value = 0.3;
    noise.connect(lp).connect(amp).connect(out);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.22; // 中速起伏
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.12;
    lfo.connect(lfoDepth).connect(amp.gain);
    noise.start();
    lfo.start();
    kit.stops.push(noise, lfo);

    // 偶发短促高频事件：确定性哈希决定触发与音高（约 45% 节拍触发一次）；
    // 触发在层输出 GainNode 下游，随交叉淡化一并淡出。
    let step = 0;
    const timer = setInterval(() => {
      step++;
      if (hash01(step * 7 + 1) > 0.45) return;
      const t = ctx.currentTime;
      const chirp = ctx.createOscillator();
      chirp.type = 'sine';
      chirp.frequency.value = 1600 + hash01(step * 13 + 5) * 1600; // 1.6–3.2kHz
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.08 + hash01(step * 17 + 9) * 0.05, t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.10 + hash01(step * 23 + 3) * 0.18);
      chirp.connect(env).connect(out);
      chirp.start(t);
      chirp.stop(t + 0.4);
    }, 1400);
    kit.timers.push(timer);
  },

  /** menu：柔和正弦和弦（A3 220 + C#4 277 + E4 330）+ 慢速 LFO 音量呼吸 */
  menu(ctx, out, kit) {
    const chord = ctx.createGain();
    chord.gain.value = 0.24;
    chord.connect(out);
    for (const f of [220, 277, 330]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const voice = ctx.createGain();
      voice.gain.value = 1 / 3;
      osc.connect(voice).connect(chord);
      osc.start();
      kit.stops.push(osc);
    }
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08; // 慢速呼吸
    const depth = ctx.createGain();
    depth.gain.value = 0.07;
    lfo.connect(depth).connect(chord.gain);
    lfo.start();
    kit.stops.push(lfo);
  },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volumes = { master: 0.7, sfx: 0.8, music: 0.6 };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved && typeof saved.master === 'number') this.volumes = saved;
    } catch { /* ignore */ }
    if (typeof this.volumes.music !== 'number') this.volumes.music = 0.6; // 旧存档补齐音乐总线
    // —— 环境音层状态（_ensureCtx 建立总线后生效） ——
    this._musicBus = null;      // musicVolume 总线：master × music → destination
    this._ambient = null;       // 当前场景层句柄 { out, level, dispose }
    this._currentScene = null;  // 已应用场景名
    this._desiredScene = null;  // AudioContext 挂起态下暂存的目标场景
    this._noiseBuf = null;      // 共享白噪声缓冲（懒建，全场景复用）
    // 首次交互解锁
    const unlock = () => {
      this._ensureCtx();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => this._applyDesiredScene()).catch(() => { /* 保持挂起 */ });
      } else {
        this._applyDesiredScene();
      }
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
    // 音乐总线：环境音层 → 独立 GainNode → musicVolume 总线 → destination
    if (this.ctx) {
      this._musicBus = this.ctx.createGain();
      this._musicBus.gain.value = this._musicBusGain();
      this._musicBus.connect(this.ctx.destination);
    }
  }

  setVolume(bus, v) {
    this.volumes[bus] = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.volumes));
    } catch { /* ignore */ }
    // master / music 任一变化都会改变音乐总线实时增益
    if (bus === 'master' || bus === 'music') this._applyMusicBusGain(0.08);
  }

  // ———— 环境音层 API（R9） ————

  /**
   * 启动 / 切换场景环境音层。
   * @param {'deepSpace'|'starCorona'|'planet'|'combat'|'ground'|'menu'} scene
   * 场景切换走 1.5s 交叉淡化；AudioContext 尚未解锁时暂存目标场景，
   * 首次用户交互（构造器 unlock）后自动补启。由各视图 mount/unmount 调用。
   */
  startAmbient(scene) {
    if (!AMBIENT_BUILDERS[scene]) return; // 未知场景静默忽略（调用方语义错误不致命）
    this._desiredScene = scene;
    this._ensureCtx();
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') {
      // 挂起态（未获用户手势）：尝试唤醒，成功后由 _applyDesiredScene 补启
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => this._applyDesiredScene()).catch(() => { /* 保持挂起 */ });
      }
      return;
    }
    this._applyScene(scene);
  }

  /** setScene 别名：App / 视图层语义化入口（同样 1.5s 交叉淡化切换） */
  setScene(scene) {
    this.startAmbient(scene);
  }

  /** 停止环境音层（1.5s 淡出后释放全部节点与定时器） */
  stopAmbient() {
    this._desiredScene = null;
    if (!this.ctx || !this._ambient) return;
    this._fadeOutDispose(this._ambient);
    this._ambient = null;
    this._currentScene = null;
  }

  /** 独立音乐音量总线（0..1；持久化与实时增益一并生效） */
  setMusicVolume(v) {
    this.setVolume('music', v);
  }

  // ———— 环境音内部实现 ————

  /** 音乐总线实时增益 = master × music（两总线任一变化都需重算） */
  _musicBusGain() {
    const m = typeof this.volumes.master === 'number' ? this.volumes.master : 0.7;
    const mu = typeof this.volumes.music === 'number' ? this.volumes.music : 0.6;
    return Math.max(0, Math.min(1, m * mu));
  }

  /** 重设音乐总线增益（短斜坡避免音量跳变） */
  _applyMusicBusGain(rampSec = 0.08) {
    if (!this.ctx || !this._musicBus) return;
    const g = this._musicBus.gain;
    const target = this._musicBusGain();
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    if (rampSec > 0) {
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(target, t + rampSec);
    } else {
      g.value = target;
    }
  }

  /** AudioContext 就绪后补启挂起期间请求的场景 */
  _applyDesiredScene() {
    if (this._desiredScene && this.ctx && this.ctx.state === 'running') {
      this._applyScene(this._desiredScene);
    }
  }

  /** 应用场景层：旧层 1.5s 淡出、新层 1.5s 淡入（交叉淡化） */
  _applyScene(scene) {
    if (!this.ctx || !this._musicBus || this.ctx.state !== 'running') return;
    if (this._currentScene === scene && this._ambient) return;
    const t = this.ctx.currentTime;
    if (this._ambient) {
      this._fadeOutDispose(this._ambient);
      this._ambient = null;
    }
    const handle = this._buildScene(scene);
    this._ambient = handle;
    this._currentScene = scene;
    const g = handle.out.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(handle.level, t + AMBIENT_XFADE_SEC);
  }

  /** 构建场景层：层输出 GainNode → musicVolume 总线；节点/定时器登记进 kit 统一释放 */
  _buildScene(scene) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001; // 交叉淡化起点（_applyScene 调度淡入曲线）
    out.connect(this._musicBus);
    const kit = { stops: [], timers: [], noise: this._noiseBuffer(ctx) };
    AMBIENT_BUILDERS[scene](ctx, out, kit);
    const handle = {
      out,
      level: SCENE_LEVEL[scene] || 0.5,
      dispose: () => {
        for (const s of kit.stops) {
          try { s.stop(); } catch { /* 已停止的源重复 stop 会抛错，忽略 */ }
        }
        for (const tm of kit.timers) clearInterval(tm);
        try { out.disconnect(); } catch { /* 已断开 */ }
      },
    };
    return handle;
  }

  /** 淡出场景层并在淡化结束后释放（释放前保留节点以完成 1.5s 尾音） */
  _fadeOutDispose(handle) {
    const t = this.ctx.currentTime;
    const g = handle.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(0.0001, t + AMBIENT_XFADE_SEC);
    setTimeout(() => handle.dispose(), AMBIENT_XFADE_SEC * 1000 + 150);
  }

  /** 共享白噪声缓冲（2s 循环；确定性 xorshift 填充，绝不使用 Math.random） */
  _noiseBuffer(ctx) {
    if (this._noiseBuf) return this._noiseBuf;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = xorshift32(0x9e3779b9);
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
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
