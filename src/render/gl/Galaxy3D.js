/**
 * render/gl/Galaxy3D.js — 银河 3D 场景 GL 资源构建（R3 / WebGL2 全 3D 棒旋星系）
 *
 * 职责：为 GalaxyRenderer 承载全部 WebGL2 资源构建与绘制调用（程序 / VAO / 动态缓冲），
 * 顶层不触碰 document/window/GL（纯 JS + GLSL 字符串，可在 Node 侧安全 import）；
 * 所有 GL 调用只发生在方法内部（持有真实上下文时）。
 *
 * ── 并行模块依赖契约（运行时经非阻塞动态 import 探测，缺席即用本地回退实现） ──
 * 1) ./GalaxyParticles.js（并行工程师交付中）：
 *      generateGalaxyParticles({count, seed, worldScale}) →
 *        { positions: Float32Array(n*3), colors: Float32Array(n*3),
 *          sizes: Float32Array(n),     seeds:  Float32Array(n) }   // 世界坐标
 *      generateSupernovaSeeds(systems, worldScale) → Float32Array(systems.length)
 *    本文件按同签名导出包装函数：外部模块在场且返回形状合法时优先使用，
 *    否则回退到本地确定性实现（sin-hash，禁用随机数），接口不变。
 * 2) ../shaders/NebulaShader.js（并行工程师交付中）：
 *      导出 NEBULA_VERT / NEBULA_FRAG（全屏体积星云）与
 *      SUPERNOVA_VERT / SUPERNOVA_FRAG（超新星球壳 imposter）。
 *    约定与 PostProcessor 一致：GLSL ES 3.0 源码、不含 #version 行（GLCore 前置）。
 *    顶点属性槽位（本文件 VAO 装配基准，真实模块须保持）：
 *      loc0 aCorner vec2（单位四边形 [-1..1]，TRIANGLE_STRIP 4 顶点）
 *      loc1 iPos vec3 / loc2 iRadius float / loc3 iColor vec3 / loc4 iSeed float
 *    uniform：uView、uProj、uProjScale(vec2)、uTime(float)。
 *    外部源码若带 #version 行会被剥除后再编译。
 *
 * ── 程序清单（全部加法混合 ONE/ONE、深度写关闭，绘制顺序不影响结果） ──
 *   galaxy3d.disk    实例化粒子星系盘（40k billboard，径向高斯软斑，HDR>1）
 *   galaxy3d.nebula  全屏体积星云 raymarch（3D fBm 5 八度 + 域扭曲 + 尘埃带消光；
 *                    uSteps 由调用方按 tier 传入 24/14/0，<=0 跳过）
 *   galaxy3d.line    航路 + 垂直投影标尺线（LINES 动态缓冲）
 *   galaxy3d.sprite  星系节点核心 / 归属光晕 / 势力环（核心高斯 + 0.75 半径环带）
 *   galaxy3d.shell   超新星球壳（视图空间射线-球求交 imposter，limb 增亮）
 */

// —— 并行模块探测（非阻塞动态 import） ——
// 交付模块在场（http 直连模式）即优先采用其导出；缺席/加载失败静默回退本文件内的
// 本地确定性实现（接口不变）。刻意不用顶层 await：R1 单文件打包器把模块体封装进
// 同步工厂函数（tests/tools/build-static-bundle.mjs），await 会使 dist 构建失效；
// 动态 import 不进入其静态依赖图，file:// 单文件模式下探测 404 后同样回退本地。
let _extParticles = null;
let _extNebula = null;
function _probeExternal(spec, assign) {
  try {
    import(spec).then(assign, () => { /* 缺席：保持 null → 本地回退 */ });
  } catch (_) { /* 极老环境无动态 import：仅用本地回退 */ }
}
_probeExternal('./GalaxyParticles.js', (m) => { _extParticles = m || null; });
_probeExternal('../shaders/NebulaShader.js', (m) => { _extNebula = m || null; });

/** 策略坐标 (0..1000) → 世界坐标的缩放系数（±10 世界单位银盘） */
export const WORLD_SCALE = 0.02;
/** 星系盘粒子生成种子（确定性；世界静态，一次生成） */
const GALAXY_SEED = 20261103;
/** 粒子上限（tier 档位在此之内前缀截取绘制） */
const PARTICLE_MAX = 40000;

// —— 确定性 hash（禁用随机数） ——————————————————————————————

function fract(x) { return x - Math.floor(x); }

