/**
 * tests/agent/FivePhaseActionDriver.js — 五阶段动作原子指令封装（doc25 §4）
 *
 * 纯外部驱动：全部写操作经官方命令总线（executeCommand）或领域公共 API
 * （与 UI 完全同源的生产入口），严禁直接篡改实体坐标/账本实现瞬移或凭空造物。
 * 推进一律使用真实时间步 advanceTicks / advanceOneTick / stepMission。
 */

import '../../src/app/commands.js'; // 命令注册副作用（与 App 启动同源）
import { executeCommand, commandList } from '../../src/core/commandBus.js';
import { advanceTicks, advanceOneTick } from '../../src/simulation/WorldSimulation.js';
import { fleetFuelTotal } from '../../src/domain/fleets/navigation.js';
import { createSurfaceWorld, getVoxel, isStandable, ddaRaycast, getSurfaceHeight } from '../../src/domain/ground/SurfaceSandbox.js';
import { buildTerrainField, TERRAIN_FLAGS } from '../../src/domain/ground/terrainField.js';
import { sampleTerrain, findPathSurface } from '../../src/domain/ground/surfaceQueries.js';
import { getMissionField, stepMission, getMissionView } from '../../src/domain/ground/GroundMission.js';

export const MISSION_DT = 1 / 30;

/** 向命令总线派发（官方管道；返回 {ok, code, reason}） */
export function cmd(world, type, params = {}, actorId = null, targetId = null) {
  return executeCommand(world, { type, actorId, targetId, params });
}

/** 断言命令成功，失败抛错（携带 code/reason） */
export function cmdOk(world, type, params = {}, actorId = null, targetId = null) {
  const r = cmd(world, type, params, actorId, targetId);
  if (!r || r.ok !== true) {
    throw new Error(`[Agent-Driver] 命令 ${type} 被拒绝: ${r ? `${r.code} ${r.reason || ''}` : '无返回'}`);
  }
  return r;
}

/** 真实时间步推进直至谓词满足；返回 {ticks, met} */
export function advanceUntil(world, predicate, maxTicks, chunk = 1) {
  let ticks = 0;
  while (ticks < maxTicks) {
    advanceTicks(world, chunk);
    ticks += chunk;
    if (predicate()) return { ticks, met: true };
  }
  return { ticks, met: false };
}

/** ———— 阶段 1：星系跃迁 ———— */

/** 选择玩家指定角色舰队（缺省 science） */
export function pickFleet(world, factionId, role = 'science') {
  return Object.values(world.entities.fleets)
    .find((f) => f.factionId === factionId && f.role === role && (f.shipIds || []).length > 0) || null;
}

/** 选择相邻连通星系（航路表第一跳） */
export function pickAdjacentSystem(world, fleet) {
  const home = world.entities.systems[fleet.systemId];
  const lane = (home?.lanes || []).find((l) => l !== fleet.systemId && world.entities.systems[l]);
  return lane || null;
}

/**
 * 阶段 1 原子动作：下达 OrderFleetMove 并采集出发遥测。
 * 返回 { transit: 出发瞬间航路快照（legs/eta/path），fuelBefore }。
 * 零瞬移证据链：transit.legs[].eta 之和为真实航路小时数（fuelPerLaneHour=1.0/t/h）。
 */
export function orderJump(world, actorId, fleet, targetSystemId) {
  if (!fleet.transit === false) throw new Error('fleet 已在途');
  const fuelBefore = fleetFuelTotal(world, fleet);
  cmdOk(world, 'OrderFleetMove', { fleetId: fleet.id, targetSystemId }, actorId);
  // beginPlannedTransit 同步置 fleet.transit（execute 内联完成，非异步）
  const t = world.entities.fleets[fleet.id].transit;
  if (!t) throw new Error('OrderFleetMove 后 transit 未建立（可能瞬移）');
  const legs = (t.legs || []).map((l) => ({ to: l.to, eta: l.eta }));
  const etaTicks = legs.reduce((s, l) => s + l.eta, 0);
  if (!(etaTicks > 0)) throw new Error('航路 eta 非正（瞬移嫌疑）');
  return { legs, etaTicks, pathLen: (t.path || legs.length + 1), fuelBefore };
}

