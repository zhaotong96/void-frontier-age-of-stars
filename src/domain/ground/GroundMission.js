/**
 * domain/ground/GroundMission.js — 行星地面行动（任务书 5.7 / GROUND-01..03）
 *
 * 固定步长 dt = 1/30s（与战术战斗一致）。任务实体是纯数据（Plain Data），
 * 挂在 world.entities.groundMissions 上，全部状态可 JSON 序列化。
 *
 * 验收条目对照：
 *  - GROUND-01 确定性：地图生成使用独立 RNG 状态（不消耗世界主 RNG），
 *    运行期不引入任何随机数；同 seed + 同输入流 → 逐帧状态完全一致。
 *  - GROUND-02 boss 三阶段单向推进：hp 阈值只触发升阶，绝不回退、绝不重复
 *    召唤/狂暴。
 *  - GROUND-03 结算幂等：finishMission / abortMission 以 rewardPaid 为结算锁，
 *    重复调用不会重复发奖、计经验或发事件。
 *
 * 地图 tile 编码：0 地板 / 1 墙 / 2 掩体 / 3 门 / 5 撤离区 / 6 危险区
 * （4 保留，不用）。坐标为像素，每格 TS=24px；格坐标 = floor(px / TS)。
 */

import { createEntity } from '../entities/registry.js';
import { emit } from '../../core/eventBus.js';
import { credit, FLOW } from '../economy/ledger.js';
import { clamp, dist, angleDelta } from '../../core/math.js';
import { int, intRange, float, chance, pick, shuffle } from '../../core/rng.js';
import { findMissionTemplate } from '../../content/missions.js';

// ———— 常量 ————

const DT_DEFAULT = 1 / 30;
const TS = 24;                       // 每格像素边长

const T_FLOOR = 0, T_WALL = 1, T_COVER = 2, T_DOOR = 3, T_EXTRACT = 5, T_HAZARD = 6;

/** tile 值 → 是否可通行（索引即 tile 值；4 保留为不可通行） */
const WALKABLE = [true, false, true, true, false, true, true];

/** 供渲染层引用的 tile 语义 */
export const GROUND_TILES = { FLOOR: 0, WALL: 1, COVER: 2, DOOR: 3, EXTRACT: 5, HAZARD: 6 };

/** 单位总量上限（玩家 + 敌人 + NPC < 40） */
const UNIT_CAP = 40;

// 玩家动作参数
const DODGE = { invuln: 0.18, move: 0.35, recover: 0.4, cd: 1.2, cost: 25, mult: 2.6 };
const BLOCK = { window: 0.25, perfect: 0.1, cost: 15, reduction: 0.15 };
const PLAYER_ATTACKS = {
  light:  { windup: 0.28, recover: 0.2 },              // 快斩：0.28s 前摇 → 0.2s 后摇
  heavy:  { windup: 0.5,  recover: 0.25, dmgMult: 2 }, // 重击：0.5s 前摇，双倍伤害
  ranged: { windup: 0.2,  recover: 0.3 },              // 射击：需射程 + 视线
};
const MELEE_REACH = 44;        // 近战触及（约 1.8 格）
const MELEE_ARC = Math.PI / 4; // 90° 扇形半角
const LIGHT_POISE = 15;        // 轻击韧性伤害
const HEAVY_POISE = 30;        // 重击韧性伤害
const RANGED_POISE = 8;        // 射击韧性伤害
const HURT_S = 0.25;           // 受击硬直
const STAMINA_REGEN = 12;      // 耐力回复 /s（block/dodge/sprint 期间不回）
const SPRINT_MULT = 1.35;      // 冲刺速度倍率
const SPRINT_DRAIN = 10;       // 冲刺耗耐 /s
const SHIELD_DELAY = 3;        // 护盾回充延迟（未受击秒数）
const SHIELD_REGEN = 5;        // 护盾回充 /s
const HAZARD_DPS = 6;          // 危险区伤害 /s
const COVER_MULT = 0.5;        // 掩体挡线：远程伤害减半
const INTERACT_R = 52;         // 交互引导距离（约 2 格）
const DETONATE_S = 3;          // 目标物交互引爆所需引导秒数

// 敌人行为参数
const ENEMY_TYPES = {
  grunt:  { hp: 45,  dmg: 8,  attackR: 150, windupS: 0.5, speed: 70, aggroR: 220, poiseMax: 30 },
  heavy:  { hp: 110, dmg: 16, attackR: 120, windupS: 0.9, speed: 45, aggroR: 220, poiseMax: 60 },
  turret: { hp: 60,  dmg: 10, attackR: 260, windupS: 0.7, speed: 0,  aggroR: 260, poiseMax: 50 },
  boss:   { hp: 900, dmg: 24, attackR: 150, windupS: 0.6, speed: 60, aggroR: 260, poiseMax: 200, phases: 3 },
};
const ALERT_S = 0.4;           // 警觉蓄势时长
const RECOVER_S = 0.5;         // 攻击后摇
const ATTACK_BEAT = 0.12;      // 攻击判定拍的展示时长
const STAGGER_S = 1.2;         // 失衡（硬直）时长
const POISE_REGEN = 8;         // 韧性回复 /s
const PATROL_PAUSE = 1.2;      // 巡更点停留
const PATROL_SPEED_MULT = 0.55;// 巡逻移速系数

// NPC / 目标物参数
const RESCUE_CONTACT = 40;     // 救援接触半径
const RESCUE_TIME = 2;         // 每名人员接应所需接触秒数
const FOLLOW_DIST = 34;        // NPC 跟随保持距离
const NPC_SPEED = 80;          // NPC 移速
const PICKUP_R = 26;           // 拾取半径
const TARGET_HP = 120;         // destroy 目标物结构值

// ———— 基础工具 ————

/** 任务内确定性自增 id（不占用世界 seq，保持任务状态自包含） */
function nid(mission, prefix) {
  mission.idSeq = (mission.idSeq || 0) + 1;
  return `${prefix}_${mission.idSeq}`;
}

/** 任务日志（有界，view 取最近 30 条） */
function mlog(mission, text) {
  mission.log.push({ t: Math.round(mission.time * 100) / 100, text });
  if (mission.log.length > 80) mission.log.splice(0, mission.log.length - 80);
}

/** 像素坐标 → tile 值（越界按墙处理） */
function tileAtPx(mission, x, y) {
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  if (tx < 0 || ty < 0 || tx >= mission.w || ty >= mission.h) return T_WALL;
  return mission.grid[ty * mission.w + tx];
}

function walkableAt(mission, x, y) {
  return WALKABLE[tileAtPx(mission, x, y)];
}

function pxOf(tx, ty) {
  return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
}

function tileIndexOf(mission, px) {
  return Math.floor(px.y / TS) * mission.w + Math.floor(px.x / TS);
}

