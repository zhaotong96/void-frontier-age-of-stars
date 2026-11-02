/**
 * render/shaders/StarCoronaShader.js — 恒星光球 / 日冕 / 脉冲星磁层着色器
 * （GLSL ES 3.0 字符串，`#version 300 es` 由调用方拼接，模块内不写版本头）
 *
 * 导出六段字符串：
 *  - STAR_VERT + STAR_FRAG：光球层球体着色器（单位球网格）。
 *      顶点 uniforms = { uMVP: mat4, uNormalMatrix: mat3 }
 *      顶点输入 = { aPos: vec3（局部单位球）, aNormal: vec3（局部法线） }
 *      片元 uniforms = { uTime: float, uStarType: int, uSeed: float }
 *      varying = { vLocalPos, vNormal }
 *      uStarType: 0 yellowDwarf / 1 redDwarf / 2 blueGiant / 3 whiteDwarf /
 *                 4 neutronStar / 5 pulsar / 6 blackHole（不适用，渲染近黑圆盘）
 *      约定：uNormalMatrix 为模型视图法线矩阵（模型仅旋转+均匀缩放），
 *      视线取远场近似 V ≈ 视空间 (0,0,1)，limbdark = pow(dot(N,V), 0.45)。
 *      输出 HDR 辐射约 3.0..6.0（供 Bloom 溢出），alpha=1 不透明。
 *  - CORONA_VERT + CORONA_FRAG：面向相机的日冕公告板。
 *      顶点 uniforms = { uMVP: mat4, uCoronaRadius: float }
 *      顶点输入 = { aPos: vec2，单位四边形角点 [-1,1]²（TRIANGLE_STRIP） }
 *      约定：uMVP 的模型部分须包含"面向相机"的旋转（调用方 billboard），
 *      或直接传视空间/裁剪空间对齐的四边形顶点。
 *      片元 uniforms = { uTime: float, uSeed: float, uStarType: int, uCoronaRadius: float }
 *      varying = { vQuad }
 *      实现极坐标径向拉伸噪声 fbm(vec2(atan(p.y,p.x)*12, log(r)*3 - uTime*0.6))
 *      绘制太阳风流线与磁力线拱形日珥；辐射 HDR 约 2..5，边缘 alpha 平滑衰减；
 *      角向接缝用双纪元交叉混合消除。建议加性混合 gl.blendFunc(gl.ONE, gl.ONE)。
 *  - PULSAR_VERT + PULSAR_FRAG：绕磁轴的双极同步辐射喷流锥 + 磁层激波环
 *      （两者合并为同一着色器输出，按网格区域分别着色）。
 *      顶点与 STAR_VERT 相同（uMVP/uNormalMatrix）。
 *      片元 uniforms = { uTime: float, uSeed: float }
 *      网格约定：磁轴 = 局部 +Y。推荐网格为对顶双锥（表面 r=0.35·|y|，y∈[-1,1]，
 *      表示喷流锥体）与赤道圆环（半径 0.8..1.0，y≈0，表示激波环）；两网格用同一
 *      程序分别绘制（或合并为一张网格），片元按局部坐标自动区分区域。
 *      建议关闭面剔除并以加性混合绘制（双面叠加增强体积感）。
 *
 * 约束：顶层无副作用、不触碰 DOM；噪声工具来自 ../gl/NoiseGLSL.js。
 */

import { GLSL_HASH, GLSL_NOISE, GLSL_SIMPLEX4D, GLSL_FBM } from '../gl/NoiseGLSL.js';

/** 片元统一精度头（模块内常量） */
const PRECISION_HEAD = `
precision highp float;
precision highp int;
`;

/* ========================= 恒星光球层（STAR） ========================= */