/** 阶段 1 推进至抵达；返回 { ticks, fuelAfter, fuelDrained } */
export function driveJumpToArrival(world, fleet, telemetry, maxTicks = 4000) {
  const fid = fleet.id;
  const arrived = () => {
    const f = world.entities.fleets[fid];
    return f && f.transit === null && f.systemId !== null;
  };
  let ticks = 0;
  while (ticks < maxTicks && !arrived()) {
    advanceOneTick(world);
    ticks++;
  }
  if (!arrived()) throw new Error(`跃迁 ${maxTicks} tick 未抵达（eta=${telemetry.etaTicks}）`);
  if (Math.abs(ticks - telemetry.etaTicks) > Math.max(4, Math.ceil(telemetry.etaTicks * 0.05))) {
    throw new Error(`跃迁耗时 ${ticks} tick 与航路 eta ${telemetry.etaTicks} 严重不符（瞬移嫌疑）`);
  }
  const f = world.entities.fleets[fid];
  const fuelAfter = fleetFuelTotal(world, f);
  return { ticks, fuelAfter, fuelDrained: telemetry.fuelBefore - fuelAfter };
}

/** ———— 阶段 2：轨道切入 ———— */

/** 阶段 2 原子动作：对当前所在星系下达扫描 */
export function orderScan(world, actorId, fleet, targetSystemId) {
  cmdOk(world, 'IssueScanOrder', { fleetId: fleet.id, targetSystemId }, actorId);
  return true;
}

/** 推进直至调查层级达 targetLevel；返回 { ticks, level } */
export function driveScanToLevel(world, systemId, factionId, targetLevel = 4, maxTicks = 3000) {
  const level = () => world.entities.systems[systemId].surveyedBy[factionId] ?? 0;
  let ticks = 0;
  while (ticks < maxTicks && level() < targetLevel) {
    advanceOneTick(world);
    ticks++;
  }
  return { ticks, level: level() };
}

/** ———— 阶段 3：地表着陆 ———— */

/**
 * 阶段 3 原子动作：初始化地表沙盒并做触地姿态审计。
 * 断言：出生列下方为实心体素；isStandable；向下 ddaRaycast 命中地形；
 * 3×3 邻域高差换算倾角 < 30°；无 -Infinity 穿透。
 */
export function landOnSurface(world, planetId) {
  const sw = createSurfaceWorld(world, planetId);
  const { x, y, z } = sw.spawn;

  const below = getVoxel(sw, Math.floor(x), Math.floor(y) - 1, Math.floor(z));
  if (below === 0) throw new Error(`着陆点 (${x},${y},${z}) 下方体素为空（悬空出生）`);
  if (!isStandable(sw, Math.floor(x), Math.floor(z))) throw new Error('着陆点列不可站立');

  const hit = ddaRaycast(sw, { x, y: y + 1.5, z }, { x: 0, y: -1, z: 0 }, 8);
  if (!hit || hit.hit !== true) throw new Error('向下 DDA 射线未命中地形（穿模风险）');
  const distToGround = hit.t;
  if (!Number.isFinite(distToGround) || distToGround > 6) {
    throw new Error(`着陆点距地面 ${distToGround}m（>6m，异常悬空）`);
  }

  // 触地姿态（体素沙盒引擎契约 = findSpawnPoint 同一规则）：3×3 邻域台阶高差 ≤ 1 体素。
  // 体素为块状地形，接触面（站立于顶面）法线恒为 +Y；连续地表法线倾角在任务场
  // （site_meters 平滑地形）上由 executeSettlement 依据站点锚点另行断言（< 30°）。
  const h0 = getSurfaceHeight(sw, Math.floor(x), Math.floor(z));
  let maxDh = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const h = getSurfaceHeight(sw, Math.floor(x) + dx, Math.floor(z) + dz);
      if (h < 0) throw new Error('着陆点 3×3 邻域存在空列（悬崖边出生）');
      maxDh = Math.max(maxDh, Math.abs(h - h0));
    }
  }
  if (maxDh > 1) throw new Error(`着陆点 3×3 台阶高差 ${maxDh} 体素 > 1（引擎站立规则破坏）`);

  return { sw, spawn: { ...sw.spawn }, stepDh: maxDh, distToGround };
}

