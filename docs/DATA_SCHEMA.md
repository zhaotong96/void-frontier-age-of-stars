# DATA_SCHEMA — World v1 数据模型

> World 定义于 `src/domain/world/World.js`（`createWorld`，`SCHEMA_VERSION = 1`，
> `GAME_VERSION = '0.1.0'`）。World 是纯数据对象，可 JSON 序列化；行为全部在系统模块。
> 所有实体为 Plain Data Entity，跨引用一律存 ID，禁止深层嵌套对象复制（任务书 2.3）。
> 字段表中「来源」指写入该字段的模块；未标来源的由 `createEntity` 注入
> （`src/domain/entities/registry.js`：`id`、`type`、`createdAtTick`）。

## 1. World 顶层字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `format` | `string` | 恒为 `'void-frontier-save'` |
| `schemaVersion` | `int` | 当前 1 |
| `gameVersion` | `string` | `'0.1.0'` |
| `seed` | `uint32` | 世界种子（`createWorld` 时 `config.seed >>> 0`） |
| `tick` | `int` | 战略时钟，1 tick = 1 游戏小时 |
| `seq` | `int` | 实体 ID 计数器（`core/ids.js nextId` 递增） |
| `schedSeq` | `int` | 调度项序号（scheduler 出队排序 tie-break） |
| `rng` | `uint32[4]` | xoshiro128** 状态（`core/rng.js seedFromNumber` 初始化） |
| `difficulty` | `string` | `story / standard / hard / sandbox`（`content/constants.js DIFFICULTY`） |
| `galaxySize` | `string` | `story(64) / standard(96) / large(160) / huge(256)` 星系数 |
| `playerFactionId` | `string?` | 玩家文明 ID（开局时指向 `fac_*`） |
| `entities` | `object` | 16 个实体集合（§3） |
| `relations.diplomacy` | `object` | 键 = `"facA|facB"`（`core/ids.js relationKey` 规范序）→ 多维关系（§4.1） |
| `economy` | `object` | `ledgers / daily / markets / transactions`（§4.2） |
| `research` | `object` | factionId → 科研状态（§4.3） |
| `events` | `object` | `queue / log / chronicle`（§4.4） |
| `scheduled` | `array` | 调度项 `{id:'sch_n', tick, seq, kind, payload}`（`core/scheduler.js`） |
| `battles` | `object` | `active{}` + `history[]`（§4.5） |
| `narrative` | `object` | `fired{} / arcs{} / flags{}`；`pendingChoices[]` 由事件系统预留（App 弹卡消费，当前无生产者） |
| `ai` | `object` | factionId → AI 状态（§4.6） |
| `victory` | `object` | `routes{}` + `ended:null`（占位，无写入方） |
| `commandLog` | `array` | 命令日志，上限 600（`core/commandBus.js logCommand`） |
| `stats` | `object` | `commandsExecuted/commandsByType/commandsFailed/ticksProcessed` 及运行期统计（`shipsBuilt/coloniesFounded/lastDailyFlows/monthlyCloses/yearlyCloses/lastAutosaveTick/archivedChronicle`） |
| `settings` | `object` | `autosaveIntervalDays(2)/reducedEffects/masterVolume/musicVolume/sfxVolume` |
| `campaignName` | `string` | 仅开局写入（`devtools/scenarioFactory.js`），不影响确定性 |
| `warnings` | `array` | 生成期告警（出生点公平性等），开局一次性 |

## 2. ID 规则（`src/core/ids.js PREFIXES`）

格式 `${prefix}_${seq}`，`seq` 为 `world.seq` 单调计数（十进制字符串）。

