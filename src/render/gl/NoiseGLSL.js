/**
 * render/gl/NoiseGLSL.js — 可拼接的 GLSL ES 3.0 噪声/工具片段库（全部原创手写）
 *
 * 用途：
 *  - 供 src/render/shaders/ 下的着色器模块按需拼接，组成完整片元着色器源码；
 *  - `#version 300 es` 由调用方在最前拼接（本模块不含版本头，也不含 precision 声明，
 *    precision highp float; 由各着色器模块的统一头常量负责）。
 *
 * 拼接顺序约定（被依赖的片段必须先出现）：
 *   GLSL_HASH → GLSL_NOISE → GLSL_SIMPLEX4D → GLSL_FBM → GLSL_BLACKBODY
 *   - GLSL_NOISE / GLSL_SIMPLEX4D 依赖 GLSL_HASH 的 hash21/hash31/hash41；
 *   - GLSL_FBM 依赖 GLSL_NOISE 的 simplex2D/simplex3D 与常量 NGL_R2/NGL_R3；
 *   - GLSL_BLACKBODY 无依赖，可单独拼接。
 *
 * 命名约束：所有导出片段之间、以及与各着色器模块内部助手之间无重名冲突；
 *   片段内部私有助手统一使用 ngl / s4 前缀（nglHashU、nglQuintic、nglGrad2、
 *   nglGrad3、s4Grad），常量使用 NGL_ 前缀，可安全地同时拼接多个片段。
 *
 * 数值约定：hash* 返回 [0,1)；noise* 与 simplex* 返回约 [-1,1]；
 *   worley* 返回 [0,1]（最近特征点归一化距离）；fbm* 返回约 [-1,1]；
 *   fbmFilaments（脊状）返回 [0,1]；blackbodyRGB 返回 HDR RGB（允许 >1）。
 */

/**
 * GLSL_HASH — 32 位整型 avalanche 哈希与晶格哈希（PCG 风格，原创实现）。
 * 导出函数：hash21(vec2)、hash31(vec3)、hash41(vec4)，输入先 floor 到整数晶格。
 * 依赖：无。
 */
export const GLSL_HASH = `
// ------------------------------------------------------------------
// GLSL_HASH — 晶格哈希库（原创手写，无外部来源）
// ------------------------------------------------------------------
uint nglHashU(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

// 2D 晶格哈希：返回 [0,1)
float hash21(vec2 p) {
  ivec2 ip = ivec2(floor(p));
  uint h = uint(ip.x) * 0x9e3779b9u;
  h ^= uint(ip.y) * 0x85ebca77u;
  return float(nglHashU(h)) / 4294967296.0;
}

// 3D 晶格哈希：返回 [0,1)（双重 avalanche 增强去相关）
float hash31(vec3 p) {
  ivec3 ip = ivec3(floor(p));
  uint h = uint(ip.x) * 0x9e3779b9u;
  h ^= uint(ip.y) * 0xc2b2ae3du;
  h ^= uint(ip.z) * 0x27d4eb2fu;
  return float(nglHashU(nglHashU(h))) / 4294967296.0;
}

// 4D 晶格哈希：返回 [0,1)（双重 avalanche）
float hash41(vec4 p) {
  ivec4 ip = ivec4(floor(p));
  uint h = uint(ip.x) * 0x9e3779b9u;
  h ^= uint(ip.y) * 0x85ebca77u;
  h ^= uint(ip.z) * 0xc2b2ae3du;
  h ^= uint(ip.w) * 0x27d4eb2fu;
  return float(nglHashU(nglHashU(h))) / 4294967296.0;
}
`;

/**
 * GLSL_NOISE — 值噪声 / 单纯形噪声 / Worley 胞腔噪声 / 4D Simplex-Worley 混合。
 * 导出函数：noise2D/noise3D（值噪声）、simplex2D/simplex3D（单纯形梯度噪声）、
 *   worley2D/worley3D/worley4D（F1 胞腔距离）、noise4D（4D Simplex-Worley 混合：
 *   值噪声骨架 + worley4D 胞腔调制；真 4D 单纯形见 GLSL_SIMPLEX4D 的 simplex4D）。
 * 依赖：GLSL_HASH。
 */
