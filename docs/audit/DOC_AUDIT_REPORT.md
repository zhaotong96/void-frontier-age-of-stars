# VOID FRONTIER 文档一致性审计报告

## 0. 状态块

- 当前阶段：`completed`（审计 12 批全部竣工；本报告仅记录问题与建议，**全部整改动作（合并/重写/删除/移动/改名）未经人工确认不执行**）
- 批次游标：无（批 1–12 全部完成）
- 已完成批次：批 1 根元文档｜批 2 ARCHITECTURE↔src｜批 3 DATA_SCHEMA↔序列化｜批 4 SAVE_FORMAT↔存档｜批 5 GAME_RULES↔领域规则｜批 6 TEST_MATRIX↔测试资产｜批 7 RUNBOOK↔agent/smoke｜批 8 specs 1–20｜批 9 specs 21–40｜批 10 audit/reports｜批 11 digest｜批 12 术语总扫
- 待确认项：Q1–Q7（见 §7）
- 最后更新时间：2026-11-11（批 10/11/12 落盘 + 终稿）

## 1. 审计摘要与索引

- 审计对象：根元文档 6 类、docs/ 顶层权威文档 6 份、docs/specs/ 编号规格 39 份（1–31、33–40，32 缺失）、docs/audit/ 7 份、docs/reports/ 报告 13 份 .md + 运行日志（仅作证据）、docs/digest/ 3 份。
- **已确认问题（累计）：64 条**（META 10、ARCH 10、DATA 7、SAVE 6、GAME 6、TEST 5、RUNBOOK 4、SPECS 7、AUDIT 2、REPORTS 3、DIGEST 2、TERM 2；其中 P1×19、P2×28、P3×17，见 §4）。
- 偏离设计（累计）：1 条待确认（DEV-01，见 §5）。
- **核心结论**：六份 docs/ 顶层权威文档与 README/ci.yml 全部冻结于 2026-11-03–11-07 区间，此后六波演化（specs 15–40，v0.2→v1.0→测试工程→SPEC-39/40）几乎未回写，形成「代码前进、文档停摆」的系统性漂移；架构/数据/规则/测试四份权威文档的时效性均需整体刷新而非局部修补。specs 体系存在编号治理缺陷（32 实体丢失、33/34 编号冲突、spec9 全副本、状态标注缺失）。
- 三条最有价值的单点发现：① invariant ENTITY_COLLECTIONS 缺 objectives（代码缺陷线索，DATA_SCHEMA 声称的同步关系失效）；② registerMigration(2, migrate_v2_to_v3) 在 load 管线不可达（v2→v3 迁移永不自动执行，仅测试直调）；③ spec 32 被下游实体引用但文件不存在（非有意跳号）。
- 索引：§2 计划与权威顺序｜§3 文档地图｜§4 问题清单｜§5 偏离清单｜§6 整理计划｜§7 待确认决策｜§8 材料缺口｜§9 分批记录｜§10 变更日志。

## 2. 审计计划（含排除项与权威顺序）

**权威顺序（从高到低，任务书原文采纳）：**
1. src/ 与 tests/suites/、tests/e2e/（实现与测试事实源）
2. docs/ARCHITECTURE.md、DATA_SCHEMA.md、SAVE_FORMAT.md、GAME_RULES.md、TEST_MATRIX.md、AUTONOMOUS_RUNBOOK.md
3. CHANGELOG.md
4. docs/specs/1–40（32 缺失）
5. docs/audit/（已裁决结论）
6. docs/reports/（过程记录，仅证据）
7. docs/digest/（摘要，仅索引）
8. README.md、LICENSE、THIRD_PARTY_NOTICES.md
9. 根 report.md、a.txt（定位未明；a.txt 实际不存在，见 §8）

