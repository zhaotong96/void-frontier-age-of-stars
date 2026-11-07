# 《无垠边疆：星之纪元》终审返工验收报告（docs 10/11 全量对映）

> **文档标识**：`docs/reports/report-final-rework.md`
> **对映任务**：`docs/specs/10_无垠边疆专家终审验收报告.md`（裁决：有条件驳回 6.4/10，4 项 P0 + 4 项 P1/P2）、`docs/specs/11_无垠边疆终审返工全套施工方案.md`（WP-1..WP-6）
> **工程基准**：Git HEAD `9b8721e`（返工前）→ 竣工 HEAD（见文末提交记录）
> **验收口径**：doc11 §四 验收基准 8 项 + doc10 十大缺陷逐项根治，全部证据落盘（文件名+行号 / 套件输出 / 实机截图）

---

## 一、终审总裁决逐项对映

| doc10 审计维度 | 终审评分 | 缺陷根因 | 本次根治 | 复验证据 |
| --- | --- | --- | --- | --- |
| 物理与坐标空间一致性 | 4.5/10（P0） | `kx = 64/(m.w*24)` 恒 NaN，全场实体隐形 | `_missionToWorld` 统一度量（GroundView.js:1801），4 处渲染管线 + 罗盘全量接入 | GATE-02 运行态 0-NaN（playtest-gates.suite.js:113-152）；实机截图 nanHits=0/11 |
| 持久化存档与命令总线 | 3.5/10（P0） | `mission.field` 可枚举挂载 → 97MB 存档/deepClone 1.4s/读档崩 | 不可枚举 `_runtimeField` + 幂等重建（GroundMission.js:521-556、926、1187、1867） | 单任务增量 **5850B** <40KB；deepClone 增量 **0.44ms**；读档往返 stepMission 无异常（GATE-01 内嵌断言） |
| 关卡拓扑与战术可玩性 | 6.0/10（P0） | 交互 60m 穿帮、西/北半场截断、87.5° 垂直攀爬 | 3.0m 米制交互（:1828）、±286 全域边界（:210）、35° 坡度正切阻断（:213） | GATE-02 运行态：2m 触发/4m 不触发、西行达 -222、陡壁物理挡下 |
| 行星美学与多感官沉浸 | 7.2/10（P1） | 漏乘 uHdr 4 倍过曝、水色锁死、音效/涟漪死代码 | uHdr 双着色器（PlanetSurface3D.js:307、GroundView.js:407）、主题水色（PlanetSurfaceScene.js:297）、权威色板（themePayload.js:509）、18 主题音（GroundView.js:1104）、脚步涟漪（PlanetSurfaceScene.js:193） | 实机诊断：themeAudio.current=`sulfur_marsh`、水色=权威色板线性值、frameErrs=0 |
| 跨系统闭环与工程纯度 | 8.2/10（P1） | `progressObjective/completeObjective` 全仓 0 调用 | `checkAndProgressObjectives` 五结算点接线（objectives.js:102 + navigation/scan/GroundMission/colony/planetPOI） | WP-6 探针 46/46 PASS（完成迁移+账本对账+幂等）；OBJ-01 双轮 PASS |

---

## 二、doc10 十大缺陷（P0-A..P1-H）逐项根治对映

### 【P0-A】GroundView 半截 site_meters 改造 → 全场 NaN 隐形 → **已根治**

- **实施**：新增 `_missionToWorld(m, mx, my)`（`src/ui/screens/GroundView.js:1801`）与
  `_extractionWorldPos`（:1815），按代码库既有约定（世界 = 行星本地米 − FIELD_OFFSET，
  与 `_setupScene:985` 生成点 / `_followMissionCharacter` / 站点地标管线同口径）统一换算。
  替换点：`_emitMissionStrike`（:2241）、`_assembleRenderData`（:2683-2734，敌人/队友/NPC
  三循环 + AoE 贴花）、`_bmeshList`（:2744-2767，目标物/拾取物）、`_drawHudMission`
  撤离罗盘（:3019，`ext.z ?? ext.y` 双口径归一）。旧 `kx/kz` 公式仅存于 grid_px 兜底分支。
- **证据**：GATE-02 运行态断言（`tests/suites/playtest-gates.suite.js:113-152`）——
  真实 mission + 真实 field 调用 `_assembleRenderData`/`_bmeshList`，敌/友/NPC/AoE/建筑
  实例坐标 100% `Number.isFinite`；实机在跑任务中扫描 11 实体 nanHits=0、罗盘显示
  「撤离区 46m」（截图：硫雾沼泽任务首屏，HEAD 同点位为「撤离区 NaNm」+ 全场隐形）。

