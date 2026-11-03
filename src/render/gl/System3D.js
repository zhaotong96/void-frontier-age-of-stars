/**
 * render/gl/System3D.js — 恒星系三维场景 GL 资源构建与绘制（返工 Phase R3）
 *
 * 职责：为 SystemRenderer 承载 WebGL2 三维恒星系视图的全部 GPU 资源与绘制。
 * 场景规范（任务书 R3）：
 *  - 相机：缓慢单轨环绕（pitch 固定 62°，yaw 随 opts.time 极慢旋转），透视投影，
 *    半径按视口自适应保证最外轨道入画；
 *  - 恒星：正二十面体细分球（细分 3）+ STAR_VERT/FRAG 光球（4D Simplex-Worley 沸腾
 *    米粒组织、临边昏暗、黑体基色、HDR 3..6）+ CORONA billboard 日冕（半径 = 本体 2.6 倍，
 *    加性混合）；pulsar/neutronStar 追加 PULSAR_V/FRAG 双极喷流锥 + 激波环
 *    （磁轴倾角 23°，uTime 高频旋转）；blackHole 走 BLACKHOLE_V/FRAG 全屏 raymarch
 *    （uCamPos/uCamBasis 由相机推导），轨道线/行星照画在透镜之后（视觉上位于透镜前方）；
 *  - 行星：8 类程序化 3D 球面（同一着色器 uCategory 分支）+ GLOW 大气辉光壳层
 *    （背面剔除 + 正面加性菲涅尔）+ gasGiant 冰晶行星环（倾角 20°，带行星本影遮挡）
 *    + 已殖民行星夜半球金色城市灯火与赤道低轨道发光轨道站环；
 *  - 轨道：3D 圆环线段（倾角 20° 统一），选中提亮；行星按 orbitIndex 均分角 +
 *    tick/opts.time 缓慢公转（纯视觉）；舰队小三角 billboard（阵营色）停靠环；
 *    未解决异常画淡紫虚线信号弧（外缘）；
 *  - LOD：tier1 全效；tier2 日冕降为 128px 低分辨率目标 + 强度衰减（BLACKHOLE_FRAG
 *    步数在着色器内为常量、不可外部注入，按任务书许可的替代方案：tier2 黑洞以
 *    半分辨率离屏目标绘制再线性放大）；tier3 由 SystemRenderer 整体退化为 _render2D。
 *
 * HDR 约定：场景经 PostProcessor 合成。RGBA16F 真 HDR 时 uHdr=1；RGBA8 模拟模式
 * （post.hdrRange=4）下自有着色器输出预除 uHdr=1/4；外部固定着色器（STAR/CORONA/
 * PULSAR/BLACKHOLE，无法注入 uHdr）改用 gl.blendColor + GL_CONSTANT_COLOR 混合因子
 * 在管线侧完成同一预除（不透明体用 (CONSTANT_COLOR, ZERO) 替换、加性体用
 * (CONSTANT_COLOR, ONE) 叠加），保证两种模式观感一致。
 *
 * 拾取约定：frame() 结束后缓存 pickData（各行星世界坐标 / 屏幕物理像素坐标 /
 * 屏幕半径，及相机基向量与 tan(fov/2)），由 SystemRenderer 换算 CSS 逻辑像素并做
 * 射线-球相交，填充 _pickList。绝不使用 gl.readPixels。
 *
 * 约束：顶层无副作用、不触碰 DOM（纯 JS，可在 Node 侧安全 import）；所有 GL 调用
 * 仅发生在 frame()/构建方法内部；不使用任何全局随机源；动画时间只来自 opts.time。
 */

import {
  mat4, mat4Multiply, mat4Perspective, mat4LookAt, mat4TRS,
  mat4Translate, mat4RotateZ, mat4MulVec4,
} from './Mat4.js';
import {
  STAR_VERT, STAR_FRAG, CORONA_VERT, CORONA_FRAG, PULSAR_VERT, PULSAR_FRAG,
} from '../shaders/StarCoronaShader.js';
import { BLACKHOLE_VERT, BLACKHOLE_FRAG } from '../shaders/BlackHoleShader.js';
import { GLSL_HASH, GLSL_NOISE, GLSL_FBM } from './NoiseGLSL.js';

/* ========================= 场景常量 ========================= */

const TAU = Math.PI * 2;
/** mat4LookAt 免分配常量（渲染循环内不产生新数组） */
const LOOK_ORIGIN = [0, 0, 0];
const LOOK_UP = [0, 1, 0];
/** 轨道世界半径：1.0 + orbitIndex*0.62（与 2D 的 60+38n 同比例） */
const ORBIT_BASE = 1.0;
const ORBIT_STEP = 0.62;
/** 舰队停靠环世界半径（与 2D 的 36/60 同比例） */
const FLEET_RING = 0.6;
/** 轨道统一倾角 20°（绕 X 轴） */
const ORBIT_INCLINE = 20 * Math.PI / 180;
/** 相机固定俯仰 62° 与竖直视场 50° */
const CAM_PITCH = 62 * Math.PI / 180;
const CAM_FOV = 50 * Math.PI / 180;
/** 黑洞事件视界（RS=1）对应的世界半径：BH 着色器以 RS 为单位 */
const BH_RS_WORLD = 0.6; // 相机 ~6.2 世界单位 → ~10.3 RS（落在 22 RS 积分域内，吸积盘 1.65..6.2 RS 可见）
/** 日冕半径 = 恒星本体 × 2.6；脉冲星磁层网格缩放 */
const CORONA_K = 2.6;
const PULSAR_K = 2.4;
/** 磁轴倾角 23° */
const PULSAR_TILT = 23 * Math.PI / 180;
/** 日冕离屏目标：tier1=256 / tier2=128（tier2 日冕细节降） */
const CORONA_RES_FULL = 256;
const CORONA_RES_LOW = 128;
/** 舰队三角数量上限（动态缓冲容量） */
const FLEET_MAX = 96;

/** 恒星类型 → STAR_FRAG uStarType 整型（见 StarCoronaShader.js 头注释） */
const STAR_TYPE = {
  yellowDwarf: 0, redDwarf: 1, blueGiant: 2, whiteDwarf: 3,
  neutronStar: 4, pulsar: 5, blackHole: 6,
};
/** 恒星类型 → 本体世界半径 */
const STAR_R = {
  yellowDwarf: 0.30, redDwarf: 0.24, blueGiant: 0.42, whiteDwarf: 0.27,
  neutronStar: 0.20, pulsar: 0.20, blackHole: 0.26,
};
/** 行星类别 → PLANET_FS uCategory 整型 */
const PLANET_CAT = {
  rocky: 0, ocean: 1, ice: 2, desert: 3, gasGiant: 4, lava: 5, toxic: 6, artificial: 7,
};
/** 行星类别 → 本体世界半径 */
const PLANET_R = {
  rocky: 0.105, ocean: 0.105, ice: 0.095, desert: 0.105,
  gasGiant: 0.175, lava: 0.09, toxic: 0.105, artificial: 0.085,
};
/** 轨道线颜色（accent #4fd8e8）/ 异常信号弧颜色（淡紫） */
const ORBIT_RGB = [0.31, 0.847, 0.91];
const ANOMALY_RGB = [0.494, 0.659, 1.0];

/** 类别 → 大气壳（GLOW）参数：[半径倍数, 强度, tint rgb] */
const GLOW_STYLE = {
  rocky: [1.12, 0.55, [0.30, 0.50, 0.85]],
  ocean: [1.16, 0.95, [0.25, 0.55, 0.95]],
  ice: [1.10, 0.45, [0.55, 0.75, 0.95]],
  desert: [1.11, 0.40, [0.78, 0.62, 0.36]],
  gasGiant: [1.09, 0.45, [0.75, 0.65, 0.45]],
  lava: [1.09, 0.40, [0.90, 0.30, 0.10]],
  toxic: [1.30, 1.35, [0.55, 0.75, 0.22]],
  artificial: [1.08, 0.30, [0.40, 0.70, 0.80]],
};

/* ========================= 自有着色器（GLSL ES 3.0，#version 由 GLCore 前置） ========================= */

