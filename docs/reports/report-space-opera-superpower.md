# 《无垠边疆：星海纪元》太空歌剧 SuperPower 全阶段正式验收报告

> **报告编号**：`SPEC-ACC-043~046`（Space Opera SuperPower 全阶段正式验收）
> **验收对象**：`SPEC-PLAN-043`（总控总纲）+ `SPEC-PLAN-044 / 045 / 046`（M1 / M2 / M3 三卷执行卷）对应全部交付面
> **上游准绳**：`docs/specs/42_无垠边疆太空歌剧与系统交织调研.md`（总纲准绳，837KB）与 `docs/specs/41_…任务委托书.md`
> **验收日期**：2026-11-13（本报告所有「实测」均为本次验收会话实跑记录）
> **工程基线**：项目根 `[REDACTED]`，纯 ESM，Node v22.20.0 便携版；金快照基线 `tests/regression/golden.json` hash=`8be8ce2c`（`tests/regression/golden.json:4`）
> **纪律声明**：本报告不包含任何未经本会话实跑或实读证实的 PASS 声明；所有行号均打开文件逐一核对。

---

## 一、工程概览

### 1.1 四阶段交付面

| 阶段 | 卷宗 | 交付面一句话 | 门禁套件 |
| :--- | :--- | :--- | :--- |
| Phase 0 (Master) | SPEC-PLAN-043 | 确定性雪崩哈希与 14 盐子流注册表、`world.spaceOperaState` 根容器迁移器、18 条太空歌剧 `CommandBus` 命令契约、阶段注册静态接线 | `SPACE-OPERA-00`（GATE-15-P0） |
| Phase 1 (M1) | SPEC-PLAN-044 | 256-Tile uint32 位编码紧凑 `PlanetState`（实测 3703B ≤ 4500 预算）、三级时钟分片调度器、通用四幕 `Situation` 引擎、S1 考古 / S2 生态相变 / S4 短缺破产三弧 | `SPACE-OPERA-M1`（GATE-15-M1） |
| Phase 2 (M2) | SPEC-PLAN-045 | 严格赫尔维茨稳定 7×7 雅可比耦合矩阵与三阶蝴蝶效应因果链、稀疏前沿位掩码 CA（并经整改接入慢速时钟活体通路）、16 大天体物理原型、S3 殖民地社会 / S6 黑市激进渗透 | `SPACE-OPERA-M2`（GATE-16-M2） |
| Phase 3 (M3) | SPEC-PLAN-046 | S5 舰队学说与 D-Mods/S-Mods 战损弧、星海群像英雄（XP/超编软惩罚/创伤/传奇）、5 类自主星区生态舰队、子空间信标流（≥15 不变量）、S7 议会/CHOAM/三大终局天灾（含有机触发与宪章表决整改）、自适应戏剧导演 | `SPACE-OPERA-M3`（GATE-17-M3） |
| 回归守护 | — | 固定种子金快照回归（4320 ticks，零漂移） | `REG-01` |

### 1.2 门禁结果表（本会话实跑）

运行命令：`node tests/tools/run-suites.mjs --id=<套件id>`（默认 3 轮对拍，Math.random 毒丸守卫，轮间指纹严格比对）。
「断言数」为套件源文件中 `assert / assertEq / assertNear / assertThrows` 静态调用点计数（`grep -oE "\b(assert|assertEq|assertNear|assertThrows)\(" | wc -l`，循环内断言运行时执行次数高于该值）；REG-01 无 assert 调用，其判定点为基线存在性 / 配置一致 / 哈希等值共 3 项。

| 套件 id | 结果 | 断言数（静态调用点） | 轮次 | 三轮实测耗时 |
| :--- | :--- | :--- | :--- | :--- |
| `SPACE-OPERA-00` | **PASS 3 / FAIL 0 / DRIFT 0** | 48 | 3 | 772.8 / 625.0 / 556.8 ms |
| `SPACE-OPERA-M1` | **PASS 3 / FAIL 0 / DRIFT 0** | 80 | 3 | 317.5 / 252.2 / 177.7 ms |
| `SPACE-OPERA-M2` | **PASS 3 / FAIL 0 / DRIFT 0** | 126 | 3 | 65.2 / 50.3 / 36.5 ms |
| `SPACE-OPERA-M3` | **PASS 3 / FAIL 0 / DRIFT 0** | 237 | 3 | 10206.5 / 8593.5 / 8614.8 ms |
| `REG-01` | **PASS 3 / FAIL 0 / DRIFT 0** | 3（哈希等值判定） | 3 | 11895.6 / 9370.1 / 12372.1 ms |

构建产物复验（本会话实跑）：
- `node tests/tools/build-static-bundle.mjs --rebuild` → `打包完成：dist\void-frontier.bundle.js（185 个模块，2661 KB）`；
- `node --check dist/void-frontier.bundle.js` → **exit=0**（语法检查通过）。