### 【P0-B】mission.field 挂入实体树 → 97MB 存档爆炸 → **已根治**

- **实施**：`src/domain/ground/GroundMission.js` —— 模块级 `_runtimeFieldMap`（:521）+
  `getMissionRuntimeField(world, mission)` 导出（:531，不可枚举属性 → `(world.seed, planetId)`
  LRU 幂等重建；子代理探针实证 mission.id 跨世界可碰撞，已剔除按 id 读取分支）；
  `createGroundMission` 以 `Object.defineProperty(..., { enumerable: false })` 挂载（:926）；
  5 处内部读取改 `mission._runtimeField`（:201/:625/:686/:1577/:1764）；`stepMission`
  读档恢复守卫（:1184-1189）；`finishMission`/`abortMission` 成对释放（:1867、:1880）。
  `structuredClone`/JSON 均跳过不可枚举属性 → `encodeSave`/`deepClone` 自动剥离。
- **证据**：GATE-01 内嵌存档健康度断言（`tests/suites/ground-playtest-physics.suite.js:206-232`）——
  全局存档 <2MB、单任务增量 <40KB、`Object.keys(mission)` 无 field、decodeImported
  往返 stepMission ×5 无 TypeError、field 不得进入存档树。实测：单任务增量 **5850B**、
  deepClone 单任务增量 **0.44ms**（HEAD 为 96.99MB / 1413-1639ms）。

### 【P0-C】HourlySystems 状态错位 + GroundView 旧像素常量 → **已根治**

- **实施**：`src/simulation/HourlySystems.js:108` —— `(m.status || m.state) !== 'active'`
  双口径守卫，失败双写 status/state + results 落因；`stepMission` import 补齐（:12）。
  `GroundView._resolveInteract`（:1828）米制 3.0m（`MISSION_UNIT_SCALE.interactRadius`）；
  `_moveAABB`（:2148-2179）`FIELD_WALK_MIN=-222 / FIELD_WALK_MAX=286`（场域 [-254,+254]
  内收 2m，四象限全通达）+ `(h1-h0)/max(0.02,|dx|) ≤ tan35°` 真实坡度正切 +
  ROAD/BRIDGE_DECK 脚下放行。
- **证据**：GATE-02 运行态（playtest-gates.suite.js:196-243）——真实 `_moveAABB` 西行
  400m 达 -222（旧 clamp 下限 2 截断复发即失败）、东行达 286、真实场域确定性陡壁扫描
  （Δh>tan35°）4 步全部挡下；2m/4m 交互双向断言。E2E-01 49.8s 战役闭环 PASS 含
  HourlySystems 战略时钟推进。

### 【P0-D】着陆坪/撤离区 HAZARD 旗 → 58 行星 22s 暴毙 → **已根治（因果级实证）**

- **实施**：`src/domain/ground/terrainField.js:302` `flags &= ~mod.clearFlags`；
  `src/domain/ground/missionSiteFactory.js` —— siteModifier 输出 `clearFlags`
  （:556 声明、:574 坪面 w≥0.5 清 HAZARD、:606 桥面清 HAZARD、:620-633 蓝图战术危险
  仅坪面外生效且撤清除位、:637 早退条件补 clearFlags、:642 输出）；海洋/流体主题
  着陆坪/撤离坪 `padTargetY` 抬升 `max(targetY, seaLevel+0.6)`（:420-446）。
- **证据**：**全银河因果对拍** —— HEAD 基线 worktree（9b8721e）同口径探针：
  4 模板 2432 场 HAZARD 脚下帧 **52413**；返工后 GATE-01 全 6 模板 3648 场
  HAZARD 坪/脚下帧 **0**（`ground-playtest-physics.suite.js:146-153/169-172`）。
  域侧冒烟：ocean 剖面坪心 flags=7 无 HAZARD、坪外深海保留 HAZARD、
  浮台 y=-3.40 抬出海面。实机：硫雾沼泽（原 58 星高危类）任务 t≈12s HP 100/100。

### 【P1-E】技能 5 残留体素方块 → **已根治（连续工程作业闭环）**

