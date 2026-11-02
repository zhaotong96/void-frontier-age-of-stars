/**
 * tests/tools/update-golden.mjs — 金快照回归基线更新
 *
 * 固定种子 SCENARIO-STARTER-001 推进 N tick 的规范化哈希写入
 * tests/regression/golden.json。规则变更后有意更新：node tests/tools/update-golden.mjs
 * 回归套件（regression-golden.suite.js）对比当前哈希与基线。
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import '../../src/app/commands.js'; // 固定基线条件：命令已注册（AI 生效，与真实游戏一致）
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { worldHash } from '../../src/core/serialization.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'regression', 'golden.json');

export const GOLDEN_CONFIG = {
  seed: 24601,
  ticks: 4320, // 1 游戏年（不含玩家命令的纯世界演化基线）
};

export function computeGolden(config = GOLDEN_CONFIG) {
  const w = createStarterCampaign({ seed: config.seed });
  advanceTicks(w, config.ticks);
  return worldHash(w);
}

export function loadGolden() {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch (e) {
    if (process.env.GOLDEN_DEBUG) console.error('[golden] 读取失败:', e.message, 'OUT=', OUT);
    return null;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const hash = computeGolden();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ...GOLDEN_CONFIG, hash, updatedAt: new Date().toISOString() }, null, 2));
  console.log(`金快照已更新: ${hash}（seed ${GOLDEN_CONFIG.seed}, ${GOLDEN_CONFIG.ticks} ticks）`);
}
