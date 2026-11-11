/**
 * render/meshes/landmarkMeshes.js — 七大旗舰主题地标预制网格（doc7 TASK-2.2/3.2/3.3/3.4）
 *
 * 对应 missionSites.js 蓝图 landmarks[].prefabId 的渲染网格（低多边形、逐位确定、
 * 每 prefab ≤300 三角形；米制单位、基座中心在原点、y=0 贴地、+Y 上）：
 *   reef_dome_ruin        碧渊海洋 — 珍珠白鎏金拱肋半埋珊瑚穹顶（半沉海床，亚特兰蒂斯语法）
 *   central_furnace_tower 永冬炉境 — 12m 黑铁蒸汽/聚变中央热源塔（琥珀暖光即生存半径）
 *   sandstone_arch        赤砾边疆 — 巨型风蚀砂岩拱门（层理分色）
 *   salt_crystal_spire    永夜晶荒 — 月白六棱盐晶簇（紫晶尖冷光；干燥世界无雪纪律）
 *   giant_fumarole_cone   硫雾沼泽 — 巨型硫磺喷气锥（黄绿沼气喷口 + 硫磺结壳带）
 *   soul_willow_tree      星辉生物圈 — 灵魂垂枝母树（发光垂须 + 双层荧光林冠）
 *   obsidian_arch_bridge  黑曜熔海 — 抛物线黑曜石高架拱桥桥面段（~24m 跨，FLAG_BRIDGE_DECK 语义）
 *
 * 经 GroundMeshes.js 的地标注册表暴露（buildLandmarkMesh(prefabId)）；本文件
 * 自包含（不 import GroundMeshes，避免环形依赖），GroundMeshes 单向引用本表。
 *
 * 构建纪律：全部显式坐标/颜色常量 + 确定性数学（无随机）；面法线右手系且
 * 逐面外向自动校正（quad/fan/fustum/dome 传入期望外向 → 绕序翻转防御），
 * 保证 CULL_FACE(CCW)+BACK 下正面可见（与 GroundMeshes/地形网格同一绕序约定）。
 * 顶层禁止访问 document/window（Node 侧可安全 import）。
 */

// ———— 几何构建器（landmark 专用精简版；输出形态与 GroundMeshes.PartMeshBuilder 一致） ————

class LandmarkMeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.parts = [];
    this._cur = null;
  }

  beginPart(name) {
    this._cur = { name, start: this.positions.length / 3, count: 0 };
    this.parts.push(this._cur);
    return this;
  }

  /** 原始三角形（绕序由调用方保证） */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
    if (this._cur) this._cur.count += 3;
    return this;
  }

  /** 四边形 → 2 三角形；法线与期望外向相反时翻转绕序（外向防御） */
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, outx, outy, outz, col) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outx + ny * outy + nz * outz >= 0) {
      this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, col);
      this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, col);
    } else {
      this.tri(ax, ay, az, dx, dy, dz, cx, cy, cz, col);
      this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, col);
    }
    return this;
  }

  /** 三角形外向校正版 */
  triOut(ax, ay, az, bx, by, bz, cx, cy, cz, outx, outy, outz, col) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outx + ny * outy + nz * outz >= 0) {
      this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, col);
    } else {
      this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, col);
    }
    return this;
  }

  /** 轴对齐盒子（12 三角形；绕序与 GroundMeshes.box 同式外向） */
  box(cx, cy, cz, hx, hy, hz, col) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
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
   * 有向梁盒：p0→p1 为轴、up 为横滚提示、w 沿 side、t 沿 nup（12 三角形）。
   * 拱链/拱肋/垂须/扶壁等斜向构件的通用原语（逐面外向校正）。
   */
  slab(p0, p1, up, w, t, col) {
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    let sx = ay * up[2] - az * up[1];
    let sy = az * up[0] - ax * up[2];
    let sz = ax * up[1] - ay * up[0];
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) { sx = -az; sy = 0; sz = ax; sl = Math.hypot(sx, sy, sz) || 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const nx = sy * az - sz * ay;
    const ny = sz * ax - sx * az;
    const nz = sx * ay - sy * ax;
    const hw = w / 2, ht = t / 2;
    const P = [p0, p1];
    const c = [];
    for (let e = 0; e < 2; e++) {
      for (let s = -1; s <= 1; s += 2) {
        for (let u = -1; u <= 1; u += 2) {
          c.push([
            P[e][0] + sx * hw * s + nx * ht * u,
            P[e][1] + sy * hw * s + ny * ht * u,
            P[e][2] + sz * hw * s + nz * ht * u,
          ]);
        }
      }
    }
    // 角点索引：idx = e*4 + (s+ 的 2) + (u+ 的 1)；六面各自外向
    this.quad(c[0][0], c[0][1], c[0][2], c[2][0], c[2][1], c[2][2], c[3][0], c[3][1], c[3][2], c[1][0], c[1][1], c[1][2], -ax, -ay, -az, col);
    this.quad(c[4][0], c[4][1], c[4][2], c[5][0], c[5][1], c[5][2], c[7][0], c[7][1], c[7][2], c[6][0], c[6][1], c[6][2], ax, ay, az, col);
    this.quad(c[0][0], c[0][1], c[0][2], c[1][0], c[1][1], c[1][2], c[5][0], c[5][1], c[5][2], c[4][0], c[4][1], c[4][2], -sx, -sy, -sz, col);
    this.quad(c[2][0], c[2][1], c[2][2], c[6][0], c[6][1], c[6][2], c[7][0], c[7][1], c[7][2], c[3][0], c[3][1], c[3][2], sx, sy, sz, col);
    this.quad(c[0][0], c[0][1], c[0][2], c[4][0], c[4][1], c[4][2], c[6][0], c[6][1], c[6][2], c[2][0], c[2][1], c[2][2], -nx, -ny, -nz, col);
    this.quad(c[1][0], c[1][1], c[1][2], c[3][0], c[3][1], c[3][2], c[7][0], c[7][1], c[7][2], c[5][0], c[5][1], c[5][2], nx, ny, nz, col);
    return this;
  }

  /**
   * Y 轴截锥（圆台；seg 段；可收束到尖顶）；capTop 封顶盖。
   * cy 为底面高，h 为锥高。
   */
  frustumY(cx, cy, cz, r0, r1, h, seg, col, capTop = true) {
    const at = (i, r) => {
      const a = (i / seg) * Math.PI * 2;
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    };
    const y1 = cy + h;
    for (let i = 0; i < seg; i++) {
      const [ax, az] = at(i, r0);
      const [bx, bz] = at(i + 1, r0);
      const [cx1, cz1] = at(i + 1, r1);
      const [dx, dz] = at(i, r1);
      // 侧面外向 = 该段中点径向
      const midA = ((i + 0.5) / seg) * Math.PI * 2;
      const ox = Math.cos(midA), oz = Math.sin(midA);
      this.quad(ax, cy, az, bx, cy, bz, cx1, y1, cz1, dx, y1, dz, ox, 0.12, oz, col);
      if (capTop && r1 > 0.02) {
        const cxy = [cx - cx1, 0, cz - cz1];
        const cxx = [dx - cx1, 0, dz - cz1];
        const onx = cxy[1] * cxx[2] - cxy[2] * cxx[1];
        const ony = cxy[2] * cxx[0] - cxy[0] * cxx[2];
        const onz = cxy[0] * cxx[1] - cxy[1] * cxx[0];
        this.triOut(cx, y1, cz, cx1, y1, cz1, dx, y1, dz, 0, ony >= 0 ? 1 : -1, 0, col);
      }
    }
    return this;
  }

  /** 上半球穹顶（开口朝下不封底；seg 经纬段数） */
  domeY(cx, cy, cz, r, seg, col) {
    const at = (i, j) => {
      const phi = (i / seg) * Math.PI * 0.5;
      const th = (j / seg) * Math.PI * 2;
      return [
        cx + r * Math.cos(phi) * Math.cos(th),
        cy + r * Math.sin(phi),
        cz + r * Math.cos(phi) * Math.sin(th),
      ];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        const mx = (a[0] + c[0]) / 2 - cx;
        const my = (a[1] + c[1]) / 2 - cy;
        const mz = (a[2] + c[2]) / 2 - cz;
        const ml = Math.hypot(mx, my, mz) || 1;
        this.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], mx / ml, my / ml, mz / ml, col);
      }
    }
    return this;
  }

  /** 水平圆盘（三角形扇；outward ±Y） */
  discY(cx, cy, cz, r, seg, col, up = 1) {
    const at = (i) => {
      const a = (i / seg) * Math.PI * 2;
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
    };
    for (let i = 0; i < seg; i++) {
      const [ax, az] = at(i);
      const [bx, bz] = at(i + 1);
      this.triOut(cx, cy, cz, bx, cy, bz, ax, cy, az, 0, up, 0, col);
    }
    return this;
  }

  /** 四棱锥（尖朝上；底面不封） */
  pyramid(cx, baseY, cz, w, h, col) {
    const h2 = w / 2;
    this.tri(cx - h2, baseY, cz - h2, cx + h2, baseY, cz - h2, cx, baseY + h, cz, col);
    this.tri(cx + h2, baseY, cz - h2, cx + h2, baseY, cz + h2, cx, baseY + h, cz, col);
    this.tri(cx + h2, baseY, cz + h2, cx - h2, baseY, cz + h2, cx, baseY + h, cz, col);
    this.tri(cx - h2, baseY, cz + h2, cx - h2, baseY, cz - h2, cx, baseY + h, cz, col);
    return this;
  }

  /** 输出网格（positions/normals/colors Float32Array + partNames + triCount） */
  build() {
    const parts = this.parts.map((p) => ({ name: p.name, start: p.start, count: p.count }));
    if (!parts.length) parts.push({ name: 'main', start: 0, count: this.positions.length / 3 });
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      triCount: this.positions.length / 9,
      partNames: parts,
    };
  }
}

