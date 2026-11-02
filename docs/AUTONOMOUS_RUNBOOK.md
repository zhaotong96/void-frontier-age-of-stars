# AUTONOMOUS_RUNBOOK — 长程研发状态记录

> 面向下一名（或下一个会话的）执行工程师：从这里恢复上下文。任务书 12.4 要求本文
> 持续维护。本文最后核对时间：2026-11-03（基于当日 git log 与工作树实况）。
> 阶段定义与验收口径见任务书 9.1 / 9.2；测试编号见 `docs/TEST_MATRIX.md`。

## 1. 当前状态速览

- **当前分支**：`main`（单主线）。
- **最新提交**：`943287e feat(combat,ai,economy): 战术战斗管线全通、文明 AI 工业阶梯、经济分层存储`
  （76 files, +13496/−1169）。
- **工作树**：存在**未提交修改**且在本文档会话期间持续演进（先后观测到 6 个、
  8 个被改文件，涉及 `src/app/App.js`、`src/app/commands.js`、
  `src/devtools/scenarioFactory.js`、`src/domain/ai/FactionAI.js`、
  `src/domain/exploration/scan.js`、`src/domain/fleets/navigation.js`、
  `src/simulation/DailySystems.js`、`src/ui/screens/DiplomacyView.js`）。
  **以下一轮 `git status` / `git diff` 实时输出为准。**本次文档会话只新增了
  `docs/` 下六份文档，未触碰任何 src/tests/styles 文件。
- **最早未收尾阶段**：阶段 03–09 的**领域层已实现**，但按 9.2 四步闭环
  （spec → 领域逻辑 → 界面集成 → 验证收敛）尚未走到"验证与收敛"提交
  （`test(XX): ...` 提交缺失，套件只有 10/57）；因此 03–09 状态记 **in-progress
  （领域层已实现，待收尾验证）**，任何 `verified` 标记都不应授予。

## 2. 阶段状态表（任务书 9.1 的 15 个阶段）

| 阶段 | 代号 | 状态 | 证据 / 对应提交 | 说明 |
| :---: | :--- | :--- | :--- | :--- |
| 00 | bootstrap | **verified** | `df247af`（11 files, +992） | 单应用骨架、styles.css 设计系统、PWA 资产（manifest/sw/404）、相对路径与 hash 路由。启动路径：`index.html → src/main.js → src/app/App.js` |
| 01 | core-kernel | **verified** | `78752bc`（12 files, +1266） | `src/core/` 全套：rng（xoshiro128**）/clock/scheduler/eventBus/commandBus（事务回滚）/invariant/math/spatial/serialization/ids。套件：CORE-01/02/02a/02b/05/06 |
| 02 | galaxy-world | **verified** | `db88f6c`（37 files, +6487） | `galaxyGen.js` 抖动网格 + kNN 航路 + UnionFind 连通修复 + 出生点公平性；GalaxyView/SystemView；套件 WORLD-01。基准 96 系（story 64 / large 160 / huge 256） |
| 03 | exploration | **领域层已实现，待收尾** | `db88f6c` + `943287e` | `domain/exploration/scan.js`：五级扫描、异常 10 模板、首次接触状态机。UI（SystemView 扫描/调查）已接。EXP-01..03 套件 PENDING |
| 04 | colonization | **领域层已实现，待收尾** | `db88f6c` | `domain/planets/colony.js`：前哨/升级/建造队列/人口日结/稳定度；COL-01..04 PENDING |
| 05 | economy-industry | **领域层已实现，待收尾** | `db88f6c` + `943287e` | ledger/market/colonyTrade 分层存储（原料入殖民地仓储、精炼品入阵营账本）；34 建筑真实配方；套件 ECON-01/04 PASS，ECON-02/03/05 PENDING |
| 06 | research-tech | **领域层已实现，待收尾** | `db88f6c` | 76 科技 DAG、effectIndex → modifiers.getMod；ResearchView。TECH-01..03 PENDING |
| 07 | ship-fleet | **领域层已实现，待收尾** | `db88f6c` | 12 船体/37 模块、validateFit、planRoute 预检、燃料/受困/加油；DesignerView/FleetView。SHIP-01..03、FLEET-01..03 PENDING |
| 08 | space-combat | **领域层已实现，待收尾** | `943287e` | BattleSimulation（dt=1/30s）+ engagement + tactics（命中/分层伤害/导弹/近防/撤退）；CombatView/BattleRenderer。COMBAT-01..06 PENDING |
| 09 | diplomacy-ai-war | **领域层已实现，待收尾** | `943287e` | FactionAI（6 人格/7 步决策/防空转）、五维关系、5 类条约、宣战、战争疲劳；DiplomacyView/GovernmentView。DIP-01..03、AI-01..03 PENDING |
| 10 | characters-ground | **未开始** | — | `characters`/`groundMissions` 集合已预留，无生产者 |
| 11 | events-crisis | **未开始**（叙事旗标预留） | — | `narrative.fired/arcs/flags`、`crises` 预留；victory 仅占位 |
| 12 | complete-ui | **部分就绪（随阶段附带）** | `943287e` | 15 个视图 + shell 四件套 + 诊断面板已存在；统一收敛（信息检视器全覆盖、快捷键、百科）未做 |
| 13 | persistence-polish | **部分实现** | `df247af`–`943287e` | IndexedDB/校验/槽位/导入导出已实现；迁移 fixture、两段式保存、多标签页仲裁缺失（见 docs/SAVE_FORMAT.md §8） |
| 14 | release-hardening | **未开始** | — | 依赖全部前序阶段 |

