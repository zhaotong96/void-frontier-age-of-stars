/**
 * domain/industry/planetaryLogistics.js — 行星局部空间物流（doc19 v0.4 WP-1/WP-2/WP-3）
 *
 * 三级工业模拟架构（doc16 §4.7）的 L2 层：行星局部电网 + 样条传送带 + 多级加工厂。
 *
 * FFF #176 铁律（doc17 §3.2 / doc19 红线 2）：传送带上的货箱严禁创建独立对象——
 * 整条样条带仅以 12 元组紧凑整型数组持久化，步进只做首尾间距整数加减与
 * 位掩码位移，复杂度严格 O(1)；并查集电网仅在放置/拆除时重建（非 60Hz）。
 *
 * 确定性红线：零 Math.random()、零 world.rng 消费。
 * 持久化预算：满载 64 节点 + 48 带 planet.ind ≤ 15 KB（GATE-06 IND-05）。
 */

import { UnionFind } from '../../core/spatial.js';
import { clamp } from '../../core/math.js';

// ———— 紧凑元组下标契约（doc19 WP-1/WP-2；doc17 §5.2 原型 2 同表） ————————

/** 工业节点 13 元组：[id, defIdx, x_dm, z_dm, y_dm, rot, state, recipeIdx, prog_permille, in0, in1, out0, gridId] */
export const NODE_IDX = Object.freeze({
  ID: 0, DEF: 1, X_DM: 2, Z_DM: 3, Y_DM: 4, ROT: 5,
  STATE: 6, RECIPE: 7, PROG: 8, IN0: 9, IN1: 10, OUT0: 11, GRID: 12,
});

/** 样条传送带 12 元组：[lineId, fromNode, fromSlot, toNode, toSlot, tier, length_dm, headGap_mm, tailGap_mm, resTypeIdx, itemCount, occupancyMask32] */
export const BELT_IDX = Object.freeze({
  ID: 0, FROM: 1, FROM_SLOT: 2, TO: 3, TO_SLOT: 4, TIER: 5,
  LEN_DM: 6, HEAD_MM: 7, TAIL_MM: 8, RES: 9, COUNT: 10, MASK: 11,
});

/** 节点状态位（state 字段） */
export const NODE_STATE = Object.freeze({ OFFLINE: 0, ACTIVE: 1, BLOCKED: 2, NO_POWER: 3 });

/** 传送带档位速度（mm/s，Tier 1..3）与标准货箱间距（1m 一箱，32 槽位对应 mask32） */
export const ITEM_SPACING_MM = 1000;
export const BELT_SPEED_MM_S = Object.freeze([0, 1875, 3750, 5625]);
export const BELT_MAX_ITEMS = 32;

/** 输入/输出槽容量（节点缓冲上限，doc19 IND-01 守恒口径） */
export const SLOT_CAP = 20;

/** 惰性初始化 planet.ind（doc22 WP-4 v3 schema 同形；幂等） */
export function ensurePlanetInd(planet) {
  if (planet.ind && planet.ind.v === 1) return planet.ind;
  planet.ind = { v: 1, nodes: [], belts: [], grids: [], splitterParity: {}, catapult: null, orbitalBuffer: {} };
  return planet.ind;
}

/**
 * 并查集电网拓扑重建（仅放置/拆除电力建筑时调用一次，严禁每帧重算）。
 * 连接半径取两端 wireRadiusM 最大值 ×10（米→分米）。
 * @param {object} indState planet.ind
 * @param {Array<object>} buildingDefs BUILDINGS 定义数组（含 wireRadiusM/supplyRadiusM）
 */
