/**
 * render/gl/GLCore.js — 轻量 WebGL 2.0 上下文封装（VOID FRONTIER 渲染底座）
 *
 * 以参考实现 simulation-matrix/common/engine/gl.js 为基础升级：
 *  - 构造时探测 EXT_color_buffer_float（floatOk，决定 HDR 管线能否落到 RGBA16F）
 *    与 MAX_TEXTURE_SIZE（maxTextureSize，供贴图/目标尺寸钳制）；
 *  - createProgram 支持 { label } 标签化错误报告；保留 _tracked 资源清册，
 *    destroy() 统一回收并经 WEBGL_lose_context 主动丢弃上下文（防 iframe/切页泄漏）；
 *  - createFloatTarget：单附件 RGBA16F（floatOk=false 时回退 RGBA8 并标记）FBO，
 *    线性采样，检查 FRAMEBUFFER_COMPLETE，登记清册；
 *  - createFullscreenVAO：单位四边形（aPos vec2，[-1..1]，TRIANGLE_STRIP 4 顶点），
 *    供全屏后处理 pass 复用；
 *  - 静态工厂 fromExisting(canvas, gl)：复用调用方已取得的 gl 上下文
 *    （CanvasManager 先自行 getContext 以决定是否退化，再交给本封装托管）。
 *
 * 约束：顶层不触碰 document/window（纯 JS，可在 Node 侧安全 import）；
 * 所有 GL 调用仅发生在持有真实上下文的方法内部。
 */

export const GLSL_VERSION = '#version 300 es\n';

function buildContextAttrs(opts) {
  return {
    antialias: opts.antialias !== false,
    alpha: !!opts.alpha,
    depth: opts.depth !== false,
    powerPreference: opts.powerPreference || 'high-performance',
  };
}