export const GLSL_NOISE = `
// ------------------------------------------------------------------
// GLSL_NOISE — 值噪声 / 单纯形 / Worley（原创手写）
// ------------------------------------------------------------------
// 五次平滑曲线（C2 连续）
float nglQuintic(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// 2D 值噪声 [-1,1]
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = vec2(nglQuintic(f.x), nglQuintic(f.y));
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// 3D 值噪声 [-1,1]
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = vec3(nglQuintic(f.x), nglQuintic(f.y), nglQuintic(f.z));
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float a = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
  float b = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
  return mix(a, b, u.z) * 2.0 - 1.0;
}

// 由 [0,1) 哈希生成单位梯度向量（圆周均匀，避免查表与三角函数开销过高问题）
vec2 nglGrad2(float h) {
  float a = h * 6.28318530718;
  return vec2(cos(a), sin(a));
}

// 由 [0,1) 哈希生成单位梯度向量（球面参数化）
vec3 nglGrad3(float h) {
  float a = h * 6.28318530718;
  float z = h * 2.0 - 1.0;
  float r = sqrt(max(1.0 - z * z, 0.0));
  return vec3(r * cos(a), r * sin(a), z);
}

// 2D 单纯形梯度噪声（原创实现：斜切框架 + 哈希梯度），输出约 [-1,1]
float simplex2D(vec2 p) {
  const float F2 = 0.36602540378;   // (sqrt(3)-1)/2
  const float G2 = 0.21132486541;   // (3-sqrt(3))/6
  float s = (p.x + p.y) * F2;
  vec2 ic = floor(p + vec2(s));
  float t = (ic.x + ic.y) * G2;
  vec2 x0 = p - (ic - vec2(t));
  // 三角形单纯形顶点顺序
  vec2 o1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 x1 = x0 - o1 + vec2(G2);
  vec2 x2 = x0 - vec2(1.0) + vec2(2.0 * G2);
  vec3 w = max(vec3(0.5) - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3(0.0));
  vec3 w4 = w * w;
  w4 = w4 * w4;
  vec2 g0 = nglGrad2(hash21(ic));
  vec2 g1 = nglGrad2(hash21(ic + o1));
  vec2 g2 = nglGrad2(hash21(ic + vec2(1.0)));
  float n = dot(w4, vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2)));
  return n * 85.0;   // 经验归一化常数
}

// 3D 单纯形梯度噪声（原创实现），输出约 [-1,1]
float simplex3D(vec3 p) {
  const float F3 = 0.33333333333;   // 1/3
  const float G3 = 0.16666666667;   // 1/6
  float s = (p.x + p.y + p.z) * F3;
  vec3 ic = floor(p + vec3(s));
  float t = (ic.x + ic.y + ic.z) * G3;
  vec3 x0 = p - (ic - vec3(t));
  // 立体单纯形顶点顺序（分量排序）
  vec3 o1;
  vec3 o2;
  if (x0.x >= x0.y) {
    if (x0.y >= x0.z)      { o1 = vec3(1.0, 0.0, 0.0); o2 = vec3(1.0, 1.0, 0.0); }
    else if (x0.x >= x0.z) { o1 = vec3(1.0, 0.0, 0.0); o2 = vec3(1.0, 0.0, 1.0); }
    else                   { o1 = vec3(0.0, 0.0, 1.0); o2 = vec3(1.0, 0.0, 1.0); }
  } else {
    if (x0.y < x0.z)       { o1 = vec3(0.0, 0.0, 1.0); o2 = vec3(0.0, 1.0, 1.0); }
    else if (x0.x < x0.z)  { o1 = vec3(0.0, 1.0, 0.0); o2 = vec3(0.0, 1.0, 1.0); }
    else                   { o1 = vec3(0.0, 1.0, 0.0); o2 = vec3(1.0, 1.0, 0.0); }
  }
  vec3 x1 = x0 - o1 + vec3(G3);
  vec3 x2 = x0 - o2 + vec3(2.0 * G3);
  vec3 x3 = x0 - vec3(1.0) + vec3(3.0 * G3);
  vec4 w = max(vec4(0.6) - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4(0.0));
  vec4 w4 = w * w;
  w4 = w4 * w4;
  vec3 g0 = nglGrad3(hash31(ic));
  vec3 g1 = nglGrad3(hash31(ic + o1));
  vec3 g2 = nglGrad3(hash31(ic + o2));
  vec3 g3 = nglGrad3(hash31(ic + vec3(1.0)));
  float n = dot(w4, vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3)));
  return n * 32.0;   // 经验归一化常数
}

// 2D Worley（F1 最近特征距离，[0,1]）
float worley2D(vec2 p) {
  vec2 ic = floor(p);
  vec2 fq = p - ic;
  float d = 2.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cl = ic + g;
      vec2 o = vec2(hash21(cl), hash21(cl + vec2(311.0, 197.0)));
      d = min(d, length(g + o - fq));
    }
  }
  return clamp(d, 0.0, 1.0);
}

// 3D Worley（F1，[0,1]）
float worley3D(vec3 p) {
  vec3 ic = floor(p);
  vec3 fq = p - ic;
  float d = 2.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 cl = ic + g;
        vec3 o = vec3(
          hash31(cl),
          hash31(cl + vec3(311.0, 197.0, 113.0)),
          hash31(cl + vec3(23.0, 71.0, 7.0))
        );
        d = min(d, length(g + o - fq));
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

// 4D Worley（F1，[0,1]，3^4 = 81 邻域，成本较高，仅作工具函数使用）
float worley4D(vec4 p) {
  vec4 ic = floor(p);
  vec4 fq = p - ic;
  float d = 2.0;
  for (int a = -1; a <= 1; a++) {
    for (int b = -1; b <= 1; b++) {
      for (int c = -1; c <= 1; c++) {
        for (int e = -1; e <= 1; e++) {
          vec4 g = vec4(float(a), float(b), float(c), float(e));
          vec4 cl = ic + g;
          vec4 o = vec4(
            hash41(cl),
            hash41(cl + vec4(101.0, 57.0, 31.0, 7.0)),
            hash41(cl + vec4(233.0, 151.0, 89.0, 13.0)),
            hash41(cl + vec4(379.0, 271.0, 131.0, 17.0))
          );
          d = min(d, length(g + o - fq));
        }
      }
    }
  }
  return clamp(d, 0.0, 1.0);
}

// 4D Simplex-Worley 混合噪声（约 [-1,1]）：
// 值噪声骨架（16 角五次插值）与 worley4D 胞腔特征按 0.65/0.35 加权；
// 恒星表面等需要真 4D 单纯形时使用 GLSL_SIMPLEX4D 的 simplex4D。
float noise4D(vec4 p) {
  vec4 i = floor(p);
  vec4 f = p - i;
  vec4 u = vec4(nglQuintic(f.x), nglQuintic(f.y), nglQuintic(f.z), nglQuintic(f.w));
  float n0000 = hash41(i);
  float n1000 = hash41(i + vec4(1.0, 0.0, 0.0, 0.0));
  float n0100 = hash41(i + vec4(0.0, 1.0, 0.0, 0.0));
  float n1100 = hash41(i + vec4(1.0, 1.0, 0.0, 0.0));
  float n0010 = hash41(i + vec4(0.0, 0.0, 1.0, 0.0));
  float n1010 = hash41(i + vec4(1.0, 0.0, 1.0, 0.0));
  float n0110 = hash41(i + vec4(0.0, 1.0, 1.0, 0.0));
  float n1110 = hash41(i + vec4(1.0, 1.0, 1.0, 0.0));
  float n0001 = hash41(i + vec4(0.0, 0.0, 0.0, 1.0));
  float n1001 = hash41(i + vec4(1.0, 0.0, 0.0, 1.0));
  float n0101 = hash41(i + vec4(0.0, 1.0, 0.0, 1.0));
  float n1101 = hash41(i + vec4(1.0, 1.0, 0.0, 1.0));
  float n0011 = hash41(i + vec4(0.0, 0.0, 1.0, 1.0));
  float n1011 = hash41(i + vec4(1.0, 0.0, 1.0, 1.0));
  float n0111 = hash41(i + vec4(0.0, 1.0, 1.0, 1.0));
  float n1111 = hash41(i + vec4(1.0, 1.0, 1.0, 1.0));
  float a = mix(mix(n0000, n1000, u.x), mix(n0100, n1100, u.x), u.y);
  float b = mix(mix(n0010, n1010, u.x), mix(n0110, n1110, u.x), u.y);
  float c = mix(mix(n0001, n1001, u.x), mix(n0101, n1101, u.x), u.y);
  float d = mix(mix(n0011, n1011, u.x), mix(n0111, n1111, u.x), u.y);
  float v = mix(mix(a, b, u.z), mix(c, d, u.z), u.w);   // [0,1]
  float w = worley4D(p);
  return mix(v * 2.0 - 1.0, 1.0 - 2.0 * w, 0.35);
}
`;

