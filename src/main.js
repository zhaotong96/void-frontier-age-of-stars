/**
 * src/main.js — 应用启动器（任务书 2.1）
 * 唯一根入口加载的模块：初始化 i18n、诊断钩子并启动 App。
 */

import { App } from './app/App.js';
import { registerAll as registerLocalization } from './content/localization/index.js';

function fail(msg) {
  (window.__bootErrors ||= []).push(msg);
  const status = document.getElementById('boot-status');
  if (status) status.textContent = msg;
  // eslint-disable-next-line no-console
  console.error('[VOID FRONTIER] 启动失败:', msg);
}

async function boot() {
  try {
    registerLocalization();
    const app = new App(document.getElementById('app'));
    await app.boot();
    // 全局错误边界：任何未捕获异常暂停模拟并提示（任务书 11.4）
    window.addEventListener('error', (ev) => {
      app.reportFatal(ev.error || new Error(ev.message));
    });
    window.addEventListener('unhandledrejection', (ev) => {
      app.reportFatal(ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason)));
    });
  } catch (e) {
    fail(`初始化失败: ${e && e.message}`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
