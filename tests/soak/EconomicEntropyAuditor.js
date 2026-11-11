/**
 * tests/soak/EconomicEntropyAuditor.js — 宏观经济收敛性与熵增审计（doc27 §2.2）
 *
 * 价格带（doc24 SIM-LONG 口径，引擎钳制 BAL.economy.priceMinFactor=0.35 /
 * priceMaxFactor=3.2）：∀t P(item,t) ∈ [0.35×base, 3.2×base]。
 * 全银河能量守恒（ECON-01 账本等式）：期末 = 期初 + Σ带符号流量（误差 0）。
 * 流量取源：world.economy.transactions 原始账（record() 每笔带 tick/派系/资源/
 * 带符号 delta/流水类别）——按 tick 窗口逐日收割（日收割量 ≪ 400 容量，零丢失），
 * 月度窗 [24×30(M−1), 24×30M] 精确对账。任何绕过 credit/debit 记账管道的直改
 * 余额路径（F-07 类缺陷）都会在本审计中呈非零残差。
 */

import { balance } from '../../src/domain/economy/ledger.js';
import { resourceDef } from '../../src/content/resources.js';

export class EconomicEntropyAuditor {
  constructor() {
    this.priceSamples = 0;
    this.priceBandViolations = [];
    this.ledgerViolations = [];
    this.months = 0;
    this.openings = null;      // { fid: { resId: v } }
    this.openTick = 0;
    this.harvested = null;     // { fid: { resId: signedSum } }（当前月窗累计）
    this.lastHarvestTick = 0;
  }

  /** 开账：快照全文明期初余额 */
  openLedgerCycle(world) {
    this.openings = {};
    for (const fid of Object.keys(world.economy.ledgers)) {
      this.openings[fid] = { ...world.economy.ledgers[fid].balances };
    }
    this.openTick = world.tick;
    this.harvested = {};
    this.lastHarvestTick = world.tick;
  }

  /** 每日采样：流水收割（逐日）+ 价格带（每周一次，长期价格追踪口径） */
  sampleDay(world, day) {
    if (day % 7 === 1) {
      const systems = Object.values(world.entities.systems);
      for (const sys of systems) {
        const m = world.economy.markets?.[sys.id];
        if (!m || !m.price) continue;
        for (const rid of Object.keys(m.price)) {
          const def = resourceDef(rid);
          if (!def) continue;
          const p = m.price[rid];
          this.priceSamples++;
          const lo = def.basePrice * 0.35 - 1e-9;
          const hi = def.basePrice * 3.2 + 1e-9;
          if (!(p >= lo && p <= hi) || p < def.basePrice * 0.01 || p < 0) {
            if (this.priceBandViolations.length < 8) {
              this.priceBandViolations.push(`day=${day} ${sys.id}.${rid}=${p} ∉ [${lo.toFixed(2)},${hi.toFixed(2)}]`);
            }
          }
        }
      }
      // 信用点溢出哨兵（doc24 SIM-LONG ③：credits < 1e9 且非 NaN）
      for (const fid of Object.keys(world.economy.ledgers)) {
        const c = balance(world, fid, 'credits');
        if (!Number.isFinite(c) || c >= 1e9) {
          this.priceBandViolations.push(`day=${day} ${fid} credits=${c} 溢出`);
        }
      }
    }
    // 收割本日 transactions（tick ∈ (lastHarvestTick, world.tick]；带符号 delta 直加）
    const txs = world.economy.transactions || [];
    for (const t of txs) {
      if (t.tick > this.lastHarvestTick && t.tick <= world.tick) {
        const acc = (this.harvested[t.factionId] ||= {});
        acc[t.resId] = (acc[t.resId] || 0) + t.delta;
      }
    }
    this.lastHarvestTick = world.tick;
  }

  /** 月度守恒对账：期初 + Σ带符号流量 = 期末（误差 0） */
  settleMonthly(world) {
    if (!this.openings) this.openLedgerCycle(world);
    for (const fid of Object.keys(this.openings)) {
      const flows = this.harvested[fid] || {};
      const resIds = new Set([
        ...Object.keys(this.openings[fid]),
        ...Object.keys(flows),
        ...Object.keys(world.economy.ledgers[fid]?.balances || {}),
      ]);
      for (const rid of resIds) {
        const expected = (this.openings[fid][rid] ?? 0) + (flows[rid] || 0);
        const actual = world.economy.ledgers[fid]?.balances[rid] ?? 0;
        if (expected !== actual && this.ledgerViolations.length < 8) {
          this.ledgerViolations.push(
            `month=${this.months + 1} ${fid}.${rid}: 账本不平 ${actual} ≠ 期初${this.openings[fid][rid] ?? 0}+流量${flows[rid] || 0}=${expected}`);
        }
      }
    }
    this.months++;
    this.openLedgerCycle(world);
  }

  /** 终审：抛出全部累计违规 */
  finalize() {
    if (this.priceBandViolations.length > 0) {
      throw new Error(`[ECON] 价格带违规: ${this.priceBandViolations.slice(0, 3).join('; ')}（共 ${this.priceBandViolations.length}）`);
    }
    if (this.ledgerViolations.length > 0) {
      throw new Error(`[ECON] 账本守恒违规: ${this.ledgerViolations.slice(0, 3).join('; ')}（共 ${this.ledgerViolations.length}）`);
    }
    return { priceSamples: this.priceSamples, months: this.months };
  }
}
