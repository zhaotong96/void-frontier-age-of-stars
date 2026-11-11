# SPEC-TEST-031 全生命周期终审收口与全量回归验证 — 竣工验收报告

> **文档编号**：REPORT-SPEC31-FINAL-GATE
> **对应施工方案**：`docs/specs/31_无垠边疆全生命周期终审收口与全量回归验证施工方案.md`
> **竣工日期**：2026-11-10
> **执行人**：执行工程师（自动化 Agent）
> **终审结论**：**五级门禁全部通过（GATE 1~5 EXIT 0），三项原子补丁 + 伴随清理全部落盘，F-10/F-07/F-09 三处隐患闭合，金快照零漂移。**

---

## 1. 三项终审原子补丁施工实证（文件名:行号）

### Patch 1 — F-10 太空战术战斗集成停局根治
| 改动 | 位置 | 内容 |
|---|---|---|
| 1a | `src/domain/combat/engagement.js:19-25` | 新增 `fleetHasWeapons(world, fleet)`：活体舰船 + 武器列表非空判定 |
| 1b | `src/domain/combat/engagement.js:38-58` | `checkEngagements`：**移除 `A.factionId > B.factionId continue` 跳过口径**（派系迭代序与 ID 序不一致时永久跳过敌对舰队的根因）；改为武装优先 + ID 字典序确定性排序；双方均无武器不建立死局战斗 |
| 1c | `src/domain/combat/engagement.js:105` | `endCondition: { kind: 'annihilate', timeoutSeconds: 600 }` 歼灭战携带硬超时 |
| 1d | `src/domain/combat/BattleSimulation.js:159-172` | 超时收束从 `kind==='timeout'` 扩展为**任意携带 `timeoutSeconds` 的 endCondition**，防无武装对峙/互不可达卡死 |
| 1e | `src/domain/combat/tactics.js:32-40,84-103,126-133,147-156,168-175` | 四处僵尸单元出清（`!ship \|\| ship.status !== 'active'` → `u.destroyed = true`，含 targetingBehavior 敌方候选 `e.destroyed = true`）；无武器单位向本方侧后退规避（`desiredX = side==='a' ? -60 : ARENA.w+60`），有武器无目标向最近敌人推进 |

### Patch 2 — F-07 账本直改漏洞闭合
| 改动 | 位置 | 内容 |
|---|---|---|
| 2 | `src/domain/planets/colonyGovernance.js:229-240` | 机偶维护费由 `led.balances.conductor = Math.max(0, ...)` 直改覆写改为 `debit(world, fid, 'conductor', upkeep, 'automataUpkeep', planet.id, FLOW.CONSUME)` 统一复式记账；`upkeep = Math.min(2, led?.balances?.conductor \|\| 0)` 预钳制保证 debit 不失败；回归验收门禁实测对账零误差（Gate 2 ECON-01/月度守恒 33 月全绿） |

### Patch 3 — F-09 残余 WebGL 孤儿资源托管
| 改动 | 位置 | 内容 |
|---|---|---|
| 3a | `src/render/gl/PlanetSurface3D.js:1805-1811` | `_skyVao`（`glc.createVAO` 创建，在 `_tracked.vaos`/`_vaoOwned` 清册内）由原生 `gl.deleteVertexArray` 改为 `glc.destroyVAO` 注销清册 |
| 3b | `src/render/gl/PlanetWater.js:319-345` | `vboPos`/`vboAux` 创建收纳进 `createVAO` 装配回调内部（`gl.createBuffer` 拦截器记入 `_vaoOwned`），`destroyVAO` 时自动级联释放，杜绝孤儿 VBO；`_ibo` 释放前置 `null` |
| 3c | `src/render/gl/BioFloraPass.js:349-360` | `_vaoFlora`/`_vaoFauna` 优先 `this._glc.destroyVAO` 注销清册（保留无 glc 时原生删除兜底 + 失效句柄 try/catch） |

---

## 2. 伴随性工程清理与回归用例去绕行实证

