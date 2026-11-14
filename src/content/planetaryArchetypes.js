/**
 * content/planetaryArchetypes.js — 16 大行星天体物理原型冻结配置表
 * （SPEC-PLAN-045 阶段二 M2 Task 2.3；责任人：Eng-A / Eng-D 协同）
 *
 * 职责（doc45 §Task 2.3 逐行照录）：
 *  1. PLANETARY_ARCHETYPES：16 项原型配置（id 0..15 / code / nameZh / themeKeys /
 *     physics / hooks），逐行与 doc45 §Task 2.3「16 大天体原型完整规格与机制绑定表」
 *     一致；hooks 承载专属动态玩法法则的数值契约（M2 集成层与
 *     domain/planets/archetypeMechanics.js 消费）；
 *  2. themeKeys = [主, 副]，映射到 src/content/planetThemes.js PLANET_THEMES（:53-579）
 *     的 18 个真实主题键；doc45 原表视觉主题名（lava/basalt/dune/canyon/relic/metallic/
 *     twilight/eyeball/crystal/prism/ice/glacier/barren/obsidian/toxic/acid/ringworld/
 *     artificial/moon/crater/gas_giant/storm/metallic/core/gaia/continental）在 18 主题
 *     键中无同名键，按下表最近语义映射（映射裁决逐行记入 ARCHETYPE_THEME_MAPPING_NOTES）；
 *  3. ARCHETYPE_COUNT = 16 与 getArchetype(id)：越界/非整数抛 Error('SO:…')
 *     （compact.archetypeId 位段 & 0x0f 恒在 0..15，越界即结构损坏，fail fast）；
 *  4. import 期表完整性自检：themeKeys 每键必须存在于 PLANET_THEMES、id 必须严格
 *     0..15 连续、code 必须唯一 —— 违规当场抛错（内容表自检，零世界状态触碰）。
 *
 * 纪律（doc43 §1.4）：本模块为纯静态配置表 —— import 期仅构建冻结常量与自检，
 * 不注册任何 TickPipeline 阶段、不挂载任何容器、不消费任何随机流。
 */

import { PLANET_THEMES } from './planetThemes.js';

/* ============================== 16 原型配置表（doc45 Task 2.3 逐行照录） ============================== */

/**
 * 16 大天体原型配置（冻结；行序 = archetypeId 0..15）。
 *  - code/nameZh：doc45 §Task 2.3 表逐字；
 *  - themeKeys：[主, 副] → PLANET_THEMES 真实键（映射裁决见 ARCHETYPE_THEME_MAPPING_NOTES）；
 *  - physics：doc45「核心天体物理奇观与地表网格拓扑」列逐字浓缩；
 *  - hooks：doc45「专属动态玩法法则与耦合触发器」列数值化（M2 模拟钩子消费契约）。
 */