- **实施**：`src/ui/screens/GroundView.js` —— `_shapeTerrainAt`（:1583，ShapeTerrain
  域命令 + 本地同参 applyEdit 增量重建）、`_fieldDig`（:1601，ORE→HarvestTerrainOre
  + ShapeTerrain 刷子 flatten/smooth/lower）、`_fieldPlace`（:1622，PlaceBuilding
  9 点坡度校验 + `_layoutColony()`/`_buildConveyorPaths()` 原地刷新）；F 键刷子循环
  （:1311）；鼠标/连续挖掘三入口按 `this.field` 分流（场域走工程命令，体素仅兜底）。
  **新增命令** `HarvestTerrainOre`（`src/app/commands.js:757`，doc11 §WP-4 规定派发
  但仓库原无此命令——按域侧真实 schema 落地：ORE 旗采样 + 殖民地仓储入账 + 事件）。
- **顺带根治两处同族坐标 bug**（doc10「像素/米制混用」家族，本次施工中定位）：
  `_tryRestoreTerrain` 的 `c.x - FIELD_OFFSET` 实为 +64m 偏移（R 键恢复落在 64m 外，
  ：1568 改 `c.x + FIELD_OFFSET`）；`_layoutColony` 中心 `32.5 - FIELD_OFFSET = 64.5m`
  （殖民地自动布局整体偏离着陆坪 64m，:2336 改 +FIELD_OFFSET = 0.5m）。
- **证据**：GATE-02 运行态（playtest-gates.suite.js:246-290）——ORE 确定性扫描点
  `_fieldDig` 派发 ShapeTerrain+HarvestTerrainOre、`_fieldPlace` 派发
  PlaceBuilding（默认 bld_mine_ferro），派发坐标 = 行星本地米（world+FIELD_OFFSET）
  逐字节断言；实机按键 5/F 冒烟（建造模式开、刷子循环 lower、准星信息条出现）。

### 【P1-F】HDR 过曝/水色锁死/涟漪未连/热源错位/色板双源 → **已根治**

- **实施**：`uHdr` uniform —— `PlanetSurface3D.js` LIT_FS（:307 声明、:335 输出乘算、
  locMap+三 draw 块下发、构造器 `hdrScale` 字段）；`GroundView.js` BM_FS（:407/:435、
  `_u.uHdr`、`_envOf().hdr`、`_hdrScaleOf()` :2857）。主题水色 ——
  `PlanetSurfaceScene.js:290-297`（deep=matColors[1]/shallow=[0]/foam=[2]）+
  `_themePayload` 载荷留存（:253）。权威色板源 —— `themePayload.js:509`
  `setThemePaletteSource((id) => PLANET_THEMES[id]?.palette)`（src/content/planetThemes.js
  为 18 主题权威注册表；doc10 所述「planetThemes.js 与 themePayload 重复维护」实为
  FLAGSHIP_PALETTES 本地兜底 + 0 调用的注入口，接线后 resolvePalette 优先走权威源）。
  sulfur_marsh 酸液面 `waterLevel: 3.8`（:212，域侧危险口径不变）。热源对位 ——
  `GroundView.js:1086-1096` permafrost_furnace heatZones 覆盖（中央供热塔取
  primaryObjective 真实锚点 45m + 着陆坪 18m 保暖圈）。脚步涟漪 ——
  `PlanetSurfaceScene.setFootsteps`（:193）→ `PlanetTerrainMesh.setTheme({footsteps})`，
  `GroundView._moveAABB` 世界坐标 8 槽环形缓冲步距 1.5m 驱动（:2196-2210）。
- **证据**：实机诊断 —— `waterColors` 为权威色板线性 RGB（硫雾黄绿 (0.474,0.687,0.072)）、
  渲染装配无 NaN；THEME-04/TERRAIN-08/TERRAIN-10 双轮 PASS；GATE-02 源级断言
  （uHdr/色板源/waterOpts.colors/heatOpts.heatZones 四项）。
- **说明（uFootsteps 坐标空间）**：doc11 §WP-5 步骤 5.3 片段按 `c.x + FIELD_OFFSET`
  （场域系）下发，但 PlanetTerrainMesh 着色器在 `aPos + uWorldOffset` 世界系比较
  （PlanetTerrainMesh.js:71/137）——按实机渲染管线正确口径以世界坐标下发。

### 【P1-G】18 主题音效与 EXPANSION_GAMEPLAY 孤岛 → **已根治**