门禁套件覆盖的 CHK 项与文档清单一览：`SPACE-OPERA-00` 覆盖 43 号 §3.1/3.2 全部 5 项（CHK-00-01..05）；M1 套件覆盖 44 号 §3 全部 7 项（CHK-M1-01..07）；M2 套件覆盖 45 号 §3 全部 6 项（CHK-M2-01..06）并额外携带整改实证项 CHK-M2-07（`tests/suites/m2-jacobian-archetypes-ca.suite.js:39`、实现体 :493-560）；M3 套件覆盖 46 号 §3 全部 7 项（CHK-M3-01..07）并额外携带整改实证项 CHK-M3-08/09/10（`tests/suites/m3-space-opera-drama-director.suite.js:35-39`、实现体 :615-702 / :704-800 / :802-964）。

---

## 二、分阶段交付明细（每模块一行：路径 + 关键导出 + 对应门禁项 + 行号实证）

### Phase 0（总控基建）

| 模块 | 关键导出（行号） | 对应门禁项 | 实证 |
| :--- | :--- | :--- | :--- |
| `src/domain/world/deterministicRng.js` | `DOMAIN_SALTS`(:23，14 盐冻结表)、`mix32`(:49)、`deriveSeed`(:71)、`sampleFloat01`(:89)、`sampleWeightedIndex`(:106) | CHK-00-01/02/03 | tests/suites/space-opera-foundation-contract.suite.js:111/:119-126/:133-153 |
| `src/domain/world/worldMigration.js` | `SPACE_OPERA_SCHEMA_VERSION=200`(:18)、`ensureSpaceOperaState`(:37，惰性补齐零 rng 消耗) | CHK-00-04 | space-opera-foundation-contract.suite.js:160-192；tests/regression/golden.json:4（8be8ce2c） |
| `src/domain/world/commandSchemas.js` | `SPACE_OPERA_COMMANDS`(:19，18 条冻结契约)、`validateSpaceOperaCommandPayload`(:227) | CHK-00-05 | space-opera-foundation-contract.suite.js:209-243（18/18 双胞胎哈希一致+负样本拒收） |
| `src/app/commandsSpaceOpera.js` | 18 契约统一注册循环(:130)、GRAVITY_WELL 弧(:146)、`hConstructOrbitalFacility`(:204)、`hTriggerTerraformingPhase`(:249)、S7 十命令扩展(:545-640) | CHK-00-05 / CHK-M1-03 / 整改项3 | space-opera-foundation-contract.suite.js:213-227；m3 suite:704-800（CHK-M3-09） |
| `src/simulation/SpaceOperaWiring.js` | `registerHourly('space-opera')`(:32，恒最后)、`registerMonthly('space-opera-monthly'→'space-opera-jacobian'→'space-opera-drama')`(:33 起) | 裁决 j | SpaceOperaWiring.js:9-12/:18-33（唯一注册点，静态 import） |

### Phase 1（M1 局势弧线与紧凑行星底座）

| 模块 | 关键导出（行号） | 对应门禁项 | 实证 |
| :--- | :--- | :--- | :--- |
| `src/domain/planets/planetStateSchema.js` | `packTile`(:61)/`unpackTile`(:84)、`OPERA_RESOURCE_KEYS`(:106，8 槽裁决 e)、`createCompactPlanetState`(:127)、`computeMaxOrbitalDistricts`(:262)、`seedCompactTiles`(:347) | CHK-M1-01/02/03；裁决 e | m1 suite:84-97（实测 3703B）、:102-114（位编码往返）、:119-146（公式=6/引力井 25/+5 月） |
| `src/simulation/SpaceOperaClock.js` | `MED_BUCKETS=10`(:42)/`SLOW_BUCKETS=30`(:43)、`stepSpaceOperaTick`(:283)、`stepSpaceOperaMonthly`(:325)、稀疏前沿 CA 慢桶接入(:235-246) | CHK-M1-04；整改项1 | m1 suite:151-198（60 帧 30/12/10/3 恒等+耗时红线）；m2 suite:493-560（CHK-M2-07 活体通路） |
| `src/domain/events/situationEngine.js` | `APPROACH_COOLDOWN_TICKS=720`(:36，裁决 b)、`spawnSituation`(:238)、`stepSituationBucket`(:308)、`switchSituationApproach`(:339)、`resolveSituationClimax`(:381) | CHK-M1-03/05/06/07；裁决 b | m1 suite:139-145（引力井月增）、:219-260（S1 对策）、:276-307（S2）、:323-361（S4） |
| `src/domain/exploration/archaeologyArc.js` | `S1_ACT_BOUNDS [0,250][251,650][651,900][901,1000]`(:48-53，裁决 a)、对策修正表(:58-76)、`applyProspectingBonus`(:123)、`startArchaeologyDig` 第 5 参科学家挂接(:152) | CHK-M1-05；裁决 a；整改项4 | m1 suite:219-260；m3 suite:884-906（晋幕 XP+考古创伤） |
| `src/domain/planets/ecologicalPhaseArc.js` | 阈值常量(:37-42，黄警 40/红局 75)、`S2_TERRAFORM_COST=5000`(:50，:235-238 精确扣除)、`stepEcologicalPerturbation`(:114) | CHK-M1-06 | m1 suite:265-307（42 无局势/76 初始 20/-5000/幸福-20%/epoch3+容量翻倍） |
| `src/domain/economy/shortageSituationArc.js` | `S4_INITIAL_PROGRESS=15.0`(:128)、`S4_DELTA_MAX_PER_MONTH=5.0`(:129，裁决 f)、`computeAccessibility`(:55)、`watchStrategicStockpiles`(:152)、`setCutInvestments`(:211)、`isEmpireDefaulted`(:256)、违约 untilTick(:357-358) | CHK-M1-07；裁决 f | m1 suite:312-361（初始 15.0 精确/-25%/-50%/盈余-5.0/五惩罚/untilTick+86400） |