/**
 * GLSL_SIMPLEX4D — 真 4D 单纯形梯度噪声 simplex4D(vec4)（原创实现：
 * 斜切框架 + 4 元素排序网络确定单纯形顶点轴序 + 4D 单位梯度哈希）。
 * 用于恒星表面米粒组织等需要时间维度平滑演化的场合。
 * 依赖：GLSL_HASH（hash41）。
 */
export const GLSL_SIMPLEX4D = `
// ------------------------------------------------------------------
// GLSL_SIMPLEX4D — 4D 单纯形梯度噪声（原创手写）
// ------------------------------------------------------------------
// 由 [0,1) 哈希构造 4D 单位梯度（双角参数化，模长恒为 1）
vec4 s4Grad(float h) {
  float t1 = 6.28318530718 * h;
  float t2 = 6.28318530718 * fract(h * 127.113);
  float t3 = 6.28318530718 * fract(h * 269.517);
  float s1 = sin(t1);
  float c1 = cos(t1);
  float s2 = sin(t2);
  float c2 = cos(t2);
  float s3 = sin(t3);
  float c3 = cos(t3);
  return vec4(c1, s1 * c2, s1 * s2 * c3, s1 * s2 * s3);
}

// 4D 单纯形梯度噪声，输出约 [-1,1]
float simplex4D(vec4 p) {
  const float F4 = 0.30901699437;   // (sqrt(5)-1)/4
  const float G4 = 0.13819660112;   // (5-sqrt(5))/20
  float s = (p.x + p.y + p.z + p.w) * F4;
  vec4 ic = floor(p + vec4(s));
  float t = (ic.x + ic.y + ic.z + ic.w) * G4;
  vec4 x0 = p - (ic - vec4(t));

  // 对 x0 四个分量做降序排序网络（5 比较器），同时追踪原始轴号；
  // 相等分量不交换（严格小于），保证角点集合在平局处仍然一致 → 连续。
  float v0 = x0.x;
  float v1 = x0.y;
  float v2 = x0.z;
  float v3 = x0.w;
  int a0 = 0;
  int a1 = 1;
  int a2 = 2;
  int a3 = 3;
  if (v0 < v1) { float tv = v0; v0 = v1; v1 = tv; int ta = a0; a0 = a1; a1 = ta; }
  if (v2 < v3) { float tv = v2; v2 = v3; v3 = tv; int ta = a2; a2 = a3; a3 = ta; }
  if (v0 < v2) { float tv = v0; v0 = v2; v2 = tv; int ta = a0; a0 = a2; a2 = ta; }
  if (v1 < v3) { float tv = v1; v1 = v3; v3 = tv; int ta = a1; a1 = a3; a3 = ta; }
  if (v1 < v2) { float tv = v1; v1 = v2; v2 = tv; int ta = a1; a1 = a2; a2 = ta; }

  // 单纯形 5 顶点（斜空间内按轴序累加单位步，再整体平移 k*G4）
  vec4 o1 = vec4(0.0);
  vec4 o2 = vec4(0.0);
  vec4 o3 = vec4(0.0);
  if (a0 == 0)      { o1.x = 1.0; }
  else if (a0 == 1) { o1.y = 1.0; }
  else if (a0 == 2) { o1.z = 1.0; }
  else              { o1.w = 1.0; }
  o2 = o1;
  if (a1 == 0)      { o2.x += 1.0; }
  else if (a1 == 1) { o2.y += 1.0; }
  else if (a1 == 2) { o2.z += 1.0; }
  else              { o2.w += 1.0; }
  o3 = o2;
  if (a2 == 0)      { o3.x += 1.0; }
  else if (a2 == 1) { o3.y += 1.0; }
  else if (a2 == 2) { o3.z += 1.0; }
  else              { o3.w += 1.0; }

  vec4 x1 = x0 - o1 + vec4(G4);
  vec4 x2 = x0 - o2 + vec4(2.0 * G4);
  vec4 x3 = x0 - o3 + vec4(3.0 * G4);
  vec4 x4 = x0 - vec4(1.0) + vec4(4.0 * G4);

  vec4 w = max(vec4(0.6) - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4(0.0));
  float w4 = max(0.6 - dot(x4, x4), 0.0);
  vec4 ww = w * w;
  ww = ww * ww;
  w4 = w4 * w4 * w4 * w4;

  vec4 g0 = s4Grad(hash41(ic));
  vec4 g1 = s4Grad(hash41(ic + o1));
  vec4 g2 = s4Grad(hash41(ic + o2));
  vec4 g3 = s4Grad(hash41(ic + o3));
  vec4 g4 = s4Grad(hash41(ic + vec4(1.0)));

  float n = dot(ww, vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3)));
  n += w4 * dot(g4, x4);
  return n * 27.0;   // 经验归一化常数
}
`;

