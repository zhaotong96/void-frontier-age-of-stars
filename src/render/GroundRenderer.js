/**
 * render/GroundRenderer.js — 地面行动渲染器（任务书 5.7）
 * 消费 getMissionView 快照，Canvas 2D 绘制网格/单位/目标点/撤离区。
 */

const TILE = 22;

export class GroundRenderer {
  init(canvasManager) {
    this.cm = canvasManager;
  }

  /** 世界坐标（tile）→ 屏幕 */
  _t2s(gx, gy) {
    return { x: gx * TILE, y: gy * TILE };
  }

  render(ctx, w, h, view, opts = {}) {
    if (!view || !view.grid) return;
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    // 网格
    const gw = view.w;
    const gh = view.h;
    const ox = Math.max(0, (w - gw * TILE) / 2);
    const oy = Math.max(0, (h - gh * TILE) / 2);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = view.grid[y * gw + x];
        let color = null;
        if (t === 1) color = '#1d2a3a';
        else if (t === 2) color = '#2c3e54';
        else if (t === 5) color = 'rgba(98, 217, 138, 0.25)';
        else if (t === 6) color = 'rgba(232, 95, 95, 0.15)';
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(ox + x * TILE, oy + y * TILE, TILE - 1, TILE - 1);
        }
      }
    }

    // 目标物（objectives 里的 interactables）
    for (const obj of view.objectives || []) {
      if (!obj.position) continue;
      const p = this._t2s(obj.position.x, obj.position.y);
      const px = ox + p.x + TILE / 2;
      const py = oy + p.y + TILE / 2;
      const done = obj.done;
      ctx.fillStyle = done ? '#62d98a' : obj.kind === 'boss' ? '#e85f5f' : '#e8b04f';
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#07090e';
      ctx.stroke();
    }

    // 敌人
    for (const e of view.enemies || []) {
      if (e.state === 'dead') continue;
      const px = ox + e.x;
      const py = oy + e.y;
      ctx.fillStyle = e.type === 'boss' ? '#e85f5f' : e.state === 'windup' ? '#e8b04f' : '#c96a6a';
      ctx.beginPath();
      ctx.arc(px, py, e.type === 'boss' ? 12 : 7, 0, Math.PI * 2);
      ctx.fill();
      if (e.state === 'windup') {
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      // 血条
      ctx.fillStyle = '#07090e';
      ctx.fillRect(px - 10, py - 14, 20, 3);
      ctx.fillStyle = '#e85f5f';
      ctx.fillRect(px - 10, py - 14, 20 * Math.max(0, e.hp / e.hpMax), 3);
    }

    // 玩家小队
    for (const u of view.playerUnits || []) {
      const px = ox + u.x;
      const py = oy + u.y;
      if (u.state === 'dead') {
        ctx.fillStyle = '#46586e';
        ctx.fillRect(px - 6, py - 2, 12, 4);
        continue;
      }
      const isControlled = u.controlled;
      ctx.fillStyle = isControlled ? '#4fd8e8' : '#7ea8ff';
      if (u.state === 'dodge') ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 朝向
      ctx.strokeStyle = '#c9d6e3';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(u.facing || 0) * 13, py + Math.sin(u.facing || 0) * 13);
      ctx.stroke();
      // 状态环
      if (u.state === 'block') {
        ctx.strokeStyle = '#e8b04f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (u.state === 'attack') {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 血/盾/耐力条
      ctx.fillStyle = '#07090e';
      ctx.fillRect(px - 12, py - 18, 24, 6);
      ctx.fillStyle = '#62d98a';
      ctx.fillRect(px - 12, py - 18, 24 * Math.max(0, u.hp / u.hpMax), 3);
      ctx.fillStyle = '#4fd8e8';
      ctx.fillRect(px - 12, py - 15, 24 * Math.max(0, u.shield / u.shieldMax), 3);
      if (isControlled) {
        ctx.fillStyle = '#e8b04f';
        ctx.fillRect(px - 12, py - 12, 24 * Math.max(0, u.stamina / 100), 2);
      }
    }

    // HUD 文本
    ctx.fillStyle = '#71839a';
    ctx.font = '11px monospace';
    ctx.fillText(`T+${Math.round(view.time)}s  目标 ${view.objectivesDone}/${view.objectivesTotal || (view.objectives || []).length}`, 10, 16);
  }
}