### Phase 2（M2 雅可比耦合与 16 天体原型）

| 模块 | 关键导出（行号） | 对应门禁项 | 实证 |
| :--- | :--- | :--- | :--- |
| `src/simulation/jacobianCoupling.js` | `JACOBIAN_7X7`(:51)、`SYSTEM_EQUILIBRIUM`(:62)、`SOFT_KNEE=8.0`(:70)、`softSaturate100`(:82-98，裁决 c)、`stepJacobianCoupling`(:100)、`recordButterflyRipple`(:150)、`consumePendingShocks`(:232) | CHK-M2-01/02；裁决 c/f | m2 suite:153-191（49 元素逐位+收敛）、:196-226（S2→S3→S6→S7 三阶链） |
| `src/domain/planets/sparseFrontierCA.js` | 位掩码 API(:113-143)、`stepSparseFrontierCA`(:417，四类相变+护盾守卫)、`seedFrontierRing`(:518) | CHK-M2-03 | m2 suite:231-278（24 位播种/耗时红线/护盾格不被覆盖） |
| `src/domain/planets/archetypeMechanics.js` | `applyArchetypeProfile`(:164)、`stepArchetypeMechanics`(:355)、`setQuantumPhaseLock`(:423)、`canBuildWithoutPenalty`(:438) | CHK-M2-04 | m2 suite:283-391（16 星全命中/#2 锁定+120%/:374/#5 列罚/:346-350/#15 守卫/:337） |
| `src/content/planetaryArchetypes.js` | `PLANETARY_ARCHETYPES`(:35，16 项 themeKeys 配置)、`ARCHETYPE_THEME_MAPPING_NOTES`(:238，裁决 g)、`getArchetype`(:267) | CHK-M2-04；裁决 g | planetaryArchetypes.js:6-24（themeKeys→PLANET_THEMES 真实键映射自检）；m2 suite:295-318 |
| `src/domain/politics/colonySocialArc.js` | `AMENITIES_COST_PER_POP`(:74，1.0/0.75/0.5)、`computeStabilityOutputMultiplier`(:128)、`computeImmigrationAttraction`(:137) | CHK-M2-05 | m2 suite:426-454（+18.0/+30.0/−30.0/封顶下限/IEEE-754 精确命中） |
| `src/domain/economy/shadowSyndicateArc.js` | `recomputeIndustrialAttention`(:210)、`RADICAL_ACTIVATION_THRESHOLD=7`(:252)、`ACTIVE_STABILITY_DRAIN=3.0`(:254)、`stepShadowSyndicateArc`(:374) | CHK-M2-06 | m2 suite:459-492（6→DORMANT/7→ACTIVE 翻转+raidSource+煽动旗标） |

### Phase 3（M3 反孤独生态与自适应戏剧导演）