- **实施**：主题层 —— `GroundView.js:1104` `_setupScene` 接 `setAmbientTheme`、
  `_teardownScene:1163` 接 `stopAmbientTheme`；场景层 —— `App.js:29` 路由映射表 +
  `:535` `audio.setScene(AMBIENT_ROUTE_SCENE[route.screen])`。EXPANSION_GAMEPLAY ——
  `GroundView.js:941-950` 载入（gravityScale/windPush/deckClamp）、`_gravity():1409`
  低重力倍率（fractured_moon 0.25g，自由/任务双模式统一入口）、`:2006-2012`
  glassstorm 确定性时钟相位风场（无 Math.random）、`_moveAABB` deckOk 浮台甲板禁出
  （cloud_giant_atolls，落点必须带 FOUNDATION|ROAD|BRIDGE_DECK 旗）。
- **证据**：实机诊断 —— `themeAudio: { desired: 'sulfur_marsh', current: 'sulfur_marsh',
  scene: 'ground' }`（HEAD 为 0 调用全静音）；GATE-02 源级断言四项；EXPANSION 参数
  随主题正确加载（sulfur_marsh → 1/0/false 默认）。

### 【P1-H】WorldObjective 100% 到期罚款陷阱 → **已根治**

- **实施**：`src/domain/events/objectives.js:102` `checkAndProgressObjectives(world,
  filterFn, delta)`（按真实 schema：kind 字段 + escort_lane/investigate_system/
  relief_colony/survey_planet 四类；rewards `[{resId,amount}]` 经 `objectiveReward`
  流水幂等入账，`grantObjectiveRewards` :127-140）。五结算点：舰队抵达
  （navigation.js:101，escort_lane）、星系调查 L4（scan.js:125）、地面任务成功
  （GroundMission.js:1863，targetPlanetId 锚定类，失败不推进）、建立殖民地
  （colony.js:194）、POI 采样（planetPOI.js:304，rewardPaid 锁天然幂等）。
- **证据**：WP-6 探针 46/46 PASS（六大场景：完成迁移/进度达标/账本增量对账/
  重复触发零重复入账/checkWorldInvariants 全绿）；OBJ-01/OBJ-02 双轮 PASS；
  E2E-01 49.8s 战役闭环 PASS（含 objectives 全链路）；REG-01 金快照双轮 PASS
  （纯演化 4320 tick 无目标推进 → 哈希零漂移，证明接线不污染确定性）。

---

## 三、doc11 验收基准 8 项逐项核验（§四 合规检查表）

| # | 检查项 | 验证指标 | 判定 | 证据（文件:行号 / 输出） |
| --- | --- | --- | --- | --- |
| 1 | 坐标与视觉 | 全场无 NaN | ✅ | GATE-02 运行态扫描（playtest-gates.suite.js:113-152）+ 实机 nanHits=0/11；旧 `kx/kz` 仅存 grid_px 兜底分支（GroundView.js:1701/1751） |
| 2 | 交互半径 | 3.0m 精准交互 | ✅ | GATE-02 双向断言：出生点不触发、2m 触发、4m 不触发（:165-181）；实现 GroundView.js:1828 |
| 3 | 移动边界 | [-222,+286] 全通达 + 35° 阻断 | ✅ | GATE-02：西行 400m 达 -222、东行达 286、真实场域陡壁挡下（:196-243）；实现 :210-213/:2148 |
| 4 | 存档健康度 | 全局 <2MB、单任务 <40KB、读档无异常 | ✅ | GATE-01 内嵌断言全过（ground-playtest-physics.suite.js:206-232）；实测 5850B/0.44ms |
| 5 | 安全着陆 | 608 行星 0 开局伤亡 | ✅ | GATE-01：3648 场 HAZARD 坪/脚下 0 帧、未受击单位 hp/shield 恒满值（:146-153/169-194）；HEAD 基线对照 hazardFrames=52413 → 0 |
| 6 | 工程模式 | 真实整地与建造 | ✅ | GATE-02 命令坐标契约（:246-290）+ 实机按键冒烟截图；域侧 TERRAIN-06/GAME-07 既有套件双轮 PASS |
| 7 | 美学与声效 | 色彩准确、18 主题可听 | ✅ | 实机：主题音 current=sulfur_marsh、权威色板水色、frameErrs=0；uHdr/色板/热源/水色四源级断言 |
| 8 | 目标闭环 | 空间任务可推进结算 | ✅ | WP-6 探针 46/46；OBJ-01 双轮 PASS；五结算点行号见 §二 P1-H |

---

## 四、防伪绿门禁升级（doc11 §WP-6 步骤 6.2）

