/**
 * tests/suites/theme-registry.suite.js — THEME-01: 18 主题注册表 / 主题分配 / 轨道视觉映射
 *
 * 覆盖（doc7 TASK-3.1，门禁 THEME-01/06/07 + 序列 6 §4 九维规范）：
 *  (a) 注册表完备性：18 主题 × 必填九维字段、sRGB 色板合法、paletteLinear 与
 *      srgbToLinear 重算一致、geomorphology ∈ TERRAIN_PROFILES、poiPool 与
 *      planetPOI.THEME_POI_POOLS 逐项一致、id 全域唯一、旗舰 7 + 扩展 11；
 *  (b) 分配确定性：同种子两世界 ≥200 颗行星 primaryThemeId 逐颗一致；
 *  (c) 约束合规：assigned theme.categoryConstraints 必含 planet.category，零违例；
 *  (d) 同星系去重（THEME-06）：存在 ≥2 兼容主题时同星系旗舰主主题零重复；
 *  (e) RNG 纯度（doc7 红线 4）：assignTheme 不触碰 world.rng；行星主题字段齐备；
 *  (f) THEME-07 身份恒定：异种子同主题 → 色板逐位相同、轨道参数在容差带内自然变化。
 *
 * 零 GL 依赖：System3D 仅以模块级 orbitalUniformsFor 被 import（纯函数）。
 */
import { createWorld } from '../../src/domain/world/World.js';
import { generateGalaxy } from '../../src/domain/world/galaxyGen.js';
import { PLANET_THEMES, assignTheme, themesForCategory, srgbToLinear, THEME_ASSIGNMENT_VERSION } from '../../src/content/planetThemes.js';
import { TERRAIN_PROFILES } from '../../src/content/terrainProfiles.js';
import { THEME_POI_POOLS } from '../../src/domain/ground/planetPOI.js';
import { orbitalUniformsFor } from '../../src/render/gl/System3D.js';
import { assert, assertEq } from './assert.js';

const SEED_A = 24601;
const SEED_B = 97531;
const CANON_CATS = ['rocky', 'ocean', 'ice', 'desert', 'gasGiant', 'lava', 'toxic', 'artificial'];
const EXPECTED_FLAGSHIP = 7;
const EXPECTED_EXPANSION = 11;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function genGalaxy(seed, systemCount = 64) {
  const world = createWorld({ seed, galaxySize: 'story' });
  generateGalaxy(world, { systemCount, factionConfigs: [{ name: 'A' }, { name: 'B' }] });
  return world;
}