**排除项（不纳入审计对象）：** .smoke/chrome-*-profile/**、dist/**、tests/fuzz/dumps/**、tests/regression/golden.json（仅证据）、docs/screenshots/**、*.log（仅证据）、void-frontier-age-of-stars.7z、.gitignore、.nojekyll、.test-run.log、404.html、favicon.svg、styles.css。docs/specs/ 文件名乱码不视为内容缺失，文件名编码问题单列「文件命名规范」类型（SPECS-FILENAME 模块）。

**批次计划：** 批 1 根元文档✅ → 批 2 ARCHITECTURE↔src → 批 3 DATA_SCHEMA↔序列化 → 批 4 SAVE_FORMAT↔存档实现 → 批 5 GAME_RULES↔领域规则 → 批 6 TEST_MATRIX↔测试资产 → 批 7 AUTONOMOUS_RUNBOOK↔agent/smoke 资产 → 批 8 specs 1–20↔CHANGELOG/audit → 批 9 specs 21–40↔当前实现 → 批 10 audit/reports 一致性 → 批 11 digest 一致性 → 批 12 跨文档术语/编号/版本总扫。

**超大文件抽样声明（证据完整性）：** docs/specs/ 中 2、3、5、7、8、14、17、24、33、34 共 10 份单文件 500KB–1.2MB（合计约 7MB），全文逐字审计不可行且无必要（其权威性低于 CHANGELOG 与已裁决 audit）。审计策略：读取头部目录/章节标题/状态标注/验收门禁清单，配合关键断言定点抽查，配合 docs/digest/doc5-digest、doc7-digest 的既有摘要交叉印证；凡未经全文核验的结论一律降级为「待确认」并在 §8 声明。

**Issue ID 规范：** `ISSUE-{模块}-{类型}-{证据hash前8位}`；hash 为冲突双方断言串接文本的 SHA-1 前 8 hex。

## 3. 文档地图

| 文档 | 类型 | 模块/主题 | 版本/更新时间 | 权威等级 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| README.md | 元文档 | 快速开始/脚本/部署 | 2026-11-05 | 8 | 过时 | 套件数 34、轮数 ×2、脚本清单与 package.json 脱节（ISSUE-META-与代码/测试不一致-388ddc86/3b17ffc3） |
| CHANGELOG.md | 元文档 | 版本事实源 | 2026-11-11 | 3 | 活动 | 缺 v0.4/doc19、docs31-35、SPEC-40 条目（ISSUE-META-缺失证据/版本矛盾-ae2d56eb/1aa5d91d/e87622cb） |
| LICENSE | 元文档 | MIT 许可 | 静态 | 8 | 有效 | 内附第三方素材说明段 |
| THIRD_PARTY_NOTICES.md | 元文档 | 资产原创性声明 | 静态 | 8 | 局部过时 | 「音频如后续加入」与 AudioManager 现实矛盾（ISSUE-META-过时-01ee7cbf） |
| report.md（根） | 待确认 | SPEC-39/40 施工实时日志 | 2026-11-11 | 9 | 活动 | 与 docs/reports/report.md 同名异文（ISSUE-META-重复冗余/文件命名规范-8e623e11） |
| a.txt（根） | 待确认 | 未知 | — | 9 | 不存在 | 工作树与全 git 历史均无（§8 缺口 G-01） |
| docs/ARCHITECTURE.md | 权威设计 | 架构 | 2026-11-03 | 2 | 大面积过时 | §1/§2/§3.3/§5 与 src/ 现状脱节；10 条问题（ISSUE-ARCH-*） |
| docs/DATA_SCHEMA.md | 权威设计 | 数据模型 | 2026-11-03 | 2 | 大面积过时 | schemaVersion 1 vs 代码 2；集合/字段表缺 v2/v3 增量；7 条问题（ISSUE-DATA-*） |
| docs/SAVE_FORMAT.md | 权威设计 | 存档格式 | 2026-11-03 | 2 | 大面积过时 | schemaVersion 1/无迁移/TabGuard 未实现/captureCheckpoint 缺失四连失效；6 条问题（ISSUE-SAVE-*） |
| docs/GAME_RULES.md | 权威设计 | 游戏规则 | 2026-11-03 | 2 | 冻结于 v0.1 | 机制数值抽查一致但 v0.2–v1.0 五波规则整块缺失；胜利/和谈声明失效；7 条问题（ISSUE-GAME-*） |
| docs/TEST_MATRIX.md | 权威设计 | 测试矩阵 | 2026-11-03 | 2 | 大面积过时 | 22 套件口径 vs 实际 66；GROUND/WORLD 行失效；缺 e2e/agent/fuzz/soak 章节；基线 8be8ce2c；5 条问题（ISSUE-TEST-*） |
| docs/AUTONOMOUS_RUNBOOK.md | 权威设计 | 自治运行手册 | 2026-11-07 | 2 | 冻结于终审返工 | 状态止于 2026-11-07 docs10/11；CDP/agent/smoke 资产零记载；遗留问题 3 项已清偿未更新；4 条问题（ISSUE-RUNBOOK-*） |
| docs/specs/1–9 | spec | 任务书/rework 系列/审美规范 | 2026-11-02~07 | 4 | 待批 8 审 | 2、3、5、7、8 为 500KB+ 大文件，抽样策略见 §2 |
| docs/specs/10–17 | spec | 终审验收/返工/调研/架构 | 2026-11-07 | 4 | 待批 8 审 | 14、17 为 680–890KB 大文件 |
| docs/specs/18–22 | spec | v0.2/v0.4/v0.6/v0.8/v1.0 施工方案 | 2026-11-07 | 4 | 待批 8 审 | 已实现（CHANGELOG 有对应条目，除 v0.4 缺条目） |
| docs/specs/23–28 | spec | 全生命周期测试工程 | 2026-11-08 | 4 | 待批 9 审 | 24 为 710KB |
| docs/specs/29–31 | spec | 测试验收/终审收口 | 2026-11-09 | 4 | 待批 9 审 | 31=GATE-10..14 |
| docs/specs/32 | spec | — | — | 4 | 缺失 | 编号断档，是否有意待确认（批 9） |
| docs/specs/33–35 | spec | 长线创新调研/施工计划 | 2026-11-09 | 4 | 待批 9 审 | 33、34 为 1.2MB/913KB |
| docs/specs/36–40 | spec | 回归规范/行星地表/UI 缺陷 | 2026-11-10~11 | 4 | 待批 9 审 | 38=72KB、39/40 最新施工规范 |
| docs/audit/7 份 | audit | 验收审计/整改指令/委托书 | 2026-11-04~07 | 5 | 有效但需标注 | 裁决链闭环（9.2→9.6→7.4→9.8→6.4→9.9→9.7）；ACCEPT 9.6 被后轮撤回未标注；spec9 全副本在内；3 条问题（AUDIT 2 + 副本 1） |
| docs/reports/*.md 13 份 | report | 施工/验收报告 | 2026-11-04~11 | 6 | 有效 | 双 report.md 之一；qa-lifecycle 为记忆文件混入；T6 台账缺失；GPU 环境漂移；4 条问题（REPORTS 3 + META 1） |
| docs/reports/*.log 19 份 | 过程记录 | 运行日志 | 2026-11-09~11 | 仅证据 | 排除审计对象 | spec31/35/39 门禁日志 |
| docs/digest/doc5-digest.md | digest | spec5 摘要 | 2026-11-07 | 7 | 与源一致 | 头部抽查与 spec5 一致，无漂移 |
| docs/digest/doc7-digest.md | digest | spec7 摘要 | 2026-11-05 | 7 | 定位风险 | 「免读原文即可开工」自述与 digest 权威定位冲突 |
| docs/digest/master-plan.md | digest | 总计划索引 | 2026-11-05 | 7 | 过期未标注 | 冻结于 52/52·5ac0ed56 时代，Wave 计划已全部竣工 |

## 4. 问题清单

| ID | 类型 | 严重度 | 置信度 | 文档A位置与断言 | 冲突对象/文档B位置与断言 | 冲突说明 | 影响 | 建议动作 | 需确认人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ISSUE-META-与代码/测试不一致-388ddc86 | 与代码/测试不一致 | P2 | 高（代码实数） | README.md:31、:52「全部 34 个自动化测试套件」「34 套件 × 2 轮 = 68 项」 | tests/suites/index.js `collectSuites()` 实测 66 套件；tests/tools/run-suites.mjs:28 默认 REPEAT=3 轮 | 套件数 34→66、轮数 ×2→×3 双重过时 | 新读者对测试面规模误判；诊断面板描述失真 | 保留/重写 README 测试口径（66 套件 × 3 轮 = 198 轮次） | 项目负责人 |
| ISSUE-META-过时-6ed0f64d | 过时 | P2 | 高 | .github/workflows/ci.yml:6-7「npm test = 21 套件 × 2 轮…整轮约 2–3 分钟」 | 同上：实际 66 套件 × 3 轮；run-suites.mjs v2.0 | CI 注释口径过时 | CI 时长预期失真 | 重写 ci.yml 注释 | 项目负责人 |
| ISSUE-META-缺失证据/版本矛盾-ae2d56eb | 缺失证据/版本矛盾 | P1 | 高 | CHANGELOG.md 全文无 v0.4/doc19 行星工业条目（grep 无 planetaryLogistics/catapult/doc19/v0.4 特性条目） | git 提交 467a4d4「feat(v0.4): doc19 planetary industry & space-ground logistics」；docs/specs/19_v0.4… 施工方案 | CHANGELOG 自称版本事实源，v0.4 里程碑缺失 | 版本事实链断裂，specs↔CHANGELOG 映射缺口 | 补充 v0.4 Added 条目（依 467a4d4 与 spec19） | 项目负责人 |
| ISSUE-META-缺失证据-1aa5d91d | 缺失证据 | P1 | 高 | CHANGELOG.md 无 docs 31–35（GATE-10..14、长线创新收口）条目 | docs/specs/31_…收口施工方案；docs/reports/report-spec333435-longline-final.md（spec31 GATE-10..14 结论） | docs31-35 施工批次无 CHANGELOG 记录 | specs31-35 时效判定缺版本锚点 | 补充条目或注明「以 docs/reports 为准」 | 项目负责人 |
| ISSUE-META-缺失证据-e87622cb | 缺失证据 | P2 | 中 | CHANGELOG.md 顶部仅记「SPEC-39 Phase S1~S4」「六项 UI/浏览器缺陷」，无 SPEC-40 全量回归/终版记录 | docs/specs/40_…全流程全量回归测试规范；docs/reports/report-spec39-full-regression-final.md 已存在 | SPEC-40 执行结果未进 CHANGELOG（施工可能尚未收尾，根 report.md:147 T5 进行中） | 若 SPEC-40 竣工后仍不记则断链 | SPEC-40 收尾时补条目 | 项目负责人 |
| ISSUE-META-过时-01ee7cbf | 过时 | P3 | 高 | THIRD_PARTY_NOTICES.md:13「音频（如后续加入）全部为原创制作或程序化合成」 | CHANGELOG.md:178「18 主题环境音 AudioManager.setAmbientTheme」；src/render/AudioManager.js 存在且被 src/app/App.js、src/ui/screens/GroundView.js 引用 | 音频已实装，声明仍写「如后续加入」 | 资产声明与实物脱节（合规方向无冲突，仅表述过时） | 重写该行 | 项目负责人 |
| ISSUE-META-过时-3b17ffc3 | 过时 | P3 | 高 | README.md:51-57 开发节仅列 test/lint:static/sim/golden:update/serve 五脚本 | package.json:8-20 另有 test:tier0..4、test:cdp、build:bundle、qa:full | README 脚本清单缺 6 项 | 分层测试与打包入口不可发现 | 补充或链接 package.json | 项目负责人 |
| ISSUE-META-重复冗余/文件命名规范-8e623e11 | 重复冗余/文件命名规范 | P2 | 高 | 根 report.md:1-5 自称「SPEC-39/SPEC-40 施工实时工作日志」（2026-11-10/11） | docs/reports/report.md（9.3KB，2026-11-04）为 rework2 时代施工日志，同名异文双位置 | 同名文件双位置，且 git 提交 91adaa2 曾「purge root report.md」后又重建 | 归属混乱：任务书将根 report.md 定为「疑似草稿/遗留」 | 人工裁决：根 report.md 归档改名入 docs/reports/ 或保留为活动日志并在 README 声明 | 项目负责人 |
| ISSUE-META-版本矛盾-0335621a | 版本矛盾 | P3 | 低（需裁决） | package.json:3「version: 0.1.0」+ CHANGELOG.md:6-7「当前项目处于 0.1.0 预发布阶段」 | CHANGELOG.md 内部与 specs 18–22 使用 v0.2/v0.4/v0.6/v0.8/v1.0 里程碑代号 | package 语义版本与内容里程碑代号并存未互链 | 外部集成方对成熟度误判 | 待确认：是否将里程碑映射进 package.json 或在 README 声明两套版本体系 | 项目负责人 |
| ISSUE-META-缺失证据-f0fee718 | 缺失证据 | P2 | 高 | 任务书 docs/audit/audit_task.md:10「根 README.md、CHANGELOG.md、LICENSE、THIRD_PARTY_NOTICES.md、report.md、a.txt」 | `find . -name a.txt` 无结果；`git log --all -- a.txt` 无任何历史 | 任务书声称的被审计对象 a.txt 不存在于工作树与全部 git 历史 | 任务书输入与实际仓库不符 | 见 §8 G-01；需人工确认是否任务书笔误或仓库外文件 | 项目负责人 |
| ISSUE-ARCH-与代码/测试不一致-4057a71c | 与代码/测试不一致 | P1 | 高 | ARCHITECTURE.md:235-244 §5「已知架构边界」三条：胜利条件未实现；多标签页防护未实现；characters/groundMissions/crises/tradeRoutes 无生产者 | src/domain/victory/victory.js（VICTORY_ROUTES/registerVictory/checkSoftFailure）+achievements.js；src/persistence/TabGuard.js（class 导出，App.js:100-105 集成，README.md:36-40 详述）；src/domain/characters/crew.js、ground/GroundMission.js、events/crisis.js、economy/tradeRoutes.js | §5「如实记录」三连全部失效；与 README 直接互斥（ARCH 说 TabGuard 未实现，README 说已实现并详述机制） | 交接工程师据 §5 会重做已实现功能/误判架构现状 | 重写 §5 边界清单 | 项目负责人 |
| ISSUE-ARCH-版本矛盾-7baf7ee5 | 版本矛盾 | P1 | 高 | ARCHITECTURE.md:3「适用版本：schemaVersion 1」 | src/domain/world/World.js:13 `SCHEMA_VERSION = 2`（v2 注释：主题/持久 POI/伴生天体/terrainEdits） | schema 头部版本声明落后一个版本 | 存档兼容性判断依据错误 | 更新为 schemaVersion 2 并注明 v3 容器状态 | 项目负责人 |
| ISSUE-ARCH-过时-cd5b9098 | 过时 | P2 | 高 | ARCHITECTURE.md:39-41 依赖图 domain 12 子目录；§2.2 表 15 文件 | src/domain/ 实际 20 子目录；新增 characters(1)/events(3)/ground(14)/industry(2)/planets/colonyGovernance.js/politics(1)/strategic(2)/victory(2)/economy+tradeRoutes.js+blackMarket.js/combat+subsystemsAndEw.js/exploration+precursorDag.js 约 30 文件 | v0.2–v1.0 五波内容演化未进架构文档 | 模块职责/依赖方向地图缺一大块 | §2.2 补表或链接 specs | 项目负责人 |
| ISSUE-ARCH-过时-9e2a2934 | 过时 | P2 | 高 | ARCHITECTURE.md:59-61、:132 渲染层仅列 GalaxyRenderer/SystemRenderer/BattleRenderer/CanvasManager/AudioManager 5 文件 | src/render/ 实际另有 GroundRenderer.js + gl/（15 文件：GLCore、PlanetSurface3D、PlanetTerrainMesh、BioFloraPass 等）+ meshes/（3）+ shaders/（3），共 22 文件未记录 | 渲染/模拟分离的关键描述缺失整个 GL 子树 | 架构评审覆盖不到渲染主干 | 补 §2.4 render 节 | 项目负责人 |
| ISSUE-ARCH-过时-cae4e344 | 过时 | P2 | 高 | ARCHITECTURE.md:170-182 每小时 8 阶段表（orders→…→ai） | src/simulation/HourlySystems.js 实际 9 个 registerHourly：orders/navigation/combat/exploration/production/research/diplomacy/**ground(:153)**/**trade-routes(:219)**（ai 阶段经 FactionAI 自注册） | tick 执行序表缺 ground/trade-routes 两阶段 | 确定性执行模型描述失真 | 更新 §3.3 表 | 项目负责人 |
| ISSUE-ARCH-过时-0ca8797a | 过时 | P2 | 高 | ARCHITECTURE.md:194-198「命令清单…（共 20 个）」 | src/app/commands.js 55 处 registerCommand + src/app/commandsLongline.js 16 处 ≈ 71 注册调用 | 命令面 20→71 未更新 | 命令层规模认知失真 | 改为数量级描述+指向代码 | 项目负责人 |
| ISSUE-ARCH-过时-a6bf2b2f | 过时 | P2 | 高 | ARCHITECTURE.md:130 content：resources 29/hulls 12/modules 37/buildings 34/technologies 76/anomalies 10 | 实测 RESOURCES 33/HULLS 13/MODULES 38/BUILDINGS 47/TECHNOLOGIES 80/ANOMALY_TEMPLATES 20；另有 policies 12/planetThemes 18/terrainProfiles 25/leviathans 4/precursors 5/missions 8/missionSites 8/events 34 未列 | 7 项计数漂移 + 11 个 content 文件未列 | 数值表入口全部失准 | 更新计数与清单 | 项目负责人 |
| ISSUE-ARCH-过时-d3dd7d51 | 过时 | P3 | 高 | ARCHITECTURE.md:131、:229「15 个视图」 | src/app/App.js:114-117 注册 16 视图（含 GovernmentView/GroundView/ChronicleView 等） | 视图数 15→16 | 低 | 更新计数 | 项目负责人 |
| ISSUE-ARCH-过时-6647b327 | 过时 | P3 | 高 | ARCHITECTURE.md:129、:134 app 4 文件、devtools 仅 scenarioFactory | src/app/ 另有 commandsLongline.js；src/devtools/ 另有 e2eGateTest.js、glGateTest.js | 长线命令注册器与两个门禁工具未记录 | 低 | 补清单 | 项目负责人 |
| ISSUE-ARCH-文件命名规范/冗余-ef7307b7 | 文件命名规范/冗余 | P3 | 高 | ARCHITECTURE.md 未提及 4 个空目录 | `find src -type d -empty`：src/domain/logistics、src/ui/accessibility、src/ui/panels、src/workers | 空目录遗留（git 不跟踪，疑打包/解包残留）；任务书背景却将 logistics/accessibility/panels/workers 列为存在模块 | 误导新读者以为有空实现 | 建议删除空目录（整改阶段） | 项目负责人 |
| ISSUE-DATA-版本矛盾-ce984144 | 版本矛盾 | P1 | 高 | DATA_SCHEMA.md:1 标题「World v1 数据模型」、:3/:14「SCHEMA_VERSION = 1」「schemaVersion 当前 1」 | World.js:13 `SCHEMA_VERSION = 2`（World.js:10-12 注释 v2 语义） | 权威数据模型文档声明落后一个 schema 大版本 | 迁移链判断/存档兼容性依据错误 | 全文升级到 v2 口径（含 v3 容器说明） | 项目负责人 |
| ISSUE-DATA-与代码/测试不一致-04856303 | 与代码/测试不一致 | P1 | 高 | DATA_SCHEMA.md:24「entities 16 个实体集合」、§3.13 四集合（characters/groundMissions/crises/tradeRoutes）「当前无生产者」 | World.js:38-56 实际 17 集合（多 objectives）；四个「预留」集合现分别由 crew.js/GroundMission.js/crisis.js/tradeRoutes.js 生产 | 集合数与生产者状态全错 | 实体模型认知失真 | 重写 §1/§3.13 | 项目负责人 |
| ISSUE-DATA-缺失证据-410dd3fb | 缺失证据 | P2 | 高 | DATA_SCHEMA.md 无 objectives 集合字段表 | World.js:50 `objectives: {}`；ids.js:20 `objective:'obj'` 前缀；生产者 planetPOI.js/objectives.js（CHANGELOG「WorldObjective 空间任务目标」） | doc7 新增的持久化目标实体无 schema 文档 | 实体契约缺失，跨引用不可核验 | 补 §3 字段表 | 项目负责人 |
| ISSUE-DATA-过时-d62f01bb | 过时 | P2 | 高 | DATA_SCHEMA.md:31「pendingChoices…当前无生产者」、:33「victory 占位，无写入方」、:53/:56/:59/:64 chr/gms/crs/trd「预留，无生产者」 | surfaceEvents.js resolveSurfaceDilemma 推送 pendingChoices（CHANGELOG:24）；victory.js 写入 routes/ended；crew.js/GroundMission.js/crisis.js/tradeRoutes.js 生产者均在 | 6 处「无生产者/无写入方」断言失效 | 数据流判断失真 | 逐项更新 | 项目负责人 |
| ISSUE-DATA-过时-ce4ab42b | 过时 | P2 | 高 | DATA_SCHEMA.md §3.3 planets 字段表止于 homeOfFactionId，无 planet.pois/terrainEdits/theme/celestials/weather/threat/soc/surfaceDelta | World v2 起 planet 承载 doc7 主题/POI/terrainEdits、doc18 surfaceDelta/xenobiology、doc20 weather/threat、doc21 soc、doc22 synergy 容器（migrate_v2_to_v3 五支柱容器） | 行星持久化字段面缺失约 8 组 | 存档体积/序列化契约不可核验 | 补 v2/v3 字段表 | 项目负责人 |
| ISSUE-DATA-与代码/测试不一致-1c840f59 | 与代码/测试不一致 | P2 | 高 | DATA_SCHEMA.md:79-80「集合清单同时被 src/core/invariant.js ENTITY_COLLECTIONS 复用」 | World.js:129-147 ENTITY_TYPES 17 键（含 objectives）vs invariant.js:30-34 ENTITY_COLLECTIONS 16 键（缺 objectives） | 文档断言的同步复用关系已失效；objectives 实体游离于不变量检查外（顺带代码疑点，移交负责人） | 文档契约失真 + invariant 覆盖缺口 | 更新文档并提请代码复核 | 项目负责人 |
| ISSUE-DATA-过时-1b0f4438 | 过时 | P3 | 高 | DATA_SCHEMA.md §2 ID 前缀表 26 行 | ids.js:20 已有 `objective: 'obj'` 前缀 | 前缀表缺 obj 行 | 低 | 补一行 | 项目负责人 |
| ISSUE-SAVE-版本矛盾-304c9685 | 版本矛盾 | P1 | 高 | SAVE_FORMAT.md:6-7「schemaVersion 当前为 1（World.js SCHEMA_VERSION），尚无历史版本」、:16 示例 `"schemaVersion": 1` | World.js:13 `SCHEMA_VERSION = 2` | 第三处 schema 版本声明失实（ARCH/DATA/SAVE 三文档同源错误） | 迁移判定依据错误 | 更新为 2 并补 v1→v2→v3 链说明 | 项目负责人 |
| ISSUE-SAVE-过时-2f69576c | 过时 | P1 | 高 | SAVE_FORMAT.md:85「当前状态：v1 为首个正式 schema，**未注册任何迁移函数**」 | MigrationRegistry.js:283 registerMigration(2, migrate_v2_to_v3)；v1→v2 迁移亦已注册（同文件 doc7 TASK-5.3 段）；tests/suites/save-migration.suite.js id SAVE-04 覆盖 | 迁移链现状与文档断言相反 | 存档升级路径认知失真 | 重写 §3 | 项目负责人 |
| ISSUE-SAVE-缺失证据/版本矛盾-421e8d80 | 缺失证据/版本矛盾 | P1 | 高 | SAVE_FORMAT.md:71 加载管线「migratePayload(payload, rec.schemaVersion → SCHEMA_VERSION)」 | SaveManager.js:63 实参 `migratePayload(rec.payload, rec.schemaVersion, SCHEMA_VERSION)`，SCHEMA_VERSION=2；registerMigration(2, migrate_v2_to_v3) 故 from=2 的迁移在 load 中**永不自动执行**；migrate_v2_to_v3 生产代码零调用（唯一调用点 tests/suites/playtest-gates.suite.js:1668-1669 测试直调）；CHANGELOG:114-116 自述「SCHEMA_VERSION 保持 2 以守金快照零漂移红线，v3 容器经直调迁移验证」 | v2→v3 迁移不可达这一关键架构事实（五支柱容器靠惰性 ensure/直调初始化）在 SAVE_FORMAT 与 DATA_SCHEMA 均未记录 | 历史存档载入后无五大支柱容器——若消费方未做惰性 ensure 将读档异常 | 见 Q7；文档补记迁移链设计决策（建议补 ADR） | 项目负责人 |
| ISSUE-SAVE-与代码/测试不一致-bcd348d1 | 与代码/测试不一致 | P1 | 高 | SAVE_FORMAT.md:129-138 §7 标题「多标签页策略——**未实现（如实记录）**」，「全仓 grep 无 BroadcastChannel 命中」 | src/persistence/TabGuard.js（BroadcastChannel 协调 + localStorage 心跳退化，README.md:36-40 详述；App.js:100-105 集成；save-roundtrip 等套件覆盖） | 断言与实现完全相反 | 交接者将重复实现已上线功能；§7 整节作废 | 重写 §7 为已实现说明 | 项目负责人 |
| ISSUE-SAVE-过时-2472f136 | 过时 | P2 | 高 | SAVE_FORMAT.md:140-149 §8 缺口表：SAVE-02 无套件/SAVE-04 无 fixture 无套件/captureCheckpoint 缺失致开局抛错/Database 退化仅内存 Map | tests/suites/save-roundtrip.suite.js id SAVE-02、save-migration.suite.js id SAVE-04（内联 voxels fixture）均已存在；SaveManager.js:23-30 captureCheckpoint 已实现（auto 槽降级语义）；Database.js:87 另有 localStorage 第三层降级（文档只写内存 Map 两级） | 已知缺口表 4 行全部失效 | 缺口清单误导整改方向 | 重写 §8 为最新缺口清单 | 项目负责人 |
| ISSUE-SAVE-与代码/测试不一致-43f12cd9 | 与代码/测试不一致 | P3 | 高 | src/persistence/SaveManager.js:5 头注释「自动保存采用『写入临时记录→完整写入成功后标记』的两段式」 | save() 实现（SaveManager.js:33-47）无任何 temp record 步骤；SAVE_FORMAT.md:100-101 与 :148 两处明确「两段式**尚未实现**」 | 代码头注释与实现及权威文档三方矛盾（以实现为准：未实现） | 低（注释误导） | 修注释或真实现两段式 | 项目负责人 |
| ISSUE-GAME-与代码/测试不一致-a5fd4ae7 | 与代码/测试不一致 | P1 | 高 | GAME_RULES.md:236-241 §12「胜利条件——**未实现（占位）**」，「没有任何代码写入 routes/ended」 | src/domain/victory/victory.js:13 VICTORY_ROUTES、:23 registerVictory、:97 checkSoftFailure + achievements.js；SeasonalSystems 年度胜利检查 | 第三处「胜利未实现」失效声明（ARCH §5、DATA_SCHEMA §1、GAME_RULES §12 同源） | 胜负条件认知失真 | 重写 §12 | 项目负责人 |
| ISSUE-GAME-过时-67b428a0 | 过时 | P2 | 高 | GAME_RULES.md:6、:228「76 项科技」 | TECHNOLOGIES 实测 80 | 科技计数漂移 | 低 | 更新计数 | 项目负责人 |
| ISSUE-GAME-过时-5bc133ba | 过时 | P2 | 高 | GAME_RULES.md:117「10 模板」（异常） | ANOMALY_TEMPLATES 实测 20 | 异常模板翻倍未记录 | 图鉴/调查规则认知偏差 | 更新 §5 | 项目负责人 |
| ISSUE-GAME-过时-5bfa5804 | 过时 | P2 | 高 | GAME_RULES.md:18-28 §2 资源表 29 种 | RESOURCES 实测 33：缺 contra_ai_core/contra_neuro_stim/contra_xeno_serum/contra_heavy_arms（违禁品 4 种，黑市体系） | 资源表缺违禁品族 | 经济/黑市规则不可查 | 补 4 行 | 项目负责人 |
| ISSUE-GAME-过时-68ebb448 | 过时 | P2 | 高 | GAME_RULES.md:194-195「和谈/占领当前未实现（peaceOffers/occupiedSystems 为预留字段）」 | src/app/commands.js:1254 registerCommand('ProposePeace')、:1274 registerCommand('AnnexOccupied')；war.js:46/:117 执行体 | 战争终局命令已实现（doc7 TD1-TD4 清偿） | 战争规则描述缺终局 | 更新 §8 | 项目负责人 |
| ISSUE-GAME-缺失证据-7c0bab9d | 缺失证据 | P1 | 高 | GAME_RULES.md:3 自述「只写当前代码真实实现的规则」；全文止于 v0.1 机制 | doc18-22/39 五波规则（气象五阶段/PTI 微分方程/殖民自治 Φ 方程/轨道五支援/异星生态/巨石遗迹/地表深度 SOS·热度/12 政策/船员经验）均无记载；§2/§3 表缺 4 资源 26 建筑（bld_shipyard…bld_quantum_lattice） | 与自述定位矛盾：当前实现规则远超文档记载 | 新读者据 GAME_RULES 理解规则将系统性过时 | 建议按内容支柱分章重写或声明版本冻结点 | 项目负责人 |
| ISSUE-TEST-过时-7ac1622c | 过时 | P1 | 高 | TEST_MATRIX.md:184「当前注册 22 个套件」；§3 清单 22 行 | tests/suites/index.js collectSuites()=66、44 个 suite 文件；22 个后建套件未入矩阵（playtest-gates GATE-02..09+IND-01..05、playtest-gate15-surface、ground-mission、celestial-bodies、save-migration、e2e-campaign-milestones、fuzz-stability、soak-inspection、gameplay-agent-loop、policy、terrain-field/edits、objectives-poi、theme-registry/expansion、planetary-terrain-theme、precursor-dag-lore、megastructure-elevator、grey-economy-smuggle、endgame-crisis-ascension、combat-tactical-v2、ground-playtest-physics） | 矩阵覆盖面与实际资产脱节一半 | 测试全景不可查 | 重写 §3 清单（建议改由 index.js 自动生成） | 项目负责人 |
| ISSUE-TEST-过时-2ba05253 | 过时 | P1 | 高 | TEST_MATRIX.md:154-156 GROUND-01/02/03 计划 ground-actions/ground-boss/ground-mission 均标 PENDING；:78 WORLD-02 行计划 world-lanes.suite.js（航路图） | ground-mission.suite.js:79/:139/:190 已建 GROUND-01/02/03；celestial-bodies.suite.js:60 实际占用 id WORLD-02（矩阵该 id 规划为航路图，天体属性原规划 WORLD-04/world-celestials） | PENDING 行失效 + WORLD-02/04 编号被实际套件错位占用 | 矩阵行↔套件映射失真 | 重排 §2.2/§2.8 行映射 | 项目负责人 |
| ISSUE-TEST-缺失证据-ea54d043 | 缺失证据 | P1 | 高 | TEST_MATRIX.md 全文无 tests/e2e、tests/agent、tests/fuzz、tests/soak 任何章节 | tests/e2e/（CampaignMilestoneRunner、stages/Milestone1Genesis..4Victory、MilestoneStateAssertions，断言 15/20/18/14 处）、tests/agent/（AutonomousGameplayAgent、FivePhaseActionDriver、StateAssertionInspector）、tests/fuzz/（StateMachineFuzzer、CommandMutator、ChaosRouteSurfer、BlackBoxCrashDumper、replayCrash）、tests/soak/（GalaxySoakSimulator、MemoryLeakDetector、EconomicEntropyAuditor、GalaxyProceduralSweeper）；对应套件 AGENT-LOOP/TRACE、FUZZ-STORM/REPLAY、SOAK-SIM/LEAK、E2E-CAMP/CHRON 已注册 | doc 25-28 建成的四类测试资产层整块未入矩阵 | Milestone1Genesis/2Combat/3Logistics/4Victory 验收标准在矩阵中不可见 | 增设 e2e/agent/fuzz/soak 章节 | 项目负责人 |
| ISSUE-TEST-过时-3c93f7b3 | 过时 | P2 | 高 | TEST_MATRIX.md:49-52、:178、:209 金快照基线 `d2ec8589 → 7ecd48dc 漂移待提交` | tests/regression/golden.json：hash `8be8ce2c`（updatedAt 2026-11-08，seed 24601×4320 tick） | 基线表述落后两次重基线（7ecd48dc→68462446→8be8ce2c） | REG-01 状态误读 | 更新基线史 | 项目负责人 |
| ISSUE-TEST-过时-20f32539 | 过时 | P3 | 高 | TEST_MATRIX.md:3-5、:19「PASS（2 轮）…每套件跑 2 轮」 | tests/tools/run-suites.mjs:28 REPEAT 默认 3 轮（v2.0 运行器） | 轮数口径 ×2→×3 | 低 | 更新口径 | 项目负责人 |
| ISSUE-RUNBOOK-缺失证据-4c7167f6 | 缺失证据 | P1 | 高 | AUTONOMOUS_RUNBOOK.md 全文 grep「CDP/run-cdp-playtest/agent-runner/campaign-e2e/smoke/s1-smoke/cdp-ab/cdp-probe/lm-part2/gv-opshud/gv-hud-patch」= 0 命中 | tests/agent/ 3 文件、tests/tools/agent-runner.html、campaign-e2e.html、.smoke/s1-smoke.mjs、cdp-ab.mjs、cdp-probe.mjs、lm-part2.js、gv-opshud.js、gv-hud-patch.py、tests/tools/run-cdp-playtest.mjs 全部存在（doc24-28 与 SPEC-39/40 时代资产） | Runbook 无任何 CDP/agent/smoke 运行步骤、依赖、超时、断言命令与产物路径记录 | 任务书批 7 对照面整块缺失；自治运行不可依 Runbook 复现 | 增设「CDP/Agent/Smoke 运行章」或链接 doc24/28 | 项目负责人 |
| ISSUE-RUNBOOK-过时-ae9e7b17 | 过时 | P1 | 高 | AUTONOMOUS_RUNBOOK.md:4「本文最后核对时间 2026-11-03（基于 a94eae6 与 22 套件×2 轮）」；§1 速览 42/44；尾部章节止于「终审返工轮（docs 10/11，2026-11-07）」 | 其后 docs 15-22（v0.2-v1.0）、docs 23-30（测试工程）、docs 31-40 六波演化均无记载；§1 自述「任务书 12.4 要求本文持续维护」 | 「持续维护」义务失效约 6 个里程碑批次 | 新会话据 Runbook 恢复将回退到 2026-11-03 状态 | 追加状态速览至当前 HEAD 91adaa2 | 项目负责人 |
| ISSUE-RUNBOOK-过时-2406c5b6 | 过时 | P2 | 高 | AUTONOMOUS_RUNBOOK.md:42 阶段 09「implemented（…和谈/占领缺失）」；§5 队列第 7 项 P2「战争终局…接入 war.js 预留字段」 | commands.js:1254/:1274 ProposePeace/AnnexOccupied 已注册；war.js:46/:117 执行体在位 | 战争终局已实现，两处仍标缺失 | 优先级队列误导 | 更新状态 | 项目负责人 |
| ISSUE-RUNBOOK-过时-bd3ecf1d | 过时 | P2 | 高 | AUTONOMOUS_RUNBOOK.md:97-99 已知问题 #9「stationIds 回填缺失——仍开放」；:80-83 #2「factionDamageMult 断链——仍开放」 | scenarioFactory.js:79-80 TD1 stationIds 确定性回填已实现；fleet.js:55 TD3 factionMods 已汇入 computeShipStats | 遗留问题清单两项已被 doc7 时代 TD1-TD4 清偿但未更新 | 问题清单失真 | 更新 §4 | 项目负责人 |
| ISSUE-SPECS-重复冗余-ceb6f947 | 重复冗余 | P2 | 高 | docs/specs/9_无垠边疆返工施工全套方案.md（25,400B） | docs/audit/REWORK_DIRECTIVES_FOR_EXECUTION_ENGINEER.md（25,400B），md5 均为 8baa4a08d86291135945a73a8d5a8b89，逐字节相同 | 同一文档在 specs 与 audit 双目录完整重复 | 修订时易单向漂移 | 裁决保留一处、另一处改指路文件或删除（整改阶段） | 项目负责人 |
| ISSUE-SPECS-版本矛盾-f2f8b642 | 版本矛盾 | P1 | 高 | docs/specs/33 头部自称「文档编号 SPEC-REPORT-033」 | docs/specs/34 头部**同样**自称「文档编号 SPEC-REPORT-033」（两份均响应 SPEC-MANDATE-032） | 两份独立调研报告共用同一编号 | 引用歧义（spec33/34 代号映射混乱） | 34 号改标 SPEC-REPORT-034（整改阶段） | 项目负责人 |
| ISSUE-SPECS-链接失效/缺失证据-d4d49364 | 链接失效/缺失证据 | P1 | 高 | docs/specs/32 文件不存在（`ls docs/specs | grep -c '^32_'` = 0） | docs/specs/35 头部引用「docs/specs/32_下一阶段长线开发内容与机制创新领域专家调研委托书.md」为输入；specs 33/34 均声明「响应委托书 SPEC-MANDATE-032」；spec 31 对 32 零提及 | 32 号是被下游文档实体引用的委托书，缺失属文件丢失而非有意跳号 | 调研链条 32→33/34→35 的源头不可考 | 人工确认是否归档于仓库外/7z 包；必要时从 35/33 头部重建引用说明 | 项目负责人 |
| ISSUE-SPECS-版本矛盾-01fe410d | 版本矛盾 | P2 | 高 | docs/specs/37、39、40 头部「所属版本：v0.2 ~ v0.6 深度演化（预研/落地/回归）阶段」 | 三份文件 2026-11-10 落盘，前置依赖 spec 31/35（v1.0 合龙后时代）；38 号与 report-spec39 均基线金快照 8be8ce2c（v1.0 后） | 版本标签与实际时序矛盾（疑模板复用未改） | 里程碑映射误读 | 修正为 v1.0 后时代表述 | 项目负责人 |
| ISSUE-SPECS-过时/规格治理-083a4b6c | 过时/规格治理 | P2 | 高 | specs 18–22、25–28 等施工方案竣工后无「已实现/已废弃」状态标注（21/27/37 状态词 0 命中；39 仅 2 处工单表内命中） | CHANGELOG 与 docs/reports 为唯一时效判据（任务书权威顺序第 4 条要求「结合 CHANGELOG 与 docs/audit 判定时效」） | 全系列 spec 无治理状态标记，时效只能外部推断 | 新读者无法就地判断 spec 是否已被实现/取代 | 新增 spec 头部状态标注规范（草稿/已实现/已废弃+日期） | 项目负责人 |
| ISSUE-SPECS-文件命名规范-50c8f44e | 文件命名规范 | P3 | 高 | docs/specs/4 文件名「4_VOID FRONTIER：专家诊断与长线演进调研报告.md」含半角空格 + 全角冒号 | 其余 38 份命名规范；git 存储 UTF-8 合法（`git ls-files` 八进制转义可正确解码为中文），乱码为查看环境显示问题（audit_task.md 背景所述「10–17 显示乱码」未在文件名字节层面复现） | 命名不规范（空格/全角标点）+ 显示层乱码观感 | 脚本兼容性/跨平台引用风险 | 统一 snake-case ASCII 命名（整改阶段） | 项目负责人 |
| ISSUE-AUDIT-直接矛盾/过时-6909350e | 直接矛盾/过时 | P2 | 高 | docs/audit/PROJECT_LEAD_ACCEPTANCE_AUDIT_REPORT.md（ACCEPT-AUDIT-…-01，9.6/10.0【卓越通过·准予正式竣工】，验收标的 commit f634828，落款 2026-11-05） | docs/audit/PROJECT_LEAD_PLAYTEST_AUDIT_REPORT.md（AUDIT-PLAYTEST-…-02，**7.4/10.0【准予整改重修·阻断投产上线】**，同一 commit f634828，指令 1「立即撤销准予投产结论」；mtime 2026-11-06） | 同一 commit 两份互斥裁决，后撤前；ACCEPT 文档无「已被撤回」标注 | 先读 ACCEPT 者误判通过状态 | 在 ACCEPT 头部加撤回标注（指向 PLAYTEST 与后续链） | 项目负责人 |
| ISSUE-AUDIT-与代码/测试不一致-5909b85a | 与代码/测试不一致 | P3 | 高 | docs/audit/MANDATE_DOMAIN_EXPERT_SECONDARY_ACCEPTANCE.md 引用 `src/views/GroundView.js`（L1410-1435 等）、`src/game/GroundMission.js` | 实际路径 `src/ui/screens/GroundView.js`、`src/domain/ground/GroundMission.js` | 已裁决结论中的代码路径错引 | 按图索骥失败 | 勘误路径（整改阶段） | 项目负责人 |
| ISSUE-REPORTS-缺失证据-b7817e33 | 缺失证据 | P2 | 高 | docs/reports/report-spec39-full-regression-final.md:8「实测工作台账：仓库根 report.md（**T0~T6** 逐段实时记录）」 | 根 report.md 全文止于「T5 SPEC-40 真机浏览器门禁进行中」且标注「npm test 66 套件 ×3 轮全量回归后台运行中」，无 T6 段 | 终版报告引用的 T6 台账段不存在 | 报告证据链断一节 | 补 T6 台账或修正报告引用 | 项目负责人 |
| ISSUE-REPORTS-疑似偏离设计/文件定位-2a0203b5 | 疑似偏离设计/文件定位 | P3 | 高 | docs/reports/void-frontier-qa-lifecycle.md 含 AI 会话记忆 frontmatter（name/description/metadata.originSessionId [REDACTED]） | docs/reports/ 其余 12 份均为项目报告体例 | ZCode 记忆导出文件混入项目报告目录 | 归档定位混淆 | 裁决去留（Q4 同类）；正文内容与 report-full-lifecycle-qa.md 一致可互为佐证 | 项目负责人 |
| ISSUE-REPORTS-术语不一致-5d9c6da4 | 术语不一致 | P3 | 低（抽样证据） | docs/specs/24/29/30/33/38 断言真机 GPU 为 RTX 5060（子代理抽样提取） | docs/reports/report-spec333435-longline-final.md「CDP 真机（**GTX 970M** Vulkan）」；report-spec39-full-regression-final.md 真机 A 为 IAB webview 软件 GL | CDP 真机硬件环境断言跨批次漂移 | 性能门禁数字跨批次不可比 | 统一环境档案表（整改阶段） | 项目负责人 |
| ISSUE-DIGEST-过时-342293bf | 过时 | P3 | 高 | docs/digest/master-plan.md「基线 main @ 2d471a5，52/52 PASS（2026-11-05 复跑确认），金快照 5ac0ed56」+ Wave A/B 波次计划 | 实际已至 66 套件/金快照 8be8ce2c/SPEC-39 时代；Wave 计划已由 report-planets/report-rework-planets 全部竣工 | 摘要无竣工标注，进度声明过期 | 误当当前计划（权威等级仅 7） | 头部加「已竣工」标注 | 项目负责人 |
| ISSUE-DIGEST-术语不一致-349bb0c3 | 术语不一致 | P3 | 高 | docs/digest/doc7-digest.md 自述「执行工程师**免读原文即可开工**」 | docs/digest/doc5-digest.md 自述「实施级摘要…需解图确认」（定位为辅助）；任务书权威顺序 digest=第 7 级不具权威性 | digest 权威定位自相矛盾，doc7-digest 有被误当施工准绳风险 | 跳过源文档的演化裁决风险 | 改写为「须与源文档联读」 | 项目负责人 |
| ISSUE-SPECS-过时-d609a1af | 过时 | P3 | 高 | docs/specs/7 头部「适用工作区：Google Drive\work\void-frontier-age-of-stars\」 | 实际仓库 [REDACTED] | 外部环境路径残留（撰写环境与运行环境不同） | 低 | 勘误或注记历史环境 | 项目负责人 |
| ISSUE-TERM-术语不一致-01ba91a7 | 术语不一致 | P2 | 高 | 套件内同一门禁双写法并存：tests/suites/ 中 `GATE-01..15` 短写（GATE-02×19、GATE-01×13…）与 `PLAYTEST-GATE-10..15` 长写同时出现 | specs 体系四套代号：spec31「Gate 1~5」五级回归门禁；spec9「PLAYTEST-GATE-01..04」；specs17-22「PLAYTEST-GATE-05..09」；specs33/34「GATE-10..14」；specs39/40「GATE-15/SURF」；TEST_MATRIX 对全部 gate 零记载 | gate 编号体系跨代混用 + 套件内长短写不统一 | 门禁追溯映射需人工解码 | 建 gate↔suite↔spec 对照表并入 TEST_MATRIX 重写 | 项目负责人 |
| ISSUE-TERM-术语不一致-32457e01 | 术语不一致 | P3 | 高 | 阶段代号六套并存无统一索引：任务书 9.1 十五阶段（bootstrap…release-hardening，RUNBOOK §2）｜Phase R1–R9（specs 2/3）｜Phase 0–5（spec7）｜WP-1..6（specs 11/18–22）｜Wave A/B（digest master-plan）｜Milestone1Genesis..4Victory（spec28/tests/e2e/stages 实证存在） | 各体系各自自洽，跨体系无映射 | 新读者难以对齐「当前进度在第几套代号」 | 术语表/代号索引（整改阶段新增 ADR 或附录） | 项目负责人 |

