# 《无垠边疆：星海纪元》太空歌剧与系统交织总控架构契约与多工位并行 SuperPower 施工总纲

> **文档编号**：`SPEC-PLAN-043`（总控卷 / Master SuperPower Construction Plan）
> **归属工程**：《无垠边疆：星海纪元》（`void-frontier-age-of-stars`）次世代太空歌剧与多系统交织演进工程
> **上游依据**：
> - 任务委托书：`docs/specs/41_次世代宏伟太空歌剧与多系统交织演化领域专家任务委托书.md`
> - 专家调研报告：`无垠边疆太空歌剧与系统交织调研.md`（《次世代宏伟太空歌剧与多系统交织演化架构深度调研报告》）
> - 既有工程基线：`docs/specs/35_无垠边疆超长线内容与机制创新综合施工计划.md`、`docs/specs/40_行星地表深度机制与全流程全量回归测试规范.md`
> **方法论标准**：`SuperPower` 工程实施范式（Mandatory `Plan` + `Tasks` + `Checklists` 三段式闭环）
> **适用角色**：架构师（Lead Architect）、4 名并行执行工程师（Eng-A / Eng-B / Eng-C / Eng-D）、QA 自动化门禁工程师

## 一、Plan（全局架构蓝图、阶段切分与多工位并行拓扑）

### 1.1 核心工程目标与三大破局靶向

本施工总纲及配套的三卷分阶段施工文档（`SPEC-PLAN-044`、`SPEC-PLAN-045`、`SPEC-PLAN-046`），旨在将《次世代宏伟太空歌剧与多系统交织演化架构深度调研报告》转化为可供多名执行工程师零歧义并行落地的代码级施工蓝图，彻底根治当前版本的三大核心痛点：

1. **终结“系统孤岛与静态数值灌水”**：废除单一的“点击即产资源”静态加法器，基于通用四幕局势引擎（Generalized 4-Act `Situation` Engine）构建七大核心系统独立发展弧（`S1`–`S7`），并通过严格赫尔维茨稳定（Hurwitz-Stable）的 `7×7` 雅可比跨系统耦合矩阵 $J$ 实现三阶蝴蝶效应涟漪传导。
2. **终结“千星一面与探索审美疲劳”**：在不突破单星 `50.00 KB` 内存红线的前提下（实测单星 `3,857 Bytes / 3.77 KB`），构建“轨道环带—地表 `16×16` 位掩码网格—深层地壳”三层垂直耦合架构、五纪元（Epoch `0–4`）不可逆历史演进状态机、稀疏前沿位掩码元胞自动机（Sparse Frontier Bitmask CA）以及 16 大极端天体物理原型（`archetypeId 0–15`）。
3. **终结“深空死寂与太空孤独感”**：注入由五类自主星区生态舰队（商队、走私船、巡逻队、市场远征军、赏金猎人）、具象化星海群像英雄（Galactic Paragons）、全频段子空间信标流（星区内常驻 $\ge 15$ 个活跃非帝国叙事信标）与自适应太空歌剧戏剧导演（Adaptive Space Opera Drama Director）共同组成的活体银河生态。

### 1.2 分阶段施工卷宗拆分体系（Phased Construction Architecture）

为避免长线工程中执行工程师遗漏关键数值公式、位段定义或耦合边界，全套工程按依赖顺序拆分为 **1 份总控总纲 + 3 份分阶段执行卷**：

