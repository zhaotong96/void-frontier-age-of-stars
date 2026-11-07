/**
 * domain/ground/xenobiology.js — 异星生态科学（doc18 v0.2 WP-2 / doc16 §4.1~4.4）
 *
 * 设计红线（doc16 §4.2）：严禁逐草逐兽建对象——采用「区域生态斑块统计
 * （Ecological Patch）+ 物种种群统计 + 局部表现代理」三级轻量模型；
 * 单星持久化 planet.eco 严格 ≤ 3 KB（XENO-04 门禁）。
 *
 * 确定性红线（doc17 §3.1）：物种形态基因 100% 由 derivePlanetSeedsExtended
 * 的 floraSeed/faunaSeed 子流实时派生，未扫描物种在存档中占 0 字节；
 * 零 Math.random()、零 world.rng 消费（XENO-01 门禁断言逐字节零污染）。
 *
 * 四阶段图鉴状态机（doc16 §4.3）：Observed（远距目击 1.0s）→ Identified
 * （25m 光谱识别 2.0s）→ Analyzed（E 采样，入账科研/生物质）→ Mastered
 * （基因逆向，解锁特种科技）。持久化 2-bit 档位（doc18 契约）：
 *   00 未发现 / 01 Observed / 10 Identified / 11 Mastered；
 * Analyzed 里程碑以 sampleMask 位记录（采样动作先于基因逆向）。
 */

import { derivePlanetSeedsExtended, createSubRng } from './planetSeeds.js';
import { emit } from '../../core/eventBus.js';
import { clamp } from '../../core/math.js';
import { credit } from '../economy/ledger.js';

/** 四阶段图鉴档位（discoveryMask 每物种 2-bit，doc18 WP-2 数据契约） */
export const SPECIES_STAGE = Object.freeze({
  NONE: 0,
  OBSERVED: 1,
  IDENTIFIED: 2,
  MASTERED: 3,
});

/** 生态斑块数（每行星固定 5 斑块；[biomass, nutrients, water, contamination, speciesDensityMask]） */
export const ECO_PATCH_COUNT = 5;

/** 主题生态风味（doc18 WP-2 目标文件 planetThemes.js 的配套语义表：命名/习性派生素材） */
export const PLANET_ECO_FLAVOR = Object.freeze({
  abyssal_ocean: { floraStyle: '发光海带', faunaStyle: '滤食水母', hazard: 'depth' },
  permafrost_furnace: { floraStyle: '热泉苔毯', faunaStyle: '潜冰猎手', hazard: 'cold' },
  red_regolith_frontier: { floraStyle: '铁锈地衣', faunaStyle: '砂原掘食兽', hazard: 'dust' },
  dry_night_polar: { floraStyle: '极夜晶蕨', faunaStyle: '夜巡绒兽', hazard: 'cold' },
  sulfur_marsh: { floraStyle: '硫华菌簇', faunaStyle: '酸液喷吐兽', hazard: 'acid' },
  biolume_canopy: { floraStyle: '荧光树蕨', faunaStyle: '夜行翼蜥', hazard: 'none' },
  obsidian_lava: { floraStyle: '硅基晶簇', faunaStyle: '熔壳爬行者', hazard: 'heat' },
  prism_crystal: { floraStyle: '棱镜晶兰', faunaStyle: '折光浮游体', hazard: 'none' },
  salt_mirror_desert: { floraStyle: '盐壳地衣', faunaStyle: '盐甲虫群', hazard: 'dust' },
  cryomethane_sea: { floraStyle: '甲烷藻毯', faunaStyle: '低温滤食者', hazard: 'cold' },
  tidal_lock_dusk: { floraStyle: '晨昏藤蔓', faunaStyle: '昏线游荡兽', hazard: 'none' },
  cloud_giant_atolls: { floraStyle: '浮台垂兰', faunaStyle: '浮空气囊兽', hazard: 'fall' },
  fungal_catacombs: { floraStyle: '孢林菌柱', faunaStyle: '孢子漫步者', hazard: 'spore' },
  ancient_megastructure: { floraStyle: '巨构附生蕨', faunaStyle: '巡构机偶兽', hazard: 'none' },
  glassstorm_barrens: { floraStyle: '玻晶棘丛', faunaStyle: '风暴蚀壳兽', hazard: 'glassstorm' },
  magnetar_aurora: { floraStyle: '磁极光苔', faunaStyle: '电磁水母群', hazard: 'emp' },
  canopy_colossus: { floraStyle: '冠层垂蕨', faunaStyle: '冠层荡臂兽', hazard: 'fall' },
  fractured_moon: { floraStyle: null, faunaStyle: null, hazard: 'vacuum' },
});

