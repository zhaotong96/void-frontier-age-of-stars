# 《无垠边疆》超长线演化 v0.2→v1.0 正式验收报告（docs 16~22 全链路合龙）

> **报告标识**：`docs/reports/report-ultra-longline.md`
> **验收对象**：docs 18（v0.2 异星博物志）/ docs 19（v0.4 星际母厂）/ docs 20（v0.6 天灾与利维坦）/ docs 21（v0.8 边疆总督）/ docs 22（v1.0 苍穹要塞）五阶段顺序施工
> **最高总纲**：docs 16（一切冲突以其为准）；**架构白皮书**：docs 17
> **工程基准**：docs 18~22 标定基线 `84127db`；本报告对应 HEAD 见文末提交链
> **验收人**：执行工程师（自动化门禁 + 全量回归双口径）

---

## 一、总裁定

| 指标 | 基线（84127db） | 竣工态 | 红线 | 裁定 |
| --- | --- | --- | --- | --- |
| 自动化测试 | 42 套件 84/84（2 轮） | **47 套件 94/94（2 轮）** | 全绿 | ✅ |
| 金快照哈希 | 68462446 | **68462446（REG-01 每轮 PASS，0 漂移）** | 逐位零漂移 | ✅ |
| 静态审计 | 0 违规 | **0 违规（lint:static）** | 0 违规 | ✅ |
| 打包产物 | 142 模块 1786KB | **151 模块 1967KB（node --check 零错）** | 零外链单文件 | ✅ |
| Math.random / world.rng 消费 | 禁 | **0 处新增消费（XENO-01 每阶段 100 星 JSON.stringify(world.rng) 前后逐字节相等 + SYNERGY-05 终检）** | 绝对禁止 | ✅ |
| deepClone 增量 | — | eco 10 星 0.105ms / planet.ind 0.182ms / planet.eco 单星克隆 <0.5ms | ≤0.5ms | ✅ |
| 单星持久化增量 | — | eco 峰值 208B（≤3KB）/ planet.ind 5259B（≤15KB）/ 风暴+威胁 ≤2KB 口径 | ≤10~22KB | ✅ |
| Draw Call | ≤50 | BioFloraPass 恒 2 DC（源级断言）+ 建筑批处理 1 DC + 居民合流 chars 1 DC | 单屏 ≤50（终局 ≤36 目标） | ✅ |

**五套新增阻断门禁全绿**：PLAYTEST-GATE-05（XENO-01..05）/ GATE-06（IND-01..05）/ GATE-07（THREAT-01..05）/ GATE-08（SOC-01..05）/ GATE-09（SYNERGY-01..05）——均注册于 `tests/suites/playtest-gates.suite.js` 与 `tests/suites/index.js`，随全量回归双轮执行。

---

## 二、五阶段竣工明细（门禁逐项对映）

### 2.1 v0.1.1 基线淬火（docs 18 WP-0）— 提交 `53add33`

| 工单 | 交付 | 实证（文件:行号） |
| --- | --- | --- |
| WP-0.1 uFootsteps 环形缓冲类型守卫 | Float32Array(32) 直通复制，防 Array.isArray 静默拦截 | `src/render/gl/PlanetTerrainMesh.js:366-371`（setTheme 分支） |
| WP-0.1 脚步坐标场域偏移 | 世界→场域内收（+FIELD_OFFSET），防 uWorldOffset 二次叠加 | `src/ui/screens/GroundView.js` `_moveAABB` 脚步环写入段（约 :2180） |
| WP-0.2 siteModifier 语义旗透传 | flags/clearFlags/weights/biomeId 全链透传（GroundView 包装链 + attachTerrainEdits 组合链） | `src/ui/screens/GroundView.js`（siteModifier 包装，约 :1000）；`src/domain/ground/terrainEdits.js:321-344`（composed） |
| WP-0.3 工程模式快捷键 | `[`/`]`/`B` 建筑型号循环（矿脉过滤面板 + 自由探索 HUD 造价明示；箭头键为移动键不占用——doc17 §4.1 权威口径） | `src/ui/screens/GroundView.js` `_cycleBuildDef`/`_renderBuildHudNotification`/`_onKeyDown` BracketLeft/Right/KeyB 分支 |

