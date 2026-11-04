/**
 * ui/state/UIStateStore.js — 瞬态 UI 状态仓库（doc5 §3.4 P0-04）
 *
 * 职责：把「视图展开/折叠、滚动偏移、焦点键、视图内临时选中」等瞬态交互状态
 * 从世界状态（world.*）与视图 DOM 生命周期中彻底解耦独立持有：
 *  - 折叠面板跨快照记忆（_panels：panelKey → isOpen）；
 *  - 容器滚动/焦点跨重建保持（_scrolls：containerKey → {top,left}）；
 *  - 视图级瞬态槽（_viewStates：viewId → plain object，惰性初始化）。
 *
 * 数据流纪律：本仓库只承载前端瞬态，绝不写入 world；领域状态仍由
 * CommandBus / SnapshotBuilder 权威驱动（doc5 §1.2 铁律 1）。
 *
 * 约束：顶层零副作用、不触碰 DOM（document 仅在 preserveScrollAndFocus 函数体内、
 * 且带 typeof 守卫访问）——可在 Node 侧安全 import 供单元测试。
 */

class UIStateManager {
  constructor() {
    /** @type {Map<string, boolean>} panelKey → 展开态 */
    this._panels = new Map();
    /** @type {Map<string, {top:number, left:number}>} containerKey → 滚动偏移 */
    this._scrolls = new Map();
    /** @type {Map<string, object>} viewId → 视图瞬态槽 */
    this._viewStates = new Map();
  }

  /**
   * 折叠面板是否展开（未记录时回退 defaultOpen）。
   * @param {string} panelKey 面板稳定键（panels.js 的 id / `panel:${title}`）
   * @param {boolean} [defaultOpen=true] 无记录时的默认展开态
   */
  isPanelOpen(panelKey, defaultOpen = true) {
    const v = this._panels.get(String(panelKey));
    return v === undefined ? defaultOpen !== false : !!v;
  }

  /** 记录面板展开态（panels.js setOpen 持久化入口） */
  setPanelOpen(panelKey, isOpen) {
    this._panels.set(String(panelKey), !!isOpen);
  }

  /**
   * 视图瞬态槽（惰性初始化）：首次调用用 defaults 浅拷贝建槽，后续返回同一对象。
   * @param {string} viewId 视图标识（如 'system'）
   * @param {object} [defaults] 首次初始化的默认字段
   */
  view(viewId, defaults = null) {
    const key = String(viewId);
    let slot = this._viewStates.get(key);
    if (!slot) {
      slot = Object.assign({}, defaults && typeof defaults === 'object' ? defaults : {});
      this._viewStates.set(key, slot);
    }
    return slot;
  }

  /** 丢弃视图瞬态槽（视图卸载且不需要跨挂载保持时可选调用） */
  dropView(viewId) {
    this._viewStates.delete(String(viewId));
  }

  /**
   * 滚动/焦点保持包裹器：执行 mutateFn（通常是整段 DOM 重建）前后保存并恢复
   * 容器 scrollTop/scrollLeft 与容器内聚焦元素的 data-focus-key，重建后按
   * `[data-focus-key="…"]` 查询恢复焦点。
   *
   * 滚动偏移同时登记进 _scrolls：容器被整棵重建（滚动归零）后的下一次调用
   * 仍可从仓库恢复上一次位置（跨视图重挂载保持）。
   *
   * @param {string} containerKey 容器稳定键（如 `dossier:${systemId}`）
   * @param {HTMLElement|null} containerEl 可滚动容器（null 时仅登记键）
   * @param {Function} mutateFn 变更函数（同步）
   */
  preserveScrollAndFocus(containerKey, containerEl, mutateFn) {
    const key = String(containerKey);
    const doc = (typeof document !== 'undefined') ? document : null;
    const box = containerEl || null;
    const canBox = !!(box && typeof box.scrollTop === 'number');

    // —— 变更前：保存滚动与焦点键 ——
    const saved = this._scrolls.get(key) || { top: 0, left: 0 };
    if (canBox) {
      saved.top = box.scrollTop || 0;
      saved.left = box.scrollLeft || 0;
    }
    let focusKey = null;
    if (doc && box && doc.activeElement
      && typeof box.contains === 'function' && box.contains(doc.activeElement)
      && typeof doc.activeElement.getAttribute === 'function') {
      focusKey = doc.activeElement.getAttribute('data-focus-key') || null;
    }

    // —— 变更 ——
    if (typeof mutateFn === 'function') mutateFn();

    // —— 变更后：恢复滚动与焦点 ——
    if (canBox) {
      if (saved.top) box.scrollTop = saved.top;
      if (saved.left) box.scrollLeft = saved.left;
    }
    if (focusKey && box && typeof box.querySelector === 'function') {
      const target = box.querySelector(`[data-focus-key="${cssAttrEscape(focusKey)}"]`);
      if (target && typeof target.focus === 'function') {
        try { target.focus(); } catch (_) { /* 不可聚焦元素忽略 */ }
      }
    }
    this._scrolls.set(key, { top: saved.top, left: saved.left });
  }
}

/** 属性选择器值转义（键含引号/反斜杠时安全；常规 id 键直通） */
function cssAttrEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 全局单例（各视图直接 import 使用） */
export const uiState = new UIStateManager();

/** 测试/工具用：类本体（可另建隔离实例） */
export { UIStateManager };