| 施工卷编号与文件名 | 阶段代号 | 核心交付范围 | 前置依赖 | 验收门禁套件 |
| :--- | :--- | :--- | :--- | :--- |
| **`43_无垠边疆太空歌剧与系统交织_总控架构契约与多工位并行SuperPower施工总纲.md`**（本卷） | **Phase 0 (Master)** | 全局确定性 PRNG 盐值注册表、跨阶段公共数据结构契约、18 条新增 `CommandBus` 命令协议、4 工位并行文件锁边界、存档向后兼容迁移器 | 基线 `main`（金快照 `8be8ce2c`） | `tests/suites/space-opera-foundation-contract.suite.js` (`GATE-15-P0`) |
| **`44_无垠边疆阶段一(M1)_局势弧线引擎与紧凑行星三维底座SuperPower施工文档.md`** | **Phase 1 (M1)** | `3.77 KB` 紧凑 `PlanetState`（`tiles[256]` `uint32` 位编码 + 8D `envVector` + 五纪元状态机 + 三层垂直空间）、三级时钟分片调度器、通用四幕 `Situation` 引擎、`S1` 异星考古弧、`S2` 生态相变弧、`S4` 经济短缺与国家破产弧 | Phase 0 接口契约冻结 | `tests/suites/m1-situation-planet-core.suite.js` (`GATE-15-M1`) |
| **`45_无垠边疆阶段二(M2)_7x7雅可比跨系统耦合与16大天体原型SuperPower施工文档.md`** | **Phase 2 (M2)** | 严格赫尔维茨稳定 `7×7` 雅可比矩阵 $J$ 与三阶蝴蝶效应管线、稀疏前沿位掩码元胞自动机（Sparse Frontier CA）、16 大天体物理原型（`#0–#15`）、`S3` 殖民地阶级与叛乱弧、`S6` 黑市走私与激进渗透（工业关注度 $\ge 7$）弧 | Phase 1 核心数据结构就绪 | `tests/suites/m2-jacobian-archetypes-ca.suite.js` (`GATE-16-M2`) |
| **`46_无垠边疆阶段三(M3)_反孤独太空歌剧生态与自适应戏剧导演SuperPower施工文档.md`** | **Phase 3 (M3)** | 5 类自主星区生态舰队 AI、`S5` 舰队学说与 D-Mods/S-Mods 战损弧、星海群像英雄（XP/软上限 $N/C$ 与 $0.85^{N-C}$/创伤/忠诚政变/传奇领袖）、子空间信标流（$\ge 15$）、`S7` 兰兹拉德/CHOAM/间谍与三大终局天灾+利维坦大游行、自适应戏剧导演（$T \in [0,100], A \in [0.75,1.35]$） | Phase 2 耦合矩阵与社会黑市就绪 | `tests/suites/m3-space-opera-drama-director.suite.js` (`GATE-17-M3`) |

### 1.3 四工位并行职责矩阵与文件修改隔离边界（Zero-Conflict Ownership）

为支持 4 名执行工程师在同一代码库并行施工而不发生 Git 合并冲突，严格实行按目录与模块切分的**单写者所有权原则（Single-Writer Ownership）**：