/** 行星/恒星/辉光共用球体顶点着色器（细分球：aPos 与 aNormal 同缓冲，单位球 normal=position） */
const PLANET_VERT = `
uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
in vec3 aPos;
in vec3 aNormal;
out vec3 vLocal;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vLocal = aPos;
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMatrix * aNormal;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

/** 行星片元着色器：8 类程序化地表（uCategory 分支）+ 昼夜 + 殖民灯火 */
const PLANET_FRAG = `precision highp float;
precision highp int;
` + GLSL_HASH + GLSL_NOISE + GLSL_FBM + `
uniform vec3 uCamPos;
uniform vec3 uStarPos;      // 恒星世界坐标（位于原点）
uniform int uCategory;      // 0 rocky / 1 ocean / 2 ice / 3 desert / 4 gasGiant / 5 lava / 6 toxic / 7 artificial
uniform float uSeed;
uniform float uTime;
uniform float uColony;      // 1.0 = 已殖民
uniform float uHdr;         // HDR 模拟预除系数（真 HDR = 1）

in vec3 vLocal;
in vec3 vWorld;
in vec3 vNormal;
out vec4 fragColor;

// —— 8 类程序化地表反照率（spec/specular 与 emit/自发光为出参） ——
void surface(vec3 p, out vec3 albedo, out float spec, out float emit) {
  spec = 0.0;
  emit = 0.0;
  if (uCategory == 0) {
    // rocky：灰褐噪声地貌 + 山脊细节
    float n = fbm3D(p * 3.4 + uSeed);
    float ridge = 1.0 - abs(simplex3D(p * 6.5 + uSeed * 2.1));
    albedo = mix(vec3(0.34, 0.29, 0.25), vec3(0.66, 0.58, 0.48), n * 0.5 + 0.5);
    albedo *= 0.80 + 0.40 * ridge;
  } else if (uCategory == 1) {
    // ocean：蓝绿海陆分布 + 海面高光
    float cont = fbm3D(p * 2.3 + uSeed);
    float land = smoothstep(0.08, 0.24, cont);
    vec3 water = mix(vec3(0.04, 0.20, 0.44), vec3(0.09, 0.42, 0.55), smoothstep(-0.25, 0.15, cont));
    vec3 landC = mix(vec3(0.52, 0.48, 0.30), vec3(0.20, 0.42, 0.22), fbm3D(p * 5.3 + uSeed * 3.1) * 0.5 + 0.5);
    spec = (1.0 - land) * 0.9;
    albedo = mix(water, landC, land);
  } else if (uCategory == 2) {
    // ice：冷白蓝 + 高反射 + 冰面裂隙
    float crack = fbmFilaments(p * 3.6 + uSeed);
    albedo = mix(vec3(0.76, 0.86, 0.93), vec3(0.95, 0.98, 1.02), fbm3D(p * 2.2 + uSeed) * 0.5 + 0.5);
    albedo = mix(albedo, vec3(0.52, 0.70, 0.86), smoothstep(0.60, 0.92, crack) * 0.5);
    spec = 0.8;
  } else if (uCategory == 3) {
    // desert：沙黄沙丘 + 流动尘暴带
    float dune = fbm3D(vec3(p.x * 2.1, p.y * 7.5, p.z * 2.1) + uSeed);
    float storm = fbm3D(vec3(p.x * 2.8, p.y * 13.0, p.z * 2.8)
      + vec3(uTime * 0.020, 0.0, uTime * 0.013) + uSeed);
    albedo = mix(vec3(0.60, 0.45, 0.25), vec3(0.86, 0.72, 0.42), dune * 0.5 + 0.5);
    albedo = mix(albedo, vec3(0.76, 0.62, 0.40), smoothstep(0.12, 0.62, storm) * 0.38);
  } else if (uCategory == 4) {
    // gasGiant：科里奥利纬向风暴带（横向条纹 fbm 扰动）+ 卵形风暴胞
    float warp = fbm3D(vec3(p.x * 2.6, p.y * 8.0, p.z * 2.6) + vec3(0.0, uTime * 0.016, 0.0) + uSeed);
    float band = sin(p.y * 9.5 + warp * 2.3 + uSeed * 4.0);
    float band2 = sin(p.y * 23.0 + warp * 3.4 + 1.7);
    vec3 c = mix(vec3(0.70, 0.50, 0.29), vec3(0.90, 0.80, 0.60), band * 0.5 + 0.5);
    c = mix(c, vec3(0.54, 0.32, 0.19), smoothstep(0.35, 0.95, band2) * 0.42);
    vec2 su = vec2(atan(p.z, p.x) * 2.0, p.y * 6.0);
    float storm = worley2D(su * 3.0 + vec2(uTime * 0.012, uSeed * 7.0));
    c = mix(c, vec3(0.92, 0.88, 0.76), smoothstep(0.0, 0.24, storm) * 0.45);
    albedo = c;
  } else if (uCategory == 5) {
    // lava：暗色玄武壳 + HDR 自发光岩浆裂谷（脊状噪声阈值）
    float crack = fbmFilaments(p * 2.7 + uSeed);
    float vein = smoothstep(0.55, 0.88, crack);
    albedo = vec3(0.10, 0.075, 0.065) * (0.55 + 0.55 * fbm3D(p * 5.0 + uSeed));
    emit = vein * (2.4 + 1.4 * sin(uTime * 1.6 + uSeed * 12.0 + crack * 9.0));
    albedo = mix(albedo, vec3(1.0, 0.34, 0.06), vein * 0.4);
  } else if (uCategory == 6) {
    // toxic：黄绿毒雾翻涌（厚大气在 GLOW 壳层增强）
    float swirl = fbm3D(vec3(p.x * 2.4, p.y * 5.2, p.z * 2.4)
      + vec3(uTime * 0.030, uTime * 0.011, 0.0) + uSeed);
    albedo = mix(vec3(0.33, 0.45, 0.15), vec3(0.60, 0.70, 0.28), swirl * 0.5 + 0.5);
    albedo = mix(albedo, vec3(0.70, 0.78, 0.34),
      smoothstep(0.2, 0.8, fbm3D(p * 6.8 - uTime * 0.02 + uSeed)) * 0.3);
  } else {
    // artificial：金属灰面板 + 规则灯带（纬带 + 12 条经带）
    float panel = noise3D(p * 9.0 + uSeed);
    float lat = abs(fract(p.y * 4.0 + 0.5) - 0.5);
    float lon = abs(fract(atan(p.z, p.x) * 1.9099 + 0.5) - 0.5);
    float strip = (1.0 - smoothstep(0.012, 0.045, lat))
      + (1.0 - smoothstep(0.018, 0.05, lon)) * 0.6;
    strip = clamp(strip, 0.0, 1.0);
    albedo = mix(vec3(0.40, 0.44, 0.48) * (0.78 + 0.30 * panel), vec3(0.55, 0.72, 0.80), strip * 0.45);
    emit = strip * 1.35;
    spec = 0.5;
  }
}

