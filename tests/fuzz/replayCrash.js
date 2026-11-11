/**
 * tests/fuzz/replayCrash.js — 离线可复现重放器内核（doc26 §3.2）
 *
 * 读取 Dump（seed + worldKind + breadcrumbs + error），从初始状态按记录节拍
 * 重喂操作序列，抵达崩溃现场并断言错误签名（name/message/堆栈首帧）100% 一致。
 * 纯内核（无 node:fs）：CLI 包装见 tests/tools/replay-crash.mjs。
 */

import { createStarterCampaign, createMinimalWorld } from '../../src/devtools/scenarioFactory.js';
import { executeCommand, commandList } from '../../src/core/commandBus.js';
import { advanceTicks } from '../../src/simulation/WorldSimulation.js';
import { FAULTS } from './StateMachineFuzzer.js';

function rebuildWorld(dump) {
  const seed = dump.worldSnapshot?.seed ?? dump.seed ?? 24601;
  const kind = dump.worldSnapshot?.worldKind || 'starter';
  const world = kind === 'minimal' ? createMinimalWorld(seed) : createStarterCampaign({ seed });
  return world;
}

/** 重放一次 dump；返回 {ok, errorMatch, replayError?, steps} */
export async function replayDump(dump) {
  const world = rebuildWorld(dump);
  const valid = new Set(commandList());
  let steps = 0;
  let replayError = null;
  for (const bc of dump.breadcrumbs || []) {
    try {
      if (bc.type === 'command') {
        // 完整载荷逐字节重喂（面包屑 cmd 字段）；无 cmd 的旧格式回退骨架重放
        const cmd = bc.cmd || { type: (/^(\w+)/.exec(bc.detail || '') || [])[1] || 'UnknownFuzzCmd', actorId: world.playerFactionId, params: {} };
        if (valid.has(cmd.type)) {
          executeCommand(world, cmd);
          steps++;
        }
      } else if (bc.type === 'sim') {
        const m = /\+(\d+)t/.exec(bc.detail || '');
        advanceTicks(world, m ? Math.min(50, Number(m[1])) : 1);
        steps++;
      } else if (bc.type === 'FAULT') {
        steps++;
        await FAULTS[bc.detail](world); // 应抛出与 dump.error 相同的异常
      }
    } catch (e) {
      replayError = e;
      break;
    }
  }
  if (!replayError) {
    return { ok: false, errorMatch: false, steps, reason: '重放未触达崩溃现场（无异常抛出）' };
  }
  const sig = (e) => `${e.name}: ${e.message}`;
  const ok = sig(replayError) === sig({ name: dump.error.name, message: dump.error.message });
  const stackHead = (s) => String(s || '').split('\n').filter((l) => l.includes('at ')).slice(0, 2).join(' | ');
  const stackMatch = stackHead(replayError.stack) === stackHead(dump.error.stack);
  return { ok: ok && stackMatch, errorMatch: ok, stackMatch, steps, replayError };
}
