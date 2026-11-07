/**
 * domain/ground/missionSiteFactory.js — 登陆点蓝图实例化与 SDF 地形融合（doc7 TASK-2.1 / §5）
 *
 * 三层同心关卡架构（doc7 §5.1 / 序列 6 §5.2）：
 *  1. 人工任务核心 Authored Mission Core（0 ~ coreRadius=44.8m）：锚点整平着陆区/目标坪、
 *     主视觉地标地基、CORE_PROTECTED 保护区；
 *  2. 人工控制过渡带 Transition Ring（45 ~ 86.4m）：道路样条 / SDF 权重经 smoothstep
 *     （86.4m → 112.4m）平滑衰减为 0，消除「人工基地贴在随机高度图上」的断层台阶；
 *  3. 确定性程序化外围 Procedural Frontier（86.4m+）：本模块不再施加任何高度修正，
 *     仅撤离/外围锚点坪与道路走廊按其自身局部 falloff 延伸（POI 级人工结构）。
 *
 * 地形算子（经 terrainField evalPoint 的 siteModifier 挂点， Applied AFTER material/hazard，
 * BEFORE 高度预算钳制 [-40,+80]）：
 *  A. 锚点坪整平：目标高 H = 宏观地貌复刻采样（见 createMacroHeightReplica），dy=(H-y)*w，
 *     w 为 smoothstep falloff；权限 |dy| ≤ 6+12w（坪心最多 18m，可填平陨坑/河道等局部特征，
 *     使坪面严格平坦；裙边收敛回 ±6m 保持场整体连贯）。
 *  B. 道路/河道样条：Catmull-Rom 过 route waypoints（Site Local → Planet Local），
 *     走廊内（wide_safe 半宽 3.5m / narrow_risky 半宽 1.75m）写 ROAD 旗 + 材质通道 3
 *     （装甲路面），高度向样条目标平滑；deckSegments 段写 BRIDGE_DECK 旗并按
 *     「两端岸高 + 拱升」抛物线抬高桥面（岩浆河/裂隙跨越）。
 *  C. 语义旗：CORE_PROTECTED（r ≤ coreRadius）、HAZARD（蓝图 hazardZones 圆域）、
 *     FOUNDATION（地标/锚点坪心）。
 *  clearFlags 契约（P0-D）：siteModifier 可输出 clearFlags 位掩码，evalPoint 在 flags
 *  合入后按位清除——坪面有效覆盖区（w ≥ 0.5）与高架桥面强制抹除自然环境危险旗
 *  （HAZARD），蓝图显式战术危险仅在坪面外生效。
 *  D. 过渡带融合：走廊高度/材质影响乘 s(r)=1-smoothstep(86.4,112.4,r)，权重平滑归零，
 *     无「人工/随机」突变边界（SITE-04）。
 *
 * 确定性（SITE-06 / doc7 红线 4）：全部变化经 derivePlanetSeeds().missionSiteSeed(id,version)
 * ⊕ proceduralSeedSalt 派生子流（seedFromNumber / nextU32），零 Math.random，
 * 绝不消费 world.rng；同 (world.seed, planetId, blueprintId, version) 逐字节可复现。
 *
 * 本模块为纯领域层：无 DOM / 无 WebGL；不 import terrainField（调用方把 siteModifier
 * 传入 createTerrainField opts），surfaceQueries 仅只读消费（validateGeneratedSite）。
 */

import { hash32, createSimplexNoise } from './SurfaceSandbox.js';
import { seedFromNumber, nextU32 } from '../../core/rng.js';
import { derivePlanetSeeds } from './planetSeeds.js';
import { TERRAIN_PROFILES } from '../../content/terrainProfiles.js';
import { getSiteBlueprint } from '../../content/missionSites.js';
import { findPathSurface, slopeAt } from './surfaceQueries.js';

// ———— 常量 ————

/** 默认站点半径（米，doc7 §5.1） */
export const SITE_RADIUS_DEFAULT = 160;
/** 人工任务核心半径系数（siteRadius × 0.28 = 44.8m） */
export const CORE_RADIUS_FACTOR_DEFAULT = 0.28;
/** 人工过渡带半径系数（siteRadius × (0.28+0.26) = 86.4m 外缘） */
export const TRANSITION_RADIUS_FACTOR_DEFAULT = 0.26;
/** 过渡带外缘 smoothstep 衰减宽度（86.4m → 112.4m） */
export const TRANSITION_FADE_WIDTH = 26;

/** TERRAIN_FLAGS 位语义（与 terrainField.js 保持一致；不 import 以避免构建期耦合） */
const FLAG_ROAD = 1;
const FLAG_FOUNDATION = 2;
const FLAG_CORE_PROTECTED = 4;
const FLAG_HAZARD = 8;
const FLAG_BRIDGE_DECK = 32;

/** 高度预算（doc7 §3.1） */
const MIN_HEIGHT = -40;
const MAX_HEIGHT = 80;
/** 坪目标高 / 样条目标高的安全内缩（保证 dy 后仍在预算内） */
const TARGET_CLAMP_LO = -34;
const TARGET_CLAMP_HI = 74;

