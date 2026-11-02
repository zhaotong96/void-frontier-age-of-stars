# ARCHITECTURE — 架构与确定性执行模型

> 适用版本：schemaVersion 1 / gameVersion 0.1.0。本文所有路径与导出名均与当前仓库代码一致，
> 供下一名工程师直接交接。配套文档：`docs/DATA_SCHEMA.md`（世界数据模型）、
> `docs/GAME_RULES.md`（玩家可感知规则）、`docs/SAVE_FORMAT.md`（持久化）、
> `docs/TEST_MATRIX.md`（断言矩阵）、`docs/AUTONOMOUS_RUNBOOK.md`（研发状态）。

## 1. 总览与分层依赖图

单仓库、单应用、零外部运行时依赖。依赖方向严格单向（任务书 2.2）：

```text
┌─────────────────────────────────────────────────────────────┐
│  index.html（唯一入口，相对路径加载 ./src/main.js）          │
└──────────────┬──────────────────────────────────────────────┘
               ↓
        src/main.js  （i18n 注册 + 全局错误边界 + 启动 App）
               ↓
┌─────────────────────────────────────────────────────────────┐
│  UI 层   src/app/App.js（根控制器）                         │
│          src/app/Router.js（hash 路由 #/screen/param）      │
│          src/app/ViewRegistry.js（视图注册）                │
│          src/ui/shell/*  src/ui/screens/*  src/ui/*        │
│  输入只产生命令：App.dispatch() ── 禁止直改世界字段         │
└──────────────┬──────────────────────────────────────────────┘
               ↓ 命令 { type, params, targetId, actorId }
┌─────────────────────────────────────────────────────────────┐
│  命令层  src/core/commandBus.js                              │
│          registerCommand / executeCommand（validate →       │
│          execute → 廉价不变量 → 失败整世界回滚）             │
│          命令注册中心：src/app/commands.js（UI 与 AI 共用）  │
└──────────────┬──────────────────────────────────────────────┘
               ↓ 已校验命令 / 调度项
┌─────────────────────────────────────────────────────────────┐
│  模拟层                                                     │
│   simulation/  WorldSimulation.js（advanceOneTick 唯一入口）│
│                TickPipeline.js（阶段注册表）                 │
│                Hourly/Daily/Monthly/SeasonalSystems.js      │
│   domain/      world/ entities/ planets/ economy/ ships/    │
│                fleets/ combat/ exploration/ research/       │
│                diplomacy/ ai/ factions/                     │
│   core/        rng clock ids math spatial serialization     │
│                scheduler eventBus commandBus invariant i18n │
└──────────────┬──────────────────────────────────────────────┘
               ↓ 状态变化 + 领域事件
┌─────────────────────────────────────────────────────────────┐
│  持久化  src/persistence/                                    │
│          SaveManager.js / SaveCodec.js / Database.js        │
│          MigrationRegistry.js / ImportExport.js             │
└──────────────┬──────────────────────────────────────────────┘
               ↓ 只读快照（~4Hz + 命令后立即）
┌─────────────────────────────────────────────────────────────┐
│  快照与视图模型                                              │
│   simulation/SnapshotBuilder.js（buildSnapshot/diplomacySnapshot）
│   simulation/ViewModels.js（colonyDetail/fleetDetail/...）  │
└──────────────┬──────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────┐
│  渲染  src/render/GalaxyRenderer.js / SystemRenderer.js     │
│        BattleRenderer.js / CanvasManager.js / AudioManager.js│
│  （只消费快照，绝不写世界状态）                              │
└─────────────────────────────────────────────────────────────┘
```

依赖硬约束（评审检查项）：

- `domain/`、`simulation/`、`core/` 不导入 `ui/`、`render/`，不触碰 DOM/Canvas。
- `render/` 与 `ui/` 只读快照/视图模型；改状态只有一条路：`App.dispatch → executeCommand`。
- `persistence/` 只序列化纯数据世界；`content/` 只含静态定义，运行时状态一律进 World。
- 例外的合法反向边：`src/domain/ai/FactionAI.js` 导入 `simulation/TickPipeline.js` 的
  `registerHourly`（AI 以"阶段提供者"身份注册，本身仍是模拟层代码）。

