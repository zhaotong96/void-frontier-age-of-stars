# TEST_MATRIX — 任务书 10.2 断言矩阵映射

> 状态定义：**PASS** = 已实现且已接入套件运行器；**PENDING** = 尚未实现，已给出计划
> 测试文件名。矩阵逐行对应任务书 10.2 的 57 条断言；补充套件 `CORE-02a/02b` 为
> 项目自增行（数学边界/战略时钟），任务书允许增加不允许删除。

## 1. 运行方法

### 1.1 Node 命令行（开发期）

```bash
node tests/tools/run-suites.mjs     # 或 npm run test:suites
```

运行器（`tests/tools/run-suites.mjs`）：从 `tests/suites/index.js` 收集全部套件
（按 id 升序），**每个套件运行 2 轮**验证结果稳定、无状态泄漏；逐行打印
`ID PASS/FAIL 耗时 名称`，任何 FAIL 置 `process.exitCode = 1`。
要求 Node ≥ 18（`package.json engines`）。

### 1.2 浏览器系统诊断面板（任务书 10.4）

启动静态服务器后打开 `#/diagnostics`（左侧导航「系统诊断」，实现于
`src/ui/screens/DiagnosticsView.js`）：「运行全部测试」按钮直接 `import`
`tests/suites/index.js` 的 `collectSuites()` 在浏览器内运行全部套件，
结果按 group 分组展示（编号、说明、耗时、失败详情），并可导出 JSON 报告。
诊断不依赖也不污染玩家当前存档。

### 1.3 其他开发工具（package.json scripts）

| 命令 | 作用 |
| :--- | :--- |
| `npm run lint:static` | 静态审计：外部依赖/绝对路径/占位代码扫描（`tests/tools/static-audit.mjs`，见 §3 注意事项） |
| `npm run sim` | 离线批量模拟 CLI，平衡调参（`tests/tools/sim-cli.mjs`） |
| `npm run golden:update` | 固定种子回归快照更新（`tests/tools/update-golden.mjs`） |
| `npm test` | Node 内置测试入口（`tests/node/`，预留） |

> 注意：`static-audit.mjs`、`sim-cli.mjs`、`update-golden.mjs` 与 `tests/node/`、
> `tests/core/` 等目录为规划路径，当前仓库中尚不存在对应文件/目录
> （`tests/` 下现有 `suites/` 与 `tools/run-suites.mjs`）。接入前先补文件。

## 2. 断言矩阵逐行映射

### 2.1 CORE — 内核

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| CORE-01 Seeded PRNG | `tests/suites/core-rng.suite.js` | PASS | 同种子 10000 值两轮一致；不同种子前 100 值内分歧；float/int 越界与拒绝采样校验；非法状态校验 |
| CORE-02 确定性模拟 | `tests/suites/core-serialization.suite.js` | PASS | stableStringify 键排序稳定、worldHash 一致、deepClone 往返、序列化两次哈希相同 |
| CORE-02a 数学边界（自增） | `tests/suites/core-math.suite.js` | PASS | clamp/safeDivide/normalizeAngle/safeInt/formatBig 边界（NaN、零除、极值） |
| CORE-02b 战略时钟（自增） | `tests/suites/core-clock.suite.js` | PASS | tick→日期换算、8640 tick/年、日/月/年边界判定、速度表 |
| CORE-03 暂停 | 计划 `tests/suites/core-pause.suite.js` | PENDING | 需要模拟循环桩：暂停态推进 N 帧后 tick/账本/AI 状态不变化 |
| CORE-04 帧率解耦 | 计划 `tests/suites/core-framerate.suite.js` | PENDING | 不同 render cadence（累加器 dt 序列）推进相同逻辑 tick，worldHash 一致 |
| CORE-05 命令事务 | `tests/suites/core-command.suite.js` | PASS | 资源不足命令被拒；execute 抛错后整世界回滚（对象引用保持）；部分扣费不复存在 |
| CORE-06 事件调度 | `tests/suites/core-scheduler.suite.js` | PASS | 同 tick 多调度项按 (tick, seq) 确定性出队、无重复触发 |

