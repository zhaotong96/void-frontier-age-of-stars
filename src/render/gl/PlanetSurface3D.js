/**
 * render/gl/PlanetSurface3D.js — 行星地表 3D 体素渲染器（返工 Phase R8）
 *
 * 消费 SurfaceSandbox 的体素世界与贪心网格输出，绘制第三人称 RPG 地表场景：
 *  - 地形：16 区块合并为单一顶点缓冲，1 次 draw call（逐顶点 AO + 材质色已由
 *    数据层烘焙，着色器叠加太阳方向漫反射 + 半球环境光 + 距离雾）；
 *  - 天空盒：按行星 category 与 atmosphere 的解析渐变（含太阳圆盘与无大气星空）；
 *  - 直接光照：太阳方向按所属星系 star.typeId 色温着色；
 *  - 建筑/货箱：单位盒实例化（按 building.category 着色），1 次 draw call；
 *  - 传送带：带段实例化（六号角色图集位）+ 货箱实例沿预定义路径按弧长移动
 *    （≤200 箱，确定性相位，无随机数）；
 *  - 殖民者/敌人：六网格实例图集（grunt/heavy/turret/boss/colonist/conveyor）
 *    全部 actor 合并 1 次 draw call（≤40 实例约束由调用方数据保证，缓冲按 64 预留）；
 *  - 角色：外骨骼 7 部件单次实例化绘制（部件号失配顶点在裁剪空间退化），
 *    行走/挥砍/挖掘动画在 CPU 侧按部件枢轴合成模型矩阵；
 *  - 相机：弹簧臂第三人称轨道（yaw/pitch/distance），DDA 射线防穿模收臂；
 *  - 特效：刀光带 / 相机对齐光束（加性）+ 红色 AoE 预警贴花（α 混合）
 *    + 确定性挖掘粒子（gl.POINTS 软圆点，池 256）。
 *
 * draw() 恰好 ≤ 8 次 draw call（预算 15）；HUD（血条/技能栏/目标信息）由
 * 调用方在 2D 层绘制，本类不触碰 DOM。
 *
 * Pass 状态隔离与诊断（doc7 §2.2 修复 3 / doc6 §3.2-3.3）：
 *  - 场景 FBO 清屏唯一所有者为 PostProcessor.beginScene()（8 步契约）；draw() 首部
 *    保留主题地平线色的双保险清屏（允许冗余防御，不构成第二所有者）；
 *  - 天空 pass 显式关 DEPTH_TEST/depthMask(false)/关 BLEND/关 CULL_FACE；不透明
 *    地形/建筑/actor/角色 pass 显式开 DEPTH_TEST(LEQUAL)/depthMask(true)/
 *    frontFace(CCW)，并按 cullEnabled 开 CULL_FACE+BACK（greedyMeshChunk 与
 *    GroundMeshes 均已验证 CCW-外向绕序）；贴花/特效/粒子透明 pass 关剔除、
 *    BLEND 按材质声明、depthMask(false)，结束恢复；
 *  - 三档地表诊断模式（setDebugMode / 循环 / getGLStateSnapshot）：
 *    0=正式  1=unlit_nocull（无光照纯色+临时关剔除）  2=wireframe_normal（法线
 *    RGB + 1m 世界格线）  3=winding_audit（gl_FrontFacing 正面翠绿/背面洋红，
 *    需关剔除观察背面）。绝不以永久关闭剔除掩盖绕序问题；
 *  - init() 注册 window.__vfSurfaceDebug（setDebugMode/cycleDebugMode/getSnapshot/
 *    renderer），destroy() 注销 —— 诊断面板（DiagnosticsView）与 glGateTest 经此
 *    钩子操作【当前挂载】的地表渲染器；本类不绑定键盘（F3 循环由视图层决定）。
 *
 * renderData 契约（全部字段可选，缺省安全跳过）：
 *   character : { x, y, z, yaw, state('idle'|'run'|'attack'|'dig'|'hurt'),
 *                 animT, attackT(0..1), flash(0..1) }
 *   camera    : { yaw, pitch, dist }           —— 期望轨道参数（弹簧平滑在渲染器内）
 *   buildings : [{ x, y, z, sx?, sy?, sz?, rotY?, category }]
 *   conveyor  : { paths: [{ pts: [[x,y,z],...], speed?, spacing? }] }（世界坐标折线）
 *   colonists : [{ x, y, z, rotY?, walk?, phase? }]
 *   enemies   : [{ kind('grunt'|'heavy'|'turret'|'boss'), x, y, z, yaw?, phase?, flash? }]
 *   effects   : { slashes: [{ x, y, z, yaw, arc, t, color? }],
 *                 beams:   [{ a:[x,y,z], b:[x,y,z], color?, width? }],
 *                 aoe:     [{ x, z, r, t }],
 *                 digEvents: [{ x, y, z, matId, color?:[r,g,b] }] }（color 提供时覆盖材质色）
 * opts 契约：{ time(秒), dt(秒), bloom/exposure 由 PostProcessor 处理，本类不读 }
 *
 * 约束：顶层不触碰 document/window；全程确定性（无 Math.random）；
 * GLSL 均为手写 GLSL ES 3.0 字符串（#version 行由 GLCore 前置）。
 */

import {
  mat4, mat4Multiply, mat4Perspective, mat4LookAt, mat4Invert,
  mat4Translate, mat4RotateX, mat4RotateY, mat4RotateZ, vec3ApplyMat4,
} from './Mat4.js';
import {
  buildExosuitMesh, buildGruntMesh, buildHeavyMesh, buildTurretMesh, buildBossMesh,
  buildColonistMesh, buildConveyorBelt, buildUnitBox,
} from '../meshes/GroundMeshes.js';
import {
  greedyMeshChunk, ddaRaycast, getSurfaceHeight, SURFACE_SIZE, SURFACE_MAT, MATERIAL_COLORS,
} from '../../domain/ground/SurfaceSandbox.js';

// ———— 场景配色（按行星类别 / 恒星 / 建筑类别） ————————————————

/** 天空渐变基色（zenith 天顶 / horizon 地平线；按 atmosphere 关键词再修正） */
const SKY_BY_CATEGORY = {
  rocky:      { zenith: [0.30, 0.42, 0.62], horizon: [0.72, 0.66, 0.55] },
  ocean:      { zenith: [0.25, 0.45, 0.70], horizon: [0.68, 0.80, 0.85] },
  ice:        { zenith: [0.35, 0.48, 0.66], horizon: [0.80, 0.88, 0.95] },
  desert:     { zenith: [0.42, 0.46, 0.58], horizon: [0.88, 0.72, 0.48] },
  gasGiant:   { zenith: [0.45, 0.35, 0.28], horizon: [0.85, 0.60, 0.36] },
  lava:       { zenith: [0.13, 0.07, 0.09], horizon: [0.55, 0.22, 0.12] },
  toxic:      { zenith: [0.28, 0.38, 0.24], horizon: [0.60, 0.68, 0.34] },
  artificial: { zenith: [0.18, 0.28, 0.48], horizon: [0.52, 0.60, 0.70] },
};

/** 恒星色温（直接光照与太阳盘颜色，按 system.star.typeId） */
const SUN_BY_STAR = {
  yellowDwarf: [1.00, 0.96, 0.84],
  redDwarf: [1.00, 0.60, 0.42],
  blueGiant: [0.70, 0.84, 1.05],
  whiteDwarf: [0.95, 0.97, 1.05],
  neutronStar: [0.85, 0.85, 1.10],
  pulsar: [1.00, 0.72, 0.95],
  blackHole: [0.45, 0.42, 0.55],
};

/** 建筑实例色（buildings.js 九大类） */
const BUILDING_COLORS = {
  mining: [0.85, 0.60, 0.28],
  refining: [0.74, 0.74, 0.80],
  industry: [0.64, 0.67, 0.72],
  agri: [0.45, 0.80, 0.50],
  science: [0.42, 0.68, 0.90],
  service: [0.85, 0.68, 0.58],
  military: [0.52, 0.55, 0.52],
  admin: [0.82, 0.78, 0.58],
  energy: [0.95, 0.84, 0.32],
};

/** 敌人实例色（与网格顶点色在着色器中混合） */
const ENEMY_COLORS = {
  grunt: [0.90, 0.42, 0.32],
  heavy: [0.62, 0.66, 0.74],
  turret: [0.70, 0.72, 0.76],
  boss: [0.72, 0.40, 1.00],
};

/** actor 图集网格位（实例 iB.y 与逐顶点 aMesh 匹配） */
const ACTOR_MESH_ID = { grunt: 0, heavy: 1, turret: 2, boss: 3, colonist: 4, conveyor: 5 };

// ———— GLSL ————

const SKY_VS = `
layout(location = 0) in vec3 aPos;
out vec2 vXY;
void main() {
  vXY = aPos.xy;
  gl_Position = vec4(aPos.xy, 0.99999, 1.0);
}`;

const SKY_FS = `
precision highp float;
in vec2 vXY;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
out vec4 fragColor;
/* 确定性哈希星空（无随机数） */
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec4 p4 = uInvVP * vec4(vXY, 0.5, 1.0);
  /* 反投影分母非零保护：p4.w → 0 时除法产生 Inf/NaN，天空输出异常值残留在场景
   * FBO 中被辉光金字塔逐帧放大（doc7 §2.2 修复 3 / doc6 §3.2） */
  float pw = abs(p4.w) < 1e-6 ? (p4.w >= 0.0 ? 1e-6 : -1e-6) : p4.w;
  vec3 dir = normalize(p4.xyz / pw - uCamPos);
  float up = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.30, up));
  float s = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(max(s, 1e-6), 800.0) * 3.2 + pow(max(s, 1e-6), 20.0) * 0.20);
  if (uStars > 0.5 && up > 0.02) {
    vec3 sp = floor(dir * 220.0);
    float st = hash13(sp);
    col += vec3(1.1, 1.15, 1.25) * step(0.9975, st) * (0.55 + 0.45 * sin(uTime * 2.0 + st * 40.0));
  }
  fragColor = vec4(col, 1.0);
}`;

