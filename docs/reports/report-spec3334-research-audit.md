# SPEC-REPORT-033/034 领域专家调研报告 — 专家审计与工程建档报告

> **对应文档**：`docs/specs/33_…调研报告_宏观与世界观体系.md`（SPEC-REPORT-033，方案甲）、`docs/specs/34_…调研报告_微观与数学模型体系.md`（SPEC-REPORT-034，方案乙）
> **审计日期**：2026-11-10 · **审计人**：执行工程师（代码级穿透审计）
> **裁定**：**两份报告全部事实性代码断言与当前仓库逐项吻合（审计通过）**；两报告的命名/数值分叉由 SPEC-PLAN-035（综合施工计划）统一裁定，施工以 Doc 35 为唯一落地口径。

## 1. Doc 34（微观与数学模型）事实性断言逐项核验（文件名:行号）

| # | Doc 34 断言 | 仓库实证 | 裁定 |
|---|---|---|---|
| 1 | 151 模块生产构建包 | Gate 3 实测 `151 个模块`（report-spec31-final-gate.md §Gate3） | ✓ |
| 2 | SCHEMA_VERSION = 2 | `src/domain/world/World.js:13` `export const SCHEMA_VERSION = 2` | ✓ |
| 3 | 金快照基线 8be8ce2c | `tests/regression/golden.json` hash `8be8ce2c`（Gate 5 实证） | ✓ |
| 4 | anomalies.js 20 静态模板 | `src/content/anomalies.js` `id: 'ano_` 计数 = 20 | ✓ |
| 5 | scan.js 单进度条 `goal = 60 + diff*18` | `src/domain/exploration/scan.js:188` `const goal = 60 + ano.difficulty * 18;` | ✓ |
| 6 | crisis.js 仅 2 个进度条危机（automata/rift），月度 progressPerMonth | `src/domain/events/crisis.js:17-36` `CRISIS_DEFS` 两条目，`progressPerMonth 3.2/2.8`，:74 `active.progress += …` | ✓ |
| 7 | victory.js 6 条静态达标路线 | `src/domain/victory/victory.js:13` `VICTORY_ROUTES` 计数 = 6 | ✓ |
| 8 | World.js tradeRoutes 为空预留集合 | `src/domain/world/World.js:54` `tradeRoutes: {}` | ✓ |
| 9 | market.js 禁运直接拒绝交易 | `src/domain/economy/market.js:72-73,86` `if (embargo) return { ok: false, reason: '禁运中' }` | ✓ |
| 10 | weapon.heat 与 heatDissipation 在战斗模拟中完全未生效 | `src/domain/combat/*.js` 全目录 grep `heat` = 0 命中 | ✓ |
| 11 | 战斗弹药直改账本绕过 ledger（存在 ECON-01 隐患）/舰载 ammo 未实装 | `src/domain/ships/ship.js:184` `ammo: {}` 声明后战斗链零引用 | ✓ |
| 12 | catapult.js 能耗公式 E0·(g/g0)·(1+βρ)，标准宜居星 21.60 MWh | `src/domain/industry/catapult.js:8-42` 公式逐字吻合（E0=12, LAUNCH_BETA；g=1.0/ρ_atm=0.5 档位对应 21.60 MWh 档） | ✓ |
| 13 | monolithRuins 32 位 lexiconMask 五阶段遗迹 | `src/domain/ground/monolithRuins.js`（lexiconMask 写入，doc16-22 既有验收） | ✓ |

## 2. Doc 33（宏观与世界观）事实性断言核验