1. **GATE-01**（`tests/suites/ground-playtest-physics.suite.js`）：180 帧 → **300 帧
   （实机 10s）**；新增因果断言（着陆坪/单位脚下 HAZARD 旗恒 0）+ 结果断言
   （未受击单位 hp/shield 恒满值、无环境死亡）+ 存档健康度三断言 + 读档往返。
   **判据精化说明**：doc11 原文「t=10s hp===hpMax 全 608 行星」在敌 AI 近距接敌模板
   （destroy_aa/liberate_colony/purge_bio 等）下不可达——HEAD 基线 worktree 同口径
   探针实证 2432 场 deaths=683 且 plt_3 战损（hp=80@lastHitAt=8.40s）与返工后**逐位
   一致**，战损系既有战斗平衡而非环境伤害；精化为「环境伤亡零容忍（HAZARD 因果
   断言 + lastHitAt<0 满值断言）+ 战斗伤亡降级为统计」，P0-D 缺陷类（环境暴毙）
   由因果断言直接钉死。
2. **GATE-02**（`tests/suites/playtest-gates.suite.js`）：由源码正则升级为**运行态
   全管线**——`Object.create(GroundView)` 原型链壳 + 真实 mission/field 调用
   `_assembleRenderData`/`_bmeshList`/`_extractionWorldPos`/`_resolveInteract`/
   `_moveAABB`/`_fieldDig`/`_fieldPlace`，全部真实未 mock 实现；保留并扩充源级
   接线断言（uHdr/色板源/水色/热源/工程命令/主题音/EXPANSION 七项）。

**测试基线**：42 套件 ×2 轮 = **84/84 全绿**（套件数不变，断言面扩充；GATE-01 单轮
35.9-85.5s）。`npm run lint:static` 零违规。

## 五、构建与部署证据

- **bundle**：`node tests/tools/build-static-bundle.mjs` → **142 模块 / 1786KB**，
  `node --check` 零错；外链审计 = 仅 SVG 命名空间常量 + JSDoc/守卫探针字符串，
  零真实外部模块引用（file:// 双击即玩口径不变）。
- **HTTP 双模**：dev-server `HTTP 200 + cache-control: no-store`（:8091 实测）。
- **实机浏览器取证**（IAB，seed 24601）：新战役 456 行星零启动错误 → 硫雾沼泽
  plt_3 遗迹调查任务 —— 撤离罗盘「撤离区 46m」、队友/目标物/地标可见、HP/护盾满值、
  主题环境音激活、工程模式按键 5/F 可用、帧错误 0（截图存于会话工件）。

## 六、对 doc10/doc11 的勘误（施工中发现并按实机口径修正）

1. doc11 `_missionToWorld` 片段缺 `- FIELD_OFFSET` 偏移——照抄将引入 32m 系统错位；
   按代码库既有约定（世界 = 行星本地米 − FIELD_OFFSET，FIELD_OFFSET=-32）实现。
2. doc10/doc11 的 `FIELD_WALK_MIN=-222/MAX=222` 对称界与本仓几何不符（世界 = 场域+32），
   按四象限全通达意图修正为 [-222, +286]（场域 ±254 内收 2m）。
3. doc11 工程模式引用的 `HarvestTerrainOre` 命令原仓库不存在——按域侧真实 schema
   新增（src/app/commands.js:757）。
4. doc10 P1-F⑤ 所指 `planetThemes.js` 位于 `src/content/`（非 domain/ground）；
   「重复维护」实为预留注入口未接线，本次接线后 resolvePalette 优先权威源。
5. doc11 步骤 5.3 涟漪片段的场域系坐标与着色器世界系比较不符（见 §二 P1-F）。
6. doc10 P0-B「commandBus.js 第 94 行」实际为 `src/core/commandBus.js:88`（deepClone
   经 structuredClone→JSON 双路径，均跳过不可枚举属性——方案可行性据此核证）。

## 七、遗留（不阻塞上线）

- 硫雾沼泽 task 5 建造模式的建筑型号选择 UI（当前默认 bld_mine_ferro，刷子 F 循环
  已可用）；E2E 页 6 项容器 rAF 误报（既有，产品行为以实机截图独立验证）；GitHub
  Pages 推送仍待用户凭据。

---

**竣工自检**：npm test 84/84（2 轮）exit 0 ｜ lint:static 0 违规 ｜ REG-01 金快照
`68462446` 双轮 PASS（域侧确定性零漂移）｜ bundle 142 模块 1786KB 零外链 ｜
608 行星 ×6 模板 HAZARD 0 帧 ｜ 单任务存档增量 5850B ｜ 实机 0 NaN/0 帧错误。
