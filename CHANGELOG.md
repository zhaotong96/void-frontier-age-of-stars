# Changelog

本项目所有显著变更记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。当前项目处于
`0.1.0` 预发布阶段，所有变更先归入 **[Unreleased]**，随首个正式标签发布。

## [Unreleased]

### Added

- **终审返工（docs 10/11，WP-1..WP-6）**：专家终审 6.4/10 有条件驳回的全链路根治。
  **地质采掘命令** `HarvestTerrainOre`（ORE 旗点位采样 + 殖民地仓储入账，
  `src/app/commands.js:757`）接入 GroundView 工程作业闭环（`_fieldDig`/`_fieldPlace`
  派发 ShapeTerrain/PlaceBuilding，坐标口径 world+FIELD_OFFSET=行星本地米）。
  **目标跨系统闭环** `checkAndProgressObjectives`（`src/domain/events/objectives.js:102`）
  挂接舰队抵达/星系调查 L4/地面任务成功/建立殖民地/POI 采样五结算点
  （`navigation.js:101`、`scan.js:125`、`GroundMission.js:1863`、`colony.js:194`、
  `planetPOI.js:304`），rewards 经 `objectiveReward` 流水幂等入账。
  **18 主题环境音**：`AudioManager.setAmbientTheme` 接入 `_setupScene/_teardownScene`
  （`GroundView.js:1104`）、场景层 `audio.setScene` 随路由流转（`App.js:535`）；
  **EXPANSION_GAMEPLAY** 接线（低重力倍率 `_gravity()`、glassstorm 确定性相位风场、
  cloud_giant 浮台甲板禁出，`GroundView.js:941-950/1409/2006`）。

### Changed

- **终审返工（docs 10/11）**：地面任务运行时场域剥离实体树——`mission.field`
  可枚举挂载（97MB 存档/deepClone 1.4s/读档崩溃）改为不可枚举 `_runtimeField` +
  `getMissionRuntimeField` 幂等重建（`GroundMission.js:521-556/926/1187/1867`），
  单任务存档增量 5850B（<40KB 门禁）、deepClone 增量 0.44ms；`HourlySystems`
  地面步进状态键 `m.state`→`m.status||m.state` 对齐（`HourlySystems.js:108`）。
  着陆坪/撤离坪/桥面 clearFlags 清险契约（`terrainField.js:302` +
  `missionSiteFactory.js:556-642`）+ 海洋主题坪面抬升 seaLevel+0.6，608 行星
  3648 场 HAZARD 旗 52413 帧 → **0**。GroundView 统一度量 `_missionToWorld`
  （`GroundView.js:1801`）根除 kx/kz NaN 全场隐形，撤离罗盘/3.0m 交互/±286 边界/
  35° 坡度阻断齐修；`LIT_FS`/`BM_FS` 补 `uHdr`（`PlanetSurface3D.js:307`、
  `GroundView.js:407`）；`PlanetWater` 主题色注入 + 权威色板源接线
  （`PlanetSurfaceScene.js:297`、`themePayload.js:509`）+ sulfur_marsh 酸液面
  3.8m（`themePayload.js:212`）+ permafrost 热源对位 + biolume 脚步涟漪。
  防伪绿门禁升级：GATE-01 300 帧（10s）全银河仿真 + 环境伤亡/存档健康度断言、
  GATE-02 真实渲染装配运行态 0-NaN 扫描 + 交互/边界/坡度/工程坐标契约
  （`ground-playtest-physics.suite.js`、`playtest-gates.suite.js`）。
  **金快照无漂移**：REG-01 基线 `68462446` 两轮 PASS（本轮返工域侧确定性零变更）。

### Added（历史）

- **地形编辑层与殖民地岗位看板（doc7 TASK-5.1/5.2）**：terrainEdits 编辑刷
  （raise/lower/smooth/flatten/restore + 植被移植回收，flatten 平芯裙边、restore
  DSP 式一键恢复、flatten/restore 可覆写采掘凹陷；TERRAIN-06 单次编辑 ≤4 区块标脏、
  SITE-07 紧凑命令序列存档重放）；ShapeTerrain/RestoreTerrain/PlaceBuilding 命令
  （9 点三角网格投影坡度校验：坡度 >16° 拒 SLOPE_TOO_STEEP、高差 >2.2m 拒
  HEIGHT_DELTA，放行派生地基承台与主题桩基，GAME-06..07）；殖民地 jobsFilled 岗位
  分配（按 jobPriority 权重，understaffed 按 η 降产）与五态 runtimeStatus 诊断
  （running/understaffed/starved_input/low_power/storage_full，COL-01..04、ECON-02）；
  ColonyView 四级物流流向看板（矿脉采掘 → 仓储物流 → 精炼制造 → 船坞/轨道输出）；
  审计技术债 TD1–TD4 清偿（stationIds 回填、ProposePeace/AnnexOccupied 战争终局
  命令、战斗投射物/事件 256 容量环形对象池 + createShip factionMods 战斗特质接入、
  events/anomalies 中文词条抽取脚本）。**经济规则修正**：powerBalance 用电侧按负值
  累加（旧实现 `gen-use` 把缺口翻正成盈余，缺电降产/low_power 永不可达）；世界哈希
  随上述规则变更整体更新，金快照基线更新为 `68462446`。