| 执行工位代号 | 角色定位 | 独占写入源码目录与核心模块 | 跨工位只读依赖接口 |
| :--- | :--- | :--- | :--- |
| **Eng-A**<br/>（内核与行星微模拟工程师） | 确定性随机核、紧凑内存布局、三级时钟分片、稀疏 CA、16 大天体物理原型、7×7 雅可比矩阵运算 | `src/domain/world/deterministicRng.js`<br/>`src/domain/planets/planetStateSchema.js`<br/>`src/domain/planets/sparseFrontierCA.js`<br/>`src/domain/planets/archetypeMechanics.js`<br/>`src/simulation/TickPipeline.js`<br/>`src/simulation/DailySystems.js`<br/>`src/simulation/MonthlySystems.js`<br/>`src/simulation/jacobianCoupling.js` | 读取 `src/content/planetaryArchetypes.js`；向 Eng-B/Eng-C 暴露 `deriveSeed()`、`unpackTile()`、`packTile()`、`getSystemStressVector()` |
| **Eng-B**<br/>（局势弧线、经济与社会政治工程师） | 通用四幕 `Situation` 引擎、`S1` 考古、`S2` 生态恶化、`S3` 社会阶级与叛乱、`S4` 短缺与破产、`S6` 黑市走私与激进组织、`S7` 议会法案与三大天灾 | `src/domain/events/situationEngine.js`<br/>`src/domain/exploration/archaeologyArc.js`<br/>`src/domain/planets/ecologicalPhaseArc.js`<br/>`src/domain/politics/colonySocialArc.js`<br/>`src/domain/economy/shortageSituationArc.js`<br/>`src/domain/economy/shadowSyndicateArc.js`<br/>`src/domain/diplomacy/galacticSenateAndCrisisArc.js` | 调用 Eng-A 的 `deriveSeed()` 与 `PlanetState` 读写器；向 Eng-A 的雅可比耦合器提供 $S_1 \dots S_7$ 原始内生推力 $\Delta S_{\text{endo}}$ |
| **Eng-C**<br/>（舰队学说、群像英雄与戏剧导演工程师） | `S5` 舰队学说与 D-Mods/S-Mods、星海群像英雄 Paragons、5 类自主星区生态舰队、子空间信标流、自适应太空歌剧戏剧导演 | `src/domain/fleets/fleetDoctrineAndScars.js`<br/>`src/domain/characters/galacticParagons.js`<br/>`src/domain/world/autonomousSectorLife.js`<br/>`src/domain/world/subspaceBeaconStream.js`<br/>`src/simulation/dramaDirector.js` | 调用 Eng-B 的 `situationEngine.spawnSituation()` 注入高潮大事件与 `+18` 机遇信标；读取 `S1–S7` 状态向量 |
| **Eng-D**<br/>（静态内容配置、视图模型与自动化门禁工程师） | 16 原型静态配置、叙事词库、ViewModels 投影、WebGL2/UI 蝴蝶效应因果链渲染、全阶段零打桩回归测试套件 | `src/content/planetaryArchetypes.js`<br/>`src/content/spaceOperaBeacons.js`<br/>`src/simulation/ViewModels.js`<br/>`src/simulation/SnapshotBuilder.js`<br/>`tests/suites/space-opera-*.suite.js`<br/>`tests/suites/m1-*.suite.js` / `m2-*.suite.js` / `m3-*.suite.js` | 只读聚合 Eng-A/B/C 导出的领域状态，严禁在 `ViewModels.js` 内修改领域数据 |

### 1.4 全局硬性工程红线（Hard Architectural Invariants）

1. **零 `Math.random()` 确定性铁律**：任何新模块严禁调用 `Math.random()`、`Date.now()` 或依赖 V8 无序对象属性遍历。所有随机采样必须通过 `deriveSeed(world.seed, domainSalt, entityId, step)` 驱动。
2. **金快照向后兼容铁律**：在默认历史回放测试参数（未显式开启新局势命令或处于旧存档升级前的初始帧）下，既有金快照 `8be8ce2c` 必须保持逐字节 100% 一致，零漂移。
3. **内存与深拷贝预算铁律**：
   - 单颗行星完整 `PlanetState` 序列化尺寸 **$\le 50.00\text{ KB}$**（目标基准：`3,857 Bytes / 3.77 KB`）；
   - 单星 `deepClone` 耗时 **$\le 0.5000\text{ ms}$**（实测基准：`0.3152 ms`）；
   - 300 颗行星全银河完整快照深拷贝耗时 **$\le 260.00\text{ ms}$**（实测基准：`246.40 ms`）。
4. **三级时钟分片帧耗时铁律**：
   - Medium Tick（日/周级，10 桶轮询，每帧 1 桶 = 30 颗行星 + 12 支自主舰队）单帧耗时 **$\le 1.5000\text{ ms}$**（实测基准：`0.3933 ms`）；
   - Slow Tick（月/季级，30 桶轮询，每帧 1 桶 = 10 颗行星稀疏 CA + 3 名领袖 + 月末雅可比与戏剧导演更新）单帧耗时 **$\le 2.0000\text{ ms}$**（实测基准：`0.4187 ms`）；
   - WebGL2 单星地表渲染 DrawCall **$\le 32$ 批次**，切换视图 100 次 $\Delta\text{GPU Buffer} = 0$。