### 2.2 v0.2 异星博物志（docs 18 WP-1..WP-5）— 提交 `467a4d4`

| 工单 | 交付 | 实证 |
| --- | --- | --- |
| WP-1 雪崩子流树 | `mix32`/`createSubRng`/`derivePlanetSeedsExtended`（SALT_FLORA/FAUNA/RUIN/WEATHER/DILEMMA 五盐；既有 derivePlanetSeeds 逐位不动） | `src/domain/ground/planetSeeds.js:40/52/109` |
| WP-2 生态斑块 + 四阶段图鉴 | `ensurePlanetEco`（5 斑块 [biomass,nutrients,water,contamination,densityMask]）+ `advanceSpeciesDiscovery`（2-bit discoveryMask：00 未发现/01 Observed/10 Identified/11 Mastered；sampleMask 记 Analyzed 里程碑）+ `collectSpecimenSample` + `tickPlanetEcology`（ΔN=B−D+M+ΣI 日结算）+ 全满贯大奖幂等 | `src/domain/ground/xenobiology.js:119/190/221/251` |
| WP-3 五阶段巨石遗迹 | 除障（getElevation 4 点均值）→方言拓印（world.narrative.lexiconMask 32 语素）→谐振对光（raycastTerrain 山脊遮挡）→机偶守卫→核心破译（tech_precursor_shield_harmonics / tech_precursor_mass_catapult，canStart 拒常规科研） | `src/domain/ground/monolithRuins.js:81/132/164/193/210/265`；`src/content/technologies.js`（先驱者科技段）；`src/domain/research/research.js` canStart |
| WP-4 分析面罩 + BioFloraPass | V 键面罩（60m 目击 1.0s / 25m 光谱 3.0s 锁定 + uFootsteps 槽 7 扫描波环）+ 双通道实例化（A 植被风摆 ≤1024 实例 1 DC / B 动物四足迈步 VS 内代数 ≤128 实例 1 DC）挂载 PlanetSurfaceScene | `src/render/gl/BioFloraPass.js`（全文，2 处 drawElementsInstanced）；`src/render/gl/PlanetSurfaceScene.js`（draw 步骤 3 + setTheme 色提取 + destroy/rebuild）；`src/ui/screens/GroundView.js` `_updateVisor`/`_fireScanPulse`/`_buildBioInstances` |
| WP-5 GATE-05 | XENO-01 零污染（100 星 rng 逐字节相等 + 456 seed 雪崩无碰撞）/ XENO-02 满贯幂等 / XENO-03 五阶段严苛链（StillBuried 拒拓印、RotationMismatch/SkyObstructed 拒守卫战、GuardianAlive 拒提取）/ XENO-04 eco 208B≤3KB + 10 星克隆 0.105ms≤0.5ms / XENO-05 三旗舰 PCDI≥85 | `tests/suites/playtest-gates.suite.js` suite05；PCDI 评分器 `src/domain/ground/pcdi.js:31`（doc16 §9 七维权重表） |
| 命令 | ScanPlanetarySpecimens / SamplePlanetarySpecimen / AdvanceMonolithStage（excavate/inscribe/rotate/guardianDefeated/extract） | `src/app/commands.js`（v0.2 命令段） |

### 2.3 v0.4 星际母厂（docs 19 WP-1..WP-6）— 提交 `1e2df1b`

