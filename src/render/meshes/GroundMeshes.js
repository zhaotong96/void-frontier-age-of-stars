/**
 * render/meshes/GroundMeshes.js — 地表行动 3D 网格（返工 Phase R8）
 *
 * 与 ShipMeshes.js 同源的 MeshBuilder 模式：纯代码生成的低多边形硬表面网格，
 * 在其基础上扩展 —— 部件分段登记（partNames，逐顶点区间）供动画系统按部件
 * 驱动旋转/位移，并附带逐顶点颜色（部件配色；实例色在着色器中与之混合）。
 *
 * 局部坐标系约定：+X 为正面朝向、+Y 上、+Z 右舷；角色网格脚底位于 y=0。
 * 尺寸单位 = 1 体素。全部确定性生成（无随机）；顶层禁止访问 document/window。
 *
 * partNames 形态：[{ name, start, count }] —— start/count 为顶点区间
 * （positions/normals/colors 三数组共享同一顶点序），渲染层按区间分部件绘制。
 */

// —— 几何构建器 ————————————————————————————————————————

/** 部件分段顶点累积器：push 三角形并自动计算面法线与逐顶点颜色 */
class PartMeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.parts = [];
    this._cur = null;
  }

  /** 开始一个命名部件（后续三角形归入该部件区间） */
  beginPart(name) {
    this._cur = { name, start: this.positions.length / 3, count: 0 };
    this.parts.push(this._cur);
    return this;
  }

  /** 单三角形：顶点 a/b/c 与颜色 col=[r,g,b]，面法线右手系 (b-a)×(c-a) */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const r = col[0];
    const g = col[1];
    const b = col[2];
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(r, g, b, r, g, b, r, g, b);
    if (this._cur) this._cur.count += 3;
    return this;
  }

  /** 轴对齐盒子（中心 cx,cy,cz；半尺寸 hx,hy,hz）→ 12 三角形 */
  box(cx, cy, cz, hx, hy, hz, col) {
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    this.tri(x1, y0, z1, x1, y0, z0, x1, y1, z0, col);
    this.tri(x1, y0, z1, x1, y1, z0, x1, y1, z1, col);
    this.tri(x0, y0, z0, x0, y0, z1, x0, y1, z1, col);
    this.tri(x0, y0, z0, x0, y1, z1, x0, y1, z0, col);
    this.tri(x0, y1, z1, x1, y1, z1, x1, y1, z0, col);
    this.tri(x0, y1, z1, x1, y1, z0, x0, y1, z0, col);
    this.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1, col);
    this.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1, col);
    this.tri(x0, y0, z1, x1, y0, z1, x1, y1, z1, col);
    this.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1, col);
    this.tri(x1, y0, z0, x0, y0, z0, x0, y1, z0, col);
    this.tri(x1, y0, z0, x0, y1, z0, x1, y1, z0, col);
    return this;
  }

  /**
   * 斜切倒角盒子（doc8 §4.2 P1-3 原语）：顶面四周边缘 45° 斜切（切宽=切高=ch，
   * 倒角环四块梯形面在角部自然合拢成棱），底部接触 AO 暗化 ×0.72 烘焙进顶点色
   * （底面整面暗化 + 侧面底部 ch 高度暗化带），消除积木悬浮感。
   * ch ≤ 0 时退化为普通 box（仍带底部 AO 带）。
   */
  chamferBox(cx, cy, cz, hx, hy, hz, ch, col) {
    const c = Math.max(0, Math.min(ch, hx, hy, hz));
    const ao = 0.72;
    const colAO = [col[0] * ao, col[1] * ao, col[2] * ao];
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    const xb0 = x0 + c;
    const xb1 = x1 - c;
    const zb0 = z0 + c;
    const zb1 = z1 - c;
    const yb = y1 - c;                       // 倒角环下沿高
    // —— 顶面（收窄矩形，+Y 外向） ——
    this.tri(xb0, y1, zb1, xb1, y1, zb1, xb1, y1, zb0, col);
    this.tri(xb0, y1, zb1, xb1, y1, zb0, xb0, y1, zb0, col);
    // —— 45° 倒角环（四梯形；角部共享斜棱水密） ——
    // +X
    this.tri(xb1, y1, zb0, xb1, y1, zb1, x1, yb, z1, col);
    this.tri(xb1, y1, zb0, x1, yb, z1, x1, yb, z0, col);
    // -X
    this.tri(xb0, y1, zb1, xb0, y1, zb0, x0, yb, z0, col);
    this.tri(xb0, y1, zb1, x0, yb, z0, x0, yb, z1, col);
    // +Z
    this.tri(xb1, y1, zb1, xb0, y1, zb1, x0, yb, z1, col);
    this.tri(xb1, y1, zb1, x0, yb, z1, x1, yb, z1, col);
    // -Z
    this.tri(xb0, y1, zb0, xb1, y1, zb0, x1, yb, z0, col);
    this.tri(xb0, y1, zb0, x1, yb, z0, x0, yb, z0, col);
    // —— 侧面（y0..yb；底部 c 高 AO 暗化带拆分） ——
    const band = Math.min(c, yb - y0);
    const ym = y0 + band;
    const bands = [[false, ym, yb]];
    if (band > 1e-6) bands.push([true, y0, ym]);
    for (const [dark, ya, yb2] of bands) {
      const cc = dark ? colAO : col;
      this.tri(x1, ya, z1, x1, ya, z0, x1, yb2, z0, cc);
      this.tri(x1, ya, z1, x1, yb2, z0, x1, yb2, z1, cc);
      this.tri(x0, ya, z0, x0, ya, z1, x0, yb2, z1, cc);
      this.tri(x0, ya, z0, x0, yb2, z1, x0, yb2, z0, cc);
      this.tri(x0, ya, z1, x1, ya, z1, x1, yb2, z1, cc);
      this.tri(x0, ya, z1, x1, yb2, z1, x0, yb2, z1, cc);
      this.tri(x1, ya, z0, x0, ya, z0, x0, yb2, z0, cc);
      this.tri(x1, ya, z0, x0, yb2, z0, x1, yb2, z0, cc);
    }
    // —— 底面（-Y 外向，全 AO 暗化） ——
    this.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1, colAO);
    this.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1, colAO);
    return this;
  }

  /** 四棱锥（炮塔/钻头/冠饰），dir=1 尖朝上 / -1 尖朝下 */
  pyramid(cx, baseY, cz, w, h, col, dir = 1) {
    const h2 = w / 2;
    if (dir >= 0) {
      this.tri(cx - h2, baseY, cz - h2, cx + h2, baseY, cz - h2, cx, baseY + h, cz, col);
      this.tri(cx + h2, baseY, cz - h2, cx + h2, baseY, cz + h2, cx, baseY + h, cz, col);
      this.tri(cx + h2, baseY, cz + h2, cx - h2, baseY, cz + h2, cx, baseY + h, cz, col);
      this.tri(cx - h2, baseY, cz + h2, cx - h2, baseY, cz - h2, cx, baseY + h, cz, col);
    } else {
      this.tri(cx + h2, baseY, cz - h2, cx - h2, baseY, cz - h2, cx, baseY - h, cz, col);
      this.tri(cx + h2, baseY, cz + h2, cx + h2, baseY, cz - h2, cx, baseY - h, cz, col);
      this.tri(cx - h2, baseY, cz + h2, cx + h2, baseY, cz + h2, cx, baseY - h, cz, col);
      this.tri(cx - h2, baseY, cz - h2, cx - h2, baseY, cz + h2, cx, baseY - h, cz, col);
    }
    return this;
  }

  /** 直棱柱圆柱（沿 Y 轴，seg 段正多边形近似；绕序保证外向法线） */
  cylinderY(cx, cy, cz, r, h, seg, col) {
    const at = (i) => {
      const a = (i / seg) * Math.PI * 2;
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    };
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    for (let i = 0; i < seg; i++) {
      const [ax, az] = at(i);
      const [bx, bz] = at(i + 1);
      // 侧面（外向）
      this.tri(bx, y0, bz, ax, y0, az, ax, y1, az, col);
      this.tri(bx, y0, bz, ax, y1, az, bx, y1, bz, col);
      // 顶/底盖
      this.tri(cx, y1, cz, bx, y1, bz, ax, y1, az, col);
      this.tri(cx, y0, cz, ax, y0, az, bx, y0, bz, col);
    }
    return this;
  }

  /** 直棱柱圆柱（沿 X 轴 —— 传送带滚轴等横向部件） */
  cylinderX(cx, cy, cz, r, len, seg, col) {
    const at = (i) => {
      const a = (i / seg) * Math.PI * 2;
      return [cy + r * Math.cos(a), cz + r * Math.sin(a)];
    };
    const x0 = cx - len / 2;
    const x1 = cx + len / 2;
    for (let i = 0; i < seg; i++) {
      const [ay, az] = at(i);
      const [by, bz] = at(i + 1);
      this.tri(x0, ay, az, x0, by, bz, x1, by, bz, col);
      this.tri(x0, ay, az, x1, by, bz, x1, ay, az, col);
      this.tri(x1, cy, cz, x1, ay, az, x1, by, bz, col);
      this.tri(x0, cy, cz, x0, by, bz, x0, ay, az, col);
    }
    return this;
  }

  /** 低多边形球（经纬各 seg 段） */
  sphere(cx, cy, cz, r, seg, col) {
    const at = (i, j) => {
      const phi = (i / seg) * Math.PI;
      const theta = (j / seg) * Math.PI * 2;
      return [
        cx + r * Math.sin(phi) * Math.cos(theta),
        cy + r * Math.cos(phi),
        cz + r * Math.sin(phi) * Math.sin(theta),
      ];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        this.tri(...a, ...b, ...c, col);
        this.tri(...a, ...c, ...d, col);
      }
    }
    return this;
  }

  /** 半球穹顶（温室/舱顶；仅上半球，开口朝下不封底） */
  dome(cx, cy, cz, r, seg, col) {
    const at = (i, j) => {
      const phi = (i / seg) * Math.PI * 0.5; // 0..π/2
      const theta = (j / seg) * Math.PI * 2;
      return [
        cx + r * Math.cos(phi) * Math.cos(theta),
        cy + r * Math.sin(phi),
        cz + r * Math.cos(phi) * Math.sin(theta),
      ];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        this.tri(...a, ...b, ...c, col);
        this.tri(...a, ...c, ...d, col);
      }
    }
    return this;
  }

  /** 输出网格：positions/normals/colors 三 Float32Array + partNames 区间表 */
  build() {
    const parts = this.parts.map((p) => ({ name: p.name, start: p.start, count: p.count }));
    // 无显式分段时整体归入单一部件
    if (!parts.length) {
      parts.push({ name: 'main', start: 0, count: this.positions.length / 3 });
    }
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      triCount: this.positions.length / 9,
      partNames: parts,
    };
  }
}

