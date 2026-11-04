/**
 * render/gl/PostProcessor.js — HDR Bloom 后处理管线（VOID FRONTIER 渲染底座 R2）
 *
 * 管线（tier 1，物理像素分辨率）：
 *  1. beginScene() 绑定场景浮点 FBO（RGBA16F + 24 位深度渲染缓冲；无浮点渲染能力时
 *     回退 RGBA8 模拟），并执行 8 步清屏/状态复位契约（见 beginScene 注释）——
 *     beginScene 是场景 FBO 清屏的【唯一所有者】（doc6 规范 6 §3.2：一个显式所有者
 *     + 注释 + 测试；调用方随后的 clearColor/clear 属允许的冗余防御，不构成第二所有者）。
 *     调用方在返回的目标中渲染 HDR 场景（颜色可 >1，模拟模式下须先除以 hdrRange 预缩放）；
 *  2. endScene()：
 *     a) 软膝盖高亮提取（threshold 0.85 / knee 0.55，smoothstep 软过渡）+ 半分辨率降采样；
 *     b) 4 级金字塔（1/2、1/4、1/8、1/16），每级水平+垂直 9-tap 可分离高斯模糊；
 *     c) 自底向上 3x3 tent 双线性上采样，加法混合（ONE, ONE）逐级累加辉光；
 *     d) 全屏合成：scene + bloomStrength×glow → Narkowicz ACES 色调映射 → sRGB 伽马
 *        → 抖动去色带 → 写默认帧缓冲。
 *
 * 降级：
 *  - floatOk=false（RGBA8 回退）：scene/glow 以 hdrRange（默认 4）预除编码存储，
 *    合成时乘回再曝光；hdrSimulated=true 标记；
 *  - tier=2：金字塔砍半为 2 级，particleScale=0.5 供调用方做粒子减量提示；
 *  - tier=3：调用方整体跳过 GL（Canvas 2D 退化），beginScene/endScene 直接短路。
 *
 * 约束：顶层不触碰 document/window（纯 JS，可在 Node 侧安全 import）；所有 GLSL
 * 均为手写 GLSL ES 3.0 字符串（#version 行由 GLCore 统一前置），不拼接外部库。
 */

/** RGBA8 模拟 HDR 时的编码基准亮度：存储值 = HDR 值 / hdrRange（钳在 [0,1]） */
const HDR_SIM_BASE = 4.0;
/** 软膝盖高亮提取参数（HDR 亮度域） */
const BRIGHT_THRESHOLD = 0.85;
const BRIGHT_KNEE = 0.55;
/** tier 1 完整金字塔级数；tier 2 减为 2 级 */
const PYRAMID_LEVELS_FULL = 4;
const PYRAMID_LEVELS_LOW = 2;
/** beginScene 默认清屏色（深空底色；调用方可传入主题天空/地平线色覆盖） */
const DEFAULT_SCENE_CLEAR = [0.02, 0.03, 0.06, 1.0];

// —— GLSL ES 3.0 着色器（手写字符串，#version 由 GLCore.createProgram 前置） ——

/** 全屏四边形顶点着色器：aPos [-1..1] → vUv [0..1] */
const VERT_QUAD = `
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** 高亮提取 + 2x2 盒式降采样：软膝盖 smoothstep(t-k, t+k, luma) * luma 风格 */
const FRAG_BRIGHT = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uSrcTexel;   // 1/源纹理尺寸（2x2 盒式降采样半 texel 偏移）
uniform float uThreshold; // 软膝盖阈值
uniform float uKnee;      // 膝盖半宽
void main() {
  vec2 o = uSrcTexel * 0.5;
  vec3 c = texture(uTexture, vUv + vec2(-o.x, -o.y)).rgb
         + texture(uTexture, vUv + vec2( o.x, -o.y)).rgb
         + texture(uTexture, vUv + vec2(-o.x,  o.y)).rgb
         + texture(uTexture, vUv + vec2( o.x,  o.y)).rgb;
  c *= 0.25;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold - uKnee, uThreshold + uKnee, luma);
  fragColor = vec4(c * w, 1.0);
}
`;

