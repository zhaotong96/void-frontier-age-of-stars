# 总施工计划（docs 4+5+6+7 合成，doc 6 为最高裁决）

基线：main @ 2d471a5，52/52 PASS（2026-11-05 复跑确认），金快照 5ac0ed56。
裁决规则：审美/玩法冲突以 doc 6 为准；doc 7 的 voxelPos/体素交互一律升级为连续三角网格坐标；
doc 5 的 P0 修复、WorldObjective、UIStateStore、RouteStack、jobsFilled 全部有效。

## 已验证的基线缺陷（主代理亲自复核）
1. PlanetSurface3D 只清 DEPTH（:906），PostProcessor.beginScene 不清屏 → 背景残影（doc6 §3.2）。
2. GLCore.createFloatTarget 无深度附件 → 深度测试无效 → 地形"消失/翻转"（doc7 §2.1）。
3. System3D.js:274/:311 GLOW_VERT `gl_Position = uMVP * w` 双重 uModel → 辉光 2× 轨道半径（doc4 P0-02）。
4. SystemView 250ms 节流全量 clearEl 重建 dossier → 折叠/滚动丢失（doc4 P0-04）。
5. SystemView `app.goto('ground')` 不带参；`_groundTargetPlanet` 无消费者；简报页 colony-only、无返回按钮、Escape 屏蔽 → 软锁（doc4 P0-05）。
6. evt_pirate_raid 等事件无空间目标（doc4 P1-01）。
7. README 22 套件计数漂移（实际 26）。
8. 管理视图无左侧安全区（.vf-view-body 从 0 排布）。

## 波次计划（串行波次，波内 2 子代理并行，文件所有权互斥）

### Wave A = doc7 Phase 0（TASK-0.1..0.4 / doc5 P0-01..07）
- A1（渲染核）：TASK-0.1 + 0.2。GLCore.createFloatTarget depth24；PostProcessor.beginScene 8 步清屏契约；
  PlanetSurface3D 每 pass 状态隔离 + 主题 clearColor 双保险 + SKY_FS 防 NaN；F3 三档诊断（unlit_nocull /
  wireframe_normal / winding_audit）+ GL 状态 JSON 导出；DiagnosticsView 入口。
  门禁：TERRAIN-02/03/07/08、GL-01（渲染侧）。
- A2（交互/UI）：TASK-0.3 + 0.4。GLOW_VERT 修复 + 晨昏线散射升级 + SystemView dblclick 聚焦/右键径向菜单/
  回波标签；UIStateStore 新建；panels.js 稳定 ID；styles.css 双模退避；App RouteStack + goBack +
  closeInspector；GroundView 简报 planetId 参数/返回按钮/Escape/survey 准入。
  门禁：GL-01、UI-01..07、NAV-01..04。
- 主代理：套件注册（新 suite 文件唯一所有者）、门禁复验、提交。

### Wave B = doc7 Phase 1 三角网格垂直切片（TASK-1.1..1.4）
- B1（领域）：planetSeeds.js 子流树；terrainProfiles.js；terrainField.js（buildTriangulatedChunkMesh
  曲率自适应对角线 + CCW + 面积加权法线 + 陡坡材质）；surfaceQueries.js（sampleTerrain/raycastTerrain/
  坡度代价 A*）。先写 TERRAIN-01..03 失败测试再实现。
- B2（渲染）：PlanetTerrainMesh.js（LOD0/1/2 + skirt + geomorph + 三平面 4 材质 GLSL）；
  PlanetAtmosphere.js；PlanetSurfaceScene.js 编排。
- 主代理收尾：GroundView 接线 + GroundMission SiteTransform 桥（TASK-1.4，GroundView 唯一所有者），
  GROUND-01..03 回归。

### Wave C = doc7 Phase 2（TASK-2.1..2.3 / doc5 P1-01..05）
- C1：missionSites.js 蓝图 ×8 + missionSiteFactory.js（SDF 整平、Catmull-Rom 样条、6 项质量自检、
  双路线、首屏构图）。门禁 SITE-01..04/06/08。
- C2：planetPOI.js（持久化 POI + rewardPaid 幂等）+ objectives.js（WorldObjective）+ galaxyGen POI 生成 +
  HarvestPlanetPOI 命令 + GalaxyRenderer 离屏箭头/Pin + EventsView 接线。
  门禁 SITE-05/07、GAME-01..04、EVT-01..02、SAVE-03、WORLD-03、E2E-02。

### Wave D = doc7 Phase 3（TASK-3.1..3.4）主题系统 + 7 旗舰主题
- D1：planetThemes.js 九维注册表（18 主题全部数据定义）+ galaxyGen 天体物理约束抽选/同星系去重 +
  System3D 轨道主题着色（THEME-01/07）。
- D2：terrainField 地貌 profile ×7 旗舰 + PlanetTerrainMesh/Atmosphere/Water 主题机制
  （热区融雪、水下 5 层光学、毒气湖、压感涟漪、岩浆河+拱桥）（THEME-02..05、GAME-05）。
- 文件互斥：D1 不碰 PlanetTerrainMesh；D2 不碰 galaxyGen/System3D。

### Wave E = doc7 Phase 4（TASK-4.1..4.3）11 扩展主题 + 卫星/小行星带
- E1：prism/salt_mirror/cryomethane/tidal_lock + cloud_giant/fungal/ancient/glassstorm 内容与 profile。
- E2：magnetar/canopy/fractured + secondaryThemeModifiers + moons/belts（RNG.fork 子流）+
  System3D 卫星/回波 + 18 主题 Web Audio。门禁 THEME-06、WORLD-02。

### Wave F = doc7 Phase 5（TASK-5.1..5.4 / doc5 P2-01..03）
- F1：terrainEdits.js（整形/恢复/植被移植 + 增量 chunk 重建）+ 建筑坡度地基/桩基 + 样条传送带 +
  colony jobsFilled/runtimeStatus 看板 + TD1-TD4。门禁 TERRAIN-06、GAME-06..08、COL-01..04、ECON-02。
- F2：MigrationRegistry v1→v2 迁移 + planetary-terrain-theme 套件（100 seed + 100 挂载压测）+
  bundle 重建 + README/RUNBOOK 校准 + file:// 与二级路径验收。门禁 SAVE-03..04、DEPLOY-01..02、TERRAIN-01..09 总复验。

## 横切纪律
- 新 suite 文件注册：只有主代理改 tests/suites/index.js。
- 金快照：世界生成新增字段会漂移 → 波次门禁后 npm run golden:update + CHANGELOG 记录（doc5 命令 3 授权）。
- 打包：每波次结束 node tests/tools/build-static-bundle.mjs（doc5 §4 总则）。
- 浏览器 E2E：扩展 tests/tools/gl-gate-test.html 或新建 e2e-gate-test.html 跑 18 项 UI/NAV/EVT/GL 断言，
  browser-use 实机执行留证据截图 docs/screenshots/。
- 提交：按 doc7 各 TASK 提交代号逐任务提交到 main。
- 禁止：Math.random、外部依赖、renderer 直改 world、把 GL 句柄写存档、先删旧模块。
