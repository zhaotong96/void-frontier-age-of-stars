Doc 10（专家终审报告）和 Doc 11（返工施工方案）已读完。现在我需要核实工程基线与源码现状，再开始施工。

基线 HEAD `9b8721e` 与 doc 11 一致，全部涉改文件都在。先做穿透式取证，核实 doc 10 列出的每个缺陷在当前 HEAD 是否真实存在：

Doc 10 的 P0-A/P0-B/P0-C 全部在指称位置实锤。继续核验其余缺陷：

全部缺陷实锤。继续核验 P0-D（HAZARD 旗）与 themePayload 相关缺陷：

全部 8 项缺陷（P0-A/B/C/D、P1-E/F/G/H）均在 HEAD `9b8721e` 实锤复现。现在建立施工计划并深入读源码。

源码取证接近完备。再补几处关键契约（field 读取方、getMissionField、实体 id、pad 高程、TERRAIN_FLAGS 值、测试运行器），随后分派子代理并行施工：

关键契约已明确。最后确认 `deepClone` 实现是否跳过不可枚举属性（WP-2 成败关键）：

`structuredClone`/JSON 双路径都只枚举自有可枚举属性——不可枚举 `_runtimeField` 方案成立。现在派出第一个子代理执行 WP-2+WP-3（域侧四文件），我本人同步开工 WP-1（GroundView 坐标统一）。

子代理已开工 WP-2+WP-3。我同步实施 WP-1——先精读 GroundView.js 各手术区：

FIELD_OFFSET=-32、TS=24 已明确——注意 doc 11 的 `_missionToWorld` 片段漏了 `- FIELD_OFFSET` 偏移（与 980 行既有约定冲突，照抄会引入 32m 系统偏移），我将以代码库既有约定为准。继续读手术区：

手术区全部读完。核对 GroundView 现有 import 与 MISSION_UNIT_SCALE 定义：

Import 缺口明确（需补 `MISSION_UNIT_SCALE`、`TERRAIN_FLAGS`）。开始 WP-1 手术——共 9 处编辑：

WP-1 九处手术完成。立即语法校验 + 残留扫描：

残留引用全部为合法 legacy 分支。WP-1 竣工。推进 WP-4/WP-5——先读建造模式与着色器现状：

WP-4 需要先核实 `ShapeTerrain`/`PlaceBuilding` 命令契约与 `app.dispatch` 返回值：

命令契约已明。再核实视图片刷新链与资源口径：

WP-4 设计定型。补看最后几处接线细节（坐标系约定、按键处理、音频 API）：

发现一个疑似预存坐标系矛盾（`_tryRestoreTerrain` 用 `c.x - FIELD_OFFSET` 而 `_groundAt` 用 `c.x + FIELD_OFFSET`）。必须核实 `applyEdit` 的坐标口径：

`applyEdit` 吃场域坐标——`_tryRestoreTerrain` 的 `c.x - FIELD_OFFSET` 疑似 +64m 预存 bug。用渲染端偏移做最终裁决：

渲染端确认：世界 = 行星本地米 + 32。顺带发现 `_tryRestoreTerrain`（+64m）与 `_layoutColony` center（64.5 vs 0.5）两处疑似同族坐标 bug。核实 `planColonyLayout` 口径：

`planColonyLayout` 吃行星本地米——`centerFx = 32.5 - FIELD_OFFSET = 64.5` 确认同族符号反转 bug（应 0.5）。开始 WP-4 施工（含 2 处相邻 bug 修复）：

需检查 `_layoutColony` 前置的旧 `colony` 守卫是否与新代码重复声明：

现在加入 WP-4 工程作业三助手（接在 `_tryRestoreTerrain` 之后）：

GroundView 的 WP-4 路由完成。现在给 `src/app/commands.js` 补 `HarvestTerrainOre` 命令：

WP-4 全部通过。进入 WP-5——批量读取渲染/音频/主题文件：