export const PLANETARY_ARCHETYPES = Object.freeze([
  {
    id: 0,
    code: 'SHATTERED_VOLCANIC_MOON',
    nameZh: '碎空火山伴星界',
    themeKeys: ['obsidian_lava', 'fractured_moon'],
    physics: '地表由 40% 联通熔岩裂谷切碎；地壳极薄，地热与重金属丰度 ×2.0',
    hooks: Object.freeze({
      tidalVolcanoPeriodDays: 90, // 每 90 天爆发一次全球潮汐火山期
      tidalVolcanoEnv0Spike: 20, // 火山期 envVector[0]（TectonicStress）激增 +20
      geothermalBonus: 1.0, // 火山期地热发电产出 +100%
    }),
  },
  {
    id: 1,
    code: 'HOURGLASS_TIDAL_TWINS',
    nameZh: '沙漏潮汐双星',
    themeKeys: ['red_regolith_frontier', 'salt_mirror_desert'],
    physics: '与伴星通过引力拉格朗日桥相连，大气与石英沙海呈周期性跨星抽吸',
    hooks: Object.freeze({
      backflowPeriodDays: 240, // 每 240 天一次双星物质倒灌相位（M2 口径：相位逐周期翻转）
      mineUpkeepPenalty: 0.35, // 掩埋相位：矿井维护费 +35%
      relicSpeedBonus: 0.6, // 裸露相位：先驱者遗迹（S1 考古）速度 +60%
    }),
  },
  {
    id: 2,
    code: 'QUANTUM_PHASE_WORLD',
    nameZh: '量子游离天体',
    themeKeys: ['magnetar_aurora', 'prism_crystal'],
    physics: '宏观量子退相干星球，地表 35% 区域处于概率云叠加态',
    hooks: Object.freeze({
      phaseShiftPeriodDays: 60, // 未锁定时每 60 天随机相移重组未锁定区划
      lockedPhysicsBonus: 1.2, // 量子观测场锁定后物理科研产出 +120%
    }),
  },
  {
    id: 3,
    code: 'RELIC_MAUSOLEUM_WORLD',
    nameZh: '先驱者机械墓园',
    themeKeys: ['ancient_megastructure', 'fractured_moon'],
    physics: '全星覆盖多层锈蚀先驱者城市装甲甲板与休眠纳米井',
    hooks: Object.freeze({
      initialArchaeologyLandmarks: 3, // 初始自带 3 处高阶考古地标
    }),
  },
  {
    id: 4,
    code: 'MYCELIAL_HIVE_WORLD',
    nameZh: '共生孢子母星',
    themeKeys: ['fungal_catacombs', 'biolume_canopy'],
    physics: '行星级活体菌丝神经网络覆盖赤道，全星相当于一个巨型生物脑',
    hooks: Object.freeze({
      partnershipGrowthBonus: 0.35, // FRUITFUL_PARTNERSHIP 菌丝路网：人口增速 +35%
    }),
  },
  {
    id: 5,
    code: 'TERMINATOR_TWILIGHT_WORLD',
    nameZh: '永昼永夜潮汐锁定界',
    themeKeys: ['tidal_lock_dusk', 'dry_night_polar'],
    physics: '向阳面（Columns 0–5）熔岩火海、背阳面（Columns 10–15）绝对零度冰原，仅中央晨昏圈（Columns 6–9）为宜居绿带',
    hooks: Object.freeze({
      terminatorColumns: Object.freeze([6, 9]), // 晨昏绿带列区间 [6, 9]（含端点）
      solarBonus: 1.5, // 向阳面太阳能产出 +150%
      darkComputeBonus: 1.0, // 背阳面超导算力与零热辐射隐蔽性 +100%
    }),
  },
  {
    id: 6,
    code: 'LEVIATHAN_NURSERY_MOON',
    nameZh: '巨兽孵化气态卫星',
    themeKeys: ['abyssal_ocean', 'biolume_canopy'],
    physics: '地核孕育着休眠的星海利维坦幼体，深海热泉密布有机母体',
    hooks: Object.freeze({
      wakeThresholdEnv0: 80, // envVector[0] > 80 提前惊醒狂暴幼兽（复用 planetaryThreat.awakenLeviathan）
    }),
  },
  {
    id: 7,
    code: 'ALL_SEEING_CRYSTALLINE',
    nameZh: '全视晶化共鸣星',
    themeKeys: ['prism_crystal', 'magnetar_aurora'],
    physics: '表面生长着高耸入云的压电硅基谐振水晶森林',
    hooks: Object.freeze({
      decryptBonus: 2, // 天然子空间雷达放大器：全星区情报解密 +2
      detectionBonus: 0.8, // 探测半径 +80%
    }),
  },
  {
    id: 8,
    code: 'CRYO_SUBGLACIAL_OCEAN',
    nameZh: '万丈冰壳暗海界',
    themeKeys: ['cryomethane_sea', 'permafrost_furnace'],
    physics: '表层为 20 公里厚永冻冰壳（Layer 2），真实生态与资源全部位于冰下地热暗海（Layer 3）',
    hooks: Object.freeze({
      bombardmentDamageMultiplier: 0.25, // 冰壳免疫轨道常规动能轰炸：伤害 -75%
    }),
  },
  {
    id: 9,
    code: 'GRAVITY_WRINKLE_WORLD',
    nameZh: '双黑洞引力褶皱星',
    themeKeys: ['glassstorm_barrens', 'obsidian_lava'],
    physics: '位于双致密天体引力鞍点，时间膨胀效应显著',
    hooks: Object.freeze({
      researchBonus: 0.8, // 物理与超空间科研产出 +80%
      upkeepPenalty: 0.4, // 强引力梯度机械疲劳：建筑与驻港舰船维护费 +40%
    }),
  },
  {
    id: 10,
    code: 'TOXIC_SULFUR_CAULDRON',
    nameZh: '超临界硫磺毒釜界',
    themeKeys: ['sulfur_marsh', 'salt_mirror_desert'],
    physics: '浓密超临界酸雾大气，常规殖民地无法生存，适合智械或经基因改造的耐酸种群定居',
    hooks: Object.freeze({
      initialEnv1: 70.0, // envVector[1]（AtmosphereToxicity 基线）初始高达 70.0
      chemEfficiency: 0.9, // 奇异化学与高爆弹药合成效率 +90%
    }),
  },
  {
    id: 11,
    code: 'SHATTERED_RING_HABITAT',
    nameZh: '断环远古天工界',
    themeKeys: ['ancient_megastructure', 'prism_crystal'],
    physics: '远古文明遗留的破碎星环区段，4 列为坍塌虚空断口',
    hooks: Object.freeze({
      maxOrbitalDistricts: 12, // 自带顶级轨道环带基座
      repairYieldBonus: 0.5, // 修复断口后全区划产出 +50%
    }),
  },
  {
    id: 12,
    code: 'KARST_HOLLOW_CAVERN',
    nameZh: '蜂巢真空溶洞死月',
    themeKeys: ['fractured_moon', 'prism_crystal'],
    physics: '地表无大气且频繁遭受流星雨暴击，地下拥有宏伟的密封结晶溶洞网',
    hooks: Object.freeze({
      subUrbanSlotsMultiplier: 2, // Layer 3 subUrbanSlots 容量翻倍（人口与工业转入地下溶洞）
    }),
  },
  {
    id: 13,
    code: 'STORM_JOVIAN_FLOATING',
    nameZh: '风暴气态浮空城界',
    themeKeys: ['cloud_giant_atolls', 'magnetar_aurora'],
    physics: '无固态地表，全部 16×16 网格为高压氢氦风暴云层中的反重力浮空平台',
    hooks: Object.freeze({
      isotopeMultiplier: 3.0, // 稀有同位素（氦-3 / 奇异气体）产出 ×3.0
    }),
  },
  {
    id: 14,
    code: 'IRON_CORE_FORGE_REMNANT',
    nameZh: '剥离地幔裸露铁核星',
    themeKeys: ['glassstorm_barrens', 'obsidian_lava'],
    physics: '古老超新星冲击吹飞了硅酸盐地幔，整颗星球是裸露的液态镍铁核心',
    hooks: Object.freeze({
      mineralAlloyBonus: 0.8, // 矿物与重工合金产出 +80%
      defenseRangeBonus: 0.3, // 天然强磁场：轨道防御武器射程 +30%
      agriHydroZero: true, // 农业与水圈恒等于 0
    }),
  },
  {
    id: 15,
    code: 'GAIA_SANCTUARY_PARADISE',
    nameZh: '先驱者封存盖亚圣域',
    themeKeys: ['canopy_colossus', 'biolume_canopy'],
    physics: '被先驱者气候护盾完美封存的黄金生态伊甸园',
    hooks: Object.freeze({
      habitabilityFixed: 100, // 全种群宜居度恒定 100%
      happinessBonus: 0.2, // 幸福度 +20%
      guardianThresholdEnv7: 35.0, // envVector[7]（工业扰动）> 35.0 → 远古净化守卫苏醒
    }),
  },
]);