/** (a) 注册表完备性与九维字段 */
function checkRegistry() {
  const ids = Object.keys(PLANET_THEMES);
  assertEq(ids.length, 18, `主题数应为 18，实测 ${ids.length}`);
  assertEq(new Set(ids).size, 18, '主题 id 必须全域唯一');

  let flagship = 0;
  let expansion = 0;
  for (const id of ids) {
    const t = PLANET_THEMES[id];
    const tag = `[${id}]`;

    // —— 身份字段 ——
    assertEq(t.id, id, `${tag} 条目 id 与键名不一致`);
    assertEq(t.version, 1, `${tag} version 应为 1`);
    assert(typeof t.labelZh === 'string' && t.labelZh.length > 0, `${tag} labelZh 缺失`);
    if (t.tier === 'flagship') flagship++;
    else if (t.tier === 'expansion') expansion++;
    else assert(false, `${tag} tier 非法: ${t.tier}`);

    // —— 类别约束（硬约束） ——
    assert(Array.isArray(t.categoryConstraints) && t.categoryConstraints.length > 0,
      `${tag} categoryConstraints 缺失`);
    for (const c of t.categoryConstraints) {
      assert(CANON_CATS.indexOf(c) >= 0, `${tag} 类别约束 ${c} 不在 8 大天体类别`);
    }

    // —— 色板：sRGB hex 合法 + paletteLinear 与 srgbToLinear 重算一致 ——
    for (const key of ['base', 'shadow', 'highlight', 'danger', 'emissive', 'atmosphere']) {
      const hex = t.palette[key];
      assert(HEX_RE.test(hex), `${tag} palette.${key} 非合法 sRGB hex: ${hex}`);
      const lin = t.paletteLinear[key];
      assert(Array.isArray(lin) && lin.length === 3, `${tag} paletteLinear.${key} 应为 [r,g,b]`);
      const expect = srgbToLinear(hex);
      for (let i = 0; i < 3; i++) {
        assert(Math.abs(lin[i] - expect[i]) < 1e-9,
          `${tag} paletteLinear.${key}[${i}] 与 srgbToLinear 重算不一致`);
        assert(lin[i] >= 0 && lin[i] <= 1, `${tag} paletteLinear.${key}[${i}] 越界`);
      }
    }

    // —— 地貌/材质/大气/天气/地标/玩法/建筑/音效/危险/经济（九维） ——
    assert(!!TERRAIN_PROFILES[t.geomorphology],
      `${tag} geomorphology ${t.geomorphology} 不在 TERRAIN_PROFILES`);
    assert(Array.isArray(t.materials) && t.materials.length >= 3, `${tag} materials 不足 3 项`);
    for (const key of ['atmosphereProfile', 'weatherProfile', 'gameplayProfile', 'buildingKit', 'audioProfile']) {
      assert(typeof t[key] === 'string' && t[key].length > 0, `${tag} ${key} 缺失`);
    }
    assert(Array.isArray(t.landmarkSet) && t.landmarkSet.length >= 2, `${tag} landmarkSet 不足 2 项`);
    assert(Array.isArray(t.poiPool) && t.poiPool.length >= 1, `${tag} poiPool 缺失`);
    assert(typeof t.hazardMechanism === 'string' && t.hazardMechanism.length >= 8,
      `${tag} hazardMechanism（危险与行动规则）缺失`);
    assert(typeof t.economyHook === 'string' && t.economyHook.length >= 6,
      `${tag} economyHook（资源与经济钩子）缺失`);

    // —— POI 池与 planetPOI.THEME_POI_POOLS 一致（POI 系统主题优先的前提） ——
    const poi = THEME_POI_POOLS[id];
    assert(Array.isArray(poi), `${tag} planetPOI.THEME_POI_POOLS 缺少该主题`);
    assertEq(t.poiPool, poi, `${tag} poiPool 与 THEME_POI_POOLS 不一致`);

    // —— 轨道视觉参数（doc7 THEME-01） ——
    const o = t.orbital;
    assert(!!o, `${tag} orbital 缺失`);
    assert(Array.isArray(o.bandColors) && o.bandColors.length >= 2 && o.bandColors.length <= 3,
      `${tag} orbital.bandColors 应为 2-3 色`);
    for (const hex of o.bandColors) assert(HEX_RE.test(hex), `${tag} bandColors 非法 hex: ${hex}`);
    assert(HEX_RE.test(o.cloudColor), `${tag} cloudColor 非法 hex`);
    for (const key of ['iceCap', 'cloudCover', 'nightLights', 'ringChance']) {
      assert(typeof o[key] === 'number' && o[key] >= 0 && o[key] <= 1,
        `${tag} orbital.${key} 应在 [0,1]: ${o[key]}`);
    }
    assert(HEX_RE.test(o.glow.tint), `${tag} glow.tint 非法 hex`);
    assert(o.glow.power >= 0 && o.glow.power <= 2, `${tag} glow.power 越界`);
    assert(o.glow.shellScale >= 1.0 && o.glow.shellScale <= 1.2,
      `${tag} glow.shellScale 应收敛于 1.0-1.2: ${o.glow.shellScale}`);
  }
  assertEq(flagship, EXPECTED_FLAGSHIP, `旗舰主题应 7 个，实测 ${flagship}`);
  assertEq(expansion, EXPECTED_EXPANSION, `扩展主题应 11 个，实测 ${expansion}`);

  // —— 每个天体类别至少 1 个兼容主题（类别覆盖完备 → 候选池永不空） ——
  for (const cat of CANON_CATS) {
    assert(themesForCategory(cat).length >= 1, `类别 ${cat} 无任何兼容主题`);
  }
}