void main() {
  vec3 p = normalize(vLocal);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uStarPos - vWorld);
  float ndl = dot(N, L);
  float day = max(ndl, 0.0);
  float twilight = smoothstep(-0.18, 0.28, ndl);
  float night = 1.0 - twilight;

  vec3 albedo;
  float spec;
  float emit;
  surface(p, albedo, spec, emit);

  // 昼夜明暗（晨昏线软化）
  vec3 col = albedo * (0.09 + 1.05 * day);
  if (spec > 0.001 && day > 0.0) {
    vec3 H = normalize(L + V);
    col += vec3(0.95, 1.00, 1.08) * pow(max(dot(N, H), 0.0), 64.0) * spec * day;
  }
  if (uCategory == 5) col += vec3(1.30, 0.40, 0.10) * emit;                    // 岩浆 HDR 自发光
  if (uCategory == 7) col += vec3(0.45, 0.85, 0.95) * emit * (0.30 + 0.90 * night);

  // —— 已殖民：夜半球金色城市灯火（城市群掩码 × worley 灯网点） ——
  if (uColony > 0.5 && night > 0.02) {
    float cluster = smoothstep(-0.15, 0.45, simplex3D(p * 5.5 + uSeed * 3.1));
    float wcell = worley3D(p * 21.0 + uSeed * 9.0);
    float lights = (1.0 - smoothstep(0.06, 0.30, wcell)) * cluster * night;
    col += vec3(1.35, 1.00, 0.50) * lights * 1.5;
  }

  // 表面菲涅尔大气边缘（弱；厚大气 toxic 在 GLOW 壳层另行增强）
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 rimTint = (uCategory == 6) ? vec3(0.45, 0.60, 0.18)
               : (uCategory == 5) ? vec3(0.70, 0.25, 0.10)
               : vec3(0.25, 0.45, 0.75);
  col += rimTint * rim * (0.15 + 0.85 * day) * ((uCategory == 6) ? 0.85 : 0.40);

  fragColor = vec4(col * uHdr, 1.0);
}
`;

/** 大气辉光壳层顶点着色器（GLOW 模式：壳层半径由 uRadius 放大） */
const GLOW_VERT = `
uniform mat4 uMVP;
uniform mat4 uModel;
uniform float uRadius;
in vec3 aPos;
out vec3 vN;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos * uRadius, 1.0);
  vWorld = w.xyz;
  vN = mat3(uModel) * aPos;
  gl_Position = uMVP * w;
}
`;

/** 大气辉光壳层片元：正面加性菲涅尔（背面剔除在管线侧开启） */
const GLOW_FRAG = `precision highp float;
uniform vec3 uCamPos;
uniform vec3 uStarPos;
uniform vec3 uCenter;    // 行星中心（世界）
uniform vec3 uTint;
uniform float uPower;    // 强度
uniform float uHdr;
in vec3 vN;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 2.6);
  vec3 L = normalize(uStarPos - uCenter);
  float day = 0.30 + 0.70 * max(dot(normalize(vWorld - uCenter), L), 0.0);
  float a = fres * day * uPower;
  fragColor = vec4(uTint * a * uHdr, a);
}
`;

/** 环面（气态行星环 / 轨道站环）顶点着色器：aPos 为环局部 XZ 平面坐标 */
const RING_VERT = `
uniform mat4 uMVP;
uniform mat4 uModel;
in vec3 aPos;
out vec3 vLocal;
out vec3 vWorld;
void main() {
  vLocal = aPos;
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  gl_Position = uMVP * w;
}
`;

/** 环面片元：uMode 0=冰晶行星环（径向密度带 + 环缝 + 行星本影遮挡）/
 * 1=发光轨道站环（角向信标调制，加性） */
const RING_FRAG = `precision highp float;
precision highp int;
` + GLSL_HASH + GLSL_NOISE + GLSL_FBM + `
uniform vec3 uStarPos;
uniform vec3 uPlanetPos;   // 环所属行星中心（世界）
uniform float uPlanetR;    // 行星本体半径（世界）
uniform float uInner;      // 环内缘（环局部单位）
uniform float uOuter;      // 环外缘（环局部单位）
uniform float uSeed;
uniform float uTime;
uniform int uMode;         // 0=冰晶行星环 1=轨道站环
uniform float uHdr;
in vec3 vLocal;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  float r = length(vLocal.xz);
  float t = clamp((r - uInner) / max(uOuter - uInner, 1e-4), 0.0, 1.0);
  if (uMode == 0) {
    // 冰晶环：径向 fbm 密度带 + 周期环缝 + 内外缘包络
    float n = fbm2D(vec2(t * 7.0 + uSeed * 11.0, uSeed * 3.7));
    float dens = 0.55 + 0.45 * n;
    dens *= smoothstep(0.06, 0.16, abs(fract(t * 4.7 + uSeed) - 0.5));
    dens *= smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.82, 1.0, t));
    // 行星本影：环点 → 恒星射线与行星球的最近距离
    vec3 toStar = normalize(uStarPos - vWorld);
    vec3 oc = uPlanetPos - vWorld;
    float proj = dot(oc, toStar);
    float perp = length(oc - toStar * proj);
    float shadow = (proj > 0.0)
      ? mix(0.15, 1.0, smoothstep(uPlanetR * 0.9, uPlanetR * 1.25, perp))
      : 1.0;
    vec3 ice = mix(vec3(0.55, 0.60, 0.66), vec3(0.86, 0.89, 0.93), n * 0.5 + 0.5);
    float alpha = clamp(dens, 0.0, 1.0) * 0.78;
    fragColor = vec4(ice * dens * shadow * uHdr, alpha);
  } else {
    // 轨道站环：细发光带 + 角向信标随时间旋转（缓慢自转的视觉提示）
    float core = exp(-pow((t - 0.5) * 7.0, 2.0));
    float beacon = 0.75 + 0.25 * sin(atan(vLocal.z, vLocal.x) * 10.0 - uTime * 2.4);
    vec3 col = vec3(0.55, 0.85, 1.0) * core * beacon * 1.6;
    fragColor = vec4(col * uHdr, core);
  }
}
`;

/** 线段/舰船三角共用顶点着色器（aT 供虚线分度） */
const LINE_VERT = `
uniform mat4 uMVP;
in vec3 aPos;
in float aT;
out float vT;
void main() {
  vT = aT;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

/** 线段片元：实线（uDashFreq<=0.5）或沿 aT 行进的虚线 */
const LINE_FRAG = `precision highp float;
uniform vec4 uColor;
uniform float uDashFreq;
uniform float uTime;
uniform float uHdr;
in float vT;
out vec4 fragColor;
void main() {
  if (uDashFreq > 0.5) {
    float d = fract(vT * uDashFreq - uTime * 0.45);
    if (d > 0.58) discard;
  }
  fragColor = vec4(uColor.rgb * uHdr, uColor.a);
}
`;

/** 深空背景：视线方向晶格星点（随相机 yaw 正确旋转）+ 径向渐变 */
const BG_VERT = `
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const BG_FRAG = `precision highp float;
` + GLSL_HASH + `
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uAspect;
uniform float uTime;
uniform float uHdr;
in vec2 vUV;
out vec4 fragColor;

// 方向晶格星点层（三层密度中取两层；确定性 hash，无随机源）
vec3 starLayer(vec3 dir, float cells, float seed) {
  vec3 q = dir * cells;
  vec3 id = floor(q);
  vec3 fq = fract(q) - 0.5;
  float h1 = hash31(id + seed);
  float h2 = hash31(id + seed + 31.0);
  float h3 = hash31(id + seed + 57.0);
  vec3 off = (vec3(h1, h3, h2) - 0.5) * 0.7;
  float dd = length(fq - off);
  float star = 1.0 - smoothstep(0.0, 0.08, dd);
  float mag = pow(h2, 12.0) * 1.6 + pow(h1, 40.0) * 8.0;
  vec3 tint = mix(vec3(1.0, 0.85, 0.68), vec3(0.75, 0.85, 1.0), hash31(id + seed + 91.0));
  float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h1 * 2.0) + h2 * 40.0);
  return tint * star * mag * tw;
}

void main() {
  vec2 uv = (vUV - 0.5) * 2.0;
  vec3 dir = normalize(uCamFwd + uCamRight * (uv.x * uAspect * 0.4663) + uCamUp * (uv.y * 0.4663));
  vec3 col = mix(vec3(0.030, 0.045, 0.075), vec3(0.010, 0.016, 0.030),
    smoothstep(0.0, 1.1, length(uv)));
  col += starLayer(dir, 24.0, 11.0) + starLayer(dir, 61.0, 173.0) * 0.6;
  fragColor = vec4(col * uHdr, 1.0);
}
`;

/** 离屏目标上采样（黑洞半分辨率放大 / 日冕小目标合成） */
const BLIT_VERT = `
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const BLIT_FRAG = `precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, vUV);
}
`;

/* ========================= 程序化网格构建（确定性，无随机源） ========================= */

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * 正二十面体细分球（索引化）。subdiv=3 → 642 顶点 / 1280 三角。
 * 返回 { positions: Float32Array, indices: Uint16Array }；单位球法线 = 顶点坐标。
 */
function buildIcosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize3);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = cache.get(key);
      if (m === undefined) {
        const va = verts[a];
        const vb = verts[b];
        m = verts.length;
        verts.push(normalize3([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
        cache.set(key, m);
      }
      return m;
    };
    const next = [];
    for (const f of faces) {
      const a = mid(f[0], f[1]);
      const b = mid(f[1], f[2]);
      const c = mid(f[2], f[0]);
      next.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  const indices = new Uint16Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }
  return { positions, indices };
}

/**
 * XZ 平面圆环面（非索引三角带）。返回 Float32Array 位置。
 * @param {number} seg 圆周分段
 * @param {number} inner 内缘半径（局部单位）
 * @param {number} outer 外缘半径（局部单位）
 * @param {number} y 环面高度
 */
function buildAnnulusPositions(seg, inner, outer, y = 0) {
  const arr = new Float32Array(seg * 6 * 3);
  let p = 0;
  const push = (x, yy, z) => { arr[p++] = x; arr[p++] = yy; arr[p++] = z; };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU;
    const a1 = ((i + 1) / seg) * TAU;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    // 两三角：(inner,a0)-(outer,a0)-(inner,a1) 与 (outer,a0)-(outer,a1)-(inner,a1)
    push(c0 * outer, y, s0 * outer); push(c0 * inner, y, s0 * inner); push(c1 * inner, y, s1 * inner);
    push(c0 * outer, y, s0 * outer); push(c1 * inner, y, s1 * inner); push(c1 * outer, y, s1 * outer);
  }
  return arr;
}

