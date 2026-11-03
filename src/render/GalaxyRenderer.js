/**
 * render/GalaxyRenderer.js — 银河地图渲染器（R3：WebGL2 全 3D 棒旋星系 + Canvas 2D 退化保护）
 *
 * 职责：
 *  - 三维透视轨道相机：策略坐标 (x,y ∈ 0..1000) 映射世界 (x-500, y-500)*0.02（±10 世界单位），
 *    星系高度 z = hash(systemId)·核球厚度剖面（银心厚、边缘薄，见 Galaxy3D.systemWorldPos）。
 *    相机默认 pitch 55°、yaw 0°，半径 = CAM_R0/zoom（zoom 0.5..4 与旧 2D 语义兼容）；
 *  - 双渲染路径：
 *      GL 路径（cm.hasGL && cm.tier<3 && 快照有效）：cm.beginGLFrame() → 星系盘实例化粒子
 *      → 体积星云全屏 raymarch（uSteps 按 tier 24/14/0）→ 航路/标尺线 → 星系节点/势力环
 *      sprite → 超新星球壳 → cm.endGLFrame()（HDR Bloom + ACES）；
 *      2D 路径 _render2D：webglcontextlost / Tier3 / 无 WebGL 时的退化保护（原 Canvas 2D
 *      实现完整保留，任何 GL 异常都平滑回落，render() 绝不抛错）；
 *  - HUD 文字/指示继续画在 cm.ctx（2D HUD 透明层）：名称标签（surveyedLevel≥1、贪心抽稀）、
 *    选中/悬停圈、势力范围、舰队/殖民/资源/贸易/前线等标记，坐标一律来自 _projCache 投影；
 *  - pick(sx, sy)：把每个可见星系的三维位置经 viewProj 投影回屏幕空间缓存到 _projCache /
 *    _pickList（每帧 render 时更新；交互事件触发相机变化后懒重建），按最近命中
 *    （阈值 max(10, 14/zoom)）返回 systemId；
 *  - 交互：左键平移（沿相机右/基准面投影上向量）、滚轮缩放半径（光标锚定）、
 *    右键/中键拖拽旋转 pitch/yaw（限制 10°..85°）——旋转监听由本渲染器在 init(cm) 时
 *    自行挂载到 cm.canvas（按下期间临时挂 window move/up，松开即卸，不与 GalaxyView 的
 *    左键交互冲突，也不产生跨视图泄漏）。
 *
 * ⚠ 设计令牌同步声明：本文件的色板字面量是 styles.css `:root` 变量的手工副本
 *   （读取 getComputedStyle 每帧开销过高），若调整 styles.css 的变量需同步改这里：
 *   --bg #070b12 / --panel #0e1520 / --line #1d2a3a / --ink #c9d6e3 / --ink-dim #71839a
 *   --ink-faint #46586e / --accent #4fd8e8 / --accent2 #7ea8ff / --warn #e8b04f
 *   --danger #e85f5f / --ok #62d98a
 *
 * 确定性约束：背景星点与星系高度使用固定 hash（禁用随机数）；动画时间只经
 * opts.time 传入 uniform；本渲染器不写任何世界/快照状态、不使用 gl.readPixels。
 */

import { mat4LookAt, mat4Perspective, mat4Multiply, mat4Invert, mat4Identity, mat4MulVec4 } from './gl/Mat4.js';
import {
  WORLD_SCALE,
  systemWorldPos,
  generateSupernovaSeeds,
  Galaxy3D,
} from './gl/Galaxy3D.js';

/** 与 styles.css 同步的字面量色板（见文件头同步声明） */
const C = {
  BG: '#070b12',
  BG_DEEP: '#0d1626',
  LINE: '#1d2a3a',
  INK: '#c9d6e3',
  INK_DIM: '#71839a',
  INK_FAINT: '#46586e',
  ACCENT: '#4fd8e8',
  ACCENT2: '#7ea8ff',
  WARN: '#e8b04f',
  DANGER: '#e85f5f',
  OK: '#62d98a',
  NODE_UNSEEN: '#39465a', // 未探索星系的暗灰点
  LABEL: '#e9f0f7',       // 标签近白色
};

/** 视图字体（与 styles.css --font 栈一致） */
const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** 恒星类型 → 地图节点本色（与 SystemRenderer 的恒星着色同源） */
const STAR_COLORS = {
  yellowDwarf: '#ffd27a',
  redDwarf: '#ff8a6a',
  blueGiant: '#9ecbff',
  whiteDwarf: '#e8f2ff',
  neutronStar: '#b8e8ff',
  pulsar: '#b8e8ff',
  blackHole: '#2a2f3a', // 本体近黑，靠吸积环辨识
};

/** 恒星类型 → 地图节点基准半径（逻辑像素，随 zoom 轻微缩放） */
const STAR_SIZES = {
  yellowDwarf: 3.4,
  redDwarf: 2.8,
  blueGiant: 5.0,
  whiteDwarf: 3.0,
  neutronStar: 2.8,
  pulsar: 3.0,
  blackHole: 3.6,
};

/** 世界坐标范围（与 galaxyGen 的 W=1000 一致） */
const WORLD = 1000;

/** 透视相机竖直视场角（弧度） */
const FOV = 50 * (Math.PI / 180);
/** zoom=1 时的轨道半径（世界单位）：竖直可见跨度 ≈ 24 世界单位，整盘 20 单位入画 */
const CAM_R0 = 26;
/** 相机半径硬钳制（世界单位） */
const CAM_R_MIN = 3;
const CAM_R_MAX = 80;
/** 旋转灵敏度（弧度/像素） */
const ROT_SPEED = 0.005;
/** GL 航路透明度（两端 surveyedLevel>=1 亮 / 其余暗） */
const LANE_A_KNOWN = 0.35;
const LANE_A_DIM = 0.10;
/** 垂直投影标尺线透明度 */
const STALK_A = 0.08;
/** 超新星球壳基准半径（世界单位；规格“~12”按 0.1 世界单位刻度解读为 1.2，
 *  即银盘半径的 12%，并随 zoom 软压避免近景遮蔽邻星） */
const SHELL_R_BASE = 1.2;
/** 星云辐射增益 */
const NEBULA_GAIN = 0.42;

