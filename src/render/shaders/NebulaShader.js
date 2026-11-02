/**
 * render/shaders/NebulaShader.js — 体积星云 / 超新星遗迹激波壳层着色器
 * （GLSL ES 3.0 字符串，`#version 300 es` 由调用方拼接，模块内不写版本头）
 *
 * 导出四段字符串：
 *  - NEBULA_VERT + NEBULA_FRAG：全屏/大四边形体积星云。
 *      顶点输入 = { aPos: vec2（NDC 角点 [-1,1]²，TRIANGLE_STRIP） }，直接透传裁剪空间；
 *      varying = { vUV ∈ [-1,1]（NDC，用于逆投影重建射线，不做纵横校正） }
 *      片元 uniforms = { uTime: float, uCamPos: vec3, uInvViewProj: mat4,
 *                        uOrigin: vec3（星云中心，世界坐标）, uScale: float,
 *                        uHue: float, uSteps: int }
 *      约定：uCamPos 与 uInvViewProj 必须来自同一相机；uScale 为星云世界半径基准
 *      （包围球半径取 1.35·uScale）；uSteps 为步进数 LOD（未设置/≤0 时默认 24，
 *      有效范围 clamp 到 8..48）。uHue 为色相微调弧度。
 *      实现：射线步进采样世界空间 3D fBm（5 八度）+ 域扭曲
 *      （warp = 0.6·vec3(fbm,fbm,fbm)），H-II 粉紫 vec3(2.4,0.5,1.6) 与青蓝电离区
 *      混色的发射加性累积；暗星云尘埃带独立通道以比尔-朗伯消光 exp(-density·k)
 *      遮蔽背景；输出预乘 alpha（建议 gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)）。
 *  - SUPERNOVA_VERT + SUPERNOVA_FRAG：球面超新星遗迹激波壳层（单位球网格）。
 *      顶点 uniforms = { uMVP: mat4, uNormalMatrix: mat3 }（约定同恒星模块）
 *      顶点输入 = { aPos: vec3 }（aNormal 可不绑定，未使用）
 *      varying = { vLocalPos, vViewDir, vRayLocal }
 *      片元 uniforms = { uTime: float, uSeed: float }
 *      实现：vLocalPos 单位球入射点、远场平行视线沿弦步进；激波薄壳
 *      shell = exp(-((r-0.78)/0.16)²)；fbmFilaments 脊状丝状结构；
 *      [O III] 青蓝 vec3(0.25,2.8,3.6) 与 H-Alpha 品红 vec3(4.2,0.45,1.35) 双色交织；
 *      菲涅尔 rim 增亮；中心致密残骸随时间闪烁。建议加性混合 gl.ONE, gl.ONE。
 *
 * 约束：顶层无副作用、不触碰 DOM；噪声工具来自 ../gl/NoiseGLSL.js。
 */

import { GLSL_HASH, GLSL_NOISE, GLSL_FBM } from '../gl/NoiseGLSL.js';

/** 片元统一精度头（模块内常量） */
const PRECISION_HEAD = `
precision highp float;
precision highp int;
`;

/* ========================= 体积星云（NEBULA） ========================= */

export const NEBULA_VERT = `
// ============ 体积星云：全屏/大四边形顶点着色器 ============
in vec2 aPos;             // NDC 角点 [-1,1]^2（TRIANGLE_STRIP）
out vec2 vUV;             // NDC 坐标（逆投影用，不做纵横校正）

void main() {
  vUV = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const NEBULA_FRAG = PRECISION_HEAD + GLSL_HASH + GLSL_NOISE + GLSL_FBM + `
// ============ 体积星云片元着色器 ============
uniform float uTime;
uniform vec3 uCamPos;
uniform mat4 uInvViewProj;
uniform vec3 uOrigin;     // 星云中心（世界坐标）
uniform float uScale;     // 星云世界半径基准
uniform float uHue;       // 色相微调（弧度）
uniform int uSteps;       // 步进数 LOD（默认 24，clamp 8..48）

in vec2 vUV;
out vec4 fragColor;

// 3 八度轻量 fBm（域扭曲专用，复用 NGL_R3 旋转去网格痕）
float nebFbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * simplex3D(p);
    p = NGL_R3 * p * 2.02;
    amp *= 0.5;
  }
  return sum * 1.14;
}

