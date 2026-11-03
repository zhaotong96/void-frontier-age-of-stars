/**
 * render/shaders/BlackHoleShader.js — 史瓦西黑洞光线步进着色器（GLSL ES 3.0 字符串）
 *
 * 返工 Phase R3 资产层：`#version 300 es` 由调用方在最前拼接（本模块不写版本头），
 * 片元统一头常量 PRECISION_HEAD 提供 precision highp float/int 声明。
 *
 * 导出：
 *  - BLACKHOLE_VERT：全屏四边形（TRIANGLE_STRIP 4 顶点）。
 *      in    vec2  aPos      顶点角点，[-1,1]²
 *      uniform float uAspect 宽高比 w/h
 *      out   vec2  vUV       已按 uAspect 校正的 UV ∈ [-1,1]
 *  - BLACKHOLE_FRAG：完整黑洞片元着色器。
 *      uniforms = { uCamPos: vec3, uCamBasis: mat3, uTime: float, uAspect: float }
 *      约定：uCamBasis 三列为相机 right/up/forward（forward 指向观察方向，即相机
 *      局部 -Z 在世界系的方向）；uCamPos 与 uCamBasis 必须为同一相机。
 *
 * 实现要点（返工规范）：
 *  - RS=1.0 视界；DISK_IN=1.65（ISCO）；DISK_OUT=6.2；
 *  - 吸积盘噪声 diskFbm：开普勒差速剪切 + 双纪元交叉混合（消除 atan 角向接缝、
 *    防止差速旋转造成的纹理无限卷绕）；
 *  - shadeAccretionDisk：径向衰减、多普勒束流 beaming = pow(doppler,3) 后
 *    clamp(0.15,4.2)、黑体温度梯度（内圈炽白电光蓝→中圈亮金橙→外圈深暗红）；
 *  - main：72 步 Velocity-Verlet 自适应步长 h = 0.15*clamp(r-0.45*RS,0.05,1.8)，
 *    测地线加速度 a = -1.5·RS·L²/r⁵·pos（L = cross(pos, vel)）；
 *  - 吸积盘赤道面（y=0）穿越检测：正面/背面透镜弯曲由测地线积分自然给出，
 *    光子环多次穿越（crossings≥2）时贡献衰减 0.35；
 *  - 吸收判定 r < RS；逃逸光线以弯曲后方向采样程序化星野（天然引力透镜畸变）。
 *
 * 约束：顶层无副作用、不触碰 DOM；噪声工具来自 ../gl/NoiseGLSL.js。
 */

import { GLSL_HASH, GLSL_NOISE, GLSL_FBM, GLSL_BLACKBODY } from '../gl/NoiseGLSL.js';

/** 片元统一精度头（模块内常量，调用方拼接 #version 300 es 后置于最前） */
const PRECISION_HEAD = `
precision highp float;
precision highp int;
`;

/** 片元依赖的噪声/工具片段（按 NoiseGLSL 约定顺序拼接） */
const NOISE_LIB = GLSL_HASH + GLSL_NOISE + GLSL_FBM + GLSL_BLACKBODY;

/** 全屏四边形顶点着色器 */
export const BLACKHOLE_VERT = `
// ============ 史瓦西黑洞：全屏四边形顶点着色器 ============
in vec2 aPos;             // 顶点角点 [-1,1]^2（TRIANGLE_STRIP 4 顶点）
uniform float uAspect;    // 宽高比 w/h
out vec2 vUV;             // 校正后 UV ∈ [-1,1]

void main() {
  vUV = vec2(aPos.x * uAspect, aPos.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** 黑洞片元着色器（完整实现） */
export const BLACKHOLE_FRAG = PRECISION_HEAD + NOISE_LIB + `
// ============ 史瓦西黑洞：光线步进片元着色器 ============
uniform vec3 uCamPos;     // 相机世界坐标（RS=1 单位系）
uniform mat3 uCamBasis;   // 相机姿态：列 = right / up / forward
uniform float uTime;
uniform float uAspect;

in vec2 vUV;
out vec4 fragColor;

const float RS = 1.0;          // 史瓦西半径
const float DISK_IN = 1.65;    // 吸积盘内缘（ISCO，返工规范规定值）
const float DISK_OUT = 6.2;    // 吸积盘外缘
const float BH_TAU = 6.28318530718;
const int MAX_STEPS = 72;      // Velocity-Verlet 步数上限

