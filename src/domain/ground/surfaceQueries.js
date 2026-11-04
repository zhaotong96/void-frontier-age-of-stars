/**
 * domain/ground/surfaceQueries.js — 连续三角网格地表查询（doc7 TASK-1.2 / TERRAIN-05）
 *
 * 在 terrainField 产出的三角化高度场上提供权威连续查询（纯领域层，无 DOM/WebGL）：
 *  - sampleTerrain   重心坐标连续高度/法线/材质插值（严格复刻构建器对角线选择）；
 *  - raycastTerrain  Chunk AABB 列 DDA + 高度带剪枝 + 二分精化（替代体素 ddaRaycast）；
 *  - slopeAt / isBuildableSlope / findPathSurface  坡度查询与坡度代价图 A* 寻路。
 *
 * 确定性：全部查询为纯读 + 幂等懒构建（未构建区块按同输入确定性补建），
 * 零 Math.random，不消费 world.rng。方向参数 dir 需为世界空间方向，
 * raycastTerrain 返回的 t 以「单位方向米数」计（内部归一化）。
 */

import { TERRAIN_FLAGS, buildTriangulatedChunkMesh } from './terrainField.js';

const SQRT2 = Math.SQRT2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampInt(v, lo, hi) {
  return Math.floor(clamp(Math.floor(v), lo, hi));
}

function num(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

/** 未构建区块按同输入确定性补建（幂等；meshRevision 已对齐则跳过） */
function ensureChunkBuilt(field, chunk) {
  if (chunk && chunk.meshRevision === 0) {
    buildTriangulatedChunkMesh(chunk, field.evalPoint);
  }
  return chunk;
}

/** 定位 (x, z) 所在区块；场地外返回 null */
function chunkAt(field, x, z) {
  const maxX = field.originX + field.sizeMeters;
  const maxZ = field.originZ + field.sizeMeters;
  if (!(x >= field.originX && x <= maxX && z >= field.originZ && z <= maxZ)) return null;
  const cx = clampInt((x - field.originX) / field.chunkMeters, 0, field.chunksX - 1);
  const cz = clampInt((z - field.originZ) / field.chunkMeters, 0, field.chunksZ - 1);
  return field.chunks[cz * field.chunksX + cx];
}

// ———— 连续采样 ————

/**
 * 连续地表采样：所在三角形内做重心坐标插值（高度/法线/材质权重），
 * 语义标记与生态 id 取重心权重最大的顶点。
 * @returns {null|{y:number, nx:number, ny:number, nz:number, weights:number[4], biomeId:number, flags:number, chunk:object}}
 */
export function sampleTerrain(field, x, z) {
  const chunk = chunkAt(field, x, z);
  if (!chunk) return null;
  ensureChunkBuilt(field, chunk);

  const N = chunk.gridSize;
  const cells = N - 1;
  const step = (chunk.bounds.maxX - chunk.bounds.minX) / cells;
  const pos = chunk.vertices.position;
  const nor = chunk.vertices.normal;
  const wgt = chunk.vertices.materialWeights;

  const u = clamp((x - chunk.bounds.minX) / step, 0, cells);
  const v = clamp((z - chunk.bounds.minZ) / step, 0, cells);
  const i = Math.min(Math.floor(u), cells - 1);
  const j = Math.min(Math.floor(v), cells - 1);
  const fu = u - i;
  const fv = v - j;

  const v00 = j * N + i;
  const v10 = v00 + 1;
  const v01 = (j + 1) * N + i;
  const v11 = v01 + 1;
  const y00 = pos[v00 * 3 + 1];
  const y10 = pos[v10 * 3 + 1];
  const y01 = pos[v01 * 3 + 1];
  const y11 = pos[v11 * 3 + 1];

  // 与构建器逐位一致的对角线选择（含棋盘偏置）
  const bias = (((i + j) & 1) === 0) ? -0.02 : 0.02;
  const diffDiagA = Math.abs(y00 - y11) + bias;
  const diffDiagB = Math.abs(y10 - y01);

  // 四角重心权重（λ00, λ10, λ01, λ11）
  let l00; let l10; let l01; let l11;
  let y;
  if (diffDiagA <= diffDiagB) {
    if (fv >= fu) { // T1 (v00,v01,v11)
      y = (1 - fv) * y00 + (fv - fu) * y01 + fu * y11;
      l00 = 1 - fv; l01 = fv - fu; l11 = fu; l10 = 0;
    } else {        // T2 (v00,v11,v10)
      y = (1 - fu) * y00 + (fu - fv) * y10 + fv * y11;
      l00 = 1 - fu; l10 = fu - fv; l11 = fv; l01 = 0;
    }
  } else {
    if (fu + fv <= 1) { // T1 (v00,v01,v10)
      y = (1 - fu - fv) * y00 + fv * y01 + fu * y10;
      l00 = 1 - fu - fv; l01 = fv; l10 = fu; l11 = 0;
    } else {            // T2 (v10,v01,v11)
      y = (1 - fv) * y10 + (fu + fv - 1) * y01 + (1 - fu) * y11;
      l10 = 1 - fv; l01 = fu + fv - 1; l11 = 1 - fu; l00 = 0;
    }
  }

  // 法线：重心插值后归一化（退化回退 +Y）
  let nx = l00 * nor[v00 * 3] + l10 * nor[v10 * 3] + l01 * nor[v01 * 3] + l11 * nor[v11 * 3];
  let ny = l00 * nor[v00 * 3 + 1] + l10 * nor[v10 * 3 + 1] + l01 * nor[v01 * 3 + 1] + l11 * nor[v11 * 3 + 1];
  let nz = l00 * nor[v00 * 3 + 2] + l10 * nor[v10 * 3 + 2] + l01 * nor[v01 * 3 + 2] + l11 * nor[v11 * 3 + 2];
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen > 1e-12) {
    nx /= nlen; ny /= nlen; nz /= nlen;
  } else {
    nx = 0; ny = 1; nz = 0;
  }

  // 材质权重：重心插值后取整（和恒 255，因四角各自和为 255 且 Σλ=1）
  const weights = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const wAcc = l00 * wgt[v00 * 4 + c] + l10 * wgt[v10 * 4 + c]
      + l01 * wgt[v01 * 4 + c] + l11 * wgt[v11 * 4 + c];
    weights[c] = Math.round(wAcc);
  }

  // 语义标记 / 生态：取重心权重最大的顶点
  let bestL = l00;
  let bestV = v00;
  if (l10 > bestL) { bestL = l10; bestV = v10; }
  if (l01 > bestL) { bestL = l01; bestV = v01; }
  if (l11 > bestL) { bestL = l11; bestV = v11; }
  const bio = chunk.vertices.biomeId;
  const flg = chunk.vertices.flags;

  return {
    y,
    nx, ny, nz,
    weights,
    biomeId: bio[bestV],
    flags: flg[bestV],
    chunk,
  };
}