// ———— 地标配色（近似 sRGB 0..1；与 GroundMeshes.COL 同域） ————

const LC = {
  pearl: [0.92, 0.89, 0.80],      // 珍珠白（珊瑚穹顶）
  pearlDark: [0.72, 0.70, 0.62],
  goldRib: [0.82, 0.64, 0.30],    // 鎏金拱肋
  coral: [0.78, 0.42, 0.50],      // 珊瑚紫红
  rubble: [0.55, 0.52, 0.47],
  ironDark: [0.13, 0.14, 0.16],   // 黑铁（热源塔）
  ironMid: [0.22, 0.24, 0.27],
  amber: [0.95, 0.62, 0.28],      // 热源琥珀 #F2A85D
  amberGlow: [1.15, 0.78, 0.38],  // 过亮供辉光
  rust: [0.78, 0.42, 0.23],       // 铁锈红 #C66B3B
  sandGold: [0.83, 0.64, 0.42],   // 沙金 #D4A36A
  dustPale: [0.90, 0.76, 0.55],
  moonWhite: [0.85, 0.87, 0.92],  // 月白 #D8DCE8
  violetTip: [0.74, 0.64, 1.00],  // 极光紫 #BDA4FF
  greyPurple: [0.30, 0.28, 0.34], // 灰紫 #77718F
  charred: [0.16, 0.14, 0.12],    // 焦黑蚀变岩
  sulfur: [0.45, 0.55, 0.17],     // 硫黄结壳 #748F2B
  acidGlow: [0.68, 0.95, 0.30],   // 毒荧绿 #B7D84C（过亮）
  barkDark: [0.09, 0.15, 0.14],   // 深海青树干
  canopyTeal: [0.14, 0.48, 0.40], // 生物青 #42D8C6（暗态）
  frondGlow: [0.24, 0.72, 0.58],  // 垂须发光
  canopyViolet: [0.33, 0.27, 0.62], // 荧光紫 #A981FF
  obsidian: [0.09, 0.07, 0.085],  // 熔岩黑 #160F14
  basaltDeck: [0.13, 0.11, 0.12],
  lavaVein: [0.55, 0.18, 0.06],   // 暗红 #5B171D
};

/** 抛物线采样（拱链/桥面共用；y = yBase + h*(1-(x/half)^2)） */
function parabolaPoint(x, half, yBase, h) {
  const t = x / half;
  return [x, yBase + h * (1 - t * t), 0];
}

// ———— 七大旗舰地标 ————————————————————————————————

/** 碧渊海洋：珍珠白鎏金拱肋半埋珊瑚穹顶（半沉海床 + 破损门柱 + 散落残骸） */
function buildReefDomeRuin() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('dome');
  m.domeY(0, -1.2, 0, 5.2, 7, LC.pearl);                       // 半埋主穹（顶部 +4.0m）
  m.beginPart('ribs');
  // 两条鎏金拱肋沿穹面经线爬升（各 3 段有向梁）
  for (const azOff of [0.9, -0.7]) {
    const az = azOff;
    let prev = null;
    for (let k = 0; k <= 3; k++) {
      const phi = 0.15 + (k / 3) * 1.15;
      const rr = 5.35;
      const p = [rr * Math.cos(phi) * Math.cos(az), -1.2 + rr * Math.sin(phi), rr * Math.cos(phi) * Math.sin(az)];
      if (prev) m.slab(prev, p, [Math.sin(az), 0, -Math.cos(az)], 0.55, 0.30, LC.goldRib);
      prev = p;
    }
  }
  m.beginPart('gate');
  m.box(-1.9, 1.3, 5.0, 0.55, 1.3, 0.55, LC.pearlDark);        // 破损门柱 ×2
  m.box(1.9, 1.1, 5.0, 0.55, 1.1, 0.55, LC.pearlDark);
  m.slab([-1.9, 2.75, 5.0], [1.9, 2.6, 5.0], [0, 0, 1], 0.7, 0.9, LC.coral); // 断梁门楣
  m.beginPart('rubble');
  m.box(-3.4, 0.35, 3.2, 0.9, 0.35, 0.7, LC.rubble);
  m.box(3.6, 0.28, 2.4, 0.7, 0.28, 0.6, LC.rubble);
  m.box(0.6, 0.22, -4.6, 0.8, 0.22, 0.55, LC.coral);
  return m.build();
}

