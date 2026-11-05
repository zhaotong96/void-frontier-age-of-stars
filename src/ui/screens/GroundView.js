/**
 * ui/screens/GroundView.js — 行星地表 3D 视图（返工 Phase R8 门禁闭合）
 *
 * 全 3D 重写：消费 SurfaceSandbox 体素世界与 PlanetSurface3D GL 渲染器，
 * 提供第三人称外骨骼地表行动（任务模式）与自由探索沙盒（采掘/建造）。
 *
 * 结构：
 *  - 简报页：行星选择（玩家殖民地）+ 任务模板列表 + 开始行动 + 自由探索模式；
 *  - 任务模式：createGroundMission 建立任务实体；视图持有固定步长累加器
 *    （dt = 1/30）驱动 stepMission，输入以「瞬态控制通道」逐帧直写
 *    mission.input（不经命令总线，见 ARCHITECTURE.md 的输入流约定）；
 *  - 自由模式：不创建任务，视图侧本地状态机 + 体素 AABB 物理，纯沙盒挖掘/建造；
 *  - 渲染：CanvasManager 三层画布（GL 场景 + 2D HUD）；每帧
 *    beginGLFrame → PlanetSurface3D.draw（≤8 draw call）→ 建筑网格批处理
 *    （buildBuildingMesh(category) 十类别图集 + 选择框，1 draw call）→
 *    endGLFrame（HDR Bloom 合成）→ 2D HUD。
 *
 * 控制器（第三人称弹簧臂）：
 *  - 右键拖拽旋转 yaw/pitch；滚轮缩放 dist 3..14（防穿模 DDA 收臂由渲染器内完成）；
 *  - WASD/方向键相机相对移动，Shift 冲刺；空格点按跳跃（初速 √(2g·1.2)）并同时
 *    触发任务 FSM 的闪避（dodgeDir），空格长按喷气悬停（耗喷气燃料）；
 *  - 体素 AABB 碰撞（脚底/头顶体素检测，轴分离滑行）；重力 g = planet.gravity × 9.8。
 *
 * 技能栏（数字键 1..6，与 GroundMission 的动作参数对齐）：
 *  1 等离子快斩（light，伤害 22，前摇 0.28s） 2 震地重劈（heavy，×2，前摇 0.5s）
 *  3 磁轨射击（ranged，需射程 + 视线） 4 偏导护盾格挡（block 0.25s 判定窗，耗耐 15）
 *  5 纳米采掘/建造（左键挖 / 右键建，矿体入账殖民地仓储） 6 小队指令（跟随/集火/散开）
 *
 * 门禁 5（体素/建筑/传送带）：
 *  - 采掘：准星 DDA 命中 → digVoxel → ps3d.digChunk 增量重建 → creditColony 入账；
 *  - 建造：命中面法向相邻格 placeVoxel(BUILDING) → digChunk（殖民地扣 1 合金/格）；
 *  - 建筑：殖民地建筑与建造队列按 buildBuildingMesh(category) 的 3D 网格渲染
 *    （十类别实例图集；R8 渲染器交付契约中的单位盒管线让渡给传送带货箱）；
 *  - 传送带：采掘建筑 → 最近精炼建筑自动生成 conveyor.paths，
 *    PlanetSurface3D 沿路径匀速滑动实例化货箱。
 *
 * 约束：确定性（全程无 Math.random，视觉相位由索引常数派生）；
 * 不修改 domain/simulation 任何文件；unmount 释放全部监听/GL/DOM 资源。
 */

import { el } from '../components/dom.js';
import { panel } from '../components/panels.js';
import { showModal, toast } from '../components/index.js';
import { L } from '../../core/i18n.js';
import { CanvasManager } from '../../render/CanvasManager.js';
import { PlanetSurface3D } from '../../render/gl/PlanetSurface3D.js';
import { PlanetSurfaceScene } from '../../render/gl/PlanetSurfaceScene.js';
import { buildThemePayload } from '../../render/gl/themePayload.js';
import { mat4, mat4Perspective, mat4LookAt, mat4Multiply } from '../../render/gl/Mat4.js';
import { buildBuildingMesh, buildUnitBox } from '../../render/meshes/GroundMeshes.js';
import { buildLandmarkMesh, LANDMARK_PREFAB_IDS } from '../../render/meshes/landmarkMeshes.js';
import {
  createSurfaceWorld, digVoxel, placeVoxel, getVoxel, ddaRaycast, getSurfaceHeight,
  SURFACE_SIZE, SURFACE_MAT,
} from '../../domain/ground/SurfaceSandbox.js';
import { buildTerrainField } from '../../domain/ground/terrainField.js';
import { ensurePlanetPois, unexploredPoiCount } from '../../domain/ground/planetPOI.js';
import { createTerrainEdits, applyEdit, attachTerrainEdits, deserializeEdits, rebuildDirtyChunks, planColonyLayout } from '../../domain/ground/terrainEdits.js';
import { sampleTerrain, raycastTerrain } from '../../domain/ground/surfaceQueries.js';
import { createGroundMission, stepMission, getMissionView } from '../../domain/ground/GroundMission.js';
import { getSiteInstance } from '../../domain/ground/missionSiteFactory.js';
import { blueprintsForPlanet } from '../../content/missionSites.js';
import { creditColony, debitColony } from '../../domain/economy/ledger.js';
import { MISSION_TEMPLATES, findMissionTemplate } from '../../content/missions.js';
import { BUILDINGS } from '../../content/buildings.js';

// ———— 常量 ————————————————————————————————————————————————

/** GroundMission 的像素格边长（mission 内部坐标 → 体素世界线性映射用） */
const TS = 24;
/** 固定步长（与 GroundMission DT_DEFAULT 一致）与单帧最大步数 */
const STEP = 1 / 30;
const MAX_STEPS_PER_FRAME = 5;

/** 角色碰撞体（体素单位） */
const PLAYER_HALF = 0.32;
const PLAYER_HEIGHT = 1.7;
/** 相机臂长范围（渲染器内部另有 2.5..26 的钳制与 DDA 收臂） */
const CAM_DIST_MIN = 3;
const CAM_DIST_MAX = 14;

/** 采掘/建造节流（秒）与准星射线距离（体素） */
const DIG_INTERVAL = 0.2;
const PLACE_INTERVAL = 0.25;
const AIM_REACH = 7.0;

/**
 * 场域集成（doc7 TASK-1.2/1.4，Phase 1 垂直切片）：
 * 连续三角网格场域 512m×512m（terrainField，origin −256，覆盖 [−256,+256]），
 * 体素世界 64×64m 资源补丁居中场域中心 —— 体素单位 ≈ 米（1:1 人类尺度），
 * 场域坐标 = 体素坐标 + FIELD_OFFSET（体素中心 32 → 场域中心 0）。
 * 角色/单位/建筑等玩法坐标保持体素空间；查询场域高度/射线时 +FIELD_OFFSET。
 */
const FIELD_OFFSET = -32;
/**
 * P0-1 竖直动力学纯函数（doc9 §3.1 蓝本；GATE-01 全银河 3648 场无头仿真与实机同源）：
 * 接触冲量铁律（deficit ≥ 0 → vy < 0 无条件清零）、大落差硬吸附（>1.5m）、
 * 有限爬坡（14 m/s）、下坡微吸附（0.08m）、终端速度截断（-28 / 潜水 -2.2）、
 * 越界就地挽救（y < -45 就地回地表，杜绝橡皮筋）。
 * @param {object} st { y, vy, onGround, ground, g, dt, jump, hovering, diving, thruster,
 *                       fuel, jetDrain, jetRegen, diveGrav, diveTerminal, thrusterVY }
 * @returns {{y:number, vy:number, onGround:boolean, fuel:number}}
 */
export function stepCharacterVertical(st) {
  let y = st.y;
  let vy = st.vy;
  let onGround = st.onGround;
  let fuel = st.fuel;
  const ground = Number.isFinite(st.ground) ? st.ground : 0.0;
  const dt = st.dt;
  const jetDrain = st.jetDrain != null ? st.jetDrain : JET_DRAIN;
  const jetRegen = st.jetRegen != null ? st.jetRegen : JET_REGEN;
  const diveGrav = st.diveGrav != null ? st.diveGrav : FLUID_DIVE_GRAV;
  const diveTerminal = st.diveTerminal != null ? st.diveTerminal : FLUID_DIVE_TERMINAL;
  const thrusterVY = st.thrusterVY != null ? st.thrusterVY : FLUID_THRUSTER_VY;
  if (st.jump && onGround) {
    vy = Math.sqrt(2 * st.g * 1.35);
    onGround = false;
  }
  if (st.diving) {
    if (st.thruster && fuel > 0) {
      fuel = Math.max(0, fuel - jetDrain * dt);
      vy = Math.min(vy + thrusterVY * dt * 6, thrusterVY);
    } else {
      vy = Math.max(vy - st.g * diveGrav * dt, diveTerminal);
      fuel = Math.min(100, fuel + jetRegen * dt);
    }
  } else if (st.hovering) {
    fuel = Math.max(0, fuel - jetDrain * dt);
    vy = Math.max(vy - st.g * dt * 0.12, -0.7);
  } else if (!onGround) {
    vy = Math.max(vy - st.g * dt, -28.0);
    fuel = Math.min(100, fuel + jetRegen * dt);
  } else {
    vy = 0;
    fuel = Math.min(100, fuel + jetRegen * dt);
  }
  y += vy * dt;
  const deficit = ground - y;
  if (deficit >= 0) {
    if (vy < 0) vy = 0;               // 接触冲量铁律：切断重力发散逃逸闭环
    onGround = true;
    if (deficit > 1.5) {
      y = ground;                     // 大落差直接吸附
    } else {
      y = Math.min(ground, y + 14.0 * dt);
      if (ground - y < 0.02) y = ground;
    }
  } else if (y > ground + 0.08) {
    onGround = false;
  } else if (vy <= 0) {
    y = ground;                       // 下坡微吸附
    vy = 0;
    onGround = true;
  }
  if (!Number.isFinite(y) || y < -45) {
    y = ground;                       // 越界就地挽救（杜绝橡皮筋）
    vy = 0;
    onGround = true;
  }
  return { y, vy, onGround, fuel };
}

/**
 * P1-1 弹簧臂相机纯函数（doc9 §3.2 蓝本；GATE-03 无头 360° 扫描与实机同源）：
 * 第一层 注视锚点地表托底；第二层 射线起点外推 0.35m + hit.t>0.08 守卫 + 最小臂长 2.1m；
 * 非对称阻尼（快收 18 / 慢放 5.5）；第三层 眼位离地净空 ≥0.65m。
 * @returns {{tgt:number[], eye:number[], springDist:number}}
 */
export function computeSpringArm(o) {
  const cp = Math.cos(o.pitch);
  const sp = Math.sin(o.pitch);
  const sy = Math.sin(o.yaw);
  const cy = Math.cos(o.yaw);
  const charGround = o.groundAt(o.charX, o.charZ);
  const safeBaseY = Number.isFinite(charGround) ? Math.max(o.charY, charGround) : o.charY;
  const tgt = [o.charX, safeBaseY + 1.55, o.charZ];
  const dir = [cp * sy, sp, cp * cy];
  let want = clamp(o.dist, 2.5, 26);
  if (o.field) {
    const rayStart = [
      tgt[0] + dir[0] * 0.35 + FIELD_OFFSET,
      tgt[1] + dir[1] * 0.35,
      tgt[2] + dir[2] * 0.35 + FIELD_OFFSET,
    ];
    const hit = raycastTerrain(o.field, rayStart, dir, want + 0.4);
    if (hit.hit && hit.t > 0.08) {
      want = Math.max(2.1, hit.t + 0.35 - 0.55);
    }
  }
  let sd = o.springDist;
  if (sd < 0) sd = want;
  const dampRate = want < sd ? 18.0 : 5.5;
  sd += (want - sd) * (1 - Math.exp(-o.dt * dampRate));
  const eye = [tgt[0] + dir[0] * sd, tgt[1] + dir[1] * sd, tgt[2] + dir[2] * sd];
  const eyeGround = o.groundAt(eye[0], eye[2]);
  if (Number.isFinite(eyeGround) && eye[1] < eyeGround + 0.65) {
    eye[1] = eyeGround + 0.65;
  }
  return { tgt, eye, springDist: sd };
}

/** 采掘凹陷每击深度（米）：场域地形雕刻（TERRAIN-06 增量重建演示） */
const DIG_DENT_DEPTH = 1.2;
/** 场域行走坡度阻断阈值（Δh/Δx > 此值的陡壁不可步行） */
const WALK_SLOPE_BLOCK = 1.6;
/** 场域可行走范围（体素坐标；对应场域 [−256,+256] 边界内收 2m） */
const FIELD_WALK_MAX = 286;

/** 喷气背包（本地燃料池；任务模式的耐力由 domain 权威，视图不回写） */
const JET_DRAIN = 22;
const JET_REGEN = 12;

/** 近战基础伤害（light；与 GroundMission playerUnits.meleeDmg 对齐，heavy ×2） */
const MELEE_DAMAGE = 22;
/** 攻击动作参数（与 GroundMission PLAYER_ATTACKS 对齐，供自由模式本地状态机用） */
const ATTACK_PARAMS = {
  light: { windup: 0.28, recover: 0.2 },
  heavy: { windup: 0.5, recover: 0.25 },
  ranged: { windup: 0.2, recover: 0.3 },
};

/** 技能栏（键位 → 名称 → 效果类别） */
const SKILLS = [
  { key: '1', name: '等离子快斩', attack: 'light' },
  { key: '2', name: '震地重劈', attack: 'heavy' },
  { key: '3', name: '磁轨射击', attack: 'ranged' },
  { key: '4', name: '偏导护盾', block: true },
  { key: '5', name: '采掘/建造', mode: true },
  { key: '6', name: '小队指令', order: true },
];

/** 小队指令档位（技能 6 循环） */
const STANCES = ['跟随', '集火', '散开'];

/** 任务目标类型中文（HUD 目标列表） */
const OBJ_ZH = {
  reach: '全员撤入撤离区',
  destroy: '摧毁目标物',
  rescue: '接应失踪人员',
  collect: '回收数据核心',
  escort: '护送工程队抵达撤离区',
  survive: '坚守阵地',
  boss: '击杀深渊体',
};

/** 体素材质中文（准星信息） */
const MAT_ZH = {
  1: '表土', 2: '岩层', 3: '铁族矿脉', 4: '硅质矿脉',
  5: '稀土矿脉', 6: '重金属矿脉', 7: '基岩', 8: '结构体素',
};

/** 移动键集合（keydown/keyup 共用） */
const MOVE_CODES = new Set([
  'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight',
]);

/**
 * 建筑网格图集槽位：buildings.js 九大类 + 兜底 + 选择框（buildUnitBox 体素高亮）
 * + doc9 P0-3 七大旗舰地标预制（landmarkMeshes.js，槽位 11..17）。
 * 类别索引即实例 iParam.y（着色器按逐顶点 aMesh 失配退化，单 draw call 多网格）。
 * 追加槽位保证 0..10 既有索引稳定（MESH_OF_CATEGORY 兜底 9 不受影响）。
 */
const BUILD_CATEGORY_IDS = [
  'mining', 'refining', 'industry', 'agri', 'science',
  'service', 'military', 'admin', 'energy', 'default', 'selector',
  ...LANDMARK_PREFAB_IDS,
];
const MESH_OF_CATEGORY = (cat) => {
  const i = BUILD_CATEGORY_IDS.indexOf(String(cat || 'default'));
  return i >= 0 ? i : 9; // 兜底槽 'default'
};
/** 地标 prefabId → 图集槽位（未注册网格的辅助地标返回 -1，跳过渲染） */
const LANDMARK_MESH_OF = (prefabId) => {
  const i = BUILD_CATEGORY_IDS.indexOf(String(prefabId || ''));
  return i >= 11 ? i : -1;
};
/** doc9 P0-3：地标逐 prefab 渲染缩放（拱/桥 1.6，塔 2.2，穹顶 1.4，晶簇 1.2，锥 1.0，树 1.8） */
const LANDMARK_SCALE = {
  reef_dome_ruin: 1.4,
  central_furnace_tower: 2.2,
  sandstone_arch: 1.6,
  salt_crystal_spire: 1.2,
  giant_fumarole_cone: 1.0,
  soul_willow_tree: 1.8,
  obsidian_arch_bridge: 1.6,
};

/** P2-1 流体规则阈值（doc8 §4.3）：涉水阻尼上限深 / 潜水态 / 深渊护盾排放 */
const FLUID_WADE_MAX = 1.2;      // 0 < d ≤ 1.2m 涉水（×0.65 阻尼 + 水花）
const FLUID_DIVE_GRAV = 0.22;    // 潜水有效重力系数
const FLUID_DIVE_TERMINAL = -2.2; // 潜水终端下沉速度
const FLUID_THRUSTER_VY = 2.8;   // 水下推进器上浮速度
const FLUID_DEEP_DRAIN = 3.5;    // 水深 >8m 护盾排放 /s
const FLUID_DEEP_DEPTH = 8.0;
/** 水花/采样喷发粒子事件色（HDR 线性；matId=255 自定义色通道） */
const SPLASH_COLOR = [0.75, 1.08, 1.18];      // 青白水花
const POI_BURST_COLOR = [1.5, 1.1, 0.45];     // 地质能量琥珀喷发