## 二、Tasks（全局公共基建与跨阶段接口契约施工任务）

### Task 0.1：确定性雪崩哈希 `mix32` 与独立盐值子流注册表（责任人：Eng-A）

* **目标文件路径**：`src/domain/world/deterministicRng.js`
* **核心实现要求**：
  1. 实现无状态 32-bit 整数雪崩混洗函数 `mix32(h)`（基于 `Math.imul` 保证 JavaScript 引擎 32 位有符号乘法精确截断，随后通过 `>>> 0` 强制转换为无符号 32 位整数 `uint32`）。
  2. 实现四元组确定性种子派生函数 `deriveSeed(worldSeed, domainSalt, entityId, step)`，以及确定性浮点归一化采样函数 `sampleFloat01(worldSeed, domainSalt, entityId, step)` 与确定性加权离散采样器 `sampleWeightedIndex(worldSeed, domainSalt, entityId, step, weights)`。
  3. 冻结全工程统一 `DOMAIN_SALTS` 常量表，严禁各模块私自硬编码魔数盐值。

* **标准代码契约**：

```javascript
// src/domain/world/deterministicRng.js

export const DOMAIN_SALTS = Object.freeze({
  PLANET_MASTER:       0x5000, // 行星静态天体原型与初始地层生成
  PLANET_SURFACE_CA:   0x5001, // 行星地表 256-Tile 稀疏前沿元胞自动机演化
  PLANET_SUBTERRANEAN: 0x5002, // 深层地壳坍塌与地底遗迹激活检定
  ARC_S1_ARCHAEOLOGY:  0xA101, // S1 深空考古与先驱者事件链采样
  ARC_S2_ECOLOGY:      0xA201, // S2 行星生态相变与局部环境灾害触发
  ARC_S3_SOCIETY:      0xB201, // S3 殖民地阶级思潮漂移与叛乱事件采样
  ARC_S4_ECONOMY:      0xB401, // S4 宏观经济短缺波动与破产次生冲击
  ARC_S5_DOCTRINE:     0xC501, // S5 战舰 D-Mod 战损抽签与残骸生成
  ARC_S6_SYNDICATE:    0xC301, // S6 黑市走私查获检定与激进组织渗透袭击
  ARC_S7_CRISIS:       0xC701, // S7 议会刺杀检定与三大终局天灾裂隙选址
  SECTOR_AUTONOMOUS:   0xD401, // 自主星区生态舰队（商队/走私/巡逻/远征/赏金）路由
  PARAGON_DESTINY:     0xD801, // 星海群像英雄特质觉醒、创伤检定与政变判定
  SUBSPACE_BEACON:     0xE501, // 全频段子空间信标流生成与频段调制
  DRAMA_DIRECTOR:      0xF601, // 自适应太空歌剧戏剧导演高潮弧与机遇信标投放
});

/**
 * 32-bit 确定性无状态雪崩哈希混洗函数
 * @param {number} h - 输入 32 位整数
 * @returns {number} 无符号 32 位整数 (0 ~ 4294967295)
 */
export function mix32(h) {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * 四元组确定性子流种子派生器
 * @param {number} worldSeed - 世界主种子
 * @param {number} domainSalt - 领域隔离盐值 (取自 DOMAIN_SALTS)
 * @param {number} entityId - 实体数字 ID (行星/舰队/领袖/局势 ID)
 * @param {number} step - 逻辑帧号或阶段序号
 * @returns {number} 无符号 32 位派生种子
 */
export function deriveSeed(worldSeed, domainSalt, entityId, step) {
  let h = mix32((worldSeed ^ domainSalt) >>> 0);
  h = mix32((h ^ Math.imul(entityId | 0, 0x9e3779b9)) >>> 0);
  h = mix32((h ^ Math.imul(step | 0, 0x7f4a7c15)) >>> 0);
  return h >>> 0;
}

/**
 * 确定性 [0, 1) 均匀分布双精度浮点采样
 */
export function sampleFloat01(worldSeed, domainSalt, entityId, step) {
  return deriveSeed(worldSeed, domainSalt, entityId, step) / 4294967296.0;
}
```