/** 是否处于撤离区矩形内 */
function inExtraction(mission, x, y) {
  const r = mission.extractionRect;
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/**
 * 视线检测：沿连线采样。墙/门阻断视线；掩体不阻断但记为“受掩体遮蔽”
 * （远程伤害 ×0.5）。返回 { clear, cover }。
 */
function lineOfSight(mission, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / (TS * 0.4)));
  let cover = false;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tile = tileAtPx(mission, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    if (tile === T_WALL || tile === T_DOOR) return { clear: false, cover };
    if (tile === T_COVER) cover = true;
  }
  return { clear: true, cover };
}

/** 轴分离碰撞移动：先 x 后 y，撞墙滑行 */
function moveWithCollision(mission, u, nx, ny, speed, dt) {
  const step = speed * dt;
  if (!(step > 0)) return;
  if (walkableAt(mission, u.x + nx * step, u.y)) u.x += nx * step;
  if (walkableAt(mission, u.x, u.y + ny * step)) u.y += ny * step;
  u.x = clamp(u.x, TS, mission.w * TS - TS);
  u.y = clamp(u.y, TS, mission.h * TS - TS);
}

function alivePlayers(mission) {
  return mission.playerUnits.filter((u) => u.state !== 'dead');
}

function nearestAlivePlayer(mission, x, y) {
  let best = null, bestD = Infinity;
  for (const p of mission.playerUnits) {
    if (p.state === 'dead') continue;
    const d = dist(x, y, p.x, p.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function nearestEnemyWithin(mission, u, radius) {
  let best = null, bestD = Infinity;
  for (const e of mission.enemies) {
    if (e.state === 'dead') continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d <= radius && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/** 当前接受输入的存活单位（激活位死亡时自动落到第一个存活单位） */
function activeUnitIdOf(mission) {
  const cur = mission.playerUnits[mission.activeIdx];
  if (cur && cur.state !== 'dead') return cur.unitId;
  const alive = alivePlayers(mission);
  return alive.length ? alive[0].unitId : null;
}

/** switchUnit：轮换到下一个存活单位 */
function cycleActive(mission) {
  const n = mission.playerUnits.length;
  for (let k = 1; k <= n; k++) {
    const idx = (mission.activeIdx + k) % n;
    if (mission.playerUnits[idx].state !== 'dead') { mission.activeIdx = idx; return; }
  }
}

/** boss 速度/前摇的阶段修正（阶段 3 狂暴） */
function enemySpeed(e) {
  return e.speed * (e.type === 'boss' && e.phase >= 3 ? 1.4 : 1);
}
function enemyWindup(e) {
  return e.windupS * (e.type === 'boss' && e.phase >= 3 ? 0.7 : 1);
}

// ———— 地图生成（GROUND-01：确定性 BSP + 走廊 + 连通验证） ————

/**
 * 生成一张地面任务地图。
 * @param rng   4 元素 uint32 状态数组（原地推进；调用方持有，与世界主 RNG 独立）
 * @param w,h   格数
 * @returns { grid: number[], w, h, spawn, extraction, extractionRect }
 *   grid 为普通数组（可 JSON 序列化）；BFS 内部使用 TypedArray。
 */
export function genMap(rng, w, h) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const map = tryGenMap(rng, w, h);
    if (map) return map;
  }
  // 兜底（理论上不可达）：全开放地板 + 远角撤离区，保证函数总有合法返回
  const grid = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { grid[x] = T_WALL; grid[(h - 1) * w + x] = T_WALL; }
  for (let y = 0; y < h; y++) { grid[y * w] = T_WALL; grid[y * w + w - 1] = T_WALL; }
  const ex = { x: w - 3, y: h - 3 };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grid[(ex.y + dy) * w + (ex.x + dx)] = T_EXTRACT;
  return {
    grid: Array.from(grid), w, h,
    spawn: pxOf(2, 2), extraction: pxOf(ex.x, ex.y),
    extractionRect: { x0: (ex.x - 1) * TS, y0: (ex.y - 1) * TS, x1: (ex.x + 2) * TS, y1: (ex.y + 2) * TS },
  };
}

/** 单次尝试：失败（连通性不足 / 可行走面积过低）返回 null，由外层重掷 */
function tryGenMap(rng, w, h) {
  const grid = new Uint8Array(w * h).fill(T_WALL);
  const rooms = [];

  // —— 递归二分（BSP）划分房间，3-4 层 ——
  const carveRoom = (x0, y0, x1, y1) => {
    const ix0 = x0 + int(rng, 2), ix1 = x1 - int(rng, 2);
    const iy0 = y0 + int(rng, 2), iy1 = y1 - int(rng, 2);
    if (ix1 - ix0 < 2 || iy1 - iy0 < 2) return false;
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) grid[y * w + x] = T_FLOOR;
    rooms.push({ x0: ix0, y0: iy0, x1: ix1, y1: iy1, cx: Math.floor((ix0 + ix1) / 2), cy: Math.floor((iy0 + iy1) / 2) });
    return true;
  };
  const bspSplit = (x0, y0, x1, y1, depth) => {
    const MIN = 6;
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const canX = rw >= MIN * 2, canY = rh >= MIN * 2;
    if (depth <= 0 || (!canX && !canY)) { carveRoom(x0, y0, x1, y1); return; }
    let horizontal;
    if (!canX) horizontal = true;
    else if (!canY) horizontal = false;
    else horizontal = rh > rw ? true : rw > rh ? false : chance(rng, 0.5);
    if (horizontal) {
      const cut = intRange(rng, y0 + MIN - 1, y1 - MIN); // 分隔墙所在行
      bspSplit(x0, y0, x1, cut - 1, depth - 1);
      bspSplit(x0, cut + 1, x1, y1, depth - 1);
    } else {
      const cut = intRange(rng, x0 + MIN - 1, x1 - MIN);
      bspSplit(x0, y0, cut - 1, y1, depth - 1);
      bspSplit(cut + 1, y0, x1, y1, depth - 1);
    }
  };
  bspSplit(1, 1, w - 2, h - 2, intRange(rng, 3, 4));
  if (rooms.length < 3) return null;

  // —— 走廊：链式串联全部房间 + 少量环路（结构性保证连通） ——
  const carveCorridor = (a, b) => {
    let x = a.cx, y = a.cy;
    const stepX = (tx) => { while (x !== tx) { x += Math.sign(tx - x); if (grid[y * w + x] === T_WALL) grid[y * w + x] = T_FLOOR; } };
    const stepY = (ty) => { while (y !== ty) { y += Math.sign(ty - y); if (grid[y * w + x] === T_WALL) grid[y * w + x] = T_FLOOR; } };
    if (chance(rng, 0.5)) { stepX(b.cx); stepY(b.cy); } else { stepY(b.cy); stepX(b.cx); }
  };
  for (let i = 1; i < rooms.length; i++) carveCorridor(rooms[i - 1], rooms[i]);
  const loops = Math.floor(rooms.length / 4);
  for (let k = 0; k < loops; k++) {
    const a = int(rng, rooms.length), b = int(rng, rooms.length);
    if (a !== b) carveCorridor(rooms[a], rooms[b]);
  }

  // —— 门：两侧皆为通行格的墙即是门口 ——
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (grid[i] !== T_WALL) continue;
    const l = grid[i - 1], r = grid[i + 1], u = grid[i - w], d = grid[i + w];
    if ((l !== T_WALL && r !== T_WALL) || (u !== T_WALL && d !== T_WALL)) grid[i] = T_DOOR;
  }

  // —— 掩体散布（房间内部，避开边圈） ——
  for (const r of rooms) {
    for (let y = r.y0 + 1; y <= r.y1 - 1; y++) for (let x = r.x0 + 1; x <= r.x1 - 1; x++) {
      const i = y * w + x;
      if (grid[i] === T_FLOOR && chance(rng, 0.07)) grid[i] = T_COVER;
    }
  }

  // —— 危险区补丁（避开出生房间中心） ——
  const spawnRoom = rooms[0];
  const hazardPatches = intRange(rng, 2, 4);
  for (let k = 0; k < hazardPatches; k++) {
    const r = pick(rng, rooms);
    const cx = intRange(rng, r.x0, r.x1), cy = intRange(rng, r.y0, r.y1);
    if (Math.abs(cx - spawnRoom.cx) <= 2 && Math.abs(cy - spawnRoom.cy) <= 2) continue;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i = y * w + x;
      if (grid[i] === T_FLOOR) grid[i] = T_HAZARD;
    }
  }

  // —— 出生点（首个房间中心）与撤离区（距出生点最远的房间中心 3×3） ——
  let far = rooms[0], fd = -1;
  for (const r of rooms) {
    const d = (r.cx - spawnRoom.cx) ** 2 + (r.cy - spawnRoom.cy) ** 2;
    if (d > fd) { fd = d; far = r; }
  }
  if (far === spawnRoom) far = rooms[rooms.length - 1];
  let exTiles = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = far.cx + dx, y = far.cy + dy;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    const i = y * w + x;
    if (grid[i] !== T_WALL) { grid[i] = T_EXTRACT; exTiles++; }
  }
  if (exTiles === 0) return null;
  if (grid[spawnRoom.cy * w + spawnRoom.cx] === T_WALL) return null;

  // —— 连通验证：出生点 → 撤离区（BFS，TypedArray） ——
  if (!bfsConnected(grid, w, h, spawnRoom.cx, spawnRoom.cy, T_EXTRACT)) return null;

  // —— 可行走面积下限（过碎的图重掷） ——
  let walkCount = 0;
  for (let i = 0; i < grid.length; i++) if (WALKABLE[grid[i]]) walkCount++;
  if (walkCount < w * h * 0.28) return null;

  return {
    grid: Array.from(grid), w, h,
    spawn: pxOf(spawnRoom.cx, spawnRoom.cy),
    extraction: pxOf(far.cx, far.cy),
    extractionRect: { x0: (far.cx - 1) * TS, y0: (far.cy - 1) * TS, x1: (far.cx + 2) * TS, y1: (far.cy + 2) * TS },
  };
}