/**
 * 脉冲星磁层合并网格（非索引）：对顶双锥喷流（r=0.35|y|，y∈[-1,1]，
 * 磁轴 = 局部 +Y，PULSAR_FRAG 网格约定）+ 赤道激波环（0.8..1.0，y≈0）。
 * 返回 { positions: Float32Array, normals: Float32Array }
 */
function buildPulsarMesh() {
  const SEG = 26;
  const ROWS = 9;
  const pos = [];
  const nor = [];
  const pushTri = (a, b, c, n) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  };
  for (const side of [1, -1]) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * TAU;
      const a1 = ((i + 1) / SEG) * TAU;
      for (let k = 0; k < ROWS; k++) {
        const y0 = k / ROWS;
        const y1 = (k + 1) / ROWS;
        const r0 = 0.35 * y0 + 0.015;
        const r1 = 0.35 * y1 + 0.015;
        const v = (r, a, y) => [Math.cos(a) * r, side * y, Math.sin(a) * r];
        const n = (a) => normalize3([Math.cos(a) * 0.96, side * 0.28, Math.sin(a) * 0.96]);
        pushTri(v(r0, a0, y0), v(r1, a0, y1), v(r0, a1, y0), n((a0 + a1) * 0.5));
        pushTri(v(r0, a1, y0), v(r1, a0, y1), v(r1, a1, y1), n((a0 + a1) * 0.5));
      }
    }
  }
  // 激波环（并轨进同一网格；片元按局部坐标自动区分区域）
  const ringSeg = 40;
  for (let i = 0; i < ringSeg; i++) {
    const a0 = (i / ringSeg) * TAU;
    const a1 = ((i + 1) / ringSeg) * TAU;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const up = [0, 1, 0];
    pushTri([c0 * 1.0, 0, s0 * 1.0], [c0 * 0.8, 0, s0 * 0.8], [c1 * 0.8, 0, s1 * 0.8], up);
    pushTri([c0 * 1.0, 0, s0 * 1.0], [c1 * 0.8, 0, s1 * 0.8], [c1 * 1.0, 0, s1 * 1.0], up);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor) };
}

/**
 * 圆弧线段（GL_LINES 顶点对，带 aT 弧长参数 0..1，供虚线 discard）。
 * @param {number} seg 分段数
 * @param {number} span 弧总角（弧度）
 */
function buildArcLines(seg, span) {
  const arr = new Float32Array(seg * 2 * 4);
  let p = 0;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg;
    const t1 = (i + 1) / seg;
    const a0 = t0 * span;
    const a1 = t1 * span;
    arr[p++] = Math.cos(a0); arr[p++] = 0; arr[p++] = Math.sin(a0); arr[p++] = t0;
    arr[p++] = Math.cos(a1); arr[p++] = 0; arr[p++] = Math.sin(a1); arr[p++] = t1;
  }
  return arr;
}