### Task 0.2：跨阶段 18 条新增 `CommandBus` 命令契约注册表（责任人：Eng-A / Eng-B / Eng-C 协同）

* **目标文件路径**：`src/app/CommandBus.js`（扩展注册表）与 `src/domain/world/commandSchemas.js`（新建契约校验）
* **核心实现要求**：所有玩家主动干预局势、调整区划、切换学说、签署私掠证或互动子空间信标的操作，必须封装为纯数据 Payload 命令通过 `CommandBus.dispatch(cmd)` 执行，确保录像回放（Replay）100% 可重现。

| 命令名称 (`cmd.type`) | 所属阶段与模块 | 必填 Payload 字段签名 | 状态变更后置条件（Post-Condition） |
| :--- | :--- | :--- | :--- |
| `SetSituationApproach` | M1 / `situationEngine.js` | `{ situationId: number, approachId: string }` | 切换指定局势的应对策略（如 `Cautious` / `Overdrive`），更新月度进度增量 $\Delta p$ 与修正 Buff，记录冷却时间戳 |
| `ConfigureUrbanZone` | M1 / `planetStateSchema.js` | `{ planetId: number, zoneSlot: 0 \| 1, zoneType: number }` | 配置行星城市区划的 2 个自定义功能区（如档案馆区、重工冶炼区、商贸自由港区），重算岗位容量 |
| `ConstructOrbitalFacility` | M1 / `planetStateSchema.js` | `{ planetId: number, slotIndex: number, facilityType: number }` | 在行星轨道环带层建造轨道居住站（Orbitals）或黑洞观测站；若为黑洞观测站则自动派生引力井局势（起始进度 `25`） |
| `ExcavateSubterraneanLayer` | M1 / `planetStateSchema.js` | `{ planetId: number, depthTier: 1 \| 2 \| 3 }` | 掘进深层地壳，解锁地下城市槽或先驱者地宫；同步增加 `envVector[0]`（构造应力）与 `envVector[7]`（工业扰动） |
| `TriggerTerraformingPhase` | M1 / `ecologicalPhaseArc.js` | `{ planetId: number, targetArchetype: number }` | 消耗 `5,000` 能量/信用点执行气候改造或触发行星五纪元跃迁（`epochStage` $+1$），写入 `historyRing[8]` |
| `EmergencyDebtRestructure` | M1 / `shortageSituationArc.js` | `{ empireId: number, resourceId: string, cutInvestment: boolean }` | 在 S4 资源短缺局势中启用/关闭 `Cut Investments`（工匠与冶金产出 `-25%`，维护费 `-50%`） |
| `LockQuantumPhasePlanet` | M2 / `archetypeMechanics.js` | `{ planetId: number, fleetId: number, engageLock: boolean }` | 针对 `#2` 量子游离天体，派遣科研舰张开观测场锁定其量子相位，暂停相移但增加反应堆维护 |
| `EnactColonyMartialLaw` | M2 / `colonySocialArc.js` | `{ planetId: number, crackDownLevel: 1 \| 2 }` | 在 S3 殖民地叛乱局势中执行镇压或全面戒严（`Total Crackdown`），立即修正稳定度与阶层幸福度 |
| `PurgeRadicalCell` | M2 / `shadowSyndicateArc.js` | `{ planetId: number, useMilitaryForce: boolean }` | 清剿行星上因工业关注度 $\ge 7$ 激活的激进分子潜伏基地（Luddic Path Cell），消除海盗袭击信标源 |
| `EstablishSyndicateBranch` | M2 / `shadowSyndicateArc.js` | `{ targetPlanetId: number, branchType: string }` | 在目标殖民地建立犯罪辛迪加地下分部，建立 `Shady Contacts`（`+1` 解密/加密）并抽取黑市暗流收益 |
| `ConfigureFleetDoctrine` | M3 / `fleetDoctrineAndScars.js` | `{ empireId: number, doctrineSize: number, qualityWeight: number, officerAggression: number }` | 在巡逻司令部（Patrol HQ）调整舰队学说配比（舰船尺寸 vs 装备质量 vs 军官鲁莽度），重算星区巡逻编队模板 |
| `RestoreShipDMod` | M3 / `fleetDoctrineAndScars.js` | `{ shipId: number, dModId: string }` | 消耗高额合金修复战舰永久结构暗伤（D-Mod），恢复战舰原始部署补给成本（消除 `-20%` D-Mod 折扣） |
| `InstallShipSMod` | M3 / `fleetDoctrineAndScars.js` | `{ shipId: number, moduleId: string }` | 消耗剧情点/稀有遗物为老兵战舰永久焊死精英改装件（S-Mod），解锁额外传奇词条 |
| `SalvageBattleWreckHabitat` | M3 / `fleetDoctrineAndScars.js` | `{ wreckEntityId: number, convertToHabitat: boolean }` | 将重大战役遗留的巨型主力舰残骸改造为永久“残骸栖息地（Wrecked Warship Habitat）”或拆解回收 |
| `AssignParagonDestinyTrait` | M3 / `galacticParagons.js` | `{ leaderId: number, destinyTraitId: string }` | 当领袖达到 8 级（Lv 8）时，从确定性派生的三项专精天命特质（Destiny Traits）中择一固化 |
| `ToggleBeholderMode` | M3 / `galacticParagons.js` | `{ paragonId: number, mode: 'WARSHIP_COMMANDER' \| 'MURMURING_MONOLITH' }` | 切换传奇灵能机械核心 `The Beholder` 的形态（战舰指挥官 vs 行星地表“低语方尖碑”总督，将矿工转化为灵能体产能量与凝聚力） |
| `RespondSubspaceBeacon` | M3 / `subspaceBeaconStream.js` | `{ beaconId: number, responseOptionId: string }` | 响应星区内的动态子空间无线电信标（救援遇险商船、竞标黑市军火合约、拦截古代求救信号） |
| `ManageLeviathanParade` | M3 / `galacticSenateAndCrisisArc.js` | `{ situationId: number, action: 'ENCOURAGE' \| 'SUPPRESS' \| 'REORGANIZE' }` | 操控击杀太空巨兽后的“利维坦凯旋大游行”局势（鼓励 `+6/月`、压制 `-4/月`、消耗 `1,000` 凝聚力重整路线） |

