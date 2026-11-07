# AUTONOMOUS_RUNBOOK — 长程研发状态记录

> 面向下一名（或下一个会话的）执行工程师：从这里恢复上下文。任务书 12.4 要求本文
> 持续维护。本文最后核对时间：2026-11-03（基于 git log 至 `a94eae6` 与 22 套件
> × 2 轮实跑的当日实测）。阶段定义与验收口径见任务书 9.1 / 9.2；
> 测试编号见 `docs/TEST_MATRIX.md`。

## 1. 当前状态速览

- **当前分支**：`main`（单主线）。
- **最新提交**：`a94eae6 feat(characters): 船员与人物系统`（10 files,
  +727/−358；顺带收编发布工程文件与本文/TEST_MATRIX 上一版修订）。
  前序：`f92f4d4`（Database 事务双重解包修复 + package.json scripts 切换 +
  发布工程文件）、`0001cda`（REG-01/E2E-01 等套件 + update-golden 读取修复）。
- **测试基线（实跑）**：2026-11-03 两次全量实跑——
  1. 人物系统并入前（`0001cda`，21 套件）：**42/42 全绿**（两次确认，约 3 分钟）。
  2. 人物系统并入后（`a94eae6`，22 套件）：**42/44**——REG-01 两轮基线漂移
     （人物特性改变确定性演化，新基线 `7ecd48dc` 已按套件指引重新生成、
     待提交）。CREW-01 两轮 PASS；静态审计零违规。
- **工作树**：并行会话推进阶段 11 成就系统——`src/domain/victory/achievements.js`
  （新）、`SeasonalSystems.js`/`ChronicleView.js`/`GalaxyView.js` 修改、
  `src/ui/shell/Tutorial.js`（新）、`tests/regression/golden.json`（新基线
  待提交）。**以下一轮 `git status` 实时输出为准。**
- **最早未收尾阶段**：阶段 03–11 的**领域层与 UI 均已实现**（`implemented`），
  但按 9.2 四步闭环（spec → 领域逻辑 → 界面集成 → 验证收敛）各域专属套件
  尚未补齐（EXP/COL/TECH/SHIP-03/FLEET-02/03/COMBAT-03..06/DIP-02/03/
  GROUND/EVENT/CRISIS 等约 36 行 PENDING），因此这些阶段不授予 `verified`。

## 2. 阶段状态表（任务书 9.1 的 15 个阶段）

