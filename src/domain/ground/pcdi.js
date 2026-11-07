/**
 * domain/ground/pcdi.js — Planetary Content Depth Index（doc16 §9 / doc18 WP-5 XENO-05）
 *
 * 行星内容深度评分（满分 100，设计管理指标）：
 *   Exploration Depth 15 / Activity Variety 20 / System Interaction 20 /
 *   World Persistence 15 / Strategic Value 10 / Replay Value 10 / Theme Uniqueness 10
 *
 * 评分口径：只度量「实际已实现且可被玩家触达」的能力与状态（反假绿——
 * 每个维度都锚定真实世界状态：discoveryMask/ruin 元组/terrainEdits/账本流水），
 * 未落地的跨系统链接不计分（v0.2 后随支柱落地逐步饱和）。
 * 纯函数 of (world, planet)：确定性、零 rng 消费、零分配副作用。
 */

import { getPlanetSpeciesCount, getSpeciesStage, SPECIES_STAGE } from './xenobiology.js';
import { RUIN_STAGE } from './monolithRuins.js';

/** 先驱者遗落科技（与 monolithRuins.PRECURSOR_TECHS 同表，避免循环依赖复制常量） */
const PRECURSOR_TECH_IDS = ['tech_precursor_shield_harmonics', 'tech_precursor_mass_catapult'];

/** 三颗首发旗舰主题（doc16 §8.1 垂直切片路径） */
export const FLAGSHIP_THEMES = Object.freeze(['sulfur_marsh', 'biolume_canopy', 'red_regolith_frontier']);

function ruinStageOf(planet) {
  return planet.eco && planet.eco.ruin ? planet.eco.ruin[0] : 0;
}

/**
 * PCDI 评分（doc16 §9 权重表；逐维度锚定真实世界状态）。
 * @returns {{total:number, dimensions:{exploration:number, activity:number, systemInteraction:number, persistence:number, strategic:number, replay:number, themeUniqueness:number}, tier:'S'|'A'|'B'|'C', flagship:boolean}}
 */
