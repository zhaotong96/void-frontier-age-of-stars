/**
 * tests/suites/index.js — 套件收集器
 *
 * 每个 suite 文件导出 `export const suite = { id, name, group, async run() }`；
 * 例外：ai-stability.suite.js 含两个套件（AI-02 = suite，AI-03 = suiteWar，
 * 受「仅新建 8 个新套件文件」约束同文件双导出）。
 * collectSuites() 返回全部套件（按 id 升序）。
 */
import { suite as coreRng } from './core-rng.suite.js';
import { suite as coreSerialization } from './core-serialization.suite.js';
import { suite as coreMath } from './core-math.suite.js';
import { suite as coreClock } from './core-clock.suite.js';
import { suite as coreCommand } from './core-command.suite.js';
import { suite as coreScheduler } from './core-scheduler.suite.js';
import { suite as economyLedger } from './economy-ledger.suite.js';
import { suite as economyMarket } from './economy-market.suite.js';
import { suite as saveCodec } from './save-codec.suite.js';
import { suite as regressionGolden } from './regression-golden.suite.js';
import { suite as e2eCampaign } from './e2e-campaign.suite.js';
import { suite as crew } from './crew.suite.js';
import { suite as policy } from './policy.suite.js';
import { suite as worldGen } from './world-gen.suite.js';
import { suite as combatDamage } from './combat-damage.suite.js';
import { suite as combatHitmodel } from './combat-hitmodel.suite.js';
import { suite as shipFit } from './ship-fit.suite.js';
import { suite as shipBuild } from './ship-build.suite.js';
import { suite as fleetNav } from './fleet-nav.suite.js';
import { suite as diplomacyTreaty } from './diplomacy-treaty.suite.js';
import { suite as aiStability, suiteWar as aiWar } from './ai-stability.suite.js';
import { suite as saveRoundtrip } from './save-roundtrip.suite.js';
import { suite01 as ground01, suite02 as ground02, suite03 as ground03 } from './ground-mission.suite.js';
import { suite01 as terr01, suite02 as terr02, suite03 as terr03 } from './terrain-field.suite.js';
import { suite as obj01, suiteMin as obj02 } from './objectives-poi.suite.js';
import { suite as theme01 } from './theme-registry.suite.js';
import { suite as theme04 } from './theme-expansion.suite.js';
import { suite as world02 } from './celestial-bodies.suite.js';
import { suite as terrain06 } from './terrain-edits.suite.js';
import { suite as save04 } from './save-migration.suite.js';
import { suite100 as terrain10, suiteMount as terrain08 } from './planetary-terrain-theme.suite.js';
import { suite as playtest01 } from './ground-playtest-physics.suite.js';
import { suite02 as playtest02, suite03 as playtest03, suite04 as playtest04, suite05 as playtest05, suite06 as playtest06, suite07 as playtest07, suite08 as playtest08, suite09 as playtest09 } from './playtest-gates.suite.js';
import { suite as agentLoop, suiteTrace as agentTrace } from './gameplay-agent-loop.suite.js';
import { suiteStorm as fuzzStability, suiteReplay as fuzzReplay } from './fuzz-stability.suite.js';
import { suiteSoak as soakInspection, suiteLeak as soakLeak, suiteSweep as sweep1000 } from './soak-inspection.suite.js';
import { suite as e2eCampaignMilestones, suiteChronicle as e2eChronicle } from './e2e-campaign-milestones.suite.js';
// doc35 GATE-10..14：超长线内容五套验收门禁（SPEC-PLAN-035 §4）
import { suite as precursorDagLore } from './precursor-dag-lore.suite.js';
import { suite as combatTacticalV2 } from './combat-tactical-v2.suite.js';
import { suite as greyEconomySmuggle } from './grey-economy-smuggle.suite.js';
import { suite as megastructureElevator } from './megastructure-elevator.suite.js';
import { suite as endgameCrisisAscension } from './endgame-crisis-ascension.suite.js';
// SPEC-39 Phase S4 / SPEC-40 第二维：Gate 15 地表深度六门禁（SURF-01..05；SURF-06 归 CDP）
import { suite01 as surf01, suite02 as surf02, suite03 as surf03, suite04 as surf04, suite05 as surf05 } from './playtest-gate15-surface.suite.js';
// doc43 GATE-15-P0：太空歌剧 Phase 0 基建契约门禁（SPACE-OPERA-00）
import { suite as spaceOperaFoundation } from './space-opera-foundation-contract.suite.js';
// doc44 GATE-15-M1：太空歌剧 M1 局势弧线引擎与紧凑行星底座门禁（SPACE-OPERA-M1）
import { suite as spaceOperaM1 } from './m1-situation-planet-core.suite.js';
// doc45 GATE-16-M2：太空歌剧 M2 雅可比耦合/稀疏前沿CA/16天体原型门禁（SPACE-OPERA-M2）
import { suite as spaceOperaM2 } from './m2-jacobian-archetypes-ca.suite.js';
// doc46 GATE-17-M3：太空歌剧 M3 反孤独生态/S7天灾/自适应戏剧导演门禁（SPACE-OPERA-M3）
import { suite as spaceOperaM3 } from './m3-space-opera-drama-director.suite.js';
// doc48 GATE-18-M4：太空歌剧 M4 活体合龙/双轨经济桥/六大视图/28命令端到端门禁（SPACE-OPERA-M4）
import { suite as spaceOperaM4 } from './m4-space-opera-live-bridge-ui.suite.js';

export function collectSuites() {
  return [
    precursorDagLore,
    combatTacticalV2,
    greyEconomySmuggle,
    megastructureElevator,
    endgameCrisisAscension,
    surf01,
    surf02,
    surf03,
    surf04,
    surf05,
    spaceOperaFoundation,
    spaceOperaM1,
    spaceOperaM2,
    spaceOperaM3,
    spaceOperaM4,
    coreRng,
    coreSerialization,
    coreMath,
    coreClock,
    coreCommand,
    coreScheduler,
    economyLedger,
    economyMarket,
    saveCodec,
  regressionGolden,
  e2eCampaign,
  crew,
  policy,
    worldGen,
    combatDamage,
    combatHitmodel,
    shipFit,
    shipBuild,
    fleetNav,
    diplomacyTreaty,
    aiStability,
    aiWar,
    saveRoundtrip,
    ground01,
    ground02,
    ground03,
    terr01,
    terr02,
    terr03,
    obj01,
    obj02,
    theme01,
    theme04,
    world02,
    terrain06,
    save04,
    terrain10,
    terrain08,
    playtest01,
    playtest02,
    playtest03,
    playtest04,
    playtest05,
    playtest06,
    playtest07,
    playtest08,
    playtest09,
    // —— doc24 全生命周期扩展卷（docs 25-28 顺序施工套件，随各卷竣工逐卷挂载）——
    agentLoop,
    agentTrace,
    fuzzStability,
    fuzzReplay,
    soakInspection,
    soakLeak,
    sweep1000,
    e2eCampaignMilestones,
    e2eChronicle,
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