| 类别 kind | 前缀 | 示例 |
| :--- | :--- | :--- |
| faction | `fac` | `fac_1` |
| system | `sys` | `sys_2` |
| planet | `plt` | `plt_3` |
| colony | `col` | `col_4` |
| station | `stn` | `stn_5` |
| ship | `shp` | `shp_6` |
| fleet | `flt` | `flt_7` |
| character | `chr` | （预留，无生产者） |
| blueprint | `blu` | `blu_8` |
| anomaly | `ano` | `ano_9` |
| groundMission | `gms` | （预留，无生产者） |
| war | `war` | `war_10` |
| treaty | `try` | `try_11` |
| crisis | `crs` | （预留，无生产者） |
| battle | `btl` | `btl_12` |
| researchProject | `rsp` | （科研项目当前实际复用 `buildQueues` 集合） |
| buildQueue | `bld` | `bld_13`（当前用于科研项目实体） |
| productionQueue | `prq` | （预留） |
| tradeRoute | `trd` | （预留） |
| survey | `srv` | （预留） |
| event | `evt` | `evt_14` |
| command | `cmd` | `cmd_15`（commandLog 条目 id） |
| scheduled | `sch` | `sch_16` |
| diplomacy | `dip` | （预留） |
| intel | `int` | （预留） |

另外两处不走 `nextId` 的 ID：宣战 `src/domain/diplomacy/war.js declareWar` 直接
`` `war_${++world.seq}` ``；缔约 `createTreaty` 直接 `` `try_${++world.seq}` ``
（与 nextId 同源计数器，保证全局唯一）。科研队列自动补位的项目使用伪 ID
`auto_${techId}`（`src/domain/research/research.js tickResearch`）。

## 3. 实体集合字段表（`world.entities.*`）

集合与类型映射由 `World.ENTITY_TYPES` 定义；集合清单同时被
`src/core/invariant.js ENTITY_COLLECTIONS` 复用。所有实体公共字段：
`id`、`type`、`createdAtTick`。

### 3.1 factions — 文明（生产者：`galaxyGen.js spawnFactions`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` / `adjective` | `string` | 名称 / 形容词（adjective 默认回退 name） |
| `personality` | `string` | `expansionist/trader/defensive/scientist/opportunist/balanced` |
| `ethosTag` | `string?` | `council/military/mercantile/ecology/automation/nomad` |
| `color` | `string` | 显示色（如 `#5ad1e6`） |
| `originType` | `string` | `homeworld/flotilla`（`content/factions.js`） |
| `traitId` | `string` | 特质键（`content/factions.js FACTION_TRAITS` 查表） |
| `homeSystemId` | `sys id` | 母星系 |
| `homePlanetId` | `plt id?` | 母星（spawnFactions 回填） |
| `isPlayer` | `bool` | 玩家标记 |
| `policySlots` / `policies` | `int` / `object` | 政策槽（3）/ 已颁政策 `{pid: {effects:[{stat,mode,value}], ...}}` |

### 3.2 systems — 星系（生产者：`galaxyGen.js`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | `string` | 双音节命名表（原创，同种子可复现） |
| `x` / `y` | `float` | 策略空间坐标（0..1000） |
| `star` | `object` | `{typeId, name, energy, scanNoise}`（7 类恒星，`galaxyGen.STAR_TYPES`） |
| `lanes` | `sys id[]` | 航路邻接（生成后按 id 排序回填） |
| `planetIds` | `plt id[]` | 行星槽位（每系 2–8 个） |
| `stationIds` | `stn id[]` | 轨道设施（当前 scenarioFactory 建船坞时未回填此表，见 §6） |
| `anomalyIds` | `ano id[]` | 异常实体（扫描分类层时生成） |
| `ownerFactionId` | `fac id?` | 主权归属 |
| `surveyedBy` | `object` | factionId → 调查层级 0–4（五级分层） |
| `surveyRewarded` | `object` | factionId → bool（调查奖励一次性标记） |
| `resourceRating` | `float` | 资源丰度（高斯场，0–1.6 取整到 0.1） |
| `dangerRating` | `float` | 危险度（0–10） |
| `hazards` | `string[]` | `pulsarInterference/gravityWell/radiationFlare/asteroidDebris` |
| `flags` | `object` | `hasAnomalySlot` 等生成期标记 |

