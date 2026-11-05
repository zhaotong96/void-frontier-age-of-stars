# 行星 GamePlay 闭环返工竣工报告（docs 8/9 整改）

**日期**：2026-11-06 ｜ **分支**：main ｜ **整改基线**：`f634828`（被驳回交付）
**竣工提交**：`a956336`（审计入库）→ `0d38fb9`（返工主体）→ 本报告
**最终门禁**：**42 套件 84/84 全绿（2 轮）** + **PLAYTEST-GATE-01..04 全部 PASS** + lint 零违规 + bundle 142 模块 1765KB 零外链。

---

## 1. VERIFY-01..10 整改对映（doc9 §二 全部证实项）

| 编号 | 病灶 | 整改 | 验证 |
|---|---|---|---|
| VERIFY-01 | Y 轴脱节 + 重力逃逸 + 橡皮筋 | `stepCharacterVertical` 纯函数（接触冲量 vy<0 无条件清零 / deficit>1.5 硬吸附 / 终端 −28 / y<−45 就地挽救）；任务首帧 coordSpace 感知地表对齐 | **GATE-01**：608 行星 × 6 模板 = 3,648 场 × 180 帧零穿地 0.00%、\|vy\|≤28；实机任务 4.5s + 移动 soak y===ground |
| VERIFY-02 | 2D 砖块迷宫维度撕裂 | GroundMission `coordSpace='site_meters'`：蓝图锚点部署全部单位/目标/撤离/敌军巡逻；moveSite 坡度 ≤35° 或 ROAD\|BRIDGE_DECK；lineOfSightSite 3D 射线 + 掩体 cover | GROUND-01..03 重写后全绿（确定性/账本/幂等）；GATE-02 路由断言 |
| VERIFY-03 | 地标孤岛死代码 | salt_crystal_spire 拼写修正 + 别名；7 旗舰地标入 bmesh 图集槽位 11-17；_bmeshList 按真实高程渲染 | GATE-02 断言 ≥1 旗舰 prefab 命中（实例 4 座） |
| VERIFY-04 | PlanetWater 孤岛 | PlanetSurfaceScene 构造/生命周期/draw 全挂载；tideWaterLevel 实时水位下发 uThemeFx[0] | GATE-02 源级 + 实例断言 |
| VERIFY-05 | _pois/_edits 初始化遗漏 | _setupScene 补齐 ensurePlanetPois/deserializeEdits/attachTerrainEdits/rebuildDirtyChunks（含 teardown 清理） | GATE-02 源级断言 + 实机 E 键/R 键复活 |
| VERIFY-06 | 黄金角盲盒布局 | planColonyLayout（22-75m 环带黄金角候选 × checkBuildingPlacement 16°/2.2m × ORE 吸附 × 0.35max/0.65avg 基准高程 × 等高线切线朝向）+ groundBuildings 双轨 | **GATE-04**：rocky/lava/ocean 三主题 17 位全过 |
| VERIFY-07 | 命令字段错位/抛错 | m.state → status 兼容判定 ×3；abortMission 替换 finishMission('aborted')；HourlySystems 同族过滤修复 | E2E 命令链 begin→input→abort 无异常 |
| VERIFY-08 | 相机 1.4m 压溃 | computeSpringArm 三层防护（托底/0.35m 外推/hit.t>0.08/臂长 ≥2.1m/眼位 ≥0.65m/阻尼 18-5.5） | **GATE-03**：2 崎岖行星 500 采样最差净空 0.65m、最小臂长 9.0m |
| VERIFY-09 | 积木拼贴违和 | chamferBox 45° 倒角 + 底部 AO ×0.72 + 1.8m 基座裙边；BM_FS/LIT_FS 统一微面板接缝 + Blinn-Phong 36/0.42 + 菲涅尔 0.18（doc8 §4.2 蓝本逐行） | 源级断言（BM_FS≡LIT_FS 蓝本 token） |
| VERIFY-10 | 流体/光谱缺位 | 四级流体规则（涉水 0.65 阻尼+水花/潜水 0.22g 终端 −2.2/推进器/>8m 护盾 3.5/s + HUD 压力 + 潮汐相位）；水下雾 [6,68]；硫雾/熔岩晕影扣盾；恒星光谱 45:55 融合；POI 采样蜕变基座残骸 + 0.8s 粒子 | 套件源级 + R-B 无头物理探针（潜水终端/推进器/阻尼 0.650/45:55 融合） |

## 2. PLAYTEST-GATE-01..04（doc9 §四 阻断门禁）

| 门禁 | 判据 | 结果 |
|---|---|---|
| GATE-01 全银河零穿地仿真 | 3,648 场 × 180 帧：c.y ≥ ground−0.05 且 \|vy\| ≤ 28，穿地率 0.00% | **PASS ×2 轮**（608 行星 large 星系全量；round-1 77.7s / round-2 63.2s） |
| GATE-02 拓扑与实装接线 | site_meters + 无 2D 墙 + _pois/_edits 初始化 + 地标入批 + _water 潮汐 | **PASS ×2** |
| GATE-03 相机 360° 零压溃 | 崎岖行星崖缘 yaw×pitch 全扫：眼位净空 ≥0.65m、臂长绝不锁死 1.4m | **PASS ×2**（500 采样最差净空 0.65m、最小臂长 9.0m） |
| GATE-04 建筑坡度贴合与裙边 | 三主题布局全部过 9 点校验、裙边闭合、零深埋 | **PASS ×2**（17/17 建筑位） |

## 3. 实机动态复测（浏览器）

- 任务模式（site_abyssal_dome_01，coordSpace=site_meters）：启动后 4.5s 角色 y === ground（−11.81）、vy=0、above=true；
- 移动 soak 后仍 y === ground——原「数秒坠渊」场景不复现；
- 证据探针：`window.__vfSurfaceDebug.view.{char3d, _groundAt, mission.coordSpace, mission.siteId}`。

## 4. 工程纪律对映（doc9 §五）

- 代码基线统一：bundle 142 模块 1765KB 与源码同步重建（node --check 零错）；lint:static 零违规；
- 文档与注释：既有公式注释/类型契约全量保留（stepCharacterVertical/computeSpringArm/planColonyLayout 均带 doc 条款引用）；
- 测试总量：38 → **42 套件 84/84**（新增 PLAYTEST-01..04）；金快照 68462446 不受影响（REG-01 两轮 PASS）；
- 提交链：`a956336`（审计入库）→ `0d38fb9`（返工主体）→ 本报告提交。

## 5. 遗留与如实注记

1. GATE-01 场域按 lod0Step=4 构建（物理采样口径；全分辨率渲染密度由 TERRAIN-01/10 覆盖）；
2. 碧渊海洋 landing pad 在海平面以下的 HAZARD 标记为地形层既有语义（下水即扣血符合主题危险设计，但着陆坪即时扣盾需后续调平）；
3. 无 3D 资产的辅助地标（radar_beacon_station 等）按 R-B 策略跳过渲染（不伪造占位）；
4. doc4 的 P2 工业长线项（蓝图批量建设/跨星系物流自动化）与 doc4 P3 内容扩张不在本轮范围（doc9 仅指定 10 项 VERIFY + 4 门禁）。

**竣工结论**：doc9 十项 VERIFY 全部整改、四项阻断门禁两轮全绿、实机坠落场景复测通过；
提请项目负责人按 doc9 §四 流程执行最终实机动态复测。
