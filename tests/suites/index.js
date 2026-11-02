/**
 * tests/suites/index.js — 套件收集器
 *
 * 每个 suite 文件导出 `export const suite = { id, name, group, async run() }`；
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
import { suite as worldGen } from './world-gen.suite.js';

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
    worldGen,
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