## 5. 偏离设计清单

| ID | 偏离点 | 设计基线位置 | 当前文档/实现位置 | 是否有变更记录 | 判断 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-01 | UI 层绕过命令总线直接突变世界状态：GroundView 渲染循环逐帧调用领域步进函数 `stepSurfaceThreatAndDeployables(this.app.world,…)`（GroundView.js:2256 → surfaceEvents.js:342）、`stepMission`，并直接 import `creditColony/debitColony`（GroundView.js import 区）改账本 | ARCHITECTURE.md:66-68 硬约束「render/ 与 ui/ 只读快照；改状态只有一条路：App.dispatch → executeCommand」 | src/ui/screens/GroundView.js:2256 等 | 无（CHANGELOG/audit 均无地面实时层架构豁免记录） | 疑似偏离/待确认（地面实时动作层可能确需帧驱动，但豁免未成文；批 8/9 复核 specs 是否有依据） | 若为有意豁免：在 ARCHITECTURE §1 补「地面实时层例外」条目成文；若无意：改造为命令或领域 tick 通道 |

## 6. 整理计划

| 优先级 | 文档/文档簇 | 问题ID | 动作 | 目标权威源 | 风险 | 建议负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | CHANGELOG.md | ISSUE-META-缺失证据/版本矛盾-ae2d56eb、1aa5d91d | 补充 v0.4 与 docs31-35 条目（依 git 467a4d4 与 reports） | git log + docs/reports | 低（纯追加） | 项目负责人 |
| P2 | README.md | ISSUE-META-与代码/测试不一致-388ddc86、3b17ffc3 | 重写测试口径与脚本清单 | tests/suites/index.js + package.json | 低 | 项目负责人 |
| P2 | .github/workflows/ci.yml | ISSUE-META-过时-6ed0f64d | 重写注释口径 | run-suites.mjs | 低 | 项目负责人 |
| P2 | 根 report.md + docs/reports/report.md | ISSUE-META-重复冗余/文件命名规范-8e623e11 | 裁决后归档改名（双 report.md 消歧） | 人工裁决 | 中（历史引用路径变更） | 项目负责人 |
| P3 | THIRD_PARTY_NOTICES.md | ISSUE-META-过时-01ee7cbf | 修正音频表述 | src/render/AudioManager.js | 低 | 项目负责人 |
| P3 | package.json/CHANGELOG/README | ISSUE-META-版本矛盾-0335621a | 版本体系裁决（见 Q2） | 人工裁决 | 低 | 项目负责人 |
| P1 | docs/ARCHITECTURE.md | ISSUE-ARCH-与代码/测试不一致-4057a71c、7baf7ee5 | 重写 §5 边界与 schema 头版本 | World.js/TabGuard.js/victory.js | 中（涉架构叙述重构） | 项目负责人 |
| P2 | docs/ARCHITECTURE.md | ISSUE-ARCH-过时-cd5b9098、9e2a2934、cae4e344、0ca8797a、a6bf2b2f | §1/§2.2/§2.4/§3.3 全量刷新至 20 子目录+GL 子树+71 命令+新计数 | src/ 现状 | 中 | 项目负责人 |
| P1 | docs/DATA_SCHEMA.md | ISSUE-DATA-版本矛盾-ce984144、04856303、410dd3fb、ce4ab42b | 升级为「World v2 数据模型」：17 集合+objectives 字段表+planet v2/v3 字段 | World.js/MigrationRegistry.js | 中 | 项目负责人 |
| P2 | docs/DATA_SCHEMA.md | ISSUE-DATA-过时-d62f01bb、1c840f59、1b0f4438 | 更新生产者状态/同步断言/ID 表 | 代码现状 | 低 | 项目负责人 |
| P2 | src/domain/logistics、src/ui/accessibility、src/ui/panels、src/workers | ISSUE-ARCH-文件命名规范/冗余-ef7307b7 | 删除 4 个空目录（整改阶段执行） | — | 低 | 项目负责人 |
| P1 | docs/SAVE_FORMAT.md | ISSUE-SAVE-版本矛盾-304c9685、2f69576c、421e8d80、bcd348d1 | 重写 §1/§3/§7/§8 至 schemaVersion 2 + 迁移链实况 + TabGuard 已实现 | MigrationRegistry.js/TabGuard.js/SaveManager.js | 中（涉迁移设计记录，建议补 ADR，见 Q7） | 项目负责人 |
| P3 | src/persistence/SaveManager.js | ISSUE-SAVE-与代码/测试不一致-43f12cd9 | 头注释两段式表述与实现对齐 | 代码注释 | 低 | 项目负责人 |
| P2 | docs/audit/PROJECT_LEAD_ACCEPTANCE_AUDIT_REPORT.md | ISSUE-AUDIT-直接矛盾/过时-6909350e | 头部加「已被 7.4 驳回轮撤回」标注 | docs/audit 内部链条 | 低 | 项目负责人 |
| P2 | 根 report.md + docs/reports/report-spec39-full-regression-final.md | ISSUE-REPORTS-缺失证据-b7817e33 | 补 T6 台账或修引用（与 Q3 联动） | 施工实况 | 低 | 项目负责人 |
| P2 | docs/TEST_MATRIX.md + 新增 ADR | ISSUE-TERM-术语不一致-01ba91a7、32457e01 | gate↔suite↔spec↔阶段代号对照表 | tests/suites + specs | 中 | 项目负责人 |
| P3 | docs/digest/ 三份 | ISSUE-DIGEST-过时-342293bf、349bb0c3 | 竣工标注 + 定位改写 | — | 低 | 项目负责人 |
| P2 | docs/specs/34、32 缺口 | ISSUE-SPECS-版本矛盾-f2f8b642、d4d49364 | 34 改标 034；32 号裁决（归档找回或注明丢失） | 人工裁决 | 低 | 项目负责人 |

