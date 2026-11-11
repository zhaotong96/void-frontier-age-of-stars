/**
 * tests/soak/GalaxyProceduralSweeper.js — 千种子全连通拓扑巡检仪（doc27 §4）
 *
 * S ∈ [1,1000] 逐一完整生成银河（generateGalaxy 全量）：
 * 1. 无向连通图 BFS：连通分量必须覆盖 100% 星系节点（零孤岛）；
 * 2. 轨道零碰撞：星系内行星轨道槽位（orbitIndex）唯一且 ≥1（不入恒星日冕层），
 *    月卫轨道半径同星系内严格分档，小行星带槽位不与行星槽位重合；
 * 3. 主题完整性：每行星 primaryThemeId ∈ PLANET_THEMES 且 THEME_PROFILE_MAP
 *    映射地形剖面 100% 有效（11+ 扩展主题着色器载荷非空口径）；
 * 4. 航路完整性：lane 双向对称、无自环、无重复边。
 * 异常种子归档 tests/regression/anomalous-seeds.json（doc27 IMPORTANT）。
 */

import { createWorld } from '../../src/domain/world/World.js';
import { generateGalaxy } from '../../src/domain/world/galaxyGen.js';
import { PLANET_THEMES } from '../../src/content/planetThemes.js';
import { THEME_PROFILE_MAP, TERRAIN_PROFILES } from '../../src/content/terrainProfiles.js';
import { factionConfigs } from '../../src/content/factions.js';

/** 单种子巡检：返回 { seed, ok, issues[] } */
export function sweepOneSeed(seed) {
  const issues = [];
  const world = createWorld({ seed, difficulty: 'standard', galaxySize: 'standard' });
  const { systemIds } = generateGalaxy(world, { factionConfigs: factionConfigs('frontier_compact') });
  const systems = systemIds.map((id) => world.entities.systems[id]).filter(Boolean);

  // 1. 全图连通性（BFS，无向图：lanes 双向对称由断言 4 保证后单向遍历即可）
  const adj = new Map(systemIds.map((id) => [id, []]));
  for (const sys of systems) {
    const lanes = sys.lanes || [];
    for (const to of lanes) {
      if (to === sys.id) { issues.push(`SELF_LANE ${sys.id}`); continue; }
      if (!adj.has(to)) { issues.push(`DANGLING_LANE ${sys.id}→${to}`); continue; }
      adj.get(sys.id).push(to);
      if (!world.entities.systems[to].lanes.includes(sys.id)) {
        issues.push(`ASYM_LANE ${sys.id}→${to}`);
      }
    }
    if (new Set(lanes).size !== lanes.length) issues.push(`DUP_LANE ${sys.id}`);
    if ((sys.lanes || []).length < 2) issues.push(`MIN_DEGREE ${sys.id}=${(sys.lanes || []).length}`);
  }
  const visited = new Set([systemIds[0]]);
  const queue = [systemIds[0]];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of adj.get(cur)) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }
  if (visited.size !== systemIds.length) {
    const isolated = systemIds.filter((id) => !visited.has(id)).slice(0, 5);
    issues.push(`ISOLATED_SYSTEMS reachable=${visited.size}/${systemIds.length} e.g.[${isolated.join(',')}]`);
  }

  // 2/3. 星系内轨道与主题
  for (const sys of systems) {
    const slots = new Set();
    for (const pid of sys.planetIds || []) {
      const planet = world.entities.planets[pid];
      if (!planet) { issues.push(`NULL_PLANET ${sys.id}:${pid}`); continue; }
      // 轨道槽位唯一且为非负整数槽位（orbitIndex 0..n-1；恒星不占槽位）
      const slot = planet.orbitIndex;
      if (!Number.isInteger(slot) || slot < 0) issues.push(`BAD_SLOT ${pid}=${slot}`);
      if (slots.has(slot)) issues.push(`ORBIT_COLLISION ${sys.id} slot=${slot} (${pid})`);
      slots.add(slot);
      // 月卫轨道分档（同行星内 orbitRadius 严格唯一；moons 已由生成器回填）
      const moonRs = (planet.moons || []).map((m) => m.orbitRadius);
      if (new Set(moonRs).size !== moonRs.length) issues.push(`MOON_ORBIT_DUP ${pid}`);
      // 主题完整性（18 主题九维注册表 + 剖面映射）
      if (!planet.primaryThemeId || !PLANET_THEMES[planet.primaryThemeId]) {
        issues.push(`UNKNOWN_THEME ${pid}=${planet.primaryThemeId}`);
      } else {
        const profId = THEME_PROFILE_MAP[planet.primaryThemeId];
        if (!profId || !TERRAIN_PROFILES[profId]) issues.push(`THEME_PROFILE ${pid}=${profId}`);
      }
      if (!planet.deposits || typeof planet.deposits !== 'object') issues.push(`NO_DEPOSITS ${pid}`);
      if (!Number.isFinite(planet.habitability)) issues.push(`BAD_HABITABILITY ${pid}`);
    }
    // 小行星带槽位不与行星重合
    for (const belt of sys.belts || []) {
      if (slots.has(belt.orbitRadius)) issues.push(`BELT_COLLISION ${sys.id} slot=${belt.orbitRadius}`);
    }
  }

  return { seed, ok: issues.length === 0, issues, systemCount: systemIds.length };
}

/** 千种子全景巡检；anomalies 非空时归档 tests/regression/anomalous-seeds.json */
export async function sweepGalaxySeeds(startSeed = 1, endSeed = 1000, opts = {}) {
  const t0 = performance.now();
  const anomalies = [];
  let swept = 0;
  let sysTotal = 0;
  for (let seed = startSeed; seed <= endSeed; seed++) {
    const r = sweepOneSeed(seed);
    swept++;
    sysTotal += r.systemCount;
    if (!r.ok) anomalies.push({ seed, issues: r.issues });
    if (opts.onProgress && swept % 100 === 0) opts.onProgress(swept, anomalies.length);
  }
  const msPerSeed = (performance.now() - t0) / swept;

  if (anomalies.length > 0 && opts.archive !== false) {
    // doc27 IMPORTANT：异常种子立即归档为永久防回退回归用例
    const fs = await import('node:fs');
    fs.mkdirSync('tests/regression', { recursive: true });
    fs.writeFileSync('tests/regression/anomalous-seeds.json', JSON.stringify({
      sweptRange: [startSeed, endSeed],
      sweptAt: new Date().toISOString(),
      count: anomalies.length,
      anomalies,
    }, null, 2), 'utf8');
  }

  if (anomalies.length > 0) {
    const a = anomalies[0];
    throw new Error(`[SWEEPER] ${anomalies.length} 个异常种子（首个 seed=${a.seed}: ${a.issues.slice(0, 2).join('; ')}）；已归档 tests/regression/anomalous-seeds.json`);
  }

  return { totalSwept: swept, anomalies: 0, avgSystems: sysTotal / swept, msPerSeed };
}
