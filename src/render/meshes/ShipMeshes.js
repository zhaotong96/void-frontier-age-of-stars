/**
 * render/meshes/ShipMeshes.js — 12 种船体的程序化 3D 网格（返工 Phase R4）
 *
 * 纯代码生成的低多边形硬表面网格（每船体 48..180 三角形），带法线，
 * 局部坐标系：+X 舰首、+Y 上、-Z 右舷；整体长度归一约 1.0，渲染层按
 * 舰种缩放与横滚。阵营涂装灯带与材质槽位由着色器 uniform 处理。
 * 全部确定性生成（无随机）；顶层禁止访问 document/window。
 */

// —— 几何构建器 ————————————————————————————————————————

/** 顶点累积器：push 三角形并自动计算面法线 */
class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    // 面法线（右手系：b-a × c-a）
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
    for (const p of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
    }
  }

  /** 轴对齐盒子（中心 cx,cy,cz；半尺寸 hx,hy,hz）→ 12 三角形 */
  box(cx, cy, cz, hx, hy, hz) {
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    // +X（右舷）
    this.tri(x1, y0, z1, x1, y0, z0, x1, y1, z0);
    this.tri(x1, y0, z1, x1, y1, z0, x1, y1, z1);
    // -X
    this.tri(x0, y0, z0, x0, y0, z1, x0, y1, z1);
    this.tri(x0, y0, z0, x0, y1, z1, x0, y1, z0);
    // +Y（上）
    this.tri(x0, y1, z1, x1, y1, z1, x1, y1, z0);
    this.tri(x0, y1, z1, x1, y1, z0, x0, y1, z0);
    // -Y
    this.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1);
    this.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1);
    // +Z（舰首向 +X 时 z=+ 为一侧舷）
    this.tri(x0, y0, z1, x1, y0, z1, x1, y1, z1);
    this.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1);
    // -Z
    this.tri(x1, y0, z0, x0, y0, z0, x0, y1, z0);
    this.tri(x1, y0, z0, x0, y1, z0, x1, y1, z0);
  }

  /** 楔形舰体：沿 +X 由舰尾(宽 w0) 收窄到舰首(宽 w1)，高 h0→h1，长 len */
  hullWedge(len, w0, w1, h0, h1, zOff = 0) {
    const x0 = -len / 2;
    const x1 = len / 2;
    // 八顶点
    const p = [
      [x0, 0, zOff + w0], [x0, 0, zOff - w0], [x0, h0, zOff], // 尾：右、左、脊
      [x1, 0, zOff + w1], [x1, 0, zOff - w1], [x1, h1, zOff], // 首
      [x0, -h0 * 0.35, zOff], [x1, -h1 * 0.35, zOff], // 底龙骨
    ];
    // 上甲板两侧
    this.tri(...p[0], ...p[5], ...p[2]);
    this.tri(...p[1], ...p[2], ...p[5]);
    this.tri(...p[1], ...p[5], ...p[4]);
    this.tri(...p[0], ...p[3], ...p[5]);
    // 两侧舷
    this.tri(...p[0], ...p[6], ...p[3]);
    this.tri(...p[0], ...p[3], ...p[5]);
    this.tri(...p[1], ...p[4], ...p[7]);
    this.tri(...p[1], ...p[7], ...p[6]);
    this.tri(...p[1], ...p[6], ...p[0]);
    // 底部
    this.tri(...p[6], ...p[7], ...p[3]);
    this.tri(...p[6], ...p[3], ...p[0]);
    // 舰尾封板
    this.tri(...p[2], ...p[5], ...p[7]);
    this.tri(...p[2], ...p[7], ...p[6]);
  }

  /** 四棱锥（炮塔/钻头/鳍尖） */
  pyramid(cx, baseY, cz, w, h, dir = 1) {
    const h2 = w / 2;
    if (dir >= 0) {
      this.tri(cx - h2, baseY, cz - h2, cx + h2, baseY, cz - h2, cx, baseY + h, cz);
      this.tri(cx + h2, baseY, cz - h2, cx + h2, baseY, cz + h2, cx, baseY + h, cz);
      this.tri(cx + h2, baseY, cz + h2, cx - h2, baseY, cz + h2, cx, baseY + h, cz);
      this.tri(cx - h2, baseY, cz + h2, cx - h2, baseY, cz - h2, cx, baseY + h, cz);
    } else {
      this.tri(cx + h2, baseY, cz - h2, cx - h2, baseY, cz - h2, cx, baseY - h, cz);
      this.tri(cx + h2, baseY, cz + h2, cx + h2, baseY, cz - h2, cx, baseY - h, cz);
      this.tri(cx - h2, baseY, cz + h2, cx + h2, baseY, cz + h2, cx, baseY - h, cz);
      this.tri(cx - h2, baseY, cz - h2, cx - h2, baseY, cz + h2, cx, baseY - h, cz);
    }
  }

  /** 垂直鳍板（双面三角） */
  fin(cx, cy, cz, len, h) {
    this.tri(cx - len / 2, cy, cz, cx + len / 2, cy, cz, cx + len * 0.2, cy + h, cz);
    this.tri(cx + len / 2, cy, cz, cx - len / 2, cy, cz, cx + len * 0.2, cy - h * 0.4, cz);
  }

  /** 低多边形球（经纬各 seg 段） */
  sphere(cx, cy, cz, r, seg = 5) {
    const at = (i, j) => {
      const phi = (i / seg) * Math.PI; // 0..π
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
        this.tri(...a, ...b, ...c);
        this.tri(...a, ...c, ...d);
      }
    }
  }

  build() {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      triCount: this.positions.length / 9,
    };
  }
}

