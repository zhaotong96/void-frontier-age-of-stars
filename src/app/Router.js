/**
 * app/Router.js — hash 路由（任务书 8.6：#/galaxy 形式，兼容 GitHub Pages 二级路径）
 */

const listeners = new Set();

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { screen: 'menu', param: null };
  const parts = h.split('/');
  return { screen: parts[0], param: parts.slice(1).join('/') || null };
}

export function navigate(screen, param = null) {
  const target = `#/${screen}${param ? '/' + param : ''}`;
  if (location.hash === target) {
    emitChange();
  } else {
    location.hash = target;
  }
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange() {
  const route = parseHash();
  for (const fn of listeners) fn(route);
}

export function initRouter() {
  window.addEventListener('hashchange', emitChange);
  return parseHash();
}