## 7. 待确认决策

- **Q1（a.txt 归属）**：任务书列名的根 a.txt 不存在且从未存在。是否任务书笔误（如指 .test-run.log 或 docs/reports 下某文件）？裁决前该对象按「缺失」处理，不作为问题源。
- **Q2（版本号策略）**：package.json 0.1.0 与内容里程碑 v0.2–v1.0 两套体系是否并存认可？若并存认可，建议在 README 或 CHANGELOG 顶部声明映射关系（本条由 ISSUE-META-版本矛盾-0335621a 升格）。
- **Q3（根 report.md 去留）**：根 report.md 现为 SPEC-39/40 活动施工日志；SPEC-40 竣工后是否移入 docs/reports/（如 report-spec39-worklog.md）并在根删除？git 91adaa2 曾清理过根 report.md，说明先例存在。
- **Q4（docs/reports/report.md 归档）**：rework2 时代同名报告是否改名（如 report-rework2-worklog.md）以消除双 report.md？
- **Q5（套件数口径刷新责任）**：README/ci.yml/CHANGELOG(22 套件历史条目) 三处历史口径是否统一由一次文档刷新收口（CHANGELOG 历史条目建议保留原文+加「当时口径」注）。
- **Q6（地面实时层架构豁免）**：GroundView 帧循环直接调用领域步进函数并直改账本（DEV-01）。地面实时动作层是否被设计为命令总线豁免区？若是，需在 ARCHITECTURE 成文；若否，属无意偏离需改造。
- **Q7（v2→v3 迁移不可达）**：registerMigration(2, migrate_v2_to_v3) 已注册，但 load 管线 latestVersion=SCHEMA_VERSION=2 → 该迁移在生产代码不可达（仅测试直调）。五大支柱容器对历史存档依赖惰性 ensure。是否有意为之？若是需在 SAVE_FORMAT/DATA_SCHEMA 记录该设计决策（建议 ADR）；若否，需 bump SCHEMA_VERSION 或调整管线。