/** 路线种类 → 走廊半宽（米）：主道 7m 宽、侧翼 3.5m 宽（doc7 TASK-2.1） */
const CORRIDOR_HALF = { wide_safe: 3.5, narrow_risky: 1.75 };
/** Catmull-Rom 采样间距（米） */
const SPLINE_SPACING = 3;
/** 走廊空间桶格（米）；查询只看 3×3 邻桶 ≥ 半宽 + 采样距 */
const BUCKET_CELL = 8;

// ———— 小工具 ————

function num(v, dflt) {
  return Number.isFinite(v) ? v : dflt;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** GLSL smoothstep 语义 */
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-12), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 分形布朗运动（2D）——与 terrainField.js 内部实现逐位一致（复刻用途） */
function fbm2(noise, x, y, octaves) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise2D(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

// ———— 宏观地貌高度复刻 ————

/**
 * 宏观地貌高度场「复刻采样器」：与 terrainField.js createMacroField().heightAt 的
 * 高度数学逐位一致（同一 seeds.macroTerrainSeed → 同一 Simplex 置换表 → 同一 fBm；
 * 陨坑散布同用 splitmix32 子种子）。terrainField 未导出该内部采样器，且 siteModifier
 * 在 evalPoint 内被调用（再入 evalPoint 会递归），故在此以纯函数复刻：
 *  - 用途 1：锚点坪目标高 H ≈ 周边自然高程，使坪面既严格平坦又与四周无缝衔接
 *    （|dy| 通常 < 2m，仅填平局部特征时触及权限上限）；
 *  - 用途 2：validateGeneratedSite 的过渡带无缝检查需要「未加 SDF 的自然高」作基准。
 * 若 terrainField 宏观场后续演化，须同步更新本复刻（仅影响坪贴合度，不影响确定性）。
 */
export function createMacroHeightReplica(profile, seeds) {
  const noise = createSimplexNoise(seeds.macroTerrainSeed);
  const detailNoise = createSimplexNoise((seeds.macroTerrainSeed ^ 0x51ed270b) >>> 0);

  const base = num(profile.base, 8);
  const amp = num(profile.amp, 10);
  const ridgeW = num(profile.ridge, 0);
  const basin = num(profile.basinDepth, 0);
  const shelf = profile.shelf || null;
  const trench = profile.trench || null;
  const mesa = profile.mesa || null;
  const terrace = num(profile.terrace, 0);
  const dune = profile.dune || null;
  const channel = profile.channel || null;

  // 陨坑群：与 terrainField 相同的子种子与抽样顺序
  const craters = [];
  if (profile.crater && profile.crater.count > 0) {
    const st = seedFromNumber((seeds.macroTerrainSeed ^ hash32('crater')) >>> 0);
    const spread = 480;
    for (let k = 0; k < profile.crater.count; k++) {
      const r1 = nextU32(st) / 4294967296;
      const r2 = nextU32(st) / 4294967296;
      const r3 = nextU32(st) / 4294967296;
      const r4 = nextU32(st) / 4294967296;
      craters.push({
        x: (r1 - 0.5) * spread,
        z: (r2 - 0.5) * spread,
        r: num(profile.crater.radius, 20) * (0.6 + 0.8 * r3),
        d: num(profile.crater.depth, 5) * (0.6 + 0.7 * r4),
      });
    }
  }

  const duneCa = dune ? Math.cos(num(dune.angle, 0)) : 1;
  const duneSa = dune ? Math.sin(num(dune.angle, 0)) : 0;
  const duneAmp = dune ? num(dune.amp, 0.8) : 0;
  const duneWave = dune ? num(dune.wavelength, 16) : 16;
  const trenchW = trench ? num(trench.width, 0.05) : 0;
  const trenchD = trench ? num(trench.depth, 10) : 0;
  const mesaThr = mesa ? 1 - 2 * clamp(num(mesa.fraction, 0.3), 0, 0.9) : 0;
  const mesaStep = mesa ? Math.max(0.5, num(mesa.step, 2)) : 1;
  const chanEdge = channel ? 1 - clamp(num(channel.width, 0.1), 0.01, 0.9) : 1;
  const chanLevel = channel ? num(channel.level, -4) : 0;
  const shelfLevel = shelf ? num(shelf.level, 0) : 0;
  const shelfThr = shelf ? num(shelf.threshold, 0.2) : 0;

  /** 与 terrainField heightAt 逐项一致的高度叠加（返回标量 y，未做预算钳制） */
  function heightAt(wx, wz) {
    let y = base + fbm2(noise, wx * 0.0055, wz * 0.0055, 3) * amp;
    if (ridgeW > 0) {
      const r = 1 - Math.abs(noise.noise2D(wx * 0.0105 + 13.7, wz * 0.0105 - 7.3));
      y += amp * ridgeW * (r * r * 1.6 - 0.35);
    }
    if (basin > 0) {
      const b = fbm2(noise, wx * 0.0035 - 41.2, wz * 0.0035 + 17.8, 2);
      if (b > 0) y -= basin * b * b;
    }
    if (shelf) {
      const s = fbm2(noise, wx * 0.004 + 91.3, wz * 0.004 - 33.8, 2);
      if (s > shelfThr) {
        const k = smoothstep(shelfThr, shelfThr + 0.22, s);
        y += (shelfLevel - y) * k * 0.9;
      }
    }
    if (trench) {
      const t = Math.abs(noise.noise2D(wx * 0.0062 + 101.3, wz * 0.0062 - 55.9));
      if (t < trenchW) {
        const k = 1 - t / trenchW;
        const kk = k * k * (3 - 2 * k);
        y -= trenchD * kk;
      }
    }
    for (let c = 0; c < craters.length; c++) {
      const cr = craters[c];
      const ddx = wx - cr.x;
      const ddz = wz - cr.z;
      const dd = Math.sqrt(ddx * ddx + ddz * ddz) / cr.r;
      if (dd < 1) {
        y -= cr.d * (1 - dd * dd);
      } else if (dd < 1.35) {
        const rim = 1 - (dd - 1) / 0.35;
        y += cr.d * 0.32 * rim * rim;
      }
    }
    if (mesa) {
      const m = fbm2(noise, wx * 0.0045 + 77.7, wz * 0.0045 - 21.4, 2);
      if (m > mesaThr) {
        const k = smoothstep(mesaThr, mesaThr + 0.10, m);
        const q = Math.round(y / mesaStep) * mesaStep;
        y += (q - y) * k;
      }
    }
    if (terrace > 0) {
      const q = Math.round(y / terrace) * terrace;
      y += (q - y) * 0.85;
    }
    if (dune) {
      const mask = 0.5 + 0.5 * detailNoise.noise2D(wx * 0.02, wz * 0.02);
      y += duneAmp * Math.sin(((wx * duneCa + wz * duneSa) * 2 * Math.PI) / duneWave) * mask;
    }
    if (channel) {
      const v = 1 - Math.abs(noise.noise2D(wx * 0.009 + 37.2, wz * 0.009 - 91.4));
      if (v > chanEdge) {
        const k = smoothstep(chanEdge, 1, v);
        y += (chanLevel - y) * k;
      }
    }
    return y;
  }

  return { heightAt };
}

// ———— Site 变换 ————

/**
 * SiteTransform（doc7 §3.1）：Site Local → Planet Local（仿射：平移 + 1 缩放）。
 * @param {{siteCenter:number[]}} site 站点实例
 * @param {number} x Site Local x（米）
 * @param {number} z Site Local z（米）
 * @returns {number[]} [px, pz] Planet Local
 */
export function siteToPlanet(site, x, z) {
  return [site.siteCenter[0] + x, site.siteCenter[1] + z];
}

/** SiteTransform 逆变换：Planet Local → Site Local */
export function planetToSite(site, x, z) {
  return [x - site.siteCenter[0], z - site.siteCenter[1]];
}

// ———— Catmull-Rom 样条 ————

/** Catmull-Rom 单段插值（均匀参数化，端点复制） */
function crPoint(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/**
 * Catmull-Rom 链采样：过全部控制点（首尾复制端点），按约 SPLINE_SPACING 间距输出。
 * @param {{x:number,z:number}[]} pts 控制点（Planet Local）
 * @returns {{x:number,z:number}[]} 采样点（含首末端点，确定性）
 */
function catmullRomChain(pts) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = P[s];
    const p1 = P[s + 1];
    const p2 = P[s + 2];
    const p3 = P[s + 3];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(2, Math.ceil(segLen / SPLINE_SPACING));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({ x: crPoint(p0.x, p1.x, p2.x, p3.x, t), z: crPoint(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
  return out;
}

/** 折线长度（采样点累计弦长） */
function chainLength(chain) {
  let len = 0;
  for (let i = 1; i < chain.length; i++) {
    len += Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z);
  }
  return len;
}

// ———— 实例化 ————

/**
 * 实例化登陆点站点（纯函数、确定性；doc6 §5.4：锚点拓扑确定，细节摆放随子流有限变化）。
 * @param {{seed:number}} world 世界实体（只读 world.seed）
 * @param {string|number} planetId 行星实体 id
 * @param {object} blueprint MissionSiteBlueprint
 * @param {{center?:number[]}} [opts] siteCenter 覆盖（默认 Planet Local [0,0]）
 * @returns {object} 站点实例（JSON 可序列化，键序稳定，同种子逐字节一致）
 */
export function instantiateSite(world, planetId, blueprint, opts = {}) {
  const seeds = derivePlanetSeeds(world, planetId);
  const version = num(blueprint.version, 1);
  const siteSeed = seeds.missionSiteSeed(blueprint.id, version);
  const salt = blueprint.proceduralSeedSalt || blueprint.id;
  const varStream = seedFromNumber((siteSeed ^ hash32(salt)) >>> 0);
  const unit = () => nextU32(varStream) / 4294967296;

  const siteRadius = num(blueprint.siteRadius, SITE_RADIUS_DEFAULT);
  const coreFactor = num(blueprint.coreRadiusFactor, CORE_RADIUS_FACTOR_DEFAULT);
  const transFactor = num(blueprint.transitionRadiusFactor, TRANSITION_RADIUS_FACTOR_DEFAULT);
  const center = opts.center ? [opts.center[0], opts.center[1]] : [0, 0];
  const toPlanet = (p) => ({ x: center[0] + p.x, z: center[1] + p.z });

  const anchors = {
    landing: toPlanet(blueprint.anchors.landing),
    primaryObjective: toPlanet(blueprint.anchors.primaryObjective),
    secondaryObjective: toPlanet(blueprint.anchors.secondaryObjective),
    extraction: toPlanet(blueprint.anchors.extraction),
  };

  // 地标：授权 rotation 保留，另加子流微扰（±0.25rad）——纯摆放细节，不破坏拓扑
  const landmarks = blueprint.landmarks.map((lm) => ({
    prefabId: lm.prefabId,
    anchor: toPlanet(lm.anchor),
    rotation: num(lm.rotation, 0) + (unit() - 0.5) * 0.5,
  }));

  // 路线：端点解析 + Site Local → Planet Local + 设计折线长（供质量门禁比对）
  const routes = blueprint.routes.map((rt) => {
    const fromA = anchors[rt.from] || null;
    const toA = anchors[rt.to] || null;
    const waypoints = rt.waypoints.map(toPlanet);
    const pts = fromA && toA ? [fromA, ...waypoints, toA] : waypoints;
    return {
      id: rt.id,
      from: rt.from,
      to: rt.to,
      kind: rt.kind,
      fromXY: fromA ? { x: fromA.x, z: fromA.z } : null,
      toXY: toA ? { x: toA.x, z: toA.z } : null,
      waypoints,
      deckSegments: rt.deckSegments ? rt.deckSegments.map((d) => [d[0], d[1]]) : null,
      deckLift: num(rt.deckLift, 3.5),
      designLength: Math.round(chainLength(pts) * 100) / 100,
    };
  });

  // 掩体点：子流微扰（±1.5m），语义 kind 保留
  const coverPoints = blueprint.coverPoints.map((cp) => ({
    x: center[0] + cp.x + (unit() - 0.5) * 3,
    z: center[1] + cp.z + (unit() - 0.5) * 3,
    kind: cp.kind || 'cover',
  }));

  const hazardZones = blueprint.hazardZones.map((hz) => ({
    x: center[0] + hz.x,
    z: center[1] + hz.z,
    radius: hz.radius,
    type: hz.type,
  }));

  return {
    id: `${blueprint.id}@${planetId}`,
    blueprintId: blueprint.id,
    blueprintVersion: version,
    generatorVersion: 1,
    planetId,
    seed: siteSeed,
    proceduralSeedSalt: salt,
    siteCenter: center,
    siteRadius,
    coreRadius: siteRadius * coreFactor,
    transitionInnerRadius: siteRadius * coreFactor,
    transitionOuterRadius: siteRadius * (coreFactor + transFactor),
    anchors,
    landmarks,
    routes,
    hazardZones,
    coverPoints,
    objectiveGraph: blueprint.objectiveGraph || null,
    extraction: {
      kind: blueprint.extraction.kind,
      radius: blueprint.extraction.radius,
      anchor: { x: anchors.extraction.x, z: anchors.extraction.z },
    },
    missionTemplateAffinity: blueprint.missionTemplateAffinity.slice(),
  };
}

// ———— SDF siteModifier 构建 ————

/** 坪面遮罩：inner 内全权 1，inner→outer smoothstep 衰减为 0 */
function padMask(d, inner, outer) {
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  return 1 - smoothstep(inner, outer, d);
}

/**
 * 构建 terrainField 的 siteModifier（(wx, wz, base) => {dy, flags, clearFlags, weights}|null）。
 * 调用方将返回值传入 createTerrainField(world, planetId, { siteModifier, profile })；
 * field 的 profile 必须与 blueprint.terrainProfile 一致（坪目标高/无缝基准取自同一剖面）。
 *
 * @param {{seed:number}} world 世界实体
 * @param {string|number} planetId 行星实体 id
 * @param {object} blueprint MissionSiteBlueprint
 * @param {{center?:number[]}} [opts]
 */
export function buildSiteModifier(world, planetId, blueprint, opts = {}) {
  const site = instantiateSite(world, planetId, blueprint, opts);
  const seeds = derivePlanetSeeds(world, planetId);
  const profile = TERRAIN_PROFILES[blueprint.terrainProfile] || null;
  const macro = profile ? createMacroHeightReplica(profile, seeds) : null;

  /** 坪/样条目标高（宏观复刻 + 预算安全内缩） */
  const targetY = (x, z) => clamp(macro ? macro.heightAt(x, z) : 0, TARGET_CLAMP_LO, TARGET_CLAMP_HI);
  /** 精确自然高（含与 evalPoint 相同的预算钳制；无缝检查基准） */
  const naturalYExact = (x, z) => clamp(macro ? macro.heightAt(x, z) : 0, MIN_HEIGHT, MAX_HEIGHT);
  /**
   * 人工结构坪目标高（P0-D）：海洋/流体主题（profile.seaLevel != null）的着陆坪/撤离坪
   * 抬升出海面（浮台/耐压船坞基座，防淹没）；主/次目标坪与地标保持自然主题（水下设施
   * 属主题设计，坪面危险旗由 clearFlags 清除）。
   */
  const padTargetY = (x, z, lift) => (profile && profile.seaLevel != null && lift)
    ? Math.max(targetY(x, z), profile.seaLevel + 0.6)
    : targetY(x, z);

  // A. 锚点坪：着陆坪（平地半径 ≥12m）、主/次目标坪、撤离坪 + 地标地基
  const pads = [];
  const padSpecs = [
    ['landing', 12, 28],
    ['primaryObjective', 8, 20],
    ['secondaryObjective', 8, 20],
  ];
  for (let i = 0; i < padSpecs.length; i++) {
    const a = site.anchors[padSpecs[i][0]];
    pads.push({ x: a.x, z: a.z, inner: padSpecs[i][1], outer: padSpecs[i][2], H: padTargetY(a.x, a.z, padSpecs[i][0] === 'landing') });
  }
  const exInner = clamp(num(site.extraction.radius, 8) + 1, 8, 12);
  pads.push({
    x: site.anchors.extraction.x, z: site.anchors.extraction.z,
    inner: exInner, outer: exInner + 12, H: padTargetY(site.anchors.extraction.x, site.anchors.extraction.z, true),
  });
  for (let i = 0; i < site.landmarks.length; i++) {
    const lm = site.landmarks[i];
    pads.push({ x: lm.anchor.x, z: lm.anchor.z, inner: 5, outer: 10, H: targetY(lm.anchor.x, lm.anchor.z) });
  }
  // 坪高一致性：内盘贴近的坪并接到同一水平面（声明序先到者优先）。
  // 否则两个 w=1 的平台交叠处会按先到者切换，形成双平台间的垂直悬崖。
  for (let i = 1; i < pads.length; i++) {
    for (let j = 0; j < i; j++) {
      const dxp = pads[i].x - pads[j].x;
      const dzp = pads[i].z - pads[j].z;
      if (Math.sqrt(dxp * dxp + dzp * dzp) < pads[i].inner + pads[j].inner + 6) {
        pads[i].H = pads[j].H;
        break;
      }
    }
  }

  // B. 道路样条：Catmull-Rom 采样 → 弧长 → 桥面段标记 → 空间桶索引
  const samples = [];
  const buckets = new Map();
  const bucketKey = (gx, gz) => (gx + 2048) * 8192 + (gz + 2048);
  for (let ri = 0; ri < site.routes.length; ri++) {
    const route = site.routes[ri];
    if (!route.fromXY || !route.toXY) continue;
    const chain = catmullRomChain([route.fromXY, ...route.waypoints, route.toXY]);
    const total = chainLength(chain);
    const half = CORRIDOR_HALF[route.kind] || 3.5;
    const decks = route.deckSegments || [];
    const lift = num(route.deckLift, 3.5);
    const cum = [0];
    for (let i = 1; i < chain.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z));
    }
    const isDeck = chain.map((_, i) => {
      const f = total > 0 ? cum[i] / total : 0;
      for (let d = 0; d < decks.length; d++) {
        if (f >= decks[d][0] && f <= decks[d][1]) return true;
      }
      return false;
    });
    // 桥面目标高：两端岸高线性基准 + 抛物线拱升，且不低于自然高（桥不沉入河道）
    const targets = new Array(chain.length);
    let i = 0;
    while (i < chain.length) {
      if (!isDeck[i]) {
        targets[i] = targetY(chain[i].x, chain[i].z);
        i++;
        continue;
      }
      let i1 = i;
      while (i1 + 1 < chain.length && isDeck[i1 + 1]) i1++;
      const yA = targetY(chain[i].x, chain[i].z);
      const yB = targetY(chain[i1].x, chain[i1].z);
      const runLen = cum[i1] - cum[i];
      for (let k = i; k <= i1; k++) {
        const u = runLen > 1e-9 ? (cum[k] - cum[i]) / runLen : 0;
        const bank = yA + (yB - yA) * u;
        const arch = bank + lift * Math.sin(Math.PI * u);
        targets[k] = Math.max(targetY(chain[k].x, chain[k].z), arch);
      }
      i = i1 + 1;
    }
    for (let k = 0; k < chain.length; k++) {
      const smp = {
        x: chain[k].x, z: chain[k].z,
        target: targets[k], half,
        deck: isDeck[k],
      };
      const idx = samples.length;
      samples.push(smp);
      const key = bucketKey(Math.floor(smp.x / BUCKET_CELL), Math.floor(smp.z / BUCKET_CELL));
      const arr = buckets.get(key);
      if (arr) arr.push(idx);
      else buckets.set(key, [idx]);
    }
  }

  const hazards = site.hazardZones;
  const coreRadius = site.coreRadius;
  const transOuter = site.transitionOuterRadius;
  const cx = site.siteCenter[0];
  const cz = site.siteCenter[1];

  // 生效半径：坪 / 走廊 / 危险域 / 核心的最大延伸 + 余量
  let reach = coreRadius + 2;
  for (let i = 0; i < pads.length; i++) {
    reach = Math.max(reach, Math.hypot(pads[i].x - cx, pads[i].z - cz) + pads[i].outer);
  }
  for (let i = 0; i < samples.length; i++) {
    reach = Math.max(reach, Math.hypot(samples[i].x - cx, samples[i].z - cz) + samples[i].half);
  }
  for (let i = 0; i < hazards.length; i++) {
    reach = Math.max(reach, Math.hypot(hazards[i].x - cx, hazards[i].z - cz) + hazards[i].radius);
  }
  reach += 2;

  /**
   * 逐点 SDF 评估。base = evalPoint 传入的 { y, weights, biomeId, flags, temp, moisture }
   * （y 为未钳制的宏观高度）；返回 null 表示本点无人工修型（程序化外围原样透传）。
   */
  return function siteModifier(wx, wz, base) {
    const dx = wx - cx;
    const dz = wz - cz;
    const r2 = dx * dx + dz * dz;
    if (r2 > reach * reach) return null;
    const r = Math.sqrt(r2);
    let dy = 0;
    let flags = 0;
    let clearFlags = 0; // P0-D：人工结构显式清除的自然危险旗（与 flags 同位掩码语义）
    let roadTake = 0;

    // A. 锚点坪 / 地标地基：取权重最高者的整平贡献（互叠时优先坪面）
    let bestW = 0;
    let bestDy = 0;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const ddx = wx - p.x;
      const ddz = wz - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 > p.outer * p.outer) continue;
      const w = padMask(Math.sqrt(d2), p.inner, p.outer);
      if (w > bestW) {
        bestW = w;
        const auth = 6 + 34 * w; // 坪心权限 40m（填平陨坑/河道/裂隙等局部特征），裙边收敛回 ±6m
        bestDy = clamp((p.H - base.y) * w, -auth, auth);
        if (w >= 0.999) flags |= FLAG_FOUNDATION;
        if (w >= 0.5) clearFlags |= FLAG_HAZARD; // 坪面有效覆盖区强制抹除自然环境危害（P0-D）
      }
    }
    if (bestW > 0.0001) dy = bestDy;

    // B. 道路走廊：最近样条样本（3×3 桶邻域）
    let bd = Infinity;
    let bs = null;
    const gx0 = Math.floor(wx / BUCKET_CELL);
    const gz0 = Math.floor(wz / BUCKET_CELL);
    for (let gz = gz0 - 1; gz <= gz0 + 1; gz++) {
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        const arr = buckets.get(bucketKey(gx, gz));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const smp = samples[arr[k]];
          const ddx = wx - smp.x;
          const ddz = wz - smp.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bd) {
            bd = d2;
            bs = smp;
          }
        }
      }
    }
    let corrW = 0;
    if (bs && bd < bs.half * bs.half) {
      const d = Math.sqrt(bd);
      corrW = 1 - smoothstep(bs.half * 0.45, bs.half, d);
      flags |= FLAG_ROAD;
      if (bs.deck) flags |= FLAG_BRIDGE_DECK;
      if (bs.deck) clearFlags |= FLAG_HAZARD; // 人工高架桥面免受桥下毒液/岩浆侵蚀（P0-D）
      // D. 过渡带融合：走廊高度/材质影响随 r 平滑衰减（86.4m → 112.4m → 0）
      const sFade = 1 - smoothstep(transOuter, transOuter + TRANSITION_FADE_WIDTH, r);
      const auth = bs.deck ? 18 : 6; // 桥面为人工结构，允许跨越河道的拱升
      const dyC = clamp(bs.target - base.y, -auth, auth) * corrW * sFade;
      // 坪面优先：坪裙边内（w ≥ 0.5）道路必须并入坪面高程，严禁以自然高目标
      // 在坪缘开挖路堑；裙边外道路才接管高度并自然衔接地形
      if (corrW > bestW && bestW < 0.5) dy = dyC;
      roadTake = Math.max(roadTake, Math.round(200 * corrW * sFade));
    }

    // C. 语义旗：任务核心保护区 / 蓝图危险域（蓝图显式战术危险优先，
    //    坪面有效覆盖区 bestW ≥ 0.3 内豁免且不阻断后续危险域判定）
    if (r <= coreRadius) flags |= FLAG_CORE_PROTECTED;
    for (let i = 0; i < hazards.length; i++) {
      const hz = hazards[i];
      const ddx = wx - hz.x;
      const ddz = wz - hz.z;
      if (ddx * ddx + ddz * ddz <= hz.radius * hz.radius) {
        if (bestW < 0.3) {
          flags |= FLAG_HAZARD;
          clearFlags &= ~FLAG_HAZARD; // 战术危险优先，抵消坪面/桥面的清除位
          break;
        }
        continue; // 命中但在坪面上：豁免，继续查下一个危险域
      }
    }

    const hasDy = dy !== 0;
    const w0 = base.weights ? base.weights[0] : 255;
    const take = Math.min(roadTake, w0);
    if (!hasDy && flags === 0 && clearFlags === 0 && take <= 0) return null;

    const mod = {};
    if (hasDy) mod.dy = dy;
    if (flags !== 0) mod.flags = flags;
    if (clearFlags !== 0) mod.clearFlags = clearFlags;
    if (take > 0 && base.weights) {
      const w = [base.weights[0], base.weights[1], base.weights[2], base.weights[3]];
      w[0] -= take;
      w[3] += take; // 四通道和恒 255（TERRAIN-01），道路材质走通道 3
      mod.weights = w;
    }
    return mod;
  };
}