/** 永冬炉境：12m 黑铁蒸汽/聚变中央热源塔（琥珀热环 + 观察窗 + 顶部信标） */
function buildCentralFurnaceTower() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('base');
  m.box(0, 0.35, 0, 3.2, 0.35, 3.2, LC.ironDark);
  m.beginPart('stack');
  m.frustumY(0, 0.7, 0, 1.9, 1.45, 3.4, 8, LC.ironMid);        // 三级收分塔身
  m.frustumY(0, 4.1, 0, 1.45, 1.05, 3.4, 8, LC.ironMid);
  m.frustumY(0, 7.5, 0, 1.05, 0.75, 3.2, 8, LC.ironMid);
  m.discY(0, 10.7, 0, 0.75, 8, LC.ironDark);                   // 顶盖
  m.beginPart('heatRing');
  m.frustumY(0, 3.9, 0, 1.50, 1.50, 0.5, 8, LC.amber, false);  // 琥珀热环（生存半径可视化）
  m.beginPart('windows');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const px = Math.cos(a) * 1.42, pz = Math.sin(a) * 1.42;
    m.slab([px, 4.6, pz], [px, 6.4, pz], [-Math.sin(a), 0, Math.cos(a)], 0.5, 0.12, LC.amberGlow);
  }
  m.beginPart('vents');
  m.frustumY(0.9, 10.7, 0.4, 0.18, 0.13, 1.6, 6, LC.ironDark); // 蒸汽立管 ×2
  m.frustumY(-0.8, 10.7, -0.5, 0.16, 0.12, 1.3, 6, LC.ironDark);
  m.beginPart('beacon');
  m.pyramid(0, 10.72, 0, 0.9, 1.3, LC.amberGlow);              // 顶部信标
  return m.build();
}

/** 赤砾边疆：巨型风蚀砂岩拱门（18m 跨；层理分色 + 扶壁 + 陨石残块） */
function buildSandstoneArch() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('legs');
  m.frustumY(-7.2, 0, 0, 2.6, 1.7, 4.5, 6, LC.rust);
  m.frustumY(7.2, 0, 0, 2.6, 1.7, 4.5, 6, LC.rust);
  m.beginPart('arch');
  // 抛物线拱链（7 段有向梁；层理分色逐段交替）
  let prev = null;
  for (let k = 0; k <= 7; k++) {
    const x = -7.2 + (k / 7) * 14.4;
    const p = parabolaPoint(x, 9.0, 3.2, 7.2);
    if (prev) m.slab(prev, p, [0, 1, 0], 4.6, 1.9, k % 2 === 0 ? LC.sandGold : LC.rust);
    prev = p;
  }
  m.beginPart('buttress');
  m.slab([-9.4, 0, 1.9], [-7.9, 3.5, 0.7], [0, 1, 0], 1.4, 1.0, LC.dustPale); // 风蚀扶壁 ×2
  m.slab([9.4, 0, -1.9], [7.9, 3.5, -0.7], [0, 1, 0], 1.4, 1.0, LC.dustPale);
  m.beginPart('debris');
  m.box(-5.0, 0.5, 4.4, 1.1, 0.5, 0.9, LC.rust);               // 陨坑溅射残块
  m.box(5.6, 0.4, -4.2, 0.9, 0.4, 0.8, LC.sandGold);
  return m.build();
}

/** 永夜晶荒：月白六棱盐晶簇（干燥世界析出盐晶；紫晶尖冷光；无雪纪律） */
function buildSaltCrystalSpire() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('bedrock');
  m.frustumY(0, 0, 0, 2.6, 2.2, 0.5, 6, LC.greyPurple);        // 盐晶基盘
  m.beginPart('spire');
  m.frustumY(0, 0.4, 0, 1.5, 0.55, 6.2, 6, LC.moonWhite);      // 主晶柱（六棱）
  m.frustumY(0, 6.6, 0, 0.55, 0.03, 1.7, 6, LC.violetTip);     // 紫晶尖
  m.beginPart('crystals');
  const sats = [
    [-1.9, 0.9, 1.4, 0.62, 2.8], [1.7, 0.7, -1.5, 0.55, 2.2],
    [1.2, 0.8, 1.9, 0.45, 1.7], [-1.3, 0.6, -1.9, 0.5, 2.5],
  ];
  for (const [sx, sy, sz, r, h] of sats) {
    m.frustumY(sx, sy, sz, r, r * 0.4, h, 4, LC.moonWhite);
    m.frustumY(sx, sy + h, sz, r * 0.4, 0.02, h * 0.45, 4, LC.violetTip);
  }
  m.beginPart('shards');
  m.box(-2.8, 0.25, -0.6, 0.7, 0.25, 0.5, LC.moonWhite);       // 晶砾
  m.box(2.6, 0.2, 0.9, 0.55, 0.2, 0.45, LC.violetTip);
  return m.build();
}

/** 硫雾沼泽：巨型硫磺喷气锥（喷口毒荧绿 + 硫磺结壳带 + 崩积岩块） */
function buildGiantFumaroleCone() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('cone');
  m.frustumY(0, 0, 0, 4.2, 2.6, 4.5, 8, LC.charred);           // 焦黑蚀变岩锥体
  m.frustumY(0, 4.5, 0, 2.6, 1.7, 3.0, 8, LC.charred);
  m.beginPart('crust');
  m.frustumY(0, 2.2, 0, 3.35, 3.25, 0.7, 8, LC.sulfur, false); // 硫磺结壳带 ×2
  m.frustumY(0, 6.3, 0, 1.95, 1.85, 0.6, 8, LC.sulfur, false);
  m.beginPart('rim');
  m.frustumY(0, 7.5, 0, 1.7, 1.9, 0.5, 8, LC.charred);         // 外翻火山口缘
  m.discY(0, 7.6, 0, 1.5, 8, LC.acidGlow, 1);                  // 喷口毒荧绿辉光
  m.beginPart('skree');
  m.box(-4.6, 0.4, 1.2, 1.0, 0.4, 0.8, LC.charred);            // 崩积岩块
  m.box(4.4, 0.35, -1.4, 0.9, 0.35, 0.7, LC.sulfur);
  m.box(1.8, 0.3, 4.3, 0.8, 0.3, 0.6, LC.charred);
  m.box(-2.0, 0.28, -4.4, 0.75, 0.28, 0.6, LC.sulfur);
  return m.build();
}