| 模块 | 关键导出（行号） | 对应门禁项 | 实证 |
| :--- | :--- | :--- | :--- |
| `src/domain/fleets/fleetDoctrineAndScars.js` | `PATROL_HQ_UPGRADE_CREDITS=250000`(:59)、`upgradePatrolHQ`(:81)、`SHIP_SUPPLY_COSTS.hammerhead=10`(:238)、`deploymentCostMultiplier`(:304)、`DMOD_RESTORE_ALLOY=500`(:362)、`SMOD_INSTALL_EXOTIC_MATTER=1`(:377)、`restoreShipDMod`(:456) | CHK-M3-01 | m3 suite:190-255（250000 扣款/D-Mod ×0.8/×0.6/×0.4/学说滑块/修复焊死费用） |
| `src/domain/characters/galacticParagons.js` | `MONTHLY_XP`(:80)、`BUILD_COMPLETION_XP`(:83)、`GROUND_BATTLE_XP`(:89)、`upkeepMultiplier`(:159)/`xpGainMultiplier`(:171)、`assignParagonDestinyTrait`(:578)、`toggleBeholderMode`(:988-1050)、`LEGENDARY_ARRIVAL_MIN_MONTH`(:1229)、`stepLegendaryParagonRecruitment`(:1256) | CHK-M3-02/03；整改项4 | m3 suite:260-317（1.5×/0.7225×/陆战 101XP 晋升）、:319-361（Beholder 双形态/导师离职-20%）、:802-964（CHK-M3-10 战役/陆战/竣工/考古/传奇全链） |
| `src/domain/world/autonomousSectorLife.js` | `AUTONOMOUS_FLEET_TYPES`(:53，五类)、`AUTONOMOUS_FLEET_CAP=24`(:68)、`spawnAutonomousFleet`(:256)、`stepAutonomousFleets`(:679) | CHK-M3-04（生态舰队侧） | autonomousSectorLife.js:53-91 常量面；m3 suite:363-383（信标密度不变量） |
| `src/domain/world/subspaceBeaconStream.js` | `BEACON_MIN_NARRATIVE=15`(:51)、`stepBeaconStream`(:184)、`injectOpportunityBeacons`(:241)、`respondSubspaceBeacon`(:333) | CHK-M3-04/06；裁决 h | m3 suite:363-383（1000 帧逐帧 ≥15）、:545（OPPORTUNITY +18） |
| `src/simulation/dramaDirector.js` | `CLIMAX_TENSION_THRESHOLD=75`(:59)、`CATHARSIS_TENSION=25`(:60)、`CATHARSIS_ADAPTATION=0.75`(:61)、`RECOVERY_GRACE_TICKS=2160`(:63)、`CATHARSIS_OPPORTUNITY_BEACONS=18`(:64)、ADAPT 三段(:67-75)、`stepDramaAdaptationDaily`(:154)、`resolveGrandClimax`(:333)、`stepSpaceOperaDramaMonthly`(:422) | CHK-M3-06；裁决 d | m3 suite:437-559（G(c) 斜坡/W 预算/T=78→T=25/A=0.75/宽限 2160/宽限锁 0.75 期满 0.825） |
| `src/domain/diplomacy/galacticSenateAndCrisisArc.js` | `ENDGAME_CRISIS_KINDS`(:114，裁决 h)、`PRETHORYN_REINFORCE_SCHEDULE`(:117)、`startEndgameCrisis`(:652)、`prethorynReinforcementsPerYear`(:701)、`purifyInfestedWorld`(:764)、`onLeviathanDefeated`(:1063)、有机触发常量(:141-147)、`stepEndgameCrisisOrganicTrigger`(:1184)、`stepGalacticSenateMonthly`(:1219)、`stepEndgameCrisisMonthly`(:1269) | CHK-M3-05；整改项2/3 | m3 suite:385-435（净化/援军缩放）、:615-702（CHK-M3-08 有机触发+大游行）、:704-800（CHK-M3-09 宪章表决） |
| UI 投影：`src/simulation/ViewModels.js` | `spaceOperaView`(:477，只读投影) | 裁决 i | ViewModels.js:477；SnapshotBuilder.js:41-43（`if (world.spaceOperaState)` 守卫透传，金快照快照逐位不变）；DiagnosticsView.js:45-61（「太空歌剧态势」只读小节） |

---

## 三、门禁台账勾选状态汇总

复选框台账存在于 43/44/45/46 四份执行卷文档的 §3（42 号总纲无复选框清单，其终审结论以本报告第五节记录）。四份文档合计 **25 项 CHK，25 项全部勾选 `- [x]`**，每项行尾均附「——实证：文件路径:行号」；**零项**保持 `- [ ]`（grep 自验：四文档剩余 `- [ ]` 计数均为 0；全部 `- [x]` 行均含「实证：」字样）。上一阶段（总纲终审）复核后 **high/medium 残留为 0**（详见第五节），不构成任何台账项的勾选阻碍。

| 文档 | §3 分布 | CHK 项 | 状态 | 实证行号（文档内行号） |
| :--- | :--- | :--- | :--- | :--- |
| `docs/specs/43_superpower.md` | §3.1 | CHK-00-01 / 02 / 03 | 3/3 勾 | :196 / :197 / :198 |
| `docs/specs/43_superpower.md` | §3.2 | CHK-00-04 / 05 | 2/2 勾 | :201 / :202 |
| `docs/specs/44_m1_superpower.md` | §3.1 | CHK-M1-01 / 02 / 03 / 04 | 4/4 勾 | :284 / :285 / :286 / :289 |
| `docs/specs/44_m1_superpower.md` | §3.2 | CHK-M1-05 / 06 / 07 | 3/3 勾 | :292 / :295 / :298 |
| `docs/specs/45_m2_7x7_16_superpower.md` | §3.1 | CHK-M2-01 / 02 | 2/2 勾 | :215 / :216 |
| `docs/specs/45_m2_7x7_16_superpower.md` | §3.2 | CHK-M2-03 / 04 | 2/2 勾 | :219 / :220 |
| `docs/specs/45_m2_7x7_16_superpower.md` | §3.3 | CHK-M2-05 / 06 | 2/2 勾 | :227 / :228 |
| `docs/specs/46_m3_superpower.md` | §3.1 | CHK-M3-01 / 02 / 03 | 3/3 勾 | :182 / :185 / :188 |
| `docs/specs/46_m3_superpower.md` | §3.2 | CHK-M3-04 / 05 / 06 / 07 | 4/4 勾 | :193 / :194 / :197 / :200 |

（勾选仅改动复选框行并在行尾追加实证文字，未触碰文档其余内容。）

---

## 四、42 号总纲冲突裁决记录（逐条）

以下 a–k 为工程期间以 42 号总纲为准绳作出的全部裁决，逐条列明裁决内容与本会话核实的实证行号。

