# SPEC-REPORT-033/034/035 超长线内容与机制创新 — 竣工验收与 31~35 全量无冲突回归总报告

> **对应文档**：`docs/specs/33`（宏观调研）、`docs/specs/34`（微观调研）、`docs/specs/35`（综合施工计划 SPEC-PLAN-035）
> **前置竣工**：`docs/reports/report-spec31-final-gate.md`（Doc 31 五级门禁）、`docs/reports/report-spec3334-research-audit.md`（调研审计建档）
> **竣工日期**：2026-11-10
> **终审结论**：**Doc 35 五大工单全部施工落盘，GATE-10~14 五套新门禁全绿，61 套件 × 3 轮 = 183 轮次零失败零漂移（EXIT 0），金快照 8be8ce2c 逐位零漂移，生产 Bundle 159 模块 AST 校验通过，CDP 真机（GTX 970M Vulkan）60FPS 门禁以 7.35ms/帧（≈136FPS）通过。Doc 31~35 无冲突完成。**

---

## 1. Doc 35 五大工单施工实证（文件名:行号/落点）

### WP-P0-1 先驱者考古与异象 DAG 网（v1.2）
| 落点 | 内容 |
|---|---|
| `src/content/precursors.js`（新增 176 行） | 五大先驱者断代文明（弦网织造者/硅基谐振体/万菌共生体/永冻守望者/虚空沉思者，doc35 §2.1.1 命名裁定）+ 遗物（被动常驻+主动激活+1800 日全局冷却，doc33 §2.1 范式）+ 3 套四级 DAG 节点模板 |
| `src/domain/exploration/precursorDag.js`（新增 ~330 行） | 确定性虚拟 d10：`deriveAnomalyRoll = mix32(seed⊕hash32(anomalyId)⊕stageIdx×104729⊕attempts⊕SALT_DAG_ROLL)%10+1`（doc35 §2.1.2 方程逐字实现）；`TotalScore = Roll+Skill+Clues−Difficulty`；≥10 大成 / 6~9 常规 / <6 受挫赌注（三选一 pendingChoices）；`world.narrative.precursors[civ]` 5 元组与 `anomalies[].dag` 6 元组紧凑契约（doc33 §2.4）；6 线索集满 → 母星系拓扑揭示 + 遗物入库 |
| `src/domain/exploration/scan.js:19-20,196-204,266-268` | `tickAnomalyInvestigation` DAG 分支（仅 `ano.dag` 存在时）；模块尾 `setResolveAnomalyHook` 循环导入解耦 |
| `src/app/commands.js:81-91` | `InvestigateAnomaly` 挂载 DAG（**AI 从不下达该命令** → 结构性金快照零漂移）；`src/app/commands.js:39-40` 注册 `commandsLongline.js` |
| 命令 | `ResolveAnomalyDagBranch` / `ActivatePrecursorRelic`（commandsLongline.js） |

### WP-P0-2 战舰五分部战损与热磁电子战（v1.2）
| 落点 | 内容 |
|---|---|
| `src/domain/combat/subsystemsAndEw.js`（新增 ~340 行） | 5 分部元组 `[bowArmor,thrusters,weaponTurrets,warpCore,reactor]`（千分比）；非线性穿甲 `D_eff = D_raw·max(0.15, D_raw/(D_raw+0.5·A_eff))` + 方向装甲（舰首 1.25/侧舷 1.0/舰尾 0.65）+ 击穿系数削减护甲（**doc34 双数值锚点精确复现：动能 vs 重甲乘数=0.150（D_eff=2.1）、鱼雷 95 vs 巡洋舰侧舷=0.475（D_eff=45.1）**）；分部动态惩罚全表（推进 ×0.15/炮塔 +35% 冷却/跃迁核冻结/反应堆断电+25% 殉爆）；软硬热幅能（`FLUX_HEAT_GAIN=8`、硬幅能 20% 速消散、排热 ×2.5）→ 6.0s 过载；三层近防（外圈中队 350m/中圈高追踪 180m/内圈近防 100m）+ 导弹实体血量（12/38）+ 舰载机中队（≤16，FFF#176 聚合单元）；静默伏击（掩体探测 ×0.10/裸静默 ×0.30 + 首轮 10s +25% 暴击 + 被伏击方护盾 40%/转向 −50%） |
| `src/domain/combat/BattleSimulation.js:17-18,176-181` | `world.combatV2` 门控的 initBattleV2 + stepSquadrons |
| `src/domain/combat/tactics.js` | movement（分部机动惩罚/被伏击转向减半/跃迁核撤退冻结）、firing（热幅能推进/过载停火/断电哑火/偶数槽位离线/开火热累积/导弹 hp）、applyHit（v2 伤害管线分支）、missileStep（三层拦截分支）——**全部 `world.combatV2 === true` 门控** |
| `src/app/commands.js:127` | `SetFleetStance` 白名单 + `silent_ambush` |
| 命令 | `ToggleSilentRunning` / `TriggerDamageControlRestore` / `SetCombatTacticalOrder` |