export function rebuildPowerGrids(indState, buildingDefs) {
  const nodes = indState.nodes || [];
  const uf = new UnionFind(nodes.map((n) => n[NODE_IDX.ID]));

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const defA = buildingDefs[a[NODE_IDX.DEF]];
    const rA = (defA && defA.wireRadiusM) || 0;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const defB = buildingDefs[b[NODE_IDX.DEF]];
      const rB = (defB && defB.wireRadiusM) || 0;
      const maxLinkDm = Math.max(rA, rB) * 10;
      if (maxLinkDm <= 0) continue;
      const dx = a[NODE_IDX.X_DM] - b[NODE_IDX.X_DM];
      const dz = a[NODE_IDX.Z_DM] - b[NODE_IDX.Z_DM];
      if (dx * dx + dz * dz <= maxLinkDm * maxLinkDm) {
        uf.union(a[NODE_IDX.ID], b[NODE_IDX.ID]);
      }
    }
  }

  const comps = uf.components();
  const gridMap = new Map();
  indState.grids = comps.map((memberIds, idx) => {
    const gid = idx + 1;
    for (const id of memberIds) gridMap.set(id, gid);
    return { id: gid, genKW: 0, loadKW: 0, accMWh: 0, accMaxMWh: 0, etaPermille: 1000 };
  });
  for (const n of nodes) {
    n[NODE_IDX.GRID] = gridMap.get(n[NODE_IDX.ID]) || 0;
  }
  return indState.grids;
}

/**
 * FFF #176 O(1) 相对间距传送带步进器（严禁遍历带上每个货箱）。
 * 整体推进仅 headGap_mm/tailGap_mm 两次整数加减；队首移交/队尾喂入各至多 1 箱/次。
 * @param {Array<number>} belt 12 元组（原地修改）
 * @param {Array<number>|null} srcNode 上游建筑元组（out0 喂入）
 * @param {Array<number>|null} dstNode 下游建筑元组（in0/in1 接收）
 * @param {number} dtSeconds 步进秒数
 * @param {number} etaPermille 所属电网供电充足率（0..1000；0 = 停转）
 */
export function stepTransportLineO1(belt, srcNode, dstNode, dtSeconds, etaPermille = 1000) {
  const tier = belt[BELT_IDX.TIER] || 1;
  const speedMm = (BELT_SPEED_MM_S[tier] || 1875) * (etaPermille / 1000);
  const deltaMm = Math.round(speedMm * dtSeconds);
  if (deltaMm <= 0) return;

  const totalLenMm = belt[BELT_IDX.LEN_DM] * 100;
  let count = belt[BELT_IDX.COUNT];

  // 1. O(1) 整体推进：队首距终点 / 队尾距起点
  if (count > 0) {
    belt[BELT_IDX.HEAD_MM] = Math.max(0, belt[BELT_IDX.HEAD_MM] - deltaMm);
    belt[BELT_IDX.TAIL_MM] = Math.min(totalLenMm, belt[BELT_IDX.TAIL_MM] + deltaMm);
  } else {
    belt[BELT_IDX.HEAD_MM] = totalLenMm;
    belt[BELT_IDX.TAIL_MM] = totalLenMm;
  }

  // 2. 队首移交下游输入口（headGap 归零且下游缓冲未满）
  const dstSlot = belt[BELT_IDX.TO_SLOT] === 1 ? NODE_IDX.IN1 : NODE_IDX.IN0;
  if (count > 0 && belt[BELT_IDX.HEAD_MM] === 0 && dstNode && dstNode[dstSlot] < SLOT_CAP) {
    dstNode[dstSlot] += 1;
    count -= 1;
    belt[BELT_IDX.COUNT] = count;
    belt[BELT_IDX.MASK] = (belt[BELT_IDX.MASK] >>> 1) >>> 0;
    belt[BELT_IDX.HEAD_MM] = count > 0 ? ITEM_SPACING_MM : totalLenMm;
  }

  // 3. 上游输出口喂入队尾（tailGap ≥ 1m 且上游有产物）
  if (count < BELT_MAX_ITEMS && belt[BELT_IDX.TAIL_MM] >= ITEM_SPACING_MM && srcNode && srcNode[NODE_IDX.OUT0] > 0) {
    srcNode[NODE_IDX.OUT0] -= 1;
    belt[BELT_IDX.MASK] = (belt[BELT_IDX.MASK] | (1 << count)) >>> 0;
    count += 1;
    belt[BELT_IDX.COUNT] = count;
    belt[BELT_IDX.TAIL_MM] = 0;
    if (count === 1) belt[BELT_IDX.HEAD_MM] = totalLenMm;
  }
}