**a) S1 四幕界 42 胜 44（250/650/900）**：44 号执行卷 Task 1.4 原文写「第二幕 251–500 / 第三幕 501–750」，与 42 号 §二.1 的 250/650/900 幕界冲突；裁决按 42 号总纲执行。实现：`src/domain/exploration/archaeologyArc.js:48-53` `S1_ACT_BOUNDS = [0,250][251,650][651,900][901,1000]`；套件实证 `tests/suites/m3-space-opera-drama-director.suite.js:888-893`（进度 250 一步 +65 跨入幕 2、晋幕游标推进至第 2 幕）。

**b) 策略冷却 30 帧→720 tick 真实月历**：44 号 Task 1.3 写「切换后锁定 30 帧」，但本工程 1 tick=1 游戏小时、月=720 tick，30 帧既非月历口径也与月度步进引擎不相容；裁决改为 720 tick 真实月历。实现：`src/domain/events/situationEngine.js:36` `APPROACH_COOLDOWN_TICKS = TICKS_PER_MONTH`（=720）；套件实证 `tests/suites/m1-situation-planet-core.suite.js:139-145`（引力井局 1 月 = 720 tick 步进语义）。

**c) σ 软饱和膝点修正**：45 号 §2.1 的 tanh 软饱和公式 σ(x)=S_eq+(x−S_eq)·tanh(|x−S_eq|/k)（膝点形态）与其自身门禁 CHK-M2-01「120 步收敛回 S_eq」数学不相容——该 tanh 形态下 σ(15)≈11.92，S_eq 不再是不动点，任何以 S_eq 为平衡点的线性系统被持续拖离平衡。依 42 号 §三.1 赫尔维茨收敛语义裁决：**内域恒等 + 边界指数软渐近，S_eq 保持精确不动点**。实现：`src/simulation/jacobianCoupling.js:70`（`SOFT_KNEE=8.0`）与 :82-98（`softSaturate100`：|x−15|≤8 恒等返回原值，边界外指数软渐近）；套件实证 `tests/suites/m2-jacobian-archetypes-ca.suite.js:187`（末态各维偏离 S_eq 最大 0.9150 < 5 收敛邻域）、:190（总距离较脉冲后严格衰减 4.173<12.500，阻尼收敛证据）。

**d) 戏剧导演 A=0.75 reset 与公式宽限期并存**：46 号 Task 3.5 的 catharsis 结算把 A 精确回落 0.75，而 45 号公式 A=1+0.0035×adaptDays 在 adaptDays=−50 时给出 0.825，两者表面矛盾；裁决为「结算瞬间 A=0.75 硬复位 + 90 游戏日宽限期内锁 0.75 + 期满恢复公式推导」，两机制并存。实现：`src/simulation/dramaDirector.js:61`（`CATHARSIS_ADAPTATION=0.75`）、:63（`RECOVERY_GRACE_TICKS=2160`，90 游戏日）、:154（`stepDramaAdaptationDaily` 宽限锁）；套件实证 `tests/suites/m3-space-opera-drama-director.suite.js:551-553`（宽限期内 graceLocked=true、A 恒 0.75、期外推导值 0.825）与 :556-557（期满恢复公式值）。

**e) OPERA_RESOURCE_KEYS 8 槽映射**：42 号 §二.4 战略资源列举 6 类核心物资，44 号 Task 1.1 的 `colony.stockpile` 布局为 8 槽（含消费品与例外槽）；裁决为 8 槽容器 + 前 6 槽战略资源索引映射。实现：`src/domain/planets/planetStateSchema.js:106-112`（`OPERA_RESOURCE_KEYS` 8 槽冻结表）与 :114（`STRATEGIC_RESOURCE_INDEXES=[0..5]` 6 战略槽）；套件实证 `tests/suites/m1-situation-planet-core.suite.js:323-328`（S4 短缺锚定 alloy 槽 stockpile[3]）。

**f) 45 号 mermaid 示意值以矩阵常量为准（S4 +5.0 非 +5.5）**：45 号架构图 mermaid 中 S4 月增速示意值 +5.5 与总纲 §二.4 的 `+5.0×clamp(r,0.1,1.0)` 口径冲突；裁决以 42 号总纲与冻结矩阵常量为唯一权威、mermaid 示意值不作实现依据。实现：`src/domain/economy/shortageSituationArc.js:129`（`S4_DELTA_MAX_PER_MONTH=5.0`）；矩阵权威 `src/simulation/jacobianCoupling.js:51-60`（`JACOBIAN_7X7` 冻结 49 元素）+ `tests/suites/m2-jacobian-archetypes-ca.suite.js:160-164`（与 45 号文档矩阵逐位一致断言，传导幅值 +7.0/+1.68/+0.4368 全部由矩阵常量推出，见 :216-222）。

