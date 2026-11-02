/**
 * app/ViewRegistry.js — 页面注册表（任务书 2.1）
 * 每个视图：{ id, titleKey, mount(ctx), unmount() }；同一时间只激活一个主视图。
 */

const views = new Map();
let active = null;

export function registerView(view) {
  if (views.has(view.id)) throw new Error(`视图重复注册: ${view.id}`);
  views.set(view.id, view);
}

export function getView(id) {
  return views.get(id);
}

export function allViews() {
  return [...views.values()];
}

/** 切换视图；返回被停用的视图 id 或 null */
export function activateView(id, ctx) {
  if (active && active.id === id) return null;
  if (active) {
    try {
      active.unmount();
    } catch (e) {
      console.error(`视图 ${active.id} 卸载异常`, e);
    }
  }
  const prev = active ? active.id : null;
  active = views.get(id) || null;
  if (!active) throw new Error(`视图未注册: ${id}`);
  active.mount(ctx);
  return prev;
}

export function activeView() {
  return active;
}