/** BFS 连通验证（visited/queue 均为 TypedArray，逐格展开四邻） */
function bfsConnected(grid, w, h, sx, sy, targetTile) {
  const start = sy * w + sx;
  if (!WALKABLE[grid[start]]) return false;
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  visited[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    if (grid[cur] === targetTile) return true;
    const cx = cur % w, cy = (cur / w) | 0;
    if (cx > 0 && !visited[cur - 1] && WALKABLE[grid[cur - 1]]) { visited[cur - 1] = 1; queue[tail++] = cur - 1; }
    if (cx < w - 1 && !visited[cur + 1] && WALKABLE[grid[cur + 1]]) { visited[cur + 1] = 1; queue[tail++] = cur + 1; }
    if (cy > 0 && !visited[cur - w] && WALKABLE[grid[cur - w]]) { visited[cur - w] = 1; queue[tail++] = cur - w; }
    if (cy < h - 1 && !visited[cur + w] && WALKABLE[grid[cur + w]]) { visited[cur + w] = 1; queue[tail++] = cur + w; }
  }
  return false;
}

// ———— 创建任务 ————

/**
 * 创建地面任务实体。
 * @param world 世界
 * @param opts  { templateId, planetId?, squadCharacterIds: [1..3 个已存在角色 id] }
 */
export function createGroundMission(world, opts = {}) {
  const { templateId, planetId = null, squadCharacterIds = [] } = opts;
  const template = findMissionTemplate(templateId);
  if (!template) throw new Error(`ground: 未知任务模板 ${templateId}`);
  const ids = (squadCharacterIds || []).slice(0, 3);
  if (!ids.length) throw new Error('ground: 小队至少需要 1 名角色');
  for (const cid of ids) {
    if (!world.entities.characters || !world.entities.characters[cid]) {
      throw new Error(`ground: 角色不存在 ${cid}`);
    }
  }

  // GROUND-01：独立地图 RNG——由世界种子与当前序号派生，不消耗世界主 RNG；
  // 同一 world.seed + world.seq 快照下，地图与单位布局完全一致。
  const rngState = [(world.seed ^ 0x9e3779b9) >>> 0, world.seq >>> 0, 0xdeadbeef, 1];
  const map = genMap(rngState, template.mapSize[0], template.mapSize[1]);

  const mission = createEntity(world, 'groundMissions', {
    templateId,
    planetId,
    kind: template.kind,
    riskLevel: template.riskLevel,
    storyTag: template.storyTag || null,
    status: 'active',
    time: 0,
    timeLimitSeconds: template.timeLimitSeconds || 0,
    failReason: null,

    w: map.w,
    h: map.h,
    grid: map.grid,
    spawn: map.spawn,
    extraction: map.extraction,
    extractionRect: map.extractionRect,
    rngState,

    playerUnits: [],
    activeIdx: 0,
    enemies: [],
    npcs: [],
    targets: [],
    items: [],
    objectives: template.objectives.map((o) => ({
      type: o.type, count: o.count || 0, seconds: o.seconds || 0,
      done: false, progress: 0, doneCount: 0,
    })),

    input: { moveDir: { x: 0, y: 0 }, sprint: false, attack: null, dodgeDir: null, block: false, interactTarget: null, switchUnit: false },
    blockLatch: false,
    idSeq: 0,
    log: [],
    results: null,
    rewardPaid: false,
    stats: { kills: 0 },
  });

  // —— 玩家小队（出生点附近就位，1-3 人） ——
  const offsets = [[0, 0], [-14, 10], [14, 10]];
  ids.forEach((cid, i) => {
    const [ox, oy] = offsets[i % offsets.length];
    const p = nudgeToWalkable(mission, { x: map.spawn.x + ox, y: map.spawn.y + oy });
    mission.playerUnits.push({
      unitId: nid(mission, 'gp'),
      characterId: cid,
      x: p.x, y: p.y,
      hp: 100, hpMax: 100,
      shield: 30, shieldMax: 30,
      stamina: 100, staminaMax: 100,
      facing: -Math.PI / 2,
      state: 'idle', stateTime: 0,
      invulnUntil: 0,
      cooldowns: { attack: 0, dodge: 0 },
      speed: 110, meleeDmg: 22, rangedDmg: 14, range: 190,
      controlled: true,
      // 动作机内部字段（全部可序列化）
      attackKind: null, struck: false, dodgeVx: 0, dodgeVy: 0, lastHitAt: -999,
    });
  });
  mission.activeIdx = 0;

  populateMission(rngState, mission, template);
  mlog(mission, `地面行动开始：${template.nameZh}（风险等级 ${template.riskLevel}）`);
  return mission;
}