/** 带盐/种子的一维 hash（粒子生成用） */
function hash01s(i, salt, seed) {
  return fract(Math.sin(i * 127.1 + salt * 311.7 + seed * 0.618034) * 43758.5453);
}

/** 字符串 → [0,1) 确定性 hash（FNV-1a 混淆），供星系高度剖面 / 超新星相位使用 */
export function hashString01(str) {
  const s = String(str == null ? '' : str);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * 星系三维位置：策略 (x,y) → 世界 (x-500, y-500)*WORLD_SCALE，
 * 高度 z = hash(systemId)*±核球厚度剖面（银心厚、边缘薄，最大 ±0.56 世界单位）。
 * @param {{id:string|number, x:number, y:number}} s 快照星系
 * @param {Float32Array} [out] 复用输出 (3)
 * @returns {Float32Array} [wx, wy, wz]
 */
export function systemWorldPos(s, out) {
  const o = out || new Float32Array(3);
  if (!s) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
  const wx = ((Number(s.x) || 0) - 500) * WORLD_SCALE;
  const wy = ((Number(s.y) || 0) - 500) * WORLD_SCALE;
  const rn = Math.sqrt(wx * wx + wy * wy) / (500 * WORLD_SCALE);
  const thick = 0.055 + 0.5 * Math.exp(-Math.max(0, rn) * 2.4);
  const h01 = hashString01(s.id != null ? String(s.id) : '');
  o[0] = wx;
  o[1] = wy;
  o[2] = (h01 * 2 - 1) * thick;
  return o;
}

// —— 粒子 / 种子生成（外部模块优先，本地确定性回退） ——————————————————

/** 本地棒旋星系粒子生成：双主旋臂 + 中央棒 + 核球（核厚缘薄）+ HII 粉斑 */
function generateGalaxyParticlesLocal(params) {
  const count = Math.max(0, Math.round(Number(params && params.count) || 0));
  const worldScale = Number(params && params.worldScale) > 0 ? Number(params.worldScale) : WORLD_SCALE;
  const seedN = Math.abs(Math.round(Number(params && params.seed) || 0)) % 100000;
  const R = 500 * worldScale; // 银盘世界半径（策略 0..1000 映射）

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const rr = Math.pow(hash01s(i, 1, seedN), 0.62); // 半径分布：内密外疏
    const r = rr * R;
    let x;
    let y;
    if (rr < 0.42 && hash01s(i, 2, seedN) < 0.30) {
      // 中央棒：沿 x 轴拉长的椭球
      const bx = (hash01s(i, 3, seedN) * 2 - 1) * R * 0.34;
      const by = (hash01s(i, 4, seedN) * 2 - 1) * R * 0.10 * (1.15 - Math.abs(bx) / (R * 0.34));
      x = bx;
      y = by;
    } else {
      // 双主旋臂（自棒端起螺旋）+ 随半径放大的角向散布
      const arm = (i % 2) * Math.PI;
      const jitter = (hash01s(i, 3, seedN) * 2 - 1) * (0.10 + 0.55 * rr);
      const th = arm + Math.max(0, rr - 0.30) * 6.1 + jitter;
      const rs = r * (0.92 + hash01s(i, 4, seedN) * 0.16);
      x = Math.cos(th) * rs;
      y = Math.sin(th) * rs;
    }
    // 核球厚、边缘薄的垂直剖面（双 hash 叠加近似高斯）
    const thick = 0.055 + 0.5 * Math.exp(-rr * 2.6);
    const z = (hash01s(i, 5, seedN) + hash01s(i, 6, seedN) - 1) * thick;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // 色温：核黄 → 臂蓝白，少量 HII 粉斑；HDR 由着色器增益（颜色本身 <=1.1）
    const t = Math.min(1, Math.max(0, rr * 1.35 + (hash01s(i, 7, seedN) - 0.5) * 0.4));
    let cr = 1.0 + (0.60 - 1.0) * t;
    let cg = 0.82 + (0.74 - 0.82) * t;
    let cb = 0.55 + (1.00 - 0.55) * t;
    if (hash01s(i, 8, seedN) > 0.968) { cr = 1.05; cg = 0.42; cb = 0.55; }
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;

    // 尺寸：世界单位；少数大颗粒 + 核球增亮
    let sz = 0.018 + Math.pow(hash01s(i, 9, seedN), 3) * 0.15;
    if (rr < 0.2) sz += 0.02;
    sizes[i] = sz;
    seeds[i] = hash01s(i, 10, seedN);
  }
  return { positions, colors, sizes, seeds };
}