### Task 0.3：存档平滑迁移器与 `world.spaceOperaState` 根容器（责任人：Eng-A）

* **目标文件路径**：`src/domain/world/worldMigration.js`
* **核心实现要求**：
  1. 在 `world` 根对象下挂载向后兼容的惰性初始化容器 `world.spaceOperaState`，若加载旧版（`< v2.0`）存档时缺失该字段，由 `ensureSpaceOperaState(world)` 无损补齐默认值，且**不消耗任何一次 `world.rng`**。
  2. 容器结构定义如下：

```javascript
// src/domain/world/worldMigration.js
export function ensureSpaceOperaState(world) {
  if (world.spaceOperaState) return world.spaceOperaState;
  world.spaceOperaState = {
    schemaVersion: 200,
    // 7 大核心系统宏观状态向量 S = [S1..S7] in [0, 100]^7
    systemVector: [15.0, 15.0, 20.0, 15.0, 15.0, 10.0, 10.0],
    // 最近 16 条三阶蝴蝶效应跨系统传导因果链日志
    butterflyCausalLog: [],
    // 活跃四幕局势字典 (key: situationId)
    situations: {},
    nextSituationId: 1,
    // 自主星区生态舰队列表 (商队/走私/巡逻/远征/赏金)
    autonomousFleets: [],
    // 活跃子空间信标流列表 (保持 >= 15 个非帝国叙事信标)
    subspaceBeacons: [],
    // 自适应太空歌剧戏剧导演状态
    dramaDirector: {
      tension: 18.0,          // T in [0.0, 100.0]
      adaptationFactor: 1.0,  // A in [0.75, 1.35]
      adaptDays: 0.0,         // 创伤适应累积天数 [-50, 100]
      climaxCount: 0,         // 已触发的史诗高潮次数
      lastClimaxTick: -1,
      recoveryGraceUntilTick: -1
    }
  };
  return world.spaceOperaState;
}
```

