/**
 * tests/tools/build-static-bundle.mjs — 零依赖静态单文件打包器（返工 R1）
 *
 * 仅用 Node 内置 node:fs / node:path。从 src/main.js 出发递归解析静态
 * import 语句，按依赖拓扑序把全部模块封装进单一 IIFE 闭包（内置极简
 * CommonJS 风格 __register/__require 注册表），生成 ./dist/void-frontier.bundle.js，
 * 使应用在 file:// 协议下双击即玩（消除 ES Modules CORS 拦截）。
 *
 * 支持的模块语法（本仓库 src/ 全集，见语法盘点）：
 *   import { a, b as c } from './x.js'  |  import * as N from './x.js'
 *   import Def, { a } from './x.js'     |  import './x.js'
 *   export const/let/var/function/class/async function NAME ...
 *   export { a, b as c }                |  export { a } from './x.js'
 *   export default <expr>
 * 语义说明：命名导出在模块体末尾统一挂载（模块体先完整求值再返回，
 * 函数声明提升，const 在模块体执行期已初始化——等价于本仓库无环依赖图
 * 下的 ESM 语义）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // 仓库根（tests/tools → 上两级）
const ENTRY = 'src/main.js';
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, 'void-frontier.bundle.js');

/** 解析相对 import 说明符 → 规范化模块 id（'src/...' posix 风格） */
function resolveSpecifier(fromId, spec) {
  if (!spec.startsWith('.')) return null; // 仅支持仓库内相对导入（外部/裸说明符报错）
  const baseDir = dirname(fromId);
  const abs = normalize(join(ROOT, baseDir, spec));
  const rel = abs.slice(ROOT.length + 1).split(sep).join('/');
  if (!existsSync(join(ROOT, rel))) {
    throw new Error(`无法解析导入 ${spec}（来自 ${fromId} → ${rel}）`);
  }
  return rel;
}

/** 依赖图收集：返回 Map<id, source>（拓扑无关，require 按需求值） */
function collectModules(entryId) {
  const modules = new Map();
  const queue = [entryId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (modules.has(id)) continue;
    const abs = join(ROOT, id);
    const raw = readFileSync(abs, 'utf8');
    const source = normalizeMultiLineImports(raw);
    modules.set(id, source);
    for (const spec of scanSpecifiers(source)) {
      const dep = resolveSpecifier(id, spec);
      if (dep && !modules.has(dep)) queue.push(dep);
      else if (!dep) throw new Error(`${id} 引用了仓库外说明符 ${spec}（打包器不支持）`);
    }
  }
  return modules;
}

/**
 * 归一化多行 import/export 语句：将跨行的 import { ... } from '...'
 * 压缩为单行，使后续单行正则能正确匹配。
 */