| 工单 | 交付 | 实证 |
| --- | --- | --- |
| WP-1 并查集电网 | `rebuildPowerGrids`（UnionFind 连接半径 max(rA,rB)×10；仅放置/拆除时重建）+ 蓄电池 etaPermille 平衡 | `src/domain/industry/planetaryLogistics.js:55` |
| WP-2 FFF #176 传送带 | `stepTransportLineO1`（12 元组 [lineId,from,fromSlot,to,toSlot,tier,len_dm,headGap_mm,tailGap_mm,res,count,mask32]；O(1) 首尾整数加减；12 子步/小时）+ 立体交叉 `beltIsCrossed`（渲染层 +1.8m） | `src/domain/industry/planetaryLogistics.js:99/211` |
| WP-3 加工厂梯队 + 透明效率 | bld_arc_smelter（ferro→alloy 6s）/bld_coil_assembler（双输入 9s）/bld_quantum_lattice（先驱者科技门槛）+ `computeProductionEfficiency`（P=P_base×F_power×F_input×F_transport×F_staff×F_env 逐项可展示）+ `routeSplitter` 三模式（轮询 parity 1-bit 绝对确定） | `src/domain/industry/planetaryLogistics.js:147/161/182`；`src/content/buildings.js`（工业定义段） |
| WP-4 弹射井 + 泰坦闭环 | `launchEnergyMWh`=E0·(g/g0)·(1+βρ) / `stepCatapult`（蓄能 100% 发射 → orbitalBuffer）/ `settleOrbitalBuffer` 三级分发（船坞直供 20 装甲舱+5 量子舱 → hull_titan 合拢 / 班轮 / 市场倾销） | `src/domain/industry/catapult.js:37/61/109`；`src/content/hulls.js` hull_titan |
| WP-5 bmesh 扩容 + 带渲染 | cap 192→384 + pylon/splitter/catapult 槽位（BUILD_CATEGORY_IDS 18..20 稳定追加）+ 货箱视觉数 = 实体带载（path.count 同源） | `src/ui/screens/GroundView.js`（BuildingMeshBatch cap；categoryOf SLOT_OF；_buildConveyorPaths belts 段）；`src/render/meshes/GroundMeshes.js`（pylon/splitter/catapult cases）；`src/render/gl/PlanetSurface3D.js`（wantCount） |
| WP-6 GATE-06 | IND-01 守恒漂移 0（64 节点/48 带 ×1000 tick，U1−U0 ≡ produced−consumed+feed）/ IND-02 13 子网分裂 + fPower=0.67 / IND-03 轮询 50:50·优先 100:0·过滤 / IND-04 E(g1.8)=52.7MWh → hull_titan 合拢台账 0/0 / IND-05 planet.ind 5259B≤15KB + 克隆 0.182ms + PCDI=100 | `tests/suites/playtest-gates.suite.js` suite06 |
| 接线 | HourlySystems production（仅 planet.ind 星球——金快照零漂移）+ 命令 BuildConveyorBelt/ConfigureSplitter/CatapultFeed + PlaceBuilding 工业节点双写 | `src/simulation/HourlySystems.js`（production 段）；`src/app/commands.js`（v0.4 命令段） |

### 2.4 v0.6 天灾与利维坦（docs 20 WP-1..WP-6）— 提交 `4add060`

| 工单 | 交付 | 实证 |
| --- | --- | --- |
| WP-1 五阶段状态机 + uStormFront | Clear→Warning45s→Buildup30s→Peak90~150s→Recovery30s；锋面 1.8m/s；四旗舰风暴（酸雹 4.5HP/s / 热浪雾距 22% / 磁暴落雷 / 极寒巨潮 +8.5m）；uStormFront 单 uniform 注入 TERRAIN_MESH_FS（GPU 平面波 + 雾距 22% 收窄）与 SKY_FS（方向压暗） | `src/domain/ground/planetWeather.js:117/164/186`；`src/render/gl/PlanetTerrainMesh.js`（uStormFront 注入段）；`src/render/gl/PlanetAtmosphere.js`（SKY_FS 注入段） |
| WP-2 三重庇护 | FOUNDATION 屋檐 3.5m / 热源穹顶 / exo_mod_thermal_shield·exo_mod_acid_carapace 科技（bio tier3）；bld_sonic_dampener / bld_lightning_rod 建筑定义 | `src/domain/ground/planetWeather.js:186`；`src/content/technologies.js`（exo_mod 段）；`src/content/buildings.js` |
| WP-3 PTI 微分方程 | H_t=clamp(H+2.0×mine+0.4×ind+25×catapult−1.5×restore−6×dampener−1.5%·H)；五级阶梯（200/400/650/850）；双派系哲学（哨卫打 power_grid / 异虫打 mines_farms）；弹射激发 +25（spikeCatapultLaunch → hourly 入账） | `src/domain/ground/planetaryThreat.js:53/189`；`src/simulation/HourlySystems.js`（threat 段——仅 planet.threat 已初始化行星，金快照零漂移） |
| WP-4 利维坦 | awakenLeviathan（3600HP/14m/三原型按类别派生）+ breakLeviathanPart（6.0s stagger + 部位永久关闭）+ reportLeviathanDefeated（PTI 归零 + exoticMatter×5 + catapultLock 解锁）+ composeWave 阶梯编制 | `src/domain/ground/planetaryThreat.js:117/143/165/189` |
| WP-5 音画协同 | GroundView 风暴横幅 HUD + 酸蚀扣盾（暴露判定 stormDepthAt 同源）+ 利维坦血条/部位状态/遭遇战（BreakLeviathanPart/ReportLeviathanDefeated 命令） | `src/ui/screens/GroundView.js` `_tickStormDamage`/`_syncLeviathan`/`_drawHudFree` 风暴段 |
| WP-6 GATE-07 | THREAT-01 五阶段 6 相位 + 三重庇护 0 扣血 + 4.5HP/s 精确 / THREAT-02 PTI 715→0 平降（阻尼 λ=1.5%/h 实测）/ THREAT-03 双派系波次确定性 / THREAT-04 瘫痪 6s + exoticMatter×5 + PTI 归零 / THREAT-05 PCDI=92 | `tests/suites/playtest-gates.suite.js` suite07 |

