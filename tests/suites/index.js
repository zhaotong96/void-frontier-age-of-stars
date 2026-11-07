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
import { suite02 as playtest02, suite03 as playtest03, suite04 as playtest04, suite05 as playtest05, suite06 as playtest06, suite07 as playtest07 } from './playtest-gates.suite.js';

export function collectSuites() {
  return [
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
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
