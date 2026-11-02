# GAME_RULES — 玩家可感知规则汇总

> 本文只写当前代码真实实现的规则（含如实标注的占位）。数值来源：
> `src/content/constants.js`（BAL）、`src/content/resources.js`、`src/content/buildings.js`、
> `src/content/hulls.js`、`src/content/modules.js`、`src/content/weapons.js`、
> `src/content/technologies.js`（76 项）、`src/content/factions.js`、`src/content/anomalies.js`。
> 引用路径均为真实文件。

## 1. 时间与速度

- **1 tick = 1 游戏小时**；24 小时/日，30 日/月，12 月/年 → **8640 tick/年**
  （`src/core/clock.js TICKS_PER_YEAR`）。纪年显示「星历 Y.MM.DD HH:00」（`dateStr`）。
- 速度档（`clock.js SPEEDS`）：暂停 / 1×(6 tick/s) / 2×(12) / 4×(24) / 8×(48)。
  空格暂停、1–4 调倍率（快捷键绑定在 UI 层）。
- 固定步长累加器推进（`src/app/App.js _frame`），暂停时世界完全冻结；渲染帧率不影响模拟。
- 日结/月结/年结在 tick 边界嵌套触发（`src/simulation/WorldSimulation.js`）。

## 2. 资源（29 种，`src/content/resources.js`）

| 类别（category） | 资源 | 备注 |
| :--- | :--- | :--- |
| 基础矿物 baseMineral (4) | `ferro` 铁族金属(4Cr/t)、`silicate` 硅质矿物(3)、`rareEarth` 稀土矿(18, 战略)、`heavyMetal` 重金属(10) | 采掘产出，存**殖民地仓储** |
| 工业材料 industrial (5) | `alloy` 合金(22, 战略)、`polymer` 聚合物(14)、`composite` 复合材料(34, 战略)、`ceramic` 陶瓷(20)、`conductor` 导体(30, 战略) | 精炼/制造产出，存**阵营账本** |
| 挥发物 volatile (5) | `hydrogen` 氢(2, 每日损耗 0.1%)、`helium3` 氦-3(16, 战略)、`deuterium` 氘(26, 战略)、`inertGas` 惰性气体(8)、`reagents` 化学试剂(12, 损耗 0.2%) | 氢为舰队燃料 |
| 生态资源 bio (5) | `food` 食物(3, 损耗 1.5%)、`water` 水(1)、`oxygen` 氧气(2)、`biomass` 生物质(6, 损耗 0.8%)、`medicine` 药品(24, 损耗 0.4%) | 殖民地仓储 |
| 能源 energy (2) | `powerCell` 储能单元(28)、`reactorFuel` 反应堆燃料(40, 战略) | 建筑电力走 powerGen/powerUse，不走资源流量 |
| 高级资源 advanced (4) | `quantumCrystal` 量子晶体(120)、`darkMatter` 暗物质(400, 不可交易)、`exoticMatter` 奇异物质(320, 不可交易)、`ancientData` 古代数据(150, 不可交易) | 异常/危机产出 |
| 经济资源 economic (4) | `credits` 信用点、`influence` 影响力、`researchData` 科研数据(10)、`intelPoints` 情报点 | 抽象计量 |

- **双层存储**（`src/domain/planets/colony.js RAW_RESOURCES`）：原料（基础矿物/挥发物/生态）
  存殖民地 `stockpile`；精炼品与经济/高级资源存阵营账本 `economy.ledgers`。
- **严禁负库存**：`ledger.js debit` 不足整体失败；`pay` 原子批量扣款。
- 每日损耗（decayRule.perDayPct）在 DailySystems ledger 阶段对账本与殖民地库存分别执行。
- 信用点不可凭空创造：所有变动带 reason/sourceId 进 `transactions` 流水（税收走 `tax` 流量）。

## 3. 生产链（真实配方，`src/content/buildings.js`）

配方字段 `{hours, inputs, outputs}`；能耗走 `powerGen/powerUse` 不进配方。单周期产出口径。

### 3.1 采掘 →（殖民地仓储）