/** 兜底环境光照（PlanetSurface3D 私有环境字段缺失时使用，取值与其默认一致） */
const FALLBACK_ENV = {
  sunDir: [0.42, 0.78, 0.32],
  sunColor: [1.0, 0.96, 0.84],
  fogColor: [0.6, 0.62, 0.66],
  fogRange: [34.0, 120.0],
};

// ———— 工具 ————————————————————————————————————————————————

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 秒 → m:ss */
function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 角度归一到 [-π, π] */
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** HUD 状态条 */
function hudBar(ctx, x, y, w, h, frac, color, label, valueText) {
  ctx.fillStyle = 'rgba(8,14,22,0.78)';
  ctx.fillRect(x, y, w, h);
  const f = clamp(frac, 0, 1);
  if (f > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * f), h - 2);
  }
  ctx.strokeStyle = 'rgba(140,170,200,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#cfe3f5';
  ctx.font = '10px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 3);
  ctx.textAlign = 'right';
  ctx.fillText(valueText, x + w, y - 3);
  ctx.textAlign = 'left';
}

// ———— 建筑网格批处理（GL） ————————————————————————————————————

/** 建筑实例着色器：单位变换（平移 + rotY + 均匀缩放）+ 网格号失配退化 + LIT 光照 */
const BM_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aMesh;
layout(location = 4) in vec4 iPos;
layout(location = 5) in vec4 iParam;
uniform mat4 uVP;
out vec3 vN;
out vec3 vC;
out vec3 vW;
out float vF;
out float vE;
void main() {
  if (abs(aMesh - iParam.y) > 0.5) {
    vN = vec3(0.0, 1.0, 0.0);
    vC = vec3(0.0);
    vW = vec3(0.0);
    vF = 0.0;
    vE = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float c = cos(iPos.w);
  float s = sin(iPos.w);
  vec3 p = aPos * iParam.x;
  vec3 w = iPos.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vW = w;
  vN = vec3(aNormal.x * c + aNormal.z * s, aNormal.y, -aNormal.x * s + aNormal.z * c);
  vC = aColor;
  vF = iParam.w;
  vE = iParam.z;
  gl_Position = uVP * vec4(w, 1.0);
}`;

/**
 * 建筑实例片元 —— doc8 §4.2【P1-3】标准升级版（与 PlanetSurface3D.LIT_FS 同一蓝本）：
 * 世界空间微面板接缝（panelSeam 1.6 频）+ hash31 微晶粒 + Blinn-Phong 金属高光
 * + 边缘菲涅尔。契约不变：vN/vC/vW/vF/vE + 既有五组 uniform。
 */
const BM_FS = `
precision highp float;
in vec3 vN;
in vec3 vC;
in vec3 vW;
in float vF;
in float vE;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
out vec4 fragColor;
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  /* 硬表面工业装甲板微纹理与接缝调制（消除纯色塑料方盒感） */
  vec3 gridP = abs(fract(vW * 1.6) - 0.5);
  float panelSeam = smoothstep(0.44, 0.49, max(gridP.x, max(gridP.y, gridP.z)));
  float microGrain = 0.94 + 0.12 * hash31(floor(vW * 12.0));
  vec3 baseAlbedo = vC * microGrain * (1.0 - panelSeam * 0.22);
  /* 半球环境光 + 漫反射 + Blinn-Phong 金属高光 + 边缘菲涅尔 */
  float ndl = max(dot(N, L), 0.0);
  float hemi = 0.38 + 0.24 * (N.y * 0.5 + 0.5);
  float spec = pow(max(dot(N, H), 0.0), 36.0) * 0.42 * ndl;
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.18;
  vec3 col = baseAlbedo * (uSunColor * ndl * 0.78 + hemi)
           + uSunColor * spec
           + uFogColor * fresnel
           + baseAlbedo * vE * 1.35;
  col = mix(col, vec3(2.0, 2.0, 2.1), vF);
  float fog = smoothstep(uFogRange.x, uFogRange.y, distance(vW, uCamPos));
  fragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;

/**
 * 建筑网格批处理：buildBuildingMesh(category) 实例图集（九大类 + 兜底 + 选择框
 * + doc9 P0-3 七大旗舰地标槽），单 draw call 绘制全部建筑 / 目标物 / 拾取物 /
 * 地标 / 体素选择框。光照 uniform 由调用方从 PlanetSurface3D 已求值的环境读取
 * （保持与地形一致）。
 */
class BuildingMeshBatch {
  constructor(glc) {
    this.glc = glc;
    this.gl = glc.gl;
    this.cap = 192;                       // 实例容量（建筑 + 目标物 + 拾取物 + 地标 + 选择框）
    this._count = 0;

    // —— 网格图集（逐顶点 aMesh）：九大类 + 兜底 + 选择框 + 七大旗舰地标 ——
    let total = 0;
    const meshes = BUILD_CATEGORY_IDS.map((cat) => {
      if (cat === 'selector') return buildUnitBox();
      if (LANDMARK_MESH_OF(cat) >= 0) return buildLandmarkMesh(cat); // doc9 P0-3 地标槽
      return buildBuildingMesh(cat);
    });
    for (const m of meshes) total += m.positions.length;
    const pos = new Float32Array(total);
    const nor = new Float32Array(total);
    const col = new Float32Array(total);
    const ids = new Float32Array(total / 3);
    let o = 0;
    let vi = 0;
    for (let mi = 0; mi < meshes.length; mi++) {
      const m = meshes[mi];
      pos.set(m.positions, o);
      nor.set(m.normals, o);
      col.set(m.colors, o);
      const vc = m.positions.length / 3;
      ids.fill(mi, vi, vi + vc);
      vi += vc;
      o += m.positions.length;
    }
    this._meshVertCount = total / 3;

    const gl = this.gl;
    this._bufP = glc.createBuffer(pos);
    this._bufN = glc.createBuffer(nor);
    this._bufC = glc.createBuffer(col);
    this._bufI = glc.createBuffer(ids);
    this._inst = glc.createBuffer(new Float32Array(this.cap * 8));

    this.prog = glc.createProgram(BM_VS, BM_FS, {
      label: 'ground:buildings',
      attributes: { aPos: 0, aNormal: 1, aColor: 2, aMesh: 3, iPos: 4, iParam: 5 },
    });
    const inst = this._inst;
    this.vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, this._bufP);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufN);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufC);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufI);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, inst);
      for (let k = 0; k < 2; k++) {
        g.enableVertexAttribArray(4 + k);
        g.vertexAttribPointer(4 + k, 4, g.FLOAT, false, 32, k * 16);
        g.vertexAttribDivisor(4 + k, 1);
      }
    });

    this._arr = new Float32Array(this.cap * 8);
    this._u = {
      uVP: gl.getUniformLocation(this.prog, 'uVP'),
      uSunDir: gl.getUniformLocation(this.prog, 'uSunDir'),
      uSunColor: gl.getUniformLocation(this.prog, 'uSunColor'),
      uCamPos: gl.getUniformLocation(this.prog, 'uCamPos'),
      uFogColor: gl.getUniformLocation(this.prog, 'uFogColor'),
      uFogRange: gl.getUniformLocation(this.prog, 'uFogRange'),
    };
  }

  /**
   * 绘制一批建筑实例。
   * @param {WebGL2RenderingContext} gl
   * @param {Float32Array} vp 视图投影矩阵（与 PlanetSurface3D 同帧相机）
   * @param {object} env { sunDir, sunColor, fogColor, fogRange, eye }
   * @param {Array<{x,y,z,rotY?,scale?,meshId,emit?,flash?}>} list 实例表
   */
  draw(gl, vp, env, list) {
    const arr = this._arr;
    let n = 0;
    for (const b of list) {
      if (!b || n >= this.cap) continue;
      const o = n * 8;
      arr[o] = b.x;
      arr[o + 1] = b.y;
      arr[o + 2] = b.z;
      arr[o + 3] = b.rotY || 0;
      arr[o + 4] = b.scale != null ? b.scale : 1;
      arr[o + 5] = b.meshId || 0;
      arr[o + 6] = b.emit || 0;
      arr[o + 7] = b.flash || 0;
      n++;
    }
    this._count = n;
    if (n <= 0) return;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this._u.uVP, false, vp);
    gl.uniform3fv(this._u.uSunDir, env.sunDir);
    gl.uniform3fv(this._u.uSunColor, env.sunColor);
    gl.uniform3f(this._u.uCamPos, env.eye[0], env.eye[1], env.eye[2]);
    gl.uniform3fv(this._u.uFogColor, env.fogColor);
    gl.uniform2f(this._u.uFogRange, env.fogRange[0], env.fogRange[1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._inst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, n * 8));
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this._meshVertCount, n);
    gl.bindVertexArray(null);
  }

  /** 释放本批处理持有的 GL 资源（glc.destroy() 亦会兜底回收） */
  destroy() {
    const gl = this.gl;
    if (!gl) return;
    for (const b of [this._bufP, this._bufN, this._bufC, this._bufI, this._inst]) {
      if (b) gl.deleteBuffer(b);
    }
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.prog) gl.deleteProgram(this.prog);
    this.vao = null;
    this.prog = null;
    this._count = 0;
  }
}

// ———— 视图 ————————————————————————————————————————————————