**g) 16 原型 themeKeys→planetThemes 真实键名映射表**：42 号 §四.5 的 16 原型叙事主题名为概念名，直接用作渲染主题键会命中不存在的 `PLANET_THEMES` 键；裁决建立概念键→真实键映射表并在 import 期做完整性自检。实现：`src/content/planetaryArchetypes.js:6-24`（映射说明与 `import { PLANET_THEMES }` 自检声明）、:35-212（16 项 `themeKeys: [主, 副]` 真实键配置，如 :40 `['obsidian_lava','fractured_moon']`）、:238-265（`ARCHETYPE_THEME_MAPPING_NOTES` 冻结映射裁决记录）；套件实证 `tests/suites/m2-jacobian-archetypes-ca.suite.js:295-318`（16 星基线修正全命中）。

**h) 信标/危机命名避让（SOS/crisis_automata 占用）**：工程既有机制已占用 `SOS`（`src/app/commands.js:1149`，SPEC-39 SOS 求救信标处置命令）与 `crisis_automata`（`src/domain/events/crisis.js:29-30`、`src/content/anomalies.js:75/:146` storyTag）；裁决新信标流与新终局天灾采用正交命名空间，不复用也不遮蔽既有名。实现：`src/domain/world/subspaceBeaconStream.js`（信标以 `kind: NARRATIVE|OPPORTUNITY` + 四频段命名，:51-88）；`src/domain/diplomacy/galacticSenateAndCrisisArc.js:113-118`（`ENDGAME_CRISIS_KINDS=['PRETHORYN','UNBIDDEN','CONTINGENCY']`，注释明示与 legacy crisis_automata/crisis_rift 命名空间正交）。

**i) UI 交付形态（ViewModels spaceOperaView + SnapshotBuilder 守卫透传 + DiagnosticsView 态势节）**：42 号要求蝴蝶效应因果链可感知，但通读总纲无「独立 WebGL 因果链渲染管线」的硬性条款；裁决以只读数据投影 + 诊断态势节交付，WebGL 专项渲染列入遗留风险（见第六节）。实现：`src/simulation/ViewModels.js:477`（`spaceOperaView(world)` 只读投影，严禁改写领域态）、`src/simulation/SnapshotBuilder.js:41-43`（`if (world.spaceOperaState)` 守卫透传——金快照世界快照结构逐位不变）、`src/ui/screens/DiagnosticsView.js:45-61`（「太空歌剧态势」只读小节：systemVector 七维条/张力与适应/活跃局势表/因果链尾 4 条）。

**j) 阶段注册静态接线重构（SpaceOperaWiring.js 唯一注册点）**：早期实现存在两类打包产物级缺陷——(1) `HourlySystems.js` 顶层 await 在单 IIFE 静态打包产物中为**语法错误**；(2) `SpaceOperaClock / jacobianCoupling / dramaDirector / situationEngine / archetypeMechanics / galacticParagons` 六处游离动态 `import(...).then(...)` 链在打包产物中变为相对说明符 **404 静默降级**（阶段注册丢失）。裁决：废除上述形态，收敛为 `src/simulation/SpaceOperaWiring.js` 唯一注册点，全部静态 import。实现：`SpaceOperaWiring.js:9-12`（hourly 'space-opera' 恒最后 + monthly 序 'space-opera-monthly'→'space-opera-jacobian'→'space-opera-drama'）、:18-33（静态 import + registerHourly/registerMonthly）；`src/simulation/HourlySystems.js:225`（顶层 await 废除说明）；`src/simulation/SpaceOperaClock.js:343`、`src/simulation/dramaDirector.js:33/:487`（动态 import 链废除说明）。复验（本会话实跑）：SPACE-OPERA-00/M1/M2/M3 与 REG-01 各 3 轮全 PASS（见 §1.2 表），`build-static-bundle --rebuild` 185 模块 + `node --check` exit=0。

**k) 构建产物 node --check exit=1 修复实证**：静态接线重构前的产物曾 `node --check` exit=1（顶层 await 语法错误）；修复后本会话实跑 `node tests/tools/build-static-bundle.mjs --rebuild` 输出「打包完成：dist\void-frontier.bundle.js（185 个模块，2661 KB）」，随后 `node --check dist/void-frontier.bundle.js` **exit=0**。修复实证 = 上述两条命令输出（本会话终审复验记录）。

---

## 五、42 号总纲终审结论（审计 findings 全量列出）

总纲合规终审由「总纲合规审计员」（初审）→「总纲整改工程师」（整改）→「总纲合规审计员-复核」（复审）三段闭环完成，以下为 findings 全量记录（初审 5 项 = 2 high + 2 medium + 1 low；整改后复核余 1 项，**high/medium 残留 0**）。

### 5.1 初审 findings（5 项）