| 阶段 | 代号 | 状态 | 证据 / 对应提交 | 说明 |
| :---: | :--- | :--- | :--- | :--- |
| 00 | bootstrap | **verified** | `df247af`（11 files, +992） | 单应用骨架、styles.css 设计系统、PWA 资产（manifest/sw/404）、相对路径与 hash 路由。启动路径：`index.html → src/main.js → src/app/App.js` |
| 01 | core-kernel | **verified** | `78752bc`（12 files, +1266） | `src/core/` 全套：rng（xoshiro128**）/clock/scheduler/eventBus/commandBus（事务回滚）/invariant/math/spatial/serialization/ids。套件 CORE-01/02/02a/02b/05/06 全 PASS |
| 02 | galaxy-world | **verified** | `db88f6c`（37 files, +6487） | `galaxyGen.js` 抖动网格 + kNN 航路 + UnionFind 连通修复 + 出生点公平性；GalaxyView/SystemView；套件 WORLD-01 PASS。基准 96 系（story 64 / large 160 / huge 256） |
| 03 | exploration | **implemented（领域+UI 已接，套件未建）** | `db88f6c` + `943287e` | `domain/exploration/scan.js`：五级扫描、异常 10 模板、首次接触状态机；SystemView 扫描/调查已接。EXP-01..03 套件 PENDING |
| 04 | colonization | **implemented（套件未建）** | `db88f6c` | `domain/planets/colony.js`：前哨/升级/建造队列/人口日结/稳定度/生活需求；ColonyView 已接。COL-01..04 PENDING |
| 05 | economy-industry | **implemented（ECON-01/04 PASS）** | `db88f6c` + `943287e` | ledger/market/colonyTrade 分层存储（原料入殖民地仓储、精炼品入阵营账本）；34 建筑真实配方。ECON-02/03/05 PENDING |
| 06 | research-tech | **implemented（套件未建）** | `db88f6c` | 76 科技 DAG、effectIndex → modifiers.getMod；ResearchView。TECH-01..03 PENDING |
| 07 | ship-fleet | **implemented（SHIP-01/02、FLEET-01 PASS）** | `db88f6c` + `943287e` | 12 船体/37 模块、validateFit、蓝图/船坞建造、planRoute 预检、燃料/受困/加油；DesignerView/FleetView。SHIP-03、FLEET-02/03 PENDING |
| 08 | space-combat | **implemented（COMBAT-01/02 PASS）** | `943287e` | BattleSimulation（dt=1/30s）+ engagement + tactics（命中/分层伤害/导弹/近防/撤退/结算）；CombatView/BattleRenderer。COMBAT-03..06 PENDING |
| 09 | diplomacy-ai-war | **implemented（DIP-01、AI-02/03 PASS；和谈/占领缺失）** | `943287e` | FactionAI（6 人格/7 步决策/防空转/工业阶梯）、五维关系、5 类条约、宣战、战争疲劳；DiplomacyView/GovernmentView。DIP-02/03、AI-01 PENDING |
| 10 | characters-ground | **implemented（地面行动 + 船员/人物已接）** | `f5588cf` + `a94eae6` | GroundMission.js + GroundView（`f5588cf`）；`domain/characters/crew.js`（经验/升级/指派/命运结算）+ GovernmentView 人物面板 + CREW-01 套件 PASS（`a94eae6`）。GROUND-01..03 套件 PENDING |
| 11 | events-crisis | **implemented（套件未建）** | `f5588cf`（成就系统推进中） | `narrative.js`（三幕弧/弹卡抉择）、`crisis.js`（危机流程）、`victory/victory.js`（年度胜利判定与软失败）全部接通；工作树正推进 `victory/achievements.js`（成就）。EVENT-01/02、CRISIS-01 PENDING |
| 12 | complete-ui | **部分就绪（深度走查未做）** | `943287e` + `f5588cf` | 16 个视图 + shell 四件套 + 诊断面板（`#/diagnostics`）；信息检视器全覆盖、快捷键、百科未收敛 |
| 13 | persistence-polish | **implemented（核心；SAVE-01/02 PASS，TabGuard 多标签）** | `df247af`–`f92f4d4` | IndexedDB/校验/槽位/导入导出/自动+快速存档已实现；多标签页仲裁已实现（TabGuard）；Database 事务双重解包导致存档列表/读取恒空的缺陷已修（`f92f4d4`）；历史版本迁移 fixture 与两段式保存仍缺（SAVE-03/04 由 SAVE-02 套件部分覆盖，见 TEST_MATRIX） |
| 14 | release-hardening | **in-progress（发布工程进行中）** | — | deploy/ci 工作流、CHANGELOG、README/docs 刷新已就绪（本会话）；Pages 实际首次发布需仓库账号凭据（Settings → Pages → Source: GitHub Actions） |

## 3. 已实现能力 ↔ 测试编号对照

| 能力 | 关键文件 | 覆盖测试（2026-11-03 实跑两轮全 PASS） |
| :--- | :--- | :--- |
| 确定性 PRNG / 稳定序列化 / 哈希 | `src/core/rng.js`、`serialization.js` | CORE-01、CORE-02 |
| 数学边界 / 战略时钟（自增） | `src/core/math.js`、`clock.js` | CORE-02a、CORE-02b |
| 命令事务回滚 / 确定性调度 | `src/core/commandBus.js`、`scheduler.js` | CORE-05、CORE-06 |
| 星系生成确定性 / 公平性 | `src/domain/world/galaxyGen.js` | WORLD-01 |
| 账本守恒 / 市场价格边界 | `src/domain/economy/ledger.js`、`market.js` | ECON-01、ECON-04 |
| 存档编码 / 中断续推 / 迁移与损坏复验 | `src/persistence/SaveCodec.js` 等 | SAVE-01、SAVE-02 |
| 装配校验 / 建造流程 | `src/domain/ships/ship.js` | SHIP-01、SHIP-02 |
| 航路规划与舰队转移 | `src/domain/fleets/navigation.js` | FLEET-01 |
| 伤害分层 / 命中模型与战斗生命周期 | `src/domain/combat/` | COMBAT-01、COMBAT-02 |
| 条约生命周期与接受效用（含到期/毁约罚分） | `src/domain/diplomacy/war.js` | DIP-01 |
| AI 战役稳定性 / AI 战争与结算 | `src/domain/ai/FactionAI.js` | AI-02、AI-03 |
| 船员人物系统 | `src/domain/characters/crew.js` | CREW-01 |
| 固定种子金快照（自增 L4） | `tests/tools/update-golden.mjs` | REG-01（人物系统并入后基线滚动，见 §4.13） |
| 端到端战役闭环（自增） | `tests/suites/e2e-campaign.suite.js` | E2E-01 |