export const GroundView = {
  id: 'ground',
  title: '行星行动',

  mount(ctx) {
    const { root, app, param } = ctx;
    this.app = app;
    this._mounted = true;
    this.mode = 'briefing';            // briefing | mission | free
    this.keys = {};                    // 按住态（键码 → bool）
    this._oneShot = {};                // 边沿触发意图（attack/dodge/interact/switchUnit…）
    this._handlers = [];               // DOM 监听登记 { target, type, fn }
    this._unsubGL = null;              // CanvasManager.onGLStateChange 注销函数
    this._raf = 0;
    this._lastFrame = 0;
    this._clock = 0;                   // 视觉时钟（着色器 time / 动画相位）
    this._acc = 0;                     // 固定步长累加器
    this.cam = { yaw: 0, pitch: 0.5, dist: 9 };
    this.char3d = {                    // 第三人称角色状态（视图侧竖直物理 + 自由模式 XZ）
      x: 0, y: 0, z: 0, vy: 0, onGround: true,
      yaw: 0, state: 'idle', animT: 0, attackT: 0, attackKind: null, struckFx: false,
      hp: 100, hpMax: 100, shield: 30, shieldMax: 30, stamina: 100, staminaMax: 100,
      fuel: 100, dodgeT: 0, dodgeX: 0, dodgeZ: 0, atkCd: 0, blockT: 0,
    };
    this._fx = { slashes: [], beams: [], dig: [] };  // 瞬时视觉特效（每帧消费）
    this._strikeSeen = new Map();      // 单位打击拍检测（unitId → 上一帧 struck）
    this._buildMode = false;           // 技能 5：采掘/建造模式
    this._stanceIdx = 0;               // 技能 6：小队指令档位
    this._digCd = 0;
    this._placeCd = 0;
    this._aim = null;                  // 准星 DDA 结果（采掘/建造/信息条共用）
    this._aimFar = false;              // 瞄准点超出角色触及范围
    this._eye = [0, 0, 0];
    this._fwd = [0, 0, 0];
    this._m = { proj: mat4(), view: mat4(), vp: mat4() };
    this._tally = {};                  // 本次入账（无殖民地的自由沙盒只记视图侧台账）
    this._resultShown = false;
    this._forceBriefing = false;       // 头部「简报」按钮一次性覆盖自动恢复
    this._targetPlanetId = null;       // 路由传入的目标行星（doc5 §3.5 NAV-01/02）
    this._lastView = null;
    this._buildingLayout = [];         // 建筑实例（挂载时按殖民地确定性布局一次）
    this._buildingColonists = [];      // 建筑旁作业殖民者
    this._conveyor = [];               // 采掘 → 精炼传送带路径
    this._mouse = { lDown: false, rDown: false, lastX: 0, lastY: 0, dragged: false };
    // —— doc9 P0-1/P0-3/P2-1 视图侧状态 ——
    this._missionGroundSynced = false; // 任务首帧/切换单位地表吸附标记
    this._lastActiveUnitId = null;     // 受控单位切换检测（传送吸附判定）
    this._pois = null;                 // POI 账本（_setupScene 激活）
    this._edits = null;                // 持久化地形编辑仓库（_setupScene 激活）
    this._splashCd = 0;                // 涉水水花节流（0.18s）
    this._poiBurst = null;             // POI 采样喷发 { x, y, z, t }（0.8s）
    this._underwater = false;          // 相机眼位水下（雾效切换沿）
    this._hazardVignette = null;       // HUD 边缘告警光晕 'red'|'purple'|null（每帧重算）

    root.innerHTML = '';
    const wrap = el('div', { class: 'vf-view vf-view-immersive' });
    const head = el('div', { class: 'vf-view-head' });
    head.appendChild(el('h2', { text: L('ui.ground') }));
    this.headInfo = el('span', { class: 'vf-dim vf-small', text: '' });
    head.appendChild(this.headInfo);
    head.appendChild(el('span', { class: 'vf-grow' }));
    this.headBtns = el('span');
    head.appendChild(this.headBtns);
    this.body = el('div', { class: 'vf-view-body', style: { overflow: 'hidden' } });
    wrap.appendChild(head);
    wrap.appendChild(this.body);
    root.appendChild(wrap);

    this._build(param);
  },

  // —— 页面分派 ————————————————

  /**
   * 按 param（missionId | planetId）定位进行中任务；param 匹配不到活动任务
   * 但是一颗行星时 → 简报页并预选该行星（doc5 §3.5 NAV-02：未殖民行星准入）。
   * @param {string|null} param 路由参数
   */
  _build(param) {
    if (!this._mounted) return;
    const app = this.app;
    // 「简报」按钮的一次性覆盖：先取走标记再复位（本帧内强制进简报）
    const forceBriefing = this._forceBriefing === true;
    this._teardownScene();
    this.body.innerHTML = '';
    this._resultShown = false;
    this._forceBriefing = false;

    const w = app.world;
    if (!w) {
      this.body.appendChild(el('div', { class: 'pad vf-dim', text: '当前无进行中的战役。' }));
      this._setHead('简报', []);
      this.mode = 'briefing';
      this._bindBriefingEscape();
      return;
    }

    // 活动任务查找（id 或 planetId 匹配；缺省取第一个）
    const missions = Object.values(w.entities.groundMissions || {})
      .filter((m) => m.status === 'active');
    let mission = null;
    if (param) mission = missions.find((m) => m.id === param || m.planetId === param) || null;
    else mission = missions[0] || null;

    // —— 目标行星解析（_returnToOrbit 与简报预选共用） ——
    if (mission) {
      this._targetPlanetId = mission.planetId || null;
    } else if (param && w.entities.planets[param]) {
      this._targetPlanetId = w.entities.planets[param].id; // 显式行星参数（无任务）
    }

    if (mission && !forceBriefing) {
      this._buildMission(mission);
      return;
    }
    this._buildBriefing(mission);
  },

  /** 头部信息与按钮组 */
  _setHead(infoText, btnDefs) {
    if (this.headInfo) this.headInfo.textContent = infoText || '';
    if (!this.headBtns) return;
    this.headBtns.innerHTML = '';
    for (const b of btnDefs) {
      this.headBtns.appendChild(el('button', {
        class: `vf-btn small${b.kind ? ' ' + b.kind : ''}`,
        text: b.text,
        title: b.title || '',
        on: { click: b.onClick },
      }));
    }
  },

  // —— 简报页 ————————————————

  /**
   * 升空返回轨道（doc5 §3.5 NAV-01/03）：由 路由目标行星 / 自由探索行星 /
   * 进行中任务行星 反查所属星系精确回跳；全部缺失时走 RouteStack 兜底回银河。
   */
  _returnToOrbit() {
    const w = this.app.world;
    const pid = this._targetPlanetId || this.freePlanetId
      || (this.mission && this.mission.planetId) || null;
    const planet = w && pid ? w.entities.planets[pid] : null;
    if (planet && planet.systemId) this.app.goto('system', planet.systemId);
    else this.app.goBack('galaxy');
  },

  /**
   * 任务简报：行星选择 + 模板列表 + 开始行动 + 自由探索（先遣勘探）模式 + 既往记录。
   * 头部无条件渲染逃逸按钮（← 返回星系 primary/Esc + ← 银河星图），解除软锁死。
   * 目标行星选择器（data-focus-key="ground-planet-sel"）按去重 Set 依次填入：
   * 路由目标行星（无论是否已殖民）→ 玩家全部殖民地行星 → 已完成定位扫描
   * （surveyedBy≥3）星系下的无主行星（未殖民 · 可勘探，doc5 §3.5 NAV-02）。
   * @param {object|null} resumeMission 已存在的进行中任务（显示恢复入口）
   */
  /**
   * 简报页专属 Escape 逃逸监听（NAV-03）。
   * 任务/自由模式的键位在 _setupScene → _bindInput 中绑定，简报模式不进入该路径，
   * 故此处独立挂 window 级监听；_teardownScene / unmount 统一移除。
   */
  _bindBriefingEscape() {
    if (this._briefingEsc) return;
    this._briefingEsc = (e) => {
      if (!this._mounted || this.mode !== 'briefing') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this._returnToOrbit();
      }
    };
    window.addEventListener('keydown', this._briefingEsc);
  },

  _buildBriefing(resumeMission) {
    this.mode = 'briefing';
    const app = this.app;
    const w = app.world;
    this._bindBriefingEscape();

    // —— 简报主语行星与所属星系（标题 + 返回按钮文案） ——
    const targetPlanet = (resumeMission && w.entities.planets[resumeMission.planetId])
      || (this._targetPlanetId ? w.entities.planets[this._targetPlanetId] : null)
      || null;
    const sysName = targetPlanet && targetPlanet.systemId
      ? ((w.entities.systems[targetPlanet.systemId] || {}).name || '未知星系')
      : null;
    const headBtns = [
      {
        text: sysName ? `← 返回${sysName}星系` : '← 返回星系',
        kind: 'primary',
        title: `返回所属星系（Esc）${targetPlanet ? '' : ' · 未解析到目标行星时回退上一层'}`,
        onClick: () => this._returnToOrbit(),
      },
      { text: '← 银河星图', title: '返回银河地图', onClick: () => app.goto('galaxy') },
    ];
    this._setHead(targetPlanet ? `${targetPlanet.name || targetPlanet.id} · 简报` : '简报', headBtns);

    // 沉浸式全屏 body：内边距避开悬浮侧栏与顶栏（R7 毛玻璃 chrome）
    const box = el('div', { class: 'pad vf-col', style: { overflowY: 'auto', padding: '64px 200px 24px 72px' } });
    const p1 = panel({ title: '发起地面行动', open: true });
    const planetSel = el('select', { 'aria-label': '目标行星' });
    planetSel.setAttribute('data-focus-key', 'ground-planet-sel');

    // —— 目标行星选项：去重 Set 依序填入（目标行星 → 殖民地 → 可勘探无主行星） ——
    const seen = new Set();
    const addOption = (planet, tag) => {
      if (!planet || seen.has(planet.id)) return;
      seen.add(planet.id);
      planetSel.appendChild(el('option', {
        value: planet.id,
        text: `${planet.name || planet.id}${tag ? ` · ${tag}` : ''}`,
      }));
    };
    // 1) 路由传入的目标行星（无论是否已殖民；NAV-02 未殖民准入）
    if (targetPlanet) {
      addOption(targetPlanet, targetPlanet.colonyId ? '己方殖民地' : '先遣勘探目标');
    }
    // 2) 玩家全部殖民地/前哨行星
    for (const c of Object.values(w.entities.colonies || {})) {
      if (c.factionId !== w.playerFactionId) continue;
      addOption(w.entities.planets[c.planetId], '己方殖民地');
    }
    // 3) 已完成「定位」（层级≥3）星系下的全部无主行星（先遣勘探准入）
    const pid = w.playerFactionId;
    for (const sys of Object.values(w.entities.systems || {})) {
      if (((sys.surveyedBy || {})[pid] ?? 0) < 3) continue;
      for (const plId of sys.planetIds || []) {
        const pl = w.entities.planets[plId];
        if (pl && !pl.colonyId) addOption(pl, '未殖民 · 可勘探');
      }
    }
    if (!planetSel.childElementCount) {
      p1.appendChild(el('div', { class: 'vf-faint vf-small', text: '暂无可降落目标——派遣舰队扫描星系（调查层级≥3）以解锁先遣勘探。' }));
    }
    if (targetPlanet) planetSel.value = targetPlanet.id;
    p1.appendChild(el('label', { class: 'vf-col' }, [
      el('span', { class: 'vf-dim vf-small', text: '目标行星' }),
      planetSel,
    ]));

    // —— 任务模板列表 ——
    const tplBox = el('div', { class: 'mt-2' });
    for (const tpl of MISSION_TEMPLATES) {
      const row = el('div', { class: 'vf-row', style: { padding: '5px 0', borderBottom: '1px solid var(--line)' } });
      row.appendChild(el('div', { class: 'vf-grow' }, [
        el('div', { text: tpl.nameZh }),
        el('div', { class: 'vf-faint vf-small', text: tpl.descZh }),
        el('div', { class: 'vf-faint vf-small', text: `风险 ${tpl.riskLevel}/5 · 目标 ${tpl.objectives.map((o) => OBJ_ZH[o.type] || o.type).join('/')} · 奖励 ${tpl.rewards.map((r) => `${r.resId}×${r.amount}`).join(' ')}` }),
      ]));
      row.appendChild(el('button', {
        class: 'vf-btn small primary',
        text: '开始行动',
        on: {
          click: () => this._startMission(planetSel.value, tpl.id),
        },
      }));
      tplBox.appendChild(row);
    }
    p1.appendChild(tplBox);

    // —— 自由探索 / 先遣勘探模式（无任务沙盒；无需殖民地，NAV-02） ——
    p1.appendChild(el('div', { class: 'vf-row mt-2' }, [
      el('span', { class: 'vf-faint vf-small vf-grow', text: '不开任务，直接派遣先遣队降落地表进行勘探、采掘与建造（无需殖民地；Esc 或「升空返回轨道」离开）。' }),
      el('button', {
        class: 'vf-btn small',
        text: '自由探索模式',
        on: { click: () => this._startFree(planetSel.value) },
      }),
    ]));
    box.appendChild(p1);

    // —— 进行中任务恢复入口 ——
    if (resumeMission) {
      const tpl = findMissionTemplate(resumeMission.templateId);
      box.appendChild(el('div', { class: 'vf-row mt-2', style: { padding: '8px', border: '1px solid var(--accent)' } }, [
        el('span', { class: 'vf-grow vf-small', text: `进行中的行动：${tpl ? tpl.nameZh : resumeMission.templateId}（${fmtClock(resumeMission.time)}）` }),
        el('button', { class: 'vf-btn small primary', text: '恢复行动', on: { click: () => this._build(resumeMission.id) } }),
      ]));
    }

    // —— 既往行动记录 ——
    const done = Object.values(w.entities.groundMissions || {}).filter((m) => m.status !== 'active');
    if (done.length > 0) {
      const p2 = panel({ title: '既往行动记录', open: false });
      for (const m of done.slice(-8)) {
        const tpl = findMissionTemplate(m.templateId);
        p2.appendChild(el('div', { class: 'vf-log-line', text: `${(tpl && tpl.nameZh) || m.templateId} — ${({ success: '成功', failed: '失败', aborted: '中止' })[m.status] || m.status}` }));
      }
      box.appendChild(p2);
    }
    this.body.appendChild(box);
  },

  /** 就近解析可出动小队：玩家阵营存活角色按 id 稳定排序取前 3（确定性） */
  _resolveSquad(w) {
    return Object.values(w.entities.characters || {})
      .filter((c) => c.factionId === w.playerFactionId && c.health !== 'dead')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 3)
      .map((c) => c.id);
  },

  /** 开始行动：经命令总线创建任务（小队角色由视图就近解析） */
  _startMission(planetId, templateId) {
    const w = this.app.world;
    if (!planetId) {
      toast('请先选择目标行星', { kind: 'warn' });
      return;
    }
    const squad = this._resolveSquad(w);
    if (!squad.length) {
      toast('需要至少 1 名可用角色出动', { kind: 'warn' });
      return;
    }
    const res = this.app.dispatch('BeginGroundMission', {
      planetId,
      templateId,
      squadCharacterIds: squad,
    });
    if (res.ok) this._build(planetId);
  },

  /** 自由探索 / 先遣勘探模式：不创建任务，纯沙盒（无需殖民地，NAV-02） */
  _startFree(planetId) {
    const w = this.app.world;
    const planet = w.entities.planets[planetId];
    if (!planet) {
      toast('请先选择目标行星', { kind: 'warn' });
      return;
    }
    this.mode = 'free';
    this.freePlanetId = planetId;
    this._targetPlanetId = planetId;
    this._teardownScene();
    this.body.innerHTML = '';
    this._setupScene(planet, null);
    this._setHead(`自由探索 · ${planet.name || planet.id}`, [
      { text: '升空返回轨道', title: '返回行星所属星系（Esc）', onClick: () => this._ascend() },
    ]);
  },

  /** 升空返回轨道：跳回行星所属星系（#/system/<systemId>；无星系可回时走路由栈兜底） */
  _ascend() {
    this._returnToOrbit();
  },

  // —— 场景装配（任务 / 自由共用） ————————————————

  /**
   * 建立体素世界 + 三层画布 + GL 渲染器 + 建筑批处理 + 输入绑定，并启动渲染循环。
   * @param {object} planet 行星实体
   * @param {object|null} mission 进行中任务实体（null = 自由模式）
   */
  _setupScene(planet, mission) {
    const w = this.app.world;
    this.planet = planet;
    this.sw = createSurfaceWorld(w, planet.id);   // 种子 = world.seed ^ hash32(planetId)：同 seed 同地貌
    // —— 人工任务核心蓝图实例化（doc7 TASK-2.2：SDF 三层关卡 + 首屏构图） ——
    const bp = blueprintsForPlanet(planet, planet.primaryThemeId || null)[0] || null;
    this._site = bp ? getSiteInstance(w, planet.id, bp.id) : null;
    // —— 连续三角网格场域（doc7 §3；体素补丁仅作矿脉/结构数据底层，不再承担视觉） ——
    this.field = buildTerrainField(w, planet.id, {
      profile: this._site ? this._site.blueprint.terrainProfile : undefined,
      siteModifier: this._site ? this._site.siteModifier : undefined,
    });
    this._digDents = new Map();                   // 采掘凹陷（列键 → 次数），siteModifier 消费
    this._placedVoxels = new Map();               // 已放置结构体素（列键 → {x,y,z}，占位盒渲染）
    this._springDist = -1;                        // 场域弹簧臂臂长（首帧吸附）
    const baseSiteMod = this._site ? this._site.siteModifier : null;
    this.field.siteModifier = (fx, fz, base) => {
      let siteDy = 0;
      let eff = base;
      if (baseSiteMod) {
        const m = baseSiteMod(fx, fz, base);
        if (m && Number.isFinite(m.dy)) {
          siteDy = m.dy;
          eff = { ...base, y: (Number.isFinite(base.y) ? base.y : 0) + siteDy };
        }
      }
      const dent = this._fieldSiteModifier(fx, fz, eff);
      // 总 dy = 站点 SDF dy + 采掘凹陷 dy（terrainField 仅应用单层 mod.dy）
      const dentDy = dent && Number.isFinite(dent.dy) ? dent.dy : 0;
      const total = siteDy + dentDy;
      return total !== 0 ? { dy: total } : null;
    };
    // —— P0-3 修复（doc9 §3.1）：激活 POI 账本与持久化地形编辑仓库 ——
    //     attachTerrainEdits 自动组合在既有 siteModifier 链之上（内部保存
    //     __baseSiteModifier），此处之后不得再对 field.siteModifier 赋值。
    this._pois = ensurePlanetPois(w, planet);
    this._edits = deserializeEdits(planet.terrainEdits || null, this.field);
    attachTerrainEdits(this.field, this._edits);
    rebuildDirtyChunks(this.field);
    this.colony = Object.values(w.entities.colonies || {})
      .find((c) => c.planetId === planet.id) || null;
    this.mission = mission || null;
    this.missionId = mission ? mission.id : null;
    this._layoutColony();
    this._conveyor = this._buildConveyorPaths();

    // —— P0-1 修复（doc9 §3.1）：首帧初始位置对齐真实地表 ——
    //     任务模式按 coordSpace 映射（site_meters = 场域米制直读，体素 = 线性映射）；
    //     R-A 改造前的 GroundMission 无 coordSpace 字段 → 防御性回退体素映射。
    const c = this.char3d;
    const spawn = this.sw.spawn;
    if (this.mission && this.mission.playerUnits && this.mission.playerUnits.length) {
      const m = this.mission;
      const au = m.playerUnits[m.activeIdx || 0];
      if (m.coordSpace === 'site_meters') {
        // 站点米制坐标已是场域米：世界 = 场域 - FIELD_OFFSET（场域 (0,0) → 世界 (32,32)）
        c.x = au.x - FIELD_OFFSET;
        c.z = au.y - FIELD_OFFSET;
      } else {
        c.x = au.x * (SURFACE_SIZE.X / (m.w * TS));
        c.z = au.y * (SURFACE_SIZE.Z / (m.h * TS));
      }
    } else {
      c.x = spawn.x;
      c.z = spawn.z;
    }
    c.y = this._groundAt(c.x, c.z);
    if (!Number.isFinite(c.y)) c.y = 8.0;         // 场外兜底
    c.vy = 0;
    c.onGround = true;
    c.state = 'idle';
    c.fuel = 100;
    this._missionGroundSynced = true;
    this._lastActiveUnitId = null;
    // 相机置于角色背后；首屏构图（doc7 §5.2）：任务模式且存在站点蓝图时，
    // yaw 自动对准 primaryObjective 主视觉地标（着陆 2 秒内可读局势）。
    this.cam.yaw = 0;
    this.cam.pitch = 0.5;
    this.cam.dist = 9;
    if (this._site && this._site.site && this._site.site.anchors) {
      const pri = this._site.site.anchors.primaryObjective;
      if (pri) {
        const wx = pri.x - FIELD_OFFSET;
        const wz = pri.z - FIELD_OFFSET;
        const dx = wx - c.x;
        const dz = wz - c.z;
        if (Math.hypot(dx, dz) > 4) {
          this.cam.yaw = Math.atan2(-dx, -dz);
        }
      }
    }

    // —— 画布与 GL ——
    const canvasWrap = el('div', { class: 'vf-view-canvas' });
    this.body.appendChild(canvasWrap);
    this.cm = new CanvasManager().attach(canvasWrap);
    this._glOK = false;
    this._initGL();

    // —— 输入 ——
    this._bindInput();

    // —— GL 状态回调（上下文丢失/恢复 → 释放/重建） ——
    this._unsubGL = this.cm.onGLStateChange((degraded) => this._onGLState(degraded));

    // —— 渲染循环 ——
    this._lastFrame = 0;
    this._acc = 0;
    const loop = (ts) => {
      if (!this._mounted) return;
      this._raf = requestAnimationFrame(loop);
      this._loopStep(ts);
    };
    this._raf = requestAnimationFrame(loop);
  },

  /** 创建/重建 GL 资源（上下文恢复后同样走这里） */
  _initGL() {
    this._glOK = false;
    this.scene = null;
    this.ps3d = null;
    this.bmesh = null;
    if (this.cm && this.cm.hasGL && this.cm.glc && this.cm.tier < 3) {
      try {
        // —— 场景编排器：连续三角网格地形 + 大气 + 天气（doc7 TASK-1.3） ——
        this.scene = new PlanetSurfaceScene(this.cm, {});
        this.scene.mount(this.field, null);
        // 场域中心 (256,256) → 体素空间 (32,32)：地形平移对齐玩法坐标
        this.scene.setWorldOffset([-FIELD_OFFSET, 0, -FIELD_OFFSET]);
        // —— 对象渲染器：箱体/actor/角色七部件/贴花/特效（外部相机，对象独占） ——
        this.ps3d = new PlanetSurface3D(this.cm.glc, this.cm.tier);
        this.ps3d.init(this.sw);
        this.ps3d.setObjectOnly(true);            // 地形/天空权威移交 PlanetSurfaceScene
        this.bmesh = new BuildingMeshBatch(this.cm.glc);
        // —— 主题载荷（doc7 TASK-3.1/3.2：planetThemes 九维色板 → 场景主题） ——
        //     对象/建筑 pass 与场景地形共用同一太阳/雾（THEME-02 一致性）。
        const gvPlanet = this.planet || {};
        this._themePayload = buildThemePayload(
          gvPlanet.primaryThemeId || null, this.app.world, gvPlanet.id || 'unknown',
          { category: gvPlanet.category, fogRange: [90, 560] },
        );
        this.scene.setTheme(this._themePayload);
        if (this.ps3d) {
          const env = this._themePayload;
          this.ps3d._sunDir = env.terrain.sun.dir.slice();
          this.ps3d._sunColor = env.terrain.sun.color.slice();
          this.ps3d._fogColor = env.terrain.fog.color.slice();
          this.ps3d._fogRange = env.terrain.fog.range.slice();
          this.ps3d._sky = {
            zenith: env.sky.zenith.slice(),
            horizon: env.sky.horizon.slice(),
            ground: env.sky.ground.slice(),
            stars: env.sky.stars || 0,
          };
        }
        // —— 诊断钩子接管：诊断模式路由到场景地形网格；GL 状态快照仍由 ps3d 供 ——
        if (typeof window !== 'undefined') {
          window.__vfSurfaceDebug = {
            renderer: this.ps3d,
            scene: this.scene,
            view: this,
            setDebugMode: (m) => (this.scene ? this.scene.setDebugMode(m) : 0),
            cycleDebugMode: () => (this.scene ? this.scene.setDebugMode((this.scene.getDebugMode() + 1) % 4) : 0),
            getSnapshot: () => ({
              ...(this.ps3d ? this.ps3d.getGLStateSnapshot() : {}),
              sceneStats: this.scene ? this.scene.getStats() : null,
            }),
          };
        }
        this._glOK = true;
      } catch (e) {
        console.error('[GroundView] GL 初始化失败，保持 2D 兜底:', e);
        this._glErr = String((e && e.message) || e);
        try { if (this.scene) this.scene.destroy(); } catch (_) { /* 忽略 */ }
        try { if (this.ps3d) this.ps3d.destroy(); } catch (_) { /* 忽略 */ }
        try { if (this.bmesh) this.bmesh.destroy(); } catch (_) { /* 忽略 */ }
        this.scene = null;
        this.ps3d = null;
        this.bmesh = null;
      }
    }
  },

  /** GL 状态回调：丢失 → 释放；恢复 → 重建 */
  _onGLState(degraded) {
    if (!this._mounted) return;
    if (degraded) {
      try { if (this.scene) this.scene.destroy(); } catch (_) { /* 忽略 */ }
      try { if (this.ps3d) this.ps3d.destroy(); } catch (_) { /* 忽略 */ }
      try { if (this.bmesh) this.bmesh.destroy(); } catch (_) { /* 忽略 */ }
      this.scene = null;
      this.ps3d = null;
      this.bmesh = null;
      this._glOK = false;
    } else {
      this._initGL();
    }
  },

  /** 释放场景（画布 / GL / 监听 / rAF），保留 DOM 骨架 */
  _teardownScene() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    for (const h of this._handlers) {
      h.target.removeEventListener(h.type, h.fn);
    }
    this._handlers = [];
    // 简报页 Escape 逃逸监听（随场景/视图拆卸一并移除）
    if (this._briefingEsc) {
      window.removeEventListener('keydown', this._briefingEsc);
      this._briefingEsc = null;
    }
    if (this._unsubGL) {
      this._unsubGL();
      this._unsubGL = null;
    }
    try { if (this.scene) this.scene.destroy(); } catch (_) { /* 忽略 */ }
    try { if (this.ps3d) this.ps3d.destroy(); } catch (_) { /* 忽略 */ }
    try { if (this.bmesh) this.bmesh.destroy(); } catch (_) { /* 忽略 */ }
    this.scene = null;
    this.ps3d = null;
    this.bmesh = null;
    if (this.cm) {
      this.cm.dispose();
      this.cm = null;
    }
    this._glOK = false;
    this.sw = null;
    this.field = null;
    this._digDents = null;
    this.mission = null;
    this.missionId = null;
    this._lastView = null;
    this._pois = null;
    this._edits = null;
    this._poiBurst = null;
    this._underwater = false;
    this._hazardVignette = null;
    this._missionGroundSynced = false;
    this._lastActiveUnitId = null;
    this._strikeSeen.clear();
    this._fx.slashes.length = 0;
    this._fx.beams.length = 0;
    this._fx.dig.length = 0;
  },

  // —— 任务模式装配 ————————————————

  /** 进行中任务：3D 场景 + 头部按钮 */
  _buildMission(mission) {
    this.mode = 'mission';
    const app = this.app;
    const w = app.world;
    const planet = w.entities.planets[mission.planetId];
    const tpl = findMissionTemplate(mission.templateId);
    this._setupScene(planet || { id: mission.planetId, name: mission.planetId, systemId: null }, mission);
    this._setHead(`${tpl ? tpl.nameZh : mission.templateId} · ${planet ? planet.name : mission.planetId}`, [
      { text: '简报', title: '返回任务简报', onClick: () => { this._forceBriefing = true; this._build(null); } },
      { text: '升空返回轨道', title: '返回行星所属星系', onClick: () => this._ascend() },
    ]);
  },

  // —— 输入 ————————————————

  /** 绑定键盘 / 鼠标（登记进 _handlers，unmount 统一移除） */
  _bindInput() {
    const onKeyDown = (e) => this._onKeyDown(e);
    const onKeyUp = (e) => this._onKeyUp(e);
    const canvas = this.cm.canvas;
    const onMouseDown = (e) => this._onMouseDown(e);
    const onMouseMove = (e) => this._onMouseMove(e);
    const onMouseUp = (e) => this._onMouseUp(e);
    const onWheel = (e) => this._onWheel(e);
    const onCtx = (e) => e.preventDefault();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);
    this._handlers = [
      { target: window, type: 'keydown', fn: onKeyDown },
      { target: window, type: 'keyup', fn: onKeyUp },
      { target: canvas, type: 'mousedown', fn: onMouseDown },
      { target: window, type: 'mousemove', fn: onMouseMove },
      { target: window, type: 'mouseup', fn: onMouseUp },
      { target: canvas, type: 'wheel', fn: onWheel },
      { target: canvas, type: 'contextmenu', fn: onCtx },
    ];
  },

  _onKeyDown(e) {
    if (!this._mounted) return;
    // 简报页 Escape 逃逸（doc5 §3.5 NAV-03）：无条件返回所属星系，解除软锁死
    if (this.mode === 'briefing') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._returnToOrbit();
      }
      return;
    }
    const code = e.code;
    if (MOVE_CODES.has(code)) {
      this.keys[code] = true;
      e.preventDefault();
      return;
    }
    switch (code) {
      case 'Space':
        e.preventDefault();
        if (!this.keys.Space) {
          this.keys.Space = true;
          this._oneShot.dodge = true;   // 点按：闪避（任务 FSM）+ 本地跳跃
        }
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys[code] = true;
        break;
      case 'Digit1':
        this._oneShot.attack = 'light';
        break;
      case 'Digit2':
        this._oneShot.attack = 'heavy';
        break;
      case 'Digit3':
        this._oneShot.attack = 'ranged';
        break;
      case 'Digit4':
        this.keys.Digit4 = true;        // 持续按住 = 格挡意图
        break;
      case 'Digit5':
        this._buildMode = !this._buildMode;
        break;
      case 'Digit6':
        this._stanceIdx = (this._stanceIdx + 1) % STANCES.length;
        break;
      case 'KeyE':
        this._oneShot.interact = true;
        break;
      case 'KeyR':
        this._tryRestoreTerrain();
        break;
      case 'Tab':
        e.preventDefault();
        this._oneShot.switchUnit = true;
        break;
      case 'Escape':
        if (this.mode === 'free') this._ascend();
        break;
      default:
        break;
    }
  },

  _onKeyUp(e) {
    const code = e.code;
    if (MOVE_CODES.has(code)) this.keys[code] = false;
    else if (code === 'Space') this.keys.Space = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys[code] = false;
    else if (code === 'Digit4') this.keys.Digit4 = false;
  },

  _onMouseDown(e) {
    if (this.mode === 'briefing') return;
    if (e.button === 0) {
      this._mouse.lDown = true;
      if (this._buildMode) {
        // 按下边沿立即采掘一格（按住由 _updateAim 按 DIG_INTERVAL 连挖）
        this._digCd = DIG_INTERVAL;
        if (this._aim) this._tryDig(this._aim);
      } else {
        this._oneShot.attack = this._oneShot.attack || 'light';
      }
    } else if (e.button === 2) {
      this._mouse.rDown = true;
      this._mouse.dragged = false;
      this._mouse.lastX = e.clientX;
      this._mouse.lastY = e.clientY;
      if (this._buildMode) {
        // 按下边沿立即放置一格（按住未拖拽时由 _updateAim 连放）
        this._placeCd = PLACE_INTERVAL;
        if (this._aim) this._tryPlace(this._aim);
      }
    }
  },

  _onMouseMove(e) {
    if (!this._mouse.rDown) return;
    const dx = e.clientX - this._mouse.lastX;
    const dy = e.clientY - this._mouse.lastY;
    this._mouse.lastX = e.clientX;
    this._mouse.lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      this._mouse.dragged = Math.abs(dx) + Math.abs(dy) > 6 || this._mouse.dragged;
      this.cam.yaw -= dx * 0.0045;
      this.cam.pitch = clamp(this.cam.pitch + dy * 0.0035, 0.08, 1.35);
    }
  },

  _onMouseUp(e) {
    if (e.button === 0) this._mouse.lDown = false;
    if (e.button === 2) this._mouse.rDown = false;
  },

  _onWheel(e) {
    if (this.mode === 'briefing') return;
    e.preventDefault();
    this.cam.dist = clamp(this.cam.dist + Math.sign(e.deltaY) * 0.8, CAM_DIST_MIN, CAM_DIST_MAX);
  },

  /** 相机相对移动向量（世界 XZ，已归一化；无输入返回 null） */
  _moveVec() {
    const f = (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0) - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0);
    const r = (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0) - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0);
    if (!f && !r) return null;
    const sy = Math.sin(this.cam.yaw);
    const cy = Math.cos(this.cam.yaw);
    // 相机水平前向 = (-sin yaw, -cos yaw)；右向 = (cos yaw, -sin yaw)
    let dx = -sy * f + cy * r;
    let dz = -cy * f - sy * r;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  },

  /** 行星重力（planet.gravity 缺省按 1.0g） */
  _gravity() {
    const g0 = this.planet && this.planet.gravity != null ? Number(this.planet.gravity) : 1.0;
    return Math.max(0.2, g0) * 9.8;
  },

  /**
   * 地面高度（脚底）。场域优先：连续三角网格重心插值（doc7 TASK-1.2）；
   * 体素列顶仅作场域缺失时的兜底（2D 降级/场外）。
   * @returns {number} 高度（米/体素单位同刻度）；场外返回 Infinity
   */
  _groundAt(x, z) {
    if (this.field) {
      const s = sampleTerrain(this.field, x + FIELD_OFFSET, z + FIELD_OFFSET);
      if (s && Number.isFinite(s.y)) return s.y;
      return Infinity;
    }
    const h = getSurfaceHeight(this.sw, x, z);
    return h >= 0 ? h + 1 : Infinity;
  },

  /**
   * 场域 siteModifier：采掘凹陷雕刻（TERRAIN-06 增量重建的域侧驱动）。
   * MissionSiteBlueprint 的 SDF 挂点由后续波次在同一钩子内合成（Wave C）。
   * @param {number} fx 场域 X（米） @param {number} fz 场域 Z（米）
   * @param {object} base terrainField 预估点
   */
  _fieldSiteModifier(fx, fz, base) {
    const dents = this._digDents;
    if (!dents || dents.size === 0) return null;
    const lx = fx - FIELD_OFFSET;
    const lz = fz - FIELD_OFFSET;
    const cx = Math.floor(lx);
    const cz = Math.floor(lz);
    let dy = 0;
    let touched = false;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const key = (cx + dx) * 4096 + (cz + dz);
        const n = dents.get(key);
        if (!n) continue;
        const d = Math.hypot(lx - (cx + dx + 0.5), lz - (cz + dz + 0.5));
        const fall = Math.max(0, 1 - d / 1.8);
        if (fall > 0) {
          dy -= n * DIG_DENT_DEPTH * fall * fall;
          touched = true;
        }
      }
    }
    return touched && Number.isFinite(base.y + dy) ? { dy } : null;
  },

  // —— P2-1 流体物理 / 危险区反馈（doc8 §4.3） ————————————————

  /**
   * 实时水位（米）：优先场景潮汐实时值（PlanetSurfaceScene.getWaterLevel），
   * 回退主题载荷静态 themeFx.waterLevel；无水主题返回 null。
   */
  _liveWaterLevel() {
    if (this.scene && typeof this.scene.getWaterLevel === 'function') {
      const lv = this.scene.getWaterLevel(this._clock);
      if (lv != null && Number.isFinite(lv)) return lv;
    }
    const fx = this._themePayload && this._themePayload.terrain
      && this._themePayload.terrain.themeFx;
    if (fx && Number.isFinite(fx.waterLevel) && fx.waterLevel > -90) return fx.waterLevel;
    return null;
  },

  /**
   * 角色浸没深度 d = waterLevel - c.y（无水返回 0）。
   * 规则分档：0 < d ≤ 1.2 涉水；d > 1.2 潜水；d > 8 深渊高压。
   */
  _fluidDepth(c) {
    const lv = this._liveWaterLevel();
    if (lv == null) return 0;
    const d = lv - c.y;
    return d > 0 ? d : 0;
  },

  /** 涉水水花：移动时 0.18s 节流注入青白水花粒子事件（角色脚底） */
  _emitSplash(c, dt, moving) {
    this._splashCd = Math.max(0, this._splashCd - dt);
    if (!moving || this._splashCd > 0) return;
    this._splashCd = 0.18;
    this._fx.dig.push({
      x: c.x - 0.5, y: c.y - 0.3, z: c.z - 0.5, matId: 255, color: SPLASH_COLOR,
    });
  },

  /**
   * 危险区持续排放（护盾优先，护盾耗尽转结构 HP）+ HUD 告警光晕标记：
   *  - 深潜 d > 8m：护盾 3.5/s；
   *  - sulfur_marsh 海拔 < 4.5m 毒气湖：护盾 2.5/s + 紫晕；
   *  - obsidian_lava 海拔 < -1.5m 熔岩河：护盾 4/s + 红晕；
   *  - permafrost_furnace 离开热源圈：体温流失（护盾 1.0/s）。
   * @returns {void} 副作用写 c.shield/c.hp 与 this._hazardVignette
   */
  _hazardDrain(c, dt, depth) {
    let rate = 0;
    let vignette = null;
    if (depth > FLUID_DEEP_DEPTH) {
      rate = Math.max(rate, FLUID_DEEP_DRAIN);
      vignette = 'red';                        // 深渊过压红晕
    }
    const themeId = this._themePayload ? this._themePayload.themeId : null;
    if (themeId === 'sulfur_marsh' && c.y < 4.5) {
      rate = Math.max(rate, 2.5);
      vignette = 'purple';
    }
    if (themeId === 'obsidian_lava' && c.y < -1.5) {
      rate = Math.max(rate, 4.0);
      vignette = 'red';
    }
    if (themeId === 'permafrost_furnace' && this.field) {
      // 离开全部热源圈（场域坐标）→ 体温流失
      const zones = (this._themePayload.terrain.heatZones || []);
      const fx = c.x + FIELD_OFFSET;
      const fz = c.z + FIELD_OFFSET;
      let warm = false;
      for (const hz of zones) {
        if (Math.hypot(fx - hz.x, fz - hz.z) <= (hz.radius || 0)) { warm = true; break; }
      }
      if (!warm && zones.length) rate = Math.max(rate, 1.0);
    }
    this._hazardVignette = vignette;
    if (rate <= 0) return;
    if (c.shield > 0) c.shield = Math.max(0, c.shield - rate * dt);
    else c.hp = Math.max(0, c.hp - rate * 0.5 * dt);
  },

  /** POI 采样能量喷发（0.8s）：持续注入琥珀色粒子事件（_updateFx 步进计时） */
  _updatePoiBurst(dt) {
    const b = this._poiBurst;
    if (!b) return;
    b.t -= dt;
    if (b.t <= 0) {
      this._poiBurst = null;
      return;
    }
    this._fx.dig.push({
      x: b.x - 0.5 + (this._clock * 7.3 % 1 - 0.5) * 0.6,
      y: b.y - 0.4,
      z: b.z - 0.5 + (this._clock * 5.1 % 1 - 0.5) * 0.6,
      matId: 255,
      color: POI_BURST_COLOR,
    });
  },

  /**
   * R 键一键恢复自然地貌（doc7 §6 DSP 式）：以角色为中心 RestoreTerrain 命令
   * （领域写回行星 terrainEdits 日志）+ 本地同 op 应用（即时增量重建）。
   */
  _tryRestoreTerrain() {
    if (!this.field || !this._edits || !this.planet) return;
    const c = this.char3d;
    const x = c.x - FIELD_OFFSET;               // 世界 → 场域坐标（命令口径）
    const z = c.z - FIELD_OFFSET;
    const res = this.app.dispatch('RestoreTerrain', {
      planetId: this.planet.id, x, z, radius: 6, strength: 1,
    });
    if (!res.ok) {
      toast(res.reason || '恢复失败', { kind: 'warn' });
      return;
    }
    applyEdit(this.field, this._edits, { kind: 'restore', x, z, radius: 6, strength: 1 });
    rebuildDirtyChunks(this.field);
    toast('地形已恢复自然状态（DSP 式）', { kind: 'ok' });
  },

  /** 采掘后标记场域 Chunk 脏（下一帧 sync 增量重建；TERRAIN-06） */
  _markFieldDirty(vx, vz) {
    if (!this.field || !Array.isArray(this.field.chunks)) return;
    const fx = vx + FIELD_OFFSET;
    const fz = vz + FIELD_OFFSET;
    const chSize = this.field.chunkMeters || 64;
    const tcx = Math.floor(fx / chSize);
    const tcz = Math.floor(fz / chSize);
    for (const ch of this.field.chunks) {
      if (!ch) continue;
      const ddx = Math.abs(ch.cx - tcx);
      const ddz = Math.abs(ch.cz - tcz);
      // 凹陷半径跨列：相邻 Chunk 一并标脏（1.8m 半径只可能触及近邻）
      if (ddx <= 1 && ddz <= 1) ch.dirty = true;
    }
  },

  // —— 主循环 ————————————————

  /** rAF 回调（时间推进） */
  _loopStep(ts) {
    const now = ts / 1000;
    let dt = Math.min(0.25, now - (this._lastFrame || now));
    if (!(dt > 0)) dt = STEP;
    this._lastFrame = now;
    this._clock += dt;

    if (this.mode === 'mission') this._missionFrame(dt);
    else if (this.mode === 'free') this._freeFrame(dt);
  },

  /** 任务模式帧：输入 → 固定步长模拟 → 竖直物理 → 渲染 */
  _missionFrame(dt) {
    const w = this.app.world;
    const m = w.entities.groundMissions[this.missionId];
    if (!m || m.status !== 'active') {
      // 任务结束：停循环并结算
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      this._showResult(m);
      return;
    }
    this._writeMissionInput(m);
    this._acc = Math.min(this._acc + dt, STEP * MAX_STEPS_PER_FRAME);
    while (this._acc >= STEP && m.status === 'active') {
      try {
        stepMission(w, m, STEP);
      } catch (e) {
        console.error('[GroundView] stepMission 异常:', e);
        break;
      }
      this._acc -= STEP;
    }
    if (m.status !== 'active') {
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      this._showResult(m);
      return;
    }
    const view = getMissionView(m);
    this._lastView = view;
    // 先更新准星/采掘（供角色采掘姿态判定），再推进打击特效与竖直物理
    this._updateAim(dt);
    this._detectStrikes(view);
    this._followMissionCharacter(view, dt);
    this._updateFx(dt);
    this._renderFrame(view, dt);
  },

  /** 自由模式帧：本地状态机 + 体素物理 → 渲染（E 键消费 POI 采样） */
  _freeFrame(dt) {
    this._updateAim(dt);
    if (this._oneShot.interact) {
      this._oneShot.interact = false;
      this._tryHarvestPoi();
    }
    this._freePhysics(dt);
    this._updateFx(dt);
    this._renderFrame(null, dt);
  },

  /**
   * E 键采样最近未勘探 POI（doc5 P1-05 / doc7 §6）：HarvestPlanetPOI 命令经
   * CommandBus 领域结算（rewardPaid 严格幂等锁），奖励回写账本/殖民地仓储。
   */
  _tryHarvestPoi() {
    if (!this._pois) return;
    const c = this.char3d;
    let best = null;
    let bd = 3.0;                              // 交互半径（米）
    for (const poi of Object.values(this._pois)) {
      if (poi.rewardPaid || poi.state === 'explored') continue;
      const px = poi.position.x - FIELD_OFFSET;
      const pz = poi.position.z - FIELD_OFFSET;
      const d = Math.hypot(px - c.x, pz - c.z);
      if (d < bd) { bd = d; best = poi; }
    }
    if (!best) {
      toast('附近没有可采样的兴趣点（靠近发光信标按 E）', { kind: 'info' });
      return;
    }
    const res = this.app.dispatch('HarvestPlanetPOI', {
      planetId: this.planet.id,
      poiId: best.id,
    });
    if (res.ok) {
      toast(`已采样：${best.id}（奖励入账）`, { kind: 'ok' });
      this._tally.poiSampled = (this._tally.poiSampled || 0) + 1;
      // —— P2-2：采样瞬间 0.8s 地质能量粒子喷发（信标蜕变为已发掘基座残骸） ——
      const bx = best.position.x - FIELD_OFFSET;
      const bz = best.position.z - FIELD_OFFSET;
      const gy = this._groundAt(bx, bz);
      this._poiBurst = {
        x: bx,
        y: Number.isFinite(gy) ? gy + 0.4 : this.char3d.y,
        z: bz,
        t: 0.8,
      };
    } else {
      toast(res.reason || '采样失败', { kind: 'warn' });
    }
  },

  /**
   * 将玩家意图逐帧写入 mission.input（瞬态控制通道，不经命令总线）。
   * moveDir 为相机相对方向映射到任务坐标（任务 +y ↔ 世界 +z）。
   */
  _writeMissionInput(m) {
    const mv = this._moveVec();
    const inp = m.input;
    inp.moveDir = mv ? { x: mv.x, y: mv.z } : { x: 0, y: 0 };
    inp.sprint = !!(this.keys.ShiftLeft || this.keys.ShiftRight);
    inp.block = !!this.keys.Digit4;
    if (this._oneShot.attack) {
      inp.attack = this._oneShot.attack;
      this._oneShot.attack = null;
    }
    if (this._oneShot.dodge) {
      // 空格点按：闪避方向 = 当前移动方向（无输入交给 FSM 回退为背向）
      inp.dodgeDir = mv ? { x: mv.x, y: mv.z } : { x: 0, y: 0 };
      this._oneShot.dodge = false;
      this._oneShot.jump = true;      // 3D 层同步起跳
    }
    if (this._oneShot.interact) {
      inp.interactTarget = this._resolveInteract(m);
      this._oneShot.interact = false;
    }
    if (this._oneShot.switchUnit) {
      inp.switchUnit = true;          // FSM 消费后自动复位（cycleActive）
      this._oneShot.switchUnit = false;
    }
  },

  /** E 键就近解析交互目标：交互半径（60px ≈ 2.5 格）内最近的未完成目标物 id */
  _resolveInteract(m) {
    const u = m.playerUnits[m.activeIdx];
    if (!u || u.state === 'dead') return null;
    let best = null;
    let bd = Infinity;
    for (const t of m.targets) {
      if (t.done) continue;
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d < 60 && d < bd) {
        bd = d;
        best = t.targetId;
      }
    }
    return best;
  },

  /**
   * 任务模式竖直物理（doc9 §3.1 P0-1 版）：XZ 由任务模拟权威按 coordSpace 映射
   * （site_meters = 场域米制直读；缺省回退体素线性映射 —— 兼容 R-A 改造前后），
   * Y 由视图本地刚体法向冲量闭环驱动（接触清零 / 双重防坠渊 / 越界就地挽救）。
   */
  _followMissionCharacter(view, dt) {
    const m = this.mission;
    const au = view.playerUnits.find((u) => u.unitId === view.activeUnitId)
      || view.playerUnits[0];
    if (!au || !m) return;

    const c = this.char3d;
    // coordSpace 感知映射（R-A 改造前 mission 无 coordSpace → 体素线性映射兜底）
    const wx = (m.coordSpace === 'site_meters')
      ? (au.x - FIELD_OFFSET)
      : (au.x * (SURFACE_SIZE.X / (m.w * TS)));
    const wz = (m.coordSpace === 'site_meters')
      ? (au.y - FIELD_OFFSET)
      : (au.y * (SURFACE_SIZE.Z / (m.h * TS)));

    const jumpDist = Math.hypot(wx - c.x, wz - c.z);
    const unitChanged = (this._lastActiveUnitId !== au.unitId) || !this._missionGroundSynced;
    c.x = wx;
    c.z = wz;
    c.yaw = -au.facing;               // 任务朝向（像素系 atan2）→ 网格 rotY 约定
    c.animT += dt;
    this._lastActiveUnitId = au.unitId;

    const rawGround = this._groundAt(c.x, c.z);
    const ground = Number.isFinite(rawGround) ? rawGround : 0.0;

    // 1. 首帧、切换受控单位或远距离传送：瞬时硬吸附到真实地表
    if (unitChanged || jumpDist > 2.5) {
      c.y = ground;
      c.vy = 0;
      c.onGround = true;
      this._missionGroundSynced = true;
    }

    // 2+3. 竖直动力学（doc9 P0-1 纯函数 stepCharacterVertical —— GATE-01 同源口径）
    const g = this._gravity();
    const depth = this._fluidDepth(c);          // P2-1 浸没深度
    const diving = depth > FLUID_WADE_MAX;
    const jump = this._oneShot.jump === true;
    this._oneShot.jump = false;
    const st = stepCharacterVertical({
      y: c.y, vy: c.vy, onGround: c.onGround, ground, g, dt,
      jump,
      hovering: !!this.keys.Space && !c.onGround && c.fuel > 0,
      diving,
      thruster: diving && !!this.keys.Space && c.fuel > 0,
      fuel: c.fuel,
    });
    c.y = st.y;
    c.vy = st.vy;
    c.onGround = st.onGround;
    c.fuel = st.fuel;

    // 3. 接触冲量速度清零铁律：只要踩地或深陷地面，法向冲量无条件截断 vy < 0
    const deficit = ground - c.y;
    if (deficit >= 0) {
      if (c.vy < 0) c.vy = 0; // 彻底切断重力发散逃逸闭环
      c.onGround = true;
      if (deficit > 1.5) {
        c.y = ground; // 大落差直接吸附，杜绝穿模入地
      } else {
        c.y = Math.min(ground, c.y + 14.0 * dt);
        if (ground - c.y < 0.02) c.y = ground;
      }
    } else if (c.y > ground + 0.08) {
      c.onGround = false;
    } else {
      // 下坡微吸附（0.08m 内且无向上初速度时保持贴地）
      if (c.vy <= 0) {
        c.y = ground;
        c.vy = 0;
        c.onGround = true;
      }
    }

    // 4. 越界就地挽救：杜绝重置到 spawn 引起的橡皮筋死循环
    if (!Number.isFinite(c.y) || c.y < -45) {
      c.y = Number.isFinite(ground) ? ground : 8.0;
      c.vy = 0;
      c.onGround = true;
    }

    // —— P2-1 流体反馈：涉水水花 + 危险区排放（任务 XZ 由 domain 权威，不阻尼） ——
    this._emitSplash(c, dt, depth > 0 && au.state === 'move');
    this._hazardDrain(c, dt, depth);

    // 状态映射：run / attack / hurt / dig（采掘中）/ idle
    if (this._buildMode && this._mouse.lDown && this._aim && this._aim.dug) {
      c.state = 'dig';
    } else if (au.state === 'move') c.state = 'run';
    else if (au.state === 'attack') c.state = 'attack';
    else if (au.state === 'hurt') c.state = 'hurt';
    else c.state = 'idle';
    c.attackT = au.state === 'attack'
      ? clamp(au.stateTime / 0.68, 0, 1)
      : 0;
    c.flash = m.time - au.lastHitAt < 0.3
      ? clamp(1 - (m.time - au.lastHitAt) / 0.3, 0, 1)
      : 0;
  },

  /**
   * 自由模式本地物理：相机相对移动 + 体素 AABB 碰撞（轴分离滑行）
   * + 重力 / 跳跃 / 喷气悬停 + 本地攻击/格挡/闪避状态机。
   */
  _freePhysics(dt) {
    const c = this.char3d;
    const sw = this.sw;
    c.animT += dt;
    const mv = this._moveVec();
    const sprinting = !!mv && (this.keys.ShiftLeft || this.keys.ShiftRight) && c.stamina > 0;
    const speed = 4.2 * (sprinting ? 1.5 : 1);

    if (c.state === 'attack') {
      // 本地攻击状态机（与任务 FSM 同参数）：前摇打击拍 → 后摇收招
      const a = ATTACK_PARAMS[c.attackKind] || ATTACK_PARAMS.light;
      c.attackT += dt;
      if (!c.struckFx && c.attackT >= a.windup) {
        c.struckFx = true;
        this._emitAttackFx(c.attackKind);
      }
      if (c.attackT >= a.windup + a.recover) {
        c.state = 'idle';
        c.attackT = 0;
        c.attackKind = null;
      }
    } else if (c.state === 'block') {
      c.blockT += dt;
      if (!this.keys.Digit4 || c.blockT >= 0.25) c.state = 'idle';
    } else if (this._oneShot.attack && c.atkCd <= 0) {
      c.attackKind = this._oneShot.attack;
      c.state = 'attack';
      c.attackT = 0;
      c.struckFx = false;
      c.atkCd = ATTACK_PARAMS[c.attackKind].windup + ATTACK_PARAMS[c.attackKind].recover;
      const fwd = this._camForward();
      c.yaw = Math.atan2(-fwd[2], fwd[0]);   // 面向相机前向
    } else if (this.keys.Digit4 && c.stamina >= 15) {
      // 技能 4：偏导护盾格挡（0.25s 判定窗，耗耐 15 —— 与任务 FSM 同参）
      c.stamina -= 15;
      c.blockT = 0;
      c.state = 'block';
    } else if (mv) {
      const yawWant = Math.atan2(-mv.z, mv.x);
      c.yaw += normAngle(yawWant - c.yaw) * Math.min(1, dt * 12);
      c.state = 'run';
    } else {
      c.state = 'idle';
    }
    this._oneShot.attack = null;
    c.atkCd = Math.max(0, c.atkCd - dt);

    // —— P2-1 流体：浸没深度分档（涉水阻尼 / 潜水态） ——
    const depth = this._fluidDepth(c);
    const wading = depth > 0 && depth <= FLUID_WADE_MAX;
    const diving = depth > FLUID_WADE_MAX;
    const fluidDamp = wading ? 0.65 : 1;   // 涉水水平移速 ×0.65 阻尼

    // —— XZ 位移（闪避爆发 + 常速移动，体素 AABB 轴分离碰撞 / 场域坡度阻断） ——
    if (c.dodgeT > 0) {
      c.dodgeT -= dt;
      this._moveAABB(c.dodgeX * 8.0 * fluidDamp * dt, c.dodgeZ * 8.0 * fluidDamp * dt);
    } else if (mv) {
      this._moveAABB(mv.x * speed * fluidDamp * dt, mv.z * speed * fluidDamp * dt);
    }

    // —— 竖直物理（P0-1 接触冲量闭环 + P2-1 潜水动力学） ——
    const g = this._gravity();
    if (this._oneShot.dodge) {
      this._oneShot.dodge = false;
      if (c.onGround) {
        c.vy = Math.sqrt(2 * g * 1.2);
        c.onGround = false;
        // 空格点按同时给一次闪避爆发（与任务 FSM 的 dodge 对齐）
        const dir = mv || { x: Math.cos(c.yaw), z: -Math.sin(c.yaw) };
        c.dodgeT = 0.18;
        c.dodgeX = dir.x;
        c.dodgeZ = dir.z;
        c.stamina = Math.max(0, c.stamina - 25);
      }
    }
    if (diving) {
      // 潜水态：有效重力 ×0.22、终端 -2.2；空格 = 水下推进器平稳上浮（同喷气燃料口径）
      if (this.keys.Space && c.fuel > 0) {
        c.fuel = Math.max(0, c.fuel - JET_DRAIN * dt);
        c.vy = Math.min(c.vy + FLUID_THRUSTER_VY * dt * 6, FLUID_THRUSTER_VY);
      } else {
        c.vy = Math.max(c.vy - g * FLUID_DIVE_GRAV * dt, FLUID_DIVE_TERMINAL);
        c.fuel = Math.min(100, c.fuel + JET_REGEN * dt);
      }
    } else {
      const hovering = !!this.keys.Space && !c.onGround && c.fuel > 0;
      if (hovering) {
        c.fuel = Math.max(0, c.fuel - JET_DRAIN * dt);
        c.vy = Math.max(c.vy - g * dt * 0.12, -0.7);
      } else {
        c.vy = Math.max(c.vy - g * dt, -28.0);  // 终端速度截断（与任务模式同参）
        c.fuel = Math.min(100, c.fuel + JET_REGEN * dt);
      }
    }
    c.y += c.vy * dt;
    // 头顶体素检测：上升顶头即截停（场域连续地形无洞穴顶盖，跳过）
    if (!this.field && c.vy > 0
      && getVoxel(sw, Math.floor(c.x), Math.floor(c.y + PLAYER_HEIGHT), Math.floor(c.z)) !== SURFACE_MAT.AIR) {
      c.vy = 0;
    }
    // 接触冲量速度清零铁律：踩地/深陷地面时无条件截断 vy < 0（含场下），有限爬升贴地
    const ground = this._groundAt(c.x, c.z);
    if (Number.isFinite(ground)) {
      const deficit = ground - c.y;
      if (deficit >= 0) {
        if (c.vy < 0) c.vy = 0;
        c.onGround = true;
        if (deficit > 1.5) {
          c.y = ground;                          // 大落差直接吸附
        } else {
          c.y = Math.min(ground, c.y + 14.0 * dt);
          if (ground - c.y < 0.02) c.y = ground;
        }
      } else if (c.y > ground + 0.08) {
        c.onGround = false;
      } else if (c.vy <= 0) {
        // 下坡微吸附
        c.y = ground;
        c.vy = 0;
        c.onGround = true;
      }
    } else {
      c.onGround = false;
    }
    // 越界就地挽救（P0-1）：吸附到当地地表，杜绝回出生点的橡皮筋死循环
    if (!Number.isFinite(c.y) || c.y < (this.field ? -45 : -12)) {
      c.y = Number.isFinite(ground) ? ground : 8.0;
      c.vy = 0;
      c.onGround = true;
    }
    // —— P2-1 流体反馈：涉水水花 + 危险区排放 ——
    this._emitSplash(c, dt, depth > 0 && !!mv);
    this._hazardDrain(c, dt, depth);
    // 采掘姿态：建造模式按住左键且本帧实际挖到（覆盖待机/奔跑姿态）
    if (this._buildMode && this._mouse.lDown && this._aim && this._aim.dug
      && (c.state === 'idle' || c.state === 'dig' || c.state === 'run')) {
      c.state = 'dig';
    }
    // 耐力：冲刺 10/s、闪避 25/次，其余 12/s 回复（与 GroundMission 对齐）
    if (sprinting) c.stamina = Math.max(0, c.stamina - 10 * dt);
    else if (c.state !== 'block' && c.dodgeT <= 0) c.stamina = Math.min(c.staminaMax, c.stamina + 12 * dt);
    c.flash = Math.max(0, c.flash - dt * 3);
  },

  /**
   * 碰撞移动：场域模式 = 坡度阻断行走（Δh/Δx 超阈值陡壁不可攀，连续三角网格
   * 无离散墙体）；体素兜底模式 = AABB 轴分离滑行（撞实体素滑开）。
   */
  _moveAABB(dx, dz) {
    const c = this.char3d;
    if (this.field) {
      const h0 = this._groundAt(c.x, c.z);
      if (dx) {
        const nx = clamp(c.x + dx, 2, FIELD_WALK_MAX);
        const h1 = this._groundAt(nx, c.z);
        if (Number.isFinite(h1) && h1 - h0 < WALK_SLOPE_BLOCK) c.x = nx;
      }
      if (dz) {
        const nz = clamp(c.z + dz, 2, FIELD_WALK_MAX);
        const h1 = this._groundAt(c.x, nz);
        if (Number.isFinite(h1) && h1 - h0 < WALK_SLOPE_BLOCK) c.z = nz;
      }
      return;
    }
    const solidBox = (px, pz) => {
      const y0 = Math.floor(c.y + 0.05);
      const y1 = Math.floor(c.y + PLAYER_HEIGHT - 0.05);
      const x0 = Math.floor(px - PLAYER_HALF);
      const x1 = Math.floor(px + PLAYER_HALF);
      const z0 = Math.floor(pz - PLAYER_HALF);
      const z1 = Math.floor(pz + PLAYER_HALF);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          for (let z = z0; z <= z1; z++) {
            if (getVoxel(this.sw, x, y, z) !== SURFACE_MAT.AIR) return true;
          }
        }
      }
      return false;
    };
    if (dx) {
      const nx = clamp(c.x + dx, 1, SURFACE_SIZE.X - 1);
      if (!solidBox(nx, c.z)) c.x = nx;
    }
    if (dz) {
      const nz = clamp(c.z + dz, 1, SURFACE_SIZE.Z - 1);
      if (!solidBox(c.x, nz)) c.z = nz;
    }
  },

  /** 相机前向单位向量（准星射线；eye = 胸口 + 背向臂长） */
  _camForward() {
    const cp = Math.cos(this.cam.pitch);
    const sp = Math.sin(this.cam.pitch);
    const sy = Math.sin(this.cam.yaw);
    const cy = Math.cos(this.cam.yaw);
    this._fwd[0] = -cp * sy;
    this._fwd[1] = -sp;
    this._fwd[2] = -cp * cy;
    return this._fwd;
  },

  /**
   * 每帧准星两段 DDA：第一段沿相机前向求瞄准点（臂长 + 视距），
   * 第二段从角色胸口指向瞄准点、以角色为基准的采掘触及范围（AIM_REACH）。
   * 第三人称下准星与挖掘目标因此始终一致，且触及半径不随臂长缩放。
   */
  _updateAim(dt) {
    this._digCd = Math.max(0, this._digCd - dt);
    this._placeCd = Math.max(0, this._placeCd - dt);
    const c = this.char3d;
    const cp = Math.cos(this.cam.pitch);
    const sp = Math.sin(this.cam.pitch);
    const sy = Math.sin(this.cam.yaw);
    const cy = Math.cos(this.cam.yaw);
    const d = this.cam.dist;
    this._eye[0] = c.x + cp * sy * d;
    this._eye[1] = c.y + 1.55 + sp * d;
    this._eye[2] = c.z + cp * cy * d;
    const fwd = this._camForward();

    if (this.field) {
      // —— 场域模式：与连续三角网格求交（doc7 TASK-1.2，替代体素 DDA） ——
      const eyeF = [this._eye[0] + FIELD_OFFSET, this._eye[1], this._eye[2] + FIELD_OFFSET];
      const camRay = raycastTerrain(this.field, eyeF, fwd, d + AIM_REACH + 4);
      const camT = camRay.hit ? camRay.t : d + 4;
      const aimPt = [
        this._eye[0] + fwd[0] * camT,
        this._eye[1] + fwd[1] * camT,
        this._eye[2] + fwd[2] * camT,
      ];
      const chest = [c.x, c.y + 1.25, c.z];
      const ddx = aimPt[0] - chest[0];
      const ddy = aimPt[1] - chest[1];
      const ddz = aimPt[2] - chest[2];
      const len = Math.hypot(ddx, ddy, ddz) || 1;
      this._aimFar = len > AIM_REACH + 0.6;
      let hit = null;
      if (!this._aimFar) {
        const r = raycastTerrain(this.field, [chest[0] + FIELD_OFFSET, chest[1], chest[2] + FIELD_OFFSET],
          [ddx / len, ddy / len, ddz / len], AIM_REACH);
        if (r.hit) {
          // 场域命中 → 体素列语义（矿脉/结构数据底层仍在体素补丁内）
          const vx = Math.floor(r.point[0] - FIELD_OFFSET);
          const vz = Math.floor(r.point[2] - FIELD_OFFSET);
          const colTop = getSurfaceHeight(this.sw, vx, vz);
          // 主导轴法线 → 体素邻面语义（建造放置沿用）
          const n = r.normal || [0, 1, 0];
          const ax = Math.abs(n[0]);
          const ay = Math.abs(n[1]);
          const az = Math.abs(n[2]);
          const nx = ax > ay && ax > az ? Math.sign(n[0]) : 0;
          const ny = ay >= ax && ay >= az ? Math.sign(n[1]) : 0;
          const nz = az > ax && az > ay ? Math.sign(n[2]) : 0;
          hit = {
            hit: true,
            vx, vz,
            vy: colTop >= 0 ? colTop : Math.floor(r.point[1]),
            nx, ny, nz,
            matId: colTop >= 0 ? getVoxel(this.sw, vx, colTop, vz) : 0,
            t: r.t,
            px: r.point[0] - FIELD_OFFSET,
            py: r.point[1],
            pz: r.point[2] - FIELD_OFFSET,
          };
        }
      }
      this._aim = hit;
      if (this._aim) this._aim.dug = false;
    } else {
      // —— 体素兜底（2D 降级/场域缺失）：两段 DDA（原逻辑） ——
      const camRay = ddaRaycast(this.sw, this._eye, fwd, d + AIM_REACH);
      const camT = camRay.hit ? camRay.t : d + 4;
      const aimPt = [
        this._eye[0] + fwd[0] * camT,
        this._eye[1] + fwd[1] * camT,
        this._eye[2] + fwd[2] * camT,
      ];
      const chest = [c.x, c.y + 1.25, c.z];
      const ddx = aimPt[0] - chest[0];
      const ddy = aimPt[1] - chest[1];
      const ddz = aimPt[2] - chest[2];
      const len = Math.hypot(ddx, ddy, ddz) || 1;
      this._aimFar = len > AIM_REACH + 0.6;
      const hit = this._aimFar
        ? { hit: false }
        : ddaRaycast(this.sw, chest, [ddx / len, ddy / len, ddz / len], AIM_REACH);
      this._aim = hit.hit ? hit : null;
      if (this._aim) this._aim.dug = false;
    }

    // —— 采掘（建造模式按住左键，节流 DIG_INTERVAL） ——
    if (this._buildMode && this._mouse.lDown && this._digCd <= 0 && this._aim) {
      this._digCd = DIG_INTERVAL;
      this._tryDig(this._aim);
    }
    // —— 建造（建造模式按住右键且未拖拽旋转相机，节流 PLACE_INTERVAL） ——
    if (this._buildMode && this._mouse.rDown && !this._mouse.dragged && this._placeCd <= 0) {
      this._placeCd = PLACE_INTERVAL;
      this._tryPlace(this._aim);
    }
  },

  /** 采掘：digVoxel → digChunk 增量重建 → 资源入账（creditColony / 视图台账） */
  _tryDig(hit) {
    const sw = this.sw;
    const matId = getVoxel(sw, hit.vx, hit.vy, hit.vz);
    if (matId === SURFACE_MAT.AIR || matId === SURFACE_MAT.BEDROCK) return;
    const r = digVoxel(sw, hit.vx, hit.vy, hit.vz);
    if (!r || r.matId === SURFACE_MAT.AIR) return;   // domain 判定不可挖（含并发保护）
    if (this._aim) this._aim.dug = true;
    this._fx.dig.push({ x: hit.vx, y: hit.vy, z: hit.vz, matId: r.matId });
    if (this.field) {
      // 场域模式：地形凹陷雕刻 + Chunk 标脏（TERRAIN-06 增量重建由场景 sync 执行）
      const key = hit.vx * 4096 + hit.vz;
      this._digDents.set(key, (this._digDents.get(key) || 0) + 1);
      this._markFieldDirty(hit.vx, hit.vz);
    } else if (this.ps3d) {
      this.ps3d.digChunk(Math.floor(hit.vx / SURFACE_SIZE.CHUNK), Math.floor(hit.vz / SURFACE_SIZE.CHUNK));
    }
    if (r.resourceDrop) {
      const { resId, amount } = r.resourceDrop;
      if (this.colony) {
        creditColony(this.app.world, this.colony, resId, amount, 'surfaceMining', this.colony.id);
      }
      this._tally[resId] = (this._tally[resId] || 0) + amount;
    }
  },

  /** 建造：命中面法向相邻格 placeVoxel(BUILDING) → digChunk（殖民地扣 1 合金/格） */
  _tryPlace(hit) {
    if (!hit || (hit.nx === 0 && hit.ny === 0 && hit.nz === 0)) return; // 起点即实体的零法线命中
    const tx = hit.vx + hit.nx;
    const ty = hit.vy + hit.ny;
    const tz = hit.vz + hit.nz;
    if (ty < 0 || ty >= SURFACE_SIZE.Y) return;
    // 拒绝与角色碰撞盒重叠的放置（防自埋）
    const c = this.char3d;
    if (tx === Math.floor(c.x) && tz === Math.floor(c.z)
      && ty >= Math.floor(c.y) && ty <= Math.floor(c.y + PLAYER_HEIGHT)) return;
    if (this.colony && (this.colony.stockpile?.alloy ?? 0) < 1) {
      this._placeCd = 1.0;            // 合金不足：降频提示
      toast('结构体素需要合金（殖民地仓储 alloy ≥ 1）', { kind: 'warn' });
      return;
    }
    if (!placeVoxel(this.sw, tx, ty, tz, SURFACE_MAT.BUILDING)) return;
    if (this.colony) {
      debitColony(this.app.world, this.colony, 'alloy', 1, 'surfaceBuild', this.colony.id);
      this._tally.alloy = (this._tally.alloy || 0) - 1;
    }
    if (this.field) {
      // 场域模式：结构体素经建筑批处理渲染（占位盒，Wave F 建筑系统替换为
      // 坡度地基/模块化结构网格）；不再依赖体素贪心网格重建。
      this._placedVoxels.set(tx * 4096 + tz, { x: tx, y: ty, z: tz });
    } else if (this.ps3d) {
      this.ps3d.digChunk(Math.floor(tx / SURFACE_SIZE.CHUNK), Math.floor(tz / SURFACE_SIZE.CHUNK));
    }
  },

  // —— 特效 ————————————————

  /**
   * 打击拍检测：每个攻击回合（state 进入 attack）内 struck 首次翻 true 的那一帧
   * 发出刀光/光束。armed 标记防止同一回合重复触发（struck 在回合内保持 true）。
   */
  _detectStrikes(view) {
    for (const u of view.playerUnits) {
      if (u.state === 'dead') continue;
      const key = u.unitId;
      const prev = this._strikeSeen.get(key) || { state: null, armed: false };
      let armed = prev.armed;
      if (u.state === 'attack' && prev.state !== 'attack') armed = false; // 新攻击回合
      if (u.state === 'attack' && u.struck && !armed) {
        armed = true;
        this._emitMissionStrike(view, u);
      }
      this._strikeSeen.set(key, { state: u.state, armed });
    }
    if (this._strikeSeen.size > 8) this._strikeSeen.clear();
  },

  /** 任务打击特效：近战刀光（伤害 22/×2 对应弧度一致）或远程光束 */
  _emitMissionStrike(view, u) {
    const m = this.mission;
    const kx = SURFACE_SIZE.X / (m.w * TS);
    const kz = SURFACE_SIZE.Z / (m.h * TS);
    const wx = u.x * kx;
    const wz = u.y * kz;
    const yaw = -u.facing;
    if (u.attackKind === 'ranged') {
      let tgt = null;
      let bd = Infinity;
      const rangeW = u.range * kx;
      for (const e of view.enemies) {
        if (e.state === 'dead') continue;
        const d = Math.hypot(e.x * kx - wx, e.y * kz - wz);
        if (d <= rangeW && d < bd) {
          bd = d;
          tgt = e;
        }
      }
      const a = [wx, this.char3d.y + 1.25, wz];
      let b;
      if (tgt) {
        const gy = this._groundAt(tgt.x * kx, tgt.y * kz);
        b = [tgt.x * kx, (gy === Infinity ? this.char3d.y : gy) + 0.8, tgt.y * kz];
      } else {
        // 空放：沿任务朝向（像素系 atan2 → 世界 x/z）打出一道曳光
        b = [wx + Math.cos(u.facing) * 18 * kx, this.char3d.y + 1.25, wz + Math.sin(u.facing) * 18 * kz];
      }
      this._fx.beams.push({ a, b, age: 0, life: 0.12 });
    } else {
      this._fx.slashes.push({
        x: wx, y: this.char3d.y, z: wz, yaw,
        arc: Math.PI * 0.9, t: 0, age: 0, life: 0.18,
      });
    }
  },

  /** 自由模式攻击特效（本地状态机打击拍） */
  _emitAttackFx(kind) {
    const c = this.char3d;
    if (kind === 'ranged') {
      const f = this._camForward();
      this._fx.beams.push({
        a: [c.x, c.y + 1.25, c.z],
        b: [c.x - f[0] * 24, c.y + 1.25 - f[1] * 24, c.z - f[2] * 24],
        age: 0, life: 0.12,
      });
    } else {
      this._fx.slashes.push({
        x: c.x, y: c.y, z: c.z, yaw: c.yaw,
        arc: kind === 'heavy' ? Math.PI * 1.2 : Math.PI * 0.9,
        t: 0, age: 0, life: 0.18,
      });
    }
  },

  /** 推进瞬时特效寿命（刀光 t 扫掠 0..1；光束到寿即删；采掘粒子事件单次消费） */
  _updateFx(dt) {
    const fx = this._fx;
    for (let i = fx.slashes.length - 1; i >= 0; i--) {
      const s = fx.slashes[i];
      s.age += dt;
      s.t = clamp(s.age / s.life, 0, 1);
      if (s.age >= s.life) fx.slashes.splice(i, 1);
    }
    for (let i = fx.beams.length - 1; i >= 0; i--) {
      const b = fx.beams[i];
      b.age += dt;
      if (b.age >= b.life) fx.beams.splice(i, 1);
    }
    this._updatePoiBurst(dt);          // P2-2 POI 采样能量喷发（0.8s）
  },

  // —— 殖民地 3D 布局 / 传送带 ————————————————

  /**
   * 殖民地建筑确定性布局：黄金角螺旋环绕出生点，逐列吸附地表。
   * 建造队列条目以 0.55 缩放 + 自发光渲染为脚手架。
   * 同时生成每个建筑旁的作业殖民者（确定性相位）。
   */
  _layoutColony() {
    this._buildingLayout = [];
    this._buildingColonists = [];
    const colony = this.colony;
    if (!colony) return;
    // —— P1-2（doc8 §3.2 议题 B2 裁决）：废除黄金角盲盒螺旋，等高线感知选址 ——
    // groundBuildings（PlaceBuilding 双轨）原样合并；未定坐标建筑由
    // planColonyLayout 在过渡环带 22-75m 内按 9 点坡度校验确定性寻址。
    const w = this.app.world;
    const planetEntity = w ? w.entities.planets[this.planet.id] : null;
    const centerFx = 32.5 - FIELD_OFFSET;   // 体素出生点 → 场域坐标
    const centerFz = 32.5 - FIELD_OFFSET;
    const plan = planColonyLayout(this.field, {
      entries: [
        ...(colony.buildings || []),
        ...(colony.constructionQueue || []).map((j) => ({ defId: j.defId, state: 'construction' })),
      ],
      groundBuildings: (planetEntity && planetEntity.groundBuildings) || [],
      center: [centerFx, centerFz],
      categoryOf: (defId) => {
        const def = BUILDINGS.find((x) => x.id === defId);
        return def ? def.category : 'default';
      },
      themeId: this.planet.primaryThemeId || null,
    });
    for (let i = 0; i < plan.length; i++) {
      const b = plan[i];
      const x = b.fx - FIELD_OFFSET;
      const z = b.fz - FIELD_OFFSET;
      const h = this._groundAt(x, z);
      if (!Number.isFinite(h)) continue;
      const building = b.state !== 'construction';
      this._buildingLayout.push({
        x,
        y: Number.isFinite(b.y) ? b.y : h,
        z,
        rotY: b.rotY,
        scale: building ? 1 : 0.55,
        meshId: MESH_OF_CATEGORY(b.category),
        emit: building ? 0 : 0.25,
      });
      this._buildingColonists.push({
        x: x + 1.6,
        y: Number.isFinite(b.y) ? b.y : h,
        z: z + 1.2,
        rotY: (i * 0.37) % 1 * Math.PI * 2,
        walk: false,
        phase: (i * 0.29) % 1,
      });
    }
  },

  /**
   * 传送带路径：每座（已建成）采掘建筑连接最近精炼建筑的地面折线，
   * 逐 1 体素采样并吸附列顶（PlanetSurface3D 沿路径铺带段 + 滑动货箱）。
   */
  _buildConveyorPaths() {
    const paths = [];
    const mines = this._buildingLayout.filter((b) => b.scale === 1 && b.meshId === MESH_OF_CATEGORY('mining'));
    const refs = this._buildingLayout.filter((b) => b.scale === 1 && b.meshId === MESH_OF_CATEGORY('refining'));
    if (!mines.length || !refs.length) return paths;
    for (const mn of mines) {
      if (paths.length >= 6) break;
      let best = null;
      let bd = Infinity;
      for (const rf of refs) {
        const d = Math.hypot(rf.x - mn.x, rf.z - mn.z);
        if (d < bd) {
          bd = d;
          best = rf;
        }
      }
      if (!best || bd < 2) continue;
      // P1-2：Catmull-Rom 样条平滑 + 每段高度 max(groundY + 0.15, splineY)
      const p0 = [mn.x, mn.y, mn.z];
      const p3 = [best.x, best.y, best.z];
      const p1 = [mn.x + (best.x - mn.x) * 0.3, mn.y, mn.z + (best.z - mn.z) * 0.3];
      const p2 = [mn.x + (best.x - mn.x) * 0.7, best.y, mn.z + (best.z - mn.z) * 0.7];
      const cr = (a, b, c, d, t) => {
        const t2 = t * t;
        const t3 = t2 * t;
        return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      };
      const n = Math.max(6, Math.ceil(bd * 2));
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = cr(p0[0], p1[0], p2[0], p3[0], t);
        const z = cr(p0[2], p1[2], p2[2], p3[2], t);
        const sy = cr(p0[1], p1[1], p2[1], p3[1], t);
        const h = this._groundAt(x, z);
        const y = Math.max(Number.isFinite(h) ? h + 0.15 : sy, sy);
        pts.push([x, y, z]);
      }
      paths.push({ pts, speed: 1.6, spacing: 1.1 });
    }
    return paths;
  },

  // —— 渲染 ————————————————

  /**
   * 渲染一帧：GL 场景（连续地形/天空/天气 → 对象 pass → 建筑批处理）→ HUD 2D。
   * 场景化集成（doc7 TASK-1.2/1.4）：地形/天空权威在 PlanetSurfaceScene；
   * 相机弹簧臂以场域射线收臂（raycastTerrain），同一 VP 供对象 pass 与建筑批处理。
   * @param {object|null} view getMissionView 快照（自由模式为 null）
   */
  _renderFrame(view, dt) {
    const cm = this.cm;
    if (!cm) return;
    cm.beginFrame();

    const rd = this._assembleRenderData(view);
    if (this._glOK && this.scene && this.ps3d) {
      const target = cm.beginGLFrame();
      if (target) {
        const gl = this.cm.gl;
        const pw = this.cm.glCanvas.width;
        const ph = this.cm.glCanvas.height;

        // —— P1-1 弹簧臂相机（doc9 §3.2）：三层防穿透与眼位离地净空守护 ——
        // 纯函数实现在模块级 computeSpringArm（GATE-03 无头 360° 扫描同源口径）
        const c = this.char3d;
        const arm = computeSpringArm({
          field: this.field,
          groundAt: (x, z) => this._groundAt(x, z),
          charX: c.x, charY: c.y, charZ: c.z,
          yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist,
          springDist: this._springDist, dt,
        });
        this._springDist = arm.springDist;
        const tgt = arm.tgt;
        const eye = arm.eye;

        // 第三层保护：相机眼位离地净空绝对钳制（永远离地 ≥0.65m，杜绝钻入山体）
        const eyeGround = this._groundAt(eye[0], eye[2]);
        if (Number.isFinite(eyeGround) && eye[1] < eyeGround + 0.65) {
          eye[1] = eyeGround + 0.65;
        }
        const mm = this._m;
        mat4Perspective(mm.proj, 1.05, pw / Math.max(1, ph), 0.1, 1600);
        mat4LookAt(mm.view, eye, tgt, [0, 1, 0]);
        mat4Multiply(mm.vp, mm.proj, mm.view);

        // —— P2-1 水下视锥：眼位没入水面 → 雾距收窄 [6,68] + 深海蓝青雾色（沿触发） ——
        const liveLv = this._liveWaterLevel();
        const under = liveLv != null && eye[1] < liveLv;
        if (under !== this._underwater) {
          this._underwater = under;
          if (this.scene) {
            if (under) {
              this.scene.setFogOnly({ color: [0.02, 0.23, 0.34], range: [6.0, 68.0] });
            } else {
              const fog = (this._themePayload && this._themePayload.terrain.fog) || {};
              this.scene.setFogOnly({ color: fog.color, range: fog.range });
            }
          }
        }
        // 对象 pass 与建筑批处理共用同一水下雾（THEME-02 一致性）
        if (this.ps3d) {
          if (under) {
            this.ps3d._fogColor = [0.02, 0.23, 0.34];
            this.ps3d._fogRange = [6.0, 68.0];
          } else if (this._themePayload) {
            this.ps3d._fogColor = this._themePayload.terrain.fog.color.slice();
            this.ps3d._fogRange = this._themePayload.terrain.fog.range.slice();
          }
        }

        // —— 1. 场景：连续地形 + 天空 + 天气（清屏唯一所有者仍是 PostProcessor） ——
        this.scene.draw(gl, pw, ph, {
          time: this._clock,
          dt,
          camera: { eye, target: tgt },
          actors: rd,
        }, {});

        // —— 2. 对象 pass：敌人/殖民者/传送带/角色七部件/贴花/特效（外部相机） ——
        this.ps3d.setExternalCamera(eye, tgt, mm.vp);
        this.ps3d.draw(gl, pw, ph, rd, { time: this._clock, dt });

        // —— 3. 建筑网格批处理：与场景同帧相机 + 同源光照 ——
        const bList = this.bmesh ? this._bmeshList() : null;
        if (this.bmesh && bList.length) {
          this.bmesh.draw(gl, mm.vp, this._envOf(), bList);
        }
        cm.endGLFrame({ time: this._clock });
      }
    }
    this._fx.dig.length = 0;          // 采掘粒子事件单次消费（渲染器逐事件喷发）
    this._drawHud(view);
  },

  /** 组装 PlanetSurface3D.renderData（全部字段缺省安全） */
  _assembleRenderData(view) {
    const c = this.char3d;
    const rd = {
      character: {
        x: c.x, y: c.y, z: c.z, yaw: c.yaw,
        state: c.state, animT: c.animT, attackT: c.attackT, flash: c.flash,
      },
      camera: { yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist },
      enemies: [],
      colonists: this._buildingColonists.slice(),   // 拷贝：后续会并入任务 NPC/队友
      conveyor: { paths: this._conveyor },
      effects: {
        slashes: this._fx.slashes,
        beams: this._fx.beams,
        aoe: [],
        digEvents: this._fx.dig,
      },
    };
    if (!view) return rd;

    const m = this.mission;
    const kx = SURFACE_SIZE.X / (m.w * TS);
    const kz = SURFACE_SIZE.Z / (m.h * TS);
    // 敌人（≤40，kind 与任务 type 同名；闪白取 lastHitAt 衰减）
    const fallY = this.char3d.y || 0;
    for (const e of view.enemies) {
      if (e.state === 'dead') continue;
      const ex = e.x * kx;
      const ez = e.y * kz;
      const gy = this._groundAt(ex, ez);
      const hitAge = m.time - e.lastHitAt;
      rd.enemies.push({
        kind: e.type,
        x: ex,
        y: gy === Infinity ? fallY : gy,   // 悬浮平台虚空列回退到角色高度
        z: ez,
        yaw: -e.facing,
        phase: e.phase || 0,
        flash: hitAge < 0.25 ? clamp(1 - hitAge / 0.25, 0, 1) : 0,
        hp: e.hp,
        hpMax: e.hpMax,
        state: e.state,
      });
      // 前摇期红色预警贴花（AoE 落点 = 面向前方 2 格）
      if (e.state === 'windup') {
        rd.effects.aoe.push({
          x: ex + Math.cos(e.facing) * 2.0,
          z: ez + Math.sin(e.facing) * 2.0,
          r: 1.9,
          t: clamp(e.stateTime / Math.max(0.01, e.windupS), 0, 1),
        });
      }
    }
    // 非激活小队成员以殖民者网格随行显示（外骨骼实例管线仅承载激活位）
    const activeId = view.activeUnitId;
    for (const u of view.playerUnits) {
      if (u.state === 'dead' || u.unitId === activeId) continue;
      const ux = u.x * kx;
      const uz = u.y * kz;
      const gy = this._groundAt(ux, uz);
      rd.colonists.push({
        x: ux, y: gy === Infinity ? fallY : gy, z: uz,
        rotY: -u.facing, walk: u.state === 'move', phase: 0.5,
      });
    }
    // 任务 NPC（救援/工程队）
    for (const n of view.npcs) {
      if (n.state === 'safe') continue;
      const nx = n.x * kx;
      const nz = n.y * kz;
      const gy = this._groundAt(nx, nz);
      rd.colonists.push({
        x: nx, y: gy === Infinity ? fallY : gy, z: nz,
        rotY: 0, walk: n.state === 'follow', phase: 0.5,
      });
    }
    return rd;
  },

  /** 建筑批处理实例表：殖民地建筑 + 任务目标物 + 数据核心 + 体素选择框 + 已放置结构体素 */
  _bmeshList() {
    const list = this._buildingLayout.slice();
    const fallY = this.char3d.y || 0;
    const view = this._lastView;
    if (view && this.mode === 'mission') {
      const m = this.mission;
      const kx = SURFACE_SIZE.X / (m.w * TS);
      const kz = SURFACE_SIZE.Z / (m.h * TS);
      for (const t of view.targets) {
        if (t.done) continue;
        const tx = t.x * kx;
        const tz = t.y * kz;
        const gy = this._groundAt(tx, tz);
        const hurt = t.hp < t.hpMax;
        list.push({
          x: tx, y: gy === Infinity ? fallY : gy, z: tz,
          rotY: 0.7, scale: 0.8, meshId: MESH_OF_CATEGORY('military'),
          emit: hurt ? 0.15 : 0,
          flash: hurt && (m.time % 0.5) < 0.25 ? 0.3 : 0,
        });
      }
      for (const it of view.items) {
        if (it.done) continue;
        const ix = it.x * kx;
        const iz = it.y * kz;
        const gy = this._groundAt(ix, iz);
        list.push({
          x: ix, y: (gy === Infinity ? fallY : gy) + 0.5, z: iz,
          rotY: this._clock * 0.8, scale: 0.38, meshId: MESH_OF_CATEGORY('selector'),
          emit: 0.9,
        });
      }
    }
    // —— doc9 P0-3：站点旗舰地标（site.landmarks 场域坐标 → 世界 = -FIELD_OFFSET） ——
    //   仅渲染 landmarkMeshes 注册表内已建模的预制；未建模辅助地标（雷达站等）
    //   无网格资产，诚实跳过（LANDMARK_MESH_OF 返回 -1）。
    if (this._site && this._site.site && Array.isArray(this._site.site.landmarks)) {
      for (const lm of this._site.site.landmarks) {
        const meshId = LANDMARK_MESH_OF(lm.prefabId);
        if (meshId < 0) continue;
        const wx = lm.anchor.x - FIELD_OFFSET;
        const wz = lm.anchor.z - FIELD_OFFSET;
        const gy = this._groundAt(wx, wz);
        if (!Number.isFinite(gy)) continue;
        list.push({
          x: wx, y: gy, z: wz,
          rotY: lm.rotation || 0,
          scale: LANDMARK_SCALE[lm.prefabId] != null ? LANDMARK_SCALE[lm.prefabId] : 1.0,
          meshId,
          emit: 0,
        });
      }
    }
    // 未勘探 POI 全息信标（doc5 P1-04）+ 已采样「已发掘基座残骸」（doc9 P2-2）：
    // rewardPaid 后不隐藏 —— 蜕变为低矮暗灰基座（scale 0.55, emit 0.05）。
    if (this._pois) {
      for (const poi of Object.values(this._pois)) {
        const bx = poi.position.x - FIELD_OFFSET;
        const bz = poi.position.z - FIELD_OFFSET;
        const gy = this._groundAt(bx, bz);
        if (!Number.isFinite(gy)) continue;
        if (poi.rewardPaid || poi.state === 'explored') {
          list.push({
            x: bx, y: gy + 0.2, z: bz,
            rotY: 0, scale: 0.55, meshId: MESH_OF_CATEGORY('default'),
            emit: 0.05,
          });
        } else {
          list.push({
            x: bx, y: gy + 0.7 + Math.sin(this._clock * 2.2) * 0.12, z: bz,
            rotY: this._clock * 0.6, scale: 0.9, meshId: MESH_OF_CATEGORY('selector'),
            emit: 1.4,
          });
        }
      }
    }
    // 已放置结构体素（场域模式占位盒；Wave F 建筑系统替换为模块化结构网格）
    if (this._placedVoxels && this._placedVoxels.size) {
      for (const pv of this._placedVoxels.values()) {
        const gy = this._groundAt(pv.x + 0.5, pv.z + 0.5);
        list.push({
          x: pv.x + 0.5, y: Number.isFinite(gy) ? gy + 0.45 : pv.y + 0.5, z: pv.z + 0.5,
          rotY: 0, scale: 0.92, meshId: MESH_OF_CATEGORY('default'),
          emit: 0.08,
        });
      }
    }
    // 体素选择框：建造（右键）时高亮放置格，采掘时高亮命中格
    const aim = this._aim;
    if (this._buildMode && aim) {
      const hasNormal = aim.nx !== 0 || aim.ny !== 0 || aim.nz !== 0;
      const placing = this._mouse.rDown && hasNormal;
      const px = placing ? aim.vx + aim.nx : aim.vx;
      const py = placing ? aim.vy + aim.ny : aim.vy;
      const pz = placing ? aim.vz + aim.nz : aim.vz;
      list.push({
        x: px + 0.5, y: py + 0.5, z: pz + 0.5,
        rotY: 0, scale: 1.04, meshId: MESH_OF_CATEGORY('selector'),
        emit: 0.55,
      });
    }
    return list;
  },

  /** 从 PlanetSurface3D 读取已求值环境（保持地形/建筑/雾一致；缺失回退默认） */
  _envOf() {
    const p = this.ps3d;
    return {
      sunDir: (p && p._sunDir) || FALLBACK_ENV.sunDir,
      sunColor: (p && p._sunColor) || FALLBACK_ENV.sunColor,
      fogColor: (p && p._fogColor) || FALLBACK_ENV.fogColor,
      fogRange: (p && p._fogRange) || FALLBACK_ENV.fogRange,
      eye: p ? p.camera.eye : this._eye,
    };
  },

  // —— HUD（2D 层） ————————————————

  /** HUD 分派：任务 / 自由 / 降级提示 */
  _drawHud(view) {
    const ctx = this.cm.ctx;
    if (!ctx) return;
    const W = this.cm.width;
    const H = this.cm.height;
    if (!this._glOK) {
      ctx.fillStyle = 'rgba(8,14,22,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#cfe3f5';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('当前环境不支持 WebGL2，3D 地表不可用（模拟与 HUD 继续运行）', W / 2, H / 2);
      if (this._glErr) {
        ctx.font = '11px monospace';
        ctx.fillStyle = '#e8b04f';
        ctx.fillText(`GL init: ${this._glErr.slice(0, 90)}`, W / 2, H / 2 + 22);
      }
      ctx.textAlign = 'left';
    }
    // 准星（采掘/建造模式为方框 + 目标信息）
    this._drawCrosshair(ctx, W, H);
    if (this.mode === 'mission' && view) this._drawHudMission(ctx, W, H, view);
    else this._drawHudFree(ctx, W, H);
    this._drawSkillbar(ctx, W, H);
    this._drawHazardVignette(ctx, W, H);
  },

  /**
   * HUD 边缘告警光晕（doc9 P2-1 危险区反馈）：_hazardDrain 每帧置位
   * 'red'（熔岩/深潜过压）| 'purple'（硫雾酸蚀）| null；径向渐变描边。
   */
  _drawHazardVignette(ctx, W, H) {
    const kind = this._hazardVignette;
    if (!kind) return;
    const col = kind === 'purple' ? '138,60,200' : '224,64,42';
    const grad = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.38,
      W / 2, H / 2, Math.max(W, H) * 0.72,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(${col},0.38)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  },

  /** 屏幕中央准星：战斗为十字，采掘/建造为方框 + 材质信息 */
  _drawCrosshair(ctx, W, H) {
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    ctx.strokeStyle = 'rgba(220,240,255,0.85)';
    ctx.lineWidth = 1.5;
    if (this._buildMode) {
      ctx.strokeRect(cx - 7.5, cy - 7.5, 15, 15);
      const aim = this._aim;
      ctx.fillStyle = 'rgba(210,232,250,0.85)';
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        aim
          ? `${MAT_ZH[aim.matId] || '未知'}（${aim.vx},${aim.vy},${aim.vz}） 左键采掘 · 右键建造`
          : (this._aimFar ? '超出采掘范围' : '未瞄准体素'),
        cx, cy + 30,
      );
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx - 3, cy);
      ctx.moveTo(cx + 3, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy - 3);
      ctx.moveTo(cx, cy + 3);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
  },

  /** 任务 HUD：左上任务名/时间、左下三色条、右上目标列表 + 日志、撤离罗盘 */
  _drawHudMission(ctx, W, H, view) {
    const m = this.mission;
    const tpl = findMissionTemplate(m.templateId);
    const au = view.playerUnits.find((u) => u.unitId === view.activeUnitId)
      || view.playerUnits[0];

    // —— 左上：任务名 + 时间（+ 时限；下移避开应用悬浮顶栏） ——
    ctx.fillStyle = 'rgba(8,14,22,0.72)';
    ctx.fillRect(12, 62, 250, 54);
    ctx.strokeStyle = 'rgba(140,170,200,0.3)';
    ctx.strokeRect(12.5, 62.5, 249, 53);
    ctx.fillStyle = '#e8f2fb';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(tpl ? tpl.nameZh : m.templateId, 22, 82);
    ctx.fillStyle = '#9fb6c9';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    const limit = view.timeLimitSeconds > 0 ? ` / ${fmtClock(view.timeLimitSeconds)}` : '';
    ctx.fillText(`任务时间 ${fmtClock(view.time)}${limit} · 风险 ${m.riskLevel}/5`, 22, 100);
    ctx.fillText(`小队指令：${STANCES[this._stanceIdx]}${this._buildMode ? ' · 采掘/建造模式' : ''}`, 22, 112);

    // —— 小队成员迷你血条 ——
    let uy = 134;
    for (const u of view.playerUnits) {
      const dead = u.state === 'dead';
      ctx.fillStyle = dead ? 'rgba(90,40,40,0.7)' : 'rgba(8,14,22,0.72)';
      ctx.fillRect(12, uy, 250, 16);
      ctx.fillStyle = dead ? '#7a4a4a' : (u.unitId === view.activeUnitId ? '#ffd76a' : '#7fa8c9');
      ctx.font = '10px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`${u.characterId}${u.unitId === view.activeUnitId ? '（操纵中）' : ''}`, 18, uy + 11);
      if (!dead) {
        ctx.fillStyle = '#4fd8a0';
        ctx.fillRect(120, uy + 4, 130 * clamp(u.hp / u.hpMax, 0, 1), 8);
        ctx.strokeStyle = 'rgba(140,170,200,0.3)';
        ctx.strokeRect(120.5, uy + 4.5, 129, 7);
      }
      uy += 20;
    }

    // —— 右上：目标列表 + 行动日志（下移避开顶栏） ——
    const boxW = 268;
    const boxY = 62;
    ctx.fillStyle = 'rgba(8,14,22,0.72)';
    ctx.fillRect(W - boxW - 12, boxY, boxW, 30 + view.objectives.length * 18);
    ctx.strokeRect(W - boxW - 11.5, boxY + 0.5, boxW - 1, 29 + view.objectives.length * 18);
    ctx.fillStyle = '#e8f2fb';
    ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('任务目标', W - boxW + 2, boxY + 18);
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    for (const o of view.objectives) {
      const yLine = boxY + 36 + view.objectives.indexOf(o) * 18;
      ctx.fillStyle = o.done ? '#5fe0a0' : '#9fb6c9';
      ctx.fillText(o.done ? '✓' : '○', W - boxW + 2, yLine);
      let extra = '';
      if (o.count > 0) extra = `（${o.doneCount}/${o.count}）`;
      else if (o.type === 'survive') extra = `（${fmtClock(o.progress)}/${fmtClock(o.seconds)}）`;
      ctx.fillStyle = o.done ? '#5fe0a0' : '#cfe3f5';
      ctx.fillText(`${OBJ_ZH[o.type] || o.type}${extra}`, W - boxW + 18, yLine);
    }

    // —— 行动日志（最近 4 条，右上目标框下方） ——
    const y = boxY + 48 + view.objectives.length * 18;
    ctx.fillStyle = 'rgba(8,14,22,0.55)';
    ctx.fillRect(W - boxW - 12, y, boxW, 14 + Math.min(4, view.log.length) * 15);
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    const logs = view.log.slice(-4);
    for (let i = 0; i < logs.length; i++) {
      const line = logs[i];
      ctx.fillStyle = '#8fa8bd';
      ctx.fillText(`[${fmtClock(line.t)}] ${line.text}`, W - boxW + 2, y + 14 + i * 15);
    }

    // —— 撤离点罗盘（顶部中央箭头 + 距离；下移避开顶栏） ——
    const kx = SURFACE_SIZE.X / (m.w * TS);
    const kz = SURFACE_SIZE.Z / (m.h * TS);
    const ex = view.extraction.x * kx;
    const ez = view.extraction.y * kz;
    const c = this.char3d;
    const camFwd = this._camForward();
    const camAng = Math.atan2(camFwd[2], camFwd[0]);
    const rel = normAngle(Math.atan2(ez - c.z, ex - c.x) - camAng);
    const dist = Math.hypot(ex - c.x, ez - c.z);
    ctx.save();
    ctx.translate(W / 2, 96);
    ctx.rotate(rel);
    ctx.fillStyle = 'rgba(95,224,160,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(7, 4);
    ctx.lineTo(0, 0);
    ctx.lineTo(-7, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#8fd8b0';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`撤离区 ${Math.round(dist)}m`, W / 2, 120);
    ctx.textAlign = 'left';

    // —— 交互引导进度（引爆装药） ——
    const channel = view.targets.find((t) => !t.done && t.progress > 0);
    if (channel) {
      const bw = 180;
      const bx = W / 2 - bw / 2;
      const by = H - 110;
      hudBar(ctx, bx, by, bw, 10, channel.progress / 3, '#ffb35c', '装药引爆', `${Math.round(channel.progress / 3 * 100)}%`);
    }

    // —— 左下：HP / 护盾 / 耐力 三色条 + 喷气燃料 ——
    if (au) {
      const bx = 16;
      let by = H - 118;
      hudBar(ctx, bx, by, 210, 12, au.hp / au.hpMax, '#e06a5a', '结构 HP', `${Math.round(au.hp)}/${au.hpMax}`);
      by += 26;
      hudBar(ctx, bx, by, 210, 10, au.shield / au.shieldMax, '#5ab8e0', '护盾', `${Math.round(au.shield)}/${au.shieldMax}`);
      by += 24;
      hudBar(ctx, bx, by, 210, 10, au.stamina / au.staminaMax, '#e0c85a', '耐力', `${Math.round(au.stamina)}/${au.staminaMax}`);
      by += 24;
      hudBar(ctx, bx, by, 210, 8, this.char3d.fuel / 100, '#b08ae0', '喷气燃料', `${Math.round(this.char3d.fuel)}%`);
    }
  },

  /** 自由模式 HUD：标题/台账 + 三色条 + 采掘统计 + 返回提示（下移避开顶栏） */
  _drawHudFree(ctx, W, H) {
    const c = this.char3d;
    ctx.fillStyle = 'rgba(8,14,22,0.72)';
    ctx.fillRect(12, 62, 250, 54);
    ctx.strokeStyle = 'rgba(140,170,200,0.3)';
    ctx.strokeRect(12.5, 62.5, 249, 53);
    ctx.fillStyle = '#e8f2fb';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`自由探索 · ${this.planet ? this.planet.name : ''}`, 22, 82);
    ctx.fillStyle = '#9fb6c9';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`采掘/建造模式：${this._buildMode ? '开' : '关'} · Esc 升空返回`, 22, 100);
    // —— 最近未勘探 POI 罗盘（doc5 P1-04：方位 + 距离 + E 采样提示） ——
    if (this._pois) {
      let best = null;
      let bd = Infinity;
      for (const poi of Object.values(this._pois)) {
        if (poi.rewardPaid || poi.state === 'explored') continue;
        const px = poi.position.x - FIELD_OFFSET;
        const pz = poi.position.z - FIELD_OFFSET;
        const d = Math.hypot(px - c.x, pz - c.z);
        if (d < bd) { bd = d; best = poi; }
      }
      const remain = unexploredPoiCount(this.planet || {});
      if (best) {
        const ang = Math.atan2(best.position.z - FIELD_OFFSET - c.z, best.position.x - FIELD_OFFSET - c.x);
        const rel = normAngle(ang - this.cam.yaw + Math.PI);
        const arrow = Math.abs(rel) < 0.5 ? '↑' : rel > 0 ? '→' : '←';
        ctx.fillStyle = '#5debdf';
        ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`◆ 兴趣点 ${arrow} ${Math.round(bd)}m（靠近按 E 采样）· 剩余 ${remain}`, 22, 116);
      } else if (remain === 0 && Object.keys(this._pois).length) {
        ctx.fillStyle = '#7ee2a8';
        ctx.fillText('本行星兴趣点已全部采样', 22, 116);
      }
    }

    // —— P2-1 深潜压力读数 + 潮汐相位（潜水态显示，doc8 §4.3 规则 3） ——
    const depth = this._fluidDepth(c);
    if (depth > FLUID_WADE_MAX) {
      const mpa = 0.101 + depth * 0.0098;          // 每米水柱 ≈ 9.8 kPa
      const tidePhase = ((this._clock % 90) / 90); // doc7：90s 潮汐周期
      ctx.fillStyle = 'rgba(8,20,34,0.78)';
      ctx.fillRect(12, 124, 250, 22);
      ctx.strokeStyle = 'rgba(90,184,224,0.45)';
      ctx.strokeRect(12.5, 124.5, 249, 21);
      ctx.fillStyle = '#8fd8f0';
      ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`深潜压力 ${mpa.toFixed(1)} MPa · 潮汐相位 ${Math.round(tidePhase * 100)}%`, 22, 139);
    }

    // 本次采掘台账
    const keys = Object.keys(this._tally).filter((k) => this._tally[k] !== 0);
    if (keys.length) {
      ctx.fillStyle = 'rgba(8,14,22,0.55)';
      ctx.fillRect(12, 124, 250, 22 + keys.length * 14);
      ctx.fillStyle = '#cfe3f5';
      ctx.fillText('本次作业台账', 22, 140);
      let ty = 154;
      for (const k of keys) {
        ctx.fillStyle = this._tally[k] > 0 ? '#9fd8b0' : '#d8a89f';
        ctx.fillText(`${k} × ${this._tally[k]}`, 22, ty);
        ty += 14;
      }
    }

    const bx = 16;
    let by = H - 118;
    hudBar(ctx, bx, by, 210, 12, c.hp / c.hpMax, '#e06a5a', '结构 HP', `${Math.round(c.hp)}/${c.hpMax}`);
    by += 26;
    hudBar(ctx, bx, by, 210, 10, c.shield / c.shieldMax, '#5ab8e0', '护盾', `${Math.round(c.shield)}/${c.shieldMax}`);
    by += 24;
    hudBar(ctx, bx, by, 210, 10, c.stamina / c.staminaMax, '#e0c85a', '耐力', `${Math.round(c.stamina)}/${c.staminaMax}`);
    by += 24;
    hudBar(ctx, bx, by, 210, 8, c.fuel / 100, '#b08ae0', '喷气燃料', `${Math.round(c.fuel)}%`);
  },

  /** 底部中央 6 槽技能栏（可用高亮 + 冷却遮罩 + 数字标注 + 名称） */
  _drawSkillbar(ctx, W, H) {
    const S = 46;
    const GAP = 8;
    const total = SKILLS.length * S + (SKILLS.length - 1) * GAP;
    const x0 = Math.round(W / 2 - total / 2);
    const y0 = H - S - 20;
    const au = this._lastView && this._lastView.playerUnits
      ? (this._lastView.playerUnits.find((u) => u.unitId === this._lastView.activeUnitId) || this._lastView.playerUnits[0])
      : null;
    const stamOk = au ? au.stamina >= 15 : this.char3d.stamina >= 15;
    const atkReady = au ? au.cooldowns.attack <= 0 : this.char3d.atkCd <= 0;
    const atkCdMax = 0.75;   // 最长动作链（heavy 0.5 + 0.25）
    for (let i = 0; i < SKILLS.length; i++) {
      const sk = SKILLS[i];
      const x = x0 + i * (S + GAP);
      let ready = true;
      let cdFrac = 0;
      if (sk.attack) {
        ready = atkReady;
        cdFrac = au
          ? clamp(au.cooldowns.attack / atkCdMax, 0, 1)
          : clamp(this.char3d.atkCd / atkCdMax, 0, 1);
      } else if (sk.block) {
        ready = stamOk;
      } else if (sk.mode) {
        ready = true;
      }
      const active = (sk.mode && this._buildMode) || (sk.block && (this.keys.Digit4 || (au && au.state === 'block')));
      ctx.fillStyle = active ? 'rgba(80,160,220,0.35)' : 'rgba(10,16,26,0.78)';
      ctx.fillRect(x, y0, S, S);
      if (cdFrac > 0) {
        ctx.fillStyle = 'rgba(20,26,34,0.75)';
        ctx.fillRect(x, y0, S, S * cdFrac);
      }
      ctx.strokeStyle = ready
        ? (active ? '#8fd0ff' : 'rgba(143,208,255,0.75)')
        : 'rgba(110,130,150,0.4)';
      ctx.strokeRect(x + 0.5, y0 + 0.5, S - 1, S - 1);
      ctx.fillStyle = '#e8f2fb';
      ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(sk.key, x + 5, y0 + 16);
      ctx.fillStyle = ready ? '#bfe2ff' : '#6c7f92';
      ctx.font = '9px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sk.name, x + S / 2, y0 + S + 11);
      ctx.textAlign = 'left';
    }
  },

  // —— 结算 ————————————————

  /** 任务结算弹窗（幂等：一次结束只弹一次），确认后回简报 */
  _showResult(m) {
    if (this._resultShown) return;
    this._resultShown = true;
    const results = (m && m.results) || { outcome: 'failed', reason: 'unknown' };
    const outcomeZh = ({ success: '任务完成', failed: '任务失败', aborted: '行动中止' })[results.outcome] || results.outcome;
    const rewards = (results.rewardsPaid || [])
      .map((r) => `${r.resId}×${r.amount}`)
      .join('　') || '无奖励结算';
    showModal({
      title: '行动结束',
      body: el('div', { class: 'vf-col' }, [
        el('div', { class: 'vf-accent', text: outcomeZh }),
        el('div', { class: 'vf-small vf-dim mt-1', text: `用时 ${fmtClock(results.timeSeconds)} · 阵亡 ${results.casualties || 0} 人` }),
        el('div', { class: 'vf-small vf-dim', text: `奖励：${rewards}` }),
        el('div', { class: 'vf-faint vf-small', text: `原因：${results.reason || '—'}` }),
      ]),
      actions: [{
        label: L('ui.confirm'),
        kind: 'primary',
        onClick: (close) => {
          close();
          this._build(null);
        },
      }],
    });
  },

  // —— 生命周期 ————————————————

  /** 快照推送：任务/自由模式由 rAF 自驱读取世界；简报页保持静态（经「恢复行动」进入） */
  onSnapshot() {},

  /** 卸载：停 rAF、移除监听、释放 GL 与画布 */
  unmount() {
    this._mounted = false;
    this._teardownScene();
    this.body = null;
    this.headInfo = null;
    this.headBtns = null;
    this.app = null;
    this.cm = null;
    this.sw = null;
    this.mission = null;
  },
};
