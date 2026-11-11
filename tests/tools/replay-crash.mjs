#!/usr/bin/env node
/**
 * tests/tools/replay-crash.mjs — 命令行离线 Dump 重放诊断脚本（doc26 §3.2/§4）
 *
 * 用法: node tests/tools/replay-crash.mjs <crash-dump.json>
 * 行为: 读取 Dump（seed/worldKind/breadcrumbs/error），重建同种子世界，
 *       逐面包屑重喂操作序列，断言错误签名 + 堆栈首帧与原始 100% 一致。
 *       exit 0 = 复现成功；exit 1 = 复现失败或 Dump 缺陷。
 */
import { readFileSync } from 'node:fs';
import { replayDump } from '../fuzz/replayCrash.js';

const file = process.argv[2];
if (!file) {
  console.error('用法: node tests/tools/replay-crash.mjs <crash-dump.json>');
  process.exitCode = 1;
} else {
  let dump;
  try {
    dump = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Dump 读取/解析失败: ${e.message}`);
    process.exitCode = 1;
  }
  if (dump) {
    console.log(`[REPLAY] Dump: ${file}`);
    console.log(`[REPLAY] 原始错误: ${dump.error.name}: ${String(dump.error.message).split('\n')[0]}`);
    console.log(`[REPLAY] 世界: seed=${dump.worldSnapshot?.seed} kind=${dump.worldSnapshot?.worldKind} tick=${dump.worldSnapshot?.tick}`);
    const t0 = performance.now();
    const rep = await replayDump(dump);
    if (rep.ok) {
      console.log(`[REPLAY] ✔ 100% 精确复现（${rep.steps} 步重喂，${(performance.now() - t0).toFixed(0)}ms）`);
      console.log(`[REPLAY] 复现错误: ${rep.replayError.name}: ${rep.replayError.message}`);
    } else {
      console.error(`[REPLAY] ✘ 复现失败: ${rep.reason || `签名不一致 stackMatch=${rep.stackMatch}`}`);
      if (rep.replayError) console.error(`[REPLAY] 重放错误: ${rep.replayError.name}: ${rep.replayError.message}`);
      process.exitCode = 1;
    }
  }
}