/** 星辉生物圈：灵魂垂枝母树（深青树干 + 双层荧光林冠 + 发光垂须） */
function buildSoulWillowTree() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('trunk');
  m.frustumY(0, 0, 0, 1.0, 0.7, 3.0, 6, LC.barkDark);
  m.frustumY(0, 3.0, 0, 0.7, 0.5, 3.0, 6, LC.barkDark);
  m.frustumY(0, 6.0, 0, 0.5, 0.38, 2.4, 6, LC.barkDark);
  m.beginPart('roots');
  m.slab([-2.2, 0, 1.4], [-0.3, 1.0, 0.4], [0, 1, 0], 0.5, 0.7, LC.barkDark); // 板根 ×3
  m.slab([2.0, 0, 1.6], [0.3, 0.9, 0.5], [0, 1, 0], 0.5, 0.7, LC.barkDark);
  m.slab([0.4, 0, -2.3], [-0.2, 1.0, -0.4], [0, 1, 0], 0.5, 0.7, LC.barkDark);
  m.beginPart('canopy');
  m.domeY(0, 7.6, 0, 5.4, 7, LC.canopyTeal);                   // 主林冠
  m.domeY(0, 6.4, 0, 3.6, 5, LC.canopyViolet);                 // 内层紫荧光林冠
  m.beginPart('fronds');
  m.slab([-3.4, 8.4, 1.5], [-4.1, 5.4, 1.9], [0, 1, 0], 0.7, 0.12, LC.frondGlow); // 垂须 ×4
  m.slab([3.2, 8.6, -1.3], [3.9, 5.6, -1.7], [0, 1, 0], 0.7, 0.12, LC.frondGlow);
  m.slab([1.2, 9.2, 3.6], [1.6, 6.4, 4.4], [0, 1, 0], 0.6, 0.12, LC.frondGlow);
  m.slab([-1.4, 9.0, -3.5], [-1.9, 6.2, -4.2], [0, 1, 0], 0.6, 0.12, LC.frondGlow);
  return m.build();
}

/** 黑曜熔海：抛物线黑曜石高架拱桥桥面段（~24m 跨；桥面承重 FLAG_BRIDGE_DECK 语义） */
function buildObsidianArchBridge() {
  const m = new LandmarkMeshBuilder();
  m.beginPart('deck');
  // 桥面：抛物线拱上 8 段有向梁（可行走面，宽 3.4m）
  let prev = null;
  for (let k = 0; k <= 8; k++) {
    const x = -12 + (k / 8) * 24;
    const p = parabolaPoint(x, 12.0, 2.0, 5.2);
    if (prev) m.slab(prev, p, [0, 1, 0], 3.4, 0.5, LC.basaltDeck);
    prev = p;
  }
  m.beginPart('arch');
  // 结构拱肋：桥面下方 6 段（熔火红纹显岩浆渗光）
  prev = null;
  for (let k = 0; k <= 6; k++) {
    const x = -10 + (k / 6) * 20;
    const p = parabolaPoint(x, 12.0, 0.55, 5.2);
    if (prev) m.slab(prev, p, [0, 1, 0], 2.2, 1.1, k === 3 ? LC.lavaVein : LC.obsidian);
    prev = p;
  }
  m.beginPart('rails');
  // 两侧栏索：各 5 段细梁（断口即侧翼捷径的「断裂缺口」语义锚点）
  for (const zs of [-1, 1]) {
    let rp = null;
    for (let k = 0; k <= 5; k++) {
      const x = -12 + (k / 5) * 24;
      const base = parabolaPoint(x, 12.0, 2.0, 5.2);
      const p = [base[0], base[1] + 0.85, zs * 1.7];
      if (rp) m.slab(rp, p, [0, 1, 0], 0.16, 0.55, LC.obsidian);
      rp = p;
    }
  }
  return m.build();
}

// ———— 注册表 ————————————————————————————————

/** 旗舰地标预制 id（missionSites.js landmarks[].prefabId 引用同名字串） */
export const LANDMARK_PREFAB_IDS = [
  'reef_dome_ruin',
  'central_furnace_tower',
  'sandstone_arch',
  'salt_crystal_spire',
  'giant_fumarole_cone',
  'soul_willow_tree',
  'obsidian_arch_bridge',
];

/** prefabId → builder 注册表（GroundMeshes 经此暴露地标网格门面；可运行时扩充） */
export const LANDMARK_MESH_BUILDERS = new Map([
  ['reef_dome_ruin', buildReefDomeRuin],
  ['central_furnace_tower', buildCentralFurnaceTower],
  ['sandstone_arch', buildSandstoneArch],
  ['salt_crystal_spire', buildSaltCrystalSpire],
  // doc9 P0-3 兼容别名：missionSites 旧稿拼写（月白盐柱）→ 同一盐晶簇构建器
  ['moonwhite_salt_monolith', buildSaltCrystalSpire],
  ['giant_fumarole_cone', buildGiantFumaroleCone],
  ['soul_willow_tree', buildSoulWillowTree],
  ['obsidian_arch_bridge', buildObsidianArchBridge],
]);

/**
 * 运行时注册补充地标预制（扩展主题 TASK-4.x 复用同一条地标通路）。
 * @param {string} prefabId @param {()=>object} builder 同 PartMeshBuilder 输出形态
 */
export function registerLandmarkBuilder(prefabId, builder) {
  if (typeof builder !== 'function') throw new Error('[landmarkMeshes] builder 须为函数');
  LANDMARK_MESH_BUILDERS.set(String(prefabId), builder);
  if (!LANDMARK_PREFAB_IDS.includes(String(prefabId))) LANDMARK_PREFAB_IDS.push(String(prefabId));
}

/**
 * 构建地标预制网格。
 * @param {string} prefabId missionSites.js 蓝图 landmarks[].prefabId
 * @returns {object} { positions, normals, colors, triCount, partNames }（米制、基座原点、y=0 贴地）
 */
export function buildLandmarkMesh(prefabId) {
  const builder = LANDMARK_MESH_BUILDERS.get(String(prefabId));
  if (!builder) throw new Error(`[landmarkMeshes] 未知地标预制 id: ${prefabId}`);
  return builder();
}

// ════════════════════════════════════════════════════════════════════════
// SPEC-39 Phase S2：12 座深度 POI 预制 + 4 类野战部署物网格
//
// 契约（doc38 §几何预算 / SPEC-39 §切片二）：
//  - 单网格三角形数 ≤ 对应 surfaceNarratives.SURFACE_POI_BLUEPRINTS.tris 预算
//    （384/312/248/276/412/396/368/340/356/296/428/324；部署物 96~180）；
//  - 所有地表建筑底部自带向下延伸 1.8m 的 skirt 裙边（混凝土/玄武岩包络悬空侧）；
//  - 残骸类（cat=wreck）自带 8°~15° 埋入倾角语义（倾角由拓扑层 tiltDeg 在实例
//    rotY 之外经 scale/rotX 表达——本图集提供 tiltPrefab 语义常量，实例化时应用）；
//  - 全部显式坐标/颜色常量 + 确定性数学（无随机），米制、基座中心原点、y=0 贴地。
// ════════════════════════════════════════════════════════════════════════