/**
 * GLSL_FBM — 分形布朗运动叠加。
 * 导出函数：fbm2D/fbm3D（5 八度，约 [-1,1]）、fbmFilaments（脊状/丝状 multifractal，
 *   返回 [0,1]，用于吸积盘丝缕、超新星激波丝状结构）。
 * 导出常量：NGL_R2/NGL_R3（每八度旋转矩阵，去除轴对齐网格痕）。
 * 依赖：GLSL_NOISE（simplex2D/simplex3D）。
 */
export const GLSL_FBM = `
// ------------------------------------------------------------------
// GLSL_FBM — 分形叠加（原创手写）
// ------------------------------------------------------------------
const mat2 NGL_R2 = mat2(0.80, -0.60, 0.60, 0.80);
const mat3 NGL_R3 = mat3(0.36, 0.48, -0.80, -0.80, 0.60, 0.0, 0.48, 0.64, 0.60);

// 2D fBm：5 八度 simplex，输出约 [-1,1]（按幅度和归一化）
float fbm2D(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * simplex2D(p);
    p = NGL_R2 * p * 2.02;
    amp *= 0.5;
  }
  return sum / 0.96875;
}

// 3D fBm：5 八度 simplex，输出约 [-1,1]
float fbm3D(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * simplex3D(p);
    p = NGL_R3 * p * 2.02;
    amp *= 0.5;
  }
  return sum / 0.96875;
}

// 脊状（ridged）丝状 fBm：|simplex| 反相平方 + 谱权重，输出约 [0,1]
float fbmFilaments(vec3 p) {
  float sum = 0.0;
  float amp = 0.55;
  float weight = 1.0;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(simplex3D(p));
    n *= n;
    sum += n * amp * weight;
    weight = clamp(n * 2.0, 0.0, 1.0);
    p = NGL_R3 * p * 2.13;
    amp *= 0.5;
  }
  return clamp(sum, 0.0, 1.0);
}
`;