export const suite = {
  id: 'THEME-01',
  name: '行星主题注册表与分配（THEME-01/06/07）',
  group: 'WORLD',
  async run() {
    try {
      // ———— (a) 注册表完备性 ————
      checkRegistry();

      // ———— (b)(c)(d) 双世界生成 + 确定性 / 约束合规 / 同星系去重 ————
      const wa = genGalaxy(SEED_A);
      const wb = genGalaxy(SEED_A);
      const pa = Object.keys(wa.entities.planets).sort();
      const pb = Object.keys(wb.entities.planets).sort();
      assertEq(pb.length, pa.length, '同种子两世界行星数不一致');
      assert(pa.length >= 200, `行星样本应 ≥200，实测 ${pa.length}`);

      let constraintViolations = 0;
      const dedupViolations = [];
      let flagshipPrimaries = 0;
      const themeTally = {};

      for (const pid of pa) {
        const a = wa.entities.planets[pid];
        const b = wb.entities.planets[pid];
        // (b) 分配确定性：逐颗一致
        assertEq(a.primaryThemeId, b.primaryThemeId, `行星 ${pid} 两次生成 primaryThemeId 不一致`);
        assertEq(a.secondaryThemeModifiers, b.secondaryThemeModifiers,
          `行星 ${pid} 两次生成 secondaryThemeModifiers 不一致`);

        // (e) 主题字段齐备 + 版本号 + 修饰器数量域
        assert(typeof a.primaryThemeId === 'string' && !!PLANET_THEMES[a.primaryThemeId],
          `行星 ${pid} primaryThemeId 非法: ${a.primaryThemeId}`);
        assert(Array.isArray(a.secondaryThemeModifiers) && a.secondaryThemeModifiers.length <= 2,
          `行星 ${pid} secondaryThemeModifiers 应为 0-2 个`);
        assertEq(a.themeAssignmentVersion, THEME_ASSIGNMENT_VERSION, `行星 ${pid} 主题版本缺失`);

        // (c) 类别约束合规（零违例）
        const theme = PLANET_THEMES[a.primaryThemeId];
        if (theme.categoryConstraints.indexOf(a.category) < 0) constraintViolations++;
        themeTally[a.primaryThemeId] = (themeTally[a.primaryThemeId] || 0) + 1;
        if (theme.tier === 'flagship') flagshipPrimaries++;

        // (e) POI 仍随主题/类别池生成（doc5 §3.7 契约不回退）
        assert(a.pois && Object.keys(a.pois).length >= 1, `行星 ${pid} POI 未生成`);
      }
      assertEq(constraintViolations, 0, `类别约束违例 ${constraintViolations} 起`);

      // (d) 同星系旗舰去重：旗舰重复仅当该行星 compatible 主题数 < 2（无替代候选）
      for (const sid of Object.keys(wa.entities.systems)) {
        const sys = wa.entities.systems[sid];
        const seen = {};
        for (const pid of sys.planetIds) {
          const p = wa.entities.planets[pid];
          const t = PLANET_THEMES[p.primaryThemeId];
          if (t.tier !== 'flagship') continue;
          seen[t.id] = (seen[t.id] || 0) + 1;
        }
        for (const tid of Object.keys(seen)) {
          if (seen[tid] < 2) continue;
          for (const pid of sys.planetIds) {
            const p = wa.entities.planets[pid];
            if (p.primaryThemeId !== tid) continue;
            if (themesForCategory(p.category).length >= 2) {
              dedupViolations.push(`${sid}/${pid} 重复旗舰 ${tid}`);
            }
          }
        }
      }
      assertEq(dedupViolations.length, 0,
        `同星系旗舰去重违例: ${dedupViolations.slice(0, 5).join('; ')}`);
      assert(flagshipPrimaries >= 50, `旗舰主题出现频次过低（${flagshipPrimaries}），抽选权重异常`);

      // ———— (e) RNG 纯度：assignTheme 只走 themeSeed 子流，不触碰 world.rng ————
      const purity = createWorld({ seed: SEED_A, galaxySize: 'story' });
      const rngBefore = JSON.stringify(purity.rng);
      for (let i = 0; i < 64; i++) {
        const fake = { id: `planet_${i + 1}`, category: CANON_CATS[i % CANON_CATS.length], water: 40, habitability: 50 };
        const pick = assignTheme(purity, fake, { danger: 3 }, new Set());
        assert(!!PLANET_THEMES[pick.primaryThemeId], 'assignTheme 返回未知主题');
      }
      assertEq(JSON.stringify(purity.rng), rngBefore, 'assignTheme 消费了主 world.rng（红线 4 违例）');

      // ———— (f) THEME-07 身份恒定：异种子同主题 → 色板相同 / 轨道参数容差内变化 ————
      const wb2 = genGalaxy(SEED_B);
      const firstByThemeA = {};
      for (const pid of pa) {
        const t = wa.entities.planets[pid].primaryThemeId;
        if (!firstByThemeA[t]) firstByThemeA[t] = pid;
      }
      let theme07Checked = 0;
      for (const pid of Object.keys(wb2.entities.planets)) {
        const pB = wb2.entities.planets[pid];
        const t = pB.primaryThemeId;
        if (!firstByThemeA[t] || theme07Checked >= 6) continue;
        const pA = wa.entities.planets[firstByThemeA[t]];
        const ouA = orbitalUniformsFor(pA);
        const ouB = orbitalUniformsFor(pB);
        // 色板逐位相同（身份恒定）
        assertEq(ouA.bandA, ouB.bandA, `[${t}] 异种子 bandA 漂移`);
        assertEq(ouA.bandB, ouB.bandB, `[${t}] 异种子 bandB 漂移`);
        assertEq(ouA.emitTint, ouB.emitTint, `[${t}] 异种子 emissive 漂移`);
        // 轨道参数容差带（自然变化 ±16% 内）
        for (const key of ['clouds', 'nightLights', 'iceCap']) {
          assert(Math.abs(ouA[key] - ouB[key]) <= 0.2,
            `[${t}] 异种子 orbital.${key} 差 ${Math.abs(ouA[key] - ouB[key])} 超容差 0.2`);
        }
        theme07Checked++;
      }
      assert(theme07Checked >= 1, '双种子间未找到同主题行星对（THEME-07 无法验证）');

      // ———— 类别回退：themeless/旧档 → 覆写层关闭、气巨环保留 ————
      const plain = orbitalUniformsFor({ id: 'planet_x', category: 'rocky' });
      assertEq(plain.on, 0, 'themeless 行星应回退类别外观（on=0）');
      assertEq(plain.ringOn, false, 'themeless 岩质行星不应有环');
      const gas = orbitalUniformsFor({ id: 'planet_g', category: 'gasGiant' });
      assertEq(gas.ringOn, true, 'themeless 气巨应保留默认冰晶环');
      const themed = orbitalUniformsFor({ id: 'planet_x', category: 'lava', primaryThemeId: 'obsidian_lava' });
      assertEq(themed.on, 1, '主题行星应开启覆写层');
      assertEq(themed.themeId, 'obsidian_lava', '主题行星 themeId 不符');

      return { ok: true, detail: `18 主题 × ${pa.length} 行星样本 × ${theme07Checked} THEME-07 对 全部通过` };
    } catch (e) {
      return { ok: false, detail: String((e && e.message) || e) };
    }
  },
};