> CORE-06 覆盖说明：该套件验证 `schedule/popDue/runDue` 的确定性语义
> （含乱序入队、同 tick tie-break）；跨系统「事件分发顺序」由
> `eventBus.dispatch` 按注册顺序保证，目前无独立套件，建议并入 core-pause 套件补充。

### 2.2 WORLD — 星系生成

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| WORLD-01 星系生成 | `tests/suites/world-gen.suite.js` | PASS | 多固定种子两次生成：实体数/坐标/航路逐一相等；ID 唯一；无 NaN；出生文明扩张前沿 ≥ 2 |
| WORLD-02 航路图 | 计划 `tests/suites/world-lanes.suite.js` | PENDING | 全源连通性检查、度数下限（lanesPerNodeMin=2）、平均航路边目标 |
| WORLD-03 起源公平性 | 计划 `tests/suites/world-fairness.suite.js` | PENDING | 各文明初始资源/可扩张路径阈值（当前 scenarioFactory 有公平性 warnings，需断言化） |
| WORLD-04 天体属性 | 计划 `tests/suites/world-celestials.suite.js` | PENDING | 7 恒星 × 8 行星类别属性范围合法、恒星影响宜居带/噪声/危险 |

### 2.3 EXP / COL — 探索与殖民

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| EXP-01 扫描进度 | 计划 `tests/suites/exp-scan.suite.js` | PENDING | 高级传感器精度不低于低级；噪声阈值；五级阈值递进 |
| EXP-02 异常奖励 | 计划 `tests/suites/exp-anomaly.suite.js` | PENDING | surveyRewarded/resolveAnomaly 幂等：重复命令只结算一次 |
| EXP-03 首次接触 | 计划 `tests/suites/exp-contact.suite.js` | PENDING | none→signal→contacted 状态差异；observeForeignSystem 分支 |
| COL-01 殖民成本 | 计划 `tests/suites/colony-found.suite.js` | PENDING | 资源不足 FoundOutpost 被拒、余额不变；宜居度 <20 阻断 |
| COL-02 人口守恒 | 计划 `tests/suites/colony-population.suite.js` | PENDING | 长程推进后 期初+增长−死亡 = 期末（整数人口模型） |
| COL-03 生活需求 | 计划 `tests/suites/colony-needs.suite.js` | PENDING | 断食→饥荒死亡+ColonyFamine；断电→降产；无瞬时无因变化 |
| COL-04 宜居度 | 计划 `tests/suites/colony-habitability.suite.js` | PENDING | habitabilityFactor 0.5–1.2 对增长/产出的趋势影响 |

### 2.4 ECON / TECH — 经济与科研

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| ECON-01 资源账本 | `tests/suites/economy-ledger.suite.js` | PASS | credit/debit/pay/refund/transfer 流量记账；`verifyLedgerConsistency` 账本等式；负库存拒绝；decayRule |
| ECON-02 负库存 | 计划 `tests/suites/economy-negative.suite.js` | PENDING | 多笔并发订单下不产生未授权负库存/重复扣款（命令层事务组合） |
| ECON-03 工业链 | 计划 `tests/suites/economy-chain.suite.js` | PENDING | 矿→合金→模块→舰船端到端，各阶段流量可追溯（reason/sourceId） |
| ECON-04 市场价格 | `tests/suites/economy-market.suite.js` | PASS | 价格方向与 0.35×/3.2× 边界、平滑收敛、买卖价差、禁运 |
| ECON-05 贸易路线 | 计划 `tests/suites/economy-trade.suite.js` | PENDING | 商业闭环：保留库存/每日上限/税上缴/需求注入（tradeRoutes 实体化前以 colonyTrade 为准） |
| TECH-01 科技前置 | 计划 `tests/suites/tech-prereq.suite.js` | PENDING | canStart 拒绝 + 不扣资源；validateTechGraph 无环 |
| TECH-02 科技解锁 | 计划 `tests/suites/tech-unlock.suite.js` | PENDING | 完成科技后 effectIndex 重建并实际改变规则（strategicSpeed 等） |
| TECH-03 研究队列 | 计划 `tests/suites/tech-queue.suite.js` | PENDING | 多项目分配之和 ≤ 实际科研产出；队列自动补位不跳前置 |