// —— 配色常量（部件/阵营视觉识别） ————————————————

const COL = {
  armor: [0.30, 0.62, 0.72],    // 外骨骼装甲（青蓝）
  armorDark: [0.20, 0.30, 0.36],
  joint: [0.22, 0.26, 0.30],    // 关节/腿（暗灰蓝）
  visor: [0.62, 0.95, 1.05],    // 观察窗（过亮供辉光）
  pack: [0.45, 0.48, 0.55],
  grunt: [0.72, 0.34, 0.26],    // 步兵（锈红）
  gruntDark: [0.42, 0.20, 0.16],
  heavy: [0.46, 0.49, 0.55],    // 重装（钢灰）
  heavyDark: [0.28, 0.30, 0.34],
  turret: [0.58, 0.60, 0.64],
  turretDark: [0.34, 0.35, 0.38],
  boss: [0.48, 0.26, 0.66],     // 深渊体（紫）
  bossDark: [0.28, 0.14, 0.40],
  bossGlow: [0.85, 0.45, 1.05],
  colonist: [0.85, 0.62, 0.32], // 殖民者作业服（橙）
  colonistDark: [0.50, 0.38, 0.22],
  metal: [0.52, 0.54, 0.58],
  metalDark: [0.30, 0.31, 0.34],
  concrete: [0.47, 0.46, 0.44],  // 基座裙边混凝土
  belt: [0.16, 0.16, 0.18],
  glass: [0.55, 0.85, 0.85],
  panel: [0.24, 0.42, 0.72],    // 太阳能板
};