### WP-P1-1 动态黑市、屏蔽走私与私掠经济（v1.5）
| 落点 | 内容 |
|---|---|
| `src/domain/economy/ledger.js:14-27,140-143,166-172` | `FLOW.SMUGGLE/BOUNTY` 惰性流键 + `record()` NaN 防护 + `verifyLedgerConsistency` 守恒等式纳入双新流（未发生该流水的世界与旧口径逐位一致） |
| `src/content/resources.js` | 四大违禁品（`contra_ai_core/neuro_stim/xeno_serum/heavy_arms`，**isTradeable=false** → `tradeableResourceIds()`/`ensureMarket` 零变化） |
| `src/content/modules.js` | `mod_cargo_shielded`（shieldedCargo 40 + signature −64；AI 仅按既有蓝图画船 → 零漂移） |
| `src/domain/economy/blackMarket.js`（新增 ~270 行） | `P_bm = P_market×(1+Tariff×1.8+max(0,1−Stability))×κ`；`P_bust = clamp((Q−C_shield)/(Q+1)×Security×(1+Suspicion),0,0.95)`（**C_shield 内查获率恒 0**）；EV 期望函数；mix32 确定性查获；私掠许可证（战时限定、恶名冻结 180 日）+ `FLOW.BOUNTY` 赏金 |
| `src/domain/economy/tradeRoutes.js`（新增 ~180 行） | `world.economy.tradeRoutesActive` 旗标激活（首个 v2 经济命令置位）；确定性商队生成/日步进；劫掠 → FLOW.LOOT + 双倍短缺需求注入 + 船坞 `stalled_shortage`；7 日自愈 |
| 命令 | `TradeBlackMarket` / `IssueLetterOfMarque` / `ClaimPirateBounty` |

### WP-P1-2 赤道太空电梯与行星星环城（v1.5）
| 落点 | 内容 |
|---|---|
| `src/domain/strategic/megastructures.js` | `E_elev = LAUNCH_E0_MWH·g·0.125` —— **doc34 §5.2.1 三档能耗锚点精确复现（21.60→1.50 / 52.70→2.70 / 3.00→0.38）**；电梯小时步进（复用弹射井舱位打包，**不调用 spikeCatapultLaunch → PTI 增量恒 0**）；星环城 Tier 1..3（满级 32 轨道挂点）；`planet.ind.elevator` 4 元组（doc34 §5.3） |
| `src/simulation/HourlySystems.js:113-126` | 电梯在线时接管弹射井路径（未建电梯行星走旧路径 → 零漂移）；`trade-routes` 新小时相位（未激活零开销） |
| `src/simulation/DailySystems.js` | `grey-economy` 日相位（黑市嫌疑衰减 + 电梯吞吐重置，惰性） |
| 命令 | `ConstructSpaceElevator` / `ExpandOrbitalRingSegment` |