- **行星主题与连续地形（docs 4-7 施工，Phase 0-2）**：场景 FBO 24 位深度附件与
  beginScene 8 步清屏契约（TERRAIN-07/08）；F3 三档地表诊断渲染 + GL 状态 JSON
  快照；GLOW/RING 顶点着色器双重模型变换修复（辉光 2× 轨道半径漂移根治，GL-01）
  与晨昏线散射升级；UIStateStore/RouteStack/双模侧栏退避/GroundView 软锁解除
  （UI-01..07、NAV-01..04）；确定性 planetSeeds 子流树 + 512m 连续三角网格场域
  （terrainField，曲率自适应对角线 + CCW + 面积加权法线，TERRAIN-01/02/SITE-06
  套件入库）；surfaceQueries 重心采样/射线求交/坡度 A*；PlanetTerrainMesh 三级
  LOD + 裙边 + geomorph + 三平面 4 材质着色器（TERRAIN-03/04/09）；GroundView
  场域化集成（连续地形视觉/碰撞/射线/采掘雕刻 + 体素补丁仅作资源数据底层）；
  MissionSiteBlueprint ×8 + missionSiteFactory SDF 三层关卡架构（SITE-01..08）；
  持久化行星 POI（8 类，rewardPaid 幂等）+ WorldObjective 空间任务目标 + 银河图
  离屏方向箭头 + 5 个 B 类事件空间化 + HarvestPlanetPOI/DispatchObjectiveFleet
  命令（OBJ-01/02、EVT-01/02、WORLD-03、SAVE-03）。
- **伴生天体扩充（doc5 P3-01）**：星系生成新增每行星持久化 POI 与 objectives
  实体容器（详见上）；世界哈希随之变化，金快照基线更新为 `452e8ba1`；主题系统接入后为 `e81dd30b`；卫星/小行星带/轨道相位后为 `a941b446`。


- **确定性模拟内核**：xoshiro128\*\* PRNG（拒绝采样）、战略时钟（8640 tick/游戏年）、
  确定性调度器、命令总线（事务回滚）、事件总线、不变量校验、稳定序列化与世界哈希、
  空间索引（`df247af`、`78752bc`）。
- **银河与世界生成**：抖动网格星系分布、kNN 航路图、UnionFind 连通性修复、
  出生点公平性检查；96 系标准规模（story 64 / large 160 / huge 256）；
  GalaxyView / SystemView（`db88f6c`）。
- **探索**：五级行星扫描、异常调查（10 模板、幂等结算）、首次接触状态机与
  邻近感知（`db88f6c`、`943287e`）。
- **殖民**：前哨建立/升级、建造队列、人口日结、稳定度与生活需求（断电/断食降产）、
  宜居度模型（`db88f6c`）。
- **经济**：资源账本（守恒校验、负库存拒绝）、市场价格（0.35×/3.2× 边界、
  买卖价差、禁运）、殖民地自动贸易；商业闭环参数基线（`db88f6c`、`943287e`）。
- **科研**：76 科技 DAG、前置校验、effectIndex → 规则修正量接入
  （`db88f6c`）。
- **舰船与舰队**：12 船体 / 37 模块、装配校验（槽位/功率/CPU/反应堆）、
  蓝图与船坞建造队列、航路规划预检（燃料/可达性，敌对边权 ×4）、燃料与搁浅
  恢复（`db88f6c`、`943287e`）。
- **战术战斗**：dt = 1/30s 战斗模拟管线、命中模型（距离衰减 clamp 0.02–0.98）、
  分层伤害（护盾→装甲→结构 + 抗性矩阵）、导弹追踪/近防拦截、撤退与战后结算
  （战报入史）（`943287e`）。
- **外交与文明 AI**：五维关系、5 类条约（签署/到期/毁约）、宣战与战争疲劳；
  文明 AI 六人格、七步决策、防空转与工业阶梯补链（`943287e`）。
- **叙事引擎 / 事件 / 危机 / 胜利 / 地面行动**：三幕叙事弧与弹卡抉择、
  危机流程、胜利条件判定与软失败、地面任务状态机（`f5588cf`）。
- **船员与人物系统**：characters 实体生产者、经验/升级、指派命令
  （AssignCharacter 经命令总线）、舰队指挥官加成、舰船损失命运结算（幂等）、
  GovernmentView 人物面板（`a94eae6`）。