// —— 角色 / 敌人 / NPC ————————————————————————————————

/** 外骨骼角色（7 部件：head/torso/armL/armR/legL/legR/backpack，约 1.8 高） */
export function buildExosuitMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('head');
  m.box(0.02, 1.50, 0, 0.095, 0.115, 0.105, COL.armor);       // 头盔
  m.box(0.115, 1.51, 0, 0.015, 0.05, 0.065, COL.visor);       // 观察窗
  m.beginPart('torso');
  m.chamferBox(0, 1.06, 0, 0.20, 0.27, 0.24, 0.05, COL.armor); // 胸甲（45° 倒角）
  m.box(0.06, 1.06, 0, 0.145, 0.20, 0.185, COL.armorDark);    // 胸口内衬
  m.beginPart('armL');
  m.chamferBox(0, 1.04, -0.295, 0.075, 0.185, 0.075, 0.03, COL.armor); // 左臂/肩甲
  m.box(-0.02, 0.80, -0.295, 0.06, 0.055, 0.065, COL.joint);  // 左手套
  m.beginPart('armR');
  m.chamferBox(0, 1.04, 0.295, 0.075, 0.185, 0.075, 0.03, COL.armor);  // 右臂/肩甲
  m.box(0.02, 0.80, 0.295, 0.06, 0.055, 0.065, COL.joint);    // 右手套
  m.beginPart('legL');
  m.box(0, 0.38, -0.145, 0.085, 0.38, 0.095, COL.joint);      // 左腿
  m.box(0.03, 0.035, -0.145, 0.10, 0.035, 0.115, COL.armorDark); // 左靴
  m.beginPart('legR');
  m.box(0, 0.38, 0.145, 0.085, 0.38, 0.095, COL.joint);       // 右腿
  m.box(0.03, 0.035, 0.145, 0.10, 0.035, 0.115, COL.armorDark); // 右靴
  m.beginPart('backpack');
  m.box(-0.20, 1.10, 0, 0.075, 0.16, 0.17, COL.pack);         // 生命维持背包
  m.box(-0.285, 1.14, 0, 0.012, 0.05, 0.05, COL.visor);       // 状态灯
  return m.build();
}