/** 将出生位置吸附到最近的可通行格中心（固定顺序扫描，确定性） */
function nudgeToWalkable(mission, px) {
  if (walkableAt(mission, px.x, px.y)) return px;
  const tx = Math.floor(px.x / TS), ty = Math.floor(px.y / TS);
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 1 || ny < 1 || nx >= mission.w - 1 || ny >= mission.h - 1) continue;
      if (WALKABLE[mission.grid[ny * mission.w + nx]]) return pxOf(nx, ny);
    }
  }
  return px;
}

/**
 * 布置目标物 / NPC / 拾取物 / 敌人。
 * 敌人数量 = 可行走格数 × enemyDensity / 15（受 UNIT_CAP 约束），
 * 敌人出生点与出生点保持 aggroR 之外，避免开局即接敌。
 */
function populateMission(rng, mission, template) {
  const { w, h, grid } = mission;
  const tiles = [];
  for (let i = 0; i < w * h; i++) {
    const t = grid[i];
    if (WALKABLE[t] && t !== T_HAZARD && t !== T_EXTRACT) tiles.push(i);
  }
  const spawnIdx = tileIndexOf(mission, mission.spawn);
  const occupancy = new Set([spawnIdx]);
  const sx = spawnIdx % w, sy = (spawnIdx / w) | 0;
  const farEnough = (i, minTiles) => {
    const x = i % w, y = (i / w) | 0;
    return Math.hypot(x - sx, y - sy) >= minTiles;
  };
  // 距离约束逐步放宽的确定性放置（4 档，每档递减 2 格）
  const placeTile = (minTiles) => {
    for (let k = 0; k < 4; k++) {
      const min = Math.max(2, minTiles - k * 2);
      const cands = [];
      for (const i of tiles) if (!occupancy.has(i) && farEnough(i, min)) cands.push(i);
      if (cands.length) {
        const i = pick(rng, cands);
        occupancy.add(i);
        return i;
      }
    }
    return -1;
  };
  const px = (i) => pxOf(i % w, (i / w) | 0);

  // —— destroy 目标物 ——
  const destroyCount = mission.objectives
    .filter((o) => o.type === 'destroy')
    .reduce((s, o) => s + o.count, 0);
  for (let k = 0; k < destroyCount; k++) {
    const i = placeTile(9);
    if (i < 0) break;
    const p = px(i);
    mission.targets.push({
      targetId: nid(mission, 'gt'),
      x: p.x, y: p.y,
      hp: TARGET_HP, hpMax: TARGET_HP,
      progress: 0, done: false,
    });
  }

  // —— NPC：救援对象 / 工程队 ——
  const rescueCount = (mission.objectives.find((o) => o.type === 'rescue') || {}).count || 0;
  for (let k = 0; k < rescueCount; k++) {
    const i = placeTile(7);
    if (i < 0) break;
    const p = px(i);
    mission.npcs.push({ npcId: nid(mission, 'gn'), kind: 'rescuee', x: p.x, y: p.y, state: 'wait', progress: 0, done: false });
  }
  if (mission.objectives.some((o) => o.type === 'escort')) {
    const i = placeTile(9);
    if (i >= 0) {
      const p = px(i);
      mission.npcs.push({ npcId: nid(mission, 'gn'), kind: 'engineer', x: p.x, y: p.y, state: 'follow', progress: 0, done: false });
    }
  }

  // —— collect 拾取物 ——
  const collectCount = (mission.objectives.find((o) => o.type === 'collect') || {}).count || 0;
  for (let k = 0; k < collectCount; k++) {
    const i = placeTile(5);
    if (i < 0) break;
    const p = px(i);
    mission.items.push({ itemId: nid(mission, 'gi'), x: p.x, y: p.y, done: false });
  }

  // —— 敌人 ——
  const cap = Math.max(0, UNIT_CAP - 1 - mission.playerUnits.length - mission.npcs.length);
  let n = Math.min(cap, Math.max(2, Math.round(tiles.length * template.enemyDensity / 15)));
  const wantBoss = template.enemyTypes.includes('boss') && mission.objectives.some((o) => o.type === 'boss');
  const pool = shuffle(rng, template.enemyTypes.filter((t) => t !== 'boss').slice());
  if (!pool.length) pool.push('grunt');
  if (wantBoss) {
    const i = placeTile(12);
    if (i >= 0) mission.enemies.push(makeEnemy('boss', px(i), { facing: float(rng) * Math.PI * 2 }));
    n = Math.max(0, n - 1);
  }
  for (let k = 0; k < n; k++) {
    const type = pool[k % pool.length];
    const minDist = Math.ceil((ENEMY_TYPES[type].aggroR + 40) / TS);
    const i = placeTile(minDist);
    if (i < 0) continue;
    const p = px(i);
    // 巡更点：本格 + 附近 ≤6 格内的 1-2 个点（turret 不移动，只有原点）
    const patrol = [{ x: p.x, y: p.y }];
    if (ENEMY_TYPES[type].speed > 0) {
      const hx = i % w, hy = (i / w) | 0;
      const near = [];
      for (const j of tiles) {
        if (occupancy.has(j)) continue;
        const x = j % w, y = (j / w) | 0;
        if (Math.hypot(x - hx, y - hy) <= 6) near.push(j);
      }
      shuffle(rng, near);
      for (let q = 0; q < 2 && q < near.length; q++) {
        const pp = px(near[q]);
        patrol.push({ x: pp.x, y: pp.y });
        occupancy.add(near[q]);
      }
    }
    mission.enemies.push(makeEnemy(type, p, {
      facing: float(rng) * Math.PI * 2,
      patrolTargets: patrol,
    }));
  }
}

function makeEnemy(type, p, opts = {}) {
  const def = ENEMY_TYPES[type];
  return {
    unitId: opts.unitId || null, // 由调用方补齐（nid）
    type,
    x: p.x, y: p.y,
    hp: def.hp, hpMax: def.hp,
    state: opts.state || 'patrol',
    stateTime: 0,
    struck: false,
    facing: opts.facing ?? 0,
    homeX: p.x, homeY: p.y,
    aggroR: def.aggroR,
    attackR: def.attackR,
    windupS: def.windupS,
    dmg: def.dmg,
    speed: def.speed,
    poise: 0, poiseMax: def.poiseMax,
    patrolTargets: opts.patrolTargets || [{ x: p.x, y: p.y }],
    patrolIdx: 0,
    waitT: 0,
    targetUnitId: null,
    lastHitAt: -999,
    phase: type === 'boss' ? 1 : 0, // GROUND-02：阶段计数，只升不降
  };
}