/** 原型数量（冻结契约值 16；与 planetStateSchema createCompactPlanetState 位段 0..15 同源） */
export const ARCHETYPE_COUNT = PLANETARY_ARCHETYPES.length;

/**
 * themeKeys 映射裁决表（doc45 原表视觉主题名 → PLANET_THEMES 真实键；逐行可追溯）。
 * doc45 的 lava/basalt/dune/canyon/relic/metallic/twilight/eyeball/crystal/prism/
 * ice/glacier/barren/obsidian/toxic/acid/ringworld/artificial/moon/crater/gas_giant/
 * storm/metallic/core/gaia/continental 均非 18 主题键名，按下述最近语义映射：
 *  - #0 lava→obsidian_lava（主）、basalt→fractured_moon（玄武岩碎裂月壳语义）；
 *  - #1 dune→red_regolith_frontier（主）、canyon→salt_mirror_desert（干盐漠裂隙语义）；
 *  - #2 aether→magnetar_aurora（主）、crystalline→prism_crystal（副）；
 *  - #3 relic→ancient_megastructure（主）、metallic→fractured_moon（锈蚀金属月壳语义）；
 *  - #4 fungal→fungal_catacombs（主）、jungle→biolume_canopy（副）；
 *  - #5 twilight→tidal_lock_dusk（主）、eyeball→dry_night_polar（ eyeball 冰冻夜侧极冠语义）；
 *  - #6 ocean→abyssal_ocean（主）、biolum→biolume_canopy（副）；
 *  - #7 crystal/prism→prism_crystal（主）、谐振放大→magnetar_aurora（副）；
 *  - #8 ice/glacier→cryomethane_sea（主）、permafrost_furnace（副）；
 *  - #9 barren→glassstorm_barrens（主）、obsidian→obsidian_lava（副）；
 *  - #10 toxic/acid→sulfur_marsh（主）、酸雾盐沼→salt_mirror_desert（副）；
 *  - #11 ringworld→ancient_megastructure（主）、artificial 晶格环段→prism_crystal（副）；
 *  - #12 moon/crater→fractured_moon（主）、密封结晶溶洞→prism_crystal（副）；
 *  - #13 gas_giant→cloud_giant_atolls（主）、风暴电磁暴→magnetar_aurora（副）；
 *  - #14 metallic/core→glassstorm_barrens（主，裸露铁核玻璃化风暴面）、obsidian_lava（副）；
 *  - #15 gaia→canopy_colossus（主）、continental→biolume_canopy（副）。
 */