| # | 级别 | 位置 | 差异 | 总纲出处 | 处置 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **high** | `src/domain/planets/sparseFrontierCA.js:417` | 稀疏前沿 CA 完整落地（frontierMask[8] 位图 API + 四类相变规则 + seedFrontierRing 24 前沿位）但全库零生产调用：stepSparseFrontierCA/seedFrontierRing 唯一引用点为测试套件，`SpaceOperaClock.stepSlowPlanets` 与 `archetypeMechanics.stepArchetypeMechanics` 均未调用——活体流程中菌毯/熔岩/冰盖/晶格四规则永不演化，42 号 §六.3 慢速时钟 CA 演化在活体流程缺位 | 42 号 §六.3「慢速时钟…8 维环境向量漂移与稀疏前沿 CA 演化」；§四.1 地表覆盖物经元胞自动机局部相变 | **已整改**：`src/simulation/SpaceOperaClock.js:235-246` 慢桶内首访播种 24 前沿位 + 逐星 stepSparseFrontierCA；新增 CHK-M2-07（`tests/suites/m2-jacobian-archetypes-ca.suite.js:39`/:493-560） |
| 2 | **high** | `src/domain/diplomacy/galacticSenateAndCrisisArc.js:426`（startEndgameCrisis）/ :1063（onLeviathanDefeated） | 三大终局天灾与巨兽凯旋大游行全库零调用、实战永不触发；ManageLeviathanParade 命令因局势恒不存在而恒静默 | 42 号 §二.7 第三/四幕「多维终局天灾」「巨兽凯旋大游行局势」；§七.3 M3 | **已整改**：有机触发检定（常量 :141-147：month≥120/占比≥25%/逐月 8%/24 月冷却；`stepEndgameCrisisOrganicTrigger` :1184-1217，经 `stepGalacticSenateMonthly` :1219 消费）+ `src/domain/ground/planetaryThreat.js:26/:166/:187` `reportLeviathanDefeated` 直连 `onLeviathanDefeated`（eventBus 监听路径保留，双路径幂等收敛）；新增 CHK-M3-08（m3 suite:615-702） |
| 3 | **medium** | `src/domain/diplomacy/galacticSenateAndCrisisArc.js:267` 等 | S7 第二幕玩家交互层休眠（signCommission/adjustChoamShares/adjustLandsraadStanding/暗杀等零调用者）且宪章法案投票机制缺失 | 42 号 §二.7 第二幕「议会支配宪章（Charters）投票、垄断 CHOAM 股份、特工暗杀」；§七.3 M3 | **已整改**：兰兹拉德宪章法案表决弧（`LANDSRAAD_BILL_KINDS` 三宪章 :317 起、`proposeLandsraadBill` :359、`settleLandsraadBillMonthly` :423-544：standing 加权票权 ×CHOAM 分红 ×禁运杠杆，通过落 SANCTION/SUBSIDY/MANDATE、否决 standing−2 反弹）+ 十条 S7 命令（`src/app/commandsSpaceOpera.js:545-640`，SPACE_OPERA_COMMANDS 18 条冻结契约未动）；新增 CHK-M3-09（m3 suite:704-800） |
| 4 | **medium** | `src/domain/characters/galacticParagons.js:330` 等 | 群像英雄实战成长钩子休眠：grantBattleXp/grantGroundXp/grantBuildXp/grantScientistXp/traumaCheck/applyLegendaryParagon/hireEnclaveMentor/attackEnclaveConsequence 全库零外部调用者 | 42 号 §五.2「太空战役 +5XP/陆战 +100XP 持续成长…创伤…传奇英雄」；§七.3 M3 | **已整改**：`src/domain/combat/BattleSimulation.js:236/:246-247`（finishBattle → grantSpaceBattleParagonXp）、`src/domain/ground/GroundMission.js:45/:1881`（finishMission → grantGroundMissionParagonXp）、`src/domain/planets/colony.js:337`（竣工 grantBuildXp）、`src/domain/exploration/archaeologyArc.js:152/:240-246`（首席科学家晋幕 XP + 高危灾难 traumaCheck）、`src/app/commands.js:1000-1011`（AppointOverseer 换任 → political_dismissal 创伤检定）、`src/domain/characters/galacticParagons.js:1229/:1256-1309`（传奇 TUBOREK@60 月龄/THE_BEHOLDER@120 月龄错峰确定性抵达 + 一次性不复活）；新增 CHK-M3-10（m3 suite:802-964） |
| 5 | **low** | `src/simulation/jacobianCoupling.js:31-33` | 头注释沿引 45 号 §Task 2.1 §3 的特征值清单（λ1=−0.7513、λ2,3=−0.5097±0.0466i、λ4,5=−0.4796±0.2995i、λ6,7=−0.3750±0.2198i），与该文件实际冻结矩阵 JACOBIAN_7X7 的实测谱（−0.878021/−0.730101/−0.641354/−0.319221/−0.037037/−0.432133±0.274185i，|λ|=0.5118 锚点吻合）不符——经 Faddeev–LeVerrier 特征多项式 + Durand-Kerner 求根交叉验证（残差 1e-16 级），声称清单非本矩阵之谱；**赫尔维茨实质要求（全 7 特征值实部严格为负 + S_eq 精确不动点 + 阻尼振荡收敛）实测全部成立**，属注释级事实错误、零行为影响 | 42 号 §三.1「全部 7 个特征值…模长 0.5118…所有特征值实部均严格小于 0」 | **残留（low）**：按复核建议选项 B 登记于本报告裁决记录；不改冻结矩阵常量与运行时行为（复核后维持不改的依据：特征值数值仅存在于注释，矩阵常量本身与 45 号文档逐位一致且门禁收敛断言全绿） |

### 5.2 整改与复核结论