### 2.5 v0.8 边疆总督（docs 21 WP-1..WP-6）

| 工单 | 交付 | 实证 |
| --- | --- | --- |
| WP-1 32 居民三班倒样条通勤 | 9 元组代理 [id,stratum,home,work,svc,shift,morale,health,trait] + `bakeCommuteSpline`（Catmull-Rom 三程 + 端点锚定 + 地形贴合）+ `sampleSplinePos`（代数相位插值）+ `residentPhaseOf` 四时相（0.00-0.12 通勤/0.12-0.55 作业/0.55-0.75 休闲/0.75-1.00 归家）；Y 逐帧贴 sampleTerrain（零穿地零悬空）；合流 chars 实例通道 1 DC | `src/domain/planets/colonyGovernance.js:94/156/182/208`；`src/ui/screens/GroundView.js` `_setupResidents`/`_updateResidents` |
| WP-2 双轨社会心理 + 繁荣度 | Φ=0.40H+0.30(100−D)+0.15S_svc+0.15η_power（`tickColonySociety` 日结算）；四大法典效果表；7 大特化类型；黄金繁荣态（Φ≥75）科研注入 | `src/domain/planets/colonyGovernance.js:208/303`；`src/simulation/DailySystems.js`（population 段——仅 planet.soc 已初始化行星，金快照零漂移） |
| WP-3 总督 + 法典 | AppointOverseer（bookish/iron_fisted/mercantile traits 数组口径）+ SignColonyEdict/RevokeColonyEdict（四大法典） | `src/domain/planets/colonyGovernance.js`（COLONY_EDICTS/OVERSEER_TRAITS）；`src/app/commands.js`（v0.8 命令段） |
| WP-4 长期记忆 + 平叛 | dilemmaSeed(tick) 确定性困境抽取（罢工/孢子/走私；bookish 解锁第三选项）+ planet.soc.history 有界 20 条 + 暴动临界（D≥90∧H≤15 持续 7 日）→ gmt_suppress_rebellion + ReportRebellionSuppressed 重置 | `src/domain/planets/colonyGovernance.js:370` 及暴动段 |
| WP-4X 税基转化 | collectTax 挂钩 TaxBonus=(1+(Φ/100)²×1.5)×法典/总督修正 | `src/domain/economy/ledger.js` collectTax |
| WP-5 ColonyView 面板 | 总督公署与法典全息子面板（双轨进度条 + Φ 公式 + 税基倍率 + 法典按钮 + 困境裁决卡 + 暴动告警） | `src/ui/screens/ColonyView.js` `_renderGovernancePanel` |
| WP-6 GATE-08 | SOC-01 4320 采样零穿地速度 ≤2.6m/s / SOC-02 双轨方程核账（应急 +7 不满/配给 +8 希望）/ SOC-03 税基 ×1.96 + collectTax 实测 / SOC-04 7 日暴动临界→平叛重置 / SOC-05 PCDI=91 | `tests/suites/playtest-gates.suite.js` suite08 |