export function pcdiEvaluate(world, planet) {
  const dims = { exploration: 0, activity: 0, systemInteraction: 0, persistence: 0, strategic: 0, replay: 0, themeUniqueness: 0 };
  const eco = planet.eco || null;
  const totalSp = getPlanetSpeciesCount(planet);
  const ruinStage = ruinStageOf(planet);
  const pois = planet.pois || {};
  const poiList = Object.values(pois);
  const poiExplored = poiList.filter((p) => p.rewardPaid || p.state === 'explored').length;
  const edits = planet.terrainEdits && Array.isArray(planet.terrainEdits.ops) ? planet.terrainEdits.ops : [];
  const groundB = planet.groundBuildings || [];
  const fid = world.playerFactionId;
  const researchDone = fid && world.research && world.research[fid] ? world.research[fid].completed : [];

  // —— Exploration Depth（0..15）：物种派生规模 + 遗迹阶段 + POI 发现 ——
  dims.exploration += Math.min(5, totalSp / 1.6);          // ≥8 种 → 5
  dims.exploration += ruinStage >= RUIN_STAGE.EXCAVATION ? 3 : 0;
  dims.exploration += ruinStage >= RUIN_STAGE.RESONANCE ? 2 : 0;
  dims.exploration += ruinStage >= RUIN_STAGE.CORE ? 2 : 0;
  dims.exploration += poiList.length > 0 ? 3 * (poiList.length ? Math.min(1, (poiExplored + 1) / poiList.length) : 0) : 0;

  // —— Activity Variety（0..20）：可触达的独立活动系统数 ——
  let acts = 0;
  if (totalSp >= 4) acts++;                                 // 生态扫描
  if (eco && eco.sampleMask) acts++;                        // 活体采样
  if (totalSp > 0 && eco && eco.discoveryMask) acts++;      // 图鉴推进
  if (ruinStage >= 1) acts++;                               // 遗迹考古
  if (poiList.length > 0) acts++;                           // POI 采样
  if (planet.deposits && Object.values(planet.deposits).some((v) => v > 0)) acts++; // 地质采掘
  if (groundB.length > 0) acts++;                           // 工程建造
  if (edits.length > 0) acts++;                             // 地形改造
  dims.activity = Math.min(20, acts * 2.5);

  // —— System Interaction（0..20）：跨系统因果链接（只计已实现的链接） ——
  let links = 0;
  if (eco && eco.surveyAwarded) links++;                    // 生态测绘 → 科研/信用入账
  if (eco && eco.sampleMask) links++;                       // 采样 → researchData 流水
  if (ruinStage >= RUIN_STAGE.CORE && PRECURSOR_TECH_IDS.some((t) => researchDone.includes(t))) links++; // 遗迹 → 遗落科技
  if (edits.length > 0) links++;                            // 地形编辑 → 持久化重建
  if (groundB.length > 0) links++;                          // 建造 → 地基承台/布局
  if (poiExplored > 0) links++;                             // POI → 账本奖励
  dims.systemInteraction = Math.min(20, links * (20 / 7));

  // —— World Persistence（0..15）：世界记住玩家行为 ——
  if (eco && eco.discoveryMask) dims.persistence += 4;
  if (eco && eco.ruin) dims.persistence += 4;
  if (edits.length > 0) dims.persistence += 4;
  if (groundB.length > 0) dims.persistence += 3;

  // —— Strategic Value（0..10）：矿产战略价值 + 特殊科技/资源 ——
  const depSum = planet.deposits ? Object.values(planet.deposits).reduce((a, b) => a + b, 0) : 0;
  dims.strategic += Math.min(5, depSum / 40);
  if (PRECURSOR_TECH_IDS.some((t) => researchDone.includes(t))) dims.strategic += 5;

  // —— Replay Value（0..10）：回访理由（未尽内容 + 动态斑块 + 多路线） ——
  const remainPoi = poiList.length - poiExplored;
  dims.replay += Math.min(4, remainPoi * 1.3);
  if (eco && eco.patches && eco.patches.length >= 5) {
    const masks = new Set(eco.patches.map((p) => p[4]));
    dims.replay += masks.size >= 3 ? 3 : 1;
  }
  if (totalSp >= 6) dims.replay += 3;

  // —— 工业与物流维度注入（doc19 WP-6 IND-05：跨入 activity/systemInteraction/
  //    persistence/replay 四维计分；只计真实 planet.ind 状态） ——
  const ind = planet.ind && planet.ind.v === 1 ? planet.ind : null;
  if (ind) {
    const nNodes = (ind.nodes || []).length;
    const nBelts = (ind.belts || []).length;
    if (nNodes > 0) dims.activity = Math.min(20, dims.activity + 2.5);
    if (nBelts > 0) dims.activity = Math.min(20, dims.activity + 2.5);
    if (ind.catapult) dims.activity = Math.min(20, dims.activity + 2.5);
    if (nNodes > 0) dims.systemInteraction = Math.min(20, dims.systemInteraction + 20 / 7);
    if (nBelts > 0) dims.systemInteraction = Math.min(20, dims.systemInteraction + 20 / 7);
    if (ind.catapult && ind.orbitalBuffer) dims.systemInteraction = Math.min(20, dims.systemInteraction + 20 / 7);
    if (nNodes > 0) dims.persistence += 3;
    if (nBelts > 0) dims.persistence += 2;
    if (ind.catapult) dims.persistence += 2;
    if (nBelts >= 4) dims.replay = Math.min(10, dims.replay + 2);
  }

  // —— Theme Uniqueness（0..10）：主题身份 + 环境危险签名 ——
  if (planet.primaryThemeId) dims.themeUniqueness += 6;
  if (FLAGSHIP_THEMES.includes(planet.primaryThemeId)) dims.themeUniqueness += 2;
  if (planet.hazards && planet.hazards.length > 0) dims.themeUniqueness += 2;

  const total = Math.round(Object.values(dims).reduce((a, b) => a + b, 0));
  const tier = total >= 85 ? 'S' : total >= 75 ? 'A' : total >= 65 ? 'B' : 'C';
  return {
    total,
    dimensions: dims,
    tier,
    flagship: FLAGSHIP_THEMES.includes(planet.primaryThemeId),
  };
}

/** 全银河 PCDI 分布统计（doc22 WP-6 SYNERGY-05 大验收消费） */
export function pcdiGalaxySummary(world) {
  const planets = Object.values(world.entities.planets);
  const rows = planets.map((p) => ({ planetId: p.id, theme: p.primaryThemeId, ...pcdiEvaluate(world, p) }));
  const counts = { S: 0, A: 0, B: 0, C: 0 };
  for (const r of rows) counts[r.tier]++;
  return { rows, counts, total: planets.length };
}