// ---- 吸积盘噪声：开普勒差速剪切 + 双纪元交叉混合（防纹理卷绕） ----
// 角向坐标 u ∈ [0,1) 随时间按开普勒角速度 ω ∝ r^-1.5 剪切；
// 纪元 A 以 u=0/1 为接缝，纪元 B 相位差半圈，在 A 的接缝处全权重切换到 B，
// 两纪元交叉混合后整个角向连续，且 fract 剪切不会让噪声域无限拉伸。
float diskFbm(float r, float ang, float t) {
  float omega = 2.0 * pow(r, -1.5);
  float u = fract(ang / BH_TAU + 0.5 + t * omega * 0.03);
  float uB = fract(u + 0.5);
  float radial = clamp((r - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);
  float nA = fbm3D(vec3(u * 7.0, radial * 3.2, 0.5));
  float nB = fbm3D(vec3(uB * 7.0, radial * 3.2, 0.5));
  float bw = abs(u * 2.0 - 1.0);   // u→0/1（A 接缝）处 bw→1，全用 B
  return mix(nA, nB, bw);
}

// ---- 吸积盘着色：径向衰减 + 多普勒束流 + 黑体温度梯度；返回 (HDR RGB, alpha) ----
vec4 shadeAccretionDisk(vec3 pc, float r, vec3 marchDir) {
  float ang = atan(pc.z, pc.x);
  float radial = clamp((r - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);

  // 密度：剪切噪声 + 环形纹波
  float n = diskFbm(r, ang, uTime);
  float dens = smoothstep(-0.25, 0.55, n);
  dens *= 0.72 + 0.28 * sin(radial * 42.0 + n * 5.0);
  // 径向包络：内缘软启动、外缘指数衰减
  dens *= smoothstep(0.0, 0.06, radial) * exp(-radial * 2.6);
  if (dens <= 0.003) {
    return vec4(0.0);
  }

  // 黑体温度梯度（内圈 1 → 外圈 0）：
  // 内圈炽白电光蓝 → 中圈亮金橙 → 外圈深暗红
  float temp = pow(1.0 - radial, 0.8);
  vec3 bb = blackbodyRGB(temp);

  // 多普勒束流：开普勒顺行轨道速度（与剪切方向一致：atan 角增方向 = pos×up）
  vec3 tangent = normalize(cross(pc, vec3(0.0, 1.0, 0.0)));
  float vKep = clamp(sqrt(0.5 / max(r - RS, 0.4)), 0.0, 0.86);
  vec3 vOrb = tangent * vKep;
  // 光子朝相机传播方向为 -marchDir → δ = 1/(1 - β·n̂) = 1/(1 + β·marchDir)
  float doppler = 1.0 / (1.0 + dot(vOrb, marchDir));
  float beaming = clamp(pow(clamp(doppler, 0.5, 2.1), 3.0), 0.15, 4.2);

  // 引力红化：靠近视界整体变暗
  float redshift = sqrt(clamp(1.0 - RS / r, 0.0, 1.0));
  float bright = mix(3.4, 0.32, radial) * beaming * (0.35 + 0.65 * redshift);

  return vec4(bb * dens * bright, clamp(dens * 1.5, 0.0, 1.0));
}

// ---- 逃逸光线采样程序化星野（方向已被引力透镜弯曲 → 天然透镜畸变） ----
vec3 sampleStarField(vec3 dir) {
  vec3 col = vec3(0.0);
  // 三层方向晶格星点（不同密度与亮度分布）
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float cellN = 96.0 + fl * 102.0;
    vec3 q = dir * cellN;
    vec3 id = floor(q);
    vec3 fq = fract(q) - 0.5;
    float h1 = hash31(id + vec3(fl * 17.0));
    float h2 = hash31(id + vec3(fl * 17.0 + 31.0, fl * 17.0 + 7.0, fl * 17.0 + 113.0));
    float h3 = hash31(id + vec3(fl * 17.0 + 5.0, fl * 17.0 + 71.0, fl * 17.0 + 23.0));
    vec3 off = (vec3(h1, h3, h2) - 0.5) * 0.72;   // 星点在晶胞内的偏移
    float dd = length(fq - off);
    float star = 1.0 - smoothstep(0.0, 0.12, dd);   // 小半径星点（严格递增边界）
    // 幂律亮度分布：大多数为暗星，少数亮星
    float mag = pow(h2, 9.0) * 2.4 + pow(h1, 30.0) * 30.0;
    vec3 tint = mix(vec3(1.0, 0.80, 0.62), vec3(0.72, 0.84, 1.00), h3);
    col += tint * (star * mag);
  }
  // 微弱银河带（绕固定法轴的大圆）
  float band = pow(1.0 - abs(dot(dir, normalize(vec3(0.32, 0.84, -0.44)))), 9.0);
  col += vec3(0.028, 0.036, 0.052) * band * (0.65 + 0.35 * fbm3D(dir * 3.1));
  return col;
}

// ---- 主流程：72 步 Velocity-Verlet 测地线积分 ----
void main() {
  // 屏幕空间抖动去带（uAspect 使像素网格保持各向同性）
  vec2 jit = vec2(gl_FragCoord.x / max(uAspect, 0.05), gl_FragCoord.y);
  float dither = hash21(jit) - 0.5;

  // 相机射线：vUV 已含纵横校正，竖直视场固定
  vec3 dirCam = normalize(vec3(vUV, -1.25));
  vec3 pos = uCamPos;
  vec3 vel = normalize(uCamBasis * dirCam);

  vec3 col = vec3(0.0);
  float trans = 1.0;        // 前向透过率
  int crossings = 0;        // 盘面穿越计数（光子环高阶像）
  bool captured = false;
  float escapeR = max(42.0, length(uCamPos) + 10.0);

  for (int i = 0; i < MAX_STEPS; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < RS) {                 // 吸收：落入视界
      captured = true;
      break;
    }
    if (r > escapeR) {            // 已逃逸出影响球
      break;
    }

    // 自适应步长（返工规范公式）
    float h = 0.15 * clamp(r - 0.45 * RS, 0.05, 1.8);

    // 测地线加速度 a = -1.5·RS·L²/r⁵ · pos，L = cross(pos, vel)
    vec3 L = cross(pos, vel);
    float L2 = dot(L, L);
    vec3 a1 = pos * (-1.5 * RS * L2 / (r2 * r2 * r));

    // Velocity-Verlet 半步：位置推进
    vec3 posN = pos + vel * h + a1 * (0.5 * h * h);

    // 吸积盘赤道面（y=0）穿越检测：正面/背面透镜弯曲由测地线自然给出
    if (pos.y * posN.y < 0.0) {
      float tc = pos.y / (pos.y - posN.y);
      vec3 pc = mix(pos, posN, tc);
      float rd = length(pc.xz);
      if (rd > DISK_IN && rd < DISK_OUT) {
        crossings += 1;
        vec4 dc = shadeAccretionDisk(pc, rd, vel);
        if (crossings >= 2) {
          dc.rgb *= 0.35;         // 光子环多次穿越：高阶像衰减
        }
        col += trans * dc.rgb;
        trans *= 1.0 - dc.a;
        if (trans < 0.02) {
          break;                  // 盘面已基本遮蔽后续贡献
        }
      }
    }

    // Velocity-Verlet 第二半步：速度更新
    vec3 L2v = cross(posN, vel);
    float rN2 = dot(posN, posN);
    vec3 a2 = posN * (-1.5 * RS * dot(L2v, L2v) / (rN2 * rN2 * sqrt(rN2)));
    vel += (a1 + a2) * (0.5 * h);
    pos = posN;
  }

  // 步数耗尽仍未逃逸/吸收 → 视为光子球缠绕，按吸收处理
  if (!captured && dot(pos, pos) < 2.56) {   // r < 1.6·RS
    captured = true;
  }

  if (!captured) {
    col += trans * sampleStarField(normalize(vel));
  }

  col += vec3(dither * 0.004);
  // Reinhard 输出压缩：吸积盘多普勒束流峰值 HDR 可达 ~190，在 RGBA8 回退
  // 模式下会被钳制成纯白块；x/(1+x)×2.2 保留环带结构并适配 0..2.2 输出域
  // （真 RGBA16F 管线下核心仍 >1.0，正常触发 Bloom 溢出）
  col = col / (1.0 + col) * 2.2;
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