/** POI/部署物配色扩展（与 LC 同域 sRGB 0..1） */
const PC = {
  hullGrey: [0.42, 0.46, 0.50],      // 舰体灰
  hullDark: [0.24, 0.27, 0.31],      // 烧蚀黑
  scorch: [0.14, 0.12, 0.11],        // 焦痕
  orangeMark: [0.92, 0.48, 0.16],    // 应急橙涂装
  tealGlass: [0.30, 0.78, 0.78],     // 青玻璃
  crateTan: [0.66, 0.56, 0.38],      // 货箱黄褐
  cryoWhite: [0.88, 0.94, 0.98],     // 低温白
  cryoFrost: [0.62, 0.82, 0.92],     // 霜蓝
  bioGreen: [0.36, 0.72, 0.34],      // 生化绿
  contagion: [0.72, 0.86, 0.28],     // 孢子黄绿
  domeGlass: [0.52, 0.80, 0.66],     // 温室玻璃
  leafVivid: [0.30, 0.66, 0.42],     // 过境藤蔓
  rigIron: [0.30, 0.32, 0.35],       // 钻机铁灰
  rigAmber: [1.05, 0.66, 0.22],      // 钻机琥珀（过亮供辉光）
  bunkerGreen: [0.34, 0.40, 0.34],   // 掩体军绿
  radarWhite: [0.82, 0.86, 0.88],    // 天线白
  monolith: [0.16, 0.17, 0.22],      // 先驱巨石玄黑
  monoGlow: [0.55, 0.95, 0.88],      // 先驱青绿辉光（过亮）
  prismCyan: [0.45, 0.92, 1.05],     // 棱镜青（过亮）
  zeroViolet: [0.70, 0.55, 1.05],    // 零点能紫（过亮）
  vaultBronze: [0.55, 0.42, 0.24],   // 密室青铜
  turretGun: [0.20, 0.22, 0.24],     // 哨兵塔炮体
  decoyRed: [1.0, 0.30, 0.24],       // 诱饵警示红（过亮）
  padConcrete: [0.36, 0.36, 0.37],   // 承台混凝土
};

/**
 * 1.8m 裙边（全 POI/部署物共用；box 12 tri）。
 * halfW/halfD 为主体半宽深（裙边微外扩 0.08m 包络坡地悬空侧），y ∈ [-1.8, 0]。
 */
function poiSkirt(m, halfW, halfD, col = PC.padConcrete) {
  m.beginPart('skirt');
  m.box(0, -0.9, 0, halfW + 0.08, 0.9, halfD + 0.08, col);
  return m;
}

/** —— POI-01 开拓者先遣护卫舰残骸（预算 384；俯仰埋入由实例 tiltDeg 应用） —— */
function buildPoiWreckPioneerFrigate() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 7.0, 2.6, PC.scorch);
  m.beginPart('hull');
  m.box(0, 1.0, 0, 6.5, 1.0, 1.8, PC.hullGrey);              // 主舱段
  m.box(-5.2, 1.5, 0, 1.6, 0.7, 1.1, PC.hullDark);           // 尽毁艏段
  m.beginPart('bridge');
  m.box(2.4, 2.5, 0, 1.5, 0.8, 1.2, PC.hullDark);            // 舰桥
  m.box(2.4, 3.4, 0, 0.7, 0.18, 0.7, PC.tealGlass);          // 观察窗带
  m.beginPart('engines');
  m.frustumY(-6.3, 0.4, 0.9, 0.95, 0.55, 1.6, 8, PC.hullDark);  // 左引擎
  m.frustumY(-6.3, 0.4, -0.9, 0.95, 0.55, 1.6, 8, PC.hullDark); // 右引擎
  m.discY(-6.3, 2.0, 0.9, 0.55, 8, PC.orangeMark);           // 喷口残焰涂装
  m.discY(-6.3, 2.0, -0.9, 0.55, 8, PC.scorch);
  m.beginPart('wings');
  m.slab([0.5, 1.2, 1.8], [-2.2, 1.5, 4.6], [0, 0, 1], 2.2, 0.24, PC.hullGrey);  // 左翼
  m.slab([0.5, 1.2, -1.8], [-2.2, 1.5, -4.6], [0, 0, 1], 2.2, 0.24, PC.hullGrey); // 右翼
  m.beginPart('trench');
  m.box(3.4, 0.28, 2.4, 2.6, 0.28, 0.9, PC.scorch);          // 撞击犁沟（-1.2m 语义由承台/地形凹陷承担）
  m.box(5.2, 0.22, 0.6, 1.6, 0.22, 0.7, PC.scorch);
  m.beginPart('arrays');
  m.box(-1.2, 2.2, 2.6, 1.5, 0.06, 0.8, PC.tealGlass);       // 散热板阵
  m.box(-3.0, 2.0, 2.6, 1.2, 0.06, 0.7, PC.tealGlass);
  m.box(-1.2, 2.2, -2.6, 1.5, 0.06, 0.8, PC.tealGlass);
  m.box(-3.0, 2.0, -2.6, 1.2, 0.06, 0.7, PC.tealGlass);
  m.beginPart('debris');
  m.box(7.6, 0.4, -2.2, 0.9, 0.4, 0.7, PC.hullGrey);
  m.box(6.8, 0.3, 3.0, 0.7, 0.3, 0.6, PC.hullDark);
  m.box(-7.4, 0.35, 2.8, 0.8, 0.35, 0.6, PC.hullGrey);
  m.box(1.4, 0.28, -4.8, 0.6, 0.28, 0.5, PC.hullDark);
  return m.build();
}

/** —— POI-02 海盗掠袭侦察艇残骸（预算 312） —— */
function buildPoiWreckPirateCorvette() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 4.6, 2.0, PC.scorch);
  m.beginPart('hull');
  m.box(0, 0.9, 0, 4.4, 0.8, 1.4, PC.hullDark);              // 掠袭艇低矮主舱
  m.box(3.8, 1.4, 0, 1.0, 0.5, 1.0, PC.hullGrey);            // 破损艦桥罩
  m.beginPart('fins');
  m.slab([-1.0, 1.0, 1.2], [-3.4, 3.0, 2.4], [0, 0, 1], 1.6, 0.2, PC.orangeMark); // 掠袭鳍×2
  m.slab([-1.0, 1.0, -1.2], [-3.4, 3.0, -2.4], [0, 0, 1], 1.6, 0.2, PC.orangeMark);
  m.beginPart('hold');
  m.box(-3.0, 0.7, 0, 1.4, 0.7, 1.0, PC.hullGrey);           // 走私货舱（密码锁位）
  m.box(-3.0, 1.5, 0, 0.5, 0.12, 0.5, PC.decoyRed);          // 诡雷指示灯
  m.beginPart('cannon');
  m.box(4.2, 0.8, 1.1, 1.4, 0.14, 0.14, PC.turretGun);       // 掠袭机炮×2
  m.box(4.2, 0.8, -1.1, 1.4, 0.14, 0.14, PC.turretGun);
  m.beginPart('debris');
  m.box(-6.0, 0.3, 1.8, 0.8, 0.3, 0.6, PC.hullDark);
  m.box(6.2, 0.26, -1.6, 0.7, 0.26, 0.5, PC.hullGrey);
  m.box(0.4, 0.24, 3.4, 0.6, 0.24, 0.5, PC.orangeMark);
  m.box(-1.8, 0.22, -3.6, 0.5, 0.22, 0.45, PC.hullDark);
  return m.build();
}

/** —— POI-03 无人轨道货柜散落群（预算 248） —— */
function buildPoiWreckCargoPodCluster() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 4.2, 3.6, PC.padConcrete);
  m.beginPart('pods');
  m.frustumY(0, 0, 0, 1.5, 1.35, 3.0, 6, PC.crateTan);       // 1 号货柜
  m.frustumY(2.9, 0, 1.6, 1.3, 1.2, 2.6, 6, PC.hullGrey);    // 2 号货柜（覆土位）
  m.frustumY(-2.6, 0, -1.8, 1.2, 1.1, 2.4, 6, PC.crateTan);  // 3 号货柜
  m.beginPart('rings');
  m.frustumY(0, 2.1, 0, 1.55, 1.55, 0.28, 6, PC.orangeMark, false); // 加固环带
  m.frustumY(2.9, 1.9, 1.6, 1.35, 1.35, 0.24, 6, PC.orangeMark, false);
  m.beginPart('crates');
  m.box(1.4, 0.35, -2.4, 0.55, 0.35, 0.45, PC.crateTan);     // 散落箱
  m.box(-1.8, 0.3, 2.6, 0.5, 0.3, 0.4, PC.hullGrey);
  m.box(3.8, 0.28, -0.8, 0.45, 0.28, 0.38, PC.crateTan);
  m.box(-4.0, 0.26, 0.6, 0.42, 0.26, 0.36, PC.hullGrey);
  return m.build();
}