| 建筑 | 科技 | 周期 | 产出 |
| :--- | :--- | :--- | :--- |
| 铁族矿井 bld_mine_ferro | — | 12h | ferro×16 |
| 硅质矿井 bld_mine_silicate | — | 12h | silicate×16 |
| 重金属矿井 bld_mine_heavy | tech_mining_1 | 12h | heavyMetal×10 |
| 深层稀土矿场 bld_mine_rare | tech_mining_2 | 24h | rareEarth×9 |
| 挥发物井 bld_volatile_well | tech_mining_1 | 12h | hydrogen×18 + helium3×3 |
| 气体采集站 bld_gas_harvester | tech_mining_1 | 12h | inertGas×10 + hydrogen×12 |

### 3.2 精炼（原料 → 精炼品）

| 建筑 | 科技 | 周期 | 投入 → 产出 |
| :--- | :--- | :--- | :--- |
| 合金厂 bld_alloy_plant | tech_alloy_1 | 24h | ferro×34 + silicate×22 → **alloy×16** |
| 化学试剂厂 bld_chem_plant | tech_polymer_1 | 24h | hydrogen×12 + water×4 → reagents×12 |
| 聚合物厂 bld_polymer_plant | tech_polymer_1 | 24h | reagents×12 + hydrogen×10 → **polymer×14** |
| 重水精炼厂 bld_deuterium_plant | tech_fuel_1 | 24h | hydrogen×24 → deuterium×6 |
| 晶体提纯厂 bld_crystal_plant | tech_science_2 | 48h | rareEarth×8 + inertGas×6 → quantumCrystal×1 |
| 电子元件厂 bld_electronics_plant | tech_industry_1 | 24h | rareEarth×6 + polymer×4 → conductor×5 |

### 3.3 工业 / 生态 / 科研 / 能源

| 建筑 | 周期 | 投入 → 产出 |
| :--- | :--- | :--- |
| 模块工厂 bld_module_factory | 24h | alloy×8 + conductor×3 → composite×5 |
| 陶瓷窑 bld_ceramic_kiln | 24h | silicate×14 + water×4 → ceramic×8 |
| 消费品厂 bld_consumer_plant | 24h | polymer×4 + biomass×4 → medicine×5 |
| 水培农场 bld_hydro_farm | 24h | water×8 → food×14 |
| 藻类反应器 bld_algae_reactor | 24h | water×10 → biomass×8 + oxygen×10 |
| 水循环装置 bld_water_recycler | 24h | biomass×3 → water×12 + oxygen×4 |
| 实验室 bld_lab | 24h | → researchData×8 |
| 深空分析中心 bld_deepspace_analytics | 24h | → researchData×20 |
| 储能工厂 bld_storage_plant | 24h | alloy×3 + conductor×2 → powerCell×5 |

端到端主链（ECON-03 验证路径）：**矿井 ferro/silicate → 合金厂 alloy → 舰船建造**
（`ShipyardBuild` 扣 credits/alloy/polymer，`hull.cost`）；模块/复合材料经
composite/conductor 进入高级模块造价。

### 3.4 生产效率与能源

- 效率 = `powerFactor × habitabilityFactor × 建筑效率 × 文明产出修正`，clamp 0.1–2.0
  （`colony.js tickColonyProduction`）。
- 电力净额 = ΣpowerGen − ΣpowerUse（活跃建筑×等级）；缺电按 `powerFactor`（0.3–1.0）降产。
- 周期开始锁料：原料不足 → 建筑 `state='starved'`；投入在周期起点一次性扣除（`cycleLocked`）。
- 殖民建造队列（上限 5）：`waiting → missing-material/building → 完成`；成本从**阵营账本**
  支付，欠料保持等待不阻塞队列。
- 船坞（`station.buildQueue`）：`ShipyardBuild` 命令扣料 + 登记工期（`hull.buildHours`），
  每小时递减，完工 `createShip` 入所属星系。

## 4. 殖民与人口（`src/domain/planets/colony.js`）

- **建立前哨**（FoundOutpost）：需舰队在目标行星星系、行星无主、**宜居度 ≥ 20**、
  支付 合金×20 + 信用点×150（× colonizationCost 文明修正）。前哨自带 1 级行政建筑。
- **升级殖民地**（UpgradeColony）：合金×30 + 信用点×220，+10 住房，解锁完整人口增长。
- **在殖民地建造**（BuildOnColony）：检查科技前置（def.techReq）、槽位（12）、队列（5）。
- **人口日结** `dailyPopulation`：
  - 食物需求 = 人口 × 0.020 吨/日（向上取整）；吃得上且住房利用率 < 1.12 才增长。
  - 增长 = 人口 × 0.011 × habitabilityFactor(0.5–1.2) × popGrowth 修正，累积进
    `growthBuffer`，≥1 转为 +1 人（整数人口，COL-02 守恒）。
  - 饥荒（食物扣款失败）：每日死亡 max(1, 1%人口)，发 `ColonyFamine` 事件。
  - 住房利用率 > 1.15 时停止增长。
