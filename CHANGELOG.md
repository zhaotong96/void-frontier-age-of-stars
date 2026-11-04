# Changelog

本项目所有显著变更记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。当前项目处于
`0.1.0` 预发布阶段，所有变更先归入 **[Unreleased]**，随首个正式标签发布。

## [Unreleased]

### Added

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
  实体容器（详见上）；世界哈希随之变化，金快照基线更新为 `452e8ba1`。

### Added

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

### Changed

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