// ———— 步进 ————

/**
 * 推进任务一步（dt = 1/30）。
 * 输入约定：mission.input 由 UI 每帧写入；本函数在步末消费并清零
 * attack / dodgeDir / interactTarget / switchUnit（block 为持续按住语义，
 * 以上升沿触发，不清零）。
 */
export function stepMission(world, mission, dt = DT_DEFAULT) {
  if (!mission || mission.status !== 'active') return mission;
  mission.time += dt;
  const input = mission.input;

  if (input.switchUnit) { input.switchUnit = false; cycleActive(mission); }

  updatePlayers(mission, dt);
  updateEnemies(mission, dt);
  updateNpcs(mission, dt);
  updateObjectives(mission, dt);
  updateVitals(mission, dt);

  // —— 结束判定 ——
  const alive = alivePlayers(mission);
  if (alive.length === 0) {
    finishMission(world, mission, 'failed', 'squads_lost');
    return mission;
  }
  if (mission.timeLimitSeconds > 0 && mission.time >= mission.timeLimitSeconds) {
    finishMission(world, mission, 'failed', 'timeout');
    return mission;
  }
  // 全员入撤离区 → 结算（目标未完成则按失败撤离处理）
  if (mission.time >= 1 && alive.every((u) => inExtraction(mission, u.x, u.y))) {
    const done = mission.objectives.length > 0 && mission.objectives.every((o) => o.done);
    finishMission(world, mission, done ? 'success' : 'failed', done ? 'extracted' : 'extracted_incomplete');
    return mission;
  }

  // —— 消费一次性输入 ——
  input.attack = null;
  input.dodgeDir = null;
  input.interactTarget = null;
  return mission;
}

// ———— 玩家小队 ————

function updatePlayers(mission, dt) {
  const input = mission.input;
  if (!input.block) mission.blockLatch = false; // 松开格挡键复位上升沿锁
  const activeId = activeUnitIdOf(mission);

  for (const u of mission.playerUnits) {
    if (u.state === 'dead') continue;
    u.stateTime += dt;
    u.cooldowns.attack = Math.max(0, u.cooldowns.attack - dt);
    u.cooldowns.dodge = Math.max(0, u.cooldowns.dodge - dt);
    const isActive = u.unitId === activeId;
    let sprinting = false;

    switch (u.state) {
      case 'dodge': {
        // 0.35s 位移（前 0.18s 无敌）+ 0.4s 恢复；期间不接新指令、不回耐力
        if (u.stateTime <= DODGE.move) {
          moveWithCollision(mission, u, u.dodgeVx, u.dodgeVy, u.speed * DODGE.mult, dt);
        }
        if (u.stateTime >= DODGE.move + DODGE.recover) { u.state = 'idle'; u.stateTime = 0; }
        break;
      }
      case 'attack': {
        const a = PLAYER_ATTACKS[u.attackKind] || PLAYER_ATTACKS.light;
        if (!u.struck && u.stateTime >= a.windup) {
          u.struck = true;
          playerStrike(mission, u);
        }
        if (u.stateTime >= a.windup + a.recover) { u.state = 'idle'; u.stateTime = 0; u.attackKind = null; }
        break;
      }
      case 'block': {
        // 0.25s 判定窗；窗内受击：≤0.1s 完美格挡（敌手失衡），否则减伤 ×0.15
        if (u.stateTime >= BLOCK.window) { u.state = 'idle'; u.stateTime = 0; }
        break;
      }
      case 'hurt': {
        if (u.stateTime >= HURT_S) { u.state = 'idle'; u.stateTime = 0; }
        break;
      }
      default: { // idle / move
        if (isActive) {
          // 格挡（上升沿触发，按住不重复；耗耐 15）
          if (input.block && !mission.blockLatch) {
            mission.blockLatch = true;
            if (u.stamina >= BLOCK.cost) {
              u.stamina -= BLOCK.cost;
              u.state = 'block'; u.stateTime = 0;
              break;
            }
          }
          // 闪避优先于攻击（耗耐 25，1.2s 冷却）
          if (input.dodgeDir && u.cooldowns.dodge <= 0 && u.stamina >= DODGE.cost) {
            startDodge(mission, u, input.dodgeDir);
            break;
          }
          // 攻击
          if (input.attack && u.cooldowns.attack <= 0) {
            startAttack(mission, u, input.attack);
            break;
          }
          // 移动（冲刺 ×1.35，耗耐 10/s）
          const md = input.moveDir;
          const ml = Math.hypot(md.x, md.y);
          if (ml > 0.01) {
            const nx = md.x / ml, ny = md.y / ml;
            sprinting = !!input.sprint && u.stamina > 0;
            if (sprinting) u.stamina = Math.max(0, u.stamina - SPRINT_DRAIN * dt);
            moveWithCollision(mission, u, nx, ny, u.speed * (sprinting ? SPRINT_MULT : 1), dt);
            u.facing = Math.atan2(ny, nx);
            u.state = 'move';
          } else {
            u.state = 'idle';
          }
        }
        // 耐力回复（block/dodge 状态不进入本分支；冲刺移动时不回）
        if (!sprinting) u.stamina = Math.min(u.staminaMax, u.stamina + STAMINA_REGEN * dt);
        break;
      }
    }
  }
}

function startDodge(mission, u, dir) {
  let dx = dir ? dir.x : 0, dy = dir ? dir.y : 0;
  let l = Math.hypot(dx, dy);
  if (l < 0.01) { dx = -Math.cos(u.facing); dy = -Math.sin(u.facing); l = Math.hypot(dx, dy) || 1; }
  u.dodgeVx = dx / l;
  u.dodgeVy = dy / l;
  u.state = 'dodge';
  u.stateTime = 0;
  u.invulnUntil = mission.time + DODGE.invuln;
  u.cooldowns.dodge = DODGE.cd;
  u.stamina -= DODGE.cost;
}

function startAttack(mission, u, kind) {
  const k = kind === 'heavy' || kind === 'ranged' ? kind : 'light';
  u.attackKind = k;
  u.struck = false;
  u.state = 'attack';
  u.stateTime = 0;
  const a = PLAYER_ATTACKS[k];
  u.cooldowns.attack = a.windup + a.recover;
  // 软锁定：起手时面向 90px 内最近敌人
  if (k !== 'ranged') {
    const e = nearestEnemyWithin(mission, u, 90);
    if (e) u.facing = Math.atan2(e.y - u.y, e.x - u.x);
  }
}

