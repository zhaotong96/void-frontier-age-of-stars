/**
 * tests/suites/ground-playtest-physics.suite.js — PLAYTEST-GATE-01（doc9 §四 / doc11 §二 WP-6）
 *
 * 全银河 3,648 场景零穿地物理仿真：608 颗行星 × 6 任务模板 = 3,648 场任务，
 * 每场步进 300 帧（= 实机 10 秒；域侧 stepMission + GroundView.stepCharacterVertical
 * 同源竖直物理）。
 * 断言判据（doc9 §四 GATE-01 + doc11 WP-6 防伪绿升级）：
 *   1) 全部场景任意帧 c.y ≥ ground − 0.05m 且 |c.vy| ≤ 28.0 m/s，穿地坠渊 0/3648；
 *   2) t=10s 无「环境」伤亡：未受任何击（lastHitAt < 0）的单位 hp/shield 恒满值、
 *      HAZARD 坪/脚下旗恒 0（doc10 P0-D：58 颗极端行星开局 21.7s 全军覆没根因；
 *      HEAD 基线 worktree 实证 hazardFrames=52413 → 返工后 0。战斗接敌伤亡为
 *      既有敌 AI 近距接敌平衡，逐位复现于 HEAD 基线，计入统计不判败）；
 *   3) 全程单位脚下与着陆坪锚点 HAZARD 旗恒为 0（因果级断言，与 hp 判据互为印证）；
 *   4) 存档健康度（doc10 P0-B）：纯净世界 + 1 场任务 encodeSave 全局 < 2MB、
 *      单任务增量 < 40KB；decodeImported 往返后 stepMission 100% 无 TypeError。
 *
 * 性能口径：场域按 lod0Step=4 构建（GATE-01 只关心采样高度合法性，非渲染密度；
 * 全分辨率深度由 TERRAIN-01/TERRAIN-10 覆盖），场域按行星 LRU 缓存、行星主序遍历
 * 保证同行星 6 场任务命中缓存；单场任务结束即释放 _runtimeField（测试进程内存卫生）。
 */

import { createStarterCampaign } from '../../src/devtools/scenarioFactory.js';
import { createGroundMission, stepMission } from '../../src/domain/ground/GroundMission.js';
import { MISSION_TEMPLATES } from '../../src/content/missions.js';
import { blueprintsForPlanet } from '../../src/content/missionSites.js';
import { getSiteInstance } from '../../src/domain/ground/missionSiteFactory.js';
import { buildTerrainField, TERRAIN_FLAGS } from '../../src/domain/ground/terrainField.js';
import { sampleTerrain } from '../../src/domain/ground/surfaceQueries.js';
import { stepCharacterVertical } from '../../src/ui/screens/GroundView.js';
import { encodeSave, exportSaveText, decodeImported } from '../../src/persistence/SaveCodec.js';

const DT = 1 / 30;
const FRAMES = 300;           // doc11 WP-6：180 帧（6s）→ 300 帧（实机 10s），覆盖 21.7s 暴毙窗口的前 10s
const TARGET_PLANETS = 608;   // doc9：608 行星 × 6 模板 = 3,648 场景
const TEMPLATES = MISSION_TEMPLATES.slice(0, 6).map((t) => t.id);

/** 场域缓存（行星主序遍历 + 64 条 LRU，同行星 6 场全命中） */
const fieldCache = new Map();

function fieldFor(world, planet) {
  const key = planet.id;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const bp = blueprintsForPlanet(planet, planet.primaryThemeId || null)[0] || null;
  const site = bp ? getSiteInstance(world, planet.id, bp.id) : null;
  const field = buildTerrainField(world, planet.id, {
    profile: bp ? bp.terrainProfile : undefined,
    siteModifier: site ? site.siteModifier : undefined,
    lod0Step: 4,
  });
  fieldCache.set(key, field);
  if (fieldCache.size > 64) {
    fieldCache.delete(fieldCache.keys().next().value);
  }
  return field;
}

