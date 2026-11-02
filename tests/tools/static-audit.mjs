/**
 * tests/tools/static-audit.mjs — L0 静态检查（任务书 10.1）
 *
 * 扫描 src/ 与 index.html：
 *  - 禁止 Math.random / eval / new Function（模拟路径）
 *  - 禁止外部 URL（http/https 引用资源）
 *  - 禁止绝对路径资源引用（/assets 等）
 *  - 禁止 TODO/FIXME/占位实现
 * 输出机器可读 JSON（--json）或人类摘要；发现违规 exit 1。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
const SRC = join(ROOT, 'src');
const violations = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.js')) yield p;
  }
}

const RULES = [
  { re: /Math\.random\s*\(/, level: 'P0', msg: '模拟路径禁止 Math.random（任务书 1.5）' },
  { re: /\beval\s*\(/, level: 'P0', msg: '禁止 eval（任务书 8.3/11.6）' },
  { re: /new\s+Function\s*\(/, level: 'P0', msg: '禁止 new Function' },
  { re: /https?:\/\/(?!www\.w3\.org|127\.0\.0\.1|localhost)[^\s'"`]+/i, level: 'P0', msg: '外部 URL 引用（零外部依赖）' },
  { re: /['"]\/(assets|src|styles|js)\//, level: 'P0', msg: '绝对路径资源引用（须相对路径，任务书 1.4/8.7）' },
  { re: /\b(TODO|FIXME|XXX|HACK)\b/, level: 'P1', msg: '占位/待办标记残留' },
  { re: /localStorage\.setItem\(['"](?!vf-)/, level: 'P1', msg: 'localStorage 键应使用 vf- 前缀' },
];

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  // 剥离注释后扫描（文档性提及不算违规；代码实体才算）
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      if (rule.re.test(line)) {
        violations.push({ file: rel, line: i + 1, level: rule.level, msg: rule.msg, text: line.trim().slice(0, 90) });
      }
    });
  }
}

// index.html 无远程引用
try {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(src|href)=["'](https?:)?\/\//gi)) {
    violations.push({ file: 'index.html', line: 0, level: 'P0', msg: '远程资源引用', text: m[0] });
  }
} catch { /* index.html 缺失由部署验收捕捉 */ }

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ violations, total: violations.length }, null, 2));
} else if (violations.length === 0) {
  console.log('静态审计通过：无违规项');
} else {
  for (const v of violations) {
    console.log(`[${v.level}] ${v.file}:${v.line} — ${v.msg}\n    ${v.text}`);
  }
  console.log(`共 ${violations.length} 项违规`);
  process.exitCode = 1;
}