运行：`node tests/tools/run-suites.mjs`（22 套件 × 2 轮；2026-11-03 实跑
记录见 §1）；浏览器内 `#/diagnostics` 运行同一套件集。

## 4. 已知问题清单（逐条核实，2026-11-03）

> 上一版记录的 12 项已逐条对照源码与提交核实；状态分为
> **已解决 / 部分解决 / 仍开放**。

1. **经济平衡待调 — 仍开放（收窄）**：商业闭环参数（保留库存 RESERVE、每日出售
   上限 60、税率 0.22、市场补货 10%/月）为首发基线；`npm run sim` 工具已可用
   （`f5588cf`）但批量校准未跑；AI 财政危机卖合金（<150 Cr 时卖 40 alloy）
   属补丁式自救。
2. **战斗平衡与特质加成断链 — 仍开放**：`factionDamageMult` 只消费 research 的
   weaponDamage 效果（`tactics.js:174/356`）；`createShip` 调用链
   （`HourlySystems.js:114`、`fleet.js:28`）均未传 `factionMods`，文明特质对
   战斗的加成未接入 `computeShipStats`。
3. **GroundMission 未实现 — 已解决**：`f5588cf` 落地 `GroundMission.js` +
   GroundView；`characters` 生产者已随 `a94eae6`（crew.js）补齐。
4. **crisis / victory 未实现 — 已解决**：`f5588cf` 接通 `crisis.js`、
   `victory/victory.js`（年度判定 + routes + ended 写入）与 `narrative.js`。
5. **存档迁移 fixture 未建 — 部分解决**：SAVE-02 套件以临时迁移注册验证机制
   正确（`0001cda`）；历史 schema 的真实版本 fixture 仍缺。
6. **`saveManager.captureCheckpoint` 缺失 — 已解决**：调用已移除，
   `startNewGame` 全路径可用（`ba9b7a8`）；SaveManager 现有
   save/saveAuto/saveQuick/load/list/remove/commitImport。
7. **`world.createdAt` 未写 — 仍开放**：`createWorld` 不设该字段，
   `SaveCodec.js:22` 记录恒 null。
8. **多标签页仲裁未实现 — 已解决**：`TabGuard.js`（`f5588cf`）以
   BroadcastChannel 协调 + localStorage 心跳退化，后来者只读观察。
9. **stationIds 回填缺失 — 仍开放**：`galaxyGen.js:163` 初始化空数组，
   `scenarioFactory` 建船坞仍不回填（快照 stationCount 恒 0；功能无碍，
   数据不完整）。
10. **package.json 部分脚本指向缺失文件 — 已解决**：四个工具文件均已落地；
    scripts 已切换（`test` → `run-suites.mjs`、`serve` → `dev-server.mjs`），
    随 `f92f4d4` 提交。
11. **和谈/占领缺失 — 仍开放**：`war.js` 预留 `peaceOffers/occupiedSystems`
    字段，但无 ProposePeace/AcceptPeace 命令；战争终局仍只靠疲劳与战场消耗。
12. **消费税/维护费简化 — 仍开放**：`colonyTrade.js:115` 维护仍按每活跃建筑
    1 Cr/日内联计算，建筑 `upkeep` 字段未消费。
13. **金快照基线滚动（新记录）— 处置中**：`loadGolden` 曾因未导入
    `readFileSync` 恒返回 null，REG-01 误报"缺少基线"（`0001cda` 已修）；
    随后人物系统并入（`a94eae6`）改变确定性世界演化，REG-01 报哈希漂移
    `7ecd48dc` ≠ 旧基线 `d2ec8589`。新基线已按套件指引重新生成于工作树，
    **待提交**后 REG-01 恢复预期全绿。
14. **内容批次本地化键未接入（新记录）— 仍开放**：i18n 内核与 zh-CN/en-US
    词典已装配（`content/localization/`），但事件/异常/建筑/科技等内容文本
    大多仍为硬编码中文，未走查接入词典键位。
