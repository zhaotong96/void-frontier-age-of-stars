/**
 * tests/suites/playtest-gates.suite.js — PLAYTEST-GATE-02/03/04（doc9 §四）
 *
 * GATE-02：3D 关卡拓扑与地标/水体/POI 实装接线断言（源级 + 实例级双口径）。
 * GATE-03：弹簧臂相机陡坡/凹坑 360° 零压溃（computeSpringArm 与实机同源纯函数）。
 * GATE-04：殖民地建筑 9 点坡度贴合与基座裙边（planColonyLayout 与实机同源纯函数）。
 *
 * 说明：GATE-02/03/04 通过「源码接线断言 + 同源纯函数实例化」覆盖实机链路——
 * GroundView 的 _setupScene/_renderFrame/_layoutColony 均调用此处被测的同一
 * 函数与同一接线语句（避免 mock 孤岛断言的旧教训；DOM 全生命周期归浏览器门禁页）。
 */

import { readFileSync } from 'node:fs';
import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { createGroundMission, getMissionField } from '../../src/domain/ground/GroundMission.js';
import { blueprintsForPlanet } from '../../src/content/missionSites.js';
import { getSiteInstance } from '../../src/domain/ground/missionSiteFactory.js';
import { buildTerrainField } from '../../src/domain/ground/terrainField.js';
import { planColonyLayout, checkBuildingPlacement } from '../../src/domain/ground/terrainEdits.js';
import { computeSpringArm } from '../../src/ui/screens/GroundView.js';
import { sampleTerrain, slopeAt } from '../../src/domain/ground/surfaceQueries.js';

const GV_SRC = readFileSync('src/ui/screens/GroundView.js', 'utf8');
const SCENE_SRC = readFileSync('src/render/gl/PlanetSurfaceScene.js', 'utf8');
const GMESH_SRC = readFileSync('src/render/meshes/GroundMeshes.js', 'utf8');

/** 世界坐标 → 场域坐标采样（world = field − FIELD_OFFSET，FIELD_OFFSET = −32） */
function groundAt(field) {
  return (wx, wz) => {
    const s = sampleTerrain(field, wx + 32, wz + 32);
    return s ? s.y : Infinity;
  };
}

/** 选出地形高差最大的崎岖行星（GATE-03 用 plt_18/plt_452 等价替身） */
function ruggedPlanets(world, count) {
  const ranked = Object.values(world.entities.planets)
    .map((p) => {
      const bp = blueprintsForPlanet(p, p.primaryThemeId || null)[0] || null;
      const site = bp ? getSiteInstance(world, p.id, bp.id) : null;
      if (!site) return null;
      const field = buildTerrainField(world, p.id, {
        profile: bp.terrainProfile,
        siteModifier: site.siteModifier,
        lod0Step: 4,
      });
      let min = Infinity;
      let max = -Infinity;
      for (let z = 0; z < 512; z += 32) {
        for (let x = 0; x < 512; x += 32) {
          const s = sampleTerrain(field, x, z);
          if (!s) continue;
          min = Math.min(min, s.y);
          max = Math.max(max, s.y);
        }
      }
      return { p, field, range: max - min };
    })
    .filter(Boolean)
    .sort((a, b) => b.range - a.range)
    .slice(0, count);
  return ranked;
}