const TERRAIN_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uVP;
out vec3 vN;
out vec3 vC;
out vec3 vW;
void main() {
  vN = aNormal;
  vC = aColor;
  vW = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = `
precision highp float;
in vec3 vN;
in vec3 vC;
in vec3 vW;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform float uDebugMode; // 0=正式 1=unlit_nocull 2=wireframe_normal 3=winding_audit
out vec4 fragColor;
void main() {
  /* 三档诊断模式（doc7 §2.2 / doc6 §3.3 B）：
   *  1 无剔除 Unlit：纯色无光照，验证顶点在视锥内（剔除由渲染器侧临时关闭）；
   *  2 线框与法线：法线 RGB + 1m 世界格线，排查法线翻转/退化三角形/接缝；
   *  3 绕序审计：gl_FrontFacing 正面翠绿 / 背面洋红（剔除必须关闭才能看到背面） */
  if (uDebugMode > 0.5) {
    if (uDebugMode > 2.5) {
      fragColor = gl_FrontFacing ? vec4(0.1, 0.9, 0.3, 1.0) : vec4(1.0, 0.0, 0.8, 1.0);
      return;
    }
    vec3 dbg;
    if (uDebugMode < 1.5) {
      dbg = vC; // 无光照材质纯色
    } else {
      dbg = normalize(vN) * 0.5 + 0.5;
      vec3 fw = abs(fract(vW) - 0.5);
      float line = max(smoothstep(0.02, 0.06, fw.x),
                       max(smoothstep(0.02, 0.06, fw.y), smoothstep(0.02, 0.06, fw.z)));
      dbg = mix(dbg, vec3(1.0, 0.9, 0.2), line * 0.6); // 1m 世界格线（黄）
    }
    fragColor = vec4(dbg, 1.0);
    return;
  }
  vec3 N = normalize(vN);
  float diff = max(dot(N, uSunDir), 0.0);
  float hemi = 0.44 + 0.18 * (N.y * 0.5 + 0.5);
  vec3 col = vC * uSunColor * (hemi + diff * 0.72);
  float fog = smoothstep(uFogRange.x, uFogRange.y, distance(vW, uCamPos));
  fragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;

/** 通用实例化（单位盒：建筑 / 传送带货箱） */
const BOX_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 iPos;
layout(location = 3) in vec3 iScale;
layout(location = 4) in vec3 iColor;
layout(location = 5) in vec2 iRotEmit;
uniform mat4 uVP;
out vec3 vN;
out vec3 vC;
out vec3 vW;
out float vF;
out float vE;
void main() {
  float c = cos(iRotEmit.x);
  float s = sin(iRotEmit.x);
  vec3 p = aPos * iScale;
  vec3 w = iPos + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vN = vec3(aNormal.x * c + aNormal.z * s, aNormal.y, -aNormal.x * s + aNormal.z * c);
  vW = w;
  vC = iColor;
  vF = 0.0;
  vE = iRotEmit.y;
  gl_Position = uVP * vec4(w, 1.0);
}`;

/** 多网格实例图集（actor：grunt/heavy/turret/boss/colonist/conveyor） */
const ACTOR_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aMesh;
layout(location = 4) in vec4 iA;
layout(location = 5) in vec4 iB;
layout(location = 6) in vec4 iC;
uniform mat4 uVP;
out vec3 vN;
out vec3 vC;
out vec3 vW;
out float vF;
out float vE;
void main() {
  if (abs(aMesh - iB.y) > 0.5) {
    // 网格位失配：退化到裁剪空间外（单 draw call 多网格实例化的 discard 技法）
    vN = vec3(0.0, 1.0, 0.0);
    vC = vec3(0.0);
    vW = vec3(0.0);
    vF = 0.0;
    vE = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float c = cos(iA.w);
  float s = sin(iA.w);
  vec3 p = aPos * iB.x;
  vec3 w = iA.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vW = w;
  vN = vec3(aNormal.x * c + aNormal.z * s, aNormal.y, -aNormal.x * s + aNormal.z * c);
  vC = mix(aColor, iC.rgb, 0.6);
  vF = iB.z;
  vE = iC.w;
  gl_Position = uVP * vec4(w, 1.0);
}`;

/**
 * 共享 lit 片元（盒体 / actor / 角色）—— doc8 §4.2【P1-3】标准升级版：
 * 世界空间微面板接缝（panelSeam）+ 微晶粒（hash31/microGrain）+ Blinn-Phong
 * 金属高光 + 边缘菲涅尔 + 半球环境光 + 雾 + 闪白 + 自发光。
 * 契约不变：vN/vC/vW/vF/vE + uSunDir/uSunColor/uCamPos/uFogColor/uFogRange。
 */
const LIT_FS = `
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
uniform float uHdr; /* WP-5 P1-F：RGBA8 模拟 HDR 时场景预缩放（对象/建筑 pass 与地形同口径） */
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
  fragColor = vec4(mix(col, uFogColor, fog) * uHdr, 1.0);
}`;

/** 角色七部件：逐实例模型矩阵 + 部件号失配退化 */
const CHAR_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aPart;
layout(location = 4) in vec4 iM0;
layout(location = 5) in vec4 iM1;
layout(location = 6) in vec4 iM2;
layout(location = 7) in vec4 iM3;
layout(location = 8) in vec4 iMisc;
uniform mat4 uVP;
out vec3 vN;
out vec3 vC;
out vec3 vW;
out float vF;
out float vE;
void main() {
  if (abs(aPart - iMisc.x) > 0.5) {
    vN = vec3(0.0, 1.0, 0.0);
    vC = vec3(0.0);
    vW = vec3(0.0);
    vF = 0.0;
    vE = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 w4 = M * vec4(aPos, 1.0);
  vW = w4.xyz;
  vN = mat3(M) * aNormal;
  vC = aColor;
  vF = iMisc.y;
  vE = iMisc.z;
  gl_Position = uVP * w4;
}`;

/** 特效/贴花通用四元色 */
const QUADC_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
uniform mat4 uVP;
out vec4 vC;
void main() {
  vC = aColor;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const QUADC_FS = `
precision highp float;
in vec4 vC;
uniform float uTime;
uniform float uPulse;
out vec4 fragColor;
void main() {
  float a = vC.a;
  if (uPulse > 0.5) a *= 0.72 + 0.28 * sin(uTime * 7.0);
  fragColor = vec4(vC.rgb, a);
}`;

/** 挖掘粒子（gl.POINTS 软圆点，加性） */
const PART_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform mat4 uVP;
uniform float uPointScale;
out vec4 vC;
void main() {
  vec4 cp = uVP * vec4(aPos, 1.0);
  gl_Position = cp;
  gl_PointSize = clamp(aSize * uPointScale / max(cp.w, 0.1), 1.5, 26.0);
  vC = aColor;
}`;

const PART_FS = `
precision highp float;
in vec4 vC;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float m = smoothstep(0.5, 0.12, length(d));
  fragColor = vec4(vC.rgb * m * vC.a, vC.a * m);
}`;

// ———— 工具 ————

/** 缓存程序 uniform 位置表 */
function locMap(gl, prog, names) {
  const m = {};
  for (const n of names) m[n] = gl.getUniformLocation(prog, n);
  return m;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 确定性整数哈希 → [0,1)（粒子初速等视觉扰动；绝不使用 Math.random） */
function hash01(n) {
  let h = (Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h / 4294967296;
}

/** GL 枚举值 → 可读名（诊断快照用；未收录值回退 0x 十六进制串） */
const GL_ENUM_NAMES = new Map([
  [0x0000, 'ZERO'], [0x0001, 'ONE'],
  [0x0200, 'NEVER'], [0x0201, 'LESS'], [0x0202, 'EQUAL'], [0x0203, 'LEQUAL'],
  [0x0204, 'GREATER'], [0x0205, 'NOTEQUAL'], [0x0206, 'GEQUAL'], [0x0207, 'ALWAYS'],
  [0x0404, 'FRONT'], [0x0405, 'BACK'], [0x0406, 'FRONT_AND_BACK'],
  [0x0408, 'FRONT_AND_BACK'],
  [0x2300, 'CW'], [0x2301, 'CCW'],
  [0x0300, 'SRC_ALPHA'], [0x0301, 'ONE_MINUS_SRC_ALPHA'],
  [0x0302, 'SRC_COLOR'], [0x0303, 'ONE_MINUS_SRC_COLOR'],
  [0x0306, 'DST_ALPHA'], [0x0307, 'ONE_MINUS_DST_ALPHA'],
  [0x0308, 'DST_COLOR'], [0x0309, 'ONE_MINUS_DST_COLOR'],
  [0x8006, 'FUNC_ADD'], [0x8009, 'FUNC_SUBTRACT'], [0x800a, 'FUNC_REVERSE_SUBTRACT'],
  [0x0500, 'INVALID_ENUM'], [0x0501, 'INVALID_VALUE'], [0x0502, 'INVALID_OPERATION'],
  [0x0503, 'STACK_OVERFLOW'], [0x0504, 'STACK_UNDERFLOW'], [0x0505, 'OUT_OF_MEMORY'],
  [0x0506, 'INVALID_FRAMEBUFFER_OPERATION'], [0x9242, 'CONTEXT_LOST_WEBGL'],
]);
/** 查枚举名；未收录回退 0x 十六进制串 */
function glEnumName(v) {
  return GL_ENUM_NAMES.has(v) ? GL_ENUM_NAMES.get(v) : '0x' + Number(v).toString(16);
}

/** 外骨骼部件枢轴（局部坐标，与 GroundMeshes.buildExosuitMesh 部件布局一致） */
const EXO_PIVOTS = {
  head: [0, 1.38, 0],
  torso: [0, 0.80, 0],
  armL: [0, 1.26, -0.30],
  armR: [0, 1.26, 0.30],
  legL: [0, 0.76, -0.145],
  legR: [0, 0.76, 0.145],
  backpack: [0, 1.10, 0],
};

// ———— 渲染器 ————

export class PlanetSurface3D {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例（CanvasManager.glc）
   * @param {number} tier 渲染层级 1|2|3（tier≥3 由调用方整体跳过 GL；2 减特效密度）
   */
  constructor(glc, tier = 1) {
    if (!glc || !glc.gl) throw new Error('[PlanetSurface3D] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    this.tier = tier;
    this.sw = null;                 // init(sceneWorld) 后持有体素世界
    this.pickDist = 7.5;            // DDA 拾取距离（体素）
    this.stats = { triangles: 0, drawCalls: 0, chunkRebuilds: 0 };
    // —— 地表诊断：0=off 1=unlit_nocull 2=wireframe_normal 3=winding_audit ——
    // cullEnabled：正式模式背面剔除开关（默认 true —— greedyMeshChunk 已验证
    // 全部 6 向面 CCW-外向；诊断模式 1/3 下强制临时关闭，结束自动恢复）。
    // 公开字段：诊断侧可直接置 false 复现"无剔除"对照视图（不得以永久关闭掩盖绕序问题）
    this._debugMode = 0;
    this.cullEnabled = true;

    this._destroyed = false;
    this._inited = false;
    this._vw = 1;
    this._vh = 1;
    this._springDist = -1;          // 弹簧臂当前臂长（首帧吸附）
    this._spawnSeq = 0;             // 挖掘粒子批次序号（确定性初速源）
    this.hdrScale = 1.0;            // WP-5：RGBA8 模拟 HDR 预缩放（调用方按 cm.post 下发）
    // 场景化集成（doc7 TASK-1.2/1.4）：地形/天空/天气改由 PlanetSurfaceScene 绘制，
    // 本渲染器经 setExternalCamera() 进入「对象独占」模式 —— 仅绘制
    // 箱体/actor/角色七部件/贴花/特效/挖掘粒子，相机与 VP 由调用方直供。
    this._extCam = null;

    // —— GL 资源（init 建立程序；其余缓冲随 init/destroy 管理） ——
    const glc2 = this.glc;
    this.progSky = glc2.createProgram(SKY_VS, SKY_FS, { label: 'surface:sky', attributes: { aPos: 0 } });
    this.progTerrain = glc2.createProgram(TERRAIN_VS, TERRAIN_FS, { label: 'surface:terrain' });
    this.progBox = glc2.createProgram(BOX_VS, LIT_FS, { label: 'surface:box' });
    this.progActor = glc2.createProgram(ACTOR_VS, LIT_FS, { label: 'surface:actor' });
    this.progChar = glc2.createProgram(CHAR_VS, LIT_FS, { label: 'surface:char', attributes: { aPos: 0, aNormal: 1, aColor: 2, aPart: 3, iM0: 4, iM1: 5, iM2: 6, iM3: 7, iMisc: 8 } });
    this.progQuadC = glc2.createProgram(QUADC_VS, QUADC_FS, { label: 'surface:quadc' });
    this.progPart = glc2.createProgram(PART_VS, PART_FS, { label: 'surface:part' });

    const gl = this.gl;
    this._u = {
      sky: locMap(gl, this.progSky, ['uInvVP', 'uCamPos', 'uZenith', 'uHorizon', 'uGround', 'uSunDir', 'uSunColor', 'uStars', 'uTime']),
      terrain: locMap(gl, this.progTerrain, ['uVP', 'uSunDir', 'uSunColor', 'uCamPos', 'uFogColor', 'uFogRange', 'uDebugMode']),
      box: locMap(gl, this.progBox, ['uVP', 'uSunDir', 'uSunColor', 'uCamPos', 'uFogColor', 'uFogRange', 'uHdr']),
      actor: locMap(gl, this.progActor, ['uVP', 'uSunDir', 'uSunColor', 'uCamPos', 'uFogColor', 'uFogRange', 'uHdr']),
      char: locMap(gl, this.progChar, ['uVP', 'uSunDir', 'uSunColor', 'uCamPos', 'uFogColor', 'uFogRange', 'uHdr']),
      quadc: locMap(gl, this.progQuadC, ['uVP', 'uTime', 'uPulse']),
      part: locMap(gl, this.progPart, ['uVP', 'uPointScale']),
    };

    // —— 通用光照 uniform 载荷（每帧一次性写入的共享数组） ——
    this._sunDir = [0.42, 0.78, 0.32];
    this._sunColor = [1.0, 0.96, 0.84];
    this._fogColor = [0.6, 0.62, 0.66];
    this._sky = { zenith: [0.3, 0.42, 0.62], horizon: [0.72, 0.66, 0.55], ground: [0.36, 0.33, 0.28], stars: 0 };
    this._fogRange = [34.0, 120.0];

    // —— 相机/矩阵草稿（零分配约定：渲染循环内不新建矩阵） ——
    this.camera = { eye: [0, 0, 0], target: [0, 0, 0], dist: 9, yaw: 0.8, pitch: 0.55 };
    this._m = {
      proj: mat4(), view: mat4(), vp: mat4(), invVp: mat4(),
      base: mat4(), piv: mat4(), rot: mat4(), tmp: mat4(), part: mat4(),
    };
    this._v3a = [0, 0, 0];
    this._v3b = [0, 0, 0];
    this._v3c = [0, 0, 0];

    // —— 实例缓冲描述（init 时创建 VAO；上传走 _uploadInstances） ——
    this._terr = null;              // { vao, vboP, vboN, vboC, vertCount }
    this._chunkMesh = new Array(SURFACE_SIZE.CHUNK_COUNT).fill(null);
    this._host = { pos: new Float32Array(0), nor: new Float32Array(0), col: new Float32Array(0) };
    this._box = null;               // 建筑+货箱实例
    this._actor = null;             // 敌人+殖民者+传送带实例
    this._char = null;              // 角色部件实例
    this._fx = null;                // 刀光/光束（加性）
    this._decal = null;             // AoE 贴花（α）
    this._particle = null;          // 挖掘粒子（点）
    this._skyVao = null;

    // —— 挖掘粒子池（结构化数组，256 容量） ——
    const PCAP = 256;
    this._pool = {
      cap: PCAP,
      n: 0,
      x: new Float32Array(PCAP), y: new Float32Array(PCAP), z: new Float32Array(PCAP),
      vx: new Float32Array(PCAP), vy: new Float32Array(PCAP), vz: new Float32Array(PCAP),
      life: new Float32Array(PCAP), life0: new Float32Array(PCAP),
      size: new Float32Array(PCAP), matId: new Uint8Array(PCAP),
      // 自定义颜色事件（ev.color，如水体水花/POI 采样喷发；matId=255 哨兵）
      colR: new Float32Array(PCAP), colG: new Float32Array(PCAP), colB: new Float32Array(PCAP),
    };
  }

  // —— 初始化 / 网格化 ————————————————

  /**
   * 绑定体素世界并完成全部静态资源构建：
   * 贪心网格化 16 区块并合并上传、actor 图集与实例 VAO、角色部件 VAO、天空三角。
   * @param {object} sceneWorld SurfaceSandbox.createSurfaceWorld 的返回实体
   */
  init(sceneWorld) {
    if (this._destroyed) throw new Error('[PlanetSurface3D] 已销毁，不可重复 init');
    if (!sceneWorld || sceneWorld.kind !== 'surfaceWorld') {
      throw new Error('[PlanetSurface3D] init 需要 SurfaceSandbox.createSurfaceWorld 的实体');
    }
    this.sw = sceneWorld;
    this._inited = true;

    const glc = this.glc;
    const gl = this.gl;

    // —— 天空全屏三角 ——
    this._skyVao = glc.createVAO((g) => {
      const buf = g.createBuffer(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]));
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    });

    // —— 地形：全部区块贪心网格化 → 合并上传 ——
    for (let ci = 0; ci < SURFACE_SIZE.CHUNK_COUNT; ci++) this._remeshChunk(ci);
    const tP = glc.createBuffer(new Float32Array(0));
    const tN = glc.createBuffer(new Float32Array(0));
    const tC = glc.createBuffer(new Float32Array(0));
    this._terr = { vao: null, vboP: tP, vboN: tN, vboC: tC, vertCount: 0 };
    this._terr.vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, tP);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, tN);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, tC);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 3, g.FLOAT, false, 0, 0);
    });
    this._uploadTerrain();

    // —— 单位盒实例（建筑 + 货箱） ——
    const boxMesh = buildUnitBox();
    this._box = this._makeInstVAO(boxMesh, 11, [
      { loc: 2, size: 3, off: 0 }, { loc: 3, size: 3, off: 12 },
      { loc: 4, size: 3, off: 24 }, { loc: 5, size: 2, off: 36 },
    ], 1024);

    // —— actor 图集：grunt/heavy/turret/boss/colonist/conveyor ——
    const atlasMeshes = [
      buildGruntMesh(), buildHeavyMesh(), buildTurretMesh(),
      buildBossMesh(), buildColonistMesh(), buildConveyorBelt(),
    ];
    const atlas = this._concatAtlas(atlasMeshes);
    this._actor = this._makeInstVAO(atlas, 12, [
      { loc: 4, size: 4, off: 0 }, { loc: 5, size: 4, off: 16 }, { loc: 6, size: 4, off: 32 },
    ], 768);

    // —— 角色外骨骼（7 部件，逐实例模型矩阵；部件号 = partNames 序） ——
    const exo = buildExosuitMesh();
    this._exoMesh = exo;
    this._charArr = new Float32Array(7 * 20);
    const exoId = new Float32Array(exo.positions.length / 3);
    for (let pi = 0; pi < exo.partNames.length; pi++) {
      const p = exo.partNames[pi];
      exoId.fill(pi, p.start, p.start + p.count);
    }
    const eP = glc.createBuffer(exo.positions);
    const eN = glc.createBuffer(exo.normals);
    const eC = glc.createBuffer(exo.colors);
    const eId = glc.createBuffer(exoId);
    const eInst = glc.createBuffer(new Float32Array(7 * 20));
    this._char = {
      vao: null, inst: eInst, capF: 7 * 20, count: 0, meshCount: exo.triCount * 3,
      partNames: exo.partNames.map((p) => p.name),
    };
    this._char.vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, eP);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, eN);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, eC);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, eId);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 1, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, eInst);
      for (let k = 0; k < 4; k++) {
        g.enableVertexAttribArray(4 + k);
        g.vertexAttribPointer(4 + k, 4, g.FLOAT, false, 80, k * 16);
        g.vertexAttribDivisor(4 + k, 1);
      }
      g.enableVertexAttribArray(8);
      g.vertexAttribPointer(8, 4, g.FLOAT, false, 80, 64);
      g.vertexAttribDivisor(8, 1);
    });

    // —— 特效 / 贴花 / 粒子动态缓冲 ——
    this._fx = this._makeDynamicVAO(9216);
    this._decal = this._makeDynamicVAO(6144);
    this._particle = this._makeDynamicVAO(2048, 8);

    // —— 天空 / 光照：按行星档案求值一次 ——
    this._evalEnvironment();

    // —— 诊断钩子：注册到 window（DiagnosticsView / glGateTest / DevTools 经此
    // 操作当前挂载的地表渲染器；destroy 注销）。键盘不在此绑定 —— F3 循环归视图层。
    if (typeof window !== 'undefined') {
      window.__vfSurfaceDebug = {
        renderer: this,
        setDebugMode: (m) => this.setDebugMode(m),
        cycleDebugMode: () => this.cycleDebugMode(),
        getSnapshot: () => this.getGLStateSnapshot(),
      };
    }

    gl.bindVertexArray(null);
    return this;
  }

  /**
   * 增量重建受影响区块：重建 (cx,cz) 及因跨界编辑被标脏的邻接区块，
   * 并重新合并上传地形缓冲。挖掘/放置后由调用方触发。
   * @returns {{rebuilt:number, triangles:number}}
   */
  digChunk(cx, cz) {
    const sw = this.sw;
    if (!sw || this._destroyed) return { rebuilt: 0, triangles: this.stats.triangles };
    const { CHUNKS_X, CHUNKS_Z } = SURFACE_SIZE;
    const targets = new Set();
    const add = (a, b) => {
      if (a >= 0 && a < CHUNKS_X && b >= 0 && b < CHUNKS_Z) targets.add(b * CHUNKS_X + a);
    };
    add(cx, cz);
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = cx + da;
      const b = cz + db;
      if (a >= 0 && a < CHUNKS_X && b >= 0 && b < CHUNKS_Z && sw.chunks[b * CHUNKS_X + a].dirty) add(a, b);
    }
    let rebuilt = 0;
    for (const ci of targets) {
      this._remeshChunk(ci);
      rebuilt++;
    }
    if (rebuilt > 0) {
      this._uploadTerrain();
      this.stats.chunkRebuilds += rebuilt;
    }
    return { rebuilt, triangles: this.stats.triangles };
  }

  /** 贪心网格化单个区块（缓存顶点数据；清除脏标记） */
  _remeshChunk(ci) {
    const ch = this.sw.chunks[ci];
    const mesh = greedyMeshChunk(this.sw, ch.cx, ch.cz);
    this._chunkMesh[ci] = mesh;
    ch.dirty = false;
  }

  /** 合并全部区块顶点并重新上传地形缓冲（区块数量少，整传开销可忽略） */
  _uploadTerrain() {
    const gl = this.gl;
    const t = this._terr;
    let total = 0;
    for (const m of this._chunkMesh) if (m) total += m.positions.length;
    const host = this._host;
    if (host.pos.length < total) {
      host.pos = new Float32Array(total * 2);
      host.nor = new Float32Array(total * 2);
      host.col = new Float32Array(total * 2);
    }
    let o = 0;
    for (const m of this._chunkMesh) {
      if (!m) continue;
      host.pos.set(m.positions, o);
      host.nor.set(m.normals, o);
      host.col.set(m.colors, o);
      o += m.positions.length;
    }
    const verts = o / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, t.vboP);
    gl.bufferData(gl.ARRAY_BUFFER, host.pos.subarray(0, o), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, t.vboN);
    gl.bufferData(gl.ARRAY_BUFFER, host.nor.subarray(0, o), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, t.vboC);
    gl.bufferData(gl.ARRAY_BUFFER, host.col.subarray(0, o), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    t.vertCount = verts;
    this.stats.triangles = Math.floor(verts / 3);
  }

  // —— 实例缓冲装配 ————————————————

  /** 静态网格 + 实例属性的通用 VAO（instanceStrideF 为每实例浮点数） */
  _makeInstVAO(mesh, instanceStrideF, instAttribs, maxInstances) {
    const glc = this.glc;
    const gl = this.gl;
    const vboP = glc.createBuffer(mesh.positions);
    const vboN = glc.createBuffer(mesh.normals);
    const vboC = glc.createBuffer(mesh.colors || new Float32Array(mesh.positions.length));
    let vboId = null;
    if (mesh.meshIds) vboId = glc.createBuffer(mesh.meshIds);
    const vboI = glc.createBuffer(new Float32Array(maxInstances * instanceStrideF));
    const strideB = instanceStrideF * 4;
    const vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vboP);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, vboN);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, vboC);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 3, g.FLOAT, false, 0, 0);
      if (vboId) {
        g.bindBuffer(g.ARRAY_BUFFER, vboId);
        g.enableVertexAttribArray(3);
        g.vertexAttribPointer(3, 1, g.FLOAT, false, 0, 0);
      }
      g.bindBuffer(g.ARRAY_BUFFER, vboI);
      for (const a of instAttribs) {
        g.enableVertexAttribArray(a.loc);
        g.vertexAttribPointer(a.loc, a.size, g.FLOAT, false, strideB, a.off);
        g.vertexAttribDivisor(a.loc, 1);
      }
    });
    return { vao, inst: vboI, strideF: instanceStrideF, capF: maxInstances * instanceStrideF, count: 0, meshCount: mesh.triCount * 3 };
  }

  /** 多网格图集拼接：positions/normals/colors + 逐顶点 meshIds */
  _concatAtlas(meshes) {
    let total = 0;
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
      col.set(m.colors || new Float32Array(m.positions.length), o);
      const vc = m.positions.length / 3;
      ids.fill(mi, vi, vi + vc);
      vi += vc;
      o += m.positions.length;
    }
    return { positions: pos, normals: nor, colors: col, meshIds: ids, triCount: total / 9 };
  }

  /** 动态四元色/粒子缓冲（每帧 CPU 填充后 bufferSubData） */
  _makeDynamicVAO(capFloats, strideF = 7) {
    const glc = this.glc;
    const gl = this.gl;
    const vbo = glc.createBuffer(new Float32Array(capFloats));
    const vao = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, vbo);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, strideF * 4, 0);
      if (strideF >= 7) {
        g.enableVertexAttribArray(1);
        g.vertexAttribPointer(1, 4, g.FLOAT, false, strideF * 4, 12);
      }
      if (strideF >= 8) {
        g.enableVertexAttribArray(2);
        g.vertexAttribPointer(2, 1, g.FLOAT, false, strideF * 4, 28);
      }
    });
    return { vao, vbo, capF: capFloats, strideF, count: 0 };
  }

  /** 实例缓冲上传（超容量时按需重分配） */
  _uploadInstances(entry, arr, count) {
    const gl = this.gl;
    entry.count = count;
    if (count <= 0) return;
    const need = count * entry.strideF;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.inst || entry.vbo);
    if (need > entry.capF) {
      gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, need), gl.DYNAMIC_DRAW);
      entry.capF = need;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, need));
    }
  }

  // —— 环境求值 ————————————————

  /** 按 planet.category / atmosphere / star.typeId 求天空渐变、太阳色温与雾色 */
  _evalEnvironment() {
    const sw = this.sw;
    const skyCfg = SKY_BY_CATEGORY[sw.category] || SKY_BY_CATEGORY.rocky;
    const zenith = skyCfg.zenith.slice();
    const horizon = skyCfg.horizon.slice();
    let stars = 0;
    const atmo = String(sw.atmosphere || '');
    if (atmo.includes('无大气') || atmo.includes('稀薄')) {
      stars = 1;
      for (let i = 0; i < 3; i++) { zenith[i] *= 0.55; horizon[i] *= 0.80; }
    }
    if (atmo.includes('酸性') || atmo.includes('氯系')) {
      zenith[1] = Math.min(1, zenith[1] * 1.25 + 0.03);
      horizon[1] = Math.min(1, horizon[1] * 1.15 + 0.03);
    }
    if (atmo.includes('氢氦')) {
      horizon[0] = Math.min(1, horizon[0] * 1.10 + 0.04);
    }
    if (atmo.includes('高压')) {
      for (let i = 0; i < 3; i++) horizon[i] = Math.min(1, horizon[i] * 1.18);
    }
    this._sky = {
      zenith,
      horizon,
      ground: [horizon[0] * 0.45, horizon[1] * 0.45, horizon[2] * 0.45],
      stars,
    };
    const sun = SUN_BY_STAR[sw.starTypeId] || SUN_BY_STAR.yellowDwarf;
    this._sunColor = sun.slice();
    this._fogColor = [horizon[0], horizon[1], horizon[2]];
  }

  // —— 相机 ————————————————

  /**
   * 外部相机直供（对象独占模式）：GroundView 场景化集成中，地形/天空由
   * PlanetSurfaceScene 绘制并权威持有弹簧臂相机；本渲染器仅承担对象 pass，
   * eye/target/vp 逐帧由调用方下发（与场景同源同空间，均为米制单位）。
   * 传 null eye 恢复内置弹簧臂相机。
   * @param {Array<number>|null} eye 眼位 [x,y,z]
   * @param {Array<number>} [target] 视点 [x,y,z]（无 vp 时用于重建 view）
   * @param {Float32Array|Array<number>} [vp] 外部 VP 矩阵（16）
   */
  setExternalCamera(eye, target, vp) {
    if (!eye) {
      this._extCam = null;
      return;
    }
    this._extCam = {
      eye: [eye[0], eye[1], eye[2]],
      target: target ? [target[0], target[1], target[2]] : null,
      vp: vp || null,
    };
  }

  /**
   * 对象独占开关（无外部相机时的场景化模式）：跳过内置相机/清屏/天空/地形，
   * 仅绘制对象 pass；VP 由每帧 setExternalCamera 下发（GroundView 集成约定：
   * _initGL 先开 objectOnly，_renderFrame 逐帧先 setExternalCamera 再 draw）。
   * @param {boolean} on
   */
  setObjectOnly(on) {
    this._objectOnly = !!on;
  }

  /**
   * 第三人称弹簧臂相机：目标 = 角色胸口，轨道 (yaw/pitch/dist)，
   * 从目标向眼位做 DDA，命中地形即收臂防穿模。
   */
  _updateCamera(w, h, rd, opts) {
    const cam = rd.camera || {};
    const ch = rd.character;
    const target = this._v3a;
    target[0] = ch ? ch.x : (cam.tx != null ? cam.tx : SURFACE_SIZE.X / 2);
    target[1] = (ch ? ch.y : (cam.ty != null ? cam.ty : SURFACE_SIZE.Y - 6)) + 1.55;
    target[2] = ch ? ch.z : (cam.tz != null ? cam.tz : SURFACE_SIZE.Z / 2);
    const yaw = cam.yaw != null ? cam.yaw : 0.8;
    const pitch = clamp(cam.pitch != null ? cam.pitch : 0.55, -0.10, 1.45);
    const want = clamp(cam.dist != null ? cam.dist : 9, 2.5, 26);

    // 弹簧平滑臂长（指数趋近；dt 缺省按 1/30 固定步）
    const dt = opts.dt != null ? Math.max(1e-4, opts.dt) : 1 / 30;
    if (this._springDist < 0) this._springDist = want;
    this._springDist += (want - this._springDist) * (1 - Math.exp(-dt * 6));

    // DDA 防穿模：目标 → 眼位方向
    const dir = this._v3b;
    dir[0] = Math.cos(pitch) * Math.sin(yaw);
    dir[1] = Math.sin(pitch);
    dir[2] = Math.cos(pitch) * Math.cos(yaw);
    let dist = this._springDist;
    if (this.sw) {
      const hit = ddaRaycast(this.sw, target, dir, this._springDist + 0.6);
      if (hit.hit) dist = Math.max(1.4, hit.t - 0.45);
    }

    const eye = this._v3c;
    eye[0] = target[0] + dir[0] * dist;
    eye[1] = target[1] + dir[1] * dist;
    eye[2] = target[2] + dir[2] * dist;

    const m = this._m;
    mat4Perspective(m.proj, 1.05, w / Math.max(1, h), 0.1, 220);
    mat4LookAt(m.view, eye, target, [0, 1, 0]);
    mat4Multiply(m.vp, m.proj, m.view);

    this.camera.eye = [eye[0], eye[1], eye[2]];
    this.camera.target = [target[0], target[1], target[2]];
    this.camera.dist = dist;
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this._vw = w;
    this._vh = h;
  }

  /**
   * 屏幕点拾取（DDA）：优先使用调用方向量；否则以上一帧 VP 反投影。
   * @returns {{hit:boolean, vx:number, vy:number, vz:number, nx:number, ny:number,
   *            nz:number, matId:number, t:number, px:number, py:number, pz:number}}
   */
  pick(sx, sy, camPos, camDir) {
    const miss = { hit: false, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0, matId: 0, t: Infinity, px: 0, py: 0, pz: 0 };
    if (!this.sw || this._destroyed) return miss;
    const o = [camPos[0] != null ? camPos[0] : camPos.x, camPos[1] != null ? camPos[1] : camPos.y, camPos[2] != null ? camPos[2] : camPos.z];
    let dx;
    let dy;
    let dz;
    if (camDir && (camDir[0] || camDir[1] || camDir[2] || camDir.x || camDir.y || camDir.z)) {
      dx = camDir[0] != null ? camDir[0] : camDir.x;
      dy = camDir[1] != null ? camDir[1] : camDir.y;
      dz = camDir[2] != null ? camDir[2] : camDir.z;
    } else {
      // 屏幕坐标 → NDC → 世界射线（依赖上一帧 VP；注意 UI y 向下）
      const m = this._m;
      mat4Invert(m.invVp, this._m.vp);
      const nx = (sx / Math.max(1, this._vw)) * 2 - 1;
      const ny = 1 - (sy / Math.max(1, this._vh)) * 2;
      const p0 = vec3ApplyMat4([0, 0, 0], m.invVp, [nx, ny, -1]);
      const p1 = vec3ApplyMat4([0, 0, 0], m.invVp, [nx, ny, 1]);
      dx = p1[0] - p0[0];
      dy = p1[1] - p0[1];
      dz = p1[2] - p0[2];
    }
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-8)) return miss;
    const dir = [dx / len, dy / len, dz / len];
    const hit = ddaRaycast(this.sw, o, dir, this.pickDist);
    if (hit.hit) {
      hit.px = o[0] + dir[0] * hit.t;
      hit.py = o[1] + dir[1] * hit.t;
      hit.pz = o[2] + dir[2] * hit.t;
    }
    return hit;
  }

  // —— 地表诊断 API（doc7 §2.2 三档诊断 / doc6 §3.3 证据链） ————————

  /**
   * 设置地表诊断渲染模式（不绑定键盘，视图层/诊断面板经 window.__vfSurfaceDebug 调用）。
   *  0 = 正式渲染（按 cullEnabled 剔除）
   *  1 = unlit_nocull：无光照纯色，临时关 CULL_FACE（验证顶点在视锥内）
   *  2 = wireframe_normal：法线 RGB + 1m 世界格线（剔除保持开启，暴露正面消失破洞）
   *  3 = winding_audit：gl_FrontFacing 正面翠绿 (0.1,0.9,0.3) / 背面洋红 (1.0,0.0,0.8)，
   *      临时关 CULL_FACE（否则背面被剔除永远看不到洋红）
   * @param {number} mode 0..3（越界回退 0）
   * @returns {number} 实际生效的模式
   */
  setDebugMode(mode) {
    const n = Math.round(Number(mode));
    this._debugMode = n >= 0 && n <= 3 && Number.isFinite(n) ? n : 0;
    return this._debugMode;
  }

  /** 循环诊断模式 0→1→2→3→0，返回新模式 */
  cycleDebugMode() {
    return this.setDebugMode((this._debugMode + 1) % 4);
  }

  /**
   * GL 状态运行时快照（JSON-able；doc6 §3.3 A 证据链 / doc7 §3.4 诊断 JSON）。
   * 采集当前绑定 FBO 的附件类型/尺寸、viewport/scissor、剔除与深度状态、混合状态、
   * getError，以及地形顶点/三角形数、区块数与 drawCalls。
   * @returns {object} 可直接 JSON.stringify 的快照
   */
  getGLStateSnapshot() {
    const gl = this.gl;
    const snap = {
      generatedAt: new Date().toISOString(),
      browser: null,
      gpu: null,
      viewport: null,
      drawingBuffer: null,
      sceneTarget: { width: this._vw, height: this._vh }, // draw() 收到的场景目标物理尺寸
      boundFbo: { bound: false, colorAttachment: null, depthAttachment: null },
      state: {},
      glError: null,
      terrain: {
        vertCount: this._terr ? this._terr.vertCount : 0,
        triCount: this.stats.triangles,
      },
      chunks: this._chunkMesh ? this._chunkMesh.length : 0,
      drawCalls: this.stats.drawCalls,
      debugMode: this._debugMode,
      cullEnabled: this.cullEnabled,
    };
    if (!gl) return snap;
    if (typeof navigator !== 'undefined' && navigator.userAgent) snap.browser = navigator.userAgent;
    // GPU 渲染器字符串（WEBGL_debug_renderer_info 不可用时置 null）
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) snap.gpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    } catch (_) { /* 快照不因探测失败而中断 */ }

    const enumName = glEnumName;
    const boolOf = (v) => !!v;
    const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    if (bound) {
      snap.boundFbo.bound = true;
      const describe = (attach) => {
        try {
          const type = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, attach, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
          if (type === gl.TEXTURE) return { type: 'texture' };
          if (type === gl.RENDERBUFFER) {
            const rbo = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, attach, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
            const prev = gl.getParameter(gl.RENDERBUFFER_BINDING);
            gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
            const size = {
              type: 'renderbuffer',
              width: gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH),
              height: gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_HEIGHT),
            };
            gl.bindRenderbuffer(gl.RENDERBUFFER, prev);
            return size;
          }
          return null;
        } catch (_) { return null; }
      };
      snap.boundFbo.colorAttachment = describe(gl.COLOR_ATTACHMENT0);
      snap.boundFbo.depthAttachment = describe(gl.DEPTH_ATTACHMENT);
    }
    snap.viewport = Array.from(gl.getParameter(gl.VIEWPORT));
    snap.drawingBuffer = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    snap.state = {
      scissorTest: boolOf(gl.isEnabled(gl.SCISSOR_TEST)),
      scissorBox: Array.from(gl.getParameter(gl.SCISSOR_BOX)),
      cullFace: boolOf(gl.isEnabled(gl.CULL_FACE)),
      cullFaceMode: enumName(gl.getParameter(gl.CULL_FACE_MODE)),
      frontFace: enumName(gl.getParameter(gl.FRONT_FACE)),
      depthTest: boolOf(gl.isEnabled(gl.DEPTH_TEST)),
      depthFunc: enumName(gl.getParameter(gl.DEPTH_FUNC)),
      depthMask: boolOf(gl.getParameter(gl.DEPTH_WRITEMASK)),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK), boolOf),
      blend: boolOf(gl.isEnabled(gl.BLEND)),
      blendSrcRgb: enumName(gl.getParameter(gl.BLEND_SRC_RGB)),
      blendDstRgb: enumName(gl.getParameter(gl.BLEND_DST_RGB)),
      blendEquationRgb: enumName(gl.getParameter(gl.BLEND_EQUATION_RGB)),
    };
    snap.glError = enumName(gl.getError());
    return snap;
  }

  // —— 帧绘制 ————————————————

  /**
   * 绘制一帧地表场景（在 CanvasManager.beginGLFrame() 之后调用）。
   * @param {WebGL2RenderingContext} gl
   * @param {number} w 物理像素宽  @param {number} h 物理像素高
   * @param {object} renderData 场景数据（见文件头契约）
   * @param {{time?:number, dt?:number}} [opts]
   */
  draw(gl, w, h, renderData, opts = {}) {
    if (this._destroyed || !this._inited || !this.sw) return this.stats;
    const rd = renderData || {};
    const time = opts.time || 0;
    const tier = this.tier;
    let dc = 0;

    const m = this._m;
    let eye;

    if (this._objectOnly || this._extCam) {
      // —— 对象独占模式（场景化集成 TASK-1.2/1.4）：外部相机/VP；不清屏、
      //    不绘天空与地形 —— 清屏唯一所有者仍是 PostProcessor 8 步契约，
      //    场景绘制权威在 PlanetSurfaceScene。 ——
      eye = this.camera.eye;
      if (this._extCam) {
        eye[0] = this._extCam.eye[0];
        eye[1] = this._extCam.eye[1];
        eye[2] = this._extCam.eye[2];
        if (this._extCam.target) {
          this.camera.target[0] = this._extCam.target[0];
          this.camera.target[1] = this._extCam.target[1];
          this.camera.target[2] = this._extCam.target[2];
        }
        if (this._extCam.vp) {
          m.vp.set(this._extCam.vp);
        } else if (this._extCam.target) {
          mat4Perspective(m.proj, 1.05, w / Math.max(1, h), 0.1, 1600);
          mat4LookAt(m.view, eye, this._extCam.target, [0, 1, 0]);
          mat4Multiply(m.vp, m.proj, m.view);
        }
      }
      this._vw = w;
      this._vh = h;
    } else {
      this._updateCamera(w, h, rd, opts);
      eye = this.camera.eye;

      // —— 0. 双保险清屏（主题地平线色 + 深度） ——
      // 场景 FBO 清屏唯一所有者是 PostProcessor.beginScene()（8 步契约）；此处为
      // doc7 §2.2 允许的冗余防御：地表视图自带正确主题色，任何前序状态偏差
      // （colorMask/scissor/blend 残留）也不至于依赖"天空恰好覆盖所有像素"。
      // 场景 FBO 已挂 DEPTH_COMPONENT24（TASK-0.1），gl.clear(DEPTH) 自此真实生效。
      const horizon = this._sky.horizon;
      gl.clearColor(horizon[0], horizon[1], horizon[2], 1.0);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // —— 1. 天空（pass 状态隔离：关深度/不写深度/关混合/关剔除） ——
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.progSky);
      const uSky = this._u.sky;
      gl.uniformMatrix4fv(uSky.uInvVP, false, mat4Invert(m.invVp, m.vp));
      gl.uniform3f(uSky.uCamPos, eye[0], eye[1], eye[2]);
      gl.uniform3fv(uSky.uZenith, this._sky.zenith);
      gl.uniform3fv(uSky.uHorizon, this._sky.horizon);
      gl.uniform3fv(uSky.uGround, this._sky.ground);
      gl.uniform3fv(uSky.uSunDir, this._sunDir);
      gl.uniform3fv(uSky.uSunColor, this._sunColor);
      gl.uniform1f(uSky.uStars, this._sky.stars);
      gl.uniform1f(uSky.uTime, time);
      gl.bindVertexArray(this._skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      dc++;

      // —— 2. 地形（单缓冲单 draw call） ——
      if (this._terr.vertCount > 0) {
        gl.useProgram(this.progTerrain);
        const u = this._u.terrain;
        gl.uniformMatrix4fv(u.uVP, false, m.vp);
        gl.uniform3fv(u.uSunDir, this._sunDir);
        gl.uniform3fv(u.uSunColor, this._sunColor);
        gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
        gl.uniform3fv(u.uFogColor, this._fogColor);
        gl.uniform2f(u.uFogRange, this._fogRange[0], this._fogRange[1]);
        gl.uniform1f(u.uDebugMode, this._debugMode);
        gl.bindVertexArray(this._terr.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this._terr.vertCount);
        dc++;
      }
    }

    // —— 不透明状态基线（对象 pass 共用；进入 pass 前显式声明） ——
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.frontFace(gl.CCW);
    // 剔除仅在绕序已验证时开启：greedyMeshChunk 全部 6 向面与 GroundMeshes 单位盒
    // 均为 CCW-外向（TERRAIN-02）。诊断模式 1（无剔除 Unlit）与 3（绕序审计，需
    // 看到背面染洋红）强制临时关闭；模式 2 保持开启以暴露"正面消失破洞"。
    const cullOpaque = this.cullEnabled && this._debugMode !== 1 && this._debugMode !== 3;
    if (cullOpaque) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    // —— 2. 建筑货箱实例（单位盒） ——
    this._fillBoxInstances(rd, time);
    if (this._box.count > 0) {
      this._uploadInstances(this._box, this._boxArr, this._box.count);
      gl.useProgram(this.progBox);
      const u = this._u.box;
      gl.uniformMatrix4fv(u.uVP, false, m.vp);
      gl.uniform3fv(u.uSunDir, this._sunDir);
      gl.uniform3fv(u.uSunColor, this._sunColor);
      gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
      gl.uniform3fv(u.uFogColor, this._fogColor);
      gl.uniform2f(u.uFogRange, this._fogRange[0], this._fogRange[1]);
      gl.uniform1f(u.uHdr, this.hdrScale);
      gl.bindVertexArray(this._box.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this._box.meshCount, this._box.count);
      dc++;
    }

    // —— 3. actor 图集（敌人 + 殖民者 + 传送带段） ——
    this._fillActorInstances(rd, time);
    if (this._actor.count > 0) {
      this._uploadInstances(this._actor, this._actorArr, this._actor.count);
      gl.useProgram(this.progActor);
      const u = this._u.actor;
      gl.uniformMatrix4fv(u.uVP, false, m.vp);
      gl.uniform3fv(u.uSunDir, this._sunDir);
      gl.uniform3fv(u.uSunColor, this._sunColor);
      gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
      gl.uniform3fv(u.uFogColor, this._fogColor);
      gl.uniform2f(u.uFogRange, this._fogRange[0], this._fogRange[1]);
      gl.uniform1f(u.uHdr, this.hdrScale);
      gl.bindVertexArray(this._actor.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this._actor.meshCount, this._actor.count);
      dc++;
    }

    // —— 4. 角色七部件（单 draw call，部件矩阵逐实例） ——
    this._fillCharInstances(rd, opts, time);
    if (this._char.count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this._char.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._charArr.subarray(0, this._char.count * 20));
      gl.useProgram(this.progChar);
      const u = this._u.char;
      gl.uniformMatrix4fv(u.uVP, false, m.vp);
      gl.uniform3fv(u.uSunDir, this._sunDir);
      gl.uniform3fv(u.uSunColor, this._sunColor);
      gl.uniform3f(u.uCamPos, eye[0], eye[1], eye[2]);
      gl.uniform3fv(u.uFogColor, this._fogColor);
      gl.uniform2f(u.uFogRange, this._fogRange[0], this._fogRange[1]);
      gl.uniform1f(u.uHdr, this.hdrScale);
      gl.bindVertexArray(this._char.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this._char.meshCount, this._char.count);
      dc++;
    }

    // —— 5. AoE 预警贴花（α 混合，深度不写；贴花圆盘三角形朝 -Y，双面绘制关剔除） ——
    this._buildDecals(rd, time);
    if (this._decal.count > 0) {
      this._uploadDynamic(this._decal, this._decalArr);
      gl.disable(gl.CULL_FACE); // 透明贴花/缎带按材质策略双面（doc6 §3.3 C）
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.progQuadC);
      gl.uniformMatrix4fv(this._u.quadc.uVP, false, m.vp);
      gl.uniform1f(this._u.quadc.uTime, time);
      gl.uniform1f(this._u.quadc.uPulse, 1);
      gl.bindVertexArray(this._decal.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this._decal.count);
      dc++;
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    // —— 6. 刀光带 / 光束（加性，深度不写；正反两面都可见 → 关剔除） ——
    this._buildFx(rd, eye);
    if (this._fx.count > 0) {
      this._uploadDynamic(this._fx, this._fxArr);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(this.progQuadC);
      gl.uniformMatrix4fv(this._u.quadc.uVP, false, m.vp);
      gl.uniform1f(this._u.quadc.uTime, time);
      gl.uniform1f(this._u.quadc.uPulse, 0);
      gl.bindVertexArray(this._fx.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this._fx.count);
      dc++;
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    // —— 7. 挖掘粒子（加性点精灵；POINTS 不受剔除影响，状态隔离保持显式） ——
    this._updateParticles(rd, opts.dt != null ? opts.dt : 1 / 30, tier);
    if (this._pool.n > 0) {
      const n = this._packParticles(tier);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(this.progPart);
      gl.uniformMatrix4fv(this._u.part.uVP, false, m.vp);
      gl.uniform1f(this._u.part.uPointScale, h * 0.5 * m.proj[5]);
      gl.bindVertexArray(this._particle.vao);
      gl.drawArrays(gl.POINTS, 0, n);
      dc++;
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    gl.bindVertexArray(null);
    gl.depthFunc(gl.LEQUAL);
    this.stats.drawCalls = dc;
    return this.stats;
  }

  /** 动态缓冲上传（fx/decal 共用；粒子独立打包） */
  _uploadDynamic(entry, arr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.vbo);
    if (entry.count * entry.strideF > entry.capF) {
      gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, entry.count * entry.strideF), gl.DYNAMIC_DRAW);
      entry.capF = entry.count * entry.strideF;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, entry.count * entry.strideF));
    }
  }

  // —— 实例填充（CPU 侧；全部确定性） ————————————————

  /** 建筑 + 传送带货箱 → 单位盒实例流 */
  _fillBoxInstances(rd, time) {
    if (!this._boxArr) this._boxArr = new Float32Array(1024 * 11);
    const arr = this._boxArr;
    let n = 0;
    const push = (x, y, z, sx, sy, sz, rotY, r, g, b, emit) => {
      if (n >= 1024) return;
      let o = n * 11;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
      arr[o + 3] = sx; arr[o + 4] = sy; arr[o + 5] = sz;
      arr[o + 6] = r; arr[o + 7] = g; arr[o + 8] = b;
      arr[o + 9] = rotY; arr[o + 10] = emit;
      n++;
    };

    // 建筑（按 category 着色；y 为底面 → 实例中心抬半高）
    const buildings = rd.buildings || [];
    for (const b of buildings) {
      const sx = b.sx != null ? b.sx : 2.4;
      const sy = b.sy != null ? b.sy : 1.8;
      const sz = b.sz != null ? b.sz : 2.4;
      const c = BUILDING_COLORS[b.category] || [0.68, 0.70, 0.74];
      push(b.x, (b.y || 0) + sy / 2, b.z, sx, sy, sz, b.rotY || 0, c[0], c[1], c[2], 0.04);
    }

    // 传送带货箱：沿路径弧长匀速滑动（≤200，确定性相位）
    const paths = rd.conveyor && rd.conveyor.paths ? rd.conveyor.paths : [];
    let crates = 0;
    const CAP_CRATES = 200;
    for (const path of paths) {
      if (crates >= CAP_CRATES) break;
      const pts = path.pts;
      if (!pts || pts.length < 2) continue;
      const speed = path.speed != null ? path.speed : 1.6;
      const spacing = path.spacing != null ? path.spacing : 1.1;
      // 弧长表
      let total = 0;
      const segLen = [];
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        segLen.push(l);
        total += l;
      }
      if (!(total > 0)) continue;
      // doc19 WP-5.2：path.count 存在时货箱视觉数 = 实体带载（FFF #176 视觉同源；
      // 缺省维持相位满铺口径以兼容 v0.1 采掘装饰带）
      const wantCount = path.count != null
        ? Math.min(path.count, Math.floor(total / spacing))
        : Math.floor(total / spacing);
      const count = Math.min(wantCount, CAP_CRATES - crates);
      for (let k = 0; k < count; k++) {
        let s = (time * speed + k * spacing) % total;
        let i = 0;
        while (i < segLen.length && s > segLen[i]) { s -= segLen[i]; i++; }
        if (i >= segLen.length) i = segLen.length - 1;
        const a = pts[i];
        const b = pts[i + 1];
        const f = segLen[i] > 1e-6 ? s / segLen[i] : 0;
        const px = a[0] + (b[0] - a[0]) * f;
        const py = a[1] + (b[1] - a[1]) * f;
        const pz = a[2] + (b[2] - a[2]) * f;
        const rotY = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
        push(px, py + 0.32, pz, 0.26, 0.26, 0.26, rotY, 1.35, 0.92, 0.30, 0.30);
        crates++;
      }
    }
    this._box.count = n;
  }

  /** 敌人 + 殖民者 + 传送带段 → actor 图集实例流 */
  _fillActorInstances(rd, time) {
    if (!this._actorArr) this._actorArr = new Float32Array(768 * 12);
    const arr = this._actorArr;
    let n = 0;
    const push = (x, y, z, rotY, scale, meshId, flash, phase, r, g, b, emit) => {
      if (n >= 768) return;
      const o = n * 12;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; arr[o + 3] = rotY;
      arr[o + 4] = scale; arr[o + 5] = meshId; arr[o + 6] = flash; arr[o + 7] = phase;
      arr[o + 8] = r; arr[o + 9] = g; arr[o + 10] = b; arr[o + 11] = emit;
      n++;
    };

    // 传送带段（meshId 5；逐 1.0 单元采样折线）
    const paths = rd.conveyor && rd.conveyor.paths ? rd.conveyor.paths : [];
    let belts = 0;
    const CAP_BELTS = 600;
    for (const path of paths) {
      if (belts >= CAP_BELTS) break;
      const pts = path.pts;
      if (!pts || pts.length < 2) continue;
      for (let i = 1; i < pts.length && belts < CAP_BELTS; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const rotY = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
        const steps = Math.max(1, Math.round(segLen)); // 四舍五入保证带段无缝搭接
        for (let k = 0; k < steps && belts < CAP_BELTS; k++) {
          const f = steps > 0 ? k / steps : 0;
          push(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f,
            rotY, 1.0, ACTOR_MESH_ID.conveyor, 0, 0, 0.42, 0.43, 0.46, 0);
          belts++;
        }
      }
    }

    // 敌人（≤40 总量约束由任务数据保证；boss 相位提升自发光）
    const enemies = rd.enemies || [];
    for (const e of enemies) {
      const kind = ACTOR_MESH_ID[e.kind] != null ? e.kind : 'grunt';
      const c = ENEMY_COLORS[kind];
      const bob = kind === 'boss' ? Math.sin(time * 1.5 + (e.phase || 0)) * 0.08 : 0;
      const emit = kind === 'boss' ? 0.10 + 0.14 * (e.phase || 1) : 0;
      push(e.x, e.y + bob, e.z, e.yaw || 0, 1.0, ACTOR_MESH_ID[kind],
        e.flash || 0, e.phase || 1, c[0], c[1], c[2], emit);
    }

    // 殖民者（行走上下颠簸在 CPU 侧按相位确定性合成）
    const colonists = rd.colonists || [];
    for (const p of colonists) {
      const bob = p.walk ? Math.abs(Math.sin(time * 7 + (p.phase || 0) * 6.2832)) * 0.05 : 0;
      push(p.x, p.y + bob, p.z, p.rotY || 0, 1.0, ACTOR_MESH_ID.colonist, 0, 0, 0.95, 0.72, 0.42, 0);
    }
    this._actor.count = n;
  }

  /**
   * 角色七部件模型矩阵：base = T(脚位+起伏) · Ry(yaw)，部件 = base · T(piv) · Rx · T(-piv)。
   * 状态动画：run 摆臂摆腿 / dig 右臂钻振 / attack 劈砍（attackT 0..1）/ hurt 前倾。
   */
  _fillCharInstances(rd, opts, time) {
    const ch = rd.character;
    this._char.count = 0;
    if (!ch || !this._charArr) return;
    const arr = this._charArr;
    const m = this._m;
    const state = ch.state || 'idle';
    const walkT = state === 'run' ? (ch.animT || 0) * 9 : 0;
    const swing = state === 'run' ? Math.sin(walkT) : 0;
    const bob = state === 'run'
      ? Math.abs(Math.cos(walkT)) * 0.05
      : Math.sin(time * 2.0) * 0.012;

    // 基座：脚位 + 朝向
    mat4Translate(m.base, ch.x, (ch.y || 0) + bob, ch.z);
    mat4RotateY(m.tmp, ch.yaw || 0);
    mat4Multiply(m.base, m.base, m.tmp);

    // 部件姿态角（rx 绕枢轴局部 X，rz 次要）
    const pose = {
      head: { rx: state === 'run' ? -swing * 0.05 : 0, rz: 0 },
      torso: { rx: state === 'run' ? swing * 0.06 : (state === 'hurt' ? 0.30 : 0), rz: 0 },
      armL: { rx: state === 'run' ? swing * 0.6 : Math.sin(time * 1.7) * 0.05, rz: 0 },
      armR: { rx: 0, rz: 0 },
      legL: { rx: -swing * 0.75, rz: 0 },
      legR: { rx: swing * 0.75, rz: 0 },
      backpack: { rx: 0, rz: 0 },
    };
    if (state === 'dig') pose.armR.rx = -1.10 + Math.sin(time * 13.0) * 0.55;
    else if (state === 'attack') pose.armR.rx = -2.30 + clamp(ch.attackT || 0, 0, 1) * 2.60;
    else pose.armR.rx = state === 'run' ? -swing * 0.6 : -Math.sin(time * 1.7) * 0.05;

    const names = this._char.partNames;
    let count = 0;
    for (let pi = 0; pi < names.length && count < 7; pi++) {
      const name = names[pi];
      const pv = EXO_PIVOTS[name] || [0, 1, 0];
      const ang = pose[name] || { rx: 0, rz: 0 };
      // part = base · T(piv) · Rx(rx) · Rz(rz) · T(-piv)
      mat4Translate(m.piv, pv[0], pv[1], pv[2]);
      mat4RotateX(m.rot, ang.rx);
      mat4Multiply(m.piv, m.piv, m.rot);
      mat4RotateZ(m.rot, ang.rz);
      mat4Multiply(m.piv, m.piv, m.rot);
      mat4Translate(m.tmp, -pv[0], -pv[1], -pv[2]);
      mat4Multiply(m.piv, m.piv, m.tmp);
      mat4Multiply(m.part, m.base, m.piv);

      const o = count * 20;
      for (let k = 0; k < 16; k++) arr[o + k] = m.part[k];
      arr[o + 16] = pi;                  // iMisc.x 部件号
      arr[o + 17] = ch.flash || 0;       // iMisc.y 闪白
      arr[o + 18] = 0;                   // iMisc.z 自发光
      arr[o + 19] = 0;                   // iMisc.w 保留
      count++;
    }
    this._char.count = count;
  }

  // —— 特效 ————————————————

  /** 刀光带 + 相机对齐光束 → 加性四元色缓冲 */
  _buildFx(rd, eye) {
    if (!this._fxArr) this._fxArr = new Float32Array(this._fx.capF);
    const arr = this._fxArr;
    let n = 0;
    const cap = this._fx.capF;
    const push = (x, y, z, r, g, b, a) => {
      if (n + 7 > cap) return;
      arr[n] = x; arr[n + 1] = y; arr[n + 2] = z; arr[n + 3] = r; arr[n + 4] = g; arr[n + 5] = b; arr[n + 6] = a;
      n += 7;
    };
    const K = this.tier === 1 ? 10 : 6;

    // 刀光带：内缘 r0 → 外缘 r1 的扇形缎带，进度 t 控制扫掠角
    const slashes = (rd.effects && rd.effects.slashes) || [];
    for (const s of slashes) {
      const arc = s.arc != null ? s.arc : Math.PI * 0.9;
      const prog = clamp(s.t != null ? s.t : 1, 0, 1);
      const col = s.color || [0.55, 0.95, 1.20];
      const r0 = 0.55;
      const r1 = 1.30;
      const y0 = 0.45;
      const y1 = 1.50;
      const start = (s.yaw || 0) - arc / 2;
      let prev = null;
      for (let k = 0; k <= K; k++) {
        const a = start + arc * (k / K) * prog;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const inner = [s.x + r0 * ca, s.y + y0, s.z - r0 * sa];
        const outer = [s.x + r1 * ca, s.y + y1, s.z - r1 * sa];
        const fade = 1 - k / K;
        if (prev) {
          const a0 = prev.a * 0.85;
          const a1 = fade * 0.85;
          push(prev.i[0], prev.i[1], prev.i[2], col[0], col[1], col[2], a0);
          push(inner[0], inner[1], inner[2], col[0], col[1], col[2], a1);
          push(outer[0], outer[1], outer[2], col[0], col[1], col[2], a1);
          push(prev.i[0], prev.i[1], prev.i[2], col[0], col[1], col[2], a0);
          push(outer[0], outer[1], outer[2], col[0], col[1], col[2], a1);
          push(prev.o[0], prev.o[1], prev.o[2], col[0], col[1], col[2], a0);
        }
        prev = { i: inner, o: outer, a: fade };
      }
    }

    // 光束：两张正交相机对齐长条（保证任意视角可见）
    const beams = (rd.effects && rd.effects.beams) || [];
    for (const b of beams) {
      const a = b.a;
      const bb = b.b;
      const col = b.color || [0.7, 1.0, 1.6];
      const width = (b.width != null ? b.width : 0.09) / 2;
      const dx = bb[0] - a[0];
      const dy = bb[1] - a[1];
      const dz = bb[2] - a[2];
      const len = Math.hypot(dx, dy, dz) || 1e-4;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      // side = normalize(u × (a - eye))；up = u × side
      const wx = a[0] - eye[0];
      const wy = a[1] - eye[1];
      const wz = a[2] - eye[2];
      let sx = uy * wz - uz * wy;
      let sy = uz * wx - ux * wz;
      let sz = ux * wy - uy * wx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      const tx = uy * sz - uz * sy;
      const ty = uz * sx - ux * sz;
      const tz = ux * sy - uy * sx;
      const quads = [[sx, sy, sz], [tx, ty, tz]];
      for (const q of quads) {
        const hw = width;
        push(a[0] - q[0] * hw, a[1] - q[1] * hw, a[2] - q[2] * hw, col[0], col[1], col[2], 0.95);
        push(a[0] + q[0] * hw, a[1] + q[1] * hw, a[2] + q[2] * hw, col[0], col[1], col[2], 0.95);
        push(bb[0] + q[0] * hw, bb[1] + q[1] * hw, bb[2] + q[2] * hw, col[0], col[1], col[2], 0.35);
        push(a[0] - q[0] * hw, a[1] - q[1] * hw, a[2] - q[2] * hw, col[0], col[1], col[2], 0.95);
        push(bb[0] + q[0] * hw, bb[1] + q[1] * hw, bb[2] + q[2] * hw, col[0], col[1], col[2], 0.35);
        push(bb[0] - q[0] * hw, bb[1] - q[1] * hw, bb[2] - q[2] * hw, col[0], col[1], col[2], 0.35);
      }
    }
    this._fx.count = n / this._fx.strideF;
  }

  /** 红色 AoE 预警贴花：地表圆盘 + 亮边环（α 混合，脉冲由着色器 uPulse 驱动） */
  _buildDecals(rd, time) {
    if (!this._decalArr) this._decalArr = new Float32Array(this._decal.capF);
    const arr = this._decalArr;
    let n = 0;
    const cap = this._decal.capF;
    const push = (x, y, z, r, g, b, a) => {
      if (n + 7 > cap) return;
      arr[n] = x; arr[n + 1] = y; arr[n + 2] = z; arr[n + 3] = r; arr[n + 4] = g; arr[n + 5] = b; arr[n + 6] = a;
      n += 7;
    };
    const K = 16;
    const aoes = (rd.effects && rd.effects.aoe) || [];
    for (const d of aoes) {
      const r = d.r != null ? d.r : 2.2;
      const hy = getSurfaceHeight(this.sw, d.x, d.z);
      const y = (hy >= 0 ? hy + 1 : (d.y != null ? d.y : 0)) + 0.05;
      const grow = clamp(d.t != null ? d.t : 1, 0, 1);
      const rr = r * (0.25 + 0.75 * grow);
      // 内盘（暗）
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * Math.PI * 2;
        const a1 = ((k + 1) / K) * Math.PI * 2;
        push(d.x, y, d.z, 1.0, 0.16, 0.12, 0.20);
        push(d.x + rr * Math.cos(a0), y, d.z + rr * Math.sin(a0), 1.0, 0.16, 0.12, 0.24);
        push(d.x + rr * Math.cos(a1), y, d.z + rr * Math.sin(a1), 1.0, 0.16, 0.12, 0.24);
      }
      // 边环（亮）
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * Math.PI * 2;
        const a1 = ((k + 1) / K) * Math.PI * 2;
        const r0 = rr * 0.82;
        push(d.x + r0 * Math.cos(a0), y, d.z + r0 * Math.sin(a0), 1.0, 0.22, 0.14, 0.55);
        push(d.x + rr * Math.cos(a0), y, d.z + rr * Math.sin(a0), 1.0, 0.22, 0.14, 0.65);
        push(d.x + rr * Math.cos(a1), y, d.z + rr * Math.sin(a1), 1.0, 0.22, 0.14, 0.65);
        push(d.x + r0 * Math.cos(a0), y, d.z + r0 * Math.sin(a0), 1.0, 0.22, 0.14, 0.55);
        push(d.x + rr * Math.cos(a1), y, d.z + rr * Math.sin(a1), 1.0, 0.22, 0.14, 0.65);
        push(d.x + r0 * Math.cos(a1), y, d.z + r0 * Math.sin(a1), 1.0, 0.22, 0.14, 0.55);
      }
    }
    void time; // 脉冲由 uPulse 着色器分支驱动
    this._decal.count = n / this._decal.strideF;
  }

  // —— 挖掘粒子 ————————————————

  /** 消费 digEvents 按确定性哈希初速喷发粒子并步进池（重力 + 寿命） */
  _updateParticles(rd, dt, tier) {
    const pool = this._pool;
    // —— 喷发 ——
    const events = (rd.effects && rd.effects.digEvents) || [];
    for (const ev of events) {
      const nSpawn = tier === 1 ? 8 : 4;
      for (let i = 0; i < nSpawn && pool.n < pool.cap; i++) {
        const id = this._spawnSeq++;
        const p = pool.n++;
        const f1 = hash01(id * 4 + 1);
        const f2 = hash01(id * 4 + 2);
        const f3 = hash01(id * 4 + 3);
        const f4 = hash01(id * 4 + 4);
        pool.x[p] = ev.x + 0.5 + (f1 - 0.5) * 0.6;
        pool.y[p] = ev.y + 0.5 + (f2 - 0.5) * 0.6;
        pool.z[p] = ev.z + 0.5 + (f3 - 0.5) * 0.6;
        pool.vx[p] = (f1 - 0.5) * 3.4;
        pool.vy[p] = 2.0 + f4 * 2.6;
        pool.vz[p] = (f3 - 0.5) * 3.4;
        pool.life[p] = 0.5 + f4 * 0.3;
        pool.life0[p] = pool.life[p];
        pool.size[p] = 0.09 + f2 * 0.07;
        if (Array.isArray(ev.color) && ev.color.length >= 3) {
          // 自定义颜色事件（水花/能量喷发）：matId 走 255 哨兵 + 逐粒 RGB
          pool.matId[p] = 255;
          pool.colR[p] = ev.color[0];
          pool.colG[p] = ev.color[1];
          pool.colB[p] = ev.color[2];
        } else {
          pool.matId[p] = ev.matId != null ? ev.matId : SURFACE_MAT.ROCK;
        }
      }
    }
    // —— 步进（倒序交换删除） ——
    for (let p = pool.n - 1; p >= 0; p--) {
      pool.life[p] -= dt;
      if (pool.life[p] <= 0) {
        const last = pool.n - 1;
        if (p !== last) {
          pool.x[p] = pool.x[last]; pool.y[p] = pool.y[last]; pool.z[p] = pool.z[last];
          pool.vx[p] = pool.vx[last]; pool.vy[p] = pool.vy[last]; pool.vz[p] = pool.vz[last];
          pool.life[p] = pool.life[last]; pool.life0[p] = pool.life0[last];
          pool.size[p] = pool.size[last]; pool.matId[p] = pool.matId[last];
        }
        pool.n--;
        continue;
      }
      pool.vy[p] -= 13.0 * dt;
      pool.x[p] += pool.vx[p] * dt;
      pool.y[p] += pool.vy[p] * dt;
      pool.z[p] += pool.vz[p] * dt;
    }
  }

  /** 粒子池 → 点精灵缓冲（颜色 = 材质基色提亮，α = 剩余寿命比） */
  _packParticles(tier) {
    if (!this._partArr) this._partArr = new Float32Array(this._particle.capF);
    const arr = this._partArr;
    const pool = this._pool;
    const maxN = tier === 1 ? 256 : 128;
    let n = 0;
    for (let p = 0; p < pool.n && n < maxN; p++) {
      const o = n * 8;
      const c = pool.matId[p] === 255
        ? [pool.colR[p], pool.colG[p], pool.colB[p]]
        : (MATERIAL_COLORS[pool.matId[p]] || MATERIAL_COLORS[2]);
      arr[o] = pool.x[p];
      arr[o + 1] = pool.y[p];
      arr[o + 2] = pool.z[p];
      arr[o + 3] = Math.min(1.6, c[0] * 1.7 + 0.08);
      arr[o + 4] = Math.min(1.6, c[1] * 1.7 + 0.08);
      arr[o + 5] = Math.min(1.6, c[2] * 1.7 + 0.08);
      arr[o + 6] = clamp(pool.life[p] / Math.max(1e-4, pool.life0[p]), 0, 1);
      arr[o + 7] = pool.size[p];
      n++;
    }
    this._uploadDynamic(this._particle, arr);
    return n;
  }

  // —— 生命周期 ————

  /** 释放本类直接持有的 GL 资源（glc.destroy() 仍会兜底清册回收） */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    // 注销诊断钩子（仅当仍指向本实例——防误清新实例的钩子）
    if (typeof window !== 'undefined' && window.__vfSurfaceDebug
      && window.__vfSurfaceDebug.renderer === this) {
      window.__vfSurfaceDebug = null;
    }
    const gl = this.gl;
    if (!gl) return;
    const delBuf = (b) => { if (b) gl.deleteBuffer(b); };
    if (this._terr) { delBuf(this._terr.vboP); delBuf(this._terr.vboN); delBuf(this._terr.vboC); gl.deleteVertexArray(this._terr.vao); }
    for (const e of [this._box, this._actor]) {
      if (e) { delBuf(e.inst); gl.deleteVertexArray(e.vao); }
    }
    if (this._char) { delBuf(this._char.inst); gl.deleteVertexArray(this._char.vao); }
    for (const e of [this._fx, this._decal, this._particle]) {
      if (e) { delBuf(e.vbo); gl.deleteVertexArray(e.vao); }
    }
    if (this._skyVao) gl.deleteVertexArray(this._skyVao);
    for (const p of [this.progSky, this.progTerrain, this.progBox, this.progActor, this.progChar, this.progQuadC, this.progPart]) {
      if (p) gl.deleteProgram(p);
    }
    this._terr = null;
    this._box = null;
    this._actor = null;
    this._char = null;
    this._fx = null;
    this._decal = null;
    this._particle = null;
    this._skyVao = null;
    this._inited = false;
  }
}