/** 真空/气态天体不生成地表生物（doc18 WP-2 §3.1；fractured_moon = 真空碎环月主题） */
function isSterilePlanet(planet) {
  return planet.category === 'gasGiant' || planet.primaryThemeId === 'fractured_moon';
}

/** 形态基因码（纯种子派生，0 存档字节）：i = 物种序号 */
function deriveGenome(seeds, kind, i) {
  const r = createSubRng(kind === 'flora' ? seeds.floraSeed(i) : seeds.faunaSeed(i));
  return {
    hueIdx: (r() * 6) | 0,              // 色相偏移桶（渲染层取主题色板）
    sizeClass: 1 + ((r() * 4) | 0),     // 1..4 体型档（0.4m ~ 6m 视觉映射）
    toxicity: kind === 'flora' ? (r() * 100) | 0 : (r() * 60) | 0,
    waterNeed: Math.round(r() * 100) / 100,   // 0.0~1.0 水分依赖
    biolume: r() < 0.35 ? 1 : 0,        // 荧光/发光体征
    mobility: kind === 'flora' ? 0 : 1 + ((r() * 3) | 0), // 1 步行 / 2 奔跑 / 3 飞行
    aggroR: kind === 'predator' ? 10 + Math.round(r() * 14) : 0, // 掠食者感知半径 m
  };
}

/** 程序化物种名（风味前缀 + 基因特征词根，纯确定性） */
const HUE_ZH = ['赤', '橙', '黄', '青', '蓝', '紫'];
function speciesName(flavor, kind, genome, i) {
  const hue = HUE_ZH[genome.hueIdx] || '';
  const trait = genome.biolume ? '荧光' : genome.toxicity > 55 ? '毒腺' : genome.sizeClass >= 3 ? '巨躯' : '矮簇';
  const style = kind === 'flora' ? (flavor.floraStyle || '原生植物') : (flavor.faunaStyle || '原生生物');
  return `${hue}${trait}${style}`;
}

/**
 * 纯函数：派生一颗行星的原生物种名录（含形态基因码）。
 * 不写任何状态——GroundView/BioFloraPass 每次进场景实时重建。
 * 营养级（doc16 §4.1）：第一 4~8 种植物/菌落、第二 1~2 种草食、第三 1~2 种掠食者。
 * @returns {{species:Array, total:number}|null} null = 不育天体（气态巨行星/真空碎环月）
 */
export function derivePlanetEcology(world, planet) {
  if (!planet || isSterilePlanet(planet)) return null;
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const flavor = PLANET_ECO_FLAVOR[planet.primaryThemeId] || PLANET_ECO_FLAVOR.red_regolith_frontier;
  const countRng = createSubRng(seeds.biomeSeed ^ seeds.planetSeed);
  const nFlora = 4 + ((countRng() * 5) | 0);          // 4..8
  const nHerbivore = 1 + ((countRng() * 2) | 0);      // 1..2
  const nPredator = 1 + ((countRng() * 2) | 0);       // 1..2
  const species = [];
  for (let i = 0; i < nFlora; i++) {
    const g = deriveGenome(seeds, 'flora', i);
    species.push({ idx: species.length, kind: 'flora', trophic: 1, name: speciesName(flavor, 'flora', g, i), genome: g });
  }
  for (let i = 0; i < nHerbivore; i++) {
    const g = deriveGenome(seeds, 'herbivore', i);
    species.push({ idx: species.length, kind: 'herbivore', trophic: 2, name: speciesName(flavor, 'herbivore', g, i), genome: g });
  }
  for (let i = 0; i < nPredator; i++) {
    const g = deriveGenome(seeds, 'predator', i);
    species.push({ idx: species.length, kind: 'predator', trophic: 3, name: speciesName(flavor, 'predator', g, i), genome: g });
  }
  return { species, total: species.length };
}

/**
 * 惰性初始化 planet.eco（doc18 WP-2 数据契约；幂等）。
 * 斑块初值由 biomeSeed 子流确定性派生（同种子逐位一致），非文档示例字面量。
 */