// ———— 生成质量门禁自检（doc7 TASK-2.1：6 项；SITE-01/03/04/06） ————

/** 门禁阈值 */
const GATE_PAD_MAX_SLOPE_DEG = 6;      // (2) 着陆坪坡度
const GATE_RING_SEAM_M = 3;            // (3) 86m 环 SDF 诱导高差 ≤ 3m / 8m
const GATE_ANCHOR_MIN_DIST_M = 12;     // (5) 锚点两两间距
const GATE_ROUTE_LEN_RATIO = 1.15;     // (4) 主/侧翼路线长差 ≥ 15%
const GATE_ROUTE_HAZARD_DIFF = 0.02;   // (4) 或危险暴露差 ≥ 2% 采样
const RING_ANGLES = 64;                // 86m 环采样角数（弧距 ≈ 8.5m）
const RING_RADIAL_STEP = 8;            // 径向配对间距（m）

/**
 * 6 项生成质量自检（纯读 field；确定性违规字符串，全部通过返回 { ok:true, violations:[] }）。
 *  (1) 锚点可达：landing → primary/secondary/extraction 的 findPathSurface 均非空；
 *  (2) 着陆坪坡度 ≤ 6°（坪心 + r=6/11m 两圈 16 向采样）；
 *  (3) 核心/过渡带边界无缝：86m 环（及 +8m 径向配对）上「SDF 诱导高差 = 场高 − 自然高」
 *      的相邻采样差 ≤ 3m（天然沟壑属程序化外围地貌，不计入人工拼缝）；
 *  (4) 路线连通且差异化：每条路线端点路径存在，且设计折线长差 ≥ 15% 或危险暴露差 ≥ 2%
 *      （或实测路径危险暴露不同）；
 *  (5) 锚点/POI 无重叠：两两间距 ≥ 12m；
 *  (6) 撤离点可自主目标抵达。
 *
 * @param {{seed:number}} world 世界实体
 * @param {string|number} planetId 行星实体 id
 * @param {object} blueprint MissionSiteBlueprint
 * @param {object} field createTerrainField 产出的地形场（profile 应与蓝图一致）
 * @returns {{ok:boolean, violations:string[], stats:object}}
 */