// ———— 射线求交 ————

function missResult() {
  return { hit: false, t: -1, point: null, normal: null, chunk: null };
}

/** 命中包装：在 t 处取样地表得到法线与区块 */
function hitResult(field, ox, oy, oz, dx, dy, dz, t) {
  const px = ox + dx * t;
  const py = oy + dy * t;
  const pz = oz + dz * t;
  const s = sampleTerrain(field, px, pz);
  return {
    hit: true,
    t,
    point: [px, py, pz],
    normal: s ? [s.nx, s.ny, s.nz] : [0, 1, 0],
    chunk: s ? s.chunk : null,
  };
}

/**
 * 区间 [ta, tb] 内精化首个「射线降至地表以下」的交点（6 步扫描 + 14 步二分）。
 * f(t) = oy + dy·t − terrainY(t)；f 单调性不保证，但首次变号即首个穿入点。
 */
function refineHit(field, ox, oy, oz, dx, dy, dz, ta, tb) {
  const span = tb - ta;
  if (span <= 1e-9) {
    const s = sampleTerrain(field, ox + dx * ta, oz + dz * ta);
    return s && oy + dy * ta <= s.y ? ta : -1;
  }
  const STEPS = 6;
  const dt = span / STEPS;
  let tPrev = ta;
  for (let k = 1; k <= STEPS; k++) {
    const tk = ta + dt * k;
    const sk = sampleTerrain(field, ox + dx * tk, oz + dz * tk);
    if (sk && oy + dy * tk <= sk.y) {
      let a = tPrev;
      let b = tk;
      for (let it = 0; it < 14; it++) {
        const m = (a + b) * 0.5;
        const sm = sampleTerrain(field, ox + dx * m, oz + dz * m);
        const fm = sm ? (oy + dy * m - sm.y) : 1;
        if (fm > 0) a = m; else b = m;
      }
      return (a + b) * 0.5;
    }
    tPrev = tk;
  }
  return -1;
}