### 3.3 planets — 行星（生产者：`galaxyGen.js`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `systemId` | `sys id` | 所属星系 |
| `orbitIndex` | `int` | 轨道序 |
| `name` | `string` | `"星系名 II"` 形式 |
| `category` / `categoryName` | `string` | 8 类行星（`galaxyGen.PLANET_CATEGORIES`：rocky/ocean/ice/desert/gasGiant/lava/toxic/artificial） |
| `radiusClass` | `int` | 1–5 |
| `gravity` | `float` | 0.3–1.9 |
| `temperatureBand` | `string` | `temperate/cold/hot/inferno` |
| `atmosphere` | `string` | 类别决定的大气短语 |
| `radiation` | `float` | 0–6 |
| `habitability` | `int` | 宜居度 0–90（气态巨行星恒 0；宜居带中心随恒星 habitZone 偏移） |
| `water` | `int` | 0–95 |
| `deposits` | `object` | 资源 id → 储量（ferro/silicate/rareEarth/heavyMetal/hydrogen/helium3/water，按类别剖面 × 丰度 × 60–160） |
| `maxDistricts` | `int` | 3–10（开发上限） |
| `colonyId` | `col id?` | 已建殖民地 |
| `terraform` | `object?` | `{stage, progress}`（预留） |
| `homeOfFactionId` | `fac id?` | 母星标记 |

### 3.4 colonies — 殖民地（生产者：`domain/planets/colony.js foundColony`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `planetId` / `systemId` / `factionId` | id | 归属（建殖民地时无主星系顺带归属） |
| `isOutpost` | `bool` | 前哨（`UpgradeColony` 升级为完整殖民地） |
| `population` | `object` | `{total:int, strata:{worker,...:int}}` 分组整数人口 |
| `housing` | `int` | 住房单位（前哨 8 / 殖民地 12，升级 +10） |
| `buildings` | `array` | `{defId, level, state, progress, cycleLocked?, efficiencyMult?, buildingIndex?}`；state ∈ `active/construction/starved/suspended` |
| `buildingSlots` | `int` | 建筑槽位（默认 12，scenarioFactory 显式设置） |
| `constructionQueue` | `array` | `{defId, state: waiting/missing-material/building, progress, buildingIndex}`，上限 5 |
| `stockpile` | `object` | 殖民地仓储（原料层）：资源 id → int（初始 `food:60, water:60, powerCell:4, medicine:4` 等） |
| `ledger` | `object` | 殖民地日流水 `{resId: {produced,consumed,transfer,exported,imported}}` |
| `stability` | `int` | 稳定度 0–100 |
| `powerBalance` | `int` | 每小时生产阶段刷新的电力净额 |
| `jobsFilled` | `object` | 岗位占用（预留细化） |
| `growthBuffer` | `float` | 人口增长缓冲（≥1 转为 +1 人） |
| `needs` | `object` | `{foodPerDay, goodsPerDay}` |
| `foundedTick` | `int` | 建立时间 |
| `commerce` / `taxPaidTotal` / `taxRateMult` | `object/int/float` | 商业闭环统计（`domain/economy/colonyTrade.js`） |

### 3.5 stations — 轨道设施（生产者：`devtools/scenarioFactory.js` / 将来的建造命令）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `kind` | `string` | 当前唯一取值 `shipyard` |
| `systemId` / `factionId` | id | 归属 |
| `level` | `int` | 等级 |
| `buildQueue` | `array` | `{blueprintId, remainingHours, factionId}`；每小时 production 阶段推进，完工调 `createShip` |