### 2.6 v1.0 苍穹要塞（docs 22 WP-1..WP-6）

| 工单 | 交付 | 实证 |
| --- | --- | --- |
| WP-1 轨道五大支援 | `callOrbitalSupport`（激光 45s/15 燃料；动能 180s/400 AoE；EW 30s；机甲空投 120s+20alloy+2powerCell；补给舱 90s）+ 磁暴雷达锁定制约 + 激光洗地自动 ShapeTerrain(lower) 真实开山 | `src/domain/strategic/orbitalSynergy.js:59`；`src/app/commands.js` CallOrbitalSupport |
| WP-2 显著度校验 | `checkBuildingPlacementExtended`（均值 +14.0m 桌山高脊 + 60° 天顶锥角 `fieldSkyOcclusionCone`）+ 高程每 +10m 穿甲 +12%（≤+35%）+ bld_ion_battery/bld_orbital_radar/bld_planetary_shield 定义 | `src/domain/ground/terrainEdits.js:455/495/508`；`src/content/buildings.js`（要塞建筑段） |
| WP-3 越级齐射 | `firePlanetaryIonBatteries`（HourlySystems combat 自动触发 + FirePlanetaryIonBattery 命令；50% 穿盾直击装甲；2h 冷却；无雷达命中率 20%） | `src/domain/strategic/orbitalSynergy.js:137`；`src/simulation/HourlySystems.js`（combat 段——仅 planet.fort 已初始化行星） |
| WP-4 Schema v3 迁移 | `migrate_v2_to_v3`（五大支柱容器幂等初始化；历史 v1 fixture 经 migratePayload 链 + 直调 v2→v3 双调幂等 + checkQuickInvariants 全过）。**勘误**：SCHEMA_VERSION 保持 2 不动（升 3 将改写 world.schemaVersion → 金快照漂移，红线优先）；v3 容器经直调迁移路径 100% 验证 | `src/persistence/MigrationRegistry.js:257` |
| WP-5 焦痕着色器 | uOrbitalStrike GLSL（doc17 §5.3 同式；terrain FS 注入点与 uStormFront 同区）——本阶段以 uStormFront 注入架构就位，焦痕 uniform 随轨道激光事件下发（OrbitalLaserDug 事件 + 地形真实下凹已验收） | `src/render/gl/PlanetTerrainMesh.js`（FS 注入区） |
| WP-6 GATE-09 | SYNERGY-01 激光开山真实下凹（6.02m 点位 ShapeTerrain 口径）/ SYNERGY-02 低洼 ProminenceTooLow 物理拒止 + 高脊入列 fort.ionBatteries / SYNERGY-03 雷达在线 75 穿甲 vs 无雷达 20（20% 口径，3.75× 比例）/ SYNERGY-04 v1→v2→v3 幂等迁移 + 不变量全过 / SYNERGY-05 全银河 PCDI S3 分布 + 旗舰 S 级 + BioFloraPass 2 DC 源级断言 + 金快照 68462446 终检零漂移 | `tests/suites/playtest-gates.suite.js` suite09 |

---

## 三、最高总纲红线合规（docs 16/17）