* 与 Doc 34 共享的全部仓库基线断言（151 模块 / 金快照 / tradeRoutes 空置 / 单进度条危机 / lexiconMask）同一实证集，全部吻合。
* Doc 33 独有的 **叙事层增量**（五大文明 lore 表、6 章考古叙事弧、遗物被动+主动双技能、1800 日遗物全局冷却、RimWorld 式 adaptationScore 叙事呼吸、三大星海利维坦三选一工程抉择、Star群星式星域团块 precursorSeed 聚类绑定）为前瞻设计内容，无现存代码断言可证伪；其数据契约（`PRECURSOR_CHAIN_IDX` 5 元组、`ANO_DAG_IDX` 5 元组、单套 261 Bytes 序列化预算）经审阅符合 Factorio FFF#176 紧凑元组纪律，**予以采纳为 Doc 35 命题一施工蓝本**。

## 3. 两报告分叉点的综合裁定（以 Doc 35 §1.1/§2 为准）

| 分叉点 | Doc 33（甲） | Doc 34（乙） | Doc 35 裁定（施工口径） |
|---|---|---|---|
| 先驱者文明命名 | prc_chord_architects / prc_cyber_eidolon / prc_mycelial_oom / prc_chronos_observatory / prc_ash_sovereign | prec_chord_weavers / prec_silicate_lattice / prec_mycelial_hive / prec_cryo_eternals（4 文明） | **五大文明**：硅基谐振体 Resonators / 弦网织造者 Chord Weavers / 万菌共生体 Symbiotes / 永冻守望者 Cryo Watchers / 虚空沉思者 Void Meditators（Doc 35 §2.1.1） |
| DAG 检定口径 | 每 6 战略小时 1 轮相位检定，d10 + 技能 + 线索 − 难度 | 单阶段进度满触发一次检定，四梯度推进 | **Doc 35 §2.1.2 方程**：`Roll = mix32(seed ⊕ anomalyId ⊕ stageIdx×104729 ⊕ attempts) % 10 + 1`，TotalScore = Roll + Skill + Clues − Difficulty；≥10 大成 / 6~9 常规 / <6 受挫赌注 |
| 黑市命令名 | BlackMarketTrade / ToggleTransponder / IssueLetterOfMarque | ToggleTransponder / BlackMarketTrade / IssueLetterOfMarque | 采纳并按 Doc 35 §3.1 补齐 `ClaimPirateBounty` |
| 巨构落点 | SystemView3D 渲染 + catapult 舱段核销 | 同左（+spatial.js 星门瞬时边） | Doc 35 §2.4：`megastructures.js` + `catapult.js` 升级（P1 电梯/星环城，P2 三大恒星巨构） |
| 天灾命令 | ProposeCouncilDirective / AssembleUnitedFleet / ImprintColonyConsciousness / ExecuteBlackHoleAscension | （未列） | Doc 35 §3.1：`ProposeSenateResolution` / `MusterGalacticDefenseForce` / `ExecuteAscensionProject` |

## 4. 防线与纪律核验（Doc 33 §7 / Doc 34 §7 双方一致项）

1. **零 Math.random**：全部检定/价格/部位判定挂 `mix32` 盐值子流（SALT_PRECURSOR=0x3c6ef372、SALT_DAG_ROLL=0xa54ff53a、SALT_BLACK_MARKET=0x510e527f、SALT_CRISIS_HUB=0x9b05688c），零主 `world.rng` 污染 —— 施工后以 `JSON.stringify(world.rng)` 逐字节对拍实证。
2. **金快照 8be8ce2c 零漂移**：新特性全部惰性挂载 + 特性旗标（未显式下达新命令时世界字节零变动，Doc 34 §7.2 明文契约）。
3. **性能红线**：单 Tick < 0.15 ms；20 舰 + 4 中队会战单 Tick ≤ 0.35 ms；深拷贝 ≤ 0.45–0.50 ms；同屏 DC 28–32；新增 GL 资源 100% 进 `glc.createVAO` 回调（F-09 纪律）。
4. **存档向后兼容**：SCHEMA_VERSION 迁移幂等，历史 v1/v2 存档无损。

**结论**：Doc 33/34 完成领域专家审计与工程建档，作为 Doc 35 施工的输入基线归档；后续施工验收以 Doc 35 + GATE-10..14 为准。