- **稳定度**（0–100）：目标值 = 55 − 食物短缺惩罚(−14) − 住房短缺×(利用率−1)×9
  + 文明稳定度修正 + 服务类建筑×2；每日按 0.7 旧值 + 0.3 目标值平滑。
- 人口归零发 `ColonyLost`。断供后果经由食物扣款失败与稳定度下滑传导（COL-03）。

## 5. 探索：扫描五级与异常（`src/domain/exploration/scan.js`）

- **五级信息分层**（`LEVEL_THRESHOLDS = [0, 14, 36, 72, 120]` 扫描点）：
  0 未接触 → 1 侦测 → 2 分类（揭示恒星/行星概要，触发异常生成）→ 3 定位（揭示资源/危险评级）
  → 4 调查完成。
- 扫描范围：本星系或航路相邻星系（`canScanTarget`）。
- 扫描点/小时 = `最高舰船 sensor × scanSpeed 修正 ÷ 噪声 × scanPrecision 修正`；
  噪声 = 1 + 恒星 scanNoise + danger×0.06（EXP-01：高级传感器精度更高）。
- **调查完成奖励一次性**（`surveyRewarded` 幂等，EXP-02）：researchData
  `8 + 资源评级×3`；40% 概率 60–149 信用点打捞。
- **异常**（`content/anomalies.js` 10 模板）：星系生成期 34%+ 丰度修正概率带异常槽位，
  扫描至 2 级时实例化。调查（InvestigateAnomaly）：需舰队在异常星系，进度按
  `scanPower×0.6` 累积，目标 `60 + difficulty×18`；完成一次性发放 `rewards`
  （如 沉默信标 → ancientData×6 + researchData×12），storyTag 写入 `narrative.flags`。
  调查舰离开 → 回退 `detected`。
- **首次接触**（EXP-03 入口）：扫描揭示他国主权（2 级+）或舰队抵达他国星系 →
  `observeForeignSystem`：`none → signal → contacted`，contacted 后外交命令解锁。

## 6. 战斗（`src/domain/combat/`）

- **触发**（`engagement.js checkEngagements`，每小时）：敌对（存在 active war）舰队
  同星系即创建战斗实例；双方 `hold` 且无战争时不触发。确定性阵位：a 侧 x=120 起排、
  b 侧 x=880 起，结构 >600 视为大型舰。
- **步长**：dt=1/30 战斗秒；1 战略 tick 推进 30 战斗秒（BAL.combat.tickBattleSeconds）。
- **命中模型**（`tactics.js hitProbability`）：
  `p = 2^(−((ω·Sr)/(T·St))² − (max(0,d−dOpt)/dFalloff)²)`，
  再乘 `(1 + hitChanceBonus − 电子战惩罚)`，clamp 0.02–0.98。ω 取目标相对速度/距离近似。
- **伤害管线**（COMBAT-01）：护盾 → 装甲 → 结构逐层吸收；每层有效伤害 =
  `dmg × (1 − layerResist(layer, damageType))`，抗性矩阵见 `content/weapons.js`
  （如动能对护盾 55% 抗性、穿透对装甲 55%），单层抗性 clamp 0–0.85；护盾被击中后
  6 战斗秒不再回复（`shieldRegenDelay`）。暴击 8% 概率 ×1.8。
- **武器表摘要**（`content/modules.js`，10 个武器模块）：

| 模块 | 类型 | 伤害/类型 | 射程/最佳/衰减 | 周期 | 追踪 | 弹药 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| mod_kinetic_cannon 动能炮 | turret | 14 kinetic | 240/145/95 | 3s | 1.2 | — |
| mod_railgun 轨道炮 | turret | 34 piercing | 420/250/170 | 6s | 0.7 | — |
| mod_siege_cannon 攻城炮 | turret | 90 explosive | 520/310/210 | 12s | 0.25 | — |
| mod_laser_array 激光阵列 | beam | 10 thermal | 300/180/120 | 2.5s | 1.6 | — |
| mod_pulse_laser 脉冲激光 | beam | 6 thermal | 220/130/90 | 2s | 2.0 | — |
| mod_particle_lance 粒子长矛 | beam | 30 em | 480/290/190 | 5s | 1.0 | — |
| mod_plasma_thrower 等离子喷吐器 | beam | 44 thermal | 260/160/100 | 7s | 0.9 | — |
| mod_missile_rack 导弹挂架 | missile | 26 explosive | 560/340/220 | 6s | 1.4 | 氘×1/发 |
| mod_torpedo_launcher 鱼雷发射器 | missile | 95 explosive | 700/420/280 | 12s | 0.5 | 氘×3/发 |
| mod_pd_turret 近防炮塔 | turret(PD) | 5 kinetic | 140/85/55 | 2s | 3.8 | — |