export function validateGeneratedSite(world, planetId, blueprint, field) {
  const site = instantiateSite(world, planetId, blueprint);
  const violations = [];
  const stats = {};
  const A = site.anchors;

  // (1)(6) 路径连通
  const reachPairs = [
    ['landing', 'primaryObjective'],
    ['landing', 'secondaryObjective'],
    ['landing', 'extraction'],
    ['primaryObjective', 'extraction'],
  ];
  for (let i = 0; i < reachPairs.length; i++) {
    const [f, t] = reachPairs[i];
    const path = findPathSurface(field, A[f].x, A[f].z, A[t].x, A[t].z);
    const key = `${f}->${t}`;
    if (!path) {
      violations.push(`anchors:${key} unreachable (no surface path)`);
      stats[`path_${key}`] = -1;
    } else {
      let len = 0;
      for (let k = 1; k < path.path.length; k++) {
        len += Math.hypot(path.path[k].x - path.path[k - 1].x, path.path[k].z - path.path[k - 1].z);
      }
      stats[`path_${key}`] = Math.round(len * 10) / 10;
    }
  }

  // (2) 着陆坪坡度（坪心 + r=6 / r=11 各 8 向）
  let padMaxSlope = 0;
  const padRings = [0, 6, 11];
  for (let ri = 0; ri < padRings.length; ri++) {
    const rr = padRings[ri];
    const count = rr === 0 ? 1 : 8;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2;
      const px = A.landing.x + Math.cos(ang) * rr;
      const pz = A.landing.z + Math.sin(ang) * rr;
      const deg = slopeAt(field, px, pz);
      if (!Number.isFinite(deg)) {
        violations.push('landing_pad: slope sample outside field');
        padMaxSlope = NaN;
        break;
      }
      if (deg > padMaxSlope) padMaxSlope = deg;
    }
  }
  stats.padMaxSlopeDeg = Number.isFinite(padMaxSlope) ? Math.round(padMaxSlope * 100) / 100 : NaN;
  if (Number.isFinite(padMaxSlope) && padMaxSlope > GATE_PAD_MAX_SLOPE_DEG) {
    violations.push(`landing_pad: slope ${stats.padMaxSlopeDeg}deg > ${GATE_PAD_MAX_SLOPE_DEG}deg`);
  }

  // (3) 86m 环无缝：SDF 诱导高差（场高 − 自然高）的相邻/径向变化 ≤ 3m / 8m
  const profile = TERRAIN_PROFILES[blueprint.terrainProfile] || null;
  const macro = profile ? createMacroHeightReplica(profile, derivePlanetSeeds(world, planetId)) : null;
  const seamBase = site.transitionOuterRadius;
  let seamAngular = 0;
  let seamRadial = 0;
  const seam = new Array(RING_ANGLES);
  for (let i = 0; i < RING_ANGLES; i++) {
    const ang = (i / RING_ANGLES) * Math.PI * 2;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const px = site.siteCenter[0] + cosA * seamBase;
    const pz = site.siteCenter[1] + sinA * seamBase;
    const h = field.evalPoint(px, pz).y;
    const n = macro ? clamp(macro.heightAt(px, pz), MIN_HEIGHT, MAX_HEIGHT) : h;
    seam[i] = h - n;
    const px2 = site.siteCenter[0] + cosA * (seamBase + RING_RADIAL_STEP);
    const pz2 = site.siteCenter[1] + sinA * (seamBase + RING_RADIAL_STEP);
    const h2 = field.evalPoint(px2, pz2).y;
    const n2 = macro ? clamp(macro.heightAt(px2, pz2), MIN_HEIGHT, MAX_HEIGHT) : h2;
    seamRadial = Math.max(seamRadial, Math.abs(h2 - n2 - seam[i]));
  }
  for (let i = 0; i < RING_ANGLES; i++) {
    const j = (i + 1) % RING_ANGLES;
    seamAngular = Math.max(seamAngular, Math.abs(seam[j] - seam[i]));
  }
  stats.ringSeamAngularM = Math.round(seamAngular * 100) / 100;
  stats.ringSeamRadialM = Math.round(seamRadial * 100) / 100;
  if (seamAngular > GATE_RING_SEAM_M) {
    violations.push(`ring: sdf seam angular ${stats.ringSeamAngularM}m > ${GATE_RING_SEAM_M}m per 8m`);
  }
  if (seamRadial > GATE_RING_SEAM_M) {
    violations.push(`ring: sdf seam radial ${stats.ringSeamRadialM}m > ${GATE_RING_SEAM_M}m per 8m`);
  }

  // (5) 锚点两两间距 ≥ 12m
  const anchorKeys = ['landing', 'primaryObjective', 'secondaryObjective', 'extraction'];
  let minPair = Infinity;
  for (let i = 0; i < anchorKeys.length; i++) {
    for (let j = i + 1; j < anchorKeys.length; j++) {
      const d = Math.hypot(
        A[anchorKeys[i]].x - A[anchorKeys[j]].x,
        A[anchorKeys[i]].z - A[anchorKeys[j]].z,
      );
      if (d < minPair) minPair = d;
    }
  }
  stats.anchorMinPairDistM = Math.round(minPair * 100) / 100;
  if (minPair < GATE_ANCHOR_MIN_DIST_M) {
    violations.push(`anchors: min pair distance ${stats.anchorMinPairDistM}m < ${GATE_ANCHOR_MIN_DIST_M}m`);
  }

  // (4) 路线连通且差异化
  const main = site.routes.find((rt) => rt.id === 'route_main') || site.routes[0] || null;
  const flank = site.routes.find((rt) => rt.id === 'route_flank') || null;
  for (let i = 0; i < site.routes.length; i++) {
    const rt = site.routes[i];
    if (!rt.fromXY || !rt.toXY) {
      violations.push(`routes:${rt.id} endpoints unresolved`);
      continue;
    }
    const path = findPathSurface(field, rt.fromXY.x, rt.fromXY.z, rt.toXY.x, rt.toXY.z);
    if (!path) violations.push(`routes:${rt.id} not connected on surface`);
  }
  if (main && flank) {
    const lenMain = Math.max(1e-6, main.designLength);
    const lenFlank = Math.max(1e-6, flank.designLength);
    const ratio = Math.max(lenMain, lenFlank) / Math.min(lenMain, lenFlank);
    stats.routeLenRatio = Math.round(ratio * 100) / 100;
    const hazMain = routeHazardFraction(site, main);
    const hazFlank = routeHazardFraction(site, flank);
    stats.routeHazardMain = hazMain;
    stats.routeHazardFlank = hazFlank;
    const distinct = ratio >= GATE_ROUTE_LEN_RATIO
      || Math.abs(hazMain - hazFlank) >= GATE_ROUTE_HAZARD_DIFF;
    if (!distinct) {
      violations.push(
        `routes: main/flank not distinct (lenRatio ${stats.routeLenRatio} < ${GATE_ROUTE_LEN_RATIO}`
        + `, hazardDiff ${Math.abs(hazMain - hazFlank).toFixed(3)})`,
      );
    }
  } else {
    violations.push('routes: route_main/route_flank pair missing');
  }

  return { ok: violations.length === 0, violations, stats };
}