/**
 * 四向分流器单箱路由（doc19 WP-3；parity 1-bit 状态保证绝对确定性）。
 * 模式 0 Round-Robin 奇偶轮询 / 模式 1 Priority 主副路 / 模式 2 ItemFilter 过滤。
 * @param {number} mode 0/1/2
 * @param {number} parityState 调用方维护的 1-bit 台账（按带独立）
 * @param {number} resId 输入资源类型 idx（过滤模式比对 node RECIPE 槽）
 * @param {number} filterResId 过滤模式的目标资源 idx
 * @returns {{port:0|1, parity:number}} port: 0=主路(out0)，1=副路(in1 复用)；parity 回写
 */
export function routeSplitter(mode, parityState, resId, filterResId) {
  if (mode === 2) {
    return { port: resId === filterResId ? 0 : 1, parity: parityState };
  }
  if (mode === 1) return { port: 0, parity: parityState }; // 主路优先（满载溢出由调用方判）
  const p = parityState & 1;
  return { port: p, parity: parityState ^ 1 };
}

/**
 * 透明瓶颈效率分解公式（doc16 §4.10 / doc19 WP-3）：
 * P_actual = P_base × F_power × F_input × F_transport × F_staff × F_environment
 * UI 面板必须逐项展示（杜绝盲猜停工根因）。
 */
export function computeProductionEfficiency(node, grid, planet) {
  const fPower = grid ? grid.etaPermille / 1000 : 0.0;
  const fInput = node[NODE_IDX.IN0] > 0 || node[NODE_IDX.IN1] > 0 ? 1.0 : 0.0;
  const fTransport = node[NODE_IDX.OUT0] < SLOT_CAP ? 1.0 : 0.2; // 输出口未堵塞
  const fStaff = planet && planet.colony && Number.isFinite(planet.colony.staffingEta)
    ? clamp(planet.colony.staffingEta, 0, 1) : 1.0;
  const fEnv = planet && planet.threat && planet.threat.storm && planet.threat.storm[0] ? 0.7 : 1.0;

  const actual = fPower * fInput * fTransport * fStaff * fEnv;
  return {
    actual,
    factors: { fPower, fInput, fTransport, fStaff, fEnv },
  };
}

/**
 * 单星工业小时步进（HourlySystems production 阶段调用；仅遍历已激活工业星）。
 * 1) 电网 etaPermille 结算（发电-负载-蓄电池）；2) 加工节点配方推进；
 * 3) 传送带 O(1) 步进（12 子步/小时，保证多箱吞吐）；4) 分流器路由。
 * @returns {{transferred:number, produced:number}} 本小时物流统计（守恒审计用）
 */
