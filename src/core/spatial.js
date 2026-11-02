/**
 * core/spatial.js — 空间索引、距离与确定性寻路（任务书 2.5 / 3.3）
 */

import { dist2, dist } from './math.js';

/** 一维均匀网格空间哈希 */
export class SpatialHash {
  constructor(cellSize) {
    this.cell = cellSize;
    this.buckets = new Map();
  }
  key(cx, cy) {
    return cx * 100000 + cy;
  }
  clear() {
    this.buckets.clear();
  }
  insert(x, y, item) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const k = this.key(cx, cy);
    let arr = this.buckets.get(k);
    if (!arr) {
      arr = [];
      this.buckets.set(k, arr);
    }
    arr.push(item);
  }
  /** 查询圆形邻域 */
  query(x, y, r) {
    const out = [];
    const c0x = Math.floor((x - r) / this.cell);
    const c1x = Math.floor((x + r) / this.cell);
    const c0y = Math.floor((y - r) / this.cell);
    const c1y = Math.floor((y + r) / this.cell);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const arr = this.buckets.get(this.key(cx, cy));
        if (!arr) continue;
        for (const it of arr) {
          if (dist2(x, y, it.x, it.y) <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}

/** 平面最近邻（小规模暴力；星系数百级足够快且完全确定） */
export function nearestNeighbor(points, x, y, excludeId = null) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    if (p.id === excludeId) continue;
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { point: best, dist: Math.sqrt(bestD) } : null;
}

/** k 近邻（返回按距离升序的前 k 个） */
export function kNearest(points, x, y, k) {
  return points
    .map((p) => ({ p, d: dist2(x, y, p.x, p.y) }))
    .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, k)
    .map((e) => ({ point: e.p, dist: Math.sqrt(e.d) }));
}

/** 并查集（连通性检查与修复） */
export class UnionFind {
  constructor(ids) {
    this.parent = new Map();
    for (const id of ids) this.parent.set(id, id);
  }
  find(a) {
    let r = this.parent.get(a);
    while (r !== this.parent.get(r)) r = this.parent.get(r);
    // 路径压缩
    let c = a;
    while (c !== this.parent.get(c)) {
      const nx = this.parent.get(c);
      this.parent.set(c, r);
      c = nx;
    }
    return r;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    // 小 id 作为根，保证确定性
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
    return true;
  }
  connected(a, b) {
    return this.find(a) === this.find(b);
  }
  components() {
    const m = new Map();
    for (const id of this.parent.keys()) {
      const r = this.find(id);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(id);
    }
    return [...m.values()];
  }
}

/**
 * 航路图 Dijkstra 最短路（确定性：同代价按节点 id 字典序）。
 * nodes: Map<id, {id, x, y}>；edges: Map<id, Set<id>>；weightFn(aId,bId)→cost≥0
 * 返回 { path:[id...], cost } 或 null（不可达）。
 */
export function shortestPath(nodeIds, edges, startId, goalId, weightFn) {
  if (startId === goalId) return { path: [startId], cost: 0 };
  const distM = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  // 简单优先队列：数组 + 排序（图规模 ≤ 数百节点，足够）
  const pq = [[0, startId]];
  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === goalId) break;
    const nbrs = edges.get(u);
    if (!nbrs) continue;
    for (const v of [...nbrs].sort()) {
      if (visited.has(v)) continue;
      const w = weightFn(u, v);
      if (!(w >= 0) || !Number.isFinite(w)) continue;
      const nd = d + w;
      const cur = distM.get(v);
      if (cur === undefined || nd < cur - 1e-9 || (Math.abs(nd - cur) <= 1e-9 && u < (prev.get(v) || u))) {
        distM.set(v, nd);
        prev.set(v, u);
        pq.push([nd, v]);
      }
    }
  }
  if (!visited.has(goalId)) return null;
  const path = [goalId];
  let c = goalId;
  while (c !== startId) {
    c = prev.get(c);
    if (c === undefined) return null;
    path.push(c);
  }
  path.reverse();
  return { path, cost: distM.get(goalId) };
}

/** 图全源连通性：返回连通分量列表（任务书 WORLD-02） */
export function connectedComponents(nodeIds, edges) {
  const uf = new UnionFind(nodeIds);
  for (const [a, set] of edges) {
    for (const b of set) uf.union(a, b);
  }
  return uf.components();
}

export { dist, dist2 };