/** 确定性 hash：f(i) = frac(sin(i*127.1)*43758.5453)，禁用随机数 */
function hash01(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** hex(#rgb/#rrggbb) → rgba 字符串；解析失败回退灰 */
function rgba(hex, a) {
  let h = String(hex || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return `rgba(113,131,154,${a})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/** hex → [r,g,b] 0..1（GL uniform 用）；解析失败回退灰 */
function hexToRgb(hex) {
  let h = String(hex || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return [113 / 255, 131 / 255, 154 / 255];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 常用色的 GL float 三元组（模块期解析一次） */
const ACCENT_RGB = hexToRgb(C.ACCENT);
const WARN_RGB = hexToRgb(C.WARN);
const DANGER_RGB = hexToRgb(C.DANGER);
const INK_RGB = hexToRgb(C.INK);
const INK_DIM_RGB = hexToRgb(C.INK_DIM);
const UNSEEN_RGB = hexToRgb(C.NODE_UNSEEN);
/** 恒星类型 → GL 颜色三元组 */
const STAR_RGB = {};
for (const k of Object.keys(STAR_COLORS)) STAR_RGB[k] = hexToRgb(STAR_COLORS[k]);

// —— 模块级 scratch（渲染为同步单线程调用，复用以保证循环内零分配） ——————
const UP_VEC = new Float32Array([0, 0, 1]);
const _tView = new Float32Array(16);
const _tProj = new Float32Array(16);
const _tVP = new Float32Array(16);
const _tIVP = new Float32Array(16);
const _tEye = new Float32Array(3);
const _tCtr = new Float32Array(3);
const _v4a = new Float32Array(4);
const _v4b = new Float32Array(4);
const _v4c = new Float32Array(4);
const _v4d = new Float32Array(4);
const _ptTmp = new Float32Array(2);
const _ptA = new Float32Array(2);
const _ptB = new Float32Array(2);
const _wp3 = new Float32Array(3);
const _wp3b = new Float32Array(3);
const _prj2 = new Float32Array(2);

export class GalaxyRenderer {
  constructor() {
    /** 视图状态：x/y 为基准面中心（策略坐标 0..1000，与相机目标同步），zoom 0.5..4 */
    this.view = { x: WORLD / 2, y: WORLD / 2, zoom: 1 };
    /** @type {import('./CanvasManager.js').CanvasManager|null} */
    this.cm = null;
    /** 最新快照引用（视图通过 setSnapshot 更新；渲染循环读最新值） */
    this._snapshot = null;
    /** 悬停命中的星系 id（视图直接写 renderer._hoverId 或调用 setHover） */
    this._hoverId = null;
    this._bgKey = '';    // 背景渐变缓存键（w×h，2D 路径用）
    this._bgGrad = null; // 背景渐变缓存
    this._stars = null;  // 程序化静态星点（世界坐标，懒构建一次）

    // —— R3：轨道相机与渲染路径状态 ——
    /** 相机姿态：pitch/yaw（弧度）；目标点即 view.x/y 映射的基准面点 */
    this._cam = { pitch: 55 * (Math.PI / 180), yaw: 0 };
    /** 上一帧实际使用的渲染路径（'gl' | '2d'），供 pick/坐标换算保持一致 */
    this._mode = '2d';
    /** GL 资源容器（首次 GL 帧懒构建；构建失败置 _glBroken 走 2D） */
    this._gl3d = null;
    this._glBroken = false;
    this._offGLState = null;

    // 相机矩阵（实例持有，供 render/pick/坐标换算复用）
    this._mView = new Float32Array(16);
    this._mProj = new Float32Array(16);
    this._mVP = new Float32Array(16);
    this._mIVP = new Float32Array(16);
    mat4Identity(this._mView);
    mat4Identity(this._mProj);
    mat4Identity(this._mVP);
    mat4Identity(this._mIVP);
    this._camEye = new Float32Array(3);
    this._camCtr = new Float32Array(3);
    this._frameW = 0; // 与 _mVP 配套的视口逻辑尺寸（0 表示矩阵未就绪）
    this._frameH = 0;
    /** 相机代次：panBy/zoomAt/旋转递增；_frameVersion 落后即表示实例矩阵过期 */
    this._camVersion = 0;
    this._frameVersion = -1;

    // pick 投影缓存（每帧 render 更新；相机变化后置脏懒重建）
    /** @type {Map<string|number, {id:any, s:object, sx:number, sy:number, vis:boolean}>} */
    this._projCache = new Map();
    /** @type {Array<{id:any, s:object, sx:number, sy:number, vis:boolean}>} */
    this._pickList = [];
    this._projValid = false;
    this._projSnap = null;

    // GL 场景动态数据（预分配，每帧覆写）
    this._spriteData = new Float32Array(1024 * 12);
    this._spriteCount = 0;
    this._shellData = new Float32Array(128 * 8);
    this._shellCount = 0;
    this._lineData = new Float32Array(6000 * 7);
    this._lineVerts = 0;
    this._byId = null;
    this._facHex = null;
    this._facRgb = null;
    this._novaSeeds = null;
    this._novaSnap = null;

    // 右键/中键旋转拖拽状态（监听器仅拖拽期间存在于 window）
    this._rot = { active: false, x: 0, y: 0 };
    this._rotDetach = null;
  }

  /**
   * 绑定画布管理器；持有 GL 时注册上下文恢复重建钩子，并挂载右/中键旋转交互。
   * @param {import('./CanvasManager.js').CanvasManager} canvasManager
   */
  init(canvasManager) {
    this.cm = canvasManager || null;
    if (this._offGLState) {
      try { this._offGLState(); } catch (_) { /* 忽略注销异常 */ }
      this._offGLState = null;
    }
    this._detachRot();
    if (this.cm) {
      // 上下文恢复（rebuild 成功）后重建本渲染器的 GL 资源；失败收敛为 2D 兜底
      if (typeof this.cm.onGLStateChange === 'function') {
        this._offGLState = this.cm.onGLStateChange((degraded) => {
          if (degraded) return; // 丢失：render 自动走 _render2D
          this._glBroken = false;
          if (this._gl3d && this.cm && this.cm.glc) {
            try {
              this._gl3d.rebuild(this.cm.glc);
            } catch (e) {
              console.error('[GalaxyRenderer] GL 资源重建失败，退回 2D:', e);
              this._glBroken = true;
            }
          }
        });
      }
      // 旋转交互：仅当画布支持事件监听时挂载（桩环境/极简 cm 下静默跳过）
      if (this.cm.canvas && typeof this.cm.canvas.addEventListener === 'function') {
        this._attachRot(this.cm.canvas);
      }
    }
    return this;
  }

  /** 更新渲染用的最新快照引用（不复制、不修改） */
  setSnapshot(snap) {
    this._snapshot = snap || null;
  }

  /** 更新悬停星系 id */
  setHover(id) {
    this._hoverId = id || null;
  }

  // —— 路径判定 ——————————————————————————————————

  /** 当前视口宽（逻辑像素） */
  _vw() { return this.cm ? this.cm.width : 0; }
  /** 当前视口高（逻辑像素） */
  _vh() { return this.cm ? this.cm.height : 0; }

  /** GL 路径可用性（快照有效性由调用方另行判断） */
  _glActive() {
    const cm = this.cm;
    return !!(cm && cm.hasGL && cm.tier < 3 && !cm.glDegraded && !this._glBroken);
  }

  // —— 视图变换（GL：轨道相机；2D：旧平面映射） ——————————————————

  /**
   * 屏幕坐标 → 世界（策略）坐标。
   * GL 路径：经相机矩阵反投影射线与 z=0 基准面求交（单选/移动命令坐标一致）；
   * 无交点（射线背向/平行）时回退当前目标点。
   */
  screenToWorld(sx, sy) {
    if (this._mode === 'gl') {
      const p = this._planePointAt(sx, sy, _ptTmp, NaN);
      if (p) {
        return { x: p[0] / WORLD_SCALE + 500, y: p[1] / WORLD_SCALE + 500 };
      }
      return { x: this.view.x, y: this.view.y };
    }
    const z = this.view.zoom;
    return {
      x: (sx - this._vw() / 2) / z + this.view.x,
      y: (sy - this._vh() / 2) / z + this.view.y,
    };
  }

  /**
   * 世界（策略）坐标 → 屏幕坐标（返回 [sx, sy]）。
   * GL 路径投影基准面点 (wx, wy, 0)；相机矩阵未就绪时退回 2D 公式。
   */
  worldToScreen(wx, wy) {
    if (this._mode === 'gl') {
      // 相机在渲染帧之间被 pan/zoom/旋转改动过 → 重建实例矩阵，保证交互期坐标一致
      if (this._frameVersion !== this._camVersion || this._frameW <= 0) {
        this._computeCamera(this._vw(), this._vh());
      }
      if (this._frameW > 0) {
        this._projectToScreen((wx - 500) * WORLD_SCALE, (wy - 500) * WORLD_SCALE, 0, _prj2);
        return [_prj2[0], _prj2[1]];
      }
    }
    const z = this.view.zoom;
    return [
      (wx - this.view.x) * z + this._vw() / 2,
      (wy - this.view.y) * z + this._vh() / 2,
    ];
  }

  /**
   * 按屏幕像素平移视图（dx/dy 为屏幕位移）。
   * GL 路径沿相机右向量与基准面投影上向量移动目标（保持目标在基准面上，
   * 使 screenToWorld 的射线求交导航稳定）；比例取目标深度处的 世界/像素 系数。
   */
  panBy(dx, dy) {
    if (this._mode === 'gl') {
      const w = this._vw();
      const h = this._vh();
      if (w > 1 && h > 1) {
        const cam = this._computeCamera(w, h); // 仅为取 世界/像素 系数 k
        if (cam) {
          const k = cam.k;
          const fx = Math.cos(this._cam.yaw);
          const fy = Math.sin(this._cam.yaw);
          const rx = -Math.sin(this._cam.yaw);
          const ry = Math.cos(this._cam.yaw);
          // 拖拽方向 = 内容跟随光标：目标沿 -右(-dx) 与 屏幕上(=基准面投影 up = -forward)(+dy) 移动
          const dwx = (-dx * rx - dy * fx) * k;
          const dwy = (-dx * ry - dy * fy) * k;
          this.view.x += dwx / WORLD_SCALE;
          this.view.y += dwy / WORLD_SCALE;
          this._clampView();
          this._camVersion++;
          this._projValid = false;
          return;
        }
      }
    }
    const z = this.view.zoom || 1;
    // 软边界：防止把星图拖丢（世界 0..1000，放宽 ±200）
    this.view.x = Math.min(WORLD + 200, Math.max(-200, this.view.x - dx / z));
    this.view.y = Math.min(WORLD + 200, Math.max(-200, this.view.y - dy / z));
    this._camVersion++;
    this._projValid = false;
  }

  /**
   * 以屏幕点 (sx,sy) 为锚缩放（factor>1 放大），zoom clamp 0.5–4（等比驱动轨道半径）。
   * GL 路径：缩放前后光标下的基准面交点保持不动（平移目标补偿透视差）。
   */
  zoomAt(sx, sy, factor) {
    if (this._mode === 'gl') {
      const w = this._vw();
      const h = this._vh();
      if (w > 1 && h > 1) {
        const before = this._planePointAt(sx, sy, _ptA, NaN);
        const z1 = Math.min(4, Math.max(0.5, (this.view.zoom || 1) * factor));
        if (before) {
          const after = this._planePointAt(sx, sy, _ptB, CAM_R0 / z1);
          if (after) {
            this.view.x += (before[0] - after[0]) / WORLD_SCALE;
            this.view.y += (before[1] - after[1]) / WORLD_SCALE;
          }
        }
        this.view.zoom = z1;
        this._clampView();
        this._camVersion++;
        this._projValid = false;
        return;
      }
    }
    const before = this.screenToWorld(sx, sy); // 光标下的世界点（缩放前后不动）
    const z = Math.min(4, Math.max(0.5, this.view.zoom * factor));
    this.view.zoom = z;
    this.view.x = before.x - (sx - this._vw() / 2) / z;
    this.view.y = before.y - (sy - this._vh() / 2) / z;
    this._clampView();
    this._camVersion++;
    this._projValid = false;
  }

  /** 视图中心软边界约束（与旧版一致：策略坐标 -200..1200） */
  _clampView() {
    this.view.x = Math.min(WORLD + 200, Math.max(-200, this.view.x));
    this.view.y = Math.min(WORLD + 200, Math.max(-200, this.view.y));
  }

  // —— 相机矩阵与拾取投影 ——————————————————————————————————

  /**
   * 构建轨道相机矩阵组（写入调用方提供的缓冲）。
   * eye = target + R·(cosP·cosY, cosP·sinY, sinP)，up = +Z（pitch 限幅内不退化）。
   */
  _buildCameraInto(w, h, radius, view, proj, vp, ivp, eye, ctr) {
    const cp = Math.cos(this._cam.pitch);
    const sp = Math.sin(this._cam.pitch);
    const cy = Math.cos(this._cam.yaw);
    const sy = Math.sin(this._cam.yaw);
    const tx = (this.view.x - 500) * WORLD_SCALE;
    const ty = (this.view.y - 500) * WORLD_SCALE;
    eye[0] = tx + radius * cp * cy;
    eye[1] = ty + radius * cp * sy;
    eye[2] = radius * sp;
    ctr[0] = tx;
    ctr[1] = ty;
    ctr[2] = 0;
    mat4LookAt(view, eye, ctr, UP_VEC);
    mat4Perspective(proj, FOV, Math.max(0.1, w / Math.max(1, h)), 0.1, 400);
    mat4Multiply(vp, proj, view);
    if (!mat4Invert(ivp, vp)) mat4Identity(ivp);
  }

  /**
   * 计算当前帧相机：填充实例矩阵 _mView/_mProj/_mVP/_mIVP 并记录配套视口尺寸。
   * @returns {{eye:Float32Array, radius:number, k:number}|null} k = 目标深度处 世界/逻辑像素
   */
  _computeCamera(w, h) {
    if (!(w > 1 && h > 1)) return null;
    const zoom = this.view.zoom || 1;
    const radius = Math.min(CAM_R_MAX, Math.max(CAM_R_MIN, CAM_R0 / zoom));
    this._buildCameraInto(w, h, radius, this._mView, this._mProj, this._mVP, this._mIVP, this._camEye, this._camCtr);
    this._frameW = w;
    this._frameH = h;
    this._frameVersion = this._camVersion;
    const k = (2 * radius * Math.tan(FOV / 2)) / h;
    return { eye: this._camEye, radius, k };
  }

  /**
   * 屏幕像素 → z=0 基准面交点（世界坐标）。
   * @param {number} sx 逻辑像素
   * @param {number} sy 逻辑像素
   * @param {Float32Array} out (2) 输出
   * @param {number} radiusOverride NaN=用当前 zoom 半径（缩放锚定预演时传新半径）
   * @returns {Float32Array|null} out 或 null（视口未就绪 / 射线无交点）
   */
  _planePointAt(sx, sy, out, radiusOverride) {
    const w = this._vw();
    const h = this._vh();
    if (!(w > 1 && h > 1)) return null;
    let radius;
    if (Number.isFinite(radiusOverride)) {
      radius = Math.min(CAM_R_MAX, Math.max(CAM_R_MIN, radiusOverride));
    } else {
      const zoom = this.view.zoom || 1;
      radius = Math.min(CAM_R_MAX, Math.max(CAM_R_MIN, CAM_R0 / zoom));
    }
    this._buildCameraInto(w, h, radius, _tView, _tProj, _tVP, _tIVP, _tEye, _tCtr);
    const nx = (sx / w) * 2 - 1;
    const ny = 1 - (sy / h) * 2;
    _v4a[0] = nx; _v4a[1] = ny; _v4a[2] = -1; _v4a[3] = 1;
    _v4b[0] = nx; _v4b[1] = ny; _v4b[2] = 1; _v4b[3] = 1;
    mat4MulVec4(_v4c, _tIVP, _v4a);
    mat4MulVec4(_v4d, _tIVP, _v4b);
    const w0 = _v4c[3];
    const w1 = _v4d[3];
    if (!(Math.abs(w0) > 1e-9 && Math.abs(w1) > 1e-9)) return null;
    const rox = _v4c[0] / w0;
    const roy = _v4c[1] / w0;
    const roz = _v4c[2] / w0;
    const dxx = _v4d[0] / w1 - rox;
    const dyy = _v4d[1] / w1 - roy;
    const dzz = _v4d[2] / w1 - roz;
    if (Math.abs(dzz) < 1e-6) return null;
    const t = -roz / dzz;
    if (!(t > 0)) return null;
    out[0] = rox + dxx * t;
    out[1] = roy + dyy * t;
    return out;
  }

  /**
   * 世界坐标 → 屏幕逻辑像素（写入 out[0..1]；相机背后返回 -1e5 哨兵）。
   * @param {number} wx 世界 x
   * @param {number} wy 世界 y
   * @param {number} wz 世界 z
   */
  _projectToScreen(wx, wy, wz, out) {
    const m = this._mVP;
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    if (cw <= 1e-6) {
      out[0] = -1e5;
      out[1] = -1e5;
      return out;
    }
    const cx = (m[0] * wx + m[4] * wy + m[8] * wz + m[12]) / cw;
    const cy = (m[1] * wx + m[5] * wy + m[9] * wz + m[13]) / cw;
    out[0] = (cx * 0.5 + 0.5) * this._frameW;
    out[1] = (0.5 - cy * 0.5) * this._frameH;
    return out;
  }

  // —— 命中检测 ——————————————————————————————————

  /**
   * 屏幕点命中检测：返回命中的星系 id 或 null。
   * _pickList 由 _updateProjCache 维护（每帧 render 更新；相机变化后懒重建），
   * 每项为可见星系三维位置经 viewProj 投影的屏幕坐标；命中半径 = max(10, 14/zoom)。
   */
  pick(sx, sy) {
    const snap = this._snapshot;
    if (!snap || !Array.isArray(snap.systems) || !snap.systems.length) return null;
    if (!this._projValid || this._projSnap !== snap) {
      this._updateProjCache(snap, this._vw(), this._vh());
    }
    const r = Math.max(10, 14 / (this.view.zoom || 1));
    let best = null;
    let bestD = Infinity;
    for (const e of this._pickList) {
      if (!e.vis) continue;
      const d = Math.hypot(e.sx - sx, e.sy - sy);
      if (d <= r && d < bestD) {
        best = e.id;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * 重建 pick/HUD 投影缓存：每个星系的三维位置（GL 模式含高度 z）投影到屏幕空间。
   * render() 每帧调用；panBy/zoomAt/旋转置 _projValid=false 后由 pick 懒重建。
   */
  _updateProjCache(snap, w, h) {
    this._projCache.clear();
    this._pickList.length = 0;
    this._projSnap = snap || null;
    this._projValid = false;
    if (!snap || !Array.isArray(snap.systems) || !(w > 1) || !(h > 1)) return;
    const glMode = this._mode === 'gl' && this._glActive();
    // 总是重算相机：panBy/zoomAt/旋转只置脏不回写实例矩阵，此处统一刷新防拾取漂移
    if (glMode) this._computeCamera(w, h);
    for (const s of snap.systems) {
      let sx;
      let sy;
      if (glMode && this._frameW > 0) {
        systemWorldPos(s, _wp3);
        this._projectToScreen(_wp3[0], _wp3[1], _wp3[2], _prj2);
        sx = _prj2[0];
        sy = _prj2[1];
      } else {
        sx = (s.x - this.view.x) * this.view.zoom + w / 2;
        sy = (s.y - this.view.y) * this.view.zoom + h / 2;
      }
      const vis = sx > -80 && sy > -80 && sx < w + 80 && sy < h + 80;
      const entry = { id: s.id, s, sx, sy, vis };
      this._projCache.set(s.id, entry);
      this._pickList.push(entry);
    }
    this._projValid = true;
  }

  // —— 渲染入口 ——————————————————————————————————

  /**
   * 渲染一帧。
   * @param {CanvasRenderingContext2D} ctx HUD 2D 上下文（cm.ctx，dpr 变换已由 beginFrame 设定）
   * @param {number} w 画布逻辑像素宽
   * @param {number} h 画布逻辑像素高
   * @param {object} snapshot App 快照（snapshot.systems / fleets / factions / battles）
   * @param {object} layers 图层开关 { lanes, ownership, claims, resources, danger,
   *                                 fleets, surveys, colonies, trade, fronts }
   * @param {object} opts { selectedId, hoverId, playerFactionId, reducedEffects,
   *                        time(秒，仅动画 uniform), marketSystemIds(Set|Array，trade 层用) }
   */
  render(ctx, w, h, snapshot, layers, opts = {}) {
    const snap = snapshot || this._snapshot;
    if (snap) this._snapshot = snap;
    this._w = w;
    this._h = h;

    const reduced = !!opts.reducedEffects;
    const t = Number(opts.time) || 0;
    const L = { lanes: true, ownership: true, claims: false, resources: false, danger: false,
      fleets: true, surveys: true, colonies: true, trade: false, fronts: true, ...(layers || {}) };

    // 派生共享数据（2D/GL 两条路径共用的查找表）
    this._byId = snap && Array.isArray(snap.systems) ? new Map(snap.systems.map((s) => [s.id, s])) : null;
    this._facHex = new Map(((snap && snap.factions) || []).map((f) => [f.id, f.color || C.ACCENT]));
    this._facRgb = new Map(((snap && snap.factions) || []).map((f) => [f.id, hexToRgb(f.color || C.ACCENT)]));

    // 路径选择：GL（tier<3、有快照）或 2D 退化保护
    const glTry = this._glActive() && snap && Array.isArray(snap.systems);
    this._mode = glTry ? 'gl' : '2d';
    this._updateProjCache(snap, w, h);

    let drewGL = false;
    if (this._mode === 'gl') {
      drewGL = this._renderGLFrame(w, h, snap, L, opts, reduced, t);
    }
    if (!drewGL) {
      // GL 不可用（无 WebGL / tier3 / 上下文丢失 / 帧失败）：本帧起走 2D 并重投影缓存
      this._mode = '2d';
      this._updateProjCache(snap, w, h);
      this._render2D(ctx, w, h, snap, L, opts);
    } else {
      this._drawHud(ctx, w, h, snap, L, opts, reduced, t);
    }
  }

  // —— GL 路径 ————————————————————————————————————————————

  /** 懒构建 GL 资源（失败抛错由调用方捕获并置 _glBroken） */
  _ensureGL3D() {
    if (this._gl3d) return this._gl3d;
    const cm = this.cm;
    if (!cm || !cm.glc) throw new Error('GLContext 缺失');
    const g3 = new Galaxy3D();
    g3.init(cm.glc);
    this._gl3d = g3;
    return g3;
  }

  /** tier → 星系盘粒子档位（40k/15k/6k；cm.post.particleScale 为一致性硬上界） */
  _particleCountFor() {
    const cm = this.cm;
    const tier = cm.tier;
    const table = tier <= 1 ? 40000 : tier === 2 ? 15000 : 6000;
    const scale = cm.post ? (cm.post.particleScale ?? 1) : 1;
    return Math.min(table, Math.round(40000 * Math.max(0, scale)));
  }

  /**
   * GL 帧主体：beginGLFrame → 场景 → endGLFrame。返回 false 表示本帧需回退 2D。
   * 任何 GL 异常都被捕获并置 _glBroken（后续帧走 _render2D），render() 不抛错。
   */
  _renderGLFrame(w, h, snap, L, opts, reduced, t) {
    const cm = this.cm;
    const post = cm.post;
    if (!post || !post.ready) return false;
    const cam = this._computeCamera(w, h);
    if (!cam) return false;
    let g3;
    try {
      g3 = this._ensureGL3D();
    } catch (e) {
      console.error('[GalaxyRenderer] GL 资源构建失败，退回 2D:', e);
      this._glBroken = true;
      return false;
    }
    let began = false;
    try {
      const target = cm.beginGLFrame(); // 绑定场景 FBO + viewport（tier>=3/降级返回 null）
      if (!target) return false;
      began = true;
      const gl = cm.gl;

      // 共享状态：加法混合、深度关（全 additive，绘制顺序不影响合成结果）
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0.0275, 0.0431, 0.0706, 1.0); // C.BG #070b12
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const px = this._mProj[0];
      const py = this._mProj[5];

      // 1) 星系盘：实例化粒子 billboard（一次 drawArraysInstanced）
      const pcount = this._particleCountFor();
      if (pcount > 0 && g3.particleCount > 0) {
        g3.drawDisk(gl, {
          viewProj: this._mVP,
          px,
          py,
          minSize: cam.k * 0.9,
          count: Math.min(pcount, g3.particleCount),
          time: reduced ? 0 : t,
        });
      }

      // 2) 体积星云全屏 pass（粒子之后、HUD 之前；uSteps 按 tier 24/14/0）
      const steps = cm.tier <= 1 ? 24 : cm.tier === 2 ? 14 : 0;
      if (steps > 0 && !reduced) {
        g3.drawNebula(gl, {
          invViewProj: this._mIVP,
          time: t,
          steps,
          gain: NEBULA_GAIN,
        });
      }

      // 3) 航路 + 垂直投影标尺线（一次性动态缓冲）
      this._buildLines(snap, L);
      if (this._lineVerts > 0) {
        g3.drawLines(gl, this._lineData, this._lineVerts, { viewProj: this._mVP });
      }

      // 4) 星系节点 / 归属光晕 / 势力环（billboard 核心 + 环带）
      this._buildSprites(snap, L, cam);
      if (this._spriteCount > 0) {
        g3.drawSprites(gl, this._spriteData, this._spriteCount, { viewProj: this._mVP, px, py });
      }

      // 5) 超新星球壳（dangerRating>6 / 黑洞 / 脉冲星；additive imposter）
      this._buildShells(snap);
      if (this._shellCount > 0) {
        g3.drawShell(gl, this._shellData, this._shellCount, {
          view: this._mView,
          proj: this._mProj,
          px,
          py,
          time: reduced ? 0 : t,
        });
      }
      void opts;
    } catch (e) {
      console.error('[GalaxyRenderer] GL 帧绘制失败，退回 2D 路径:', e);
      this._glBroken = true;
    }
    if (!began) return false;
    try {
      cm.endGLFrame({ bloom: reduced ? 0.5 : 0.95, exposure: 1.12, time: t });
    } catch (_) { /* 后处理异常不致命：下一帧按 _glBroken 走 2D */ }
    return true;
  }

  /** 航路 + 垂直标尺线几何（写入 _lineData；上限 3000 段，超出截断） */
  _buildLines(snap, L) {
    const arr = this._lineData;
    const cap = arr.length / 7;
    let v = 0;
    const pushV = (x, y, z, rgb, a) => {
      if (v >= cap) return;
      const o = v * 7;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
      arr[o + 3] = rgb[0]; arr[o + 4] = rgb[1]; arr[o + 5] = rgb[2];
      arr[o + 6] = a;
      v++;
    };
    const byId = this._byId;
    if (L.lanes && byId) {
      for (const s of snap.systems) {
        systemWorldPos(s, _wp3);
        const ax = _wp3[0];
        const ay = _wp3[1];
        const az = _wp3[2];
        for (const laneId of s.lanes || []) {
          if (laneId <= s.id) continue; // 字符串序去重：每条航路只画一次
          const other = byId.get(laneId);
          if (!other) continue;
          systemWorldPos(other, _wp3b);
          const known = (s.surveyedLevel ?? 0) >= 1 && (other.surveyedLevel ?? 0) >= 1;
          const a = known ? LANE_A_KNOWN : LANE_A_DIM;
          pushV(ax, ay, az, ACCENT_RGB, a);
          pushV(_wp3b[0], _wp3b[1], _wp3b[2], ACCENT_RGB, a);
        }
      }
    }
    // 垂直投影标尺线：三维位置 → 基准面（z=0）
    for (const s of snap.systems) {
      systemWorldPos(s, _wp3);
      pushV(_wp3[0], _wp3[1], _wp3[2], INK_RGB, STALK_A);
      pushV(_wp3[0], _wp3[1], 0, INK_RGB, STALK_A);
    }
    this._lineVerts = v;
  }

  /** 星系节点 / 归属光晕 / 势力环实例（写入 _spriteData；尺寸按屏幕像素×k 换算世界单位） */
  _buildSprites(snap, L, cam) {
    const arr = this._spriteData;
    const cap = arr.length / 12;
    const k = cam.k;
    const z = this.view.zoom || 1;
    const sizeK = Math.min(1.5, Math.max(0.8, z));
    let n = 0;
    const push = (p3, size, ar, ag, ab, aa, br, bg, bb, ba) => {
      if (n >= cap) return;
      const o = n * 12;
      arr[o] = p3[0]; arr[o + 1] = p3[1]; arr[o + 2] = p3[2];
      arr[o + 3] = size;
      arr[o + 4] = ar; arr[o + 5] = ag; arr[o + 6] = ab; arr[o + 7] = aa;
      arr[o + 8] = br; arr[o + 9] = bg; arr[o + 10] = bb; arr[o + 11] = ba;
      n++;
    };
    for (const s of snap.systems) {
      systemWorldPos(s, _wp3);
      const lvl = s.surveyedLevel ?? 0;
      const typeId = s.star && s.star.typeId;
      // 归属势力光晕（软高斯薄雾：半径收敛 + 低强度，避免吞没星盘）
      if (L.ownership && s.ownerFactionId) {
        const oc = this._facRgb.get(s.ownerFactionId) || ACCENT_RGB;
        push(_wp3, 11 * k, oc[0] * 0.45, oc[1] * 0.45, oc[2] * 0.45, 0.010, 0, 0, 0, 0);
      }
      // 节点核心
      if (lvl === 0) {
        // 未探索：暗灰小光斑
        push(_wp3, 2.2 * sizeK * k * 2.4, UNSEEN_RGB[0], UNSEEN_RGB[1], UNSEEN_RGB[2], 0.5, 0, 0, 0, 0);
      } else if (typeId === 'blackHole') {
        // 黑洞：暗核 + 琥珀吸积环
        push(_wp3, 2.2 * sizeK * k * 2.0, 0.06, 0.07, 0.09, 0.8, 0, 0, 0, 0);
        push(_wp3, (5.5 * sizeK * k) / 0.75, 0, 0, 0, 0, WARN_RGB[0], WARN_RGB[1], WARN_RGB[2], 0.85);
      } else {
        const baseR = (STAR_SIZES[typeId] || 3.2) * sizeK;
        const sc = STAR_RGB[typeId] || INK_RGB;
        const inten = lvl >= 4 ? 2.0 : 1.15;
        push(_wp3, baseR * 2.4 * k, sc[0], sc[1], sc[2], inten, 0, 0, 0, 0);
        if (lvl >= 4) {
          // 全亮辉光垫底
          push(_wp3, baseR * 5.2 * k, sc[0], sc[1], sc[2], 0.16, 0, 0, 0, 0);
        }
        if (typeId === 'pulsar' || typeId === 'neutronStar') {
          // 脉冲星：外围十字光近似（大半径微光斑）
          push(_wp3, baseR * 4.6 * k, sc[0], sc[1], sc[2], 0.5, 0, 0, 0, 0);
        }
      }
      // 外圈（归属势力色 / 无主灰）
      const orc = s.ownerFactionId ? (this._facRgb.get(s.ownerFactionId) || ACCENT_RGB) : INK_DIM_RGB;
      const ringA = lvl === 0 ? 0.28 : 0.9;
      push(_wp3, (7 * sizeK * k) / 0.75, 0, 0, 0, 0, orc[0], orc[1], orc[2], ringA);
    }
    this._spriteCount = n;
  }

  /** 超新星球壳实例（dangerRating>6 / 黑洞 / 脉冲星；写入 _shellData） */
  _buildShells(snap) {
    const arr = this._shellData;
    const cap = arr.length / 8;
    if (this._novaSnap !== snap) {
      this._novaSeeds = generateSupernovaSeeds(snap.systems, WORLD_SCALE);
      this._novaSnap = snap;
    }
    const z = this.view.zoom || 1;
    const base = SHELL_R_BASE / Math.sqrt(Math.max(0.5, z));
    let n = 0;
    for (let i = 0; i < snap.systems.length; i++) {
      const s = snap.systems[i];
      const typeId = s.star && s.star.typeId;
      const danger = s.dangerRating ?? 0;
      if (danger <= 6 && typeId !== 'blackHole' && typeId !== 'pulsar') continue;
      const rgb = danger > 6 ? DANGER_RGB : typeId === 'blackHole' ? WARN_RGB : STAR_RGB.pulsar;
      systemWorldPos(s, _wp3);
      if (n >= cap) break;
      const o = n * 8;
      arr[o] = _wp3[0];
      arr[o + 1] = _wp3[1];
      arr[o + 2] = _wp3[2];
      arr[o + 3] = base;
      arr[o + 4] = rgb[0];
      arr[o + 5] = rgb[1];
      arr[o + 6] = rgb[2];
      const seeds = this._novaSeeds;
      arr[o + 7] = seeds && i < seeds.length ? seeds[i] : ((i * 0.618034) % 1);
      n++;
    }
    this._shellCount = n;
  }

  // —— HUD（2D 透明层；GL 模式下所有坐标来自 _projCache 投影） ————————

  /** GL 模式取星系屏幕坐标：优先 _projCache（三维位置投影），缺省退 worldToScreen */
  _hudPosFn() {
    const cache = this._projCache;
    const self = this;
    return (s) => {
      const e = cache.get(s.id);
      if (e) return [e.sx, e.sy];
      return self.worldToScreen(s.x, s.y);
    };
  }

  /** 构建世界锚定静态星点（一次） */
  _buildStars() {
    const stars = [];
    const N = 260;
    for (let i = 0; i < N; i++) {
      stars.push({
        x: hash01(i) * WORLD,
        y: hash01(i * 1.37 + 7.31) * WORLD,
        r: 0.5 + hash01(i * 2.11 + 13.7) * 1.3,
        a: 0.12 + hash01(i * 3.73 + 29.1) * 0.5,
      });
    }
    this._stars = stars;
  }

  /** GL 模式背景星点（透明 HUD 上叠画，经矩阵投影保持世界锚定） */
  _drawHudStars(ctx, w, h) {
    if (!this._stars) this._buildStars();
    const m = 60; // 视口外剔除边距
    for (const st of this._stars) {
      const p = this.worldToScreen(st.x, st.y);
      if (p[0] < -m || p[1] < -m || p[0] > w + m || p[1] > h + m) continue;
      ctx.fillStyle = `rgba(201,214,227,${st.a * 0.8})`;
      ctx.fillRect(p[0] - st.r / 2, p[1] - st.r / 2, st.r, st.r);
    }
  }

  /** GL 模式 HUD：星点 → 势力范围 → 星系标记 → 舰队 → 标签 → 前线 */
  _drawHud(ctx, w, h, snap, L, opts, reduced, t) {
    ctx.clearRect(0, 0, w, h);
    if (this._mode !== 'gl') this._drawHudStars(ctx, w, h);
    if (!snap || !Array.isArray(snap.systems)) return;
    const facColor = this._facHex;
    const posFn = this._hudPosFn();
    // 势力范围雾效已由 GL 通道的归属光晕承担（HUD 层不再叠加 R=90 渐变圆，
    // 否则 16 星系渐变叠加会形成吞没星盘的巨型色球）
    const sizeK = Math.min(1.5, Math.max(0.8, this.view.zoom));
    for (const s of snap.systems) {
      const p = posFn(s);
      const sx = p[0];
      const sy = p[1];
      if (sx < -60 || sy < -60 || sx > w + 60 || sy > h + 60) continue;
      const ownerColor = s.ownerFactionId ? (facColor.get(s.ownerFactionId) || C.ACCENT) : C.INK_DIM;
      this._drawSystemOverlays(ctx, s, sx, sy, sizeK, ownerColor, facColor, L, opts, reduced, t);
    }
    if (L.fleets) this._drawFleets(ctx, snap, facColor, posFn);
    this._drawLabels(ctx, snap, facColor, posFn);
    if (L.fronts) this._drawFronts(ctx, snap, reduced, t, posFn);
  }

  // —— 2D 路径（原实现完整保留：webglcontextlost / Tier3 / 无 WebGL 退化保护） ——

  /**
   * 2D 渲染一帧（传入已合并默认值的图层开关 L）。
   * @param {CanvasRenderingContext2D} ctx 2D 上下文
   */
  _render2D(ctx, w, h, snap, L, opts) {
    const reduced = !!opts.reducedEffects;
    const t = Number(opts.time) || 0;
    const facColor = this._facHex;

    // 1) 背景深空渐变 + 程序化静态星点
    this._drawBackground(ctx, w, h);

    if (!snap || !Array.isArray(snap.systems)) return;

    // 2) 航路（两端 surveyedLevel>=1 实线 0.25，否则 0.08）
    if (L.lanes) this._drawLanes(ctx, snap);

    // 3) 势力范围光晕
    if (L.ownership) this._drawOwnership(ctx, snap, facColor, reduced, null);

    // 4) 星系节点（含 claims / danger / surveys / colonies / trade 叠加层）
    this._drawSystems(ctx, snap, this._byId, facColor, L, opts, reduced, t);

    // 5) 舰队图标（同系多队横向偏移）
    if (L.fleets) this._drawFleets(ctx, snap, facColor, null);

    // 6) 标签（zoom<0.8 时按 y 贪心抽稀）
    this._drawLabels(ctx, snap, facColor, null);

    // 7) 战争前线（战斗星系脉冲环，置于最上）
    if (L.fronts) this._drawFronts(ctx, snap, reduced, t, null);
  }

  /** 背景深空渐变 + 世界锚定的静态星点（2D 路径） */
  _drawBackground(ctx, w, h) {
    const key = `${w}x${h}`;
    if (this._bgKey !== key) {
      const g = ctx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h / 2, Math.max(w, h) * 0.78);
      g.addColorStop(0, C.BG_DEEP);
      g.addColorStop(1, C.BG);
      this._bgGrad = g;
      this._bgKey = key;
    }
    ctx.fillStyle = this._bgGrad;
    ctx.fillRect(0, 0, w, h);

    if (!this._stars) this._buildStars();
    const m = 60; // 视口外剔除边距
    for (const st of this._stars) {
      const [sx, sy] = this.worldToScreen(st.x, st.y);
      if (sx < -m || sy < -m || sx > w + m || sy > h + m) continue;
      ctx.fillStyle = `rgba(201,214,227,${st.a})`;
      ctx.fillRect(sx - st.r / 2, sy - st.r / 2, st.r, st.r);
    }
  }

  /** 航路：两端均已侦测(surveyedLevel>=1) → 0.25 实线，否则 0.08（2D 路径） */
  _drawLanes(ctx, snap) {
    const byId = this._byId;
    if (!byId) return;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let knownPath = false;
    // 分两批描边，减少状态切换：先画已知（亮），再画未知（暗）
    const dimSegs = [];
    for (const s of snap.systems) {
      for (const laneId of s.lanes || []) {
        if (laneId <= s.id) continue; // 字符串序去重：每条航路只画一次
        const other = byId.get(laneId);
        if (!other) continue;
        const known = (s.surveyedLevel ?? 0) >= 1 && (other.surveyedLevel ?? 0) >= 1;
        if (known) {
          const [ax, ay] = this.worldToScreen(s.x, s.y);
          const [bx, by2] = this.worldToScreen(other.x, other.y);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by2);
          knownPath = true;
        } else {
          dimSegs.push([s.x, s.y, other.x, other.y]);
        }
      }
    }
    if (knownPath) {
      ctx.strokeStyle = rgba(C.ACCENT, 0.25);
      ctx.stroke();
    }
    ctx.beginPath();
    for (const [ax, ay, bx, by2] of dimSegs) {
      const [x1, y1] = this.worldToScreen(ax, ay);
      const [x2, y2] = this.worldToScreen(bx, by2);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = rgba(C.ACCENT, 0.08);
    ctx.stroke();
  }

  /** 势力范围：每个有主星系画一层大半径径向渐变（faction.color, alpha 0.05） */
  _drawOwnership(ctx, snap, facColor, reduced, posFn) {
    const at = posFn || ((s) => this.worldToScreen(s.x, s.y));
    const R = 90; // 世界单位半径
    for (const s of snap.systems) {
      if (!s.ownerFactionId) continue;
      const color = facColor.get(s.ownerFactionId) || C.ACCENT;
      const p = at(s);
      const sx = p[0];
      const sy = p[1];
      const sr = R * this.view.zoom;
      if (sx < -sr || sy < -sr || sx > this._w + sr || sy > this._h + sr) continue;
      if (reduced) {
        // 减少动效：以平涂替代径向渐变
        ctx.fillStyle = rgba(color, 0.04);
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        g.addColorStop(0, rgba(color, 0.05));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 星系节点主体（2D 路径）。
   * surveyedLevel 0 → 暗灰小点（无名字）；1–3 → 按恒星类型的星点（黑洞吸积环 / 脉冲星十字光）；
   * 4 → 全亮（带辉光）；随后绘制共享叠加层 _drawSystemOverlays。
   */
  _drawSystems(ctx, snap, byId, facColor, L, opts, reduced, t) {
    const z = this.view.zoom;
    const sizeK = Math.min(1.5, Math.max(0.8, z)); // 节点随缩放的轻微尺寸响应
    const M = 60; // 视口外剔除边距

    for (const s of snap.systems) {
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      if (sx < -M || sy < -M || sx > this._w + M || sy > this._h + M) continue;
      const lvl = s.surveyedLevel ?? 0;
      const ownerColor = s.ownerFactionId ? (facColor.get(s.ownerFactionId) || C.ACCENT) : C.INK_DIM;

      // —— 星点本体 ——
      if (lvl === 0) {
        // 未探索：暗灰小点，无任何额外信息
        ctx.fillStyle = C.NODE_UNSEEN;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2 * sizeK, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const typeId = s.star && s.star.typeId;
        const baseR = (STAR_SIZES[typeId] || 3.2) * sizeK;
        const color = STAR_COLORS[typeId] || C.INK;
        if (lvl >= 4) {
          // 全亮：低配辉光（大半透明圆垫底）
          ctx.fillStyle = rgba(color, 0.18);
          ctx.beginPath();
          ctx.arc(sx, sy, baseR * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (typeId === 'blackHole') {
          // 黑洞：暗核 + 吸积环
          ctx.fillStyle = '#111318';
          ctx.beginPath();
          ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(C.WARN, 0.85);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR + 1.8, 0, Math.PI * 2);
          ctx.stroke();
        } else if (typeId === 'pulsar' || typeId === 'neutronStar') {
          // 脉冲星：十字光 + 亮核
          ctx.strokeStyle = rgba(color, 0.65);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx - baseR * 3, sy);
          ctx.lineTo(sx + baseR * 3, sy);
          ctx.moveTo(sx, sy - baseR * 3);
          ctx.lineTo(sx, sy + baseR * 3);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR * 0.9, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // —— 叠加层（悬停/选中/势力环/信息标记） ——
      this._drawSystemOverlays(ctx, s, sx, sy, sizeK, ownerColor, facColor, L, opts, reduced, t);
    }
  }

  /**
   * 星系叠加层（2D/GL 共用，坐标由调用方给出）：
   * 势力环、悬停圈、选中呼吸圈、danger>6 红环、claims/resources/danger/surveys/
   * colonies/trade 信息标记。
   */
  _drawSystemOverlays(ctx, s, sx, sy, sizeK, ownerColor, facColor, L, opts, reduced, t) {
    void facColor;
    // —— 外圈（归属势力色 / 无主灰） ——
    ctx.strokeStyle = rgba(ownerColor, 0.9);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, 7 * sizeK, 0, Math.PI * 2);
    ctx.stroke();

    // —— 悬停圈 ——
    if (opts.hoverId && opts.hoverId === s.id) {
      ctx.strokeStyle = rgba(C.INK, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 9.5 * sizeK, 0, Math.PI * 2);
      ctx.stroke();
    }

    // —— 选中：高亮圈 + 呼吸动画（reduced 时静止） ——
    if (opts.selectedId === s.id) {
      const pulse = reduced ? 0 : Math.sin(t * 3) * 1.6;
      ctx.strokeStyle = rgba(C.ACCENT, 0.95);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, (11 + pulse) * sizeK, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.ACCENT, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, (14 + pulse) * sizeK, 0, Math.PI * 2);
      ctx.stroke();
    }

    // —— danger > 6：红色细环（常显，不依赖 danger 图层） ——
    if ((s.dangerRating ?? 0) > 6) {
      ctx.strokeStyle = rgba(C.DANGER, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 9 * sizeK, 0, Math.PI * 2);
      ctx.stroke();
    }

    // —— 叠加层（按图层开关） ——
    if (L.claims && s.ownerFactionId) {
      // 领土主张：势力色虚线边界圈
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = rgba(ownerColor, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 15 * sizeK, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (L.resources && (s.surveyedLevel ?? 0) >= 1) {
      // 资源富集：节点下色条 + 评级小字（resourceRating 0..10）
      const rating = Math.min(10, Math.max(0, s.resourceRating ?? 0));
      const bw = 14;
      ctx.fillStyle = rgba(C.LINE, 0.9);
      ctx.fillRect(sx - bw / 2, sy + 10, bw, 2.5);
      ctx.fillStyle = rgba(C.OK, 0.35 + rating / 10 * 0.65);
      ctx.fillRect(sx - bw / 2, sy + 10, bw * (rating / 10), 2.5);
      ctx.fillStyle = rgba(C.INK_FAINT, 0.95);
      ctx.font = `8px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(rating.toFixed(1), sx + bw / 2 + 3, sy + 7.5);
    }
    if (L.danger) {
      // 危险度色环：warn(低) → danger(高)
      const d = Math.min(10, Math.max(0, s.dangerRating ?? 0));
      if (d > 0.5) {
        const col = d <= 4 ? C.WARN : C.DANGER;
        ctx.strokeStyle = rgba(col, Math.min(0.85, 0.15 + d / 10));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 10.5 * sizeK, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (L.surveys && (s.surveyedLevel ?? 0) >= 1) {
      // 扫描覆盖：调查层级进度弧（lvl/4 圆周）
      const lvl = Math.min(4, s.surveyedLevel ?? 0);
      ctx.strokeStyle = rgba(C.ACCENT, lvl >= 4 ? 0.9 : 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 13 * sizeK, -Math.PI / 2, -Math.PI / 2 + (lvl / 4) * Math.PI * 2);
      ctx.stroke();
    }
    if (L.colonies && (s.colonyCount ?? 0) > 0) {
      // 殖民状态：白色方旗标记 + 数量
      ctx.fillStyle = rgba(C.INK, 0.95);
      ctx.fillRect(sx + 7, sy - 12, 5, 5);
      ctx.strokeStyle = rgba('#070b12', 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 7, sy - 12, 5, 5);
      if (s.colonyCount > 1) {
        ctx.fillStyle = rgba(C.INK, 0.9);
        ctx.font = `8px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(s.colonyCount), sx + 13, sy - 12);
      }
    }
    if (L.trade) {
      // 贸易流：有市场星系画 ◇（琥珀色菱形轮廓）
      const markets = opts.marketSystemIds || null;
      const hasMarket = markets && typeof markets.has === 'function' ? markets.has(s.id) : false;
      if (hasMarket) {
        const r = 4;
        ctx.strokeStyle = rgba(C.WARN, 0.9);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 14 - r);
        ctx.lineTo(sx + r, sy - 14);
        ctx.lineTo(sx, sy - 14 + r);
        ctx.lineTo(sx - r, sy - 14);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  /** 舰队图标：systemId 非空（在系停靠）的舰队画 ▲ 小三角，同系多队横向偏移 */
  _drawFleets(ctx, snap, facColor, posFn) {
    const at = posFn || ((s) => this.worldToScreen(s.x, s.y));
    // 按 systemId 分组（保持确定性顺序）
    const groups = new Map();
    for (const f of snap.fleets || []) {
      if (!f.systemId) continue; // 在途舰队 systemId 为空，不上图
      if (!groups.has(f.systemId)) groups.set(f.systemId, []);
      groups.get(f.systemId).push(f);
    }
    for (const [systemId, list] of groups) {
      const sys = (snap.systems || []).find((s) => s.id === systemId);
      if (!sys) continue;
      const p = at(sys);
      const sx = p[0];
      const sy = p[1];
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const f = list[i];
        const x = sx + (i - (n - 1) / 2) * 9;
        const y = sy + 14;
        const color = facColor.get(f.factionId) || C.ACCENT;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x - 4, y + 3);
        ctx.lineTo(x + 4, y + 3);
        ctx.closePath();
        ctx.fillStyle = rgba(color, 0.95);
        ctx.fill();
        ctx.strokeStyle = rgba(C.BG, 0.8); // 深色描边保证与背景分离
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  /**
   * 标签：surveyedLevel>=1 显示名字；zoom<0.8 时按 y 排序做贪心抽稀
   * （纵向间距 <12px 的后者隐藏）。名字白色 10px，有主星系在名字前加 owner 色点。
   */
  _drawLabels(ctx, snap, facColor, posFn) {
    const at = posFn || ((s) => this.worldToScreen(s.x, s.y));
    const showAll = this.view.zoom >= 0.8;
    const candidates = [];
    for (const s of snap.systems) {
      if ((s.surveyedLevel ?? 0) < 1) continue; // 未探索无名字
      const p = at(s);
      const sx = p[0];
      const sy = p[1];
      if (sx < -30 || sy < -16 || sx > this._w + 30 || sy > this._h + 16) continue;
      candidates.push({ s, sx, sy });
    }
    candidates.sort((a, b) => a.sy - b.sy); // 按 y 排序

    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lastY = -Infinity;
    for (const c of candidates) {
      if (!showAll) {
        // 贪心抽稀：与上一个已显示标签纵向间距 <12px 则隐藏
        if (c.sy - lastY < 12) continue;
        lastY = c.sy;
      }
      const ownerColor = c.s.ownerFactionId ? (facColor.get(c.s.ownerFactionId) || C.ACCENT) : null;
      let tx = c.sx + 12;
      if (ownerColor) {
        ctx.fillStyle = rgba(ownerColor, 0.95);
        ctx.beginPath();
        ctx.arc(c.sx + 8, c.sy, 2, 0, Math.PI * 2);
        ctx.fill();
        tx = c.sx + 13;
      }
      ctx.fillStyle = rgba(C.LABEL, 0.92);
      ctx.fillText(String(c.s.name || ''), tx, c.sy);
    }
  }

  /** 战争前线：有进行中战斗的星系画红色脉冲环 */
  _drawFronts(ctx, snap, reduced, t, posFn) {
    const at = posFn || ((s) => this.worldToScreen(s.x, s.y));
    const battles = snap.battles || [];
    const byId = this._byId || new Map((snap.systems || []).map((s) => [s.id, s]));
    for (const b of battles) {
      const sys = byId.get(b.systemId);
      if (!sys) continue;
      const p = at(sys);
      const sx = p[0];
      const sy = p[1];
      const pulse = reduced ? 0 : Math.sin(t * 4) * 2;
      ctx.strokeStyle = rgba(C.DANGER, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 14 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.DANGER, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 19 + pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // —— 右键 / 中键旋转交互（渲染器自持，不触碰 GalaxyView） ————————————

  /**
   * 在 cm.canvas 上挂载旋转交互：右键/中键按下 → 拖拽旋转 yaw/pitch
   * （pitch 限制 10°..85°）。GalaxyView 的 mousedown 只处理左键，互不冲突；
   * window 的 move/up 监听仅在拖拽期间存在（mouseup 即卸），不产生跨视图泄漏；
   * contextmenu 被抑制以避免右键拖拽弹出菜单。
   */
  _attachRot(canvas) {
    const st = this._rot;
    const move = (e) => {
      if (!st.active) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      st.x = e.clientX;
      st.y = e.clientY;
      this._cam.yaw -= dx * ROT_SPEED;
      this._cam.pitch = Math.min(85 * (Math.PI / 180), Math.max(10 * (Math.PI / 180), this._cam.pitch - dy * ROT_SPEED));
      this._camVersion++;
      this._projValid = false;
    };
    const up = () => {
      if (!st.active) return;
      st.active = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    const down = (e) => {
      if (st.active) return;
      if (e.button !== 1 && e.button !== 2) return; // 仅中键/右键
      if (!this._glActive()) return;                // 纯 2D 下无旋转语义
      st.active = true;
      st.x = e.clientX;
      st.y = e.clientY;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      e.preventDefault();
    };
    const ctxm = (e) => {
      e.preventDefault(); // 抑制地图上的浏览器右键菜单
    };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('contextmenu', ctxm);
    this._rotDetach = () => {
      canvas.removeEventListener('mousedown', down);
      canvas.removeEventListener('contextmenu', ctxm);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      st.active = false;
    };
  }

  /** 卸载旋转交互（init 重复调用或更换画布时） */
  _detachRot() {
    if (this._rotDetach) {
      try { this._rotDetach(); } catch (_) { /* 忽略 */ }
      this._rotDetach = null;
    }
  }
}