/** 攻击判定拍：近战 90° 扇形（含目标物），远程需射程内 + 视线无墙 */
function playerStrike(mission, u) {
  const k = u.attackKind;
  if (k === 'ranged') {
    let best = null, bestD = Infinity, bestCover = false;
    for (const e of mission.enemies) {
      if (e.state === 'dead') continue;
      const d = dist(u.x, u.y, e.x, e.y);
      if (d >= u.range || d >= bestD) continue;
      const los = lineOfSight(mission, u.x, u.y, e.x, e.y);
      if (!los.clear) continue;
      best = e; bestD = d; bestCover = los.cover;
    }
    if (best) {
      damageEnemy(mission, best, u.rangedDmg * (bestCover ? COVER_MULT : 1), RANGED_POISE);
      return;
    }
    // 没有可射敌人：尝试射击目标物
    for (const t of mission.targets) {
      if (t.done) continue;
      const d = dist(u.x, u.y, t.x, t.y);
      if (d >= u.range) continue;
      const los = lineOfSight(mission, u.x, u.y, t.x, t.y);
      if (!los.clear) continue;
      damageTarget(mission, t, u.rangedDmg * (los.cover ? COVER_MULT : 1));
      return;
    }
    return; // 空放
  }
  // 近战
  const dmg = k === 'heavy' ? u.meleeDmg * PLAYER_ATTACKS.heavy.dmgMult : u.meleeDmg;
  const poise = k === 'heavy' ? HEAVY_POISE : LIGHT_POISE;
  const reach = k === 'heavy' ? MELEE_REACH + 6 : MELEE_REACH;
  for (const e of mission.enemies) {
    if (e.state === 'dead') continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > reach) continue;
    if (Math.abs(angleDelta(u.facing, Math.atan2(e.y - u.y, e.x - u.x))) > MELEE_ARC) continue;
    damageEnemy(mission, e, dmg, poise);
  }
  for (const t of mission.targets) {
    if (t.done) continue;
    const d = dist(u.x, u.y, t.x, t.y);
    if (d > reach + 10) continue;
    if (Math.abs(angleDelta(u.facing, Math.atan2(t.y - u.y, t.x - u.x))) > MELEE_ARC) continue;
    damageTarget(mission, t, dmg);
  }
}

// ———— 敌人 ————

function updateEnemies(mission, dt) {
  for (const e of mission.enemies) {
    if (e.state === 'dead') continue;
    e.stateTime += dt;
    e.poise = Math.max(0, e.poise - POISE_REGEN * dt);
    bossPhaseCheck(mission, e);

    switch (e.state) {
      case 'stagger': {
        if (e.stateTime >= STAGGER_S) { e.state = 'alert'; e.stateTime = 0; }
        break;
      }
      case 'windup': {
        // 前摇中持续咬住目标方向（turret 转塔）
        const tgt = windupTarget(mission, e);
        if (tgt) e.facing = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        if (e.stateTime >= enemyWindup(e)) {
          e.state = 'attack';
          e.stateTime = 0;
          e.struck = false;
        }
        break;
      }
      case 'attack': {
        // 攻击判定拍：90° 扇形 + 距离判定，随即进后摇
        if (!e.struck) { e.struck = true; enemyStrike(mission, e); }
        if (e.stateTime >= ATTACK_BEAT) { e.state = 'recover'; e.stateTime = 0; }
        break;
      }
      case 'recover': {
        if (e.stateTime >= RECOVER_S) { e.state = 'alert'; e.stateTime = 0; }
        break;
      }
      case 'alert': {
        const tgt = nearestAlivePlayer(mission, e.x, e.y);
        if (!tgt) { e.state = 'patrol'; e.stateTime = 0; break; }
        e.facing = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        const d = dist(e.x, e.y, tgt.x, tgt.y);
        if (d <= e.attackR) {
          // 警觉 0.4s 后进入前摇
          if (e.stateTime >= ALERT_S) {
            e.state = 'windup'; e.stateTime = 0;
            e.targetUnitId = tgt.unitId;
          }
        } else if (e.speed > 0 && d <= e.aggroR * 1.8) {
          // 追击（直线 + 撞墙滑行）
          moveWithCollision(mission, e, (tgt.x - e.x) / (d || 1), (tgt.y - e.y) / (d || 1), enemySpeed(e), dt);
        } else {
          // 丢失接触：回巡逻
          e.state = 'patrol'; e.stateTime = 0;
        }
        break;
      }
      case 'patrol':
      default: {
        const tgt = nearestAlivePlayer(mission, e.x, e.y);
        if (tgt) {
          const d = dist(e.x, e.y, tgt.x, tgt.y);
          if (d <= e.aggroR && lineOfSight(mission, e.x, e.y, tgt.x, tgt.y).clear) {
            e.state = 'alert'; e.stateTime = 0;
            e.targetUnitId = tgt.unitId;
            break;
          }
        }
        if (e.speed > 0 && e.patrolTargets.length > 1) {
          const p = e.patrolTargets[e.patrolIdx];
          const d = dist(e.x, e.y, p.x, p.y);
          if (d < 10) {
            e.waitT += dt;
            if (e.waitT >= PATROL_PAUSE) {
              e.waitT = 0;
              e.patrolIdx = (e.patrolIdx + 1) % e.patrolTargets.length;
            }
          } else {
            moveWithCollision(mission, e, (p.x - e.x) / (d || 1), (p.y - e.y) / (d || 1), e.speed * PATROL_SPEED_MULT, dt);
          }
        }
        break;
      }
    }
  }
}

function windupTarget(mission, e) {
  return mission.playerUnits.find((p) => p.unitId === e.targetUnitId && p.state !== 'dead')
    || nearestAlivePlayer(mission, e.x, e.y);
}

/** 攻击判定：90° 扇形（±45°）+ 攻击距离；turret 需视线且受掩体衰减 */
function enemyStrike(mission, e) {
  const tgt = windupTarget(mission, e);
  if (!tgt) return;
  e.facing = Math.atan2(tgt.y - e.y, tgt.x - e.x);
  for (const p of mission.playerUnits) {
    if (p.state === 'dead') continue;
    const d = dist(e.x, e.y, p.x, p.y);
    if (d > e.attackR) continue;
    if (Math.abs(angleDelta(e.facing, Math.atan2(p.y - e.y, p.x - e.x))) > MELEE_ARC) continue;
    let dmg = e.dmg;
    if (e.type === 'turret') {
      const los = lineOfSight(mission, e.x, e.y, p.x, p.y);
      if (!los.clear) continue;      // 目标缩到墙后：脱靶
      if (los.cover) dmg *= COVER_MULT; // 掩体挡线 ×0.5
    }
    damagePlayer(mission, p, dmg, e);
  }
}

/**
 * 玩家受伤：闪避无敌 → 格挡判定（≤0.1s 完美格挡令敌手失衡 1.2s；
 * 窗内其余时间减伤 ×0.15）→ 护盾先扣 → 结构。
 */
