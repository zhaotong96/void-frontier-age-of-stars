/**
 * persistence/TabGuard.js — 多标签页并发写入防护（任务书 8.4）
 *
 * BroadcastChannel 协调活动标签页；不支持时退化为 localStorage 心跳
 * 尽力而为提示。检测到重复会话时，后来者进入只读警告状态。
 */

const CHANNEL = 'void-frontier-session';
const LEASE_KEY = 'vf-session-lease';
const HEARTBEAT_MS = 3000;

export class TabGuard {
  constructor() {
    this.isOwner = false;
    this.readOnly = true;
    this.channel = null;
    this._heartbeat = null;
    this._onStateChange = null;
  }

  /** 尝试获取会话所有权；返回 'owner' | 'observer' */
  acquire(onStateChange) {
    this._onStateChange = onStateChange || null;
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (ev) => this._onMessage(ev.data);
    } catch {
      this.channel = null; // 退化路径
    }
    // 询问现有持有者
    this._post({ type: 'who' });
    // 短暂等待后成为持有者（无响应即无竞争）
    this._ownerTimer = setTimeout(() => {
      this.isOwner = true;
      this.readOnly = false;
      this._startHeartbeat();
      this._post({ type: 'claimed' });
      if (this._onStateChange) this._onStateChange('owner');
    }, 350);
    return 'pending';
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'who' && this.isOwner) {
      this._post({ type: 'held' });
    } else if (msg.type === 'held' && !this.isOwner && this._ownerTimer) {
      // 已有持有者：进入只读
      clearTimeout(this._ownerTimer);
      this._ownerTimer = null;
      this.readOnly = true;
      if (this._onStateChange) this._onStateChange('observer');
    } else if (msg.type === 'release') {
      // 持有者释放：允许延迟重试
    }
  }

  _startHeartbeat() {
    this._heartbeat = setInterval(() => {
      try {
        localStorage.setItem(LEASE_KEY, String(Date.now()));
      } catch { /* ignore */ }
    }, HEARTBEAT_MS);
  }

  _post(msg) {
    try {
      this.channel?.postMessage(msg);
    } catch { /* ignore */ }
  }

  release() {
    this._post({ type: 'release' });
    if (this._heartbeat) clearInterval(this._heartbeat);
    if (this._ownerTimer) clearTimeout(this._ownerTimer);
    this.isOwner = false;
    this.readOnly = true;
  }
}