/** 敌军步兵（四足驮兽形，6 部件，肩高约 0.8） */
export function buildGruntMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('body');
  m.box(0, 0.56, 0, 0.34, 0.15, 0.20, COL.grunt);             // 躯干
  m.box(-0.30, 0.60, 0, 0.05, 0.11, 0.05, COL.gruntDark);     // 尾椎
  m.pyramid(-0.36, 0.60, 0, 0.08, 0.10, COL.gruntDark, -1);   // 尾刺
  m.beginPart('head');
  m.box(0.42, 0.64, 0, 0.13, 0.11, 0.13, COL.gruntDark);      // 头甲
  m.box(0.52, 0.62, 0, 0.035, 0.035, 0.05, COL.visor);        // 感官窗
  m.pyramid(0.60, 0.62, 0.05, 0.05, 0.09, COL.grunt, 1);      // 右颚牙
  m.pyramid(0.60, 0.62, -0.05, 0.05, 0.09, COL.grunt, 1);     // 左颚牙
  m.beginPart('legFL');
  m.box(0.24, 0.29, -0.17, 0.055, 0.29, 0.055, COL.gruntDark);
  m.beginPart('legFR');
  m.box(0.24, 0.29, 0.17, 0.055, 0.29, 0.055, COL.gruntDark);
  m.beginPart('legBL');
  m.box(-0.22, 0.29, -0.17, 0.055, 0.29, 0.055, COL.gruntDark);
  m.beginPart('legBR');
  m.box(-0.22, 0.29, 0.17, 0.055, 0.29, 0.055, COL.gruntDark);
  m.beginPart('spine');
  m.box(0, 0.74, 0, 0.20, 0.035, 0.045, COL.gruntDark);       // 背脊板
  return m.build();
}

/** 重装机甲（8 部件，肩高约 1.7，双臂速射炮） */
export function buildHeavyMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('torso');
  m.chamferBox(0, 1.02, 0, 0.30, 0.30, 0.34, 0.07, COL.heavy); // 主装甲箱（45° 倒角）
  m.box(0, 0.70, 0, 0.20, 0.10, 0.24, COL.heavyDark);         // 骨盆驱动
  m.beginPart('cockpit');
  m.box(0.16, 1.26, 0, 0.14, 0.11, 0.16, COL.heavyDark);      // 座舱
  m.box(0.31, 1.26, 0, 0.015, 0.06, 0.09, COL.visor);         // 舱窗
  m.beginPart('legL');
  m.box(0, 0.42, -0.24, 0.16, 0.42, 0.16, COL.heavyDark);     // 左液压腿
  m.box(0.04, 0.04, -0.24, 0.20, 0.045, 0.20, COL.heavy);     // 左足
  m.beginPart('legR');
  m.box(0, 0.42, 0.24, 0.16, 0.42, 0.16, COL.heavyDark);
  m.box(0.04, 0.04, 0.24, 0.20, 0.045, 0.20, COL.heavy);
  m.beginPart('armL');
  m.box(0.10, 1.06, -0.46, 0.30, 0.10, 0.10, COL.metal);      // 左臂炮
  m.cylinderX(0.44, 1.06, -0.46, 0.065, 0.14, 6, COL.heavyDark); // 炮口
  m.beginPart('armR');
  m.box(0.10, 1.06, 0.46, 0.30, 0.10, 0.10, COL.metal);
  m.cylinderX(0.44, 1.06, 0.46, 0.065, 0.14, 6, COL.heavyDark);
  m.beginPart('shoulderL');
  m.chamferBox(0, 1.32, -0.40, 0.16, 0.10, 0.12, 0.04, COL.heavy); // 左肩甲（倒角）
  m.beginPart('shoulderR');
  m.chamferBox(0, 1.32, 0.40, 0.16, 0.10, 0.12, 0.04, COL.heavy);
  m.beginPart('antenna');
  m.box(-0.20, 1.55, 0.10, 0.015, 0.22, 0.015, COL.metalDark); // 通讯天线
  return m.build();
}