/**
 * 地形射线求交（替代体素 ddaRaycast）：
 * 2D DDA 步进 Chunk 列（xz 平面 Amanatides–Woo），逐列做高度带剪枝
 * （y(t) 线性区间 ∩ [chunk.minY, chunk.maxY]），命中带内再做重心精化。
 * dir.y ≈ 0（平飞）稳健：高度带退化为常量判定。
 *
 * @param {object} field 地形场
 * @param {number[]} origin [x, y, z]
 * @param {number[]} dir 方向（任意长度，内部归一化；全零向量视为未命中）
 * @param {number} [maxDist=64] 最大距离（米）
 * @returns {{hit:boolean, t:number, point:number[]|null, normal:number[]|null, chunk:object|null}}
 */
export function raycastTerrain(field, origin, dir, maxDist = 64) {
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  let dx = dir[0];
  let dy = dir[1];
  let dz = dir[2];
  const dLen = Math.hypot(dx, dy, dz);
  if (!(dLen > 1e-12)) return missResult();
  const inv = 1 / dLen;
  dx *= inv; dy *= inv; dz *= inv;
  const tMax = num(maxDist, 64);

  const minX = field.originX;
  const minZ = field.originZ;
  const maxX = minX + field.sizeMeters;
  const maxZ = minZ + field.sizeMeters;

  // 场地 AABB（xz slab）求交
  let t0 = 0;
  let t1 = tMax;
  if (Math.abs(dx) < 1e-12) {
    if (ox < minX || ox > maxX) return missResult();
  } else {
    let ta = (minX - ox) / dx;
    let tb = (maxX - ox) / dx;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < minZ || oz > maxZ) return missResult();
  } else {
    let ta = (minZ - oz) / dz;
    let tb = (maxZ - oz) / dz;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return missResult();

  // 起点（或入场点）已在地形之下 → 立即命中
  const s0 = sampleTerrain(field, ox + dx * t0, oz + dz * t0);
  if (s0 && oy + dy * t0 <= s0.y) {
    return hitResult(field, ox, oy, oz, dx, dy, dz, t0);
  }

  // 2D DDA（Amanatides–Woo on chunk grid）
  const cm = field.chunkMeters;
  let cx = clampInt((ox + dx * t0 - minX) / cm, 0, field.chunksX - 1);
  let cz = clampInt((oz + dz * t0 - minZ) / cm, 0, field.chunksZ - 1);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(dx) > 1e-12 ? cm / Math.abs(dx) : Infinity;
  const tDeltaZ = Math.abs(dz) > 1e-12 ? cm / Math.abs(dz) : Infinity;
  let tMaxX = Math.abs(dx) > 1e-12
    ? ((dx > 0 ? minX + (cx + 1) * cm : minX + cx * cm) - ox) / dx
    : Infinity;
  let tMaxZ = Math.abs(dz) > 1e-12
    ? ((dz > 0 ? minZ + (cz + 1) * cm : minZ + cz * cm) - oz) / dz
    : Infinity;

  let guard = (field.chunksX + field.chunksZ) * 2 + 8; // DDA 步数上限（跨列去重）
  let tc = t0;
  while (tc <= t1) {
    const tc1 = Math.min(t1, Math.min(tMaxX, tMaxZ));
    const chunk = field.chunks[cz * field.chunksX + cx];
    if (chunk) {
      ensureChunkBuilt(field, chunk);
      // 高度带剪枝：y(t) = oy + dy·t 与 [minY-ε, maxY+ε] 的 t 区间
      let ba = tc;
      let bb = tc1;
      const lo = chunk.bounds.minY - 0.05;
      const hi = chunk.bounds.maxY + 0.05;
      if (dy > 1e-12) {
        ba = Math.max(ba, (lo - oy) / dy);
        bb = Math.min(bb, (hi - oy) / dy);
      } else if (dy < -1e-12) {
        ba = Math.max(ba, (hi - oy) / dy);
        bb = Math.min(bb, (lo - oy) / dy);
      } else if (oy < lo || oy > hi) {
        ba = 1; bb = 0; // 平飞且不在带内 → 本列无交
      }
      if (ba <= bb) {
        const tHit = refineHit(field, ox, oy, oz, dx, dy, dz, ba, bb);
        if (tHit >= 0 && tHit <= tMax) {
          return hitResult(field, ox, oy, oz, dx, dy, dz, tHit);
        }
      }
    }
    if (tc1 >= t1) break;
    if (tMaxX < tMaxZ) {
      tc = tMaxX;
      cx += stepX;
      tMaxX += tDeltaX;
      if (cx < 0 || cx >= field.chunksX) break;
    } else {
      tc = tMaxZ;
      cz += stepZ;
      tMaxZ += tDeltaZ;
      if (cz < 0 || cz >= field.chunksZ) break;
    }
  }
  return missResult();
}