/** 9-tap 可分离高斯模糊（单方向；uDir = texel × 方向 × 步长） */
const FRAG_BLUR = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uDir;
void main() {
  vec3 acc = texture(uTexture, vUv).rgb * 0.22702703;
  acc += texture(uTexture, vUv + uDir        ).rgb * 0.19459459;
  acc += texture(uTexture, vUv - uDir        ).rgb * 0.19459459;
  acc += texture(uTexture, vUv + uDir * 2.0  ).rgb * 0.12162162;
  acc += texture(uTexture, vUv - uDir * 2.0  ).rgb * 0.12162162;
  acc += texture(uTexture, vUv + uDir * 3.0  ).rgb * 0.05405405;
  acc += texture(uTexture, vUv - uDir * 3.0  ).rgb * 0.05405405;
  acc += texture(uTexture, vUv + uDir * 4.0  ).rgb * 0.01621622;
  acc += texture(uTexture, vUv - uDir * 4.0  ).rgb * 0.01621622;
  fragColor = vec4(acc, 1.0);
}
`;

/**
 * 3x3 tent 双线性上采样（权重和为 1）。
 * uSrcTexel = 0 时退化为逐点拷贝（兼作金字塔降采样链的拷贝 pass）。
 */
const FRAG_UPSAMPLE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uSrcTexel;
void main() {
  vec2 t = uSrcTexel;
  vec3 acc = vec3(0.0);
  acc += texture(uTexture, vUv + vec2(-t.x, -t.y)).rgb * 1.0;
  acc += texture(uTexture, vUv + vec2( 0.0, -t.y)).rgb * 2.0;
  acc += texture(uTexture, vUv + vec2( t.x, -t.y)).rgb * 1.0;
  acc += texture(uTexture, vUv + vec2(-t.x,  0.0)).rgb * 2.0;
  acc += texture(uTexture, vUv                  ).rgb * 4.0;
  acc += texture(uTexture, vUv + vec2( t.x,  0.0)).rgb * 2.0;
  acc += texture(uTexture, vUv + vec2(-t.x,  t.y)).rgb * 1.0;
  acc += texture(uTexture, vUv + vec2( 0.0,  t.y)).rgb * 2.0;
  acc += texture(uTexture, vUv + vec2( t.x,  t.y)).rgb * 1.0;
  fragColor = vec4(acc / 16.0, 1.0);
}
`;

