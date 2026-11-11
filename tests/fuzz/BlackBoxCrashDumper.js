/**
 * tests/fuzz/BlackBoxCrashDumper.js — 黑匣子现场快照转储器（doc26 §3）
 *
 * 100ms 级冻结现场：错误堆栈 + 面包屑 + 系统画像 + 世界快照（tick/seq/派系）。
 * Node 侧经动态 import('node:fs') 落盘（套件模块零 node:* 静态导入，浏览器
 * DiagnosticsView 聚合门面可安全加载）；浏览器侧保存在 window.__fuzzDumps。
 * 兼容无头与 WebGL 上下文丢失场景（doc26 IMPORTANT：转储过程自身绝不抛次生异常）。
 */

export class BlackBoxCrashDumper {
  constructor(ctx, options = {}) {
    this.ctx = ctx || {};
    this.options = Object.assign({ dumpDir: 'tests/fuzz/dumps', gameVersion: '0.1.0' }, options);
    this.dumps = [];
  }

  /** 生成自包含诊断快照对象（纯同步，无 I/O，绝不抛错） */
  capture(err, breadcrumbs, world) {
    let sysProfile = { jsHeapUsedMB: null, activeDOMNodes: null, webGLContextLost: null, fps: null };
    try {
      if (typeof performance !== 'undefined' && performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)) {
        sysProfile.jsHeapUsedMB = Math.round((performance.memory.usedJSHeapSize / 1048576) * 100) / 100;
      }
      if (typeof document !== 'undefined' && document.querySelectorAll) {
        sysProfile.activeDOMNodes = document.querySelectorAll('*').length;
      }
    } catch { /* 环境能力缺失时字段保持 null（doc26 兼容铁律） */ }

    let worldSnapshot = null;
    try {
      worldSnapshot = world ? {
        tick: world.tick, seq: world.seq, playerFactionId: world.playerFactionId,
        seed: world.seed, worldKind: this.ctx.worldKind || 'starter',
        hashSafe: safeSnapshotHash(world),
      } : null;
    } catch { worldSnapshot = null; }

    return {
      timestamp: Date.now(),
      gameVersion: this.options.gameVersion,
      seed: this.ctx.seed ?? null,
      lastRoute: this.ctx.lastRoute || null,
      activeViewId: this.ctx.activeViewId || null,
      error: {
        name: (err && err.name) || 'Error',
        message: String((err && err.message) || err),
        stack: String((err && err.stack) || '').split('\n').slice(0, 12).join('\n'),
      },
      breadcrumbs: (breadcrumbs || []).slice(-60),
      systemProfile: sysProfile,
      worldSnapshot,
      canvasFrame: null, // 无头/上下文丢失场景恒 null；浏览器实机由 fuzz-runner 经 canvas.toDataURL 补充
    };
  }

  /** 捕获并落盘；返回 {dumpPath?, dump}。任何 I/O 失败降级为仅内存保留。 */
  async captureAndSave(err, breadcrumbs, world) {
    const dump = this.capture(err, breadcrumbs, world);
    this.dumps.push(dump);
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(this.options.dumpDir, { recursive: true });
        const path = `${this.options.dumpDir}/crash-dump-${dump.timestamp}.json`;
        writeFileSync(path, JSON.stringify(dump, null, 2), 'utf8');
        dump.dumpPath = path;
      } catch (ioErr) {
        dump.ioError = String(ioErr && ioErr.message);
      }
    } else if (typeof window !== 'undefined') {
      (window.__fuzzDumps ||= []).push(dump);
      dump.dumpPath = `window.__fuzzDumps[${window.__fuzzDumps.length - 1}]`;
    }
    return dump;
  }
}

/** 循环引用安全的世界摘要哈希（审计用；NaN/Infinity 哨兵在 FuzzStorm 内实现） */
function safeSnapshotHash(world) {
  try {
    const seen = new Set();
    let h = 2166136261 >>> 0;
    const walk = (v) => {
      if (v === null || typeof v !== 'object') {
        const t = typeof v === 'number' ? (Number.isFinite(v) ? `n${v}` : `x${String(v)}`) : `${typeof v}:${String(v)}`;
        for (let i = 0; i < t.length; i++) h = (Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0);
        return;
      }
      if (seen.has(v)) { h = (Math.imul(h ^ 0x5a5a, 16777619) >>> 0); return; }
      seen.add(v);
      for (const k of Object.keys(v)) {
        for (let i = 0; i < k.length; i++) h = (Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0);
        walk(v[k]);
      }
      seen.delete(v);
    };
    walk(world);
    return (h >>> 0).toString(16);
  } catch {
    return null;
  }
}