- **导弹**：追踪飞行（转速上限 tracking），可被目标侧近防拦截
  （成功率 `0.6 + 0.4×pdEfficiency`，每防御者每轮一次）；投射物上限 600。
- **缺电禁射**：`ship.powerNet < 0` 的舰船无法开火（装配后果）。
- **撤退**（OrderFleetRetreat）：单位进入撤退航向并蓄能 25 战斗秒（retreatChargeSeconds）
  后脱离战斗（舰船保留）。
- **结束**（COMBAT-06）：全歼/全员撤离/超时 → `finishBattle` 生成战报入
  `battles.history`（上限 24），损失实时写在舰船实体上（一次性结算）。
- 战术暂停 = 全局暂停（模拟冻结，COMBAT-04 满足路径）。

## 7. 航行与后勤（`src/domain/fleets/navigation.js`）

- **航路时数**：`legEta = ceil(dist(from,to) / (舰队速度 × 55))`；舰队速度 =
  最慢船 `strategicSpeed`（任务书 3.3 最慢船约束）。船体 strategicSpeed 2.0–4.8。
- **路径规划**（`planRoute`，只读预检）：Dijkstra，经过敌对主权星系边权 ×4；
  失败码 `IN_TRANSIT/NO_TARGET/SAME_SYSTEM/NO_ROUTE/NO_FUEL`。移动 = 预检通过才
  `beginPlannedTransit`，失败不触碰状态。
- **燃料**：每航路小时耗 `1.0 × 舰队平均 fuelEfficiency`，从随行舰船货舱
  `cargo.hydrogen` 扣（先旗舰后补给舰）；航前预检 `fuelNeed > fleetFuelTotal` 则拒绝。
  燃料耗尽 → `status='stranded'` + `FleetStranded` 事件（FLEET-02）。
- **加油**（`refuelFleet`，每小时，抵达星系自动）：① 本文明殖民地氢仓储直补
  （上限 20/小时）；② 星系市场按 1.5×市价用信用点购买；③ 搁浅舰队有燃料后恢复 idle。
- 舰体 fuelCap 140（截击艇）–900（补给舰）；开局船只油箱 80%。

## 8. 外交与战争（`src/domain/diplomacy/war.js`）

- **关系五维+**（`relations.diplomacy`，详表见 docs/DATA_SCHEMA.md §4.1）：
  opinion / trust / threat / borderTension / tradeInterdependence / grievances /
  warWeariness / intelConfidence。
- **接触门槛**：宣战、缔约、赠礼均要求 `contactState === 'contacted'`。
- **每日漂移**（DailySystems diplomacy-drift）：opinion ×0.995 回归；边境接壤
  紧张 +0.35/日（不接壤 −0.25）；threat 随军力比漂移；贸易依赖 >30 时紧张 −0.3。
- **条约**（5 类）：`nonaggression 互不侵犯 / trade 贸易 / research 科研 / openBorders
  开放边境 / mutualDefense 共同防御`；默认期限 360 游戏日，到期 `expired`（trust −2）。
  签约 trust +6。**接受概率** = clamp((效用分 + 40)/100, 0.05, 0.95)；效用 =
  opinion×0.4 + trust×0.5 − threat×0.3 − borderTension×0.2 + 类型修正 + 人格修正
  （`treatyAcceptanceScore`）。被拒 opinion −2。同类条约不可重复。
- **履约反馈**（月度）：贸易/科研条约 trust +1、贸易依赖 +2/月。
- **毁约**（BreakTreaty）：trust −18、opinion −15、grievances +1。
- **宣战**（DeclareWar）：需已接触且未处于战争；战争目标 5 选 1
  （`borderSystems/haltExpansion/reparations/liberate/protectAlly`）。
  宣战自动解除双方全部条约（视为毁约）并发 `WarDeclared`。