// —— 12 船体定义 ————————————————————————————————————————

const BUILDERS = {
  // 侦察艇：细长 needle + 大型传感鳍
  hull_scout(m) {
    m.hullWedge(1.0, 0.10, 0.04, 0.07, 0.03);
    m.fin(-0.2, 0.06, 0, 0.34, 0.2);
    m.sphere(0.28, 0.06, 0, 0.055, 4); // 传感穹顶
  },
  // 截击艇：前掠翼楔形
  hull_interceptor(m) {
    m.hullWedge(0.8, 0.16, 0.02, 0.06, 0.02);
    // 前掠双翼（上下双面 + 翼尖配重）
    m.tri(0.1, 0, 0.05, 0.42, 0, 0.30, 0.16, 0, 0.04);
    m.tri(-0.1, 0, 0.05, 0.1, 0, 0.05, 0.16, 0, 0.04);
    m.tri(0.1, 0, -0.05, 0.16, 0, -0.04, 0.42, 0, -0.30);
    m.tri(-0.1, 0, -0.05, 0.1, 0, -0.05, 0.1, 0, -0.05);
    m.box(0.30, 0.0, 0.28, 0.05, 0.02, 0.03); // 翼尖配重
    m.box(0.30, 0.0, -0.28, 0.05, 0.02, 0.03);
    m.box(-0.1, 0.05, 0, 0.12, 0.04, 0.06); // 座舱
    m.pyramid(-0.38, 0.03, 0, 0.10, 0.08, -1); // 尾喷锥
    m.fin(-0.15, 0.06, 0, 0.18, 0.10); // 背鳍
  },
  // 护卫舰：均衡舰体 + 小舰桥 + 双推进短舱
  hull_frigate(m) {
    m.hullWedge(1.0, 0.18, 0.06, 0.10, 0.04);
    m.box(-0.05, 0.11, 0, 0.14, 0.05, 0.08); // 舰桥
    m.box(0.30, 0.03, 0.10, 0.12, 0.035, 0.035); // 右推进短舱
    m.box(0.30, 0.03, -0.10, 0.12, 0.035, 0.035); // 左推进短舱
    m.pyramid(0.18, 0.10, 0, 0.08, 0.07); // 前炮座
    m.fin(-0.34, 0.08, 0, 0.26, 0.16);
    m.box(-0.44, 0.06, 0, 0.06, 0.06, 0.10); // 尾封板
  },
  // 驱逐舰：修长双联前爪
  hull_destroyer(m) {
    m.hullWedge(1.15, 0.16, 0.05, 0.09, 0.04);
    m.box(0.30, 0.0, 0.09, 0.20, 0.03, 0.035); // 右前爪
    m.box(0.30, 0.0, -0.09, 0.20, 0.03, 0.035);
    m.box(-0.02, 0.11, 0, 0.16, 0.05, 0.075);
    m.pyramid(0.16, 0.10, 0, 0.09, 0.09);
  },
  // 炮击巡洋舰：厚重舰体 + 主炮塔
  hull_gun_cruiser(m) {
    m.hullWedge(1.2, 0.24, 0.08, 0.14, 0.06);
    m.box(0.0, 0.15, 0, 0.18, 0.06, 0.10);
    m.pyramid(0.34, 0.12, 0, 0.14, 0.14); // 主炮基座
    m.box(0.5, 0.17, 0, 0.16, 0.035, 0.035); // 主炮身
    m.box(-0.34, 0.13, 0, 0.12, 0.05, 0.09);
  },
  // 防空巡洋舰：桅杆雷达 + 多联小炮塔
  hull_aa_cruiser(m) {
    m.hullWedge(1.1, 0.22, 0.07, 0.12, 0.05);
    m.box(0.0, 0.14, 0, 0.14, 0.05, 0.09);
    m.box(-0.02, 0.22, 0, 0.02, 0.09, 0.02); // 桅杆
    m.box(-0.02, 0.30, 0, 0.10, 0.02, 0.10); // 雷达板
    m.pyramid(0.30, 0.10, 0.10, 0.07, 0.06);
    m.pyramid(0.30, 0.10, -0.10, 0.07, 0.06);
    m.pyramid(-0.2, 0.11, 0.12, 0.06, 0.05);
    m.pyramid(-0.2, 0.11, -0.12, 0.06, 0.05);
  },
  // 战列舰：阶梯重装甲舰桥 + 双主炮塔
  hull_battleship(m) {
    m.hullWedge(1.5, 0.32, 0.12, 0.20, 0.09);
    m.box(-0.1, 0.20, 0, 0.22, 0.07, 0.13); // 一阶舰桥
    m.box(0.18, 0.24, 0, 0.14, 0.05, 0.10); // 二阶
    m.box(0.36, 0.27, 0, 0.08, 0.04, 0.07); // 顶部指挥塔
    m.pyramid(0.52, 0.16, 0, 0.16, 0.16); // A 炮塔
    m.box(0.72, 0.19, 0, 0.14, 0.04, 0.04); // 主炮身
    m.pyramid(-0.3, 0.18, 0, 0.14, 0.14); // X 炮塔
    m.box(-0.48, 0.20, 0, 0.12, 0.035, 0.035);
    m.box(-0.1, 0.05, 0.18, 0.4, 0.05, 0.04); // 侧装甲带
    m.box(-0.1, 0.05, -0.18, 0.4, 0.05, 0.04);
  },
  // 航母：双体不对称飞行甲板 + 蓝光机库槽
  hull_carrier(m) {
    m.hullWedge(1.4, 0.30, 0.10, 0.12, 0.05);
    m.box(0.1, 0.14, 0.16, 0.55, 0.03, 0.16); // 左偏置飞行甲板
    m.box(-0.2, 0.10, -0.12, 0.3, 0.05, 0.08); // 右侧岛式建筑
    m.box(0.35, 0.145, 0.16, 0.2, 0.005, 0.05); // 机库槽（着色器灯带）
    m.box(0.0, 0.145, 0.16, 0.15, 0.005, 0.05);
    m.fin(-0.5, 0.10, 0, 0.3, 0.18);
  },
  // 工业舰：模块化货舱块
  hull_industrial(m) {
    m.hullWedge(0.9, 0.20, 0.08, 0.14, 0.06);
    m.box(-0.15, 0.12, 0.12, 0.22, 0.09, 0.09);
    m.box(-0.15, 0.12, -0.12, 0.22, 0.09, 0.09);
    m.box(0.25, 0.10, 0, 0.14, 0.08, 0.12);
    m.box(-0.48, 0.08, 0, 0.08, 0.10, 0.14);
  },
  // 矿业舰：前部采集钻锥 + 侧挂矿石舱
  hull_miner(m) {
    m.hullWedge(0.9, 0.22, 0.10, 0.13, 0.07);
    m.pyramid(0.62, 0.0, 0, 0.18, 0.26); // 采集钻锥
    m.box(-0.2, 0.10, 0.14, 0.2, 0.08, 0.07); // 矿石舱
    m.box(-0.2, 0.10, -0.14, 0.2, 0.08, 0.07);
    m.box(0.1, 0.13, 0, 0.12, 0.05, 0.08);
  },
  // 科学船：大型传感阵列穹顶
  hull_science(m) {
    m.hullWedge(1.0, 0.20, 0.06, 0.11, 0.05);
    m.sphere(0.05, 0.16, 0, 0.11, 5); // 主穹顶
    m.sphere(-0.3, 0.10, 0.09, 0.05, 4);
    m.sphere(-0.3, 0.10, -0.09, 0.05, 4);
    m.fin(-0.35, 0.07, 0, 0.24, 0.14);
  },
  // 补给舰：粗胖货舱 + 燃料罐
  hull_supply(m) {
    m.hullWedge(1.2, 0.30, 0.12, 0.20, 0.10);
    m.box(-0.2, 0.16, 0.16, 0.3, 0.07, 0.05); // 燃料罐
    m.box(-0.2, 0.16, -0.16, 0.3, 0.07, 0.05);
    m.box(-0.2, 0.16, 0, 0.34, 0.08, 0.09); // 主货舱
    m.box(0.3, 0.14, 0, 0.1, 0.06, 0.08);
  },
};

const meshCache = new Map();

/** 构建并缓存船体网格（渲染层每 GL 上下文再上传 VBO） */
export function buildHullMesh(hullId) {
  if (meshCache.has(hullId)) return meshCache.get(hullId);
  const m = new MeshBuilder();
  const builder = BUILDERS[hullId];
  if (builder) builder(m);
  else m.hullWedge(1.0, 0.18, 0.06, 0.10, 0.04); // 兜底：通用护卫舰形
  const mesh = m.build();
  meshCache.set(hullId, mesh);
  return mesh;
}

/** 全部可用船体 id（12 种） */
export function availableHullIds() {
  return Object.keys(BUILDERS).sort();
}