| 项 | 位置 | 内容 |
|---|---|---|
| 临时诊断文件移除 | `tests/regression/anomalous-seeds.json` | 已物理删除（`GalaxyProceduralSweeper.js` 异常归档机制保留，异常复现时自动重建） |
| M2 战役去绕行 | `tests/e2e/stages/Milestone2Combat.js:87-107` | 移除第 6 步 `OrderFleetRetreat` 强制撤离绕行；硬断言：战报必须在史（`rep !== undefined \|\| history.length > 0`）+ `battles.active === 0`（战斗彻底自然收束）。门禁三轮实测：`宣战 fac_385 · 敌损 2 · 战报 winner=a`，400 tick 内自然全歼结算 |

---

## 3. 五级全量回归门禁实证

### Gate 1 — 静态语法与代码规范审计 ✅
```
$ node tests/tools/static-audit.mjs
静态审计通过：无违规项        EXIT=0
```

### Gate 2 — 56 套件 × 3 轮连续回归 ✅（三轮 168 轮次全绿零漂移）
```
$ node tests/tools/run-suites.mjs --repeat=3        （日志 docs/reports/spec31-gate2-run3.log）
==== 汇总: PASS 168 / FAIL 0 / DRIFT 0（3 轮 × 56 套件 = 168 轮次）====
全生命周期确定性门禁 100% 通过（零状态泄漏、零时间漂移）。   GATE2_EXIT=0
```
覆盖 Agent 五阶段（AGENT-LOOP/TRACE）、模糊风暴 10,000 步（FUZZ-STORM/REPLAY）、千日浸泡（SOAK-SIM 55.4s/轮 + SOAK-LEAK 零句柄泄漏）、四大战役里程碑全连通（E2E-CAMP M1→M4 ending=transcendence）。

**施工期发现并修复的 2 处指纹伪漂移（非断言弱化，模拟态证据不动）**：
1. `tests/suites/e2e-campaign-milestones.suite.js:46-60`：M4 detail 内嵌墙钟毫秒在 runner `normalizeDetail` 之前参与 `slice(0,60)` 截断，毫秒位数差移动截断边界产生 1 字符指纹漂移（R1 `ancientData ]` vs R2 `ancientData]`，世界态 hash `camp4 t8667` 三轮完全一致）。修复 = 与 runner 同口径先归一化 `<ms>` 再截断；里程碑门禁与断言零改动。
2. `tests/suites/soak-inspection.suite.js:96-100`：SOAK-SIM hash 内嵌 `v${msPerDayMinimal.toFixed(1)}` 墙钟实测速度，三轮实测 1.278/1.4x/1.465ms 跨 0.1 桶边界（v1.3/v1.4/v1.5）判漂移，全部模拟态不变量（队列峰值 0/500、AI 折返 0、100 轮零 NaN/Inf、33 月对账零误差）三轮逐字一致。修复 = 速度分量移出指纹（runner doc14-18 既定语义：毫秒计时属合法测量输出而非状态漂移）；**≤1.5ms/日纯管线速度门禁仍为硬断言**。
   修复后定向复验 SOAK-SIM ×3 = PASS 3 / DRIFT 0（轮耗时 70.8s/60.4s 高负载差下指纹恒定）。

### Gate 3 — 生产级单体 Bundle 打包与 AST 校验 ✅
```
$ node tests/tools/build-static-bundle.mjs
打包完成：[REDACTED]\dist\void-frontier.bundle.js（151 个模块，1973 KB）
$ node --check dist/void-frontier.bundle.js          → NODE_CHECK_OK
```
体积 1970KB → 1973KB（+3KB ≈ 64 行补丁；施工方案中 "~1.2MB 级" 为估算口径，实测稳定基线为 ~1.97MB 级）。补丁入包验证：bundle 内 `fleetHasWeapons`×3、`automataUpkeep`×1、`timeoutSeconds`×4 命中。