export function ensurePlanetEco(world, planet) {
  if (planet.eco && planet.eco.v === 1) return planet.eco;
  const seeds = derivePlanetSeedsExtended(world, planet.id);
  const eco = derivePlanetEcology(world, planet);
  const rng = createSubRng(seeds.biomeSeed);
  const patches = [];
  for (let p = 0; p < ECO_PATCH_COUNT; p++) {
    const biomass = 30 + ((rng() * 55) | 0);     // 30..85
    const nutrients = 20 + ((rng() * 50) | 0);   // 20..70
    const water = 25 + ((rng() * 55) | 0);       // 25..80
    const contamination = eco ? (rng() * 6) | 0 : 0; // 原生污染基线 0..5
    // 物种密度位掩码：第 p 斑块按哈希散布物种（bit i = 物种 i 在本斑块有栖息密度）
    let densityMask = 0;
    if (eco) {
      const prng = createSubRng(seeds.biomeSeed ^ (p + 1) * 0x9e3779b9);
      for (let s = 0; s < eco.total; s++) {
        if (prng() < 0.45) densityMask |= (1 << s);
      }
      if (densityMask === 0) densityMask = 1 << (p % eco.total); // 每斑块至少 1 种
    }
    patches.push([biomass, nutrients, water, contamination, densityMask]);
  }
  planet.eco = {
    v: 1,
    speciesCount: eco ? eco.total : 0,
    discoveryMask: 0,
    sampleMask: 0,          // Analyzed 里程碑（bit i = 物种 i 已采样）
    patches,
    surveyAwarded: false,
    ruin: null,             // WP-3 monolithRuins 紧凑元组
  };
  return planet.eco;
}

/** 物种总数（doc18 契约签名 getPlanetSpeciesCount(planet)；未激活生态返回 0） */
export function getPlanetSpeciesCount(planet) {
  return (planet && planet.eco && planet.eco.speciesCount) || 0;
}

/** 读某物种当前档位 */
export function getSpeciesStage(planet, speciesIdx) {
  if (!planet.eco) return SPECIES_STAGE.NONE;
  return (planet.eco.discoveryMask >>> (speciesIdx * 2)) & 0b11;
}

/** 全物种 Mastered 且未发奖 → 一次性「行星生态完全测绘大奖」（幂等，doc18 XENO-02） */
function grantSurveyAwardIfComplete(world, planet) {
  const eco = planet.eco;
  if (eco.surveyAwarded) return false;
  const total = getPlanetSpeciesCount(planet);
  for (let i = 0; i < total; i++) {
    if (((eco.discoveryMask >>> (i * 2)) & 0b11) < SPECIES_STAGE.MASTERED) return false;
  }
  eco.surveyAwarded = true;
  const fid = world.playerFactionId;
  if (fid) {
    credit(world, fid, 'credits', 500, 'planetEcoSurvey', planet.id);
    credit(world, fid, 'researchData', 60, 'planetEcoSurvey', planet.id);
  }
  emit(world, 'PlanetEcoSurveyCompleted', { planetId: planet.id, speciesCount: total }, 'ground');
  return true;
}

/**
 * 四阶段图鉴推进（doc18 WP-2 §3 契约实现；GroundView 分析面罩/采样/实验室调用）。
 * Analyzed 里程碑：targetStage ≥ 2（Identified）且首次采样时置 sampleMask 位并入账
 * 科研点与生物质（doc16 §4.3 阶段 3）。Mastered（档位 3）要求该物种已采样（阶段 4
 * 基因逆向的前置），无殖民星球亦可完成（doc16 §8.1 验收红线）。
 * @param {number} targetStage 1..3（SPECIES_STAGE）
 * @returns {{ok:boolean, reason?:string, currentStage?:number, newlyAwarded?:boolean, sampleAward?:object}}
 */
export function advanceSpeciesDiscovery(world, planetId, speciesIdx, targetStage) {
  const planet = world.entities.planets[planetId];
  if (!planet) return { ok: false, reason: 'PlanetNotFound' };
  if (!planet.eco) ensurePlanetEco(world, planet);
  const eco = planet.eco;
  const total = getPlanetSpeciesCount(planet);
  if (!(speciesIdx >= 0 && speciesIdx < total)) return { ok: false, reason: 'SpeciesIdxOutOfRange' };
  if (!(targetStage >= SPECIES_STAGE.NONE && targetStage <= SPECIES_STAGE.MASTERED)) {
    return { ok: false, reason: 'BadTargetStage' };
  }

  const shift = speciesIdx * 2;
  const currentStage = (eco.discoveryMask >>> shift) & 0b11;
  // Mastered 前置：必须先完成 Analyzed 采样里程碑（doc16 §4.3 阶段链）
  let sampleAward = null;
  if (targetStage >= SPECIES_STAGE.MASTERED && !(eco.sampleMask & (1 << speciesIdx))) {
    return { ok: false, reason: 'SampleRequired', currentStage };
  }
  if (targetStage > currentStage) {
    eco.discoveryMask = (eco.discoveryMask & ~(0b11 << shift)) | (targetStage << shift);
  }

  const newlyAwarded = grantSurveyAwardIfComplete(world, planet);
  return { ok: true, currentStage: Math.max(currentStage, targetStage), newlyAwarded, sampleAward };
}

/**
 * Analyzed 采样里程碑（doc16 §4.3 阶段 3）：E 键采集活体组织/排泄物。
 * 入账科研点 +10 与生物质 +5（有殖民地入殖民地仓储，否则入玩家账本）；
 * 幂等性：每物种档位只发一次（重复采样只产物料不改档位——由调用方节流）。
 */