// ———— 坡度与寻路 ————

/**
 * 坡度（度）：由采样法线 ny 反解；场地外返回 NaN。
 */
export function slopeAt(field, x, z) {
  const s = sampleTerrain(field, x, z);
  if (!s) return NaN;
  const ny = clamp(s.ny, -1, 1);
  return Math.acos(ny) * (180 / Math.PI);
}

/**
 * 坡度可建性：坡度 ≤ maxSlopeDeg（默认 16°）即认为可直建；
 * 危险/保护区语义由调用方按 flags 叠加裁决（GAME-05..08）。
 */
export function isBuildableSlope(field, x, z, maxSlopeDeg = 16) {
  const s = sampleTerrain(field, x, z);
  if (!s) return false;
  const ny = clamp(s.ny, -1, 1);
  const deg = Math.acos(ny) * (180 / Math.PI);
  return deg <= num(maxSlopeDeg, 16);
}

/** 八方向邻居（固定顺序 → 确定性） */
const NBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * 地表 A* 寻路（1m 栅格，8 向）：
 * 代价 = 步距 × (1 + slopePenalty)；slopePenalty = 3·(slope/maxSlopeDeg)²，
 * HAZARD 区追加 hazardPenalty（默认 +6）；slope > maxSlopeDeg（默认 35°）不可通行，
 * 除非顶点 flags 含 BRIDGE_DECK 或 ROAD（拱桥/道路可越陡坡）。
 * 二叉最小堆（f 相同按格点下标决胜）+ 固定邻居序 → 完全确定性。
 *
 * @returns {null|{path:{x:number,z:number,y:number}[], cost:number}}
 */