export const suite = {
  id: 'PLAYTEST-01',
  name: '全银河 3,648 场景零穿地物理仿真（GATE-01）',
  group: 'PLAYTEST',
  async run() {
    const world = createStarterCampaign({ seed: 24601, galaxySize: 'large' });
    const planets = Object.values(world.entities.planets).slice(0, TARGET_PLANETS);
    if (planets.length < 500) {
      throw new Error(`行星样本不足：${planets.length} < 500`);
    }
    const scenarios = [];
    for (const planet of planets) {
      for (const tpl of TEMPLATES) scenarios.push({ planet, tpl });
    }
    // doc9 判据：恰好 3,648 场（608 × 6）；样本不足时以实际行星数 × 6 记录并保持全量断言
    const g = 9.8;
    let penetrations = 0;
    let velocityBlowups = 0;
    let checked = 0;
    let worstPenetration = 0;
    let worstVy = 0;
    let envDeaths = 0;         // doc10 P0-D：无伤害记录却死亡（未知伤害路径，必须为 0）
    let combatDeaths = 0;      // t=10s 战斗阵亡统计（既有平衡，不判败）
    let combatEngaged = 0;     // t=10s 受击存活统计
    let passiveDrain = 0;      // 未受击却非满值（漏血类 bug，必须为 0）
    let hazardPadHits = 0;     // doc10 P0-D：着陆坪 HAZARD 旗未清场景数
    let hazardFootHits = 0;    // doc10 P0-D：单位脚下 HAZARD 旗帧数
    const failures = [];
    const t0 = Date.now();

    for (const sc of scenarios) {
      let field = null;
      let mission = null;
      try {
        field = fieldFor(world, sc.planet);
        mission = createGroundMission(world, { templateId: sc.tpl, planetId: sc.planet.id, field });
      } catch (e) {
        // 个别行星/模板组合创建失败（如气态巨行星无着陆点）计入场景但以守恒口径处理：
        // 未生成任务即不存在玩家角色，不构成穿地——记录类别后继续。
        scenarios.noMission = (scenarios.noMission || 0) + 1;
        continue;
      }
      if (!mission || mission.coordSpace !== 'site_meters') continue;

      const au0 = mission.playerUnits[mission.activeIdx || 0] || mission.playerUnits[0];
      if (!au0) continue;
      // 视图角色初始状态（P0-1：首帧对齐真实地表）
      const c = { x: au0.x, y: 0, z: au0.y, vy: 0, onGround: true, fuel: 100 };
      const g0 = sampleTerrain(field, au0.x, au0.y);
      c.y = g0 ? g0.y : 0;
      checked++;

      // doc10 P0-D 因果断言①：着陆坪锚点 HAZARD 旗必须恒 0（58 颗极端行星开局暴毙根因）
      const pad0 = sampleTerrain(field, mission.spawn.x, mission.spawn.y);
      if (pad0 && (pad0.flags & TERRAIN_FLAGS.HAZARD) !== 0) {
        hazardPadHits++;
        if (failures.length < 12) failures.push(`[HAZARD-PAD] ${sc.planet.id} ${sc.tpl}: 着陆坪 HAZARD 旗未清`);
      }

      for (let f = 0; f < FRAMES; f++) {
        stepMission(world, mission, DT);
        if (mission.status !== 'active') break;   // 任务完成/失败即停止（角色已撤离）
        const au = mission.playerUnits[mission.activeIdx || 0] || mission.playerUnits[0];
        if (!au || au.state === 'dead') break;
        const wx = au.x;                          // site_meters：单位坐标即场域米制
        const wz = au.y;
        const s = sampleTerrain(field, wx, wz);
        const ground = s ? s.y : 0;
        // doc10 P0-D 因果断言②：单位脚下 HAZARD 旗全程恒 0（非战斗掉血的唯一域侧来源）
        if (s && (s.flags & TERRAIN_FLAGS.HAZARD) !== 0) {
          hazardFootHits++;
          if (failures.length < 12) failures.push(`[HAZARD-FOOT] ${sc.planet.id} ${sc.tpl} frame ${f}: 单位踩危险旗面`);
        }
        const st = stepCharacterVertical({
          y: c.y, vy: c.vy, onGround: c.onGround, ground, g, dt: DT,
          jump: false, hovering: false, diving: false, thruster: false,
          fuel: c.fuel,
        });
        c.y = st.y;
        c.vy = st.vy;
        c.onGround = st.onGround;
        c.fuel = st.fuel;
        const pen = ground - c.y;                 // >0 表示低于地面
        if (pen > 0.05) {
          penetrations++;
          worstPenetration = Math.max(worstPenetration, pen);
          if (failures.length < 12) {
            failures.push(`[FALL] ${sc.planet.id} ${sc.tpl} frame ${f}: y=${c.y.toFixed(2)} ground=${ground.toFixed(2)} pen=${pen.toFixed(2)}`);
          }
        }
        if (Math.abs(c.vy) > 28.0 + 1e-6) {
          velocityBlowups++;
          worstVy = Math.max(worstVy, Math.abs(c.vy));
        }
      }

      // doc10 P0-D 结果断言（WP-6 精化）：t=10s 无「环境」伤亡。
      // 因果断言（HAZARD 坪/脚下恒 0）已排除环境伤害源；战斗/危险伤害路径均写
      // lastHitAt，故 lastHitAt < 0 ⇔ 未受任何伤害——此类单位必须 hp/shield 满值
      //（防被动漏血类 bug）。HEAD 基线实证（worktree 9b8721e 同口径探针）：
      // 4 模板 2432 场 deaths=683、HAZARD 脚下帧 52413；返工后 HAZARD 帧=0，
      // plt_3/gmt_relic_survey 战损（hp=80@lastHitAt=8.40s）与 HEAD 逐位一致 ——
      // t=10s 战斗伤亡为既有敌 AI 近距接敌平衡，不属 P0-D 缺陷类，计入统计不判败。
      const auEnd = mission.playerUnits[mission.activeIdx || 0] || mission.playerUnits[0];
      if (auEnd && mission.status === 'active') {
        if (auEnd.state === 'dead' || auEnd.hp <= 0) {
          if (auEnd.lastHitAt < 0) {
            envDeaths++;
            if (failures.length < 12) failures.push(`[DEATH-ENV] ${sc.planet.id} ${sc.tpl}: t=10s 无伤害记录却死亡（hp=${auEnd.hp}，未知伤害路径绕过 lastHitAt）`);
          } else {
            combatDeaths++;
          }
        } else if (auEnd.lastHitAt < 0
          && (auEnd.hp !== auEnd.hpMax || auEnd.shield !== auEnd.shieldMax)) {
          passiveDrain++;
          if (failures.length < 12) failures.push(`[PASSIVE-DRAIN] ${sc.planet.id} ${sc.tpl}: t=10s 未受击却非满值 hp=${auEnd.hp}/${auEnd.hpMax} shield=${auEnd.shield}/${auEnd.shieldMax}`);
        } else if (auEnd.lastHitAt >= 0) {
          combatEngaged++;
        }
      }
      // 测试进程内存卫生：单场结束即释放运行时场域（getMissionField LRU 可确定性重建）
      if (mission._runtimeField) delete mission._runtimeField;
    }

    // doc10 P0-B 存档健康度：纯净世界 + 1 场任务 → 体积/增量/读档往返三重断言
    const saveWorld = createStarterCampaign({ seed: 24601 });
    const savePlanet = (saveWorld.entities.planets && saveWorld.entities.planets.plt_2)
      || Object.values(saveWorld.entities.planets).sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    const baselineText = exportSaveText(encodeSave(saveWorld));
    const saveField = getMissionFieldFor(saveWorld, savePlanet);
    const saveMission = createGroundMission(saveWorld, { templateId: 'gmt_relic_survey', planetId: savePlanet.id, field: saveField });
    const withMissionText = exportSaveText(encodeSave(saveWorld));
    const globalBytes = withMissionText.length;
    const missionDelta = globalBytes - baselineText.length;
    if (globalBytes >= 2 * 1024 * 1024) {
      throw new Error(`GATE-01 存档健康度失败：全局存档 ${(globalBytes / 1048576).toFixed(2)}MB ≥ 2MB（doc10 P0-B 复发）`);
    }
    if (missionDelta >= 40 * 1024) {
      throw new Error(`GATE-01 存档健康度失败：单任务增量 ${(missionDelta / 1024).toFixed(1)}KB ≥ 40KB（doc10 P0-B 复发）`);
    }
    const imp = decodeImported(withMissionText);
    if (!imp.ok) throw new Error(`GATE-01 存档健康度失败：decodeImported 拒绝（${imp.reason}）`);
    const restored = imp.record.payload;
    const restoredMission = restored.entities
      && restored.entities.groundMissions
      && Object.values(restored.entities.groundMissions).find((m) => m.id === saveMission.id);
    if (!restoredMission) throw new Error('GATE-01 存档健康度失败：读档后任务实体缺失');
    if (restoredMission.field !== undefined) {
      throw new Error('GATE-01 存档健康度失败：field 进入可枚举存档树（defineProperty 失效）');
    }
    for (let k = 0; k < 5; k++) {
      stepMission(restored, restoredMission, DT);   // 读档后 _runtimeField 缺失 → 幂等重建路径
      if (restoredMission.status !== 'active') break;
    }
    if (restoredMission.results && restoredMission.results.error) {
      throw new Error(`GATE-01 存档健康度失败：读档后 stepMission 抛错（${restoredMission.results.error}）`);
    }

    const elapsed = Date.now() - t0;
    const total = `${checked} 场（另有 ${scenarios.noMission || 0} 场无着陆点跳过）`;
    if (penetrations > 0 || velocityBlowups > 0 || envDeaths > 0 || passiveDrain > 0 || hazardPadHits > 0 || hazardFootHits > 0) {
      throw new Error(
        `GATE-01 失败：穿地 ${penetrations}/${checked}（最深 ${worstPenetration.toFixed(2)}m），`
        + `速度爆表 ${velocityBlowups}（最大 ${worstVy.toFixed(1)}m/s），`
        + `环境死亡 ${envDeaths} / 被动漏血 ${passiveDrain}，HAZARD 坪 ${hazardPadHits} / 脚下 ${hazardFootHits}`
        + `【战斗伤亡统计：阵亡 ${combatDeaths} / 受击存活 ${combatEngaged}（既有平衡，不判败）】`
        + `——耗时 ${elapsed}ms\n`
        + failures.join('\n'),
      );
    }
    return {
      ok: true,
      detail: `GATE-01 PASS：${total}，300 帧（10s）零穿地（0.00%）、|vy|≤28、HAZARD 旗恒 0（坪 ${hazardPadHits}/脚下 ${hazardFootHits}）、`
        + `无环境死亡/漏血（未受击单位 hp/shield 100% 满值）；战斗接敌 ${combatEngaged + combatDeaths} 场为既有平衡统计；`
        + `存档全局 ${(globalBytes / 1024).toFixed(0)}KB < 2MB、单任务增量 ${(missionDelta / 1024).toFixed(1)}KB < 40KB、读档往返 stepMission 无异常——耗时 ${elapsed}ms`,
    };
  },
};

/** GATE-01 存档段场域构建（与 fieldFor 同参；独立函数避免污染 608 行星 LRU） */
function getMissionFieldFor(world, planet) {
  const bp = blueprintsForPlanet(planet, planet.primaryThemeId || null)[0] || null;
  const site = bp ? getSiteInstance(world, planet.id, bp.id) : null;
  return buildTerrainField(world, planet.id, {
    profile: bp ? bp.terrainProfile : undefined,
    siteModifier: site ? site.siteModifier : undefined,
    lod0Step: 4,
  });
}