export const ARCHETYPE_THEME_MAPPING_NOTES = Object.freeze([
  '0: lava->obsidian_lava, basalt->fractured_moon',
  '1: dune->red_regolith_frontier, canyon->salt_mirror_desert',
  '2: aether->magnetar_aurora, crystalline->prism_crystal',
  '3: relic->ancient_megastructure, metallic->fractured_moon',
  '4: fungal->fungal_catacombs, jungle->biolume_canopy',
  '5: twilight->tidal_lock_dusk, eyeball->dry_night_polar',
  '6: ocean->abyssal_ocean, biolum->biolume_canopy',
  '7: crystal/prism->prism_crystal, resonance->magnetar_aurora',
  '8: ice/glacier->cryomethane_sea, permafrost_furnace',
  '9: barren->glassstorm_barrens, obsidian->obsidian_lava',
  '10: toxic/acid->sulfur_marsh, flats->salt_mirror_desert',
  '11: ringworld->ancient_megastructure, artificial->prism_crystal',
  '12: moon/crater->fractured_moon, cavern->prism_crystal',
  '13: gas_giant->cloud_giant_atolls, storm->magnetar_aurora',
  '14: metallic/core->glassstorm_barrens, obsidian->obsidian_lava',
  '15: gaia->canopy_colossus, continental->biolume_canopy',
]);

/* ============================== 查表 API（fail fast） ============================== */

/**
 * archetypeId → 原型配置（冻结行）。
 * 非整数 / 越界 [0, 15] 抛 Error('SO:…')（compact.archetypeId 位段保证 0..15，
 * 越界即容器结构损坏，fail fast 而非静默回退）。
 *
 * @param {number} archetypeId - 天体原型 0..15
 * @returns {object} 冻结的原型配置行
 */
export function getArchetype(archetypeId) {
  const n = Number(archetypeId);
  if (!Number.isInteger(n) || n < 0 || n >= ARCHETYPE_COUNT) {
    throw new Error(`SO: archetypeId 必须为 0..${ARCHETYPE_COUNT - 1} 整数（实测 ${String(archetypeId)}）`);
  }
  return PLANETARY_ARCHETYPES[n];
}

/* ============================== import 期表完整性自检（零世界状态触碰） ============================== */

for (let i = 0; i < PLANETARY_ARCHETYPES.length; i++) {
  const row = PLANETARY_ARCHETYPES[i];
  if (row.id !== i) throw new Error(`SO: 原型表 id 须严格 0..15 连续（行 ${i} 实测 ${row.id}）`);
  if (!Array.isArray(row.themeKeys) || row.themeKeys.length !== 2) {
    throw new Error(`SO: 原型 ${row.id} themeKeys 须为 [主, 副] 双键`);
  }
  for (const key of row.themeKeys) {
    if (!PLANET_THEMES[key]) {
      throw new Error(`SO: 原型 ${row.id} themeKey "${key}" 不存在于 PLANET_THEMES`);
    }
  }
  if (typeof row.physics !== 'string' || row.physics.length === 0) {
    throw new Error(`SO: 原型 ${row.id} physics 描述缺失`);
  }
  if (!row.hooks || typeof row.hooks !== 'object') {
    throw new Error(`SO: 原型 ${row.id} hooks 缺失`);
  }
}
const CODE_SET = new Set(PLANETARY_ARCHETYPES.map((r) => r.code));
if (CODE_SET.size !== ARCHETYPE_COUNT) throw new Error('SO: 原型 code 必须两两互异');