export function findPathSurface(field, sx, sz, tx, tz, opts = {}) {
  const maxSlopeDeg = num(opts.maxSlopeDeg, 35);
  const hazardPenalty = num(opts.hazardPenalty, 6);
  const maxExpand = num(opts.maxExpand, 90000);

  // 1m 栅格（内缩 1m 避免场地边界退化）
  const gx0 = field.originX + 1;
  const gz0 = field.originZ + 1;
  const gw = field.sizeMeters - 2;
  const gh = field.sizeMeters - 2;
  const sxg = clampInt(Math.round(sx), gx0, gx0 + gw - 1);
  const szg = clampInt(Math.round(sz), gz0, gz0 + gh - 1);
  const txg = clampInt(Math.round(tx), gx0, gx0 + gw - 1);
  const tzg = clampInt(Math.round(tz), gz0, gz0 + gh - 1);

  const idxOf = (x, z) => (z - gz0) * gw + (x - gx0);
  const total = gw * gh;
  const gScore = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const nodeY = new Float64Array(total).fill(NaN);
  const nodeSlope = new Float64Array(total).fill(-1);
  const nodeFlags = new Uint16Array(total);
  const nodeState = new Uint8Array(total); // 0 未评估 1 可通行 2 阻断

  const octile = (ax, az, bx, bz) => {
    const ddx = Math.abs(ax - bx);
    const ddz = Math.abs(az - bz);
    return ddx > ddz ? ddx - ddz + SQRT2 * ddz : ddz - ddx + SQRT2 * ddx;
  };

  const startIdx = idxOf(sxg, szg);
  const goalIdx = idxOf(txg, tzg);

  // 节点评估（惰性，仅一次；sampleTerrain 幂等）
  const evalNode = (x, z, ni) => {
    if (nodeState[ni] !== 0) return nodeState[ni] === 1;
    const s = sampleTerrain(field, x, z);
    if (!s) {
      nodeState[ni] = 2;
      return false;
    }
    nodeY[ni] = s.y;
    nodeFlags[ni] = s.flags;
    nodeSlope[ni] = Math.acos(clamp(s.ny, -1, 1)) * (180 / Math.PI);
    const bridgeable = (s.flags & (TERRAIN_FLAGS.BRIDGE_DECK | TERRAIN_FLAGS.ROAD)) !== 0;
    nodeState[ni] = (nodeSlope[ni] <= maxSlopeDeg || bridgeable) ? 1 : 2;
    return nodeState[ni] === 1;
  };

  if (!evalNode(sxg, szg, startIdx)) return null;
  if (!evalNode(txg, tzg, goalIdx)) return null;
  if (startIdx === goalIdx) {
    return { path: [{ x: sxg, z: szg, y: nodeY[startIdx] }], cost: 0 };
  }

  // 二叉最小堆：扁平数组 [f0, idx0, f1, idx1, ...]；f 同值按 idx 决胜（确定性）
  const heap = [];
  const heapPush = (f, i) => {
    heap.push(f, i);
    let c = (heap.length >> 1) - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      const pf = heap[p * 2];
      const pi = heap[p * 2 + 1];
      const cf = heap[c * 2];
      const ci = heap[c * 2 + 1];
      if (pf < cf || (pf === cf && pi <= ci)) break;
      heap[p * 2] = cf; heap[p * 2 + 1] = ci;
      heap[c * 2] = pf; heap[c * 2 + 1] = pi;
      c = p;
    }
  };
  const heapPop = () => {
    const topF = heap[0];
    const topI = heap[1];
    const lastI = heap.pop();
    const lastF = heap.pop();
    const n = heap.length >> 1;
    if (n > 0) {
      heap[0] = lastF;
      heap[1] = lastI;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < n && (heap[l * 2] < heap[m * 2] || (heap[l * 2] === heap[m * 2] && heap[l * 2 + 1] < heap[m * 2 + 1]))) m = l;
        if (r < n && (heap[r * 2] < heap[m * 2] || (heap[r * 2] === heap[m * 2] && heap[r * 2 + 1] < heap[m * 2 + 1]))) m = r;
        if (m === p) break;
        const tf = heap[p * 2]; const ti = heap[p * 2 + 1];
        heap[p * 2] = heap[m * 2]; heap[p * 2 + 1] = heap[m * 2 + 1];
        heap[m * 2] = tf; heap[m * 2 + 1] = ti;
        p = m;
      }
    }
    return [topF, topI];
  };

  gScore[startIdx] = 0;
  heapPush(octile(sxg, szg, txg, tzg), startIdx);

  let expansions = 0;
  while (heap.length > 0) {
    const [, cur] = heapPop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) {
      const path = [];
      let walk = goalIdx;
      while (walk >= 0) {
        const wz = gz0 + Math.floor(walk / gw);
        const wx = gx0 + (walk % gw);
        path.push({ x: wx, z: wz, y: nodeY[walk] });
        walk = came[walk];
      }
      path.reverse();
      return { path, cost: gScore[goalIdx] };
    }
    if (++expansions > maxExpand) return null;
    const cz0 = gz0 + Math.floor(cur / gw);
    const cx0 = gx0 + (cur % gw);
    const gCur = gScore[cur];
    for (let k = 0; k < 8; k++) {
      const nx = cx0 + NBORS[k][0];
      const nz = cz0 + NBORS[k][1];
      if (nx < gx0 || nx >= gx0 + gw || nz < gz0 || nz >= gz0 + gh) continue;
      const ni = idxOf(nx, nz);
      if (closed[ni]) continue;
      if (!evalNode(nx, nz, ni)) continue;
      const stepDist = NBORS[k][2];
      const slope = Math.max(0, nodeSlope[ni]);
      let penalty = 3 * (slope / maxSlopeDeg) * (slope / maxSlopeDeg);
      if (nodeFlags[ni] & TERRAIN_FLAGS.HAZARD) penalty += hazardPenalty;
      const ng = gCur + stepDist * (1 + penalty);
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        came[ni] = cur;
        heapPush(ng + octile(nx, nz, txg, tzg), ni);
      }
    }
  }
  return null;
}