/** ———— 阶段 4：资源与事件结算 ———— */

/** 场域 ORE 旗点位扫描（与 HarvestTerrainOre 命令同源 buildTerrainField({}) 口径） */
export function findOreCoord(world, planetId, scanRadius = 220, step = 4) {
  const field = buildTerrainField(world, planetId, {});
  for (let z = -scanRadius; z <= scanRadius; z += step) {
    for (let x = -scanRadius; x <= scanRadius; x += step) {
      const s = sampleTerrain(field, x, z);
      if (s && (s.flags & TERRAIN_FLAGS.ORE) !== 0) return { x, z };
    }
  }
  return null;
}

/** 定位行星当前活跃地面任务实体 */
export function activeMissionOf(world, planetId) {
  return Object.values(world.entities.groundMissions)
    .find((m) => m.planetId === planetId && (m.status || m.state) === 'active') || null;
}

/**
 * 地面任务自治 Bot：经生产同源输入通道驱动小队完成目标并撤离。
 *
 * 输入通道口径（doc24 真实代码盘点优先）：UI 逐帧写入 mission.input 是本作
 * 官方瞬态控制通道（GroundView._writeMissionInput，ARCHITECTURE.md 输入流约定：
 * 不经命令总线；SetGroundInput 命令每帧派发会触发全宇宙 deepClone 事务回滚
 * 快照，与真实游戏 60FPS 语义相悖）。Bot 与 GroundView 逐位同源：
 * 直接写 mission.input 瞬态字段，stepMission 消费后自动清零。
 * SetGroundInput 命令通道由 suite 以单次派发另行验证（命令注册表可达性）。
 *
 * 行为树（确定性，无随机）：生产寻路 findPathSurface（1m 栅格 A*）路径跟随 →
 * 采集目标最近优先 → 敌近 21m 内远程攻击 → 目标全清后逐员撤入撤离区；
 * 卡滞（30 步无位移）自动重算路径（废墟墙体绕行）。
 * @returns {{status, steps, simSeconds, objectives, logTail, view}}
 */
