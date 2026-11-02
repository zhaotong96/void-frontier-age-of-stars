/**
 * ui/components/dataTable.js — 通用数据表格
 *
 * dataTable({ columns, rows, selectedId, onRowClick, emptyText, dense }) → table.vf-table。
 *  - columns: [{ key, label?, align?('left|right|center'), width?(css width), render?(row), sortValue?(row) }]
 *    默认 render 取 row[key]；render 抛错时该单元格显示 "!"（console.warn），不影响整表；
 *  - 点击表头按 sortValue ?? row[key] 排序：数值列数值比较，否则 localeCompare('zh-CN')；
 *    值相同保持原始顺序（显式索引 tiebreaker 保证稳定）；再点同一表头反转方向；
 *    排序在行视图副本上进行，绝不改动调用方数组；
 *  - 选中行（row.id === selectedId）标记 class "is-selected"，可点击行标记 "is-clickable"，
 *    hover/选中样式由 CSS 负责，本组件只产出结构 class；
 *  - 空数据显示 emptyText（默认「暂无数据」）；表头 button 带 aria-sort。
 * 本模块顶层不触碰 document。
 */

import { el, clearEl } from './dom.js';

export function dataTable({ columns, rows, selectedId, onRowClick, emptyText = '暂无数据', dense } = {}) {
  const cols = (Array.isArray(columns) ? columns : []).filter(Boolean);
  const data = Array.isArray(rows) ? rows : [];
  let sortKey = null; // 当前排序列 key；null = 未排序（保持传入顺序）
  let sortDir = 'asc';

  const headerRow = el('tr');
  const thead = el('thead', null, [headerRow]);
  const tbody = el('tbody');
  const table = el('table', { class: dense ? 'vf-table is-dense' : 'vf-table' }, [thead, tbody]);

  renderHeader();
  renderBody();
  return table;

  /** 重建表头：button 承载点击排序；th 带 scope/aria-sort/列宽 */
  function renderHeader() {
    clearEl(headerRow);
    for (const col of cols) {
      const active = sortKey != null && col.key === sortKey;
      headerRow.append(el('th', {
        scope: 'col',
        'aria-sort': active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
        style: col.width ? { width: String(col.width) } : null,
      }, [
        el('button', {
          class: 'vf-table-sort',
          type: 'button',
          on: { click: () => toggleSort(col) },
        }, [
          String(col.label ?? col.key),
          active ? el('span', { class: 'vf-table-arrow', 'aria-hidden': 'true', text: sortDir === 'asc' ? '▲' : '▼' }) : null,
        ]),
      ]));
    }
  }

  /** 表头点击：同列反转方向，异列回到升序 */
  function toggleSort(col) {
    if (sortKey === col.key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = col.key;
      sortDir = 'asc';
    }
    renderHeader();
    renderBody();
  }

  /** 重建表体（基于排序视图副本） */
  function renderBody() {
    clearEl(tbody);
    if (data.length === 0) {
      tbody.append(el('tr', { class: 'vf-table-empty' }, [
        el('td', { class: 'vf-table-empty-cell', colspan: Math.max(cols.length, 1), text: emptyText }),
      ]));
      return;
    }
    for (const row of sortedRows()) {
      const id = row && typeof row === 'object' ? row.id : undefined;
      const parts = [];
      if (selectedId != null && id === selectedId) parts.push('is-selected');
      if (typeof onRowClick === 'function') parts.push('is-clickable');
      const tr = el('tr', {
        class: parts.length ? parts.join(' ') : null,
        dataset: id != null ? { id: String(id) } : null, // data-id 便于测试与自动化定位
        on: typeof onRowClick === 'function' ? { click: (ev) => onRowClick(row, ev) } : null,
      });
      for (const col of cols) tr.append(renderCell(row, col));
      tbody.append(tr);
    }
  }

  /** 返回排序后的行视图副本；未排序时保持原序 */
  function sortedRows() {
    if (sortKey == null) return data.slice();
    const col = cols.find((c) => c.key === sortKey) || {};
    const keyed = data.map((row, index) => ({ row, index, value: sortValueOf(col, row) }));
    keyed.sort((a, b) => {
      const cmp = compareValues(a.value, b.value);
      if (cmp !== 0) return sortDir === 'desc' ? -cmp : cmp;
      return a.index - b.index; // 值相同：无论升降序都保持原始顺序（稳定）
    });
    return keyed.map((entry) => entry.row);
  }

  /** 单行排序键：优先 sortValue(row)，回退 row[key]；sortValue 抛错时降级为 row[key] */
  function sortValueOf(col, row) {
    try {
      if (typeof col.sortValue === 'function') {
        const v = col.sortValue(row);
        return v === undefined ? null : v;
      }
    } catch (err) {
      console.warn(`[dataTable] sortValue 列 "${col.key}" 抛错，回退 row[key]:`, err);
    }
    const fallback = row ? row[col.key] : null;
    return fallback === undefined ? null : fallback;
  }

  /** 数值列数值比较；其余按 zh-CN 字符串比较；null 排最前（升序时） */
  function compareValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'zh-CN');
  }

  /** 单元格渲染：默认 row[key]；render 抛错显示 "!"，不让整表崩溃 */
  function renderCell(row, col) {
    let content;
    try {
      const raw = typeof col.render === 'function' ? col.render(row) : (row ? row[col.key] : null);
      content = raw instanceof Node ? raw : (raw == null ? '' : String(raw));
    } catch (err) {
      console.warn(`[dataTable] render 列 "${col.key}" 抛错:`, err);
      content = '!';
    }
    return el('td', { class: ['left', 'right', 'center'].includes(col.align) ? `is-${col.align}` : null }, [content]);
  }
}