/** 本地超新星相位种子（与 systems 顺序对齐） */
function generateSupernovaSeedsLocal(systems) {
  const arr = Array.isArray(systems) ? systems : [];
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const id = arr[i] && arr[i].id != null ? String(arr[i].id) : String(i);
    out[i] = hashString01(`${id}:nova`);
  }
  return out;
}

/**
 * 星系盘粒子生成（包装）：并行模块在场且返回形状合法时透传，否则本地实现。
 * @param {{count?:number, seed?:number, worldScale?:number}} [params]
 * @returns {{positions:Float32Array, colors:Float32Array, sizes:Float32Array, seeds:Float32Array}}
 */
export function generateGalaxyParticles(params) {
  const ext = _extParticles;
  if (ext && typeof ext.generateGalaxyParticles === 'function') {
    try {
      const out = ext.generateGalaxyParticles(params || {});
      if (out && out.positions && out.colors && out.sizes && out.seeds) return out;
    } catch (_) { /* 外部模块异常：回退本地确定性实现 */ }
  }
  return generateGalaxyParticlesLocal(params || {});
}

/**
 * 超新星相位种子生成（包装）。
 * @param {Array<{id:string|number}>} systems
 * @param {number} [worldScale]
 * @returns {Float32Array}
 */
export function generateSupernovaSeeds(systems, worldScale) {
  void worldScale; // 契约占位参数：本地实现不依赖尺度
  const ext = _extParticles;
  const n = Array.isArray(systems) ? systems.length : 0;
  if (ext && typeof ext.generateSupernovaSeeds === 'function') {
    try {
      const out = ext.generateSupernovaSeeds(systems, worldScale);
      if (out && (out.length ?? -1) === n) return out;
    } catch (_) { /* 回退本地实现 */ }
  }
  return generateSupernovaSeedsLocal(systems);
}

// —— GLSL（本地契约回退实现；外部 NebulaShader 在场时优先生效） ————————