/** FNV-1a 字符串哈希 → [0,1)（确定性场景种子；禁用全局随机源） */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** hex(#rgb/#rrggbb) → [r,g,b] 线性 0..1（解析失败回退 accent 青） */
function hexToRGB(hex) {
  let h = String(hex || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return [0.31, 0.847, 0.91];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ========================= System3D ========================= */

export class System3D {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例（CanvasManager.glc 或
   *        SystemRenderer 发现路径自建；资源登记进该实例清册，随上下文统一回收）
   * @param {number} tier LOD 档位 1|2（tier3 时调用方整体退化为 2D，不会构成本类）
   */
  constructor(glc, tier = 1) {
    if (!glc || !glc.gl) throw new Error('[System3D] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    this.tier = tier === 2 ? 2 : 1;
    /** @type {{entries:Object[], count:number, ...相机缓存}|null} 最近一帧拾取缓存 */
    this.pickData = null;

    // 舰队动态缓冲数据（pos3 + t1 × 3 顶点）—— 必须先于 _buildResources 分配
    this._fleetData = new Float32Array(FLEET_MAX * 3 * 4);

    this._incCos = Math.cos(ORBIT_INCLINE);
    this._incSin = Math.sin(ORBIT_INCLINE);
    this._coronaRes = this.tier === 2 ? CORONA_RES_LOW : CORONA_RES_FULL;
    this._coronaTarget = null;   // { texture, fbo, width, height }
    this._bhTarget = null;       // tier2 黑洞半分辨率目标（按场景尺寸惰性重建）
    this._bhTargetW = 0;
    this._bhTargetH = 0;

    this._buildResources();

    // —— 零分配草稿矩阵/向量（渲染循环内不产生新数组） ——
    this._s = {
      proj: mat4(), view: mat4(), vp: mat4(), vpPick: mat4(), vm: mat4(),
      model: mat4(), mA: mat4(), mB: mat4(), mC: mat4(), mD: mat4(),
      nm: new Float32Array(9),
      eye: new Float32Array(3),
      right: new Float32Array(3),
      up: new Float32Array(3),
      fwd: new Float32Array(3),
      clip: new Float32Array(4),
      pt4: new Float32Array(4),   // mat4MulVec4 输入（须 4 分量）
      tmp3: new Float32Array(3),
      bhBasis: new Float32Array(9),
      starSeed: 0.37,
    };

    // —— 行星布局缓存（复用对象，避免逐帧分配） ——
    this._pl = [];               // { id, world, radius, cat, colony, selected, orbitR, seed, name }
    this._plCount = 0;
    // —— 拾取条目池 ——
    this._entries = [];
    this._entryCount = 0;
  }

  /** 切换 LOD 档位（1|2）；档位变化时重建日冕离屏目标分辨率 */
  setTier(t) {
    const v = t === 2 ? 2 : 1;
    if (v === this.tier) return;
    this.tier = v;
    this._rebuildCoronaTarget(v === 2 ? CORONA_RES_LOW : CORONA_RES_FULL);
  }

  /**
   * 绘制一帧三维恒星系场景（在 beginGLFrame()/post.beginScene() 绑定场景 FBO 之后调用）。
   * @param {WebGL2RenderingContext} gl
   * @param {number} width 场景目标物理像素宽
   * @param {number} height 场景目标物理像素高
   * @param {object} data SystemRenderer.render 的 data
   * @param {object} opts { time, reducedEffects, selectedPlanetId, yaw, hdrRange, sceneFbo }
   *        sceneFbo：场景帧缓冲句柄（日冕/黑洞离屏 pass 之后须重绑）
   */
  frame(gl, width, height, data, opts = {}) {
    const s = this._s;
    const time = Number(opts.time) || 0;
    const reduced = !!opts.reducedEffects;
    const sTime = reduced ? time * 0.4 : time; // 减少动效：着色器动画时间减速
    const hdrRange = Number(opts.hdrRange) || 1;
    this._hdr = 1 / Math.max(1, hdrRange);     // 自有着色器预除系数
    this._sceneFbo = opts.sceneFbo != null ? opts.sceneFbo : null;
    this._sceneW = width;
    this._sceneH = height;

    const star = (data && data.system && data.system.star) || {};
    const typeId = star.typeId || 'yellowDwarf';
    const planets = (data && data.system && Array.isArray(data.system.planets))
      ? data.system.planets : [];
    const tick = Number((data && data.tick) || 0);
    const selected = opts.selectedPlanetId || null;
    const starType = STAR_TYPE[typeId] != null ? STAR_TYPE[typeId] : 0;
    const isBH = typeId === 'blackHole';
    const starR = STAR_R[typeId] != null ? STAR_R[typeId] : 0.30;
    // 场景确定性种子（同星系恒定；无任何全局随机源）
    let seedSrc = String(typeId || '');
    for (let i = 0; i < planets.length; i++) {
      seedSrc += `|${(planets[i] && planets[i].id) || i}`;
    }
    s.starSeed = hashSeed(seedSrc);

    // —— 布局与相机 ——
    this._layout(planets, tick, time, selected);
    const n = Math.max(1, planets.length);
    const rMax = ORBIT_BASE + Math.max(0, n - 1) * ORBIT_STEP + 0.55;
    const aspect = width / Math.max(1, height);
    const halfY = CAM_FOV / 2;
    const halfX = Math.atan(Math.tan(halfY) * aspect);
    // 黑洞星系：专用低角度运镜（吸积盘近景，Interstellar 式构图）；
    // 盘世界半径 = 6.2 × BH_RS_WORLD，相机略高于盘面并保持完整透镜环入画
    const isBHCam = typeId === 'blackHole';
    const camPitch = isBHCam ? 0.24 : CAM_PITCH;
    // 黑洞：固定世界距离 7.0 → 11.7 RS，保证吸积盘（1.65..6.2 RS）完整入画
    // （修复：camRMax 为未定义标识符，场景半径即上方 rMax —— 原 GL 帧必然抛错退化 2D）
    const dist = isBHCam ? 4.6 : (rMax / Math.sin(Math.min(halfY, halfX))) * 1.06;
    const yaw = 0.55 + time * (isBHCam ? 0.008 : 0.02) + (Number(opts.yaw) || 0);
    const cp = Math.cos(camPitch);
    const sp = Math.sin(camPitch);
    s.eye[0] = dist * cp * Math.sin(yaw);
    s.eye[1] = dist * sp;
    s.eye[2] = dist * cp * Math.cos(yaw);
    mat4Perspective(s.proj, CAM_FOV, aspect, Math.max(0.02, dist * 0.02), dist + rMax * 8 + 30);
    mat4LookAt(s.view, s.eye, LOOK_ORIGIN, LOOK_UP);
    mat4Multiply(s.vp, s.proj, s.view);
    mat4Multiply(s.vpPick, s.proj, s.view); // 拾取专用 viewProj（s.vp 供各绘制层作草稿）
    // 视图基向量（列主序）：right/up/forward（forward = 观察方向）
    s.right[0] = s.view[0]; s.right[1] = s.view[4]; s.right[2] = s.view[8];
    s.up[0] = s.view[1]; s.up[1] = s.view[5]; s.up[2] = s.view[9];
    s.fwd[0] = -s.view[2]; s.fwd[1] = -s.view[6]; s.fwd[2] = -s.view[10];

    // —— 1. 深空背景（关深度） ——
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this._drawBg(gl, aspect, sTime);

    // —— 2. 恒星本体区（黑洞 → 全屏 raymarch；其余 → 日冕 + 光球 + 磁层） ——
    if (isBH) {
      this._drawBlackHole(gl, width, height, time);
    } else {
      this._drawCorona(gl, starType, starR, sTime, reduced);
      this._drawStar(gl, starType, starR, sTime);
      if (starType === 4 || starType === 5) {
        this._drawPulsarMeshes(gl, starR, sTime, reduced);
      }
    }

    // —— 3. 轨道线（黑洞路径下照画在透镜之后 → 视觉上位于透镜前方） ——
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this._drawOrbits(gl, reduced, sTime);

    // —— 4. 行星本体（不透明，写深度） ——
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this._drawPlanets(gl, sTime);

    // —— 5. 大气辉光壳层（背面剔除 + 正面加性菲涅尔，不写深度） ——
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this._drawGlows(gl);
    gl.disable(gl.CULL_FACE);

    // —— 6. 行星环（半透明）与轨道站环（加性） ——
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._drawRings(gl, 0, sTime);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._drawRings(gl, 1, sTime);

    // —— 7. 舰队三角 billboard（阵营色，α 缩放加性） ——
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this._drawFleets(gl, data, tick, time);

    // —— 8. 未解决异常：淡紫虚线信号弧（外缘） ——
    this._drawAnomaly(gl, data, planets, rMax, sTime, reduced);

    // —— 收尾状态（PostProcessor 自行管理其 pass 状态） ——
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // —— 拾取缓存（物理像素） ——
    this._cachePick(width, height, aspect, halfY);
  }

  /** 释放（API 对称占位）：资源登记在共享 glc 清册，由 CanvasManager.dispose 统一回收；
   *  绝不在此调用 glc.destroy()（会连带丢弃共享上下文）。 */
  destroy() {
    this.pickData = null;
  }

  // —————————————————————————— 内部：布局与缓存 ——————————————————————————

  /** 行星布局：orbitIndex 均分角 + tick/时间缓慢公转，倾角 20° 统一（复用对象） */
  _layout(planets, tick, time, selected) {
    const n = Math.max(1, planets.length);
    this._plCount = planets.length;
    while (this._pl.length < planets.length) {
      this._pl.push({
        id: null, world: new Float32Array(3), radius: 0.1, cat: 0,
        colony: false, selected: false, orbitR: 1, seed: 0, category: 'rocky',
      });
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i] || {};
      const e = this._pl[i];
      const orbit = Math.max(0, Number(p.orbitIndex) || 0);
      const R = ORBIT_BASE + orbit * ORBIT_STEP;
      const ang = (orbit / n) * TAU + tick * 0.0004 + time * 0.008;
      const x = Math.cos(ang) * R;
      const z = Math.sin(ang) * R;
      e.id = p.id;
      e.world[0] = x;
      e.world[1] = -z * this._incSin;
      e.world[2] = z * this._incCos;
      e.category = String(p.category || 'rocky');
      e.cat = PLANET_CAT[e.category] != null ? PLANET_CAT[e.category] : 0;
      e.radius = PLANET_R[e.category] != null ? PLANET_R[e.category] : 0.1;
      e.colony = p.colonyId != null && p.colonyId !== false;
      e.selected = !!selected && selected === p.id;
      e.orbitR = R;
      e.seed = hashSeed(p.id || `p${orbit}`);
    }
  }

  /** 拾取缓存：行星中心投影到物理像素 + 屏幕半径 + 相机基（供射线-球相交） */
  _cachePick(width, height, aspect, halfY) {
    const s = this._s;
    this._entryCount = this._plCount;
    while (this._entries.length < this._plCount) {
      this._entries.push({ id: null, sx: 0, sy: 0, rpx: 0, world: null, radius: 0 });
    }
    for (let i = 0; i < this._plCount; i++) {
      const e = this._pl[i];
      const out = this._entries[i];
      s.pt4[0] = e.world[0];
      s.pt4[1] = e.world[1];
      s.pt4[2] = e.world[2];
      s.pt4[3] = 1;
      mat4MulVec4(s.clip, s.vpPick, s.pt4);
      const w = s.clip[3];
      if (w > 0.001) {
        const ndcX = s.clip[0] / w;
        const ndcY = s.clip[1] / w;
        out.sx = (ndcX * 0.5 + 0.5) * width;
        out.sy = (0.5 - ndcY * 0.5) * height;
      } else {
        out.sx = -1e4;
        out.sy = -1e4;
      }
      const dx = e.world[0] - s.eye[0];
      const dy = e.world[1] - s.eye[1];
      const dz = e.world[2] - s.eye[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      out.rpx = Math.max(2, (e.radius / (d * Math.tan(halfY))) * (height / 2));
      out.id = e.id;
      out.world = e.world;
      out.radius = e.radius;
    }
    this.pickData = {
      width, height, aspect, tanY: Math.tan(halfY),
      eye: s.eye, right: s.right, up: s.up, fwd: s.fwd,
      entries: this._entries, count: this._entryCount,
    };
  }

  // —————————————————————————— 内部：GL 资源构建 ——————————————————————————

  _buildResources() {
    const glc = this.glc;
    const gl = this.gl;
    this._p = {};

    // —— 程序（uniform 位置一次缓存） ——
    const reg = (key, vs, fs, attrs, uniforms) => {
      const prog = glc.createProgram(vs, fs, { label: `system3d:${key}`, attributes: attrs });
      const u = {};
      for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
      this._p[key] = { prog, u };
    };
    reg('bg', BG_VERT, BG_FRAG, { aPos: 0 },
      ['uCamRight', 'uCamUp', 'uCamFwd', 'uAspect', 'uTime', 'uHdr']);
    reg('star', STAR_VERT, STAR_FRAG, { aPos: 0, aNormal: 1 },
      ['uMVP', 'uNormalMatrix', 'uTime', 'uStarType', 'uSeed']);
    reg('corona', CORONA_VERT, CORONA_FRAG, { aPos: 0 },
      ['uMVP', 'uCoronaRadius', 'uTime', 'uSeed', 'uStarType']);
    reg('pulsar', PULSAR_VERT, PULSAR_FRAG, { aPos: 0, aNormal: 1 },
      ['uMVP', 'uNormalMatrix', 'uTime', 'uSeed']);
    reg('bh', BLACKHOLE_VERT, BLACKHOLE_FRAG, { aPos: 0 },
      ['uCamPos', 'uCamBasis', 'uTime', 'uAspect']);
    reg('blit', BLIT_VERT, BLIT_FRAG, { aPos: 0 }, ['uTex']);
    reg('planet', PLANET_VERT, PLANET_FRAG, { aPos: 0, aNormal: 1 },
      ['uMVP', 'uModel', 'uNormalMatrix', 'uCamPos', 'uStarPos', 'uCategory',
        'uSeed', 'uTime', 'uColony', 'uHdr']);
    reg('glow', GLOW_VERT, GLOW_FRAG, { aPos: 0 },
      ['uMVP', 'uModel', 'uRadius', 'uCamPos', 'uStarPos', 'uCenter', 'uTint', 'uPower', 'uHdr']);
    reg('ring', RING_VERT, RING_FRAG, { aPos: 0 },
      ['uMVP', 'uModel', 'uStarPos', 'uPlanetPos', 'uPlanetR', 'uInner', 'uOuter',
        'uSeed', 'uTime', 'uMode', 'uHdr']);
    reg('line', LINE_VERT, LINE_FRAG, { aPos: 0, aT: 1 },
      ['uMVP', 'uColor', 'uDashFreq', 'uTime', 'uHdr']);

    // —— 单位四边形（CORONA/BH/BG/BLIT 共用：aPos vec2，TRIANGLE_STRIP 4 顶点） ——
    this._vaoQuad = glc.createFullscreenVAO();

    // —— 细分球（恒星/行星/大气壳共用；单位球 normal=position 同缓冲复用） ——
    const ico = buildIcosphere(3);
    this._icoCount = ico.indices.length;
    const icoPos = glc.createBuffer(ico.positions);
    const icoIdx = gl.createBuffer();
    glc._tracked.buffers.push(icoIdx);
    this._vaoSphere = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, icoPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, icoPos);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, icoIdx);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, ico.indices, g.STATIC_DRAW);
    });

    // —— 脉冲星磁层网格（喷流双锥 + 激波环，非索引） ——
    const pm = buildPulsarMesh();
    this._pulsarCount = pm.positions.length / 3;
    const pmPos = glc.createBuffer(pm.positions);
    const pmNor = glc.createBuffer(pm.normals);
    this._vaoPulsar = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, pmPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, pmNor);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, 0, 0);
    });

    // —— 气态行星环（内/外缘比例 1.5/2.7）与轨道站环（0.94/1.0 薄环） ——
    const gasRing = buildAnnulusPositions(96, 1.5 / 2.7, 1.0, 0);
    const gasPos = glc.createBuffer(gasRing);
    this._vaoGasRing = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, gasPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    });
    const stRing = buildAnnulusPositions(64, 0.94, 1.0, 0);
    const stPos = glc.createBuffer(stRing);
    this._vaoStationRing = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, stPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    });

    // —— 轨道圆环线（整圆）与异常信号弧（270° 弧） ——
    const orbitLines = buildArcLines(180, TAU);
    const orbitPos = glc.createBuffer(orbitLines);
    this._orbitVertCount = 360;
    this._vaoOrbit = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, orbitPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 16, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 1, g.FLOAT, false, 16, 12);
    });
    const arcLines = buildArcLines(96, Math.PI * 1.5);
    const arcPos = glc.createBuffer(arcLines);
    this._arcVertCount = 192;
    this._vaoArc = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, arcPos);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 16, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 1, g.FLOAT, false, 16, 12);
    });

    // —— 舰队三角动态缓冲（billboard 顶点每帧 CPU 组装） ——
    this._fleetBuf = glc.createBuffer(this._fleetData, gl.DYNAMIC_DRAW);
    this._vaoFleet = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, this._fleetBuf);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, 16, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 1, g.FLOAT, false, 16, 12);
    });

    // —— 日冕离屏目标 ——
    this._rebuildCoronaTarget(this._coronaRes);

    glc.checkError('System3D.build');
  }

  /** 重建日冕离屏目标（tier 变化时降分辨率） */
  _rebuildCoronaTarget(res) {
    const gl = this.gl;
    if (this._coronaTarget) {
      gl.deleteTexture(this._coronaTarget.texture);
      gl.deleteFramebuffer(this._coronaTarget.fbo);
      this._coronaTarget = null;
    }
    this._coronaRes = res;
    this._coronaTarget = this.glc.createFloatTarget(res, res, { linear: true });
  }

  /** 释放黑洞半分辨率目标 */
  _releaseBhTarget() {
    if (this._bhTarget) {
      this.gl.deleteTexture(this._bhTarget.texture);
      this.gl.deleteFramebuffer(this._bhTarget.fbo);
      this._bhTarget = null;
      this._bhTargetW = 0;
      this._bhTargetH = 0;
    }
  }

  // —————————————————————————— 内部：HDR 混合助手 ——————————————————————————

  /**
   * 固定着色器（无 uHdr uniform）的 HDR 预除：RGBA8 模拟模式下经
   * blendColor + GL_CONSTANT_COLOR 完成 ×(1/hdrRange)，不透明体替换写、
   * 加性体叠加写；真 HDR 模式退化为常规禁用混合 / (ONE, ONE)。
   */
  _hdrBlend(gl, additive) {
    gl.enable(gl.BLEND);
    if (this._hdr >= 0.999) {
      if (additive) {
        gl.blendFunc(gl.ONE, gl.ONE);
      } else {
        gl.disable(gl.BLEND);
        return;
      }
    } else {
      gl.blendColor(this._hdr, this._hdr, this._hdr, 1.0);
      gl.blendFunc(gl.CONSTANT_COLOR, additive ? gl.ONE : gl.ZERO);
    }
  }

  // —————————————————————————— 内部：各绘制层 ——————————————————————————

  /** 深空背景（视线方向星点 + 径向渐变；黑洞路径下被全屏 raymarch 覆盖） */
  _drawBg(gl, aspect, time) {
    const s = this._s;
    const P = this._p.bg;
    gl.useProgram(P.prog);
    gl.bindVertexArray(this._vaoQuad);
    gl.uniform3fv(P.u.uCamRight, s.right);
    gl.uniform3fv(P.u.uCamUp, s.up);
    gl.uniform3fv(P.u.uCamFwd, s.fwd);
    gl.uniform1f(P.u.uAspect, aspect);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * 日冕：面向相机 billboard（半径 = 本体 × 2.6）先绘入小分辨率离屏目标
   * （tier2 降为 128px = 细节降），再加性合成到场景；减效时经 CONSTANT_COLOR 衰减。
   */
  _drawCorona(gl, starType, starR, time, reduced) {
    if (starType === 6) return;
    const s = this._s;
    const ct = this._coronaTarget;
    if (!ct) return;
    const P = this._p.corona;
    const R = starR * CORONA_K * (reduced ? 0.9 : 1.0);
    // billboard 模型矩阵：列 = camRight·R / camUp·R / camFwd，平移 = 恒星（原点）
    s.mA[0] = s.right[0] * R; s.mA[1] = s.right[1] * R; s.mA[2] = s.right[2] * R; s.mA[3] = 0;
    s.mA[4] = s.up[0] * R; s.mA[5] = s.up[1] * R; s.mA[6] = s.up[2] * R; s.mA[7] = 0;
    s.mA[8] = s.fwd[0]; s.mA[9] = s.fwd[1]; s.mA[10] = s.fwd[2]; s.mA[11] = 0;
    s.mA[12] = 0; s.mA[13] = 0; s.mA[14] = 0; s.mA[15] = 1;
    mat4Multiply(s.vm, s.view, s.mA);
    mat4Multiply(s.vp, s.proj, s.vm);

    // —— pass 1：小目标绘制（无深度） ——
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ct.fbo);
    gl.viewport(0, 0, ct.width, ct.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.prog);
    gl.bindVertexArray(this._vaoQuad);
    gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
    gl.uniform1f(P.u.uCoronaRadius, 1.0);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uSeed, s.starSeed);
    gl.uniform1i(P.u.uStarType, starType);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // —— pass 2：加性合成回场景（tier2/减效 经 CONSTANT_COLOR 衰减） ——
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
    gl.viewport(0, 0, this._sceneW, this._sceneH);
    const k = (reduced ? 0.55 : 1.0) * (this.tier === 2 ? 0.8 : 1.0);
    const cf = Math.min(1, this._hdr * k);
    gl.enable(gl.BLEND);
    if (cf >= 0.999) {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendColor(cf, cf, cf, 1.0);
      gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE);
    }
    gl.useProgram(this._p.blit.prog);
    gl.bindVertexArray(this._vaoQuad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ct.texture);
    gl.uniform1i(this._p.blit.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** 恒星光球：细分球 + STAR_V/FR（不透明；模拟 HDR 下 (CONSTANT_COLOR, ZERO) 预除） */
  _drawStar(gl, starType, starR, time) {
    const s = this._s;
    const P = this._p.star;
    mat4TRS(s.model, 0, 0, 0, 0, this._starSeed * 6.0 + time * 0.02, 0, starR);
    mat4Multiply(s.vm, s.view, s.model);
    mat4Multiply(s.vp, s.proj, s.vm);
    s.nm[0] = s.vm[0]; s.nm[1] = s.vm[1]; s.nm[2] = s.vm[2];
    s.nm[3] = s.vm[4]; s.nm[4] = s.vm[5]; s.nm[5] = s.vm[6];
    s.nm[6] = s.vm[8]; s.nm[7] = s.vm[9]; s.nm[8] = s.vm[10];

    this._hdrBlend(gl, false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(P.prog);
    gl.bindVertexArray(this._vaoSphere);
    gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
    gl.uniformMatrix3fv(P.u.uNormalMatrix, false, s.nm);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1i(P.u.uStarType, starType);
    gl.uniform1f(P.u.uSeed, s.starSeed);
    gl.drawElements(gl.TRIANGLES, this._icoCount, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
  }

  /** 脉冲星/中子星磁层：双极喷流锥 + 激波环（磁轴 23° 倾角 + uTime 高频旋转，加性） */
  _drawPulsarMeshes(gl, starR, time, reduced) {
    const s = this._s;
    const P = this._p.pulsar;
    // M = T(0)·Ry(ωt)·Rz(23°)·S：磁轴局部 +Y 先倾斜再绕世界 Y 扫掠（灯塔效应）
    mat4TRS(s.model, 0, 0, 0, 0, time * 5.0, PULSAR_TILT, starR * PULSAR_K);
    mat4Multiply(s.vm, s.view, s.model);
    mat4Multiply(s.vp, s.proj, s.vm);
    s.nm[0] = s.vm[0]; s.nm[1] = s.vm[1]; s.nm[2] = s.vm[2];
    s.nm[3] = s.vm[4]; s.nm[4] = s.vm[5]; s.nm[5] = s.vm[6];
    s.nm[6] = s.vm[8]; s.nm[7] = s.vm[9]; s.nm[8] = s.vm[10];

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const k = reduced ? 0.6 : 1.0;
    const cf = Math.min(1, this._hdr * k);
    gl.enable(gl.BLEND);
    gl.blendColor(cf, cf, cf, 1.0);
    gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE);
    gl.useProgram(P.prog);
    gl.bindVertexArray(this._vaoPulsar);
    gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
    gl.uniformMatrix3fv(P.u.uNormalMatrix, false, s.nm);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uSeed, s.starSeed);
    gl.drawArrays(gl.TRIANGLES, 0, this._pulsarCount);
    gl.disable(gl.BLEND);
  }

  /**
   * 黑洞专屏：BLACKHOLE_V/FR 全屏 raymarch（uCamPos/uCamBasis 由相机推导，
   * 世界坐标换算到 RS 单位）。tier1 直绘场景；tier2 降为半分辨率离屏目标
   * 再线性放大（BLACKHOLE_FRAG 步数为着色器内常量，按任务书许可方案以分辨率降载）。
   */
  _drawBlackHole(gl, width, height, time) {
    const s = this._s;
    const P = this._p.bh;
    const rs = 1 / BH_RS_WORLD;
    const camBH = s.tmp3;
    camBH[0] = s.eye[0] * rs;
    camBH[1] = s.eye[1] * rs;
    camBH[2] = s.eye[2] * rs;
    // uCamBasis 列 = right / up / forward
    const b = s.bhBasis;
    b[0] = s.right[0]; b[1] = s.right[1]; b[2] = s.right[2];
    b[3] = s.up[0]; b[4] = s.up[1]; b[5] = s.up[2];
    b[6] = s.fwd[0]; b[7] = s.fwd[1]; b[8] = s.fwd[2];

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    const low = this.tier >= 2;
    let tw = width;
    let th = height;
    if (low) {
      tw = Math.max(1, width >> 1);
      th = Math.max(1, height >> 1);
      if (!this._bhTarget || this._bhTargetW !== tw || this._bhTargetH !== th) {
        this._releaseBhTarget();
        this._bhTarget = this.glc.createFloatTarget(tw, th, { linear: true });
        this._bhTargetW = tw;
        this._bhTargetH = th;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bhTarget.fbo);
      gl.viewport(0, 0, tw, th);
    }
    this._hdrBlend(gl, false);
    gl.useProgram(P.prog);
    gl.bindVertexArray(this._vaoQuad);
    gl.uniform3fv(P.u.uCamPos, camBH);
    gl.uniformMatrix3fv(P.u.uCamBasis, false, b);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uAspect, tw / Math.max(1, th));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);

    if (low) {
      // 半分辨率结果线性放大回场景（不透明星野整幅覆盖）
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
      gl.viewport(0, 0, this._sceneW, this._sceneH);
      gl.disable(gl.BLEND);
      gl.useProgram(this._p.blit.prog);
      gl.bindVertexArray(this._vaoQuad);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._bhTarget.texture);
      gl.uniform1i(this._p.blit.u.uTex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /** 轨道线：3D 圆环线段（倾角 20° 统一），选中行星轨道提亮 */
  _drawOrbits(gl, reduced, time) {
    const s = this._s;
    const P = this._p.line;
    gl.useProgram(P.prog);
    gl.uniform1f(P.u.uDashFreq, 0.0);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.bindVertexArray(this._vaoOrbit);
    for (let i = 0; i < this._plCount; i++) {
      const e = this._pl[i];
      this._orbitModel(e.orbitR);
      mat4Multiply(s.vm, s.view, s.model);
      mat4Multiply(s.vp, s.proj, s.vm);
      gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
      const a = e.selected ? 0.5 : 0.16;
      gl.uniform4f(P.u.uColor, ORBIT_RGB[0], ORBIT_RGB[1], ORBIT_RGB[2], a);
      gl.drawArrays(gl.LINES, 0, this._orbitVertCount);
    }
  }

  /** 轨道环模型矩阵 = RotX(20°)·Scale(R)（解析直写，免乘法链） */
  _orbitModel(R) {
    const m = this._s.model;
    m.fill(0);
    m[0] = R;
    m[5] = R * this._incCos;
    m[6] = R * this._incSin;
    m[9] = -R * this._incSin;
    m[10] = R * this._incCos;
    m[15] = 1;
    return m;
  }

  /** 行星本体：8 类程序化球面（uCategory 分支），不透明写深度 */
  _drawPlanets(gl, time) {
    const s = this._s;
    const P = this._p.planet;
    gl.useProgram(P.prog);
    gl.uniform3f(P.u.uCamPos, s.eye[0], s.eye[1], s.eye[2]);
    gl.uniform3f(P.u.uStarPos, 0, 0, 0);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.bindVertexArray(this._vaoSphere);
    for (let i = 0; i < this._plCount; i++) {
      const e = this._pl[i];
      // M = T·Ry(spin)·S；gasGiant 追加 20° 轴倾（T·Rz·Ry·S，与环面共轴）
      if (e.category === 'gasGiant') {
        mat4TRS(s.mA, 0, 0, 0, 0, time * 0.12 + e.seed * 9.0, 0, e.radius);
        mat4RotateZ(s.mB, ORBIT_INCLINE);
        mat4Multiply(s.mC, s.mB, s.mA);
        mat4Translate(s.mD, e.world[0], e.world[1], e.world[2]);
        mat4Multiply(s.model, s.mD, s.mC);
      } else {
        mat4TRS(s.model, e.world[0], e.world[1], e.world[2],
          0, time * 0.06 + e.seed * 9.0, 0, e.radius);
      }
      mat4Multiply(s.vm, s.view, s.model);
      mat4Multiply(s.vp, s.proj, s.vm);
      s.nm[0] = s.vm[0]; s.nm[1] = s.vm[1]; s.nm[2] = s.vm[2];
      s.nm[3] = s.vm[4]; s.nm[4] = s.vm[5]; s.nm[5] = s.vm[6];
      s.nm[6] = s.vm[8]; s.nm[7] = s.vm[9]; s.nm[8] = s.vm[10];
      gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
      gl.uniformMatrix4fv(P.u.uModel, false, s.model);
      gl.uniformMatrix3fv(P.u.uNormalMatrix, false, s.nm);
      gl.uniform1i(P.u.uCategory, e.cat);
      gl.uniform1f(P.u.uSeed, e.seed);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uColony, e.colony ? 1.0 : 0.0);
      gl.drawElements(gl.TRIANGLES, this._icoCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  /** 大气辉光壳层：GLOW 模式（管线侧背面剔除 + 加性；不写深度） */
  _drawGlows(gl) {
    const s = this._s;
    const P = this._p.glow;
    gl.useProgram(P.prog);
    gl.uniform3f(P.u.uCamPos, s.eye[0], s.eye[1], s.eye[2]);
    gl.uniform3f(P.u.uStarPos, 0, 0, 0);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.bindVertexArray(this._vaoSphere);
    for (let i = 0; i < this._plCount; i++) {
      const e = this._pl[i];
      const st = GLOW_STYLE[e.category] || GLOW_STYLE.rocky;
      mat4Translate(s.model, e.world[0], e.world[1], e.world[2]);
      mat4Multiply(s.vm, s.view, s.model);
      mat4Multiply(s.vp, s.proj, s.vm);
      gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
      gl.uniformMatrix4fv(P.u.uModel, false, s.model);
      gl.uniform1f(P.u.uRadius, e.radius * st[0]);
      gl.uniform3f(P.u.uCenter, e.world[0], e.world[1], e.world[2]);
      gl.uniform3fv(P.u.uTint, st[2]);
      gl.uniform1f(P.u.uPower, st[1]);
      gl.drawElements(gl.TRIANGLES, this._icoCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  /**
   * 环面：mode 0 = gasGiant 冰晶行星环（倾角 20°，带本影遮挡，半透明）；
   * mode 1 = 已殖民行星赤道低轨道发光轨道站环（加性）。
   */
  _drawRings(gl, mode, time) {
    const s = this._s;
    const P = this._p.ring;
    gl.useProgram(P.prog);
    gl.uniform3f(P.u.uStarPos, 0, 0, 0);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.depthMask(false);
    gl.bindVertexArray(mode === 0 ? this._vaoGasRing : this._vaoStationRing);
    for (let i = 0; i < this._plCount; i++) {
      const e = this._pl[i];
      if (mode === 0 && e.category !== 'gasGiant') continue;
      if (mode === 1 && !e.colony) continue;
      if (mode === 0) {
        // 冰晶环：T·Rz(20°)·S(planetR·2.7)；内缘 1.5/2.7（局部单位）
        mat4RotateZ(s.mB, ORBIT_INCLINE);
        mat4Translate(s.mD, e.world[0], e.world[1], e.world[2]);
        mat4TRS(s.mA, 0, 0, 0, 0, 0, 0, e.radius * 2.7);
        mat4Multiply(s.mC, s.mB, s.mA);
        mat4Multiply(s.model, s.mD, s.mC);
      } else {
        // 轨道站环：赤道低轨道（Ry 慢旋由片元信标动画承担）
        mat4TRS(s.model, e.world[0], e.world[1], e.world[2],
          0, time * 0.4 + e.seed * 6.0, 0, e.radius * 1.9);
      }
      mat4Multiply(s.vm, s.view, s.model);
      mat4Multiply(s.vp, s.proj, s.vm);
      gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
      gl.uniformMatrix4fv(P.u.uModel, false, s.model);
      gl.uniform3f(P.u.uPlanetPos, e.world[0], e.world[1], e.world[2]);
      gl.uniform1f(P.u.uPlanetR, e.radius);
      gl.uniform1f(P.u.uInner, mode === 0 ? 1.5 / 2.7 : 0.94);
      gl.uniform1f(P.u.uOuter, 1.0);
      gl.uniform1f(P.u.uSeed, e.seed);
      gl.uniform1i(P.u.uMode, mode);
      gl.drawArrays(gl.TRIANGLES, 0, mode === 0 ? 96 * 6 : 64 * 6);
    }
  }

  /** 舰队小三角：停靠环（0.6）上均布，相机 billboard（阵营色，加性） */
  _drawFleets(gl, data, tick, time) {
    const fleets = (data && Array.isArray(data.fleets)) ? data.fleets : [];
    const count = Math.min(FLEET_MAX, fleets.length);
    if (!count) return;
    const s = this._s;
    const P = this._p.line;
    const fd = this._fleetData;
    const size = 0.05;
    for (let i = 0; i < count; i++) {
      const f = fleets[i] || {};
      const ang = (i / Math.max(1, fleets.length)) * TAU + tick * 0.0004;
      const R = FLEET_RING;
      const bx = Math.cos(ang) * R;
      const bz = Math.sin(ang) * R;
      const wx = bx;
      const wy = -bz * this._incSin;
      const wz = bz * this._incCos;
      // billboard 三角（尖朝上）：tip / left / right
      const o = i * 12;
      fd[o] = wx; fd[o + 1] = wy + size * 1.25; fd[o + 2] = wz; fd[o + 3] = 0;
      fd[o + 4] = wx - s.right[0] * size * 0.9 - s.up[0] * size * 0.7;
      fd[o + 5] = wy - s.right[1] * size * 0.9 - s.up[1] * size * 0.7;
      fd[o + 6] = wz - s.right[2] * size * 0.9 - s.up[2] * size * 0.7;
      fd[o + 7] = 0;
      fd[o + 8] = wx + s.right[0] * size * 0.9 - s.up[0] * size * 0.7;
      fd[o + 9] = wy + s.right[1] * size * 0.9 - s.up[1] * size * 0.7;
      fd[o + 10] = wz + s.right[2] * size * 0.9 - s.up[2] * size * 0.7;
      fd[o + 11] = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fleetBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fd, 0, count * 12);
    gl.bindVertexArray(this._vaoFleet);
    mat4Multiply(s.vp, s.proj, s.view);
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
    gl.uniform1f(P.u.uDashFreq, 0.0);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uHdr, this._hdr);
    for (let i = 0; i < count; i++) {
      const rgb = hexToRGB(fleets[i] && fleets[i].color);
      gl.uniform4f(P.u.uColor, rgb[0], rgb[1], rgb[2], 0.95);
      gl.drawArrays(gl.TRIANGLES, i * 3, 3);
    }
  }

  /** 未解决异常：外缘淡紫虚线信号弧（行进虚线；减效时静止） */
  _drawAnomaly(gl, data, planets, rMax, time, reduced) {
    const anomalies = (data && Array.isArray(data.anomalies)) ? data.anomalies : [];
    let active = false;
    for (const a of anomalies) {
      if (a && a.state !== 'resolved') { active = true; break; }
    }
    if (!active) return;
    const s = this._s;
    const P = this._p.line;
    this._orbitModel(rMax + 0.18);
    mat4Multiply(s.vm, s.view, s.model);
    mat4Multiply(s.vp, s.proj, s.vm);
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uMVP, false, s.vp);
    gl.uniform1f(P.u.uDashFreq, 46.0);
    gl.uniform1f(P.u.uTime, reduced ? 0 : time);
    gl.uniform1f(P.u.uHdr, this._hdr);
    gl.uniform4f(P.u.uColor, ANOMALY_RGB[0], ANOMALY_RGB[1], ANOMALY_RGB[2], 0.5);
    gl.bindVertexArray(this._vaoArc);
    gl.drawArrays(gl.LINES, 0, this._arcVertCount);
  }
}