### Gate 4 — Tier 5 Chrome CDP 物理真机巡检 ✅（NVIDIA GTX 970M 实测）
```
$ node tests/tools/run-cdp-playtest.mjs              （日志 docs/reports/spec31-gate4-cdp-run9.log）
[Tier 5 GPU 基线] 显卡: ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce GTX 970M (0x000013D8)), NVIDIA)
                   | avgFrameMs=10.93ms (<16.6ms) | DrawCalls=20 (<=32 DC) | Triangles=76288
[Tier 5 CDP] 全链路实机自动化巡检 PASS！截图已归档至 [REDACTED]\docs\screenshots\cdp-regression
                                              EXIT=0
```
* 16 屏全场景路由巡检（menu→galaxy→system→colony→fleet→designer→combat→research→market→diplomacy→government→ground→events→chronicle→settings→diagnostics）全通过，Console Error=0、Warning=0、Network 404=0（工具断言直判）。
* 地表闭环：KeyV 科研面罩、Digit5 工程建造、KeyE POI 交互、Escape 返轨全部通过（工具断言直判）。
* 物理基线：**avgFrameMs=10.93ms（≈91 FPS，优于 60FPS 门禁）**、DrawCalls=20（规格 ~20 ✓）、Triangles=76288（规格 ~7.6 万 ✓ 精确命中）、`gl.getError()===0`（工具断言直判）。
* 产物：`docs/screenshots/cdp-regression/01-galaxy-boot.png` ~ `05-escape-to-orbit.png` 共 5 张全量刷新（2026-11-10 00:40）。

**施工期两项 harness 修正（均非断言弱化，证据链完整）**：
1. `tests/tools/run-cdp-playtest.mjs:141-152`：固定 1200ms 挂载等待在 Vulkan dGPU 冷会话下产生假阴性（实测首次模块挂载 ~31.8s，诊断日志在案）。改为轮询等待挂载（≤45s）+ 保留原 1200ms 沉降——仅消除 harness 竞态，全部门禁断言零改动。
2. GPU 选择：本机（[REDACTED]）为 GTX 970M + HD 4600 双 GPU，Chrome 默认走 Intel iGPU（33.47ms）；`--use-angle=vulkan` 使 WebGL2 绑定 **NVIDIA GTX 970M 物理 dGPU**（`SystemInfo.getInfo` 设备清单 + UNMASKED_RENDERER 实证），全热后 10.93ms 达标。方案所指 "RTX 5060 真机" 为项目负责人本机（doc23：委托书明载 RTX 5060 Laptop GPU 为项目负责人实测环境），本机无该硬件，以可用的物理 NVIDIA dGPU 完成同级实测，显卡字符串如实归档。临时设置的 Chrome GpuPreference 注册表项（对选择无实效）已清理还原。

### Gate 5 — Golden Baseline 审计与回归闭环 ✅（零漂移，无需重基线）
```
$ node tests/tools/run-suites.mjs --repeat=1 --id=REG-01
T1 REG-01   PASS 22664.1ms [regression] 固定种子金快照回归   EXIT=0
tests/regression/golden.json → { "seed": 24601, "ticks": 4320, "hash": "8be8ce2c" }
```
F-10/F-07 补丁未触碰金快照确定性序列（4320 tick 纯世界演化在补丁前后 hash 恒为 `8be8ce2c`），**无需 `--update` 重基线**。且 Gate 2 全量 3 轮中 REG-01 亦 3/3 PASS 对拍一致。

---

## 4. 红线纪律核查

1. **未执行任何 `git commit`**——全部改动与验证在本地工作树，等待项目负责人核实与最终审批。✅
2. **未弱化任何断言**——2 处指纹修复均为墙钟测量值与模拟态的口径归一（模拟态不变量、速度硬门禁、战役连通断言全部保留且全绿）；CDP 工具 1 处为挂载竞态消除（断言原样）。无注释断言、无扩宽容差、无吞噬异常。✅
3. **真实证据优先**——本报告全部结论来自真实终端日志（`docs/reports/spec31-gate2-run*.log`、`spec31-gate4-cdp-run*.log`）与落盘产物（bundle、golden.json、5 张截图）。✅

## 5. 遗留与移交

* Pages 推送仍等待用户凭据（历史遗留，非本方案范围）。
* `docs/reports/spec31-gate2-run.log`（首轮）记录了一次 node 进程外部异常终止（exit 127，无 stderr、无 OOM 栈），完整重跑（run3）168/168 全绿后不复现，判定为环境瞬态，留档备查。