function normalizeMultiLineImports(source) {
  const lines = source.split('\n');
  const out = [];
  let joining = false;
  let joined = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!joining) {
      // 仅当 import/export 语句开头且不含 from/from 导入路径时才进入连接模式。
      // export const/let/var/function/class/default 声明不参与连接（防止
      // 多行对象字面量被误吞 —— 如 localization 词典 export const DICT = {...}）
      const isImportStart = /^import\s+\{/.test(trimmed) && !/from\s*['"]/.test(trimmed);
      const isExportFrom = /^export\s+\{/.test(trimmed) && !/from\s*['"]/.test(trimmed) && !/;\s*$/.test(trimmed);
      const isImportBare = /^import\s+[A-Za-z$*]/.test(trimmed) && !/from\s*['"]/.test(trimmed) && !/['"]\s*;?\s*$/.test(trimmed);
      if (isImportStart || isExportFrom || isImportBare) {
        joining = true;
        joined = line;
      } else {
        out.push(line);
      }
    } else {
      joined += ' ' + trimmed;
      // 连接终止：出现 from '...' 或行尾以引号+分号结束
      if (/from\s*['"]/.test(trimmed) || /['"]\s*;?\s*$/.test(trimmed)) {
        joining = false;
        out.push(joined);
      }
    }
  }
  if (joining) out.push(joined);
  return out.join('\n');
}

/** 扫描静态 import 说明符（含 export...from 重导出；单行锚定，防止跨行吞噬） */
function scanSpecifiers(source) {
  const specs = [];
  const fromRe = /^[ \t]*(?:import|export)\s+[^\n]*?from\s*['"]([^'"]+)['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;
  const bareRe = /^[ \t]*import\s*['"]([^'"]+)['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;
  let m;
  while ((m = fromRe.exec(source)) !== null) specs.push(m[1]);
  while ((m = bareRe.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

/** 转换单个模块体：剥离 import/export，改写为 __exports/__require 形态 */
export function transformModule(id, source) {
  const deps = new Map(); // spec → module id
  const out = [];

  // 1. 逐个处理 import 语句（单行风格；正则覆盖 from 前的任意子句）
  const importRe = /^[ \t]*import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;
  const bareImportRe = /^[ \t]*import\s*['"]([^'"]+)['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;
  let body = source.replace(bareImportRe, (whole, spec) => {
    const dep = resolveSpecifier(id, spec);
    deps.set(spec, dep);
    return `__require(${JSON.stringify(dep)});`;
  });
  body = body.replace(importRe, (whole, clause, spec) => {
    const dep = resolveSpecifier(id, spec);
    deps.set(spec, dep);
    return transformImportClause(clause.trim(), dep);
  });

  // 2. export { ... } from './x.js'（重导出）
  body = body.replace(/^[ \t]*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*(?:\/\/[^\n]*)?$/gm, (whole, names, spec) => {
    const dep = resolveSpecifier(id, spec);
    const mapped = names.split(',').map((n) => n.trim()).filter(Boolean)
      .map((n) => {
        const [orig, alias] = n.split(/\s+as\s+/);
        return `${alias || orig}: __m.${orig}`;
      }).join(', ');
    return `Object.assign(__exports, (function(){ const __m = __require(${JSON.stringify(dep)}); return { ${mapped} }; })());`;
  });

  // 3. export default <expr>; → __exports.default = <expr>;
  body = body.replace(/^[ \t]*export\s+default\s+/gm, '__exports.default = ');

  // 4. export { a, b as c };（本地重导出）→ Object.assign(__exports, { a, c: b });
  //    SPEC-PLAN-057 Task 57.4 配套修复：键必须是「导出名」，值必须是「局部名」。
  //    旧实现写反为 { b: c }，使 `export { leaderTickEntry as stepParagonLeaderTick }`
  //    生成对未定义标识符的引用，生产 Bundle 首次执行即抛 ReferenceError，
  //    App 无法挂载（ESM 源码路径不受影响，故仅在 Bundle 默认加载后暴露）。
  body = body.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (whole, names) => {
    const mapped = names.split(',').map((n) => n.trim()).filter(Boolean)
      .map((n) => {
        const [orig, alias] = n.split(/\s+as\s+/);
        return `${alias || orig}: ${orig}`;
      }).join(', ');
    return `Object.assign(__exports, { ${mapped} });`;
  });

  // 5. export const/let/var/function/class/async function 声明 → 剥离 export，登记名称
  const declared = [];
  body = body.replace(/^[ \t]*export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (whole, kind, name) => {
      declared.push(name);
      return `${kind} ${name}`;
    });

  // 6. 模块体末尾统一挂载命名导出
  if (declared.length > 0) {
    body += `\nObject.assign(__exports, { ${declared.join(', ')} });\n`;
  }

  // 7. 残留 export 关键字检查（防止未覆盖形态静默出错）
  const leftover = body.match(/^\s*export\b/m);
  if (leftover) {
    throw new Error(`${id} 存在打包器未覆盖的 export 形态，请检查：${body.slice(leftover.index, leftover.index + 80)}`);
  }

  out.push(body);
  return { body: out.join(''), deps: [...deps.values()] };
}

/** import 子句 → require 解构 */
function transformImportClause(clause, dep) {
  const req = `__require(${JSON.stringify(dep)})`;
  // import * as N
  const star = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (star) return `const ${star[1]} = ${req};`;
  // import Def, { a, b as c }
  const mixed = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}$/);
  if (mixed) {
    return `const ${mixed[1]} = ${req};` + namedDestructure(mixed[2], req, true);
  }
  // import { a, b as c }
  if (clause.startsWith('{')) return namedDestructure(clause.slice(1, -1), req, false);
  // import Def（罕见；默认导出）
  if (/^[A-Za-z_$][\w$]*$/.test(clause)) return `const ${clause} = ${req}.default;`;
  throw new Error(`无法解析 import 子句：${clause}`);
}

function namedDestructure(inner, req, skipDefault) {
  const names = inner.split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/);
      return `${orig}: ${alias || orig}`;
    }).join(', ');
  const prefix = skipDefault ? '' : '';
  return `${prefix}const { ${names} } = ${req};`;
}


/**
 * SPEC-ACC-062 Task 62.3 (FINDING-M5-05)：零依赖 JS 词法级压缩器
 * 剥离注释与多余空白/缩进，保留字符串、模板字面量（含 ${...} 嵌套）及正则字面量语义，
 * 并保留必要换行以维持 ASI 安全，确保 dist/void-frontier.bundle.js < 2.0 MiB。
 */
export function compactJS(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  let prevNonWs = '';
  let lastWord = '';
  const regexPrevKeywords = new Set([
    'return', 'throw', 'case', 'delete', 'void', 'typeof', 'in', 'instanceof', 'new', 'else', 'do', 'yield', 'await'
  ]);
  const regexPrevChars = new Set(['', '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '~', '+', '-', '*', '%', '<', '>', '^', '\n']);

  function isIdentChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '$';
  }
  function canStartRegex() {
    if (regexPrevChars.has(prevNonWs)) return true;
    if (lastWord && regexPrevKeywords.has(lastWord)) return true;
    return false;
  }
  function pushTokenChar(ch) {
    out.push(ch);
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      prevNonWs = ch;
    }
  }

  let pendingSpace = false;
  let pendingNewline = false;

  function flushWhitespace(nextCh) {
    if (pendingNewline) {
      if (out.length > 0 && out[out.length - 1] !== '\n') {
        out.push('\n');
        prevNonWs = '\n';
      }
      pendingNewline = false;
      pendingSpace = false;
      return;
    }
    if (pendingSpace) {
      const prev = out.length > 0 ? out[out.length - 1] : '';
      if (prev && prev !== '\n' && isIdentChar(prev) && isIdentChar(nextCh)) {
        out.push(' ');
      } else if (prev && prev !== '\n' && ((prev === '+' && nextCh === '+') || (prev === '-' && nextCh === '-'))) {
        out.push(' ');
      }
      pendingSpace = false;
    }
  }

  while (i < n) {
    const ch = code[i];
    const next = i + 1 < n ? code[i + 1] : '';

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pendingSpace = true;
      i++;
      continue;
    }
    if (ch === '\n') {
      pendingNewline = true;
      lastWord = '';
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const isKeep = i + 2 < n && code[i + 2] === '!';
      if (isKeep) {
        flushWhitespace('/');
        const start = i;
        i += 2;
        while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
        if (i < n) i += 2;
        out.push(code.slice(start, i));
        out.push('\n');
        prevNonWs = '\n';
      } else {
        i += 2;
        while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
          if (code[i] === '\n') pendingNewline = true;
          i++;
        }
        if (i < n) i += 2;
        pendingSpace = true;
      }
      continue;
    }

    // String literals
    if (ch === "'" || ch === '"') {
      flushWhitespace(ch);
      const quote = ch;
      out.push(ch);
      i++;
      while (i < n) {
        const c = code[i];
        out.push(c);
        i++;
        if (c === '\\' && i < n) {
          out.push(code[i]);
          i++;
        } else if (c === quote) {
          break;
        }
      }
      prevNonWs = quote;
      lastWord = '';
      continue;
    }

    // Template literal
    if (ch === '`') {
      flushWhitespace('`');
      out.push('`');
      i++;
      let tplDepth = 0;
      const braceStack = [];
      while (i < n) {
        const c = code[i];
        if (c === '\\' && i + 1 < n) {
          out.push(c, code[i + 1]);
          i += 2;
          continue;
        }
        if (tplDepth === 0) {
          if (c === '`') {
            out.push('`');
            i++;
            break;
          }
          if (c === '$' && i + 1 < n && code[i + 1] === '{') {
            out.push('${');
            i += 2;
            tplDepth = 1;
            braceStack.push(1);
            continue;
          }
          out.push(c);
          i++;
        } else {
          if (c === "'" || c === '"' || c === '`') {
            const q = c;
            out.push(c);
            i++;
            if (q === '`') {
              // nested template inside ${...}
              let d = 0;
              while (i < n) {
                const nc = code[i];
                if (nc === '\\' && i + 1 < n) { out.push(nc, code[i + 1]); i += 2; continue; }
                out.push(nc);
                i++;
                if (nc === '$' && code[i] === '{') { d++; out.push('{'); i++; }
                else if (d > 0 && nc === '}') { d--; }
                else if (d === 0 && nc === '`') break;
              }
            } else {
              while (i < n) {
                const nc = code[i];
                out.push(nc);
                i++;
                if (nc === '\\' && i < n) { out.push(code[i]); i++; }
                else if (nc === q) break;
              }
            }
            continue;
          }
          if (c === '{') {
            braceStack[braceStack.length - 1]++;
          } else if (c === '}') {
            braceStack[braceStack.length - 1]--;
            if (braceStack[braceStack.length - 1] === 0) {
              braceStack.pop();
              tplDepth = braceStack.length;
            }
          }
          out.push(c);
          i++;
        }
      }
      prevNonWs = '`';
      lastWord = '';
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex()) {
      flushWhitespace('/');
      out.push('/');
      i++;
      let inClass = false;
      while (i < n) {
        const c = code[i];
        out.push(c);
        i++;
        if (c === '\\' && i < n) {
          out.push(code[i]);
          i++;
        } else if (c === '[') {
          inClass = true;
        } else if (c === ']') {
          inClass = false;
        } else if (c === '/' && !inClass) {
          break;
        } else if (c === '\n') {
          break;
        }
      }
      while (i < n && /[a-z]/i.test(code[i])) {
        out.push(code[i]);
        i++;
      }
      prevNonWs = '/';
      lastWord = '';
      continue;
    }

    // Identifiers / numbers
    if (isIdentChar(ch)) {
      flushWhitespace(ch);
      const start = i;
      while (i < n && isIdentChar(code[i])) {
        out.push(code[i]);
        i++;
      }
      const word = code.slice(start, i);
      prevNonWs = word[word.length - 1];
      lastWord = word;
      continue;
    }

    // Punctuation / operators
    flushWhitespace(ch);
    pushTokenChar(ch);
    lastWord = '';
    i++;
  }
  return out.join('');
}

/** 主流程 */
export function buildBundle({ log = console.log } = {}) {
  const modules = collectModules(ENTRY);
  const chunks = [
    '/*! VOID FRONTIER: AGE OF STARS — self-contained static bundle. Generated by tests/tools/build-static-bundle.mjs. Do not edit. */',
    '(function () {',
    "  'use strict';",
    '  const __modules = Object.create(null);',
    '  const __cache = Object.create(null);',
    '  function __register(id, factory) { __modules[id] = factory; }',
    '  function __require(id) {',
    '    let exp = __cache[id];',
    '    if (exp) return exp;',
    '    const factory = __modules[id];',
    '    if (!factory) throw new Error("bundle: missing module " + id);',
    '    exp = { };',
    '    __cache[id] = exp;',
    '    factory(exp, __require);',
    '    return exp;',
    '  }',
  ];
  for (const [id, source] of modules) {
    const { body } = transformModule(id, source);
    chunks.push(`__register(${JSON.stringify(id)}, function (__exports, __require) {\n${body}\n});`);
  }
  chunks.push(`  __require(${JSON.stringify(ENTRY)});`);
  chunks.push('})();');

  const compacted = compactJS(chunks.join('\n')).replace(/\r\n/g, '\n');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, compacted, 'utf8');
  const kb = Math.round(compacted.length / 1024);
  log(`打包完成：${OUT_FILE}（${modules.size} 个模块，${kb} KB / ${(compacted.length / 1048576).toFixed(2)} MiB）`);
  return { moduleCount: modules.size, bytes: compacted.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
// SPEC-PLAN-057 CHK-57-05 / SPEC-PLAN-060 Task 60.3：显式接受 --rebuild / -r 强制重打包。
// 构建本身恒为全量重打包（无增量缓存），参数仅用于门禁命令的可读性与意图声明。
if (isMain) {
  buildBundle();
}