function damagePlayer(mission, u, amount, srcEnemy) {
  if (u.state === 'dead') return;
  if (u.invulnUntil > mission.time) return;
  if (u.state === 'block') {
    if (u.stateTime <= BLOCK.perfect) {
      if (srcEnemy && srcEnemy.state !== 'dead') {
        staggerEnemy(srcEnemy);
        mlog(mission, `${u.unitId} 完美格挡，敌手失衡`);
      }
      return;
    }
    if (u.stateTime <= BLOCK.window) amount *= BLOCK.reduction;
  }
  u.lastHitAt = mission.time;
  let dmg = amount;
  if (u.shield > 0) {
    const a = Math.min(u.shield, dmg);
    u.shield -= a;
    dmg -= a;
  }
  if (dmg > 0) {
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0;
      u.state = 'dead'; u.stateTime = 0;
      mlog(mission, `${u.unitId} 阵亡`);
    } else if (u.state !== 'dodge') {
      u.state = 'hurt'; u.stateTime = 0;
    }
  }
}

function damageEnemy(mission, e, amount, poiseDmg) {
  if (e.state === 'dead') return;
  e.hp -= amount;
  e.poise += poiseDmg;
  e.lastHitAt = mission.time;
  if (e.poise >= e.poiseMax) staggerEnemy(e);
  if (e.hp <= 0) {
    e.hp = 0;
    e.state = 'dead'; e.stateTime = 0;
    mission.stats.kills++;
    mlog(mission, `击毁敌军单位（${e.type}）`);
  }
}

function staggerEnemy(e) {
  if (e.state === 'dead') return;
  e.state = 'stagger';
  e.stateTime = 0;
  e.poise = 0;
}

/**
 * GROUND-02：boss 三阶段单向推进。
 * 阶段 1 → 2（hp ≤ 2/3：召唤 2 名护卫）→ 3（hp ≤ 1/3：狂暴，速度 ×1.4、
 * 前摇 ×0.7）。阶段只升不降，召唤与狂暴各至多触发一次。
 */
function bossPhaseCheck(mission, e) {
  if (e.type !== 'boss' || e.state === 'dead') return;
  if (e.phase === 1 && e.hp <= e.hpMax * (2 / 3)) {
    e.phase = 2;
    mlog(mission, '深渊体进入第二阶段，召唤护卫');
    summonAdds(mission, e, 2);
  }
  if (e.phase === 2 && e.hp <= e.hpMax / 3) {
    e.phase = 3;
    mlog(mission, '深渊体进入终末阶段：狂暴');
  }
}

/** boss 召唤护卫：boss 周身逐环扫描可通行格，受 UNIT_CAP 约束（确定性顺序） */
function summonAdds(mission, e, count) {
  const baseX = Math.floor(e.x / TS), baseY = Math.floor(e.y / TS);
  let spawned = 0;
  for (let r = 1; r <= 3 && spawned < count; r++) {
    for (let dy = -r; dy <= r && spawned < count; dy++) {
      for (let dx = -r; dx <= r && spawned < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = baseX + dx, ty = baseY + dy;
        if (tx < 1 || ty < 1 || tx >= mission.w - 1 || ty >= mission.h - 1) continue;
        const i = ty * mission.w + tx;
        if (!WALKABLE[mission.grid[i]] || mission.grid[i] === T_HAZARD) continue;
        const px = pxOf(tx, ty);
        if (mission.enemies.some((o) => o.state !== 'dead' && dist(o.x, o.y, px.x, px.y) < 12)) continue;
        if (mission.playerUnits.length + mission.enemies.length + mission.npcs.length >= UNIT_CAP) continue;
        const add = makeEnemy('grunt', px, { state: 'alert' });
        add.unitId = nid(mission, 'ge');
        mission.enemies.push(add);
        spawned++;
      }
    }
  }
}

// ———— NPC / 目标 / 拾取 ————

function updateNpcs(mission, dt) {
  for (const n of mission.npcs) {
    if (n.state === 'safe') continue;
    const p = nearestAlivePlayer(mission, n.x, n.y);

    // 救援：接触 2s 接应成功（中断缓慢回落）
    if (n.kind === 'rescuee' && !n.done) {
      if (p && dist(n.x, n.y, p.x, p.y) < RESCUE_CONTACT) {
        n.progress += dt;
        if (n.progress >= RESCUE_TIME) {
          n.done = true;
          n.state = 'follow';
          mlog(mission, '失踪人员已接应，随队撤离');
        }
      } else {
        n.progress = Math.max(0, n.progress - dt * 0.5);
      }
    }

    // 跟随：工程队全程跟随；失踪人员接应后跟随
    if (n.done || n.kind === 'engineer') {
      if (p) {
        const d = dist(n.x, n.y, p.x, p.y);
        if (d > FOLLOW_DIST) {
          moveWithCollision(mission, n, (p.x - n.x) / (d || 1), (p.y - n.y) / (d || 1), NPC_SPEED, dt);
          n.state = 'follow';
        }
      }
      if (inExtraction(mission, n.x, n.y)) {
        if (n.kind === 'engineer' && !n.done) {
          n.done = true;
          mlog(mission, '工程队抵达撤离区');
        } else if (n.kind === 'rescuee' && n.done) {
          n.state = 'safe';
        }
      }
    }
  }
}

function damageTarget(mission, t, amount) {
  if (t.done) return;
  t.hp -= amount;
  if (t.hp <= 0) {
    t.hp = 0;
    t.done = true;
    mlog(mission, '目标物被摧毁');
  }
}

function updateObjectives(mission, dt) {
  const alive = alivePlayers(mission);

  // —— collect：接触拾取 ——
  for (const it of mission.items) {
    if (it.done) continue;
    for (const p of alive) {
      if (dist(p.x, p.y, it.x, it.y) < PICKUP_R) {
        it.done = true;
        mlog(mission, '回收数据核心');
        break;
      }
    }
  }

  // —— destroy：交互引导 3s 引爆（打断则缓慢回落） ——
  const interactId = mission.input.interactTarget;
  const actor = alive.find((u) => u.unitId === activeUnitIdOf(mission));
  for (const t of mission.targets) {
    if (t.done) continue;
    const channeling = interactId && t.targetId === interactId && actor
      && actor.state !== 'dodge' && actor.state !== 'attack' && actor.state !== 'hurt'
      && dist(actor.x, actor.y, t.x, t.y) < INTERACT_R;
    if (channeling) {
      t.progress += dt;
      if (t.progress >= DETONATE_S) {
        t.hp = 0;
        t.done = true;
        mlog(mission, '装药引爆，目标物清除');
      }
    } else {
      t.progress = Math.max(0, t.progress - dt * 1.5);
    }
  }

  // —— 目标清单状态 ——
  for (const o of mission.objectives) {
    switch (o.type) {
      case 'destroy':
        o.doneCount = mission.targets.filter((t) => t.done).length;
        o.done = o.doneCount >= o.count;
        break;
      case 'rescue':
        o.doneCount = mission.npcs.filter((n) => n.kind === 'rescuee' && n.done).length;
        o.done = o.doneCount >= o.count;
        break;
      case 'collect':
        o.doneCount = mission.items.filter((i) => i.done).length;
        o.done = o.doneCount >= o.count;
        break;
      case 'escort': {
        const n = mission.npcs.find((x) => x.kind === 'engineer');
        o.done = !!n && n.done;
        o.progress = o.done ? 1 : 0;
        break;
      }
      case 'survive':
        if (!o.done) {
          o.progress += dt;
          if (o.progress >= o.seconds) o.done = true;
        }
        break;
      case 'boss':
        o.done = mission.enemies.some((e) => e.type === 'boss' && e.state === 'dead');
        break;
      case 'reach':
        o.done = alive.length > 0 && alive.every((p) => inExtraction(mission, p.x, p.y));
        break;
    }
  }
}