## 8. 材料缺口

- **G-01**：根 a.txt 不存在（工作树+全 git 历史均无）。任务书批 1 对象清单含 a.txt；其内容与归属无法审计。已按「缺失」记录，不影响其余批次。
- **G-02**：docs/specs/ 10 份超大文件（2/3/5/7/8/14/17/24/33/34，约 7MB）采用「头部+目录+门禁清单+定点抽查」策略，未全文逐字核验；由此产生的低置信度结论在各批记录中单独标注。
- **G-03**：docs/reports/ 19 份 .log 仅作证据引用，不逐份全文审计（任务书排除其为审计对象）。
- **G-04**：dist/void-frontier.bundle.js 为构建产物（排除对象），涉及 bundle 的文档断言以 tests/tools/build-static-bundle.mjs 与 index.html 双模加载器为对照源。
- **G-05**：RUNBOOK §6-§7 及 Phase 0-5 章节按章节标题定位核对，未逐行精读（冻结状态已证，逐行增益有限）。
- **G-06**：GPU 环境断言（RTX 5060 vs GTX 970M vs IAB 软件 GL）证据来自子代理对 specs 24/29/30/33/38 的抽样提取，未逐行复核原文，置信度低（ISSUE-REPORTS-术语不一致-5d9c6da4）。
- **G-07**：根 a.txt（任务书列名对象）不存在，内容无法审计（同 G-01，问题侧记录为 ISSUE-META-缺失证据-f0fee718）。