export function stepPlanetIndustry(world, planet, indState, buildingDefs, dtHours = 1) {
  const out = { transferred: 0, produced: 0, consumed: 0 };
  const nodes = indState.nodes || [];
  if (nodes.length === 0) return out;
  const nodeById = new Map(nodes.map((n) => [n[NODE_IDX.ID], n]));

  // 1) 电网供电充足率：genKW（发电类 def.powerUse>0 视为发电）− loadKW（<0 用电）
  for (const g of indState.grids || []) {
    g.genKW = 0;
    g.loadKW = 0;
    g.accMaxMWh = 0;
  }
  for (const n of nodes) {
    const def = buildingDefs[n[NODE_IDX.DEF]];
    const g = (indState.grids || []).find((x) => x.id === n[NODE_IDX.GRID]);
    if (!g || !def) continue;
    if (def.powerUse > 0) g.genKW += def.powerUse * 1000;
    else g.loadKW += -def.powerUse * 1000;
    if (def.accMaxMWh) g.accMaxMWh += def.accMaxMWh;
  }
  for (const g of indState.grids || []) {
    if (g.loadKW <= 0) g.etaPermille = 1000;
    else {
      const supply = g.genKW + (g.accMWh > 0 ? 5000 : 0); // 蓄电池最大放电 5MW 兜底
      g.etaPermille = Math.round(clamp(supply / g.loadKW, 0, 1) * 1000);
      if (g.genKW < g.loadKW && g.accMWh > 0) {
        g.accMWh = Math.max(0, g.accMWh - (g.loadKW - g.genKW) / 1000 * dtHours);
      } else if (g.genKW > g.loadKW && g.accMaxMWh > 0) {
        g.accMWh = Math.min(g.accMaxMWh, g.accMWh + (g.genKW - g.loadKW) / 1000 * dtHours * 0.5);
      }
    }
  }

  // 2) 加工节点配方推进（电网 etaPermille 线性降速；doc19 WP-3）
  const SUB = 12; // 小时子步（传送带多箱吞吐）
  for (const n of nodes) {
    const def = buildingDefs[n[NODE_IDX.DEF]];
    if (!def || !def.indRecipe) continue;
    const g = (indState.grids || []).find((x) => x.id === n[NODE_IDX.GRID]);
    const eta = g ? g.etaPermille : 0;
    if (eta <= 0) { n[NODE_IDX.STATE] = NODE_STATE.NO_POWER; continue; }
    const rec = def.indRecipe;
    const needIn0 = rec.in0 || null;
    const needIn1 = rec.in1 || null;
    // 输入缓冲检查
    if ((needIn0 && n[NODE_IDX.IN0] <= 0) || (needIn1 && n[NODE_IDX.IN1] <= 0)) {
      n[NODE_IDX.STATE] = NODE_STATE.BLOCKED;
      continue;
    }
    n[NODE_IDX.STATE] = NODE_STATE.ACTIVE;
    const cycleS = rec.cycleS || 6;
    const progressPerSub = (3600 / SUB) / cycleS * 1000 * (eta / 1000);
    let producedThisHour = 0;
    for (let k = 0; k < SUB; k++) {
      if ((needIn0 && n[NODE_IDX.IN0] <= 0) || (needIn1 && n[NODE_IDX.IN1] <= 0)) {
        n[NODE_IDX.STATE] = NODE_STATE.BLOCKED;
        break;
      }
      n[NODE_IDX.PROG] += progressPerSub;
      if (n[NODE_IDX.PROG] >= 1000) {
        n[NODE_IDX.PROG] -= 1000;
        if (needIn0) { n[NODE_IDX.IN0] -= 1; out.consumed++; }
        if (needIn1) { n[NODE_IDX.IN1] -= 1; out.consumed++; }
        if (n[NODE_IDX.OUT0] < SLOT_CAP) {
          n[NODE_IDX.OUT0] += 1;
          out.produced++;
          producedThisHour++;
        } else {
          n[NODE_IDX.STATE] = NODE_STATE.BLOCKED; // 输出堵塞（原料已耗，产物丢弃计数为 0）
        }
      }
    }
    out.produced += producedThisHour;
  }

  // 3) 传送带 O(1) 步进 × 子步 + 分流器确定性路由
  for (const belt of indState.belts || []) {
    const src = nodeById.get(belt[BELT_IDX.FROM]) || null;
    const dst = nodeById.get(belt[BELT_IDX.TO]) || null;
    const srcGrid = src ? (indState.grids || []).find((x) => x.id === src[NODE_IDX.GRID]) : null;
    const eta = srcGrid ? srcGrid.etaPermille : 1000; // 带由上游电网供电
    for (let k = 0; k < SUB; k++) {
      const before = belt[BELT_IDX.COUNT];
      stepTransportLineO1(belt, src, dst, 3600 / SUB, eta);
      if (belt[BELT_IDX.COUNT] < before) out.transferred++;
    }
    // 分流器消费：mode 存于 toNode.rot 低 2 位；parity 台账 indState.splitterParity[lineId]。
    // 每子步自 in0 取 1 箱按模式路由至 out0（主路）/in1（副路复用为第二输出口）
    if (dst) {
      const def = buildingDefs[dst[NODE_IDX.DEF]];
      if (def && def.splitter && dst[NODE_IDX.IN0] > 0) {
        const mode = dst[NODE_IDX.ROT] & 0b11;
        const parityKey = `s${belt[BELT_IDX.ID]}`;
        const r = routeSplitter(mode, indState.splitterParity[parityKey] || 0, belt[BELT_IDX.RES], dst[NODE_IDX.RECIPE] || 0);
        const outSlot = r.port === 0 ? NODE_IDX.OUT0 : NODE_IDX.IN1;
        if (dst[outSlot] < SLOT_CAP) {
          dst[NODE_IDX.IN0] -= 1;
          dst[outSlot] += 1;
          indState.splitterParity[parityKey] = r.parity;
        }
      }
    }
  }
  return out;
}