### 2.5 SHIP / FLEET — 舰船与舰队

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| SHIP-01 装配合法性 | 计划 `tests/suites/ship-fit.suite.js` | PENDING | validateFit：槽位超限/功率缺口/CPU 超限/缺反应堆（NO_REACTOR）逐一拦截 |
| SHIP-02 舰船建造 | 计划 `tests/suites/ship-build.suite.js` | PENDING | ShipyardBuild 扣料/队列推进/完工 createShip；缺料拒绝 |
| SHIP-03 模块损伤 | 计划 `tests/suites/ship-damage.suite.js` | PENDING | 战斗中 hp 分层下降并持久化；destroyShip 引用清理 |
| FLEET-01 航行时间 | 计划 `tests/suites/fleet-navigation.suite.js` | PENDING | laneHours = ceil(dist/(最慢船速×55))；多段 legs ETA 累加 |
| FLEET-02 燃料耗尽 | 计划 `tests/suites/fleet-fuel.suite.js` | PENDING | planRoute NO_FUEL 预检；途中耗尽 → stranded + FleetStranded |
| FLEET-03 补给 | 计划 `tests/suites/fleet-supply.suite.js` | PENDING | 殖民地直补 20/h、市场 1.5× 加价、搁浅恢复 |

### 2.6 COMBAT — 战术战斗

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| COMBAT-01 伤害层级 | 计划 `tests/suites/combat-damage.suite.js` | PENDING | 护盾→装甲→结构顺序、layerResist 抗性、0.85 上限 |
| COMBAT-02 射程边界 | 计划 `tests/suites/combat-range.suite.js` | PENDING | 命中概率随 (d−optimal)/falloff 衰减、clamp 0.02–0.98 |
| COMBAT-03 武器周期 | 计划 `tests/suites/combat-cycle.suite.js` | PENDING | cycleSeconds 冷却、耗能/弹药消耗与开火次数一致 |
| COMBAT-04 战术暂停 | 计划 `tests/suites/combat-pause.suite.js` | PENDING | 暂停后 stepBattles 不推进（由全局暂停保证，需回归锁定） |
| COMBAT-05 导弹拦截 | 计划 `tests/suites/combat-missile.suite.js` | PENDING | 追踪/近防/生命周期唯一（不重复命中/销毁）、投射物上限 600 |
| COMBAT-06 战后结算 | 计划 `tests/suites/combat-settle.suite.js` | PENDING | finishBattle 战报入 history（上限 24）、损失各结算一次、舰船移出舰队 |

### 2.7 DIP / AI — 外交与 AI

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| DIP-01 外交条约 | 计划 `tests/suites/dip-treaty.suite.js` | PENDING | treatyAcceptanceScore → 接受/拒绝分支；同类重复缔约拒绝 |
| DIP-02 违约 | 计划 `tests/suites/dip-breach.suite.js` | PENDING | BreakTreaty/到期/宣战毁约的 trust/opinion/grievances 差异 |
| DIP-03 情报置信度 | 计划 `tests/suites/dip-intel.suite.js` | PENDING | 未接触不暴露数值；intelConfidence 随接触提升（0.2→0.35） |
| AI-01 AI 经济 | 计划 `tests/suites/ai-economy.suite.js` | PENDING | 10 游戏年离线模拟（`npm run sim`）不负债/不无限建造/无凭空资源 |
| AI-02 AI 航行 | 计划 `tests/suites/ai-navigation.suite.js` | PENDING | 不可达目标可取消/重规划；命令超时 480 tick 清理 |
| AI-03 AI 战争 | 计划 `tests/suites/ai-war.suite.js` | PENDING | 多文明战争 5 年：宣战条件、回防、疲劳累积 |