- 整改轮：4 项 high/medium 全部由「总纲整改工程师」按 42 号总纲整改（实现接入而非改门禁口径），并同步新增套件断言 CHK-M2-07 / CHK-M3-08 / CHK-M3-09 / CHK-M3-10（`tests/suites/m2-jacobian-archetypes-ca.suite.js:39`、`tests/suites/m3-space-opera-drama-director.suite.js:35-39`）。
- 复核轮：复审仅余 1 项 **low**（上表 #5），复核门禁卡记录「总纲复核 passing，复核后剩余 1 项记录」。
- **对台账的影响**：high/medium 残留为 0，故四份执行卷 §3 全部 25 项 CHK 均满足勾选前提；low 残留项不阻断任何门禁项，已在 §四/§5.1 如实登记。
- 整改后复验分层记录（证据来源分层注明）：
  - **本验收会话直接实跑**：SPACE-OPERA-00 / M1 / M2 / M3 / REG-01 各 3 轮全 PASS（§1.2 表）+ `build-static-bundle --rebuild`（185 模块）+ `node --check` exit=0；
  - **本轮编排层终审复验（workflow db 报告卡）**：`FULL-REGRESSION(终审) passing — 70 套件 × 3 轮 exit=0`、`BUILD-BUNDLE(终审) passing — exit=0`、`BUNDLE-CHECK(终审) passing — exit=0`；
  - **整改工程师会话自验（ask 返回清单）**：SPACE-OPERA-00/M1/M2/M3 + REG-01 + SURF-01 各 3 轮 PASS、static-audit 无违规、全量 70 套件×3 轮=210/210 PASS / DRIFT 0；
  - **前序 run（dwfrun-4c78c075，M3 阶段）**：static-audit exit=0（编排层实跑记录）。

---

## 六、遗留风险与建议

1. **`npm run test:cdp` 浏览器实测未接入**：本阶段全部门禁为纯 Node 确定性管线（run-suites 三轮对拍 + static-audit + bundle 构建检查），CDP 浏览器端到端播放（真实 WebGL 上下文、真实 UI 交互）未在本阶段执行。建议下一阶段按 doc28/doc39 的 CDP 播放骨架把 SPACE-OPERA 系门禁的 UI 侧（DiagnosticsView 态势节渲染、spaceOperaView 投影）接入浏览器实测。
2. **WebGL 因果链专项渲染未做**：42 号无独立 WebGL 因果链渲染硬性条款（裁决 i），本阶段以 `ViewModels.js:477 spaceOperaView` 数据投影 + `DiagnosticsView.js:45-61` 态势节交付；三阶蝴蝶效应因果链目前为文本/表格呈现。建议后续版本做专项 GPU 因果链可视化（七维向量条 → 涟漪链动画）。
3. **jacobianCoupling.js:31-33 注释级特征值清单残留（low）**：头注释仍沿引 45 号文档的旧特征值清单，与矩阵实测谱不符（见 §5.1 #5）。零行为影响，建议下一次触碰该文件的改动顺带更正注释（或与 45 号文档 §Task 2.1 §3 一并勘误）。
4. **套件导入图依赖**：M3 套件的 CHK-M3-10 依赖 `AppointOverseer` 命令注册，该命令注册于 `src/app/commands.js:987`（由 `tests/suites/index.js` 全量聚合导入的其他套件文件带副作用注册）。经 `run-suites.mjs` 正式管线（全量导入图）三轮 PASS 无虞；但若将来把该套件从全量图中拆出单跑，需在套件内补 `import '../../src/app/commands.js'` 副作用导入，否则会因命令未注册出现假失败（本会话以 `node -e` 半图复现过该现象，属测试编排事项、非产品缺陷）。
5. **「断言数」口径说明**：§1.2 的断言数为套件源文件静态调用点计数（48/80/126/237），循环内断言的实际运行时执行次数高于该值（如 CHK-M2-03 的 300 星循环、CHK-M3-04 的 1000 帧循环）；REG-01 无 assert 调用、以哈希等值判定为准。建议后续在 run-suites 汇总中引入运行时断言计数器，使口径唯一。

---

## 附：本会话实跑命令清单（证据可复现）

```
node tests/tools/run-suites.mjs --id=SPACE-OPERA-00   # PASS 3/DRIFT 0（772.8/625.0/556.8ms）
node tests/tools/run-suites.mjs --id=SPACE-OPERA-M1   # PASS 3/DRIFT 0（317.5/252.2/177.7ms）
node tests/tools/run-suites.mjs --id=SPACE-OPERA-M2   # PASS 3/DRIFT 0（65.2/50.3/36.5ms）
node tests/tools/run-suites.mjs --id=SPACE-OPERA-M3   # PASS 3/DRIFT 0（10206.5/8593.5/8614.8ms）
node tests/tools/run-suites.mjs --id=REG-01           # PASS 3/DRIFT 0（11895.6/9370.1/12372.1ms）
node tests/tools/build-static-bundle.mjs --rebuild    # 185 模块，2661 KB
node --check dist/void-frontier.bundle.js             # exit=0
```

（全部在 `[REDACTED]`、Node v22.20.0 下执行。）