/** 光球/脉冲星共用球体网格顶点着色器 */
const SPHERE_VERT_SRC = `
// ============ 恒星/脉冲星：单位球网格顶点着色器 ============
uniform mat4 uMVP;            // 调用方约定命名 uMVP = Projection·View·Model
uniform mat3 uNormalMatrix;   // 模型视图法线矩阵（模型仅旋转+均匀缩放）
in vec3 aPos;                 // 局部单位球顶点
in vec3 aNormal;              // 局部法线
out vec3 vLocalPos;           // 局部坐标（片元程序化采样用）
out vec3 vNormal;             // 视空间法线

void main() {
  vLocalPos = aPos;
  vNormal = uNormalMatrix * aNormal;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

export const STAR_VERT = SPHERE_VERT_SRC;

/** 光球层片元着色器 */
export const STAR_FRAG = PRECISION_HEAD + GLSL_HASH + GLSL_NOISE + GLSL_SIMPLEX4D + `
// ============ 恒星光球层片元着色器 ============
uniform float uTime;
uniform int uStarType;        // 0..6，见模块头注释
uniform float uSeed;

in vec3 vLocalPos;
in vec3 vNormal;
out vec4 fragColor;

// 星型 → 黑体基色（HDR 线性）
vec3 starTypeBase(int t) {
  if (t == 0) return vec3(2.60, 1.85, 0.85);   // yellowDwarf 暖金
  if (t == 1) return vec3(1.90, 0.50, 0.18);   // redDwarf 暗红橙
  if (t == 2) return vec3(1.05, 1.80, 3.40);   // blueGiant 电光蓝白
  if (t == 3) return vec3(1.95, 2.15, 2.55);   // whiteDwarf 惨白蓝
  if (t == 4 || t == 5) return vec3(1.40, 2.55, 3.10);   // neutronStar/pulsar 青白极亮
  return vec3(0.02, 0.02, 0.03);               // blackHole：不适用，近黑
}

// 米粒组织采样用复合自转（绕 Y 后绕 X，两层取相反角速度形成差速）
vec3 starSpin(vec3 p, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  vec3 q = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  float c2 = cos(ang * 0.37);
  float s2 = sin(ang * 0.37);
  return vec3(q.x, c2 * q.y - s2 * q.z, s2 * q.y + c2 * q.z);
}

void main() {
  vec3 p = normalize(vLocalPos);
  vec3 N = normalize(vNormal);
  float NdotV = clamp(N.z, 0.0, 1.0);          // 远场视线 V ≈ 视空间 (0,0,1)

  vec3 base = starTypeBase(uStarType);

  // —— 双层旋转 4D Simplex-Worley 米粒组织（两层不同速度/方向） ——
  vec3 p1 = starSpin(p, uTime * 0.05 + uSeed);
  vec3 p2 = starSpin(p, -uTime * 0.13 + uSeed * 2.7);
  float g1 = simplex4D(vec4(p1 * 3.2, uTime * 0.10 + uSeed));
  float g2 = simplex4D(vec4(p2 * 6.4, uTime * 0.23 + uSeed * 1.9));
  float w1 = worley3D(p1 * 4.5);               // Simplex-Worley 混合的胞腔项
  float grain = (g1 * 0.58 + g2 * 0.42) * 0.78 + (1.0 - w1) * 0.22;

  // —— 太阳黑子暗区（低频噪声阈值） ——
  float spotN = simplex4D(vec4(starSpin(p, uTime * 0.02) * 1.9, uTime * 0.015 + uSeed * 3.3));
  float spot = 1.0 - smoothstep(-0.46, -0.26, spotN);   // 低于阈值 → 黑子（严格递增边界）

  // —— 超米粒耀斑亮区（高频脊状阈值） ——
  float fl = 1.0 - abs(simplex4D(vec4(p * 8.5, uTime * 0.30 + uSeed * 5.1)));
  float flare = smoothstep(0.80, 0.96, fl);

  // —— 临边昏暗 + 边缘色球反变增亮（边缘 5% 区间色相偏移） ——
  float limbdark = pow(NdotV, 0.45);
  float edge = 1.0 - NdotV;
  float chromo = smoothstep(0.78, 0.97, edge);
  bool hot = (uStarType == 2 || uStarType == 3 || uStarType == 4 || uStarType == 5);
  vec3 chromoTint = hot ? vec3(0.45, 1.35, 2.60) : vec3(1.85, 0.42, 0.12);

  vec3 col = base * (0.82 + 0.30 * grain);
  col *= (1.0 - spot * 0.85);
  col += base * flare * 1.9;
  col *= limbdark;
  col += chromoTint * chromo * (1.1 + 0.9 * flare);

  // 中子星/脉冲星表面高频闪烁
  if (uStarType == 4 || uStarType == 5) {
    col *= 0.85 + 0.35 * sin(uTime * 21.0 + uSeed * 41.0) * sin(uTime * 6.3 + uSeed * 17.0);
  }

  // HDR 辐射 3.0..6.0（供 Bloom 溢出）
  col *= 2.4;
  if (uStarType == 6) {
    col = vec3(0.008, 0.008, 0.012);           // blackHole：不适用，近黑圆盘
  }
  fragColor = vec4(col, 1.0);
}
`;

/* ========================= 日冕公告板（CORONA） ========================= */

export const CORONA_VERT = `
// ============ 日冕：面向相机的公告板四边形顶点着色器 ============
uniform mat4 uMVP;              // 模型部分须含面向相机的旋转（调用方 billboard）
uniform float uCoronaRadius;    // 公告板世界半径
in vec2 aPos;                   // 单位四边形角点 [-1,1]^2（TRIANGLE_STRIP）
out vec2 vQuad;                 // 传给片元的公告板坐标