/** 自动炮台（3 部件：base/yoke/barrel，塔身高约 0.9） */
export function buildTurretMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('base');
  m.cylinderY(0, 0.16, 0, 0.46, 0.32, 8, COL.turretDark);     // 底座
  m.box(0, 0.36, 0, 0.30, 0.05, 0.30, COL.turretDark);        // 承台
  m.beginPart('yoke');
  m.box(0, 0.55, 0, 0.13, 0.16, 0.24, COL.turret);            // 炮架
  m.beginPart('barrel');
  m.box(0.36, 0.58, 0, 0.28, 0.055, 0.055, COL.metal);        // 主炮身
  m.cylinderX(0.66, 0.58, 0, 0.075, 0.10, 6, COL.turretDark); // 炮口制退器
  m.box(-0.02, 0.68, 0, 0.06, 0.06, 0.06, COL.visor);         // 瞄具
  return m.build();
}

/**
 * 深渊体 Boss（三阶段形态，6 部件，核心高约 3）：
 *  阶段 1 = core + armL/armR；阶段 2 展开 shellL/shellR；
 *  阶段 3 隆起 crest。渲染层可按 partNames 区间选择性绘制部件。
 */
export function buildBossMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('core');
  m.sphere(0, 1.55, 0, 0.92, 6, COL.boss);                    // 主核心
  m.sphere(0.55, 1.55, 0, 0.34, 5, COL.bossGlow);             // 前突眼核
  m.cylinderY(0, 0.42, 0, 0.55, 0.84, 8, COL.bossDark);       // 底座触根
  m.beginPart('armL');
  m.box(0.10, 1.30, -1.20, 0.55, 0.14, 0.14, COL.bossDark);   // 左触臂
  m.pyramid(0.72, 1.30, -1.20, 0.26, 0.34, COL.bossGlow, 1);  // 左臂尖刺
  m.beginPart('armR');
  m.box(0.10, 1.30, 1.20, 0.55, 0.14, 0.14, COL.bossDark);
  m.pyramid(0.72, 1.30, 1.20, 0.26, 0.34, COL.bossGlow, 1);
  m.beginPart('shellL');
  m.tri(-0.30, 1.10, -0.70, -0.30, 2.30, -0.90, -0.95, 1.70, -1.30, COL.boss); // 左甲壳
  m.tri(-0.30, 1.10, -0.70, -0.95, 1.70, -1.30, -0.55, 1.05, -1.05, COL.bossDark);
  m.beginPart('shellR');
  m.tri(-0.30, 1.10, 0.70, -0.95, 1.70, 1.30, -0.30, 2.30, 0.90, COL.boss);   // 右甲壳
  m.tri(-0.30, 1.10, 0.70, -0.55, 1.05, 1.05, -0.95, 1.70, 1.30, COL.bossDark);
  m.beginPart('crest');
  m.pyramid(0, 2.42, 0, 0.55, 0.75, COL.bossGlow, 1);         // 顶冠（阶段 3）
  m.pyramid(0.30, 2.35, 0.26, 0.28, 0.45, COL.boss, 1);
  m.pyramid(0.30, 2.35, -0.26, 0.28, 0.45, COL.boss, 1);
  return m.build();
}