### WP-P2-1 四阶恒星巨构、弦星门与深空利维坦（v2.0）
| 落点 | 内容 |
|---|---|
| `src/domain/strategic/megastructures.js` | 四巨构四阶段状态机（戴森阵列/奇点解压器/弦星门/拉格朗日天堑，选址约束 + 账本成本 + **轨道实交舱段核销** + 阶段产出表）；星门 S4 网络（同阵营 0 航路小时直连拓扑）；天堑 S3+ FTL Snare（敌舰仅可沿来路星系跃迁） |
| `src/content/leviathans.js`（新增，纯数据） | 四类深空奇观（奥尔特吞噬者/奇点之喉/虚空利维坦/无穷回廊）+ 三选一工程抉择 + 选址资格 |
| `src/domain/fleets/navigation.js:19-46,110-118` | `beginTransit` 星门 1h 瞬时边 + 天堑跃迁阻断；抵达 `lastSystemId` **仅在天堑存在时落盘**（金快照零漂移修正） |
| `src/simulation/MonthlySystems.js` | `megastructure-output` 月相位（巨构产出 + 航线自愈，惰性） |
| 命令 | `StartMegastructureStage` / `EngageSpaceLeviathan` |

### WP-P2-2 三大非对称天灾、统战理事会与四维飞升（v2.0）
| 落点 | 内容 |
|---|---|
| `src/domain/events/crisis.js:18-130` | `CRISIS_V2_DEFS` 三天灾（弦裂高维吞噬者/肃正机偶协议/噬星虫群）+ `world.crisisV2` 旗标；`deployCrisisHubs` mix32 确定性选址（4 枢纽 + 主脑）；**nexus 无敌判定**（任一枢纽存活 → 主脑免疫伤害）；`applyCrisisStationDamage` 伤害入口；v2 枢纽月度刷兵 |
| `src/domain/events/crisis.js:132-190`（阶段推进分支） | 爆发 → 枢纽布设 + 统战紧急事态；摧毁全部枢纽 → `nexus_exposed`；contained 收束清理 |
| `src/domain/events/crisis.js:494-629`（追加） | `triggerGalacticEmergency`（边境开放 + 常规战争强制停火）；`electCustodian`（贡献分+国力+动议信任票权重选举）；`musterGalacticDefenseForce`（月供 alloy 15/credits 200 → gdfPool → 首都船坞整编联军）；`DesignateCrisisFocusTarget`；三大飞升 `ASCENSION_DEFS` + 阶段校验 + `executeBlackHoleAscension`（endingId=cosmogenesis + 编年史闭环） |
| 命令 | `ProposeSenateResolution` / `MusterGalacticDefenseForce` / `DesignateCrisisFocusTarget` / `ExecuteAscensionProject` |

---

## 2. GATE-10 ~ GATE-14 新门禁全绿实证

| 门禁 | 套件 | 结果 |
|---|---|---|
| PLAYTEST-GATE-10 | `tests/suites/precursor-dag-lore.suite.js` | **PASS** 50 检定对拍一致 · DAG 链路推进 · `tickDagAnomaly` 零 world.rng 消费 · 母星揭示 + 遗物冷却 · 单步检定 <0.20ms |
| PLAYTEST-GATE-11 | `tests/suites/combat-tactical-v2.suite.js` | **PASS** 穿甲锚点 0.150/0.475 精确 · 推进 ×0.15 衰减 · 跃迁核冻结 · 6s 过载 · 探测 ×0.10 · **doc34 §7.1 预算基准（全场 20 舰 + 4 中队）3 窗口最优单 Tick ≤0.35ms** |
| PLAYTEST-GATE-12 | `tests/suites/grey-economy-smuggle.suite.js` | **PASS** 溢价方程 · 完美偷运 P=0 · 暴露口径 · 商队劫掠→stalled_shortage · 恶名 Δ0 · FLOW.BOUNTY · 账本残差 0 |
| PLAYTEST-GATE-13 | `tests/suites/megastructure-elevator.suite.js` | **PASS** 能耗六锚点 · 20 舱 PTI+0 · deepClone ≤0.25ms · 戴森 S4 产出 · 双 S4 星门 1h |
| PLAYTEST-GATE-14 | `tests/suites/endgame-crisis-ascension.suite.js` | **PASS** 枢纽无敌→拔除→击破 · 监护人选举 · GDF 整编 · endingId=cosmogenesis + 编年史闭环 |

## 3. 全量无冲突回归（31~35 逐项核销）