/** —— POI-04 深空低温休眠救生艇（预算 276） —— */
function buildPoiWreckCryoLifeboat() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 3.4, 2.2, PC.cryoFrost);
  m.beginPart('capsule');
  m.frustumY(0, 0.2, 0, 1.6, 1.3, 3.4, 8, PC.cryoWhite);     // 低温主舱
  m.domeY(0, 3.6, 0, 1.3, 6, PC.cryoFrost);                  // 圆钝头部
  m.beginPart('pods');
  m.box(-2.0, 1.2, 0, 0.7, 0.9, 0.7, PC.cryoWhite);          // 单人休眠外挂舱
  m.box(2.0, 1.2, 0, 0.7, 0.9, 0.7, PC.cryoWhite);
  m.box(-2.0, 2.2, 0, 0.5, 0.12, 0.5, PC.tealGlass);         // 体征观察窗
  m.beginPart('radiator');
  m.box(0, 2.0, 1.6, 2.2, 0.05, 0.7, PC.cryoFrost);          // 辐射翼板
  m.box(0, 2.0, -1.6, 2.2, 0.05, 0.7, PC.cryoFrost);
  m.beginPart('status');
  m.box(0, 4.0, 0, 0.16, 0.5, 0.16, PC.bioGreen);            // 生命体征灯柱
  m.box(0.9, 0.3, 2.4, 0.5, 0.3, 0.4, PC.cryoWhite);         // 坠落散件
  return m.build();
}

/** —— POI-05 受灾废弃异星生化实验室（预算 412） —— */
function buildPoiOutpostXenobioLab() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 5.2, 3.8);
  m.beginPart('main');
  m.box(0, 1.5, 0, 4.8, 1.5, 3.4, PC.hullGrey);              // 主实验室舱
  m.box(0, 3.1, 0, 4.6, 0.14, 3.2, PC.hullDark);             // 顶板
  m.beginPart('filter');
  m.frustumY(-3.4, 3.2, 0, 0.7, 0.5, 3.2, 6, PC.rigIron);    // 抽风过滤塔
  m.frustumY(-3.4, 6.4, 0, 0.5, 0.35, 0.9, 6, PC.bioGreen);
  m.beginPart('greenhouse');
  m.domeY(2.6, 3.2, 0, 1.9, 6, PC.domeGlass);                // 破裂培养穹顶
  m.beginPart('tanks');
  m.frustumY(3.8, 0, 2.4, 0.6, 0.5, 2.0, 6, PC.tealGlass);   // 培养罐×2
  m.frustumY(3.8, 0, -2.4, 0.6, 0.5, 2.0, 6, PC.tealGlass);
  m.beginPart('vents');
  m.box(0, 2.0, 3.4, 1.6, 0.4, 0.4, PC.rigIron);             // 管桥
  m.box(-2.0, 2.2, 2.6, 0.4, 0.3, 0.9, PC.rigIron);
  m.beginPart('spill');
  m.box(1.0, 0.15, 4.4, 1.8, 0.15, 1.0, PC.contagion);       // 孢子溢滩（荧光）
  m.box(-1.6, 0.12, 4.8, 1.0, 0.12, 0.7, PC.contagion);
  m.box(-6.4, 0.3, -2.6, 0.7, 0.3, 0.6, PC.hullDark);        // 撤离残件
  return m.build();
}

/** —— POI-06 失控共生水培温室站（预算 396） —— */
function buildPoiOutpostHydroponicDome() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 5.6, 5.6);
  m.beginPart('dome');
  m.domeY(0, 0.3, 0, 5.0, 8, PC.domeGlass);                  // 主温室穹顶
  m.beginPart('frame');
  m.frustumY(0, 0, 0, 5.15, 5.15, 0.35, 8, PC.rigIron, false); // 基座环梁
  m.beginPart('racks');
  m.box(-2.2, 1.0, 0, 1.0, 0.7, 2.2, PC.rigIron);            // 立体种植架×2
  m.box(2.2, 1.0, 0, 1.0, 0.7, 2.2, PC.rigIron);
  m.box(-2.2, 1.8, 0, 0.9, 0.1, 2.0, PC.leafVivid);          // 过境藤蔓层
  m.box(2.2, 1.8, 0, 0.9, 0.1, 2.0, PC.leafVivid);
  m.beginPart('core');
  m.frustumY(0, 0.3, 0, 0.8, 0.5, 3.6, 6, PC.rigIron);       // 中央母株塔
  m.domeY(0, 4.1, 0, 0.75, 5, PC.leafVivid);                 // 母株荧光冠
  m.beginPart('vine');
  m.slab([-4.2, 2.4, 1.2], [-5.6, 0.4, 2.6], [0, 1, 0], 0.4, 0.3, PC.leafVivid); // 破口藤蔓×2
  m.slab([3.6, 3.0, -2.0], [5.4, 0.5, -3.4], [0, 1, 0], 0.45, 0.32, PC.leafVivid);
  return m.build();
}

/** —— POI-07 自动化深井同位素采矿站（预算 368） —— */
function buildPoiOutpostDeepcoreRig() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 4.4, 4.4);
  m.beginPart('deck');
  m.box(0, 0.5, 0, 3.8, 0.5, 3.8, PC.rigIron);               // 作业平台
  m.beginPart('derrick');
  m.box(-1.6, 3.0, -1.6, 0.16, 2.5, 0.16, PC.rigIron);       // 井架四足
  m.box(-1.6, 3.0, 1.6, 0.16, 2.5, 0.16, PC.rigIron);
  m.box(1.6, 3.0, -1.6, 0.16, 2.5, 0.16, PC.rigIron);
  m.box(1.6, 3.0, 1.6, 0.16, 2.5, 0.16, PC.rigIron);
  m.box(0, 5.6, 0, 1.8, 0.14, 1.8, PC.rigIron);              // 顶部横梁
  m.beginPart('drill');
  m.frustumY(0, 1.0, 0, 0.55, 0.4, 4.6, 6, PC.rigAmber);     // 主钻杆（琥珀辉光）
  m.beginPart('tanks');
  m.frustumY(-3.2, 0, 0, 0.9, 0.75, 2.2, 6, PC.rigIron);     // 同位素罐×2
  m.frustumY(-3.2, 2.2, 0, 0.75, 0.5, 0.8, 6, PC.rigAmber);
  m.box(3.2, 0.8, 0, 0.8, 0.8, 0.8, PC.rigIron);             // 配电舱
  m.beginPart('boom');
  m.slab([0, 5.6, 0], [4.6, 3.4, 0], [0, 0, 1], 0.5, 0.35, PC.rigIron); // 悬臂
  m.box(5.0, 3.2, 0, 0.5, 0.4, 0.5, PC.rigAmber);
  return m.build();
}