关键发现：`planetThemes.js` 在当前 HEAD 根本不存在（doc10 P1-F⑤ 失实）——先全仓确认，再查 `PlanetWater` 是否支持主题色注入：

`PlanetWater.sync` 原生支持 colors——且 `planetThemes.js` 在 `src/content/`（非 doc10 所写路径）。核实其色板形状、与套件断言的关系、音频与 EXPANSION_GAMEPLAY：

theme-expansion 套件只断言结构合法性（不锁具体色值）——接线安全。最后一轮细节定位（重力/风/甲板/音频/场地钩子）：

WP-2+WP-3 子代理竣工：13 套件全绿、存档单任务增量 5850B（<40KB）、deepClone 增量 0.44ms、读档往返 stepMission 无异常、坪面清险冒烟全过。它还实证修正了我工单中 Map-L1 缓存的读档缺陷。立即抽查其 diff，并派出 WP-6 域侧子代理（保持双槽）：

WP-6a 子代理已开工。我继续 WP-5——先做 PlanetSurface3D 的 uHdr：

补上第二处编辑（LIT_FS uniform 块加 uHdr）：

PlanetSurface3D 完成。现在 GroundView 的 BM_FS/bmesh/env 链：

需核实 uFootsteps 的坐标空间（世界 or 场域）再接涟漪：

uFootsteps 是世界空间（`aPos + uWorldOffset` 后比较）——doc 11 的 `+ FIELD_OFFSET` 又是错的，须用世界坐标。找 `_moveAABB` 调用点与重力积分点：

`_gravity()` 是双模式统一入口——gravityScale 就此接入。执行移动层三处集成：

补上 HUD 工程刷状态行，然后全面语法校验：

WP-5 全部通过语法。跑受影响的套件冒烟（主题/场景挂载/命令总线）：

TDZ 时序错误——注册调用须移到 `externalPaletteSource` 声明之后：

WP-6a 子代理报告的 TDZ 阻塞正是我刚修复的问题——通知它主树已修，然后重跑冒烟：

6/6 全绿——WP-5 竣工。进入 WP-6b（防伪绿门禁升级）——先读现有门禁：

门禁结构清楚了。读 GATE-01 现状与 `_bmeshList` 尾段的 this 依赖：

门禁升级设计定型。核实 SaveCodec API 与 isHazardAt 语义：

SaveCodec API 明确。升级 GATE-01（300 帧 + 608 行星暴毙断言 + 存档体积/往返）：

GATE-01 升级完成。升级 GATE-02——先确认 `getMissionView` 签名：

修正 `_resolveInteract` 断言的 null 语义（targetId 可能非字符串）：

WP-6a 竣工（46/46 探针、隔离全量 84/84）。GATE-02 的 `this` 断链原因明确——`.call()` 整体替换了 `this`，改用 `Object.create(GroundView)` 原型链壳：

GATE-02 全绿。跑 GATE-03/04 与其他受影响套件，然后后台跑全量：

全部受影响套件（20 个）全绿。启动全量门禁（后台）：

lint:static 零违规。并行重建 bundle：

bundle 142 模块 1786KB 语法零错。趁全量测试后台跑，预判 golden 是否受 WP-2/WP-6 影响：

golden 为无玩家命令纯演化——先查 objective 生成是否会触及新接线，同时核验 `_drawHudMission` 的 `m` 定义域：

`m` 作用域无问题。查看全量测试进度：

趁全量后台跑，给 GATE-02 补齐 doc11 验收表剩余两项的运行态断言（移动边界/坡度阻断 + 工程命令坐标契约）：

断崖测试与 `sampleTerrain` 模块级耦合有冲突——查 `sampleTerrain` 是否走 `field.evalPoint` 可桩点：

`sampleTerrain` 走真实 chunk 网格——改用套件内已有真实场域做确定性陡壁扫描：