### 2.8 GROUND / EVENT / CRISIS — 地面行动与叙事（内容未实现，测试随阶段 10/11 立项）

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| GROUND-01 动作状态机 | 计划 `tests/suites/ground-actions.suite.js` | PENDING | 依赖地面行动系统（阶段 10，未实现） |
| GROUND-02 Boss 阶段 | 计划 `tests/suites/ground-boss.suite.js` | PENDING | 同上 |
| GROUND-03 任务回写 | 计划 `tests/suites/ground-mission.suite.js` | PENDING | 依赖 groundMissions 实体生产者 |
| EVENT-01 事件互斥 | 计划 `tests/suites/event-once.suite.js` | PENDING | narrative.fired 去重（当前仅有字段预留 + 异常 storyTag 写入） |
| EVENT-02 分支状态 | 计划 `tests/suites/event-branch.suite.js` | PENDING | 事件系统阶段 11 实现 |
| CRISIS-01 危机流程 | 计划 `tests/suites/crisis-flow.suite.js` | PENDING | crises 实体无生产者，阶段 11 |

### 2.9 SAVE / UI / DEPLOY — 持久化、UI 与部署

| 编号 | 测试文件 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| SAVE-01 保存恢复 | `tests/suites/save-codec.suite.js` | PASS | encodeSave→validateSaveRecord→导出导入往返；篡改 payload 捕获 checksum 失败；非法 JSON/format 拒绝；MigrationRegistry v1→v2 注册与迁移 |
| SAVE-02 RNG 恢复 | 计划 `tests/suites/save-rng.suite.js` | PENDING | 存档→读档→续推 N tick 与不中断推进 worldHash 一致（依赖 worldHash 长程基线） |
| SAVE-03 损坏文件 | 计划 `tests/suites/save-corrupt.suite.js` | PENDING | 字段缺失/类型错误/超 24MB 导入拒绝且原存档不受影响（encodeSave 部分已覆盖，需补 ImportExport 与 Database 层） |
| SAVE-04 版本迁移 | 计划 `tests/suites/save-migration.suite.js` | PENDING | 历史 schema fixture 迁移后通过 checkWorldInvariants（当前 v1 无历史版本，fixture 未建） |
| UI-01 操作可达性 | 计划 `tests/suites/ui-loop.suite.js`（或浏览器验收脚本） | PENDING | 不开 DevTools 走完核心循环；属于 L5 浏览器验收 |
| UI-02 路由恢复 | 计划 `tests/suites/ui-route.suite.js` | PENDING | 刷新 `#/galaxy`、`#/fleet/xxx`、`#/battle/xxx` 定位有效页面 |
| DEPLOY-01 二级路径 | 计划 `tests/suites/deploy-basepath.suite.js`（静态扫描）+ 手工二级路径模拟 | PENDING | `/repo/` base path 下无 404（lint:static 的绝对路径扫描是前置） |
| DEPLOY-02 外部请求审计 | 计划 `tests/suites/deploy-audit.suite.js` + 运行时网络面板核对 | PENDING | 无第三方运行时请求/远程 API（静态审计 + L5/L6 人工环节） |

## 3. 套件清单现状

`tests/suites/index.js` 当前注册 **10 个套件**：

| 套件文件 | id | 组 |
| :--- | :--- | :--- |
| `core-rng.suite.js` | CORE-01 | core |
| `core-serialization.suite.js` | CORE-02 | core |
| `core-math.suite.js` | CORE-02a | core |
| `core-clock.suite.js` | CORE-02b | core |
| `core-command.suite.js` | CORE-05 | core |
| `core-scheduler.suite.js` | CORE-06 | core |
| `economy-ledger.suite.js` | ECON-01 | economy |
| `economy-market.suite.js` | ECON-04 | economy |
| `save-codec.suite.js` | SAVE-01 | persistence |
| `world-gen.suite.js` | WORLD-01 | world |

即任务书矩阵 57 行中 **8 行 PASS**（CORE-01/02/05/06、ECON-01/04、SAVE-01、WORLD-01），
另有 **2 行自增套件**（CORE-02a/02b）——合计 **10 套件 PASS**；其余 49 行 **PENDING**。
PENDING 行全部给出了计划文件名，命名沿用 `tests/suites/<域>-<主题>.suite.js`
约定（与 index.js 的 import + collectSuites 注册方式一致）。
建议优先补齐顺序见 `docs/AUTONOMOUS_RUNBOOK.md` §4 下一步队列。