export class GLContext {
  /**
   * 常规构造：自行向 canvas 请求 webgl2 上下文，失败即抛错。
   * @param {HTMLCanvasElement} canvas
   * @param {{antialias?:boolean, alpha?:boolean, depth?:boolean, powerPreference?:string}} [opts]
   */
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', buildContextAttrs(opts));
    if (!gl) throw new Error('WebGL 2.0 is not available in this environment');
    this._init(canvas, gl, opts);
  }

  /**
   * 静态工厂：复用调用方已取得的 gl 上下文（不再重复 getContext）。
   * 典型用法：CanvasManager 先自行 getContext 决定降级路径，再交给本封装托管。
   * @param {HTMLCanvasElement} canvas
   * @param {WebGL2RenderingContext} gl 已取得的 webgl2 上下文（不可为空）
   * @returns {GLContext}
   */
  static fromExisting(canvas, gl) {
    if (!gl) throw new Error('[GLContext] fromExisting 需要已创建的 WebGL2 上下文');
    const inst = Object.create(GLContext.prototype);
    inst._init(canvas, gl, {});
    return inst;
  }

  /** 内部共享初始化（构造与 fromExisting 共用） */
  _init(canvas, gl, opts) {
    this.canvas = canvas;
    this.gl = gl;
    // HDR 能力探测：能否渲染到浮点颜色附件（RGBA16F 等）
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    // 线性过滤 32 位浮点纹理需要独立扩展（16F 为 WebGL2 核心可过滤格式）
    this.floatLinearOk = !!gl.getExtension('OES_texture_float_linear');
    this.loseContextExt = gl.getExtension('WEBGL_lose_context');
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this._tracked = { programs: [], buffers: [], vaos: [], textures: [], fbos: [] };
    this.errorCount = 0;
    void opts; // 预留：后续如需按 opts 差异化初始化在此扩展
    // 调试模式（window.__GL_THROW_ON_ERROR）：包装全部 gl 方法（原型链完整
    // 遍历），调用后立即 getError，非 NO_ERROR 即抛出带方法名的错误。
    if (typeof window !== 'undefined' && window.__GL_THROW_ON_ERROR) {
      let proto = Object.getPrototypeOf(gl);
      let count = 0;
      while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor' || typeof gl[name] !== 'function') continue;
          // getError 自引用会导致无限递归； getContext 不可重入 —— 排除
          if (name === 'getError' || name === 'getContext') continue;
          const orig = gl[name].bind(gl);
          const wrapped = (...a) => {
            const r = orig(...a);
            const err = gl.getError();
            if (err !== gl.NO_ERROR) {
              const args = a.slice(0, 4).map((v) => (typeof v === 'number' ? v : (v && v.length !== undefined ? 'arr/' + v.length : String(v)))).join(',');
              throw new Error(`[GL_DEBUG] gl.${name} → 0x${err.toString(16)} (${args})`);
            }
            return r;
          };
          try {
            Object.defineProperty(gl, name, { value: wrapped, writable: true, configurable: true });
            count++;
          } catch { /* 不可包装的方法跳过 */ }
        }
        proto = Object.getPrototypeOf(proto);
      }
      this.debugWrapped = count;
    }
  }

  get isLost() {
    return !this.gl || this.gl.isContextLost();
  }

  /** 检查并抛出 GL 错误（开发期防呆；错误计数供诊断） */
  checkError(where) {
    const gl = this.gl;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      this.errorCount++;
      throw new Error(`WebGL error 0x${err.toString(16)} at ${where}`);
    }
  }

  /** 编译单个着色器，失败抛出带 label 的信息日志 */
  compileShader(type, source, label = 'shader') {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`${label} compile failed: ${log}`);
    }
    return sh;
  }

  /**
   * 编译并链接程序（自动前置 GLSL ES 3.00 版本行）。
   * @param {string} vsSource 顶点着色器源码（不含 #version 行）
   * @param {string} fsSource 片元着色器源码（不含 #version 行）
   * @param {{label?:string, attributes?:Object<string,number>}} [opts]
   * @returns {WebGLProgram}
   */
  createProgram(vsSource, fsSource, { label = 'program', attributes = {} } = {}) {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, GLSL_VERSION + vsSource, `${label}:vertex`);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, GLSL_VERSION + fsSource, `${label}:fragment`);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    for (const [name, loc] of Object.entries(attributes)) {
      gl.bindAttribLocation(prog, loc, name);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`${label} link failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this._tracked.programs.push(prog);
    return prog;
  }

  /** 创建并上传数据的 VBO（登记清册） */
  createBuffer(data, usage = this.gl.STATIC_DRAW) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    this._tracked.buffers.push(buf);
    return buf;
  }

  /** 创建 VAO 并在 setup(gl) 回调内完成属性装配（登记清册） */
  createVAO(setup) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    setup(gl);
    gl.bindVertexArray(null);
    this._tracked.vaos.push(vao);
    return vao;
  }

  /**
   * 创建 2D 纹理（默认 RGBA8/NEAREST/CLAMP_TO_EDGE）。
   * @returns {{texture:WebGLTexture, width:number, height:number}}
   */
  createTexture2D(width, height, pixels, { internalFormat = null, format = null, type = null, filter = null, wrap = null } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0,
      internalFormat || gl.RGBA, width, height, 0,
      format || gl.RGBA, type || gl.UNSIGNED_BYTE, pixels);
    const filt = filter || gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    const wr = wrap || gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    this._tracked.textures.push(tex);
    return { texture: tex, width, height };
  }

  /** 上传 2D 纹理数组（TEXTURE_2D_ARRAY），layers 为同尺寸 ImageData/canvas 列表 */
  createTextureArray(width, height, layers, { filter = null } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, width, height, layers.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (let i = 0; i < layers.length; i++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, layers[i]);
    }
    const filt = filter || gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this._tracked.textures.push(tex);
    return { texture: tex, width, height, depth: layers.length };
  }

  /**
   * 创建单附件浮点渲染目标（HDR 管线用）。
   *  - floatOk=true：RGBA16F + HALF_FLOAT；若驱动仍报 FBO 不完整则自动回退 RGBA8；
   *  - floatOk=false：直接 RGBA8 + UNSIGNED_BYTE（由 PostProcessor 做 HDR 模拟）。
   * @param {number} width
   * @param {number} height
   * @param {{linear?:boolean}} [opts] 采样过滤（默认 LINEAR，供降/升采样双线性）
   * @returns {{texture:WebGLTexture, fbo:WebGLFramebuffer, width:number, height:number, float:boolean}}
   */
  createFloatTarget(width, height, { linear = true } = {}) {
    const gl = this.gl;
    const make = (floatMode) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (floatMode) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      const filt = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo, complete };
    };

    let res = make(this.floatOk);
    let float = this.floatOk;
    if (!res.complete && this.floatOk) {
      // 驱动/实现不支持渲染到 RGBA16F：降级 RGBA8（float 标记为 false）
      gl.deleteTexture(res.tex);
      gl.deleteFramebuffer(res.fbo);
      res = make(false);
      float = false;
    }
    if (!res.complete) {
      gl.deleteTexture(res.tex);
      gl.deleteFramebuffer(res.fbo);
      throw new Error(`float target FBO incomplete (${width}x${height})`);
    }
    this._tracked.textures.push(res.tex);
    this._tracked.fbos.push(res.fbo);
    return { texture: res.tex, fbo: res.fbo, width, height, float };
  }

  /**
   * 创建全屏四边形 VAO：aPos（location=0，vec2，[-1..1]），TRIANGLE_STRIP 共 4 顶点。
   * 全屏后处理 pass 复用同一 VAO，配合 drawArrays(gl.TRIANGLE_STRIP, 0, 4) 绘制。
   * @returns {WebGLVertexArrayObject}
   */
  createFullscreenVAO() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // 顶点顺序：左下 → 右下 → 左上 → 右上（TRIANGLE_STRIP 成整屏四边形）
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._tracked.buffers.push(buf);
    this._tracked.vaos.push(vao);
    return vao;
  }

  /**
   * 双 FBO ping-pong（GPU 模拟类 pass 用；登记清册）。
   * @returns {{read:Object, write:Object, swap:Function, width:number, height:number}}
   */
  createPingPongFBOs(width, height, { internalFormat = null, type = null } = {}) {
    const gl = this.gl;
    const make = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat || gl.RGBA32F, width, height, 0, gl.RGBA, type || gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('ping-pong FBO incomplete');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._tracked.textures.push(tex);
      this._tracked.fbos.push(fbo);
      return { texture: tex, fbo };
    };
    const a = make();
    const b = make();
    return {
      read: a,
      write: b,
      swap() { const t = this.read; this.read = this.write; this.write = t; },
      width, height,
    };
  }

  /**
   * 上下文恢复（webglcontextrestored）后调用：旧句柄已全部失效，
   * 清空清册但不做删除调用（对失效句柄的删除本为空操作，清空可防清册无限膨胀）。
   */
  resetTracking() {
    this._tracked = { programs: [], buffers: [], vaos: [], textures: [], fbos: [] };
    this.errorCount = 0;
    // 调试钩子：window.__GL_TRACE 时包装全部 gl 方法，记录最后 N 次调用（含参数摘要）
    if (typeof window !== 'undefined' && window.__GL_TRACE) {
      this.traceLog = [];
      for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(gl)).concat(Object.keys(gl))) {
        if (typeof gl[name] !== 'function') continue;
        const orig = gl[name].bind(gl);
        gl[name] = (...a) => {
          try {
            this.traceLog.push(name + ' ' + a.slice(0, 4).map((v) => typeof v === 'number' ? v : (v && v.length !== undefined ? ('arr:' + (v.length)) : String(v))).join(','));
            if (this.traceLog.length > 40) this.traceLog.shift();
          } catch { /* 追踪不影响主流程 */ }
          return orig(...a);
        };
      }
    }
  }

  /** 销毁全部登记资源，并经 WEBGL_lose_context 主动丢弃上下文 */
  destroy() {
    const gl = this.gl;
    if (!gl) return;
    for (const p of this._tracked.programs) gl.deleteProgram(p);
    for (const b of this._tracked.buffers) gl.deleteBuffer(b);
    for (const v of this._tracked.vaos) gl.deleteVertexArray(v);
    for (const t of this._tracked.textures) gl.deleteTexture(t);
    for (const f of this._tracked.fbos) gl.deleteFramebuffer(f);
    this._tracked = { programs: [], buffers: [], vaos: [], textures: [], fbos: [] };
    if (this.loseContextExt) this.loseContextExt.loseContext();
  }
}

/** 实例化绘制助手：绑定 VAO 后按 instanceCount 批量绘制 */
export function drawInstanced(gl, vao, count, instanceCount, mode = gl.TRIANGLES) {
  gl.bindVertexArray(vao);
  gl.drawArraysInstanced(mode, 0, count, instanceCount);
  gl.bindVertexArray(null);
}