## 9. 分批审计记录

### 批次 1：根元文档定位（README.md、CHANGELOG.md、LICENSE、THIRD_PARTY_NOTICES.md、report.md、a.txt）

- 本批输入与 hash：
  - README.md 3.2KB（2026-11-05）、CHANGELOG.md 26.0KB（2026-11-11）、LICENSE 1.3KB、THIRD_PARTY_NOTICES.md 2.4KB、根 report.md 14.7KB（2026-11-11）、a.txt 不存在。
  - 证据源：package.json（1127B）、.github/workflows/ci.yml（958B）、deploy.yml（1501B）、index.html（2406B）、sw.js（2856B）、manifest.webmanifest（412B）、tests/suites/index.js、tests/tools/run-suites.mjs。
- 证据与断言：
  1. `tests/suites/index.js` 经 Node 运行 `collectSuites()` 返回 **66**（2026-11-11 工作树实测）；`run-suites.mjs:28` `REPEAT = getArg('repeat') || 3`。
  2. README.md:31-33「全部 34 个自动化测试套件」、:52「34 套件 × 2 轮 = 68 项」。
  3. ci.yml:6-7「21 套件 × 2 轮，整轮约 2–3 分钟」。
  4. CHANGELOG.md:274-280「22 个自动化套件（每套件运行 2 轮…）」为历史条目（口径符合当时，现为历史）；CHANGELOG 顶部 SPEC-39 条目「套件总数 61→66」与实测一致。
  5. git log：`467a4d4`（feat v0.4 doc19）、`4add060`（v0.6）、`e553f41`（v0.8+v1.0）、`91adaa2`（hotfix + purge root report.md + ingest docs 23/24）；CHANGELOG 无 v0.4、docs31-35、SPEC-40 特性条目（grep「planetaryLogistics|doc19|GATE-10|SPEC-40」0 命中特性段）。
  6. THIRD_PARTY_NOTICES.md:13「音频（如后续加入）」vs src/render/AudioManager.js 存在、setAmbientTheme 被 src/app/App.js 与 src/ui/screens/GroundView.js 引用（grep 实证）。
  7. README 部署节（deploy.yml 直传 Pages、hash 路由、404.html 回退）与 deploy.yml:39-47、index.html 双模加载器、sw.js 相对路径声明一致——无问题。
  8. README 快速开始（静态服务器即可玩、npm run serve）与 package.json:19、dev-server.mjs 存在性一致——无问题。
  9. index.html PWA manifest 仅 http(s) 注入（file:// 规避 CORS）与 sw.js/manifest 自述一致——无问题。
- 本批发现：§4 新增 ISSUE-META-与代码/测试不一致-388ddc86 / 6ed0f64d / ae2d56eb / 1aa5d91d / e87622cb / 01ee7cbf / 3b17ffc3 / 8e623e11 / 0335621a / f0fee718 共 10 条；§7 新增 Q1–Q5；§8 新增 G-01。
- 检查点：
  - batch_id：B1
  - 已完成步骤：6 对象全读 + 7 证据源全读 + 3 项代码实测（套件数/轮数/AudioManager）+ 2 项 git 实测（a.txt 历史、HEAD 提交链）
  - 本批问题 ID：上述 10 条
  - 待确认 ID：Q1–Q5
  - 材料缺口：G-01
  - 下一批游标：批 2（docs/ARCHITECTURE.md ↔ src/ 模块映射）
  - 状态：awaiting_review（按非阻塞纪律自动续跑批 2）

### 批次 2：ARCHITECTURE.md 与 src/ 模块映射

- 本批输入与 hash：
  - docs/ARCHITECTURE.md 23.8KB（2026-11-03）；对照 src/ 全树实测（app 5 / content 21 / core 11 / devtools 3 / persistence 6 / simulation 8 / ui screens 16 / render gl 15+meshes 3+shaders 3 / domain 20 子目录）。
- 证据与断言：
  1. src/domain 实际 20 子目录 vs §1 图 12 个；§2.2 表缺约 30 文件（ground/ 14 文件全缺）。
  2. src/render 实际 GroundRenderer + gl/(15) + meshes/(3) + shaders/(3) vs 文档 5 文件。
  3. HourlySystems.js grep registerHourly = 9（含 ground:153、trade-routes:219；ai 经 FactionAI 自注册）vs §3.3 表 8 阶段。
  4. commands.js 55 + commandsLongline.js 16 registerCommand 调用 vs §3.3「共 20 个」。
  5. content 计数实测（Node import）：RESOURCES 33 / HULLS 13 / MODULES 38 / BUILDINGS 47 / TECHNOLOGIES 80 / ANOMALY_TEMPLATES 20 / FACTIONS 6 / POLICIES 12 vs 文档 29/12/37/34/76/10/6/未列。
  6. App.js:114-117 注册 16 视图 vs 文档「15 个视图」。
  7. World.js:13 SCHEMA_VERSION=2 vs ARCHITECTURE.md:3 schemaVersion 1。
  8. victory.js（VICTORY_ROUTES/registerVictory/checkSoftFailure 导出）、TabGuard.js（class TabGuard:12）、crew.js/GroundMission.js/crisis.js/tradeRoutes.js 均存在 vs §5 三条「未实现/无生产者」。
  9. `find src -type d -empty` → domain/logistics、ui/accessibility、ui/panels、workers 4 空目录。
  10. GroundView.js:2256 帧循环调用领域步进函数 stepSurfaceThreatAndDeployables + 直接 import creditColony/debitColony → DEV-01 偏离疑点。
- 本批发现：§4 新增 ISSUE-ARCH-与代码/测试不一致-4057a71c / 7baf7ee5 / cd5b9098 / 9e2a2934 / cae4e344 / 0ca8797a / a6bf2b2f / d3dd7d51 / 6647b327 / ef7307b7 共 10 条；§5 新增 DEV-01；§7 新增 Q6。
- 检查点：
  - batch_id：B2
  - 已完成步骤：ARCHITECTURE.md 全读 + src 全树实测 + 6 项计数实测 + 偏离疑点 1 项
  - 本批问题 ID：上述 10 条
  - 待确认 ID：Q6
  - 材料缺口：无新增
  - 下一批游标：批 3
  - 状态：awaiting_review（自动续跑）

### 批次 3：DATA_SCHEMA.md 与数据/序列化实现

- 本批输入与 hash：
  - docs/DATA_SCHEMA.md 20.8KB（2026-11-03）全读；对照 src/domain/world/World.js 全读、src/core/ids.js、src/core/invariant.js:30-34、src/persistence/MigrationRegistry.js:1-60、src/domain/entities/registry.js 导出表。
- 证据与断言：
  1. World.js:13 `SCHEMA_VERSION = 2`、:14 `GAME_VERSION = '0.1.0'` vs DATA_SCHEMA.md:1/:3/:14「World v1 / SCHEMA_VERSION = 1」。
  2. World.js:38-56 entities 17 集合（含 objectives）vs 文档「16 个实体集合」；§3.13 四预留集合生产者全部存在。
  3. World.js:129-147 ENTITY_TYPES 17 键 vs invariant.js:30-34 ENTITY_COLLECTIONS 16 键（缺 objectives）——文档:79「同时被复用」断言失效，objectives 游离于不变量检查外（代码疑点移交）。
  4. ids.js:20 `objective:'obj'` 前缀 vs §2 表无 obj 行。
  5. MigrationRegistry.js:18-21 `registerMigration(fromVersion, fn)` 语义 = from→from+1；:283 `registerMigration(2, migrate_v2_to_v3)` 注册 v2→v3 迁移，但 World.js SCHEMA_VERSION 仍为 2（CHANGELOG「保持 2 守金快照」）→ 迁移链终点与 SCHEMA_VERSION 关系存疑，移交批 4 核对 SaveManager.load 的 latestVersion 实参。
  6. registry.js 导出 createEntity/getEntity/removeEntity/eachEntity/listEntities/listByFaction/countEntities，与文档无冲突。
- 本批发现：§4 新增 ISSUE-DATA-版本矛盾-ce984144 / 04856303 / 410dd3fb / d62f01bb / ce4ab42b / 1c840f59 / 1b0f4438 共 7 条。
- 检查点：
  - batch_id：B3
  - 已完成步骤：DATA_SCHEMA 全读 + World.js/ids/invariant/MigrationRegistry/registry 实测
  - 本批问题 ID：上述 7 条
  - 待确认 ID：无新增
  - 材料缺口：无新增
  - 下一批游标：批 4（SAVE_FORMAT.md ↔ SaveManager/SaveCodec/MigrationRegistry/ImportExport/TabGuard + save 套件）
  - 状态：awaiting_review（自动续跑）

### 批次 4：SAVE_FORMAT.md 与存档实现及测试

- 本批输入与 hash：
  - docs/SAVE_FORMAT.md 8.4KB（2026-11-03）全读；对照 src/persistence/SaveManager.js、SaveCodec.js 全读、MigrationRegistry.js 头部与注册表、Database.js/ImportExport.js 关键行、tests/suites/save-codec|save-roundtrip|save-migration 套件 id、CHANGELOG v3 迁移条目。