15. **Database 事务双重解包（新记录）— 已解决**：存档列表/读取恒空
    （`f92f4d4` 修复）。

## 5. 下一步队列（优先级排序）

> 原则（任务书 12.7）：先恢复稳定与证据链，再扩展功能；P0 缺陷阻塞新功能。

1. **P0 — 提交金快照新基线**：工作树中 `tests/regression/golden.json`
   （`7ecd48dc`）随人物系统特性一并提交，REG-01 恢复全绿（已知问题 13）。
2. **P0 — 启用 GitHub Pages 发布**：deploy/ci 工作流已入库（`f92f4d4`）；
   Settings → Pages → Source: GitHub Actions 后推送 main 即自动发布。
   **实际首次发布需要仓库账号凭据**，本地环境无法代办。
3. **P1 — 内容批次本地化键走查**：把事件/异常/建筑/科技等硬编码文本接入
   `content/localization` 词典，清零 i18n"缺失词条"告警（已知问题 14）。
4. **P1 — UI 视图深度走查**（阶段 12 收敛）：16 视图信息检视器全覆盖、
   快捷键、百科。
5. **P1 — 补齐域专属套件**（约 36 行 PENDING，按风险排序）：COMBAT-03..06、
   TECH-01..03、COL-01..04、EXP-01..03、ECON-02/03/05、FLEET-02/03、
   SAVE-03/04 真实 fixture、GROUND/EVENT/CRISIS。
6. **P2 — sim 批量校准**：`node tests/tools/sim-cli.mjs --seeds 5 --years 10
   --json` 跑 AI 经济十年基线，产出经济/战斗调参数据（已知问题 1/2）。
7. **P2 — 战争终局**：和谈/白和/占领判定接入 `war.js` 预留字段
   （已知问题 11）。
8. **P3 — 两段式自动保存与历史版本迁移 fixture**（SAVE-04，已知问题 5）。

## 6. 设计取舍记录

- **原料/精炼分层存储**：原料（矿物/挥发物/生态）存殖民地 `stockpile`、精炼品与
  经济资源存阵营账本。理由：贴近"行星级仓储 vs 文明战略储备"的直觉，让殖民地盈余
  自动出售（colonyTrade）成为财政主循环；代价是跨层转移需要 `colonyToFaction/
  factionToColony` 显式记账（`ledger.js`）。替代方案（单一账本）会让市场自动贸易
  与殖民地饥荒互相踩踏。
- **燃料油箱模型**：燃料 = 随行舰船货舱中的 `hydrogen`（`cargo.hydrogen`）而非独立
  舰队油条。理由：复用统一资源/账本语义，补给舰 cargo 大即为"移动油库"自然成立；
  加油规则每小时 20 吨（殖民地直补）或 1.5× 市价购买，`fuelPerLaneHour=1.0` ×
  平均 fuelEfficiency。代价是"舰队燃料"是派生量（`fleetFuelTotal`），预检必须
  在 planRoute 中完成。
- **planRoute 预检**：移动 = 只读 Dijkstra（敌对主权边权 ×4）→ 燃料/可达性检查
  全部通过才 `beginPlannedTransit`，失败不触碰状态。理由：与命令事务回滚（CORE-05）
  互补，把"必败命令"挡在 execute 之前，AI 与 UI 共用同一解释文案（reason/code）。
- **AI 工业阶梯**：AI 不做自由效用搜索，而是固定优先级补链清单（电力→水循环→食物
  →双矿→挥发物→合金厂→化工→聚合物→实验室），每次评估最多推进一步并附冷却。
  理由：可解释、可回归（AI-01 可断言"无凭空资源"）、防资源死锁；代价是行为模式
  固定，后续用 personality 权重与难度参数做差异化而非改结构。
- **邻近感知接触**：首次接触不只由舰队抵达触发——扫描某星系至 2 级时，其航路邻接
  的他国领土也会触发 `observeForeignSystem`（`scan.js revealSurveyLevel`）。
  理由：96 系规模下 AI 边境压力与玩家情报视角一致，避免"AI 早已互相开战而玩家
  永远不知"的信息断层。
- **战斗在活体实体上进行**：战斗实例只持位置/速度/投射物等瞬态，伤害直接写舰船
  实体（`tactics.js applyHit → ship.hp`）。理由：满足任务书 5.5"结果回写同一 World"，
  避免战斗快照与实体双写不一致；代价是战斗不可回放重演（历史只有战报）。
