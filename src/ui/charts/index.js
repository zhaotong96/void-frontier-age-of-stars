/**
 * ui/charts/index.js — 图表库统一出口
 *
 * 汇总 re-export src/ui/charts/ 下的全部图表组件与默认色板；
 * 页面侧统一从本文件 import，避免深层相对路径。
 * 各图表的参数与结构约定见各自文件头部注释：
 *  - lineChart / sparkline —— 折线图、迷你趋势线（资源曲线、市场趋势）；
 *  - barChart —— 水平条形图（市场供需对比，支持负值）；
 *  - gauge —— 半环仪表（威胁等级、稳定度）；
 *  - stackBar —— 堆叠横条（人口构成、账本构成）；
 *  - timeline —— 竖直时间线（纪年事件流）；
 *  - CHART_COLORS —— 默认系列色板。
 */

export { lineChart, sparkline, CHART_COLORS } from './svgChart.js';
export { barChart } from './barChart.js';
export { gauge } from './gauge.js';
export { stackBar } from './stack.js';
export { timeline } from './timeline.js';