- 证据与断言：
  1. World.js SCHEMA_VERSION=2 vs SAVE_FORMAT.md:6-7/:16「当前为 1 / 示例 schemaVersion 1」。
  2. MigrationRegistry.js:283 registerMigration(2, migrate_v2_to_v3) + v1→v2 已注册 vs :85「未注册任何迁移函数」。
  3. SaveManager.js:63 migratePayload(..., SCHEMA_VERSION=2) → from=2 迁移 load 不可达；grep migrate_v2_to_v3 生产代码零调用（仅 playtest-gates.suite.js:1668-1669 直调）；CHANGELOG「保持 2…直调迁移验证」——架构事实未入文档（Q7）。
  4. TabGuard.js 存在（BroadcastChannel + localStorage 心跳）vs §7「未实现、全仓 grep 无命中」。
  5. save-roundtrip id SAVE-02、save-migration id SAVE-04 存在；SaveManager.js:23 captureCheckpoint 已实现 vs §8 三行缺口失效；Database.js:87 localStorage 第三层降级 vs §5 仅内存 Map。
  6. SaveManager.js:5 头注释「两段式」vs save() 无 temp record vs SAVE_FORMAT §4/§8「未实现」——三方矛盾。
  7. 一致项（无问题）：24MB 导入上限（SaveCodec.js:13 = ImportExport.js:34）、gzip 压缩导出（SaveCodec.js:87-105）、DB 名 void-frontier/keyPath slotId|k/5 槽位（SLOTS=manual-1..3+auto+quick）/校验管线顺序与 §2.2 一致。
- 本批发现：§4 新增 ISSUE-SAVE-版本矛盾-304c9685 / 2f69576c / 421e8d80 / bcd348d1 / 2472f136 / 43f12cd9 共 6 条；§7 新增 Q7。
- 检查点：
  - batch_id：B4
  - 已完成步骤：SAVE_FORMAT 全读 + persistence 5 文件实测 + 3 save 套件 id 核对
  - 本批问题 ID：上述 6 条
  - 待确认 ID：Q7
  - 材料缺口：无新增
  - 下一批游标：批 5（GAME_RULES.md ↔ 领域规则）
  - 状态：awaiting_review（自动续跑）

### 批次 5：GAME_RULES.md 与领域规则实现

- 本批输入与 hash：
  - docs/GAME_RULES.md 18.1KB（2026-11-03）全读；对照 content 六库计数实测（Node import）、buildings.js:106 bld_alloy_plant 配方、market.js:49、colonyTrade.js:32、war.js:46/:117/:253、navigation.js:146、scan.js:21、scenarioFactory.js:121、commands.js:1254/:1274、victory.js。
- 证据与断言：
  1. §12「胜利未实现」vs victory.js VICTORY_ROUTES/registerVictory/checkSoftFailure + achievements.js —— 失效。
  2. 76→80 科技、10→20 异常模板、29→33 资源（缺 4 违禁品 contra_*）。
  3. §8「和谈/占领未实现」vs commands.js ProposePeace/AnnexOccupied —— 失效。
  4. §2/§3 表冻结于 21 建筑；实际 47（缺 bld_shipyard 至 bld_quantum_lattice 26 个）。
  5. 一致项（抽查全中）：1 tick=1h/8640 年、alloy 配方 ferro34+silicate22→16@24h、LEVEL_THRESHOLDS [0,14,36,72,120]、条约 360 日、REFUEL_PER_HOUR=20、MAX_SELL_PER_DAY=60、开局 3 科技、priceSmooth 平滑结构。
- 判断：GAME_RULES 为 v0.1（2026-11-03）冻结快照，冻结点内数值质量高（抽查零误差），其后五波内容演化整块未进文档，与「只写当前代码真实实现的规则」自述矛盾。
- 本批发现：§4 新增 ISSUE-GAME-与代码/测试不一致-a5fd4ae7 / 67b428a0 / 5bc133ba / 5bfa5804 / 68ebb448 / 7c0bab9d 共 6 条。
- 检查点：
  - batch_id：B5
  - 已完成步骤：GAME_RULES 全读 + 10 项数值抽查（6 中 6 于冻结点内）+ 3 项集合计数
  - 本批问题 ID：上述 6 条
  - 待确认 ID：无新增
  - 材料缺口：无新增
  - 下一批游标：批 6（TEST_MATRIX.md ↔ 测试资产）
  - 状态：awaiting_review（自动续跑）

### 批次 6：TEST_MATRIX.md 与测试资产

- 本批输入与 hash：
  - docs/TEST_MATRIX.md 19.6KB（2026-11-03）全读；对照 tests/suites/ 44 文件清单、collectSuites()=66、ground-mission/celestial-bodies/playtest-gates/fuzz-stability/soak-inspection/gameplay-agent-loop 套件 id 实测、tests/e2e|agent|fuzz|soak 目录清单、run-suites.mjs:28、golden.json（hash 8be8ce2c @2026-11-08）。
- 证据与断言：
  1. 「22 个套件」vs 实际 66（22 个后建套件未入矩阵）。
  2. GROUND-01/02/03 已建成（ground-mission.suite.js:79/139/190）vs 矩阵 PENDING；celestial-bodies.suite.js:60 占用 id WORLD-02 与矩阵规划错位。
  3. e2e/agent/fuzz/soak 四类资产 + 6 个对应套件 id 完全未入矩阵。
  4. golden 基线 8be8ce2c（2026-11-08 重基线）vs 矩阵「7ecd48dc 待提交」。
  5. 「PASS（2 轮）」vs REPEAT 默认 3。
- 本批发现：§4 新增 ISSUE-TEST-过时-7ac1622c / 2ba05253 / ea54d043 / 3c93f7b3 / 20f32539 共 5 条。
- 检查点：
  - batch_id：B6
  - 已完成步骤：TEST_MATRIX 全读 + 套件资产全景实测 + 6 套件 id 抽验
  - 本批问题 ID：上述 5 条
  - 待确认 ID：无新增
  - 材料缺口：无新增
  - 下一批游标：批 7
  - 状态：awaiting_review（自动续跑）

### 批次 7：AUTONOMOUS_RUNBOOK.md 与 agent / smoke 资产

- 本批输入与 hash：
  - docs/AUTONOMOUS_RUNBOOK.md 29.7KB（2026-11-07）读 §1-§5 与章节结构（grep 全部标题）；对照 tests/agent/、tests/tools/agent-runner.html、campaign-e2e.html、.smoke/ 脚本、run-cdp-playtest.mjs 存在性；scenarioFactory.js:79-80、fleet.js:55、World.js createdAt。
- 证据与断言：
  1. RUNBOOK 全文 CDP/agent/smoke 关键词 0 命中 vs 任务书批 7 指定的全部对照资产存在。
  2. 文档冻结于 2026-11-03（§1 基于 a94eae6 22 套件）+ 尾部补遗止于 2026-11-07 终审返工；docs 15-40 六波无记载；与 §1 自述「12.4 要求持续维护」矛盾。
  3. 阶段 09「和谈/占领缺失」与 §5 队列第 7 项 vs ProposePeace/AnnexOccupied 已实现（commands.js:1254/:1274）。
  4. §4 遗留问题 #9 stationIds、#2 factionMods 已被 TD1/TD3 清偿（scenarioFactory.js:79-80、fleet.js:55 实证）；#7 createdAt 仍开放（World.js 无该字段，确认有效）。
  5. §5 下一步队列 P0「启用 Pages 需凭据」与当前状态一致（仍待用户凭据）——有效。
- 本批发现：§4 新增 ISSUE-RUNBOOK-缺失证据-4c7167f6 / ae9e7b17 / 2406c5b6 / bd3ecf1d 共 4 条。
- 检查点：
  - batch_id：B7
  - 已完成步骤：RUNBOOK 结构+前 140 行精读 + 3 项代码复核 + 资产存在性对照
  - 本批问题 ID：上述 4 条
  - 待确认 ID：无新增
  - 材料缺口：G-05（RUNBOOK §6-§7 及 Phase 0-5 章节按标题定位未逐行精读——结构已证冻结，逐行增益有限；如需可补读）
  - 下一批游标：批 8（specs 1–20 ↔ CHANGELOG/audit）
  - 状态：awaiting_review（自动续跑）

### 批次 8：specs 1–20 与早期版本里程碑

- 本批输入与 hash：
  - docs/specs/ 1–20 共 20 份（子代理 Explore 提取：超大文件头/尾/章节标题/状态词协议）；对照 CHANGELOG.md、docs/audit/ 命名族 md5 对照。
- 证据与断言（要点）：
  1. 演化链成立：spec1 任务书 → spec2/3 rework/rework2（专家诊断报告，R1-R4/R5-R9）→ spec5 全套施工（26 套件 52/52）→ spec6 审美宪法（废止方块体素）→ spec7 施工总纲 → spec8 二次验收 **5.2/10.0 驳回** → spec9 强制施工指示（≡docs/audit/REWORK_DIRECTIVES，md5 相同）→ spec10 专家终审 **6.4/10.0 有条件驳回** → spec11 终审返工纲领 WP-1..6 → spec12 负责人 **9.9/10.0 撤销阻断** → spec13 终审委托 → spec14 专家终局 **9.7/10.0 正式通过**。
  2. spec12/13 与 docs/audit 同名英文族（PROJECT_LEAD_FINAL_ACCEPTANCE_REPORT 9.8/11-05、MANDATE_..._SECONDARY_ACCEPTANCE -02 号）**非副本**（md5 各异），是先后两轮验收/委托；命名相近易误读为同一文档。
  3. spec15-17 超长线阶段（委托→总体方案→架构白皮书）；spec17 定 Roadmap v0.1.1→v0.2→v0.4→v0.6→v0.8→v1.0；specs 18/19/20 头部均尊 16 为最高总纲、17 为架构规范，门禁 GATE-05/06/07 衔接。
  4. CHANGELOG 对应：v0.1.1/v0.2（docs18）、v0.6（docs20）、v0.8（docs21）、v1.0（docs22）有条目；**v0.4/docs19 无条目**（坐实 ISSUE-META-缺失证据/版本矛盾-ae2d56eb）；specs 1-14 的 v0.1.0 演化未在 CHANGELOG 单列（仅 Unreleased 叙述）。
  5. 套件数演化链：23→26→38→42（specs 内部自洽）；金快照链 a7492dc9（spec2）→68462446（spec8 起）；评分链 9.8→6.4→9.9→9.7。
- 本批发现：§4 新增 ISSUE-SPECS-重复冗余-ceb6f947 / f2f8b642 / d4d49364 / 01fe410d / 083a4b6c / 50c8f44e 共 6 条（批 8/9 合并定案）。
- 检查点：
  - batch_id：B8
  - 已完成步骤：20 份 spec 结构化提取（子代理）+ md5 重复对照 + CHANGELOG 映射核对
  - 本批问题 ID：上述 6 条（与批 9 合并）
  - 待确认 ID：无新增
  - 材料缺口：G-02（超大 spec 头/尾/标题抽样协议）
  - 下一批游标：批 9
  - 状态：awaiting_review（自动续跑）

### 批次 9：specs 21–40 与当前实现

- 本批输入与 hash：
  - docs/specs/ 21–40 共 19 份（32 缺失确认；子代理 Explore 提取）；对照 docs/reports/report-spec39-full-regression-final.md 头部、tests/agent|fuzz|soak|e2e 资产清单（批 6 已证）、根 report.md。
