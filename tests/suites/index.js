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
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