/** 路线危险暴露：Catmull-Rom 采样点落入任一 hazardZones 的比例（设计层面差异化度量） */
function routeHazardFraction(site, route) {
  if (!route.fromXY || !route.toXY) return 0;
  const chain = catmullRomChain([route.fromXY, ...route.waypoints, route.toXY]);
  let hits = 0;
  for (let i = 0; i < chain.length; i++) {
    for (let h = 0; h < site.hazardZones.length; h++) {
      const hz = site.hazardZones[h];
      const dx = chain[i].x - hz.x;
      const dz = chain[i].z - hz.z;
      if (dx * dx + dz * dz <= hz.radius * hz.radius) {
        hits++;
        break;
      }
    }
  }
  return chain.length > 0 ? hits / chain.length : 0;
}

// ———— 便捷入口 ————

/**
 * getSiteInstance：查表 → 实例化 → 构建 siteModifier，返回即可直接传入
 * createTerrainField(world, planetId, { profile: blueprint.terrainProfile, siteModifier })。
 * @returns {null|{blueprint:object, site:object, siteModifier:Function}}
 */
export function getSiteInstance(world, planetId, blueprintId, opts = {}) {
  const blueprint = getSiteBlueprint(blueprintId);
  if (!blueprint) return null;
  return {
    blueprint,
    site: instantiateSite(world, planetId, blueprint, opts),
    siteModifier: buildSiteModifier(world, planetId, blueprint, opts),
  };
}
