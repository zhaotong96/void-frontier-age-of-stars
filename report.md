返工指令已读完。先对 10 项 VERIFY 逐一对当前 HEAD 做真伪核验（防伪绿审计的反面：先确认诊断属实）：

核验完成：**10 项 VERIFY 全部属实**（含 V-05——我此前 Wave F 的 `_pois/_edits` 初始化在提交链中丢失，审计正确）。先看 static-audit.mjs 改动与审计文档入库，随即双槽启动返工：

双槽返工已启动。并行推进：补读 doc8 仲裁章节（A1-A3/B1-B3 裁决约束 P1-3/P2 细节）+ 检查 bundle 新旧版本混杂指控：

R-B 交付（76/76 含 R-A 的 GROUND 改造——R-A 也已落盘）。确认 R-A 状态并启动 GATE 套件构建：

R-A/R-B 均已落盘且 76/76 全绿。现在主代理执行 P1-2（等高线布局）+ 抽取纯函数供 GATE-03/04 无头测试：

实现 P1-2 布局规划器（domain 侧，GATE-04 可无头测试）+ 抽取弹簧臂纯函数（GATE-03）：

R-A 交付完整。修复 planColonyLayout 对 chk 字段的错误依赖（chk 不含 maxY/avgY/flags——改为自己采样）+ HourlySystems 同族 V-07 修复：

GroundView 布局重构 + Catmull-Rom 传送带：

抽取竖直物理纯函数（GATE-01 无头口径）。读 R-B 版 `_followMissionCharacter`：

抽取 `stepCharacterVertical` 纯函数（GATE-01 物理口径）：

现在我来编写这 4 个 GATE 套件。首先检查 R-A 的 `getMissionField` API + R-B 的场景水位访问器：

编写 GATE-01..04 四套件：

GATE-01 通过（**3648 场 180 帧零穿地 0.00%**）。修 PLAYTEST-03/04：

GATE-02/03 通过。lava 零落位 → 候选序列扩容（熔岩地貌平坦台地稀疏，需更大确定性搜索量）：

GATE-04 的 center 传错（场域中心是 (0,0) 非 (256,256)）。修正：

4 项 GATE 全部单独通过。全量门禁 + 提交：

**84/84 全绿（42 套件，PLAYTEST-GATE-01..04 两轮全过）。** 实机验证坠落修复 + bundle + 提交：

实机复测通过：任务模式 site_meters + 站点蓝图，角色 y === ground（-11.81）、vy=0，4.5 秒零穿地。移动压力 soak + 截图：

物理修复实机确认（移动后仍 y===ground，above=true）。重建 bundle + 提交全部返工成果：

**返工竣工。** docs 8/9 全部整改项完成，HEAD `7479182`，工作树干净。

## 整改总览

| 审计裁决项 | 结果 |
|---|---|
| doc9 十项 VERIFY（含 P0 阻断 5 项） | 全量整改（`0d38fb9`） |
| **PLAYTEST-GATE-01**：608 行星 × 6 模板 = 3,648 场 × 180 帧 | **零穿地 0.00%、\|vy\|≤28**（×2 轮，77.7s/63.2s） |
| **PLAYTEST-GATE-02**：site_meters/_pois/_edits/地标/水体接线 | **PASS ×2** |
| **PLAYTEST-GATE-03**：崎岖行星相机 360° 零压溃 | 500 采样，最差净空 0.65m、最小臂长 9.0m（**PASS ×2**） |
| **PLAYTEST-GATE-04**：三主题建筑 9 点坡度 + 基座裙边 | 17/17 建筑位全过（**PASS ×2**） |
| 全量回归 | **42 套件 84/84 全绿（2 轮）**，lint 零违规，金快照 REG-01 PASS，bundle 142 模块 1765KB |

## 关键修复

- **P0-1 坠渊根治**：竖直物理抽为 `stepCharacterVertical` 纯函数——接触冲量 vy<0 无条件清零（切断重力逃逸闭环）、deficit>1.5 硬吸附、y<−45 就地挽救（杜绝橡皮筋）；任务首帧 coordSpace 感知地表对齐
- **P0-2 维度合龙**：GroundMission 废除 2D BSP 迷宫 → `coordSpace='site_meters'` 米制 3D（蓝图锚点部署全部单位/目标/撤离/敌军巡逻；moveSite 坡度/ROAD/BRIDGE_DECK 通行；lineOfSightSite 3D 射线 + 掩体减伤；米制刻度 5.2m/s/2.2m/22m/3.0m）
- **P0-3 孤岛激活**：`_pois/_edits` 初始化补齐（V-05 属实——我方自查失守，多轮补丁丢失初始化，教训已记记忆）、PlanetWater 潮汐挂载、7 旗舰地标入渲染图集 + 拼写修正
- **V-07**：命令字段 status 兼容 + abortMission 替换 + HourlySystems 同族修复
- **P1/P2**：相机三层防压溃（computeSpringArm）、等高线感知布局（planColonyLayout）、chamferBox 倒角 + AO + 1.8m 裙边、统一 PBR 着色器、四级流体物理、恒星光谱 45:55 融合、POI 采样蜕变基座残骸

## 实机复测

任务模式（site_abyssal_dome_01）着陆 4.5s + 移动 soak：**y === ground（−11.81）、vy=0、零穿地**——原「数秒坠渊」场景不复现。

报告：`docs/reports/report-rework-planets.md`（VERIFY 逐项对映 + GATE 证据）。提请项目负责人按 doc9 §四 执行最终实机动态复测。