- **存档与持久化**：IndexedDB 槽位存档、自动/快速存档（默认每 2 游戏日）、
  导入导出、编码 checksum 校验、迁移注册表；**多标签页写入防护**
  （BroadcastChannel 仲裁 + localStorage 心跳退化，后来者只读）（`f5588cf`、
  `0001cda`）。
- **界面**：单应用骨架 + 设计系统 + PWA 资产（manifest / Service Worker /
  404 回退）（`df247af`）；16 个游戏视图与 shell 四件套、浏览器内诊断面板
  （`#/diagnostics`，可在浏览器直接运行全部套件并导出 JSON 报告）
  （`943287e`、`f5588cf`）。
- **国际化**：轻量 i18n 内核（`78752bc`）与 zh-CN / en-US 双语词典装配
  （`943287e`）。
- **测试基建**：
  - 22 个自动化套件（每套件运行 2 轮验证确定性与无状态泄漏），覆盖内核/
    经济/存档/世界/舰船/舰队/战斗/外交/AI/人物，以及四个项目自增行：
    **REG-01 固定种子金快照回归**（seed 24601 × 4320 tick 哈希基线）、
    **E2E-01 标准战役端到端闭环**（SCENARIO-STARTER-001 十四步：探索→殖民→
    工业→造舰→舰队→战斗→结算→外交/科研→存读档→长期推进，全程命令总线驱动）、
    **CREW-01 船员人物系统**（经验升级/指派/命运结算幂等）（`78752bc`–`a94eae6`）；
  - Node 套件运行器 `tests/tools/run-suites.mjs`（`78752bc` 起）；
  - 静态审计 `tests/tools/static-audit.mjs`（外部依赖/绝对路径/占位代码扫描，
    当前零违规）（`f5588cf`）；
  - 离线批量模拟 CLI `tests/tools/sim-cli.mjs`
    （`--seed/--seeds/--years/--json`，平衡调参）（`f5588cf`）；
  - 金快照基线工具 `tests/tools/update-golden.mjs` 与基线
    `tests/regression/golden.json`（`0001cda`）；
  - Node 开发服务器 `tests/tools/dev-server.mjs`（no-store、hash 路由回退）
    （`f5588cf`）。
- **发布工程**：GitHub Pages 部署工作流（`.github/workflows/deploy.yml`，
  纯静态直传、无构建步骤）与 CI 工作流（`.github/workflows/ci.yml`，
  套件 + 静态审计，Node 22、零依赖免安装）（`f92f4d4`）。

### Changed（历史）

- **经济存储分层**：原料（矿物/挥发物/生态）存殖民地仓储，精炼品与经济资源
  存阵营账本，跨层转移显式记账，殖民地盈余自动出售构成财政主循环
  （`943287e`）。
- **npm scripts 调整**（`f92f4d4`）：`test` →
  `node tests/tools/run-suites.mjs`（原 `node --test tests/node/` 预留位）；
  `serve` → `node tests/tools/dev-server.mjs`（原依赖 Python
  `http.server`），Node 环境下开发服务器不再需要 Python。
- **金快照基线滚动**：人物系统并入改变确定性世界演化，基线哈希
  `d2ec8589` → `7ecd48dc`（按套件指引运行 `npm run golden:update` 重新生成
  并在此记录）（`a94eae6`，基线文件更新待提交）。

### Fixed

- **浏览器闭环 P0 修复**：新战役开局路径异常（移除对未实现的
  `captureCheckpoint` 的调用）与叙事收尾问题，`startNewGame` 全路径可用
  （`f5588cf`、`ba9b7a8`）。
- **金快照回归读取路径**：`loadGolden` 因未导入 `readFileSync` 而始终返回
  null，导致已有基线被误报"缺少基线"；补导入后 REG-01 两轮通过
  （`0001cda`）。
- **存档列表/读取恒空**：Database 事务结果被双重解包，导致存档管理界面
  无法列出/读取任何存档（`f92f4d4`）。

### Performance

- **银河生成**：抖动网格 + kNN 近邻航路，96 系标准规模全量生成
  （含公平性校验）约 0.15–0.2 s（WORLD-01 套件计时）（`db88f6c`）。
- **战略/战术解耦**：战斗仅在 engagement 活跃时以固定步长 dt = 1/30 s 步进，
  1 战略 tick = 30 战斗秒；典型遭遇战在 1–2 个战略 tick 内收敛，战略节奏
  不被战斗拖慢（`943287e`）。
- **快照与序列化**：确定性稳定序列化（键排序）+ 世界哈希支撑两轮套件回归
  与存档中断续推一致（SAVE-02）；分层存储使原料不进阵营账本，减少快照体积
  （`943287e`、`0001cda`）。