/**
 * 新建样条传送带 12 元组（BuildConveyorBelt 命令执行体）。
 * 立体交叉（doc19 WP-2.4）：与既有带水平相交时后铺带渲染层 y +1.8m + 微型立柱
 * （纯渲染偏移，由 beltIsCrossed 渲染时重算，不占持久化元组）。
 */
export function createBeltTuple(indState, { fromNode, fromSlot, toNode, toSlot, tier, lengthM, resTypeIdx }) {
  const nextId = (indState.belts || []).reduce((m, b) => Math.max(m, b[BELT_IDX.ID]), 0) + 1;
  return [
    nextId,
    fromNode, fromSlot, toNode, toSlot, tier,
    Math.round(lengthM * 10),          // length_dm
    Math.round(lengthM * 10 * 100),    // headGap_mm 初值 = 全长（空带）
    Math.round(lengthM * 10 * 100),    // tailGap_mm 初值 = 全长
    resTypeIdx, 0, 0,
  ];
}

/** 传送带立体交叉判定（渲染层每帧重算；水平投影线段相交） */
export function beltIsCrossed(indState, belt) {
  const a1 = nodePosOf(indState, belt[BELT_IDX.FROM]);
  const a2 = nodePosOf(indState, belt[BELT_IDX.TO]);
  if (!a1 || !a2) return false;
  for (const other of indState.belts || []) {
    if (other[BELT_IDX.ID] === belt[BELT_IDX.ID]) continue;
    if (other[BELT_IDX.ID] > belt[BELT_IDX.ID]) continue; // 后铺带抬升（id 大者为后）
    const b1 = nodePosOf(indState, other[BELT_IDX.FROM]);
    const b2 = nodePosOf(indState, other[BELT_IDX.TO]);
    if (!b1 || !b2) continue;
    if (segIntersect(a1, a2, b1, b2)) return true;
  }
  return false;
}

function nodePosOf(indState, nodeId) {
  const n = (indState.nodes || []).find((x) => x[NODE_IDX.ID] === nodeId);
  return n ? { x: n[NODE_IDX.X_DM] / 10, z: n[NODE_IDX.Z_DM] / 10 } : null;
}

/** 线段相交判定（立体交叉检测用，水平投影） */
function segIntersect(a1, a2, b1, b2) {
  const d = (a2.x - a1.x) * (b2.z - b1.z) - (a2.z - a1.z) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((b1.x - a1.x) * (b2.z - b1.z) - (b1.z - a1.z) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.z - a1.z) - (b1.z - a1.z) * (a2.x - a1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