/** 危险区伤害 + 玩家护盾回充（3s 未受击 5/s） */
function updateVitals(mission, dt) {
  for (const u of mission.playerUnits) {
    if (u.state === 'dead') continue;
    if (tileAtPx(mission, u.x, u.y) === T_HAZARD) applyRawDamage(mission, u, HAZARD_DPS * dt);
    if (mission.time - u.lastHitAt >= SHIELD_DELAY) {
      u.shield = Math.min(u.shieldMax, u.shield + SHIELD_REGEN * dt);
    }
  }
  for (const e of mission.enemies) {
    if (e.state === 'dead') continue;
    if (tileAtPx(mission, e.x, e.y) === T_HAZARD) {
      e.hp -= HAZARD_DPS * dt;
      e.lastHitAt = mission.time;
      if (e.hp <= 0) {
        e.hp = 0;
        e.state = 'dead'; e.stateTime = 0;
        mission.stats.kills++;
      }
    }
  }
}

/** 环境伤害：无视闪避/格挡，护盾先扣 */
function applyRawDamage(mission, u, amount) {
  if (u.state === 'dead') return;
  u.lastHitAt = mission.time;
  let dmg = amount;
  if (u.shield > 0) {
    const a = Math.min(u.shield, dmg);
    u.shield -= a;
    dmg -= a;
  }
  if (dmg > 0) {
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0;
      u.state = 'dead'; u.stateTime = 0;
      mlog(mission, `${u.unitId} 阵亡`);
    }
  }
}

// ———— 结算（GROUND-03：幂等） ————

/**
 * 结算任务。重复调用直接返回既有 results，不重复发奖 / 计经验 / 发事件。
 * @param outcome 'success' | 'failed'
 * @param reason  结束原因（squads_lost / timeout / extracted / extracted_incomplete 等）
 */
export function finishMission(world, mission, outcome = 'success', reason = null) {
  if (mission.rewardPaid || mission.status !== 'active') return mission.results;
  if (outcome !== 'success' && outcome !== 'failed') throw new Error(`ground: 非法结算结果 ${outcome}`);
  mission.rewardPaid = true; // 结算锁（GROUND-03）

  const results = {
    outcome,
    rewardsPaid: [],
    casualties: mission.playerUnits.filter((u) => u.state === 'dead').length,
    objectivesDone: mission.objectives.map((o) => ({ type: o.type, done: o.done })),
    timeSeconds: Math.round(mission.time * 100) / 100,
    xpGained: [],
    reason: reason || null,
  };

  if (outcome === 'success') {
    const template = findMissionTemplate(mission.templateId);
    for (const r of (template && template.rewards) || []) {
      credit(world, world.playerFactionId, r.resId, r.amount, 'groundMission', mission.id, FLOW.LOOT);
      results.rewardsPaid.push({ resId: r.resId, amount: r.amount });
    }
    // 存活角色 +30 经验
    for (const u of mission.playerUnits) {
      if (u.state === 'dead' || !u.characterId) continue;
      const ch = world.entities.characters ? world.entities.characters[u.characterId] : null;
      if (ch) {
        ch.xp = (ch.xp || 0) + 30;
        results.xpGained.push({ characterId: u.characterId, xp: 30 });
      }
    }
    // 叙事标记
    if (mission.storyTag && world.narrative && world.narrative.flags) {
      world.narrative.flags[mission.storyTag] = true;
    }
  }

  mission.results = results;
  mission.status = outcome === 'success' ? 'success' : 'failed';
  mission.failReason = results.reason;
  mlog(mission, outcome === 'success' ? '行动完成，小队撤离成功' : `行动失败（${results.reason || 'unknown'}）`);
  emit(world, 'GroundMissionEnded', {
    missionId: mission.id,
    templateId: mission.templateId,
    planetId: mission.planetId,
    outcome,
    results,
  }, 'combat');
  return results;
}

/** 中止任务（幂等；无奖励、无经验，同样锁定结算） */
export function abortMission(world, mission) {
  if (!mission || mission.status !== 'active') return mission ? mission.results : null;
  mission.rewardPaid = true; // 结算锁（GROUND-03）
  mission.status = 'aborted';
  mission.failReason = 'aborted';
  mission.results = {
    outcome: 'aborted',
    rewardsPaid: [],
    casualties: mission.playerUnits.filter((u) => u.state === 'dead').length,
    objectivesDone: mission.objectives.map((o) => ({ type: o.type, done: o.done })),
    timeSeconds: Math.round(mission.time * 100) / 100,
    xpGained: [],
    reason: 'aborted',
  };
  mlog(mission, '行动中止，小队回收');
  emit(world, 'GroundMissionEnded', {
    missionId: mission.id,
    templateId: mission.templateId,
    planetId: mission.planetId,
    outcome: 'aborted',
    results: mission.results,
  }, 'combat');
  return mission.results;
}

// ———— 渲染层只读快照 ————

/**
 * 返回渲染用只读快照：网格、单位、目标状态、输入、最近 30 条日志与结算结果。
 * grid 为共享数组引用（大数组按约定只读）；单位与目标为浅拷贝。
 */
export function getMissionView(mission) {
  if (!mission) return null;
  return {
    id: mission.id,
    templateId: mission.templateId,
    kind: mission.kind,
    state: mission.status,
    time: Math.round(mission.time * 100) / 100,
    timeLimitSeconds: mission.timeLimitSeconds,
    w: mission.w,
    h: mission.h,
    grid: mission.grid,
    playerUnits: mission.playerUnits.map((u) => ({ ...u, cooldowns: { ...u.cooldowns } })),
    enemies: mission.enemies.map((e) => ({ ...e })),
    npcs: mission.npcs.map((n) => ({ ...n })),
    targets: mission.targets.map((t) => ({ ...t })),
    items: mission.items.map((i) => ({ ...i })),
    objectives: mission.objectives.map((o) => ({ ...o })),
    activeUnitId: activeUnitIdOf(mission),
    input: { ...mission.input, moveDir: { ...mission.input.moveDir } },
    extraction: mission.extraction,
    stats: { ...mission.stats },
    log: mission.log.slice(-30),
    results: mission.results ? { ...mission.results } : null,
  };
}