- 证据与断言（要点）：
  1. 32 号缺失非有意：spec35 头部引用其文件名、spec33/34 声明响应 SPEC-MANDATE-032、spec31 零提及——实体文件丢失。
  2. spec25/26/27/28 资产路径与 tests/agent、tests/fuzz（dumps 由 BlackBoxCrashDumper 生成 crash-dump-*.json 经 replay-crash.mjs 消费）、tests/soak、tests/e2e 一一对应且已实装（spec29 证实）。
  3. spec31 声明 Gate 1~5 五级回归门禁；GATE-10..14 实际由 spec33/34 §8.2 各自声明（内容重叠）；SPEC-39 落地为 playtest-gate15-surface.suite.js（SURF-01..05）——gate 编号存在三套体系（Gate1-5 / PLAYTEST-GATE-05..09 / GATE-10..14 / GATE-15），批 12 总扫。
  4. spec33/34 均自称 SPEC-REPORT-033（编号冲突）；两者基准表述略异（Doc 23–31 vs Doc 16 至 Doc 31）。
  5. spec40 口径「57 套×3 轮=171」签发后套件继续增长至 66（根 report.md T0「61 + Gate15」、实测 66）——40 号签发时点与执行时点的规模漂移，批 10 与终版报告核对。
  6. spec37/39/40「所属版本 v0.2~v0.6」与 2026-11-10 落盘时序矛盾。
  7. specs 21/22（v0.8/v1.0）WP-1..6 已由 CHANGELOG L107/L120 覆盖 ✓；specs 23/24（测试工程）由 CHANGELOG Fixed(2026-11-08) 部分覆盖；spec29/30（验收）无 CHANGELOG 条目（过程文档，可接受）。
- 本批发现：与批 8 合并计 6 条（SPECS 模块）；无新增独立 ID。
- 检查点：
  - batch_id：B9
  - 已完成步骤：19 份 spec 结构化提取 + 32 号缺失三向印证 + gate 体系归属判定
  - 本批问题 ID：同批 8 的 6 条
  - 待确认 ID：无新增
  - 材料缺口：G-02 延续（24/33/34 抽样）
  - 下一批游标：批 10（docs/audit 与 docs/reports 过程结论一致性）
  - 状态：awaiting_review（自动续跑）

### 批次 10：docs/audit/ 与 docs/reports/ 过程结论一致性

- 本批输入与 hash：
  - docs/audit/ 6 份精读（子代理提取：TASK_DELEGATION、PROJECT_LEAD_AUDIT、ACCEPTANCE_AUDIT、PLAYTEST_AUDIT、MANDATE_SECONDARY、FINAL_ACCEPTANCE；REWORK_DIRECTIVES 经 md5 判定为 spec9 副本不重复提取）；docs/reports/ 13 份 .md 头部与关键段（report-final-rework、report-planets、report-rework-planets、report-rework2、report-full-lifecycle-qa、report-spec31-final-gate、report-spec3334-research-audit、report-spec333435-longline-final、report-spec39-full-regression-final、report.md、test_review.md、void-frontier-qa-lifecycle.md）。
- 证据与断言（要点）：
  1. 裁决链完整闭环：AUDIT-SPEC(9.2, 071961a)→RFP 委托→ACCEPT-AUDIT(9.6, f634828)→PLAYTEST-AUDIT(7.4 驳回, 同 f634828)→MANDATE-02 协查→specs 8/9 返工→FINAL(9.8, 0d38fb9)→spec10(6.4 驳回)→specs 11/12(9.9)→specs 13/14(9.7 正式通过)。audit 整改指令（VERIFY-01..10、PLAYTEST-GATE-01..04、TD1-TD4）在后续报告中逐一闭环 ✓。
  2. ACCEPT(9.6) 与 PLAYTEST(7.4) 同 commit 互斥、后者撤回前者，ACCEPT 无撤回标注。
  3. MANDATE_SECONDARY 代码路径错引（src/views/、src/game/）。
  4. report-spec39 引用根 report.md「T0~T6」台账，实际止于 T5 进行中——T6 缺失。
  5. void-frontier-qa-lifecycle.md 为 AI 记忆导出（frontmatter originSessionId）混入 reports。
  6. test_review.md（11-08）口径「保既有 47 套件」为中间口径；与 TEST_MATRIX(22)、当前(66) 构成口径演化链，test_review 是最新权威过程记录。
  7. 同一 spec 多报告结论冲突检查：spec31→report-spec31-final-gate（五级门禁全过）；specs 33/34→report-spec3334-research-audit（审计通过，裁定 34=方案乙 SPEC-REPORT-034——与 spec34 自称 033 冲突，坐实 ISSUE-SPECS-版本矛盾-f2f8b642）；specs 33/34/35→report-spec333435-longline-final（GATE-10..14 全绿、183 轮次）；specs 39/40→report-spec39-full-regression-final（TC-FIX/SURF 系列 PASS）。无结论级冲突；环境断言漂移（GPU）1 处。
- 本批发现：§4 新增 ISSUE-AUDIT-直接矛盾/过时-6909350e、5909b85a；ISSUE-REPORTS-缺失证据-b7817e33、2a0203b5、5d9c6da4 共 5 条。
- 检查点：
  - batch_id：B10
  - 已完成步骤：audit 6 份精读（子代理）+ reports 13 份头部/关键段 + 闭环核对
  - 本批问题 ID：上述 5 条
  - 待确认 ID：无新增
  - 材料缺口：G-06（GPU 断言为子代理抽样，低置信度）
  - 下一批游标：批 11
  - 状态：awaiting_review（自动续跑）

### 批次 11：digest 与摘要一致性

- 本批输入与 hash：
  - docs/digest/master-plan.md 全读、doc5-digest.md 与 doc7-digest.md 头部 22 行；对照 spec5/spec7 头部原文。
- 证据与断言：
  1. doc5-digest 与 spec5 头部一致（PLAN-MASTER-VOID-FRONTIER-202611-FULL、基线 2d471a5、26 套件 52/52、八大痛点逐条对应）——无漂移 ✓。
  2. doc7-digest 与 spec7 头部一致（SEQ07、废止体素、三层关卡、18 主题）——无漂移 ✓；但其「免读原文即可开工」定位与 digest 权威级 7 冲突。
  3. master-plan.md 冻结于 2026-11-05（52/52、金快照 5ac0ed56、Wave A/B 计划），波次已由 report-planets/report-rework-planets 全部竣工，无竣工标注。
  4. digest 未被任何权威文档引用为依据（grep 抽查 specs/audit 引用对象均为 specs 与 reports）——「误当权威」风险主要来自 doc7-digest 自述。
- 本批发现：§4 新增 ISSUE-DIGEST-过时-342293bf、349bb0c3；ISSUE-SPECS-过时-d609a1af（spec7 头部 Google Drive 路径残留）共 3 条。
- 检查点：
  - batch_id：B11
  - 已完成步骤：digest 3 份 + 源文档头部对照
  - 本批问题 ID：上述 3 条
  - 待确认 ID：无新增
  - 材料缺口：G-02 延续（digest 正文未逐行比对，头部一致性抽查通过）
  - 下一批游标：批 12
  - 状态：awaiting_review（自动续跑）

### 批次 12：跨文档术语 / 编号 / 版本 / 里程碑一致性总扫

- 本批输入与 hash：
  - 全部前批证据汇总 + 定向 grep（tests/suites gate 代号分布、specs gate 引用、stages Milestone 命名）。
- 证据与断言：
  1. **spec 编号**：1–40 缺 32（实体丢失，ISSUE-SPECS-链接失效/缺失证据-d4d49364）；33/34 编号冲突（f2f8b642）；spec 12/13 与 audit 族命名相近非重复（md5 异，演化链支撑，备注不算问题）。
  2. **gate 代号**：四套体系（Gate 1~5 / PLAYTEST-GATE-01..04 / PLAYTEST-GATE-05..09 / GATE-10..14 / GATE-15·SURF）+ 套件内 GATE-xx 短写与 PLAYTEST-GATE-xx 长写并存（GATE-02×19 等）；TEST_MATRIX 零记载。
  3. **milestone 命名**：Milestone1Genesis/2Combat/3Logistics/4Victory 与 spec28/tests/e2e 一致 ✓；与任务书 15 阶段、Phase R1-R9、Phase 0-5、WP、Wave 六套代号并存无索引。
  4. **版本号**：package/GAME_VERSION 0.1.0 vs 里程碑 v0.1.1→v1.0（CHANGELOG/specs）vs 规划 v1.2/v1.5/v2.0（spec35）vs 37/39/40 错标 v0.2~v0.6——散见 META-0335621a、SPECS-01fe410d，总扫确认无遗漏面。
  5. **金快照链**：a7492dc9→5ac0ed56→68462446→8be8ce2c；当前权威 8be8ce2c（golden.json）；TEST_MATRIX 停 7ecd48dc（已记）。
  6. **套件数链**：21/22（ci.yml/README/CHANGELOG 历史）→23→26→38→42→47→56→57→61→66（各文档冻结点快照，均已在相应批次记录）。
  7. **文件名编码**：git 层 UTF-8 合法，乱码为显示层；spec4 命名不规范（已记）。
- 本批发现：§4 新增 ISSUE-TERM-术语不一致-01ba91a7、32457e01 共 2 条。
- 检查点：
  - batch_id：B12
  - 已完成步骤：六轴总扫（编号/代号/版本/里程碑/哈希/命名）
  - 本批问题 ID：上述 2 条
  - 待确认 ID：无新增
  - 材料缺口：无新增
  - 下一批游标：无（12 批竣工，报告终稿化）
  - 状态：completed（全批次竣工，整改待人工确认）

## 10. 变更日志

| 时间 | 操作 | 批次 | 说明 |
| --- | --- | --- | --- |
| 2026-11-11 | 初始化 | 0 | 状态块/计划/文档地图/材料缺口落盘 |
| 2026-11-11 | 批 1 完成 | 1 | 10 问题 + 5 待确认 + G-01 落盘；状态置 awaiting_review |
| 2026-11-11 | 批 2 完成 | 2 | 10 问题（ARCH）+ DEV-01 偏离疑点 + Q6；状态置 awaiting_review |
| 2026-11-11 | 批 3 完成 | 3 | 7 问题（DATA）；发现 invariant ENTITY_COLLECTIONS 缺 objectives 代码疑点；状态置 awaiting_review |
| 2026-11-11 | 批 4 完成 | 4 | 6 问题（SAVE）+ Q7（v2→v3 迁移不可达）；状态置 awaiting_review |
| 2026-11-11 | 批 5 完成 | 5 | 6 问题（GAME）：GAME_RULES 冻结于 v0.1，五波规则整块缺失；状态置 awaiting_review |
| 2026-11-11 | 批 6 完成 | 6 | 5 问题（TEST）：矩阵 22→66 套件、四类资产缺章、基线过时；状态置 awaiting_review |
| 2026-11-11 | 批 7 完成 | 7 | 4 问题（RUNBOOK）：CDP/agent/smoke 零记载、冻结于 11-07、遗留清单 3 项失效；状态置 awaiting_review |
| 2026-11-11 | 批 8+9 完成 | 8,9 | 6 问题（SPECS）：spec9 全副本、33/34 编号冲突、32 号实体丢失、版本标签矛盾、无状态标注、命名规范；状态置 awaiting_review |
| 2026-11-11 | 批 10 完成 | 10 | 5 问题（AUDIT 2 + REPORTS 3）：互斥裁决未标注、路径错引、T6 台账缺失、记忆文件混入、GPU 漂移；状态置 awaiting_review |
| 2026-11-11 | 批 11 完成 | 11 | 3 问题（DIGEST 2 + SPECS 1）：master-plan 过期、doc7-digest 定位、spec7 外部路径；状态置 awaiting_review |
| 2026-11-11 | 批 12 完成 + 终稿 | 12 | 2 问题（TERM）；64 条问题/1 偏离/7 待确认/7 缺口收口；问题 ID 三段化合规（ISSUE-模块-类型-hash8）；状态置 completed |