## 3. 已实现能力 ↔ 测试编号对照

| 能力 | 关键文件 | 覆盖测试 |
| :--- | :--- | :--- |
| 确定性 PRNG / 稳定序列化 / 哈希 | `src/core/rng.js`、`serialization.js` | CORE-01、CORE-02 PASS |
| 数学边界 / 时钟 | `src/core/math.js`、`clock.js` | CORE-02a、CORE-02b PASS（自增行） |
| 命令事务回滚 | `src/core/commandBus.js` | CORE-05 PASS |
| 确定性调度 | `src/core/scheduler.js` | CORE-06 PASS（调度器本体；事件分发联动待补） |
| 账本守恒 / 损耗 | `src/domain/economy/ledger.js` | ECON-01 PASS |
| 市场价格边界 / 禁运 / 价差 | `src/domain/economy/market.js` | ECON-04 PASS |
| 存档编码 / checksum / 导入拒绝 / 迁移注册 | `src/persistence/SaveCodec.js`、`MigrationRegistry.js` | SAVE-01 PASS |
| 星系生成确定性 / 公平性 | `src/domain/world/galaxyGen.js` | WORLD-01 PASS |
| 其余 47 行 | — | PENDING（计划文件见 TEST_MATRIX） |

运行：`node tests/tools/run-suites.mjs`（每套件 2 轮）；浏览器内 `#/diagnostics`。

## 4. 已知问题清单（如实）

1. **经济平衡待调**：商业闭环参数（保留库存 RESERVE、每日出售上限 60、税率 0.22、
   市场补货 10%/月）为首发基线，未经 `npm run sim` 批量模拟校准；AI 财政危机卖合金
   （<150 Cr 时卖 40 alloy）属补丁式自救。
2. **战斗平衡待调**：武器伤害/命中/抗性矩阵为基线值；`factionDamageMult` 只消费
   research 的 weaponDamage 效果，文明特质对战斗的加成（如 ember_nomad hitChanceBonus）
   未接入战斗统计推导（`computeShipStats` 的 factionMods 参数在 `createShip` 调用链
   中未传入）。
3. **GroundMission 未实现**：阶段 10 整体未开始；`groundMissions`/`characters` 集合空置。
4. **crisis / victory 未实现**：`crises` 集合空置；`world.victory` 无写入方（占位），
   年度结算只有统计钩子；`narrative.pendingChoices` 无生产者（App 弹卡逻辑待命）。
