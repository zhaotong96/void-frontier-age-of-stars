/**
 * tests/e2e/CampaignMilestoneRunner.js — 战役黄金路径端到端自动化验收调度器（doc28 §4.1）
 *
 * CAMPAIGN-01「边疆回声」四大里程碑顺序执行，全部经官方命令总线驱动
 * （严禁直接修改世界状态跳关；唯一例外为剧本前提注入，见 Milestone2Combat
 * 的 contactState 说明——与既有 E2E-01 套件同口径）。
 */

import { Milestone1Genesis } from './stages/Milestone1Genesis.js';
import { Milestone2Combat } from './stages/Milestone2Combat.js';
import { Milestone3Logistics } from './stages/Milestone3Logistics.js';
import { Milestone4Victory } from './stages/Milestone4Victory.js';

/** 里程碑阶段注册表（运行器与浏览器观摩器共用同一执行序） */
export const __stages = [
  ['M1', Milestone1Genesis],
  ['M2', Milestone2Combat],
  ['M3', Milestone3Logistics],
  ['M4', Milestone4Victory],
];

export class CampaignMilestoneRunner {
  constructor(app, options = {}) {
    this.app = app; // { world, saveManager?, ui? }
    this.options = Object.assign({
      seed: 24601,
      timeoutMs: 60000,
      logMilestones: true,
    }, options);
  }

  /** 按序执行四大里程碑验收并返回审计报告 */
  async runCampaignAcceptance() {
    const report = {
      campaign: 'CAMPAIGN-01 边疆回声',
      startTime: Date.now(),
      milestones: [],
      passed: false,
    };
    const ctx = { world: this.app.world, options: this.options, ui: this.app.ui || null };

    try {
      for (const [id, Stage] of __stages) {
        const t0 = performance.now();
        const m = await new Stage(ctx).execute();
        m.id = id;
        m.name = id;
        m.durationMs = performance.now() - t0;
        m.tickAtEnd = ctx.world.tick;
        report.milestones.push(m);
        if (this.options.logMilestones) {
          console.log(`[CAMPAIGN] ${id} ${m.success ? 'PASS' : 'FAIL'} (${m.durationMs.toFixed(0)}ms @tick${m.tickAtEnd}) ${m.detail || ''}`);
        }
        if (!m.success) {
          report.failedAt = id;
          break;
        }
      }
      report.passed = report.milestones.length === 4 && report.milestones.every((m) => m.success === true);
    } catch (err) {
      report.passed = false;
      report.fatalError = { message: err.message, stack: (err.stack || '').split('\n').slice(0, 5).join('\n') };
      throw err;
    } finally {
      report.durationMs = Date.now() - report.startTime;
    }
    return report;
  }
}