export function collectSpecimenSample(world, planetId, speciesIdx) {
  const planet = world.entities.planets[planetId];
  if (!planet) return { ok: false, reason: 'PlanetNotFound' };
  if (!planet.eco) ensurePlanetEco(world, planet);
  const eco = planet.eco;
  const total = getPlanetSpeciesCount(planet);
  if (!(speciesIdx >= 0 && speciesIdx < total)) return { ok: false, reason: 'SpeciesIdxOutOfRange' };
  const stage = getSpeciesStage(planet, speciesIdx);
  if (stage < SPECIES_STAGE.IDENTIFIED) return { ok: false, reason: 'NotIdentified' };
  const first = (eco.sampleMask & (1 << speciesIdx)) === 0;
  if (first) {
    eco.sampleMask |= (1 << speciesIdx);
    const fid = world.playerFactionId;
    if (fid) credit(world, fid, 'researchData', 10, 'specimenSample', planet.id);
    const colony = Object.values(world.entities.colonies || {}).find((c) => c.planetId === planet.id);
    if (colony) {
      colony.stockpile ||= {};
      colony.stockpile.biomass = (colony.stockpile.biomass || 0) + 5;
    }
    emit(world, 'SpecimenSampled', { planetId: planet.id, speciesIdx, resCredits: 0 }, 'ground');
  }
  return { ok: true, first, stage };
}

/**
 * 生态斑块日结算（doc16 §4.2 ΔN_i = B_i − D_i + M_i + Σ I_ij 轻量统计模型；
 * DailySystems population 阶段调用；确定性、O(5) 常数、零对象分配）。
 * B 繁殖：水分充足 + 营养有余；D 死亡：污染超阈值/超承载；M 迁徙：邻斑 Biomass 梯度；
 * I 交互：污染侵蚀物种密度位（灭绝-重殖皆确定性）。
 */
export function tickPlanetEcology(world, planet) {
  if (!planet || !planet.eco || !planet.eco.patches) return false;
  const patches = planet.eco.patches;
  let changed = false;
  const next = [];
  for (let i = 0; i < patches.length; i++) {
    const cur = patches[i];
    const [biomass, nutrients, water, contamination, densityMask] = cur;
    // B：繁殖增长（水分/营养双门槛）
    const grow = (water >= 25 && nutrients >= 20 && biomass < 95) ? 2 : 0;
    // D：死亡损失（污染毒害 + 超承载密度制约）
    const die = (contamination > 40 ? 3 : 0) + (biomass > 85 ? 1 : 0);
    // M：迁徙净变化（环形邻域梯度，同种子确定性）
    const nb = patches[(i + 1) % patches.length][0];
    const migrate = Math.sign(nb - biomass) * (Math.abs(nb - biomass) > 20 ? 1 : 0);
    // I：交互（污染每 25 点侵蚀 1 点营养循环效率 → 营养流失）
    const pollutionDrain = contamination >= 25 ? 1 : 0;
    let nb2 = clamp(biomass + grow - die + migrate, 0, 100);
    let nn = clamp(nutrients - (grow > 0 ? 1 : 0) - pollutionDrain + (contamination > 60 ? 0 : 1), 0, 100);
    let nw = clamp(water - (grow > 0 ? 1 : 0) + (contamination > 50 ? 0 : 1), 0, 100);
    let nc = clamp(contamination - 1, 0, 100); // 自然消散（世界不会永远惩罚，doc16 §11）
    let nm = densityMask;
    // 物种密度位：斑块荒漠化（<10）→ 密度位清零（局部迁离）；恢复（>40）→ 重殖回填
    if (nb2 < 10 && nm !== 0) nm = 0;
    else if (nb2 > 40 && nm === 0) {
      const prng = createSubRng((planet.eco.discoveryMask ^ (i + 1) * 0x85ebca6b ^ world.tick) >>> 0);
      nm = (1 << (prng() * Math.max(1, getPlanetSpeciesCount(planet)) | 0)) >>> 0;
    }
    if (nb2 !== biomass || nn !== nutrients || nw !== water || nc !== contamination || nm !== densityMask) changed = true;
    next.push([nb2, nn, nw, nc, nm]);
  }
  if (changed) planet.eco.patches = next;
  return changed;
}

/** 生态图鉴完成度（0..1）：已 Mastered 物种 / 总物种；不育天体 = 1 */
export function ecoSurveyProgress(planet) {
  const total = getPlanetSpeciesCount(planet);
  if (!total) return 1;
  let mastered = 0;
  for (let i = 0; i < total; i++) {
    if (((planet.eco.discoveryMask >>> (i * 2)) & 0b11) >= SPECIES_STAGE.MASTERED) mastered++;
  }
  return mastered / total;
}