## 2. 模块清单与职责

### 2.1 src/core/ — 计算内核（无任何领域知识）

| 文件 | 关键导出 | 职责 |
| :--- | :--- | :--- |
| `src/core/rng.js` | `nextU32` `seedFromNumber` `seedFromString` `float` `int` `range` `intRange` `chance` `pick` `shuffle` `validateState` `RNG` | xoshiro128** 确定性 PRNG；状态为 4×uint32 数组，原地突变；`RNG` 封装直接读写 `world.rng`；`int` 用拒绝采样消偏 |
| `src/core/clock.js` | `HOURS_PER_DAY/DAYS_PER_MONTH/MONTHS_PER_YEAR/TICKS_PER_YEAR` `tickToDate` `dateStr` `isDayStart/isMonthStart/isYearStart` `SPEEDS` | 1 tick=1 游戏小时，8640 tick/年；速度档 暂停/1×/2×/4×/8×（每现实秒 0/6/12/24/48 tick） |
| `src/core/ids.js` | `PREFIXES` `prefixOf` `nextId` `seqOf` `relationKey` | ID 由 `world.seq` 计数器派生（非随机），同种子同命令流 ID 一致；`relationKey` 生成无序阵营对的规范键 `"a|b"` |
| `src/core/scheduler.js` | `registerScheduled` `schedule` `popDue` `runDue` `cancelByKind` | 可序列化调度队列（`world.scheduled`），按 `(tick, seq)` 确定性出队 |
| `src/core/eventBus.js` | `on` `emit` `drainQueue` `dispatch` `recentLog` `chronicle` | 事件入 `world.events.queue` 并按类别归档（`LOG_CAPS` 有界）；监听器在代码侧注册，不进世界状态 |
| `src/core/commandBus.js` | `registerCommand` `executeCommand` `hasCommand` `commandList` | 命令事务：validate（只读）→ execute → `checkQuickInvariants`；执行前 `deepClone` 快照，失败原地回滚；命令写入 `world.commandLog`（上限 600） |
| `src/core/invariant.js` | `checkQuickInvariants` `checkWorldInvariants` `ENTITY_COLLECTIONS` | 廉价检查（ID 空洞/NaN 扩散采样）每 tick 每命令后运行；完整检查（全局 ID 唯一、引用可解析、账本非负、RNG 合法）供存档与诊断 |
| `src/core/math.js` | `clamp` `safeDivide` `lerp` `normalizeAngle` `angleDelta` `dist` `assertFinite` `safeInt` `nonNegInt` `stableSortBy` `sortedKeys` `formatBig` | 边界防护与确定性遍历原语；`sortedKeys` 是全仓遍历规范 |
| `src/core/spatial.js` | `nearestNeighbor` `kNearest` `shortestPath` `connectedComponents` `UnionFind` | k 近邻、Dijkstra 最短路（`planRoute` 用）、连通分量与并查集 |
| `src/core/serialization.js` | `stableStringify` `hash32` `worldHash` `deepClone` `parseWorld` | 键排序稳定序列化；FNV-1a 32 位哈希；`worldHash` 供回归与存档校验共用 |
| `src/core/i18n.js` | `L` `registerAll` | 轻量文案查表；不触碰 window/localization 之外的宿主 API |

### 2.2 src/domain/ — 领域规则（纯函数式系统模块）