- **战争疲劳**：交战各方 exhaustion +0.005/小时（上限 100）。**和谈/占领当前未实现**
  （peaceOffers/occupiedSystems 为预留字段，战争只能靠疲劳与战场消耗延续）。

## 9. 文明 AI（`src/domain/ai/FactionAI.js`）

- **人格 6 种**（权重表 PERSONALITY_WEIGHTS）：expansionist / trader / defensive /
  scientist / opportunist / balanced，决定 expand/economy/military/research/diplomacy 五维权重。
- **评估节奏**：每 24 tick（游戏日）每文明一次，按 `(hash(factionId)+index)%24` 错峰；
  单文明异常不拖垮世界（errorCooldown 72 tick）。
- **决策顺序**（每次评估按序尝试，命中即返回）：
  1. 关键经济（缺电/缺水/缺粮/缺矿 → 工业阶梯前四档）
  2. 扩张（权重 ≥0.9 才考虑；预算 credits≥240 且 alloy≥26；找已调查 3 级+ 的宜居无主行星）
  3. 工业链补全（挥发物井 → 合金厂 → 化工厂 → 聚合物厂 → 实验室）
  4. 科研（人格偏好表 → 表序兜底；队列满 8 不再下命令）
  5. 探索（科学舰队扫未调查邻系 → 移动到勘探前沿）
  6. 军事（威胁 >0.6 回防；预算 credits>1400 且 alloy>90 才造舰；军力比 >1.5 且
     边境紧张 >25 且好战人格 + 高侵略难度才宣战）
  7. 外交（威胁 >55 且信任 >25 提互不侵犯；信任 >45 且外交权重高提贸易条约）
- **防空转**（AI-01/02）：并发命令上限 6；命令超时 480 tick；同类冷却 72 tick；
  建造/造舰前 `canAfford` 预检；AI 全部行动经 CommandBus（与玩家同规则）。
- AI 初始拥有与玩家同规格的母星殖民地、船坞、护卫舰蓝图与探索/巡逻舰队（scenarioFactory）。

## 10. 市场（`src/domain/economy/market.js` / `colonyTrade.js`）

- 价格日更：`P = base × clamp(1 + 0.55×(D−S)/max(S,25), 0.35×base, 3.2×base)`，
  再按 0.35 系数向目标平滑（ECON-04 边界内）。
- **买卖价差**：单价随单量冲击（买 +0~20%、卖 −0~15%）；自动出售按市价 85% 折价。
- **殖民地商业闭环**（每日）：盈余（超保留库存，每资源每日 ≤60）自动出售 → 信用点
  留殖民地 → 按 22% 税率上缴阵营（`tax` 流水）；缺口注入市场需求推高价格。
- **月度补货**：市场库存向 `basePrice×10` 的基准回填 10%。
- 禁运（`setEmbargo`）阻断该文明买卖；舰队加油同样受禁运限制。

## 11. 科研（`src/domain/research/research.js`）

- 76 项科技，DAG 前置（启动期 `validateTechGraph` 校验无环，TECH-01 缺前置拒绝）。
- 科研点/小时 = `(1 + 实验室数×1.5) × researchOutput 修正`；单池按 active 顺序分配
  （TECH-03：分配之和 ≤ 产出）；并行研究槽上限 2（StartResearch 命令校验），队列上限 8。
- 完成 → `completed` + `effectIndex` 重建 → 修正即时生效（`getMod` 消费：
  researchOutput/mineOutput/alloyOutput/shipBuildCostReduction/weaponDamage/sensorStrength 等）
  + `TechCompleted` 事件（TECH-02：如 tech_warpdrive_1/2 提升战略速度）。
- 开局已解锁：`tech_mining_1 / tech_alloy_1 / tech_science_1`（scenarioFactory）。

## 12. 胜利条件 — **未实现（占位）**

`world.victory = { routes:{}, ended:null }` 已进入 schema 与快照
（`SnapshotBuilder.js` 透传 `victory`），`FactionAI` 在 `world.victory.ended` 时短路停止评估；
但**没有任何代码写入 `routes`/`ended`** —— 六条胜利路线（科技/霸权/外交/经济/探索/主线）
均为任务书规划，当前实现状态：**占位**。相应地，年度结算（SeasonalSystems）只有统计钩子。