- **1 战略 tick = 30 战斗秒**：战略小时与战术秒的折算常量（BAL.combat.tickBattleSeconds）。
  理由：一场典型遭遇战（数十战斗秒）在 1–2 个战略 tick 内结束，战略节奏不被战斗拖慢。

## 7. 会话恢复检查单（新会话从这里开始）

1. `git log --oneline` + `git status`：确认提交与工作树（本文 §1 的快照是否过期）。
2. 读 `docs/AUTONOMOUS_RUNBOOK.md`（本文）→ `docs/ARCHITECTURE.md` §5 已知边界。
3. `node tests/tools/run-suites.mjs` 记录基线（22 套件 × 2 轮 = 44 组；
   2026-11-03 实跑记录见 §1；CREW-01 约 54 s/轮、E2E-01 约 70 s/轮，
   全程约 6 分钟）。
4. 确认阶段状态表（§2）中最早已 `implemented` 但未 `verified` 的阶段，
   只推进该阶段及其依赖。
5. 编码前：改动接口/Schema → 同步 `docs/DATA_SCHEMA.md` + 注册迁移 + 补套件；
   规则有意变更 → `npm run golden:update` 更新基线并在 CHANGELOG 记录。

## 最终验收记录（2026-11-03）

- **全量测试**：22 套件 × 2 轮 = 44/44 PASS（`npm test`，含 E2E-01 端到端战役闭环、REG-01 金快照回归 7ecd48dc、CREW-01 人物系统、AI-02/03 十年稳定性与战争管线）。
- **100 游戏年长线验收（15.3 P1）**：seed 424242，逐年不变量 PASS；内存 +21MB（无线性增长，RISK-08 防御有效）；存档 1211KB（预算内，validateSaveRecord 通过）；双银河危机均触发并化解（contained）；纪年 800/交易流水 400/命令日志 600 全部有界；65 分钟完成（离线口径）。
- **浏览器闭环（L5）**：干净检出 + 二级路径 `/deploy-check/` 启动零错误、零外部请求；新战役→银河渲染→时间推进→经济流动→保存→刷新→槽位列表→恢复→继续推进 全链路实测通过；13 视图走查零控制台错误；人物面板/成就面板/新手引导在位。
- **发布（L6）**：本地验收全部通过；GitHub Pages 实际推送需要用户账号凭据（gh CLI 已就绪、`gh auth status` 未登录），`.github/workflows/deploy.yml` 已就位——推送 main 即发布（Settings → Pages → Source: GitHub Actions）。
- **剩余已知事项**（均为平衡/增强，非阻断）：AI 扩张速率偏快（2 年 145 殖民地）、战争触发条件过严（均势局少开战，管线已验证）、政策系统占位（已明确标记锁定）、百科视图未单列（规则文档替代）、内容键的 en-US 深翻未完成（zh 为主语言）。

## 政策系统落地（2026-11-03 补遗，验证器反馈项）

- 4.1 政策系统已全量实现：12 项政策/法令（八类规定全覆盖）、颁布/撤销/互斥/
  冷却/定期到期、行政容量门控与超载稳定度侵蚀（EnactPolicy/RevokePolicy 命令、
  GovernmentView 操作面板）。POL-01 套件 8 项断言通过；全量 23 套件 46/46 PASS
  （金快照基线更新为 a7492dc9）。
- 平衡项已修：扩张成本随殖民规模递增（+30%/4 殖民地，治理约束扩张）、AI 扩张
  成功后 480 tick 冷却、战争触发放宽（军力比 1.3、紧张 20）。浏览器已实测
  颁布扣费/互斥拦截/撤销冷却全链路（零控制台错误）。

## GL 门禁测试结果（2026-11-04）

**GL 门禁测试子代理交付** `src/devtools/glGateTest.js`（788 行）+ 真实浏览器三项门禁验证：

| 门禁 | 结果 | 明细 |
|---|---|---|
| 50 次视图切换泄漏 | **PASS** | GL 对象峰值恒定 40→40（余量 5），堆平台期稳定 |
| WEBGL_lose_context 退化 | **PASS** | 退化链路完整、零异常 |
| 100 艘战舰压测 | **PASS** | avgFps 30.5 / minFps 29.2 / draw 3.88ms（软件渲染下限） |

