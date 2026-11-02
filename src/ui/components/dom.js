/**
 * ui/components/dom.js — 通用 DOM 构建工具（组件库地基）
 *
 * 提供最小而完整的声明式元素构建：
 *  - el(tag, attrs, children)：HTML 元素；attrs 支持 class/dataset/text/html/style/on，
 *    以及布尔属性（true → 置空属性、false → 移除）与任意自定义属性（setAttribute）；
 *  - frag(children)：DocumentFragment 聚合；
 *  - clearEl(node)：清空全部子节点；
 *  - svgEl(tag, attrs, children)：SVG 命名空间版本（class 同样走 setAttribute）。
 *
 * 安全约定：动态内容一律走 textContent / createTextNode / setAttribute；
 * html 属性仅允许调用方传入静态模板字符串，组件库内部不对动态数据使用。
 * 本模块顶层不触碰 document/window（仅在函数体内访问），可在 Node 侧安全 import。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 创建 HTML 元素并应用属性与子节点 */
export function el(tag, attrs = null, children = null) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** 创建 SVG 元素（createElementNS），attrs 语义与 el 完全一致 */
export function svgEl(tag, attrs = null, children = null) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** 聚合 children（数组/字符串/Node/null…，数组递归）为 DocumentFragment */
export function frag(children = null) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}

/** 移除 node 的全部子节点（返回原节点，便于链式使用） */
export function clearEl(node) {
  node.replaceChildren();
  return node;
}

/** 逐键应用 attrs：保留键特殊处理，其余走通用属性（含布尔属性语义） */
function applyAttrs(node, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue; // null/undefined 一律视为「不设置」
    switch (key) {
      case 'class':
        node.setAttribute('class', String(value)); // SVG 与 HTML 统一走 setAttribute
        break;
      case 'dataset':
        for (const [k, v] of Object.entries(value || {})) {
          if (v != null) node.dataset[k] = String(v); // camelCase 自动映射为 data-*
        }
        break;
      case 'text':
        node.textContent = String(value); // 动态文本的唯一安全通道
        break;
      case 'html':
        node.innerHTML = value; // 仅限静态模板字符串；严禁传入动态数据
        break;
      case 'style':
        for (const [k, v] of Object.entries(value || {})) {
          if (v != null) node.style[k] = String(v); // camelCase 键
        }
        break;
      case 'on':
        for (const [type, fn] of Object.entries(value || {})) {
          if (typeof fn === 'function') node.addEventListener(type, fn);
        }
        break;
      default:
        setAttr(node, key, value);
    }
  }
}

/** 通用属性：true → 置空属性；false → 移除；其余 String 化（覆盖 disabled/checked/aria-系列/title 等） */
function setAttr(node, name, value) {
  if (value === false) node.removeAttribute(name);
  else if (value === true) node.setAttribute(name, '');
  else node.setAttribute(name, String(value));
}

/** 递归追加子节点：Node 直挂；字符串/数字/布尔转文本；null/undefined 与未知类型静默跳过 */
function appendChildren(parent, children) {
  if (children == null) return;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(parent, child);
    return;
  }
  if (children instanceof Node) {
    parent.appendChild(children);
    return;
  }
  if (typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean') {
    parent.appendChild(document.createTextNode(String(children)));
  }
}
