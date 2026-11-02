/**
 * ui/components/index.js — 组件库统一出口
 *
 * 汇总 re-export src/ui/components/ 下的全部通用组件；
 * 页面侧统一从本文件 import，避免深层相对路径。
 * 各组件的职责与结构约定见各自文件头部注释。
 */

export { el, frag, clearEl, svgEl } from './dom.js';
export { dataTable } from './dataTable.js';
export { showModal } from './modal.js';
export { toast, clearToasts } from './toast.js';
export { progressBar } from './progress.js';
export { statBar, resourceChip } from './bars.js';
export { tabs } from './tabs.js';
export { panel, kvList } from './panels.js';