### 3.6 ships — 舰船（生产者：`domain/ships/ship.js createShip`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `factionId` / `fleetId` / `systemId` / `blueprintId` | id? | 归属；在途舰队成员 `systemId` 可为 null |
| `hullId` | `string` | `content/hulls.js` 12 船体之一 |
| `modules` | `string[]` | 模块 id（保存时排序） |
| `name` | `string` | 舰名 |
| `stats` | `object` | `computeShipStats` 纯函数产物：hp 三层、power/powerNet/powerUsed、cpu、strategicSpeed、maxSpeed/acceleration/turnRate、fuelCap/fuelEfficiency、cargo、sensor/signature、lockons、hangar、crew、ewarStrength、weapons[]（含 damage/damageType/range/optimal/falloff/cycleSeconds/tracking/ammo/pd）、miningRating 等 |
| `hp` | `object` | `{structure, armor, shield, shieldMax, shieldRegenDelay?}` |
| `powerNet` | `int` | 净电力（<0 缺电禁射） |
| `cargo` | `object` | 货舱资源（含随行燃料 `hydrogen`、弹药） |
| `fuel` | `float` | 油箱余量（初始 0.8×fuelCap） |
| `ammo` | `object` | 弹药（预留细化，当前弹药走 cargo） |
| `crew` | `object` | `{assigned, healthy}` |
| `xp` | `int` | 经验（预留） |
| `status` | `string` | `active/disabled/captured/destroyed` |
| `buildTick` / `destroyedTick` / `destroyCause` | `int/string` | 生命周期（销毁由 `destroyShip` 写入） |

### 3.7 fleets — 舰队（生产者：`domain/fleets/fleet.js createFleet`）

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `factionId` / `name` | — | 归属与命名 |
| `shipIds` | `shp id[]` | 成员表（与 ship.fleetId 双向一致，invariant 校验） |
| `systemId` | `sys id?` | 所在星系（在途为 null） |
| `stance` | `string` | `hold/patrol/aggressive/escort` |
| `status` | `string` | 实际写入值：`idle`（默认/抵达/恢复）/`engaged`（交战）/`stranded`（燃料耗尽）/`dissolved`（空舰队）；`retreated` 仅在 `checkEngagements` 被防御性读取，当前无写入方 |
| `orders` | `object?` | `{kind: scan/investigate/move, ...}`（探索/移动订单） |
| `transit` | `object?` | `{path[], legIndex, legProgress, legEta, legs:[{to,eta}], startedTick}` |
| `commanderId` | `chr id?` | 指挥官（预留，characters 无生产者） |
| `supplyDays` / `morale` | `int` | 后备补给天数（默认 60）/ 士气（默认 70，暂无消费者） |
| `role` | `string` | `combat/science/mining/trade/colony` |

### 3.8 blueprints — 舰船蓝图（生产者：`SaveBlueprint` 命令 / scenarioFactory）

`factionId`、`name`、`hullId`、`modules[]`（排序存储）。只保存可序列化定义。

### 3.9 anomalies — 异常（生产者：`domain/exploration/scan.js spawnAnomaliesForSystem`）

| 字段 | 说明 |
| :--- | :--- |
| `systemId` | 所在星系（`sys.anomalyIds` 反向登记） |
| `templateId` / `category` | `content/anomalies.js` 10 模板 / 类别 `ancient/derelict/life/spatial/signal/automata` |
| `nameZh` / `nameEn` / `descZh` | 文案（模板拷贝） |
| `state` | `detected → analyzing → resolved`（`ready` 预留；调查舰离开回退 `detected`） |
| `progress` / `difficulty` | 调查进度 / 难度（dangerRating + 0–4） |
| `rewards` | `[{resId, amount}]` 一次性奖励 |
| `risks` | `string[]` 风险标签 |
| `discoveredBy` / `resolvedBy` / `resolvedTick` | 发现者 / 结算者 / 结算时间 |
| `storyTag` | 叙事旗标（结算时写入 `narrative.flags`） |

### 3.10 wars — 战争（生产者：`domain/diplomacy/war.js declareWar`）

`attackers[]`、`defenders[]`、`startTick`、`wargoals[]`（`borderSystems/haltExpansion/reparations/liberate/protectAlly`）、
`occupiedSystems{}`（预留）、`exhaustion{facId: 0–100}`（+0.005/小时）、`battles`、`status: active/...`、`peaceOffers[]`（预留）。

### 3.11 treaties — 条约（生产者：`createTreaty`）

`kind`（`nonaggression/trade/research/openBorders/mutualDefense`）、`parties[]`（排序）、
`startTick`、`expiryTick`（默认 360 游戏日）、`status`（`active/expired/breached`）、
`terms`（`war.js TREATY_TERMS` 常量拷贝）。