**发现的 Battle3D 两处缺陷已修复**（b523ebd）：
1. 12 处着色器源码自带 GLSL_VERSION 前缀 → GLCore.createProgram 又前置 → 双 #version → 所有战斗 GL 程序编译失败
2. _scratch 缺少 proj/view 矩阵槽位 → 首帧即抛

**Node 侧 CPU 模拟压测**：100 额外战舰 + 100 tick = 455ms → 220 ticks/s（预算 500ms → PASS）

---

# 行星美学与行星 GamePlay 全线施工（docs 4-7，2026-11-05 起）

> 依据：`docs/specs/4..7`（序列 6 为最高审美裁决，序列 7 为施工总纲）；
> 波次计划与文件所有权见 `docs/digest/master-plan.md`，doc5/7 摘要见 `docs/digest/`。
> 执行顺序：Phase 0 → 三角网格垂直切片 → 人工任务点/POI → 主题系统 → 扩展主题 → 工业/存档硬化。

## Phase 0 — P0 渲染止血与导航软锁解除（TASK-0.1..0.4）

1. **目标与范围**：修复背景残影与地形消失（场景 FBO 无深度附件、无显式清屏）、
   辉光 2× 轨道半径漂移、UIStateStore 缺失、RouteStack 缺失、GroundView 简报软锁。
2. **代码变更**：GLCore（createFloatTarget depth24）、PostProcessor（beginScene 8 步契约，
   唯一清屏所有者）、PlanetSurface3D（pass 状态隔离 + F3 三档诊断 + GL 状态 JSON）、
   System3D（GLOW/RING 双乘修复 + 晨昏线散射 + 轨道 lerp 聚焦）、SystemView（双击聚焦/
   右键径向菜单/回波标签）、UIStateStore（新）、panels.js（稳定 ID）、styles.css（双模退避）、
   App.js（RouteStack/closeInspector）、GroundView（参数化路由 + 返回按钮 + Escape + survey 准入）。
3. **Schema/接口**：无世界结构变更；GLCore.createFloatTarget 签名 `{linear, depth}`。
4. **固定种子/复现**：seed 24601；`#/galaxy` 双击母星 → `#/system/sys_100`。
5. **自动化测试**：26 套件 52/52（改动全程未破坏）。
6. **浏览器 E2E**：UI-01/02/03（结构）/06/07 ✓，NAV-01/02/03/04 ✓，GL-01 目测 ✓
   （8093 dev server + IAB 实机操作）。
7. **截图**：docs/digest/master-plan.md 引用的 artifacts 快照（辉光对齐、地表无残影）。
8. **性能**：地表 drawCalls 8（体素时代基线）。
9. **遗留风险**：Space 双绑定（App 全局暂停 vs SystemView 推进）→ Enter 为主路径。
10. **提交**：`7f5a57d` `27c96d9` `ba8b822` `f647aa2` + `0ad71a4`（简报 keydown 从未绑定
    的回归修复——`_bindInput` 仅任务/自由模式调用，简报级 Escape 独立监听）。

## Phase 1 — 连续三角网格垂直切片（TASK-1.1..1.4）

1. **目标与范围**：planetSeeds 子流树、512m 三角网格场域、surfaceQueries、
   LOD 渲染器（skirt+geomorph+三平面）、GroundView 场域化集成。
2. **代码变更**：planetSeeds/terrainProfiles/terrainField/surfaceQueries（新）、
   PlanetTerrainMesh/PlanetAtmosphere/PlanetSurfaceScene（新）、GroundView（场域化）、
   PlanetSurface3D（对象独占模式）。
3. **Schema**：terrainField chunk（65×65 顶点/块 × 8×8，CCW 索引，materialWeights 4ch，
   TERRAIN_FLAGS 位掩码）；世界结构未变。
4. **固定种子**：24601，`plt_101`（岚托 I）自由探索。
5. **自动化**：TERRAIN-01/02、SITE-06 套件（29→31 套件体系内）。
6. **浏览器 E2E**：连续地形渲染 ✓、角色贴合 ✓、地基垫 ✓、弹簧臂场域射线收臂 ✓。
7. **截图**：三角地形 + 穹顶 + 外骨骼（IAB artifacts）。
8. **性能**：64 chunks，≈120-190k tris，场景帧 0.7-0.9ms（IAB 软件渲染）。
9. **遗留风险**：三处 ANGLE/WebGL 严格性缺陷已修（raw createBuffer 空顶点、
   ARRAY 上传的 buffer 绑 ELEMENT 被静默丢弃 → ELEMENT 目标直传、场域平移符号）；
   材质全白问题归 Wave D 主题调色板。