/** 全屏合成：scene + bloom×glow → ACES(Narkowicz) → sRGB 伽马 → 抖动去色带 */
const FRAG_COMPOSITE = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uGlow;
uniform float uBloom;    // 辉光强度
uniform float uExposure; // 曝光
uniform float uHdrRange; // 1.0=真 HDR；RGBA8 模拟时为编码基准（存储值已预除）
uniform float uTime;     // 抖动相位（秒）
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 hdr = texture(uScene, vUv).rgb * uHdrRange;
  vec3 glow = texture(uGlow, vUv).rgb * uHdrRange;
  vec3 c = hdr + uBloom * glow;
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2)); // sRGB 伽马
  // 确定性时间抖动（±1/255）消除伽马后暗部色带；不使用随机数
  float d = (hash12(gl_FragCoord.xy + vec2(uTime * 60.0, uTime * 47.0)) - 0.5) / 255.0;
  fragColor = vec4(c + d, 1.0);
}
`;

export class PostProcessor {
  /**
   * @param {import('./GLCore.js').GLContext} glc GLContext 实例
   */
  constructor(glc) {
    if (!glc || !glc.gl) throw new Error('[PostProcessor] 需要 GLContext 实例');
    this.glc = glc;
    this.gl = glc.gl;
    /** 渲染层级：1=完整 4 级；2=2 级金字塔（管线降级）；3=调用方跳过 GL（本类短路） */
    this.tier = 1;
    /** 物理像素尺寸（resize 后有效；构造时尚未建立目标） */
    this.width = 0;
    this.height = 0;
    /** RGBA8 模拟 HDR 标记（scene 目标实际格式决定，见 _buildTargets） */
    this.hdrSimulated = !glc.floatOk;
    /** HDR 编码基准：1.0=真 HDR；模拟模式下 scene 内容须先除以该值写入 */
    this.hdrRange = this.hdrSimulated ? HDR_SIM_BASE : 1.0;
    /** 粒子减量提示（仅管线降级提示）：tier1=1.0 / tier2=0.5 / tier3=0.0 */
    this.particleScale = 1.0;

    this._progBright = null;
    this._progBlur = null;
    this._progUp = null;
    this._progComp = null;
    this._quadVao = null;
    this._scene = null;   // { texture, fbo, rbo, width, height, float, hasDepth }
    this._levels = [];    // 金字塔：[{ a, b, width, height }]，a 为主缓冲，b 为模糊中转
    this._u = { bright: null, blur: null, up: null, comp: null };

    // 尺寸无关资源：程序 + 全屏 VAO（目标缓冲等 resize 建立后再分配）
    this._buildPrograms();
    this._quadVao = glc.createFullscreenVAO();
  }

  /** 场景目标是否就绪（resize 之后为 true） */
  get ready() {
    return !!this._scene;
  }

  /**
   * 设置渲染层级。
   *  1 = 完整 4 级金字塔；2 = 2 级金字塔 + 粒子减量提示（仅管线降级）；
   *  3 = 调用方直接跳过 GL（Canvas 2D 退化），beginScene/endScene 直接短路。
   * @param {number} t
   * @returns {number} 实际生效的层级
   */
  setTier(t) {
    const n = Math.round(Number(t));
    const v = Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1;
    if (v === this.tier) return this.tier;
    this.tier = v;
    this.particleScale = v === 1 ? 1.0 : v === 2 ? 0.5 : 0.0;
    // 层级数变化影响金字塔级数 → 按当前尺寸重建目标
    if (this.width > 0 && this.height > 0) this._buildTargets();
    return this.tier;
  }

  /**
   * 重建全部渲染目标（窗口/画布尺寸变化时调用）。
   * 场景 FBO 与金字塔均按物理像素尺寸分配；尺寸未变且目标已就绪时跳过。
   * @param {number} width 物理像素宽
   * @param {number} height 物理像素高
   */
  resize(width, height) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    if (w === this.width && h === this.height && this._scene) return;
    this.width = w;
    this.height = h;
    this._buildTargets();
  }

  /**
   * 开始场景 pass：绑定场景 FBO，执行 8 步清屏/状态复位契约，返回目标信息。
   * 本方法是场景 FBO 清屏与初始渲染状态的【唯一所有者】（doc6 §3.2：唯一显式
   * 所有者 + 注释 + 测试；doc7 §2.2 修复 2）——每帧固定顺序：
   *   1. bindFramebuffer(_scene.fbo)
   *   2. viewport(0, 0, w, h)
   *   3. disable(SCISSOR_TEST)
   *   4. disable(BLEND)
   *   5. colorMask(true, true, true, true)
   *   6. depthMask(true)
   *   7. frontFace(CCW) + cullFace(BACK) + disable(CULL_FACE)（声明默认绕序，不开启剔除）
   *   8. clearColor(clearColor || 深空底色) + clearDepth(1.0)
   *      + clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)
   * 背景"懒刷新"重影的根治点：不再依赖"天空恰好覆盖所有像素"间接清色，
   * 残留状态（blend/colorMask/scissor）在此统一复位。tier>=3 或目标未就绪时
   * 返回 null（调用方应整体跳过 GL）。
   * @param {[number,number,number,number]?} clearColor 可选清屏色 RGBA
   * @returns {{fbo:WebGLFramebuffer, width:number, height:number}|null}
   */
  beginScene(clearColor = null) {
    if (this.tier >= 3 || !this._scene) return null;
    const gl = this.gl;
    const s = this._scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); // 1
    gl.viewport(0, 0, s.width, s.height); // 2
    gl.disable(gl.SCISSOR_TEST); // 3
    gl.disable(gl.BLEND); // 4
    gl.colorMask(true, true, true, true); // 5
    gl.depthMask(true); // 6
    gl.frontFace(gl.CCW); // 7：声明默认绕序（不开启剔除，由各渲染器按 pass 管理）
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE);
    const cc = clearColor || DEFAULT_SCENE_CLEAR; // 8
    gl.clearColor(cc[0], cc[1], cc[2], cc[3] != null ? cc[3] : 1.0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return { fbo: s.fbo, width: s.width, height: s.height };
  }

  /**
   * 结束场景 pass：执行 亮度提取 → 高斯金字塔 → 上采样累加 → ACES 合成，
   * 最终写默认帧缓冲。
   * @param {{bloom?:number, exposure?:number, time?:number}} [opts]
   *        bloom 辉光强度（默认 1）、exposure 曝光（默认 1）、time 秒（抖动相位）
   */
  endScene(opts = {}) {
    if (this.tier >= 3) return; // Canvas 2D 退化：直接跳过
    const levels = this._levels;
    if (!this._scene || !levels.length) return;

    const gl = this.gl;
    const bloom = this._num(opts.bloom, 1.0);
    const exposure = this._num(opts.exposure, 1.0);
    const time = this._num(opts.time, 0.0);

    // 后处理全屏 pass 不需要深度；混合默认关闭（累加阶段单独开启）
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // —— 1. 软膝盖高亮提取 + 降采样到 1/2 分辨率 → levels[0].a ——
    this._pass(this._progBright, levels[0].a, () => {
      this._bindTex(0, this._scene.texture, this._u.bright.tex);
      gl.uniform2f(this._u.bright.srcTexel, 1 / this._scene.width, 1 / this._scene.height);
      // 模拟模式下场景已预除 hdrRange，阈值/膝宽同步缩放，保持 HDR 域语义一致
      gl.uniform1f(this._u.bright.threshold, this.hdrSimulated ? BRIGHT_THRESHOLD / this.hdrRange : BRIGHT_THRESHOLD);
      gl.uniform1f(this._u.bright.knee, this.hdrSimulated ? BRIGHT_KNEE / this.hdrRange : BRIGHT_KNEE);
    });

    // —— 2. level0 水平 + 垂直高斯模糊 ——
    this._blurLevel(0);

    // —— 3. 逐级降采样拷贝 + 模糊（1/4、1/8、1/16）——
    for (let i = 1; i < levels.length; i++) {
      const src = levels[i - 1].a;
      this._pass(this._progUp, levels[i].a, () => {
        this._bindTex(0, src.texture, this._u.up.tex);
        gl.uniform2f(this._u.up.srcTexel, 0.0, 0.0); // 零 texel → 等价逐点拷贝
      });
      this._blurLevel(i);
    }

    // —— 4. 自底向上 tent 上采样，加法混合逐级累加辉光 ——
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels.length - 1; i >= 1; i--) {
      const src = levels[i].a;
      this._pass(this._progUp, levels[i - 1].a, () => {
        this._bindTex(0, src.texture, this._u.up.tex);
        gl.uniform2f(this._u.up.srcTexel, 1 / src.width, 1 / src.height);
      });
    }
    gl.disable(gl.BLEND);

    // —— 5. 全屏合成到默认帧缓冲（ACES + 伽马 + 抖动）——
    this._pass(this._progComp, null, () => {
      this._bindTex(0, this._scene.texture, this._u.comp.scene);
      this._bindTex(1, levels[0].a.texture, this._u.comp.glow);
      gl.uniform1f(this._u.comp.bloom, bloom);
      gl.uniform1f(this._u.comp.exposure, exposure);
      gl.uniform1f(this._u.comp.hdrRange, this.hdrRange);
      gl.uniform1f(this._u.comp.time, time);
    });

    // —— 还原共享状态，避免污染调用方后续 GL 绘制 ——
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * 上下文恢复后重建全部 GPU 资源（程序 / VAO / 目标缓冲）。
   * 旧句柄随上下文失效，对其的删除调用为安全空操作。
   */
  rebuild() {
    this._releaseTargets();
    this._releasePrograms();
    this._buildPrograms();
    this._quadVao = this.glc.createFullscreenVAO();
    if (this.width > 0 && this.height > 0) {
      this._buildTargets();
    } else {
      this._scene = null;
      this._levels = [];
    }
  }

  /** 释放本类创建的全部登记资源（glc.destroy() 会再次幂等清理） */
  destroy() {
    this._releaseTargets();
    this._releasePrograms();
    this._quadVao = null;
    this._scene = null;
    this._levels = [];
  }

  // —— 内部实现 ——————————————————————————————————————————————

  /** 数字参数兜底：非法值回退默认 */
  _num(v, dft) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dft;
  }

  /** 编译 4 个后处理程序并缓存 uniform 位置 */
  _buildPrograms() {
    const glc = this.glc;
    const loc = (prog, name) => glc.gl.getUniformLocation(prog, name);

    this._progBright = glc.createProgram(VERT_QUAD, FRAG_BRIGHT, { label: 'post.bright' });
    this._u.bright = {
      tex: loc(this._progBright, 'uTexture'),
      srcTexel: loc(this._progBright, 'uSrcTexel'),
      threshold: loc(this._progBright, 'uThreshold'),
      knee: loc(this._progBright, 'uKnee'),
    };

    this._progBlur = glc.createProgram(VERT_QUAD, FRAG_BLUR, { label: 'post.blur' });
    this._u.blur = {
      tex: loc(this._progBlur, 'uTexture'),
      dir: loc(this._progBlur, 'uDir'),
    };

    this._progUp = glc.createProgram(VERT_QUAD, FRAG_UPSAMPLE, { label: 'post.upsample' });
    this._u.up = {
      tex: loc(this._progUp, 'uTexture'),
      srcTexel: loc(this._progUp, 'uSrcTexel'),
    };

    this._progComp = glc.createProgram(VERT_QUAD, FRAG_COMPOSITE, { label: 'post.composite' });
    this._u.comp = {
      scene: loc(this._progComp, 'uScene'),
      glow: loc(this._progComp, 'uGlow'),
      bloom: loc(this._progComp, 'uBloom'),
      exposure: loc(this._progComp, 'uExposure'),
      hdrRange: loc(this._progComp, 'uHdrRange'),
      time: loc(this._progComp, 'uTime'),
    };
  }

  /** 重建场景 FBO 与辉光金字塔（调用前须先释放旧目标） */
  _buildTargets() {
    this._releaseTargets();
    const glc = this.glc;
    const w = this.width;
    const h = this.height;

    // 场景浮点目标（floatOk=false 或 FBO 不完整时 GLCore 内部回退 RGBA8）。
    // depth:true —— 挂载 DEPTH_COMPONENT24 渲染缓冲（doc7 TERRAIN-07）：场景 FBO
    // 无深度附件时 gl.enable(DEPTH_TEST)/gl.clear(DEPTH_BUFFER_BIT) 均无效，
    // 是"地形像被背面剔除"故障的根因；辉光金字塔缓冲保持无深度（纯颜色 pass）。
    this._scene = glc.createFloatTarget(w, h, { linear: true, depth: true });
    // 以场景目标的实际格式为准刷新模拟标记（floatOk=true 但驱动回退的极端情况）
    this.hdrSimulated = !this._scene.float;
    this.hdrRange = this.hdrSimulated ? HDR_SIM_BASE : 1.0;

    // 辉光金字塔：1/2、1/4、1/8、1/16（tier 2 时仅前 2 级），每级 a/b 两个缓冲
    const n = this.tier === 2 ? PYRAMID_LEVELS_LOW : PYRAMID_LEVELS_FULL;
    this._levels = [];
    for (let i = 0; i < n; i++) {
      const lw = Math.max(1, w >> (i + 1));
      const lh = Math.max(1, h >> (i + 1));
      this._levels.push({
        a: glc.createFloatTarget(lw, lh, { linear: true }),
        b: glc.createFloatTarget(lw, lh, { linear: true }),
        width: lw,
        height: lh,
      });
    }
  }

  /** 对第 i 级执行水平 → 垂直 9-tap 可分离高斯模糊（结果写回 a） */
  _blurLevel(i) {
    const gl = this.gl;
    const lv = this._levels[i];
    const tx = 1 / lv.width;
    const ty = 1 / lv.height;
    // 水平：a → b
    this._pass(this._progBlur, lv.b, () => {
      this._bindTex(0, lv.a.texture, this._u.blur.tex);
      gl.uniform2f(this._u.blur.dir, tx, 0.0);
    });
    // 垂直：b → a
    this._pass(this._progBlur, lv.a, () => {
      this._bindTex(0, lv.b.texture, this._u.blur.tex);
      gl.uniform2f(this._u.blur.dir, 0.0, ty);
    });
  }

  /**
   * 执行一次全屏 pass。
   * @param {WebGLProgram} prog 程序
   * @param {Object} u uniform 位置表
   * @param {{fbo:WebGLFramebuffer, width:number, height:number}|null} target 目标（null = 默认帧缓冲）
   * @param {Function} setUniforms uniform/纹理装配回调
   */
  _pass(prog, target, setUniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : this.width, target ? target.height : this.height);
    gl.useProgram(prog);
    gl.bindVertexArray(this._quadVao);
    setUniforms();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 绑定纹理单元并设置 sampler uniform */
  _bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  }

  /** 释放场景与金字塔目标（对已失效句柄的删除为空操作，可安全重复调用） */
  _releaseTargets() {
    const gl = this.gl;
    if (!gl) return;
    if (this._scene) {
      gl.deleteFramebuffer(this._scene.fbo);
      gl.deleteTexture(this._scene.texture);
      if (this._scene.rbo) gl.deleteRenderbuffer(this._scene.rbo); // 场景深度渲染缓冲
      this._scene = null;
    }
    for (const lv of this._levels) {
      gl.deleteFramebuffer(lv.a.fbo);
      gl.deleteTexture(lv.a.texture);
      gl.deleteFramebuffer(lv.b.fbo);
      gl.deleteTexture(lv.b.texture);
    }
    this._levels = [];
  }

  /** 释放 4 个后处理程序 */
  _releasePrograms() {
    const gl = this.gl;
    if (!gl) return;
    if (this._progBright) { gl.deleteProgram(this._progBright); this._progBright = null; }
    if (this._progBlur) { gl.deleteProgram(this._progBlur); this._progBlur = null; }
    if (this._progUp) { gl.deleteProgram(this._progUp); this._progUp = null; }
    if (this._progComp) { gl.deleteProgram(this._progComp); this._progComp = null; }
    if (this._quadVao) { gl.deleteVertexArray(this._quadVao); this._quadVao = null; }
    this._u = { bright: null, blur: null, up: null, comp: null };
  }
}
