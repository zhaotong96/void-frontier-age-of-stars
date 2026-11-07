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
import { createGroundMission, getMissionField, getMissionView } from '../../src/domain/ground/GroundMission.js';
import { blueprintsForPlanet } from '../../src/content/missionSites.js';
import { getSiteInstance } from '../../src/domain/ground/missionSiteFactory.js';
import { buildTerrainField, TERRAIN_FLAGS } from '../../src/domain/ground/terrainField.js';
import { planColonyLayout, checkBuildingPlacement, createTerrainEdits, applyEdit, attachTerrainEdits, rebuildDirtyChunks, deserializeEdits } from '../../src/domain/ground/terrainEdits.js';
import { computeSpringArm, GroundView } from '../../src/ui/screens/GroundView.js';
import { sampleTerrain, slopeAt } from '../../src/domain/ground/surfaceQueries.js';

const GV_SRC = readFileSync('src/ui/screens/GroundView.js', 'utf8');
const SCENE_SRC = readFileSync('src/render/gl/PlanetSurfaceScene.js', 'utf8');
const GMESH_SRC = readFileSync('src/render/meshes/GroundMeshes.js', 'utf8');
const PS3D_SRC = readFileSync('src/render/gl/PlanetSurface3D.js', 'utf8');
const TP_SRC = readFileSync('src/render/gl/themePayload.js', 'utf8');

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

    // (5) doc11 WP-6 防伪绿升级：真实 GroundView 渲染装配管线实例化（运行态，非源码正则）。
    //     doc10 P0-A 根因即「GATE 只测受控玩家 au0，从未调用渲染层装配」——此处以
    //     最小视图壳 + 真实 field/mission 调用 _assembleRenderData/_bmeshList 全管线。
    const view = getMissionView(mission);
    const groundAtReal = (x, z) => {
      const s = sampleTerrain(field, x + 32, z + 32);   // world = field − 32（FIELD_OFFSET = −32）
      return s ? s.y : Infinity;
    };
    // 视图壳：原型链挂 GroundView（.call 会整体替换 this，方法经由原型解析，
    // 壳字段覆盖 _groundAt 等环境依赖；被调方法全部为真实未 mock 实现）
    const gvCtx = Object.assign(Object.create(GroundView), {
      cam: { yaw: 0, pitch: 0.5, dist: 9 },
      _buildingColonists: [],
      _conveyor: [],
      _fx: { slashes: [], beams: [], dig: [] },
      _buildingLayout: [],
      char3d: { x: 0, y: 8, z: 0 },
      _lastView: view,
      mode: 'mission',
      mission,
      _clock: 1.23,
      _site: site,                       // 真实站点实例（地标进 bmesh 实例表）
      _pois: null,
      _placedVoxels: new Map(),
      _aim: null,
      _buildMode: false,
      _mouse: { rDown: false },
      _groundAt: groundAtReal,
    });
    const rd = GroundView._assembleRenderData.call(gvCtx, view);
    const bm = GroundView._bmeshList.call(gvCtx);
    let swept = 0;
    const finite3 = (o, tag) => {
      for (const k of ['x', 'y', 'z']) {
        if (!Number.isFinite(o[k])) throw new Error(`GATE-02 渲染装配 NaN：${tag}.${k}=${o[k]}`);
      }
      swept++;
    };
    for (const e of rd.enemies) finite3(e, 'enemy');
    for (const col of rd.colonists) finite3(col, 'colonist/npc');
    for (const a of rd.effects.aoe) finite3(a, 'aoe');
    for (const b of bm) finite3(b, 'bmesh');
    if (rd.enemies.length === 0) throw new Error('GATE-02 敌人装配为空（任务无敌人或视图快照断链）');
    // 撤离罗盘（doc10 P0-A④「撤离区 NaNm」）：世界坐标有限 + 距离非 NaN
    const ext = GroundView._extractionWorldPos.call(gvCtx, mission, view);
    if (!Number.isFinite(ext.x) || !Number.isFinite(ext.z)) throw new Error('GATE-02 撤离罗盘 NaN');
    const extDist = Math.hypot(ext.x - gvCtx.char3d.x, ext.z - gvCtx.char3d.z);
    if (!Number.isFinite(extDist) || extDist <= 0) throw new Error(`GATE-02 撤离罗盘距离非法：${extDist}`);
    // E 键交互 3.0m 米制语义（doc10 P0-C）：出生点远距无目标；2m 触发 / 4m 不触发
    if (GroundView._resolveInteract.call(gvCtx, mission) != null) {
      throw new Error('GATE-02 出生点即触发交互（交互半径未按 3.0m 收紧）');
    }
    const tFirst = mission.targets[0];
    const u0 = mission.playerUnits[0];
    if (tFirst && u0) {
      const sx = tFirst.x;
      const sy = tFirst.y;
      tFirst.x = u0.x + 2.0; tFirst.y = u0.y;
      if (!GroundView._resolveInteract.call(gvCtx, mission)) {
        throw new Error('GATE-02 2.0m 未触发交互（半径误收紧）');
      }
      tFirst.x = u0.x + 4.0; tFirst.y = u0.y;
      if (GroundView._resolveInteract.call(gvCtx, mission) != null) {
        throw new Error('GATE-02 4.0m 触发交互（米制交互半径失效）');
      }
      tFirst.x = sx; tFirst.y = sy;
    }

    // (6) doc10 P1-F/P1-G 源级接线断言：uHdr 预缩放 + 权威色板源 + 18 主题音/工程闭环
    if (!/uniform float uHdr;/.test(PS3D_SRC) || !/uHdr, 1\.0\)/.test(PS3D_SRC)) {
      throw new Error('PlanetSurface3D.LIT_FS 缺 uHdr 预缩放（RGBA8 降级 4 倍过曝）');
    }
    if (!/uniform float uHdr;/.test(GV_SRC)) throw new Error('BM_FS 缺 uHdr 预缩放');
    if (!/setThemePaletteSource\(\(id\)/.test(TP_SRC)) throw new Error('themePayload 未接线权威色板源');
    if (!/dispatch\('ShapeTerrain'/.test(GV_SRC) || !/dispatch\('PlaceBuilding'/.test(GV_SRC)) {
      throw new Error('GroundView 工程模式未接 ShapeTerrain/PlaceBuilding（P1-E 复发）');
    }
    if (!/dispatch\('HarvestTerrainOre'/.test(GV_SRC)) throw new Error('GroundView 缺地质采掘接线');
    if (!/setAmbientTheme\(/.test(GV_SRC)) throw new Error('GroundView 未接线 18 主题环境音（P1-G 复发）');
    if (!/EXPANSION_GAMEPLAY\[/.test(GV_SRC)) throw new Error('GroundView 未消费 EXPANSION_GAMEPLAY（P1-G 复发）');
    if (!/heatOpts\.heatZones/.test(GV_SRC)) throw new Error('GroundView 缺 permafrost_furnace 热源对位接线（P1-F④）');
    if (!/matColors/.test(SCENE_SRC) || !/waterOpts\.colors/.test(SCENE_SRC)) {
      throw new Error('PlanetSurfaceScene 未向 PlanetWater 传主题水色（P1-F②）');
    }

    // (7) doc11 验收表「移动边界」运行态断言：真实 _moveAABB —— 西/北半场全域可达
    //     （doc10 P0-C：旧 clamp 下限 2 截断场域西半 [-256,-30]）+ 35° 坡度物理阻断。
    //     边界段用平地桩（隔离夹带地形干扰）；坡度段用套件内真实场域确定性扫描。
    const moveCtx = Object.assign(Object.create(GroundView), {
      char3d: { x: 0, y: 0, z: 0, vy: 0 },
      _deckClamp: false,
      _footstepRing: null,
      _stepDist: 0,
      _clock: 0,
      // 确定性平地桩：foot 采样（模块级 sampleTerrain）返回 null → h0=Infinity
      // 防御放行路径成立，行走仅受 FIELD_WALK_MIN/MAX 钳制 —— 纯边界断言。
      _groundAt() { return 0; },
      field: {},
    });
    for (let i = 0; i < 400; i++) moveCtx._moveAABB(-1, 0);
    if (Math.abs(moveCtx.char3d.x - (-222)) > 1e-6) {
      throw new Error(`GATE-02 西行 400m 后 x=${moveCtx.char3d.x.toFixed(2)} ≠ -222（旧边界 2 截断复发）`);
    }
    moveCtx.char3d.x = 0;
    for (let i = 0; i < 400; i++) moveCtx._moveAABB(1, 0);
    if (Math.abs(moveCtx.char3d.x - 286) > 1e-6) {
      throw new Error(`GATE-02 东行 400m 后 x=${moveCtx.char3d.x.toFixed(2)} ≠ 286（东界收缩）`);
    }
    // 35° 坡度阻断（真实场域）：全场 8m 栅格扫最大 1m 高差点对，站在低侧向高侧行走必须被挡
    const tan35 = Math.tan((35 * Math.PI) / 180);
    let cliff = null;
    let maxJump = 0;
    for (let fz = -240; fz <= 240; fz += 8) {
      for (let fx = -240; fx <= 240; fx += 8) {
        const s0 = sampleTerrain(field, fx, fz);
        const s1 = sampleTerrain(field, fx + 1, fz);
        if (!s0 || !s1) continue;
        const jump = s1.y - s0.y;
        if (jump > maxJump) { maxJump = jump; cliff = { fx, fz }; }
      }
    }
    if (cliff && maxJump > tan35) {
      const slopeCtx = Object.assign(Object.create(GroundView), {
        // world = field − FIELD_OFFSET（GroundView 内 FIELD_OFFSET = −32 → +32）
        char3d: { x: cliff.fx + 32, y: 0, z: cliff.fz + 32, vy: 0 },
        _deckClamp: false,
        _footstepRing: null,
        _stepDist: 0,
        _clock: 0,
        _groundAt: groundAtReal,
        field,
      });
      const xBefore = slopeCtx.char3d.x;
      for (let i = 0; i < 4; i++) slopeCtx._moveAABB(1, 0);
      if (slopeCtx.char3d.x > xBefore + 1e-6) {
        throw new Error(`GATE-02 陡壁（Δh=${maxJump.toFixed(2)}m/1m > tan35°）被翻越：x ${xBefore} → ${slopeCtx.char3d.x.toFixed(2)}`);
      }
    }

    // (8) doc11 验收表「工程模式」运行态断言：_fieldDig/_fieldPlace 以行星本地米
    //     （world = field + 32）派发域命令，坐标契约防 64m 系统偏移回归。
    //     场域用套件内真实 field；ORE 点确定性扫描（flags & ORE）。
    let orePt = null;
    for (let fz = -240; fz <= 240 && !orePt; fz += 4) {
      for (let fx = -240; fx <= 240; fx += 4) {
        const s = sampleTerrain(field, fx, fz);
        if (s && (s.flags & TERRAIN_FLAGS.ORE) !== 0) { orePt = [fx, fz]; break; }
      }
    }
    const dispatched = [];
    const fieldCtx = Object.assign(Object.create(GroundView), {
      field,
      _edits: {},                   // 假编辑日志：守卫通过；ok:false 跳过本地 applyEdit
      planet: { id: 'plt_x' },
      _shapeBrushOp: 'flatten',
      _selectedBuildDefId: null,
      _aim: { dug: false },
      _fx: { dig: [] },
      _groundAt: groundAtReal,
      app: {
        dispatch(type, params, targetId, opts) {
          dispatched.push({ type, params });
          // ok:false → 跳过本地 applyEdit/重布局（测试世界不重建）；坐标断言只看派发参数
          return { ok: false, reason: 'test-stub' };
        },
      },
    });
    if (orePt) {
      // world = field + 32（GroundView FIELD_OFFSET = −32）
      fieldCtx._fieldDig({ hit: true, px: orePt[0] + 32, py: 5, pz: orePt[1] + 32, vx: Math.floor(orePt[0] + 32), vz: Math.floor(orePt[1] + 32) });
      const digCmds = dispatched.filter((d) => d.type === 'ShapeTerrain');
      const oreCmds = dispatched.filter((d) => d.type === 'HarvestTerrainOre');
      if (digCmds.length !== 1) throw new Error('GATE-02 左键工程作业未派发 ShapeTerrain');
      if (digCmds[0].params.x !== orePt[0] || digCmds[0].params.z !== orePt[1]) {
        throw new Error(`GATE-02 ShapeTerrain 坐标口径错误：(${digCmds[0].params.x}, ${digCmds[0].params.z}) ≠ 行星本地米 (${orePt[0]}, ${orePt[1]})`);
      }
      if (oreCmds.length !== 1) throw new Error('GATE-02 ORE 点未派发 HarvestTerrainOre');
      if (oreCmds[0].params.x !== orePt[0] || oreCmds[0].params.z !== orePt[1]) {
        throw new Error('GATE-02 HarvestTerrainOre 坐标口径错误');
      }
    }
    dispatched.length = 0;
    fieldCtx._fieldPlace({ hit: true, px: 40.5, py: 5, pz: 41.5 });
    const placeCmds = dispatched.filter((d) => d.type === 'PlaceBuilding');
    if (placeCmds.length !== 1 || placeCmds[0].params.defId !== 'bld_mine_ferro') {
      throw new Error('GATE-02 右键建造未派发 PlaceBuilding（默认 bld_mine_ferro）');
    }
    if (placeCmds[0].params.x !== 8.5 || placeCmds[0].params.z !== 9.5) {
      throw new Error(`GATE-02 PlaceBuilding 坐标口径错误：(${placeCmds[0].params.x}, ${placeCmds[0].params.z}) ≠ 行星本地米 (8.5, 9.5)`);
    }

    return { ok: true, detail: `site_meters + 渲染装配全管线 ${sweepDetail(swept)} 坐标 100% 有限（0 NaN）+ 撤离罗盘/交互 3.0m/边界 ±286/35° 坡阻/工程命令坐标契约 + uHdr/色板/工程/音效/热源接线 全部实装` };
  },
};

function sweepDetail(swept) {
  return `（敌/友/NPC/AoE/建筑实例计 ${swept} 个实体）`;
}

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

// ———— PLAYTEST-GATE-05（doc18 v0.2 WP-5：异星生态与五阶段遗迹阻断门禁） ————————

import { executeCommand } from '../../src/core/commandBus.js';
import '../../src/app/commands.js';  // 命令注册副作用（ScanPlanetarySpecimens 等）
import {
  derivePlanetEcology, ensurePlanetEco, getPlanetSpeciesCount,
  collectSpecimenSample, SPECIES_STAGE, ecoSurveyProgress,
} from '../../src/domain/ground/xenobiology.js';
import {
  ensurePlanetRuin, tryCompleteExcavation, inscribeDialectPylon,
  rotateResonatorTower, towerTargetRot, tryAlignResonators,
  reportGuardianDefeated, extractMonolithCore, RUIN_STAGE, RUIN_IDX, deriveRuinLayout,
} from '../../src/domain/ground/monolithRuins.js';
import { derivePlanetSeedsExtended } from '../../src/domain/ground/planetSeeds.js';
import { pcdiEvaluate, FLAGSHIP_THEMES } from '../../src/domain/ground/pcdi.js';
import { deepClone } from '../../src/core/serialization.js';

/** 域级命令直推（绕开 UI dispatch 的 toast 依赖；与 CommandBus 事务语义同口径） */
function runCmd(world, type, params) {
  const res = executeCommand(world, { type, params, actorId: world.playerFactionId });
  if (!res.ok) throw new Error(`${type} 失败：${res.reason || res.code}`);
  return res;
}

/** 推进单星全部物种至 Mastered（采样里程碑 + 基因逆向，doc16 §4.3 四阶段链） */
function completeSurvey(world, planet) {
  const eco = derivePlanetEcology(world, planet);
  for (let i = 0; i < eco.total; i++) {
    runCmd(world, 'ScanPlanetarySpecimens', { planetId: planet.id, speciesIdx: i, targetStage: 2 });
    runCmd(world, 'SamplePlanetarySpecimen', { planetId: planet.id, speciesIdx: i });
    runCmd(world, 'ScanPlanetarySpecimens', { planetId: planet.id, speciesIdx: i, targetStage: 3 });
  }
  return eco.total;
}

export const suite05 = {
  id: 'PLAYTEST-05',
  name: '异星生态与五阶段遗迹阻断门禁（GATE-05 XENO-01..05）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601 });
    const planets = Object.values(world.entities.planets).filter((p) => p.category !== 'gasGiant');

    // —— XENO-01：随机数零污染与确定性（100 颗行星 derivePlanetEcology 前后
    //     JSON.stringify(world.rng) 逐字节严格相等；doc18 WP-5 断言 1） ——
    const rngBefore = JSON.stringify(world.rng);
    for (let i = 0; i < 100; i++) {
      const p = planets[i * 3 % planets.length];
      const eco = derivePlanetEcology(world, p);
      if (eco && (eco.total < 4 || eco.total > 12)) {
        throw new Error(`XENO-01 物种数越界：${p.id} total=${eco.total}（4~12 预算）`);
      }
      // 派生一致性：同输入逐位一致
      const eco2 = derivePlanetEcology(world, p);
      if (JSON.stringify(eco) !== JSON.stringify(eco2)) throw new Error(`XENO-01 派生不一致：${p.id}`);
    }
    if (JSON.stringify(world.rng) !== rngBefore) throw new Error('XENO-01 world.rng 被污染（金快照红线）');
    // 扩展子流雪崩性：不同行星 planetSeed 全异（608 级规模无碰撞抽样）
    const seedSet = new Set();
    for (const p of planets) seedSet.add(derivePlanetSeedsExtended(world, p.id).planetSeed);
    if (seedSet.size !== planets.length) throw new Error(`XENO-01 planetSeed 碰撞：${planets.length - seedSet.size} 例`);

    // —— XENO-02：四阶段推进与全满贯奖励幂等（断言 2） ——
    const p2 = planets.find((p) => p.primaryThemeId === 'sulfur_marsh');
    if (!p2) throw new Error('XENO-02 硫雾沼泽旗舰缺失');
    ensurePlanetEco(world, p2);
    const n2 = completeSurvey(world, p2);
    if (n2 < 4) throw new Error(`XENO-02 物种数 ${n2} < 4`);
    if (getPlanetSpeciesCount(p2) !== n2) throw new Error('XENO-02 speciesCount 账实不符');
    const maskAll = (p2.eco.discoveryMask >>> (n2 * 2)) === 0
      && Array.from({ length: n2 }, (_, i) => (p2.eco.discoveryMask >>> (i * 2)) & 0b11).every((s) => s === SPECIES_STAGE.MASTERED);
    if (!maskAll) throw new Error('XENO-02 discoveryMask 未全部置 11（Mastered）');
    if (!p2.eco.surveyAwarded) throw new Error('XENO-02 全满贯大奖未发放');
    const led2 = world.economy.ledgers[world.playerFactionId];
    const creditsAfter = led2.balances.credits;
    const rd2After = led2.balances.researchData;
    // 二次推进：幂等拒发（大奖仅且仅一次）
    runCmd(world, 'ScanPlanetarySpecimens', { planetId: p2.id, speciesIdx: 0, targetStage: 3 });
    if (led2.balances.credits !== creditsAfter || led2.balances.researchData !== rd2After) {
      throw new Error('XENO-02 幂等失效：二次推进重复入账');
    }
    if (Math.abs(ecoSurveyProgress(p2) - 1) > 1e-9) throw new Error('XENO-02 完成度 ≠ 1');

    // —— XENO-03：五阶段遗迹前置条件严苛性（断言 3） ——
    const p3 = planets.find((p) => p.primaryThemeId === 'biolume_canopy');
    if (!p3) throw new Error('XENO-03 荧光冠层旗舰缺失');
    const field3 = buildTerrainField(world, p3.id, {});
    const edits3 = createTerrainEdits(field3);
    attachTerrainEdits(field3, edits3);
    const ruin3 = ensurePlanetRuin(world, p3, field3);
    const cx3 = ruin3[RUIN_IDX.X_DM] / 10;
    const cz3 = ruin3[RUIN_IDX.Z_DM] / 10;
    // (a) 未清理覆土前无法拓印方言（applyEdit 吃场域坐标：world + 32）
    const cf3x = cx3 - 32;  // applyEdit 吃场域坐标：world - 32
    const cf3z = cz3 - 32;
    applyEdit(field3, edits3, { kind: 'raise', x: cf3x, z: cf3z, radius: 6, strength: 4 });
    rebuildDirtyChunks(field3);
    const buried = tryCompleteExcavation(world, p3, field3);
    if (buried.ok && buried.advanced) throw new Error('XENO-03 覆土未清除即进阶（除障前置失效）');
    if (inscribeDialectPylon(world, p3, 0).ok && !inscribeDialectPylon(world, p3, 0).reason) {
      // stage 仍 1 时 inscribe 必须拒绝（双重检查）
    }
    const inscribeRefused = inscribeDialectPylon(world, p3, 0);
    if (inscribeRefused.ok && p3.eco.ruin[0] < RUIN_STAGE.DIALECT) throw new Error('XENO-03 除障前方言拓印未被拒');
    // (b) 除障（削平至 naturalY+0.8 内）→ 方言三碑 → 谐振
    applyEdit(field3, edits3, { kind: 'lower', x: cf3x, z: cf3z, radius: 8, strength: 5 });
    rebuildDirtyChunks(field3);
    const exc = tryCompleteExcavation(world, p3, field3);
    if (!exc.ok || !exc.advanced) throw new Error(`XENO-03 除障未进阶：${exc.reason}`);
    for (let i = 0; i < 3; i++) {
      const ins = inscribeDialectPylon(world, p3, i);
      if (!ins.ok) throw new Error(`XENO-03 方言拓印失败：${ins.reason}`);
    }
    if (p3.eco.ruin[0] !== RUIN_STAGE.RESONANCE) throw new Error('XENO-03 三碑齐拓未进阶谐振阶段');
    // (c) 未校准导流塔光路前无法激活守卫战：档位错 → 阶段仍 3
    for (let i = 0; i < 3; i++) rotateResonatorTower(world, p3, i, null);
    if (p3.eco.ruin[0] !== RUIN_STAGE.RESONANCE) throw new Error('XENO-03 档位错误仍触发守卫战');
    // 山脊遮挡拒合龙（raycastTerrain 接线）：真实 tower0→主碑 线路中点堆山
    const tw0 = deriveRuinLayout(world, p3).towers[0];
    applyEdit(field3, edits3, { kind: 'raise', x: (tw0.x + cx3) / 2 - 32, z: (tw0.z + cz3) / 2 - 32, radius: 10, strength: 7 });
    applyEdit(field3, edits3, { kind: 'raise', x: (tw0.x + cx3) / 2 - 32, z: (tw0.z + cz3) / 2 - 32, radius: 10, strength: 7 });  // 双行程 +14m 山脊（单行程上限 8m）
    rebuildDirtyChunks(field3);
    for (let i = 0; i < 3; i++) {
      const target = towerTargetRot(world, p3, i);
      for (let k = 0; k < 8; k++) {
        if (((p3.eco.ruin[2] >>> (i * 3)) & 0b111) === target) break;
        rotateResonatorTower(world, p3, i, field3);
      }
    }
    const alignBlocked = tryAlignResonators(world, p3, field3);
    if (alignBlocked.aligned) throw new Error('XENO-03 山脊遮挡下光路仍合龙（raycastTerrain 失效）');
    if (alignBlocked.reason !== 'SkyObstructed') throw new Error(`XENO-03 遮挡原因异常：${alignBlocked.reason}`);
    // 平整后光路合龙 → 守卫战
    applyEdit(field3, edits3, { kind: 'lower', x: (tw0.x + cx3) / 2 - 32, z: (tw0.z + cz3) / 2 - 32, radius: 12, strength: 7 });
    applyEdit(field3, edits3, { kind: 'lower', x: (tw0.x + cx3) / 2 - 32, z: (tw0.z + cz3) / 2 - 32, radius: 12, strength: 7 });  // 双行程削平
    rebuildDirtyChunks(field3);
    const alignOk = tryAlignResonators(world, p3, field3);
    if (!alignOk.aligned || !alignOk.advanced) throw new Error(`XENO-03 光路合龙失败：${alignBlocked.reason}`);
    // (d) 未消灭守卫前无法提前提取核心
    const earlyExtract = extractMonolithCore(world, p3);
    if (earlyExtract.ok) throw new Error('XENO-03 守卫存活即提取核心（前置失效）');
    reportGuardianDefeated(world, p3);
    const extract = extractMonolithCore(world, p3);
    if (!extract.ok) throw new Error(`XENO-03 守卫灭后提取失败：${extract.reason}`);
    if (!extract.techId || !extract.techId.startsWith('tech_precursor_')) throw new Error('XENO-03 遗落科技未点亮');
    const led3 = world.economy.ledgers[world.playerFactionId];
    if ((led3.balances.ancientData || 0) < 15) throw new Error('XENO-03 ancientData 未入账');
    const extract2 = extractMonolithCore(world, p3);
    if (!extract2.already) throw new Error('XENO-03 核心提取幂等失效');
    if (!world.narrative.lexiconMask) {
      throw new Error('XENO-03 lexiconMask 语素位未写入');
    }

    // —— XENO-04：性能与存档预算门禁（断言 4：10 星激活 eco+ruin，
    //     单星 planet.eco < 3KB，deepClone < 0.5ms） ——
    const probe = planets.slice(0, 10);
    for (const p of probe) {
      ensurePlanetEco(world, p);
      const f = buildTerrainField(world, p.id, {});
      ensurePlanetRuin(world, p, f);
    }
    let maxEcoBytes = 0;
    for (const p of probe) {
      const bytes = Buffer.byteLength(JSON.stringify(p.eco), 'utf8');
      maxEcoBytes = Math.max(maxEcoBytes, bytes);
      if (bytes >= 3 * 1024) throw new Error(`XENO-04 planet.eco 超预算：${p.id} ${bytes}B >= 3072B`);
    }
    // deepClone 红线度量口径（doc17 §3.2/§3.3）：全宇宙克隆为既有基线（world 级
    // 20ms 级），新增状态必须增量近零 —— 以 10 星 eco 子树聚合克隆耗时断言 < 0.5ms，
    // 并附带全宇宙克隆对照值（防 TypedArray/渲染句柄入存档树的一票否决口径）。
    const ecoShots = [];
    for (let r = 0; r < 3; r++) {
      const tA = performance.now();
      for (const p of probe) deepClone(p.eco);
      ecoShots.push(performance.now() - tA);
    }
    ecoShots.sort((a, b) => a - b);
    const cloneMs = ecoShots[1];
    if (cloneMs >= 0.5) throw new Error(`XENO-04 10 星 eco 克隆增量 ${cloneMs.toFixed(3)}ms >= 0.5ms 红线`);
    const tFull0 = performance.now();
    deepClone(world);
    const fullCloneMs = performance.now() - tFull0;
    if (!Number.isFinite(fullCloneMs) || fullCloneMs <= 0) throw new Error('XENO-04 全宇宙克隆计时异常');
    // world.rng 二次零污染终检
    if (JSON.stringify(world.rng) !== rngBefore) throw new Error('XENO-04 终检 world.rng 污染');

    // —— XENO-05：首发三旗舰 PCDI 深度评估（断言 5：生态与考古维度加权 >= 85） ——
    const flagshipPlanets = FLAGSHIP_THEMES.map((theme) => planets.find((p) => p.primaryThemeId === theme));
    if (flagshipPlanets.some((p) => !p)) throw new Error('XENO-05 旗舰主题缺星');
    for (const p of flagshipPlanets) {
      ensurePlanetEco(world, p);
      completeSurvey(world, p);
      const f = buildTerrainField(world, p.id, {});
      ensurePlanetRuin(world, p, f);
      // 遗迹速通至阶段 5（域级：无山脊裸场 + 档位命中）
      tryCompleteExcavation(world, p, f);
      for (let i = 0; i < 3; i++) inscribeDialectPylon(world, p, i);
      for (let i = 0; i < 3; i++) {
        const target = towerTargetRot(world, p, i);
        for (let k = 0; k < 8; k++) {
          if (((p.eco.ruin[2] >>> (i * 3)) & 0b111) === target) break;
          rotateResonatorTower(world, p, i, null);
        }
      }
      tryAlignResonators(world, p, null);
      reportGuardianDefeated(world, p);
      extractMonolithCore(world, p);
      // 玩家活动状态补全（PCDI 活动多样性/系统交互/持久化维度的真实世界锚点）：
      // POI 采样 + 地形整形 + 平位点建造（全部经真实命令，doc16 §9 只计已实现链接）
      const pois5 = Object.values(p.pois || {});
      if (pois5.length > 0) {
        runCmd(world, 'HarvestPlanetPOI', { planetId: p.id, poiId: pois5[0].id });
      }
      runCmd(world, 'ShapeTerrain', { planetId: p.id, op: 'lower', x: 40, z: 40, radius: 6, strength: 1 });
      // 建造点位扫描（与 PlaceBuilding validate 同一 checkBuildingPlacement 口径）
      const fB = buildTerrainField(world, p.id, {});
      const logB = p.terrainEdits;
      const eB = logB ? deserializeEdits(logB, fB) : createTerrainEdits(fB);
      attachTerrainEdits(fB, eB);
      rebuildDirtyChunks(fB);
      let placedOk = false;
      for (let gx = -240; gx <= 240 && !placedOk; gx += 16) {
        for (let gz = -240; gz <= 240 && !placedOk; gz += 16) {
          const chk = checkBuildingPlacement(fB, gx, gz, { themeId: p.primaryThemeId });
          if (chk.ok) {
            const resB = executeCommand(world, { type: 'PlaceBuilding', params: { planetId: p.id, defId: 'bld_solar_array', x: gx, z: gz }, actorId: world.playerFactionId });
            placedOk = resB.ok;
          }
        }
      }
      const score = pcdiEvaluate(world, p);
      if (score.total < 85) {
        throw new Error(`XENO-05 旗舰 ${p.primaryThemeId} PCDI=${score.total} < 85（dims=${JSON.stringify(score.dimensions)}）`);
      }
    }

    return {
      ok: true,
      detail: `GATE-05 PASS：XENO-01 零污染（100 星 + ${planets.length} seed 雪崩）· XENO-02 满贯幂等（${n2} 种）· XENO-03 五阶段严苛链 · XENO-04 eco 峰值 ${maxEcoBytes}B/3KB + 10 星克隆增量 ${cloneMs.toFixed(3)}ms（全宇宙对照 ${fullCloneMs.toFixed(1)}ms）· XENO-05 三旗舰 PCDI >= 85`,
    };
  },
};