10. **提交**：`44b4bc3` `69b451c` `a9c0386`。

## Phase 2 — 人工任务点 + POI + WorldObjective（TASK-2.1/2.3）

1. **范围**：MissionSiteBlueprint ×8 + SDF 三层关卡工厂（SITE-01..08 自检）；
   planetPOI 持久化（8 类，rewardPaid 幂等）；WorldObjective 空间实体（5 个 B 类事件
   空间化）；HarvestPlanetPOI/DispatchObjectiveFleet 命令；银河图离屏箭头；EventsView 目标卡。
2. **提交**：`b465999` `044ccfd`；OBJ-01/02 套件入库（31 套件 62/62）。
3. **金快照**：5ac0ed56 → 452e8ba1（pois/objectives 字段）→ d360bb4d（objectives 到期
   罚则接线 DailySystems 后的经济扰动）；CHANGELOG 已记录。
4. **E2E 适配**：e2e-campaign「下单建造」改为补筹重试（罚则合法扰动战役经济）。
5. **GroundView POI 交互**：未勘探 POI 信标渲染 + E 键采样 + HUD 罗盘（field 坐标 →
   世界 = field + 32 映射）。

## Phase 3/4 — 行星主题系统与 18 主题（TASK-3.1..4.3）

1. **范围**：planetThemes 18 主题九维注册表（doc6 §4.4 色板/约束/轨道参数）；
   天体物理约束抽选 + 同星系去重（themeSeed 子流）；System3D 轨道主题着色；
   themePayload 场景载荷（7 旗舰专属太阳/雾/天气/热区/水位/荧光/岩浆/极光/毒雾）；
   PlanetWater 海面层 + 90s 潮汐；7 旗舰地标网格；11 扩展主题配置 + 10 新地貌剖面；
   cloud_giant_atolls atmospheric 登陆模式；伴生卫星（4 类）+ 小行星带（光谱概率表）
   + 黄金角轨道相位 + 18 主题 Web Audio 环境音。
2. **提交**：`c310cd1` `7f19b11` `a40e39d` `a3ad508` `c3bb502`。
3. **套件**：THEME-01（注册表/分配/去重）、THEME-02（载荷健康 + 55 对区分）、
   THEME-04（扩展 11 主题）、WORLD-02（千种子分布：均值 5.0、卫星率 0.852/0.351、
   带率 ±0.08）——34→34 套件体系内 68/68。
4. **实机验收**：abyssal_ocean 主题地表（深海蓝 + 双向焦散光网 + RGB 吸收雾 +
   水位 -4 + 基础设施垫）截图 docs/screenshots/planets-abyssal-themed-surface.png；
   轨道主题身份（海洋行星蓝辉光）+ 卫星入轨截图 planets-system-glow-aligned.png。
5. **金快照**：e81dd30b（主题字段）→ a941b446（卫星/带/相位）。
6. **遗留**：碎环月母星背景环（ringChance 0.85 已由既有环渲染覆盖）；磁暴脉冲
   由 aurora skyMode 载荷承担。

## Phase 5 — 工业/存档硬化/部署（TASK-5.1..5.4）

1. **范围**：terrainEdits 编辑层（五算子刷子 + 植被移植 + 组合 siteModifier 链 +
   planet.terrainEdits 日志持久化重放）；ShapeTerrain/RestoreTerrain/PlaceBuilding
   命令（9 点坡度校验 + 主题地基承台）；GroundView R 键 DSP 恢复；colony
   jobsFilled/η 开动率/五态 runtimeStatus + ColonyView 四级流向看板；
   TD1 stationIds 回填 / TD2 ProposePeace+AnnexOccupied / TD3 投射物 256 环形池 +
   factionMods 汇入 / TD4 i18n 抽取脚本；SCHEMA_VERSION 1→2 迁移（POI/主题/天体/
   编辑日志补齐 + 体素兼容日志零静默丢弃 + 幂等）；100 种子 × 18 主题广度套件 +
   100 次挂载/卸载 mock-GL 零泄漏压测；E2E 门禁页（doc5 §5 矩阵 20 行）。
2. **提交**：`479c4a7` `6907274` `2102d6c` `a47aa64`。
3. **套件**：TERRAIN-06、SAVE-04、TERRAIN-10、TERRAIN-08 入库 —— **38 套件
   76/76 全绿**（2 轮）；金快照 68462446（schemaVersion 2 + terrainEdits 字段）。