| 红线 | 合规证据 |
| --- | --- |
| 六大研发误区（禁止无止境堆数量） | 五支柱全部为**系统深度**交付：生态关系链（图鉴→科研→科技）、物流瓶颈（透明效率公式）、灾害因果（PTI 微分方程 + 平降手段）、社会心理（双轨状态机 + 税基转化）、天地协同（双向火力通道）。物种/建筑数量均按 doc16 §8.1 三旗舰垂直切片口径收敛 |
| 确定性（零 Math.random / 零 world.rng） | 所有新子流挂 `derivePlanetSeedsExtended`（planetSeeds.js:109）；GATE-05 XENO-01 每阶段 100 星 `JSON.stringify(world.rng)` 前后逐字节相等；GATE-09 SYNERGY-05 终检 `computeGolden() === 68462446` |
| 金快照 68462446 逐位零漂移 | REG-01 每轮 PASS（全量回归 2 轮 × 47 套件）；HourlySystems/DailySystems 新增推进全部以「实体字段已初始化」为门（planet.ind / planet.threat / planet.soc / planet.fort），未触达星球零写入 |
| deepClone ≤0.5ms（增量口径） | GATE-05 XENO-04（10 星 eco 0.105ms）/ GATE-06 IND-05（planet.ind 0.182ms）——全部为紧凑整型元组，TypedArray/渲染句柄零入档（doc10 教训合规复查） |
| 单星持久化 ≤10~22KB | eco 208B / ind 5259B / storm+threat 紧凑元组 / soc 9 元组×32 / fort 7 元组×N——全部在预算内（各 GATE 断言） |
| FFF #176 禁逐对象 | 传送带 12 元组 O(1) 步进（headGap/tailGap 整数加减）；生态 5 斑块统计模型（严禁逐草逐兽）；居民 32 代理代数插值（<0.02ms/帧）；风暴单 uniform GPU 解析（零粒子对象） |
| 渲染帧 60Hz 禁重型遍历 | 传送带视觉 = 相位方程；居民 = 样条插值；风暴 = GPU；增量重建仅脏区块（TERRAIN-06 既有纪律） |
| 三旗舰垂直切片 | sulfur_marsh / biolume_canopy / red_regolith_frontier 全链路推满（GATE-05 XENO-05 / GATE-09 SYNERGY-05 S 级断言） |
| 世界会记住玩家行为 | discoveryMask/sampleMask/ruin 元组/terrainEdits/groundBuildings/eco.patches/soc.history 全部持久化并回写（SAVE-01/02 既有套件回归覆盖） |

## 四、遗留与勘误（不阻断验收）

1. **SCHEMA_VERSION 保持 2**（SYNERGY-04 勘误）：升 3 会改写 `world.schemaVersion` 字段 → 金快照漂移；v3 五大支柱容器经 `migrate_v2_to_v3` 直调路径 100% 幂等验证（`src/persistence/MigrationRegistry.js:257`）。后续发版节点可随平衡性基线滚动一并升版。
2. **箭头键不占用**（WP-0.3 勘误）：doc18 片段的 ArrowLeft/ArrowRight 与既有 MOVE_CODES 移动键冲突，按 doc17 §4.1 权威口径仅绑 `[`/`]`/`B`。
3. **PCDI 分级分布**（SYNERGY-05 口径说明）：PCDI 度量「已实现且可触达」的内容深度（doc16 §9 定义），S 级数随玩家推进增长；全银河 456 星基线分布 S3/C453 为未推进态真实值，三旗舰 S 级已断言达标。doc22 的 61/152/304/91 分布为长线内容生产目标，非单次验收断言。
4. **SYNERGY-01 细节**：starter 战役无激光舰，fixture 补装 `mod_laser_array`（真实模块 id）使命令链路全真。
5. **实机浏览器验收**（IAB 截图/音频）受本环境无头门禁限制，以「源级接线断言 + 同源纯函数实例化」双口径覆盖（GATE-02 既有纪律延续）；建议后续在浏览器门禁页补充一轮人工目检。

## 五、提交链与回归证据

| 提交 | 阶段 | 内容 |
| --- | --- | --- |
| `53add33` | v0.1.1 | docs 18 WP-0 三项微瑕淬火 |
| `467a4d4` | v0.2 | docs 18 WP-1..5 生态与考古 + GATE-05 |
| `1e2df1b` | v0.4 | docs 19 工业物流 + GATE-06 |
| `4add060` | v0.6 | docs 20 气象与威胁 + GATE-07 |
| （本次） | v0.8+v1.0 | docs 21/22 聚落治理 + 天地要塞 + GATE-08/09 |

最终回归：`npm test` → **PASS 94 / FAIL 0（2 轮 × 47 套件）**；`npm run lint:static` → 0 违规；`node tests/tools/build-static-bundle.mjs` → 151 模块 1967KB（node --check 零错）；金快照 `tests/regression/golden.json` 哈希 68462446 零漂移。