| 文件 | 关键导出 | 职责 |
| :--- | :--- | :--- |
| `src/domain/world/World.js` | `createWorld` `SCHEMA_VERSION` `GAME_VERSION` `ENTITY_TYPES` | World v1 工厂（纯数据对象）；16 个实体集合映射 |
| `src/domain/world/galaxyGen.js` | `generateGalaxy` `STAR_TYPES` `PLANET_CATEGORIES` | 抖动网格采样 → k 近邻航路 + 剪枝 → UnionFind 连通修复 → 资源/危险高斯场 → 行星/异常 → 贪心最远点出生点 + 公平性校验 |
| `src/domain/entities/registry.js` | `createEntity` `getEntity` `removeEntity` `eachEntity` `listEntities` `listByFaction` | 实体注册表：自动注入 `id/type/createdAtTick`，确定性遍历 |
| `src/domain/economy/ledger.js` | `FLOW` `ensureLedger` `balance` `credit` `debit` `canAfford` `pay` `refund` `transferBetween` `closeDailyLedgers` `verifyLedgerConsistency` `applyDecay` `collectTax` `creditColony/debitColony` `colonyToFaction/factionToColony` | 账本等式 `S+P+I+L+T = C+E+D`；严禁负库存（`debit` 不足整体失败）；每笔流量带 reason/sourceId 进 `transactions`（上限 400）；殖民地仓储与阵营账本双层 |
| `src/domain/economy/market.js` | `ensureMarket` `price` `updateMarketPrices` `addDemand` `marketBuy` `marketSell` `marketUnitPrice` `setEmbargo` | 每日价格 `P = base × clamp(1+α(D−S)/max(S,25), 0.35, 3.2)`，`priceSmooth=0.35` 平滑；买卖价差模型；禁运 |
| `src/domain/economy/colonyTrade.js` | `dailyColonyCommerce` `restockMarkets` | 殖民地商业闭环：盈余按保留库存自动出售（85% 折价、每资源每日上限 60）→ 税率 22% 上缴 → 缺口注入市场需求；月度市场补货 |
| `src/domain/planets/colony.js` | `foundColony` `powerBalance` `powerFactor` `habitabilityFactor` `tickColonyProduction` `tickColonyConstruction` `dailyPopulation` `buildingDef` | 殖民地/人口/建筑；`RAW_RESOURCES` 分层：原料进殖民地仓储、精炼品进阵营账本；生产周期锁料（`cycleLocked`） |
| `src/domain/ships/ship.js` | `validateFit` `computeShipStats` `createShip` `applyDamage` `destroyShip` `regenShield` `hullDef` `moduleDef` | 装配校验（槽位/功率/CPU/反应堆）；统计值纯函数推导；销毁时从舰队移除但保留实体（status='destroyed'） |
| `src/domain/fleets/fleet.js` | `createFleet` `addShipToFleet` `removeShipFromFleet` `orderMove` | 舰队编组；移动 = `planRoute` 只读预检 → `beginPlannedTransit` |
| `src/domain/fleets/navigation.js` | `laneHours` `fleetSpeed` `beginTransit` `advanceFleets` `refuelFleet` `planRoute` `beginPlannedTransit` `fleetFuelTotal` | 航路时数 `ceil(dist/(最慢船 strategicSpeed × 55))`；燃料 1.0/航路小时（×平均 fuelEfficiency）从随行货舱 `cargo.hydrogen` 扣；耗尽 → `stranded`；抵达后殖民地直补/市场 1.5×市价加油 |
| `src/domain/combat/BattleSimulation.js` | `stepBattles` `stepOneBattle` `finishBattle` `unitBehaviors` `projectileBehaviors` | 战斗实例固定步长 dt=1/30s；1 战略 tick 推进 30 战斗秒；结束条件全歼/超时；战报进 `world.battles.history`（上限 24） |
| `src/domain/combat/engagement.js` | `areHostile` `checkEngagements` `createBattleFromFleets` `findAttackTarget` `orderRetreat` | 每小时交战检查：同星系敌对舰队按 `(factionId)` 序每对只触发一次；确定性左右分列阵位 |
| `src/domain/combat/tactics.js` | `installCombatBehaviors` | 机动（接近/保持距离/环绕/撤退蓄能）、目标选择（威胁加权）、开火（武器周期/弹药/热/缺电禁射）、导弹追踪与近防拦截、命中概率、护盾→装甲→结构伤害管线 |
| `src/domain/exploration/scan.js` | `LEVEL_THRESHOLDS` `scanPower` `canScanTarget` `startScan` `tickScanning` `revealSurveyLevel` `spawnAnomaliesForSystem` `tickAnomalyInvestigation` `resolveAnomaly` `observeForeignSystem` | 扫描五级信息分层；异常调查一次性奖励（幂等）；首次接触状态机入口 |
| `src/domain/research/research.js` | `validateTechGraph` `initResearch` `canStart` `startResearch` `tickResearch` `completeTech` `rebuildEffectIndex` `techStatus` `allTechs` `techDef` | 科技 DAG 校验；科研点单池按序分配（TECH-03）；完成 → `effectIndex` 重建 → 修正即时生效 |
| `src/domain/diplomacy/war.js` | `runDiplomacyTimers` `onTreatyEnd` `getRelation` `declareWar` `createTreaty` `TREATY_TERMS` `treatyAcceptanceScore` | 条约到期/战争疲劳计时；多维关系惰性创建；宣战解除双方条约；条约接受效用 |
| `src/domain/ai/FactionAI.js` | `registerAI` `evaluateFaction` | AI 决策：人格权重 + 经济阶梯 + 扩张/科研/探索/军事/外交；全部经 `executeCommand` 下命令 |
| `src/domain/factions/modifiers.js` | `getMod` `difficultyParam` `applyMods` `explainMod` | 统一修正器：文明特质 → 科技 effectIndex → 政策，聚合顺序确定 |