### 3.12 buildQueues — 建造/科研项目（生产者：`StartResearch` → `research.js startResearch`）

当前唯一用途是科研项目：`kind:'research'`、`factionId`、`techId`、`progress`、`cost`。
殖民建造与船坞建造分别内嵌于 `colony.constructionQueue` 与 `station.buildQueue`，
不使用本集合。

### 3.13 预留集合（schema 已声明、当前无生产者）

- `characters`：舰队 `commanderId` 与 invariant 引用检查预留。
- `groundMissions`：阶段 10 行星行动。
- `crises`：阶段 11 危机。
- `tradeRoutes`：贸易路线实体（当前贸易走市场即时成交）。

## 4. 关系与全局结构

### 4.1 relations.diplomacy — 多维外交关系

键 `"facA|facB"`（`relationKey` 排序规范序），生产者 `war.js getRelation`（惰性创建）：

| 字段 | 说明 |
| :--- | :--- |
| `parties` | `[a, b]` 排序 |
| `contactState` | `none → signal → contacted`（首次接触推进，`scan.js observeForeignSystem`） |
| `firstContactTick` | 首次侦测时间 |
| `opinion` | 好感 −100..100 |
| `trust` | 信任 0..100（初始 10） |
| `threat` | 威胁感知 0..100 |
| `borderTension` | 边境紧张 0..100 |
| `tradeInterdependence` | 贸易依赖 0..100 |
| `grievances` | 侵害计数（违约/毁约 +1） |
| `warWeariness` | 战争疲劳（预留字段） |
| `intelConfidence` | 情报置信度 0..1（初始 0.2，接触后 0.35） |
| `treaties` | 生效条约 id 列表 |
| `warId` | 当前战争 id（宣战写入，和谈后应清除——当前无和谈命令） |

### 4.2 economy — 经济

| 字段 | 结构 | 说明 |
| :--- | :--- | :--- |
| `ledgers` | `facId → {balances: {resId: int}}` | 阵营账本余额（精炼品/战略资源层），严禁负值 |
| `daily` | `facId → {resId: {produced,consumed,imported,exported,loot,decay,transfer,tax}}` | 当日流量累计，日结后整体移交 `stats.lastDailyFlows` 并清零 |
| `markets` | `sysId → {systemId, stock{res:int}, demand{res:int}, price{res:float}, embargo{facId:bool}, riskFactor}` | 星系市场（`ensureMarket` 惰性创建） |
| `transactions` | `[{tick, factionId, resId, flow, delta, reason, sourceId}]` | 有界流水（上限 400，FIFO 摘除） |

### 4.3 research — 科研状态

`factionId → { completed:[techId], active:[{projectId, techId, progress}], queue:[techId],
points:int, effectIndex:{stat: [{value, mode, techId}]} }`。
`effectIndex` 由 `rebuildEffectIndex` 在科技完成时重建，`factions/modifiers.js getMod` 消费。

### 4.4 events / narrative — 事件

- `events.queue[]`：本 tick 产生的事件 `{id:'evt_n', tick, type, category, payload}`，
  每 tick 末尾 drain 后分发给监听器。
- `events.log{category: [{id,tick,type,payload}]}`：按类别有界归档
  （`eventBus.js LOG_CAPS`：economy/fleet/combat 400，diplomacy/exploration/colony/politics/crisis 300，research/world 200，system 120）。
- `events.chronicle[]`：战役纪年 `{id, tick, type, text, refs}`，月结归档超 800 条折叠。
- `narrative.fired{eventId: tick}` 一次性去重、`arcs{}` 故事线、`flags{}` 全局旗标
  （异常 storyTag 写入点）。

### 4.5 battles — 战斗

