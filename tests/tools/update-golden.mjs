/**
 * tests/tools/update-golden.mjs — 金快照回归基线更新
 *
 * 固定种子 SCENARIO-STARTER-001 推进 N tick 的规范化哈希写入
 * tests/regression/golden.json。规则变更后有意更新：node tests/tools/update-golden.mjs
 * 回归套件（regression-golden.suite.js）对比当前哈希与基线。
 *
 * [SPEC-39 Bug 1] 浏览器安全化：旧版头部静态 `import ... from 'node:fs'` 与顶层
 * `process.argv` 使 DiagnosticsView 动态 import 本模块（经 playtest-gates 套件）
 * 在纯浏览器抛 `Failed to resolve module specifier 'node:fs'`。现改为：
 *   - computeGolden 纯内核（本就无 fs，浏览器可用）；
 *   - loadGolden 改为同步读缓存，基线装载经 warmGolden()（Node 动态 import node:fs；
 *     浏览器 fetch(import.meta.url 相对 golden.json)），套件 run() 顶部 await warmGolden()；
 *   - CLI 入口（node tests/tools/update-golden.mjs）行为不变。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js'; // 固定基线条件：命令已注册（AI 生效，与真实游戏一致）
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { worldHash } from '../../src/core/serialization.js';

/** 运行时环境自省守卫（浏览器 process === undefined） */
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

export const GOLDEN_CONFIG = {
  seed: 24601,
  ticks: 4320, // 1 游戏年（不含玩家命令的纯世界演化基线）
};

export function computeGolden(config = GOLDEN_CONFIG) {
  const w = createStarterCampaign({ seed: config.seed });
  advanceTicks(w, config.ticks);
  return worldHash(w);
}

// —— 基线装载缓存（loadGolden 同步读此处；warmGolden 幂等预热） ————
let _goldenCache = null;
let _warmPromise = null;

/**
 * 预热金快照基线缓存（幂等；返回共享 Promise）。
 * Node：动态 import('node:fs') 读取 tests/regression/golden.json；
 * 浏览器：fetch 与本模块同源的 ../regression/golden.json（dev-server 静态可达；
 * file:// 等 fetch 失败时缓存 null，套件按「基线缺失」口径降级，不再抛模块解析错）。
 */
export function warmGolden() {
  if (_warmPromise) return _warmPromise;
  _warmPromise = (async () => {
    try {
      if (isNode) {
        const { readFileSync } = await import('node:fs');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const HERE = dirname(fileURLToPath(import.meta.url));
        _goldenCache = JSON.parse(readFileSync(join(HERE, '..', 'regression', 'golden.json'), 'utf8'));
      } else {
        const res = await fetch(new URL('../regression/golden.json', import.meta.url));
        _goldenCache = res.ok ? await res.json() : null;
      }
    } catch (e) {
      if (isNode && process.env && process.env.GOLDEN_DEBUG) {
        console.error('[golden] 基线装载失败:', e && e.message);
      }
      _goldenCache = null;
    }
  })();
  return _warmPromise;
}

/** 同步读基线缓存（须先 warmGolden()；未预热/不可达返回 null） */
export function loadGolden() {
  return _goldenCache;
}

const isMain = isNode && process.argv[1]
  && String(import.meta.url).endsWith('update-golden.mjs')
  && process.argv[1].replace(/\\/g, '/').endsWith('update-golden.mjs');
if (isMain) {
  (async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const HERE = dirname(fileURLToPath(import.meta.url));
    const OUT = join(HERE, '..', 'regression', 'golden.json');
    const hash = computeGolden();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ ...GOLDEN_CONFIG, hash, updatedAt: new Date().toISOString() }, null, 2));
    console.log(`金快照已更新: ${hash}（seed ${GOLDEN_CONFIG.seed}, ${GOLDEN_CONFIG.ticks} ticks）`);
  })();
}