// YIQ 色相旋转（uHue 弧度）
vec3 nebHueShift(vec3 c, float a) {
  const vec3 Yk = vec3(0.299, 0.587, 0.114);
  const vec3 Ik = vec3(0.596, -0.274, -0.322);
  const vec3 Qk = vec3(0.211, -0.523, 0.312);
  float y = dot(c, Yk);
  float ci = dot(c, Ik);
  float cq = dot(c, Qk);
  float cs = cos(a);
  float sn = sin(a);
  float i2 = ci * cs - cq * sn;
  float q2 = ci * sn + cq * cs;
  return y * Yk + i2 * Ik + q2 * Qk;
}

void main() {
  // 由逆视图投影矩阵重建世界射线（近/远平面两点各一次 w 除）
  vec4 q0 = uInvViewProj * vec4(vUV, -1.0, 1.0);
  vec4 q1 = uInvViewProj * vec4(vUV, 1.0, 1.0);
  vec3 ro = uCamPos;
  vec3 rd = normalize((q1.xyz / q1.w) - (q0.xyz / q0.w));

  // 包围球（半径 1.35·uScale）求交
  float R = uScale * 1.35;
  vec3 oc = ro - uOrigin;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - R * R;
  float disc = b * b - cc;
  if (disc <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  float sq = sqrt(disc);
  float tN = max(-b - sq, 0.0);
  float tF = -b + sq;
  if (tF <= tN) {
    fragColor = vec4(0.0);
    return;
  }

  int steps = uSteps > 0 ? min(uSteps, 48) : 24;   // LOD：uSteps 可降档
  if (steps < 8) {
    steps = 8;
  }
  float dt = (tF - tN) / float(steps);
  float t = tN + dt * hash21(gl_FragCoord.xy);     // 抖动起始相位去条带

  vec3 col = vec3(0.0);
  float trans = 1.0;                               // 比尔-朗伯透过率
  float stepQ = dt / max(uScale, 0.0001);          // 归一化空间步长（尺度无关）

  for (int k = 0; k < 48; k++) {
    if (k >= steps || trans < 0.015) {
      break;
    }
    vec3 wp = ro + rd * t;
    vec3 q = (wp - uOrigin) / uScale;              // 归一化星云空间
    float rr = length(q);

    // 域扭曲：p += 0.6·vec3(fbm(p+off1), fbm(p+off2), fbm(p+off3))
    vec3 wq = q * 1.7 + vec3(0.0, uTime * 0.010, 0.0);
    vec3 warp = 0.6 * vec3(
      nebFbm3(wq + vec3(0.0, 1.7, 3.1)),
      nebFbm3(wq + vec3(5.2, 0.3, 8.4)),
      nebFbm3(wq + vec3(9.1, 7.7, 0.5))
    );
    float base = fbm3D(q * 2.1 + warp);            // 5 八度主密度
    float dens = smoothstep(0.02, 0.58, base) * (1.0 - smoothstep(0.55, 1.05, rr));

    // 暗星云尘埃带（独立通道，消光更强）
    float dust = smoothstep(0.15, 0.62,
      nebFbm3(q * 3.3 + warp * 0.5 + vec3(13.7, 4.2, 9.9)));

    if (dens > 0.002 || dust > 0.002) {
      // H-II 粉紫 与 青蓝电离区 混色（扭曲场驱动），再按 uHue 微调色相
      float mixF = 0.5 + 0.5 * nebFbm3(q * 1.3 + warp * 0.35 + vec3(21.0, 3.0, 7.0));
      vec3 emit = mix(vec3(2.4, 0.5, 1.6), vec3(0.35, 1.05, 2.60), mixF);
      emit = nebHueShift(emit, uHue);
      float eK = dens * 0.9 + dust * 0.10;
      col += emit * eK * stepQ * trans * 3.0;      // 发射加性累积（前向加权）
      trans *= exp(-(dens * 1.35 + dust * 3.1) * stepQ * 6.0);   // 比尔-朗伯消光
    }
    t += dt;
  }

  float alpha = 1.0 - trans;
  fragColor = vec4(col, alpha);                    // col 已前向加权 ≈ 预乘 alpha
}
`;

/* ========================= 超新星遗迹（SUPERNOVA） ========================= */

export const SUPERNOVA_VERT = `
// ============ 超新星遗迹：单位球包络顶点着色器 ============
uniform mat4 uMVP;            // 调用方约定命名 uMVP = Projection·View·Model
uniform mat3 uNormalMatrix;   // 模型视图法线矩阵（模型仅旋转+均匀缩放）
in vec3 aPos;                 // 局部单位球顶点（aNormal 可不绑定，未使用）
out vec3 vLocalPos;           // 单位球表面点（可见半球 = 射线入射点）
out vec3 vViewDir;            // 视空间球面方向（菲涅尔 rim 用，远场近似）
out vec3 vRayLocal;           // 局部空间视线方向（远场平行投影近似，指向球内）

void main() {
  vLocalPos = aPos;
  vViewDir = uNormalMatrix * normalize(aPos);
  // uNormalMatrix 为纯旋转（局部→视空间），其转置把视空间视线变换回局部空间
  vRayLocal = transpose(uNormalMatrix) * vec3(0.0, 0.0, -1.0);
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

export const SUPERNOVA_FRAG = PRECISION_HEAD + GLSL_HASH + GLSL_NOISE + GLSL_FBM + `
// ============ 超新星遗迹激波壳层片元着色器 ============
uniform float uTime;
uniform float uSeed;

in vec3 vLocalPos;
in vec3 vViewDir;
in vec3 vRayLocal;
out vec4 fragColor;

void main() {
  vec3 entry = normalize(vLocalPos);
  vec3 dir = normalize(vRayLocal);
  // 单位球穿弦长度：入射点在球面、方向向内时出口满足 |entry + t·dir| = 1 → t = -2·(entry·dir)
  float chord = -2.0 * dot(entry, dir);
  if (chord <= 0.0) {                 // 背面片元（或方向异常）不发光
    fragColor = vec4(0.0);
    return;
  }

  // 菲涅尔 rim：切向视线掠过壳层边缘时增亮
  float rim = pow(1.0 - abs(normalize(vViewDir).z), 2.0);
  float dither = hash21(gl_FragCoord.xy);

  const int NSTEP = 14;
  float stepLen = chord / float(NSTEP);
  vec3 col = vec3(0.0);
  float minR = 1.5;

  for (int k = 0; k < NSTEP; k++) {
    vec3 p = entry + dir * (stepLen * (float(k) + dither));
    float r = length(p);
    minR = min(minR, r);
    // 激波薄壳：r≈0.78、厚度 0.16 的高斯剖面
    float sd = (r - 0.78) / 0.16;
    float shell = exp(-sd * sd);
    if (shell > 0.004) {
      // 脊状丝状结构（seed 偏移 + 随时间缓慢演化）
      vec3 fp = p * 2.6 + vec3(uSeed * 7.3, uSeed * 3.1, -uSeed * 5.7)
        + vec3(0.0, uTime * 0.02, 0.0);
      float f1 = fbmFilaments(fp);
      float f2 = fbmFilaments(fp * 1.7 + vec3(31.4, 17.9, 8.8));
      float fil = pow(clamp(f1, 0.0, 1.0), 1.8);
      // [O III] 青蓝 与 H-Alpha 品红 双色交织
      vec3 cOIII = vec3(0.25, 2.80, 3.60);
      vec3 cHA = vec3(4.20, 0.45, 1.35);
      vec3 emit = mix(cOIII, cHA, smoothstep(0.30, 0.72, f2));
      col += emit * (shell * fil * stepLen * (0.7 + 1.1 * rim) * 1.6);
    }
  }

  // 中心致密残骸：射线近心通过时点亮并闪烁
  float flick = 0.55 + 0.75
    * (0.5 + 0.5 * sin(uTime * 11.0 + uSeed * 51.0))
    * (0.5 + 0.5 * sin(uTime * 4.7 + uSeed * 13.0));
  float md = minR / 0.16;
  float remnant = exp(-md * md) * flick;
  col += vec3(3.6, 3.3, 2.9) * remnant;

  float alpha = clamp(dot(col, vec3(0.333)), 0.0, 1.0);
  fragColor = vec4(col, alpha);       // 建议加性混合 gl.ONE, gl.ONE
}
`;