两处稳健性修正：空场域需 `chunks: []`（防 chunkAt 崩）、陡壁点排除 ROAD/BRIDGE 豁免旗：

全量测试 exit 0。读汇总确认，并完成陡壁扫描的旗标排除修正：

关键发现：全量跑实为 PLAYTEST-01 失败（`| tail` 掩盖了真实退出码）——但因果断言全过：**穿地 0、HAZARD 坪 0、脚下 0**。708 例 t=10s 死亡/1097 非满值需要甄别：是战斗伤害（合法）还是环境伤害（P0-D 复发）。核实 `lastHitAt` 是否只由战斗路径写入：

`lastHitAt` 战斗/危险双路径都写——但因果断言已证 HAZARD 恒 0，故 `lastHitAt >= 0` ⇔ 敌击。先用 HEAD worktree 实证「10s 战损是既有平衡而非本次返工引入」：

**决定性实证**：HEAD 基线同口径探针 —— deaths=683/2432、**hazardHits=52413**；返工后 hazardHits=0；plt_3 的 hp=80/100@lastHitAt=8.40 与返工后逐字节一致 ⇒ 战损系既有敌 AI 接敌平衡，环境伤害（P0-D 缺陷类）已归零。按此精化 GATE-01 判据：

套件内拿不到 GroundView 私有常量——直接用值 +32（FIELD_OFFSET=-32）：

GATE-01 精化判据 PASS。GATE-02 壳字段遮蔽了原型方法且本地 applyEdit 会在假场域上炸——修正壳：

`_shapeTerrainAt` 的 `this._edits` 守卫拦住了——壳补 `_edits`：

假场域无 ORE 旗——改用真实场域 + 确定性 ORE 扫描点重写工程契约段：

上次编辑已移除 `_shapeTerrainAt: null` 行——重读现状再替换：

GATE-02 全段 PASS。清理基线 worktree，启动最终全量门禁（保留真实退出码）：

最终全量门禁后台运行中（约 8-10 分钟）。趁此做实机浏览器冒烟取证。启动 dev-server 并加载浏览器技能：

`window.__VF_APP` 全局句柄可用。开浏览器实机验证：

战役已启动（456 行星、零启动错误）。导航到地面视图并截图：

落在硫雾沼泽行星（正是 P1-F/P0-D 的主题）！截图取证：

叙事事件弹窗挡住了。关闭并进入「遗迹调查」任务：

进入任务 3D 场景（暂停战略时钟防叙事打断）：

任务运行中（site_meters + GL 正常）。截取 3D 战场首屏：

**实机铁证到手**：「撤离区 46m」罗盘正常（HEAD 为 NaNm）、队友可见（HEAD 全隐形）、HP/护盾满值、硫雾病绿主题。收集运行态诊断收尾：

实机诊断全绿：nanHits=0/11、主题音 `sulfur_marsh` 已激活、权威色板已注入、HP 满值。最后冒烟工程模式（技能5 + F 刷子）：

工程模式实机可用（建造模式开、刷子循环到「采掘」、准星信息条出现）。查看最终全量门禁结果：

第 1 轮全 PASS 含 **REG-01 金快照 PASS**（哈希未变——域侧模拟行为零漂移）。趁第 2 轮运行，核对 CHANGELOG/报告目录约定与 bundle 外链：

bundle 零真实外链（全部为 JSDoc/守卫探针）。收集竣工行号证据备报告用：

第 2 轮 GATE 全 PASS。等待收尾的 17 项：

**全量门禁：PASS 84 / FAIL 0（2 轮 × 42 套件）**。确认真实退出码：

EXIT=0，双轮 84/84，金快照双轮 PASS。现在落盘 CHANGELOG 与正式验收报告：

修正 CHANGELOG 结构（我插入了重复的 Changed 标题）：

CHANGELOG 落定。撰写正式验收报告：

HEAD `ba83215` 提交完毕。停掉 dev-server、确认工作树净、更新记忆：