/** 殖民者小人（5 部件，约 1.05 高；无装甲的作业服造型） */
export function buildColonistMesh() {
  const m = new PartMeshBuilder();
  m.beginPart('torso');
  m.box(0, 0.62, 0, 0.145, 0.20, 0.10, COL.colonist);         // 作业服躯干
  m.beginPart('head');
  m.sphere(0, 0.94, 0, 0.115, 4, COL.colonistDark);           // 头（含安全帽）
  m.beginPart('armL');
  m.box(0, 0.62, -0.175, 0.045, 0.15, 0.045, COL.colonistDark);
  m.beginPart('armR');
  m.box(0, 0.62, 0.175, 0.045, 0.15, 0.045, COL.colonistDark);
  m.beginPart('legs');
  m.box(0, 0.20, -0.065, 0.055, 0.20, 0.055, COL.colonistDark);
  m.box(0, 0.20, 0.065, 0.055, 0.20, 0.055, COL.colonistDark);
  return m.build();
}

// —— 建筑网格（按 building.category，9 类 + 兜底） ————————————————

/** 各类别建筑基底半宽（米/体素；与各 case 主体占地对齐，供基座裙边取值） */
const FOOTPRINT_HALF = {
  mining: 2.0, refining: 2.0, industry: 1.9, agri: 1.85, science: 1.6,
  service: 1.5, military: 1.6, admin: 1.0, energy: 1.9,
  pylon: 1.0, splitter: 1.3, catapult: 2.4,  // doc19 WP-5 新槽位
  default: 1.4,
};

/**
 * 24 种建筑按 9 个 category 差异化造型（mining/refining/industry/agri/
 * science/service/military/admin/energy）。底面约 4×4 体素，高度 2..6。
 * 实例化渲染时按类别整体着色（实例色与顶点色混合），部件区间保留给
 * 需要分件动画的场景（雷达旋转、钻头升降等）。
 * 基座裙边（doc9 P1-2 几何项）：所有建筑附加向下延伸 1.8m 的混凝土防塌护坡
 * （略微外扩 0.08m）；斜坡上悬空侧由裙边包络支撑，平地上裙边没入地下。
 * @param {string} buildingCategory buildings.js 的 category 字段
 */