/** 剥除外部着色器可能自带的 #version 行（GLCore.createProgram 统一前置） */
function stripVersion(src) {
  return String(src || '').replace(/^\s*#version[^\n]*\n/, '');
}

function pickShader(ext, name, local) {
  const v = ext ? ext[name] : null;
  return typeof v === 'string' && v.length > 8 ? stripVersion(v) : local;
}

/** 全屏四边形顶点着色器（星云用，vUv [0..1]） */
const LOCAL_NEBULA_VERT = `
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * 体积星云片元：反投影生成视线，在 |z|<=HZ 薄板内 raymarch；
 * 密度 = 域扭曲(两级低频 fBm) + 5 八度 3D fBm + 对数螺旋臂偏置 + 核厚缘薄包络；
 * 尘埃带消光以光程累积 exp(-od) 作用于星云自身辐射（加法管线下不衰减既有像素）。
 */
const LOCAL_NEBULA_FRAG = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform mat4 uInvViewProj;
uniform float uTime;
uniform float uSteps;
uniform float uGain;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm2(vec3 p) {
  float s = 0.5 * vnoise(p);
  s += 0.25 * vnoise(p * 2.03 + vec3(11.7, 3.1, 7.9));
  return s / 0.75;
}
float fbm5(vec3 p) {
  float amp = 0.5;
  float s = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 5; i++) {
    s += amp * vnoise(p);
    norm += amp;
    p = p * 2.02 + vec3(7.3, 1.9, 4.7);
    amp *= 0.52;
  }
  return s / norm;
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 pn = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 pf = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 ro = pn.xyz / pn.w;
  vec3 rd = normalize(pf.xyz / pf.w - ro);

  // 远景星野：视线方向锚定的确定性 hash 点（不随时间漂移）
  vec3 col = vec3(0.0);
  vec3 cell = floor(rd * 230.0);
  float hs = hash13(cell + vec3(7.0));
  float star = smoothstep(0.9972, 0.9999, hs) * (0.25 + 0.75 * hash13(cell + vec3(19.0)));
  col += vec3(0.72, 0.8, 0.95) * star;

  // 与银河薄板 |z| <= HZ 求交
  const float HZ = 2.4;
  float t0 = 0.0;
  float t1 = 0.0;
  bool hit = true;
  if (abs(rd.z) < 1e-5) {
    hit = abs(ro.z) < HZ;
    t1 = hit ? 200.0 : 0.0;
  } else {
    float ta = (-HZ - ro.z) / rd.z;
    float tb = (HZ - ro.z) / rd.z;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
    hit = t1 > t0;
  }

  if (hit && uSteps > 0.5) {
    float dt = (t1 - t0) / uSteps;
    float t = t0 + dt * hash13(vec3(gl_FragCoord.xy, 1.0));
    float od = 0.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 28; i++) {
      if (float(i) >= uSteps) break;
      vec3 p = ro + rd * t;
      t += dt;
      float rn = length(p.xy) * 0.1;
      if (rn > 1.24 || abs(p.z) > HZ) continue;
      // 域扭曲 + 5 八度 fBm + 对数螺旋臂偏置 + 垂直包络
      vec3 w = vec3(fbm2(p * 0.4 + vec3(0.0, 0.0, uTime * 0.02)),
                    fbm2(p * 0.4 + vec3(5.2, 1.3, 9.4)),
                    fbm2(p * 0.4 + vec3(1.7, 8.1, 3.0)));
      vec3 q = p * 0.55 + (w - 0.5) * 2.6;
      float d = fbm5(q);
      float ang = atan(p.y, p.x);
      float arm = 0.5 + 0.5 * sin(ang * 2.0 - log(max(rn, 0.06)) * 4.6 + 1.7);
      d *= 0.6 + 0.6 * arm;
      float hThick = 0.09 + 0.5 * exp(-rn * 2.4);
      d *= exp(-abs(p.z) / hThick) * smoothstep(1.24, 0.4, rn) * smoothstep(0.015, 0.14, rn);
      d = smoothstep(0.3, 0.85, d);
      if (d <= 0.002) continue;
      // 尘埃带消光（自遮蔽光程）
      float du = fbm2(q * 1.9 + vec3(13.1, 3.7, 8.2));
      float dust = smoothstep(0.5, 0.78, du) * d;
      // 辐射色：核暖黄 → 外缘蓝白 + HII 粉斑
      vec3 em = mix(vec3(1.0, 0.62, 0.34), vec3(0.36, 0.55, 1.0), clamp(rn * 1.4 - 0.08, 0.0, 1.0));
      float hii = fbm2(p * 1.35 + vec3(23.0, 11.0, 5.0));
      em += vec3(1.0, 0.3, 0.48) * smoothstep(0.6, 0.85, hii) * 0.9;
      acc += em * d * exp(-od) * dt * uGain;
      od += dust * dt * 3.2;
    }
    col += acc;
  }
  fragColor = vec4(col, 1.0);
}
`;

/** 超新星球壳顶点：相机朝向 billboard 展开 + 脉冲缩放（视图空间 imposter 基准） */
const LOCAL_SUPERNOVA_VERT = `
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iPos;
layout(location = 2) in float iRadius;
layout(location = 3) in vec3 iColor;
layout(location = 4) in float iSeed;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uProjScale;
uniform float uTime;
out vec2 vCorner;
out vec3 vViewC;
out float vRadius;
out vec3 vColor;
out float vSeed;
void main() {
  float pulse = 1.0 + 0.12 * sin(uTime * 2.3 + iSeed * 6.2831853);
  float r = max(0.0001, iRadius * pulse);
  vec4 vc = uView * vec4(iPos, 1.0);
  vec4 cc = uProj * vc;
  vCorner = aCorner;
  vViewC = vc.xyz;
  vRadius = r;
  vColor = iColor;
  vSeed = iSeed;
  if (cc.w <= 0.0001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vRadius = 0.0;
    return;
  }
  gl_Position = cc + vec4(aCorner * uProjScale * r * 1.06, 0.0, 0.0);
}
`;

/** 超新星球壳片元：视图空间射线-球求交，limb 增亮 + 方位微条纹（additive） */
const LOCAL_SUPERNOVA_FRAG = `
precision highp float;
in vec2 vCorner;
in vec3 vViewC;
in float vRadius;
in vec3 vColor;
in float vSeed;
uniform float uTime;
out vec4 fragColor;
void main() {
  if (vRadius <= 0.0) { fragColor = vec4(0.0); return; }
  vec3 rd = vec3(vCorner * vRadius, vViewC.z);
  vec3 c = vec3(0.0, 0.0, vViewC.z);
  float r2 = dot(rd, rd);
  float b = dot(rd, c);
  float disc = b * b - r2 * (dot(c, c) - vRadius * vRadius);
  if (disc <= 0.0) { fragColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = (b - sq) / r2;
  if (t <= 0.0) t = (b + sq) / r2; // 相机入壳内时取后交点
  if (t <= 0.0) { fragColor = vec4(0.0); return; }
  vec3 p = rd * t;
  vec3 n = normalize(p - c);
  vec3 vdir = normalize(p);
  float facing = clamp(dot(n, -vdir), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.2);
  float band = 0.78 + 0.22 * sin(atan(n.y, n.x) * 5.0 + uTime * 1.6 + vSeed * 37.0);
  float inten = (rim * 2.6 + 0.10) * band;
  fragColor = vec4(vColor * inten, 1.0);
}
`;

// —— 星系盘粒子（实例化 billboard） ——————————————————————————————

const VERT_DISK = `
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iPos;
layout(location = 2) in float iSize;
layout(location = 3) in vec3 iColor;
layout(location = 4) in float iSeed;
uniform mat4 uViewProj;
uniform vec2 uProjScale;
uniform float uMinSize;
uniform float uSizeClamp;
out vec2 vCorner;
out vec3 vColor;
out float vSeed;
void main() {
  vec4 c = uViewProj * vec4(iPos, 1.0);
  if (c.w <= 0.0001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCorner = vec2(0.0);
    vColor = vec3(0.0);
    vSeed = 0.0;
    return;
  }
  float sz = clamp(iSize, uMinSize, c.w * uSizeClamp);
  gl_Position = c + vec4(aCorner * uProjScale * sz, 0.0, 0.0);
  vCorner = aCorner;
  vColor = iColor;
  vSeed = iSeed;
}
`;

/** 径向高斯软斑 + 亮核 + 种子闪烁（HDR 峰值 ~2.9，供 bloom 提取） */
const FRAG_DISK = `
precision highp float;
in vec2 vCorner;
in vec3 vColor;
in float vSeed;
uniform float uTime;
out vec4 fragColor;
void main() {
  float d2 = dot(vCorner, vCorner);
  float d = sqrt(d2);
  float edge = smoothstep(1.0, 0.6, d);
  float g = exp(-d2 * 5.0);
  float core = exp(-d2 * 26.0);
  float tw = 0.82 + 0.34 * sin(uTime * 1.7 + vSeed * 41.0);
  fragColor = vec4(vColor * ((g * 1.05 + core * 1.9) * tw * edge), 1.0);
}
`;

// —— 星系节点 / 归属光晕 / 势力环（实例化 billboard：核心高斯 + 环带） ————

const VERT_SPRITE = `
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iPos;
layout(location = 2) in float iSize;
layout(location = 3) in vec4 iColA;
layout(location = 4) in vec4 iColB;
uniform mat4 uViewProj;
uniform vec2 uProjScale;
uniform float uSizeClamp;
out vec2 vCorner;
out vec4 vColA;
out vec4 vColB;
void main() {
  vec4 c = uViewProj * vec4(iPos, 1.0);
  if (c.w <= 0.0001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCorner = vec2(0.0);
    vColA = vec4(0.0);
    vColB = vec4(0.0);
    return;
  }
  float sz = min(iSize, c.w * uSizeClamp);
  gl_Position = c + vec4(aCorner * uProjScale * sz, 0.0, 0.0);
  vCorner = aCorner;
  vColA = iColA;
  vColB = iColB;
}
`;

/** 环带中心 d=0.75（调用方按 目标半径/0.75 换算实例尺寸），核心为高斯软斑 */
const FRAG_SPRITE = `
precision highp float;
in vec2 vCorner;
in vec4 vColA;
in vec4 vColB;
out vec4 fragColor;
void main() {
  float d = length(vCorner);
  float edge = smoothstep(1.0, 0.8, d);
  float core = exp(-d * d * 5.5);
  float ring = exp(-pow((d - 0.75) * 9.0, 2.0));
  vec3 col = vColA.rgb * (core * vColA.a) + vColB.rgb * (ring * vColB.a);
  fragColor = vec4(col * edge, 1.0);
}
`;

// —— 航路 / 标尺线 ——————————————————————————————————————————————

const VERT_LINE = `
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

const FRAG_LINE = `
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor.rgb * vColor.a, 1.0);
}
`;

/** 解析实际生效的星云/超新星着色器（外部模块优先，本地契约回退） */
function resolveNebulaShaders() {
  return {
    NEBULA_VERT: pickShader(_extNebula, 'NEBULA_VERT', LOCAL_NEBULA_VERT),
    NEBULA_FRAG: pickShader(_extNebula, 'NEBULA_FRAG', LOCAL_NEBULA_FRAG),
    SUPERNOVA_VERT: pickShader(_extNebula, 'SUPERNOVA_VERT', LOCAL_SUPERNOVA_VERT),
    SUPERNOVA_FRAG: pickShader(_extNebula, 'SUPERNOVA_FRAG', LOCAL_SUPERNOVA_FRAG),
  };
}

// —— GL 资源容器 ——————————————————————————————————————————————————

/** 星系盘实例步长：pos3 + size1 + color3 + seed1（float） */
const DISK_STRIDE_F = 8;
/** 节点 sprite 实例步长：pos3 + size1 + colA4 + colB4（float） */
const SPRITE_STRIDE_F = 12;
/** 球壳实例步长：pos3 + radius1 + color3 + seed1（float） */
const SHELL_STRIDE_F = 8;
/** 线段顶点步长：pos3 + rgba4（float） */
const LINE_STRIDE_F = 7;

export class Galaxy3D {
  constructor() {
    this.glc = null;
    this.gl = null;
    /** 实际可绘制粒子实例数（生成结果可能少于请求值） */
    this.particleCount = 0;

    this._quadBuf = null;
    this._quadVao = null;
    this._bufDisk = null;
    this._vaoDisk = null;
    this._bufSprite = null;
    this._vaoSprite = null;
    this._bufShell = null;
    this._vaoShell = null;
    this._bufLine = null;
    this._vaoLine = null;

    this._progDisk = null;
    this._progSprite = null;
    this._progLine = null;
    this._progNebula = null;
    this._progShell = null;
    this._u = {};
  }

  /**
   * 构建全部程序 / VAO / 缓冲（上下文丢失恢复后可重复调用：rebuild）。
   * 任一着色器编译失败即抛错（调用方捕获后整体退回 2D 路径）。
   * @param {import('./GLCore.js').GLContext} glc
   */
  init(glc) {
    if (!glc || !glc.gl) throw new Error('[Galaxy3D] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    const gl = glc.gl;

    this._buildPrograms();

    // 单位四边形（TRIANGLE_STRIP 4 顶点）：billboard 与全屏 pass 共用数据
    this._quadBuf = glc.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this._quadVao = glc.createFullscreenVAO();

    this._buildDiskResources(glc, gl);
    this._buildSpriteResources(glc, gl);
    this._buildShellResources(glc, gl);
    this._buildLineResources(glc, gl);
    return this;
  }

  /** 上下文恢复钩子：旧句柄已随上下文失效，整体重建 */
  rebuild(glc) {
    this.init(glc);
  }

  // —— 资源构建 ————————————————————————————————————————————

  _buildPrograms() {
    const glc = this.glc;
    const sh = resolveNebulaShaders();
    const loc = (prog, name) => glc.gl.getUniformLocation(prog, name);

    this._progDisk = glc.createProgram(VERT_DISK, FRAG_DISK, { label: 'galaxy3d.disk' });
    this._u.disk = {
      viewProj: loc(this._progDisk, 'uViewProj'),
      projScale: loc(this._progDisk, 'uProjScale'),
      minSize: loc(this._progDisk, 'uMinSize'),
      sizeClamp: loc(this._progDisk, 'uSizeClamp'),
      time: loc(this._progDisk, 'uTime'),
    };

    this._progSprite = glc.createProgram(VERT_SPRITE, FRAG_SPRITE, { label: 'galaxy3d.sprite' });
    this._u.sprite = {
      viewProj: loc(this._progSprite, 'uViewProj'),
      projScale: loc(this._progSprite, 'uProjScale'),
      sizeClamp: loc(this._progSprite, 'uSizeClamp'),
    };

    this._progLine = glc.createProgram(VERT_LINE, FRAG_LINE, { label: 'galaxy3d.line' });
    this._u.line = { viewProj: loc(this._progLine, 'uViewProj') };

    this._progNebula = glc.createProgram(sh.NEBULA_VERT, sh.NEBULA_FRAG, { label: 'galaxy3d.nebula' });
    this._u.nebula = {
      invViewProj: loc(this._progNebula, 'uInvViewProj'),
      time: loc(this._progNebula, 'uTime'),
      steps: loc(this._progNebula, 'uSteps'),
      gain: loc(this._progNebula, 'uGain'),
    };

    this._progShell = glc.createProgram(sh.SUPERNOVA_VERT, sh.SUPERNOVA_FRAG, { label: 'galaxy3d.shell' });
    this._u.shell = {
      view: loc(this._progShell, 'uView'),
      proj: loc(this._progShell, 'uProj'),
      projScale: loc(this._progShell, 'uProjScale'),
      time: loc(this._progShell, 'uTime'),
    };
  }

  /** 星系盘：生成（外部模块优先）→ 交错 → 静态实例缓冲 + VAO */
  _buildDiskResources(glc, gl) {
    const gen = generateGalaxyParticles({ count: PARTICLE_MAX, seed: GALAXY_SEED, worldScale: WORLD_SCALE });
    const pos = gen.positions;
    const col = gen.colors;
    const siz = gen.sizes;
    const sd = gen.seeds;
    const n = Math.min(Math.floor(pos.length / 3), Math.floor(col.length / 3), siz.length, sd.length);
    this.particleCount = Math.max(0, n);

    const inst = new Float32Array(this.particleCount * DISK_STRIDE_F);
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * DISK_STRIDE_F;
      inst[o] = pos[i * 3];
      inst[o + 1] = pos[i * 3 + 1];
      inst[o + 2] = pos[i * 3 + 2];
      inst[o + 3] = siz[i];
      inst[o + 4] = col[i * 3];
      inst[o + 5] = col[i * 3 + 1];
      inst[o + 6] = col[i * 3 + 2];
      inst[o + 7] = sd[i];
    }
    this._bufDisk = glc.createBuffer(inst, gl.STATIC_DRAW);
    const quad = this._quadBuf;
    this._vaoDisk = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufDisk);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, DISK_STRIDE_F * 4, 0);
      g.vertexAttribDivisor(1, 1);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 1, g.FLOAT, false, DISK_STRIDE_F * 4, 12);
      g.vertexAttribDivisor(2, 1);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 3, g.FLOAT, false, DISK_STRIDE_F * 4, 16);
      g.vertexAttribDivisor(3, 1);
      g.enableVertexAttribArray(4);
      g.vertexAttribPointer(4, 1, g.FLOAT, false, DISK_STRIDE_F * 4, 28);
      g.vertexAttribDivisor(4, 1);
    });
  }

  /** 节点 sprite：动态实例缓冲（每帧 bufferSubData 覆盖）+ VAO */
  _buildSpriteResources(glc, gl) {
    this._bufSprite = glc.createBuffer(new Float32Array(1024 * SPRITE_STRIDE_F), gl.DYNAMIC_DRAW);
    const quad = this._quadBuf;
    this._vaoSprite = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufSprite);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, SPRITE_STRIDE_F * 4, 0);
      g.vertexAttribDivisor(1, 1);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 1, g.FLOAT, false, SPRITE_STRIDE_F * 4, 12);
      g.vertexAttribDivisor(2, 1);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 4, g.FLOAT, false, SPRITE_STRIDE_F * 4, 16);
      g.vertexAttribDivisor(3, 1);
      g.enableVertexAttribArray(4);
      g.vertexAttribPointer(4, 4, g.FLOAT, false, SPRITE_STRIDE_F * 4, 32);
      g.vertexAttribDivisor(4, 1);
    });
  }

  /** 超新星球壳：动态实例缓冲 + VAO */
  _buildShellResources(glc, gl) {
    this._bufShell = glc.createBuffer(new Float32Array(128 * SHELL_STRIDE_F), gl.DYNAMIC_DRAW);
    const quad = this._quadBuf;
    this._vaoShell = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, this._bufShell);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 3, g.FLOAT, false, SHELL_STRIDE_F * 4, 0);
      g.vertexAttribDivisor(1, 1);
      g.enableVertexAttribArray(2);
      g.vertexAttribPointer(2, 1, g.FLOAT, false, SHELL_STRIDE_F * 4, 12);
      g.vertexAttribDivisor(2, 1);
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 3, g.FLOAT, false, SHELL_STRIDE_F * 4, 16);
      g.vertexAttribDivisor(3, 1);
      g.enableVertexAttribArray(4);
      g.vertexAttribPointer(4, 1, g.FLOAT, false, SHELL_STRIDE_F * 4, 28);
      g.vertexAttribDivisor(4, 1);
    });
  }

  /** 线（航路 + 标尺）：动态顶点缓冲 + VAO */
  _buildLineResources(glc, gl) {
    this._bufLine = glc.createBuffer(new Float32Array(6000 * LINE_STRIDE_F), gl.DYNAMIC_DRAW);
    this._vaoLine = glc.createVAO((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, this._bufLine);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 3, g.FLOAT, false, LINE_STRIDE_F * 4, 0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(1, 4, g.FLOAT, false, LINE_STRIDE_F * 4, 12);
    });
  }

  // —— 绘制调用（每帧；混合/深度状态由调用方统一：additive ONE/ONE、depth 关） ——

  /**
   * 星系盘粒子：一次 drawArraysInstanced 画 count 个 billboard（count <= particleCount）。
   * @param {{viewProj:Float32Array, px:number, py:number, minSize:number, count:number, time:number}} o
   */
  drawDisk(gl, o) {
    const u = this._u.disk;
    const count = Math.min(Math.max(0, Math.round(o.count) || 0), this.particleCount);
    if (count <= 0) return;
    gl.useProgram(this._progDisk);
    gl.uniformMatrix4fv(u.viewProj, false, o.viewProj);
    gl.uniform2f(u.projScale, o.px, o.py);
    gl.uniform1f(u.minSize, o.minSize);
    gl.uniform1f(u.sizeClamp, 0.5);
    gl.uniform1f(u.time, o.time || 0);
    gl.bindVertexArray(this._vaoDisk);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  /**
   * 节点 sprite 批量绘制（data 为预填实例数组，count 为实例数）。
   * @param {{viewProj:Float32Array, px:number, py:number}} o
   */
  drawSprites(gl, data, count, o) {
    const n = Math.max(0, Math.round(count) || 0);
    if (n <= 0 || !this._bufSprite) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bufSprite);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * SPRITE_STRIDE_F);
    const u = this._u.sprite;
    gl.useProgram(this._progSprite);
    gl.uniformMatrix4fv(u.viewProj, false, o.viewProj);
    gl.uniform2f(u.projScale, o.px, o.py);
    gl.uniform1f(u.sizeClamp, 0.5);
    gl.bindVertexArray(this._vaoSprite);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
  }

  /**
   * 超新星球壳批量绘制。
   * @param {{view:Float32Array, proj:Float32Array, px:number, py:number, time:number}} o
   */
  drawShell(gl, data, count, o) {
    const n = Math.max(0, Math.round(count) || 0);
    if (n <= 0 || !this._bufShell) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bufShell);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * SHELL_STRIDE_F);
    const u = this._u.shell;
    gl.useProgram(this._progShell);
    gl.uniformMatrix4fv(u.view, false, o.view);
    gl.uniformMatrix4fv(u.proj, false, o.proj);
    gl.uniform2f(u.projScale, o.px, o.py);
    gl.uniform1f(u.time, o.time || 0);
    gl.bindVertexArray(this._vaoShell);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
  }

  /**
   * 线段批量绘制（航路 + 垂直标尺；data 已填充 vertCount 个顶点）。
   * @param {{viewProj:Float32Array}} o
   */
  drawLines(gl, data, vertCount, o) {
    const n = Math.max(0, Math.round(vertCount) || 0);
    if (n <= 0 || !this._bufLine) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bufLine);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * LINE_STRIDE_F);
    const u = this._u.line;
    gl.useProgram(this._progLine);
    gl.uniformMatrix4fv(u.viewProj, false, o.viewProj);
    gl.bindVertexArray(this._vaoLine);
    gl.drawArrays(gl.LINES, 0, n);
    gl.bindVertexArray(null);
  }

  /**
   * 全屏体积星云 pass（加法；uSteps <= 0 时调用方应整体跳过本 pass）。
   * @param {{invViewProj:Float32Array, time:number, steps:number, gain:number}} o
   */
  drawNebula(gl, o) {
    const steps = Math.max(0, Math.min(28, Math.round(o.steps) || 0));
    if (steps <= 0) return;
    const u = this._u.nebula;
    gl.useProgram(this._progNebula);
    gl.uniformMatrix4fv(u.invViewProj, false, o.invViewProj);
    gl.uniform1f(u.time, o.time || 0);
    gl.uniform1f(u.steps, steps);
    gl.uniform1f(u.gain, o.gain);
    gl.bindVertexArray(this._quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