void main() {
  vQuad = aPos;
  gl_Position = uMVP * vec4(aPos * uCoronaRadius, 0.0, 1.0);
}
`;

export const CORONA_FRAG = PRECISION_HEAD + GLSL_HASH + GLSL_NOISE + GLSL_FBM + `
// ============ 日冕片元着色器 ============
uniform float uTime;
uniform float uSeed;
uniform int uStarType;
uniform float uCoronaRadius;    // 与顶点侧同名 uniform（同一程序共享）

in vec2 vQuad;
out vec4 fragColor;

const float CO_TAU = 6.28318530718;

// 星型 → 日冕色（HDR）
vec3 coronaTint(int t) {
  if (t == 0) return vec3(2.30, 1.55, 0.70);
  if (t == 1) return vec3(2.05, 0.70, 0.30);
  if (t == 2) return vec3(0.75, 1.55, 3.10);
  if (t == 3) return vec3(1.70, 1.95, 2.40);
  if (t == 4 || t == 5) return vec3(0.90, 2.20, 2.80);
  return vec3(0.0);
}

// 极坐标径向拉伸噪声 fbm(vec2(atan(p.y,p.x)*12, log(r)*3 - uTime*0.6))，
// 角向用双纪元交叉混合消除 atan ±π 接缝（与吸积盘同思路）
float coronaFbm(float theta, float r, float t) {
  float lr = log(max(r, 0.03));
  float yC = lr * 3.0 - t * 0.6;                  // 径向对数坐标随时间向外流动
  float u = fract(theta / CO_TAU + 0.5 + uSeed * 0.11);
  float uB = fract(u + 0.5);
  float nA = fbm2D(vec2((u - 0.5) * CO_TAU * 12.0, yC));
  float nB = fbm2D(vec2((uB - 0.5) * CO_TAU * 12.0, yC));
  return mix(nA, nB, abs(u * 2.0 - 1.0));
}

