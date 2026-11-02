/**
 * content/localization/index.js — 词典装配入口
 *
 * 以 ES 模块方式导入 zh-CN / en-US 两份词典并注册到 i18n 内核，
 * 随后将默认语言设为 zh-CN。重复调用幂等：
 * 词典合并本身无副作用，且不会覆盖调用方已切换的语言。
 */

import { registerDict, setLanguage, getLanguage } from '../../core/i18n.js';
import { DICT as DICT_ZH_CN } from './zh-CN.js';
import { DICT as DICT_EN_US } from './en-US.js';

/** 是否已完成首次装配 */
let registered = false;

/**
 * 注册全部语言词典并设置默认语言（zh-CN）。
 * @returns {string} 装配后的当前语言代码
 */
export function registerAll() {
  if (!registered) {
    registerDict('zh-CN', DICT_ZH_CN);
    registerDict('en-US', DICT_EN_US);
    setLanguage('zh-CN');
    registered = true;
  }
  return getLanguage();
}