export function buildBuildingMesh(buildingCategory) {
  const m = new PartMeshBuilder();
  const cat = String(buildingCategory || 'default');
  switch (cat) {
    case 'mining': {
      // 采掘：井架 + 钻锥
      m.beginPart('foundation');
      m.box(0, 0.15, 0, 2.0, 0.15, 2.0, COL.metalDark);
      m.beginPart('derrick');
      m.box(-1.2, 1.4, -1.2, 0.10, 1.25, 0.10, COL.metal);
      m.box(-1.2, 1.4, 1.2, 0.10, 1.25, 0.10, COL.metal);
      m.box(1.2, 1.4, -1.2, 0.10, 1.25, 0.10, COL.metal);
      m.box(1.2, 1.4, 1.2, 0.10, 1.25, 0.10, COL.metal);
      m.box(0, 2.75, 0, 1.3, 0.10, 1.3, COL.metalDark);
      m.beginPart('drill');
      m.pyramid(0, 2.65, 0, 0.7, 0.9, COL.turret, 1);
      break;
    }
    case 'refining': {
      // 精炼：双储罐 + 连接管
      m.beginPart('foundation');
      m.box(0, 0.12, 0, 2.0, 0.12, 2.0, COL.metalDark);
      m.beginPart('silo');
      m.cylinderY(-0.85, 1.42, 0, 0.85, 2.6, 8, COL.metal);
      m.cylinderY(0.85, 1.42, 0, 0.85, 2.6, 8, COL.metal);
      m.beginPart('pipe');
      m.box(0, 2.0, 0, 0.85, 0.14, 0.16, COL.turretDark);
      m.box(0, 0.5, 0, 0.16, 0.14, 0.85, COL.turretDark);
      break;
    }
    case 'industry': {
      // 工业：主厂房 + 烟囱（主厂房 45° 倒角，P1-3）
      m.beginPart('hall');
      m.chamferBox(0, 0.75, 0, 1.9, 0.75, 1.3, 0.18, COL.metal);
      m.box(0, 1.55, 0, 1.9, 0.06, 1.3, COL.metalDark);        // 屋沿
      m.beginPart('chimney');
      m.cylinderY(1.25, 2.0, 0.7, 0.24, 2.3, 6, COL.turretDark);
      m.beginPart('vent');
      m.box(-1.0, 1.70, -0.5, 0.22, 0.12, 0.22, COL.metalDark);
      break;
    }
    case 'agri': {
      // 农业：水培穹顶 + 种植架
      m.beginPart('dome');
      m.dome(0, 0.1, 0, 1.7, 6, COL.glass);
      m.beginPart('racks');
      m.box(-0.8, 0.45, 0, 0.5, 0.35, 0.7, COL.metalDark);
      m.box(0.8, 0.45, 0, 0.5, 0.35, 0.7, COL.metalDark);
      m.beginPart('pad');
      m.box(0, 0.08, 0, 1.85, 0.08, 1.85, COL.metalDark);
      break;
    }
    case 'science': {
      // 科研：实验方舱 + 深空天线
      m.beginPart('lab');
      m.box(-0.7, 0.65, 0.4, 0.9, 0.65, 0.8, COL.metal);
      m.beginPart('mast');
      m.cylinderY(1.0, 0.9, -0.7, 0.09, 1.8, 6, COL.metalDark);
      m.pyramid(1.0, 1.8, -0.7, 0.9, 0.5, COL.panel, 1);       // 碟形天线（锥代）
      m.beginPart('dome');
      m.dome(-0.7, 1.3, 0.4, 0.5, 5, COL.glass);
      break;
    }
    case 'service': {
      // 人口服务：居住街区 + 灯带
      m.beginPart('block');
      m.box(0, 1.05, 0, 1.5, 1.05, 1.05, COL.metal);
      m.beginPart('windows');
      m.box(1.51, 1.05, 0, 0.02, 0.55, 0.75, COL.visor);       // 东面灯带
      m.box(-1.51, 1.05, 0, 0.02, 0.55, 0.75, COL.visor);      // 西面灯带
      m.beginPart('roof');
      m.box(0, 2.16, 0, 0.9, 0.06, 0.7, COL.metalDark);
      break;
    }
    case 'military': {
      // 军事：掩体碉堡（45° 倒角掩体箱，P1-3） + 双联炮
      m.beginPart('bunker');
      m.chamferBox(0, 0.42, 0, 1.6, 0.42, 1.6, 0.12, COL.turretDark);
      m.beginPart('turrets');
      m.cylinderY(-0.55, 1.05, 0, 0.28, 0.42, 6, COL.turret);
      m.cylinderY(0.55, 1.05, 0, 0.28, 0.42, 6, COL.turret);
      m.beginPart('barrels');
      m.box(-0.95, 1.12, 0, 0.42, 0.06, 0.06, COL.metal);
      m.box(0.95, 1.12, 0, 0.42, 0.06, 0.06, COL.metal);
      break;
    }
    case 'admin': {
      // 行政贸易：指挥塔 + 尖顶
      m.beginPart('tower');
      m.box(0, 1.5, 0, 1.0, 1.5, 1.0, COL.metal);
      m.box(0, 3.1, 0, 0.65, 0.10, 0.65, COL.metalDark);
      m.beginPart('spire');
      m.pyramid(0, 3.2, 0, 0.7, 1.1, COL.turret, 1);
      m.beginPart('annex');
      m.box(1.5, 0.55, 0.6, 0.7, 0.55, 0.55, COL.metalDark);
      break;
    }
    case 'energy': {
      // 能源：变电塔 + 双太阳能板阵
      m.beginPart('pylon');
      m.cylinderY(0, 0.9, 0, 0.16, 1.8, 6, COL.metalDark);
      m.beginPart('panels');
      m.box(-1.3, 1.0, 0, 0.9, 0.04, 0.7, COL.panel);
      m.box(1.3, 1.0, 0, 0.9, 0.04, 0.7, COL.panel);
      m.box(0, 1.85, 0, 0.6, 0.04, 0.6, COL.panel);
      m.beginPart('base');
      m.box(0, 0.1, 0, 1.9, 0.1, 1.9, COL.metalDark);
      break;
    }
    case 'pylon': {
      // doc19 WP-5：输电塔（四足桁架塔身 + 顶部横担 + 绝缘子对）
      m.beginPart('legs');
      m.box(-0.6, 1.4, -0.6, 0.09, 2.8, 0.09, COL.metal);
      m.box(-0.6, 1.4, 0.6, 0.09, 2.8, 0.09, COL.metal);
      m.box(0.6, 1.4, -0.6, 0.09, 2.8, 0.09, COL.metal);
      m.box(0.6, 1.4, 0.6, 0.09, 2.8, 0.09, COL.metal);
      m.beginPart('crossarm');
      m.box(0, 2.85, 0, 1.7, 0.08, 0.08, COL.metalDark);
      m.box(0, 2.65, 0, 0.08, 0.08, 1.2, COL.metalDark);
      m.beginPart('insulators');
      m.box(-0.8, 2.7, 0, 0.06, 0.22, 0.06, COL.panel);
      m.box(0.8, 2.7, 0, 0.06, 0.22, 0.06, COL.panel);
      m.box(0, 2.7, -0.55, 0.06, 0.22, 0.06, COL.panel);
      m.box(0, 2.7, 0.55, 0.06, 0.22, 0.06, COL.panel);
      break;
    }
    case 'splitter': {
      // doc19 WP-5：四向分流器（低平枢纽 + 四向溜槽 + 状态灯）
      m.beginPart('hub');
      m.chamferBox(0, 0.35, 0, 1.0, 0.35, 1.0, 0.10, COL.metal);
      m.beginPart('chutes');
      m.box(0, 0.22, 1.1, 0.5, 0.16, 0.5, COL.turretDark);
      m.box(0, 0.22, -1.1, 0.5, 0.16, 0.5, COL.turretDark);
      m.box(1.1, 0.22, 0, 0.5, 0.16, 0.5, COL.turretDark);
      m.box(-1.1, 0.22, 0, 0.5, 0.16, 0.5, COL.turretDark);
      m.beginPart('lamp');
      m.box(0, 0.85, 0, 0.10, 0.14, 0.10, COL.panel);
      break;
    }
    case 'catapult': {
      // doc19 WP-5：轨道货运弹射井（后倾发射导轨 + 配电基座 + 电容环）
      m.beginPart('rail');
      m.box(0, 2.4, -0.4, 0.5, 0.10, 4.2, COL.metal);
      m.box(0, 1.35, 1.6, 0.5, 0.10, 0.5, COL.turretDark);
      m.beginPart('tower');
      m.box(0, 1.3, -1.2, 0.7, 2.6, 0.7, COL.metalDark);
      m.beginPart('caps');
      m.box(0, 2.75, -1.0, 0.5, 0.5, 0.5, COL.panel);
      m.box(0, 0.25, 0, 2.2, 0.5, 1.2, COL.concrete);
      break;
    }
    default: {
      // 兜底：通用方舱 + 天线
      m.beginPart('block');
      m.box(0, 0.9, 0, 1.4, 0.9, 1.4, COL.metal);
      m.beginPart('mast');
      m.box(0.5, 2.2, 0.5, 0.03, 0.4, 0.03, COL.metalDark);
      break;
    }
  }
  // —— 混凝土基座裙边（向下 1.8m，微外扩；平地没入地下，坡地包络悬空侧） ——
  const fp = FOOTPRINT_HALF[cat] != null ? FOOTPRINT_HALF[cat] : FOOTPRINT_HALF.default;
  m.beginPart('skirt');
  m.box(0, -0.8, 0, fp + 0.08, 1.0, fp + 0.08, COL.concrete);
  return m.build();
}