/** —— POI-08 深空加密监听与雷达掩体（预算 340） —— */
function buildPoiOutpostCommsBunker() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 4.6, 3.6);
  m.beginPart('bunker');
  m.box(0, 0.9, 0, 4.0, 0.9, 3.0, PC.bunkerGreen);           // 掩体主部
  m.box(0, 1.9, 0, 3.6, 0.16, 2.6, PC.hullDark);             // 顶板
  m.box(3.0, 1.3, 0, 0.9, 0.4, 0.9, PC.bunkerGreen);         // 门斗
  m.beginPart('antenna');
  m.frustumY(-1.2, 2.0, 0, 0.22, 0.16, 4.6, 6, PC.rigIron);  // 主桅
  m.pyramid(-1.2, 6.6, 0, 1.6, 0.7, PC.radarWhite);          // 碟形天线（锥代）
  m.box(-1.2, 5.2, 0, 0.9, 0.08, 0.08, PC.radarWhite);       // 横杆
  m.beginPart('dish2');
  m.pyramid(1.8, 2.1, -1.6, 1.1, 0.5, PC.radarWhite);        // 副天线
  m.frustumY(1.8, 2.0, -1.6, 0.14, 0.1, 2.1, 6, PC.rigIron);
  m.beginPart('power');
  m.box(2.4, 0.6, 2.2, 1.0, 0.6, 0.7, PC.rigIron);           // 燃料电池舱
  m.box(2.4, 1.35, 2.2, 0.4, 0.12, 0.3, PC.bioGreen);        // 状态灯
  return m.build();
}

/** —— POI-09 先驱者弦环共鸣巨石阵（预算 356） —— */
function buildPoiXenoRingMonolith() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 6.4, 6.4, PC.monolith);
  m.beginPart('ring');
  // 八段弦环（八角排布；每段 slab 12 tri）
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2;
    const a1 = ((k + 1) / 8) * Math.PI * 2;
    const r = 5.2;
    m.slab(
      [Math.cos(a0) * r, 2.6, Math.sin(a0) * r],
      [Math.cos(a1) * r, 2.6, Math.sin(a1) * r],
      [0, 1, 0], 0.9, 0.9, PC.monolith,
    );
  }
  m.beginPart('pylons');
  m.frustumY(0, 0, 0, 1.4, 0.9, 5.2, 6, PC.monolith);        // 主碑
  m.frustumY(0, 5.2, 0, 0.9, 0.02, 1.0, 6, PC.monoGlow);     // 主碑顶晶
  m.frustumY(6.4, 0, 0, 0.55, 0.4, 2.2, 4, PC.monolith);     // 方言副碑×3
  m.frustumY(-3.2, 0, 5.5, 0.55, 0.4, 2.0, 4, PC.monolith);
  m.frustumY(-3.2, 0, -5.5, 0.55, 0.4, 2.0, 4, PC.monolith);
  m.beginPart('glyphs');
  m.box(0, 3.0, 1.45, 0.7, 0.9, 0.06, PC.monoGlow);          // 主碑语素刻带
  m.box(6.4, 1.2, 0.42, 0.3, 0.5, 0.05, PC.monoGlow);        // 副碑刻痕
  return m.build();
}

/** —— POI-10 反重力零点能导流柱（预算 296） —— */
function buildPoiXenoAntigravPylon() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 3.4, 3.4, PC.monolith);
  m.beginPart('column');
  m.frustumY(0, 0.6, 0, 1.15, 0.8, 5.6, 6, PC.monolith);     // 悬空主柱（底部 0.6m 反重力间隙）
  m.frustumY(0, 6.2, 0, 0.8, 0.05, 1.2, 6, PC.zeroViolet);   // 零点能晶尖
  m.beginPart('anchors');
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const px = Math.cos(a) * 2.6;
    const pz = Math.sin(a) * 2.6;
    m.frustumY(px, 0, pz, 0.34, 0.26, 1.4, 4, PC.monolith);  // 锚链桩×3
    m.slab([px, 1.4, pz], [Math.cos(a) * 1.15, 2.6, Math.sin(a) * 1.15], [0, 1, 0], 0.12, 0.12, PC.zeroViolet); // 磁通锚链
  }
  m.beginPart('ring');
  m.frustumY(0, 2.6, 0, 1.5, 1.5, 0.22, 8, PC.zeroViolet, false); // 谐振环
  return m.build();
}

/** —— POI-11 远古先驱者地下封印密室（预算 428） —— */
function buildPoiXenoSubterraneanVault() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 5.4, 5.4, PC.monolith);
  m.beginPart('mastab');
  m.box(0, 0.7, 0, 4.6, 0.7, 4.6, PC.monolith);              // 半地下封印台
  m.box(0, 1.5, 0, 3.6, 0.85, 3.6, PC.vaultBronze);          // 圣物柜环廊
  m.beginPart('door');
  m.box(0, 2.6, 3.7, 1.4, 1.1, 0.5, PC.monolith);            // 符号逻辑门
  m.box(-0.5, 2.7, 3.98, 0.16, 0.16, 0.06, PC.monoGlow);     // 符号锁孔×3
  m.box(0.0, 2.7, 3.98, 0.16, 0.16, 0.06, PC.monoGlow);
  m.box(0.5, 2.7, 3.98, 0.16, 0.16, 0.06, PC.monoGlow);
  m.beginPart('obelisks');
  m.frustumY(-3.4, 0.7, -3.4, 0.5, 0.35, 3.4, 4, PC.monolith); // 封印方尖碑×4
  m.frustumY(3.4, 0.7, -3.4, 0.5, 0.35, 3.4, 4, PC.monolith);
  m.frustumY(-3.4, 0.7, 3.4, 0.5, 0.35, 3.0, 4, PC.monolith);
  m.frustumY(3.4, 0.7, 3.4, 0.5, 0.35, 3.0, 4, PC.monolith);
  m.beginPart('vault');
  m.domeY(0, 2.35, 0, 3.4, 7, PC.monolith);                  // 穹顶封印
  m.box(0, 4.3, 0, 0.3, 0.55, 0.3, PC.monoGlow);             // 顶核晶
  return m.build();
}

/** —— POI-12 棱镜光学谐振矩阵遗址（预算 324） —— */
function buildPoiXenoHarmonicPrism() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 5.8, 5.8, PC.monolith);
  m.beginPart('tower');
  m.frustumY(0, 0, 0, 1.05, 0.7, 6.4, 6, PC.monolith);       // 主晶塔
  m.frustumY(0, 6.4, 0, 0.7, 0.02, 1.4, 6, PC.prismCyan);    // 聚焦顶
  m.beginPart('prisms');
  // 三座可旋转棱镜基座（KeyE 旋转语义由实例动画承担）
  const ang = [0.3, 0.3 + (Math.PI * 2) / 3, 0.3 + (Math.PI * 4) / 3];
  for (let k = 0; k < 3; k++) {
    const px = Math.cos(ang[k]) * 4.4;
    const pz = Math.sin(ang[k]) * 4.4;
    m.frustumY(px, 0, pz, 0.8, 0.6, 1.0, 6, PC.monolith);    // 基座
    m.pyramid(px, 1.0, pz, 1.5, 2.2, PC.prismCyan);          // 棱镜晶体
  }
  m.beginPart('bench');
  m.box(0, 0.25, 0, 4.9, 0.25, 4.9, PC.padConcrete);         // 光路基准台
  m.box(2.2, 0.55, 0, 0.1, 0.3, 0.1, PC.prismCyan);          // 光路中继点
  m.box(-2.2, 0.55, 0, 0.1, 0.3, 0.1, PC.prismCyan);
  return m.build();
}