4. **实机/部署**：bundle 138 模块 1623KB（node --check 零错）；lint:static 零违规；
   README 计数校准；docs/screenshots/ 证据 6 张。
5. **遗留**：E2E 门禁页 6 项在门禁容器内因 rAF 停摆误报（UI-01/02/04/05/06/07），
   产品行为以实机操作 + 截图独立验证（见 docs/reports/report-planets.md）；
   地质钻探器/地面扫描仪工具 UI（doc6 §6.5 表其余两行）为后续增量。

## 返工轮（docs 8/9，2026-11-06）— 实机审计驳回后的闭环整改

- **背景**：交付 f634828 被项目负责人实机审计（7.4/10）与领域专家二次验收（5.2/10）
  双重驳回：3,648 场任务仿真 112 场坠渊（Y 轴脱节 + 重力逃逸 + 橡皮筋）、2D/3D 维度
  撕裂、四处孤岛死代码（V-05 _pois/_edits 初始化在执行工程师自己的提交链中丢失——
  教训：多轮 python 补丁必须跑全量行为探针而非只看套件绿）。
- **整改**：doc9 十项 VERIFY 全量修复（见 `docs/reports/report-rework-planets.md`
  逐项对映表）；GroundMission 升维 site_meters 米制 3D（蓝图锚点部署 + 3D LOS/掩体）；
  stepCharacterVertical / computeSpringArm / planColonyLayout 三个纯函数抽取
  （实机与无头门禁同源口径）。
- **门禁**：新增 PLAYTEST-GATE-01..04（3648 场零穿地 0.00% / 接线断言 / 相机 360°
  零压溃 / 三主题布局裙边）——42 套件 **84/84 全绿（2 轮）**。
- **提交**：`a956336` `0d38fb9` + 本报告 `docs/reports/report-rework-planets.md`。
- **实机复测**：任务模式 site_abyssal_dome_01 着陆 4.5s + 移动 soak——y === ground、
  vy=0、零穿地（原数秒坠渊场景不复现）。

## 终审返工轮（docs 10/11，2026-11-07）— 专家终审 6.4/10 有条件驳回的全链路根治

- **背景**：领域专家穿透式审计（`docs/specs/10`）裁定 4 项 P0（全场 NaN 隐形 /
  97MB 存档炸弹 / 时钟与交互失真 / 58 星开局暴毙）+ 4 项 P1/P2（体素残留 / HDR 与
  水色失真 / 音效孤岛 / 目标罚款陷阱），定性「只修门禁断言覆盖的半截链路」。
- **整改**：WP-1..WP-6 全量施工（详见 `docs/reports/report-final-rework.md`
  逐项对映 + doc10/doc11 勘误 6 条）：GroundView `_missionToWorld` 统一度量根除
  NaN；GroundMission `_runtimeField` 不可枚举剥离（5850B/0.44ms）+ 读档幂等重建；
  HourlySystems `m.status` 对齐；terrainField `clearFlags` 契约 + 海洋坪面抬升；
  GroundView 技能 5 接 ShapeTerrain/PlaceBuilding/HarvestTerrainOre（新命令）；
  uHdr/主题水色/权威色板/热源对位/脚步涟漪/18 主题音/EXPANSION_GAMEPLAY 全接线；
  `checkAndProgressObjectives` 五结算点闭环。
- **门禁**：GATE-01 升 300 帧（10s）全银河仿真 + HAZARD 因果断言 + 存档健康度
  （HEAD 基线 worktree 对照：hazardFrames 52413 → **0**，战损逐位复现为既有平衡）；
  GATE-02 升级运行态全管线（真实 GroundView 方法 0-NaN 扫描 + 交互/边界/坡度/
  工程坐标契约）。**42 套件 84/84 全绿（2 轮）**；金快照 68462446 零漂移。
- **实机复测**（IAB，硫雾沼泽 plt_3 遗迹调查）：撤离罗盘 46m（原 NaNm）、队友/目标
  可见（原全隐形）、HP 100/100@12s（原 21.7s 团灭类行星）、主题音 sulfur_marsh
  激活（原全静音）、工程模式 5/F 可用、0 帧错误。
- **提交**：本次返工单体提交 + `docs/reports/report-final-rework.md`。