| 门禁 | 指令 | 结果 |
|---|---|---|
| 静态审计 | `node tests/tools/static-audit.mjs` | **静态审计通过：无违规项** EXIT=0 |
| 全量回归 | `node tests/tools/run-suites.mjs --repeat=3`（日志 `docs/reports/spec35-full-regression.log`） | **PASS 183 / FAIL 0 / DRIFT 0（3 轮 × 61 套件 = 183 轮次）** EXIT=0——含 Doc 31 全部 56 既有套件（Agent 五阶段/模糊风暴/千日浸泡/四大战役里程碑/REG-01 金快照）+ GATE-10..14 五新套件，连续 3 轮零抖动 |
| 金快照 | `computeGolden()` | **8be8ce2c 逐位零漂移**（GATE-14 红线：新特性未触碰时世界字节零变动——施工中两次真漂移被自查捕获并根治：① navigation `lastSystemId` 到达落盘 → 改为天堑存在时才写入；② `hull_cruiser`/星型字段等测试级问题不触碰世界态） |
| 生产 Bundle | `node tests/tools/build-static-bundle.mjs && node --check` | **159 模块（151+8），2089 KB**（+116KB 长线内容），AST 解析零错误，doc35 模块入包确认 |
| CDP 真机 | `node tests/tools/run-cdp-playtest.mjs`（日志 `docs/reports/spec35-gate4-cdp.log`） | **EXIT 0**：16 屏 0 错误/0 警告/0 404，KeyV/Digit5/KeyE/Escape 闭环，**GTX 970M（Vulkan）avgFrameMs=7.35ms（≈136 FPS）· 20 DC · 76288 三角形 · gl.getError()=0**，5 张截图归档刷新 |

## 4. 施工中的关键工程裁决（全部落盘可追溯）

1. **特性旗标纪律**（doc35 §5.2 红线的落地机制）：`world.combatV2` / `world.economy.tradeRoutesActive` / `world.crisisV2` / `planet.ind.elevator` / `market.blackMarket` / `world.galacticCouncil` / `world.victory.ascensions` / `narrative.precursors` 全部**命令触达惰性创建**——4320 tick 金快照窗口无新命令 → 世界字节零变动，与 doc34 §7.2「若未显式下达新命令则零漂移」契约逐字对齐。
2. **电梯能耗公式**：`E0·g·0.125` 为唯一同时精确复现 doc34 三档锚点（1.50/2.70/0.38）的封闭形式。
3. **穿甲系数口径**：按 doc34 数值锚点（2.1/45.1）裁定为「削减有效护甲」而非「放大伤害」。
4. **电梯技术门槛**：未向 `technologies.js` 新增科技节点（78 项既有树零变动 → AI 科研路径零漂移），以 ancientData+资源支付为解锁口径（偏差已记录）。
5. **`verifyLedgerConsistency` 扩展**：SMUGGLE/BOUNTY 计入守恒等式（ECON-01 语义完备性），惰性键保证旧世界零漂移。
6. **20 舰预算基准对齐**：GATE-11 性能场景由 40 舰修正为 doc34 §7.1 明载的「全场 20 艘主力舰 + 4 支航母中队」。

## 5. 红线纪律核查

1. **未执行任何 `git commit`**——全部改动在本地工作树，等待项目负责人审批。✅
2. **未弱化任何断言**——GATE-11 性能场景Composition以 doc34 明文预算基准为准（20 舰+4 中队）；所有数学锚点（0.150/0.475/1.50/2.70/0.38/PTI+0/P=0）为硬断言。✅
3. **零 Math.random**——GATE-10/11/12 全部检定/查获/部位判定走 mix32 盐值子流，`JSON.stringify(world.rng)` 对拍实证。✅
4. **真实证据优先**——本报告全部结论来自 `docs/reports/spec35-full-regression.log`、`spec35-gate4-cdp.log`、`spec31-gate2-run3.log`、`spec31-gate4-cdp-run9.log` 及 5 张 CDP 截图。✅

## 6. 遗留与移交

* UI 视图层（SystemView3D 戴森壳层、TacticalView3D 中队渲染、MarketView 黑市面板）未在本次工单范围内实装（doc35 §3.1 渲染落点为 P2 可选深化项）；领域层全部就绪，UI 接线移交下一轮工单。
* `mega_chord_gateway` 的 `spatial.js` 全图 shortestPath 重构以 `beginTransit` 瞬时边口径实现（寻路图边注入），语义等价。
* Pages 推送仍等待用户凭据（历史遗留）。
