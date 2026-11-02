/**
 * core/i18n.js — 轻量国际化内核
 *
 * 设计约束：
 * - 纯内存状态：语言切换与持久化（localStorage 等）完全交给调用方，本模块不触碰任何宿主 API。
 * - 顶层禁止访问 window / document / localStorage，保证 Node 环境可直接导入（测试、模拟器 CLI）。
 * - 词典为扁平点分键（如 'ui.galaxy'），registerDict 可多次调用、浅合并（后注册覆盖同名键）。
 * - 查询回退链：当前语言 → zh-CN → 键名本身；缺失键只 console.warn 一次。
 */

/** 回退语言：词条缺失时的最终兜底 */
export const FALLBACK_LANG = 'zh-CN';

/** 支持的语言清单（固定顺序，getLanguages 返回其副本） */
const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'];

/** 已注册词典：lang → 扁平键值表 */
const dicts = new Map();

/** 当前语言（内存态，默认 zh-CN） */
let currentLang = FALLBACK_LANG;

/** 已警告过的缺失键集合：保证同一 key 只警告一次 */
const warnedKeys = new Set();

/** "{name}" 插值占位符匹配 */
const PARAM_PATTERN = /\{([^{}]+)\}/g;

/**
 * 注册（或合并）一门语言的词典。
 * 可对同一语言多次调用：后注册的同名键覆盖先注册的值，其余键保留。
 * @param {string} lang 语言代码，如 'zh-CN'
 * @param {Record<string, string>} dict 扁平键值词典
 * @returns {Record<string, string>} 合并后的该语言词典
 */
export function registerDict(lang, dict) {
  if (typeof lang !== 'string' || lang.length === 0) {
    throw new TypeError('[i18n] registerDict：语言代码必须为非空字符串');
  }
  if (dict === null || typeof dict !== 'object') {
    throw new TypeError('[i18n] registerDict：词典必须为对象');
  }
  const merged = { ...(dicts.get(lang) || {}), ...dict };
  dicts.set(lang, merged);
  return merged;
}

/**
 * 设置当前语言（仅内存态；持久化由调用方负责）。
 * @param {string} lang 语言代码
 * @returns {boolean} 是否生效（不支持的语言会告警并保持原语言）
 */
export function setLanguage(lang) {
  if (typeof lang !== 'string' || !SUPPORTED_LANGUAGES.includes(lang)) {
    console.warn(`[i18n] 不支持的语言：${String(lang)}，保持当前语言 ${currentLang}`);
    return false;
  }
  currentLang = lang;
  return true;
}

/** 当前语言代码 */
export function getLanguage() {
  return currentLang;
}

/** 支持的语言清单副本：['zh-CN', 'en-US'] */
export function getLanguages() {
  return SUPPORTED_LANGUAGES.slice();
}

/**
 * 查询词条：当前语言 → zh-CN 回退 → 键名本身（同一缺失键仅 console.warn 一次）。
 * @param {string} key 词条键，如 'ui.galaxy'
 * @param {Record<string, unknown>} [params] 插值参数：{name:'x'} 替换模板中的 "{name}"
 * @returns {string} 词条文本
 */
export function L(key, params) {
  const k = String(key);
  const template = lookup(currentLang, k) ?? lookup(FALLBACK_LANG, k);
  if (template === undefined) {
    if (!warnedKeys.has(k)) {
      warnedKeys.add(k);
      console.warn(`[i18n] 缺失词条：${k}`);
    }
    return k;
  }
  if (params === null || params === undefined) {
    return template;
  }
  // {name} 插值：参数缺失时保留原占位符，便于排查
  return template.replace(PARAM_PATTERN, (token, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
  );
}

/** 单语言查找：值仅接受字符串（数字等一律转为字符串），缺失返回 undefined */
function lookup(lang, key) {
  const dict = dicts.get(lang);
  if (dict === undefined) return undefined;
  const value = dict[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : String(value);
}