/**
 * GLSL_BLACKBODY — 黑体辐射近似色温梯度（HDR RGB，无依赖可独立拼接）。
 * 导出函数：blackbodyRGB(t)，t ∈ [0,1]：
 *   0 → 深暗红 → 0.3 炽橙红 → 0.55 亮金橙 → 0.8 炽白 → 1 电光蓝白。
 */
export const GLSL_BLACKBODY = `
// ------------------------------------------------------------------
// GLSL_BLACKBODY — 黑体色温近似梯度（原创手写，关键帧平滑混合）
// ------------------------------------------------------------------
vec3 blackbodyRGB(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c;
  if (t < 0.30) {
    c = mix(vec3(0.30, 0.03, 0.01), vec3(1.25, 0.30, 0.05), smoothstep(0.0, 0.30, t));
  } else if (t < 0.58) {
    c = mix(vec3(1.25, 0.30, 0.05), vec3(2.30, 1.45, 0.50), smoothstep(0.30, 0.58, t));
  } else if (t < 0.82) {
    c = mix(vec3(2.30, 1.45, 0.50), vec3(2.65, 2.50, 2.30), smoothstep(0.58, 0.82, t));
  } else {
    c = mix(vec3(2.65, 2.50, 2.30), vec3(1.95, 2.50, 3.70), smoothstep(0.82, 1.0, t));
  }
  return c;
}
`;