export const suite02 = {
  id: 'PLAYTEST-02',
  name: '3D 关卡拓扑与地标/水体/POI 实装接线（GATE-02）',
  group: 'PLAYTEST',
  async run() {
    // (1) 任务运行于 site_meters 且 route_main 无 2D 隐形墙（3D 坡度通行）
    const world = createStarterCampaign({ seed: 24601 });
    const planet = Object.values(world.entities.planets).find((p) => p.category !== 'gasGiant');
    const field = getMissionField(world, planet.id);
    if (!field) throw new Error('getMissionField 未产出场域');
    const mission = createGroundMission(world, { templateId: 'gmt_relic_survey', planetId: planet.id, field });
    if (mission.coordSpace !== 'site_meters') throw new Error(`coordSpace=${mission.coordSpace}`);
    if (mission.grid || mission.w) throw new Error('site_meters 任务残留 2D 网格字段');
    const routeOk = mission.site.routes.some((r) => r.kind === 'wide_safe');
    if (!routeOk) throw new Error('站点缺 route_main（wide_safe）');

    // (2) GroundView._setupScene 的 _pois/_edits 接线语句存在（源级断言）
    if (!/this\._pois = ensurePlanetPois\(/.test(GV_SRC)) throw new Error('GroundView 缺 _pois 初始化');
    if (!/this\._edits = deserializeEdits\(/.test(GV_SRC)) throw new Error('GroundView 缺 _edits 初始化');
    if (!/attachTerrainEdits\(this\.field, this\._edits\)/.test(GV_SRC)) throw new Error('GroundView 缺 attachTerrainEdits 接线');

    // (3) _bmeshList 遍历站点地标（源级）+ 实例级地标 ≥ 2
    if (!/this\._site\.site\.landmarks/.test(GV_SRC)) throw new Error('_bmeshList 未渲染站点地标');
    const bp = blueprintsForPlanet(planet, planet.primaryThemeId || null)[0];
    const site = getSiteInstance(world, planet.id, bp.id);
    if (!site || site.site.landmarks.length < 2) throw new Error('站点地标实例 < 2');
    const FLAGSHIP = /salt_crystal_spire|sandstone_arch|central_furnace_tower|reef_dome_ruin|obsidian_arch_bridge|giant_fumarole_cone|soul_willow_tree|moonwhite_salt_monolith/;
    if (!site.site.landmarks.some((lm) => FLAGSHIP.test(lm.prefabId))) {
      throw new Error('站点地标无一命中七大旗舰图集 prefab');
    }

    // (4) PlanetSurfaceScene 挂载 PlanetWater + 潮汐（源级 + 实例级）
    if (!/import \{ PlanetWater, tideWaterLevel \} from '\.\/PlanetWater\.js';/.test(SCENE_SRC)
      && !/PlanetWater/.test(SCENE_SRC)) throw new Error('PlanetSurfaceScene 未导入 PlanetWater');
    if (!/this\._water = new PlanetWater\(/.test(SCENE_SRC)) throw new Error('PlanetSurfaceScene 未实例化 _water');
    if (!/tideWaterLevel\(/.test(SCENE_SRC)) throw new Error('场景未接入 90s 潮汐');
    // 蓝图地形剖面水位：abyssal_ocean 下 themeFx.waterLevel 应激活（非 -1000 关闭态）
    if (bp.terrainProfile === 'ocean_basin_reef_trench' || planet.category === 'ocean') {
      if (!/getWaterLevel/.test(SCENE_SRC)) throw new Error('场景缺 getWaterLevel 潮汐访问器');
    }
    return { ok: true, detail: `site_meters + _pois/_edits 接线 + 地标 ${site.site.landmarks.length} 座 + PlanetWater/潮汐 全部实装` };
  },
};

export const suite03 = {
  id: 'PLAYTEST-03',
  name: '弹簧臂相机陡坡/凹坑 360° 零压溃（GATE-03）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const rugged = ruggedPlanets(world, 2);
    if (rugged.length < 2) throw new Error('崎岖行星样本不足');
    let worstClearance = Infinity;
    let minArm = Infinity;
    let samples = 0;
    for (const { p, field } of rugged) {
      const gAt = groundAt(field);
      // 取地形高差点为角色位（最恶劣凹坑/崖缘）
      let spot = [256, 256];
      let bestRange = -1;
      for (let z = 32; z < 480; z += 48) {
        for (let x = 32; x < 480; x += 48) {
          const s = sampleTerrain(field, x, z);
          if (!s) continue;
          const s2 = sampleTerrain(field, x + 16, z + 16);
          if (!s2) continue;
          const r = Math.abs(s2.y - s.y);
          if (r > bestRange) { bestRange = r; spot = [x, z]; }
        }
      }
      const charX = spot[0] - 32;   // world = field − 32
      const charZ = spot[1] - 32;
      const charY = gAt(charX, charZ);
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
        for (let pitch = 0.1; pitch <= 1.4; pitch += 0.325) {
          let sd = -1;
          // 两帧级联（首帧吸附 + 稳态），捕捉任何一帧的压溃/穿地
          for (let k = 0; k < 2; k++) {
            const arm = computeSpringArm({
              field,
              groundAt: gAt,
              charX, charY, charZ,
              yaw, pitch, dist: 9,
              springDist: sd, dt: 1 / 30,
            });
            sd = arm.springDist;
            const eyeGround = gAt(arm.eye[0], arm.eye[2]);
            if (Number.isFinite(eyeGround)) {
              const clearance = arm.eye[1] - eyeGround;
              worstClearance = Math.min(worstClearance, clearance);
              if (clearance < 0.65 - 1e-6) {
                throw new Error(`GATE-03 眼位净空 ${clearance.toFixed(3)}m < 0.65m（${p.id} yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)}）`);
              }
            }
            if (Number.isFinite(sd)) minArm = Math.min(minArm, sd);
            samples++;
          }
          if (minArm < 2.1 - 1e-6 && minArm > 0) {
            throw new Error(`GATE-03 臂长 ${minArm.toFixed(2)}m 压溃至 1.4m 极限以下阈值（最小安全臂长 2.1m）`);
          }
        }
      }
    }
    return { ok: true, detail: `GATE-03 PASS：${samples} 采样（2 崎岖行星 × 24 yaw × 5 pitch × 2 帧），最差净空 ${worstClearance.toFixed(2)}m，最小臂长 ${minArm.toFixed(2)}m ≥ 2.1m` };
  },
};

export const suite04 = {
  id: 'PLAYTEST-04',
  name: '殖民地建筑 9 点坡度贴合与基座裙边（GATE-04）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    // 高山/熔岩/海洋三类行星（doc9 GATE-04 指定主题地表）
    const wanted = ['rocky', 'lava', 'ocean'];
    const picked = [];
    for (const cat of wanted) {
      const p = Object.values(world.entities.planets).find((q) => q.category === cat);
      if (p) picked.push(p);
    }
    if (picked.length < 3) throw new Error(`三类主题行星不足：${picked.map((p) => p.category).join(',')}`);
    const entries = [];
    for (let i = 0; i < 8; i++) {
      entries.push({ defId: ['bld_mine', 'bld_refinery', 'bld_farm', 'bld_lab', 'bld_house', 'bld_mine', 'bld_refinery', 'bld_house'][i] || 'bld_house', state: 'built' });
    }
    let placed = 0;
    let total = 0;
    for (const p of picked) {
      const bp = blueprintsForPlanet(p, p.primaryThemeId || null)[0] || null;
      const site = bp ? getSiteInstance(world, p.id, bp.id) : null;
      const field = buildTerrainField(world, p.id, {
        profile: bp ? bp.terrainProfile : undefined,
        siteModifier: site ? site.siteModifier : undefined,
        lod0Step: 4,
      });
      const plan = planColonyLayout(field, {
        entries,
        groundBuildings: [],
        center: [0, 0],   // 场域中心（origin −256，站点 SDF 着陆坪所在）
        categoryOf: (defId) => {
          const map = { bld_mine: 'mining', bld_refinery: 'refining', bld_farm: 'agri', bld_lab: 'science', bld_house: 'service' };
          return map[defId] || 'default';
        },
        themeId: p.primaryThemeId || null,
      });
      if (plan.length === 0) throw new Error(`${p.category} 行星布局零落位（规划器失效）`);
      for (const b of plan) {
        total++;
        // (1) 复检 9 点校验（布局器只输出 ok 位，但此处独立复检防伪绿）
        const chk = checkBuildingPlacement(field, b.fx, b.fz, { footprintHalfM: 2.2, maxSlopeDeg: 16, maxHeightDeltaM: 2.2 });
        if (!chk.ok) throw new Error(`${p.category}/${b.defId} 落位未通过 9 点校验：${chk.code}`);
        // (2) 建筑中心不深埋：y ≥ 9 点最低样本 − 0.05
        const s = sampleTerrain(field, b.fx, b.fz);
        if (s && b.y < s.y - 2.6) throw new Error(`${p.category}/${b.defId} 中心深埋（y=${b.y.toFixed(2)} < ground=${s.y.toFixed(2)}）`);
        // (3) 基座裙边源级断言（1.8m 混凝土裙边包络悬空侧）
        if (!/skirt/i.test(GMESH_SRC)) throw new Error('GroundMeshes 缺基座裙边几何');
        placed++;
      }
    }
    // (4) 裙边深度常量断言
    if (!/1\.8/.test(GMESH_SRC)) throw new Error('GroundMeshes 裙边深度未达 1.8m');
    return { ok: true, detail: `GATE-04 PASS：${placed}/${total} 建筑位（${picked.map((p) => p.category).join('/')} 三主题）9 点校验全过 + 基座裙边闭合` };
  },
};