5. **存档迁移 fixture 未建**：MigrationRegistry 机制可用但无历史版本、无 fixture 目录、
   无 SAVE-04 套件（SAVE-02/03 亦未建）。
6. **`saveManager.captureCheckpoint` 缺失**：`App.startNewGame`（`src/app/App.js`）调用它，
   `SaveManager.js` 未实现 → 新战役开局路径会抛异常（被 main.js 全局错误边界捕获并提示）。
   修复前，用 `loadGame` 路径可正常进入战役。
7. **`world.createdAt` 未写**：`createWorld` 不设该字段，存档记录 `createdAt` 恒 null。
8. **多标签页仲裁未实现**：无 BroadcastChannel/lock，同存档多开有并发覆盖风险。
9. **stationIds 回填缺失**：`scenarioFactory` 建船坞未写 `system.stationIds`
   （快照 stationCount 恒 0；功能无碍，数据不完整）。
10. **package.json 部分脚本指向缺失文件**：`static-audit.mjs`、`sim-cli.mjs`、
    `update-golden.mjs`、`tests/node/` 尚不存在，接入前需补（README 已宣传 lint:static）。
11. **和谈/占领缺失**：战争无和平路径（peaceOffers/occupiedSystems 预留），
    AI 宣战后只能靠疲劳与战场消耗；与任务书 5.4 差距明确。
12. **消费税/维护费简化**：殖民地维护按每活跃建筑 1 Cr/日（colonyTrade 内联），
    建筑 `upkeep` 字段未消费。

## 5. 下一步队列（优先级排序）

> 原则（任务书 12.7）：先恢复稳定与证据链，再扩展功能；P0 缺陷阻塞新功能。

1. **P0 — 修复 `captureCheckpoint` 缺失**（已知问题 6）：实现或移除调用，
   保证 `startNewGame` 全路径可用；顺带写 `world.createdAt`。
2. **P0 — 提交当前工作树**：6 个未提交文件（AI/导航/扫描/外交 UI 的演进）按
   Conventional Commits 拆分原子提交；`docs/` 六份文档以 `docs(...):` 提交。
3. **P1 — 补齐 L1/L2 套件**（按风险排序）：`core-pause`+`core-framerate`
   （CORE-03/04）、`ship-fit`（SHIP-01）、`fleet-navigation`+`fleet-fuel`
   （FLEET-01/02）、`combat-damage`/`combat-settle`（COMBAT-01/06）、
   `save-rng`（SAVE-02）、`tech-prereq`（TECH-01）。
4. **P1 — 战争终局**：和谈/白和/占领判定（阶段 09 收尾），否则长程战役不可收敛。
5. **P2 — 离线模拟工具**：补 `tests/tools/sim-cli.mjs`（README/package.json 已承诺），
   跑 AI-01 的 10 年基线，产出平衡调参数据（经济/战斗）。
6. **P2 — SAVE-04 fixture 与两段式自动保存**；多标签页 lease（任务书 8.4）。
7. **P3 — 阶段 10（角色/地面行动）**：按任务书 9.13，先 spec + schema
   （characters/groundMissions 生产者），再动作状态机。
8. **P3 — 阶段 11（事件/危机/胜利）**：事件触发器 + 三幕主线 + victory 写入方。
9. **P4 — 阶段 12/13/14 收敛**：UI 统一、性能预算、发布硬化（依赖前序）。

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
3. `node tests/tools/run-suites.mjs` 记录基线（10 套件 ×2 轮；套件文件均已注册，
   预期全 PASS——本次文档会话环境无 Node 可执行文件，未实际运行，以首跑输出为准）。
4. 确认最早未收尾阶段（§2 表），只推进该阶段及其依赖。
5. 编码前：改动接口/Schema → 同步 `docs/DATA_SCHEMA.md` + 注册迁移 + 补套件。