void main() {
  float r = length(vQuad);
  if (r > 1.0 || uStarType == 6) {               // 圆外 / blackHole 无日冕
    fragColor = vec4(0.0);
    return;
  }
  float theta = atan(vQuad.y, vQuad.x);
  vec3 tint = coronaTint(uStarType);

  // 太阳风流线：极坐标径向拉伸噪声阈值化
  float n = coronaFbm(theta, r, uTime);
  float stream = smoothstep(0.02, 0.62, n);

  // 磁力线拱形日珥：角向周期拱 + 径向窗口（聚在 limb 一带）
  float arch = pow(max(sin(theta * 3.0 + n * 2.6 + uSeed * 6.28), 0.0), 5.0);
  arch *= smoothstep(0.30, 0.55, r) * (1.0 - smoothstep(0.72, 0.95, r));

  // 辉光包络：内圈致密亮核 + 流线延伸 + 日珥
  float glow = 1.05 * exp(-r * 2.6) + stream * 0.85 * exp(-r * 1.5) + arch * 0.75;

  float fade = 1.0 - smoothstep(0.74, 1.0, r);   // 边缘 alpha 平滑衰减
  vec3 col = tint * glow * (1.8 + 0.5 * sin(uTime * 0.7 + uSeed * 9.0));
  float alpha = clamp(glow, 0.0, 1.0) * fade;
  fragColor = vec4(col * fade, alpha);           // 预乘形式；建议加性混合
}
`;

/* ========================= 脉冲星磁层（PULSAR） ========================= */

export const PULSAR_VERT = SPHERE_VERT_SRC;

export const PULSAR_FRAG = PRECISION_HEAD + `
// ============ 脉冲星：双极喷流锥 + 磁层激波环片元着色器 ============
// 网格约定：磁轴 = 局部 +Y。喷流锥 = 对顶双锥（表面 r=0.35·|y|，y∈[-1,1]）；
// 激波环 = 赤道圆环（半径 0.8..1.0，y≈0）。同一程序可先后绘制两网格。
uniform float uTime;
uniform float uSeed;

in vec3 vLocalPos;
in vec3 vNormal;
out vec4 fragColor;

void main() {
  vec3 p = vLocalPos;
  float ax = abs(p.y);                 // 0 赤道 → 1 极尖
  float rad = length(p.xz);
  float ang = atan(p.z, p.x);

  // —— 双极同步辐射喷流锥：锥体内沿轴向渐变 HDR 青白 ——
  float coneR = 0.35 * ax + 0.03;      // 锥体半径随轴向距离线性展开
  float ratio = rad / max(coneR, 0.001);
  float core = 1.0 - smoothstep(0.30, 0.95, ratio);          // 锥体内充实度
  float sr = rad / (0.14 * ax + 0.03);
  float spine = exp(-sr * sr);                               // 中轴亮脊
  float axial = pow(clamp(1.0 - ax, 0.0, 1.0), 0.55);        // 根部亮 → 尖端衰减
  float helix = 0.68 + 0.32 * sin(ang * 3.0 + ax * 21.0 - uTime * 14.0);   // 高频螺旋
  float flick = 0.72
    + 0.38 * pow(0.5 + 0.5 * sin(uTime * 17.0 + uSeed * 43.0), 3.0)          // 快闪烁
    + 0.18 * sin(uTime * 5.1 + uSeed * 11.0);                                // 慢脉动
  vec3 jetCol = vec3(0.62, 0.94, 1.35);
  vec3 jet = jetCol * (core * 0.8 + spine * 1.3) * axial * helix * flick * mix(5.2, 0.9, ax);

  // —— 磁层激波环：绕赤道的亮环，双束方位调制随时间旋转 ——
  float ry = p.y / 0.055;
  float ring = exp(-ry * ry)
    * smoothstep(0.52, 0.80, rad) * (1.0 - smoothstep(0.98, 1.18, rad));
  float beam = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(ang * 2.0 - uTime * 3.4 + uSeed), 2.0);
  vec3 ringCol = vec3(0.55, 0.85, 1.20) * ring * beam * 3.1;

  vec3 col = jet + ringCol;
  float alpha = clamp(dot(col, vec3(0.333)), 0.0, 1.0);
  fragColor = vec4(col, alpha);        // 建议加性混合 gl.ONE, gl.ONE
}
`;