// —— 传送带 / 通用几何 ————————————————————————————————

/**
 * 传送带段网格：沿 +X 方向 1.0 单位长（frame + belt + rollers）。
 * 渲染层按路径方向 rotY 摆放；货箱为独立实例沿带面滑动。
 */
export function buildConveyorBelt() {
  const m = new PartMeshBuilder();
  m.beginPart('frame');
  m.box(0, 0.10, 0, 0.5, 0.05, 0.30, COL.metalDark);          // 机架
  m.box(-0.32, 0.035, 0, 0.06, 0.035, 0.24, COL.metalDark);   // 支腿
  m.box(0.32, 0.035, 0, 0.06, 0.035, 0.24, COL.metalDark);
  m.beginPart('belt');
  m.box(0, 0.17, 0, 0.47, 0.022, 0.26, COL.belt);             // 带面
  m.beginPart('rollers');
  m.cylinderX(-0.42, 0.155, 0, 0.055, 0.5, 6, COL.turret);    // 尾滚轮
  m.cylinderX(0.42, 0.155, 0, 0.055, 0.5, 6, COL.turret);     // 头滚轮
  return m.build();
}

/** 中心对称单位盒（24 顶点带独立面法线）—— 建筑/货箱/传送带实例化的公共底座 */
export function buildUnitBox() {
  const m = new PartMeshBuilder();
  m.beginPart('box');
  m.box(0, 0, 0, 0.5, 0.5, 0.5, [1, 1, 1]);
  return m.build();
}