### 2.3 src/simulation/ — 世界推进

| 文件 | 关键导出 | 职责 |
| :--- | :--- | :--- |
| `src/simulation/TickPipeline.js` | `registerHourly` `registerDaily` `registerMonthly` `registerYearly` `runHourly` `runDaily` `runMonthly` `runYearly` `phaseNames` | 阶段注册表：顺序 = 注册顺序，注册即锁定 |
| `src/simulation/WorldSimulation.js` | `advanceOneTick` `advanceTicks` | 唯一世界推进入口（见 §4） |
| `src/simulation/HourlySystems.js` | （副作用注册）`tickShipyards` | 每小时阶段：orders→navigation→combat→exploration→production→research→diplomacy→ai；船坞队列也在 production 阶段 |
| `src/simulation/DailySystems.js` | （副作用注册） | population→ledger→market→diplomacy-drift；关系自然回归与边境紧张漂移 |
| `src/simulation/MonthlySystems.js` | （副作用注册） | stats-guard→market-restock→treaty-upkeep→chronicle-archive |
| `src/simulation/SeasonalSystems.js` | （副作用注册） | 年度 stats-guard（胜利检查的挂点，当前为占位） |
| `src/simulation/SnapshotBuilder.js` | `buildSnapshot` `diplomacySnapshot` | 只读快照（tick/date/factions/systems/fleets/colonies/battles/alerts/logLines/resources/pendingEvent/victory） |
| `src/simulation/ViewModels.js` | `colonyDetail` `fleetDetail` `shipSummary` `researchView` `marketView` `diplomacyView` `treatySummary` `warSummary` `governmentView` `adminCapacity` `governanceLoad` `designerView` `fitPreview` `shipyardView` `explorationView` `chronicleView` `battleView` `intelView` | 页面级视图模型（仍是只读投影） |

### 2.4 其余层

- `src/app/`：`App.js`（固定步长累加器、命令分发、快照刷新、自动保存检查）、`Router.js`、`ViewRegistry.js`、`commands.js`（20 个玩家/系统命令注册，见 §3.3）。
- `src/content/`：`constants.js`（BAL 平衡常量与 DIFFICULTY）、`resources.js`（29 种资源）、`factions.js`（6 文明 + FACTION_TRAITS）、`hulls.js`（12 船体）、`modules.js`（37 模块）、`weapons.js`（伤害类型与抗性矩阵）、`buildings.js`（34 建筑）、`technologies.js`（76 科技）、`anomalies.js`（10 异常模板）、`localization/`。
- `src/ui/`：`shell/`（TopBar/SideNav/Inspector/BottomBar）、`screens/`（15 个视图，含 `DiagnosticsView.js` 诊断面板）、`components/`、`charts/`。
- `src/render/`：Canvas 渲染器与程序化音频（`AudioManager.js`，音量持久化用 localStorage）。
- `src/persistence/`：见 `docs/SAVE_FORMAT.md`。
- `src/devtools/scenarioFactory.js`：`createStarterCampaign`（SCENARIO-STARTER-001 / CAMPAIGN-01「边疆回声」，默认种子 24601）与 `createMinimalWorld`。
- `tests/suites/` + `tests/tools/run-suites.mjs`：双轮回归套件运行器。

## 3. 确定性执行模型