- `active{battleId → 战斗实例}`：`{id, systemId, startedTick, time, status, sides:{a,b},
  fleetIds:{a,b}, units[{idx, shipId, side, x, y, vx, vy, heading, targetShipId,
  cooldowns{}, retreatCharge, destroyed, evacuated?, order, isBig}],
  projectiles[], events[], losses:{a,b}, damageDealt:{a,b}, initialStrength:{a,b},
  endCondition:{kind, timeoutSeconds?}, winnerSide?, endedTick?}`
  （`endCondition.kind` 当前写入值仅 `'annihilate'`——`engagement.js`；`'timeout'` 由
  `stepOneBattle` 支持；撤退结束经单位 `destroyed/evacuated` 走全歼判定通道）。
- `history[]`：战报（`finishBattle` 产物），上限 24。

### 4.6 ai — 文明 AI 状态

`factionId → { personality, goals[], cooldowns{kind: expiryTick}, orders{oid: {kind,
detail, createdTick, status?}}, lastEvalTick, errorCooldown?, _oid? }`。
`orders` 由 `HourlySystems orders` 阶段做 480 tick 超时清理；容量上限 12（FIFO 摘除）。

## 5. 跨引用规则

| 引用 | 方向 | 一致性保证 |
| :--- | :--- | :--- |
| system.planetIds ↔ planet.systemId | 双向 | 生成时同步写入；invariant 检查 planetIds 可解析 |
| planet.colonyId ↔ colony.planetId | 双向 | `foundColony` 同步 |
| fleet.shipIds ↔ ship.fleetId | 双向 | `addShipToFleet`/`removeShipFromFleet`/`destroyShip` 维护；invariant 全量校验 |
| system.lanes | 出边 | 生成期 idx→id 映射回填；invariant 检查指向存在 |
| relations.diplomacy.treaties ↔ treaty.parties | 双向 | `createTreaty`/`BreakTreaty`/宣战清理维护 |
| relation.warId ↔ war 实体 | 双向 | `declareWar` 写入 |
| system.anomalyIds ↔ anomaly.systemId | 双向 | `spawnAnomaliesForSystem` 同步 |
| ship.stats.weapons[].moduleId | 弱引用 | 指向 content 定义（非实体），不参与 invariant |
| blueprint.factionId / station.buildQueue[].blueprintId | 单向 | 造船命令校验存在性 |
| colony.constructionQueue[].defId / buildings[].defId | 弱引用 | 指向 `content/buildings.js`，未知 defId 在队列推进时静默摘除 |

## 6. 删除与清理约定（任务书 2.3）

- **舰船销毁**（`ship.js destroyShip`）：`status='destroyed'`、写 `destroyedTick/destroyCause`、
  从舰队 `shipIds` 移除并清 `ship.fleetId`；**实体保留**（战斗历史与归属史可追溯），
  集合内条目不删除。
- **舰队解散**（`removeShipFromFleet` 空舰队）：`status='dissolved'`，实体保留。
- **条约失效**：不删除条目，`status='expired'/'breached'`；同时从 `rel.treaties` 移除。
- **战斗结束**：战斗实例从 `battles.active` 删除，战报转入 `battles.history`（上限 24）。
- **通用移除**（`registry.removeEntity`）：仅删条目，引用清理由调用方负责 —— 当前
  代码库中无实际调用点（所有"删除"都走状态标记），新增删除路径时必须补充引用清扫。
- 已知的引用缺口（如实记录）：`scenarioFactory` 创建船坞 station 后未把 station id
  回填 `system.stationIds`（快照的 `stationCount` 因此恒为 0，UI 不受影响但数据不完整）。

## 7. 有界容量一览（防长期膨胀，任务书 7.5）

| 数据 | 上限 | 清理时机 |
| :--- | :--- | :--- |
| `economy.transactions` | 400 | 每次 record 时 FIFO |
| `commandLog` | 600 | 每次 logCommand |
| `events.log`（每类别） | 120–400 | 每次 emit |
| `events.chronicle` | 800 | 月结归档 |
| `battles.history` | 24 | finishBattle |
| `ai[fid].orders` | 12 | recordOrder FIFO + 480 tick 超时 |
| `battle.projectiles` | 600 | 每战术步 |