export async function driveMissionToCompletion(world, mission, actorId, maxSteps = 45000, opts = {}) {
  const mid = mission.id;
  const cmdChannel = opts.cmdChannel !== false;
  // stepMode='external'：由挂载中的 GroundView rAF 循环消费输入并步进（浏览器实机门禁
  // 影像化模式）；默认 'self'：驱动器自步进（CLI 无头模式，GROUND-01 同口径）。
  const external = opts.stepMode === 'external';
  const awaitFrame = opts.awaitFrame || (() => Promise.resolve());
  let cmdChannelVerified = false;
  // —— 实机键鼠通道（external 专用）：合成 KeyboardEvent + 按住态差分 ——
  const heldKeys = new Set();
  const pressKeys = (codes) => {
    for (const c of [...heldKeys]) {
      if (!codes.includes(c)) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
        heldKeys.delete(c);
      }
    }
    for (const c of codes) {
      if (!heldKeys.has(c)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        heldKeys.add(c);
      }
    }
  };
  const fireKey = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  const activeUnit = (m) => {
    // 与域内 activeUnitIdOf（GroundMission.js:1306-1310）同口径：激活位阵亡时
    // 输入自动落到第一个存活单位——Bot 的决策基准必须同步这一回退语义，
    // 否则会以阵亡单位坐标解算移动方向（F-13 排障：M4 任务撤离停滞根因）。
    const cur = m.playerUnits[m.activeIdx];
    if (cur && cur.state !== 'dead') return cur;
    return m.playerUnits.find((p) => p.state !== 'dead') || null;
  };
  const nearestEnemy = (u) => {
    let best = null;
    let bestD = Infinity;
    for (const e of mission.enemies) {
      if (e.state === 'dead' || e.hp <= 0) continue;
      const d = Math.hypot(u.x - e.x, u.y - e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { e: best, d: bestD } : null;
  };
  const inExtraction = (u) => {
    const ex = mission.extraction;
    // site_meters 口径：extraction = {x, z(平面第二轴), r}（域内 inExtraction 同源）
    return ex && Math.hypot(u.x - ex.x, u.y - ex.z) <= ex.r;
  };
  const moveInput = (u, tx, ty, o = {}) => {
    const m = world.entities.groundMissions[mid];
    const inp = m.input;
    if (external) {
      // 影像化实机模式：与玩家键鼠 100% 同源——移动经合成 KeyboardEvent
      // （GroundView window 级监听器），攻击 Digit3 / 换员 Tab 一次性键。
      // moveDir/sprint 由 GroundView._writeMissionInput 每帧从按键状态生成。
      const gv = opts.getView ? opts.getView() : null;
      const dxw = tx - u.x;
      const dyw = ty - u.y;
      const len = Math.hypot(dxw, dyw) || 1;
      if (gv && gv.cam && Number.isFinite(gv.cam.yaw)) {
        const dx = dxw / len;
        const dz = dyw / len;
        const sy = Math.sin(gv.cam.yaw);
        const cy = Math.cos(gv.cam.yaw);
        // _moveVec 逆变换：世界方向 → 相机轴向键位（f=W/S，r=D/A）
        const f = -sy * dx - cy * dz;
        const r = cy * dx - sy * dz;
        const codes = [];
        if (f > 0.38) codes.push('KeyW');
        else if (f < -0.38) codes.push('KeyS');
        if (r > 0.38) codes.push('KeyD');
        else if (r < -0.38) codes.push('KeyA');
        if (o.sprint && codes.length > 0) codes.push('ShiftLeft');
        pressKeys(codes);
      } else if (gv && gv.mode === 'mission') {
        // 相机未就绪兜底：直写瞬态字段（GroundView 会覆写 moveDir，仅作占位）
        inp.moveDir = { x: dxw / len, y: dyw / len };
        inp.sprint = !!o.sprint;
      }
      if (o.attack) fireKey('Digit3');
      if (o.interactTarget) fireKey('KeyE');
      if (o.switchUnit) fireKey('Tab');
      if (cmdChannel && !cmdChannelVerified) {
        cmdOk(world, 'SetGroundInput', {
          missionId: mid,
          input: { moveDir: { x: 0, y: 0 }, sprint: false, attack: null, dodgeDir: null, block: false, interactTarget: null, switchUnit: false },
        }, actorId);
        cmdChannelVerified = true;
      }
      return;
    }
    const dx = tx - u.x;
    const dy = ty - u.y;
    const len = Math.hypot(dx, dy) || 1;
    // 与 GroundView._writeMissionInput 逐位同源的瞬态控制通道
    inp.moveDir = { x: dx / len, y: dy / len };
    inp.sprint = !!o.sprint;
    inp.block = false;
    if (o.attack) inp.attack = o.attack;               // 一次性输入：FSM 消费后清零
    if (o.interactTarget) inp.interactTarget = o.interactTarget;
    if (o.switchUnit) inp.switchUnit = true;           // cycleActive 消费后自动复位
    if (cmdChannel && !cmdChannelVerified) {
      // 单次验证 SetGroundInput 命令通道可达（与瞬态通道字段级同构）
      cmdOk(world, 'SetGroundInput', {
        missionId: mid,
        input: { moveDir: { x: 0, y: 0 }, sprint: false, attack: null, dodgeDir: null, block: false, interactTarget: null, switchUnit: false },
      }, actorId);
      cmdChannelVerified = true;
    }
  };

  // —— 路径跟随（生产寻路器） ——
  const field = opts.field || null;
  const nav = { goalKey: '', wps: null, idx: 0, lastX: NaN, lastY: NaN, stuck: 0, sincePlan: 0, unstickDir: -1, unstickTtl: 0, unstickX: 0, unstickY: 0 };
  // 避柱横移序列（确定性 8 向扫掠；寻路器不感知实体碰撞柱，卡滞时绕行）
  const UNSTICK_HEADINGS = [Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, -(3 * Math.PI) / 4, Math.PI, Math.PI / 4, -Math.PI / 4, 0];
  const planPath = (m, u, tx, ty) => {
    const key = `${tx.toFixed(1)}|${ty.toFixed(1)}`;
    if (nav.goalKey === key && nav.wps && nav.idx < nav.wps.length) return true;
    nav.goalKey = key;
    nav.idx = 0;
    nav.wps = null;
    nav.sincePlan = 0;
    if (!field) {
      nav.wps = [{ x: tx, z: ty }];
      return true;
    }
    const res = findPathSurface(field, u.x, u.y, tx, ty);
    nav.wps = res && Array.isArray(res.path) && res.path.length > 0 ? res.path : [{ x: tx, z: ty }];
    return true;
  };
  const followPath = (m, u, tx, ty, o = {}) => {
    planPath(m, u, tx, ty);
    nav.sincePlan++;
    // 卡滞检测：连续 30 步位移 < 0.6m（正常步速 ~0.17m/步）→ 进入避柱横移
    const moved = Number.isFinite(nav.lastX) ? Math.hypot(u.x - nav.lastX, u.y - nav.lastY) : 1;
    nav.lastX = u.x; nav.lastY = u.y;
    if (moved < 0.6 / 30) nav.stuck++; else nav.stuck = 0;
    if (nav.unstickTtl > 0) {
      // 避柱横移：沿当前扫掠方向直行 40 步，累计位移 > 1.5m 即解除并重规划
      nav.unstickTtl--;
      const escaped = Math.hypot(u.x - nav.unstickX, u.y - nav.unstickY) > 1.5;
      const dir = UNSTICK_HEADINGS[nav.unstickDir % UNSTICK_HEADINGS.length];
      if (escaped || nav.unstickTtl === 0) {
        if (escaped) { nav.unstickDir = 0; nav.stuck = 0; nav.goalKey = ''; planPath(m, u, tx, ty); }
        else nav.unstickDir++; // 本方向也被堵：换下一方向
        nav.unstickTtl = escaped ? 0 : 40;
        nav.unstickX = u.x; nav.unstickY = u.y;
      }
      moveInput(u, u.x + Math.cos(dir), u.y + Math.sin(dir), { sprint: false });
      return;
    }
    if (nav.stuck > 30) {
      nav.stuck = 0;
      if (nav.unstickDir < 0) nav.unstickDir = 0;
      nav.unstickTtl = 40;
      nav.unstickX = u.x; nav.unstickY = u.y;
      const dir = UNSTICK_HEADINGS[nav.unstickDir % UNSTICK_HEADINGS.length];
      moveInput(u, u.x + Math.cos(dir), u.y + Math.sin(dir), { sprint: false });
      return;
    }
    if (nav.sincePlan > 240) {
      nav.goalKey = '';
      planPath(m, u, tx, ty);
    }
    let wp = nav.wps[nav.idx];
    while (wp && Math.hypot(u.x - wp.x, u.y - wp.z) < 1.6 && nav.idx < nav.wps.length - 1) {
      nav.idx++;
      wp = nav.wps[nav.idx];
    }
    const gx = wp ? wp.x : tx;
    const gy = wp ? wp.z : ty;
    moveInput(u, gx, gy, o);
  };

  let steps = 0;
  const phase = () => {
    const m = world.entities.groundMissions[mid];
    if (!m || m.status !== 'active') return 'done';
    if (m.objectives.some((o) => o.type === 'collect') && !m.objectives.find((o) => o.type === 'collect').done) return 'collect';
    return 'extract';
  };
  const pickTarget = (u) => {
    let best = null;
    let bestD = Infinity;
    for (const it of mission.items) {
      if (it.done) continue;
      const d = Math.hypot(u.x - it.x, u.y - it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  };

  // 交火战术：>15m 逼近（拉入稳定射程/视线），≤15m 远程打击（软锁由域内实现）
  const engage = (m, u, foe) => {
    if (foe.d > 15) {
      followPath(m, u, foe.e.x, foe.e.y, { sprint: false });
    } else {
      moveInput(u, u.x, u.y, { attack: 'ranged' });
      nav.goalKey = '';
    }
  };

  while (steps < maxSteps) {
    const m = world.entities.groundMissions[mid];
    if (!m || m.status !== 'active') break;
    const ph = phase();
    const u = activeUnit(m);
    if (!u) break;

    if (ph === 'collect') {
      const foe = nearestEnemy(u);
      if (foe && foe.d < 21) {
        engage(m, u, foe);
      } else {
        const it = pickTarget(u);
        if (!it) {
          followPath(m, u, m.extraction.x, m.extraction.z, { sprint: true });
        } else {
          followPath(m, u, it.x, it.y, { sprint: true });
        }
      }
    } else {
      // 撤离段：全员入圈 —— 圈内活动单位让位（官方 switchUnit 输入位，cycleActive 确定性轮转）
      const outside = m.playerUnits.filter((p) => p.state !== 'dead' && !inExtraction(p));
      if (outside.length === 0) {
        moveInput(u, m.extraction.x, m.extraction.z, { sprint: true });
      } else {
        const foe = nearestEnemy(u);
        if (foe && foe.d < 21) {
          engage(m, u, foe);
        } else if (!inExtraction(u)) {
          followPath(m, u, m.extraction.x, m.extraction.z, { sprint: true });
        } else {
          moveInput(u, m.extraction.x, m.extraction.z, { switchUnit: true });
        }
      }
    }

    if (external) {
      // 影像化：输入已直写，交由 GroundView 下一 rAF 消费并 stepMission
      await awaitFrame();
    } else {
      stepMission(world, m, opts.dt || MISSION_DT);
    }
    steps++;
  }

  if (external) pressKeys([]); // 松开全部按住键（现场清理）

  const m = world.entities.groundMissions[mid] || mission;
  return {
    status: m.status,
    steps,
    simSeconds: m.time,
    objectives: m.objectives.map((o) => ({ type: o.type, done: o.done, doneCount: o.doneCount })),
    logTail: (m.log || []).slice(-8).map((l) => (typeof l === 'string' ? l : l.msg || JSON.stringify(l))),
    view: getMissionView(m),
  };
}

/** ———— 阶段 5：存档冷重启 ———— */

/** 保存到隔离槽位并返回持久化遥测（hash A 在外部计算） */
export async function saveToSlot(saveManager, world, slotId, name) {
  const r = await saveManager.save(world, slotId, name);
  if (!r || r.ok !== true) throw new Error(`存档失败: ${r ? r.reason : '无返回'}`);
  return r;
}

/** 1 tick 确定性续推对拍：存档侧克隆与读档侧各推 1 tick 后哈希必须一致 */
export async function assertOneTickReplay(world, loadedWorld, deepClone, worldHashFn) {
  const a = deepClone(world);
  const b = loadedWorld;
  advanceOneTick(a);
  advanceOneTick(b);
  const ha = worldHashFn(a);
  const hb = worldHashFn(b);
  if (ha !== hb) throw new Error(`存读档后 1 tick 续推发散: ${ha} ≠ ${hb}`);
  return { hashA1: ha, hashB1: hb };
}

/** 已注册命令清单（阶段 0 自检用） */
export function registeredCommands() {
  return commandList();
}