### 3.1 确定性来源（CORE-01/02/04 的实现基础）

1. **RNG**：xoshiro128**（`src/core/rng.js` `nextU32`），状态 4×uint32 存于 `world.rng`，
   随世界一起序列化。种子经 `seedFromNumber`（splitmix32）扩展；禁止 `Math.random()`
   与 `Date.now()` 进入模拟（真实时间只出现在存档记录的 `savedAt` 字段，见
   `src/devtools/scenarioFactory.js` 顶部注释）。
2. **ID**：`nextId(world, kind)` 由 `world.seq` 单调计数派生（`src/core/ids.js`），
   恢复存档后继续单调。
3. **遍历顺序**：所有实体/键遍历用 `Object.keys(...).sort()` 或 `math.sortedKeys`；
   调度队列按 `(tick, seq)` 出队；AI 评估按 `(hash(factionId)+index) % 24` 错峰但顺序确定。
4. **序列化**：`stableStringify` 键排序、丢弃 undefined/函数；`worldHash`（FNV-1a 32 位）
   同时用于回归测试与存档 checksum。
5. **时间**：模拟推进与渲染完全解耦——`App._frame` 用固定步长累加器
   （`accumulator += dtReal × ticksPerSecond`，单帧最多 40 步，超出丢弃积压），
   渲染帧率不影响模拟结果；暂停即不调用 `advanceOneTick`。

### 3.2 tick 内执行顺序（`src/simulation/WorldSimulation.js` `advanceOneTick`）

```text
world.tick += 1
 1. runDue(world)              —— core/scheduler 到期调度项
 2. runHourly(world)           —— TickPipeline 注册序（见下）
 3. 日/月/年结（tick 边界判定，嵌套触发）
    isDayStart → runDaily → isMonthStart → runMonthly → isYearStart → runYearly
 4. drainQueue + dispatch      —— 领域事件交给监听器
 5. checkQuickInvariants       —— 违规抛错，禁止静默续跑
world.stats.ticksProcessed += 1
```

### 3.3 阶段注册顺序（实际代码顺序）

**每小时**（`src/simulation/HourlySystems.js`，注册顺序 = 执行顺序）：

| # | 阶段名 | 执行内容 |
| -- | :--- | :--- |
| 1 | `orders` | AI 命令超时清理（`BAL.ai.commandTimeoutTicks`=480 超时 + 72 tick 冷却） |
| 2 | `navigation` | `advanceFleets`：在途舰队逐小时推进、燃料结算、受困/抵达、加油与接触检查 |
| 3 | `combat` | `checkEngagements`（交战判定）→ `stepBattles`（30 战斗秒/tick） |
| 4 | `exploration` | 逐舰队 `tickScanning` + `tickAnomalyInvestigation` |
| 5 | `production` | 逐殖民地 `tickColonyProduction` + `tickColonyConstruction` → `tickShipyards`（船坞完工生成舰船） |
| 6 | `research` | 每文明科研点 = `(1 + 实验室数×1.5) × researchOutput 修正` → `tickResearch` |
| 7 | `diplomacy` | `runDiplomacyTimers`：条约到期、战争疲劳 +0.005/小时 |
| 8 | `ai` | `registerAI()` 注册的 `aiHourlyPhase`：每 24 tick 错峰评估（最后执行，依赖前序阶段产物） |

**每日**（`src/simulation/DailySystems.js`）：`population`（人口日结/饥荒/稳定度）
→ `ledger`（资源 decayRule 损耗 + 殖民地库存损耗 + `closeDailyLedgers`）
→ `market`（`dailyColonyCommerce` 商业闭环 + `updateMarketPrices`）
→ `diplomacy-drift`（opinion ×0.995 回归、边境接壤紧张 +0.35、威胁随军力比漂移、贸易依赖缓解）。

**每月**（`src/simulation/MonthlySystems.js`）：`stats-guard` → `market-restock`
（市场库存向基准回填 10%）→ `treaty-upkeep`（贸易/科研条约信任 +1、贸易依赖 +2）
→ `chronicle-archive`（纪年超过 800 条折叠摘除）。

**每年**（`src/simulation/SeasonalSystems.js`）：`stats-guard`（`yearlyCloses` 计数）。