// —— 4 类野战部署物（96~180 tri；含 1.8m 裙边） ————————————————————————

/** dep_gpr_radar 便携式探地雷达（预算 128） */
function buildDepGprRadar() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 0.9, 0.9, PC.padConcrete);
  m.beginPart('tripod');
  m.slab([0, 0.6, 0], [0.7, 0, 0.5], [0, 1, 0], 0.09, 0.09, PC.turretGun);
  m.slab([0, 0.6, 0], [-0.7, 0, 0.5], [0, 1, 0], 0.09, 0.09, PC.turretGun);
  m.slab([0, 0.6, 0], [0, 0, -0.8], [0, 1, 0], 0.09, 0.09, PC.turretGun);
  m.beginPart('box');
  m.box(0, 0.8, 0, 0.42, 0.26, 0.3, PC.turretGun);           // 主机
  m.box(0, 1.12, 0, 0.12, 0.08, 0.12, PC.bioGreen);          // 状态灯
  m.beginPart('dish');
  m.pyramid(0, 1.35, 0, 1.0, 0.42, PC.radarWhite);           // 低频天线阵
  return m.build();
}

/** dep_thermal_pylon 临时充能桩（预算 96） */
function buildDepThermalPylon() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 0.7, 0.7, PC.padConcrete);
  m.beginPart('body');
  m.frustumY(0, 0, 0, 0.34, 0.26, 2.3, 6, PC.rigIron);       // 桩体
  m.frustumY(0, 2.3, 0, 0.26, 0.02, 0.5, 6, PC.rigAmber);    // 顶端热核
  m.beginPart('ring');
  m.frustumY(0, 1.5, 0, 0.55, 0.55, 0.16, 6, PC.rigAmber, false); // 12m 力场发射环
  return m.build();
}

/** dep_sentry_turret 便携式防御哨兵机枪塔（预算 180） */
function buildDepSentryTurret() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 1.0, 1.0, PC.padConcrete);
  m.beginPart('base');
  m.box(0, 0.18, 0, 0.8, 0.18, 0.8, PC.turretGun);           // 底座
  m.beginPart('mount');
  m.frustumY(0, 0.36, 0, 0.34, 0.28, 0.6, 6, PC.turretGun);  // 回转座
  m.box(0, 1.1, 0, 0.5, 0.24, 0.44, PC.turretGun);           // 炮匣
  m.beginPart('guns');
  m.box(0.16, 1.1, 0.55, 0.05, 0.05, 0.55, PC.hullGrey);     // 双联机枪管
  m.box(-0.16, 1.1, 0.55, 0.05, 0.05, 0.55, PC.hullGrey);
  m.box(0, 1.42, 0, 0.1, 0.1, 0.1, PC.decoyRed);             // 索敌头
  m.beginPart('ammo');
  m.box(-0.6, 0.5, 0, 0.24, 0.3, 0.3, PC.crateTan);          // 弹箱
  return m.build();
}

/** dep_decoy_emitter 全频段信号诱饵弹（预算 110） */
function buildDepDecoyEmitter() {
  const m = new LandmarkMeshBuilder();
  poiSkirt(m, 0.55, 0.55, PC.padConcrete);
  m.beginPart('tube');
  m.frustumY(0, 0.1, 0, 0.3, 0.26, 1.1, 8, PC.hullGrey);     // 弹体
  m.frustumY(0, 1.2, 0, 0.26, 0.02, 0.4, 8, PC.decoyRed);    // 全频段发射头
  m.beginPart('fins');
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    m.slab(
      [0, 0.45, 0],
      [Math.cos(a) * 0.55, 0.18, Math.sin(a) * 0.55],
      [0, 1, 0], 0.16, 0.05, PC.decoyRed,
    ); // 展开尾翼×3
  }
  return m.build();
}

// —— 注册（GroundView 的 BUILD_CATEGORY_IDS 经 LANDMARK_PREFAB_IDS 展开自动收编） ——
const SURFACE_POI_MESH_IDS = [
  'poi_wreck_pioneer_frigate', 'poi_wreck_pirate_corvette', 'poi_wreck_cargo_pod_cluster',
  'poi_wreck_cryo_lifeboat', 'poi_outpost_xenobio_lab', 'poi_outpost_hydroponic_dome',
  'poi_outpost_deepcore_rig', 'poi_outpost_comms_bunker', 'poi_xeno_ring_monolith',
  'poi_xeno_antigrav_pylon', 'poi_xeno_subterranean_vault', 'poi_xeno_harmonic_prism',
];
const SURFACE_DEPLOYABLE_MESH_IDS = ['dep_gpr_radar', 'dep_thermal_pylon', 'dep_sentry_turret', 'dep_decoy_emitter'];
const _SURFACE_BUILDERS = {
  poi_wreck_pioneer_frigate: buildPoiWreckPioneerFrigate,
  poi_wreck_pirate_corvette: buildPoiWreckPirateCorvette,
  poi_wreck_cargo_pod_cluster: buildPoiWreckCargoPodCluster,
  poi_wreck_cryo_lifeboat: buildPoiWreckCryoLifeboat,
  poi_outpost_xenobio_lab: buildPoiOutpostXenobioLab,
  poi_outpost_hydroponic_dome: buildPoiOutpostHydroponicDome,
  poi_outpost_deepcore_rig: buildPoiOutpostDeepcoreRig,
  poi_outpost_comms_bunker: buildPoiOutpostCommsBunker,
  poi_xeno_ring_monolith: buildPoiXenoRingMonolith,
  poi_xeno_antigrav_pylon: buildPoiXenoAntigravPylon,
  poi_xeno_subterranean_vault: buildPoiXenoSubterraneanVault,
  poi_xeno_harmonic_prism: buildPoiXenoHarmonicPrism,
  dep_gpr_radar: buildDepGprRadar,
  dep_thermal_pylon: buildDepThermalPylon,
  dep_sentry_turret: buildDepSentryTurret,
  dep_decoy_emitter: buildDepDecoyEmitter,
};
for (const id of [...SURFACE_POI_MESH_IDS, ...SURFACE_DEPLOYABLE_MESH_IDS]) {
  registerLandmarkBuilder(id, _SURFACE_BUILDERS[id]);
}

/** SPEC-39 S2 图集 id 清单（GroundView BUILD_CATEGORY_IDS 追加段与门禁消费） */
export const SURFACE_ATLAS_IDS = Object.freeze([...SURFACE_POI_MESH_IDS, ...SURFACE_DEPLOYABLE_MESH_IDS]);
