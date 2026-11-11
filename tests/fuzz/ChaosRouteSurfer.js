/**
 * tests/fuzz/ChaosRouteSurfer.js — 16 屏高频突变驱动（doc26 §2.1）
 *
 * 浏览器实机：真实 App 视图导航 + DOM/监听器健康度断言（.vf-view 恒 1、
 * window 监听器增量受控）；Node 无头：导出路由池与 parseHash fuzz 配合
 * StateMachineFuzzer 使用（Router.js:9-19 纯解析器口径）。
 */

/** doc26 §2.1 全量视图池（Screen ID 与 src/ui/screens/ 实体模块一一对应） */
export const SURF_ROUTES = [
  { screen: 'menu', param: null },
  { screen: 'galaxy', param: null },
  { screen: 'system', param: 'sys_1' },
  { screen: 'colony', param: 'col_1' },
  { screen: 'fleet', param: 'flt_1' },
  { screen: 'designer', param: null },
  { screen: 'combat', param: 'bat_1' },
  { screen: 'research', param: null },
  { screen: 'market', param: null },
  { screen: 'diplomacy', param: null },
  { screen: 'government', param: null },
  { screen: 'ground', param: 'plt_1' },
  { screen: 'events', param: null },
  { screen: 'chronicle', param: null },
  { screen: 'settings', param: null },
  { screen: 'diagnostics', param: null },
  // 半合法 / 未知路由（App._onRoute 未知路由回菜单守卫）
  { screen: 'unknown_screen', param: 'x' },
  { screen: 'ground', param: 'invalid_planet' },
];

/** 浏览器实机单步冲浪：导航 + 域断言；返回落位 screen */
export async function surfNavigate(ui, route) {
  await ui.navigate(route.screen, route.param);
  // DOM 视图双重堆叠禁令（doc26 §2.1）：.vf-view 数量恒等于 1
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    const n = document.querySelectorAll('.vf-view').length;
    if (n > 1) throw new Error(`[CHAOS-SURF] DOM 视图堆叠 ${n} > 1（路由 ${route.screen}）`);
  }
  return route.screen;
}

/**
 * 监听器泄露普查（doc26 §2.1：1,000 次切换后 window 监听器增量 ≤ 2）。
 * 通过 getEventListeners 不可用的环境用 monkeypatch 计数器（fuzz-runner 安装）。
 */
export function listenerDelta(installed) {
  if (!installed) return null;
  return {
    added: installed.added,
    removed: installed.removed,
    delta: installed.added - installed.removed,
  };
}