**命令清单**（`src/app/commands.js` 注册，AI 与 UI 共用）：
`IssueScanOrder` `InvestigateAnomaly` `OrderFleetMove` `SetFleetStance` `OrderFleetRetreat`
`OrderFleetAttack` `FoundOutpost` `BuildOnColony` `UpgradeColony` `StartResearch`
`QueueResearch` `MarketBuy` `MarketSell` `DeclareWar` `OfferTreaty` `BreakTreaty`
`ImproveRelations` `SaveBlueprint` `ShipyardBuild` `AssembleFleet`（共 20 个）。

### 3.4 命令事务语义（CORE-05）

`src/core/commandBus.js` `executeCommand` 流程：

1. 未知命令 / 格式非法 → 拒绝，不触碰状态。
2. `validate(ctx, cmd)` 只读前置检查（权限、前置条件、资源成本、目标状态），
   失败返回 `{ok:false, code, reason}` 并计入 `world.stats.commandsFailed`。
3. 执行前 `deepClone(world)` 全量快照。
4. `execute` 唯一修改点；结束后跑 `checkQuickInvariants`，任何异常或不变量失败
   → 原地恢复快照（`restore`：逐键删后赋回，保持对象引用语义），命令记为
   `EXEC_ERROR`。资源扣除、队列登记等复合操作因此天然原子。
5. 成功命令写入 `world.commandLog`（上限 600 条）与 `stats.commandsByType`。

## 4. 零依赖约束与静态部署契约

- **零运行时依赖**：`package.json` 无 `dependencies`/`devDependencies`；生产代码不加载
  CDN、字体、远程 API；原生 ES2022 Modules 直接由浏览器加载，无打包器。
- **相对路径**：`index.html` 以 `./styles.css`、`./src/main.js`、`./manifest.webmanifest`
  引用资源（任务书 1.4 禁止绝对路径）。`sw.js` 预缓存清单全部 `./` 相对路径，
  `CACHE_NAME = 'void-frontier-v1'`。
- **hash 路由**：`src/app/Router.js` 解析 `#/screen/param`（如 `#/galaxy`、`#/system/sys_1`），
  页面刷新不产生服务器请求；未知路由回退菜单（`App._onRoute`）。
- **二级路径**：无任何 `/assets/...` 形式的域名根路径引用，天然兼容
  `https://<user>.github.io/<repo>/` 项目站点；`404.html` 为独立内联样式回退页。
- **PWA**：`manifest.webmanifest` + `sw.js`（缓存优先、同源 GET、离线回退外壳、
  activate 清理旧缓存）。SW 失效时普通 HTTPS 静态加载仍可运行。
- **Node 仅用于开发期**：`npm run test:suites`（套件运行器）、`npm run lint:static`
  （静态审计）、`npm run sim`（离线模拟 CLI）、`npm run golden:update`；游戏本身不依赖 Node。
- **启动路径**：`main.js` → 注册 i18n → `new App(#app).boot()` → 注册 15 视图 →
  构建 shell（TopBar/SideNav/Main/Inspector/BottomBar）→ initRouter → rAF 主循环。
  模拟内核（`WorldSimulation.js`）与命令注册（`app/commands.js`）为动态 `import()`，
  避免启动期阻塞首屏。

## 5. 已知架构边界（如实记录）

- `characters`、`groundMissions`、`crises`、`tradeRoutes` 四个实体集合已在
  `World.ENTITY_TYPES`/`core/invariant.js ENTITY_COLLECTIONS` 中预留，但当前无生产者
  （阶段 10/11 内容）。
- `world.victory` 仅被 `FactionAI`（`world.victory.ended` 短路检查）与快照透传消费，
  没有任何代码写入 `ended`/`routes` —— 胜利条件未实现。
- 多标签页并发写入防护（BroadcastChannel/lease）未实现，同一存档多开无仲裁
  （见 `docs/SAVE_FORMAT.md` §7）。
- `App.startNewGame` 调用 `saveManager.captureCheckpoint(world)`，但
  `src/persistence/SaveManager.js` 当前没有 `captureCheckpoint` 方法（开局检查点为
  待实现点；运行时会抛异常进入全局错误边界）。