## 三、Checklists（全局基建与跨阶段接口达标自检表）

执行工程师在进入 Phase 1（M1）编码前，必须逐项勾选并通过以下自检清单：

### 3.1 静态代码与确定性纪律检查（Static & Determinism Gate）
- [x] **CHK-00-01（零原生随机）**：执行 `grep -rn "Math.random" src/`，输出必须为 `0` 行匹配。——实证：tests/suites/space-opera-foundation-contract.suite.js:70-104（chk0001 递归扫 src/ 全树 193 文件，断言 :102 Math.random 零命中、:103 白名单外 Date.now 零命中）；本机 grep src/ 实扫 0 匹配。
- [x] **CHK-00-02（位运算无符号保护）**：检查 `deterministicRng.js` 中所有 32 位移位与乘法操作，确认全部使用 `Math.imul` 并在返回前执行 `>>> 0` 无符号截断，输入负数 `entityId` 或极大 `step` 时绝不产出负数种子。——实证：src/domain/world/deterministicRng.js:49-69（mix32 全 Math.imul + `>>> 0`）、:71-87（deriveSeed 三次 mix32 混洗）；tests/suites/space-opera-foundation-contract.suite.js:111/:119-121/:126（uint32 值域、负 entityId+极大 step、三次派生逐位一致、异盐互异）。
- [x] **CHK-00-03（盐值唯一性）**：断言 `Object.values(DOMAIN_SALTS)` 中 14 个十六进制盐值无任何重复（`new Set(Object.values(DOMAIN_SALTS)).size === 14`）。——实证：src/domain/world/deterministicRng.js:23-47（DOMAIN_SALTS 冻结 14 盐表）；tests/suites/space-opera-foundation-contract.suite.js:133-135/:153（盐集=14/冻结/逐键对照冻结契约值）。

### 3.2 金快照向后兼容与性能基线检查（Golden Snapshot & Memory Gate）
- [x] **CHK-00-04（金快照零漂移）**：调用 `ensureSpaceOperaState(world)` 后运行既有金快照套件，断言哈希值精确等于 `8be8ce2c`。——实证：src/domain/world/worldMigration.js:37-98（ensureSpaceOperaState 惰性补齐、零 world.rng 消费）；tests/suites/space-opera-foundation-contract.suite.js:160-192（容器幂等/逐字段契约/rng 与实体键集零扰动）；tests/regression/golden.json:4（基线 hash=8be8ce2c）；node tests/tools/run-suites.mjs --id=REG-01 本机 3 轮全 PASS。
- [x] **CHK-00-05（命令总线可序列化）**：对全部 18 条新增 `CommandBus` 命令构造标准测试 Payload，执行 `JSON.parse(JSON.stringify(cmd))` 后派发，断言前后世界状态 SHA-256 摘要 100% 一致。——实证：src/domain/world/commandSchemas.js:19-226/:227（SPACE_OPERA_COMMANDS 18 条冻结契约 + validateSpaceOperaCommandPayload）；src/app/commandsSpaceOpera.js:130（18 条契约统一注册循环）与 :545-640（S7 十命令扩展注册面）；tests/suites/space-opera-foundation-contract.suite.js:209-243（chk0005：18/18 双胞胎哈希一致 + 信封一致 + 负样本拒收，断言 :211/:213/:215/:227）。