# 终审返工竣工汇报（docs 10/11 全量对映）

**竣工 HEAD `ba83215`，工作树净。42 套件 84/84（2 轮）exit 0，lint:static 零违规，金快照 `68462446` 零漂移，bundle 142 模块 1786KB 零外链。**

## 一、doc10 四项 P0 阻断事故根治实证

| 缺陷 | 根治 | 铁证 |
|---|---|---|
| **P0-A** 全场 NaN 隐形 | `_missionToWorld` 统一度量（GroundView.js:1801），4 渲染管线+罗盘全接入 | GATE-02 运行态扫描 0 NaN；实机罗盘「撤离区 46m」（HEAD 为 `撤离区 NaNm`） |
| **P0-B** 97MB 存档炸弹 | 不可枚举 `_runtimeField` + 幂等重建（GroundMission.js:521/926/1187/1867） | 单任务增量 **97MB → 5850B**（<40KB）；deepClone **1.4s → 0.44ms**；读档往返零异常 |
| **P0-C** 时钟/交互失真 | HourlySystems.js:108 `m.status\|\|m.state`；3.0m 交互 / ±286 全域边界 / 35° 坡度正切 | GATE-02：西行 400m 达 -222（原截断于 2）、陡壁物理挡下、2m 触发/4m 不触发 |
| **P0-D** 58 星开局暴毙 | `clearFlags` 清险契约 + 海洋坪抬升（terrainField.js:302 + missionSiteFactory.js:556-642） | **HEAD worktree 对照探针：HAZARD 脚下帧 52413 → 0**（3648 场因果级） |

## 二、P1 四项闭环
- **P1-E**：技能 5 接 ShapeTerrain/PlaceBuilding/**HarvestTerrainOre**（新命令，doc11 引用但原仓库不存在，按真实 schema 落地 commands.js:757）；顺带根治同族坐标 bug ×2（`_tryRestoreTerrain`/`_layoutColony` 各偏 64m）
- **P1-F**：uHdr 双着色器、PlanetWater 主题水色、权威色板源接线、硫雾酸液面 3.8m、永冻炉心热源对位、biolume 脚步涟漪
- **P1-G**：18 主题环境音双激活（实机 `current: 'sulfur_marsh'`，原 0 调用全静音）；EXPANSION_GAMEPLAY 三规则（0.25g 低重力/相位风场/浮台禁出）
- **P1-H**：`checkAndProgressObjectives` 五结算点闭环，WP-6 探针 **46/46**（账本对账+幂等）

## 三、防伪绿门禁升级（杜绝再次伪绿）
- **GATE-01**：300 帧（10s）全银河仿真 + HAZARD 因果断言 + 存档健康度。判据精化有据：HEAD 基线对照证明战斗伤亡（683 例）系既有平衡且与返工后逐位一致，环境伤亡才是 P0-D 缺陷类——现已钉死为 0
- **GATE-02**：源码正则 → **运行态全管线**（原型链壳调用真实 `_assembleRenderData/_bmeshList/_moveAABB/_fieldDig`，0 NaN + 交互/边界/坡度/工程坐标契约）

## 四、落盘清单
- 验收报告：`docs/reports/report-final-rework.md`（缺陷→实施→证据三列 + doc10/11 勘误 6 条，含 FIELD_OFFSET 约定、`_missionToWorld` 片段缺偏移等按实机口径的修正说明）
- CHANGELOG `[Unreleased]` 条目 + `AUTONOMOUS_RUNBOOK.md` 终审返工轮 + 全部代码/测试/dist 单体提交
- 实机取证（IAB 硫雾沼泽任务）：罗盘 46m、队友可见、HP 100/100@12s、主题音激活、工程模式可用、0 帧错误

**遗留（不阻塞）**：建筑型号选择 UI、E2E 页 6 项容器 rAF 误报（既有）、Pages 推送待凭据。