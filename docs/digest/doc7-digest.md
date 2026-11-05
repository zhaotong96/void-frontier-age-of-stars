# doc7 摘要 — 《无垠边疆：星海纪元游戏审美主题与行星 GamePlay 全线施工方案与工程实施总纲》

> 源文件: `docs/specs/7_无垠边疆行星美学与施工方案.md`（751 行，约 560KB，其中约 445KB 为 19 张内嵌 base64 公式/示意图）。
> 行文约定：`doc7:N` = 源文档第 N 行。文中引用标记"1"（几乎每句句尾）是脚注引用（指向序列 6 文档），非内容。
> 用途：执行工程师免读原文即可开工；需要精确代码时按下文给出的行号区间回读。

---

## 1. 文档定位与红线（doc7:1-23）

**身份**（doc7:3-8）：
- 文档标识 `VF-EXEC-PLAN-PLANETARY-202611-SEQ07`，演化序列 7，承接序列 1-6，是执行工程师全线施工的**调度与验收准绳**。
- 参考代码基线：`main @ 2d471a5e35db4fb8f9cb5b58d3fcb79dbedff9d2`（129 个源模块 / 35,192 行原生 JS，26 个自动化测试套件 × 2 轮 = 52/52 PASS）。
- 定性：不替代序列 1-6；在**服从序列 6 的最高审美与玩法裁决权**前提下，整合序列 4 的四层交互诊断与序列 5 的全栈收敛方案，形成**自包含、零外部搜索依赖、可直接按图索骥编码与验收**的施工总纲。
- 三项核心工程指令：① 彻底废止 Minecraft 式 64×24×64 方块体素地表与 greedyMeshChunk 立方体台阶，转向《戴森球计划》式**连续三角化行星地形**；② 重构地形前先按代码证据链根治两大 P0 渲染故障（地形表面像背面剔除不渲染 / 世界背景懒刷新重影）并解除地表简报页软锁死；③ 废除纯随机噪声地图与改 RGB 伪主题，实装"人工任务核心 + 人工过渡带 + 确定性程序化外围"三层关卡结构及 **18 个行星主题系统**。

**跨文档对齐与裁决表**（doc7:14-21）：

| 序列 | 保留资产（必须继承） | 冲突裁决 |
|---|---|---|
| 1 长线研发任务书 | 单一静态 Web 应用、统一 World 状态、xoshiro128** 确定性随机、单向 CommandBus/EventBus、三级降级存档（IndexedDB→localStorage→内存）、零第三方运行时依赖、GitHub Pages 与 file:// 双模 | 严禁拆分为孤立小游戏/第二 World 存储；地表改动必须经命令总线回写主世界 |
| 2 rework | GLCore.js、Mat4.js、PostProcessor.js（RGBA16F + 4 级高斯辉光金字塔 + Narkowicz ACES）、CanvasManager 双画布（glCanvas+hudCanvas）、3D 银河/星系/太空战管线 | 保留架构，但必须按第 2 章补齐场景 FBO 硬件深度附件与 beginScene 显式清屏契约 |
| 3 rework2 | 沉浸式毛玻璃 HUD、越肩弹簧臂相机、7 部件外骨骼、小队战斗状态机、GroundMeshes.js、传送带货箱流动 | **彻底废止 Phase R8 的 64×24×64 体素主视觉方向**（greedyMeshChunk 立方体表面与 ddaRaycast 挖方块） |
| 4 专家诊断 | L1 银河→L2 星系→L3 行星经营→L4 局部战术四层无断点体系、事件目标化、"探索先于殖民"、持久化 POI 价值模型 | 完全采纳交互诊断结论；L3/L4 注入序列 6 主题身份与人工核心设计 |
| 5 全套施工方案 | **完整保留并执行**其 P0 导航/UI/着色器修复（GLOW_VERT 二倍轨道半径修正、侧栏安全边距、UIStateStore 瞬态保持、RouteStack 与 GroundView 软锁死解除、Inspector 自动收起）、WorldObjective 离屏箭头、jobsFilled 与 runtimeStatus、伴生卫星/小行星带 | **覆写其地表 POI 坐标与地形交互**：voxelPos 挂载升级为连续三角网格上的 PlanetLocal 三维坐标与主题地标实例 |
| 6 最高指导规范 | **最高审美与玩法宪法**：冻结连续三角网格、DSP 式空间尺度、18 主题九维规范、三层登陆区、四类地表活动闭环 | 本文档（序列 7）是将其全部规范转化为代码结构/数学公式/着色器/原子任务/门禁的**唯一施工执行手册** |

**七条工程红线**（doc7:23）：
1. 正式地表不得再渲染可见立方体台阶或棋盘格色块；SurfaceSandbox.js 旧体素数组仅限旧档兼容迁移或离散辅助，greedyMeshChunk() 方块网格不得作为正式地表主几何提交绘制。
2. 不得仅改 `CATEGORY_TERRAIN.tint` 或天空渐变 RGB 就宣称完成主题；每个主题必须同时具备专属**地貌高度场函数、连续混合材质、大气与天气着色器、标志性 3D 地标、环境危险规则、专属经济或科技产出**。
3. Mission Core 严禁只靠 Simplex 噪声加随机撒点；必须经 MissionSiteBlueprint 保证落地点、主视觉地标、至少两条差异化战术路线、掩体与撤离点的确定性拓扑与首屏焦点构图。
4. 所有主题抽选、宏观高度场、任务蓝图实例化、外围 POI 与地表装饰物一律经 `RNG.fork(world, salt)` 或 `seedFromNumber(world.seed ^ hash32(...))` 派生子随机流；**严禁消费主 world.rng**（保 52/52 测试与金快照哈希 `5ac0ed56` 不漂移），严禁 `Math.random()`。
5. src/render/ 与 src/ui/ 只消费只读快照或地形投影；采矿、采样、建造、地形整形与任务结算必须经 `App.dispatch()` 走 CommandBus（或任务帧 SetGroundInput 瞬态通道）由领域层权威执行。
6. 存档只保存 primaryThemeId、生成器版本、种子、POI 状态、建筑实体与压缩地形编辑差异（terrainEdits）；严禁把 WebGL 顶点缓冲、VAO/FBO 句柄、相机矩阵写入 IndexedDB。
7. 网格生成、自适应三角剖分、SDF 融合、样条、GLSL ES 3.0 着色器、Web Audio 合成音效全部原生 JS 手写，零外部运行时依赖，并同步打包进 `./dist/void-frontier.bundle.js`。

---

## 2. Phase 0 止血项（doc7:25-137）

### 2.1 故障机理取证（doc7:29-34）

**故障一：地形"像被背面剔除"不渲染 —— 场景 FBO 缺深度附件**（doc7:32）
- 事实链：`GroundView._renderFrame()` 每帧经 `cm.beginGLFrame()` → `post.beginScene()`，渲染目标绑到 `PostProcessor._scene.fbo`（由 `GLCore.createFloatTarget(w,h)` 创建）。该函数**只创建了颜色纹理 COLOR_ATTACHMENT0，未创建/挂载 DEPTH_ATTACHMENT（DEPTH_COMPONENT24 渲染缓冲）**。
- 后果：WebGL 2.0 下离屏 FBO 无深度附件时，`gl.enable(gl.DEPTH_TEST)` 与 `gl.clear(gl.DEPTH_BUFFER_BIT)` 均无效；`PlanetSurface3D.draw()` 提交的地形区块、地下洞穴内壁（prof.cave）、侧面与底面按顶点缓冲先后顺序"后盖前"绘制；远处区块背面、洞穴顶/底面直接覆盖近处地表 → 地表看起来像被背面剔除一样破损消失或深度翻转。

**故障二：背景"懒刷新"重影 —— 无显式清屏 + 状态残留被辉光金字塔逐帧放大**（doc7:33）
- `CanvasManager.beginFrame()` 只清了顶层 2D HUD 画布；`PostProcessor.beginScene()` 绑定场景 FBO 后**未执行颜色/深度清除**；`PlanetSurface3D.draw()` 开头仅 `gl.clear(gl.DEPTH_BUFFER_BIT)`（且如上无效），不调 `gl.clear(COLOR_BUFFER_BIT)`，完全依赖随后的天空全屏三角形覆盖整张 FBO。
- 更脆弱点：天空三角形绘制前只 `gl.disable(DEPTH_TEST); gl.depthMask(false);`，**未关闭 gl.BLEND、未关闭 gl.SCISSOR_TEST、未重置 gl.colorMask(true,true,true,true)**。一旦前序通道遗留混合因子（如 `System3D._hdrBlend` 的 CONSTANT_COLOR 混合）或裁剪状态，或 `SKY_FS` 中 `pow(s, 800.0)` 与逆矩阵反投影在某些视角产生异常值，上一帧颜色残留在 `_scene.texture` 中，并在 `PostProcessor.endScene()` 的 4 级高斯金字塔**加法混合 (gl.ONE, gl.ONE)** 中逐帧放大 → 满屏重影拖尾。

**故障三：绕序与剔除状态从未声明**（doc7:34）
- `PlanetSurface3D.js` 全文未声明 `gl.frontFace(gl.CCW)`，也未在各绘制通道间显式管理 `gl.CULL_FACE`。
- 依序列 6 §3.2/3.3：没有真实浏览器运行时快照前，不能凭单一代码缺陷宣称解释全部现象；必须同时落实**显式清屏状态契约**与**运行时证据链诊断**。

**导航死锁**：地表简报页软锁死，修复归入 TASK-0.4（doc7:289）：GroundView 简报页接收 planetId 参数、无条件渲染顶部返回按钮、响应 Escape、开放未殖民行星 survey 入口。

### 2.2 P0 渲染状态契约与代码级修复（doc7:36-136）

**修复 1 — GLCore.js：createFloatTarget 挂 24 位深度渲染缓冲**（doc7:40-100，代码蓝本在 40-100 行）
- `GLCore._init()` 的 `_tracked` 清册新增 `rbos: []`；`resetTracking()` 与 `destroy()` 同步 `gl.deleteRenderbuffer` 清理。
- 签名：`createFloatTarget(width, height, { linear = true, depth = false } = {})`。
- 算法：内部 `make(floatMode)` —— float 模式 `texImage2D(RGBA16F, RGBA, HALF_FLOAT)`，否则 `RGBA8, UNSIGNED_BYTE`；过滤 linear?LINEAR:NEAREST，WRAP 均 CLAMP_TO_EDGE；建 FBO 挂 COLOR_ATTACHMENT0；`depth:true` 时建 Renderbuffer `DEPTH_COMPONENT24` 挂 DEPTH_ATTACHMENT；`checkFramebufferStatus` 校验，不完备则降级 float→byte 重建，仍不完备抛错 `float target FBO incomplete (WxH)`；资源全部登记 `_tracked.textures/fbos/rbos`；返回 `{ texture, fbo, rbo, width, height, float, hasDepth }`。

**修复 2 — PostProcessor.js：唯一权威的场景 FBO 清屏与状态复位契约**（doc7:102-125，代码蓝本在 104-125 行）
- `_buildTargets()`：主场景改 `this._scene = glc.createFloatTarget(w, h, { linear: true, depth: true })`；金字塔模糊缓冲保持 `depth: false`；`_releaseTargets()` 释放 `this._scene.rbo`。
- `beginScene(clearColor)` **每帧 8 步契约**（tier>=3 或 !_scene 返回 null）：
  1. `bindFramebuffer(_scene.fbo)`；2. `viewport(0,0,w,h)`；3. `disable(SCISSOR_TEST)`；4. `disable(BLEND)`；5. `colorMask(true,true,true,true)`；6. `depthMask(true)`；7. `frontFace(gl.CCW)` + `cullFace(gl.BACK)` + `disable(CULL_FACE)`（声明默认绕序，不开启剔除）；8. 默认 clearColor `[0.02, 0.03, 0.06, 1.0]`，`clearDepth(1.0)`，`clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)`。返回 `{ fbo, width, height }`。

**修复 3 — 地表渲染器 Pass 隔离与三档诊断视图 TerrainDebugView**（doc7:127-136）
- **严禁**在正式代码里永久禁用 CULL_FACE 掩盖绕序问题。
- `PlanetSurface3D.js`（及新建 `PlanetTerrainMesh.js` / `PlanetSurfaceScene.js`）：
  - **每帧双保险清色**：draw() 首部设主题地平线 clearColor 并 `gl.clear(COLOR|DEPTH)`；SKY_FS 中 `pow(s, 800.0)` 改为 `pow(max(s, 1e-6), 800.0)`，反投影分母 `p4.w` 加非零保护（防 NaN/Inf）。
  - **严格 Pass 状态隔离**：天空 Pass 显式关 DEPTH_TEST、depthMask、BLEND、CULL_FACE；不透明地形与建筑 Pass 显式开 DEPTH_TEST(LEQUAL)、depthMask(true)、frontFace(CCW)、enable(CULL_FACE)+cullFace(BACK)；水体与半透明 Pass 显式管理混合模式与深度写入，结束时恢复默认状态。
  - **三档诊断模式（F3 循环切换 + 导出 JSON 快照）**：① 模式 1 无剔除 Unlit 诊断——临时关 CULL_FACE、输出无光照纯色，验证顶点在视锥内；② 模式 2 线框与法线诊断——顶点法线映射 RGB、叠加网格边线与 Chunk 边界框，排查法线翻转/退化三角形/接缝；③ 模式 3 单三角形朝向与 CCW 绕序诊断——用 `gl_FrontFacing` 正面染翠绿 (0.1,0.9,0.3)、背面染洋红 (1.0,0.0,0.8)；配套单元测试：对已知朝上地面三角形验证 `(v1-v0)×(v2-v0)` 与外法线点积恒为正，保证开/关背面剔除正面可见性 100% 一致。

---

## 3. 地表几何方向（doc7:138-162）

总方向（doc7:138-141）：正式地表主几何 = **Triangulated Planetary Terrain**。非每帧全局 Delaunay，而是"规则高度场三角网格 + 基于局部曲率/坡度的自适应细化与对角线优化 + 任务区约束网格"分层架构；吸收 mapbox/delatin（Garland & Heckbert 最大误差控制）与 NVIDIA GPU Gems 2 *Geometry Clipmaps* 精髓。（doc7:141 处 image1 为方案示意图）

### 3.1 四层空间坐标体系（doc7:143-152）

| 层级 | 范围定义 | 职责与契约 |
|---|---|---|
| **Planet Local** | 行星局部切平面坐标，首期可探索范围 **[-256m, +256m]**（512m×512m，8×8=64 个 64m×64m 区块），高度 **-40m ~ +80m**；后续支持无缝挂载 Cube-Sphere 六面球面四叉树 | 连续地形高度场生成、三角网格顶点计算、建筑地基投影落位、胶囊体碰撞、地表寻路。顶点着色器施加**视觉球面曲率修正**（doc7:149 image3 公式；据 §8.2 蓝本为 `y -= distSq * (1/(2R))`，视觉行星半径 R=1800m，即 `uPlanetCurveInv2R = 1.0/(2.0*1800.0)`），使远方山脉/海平面/建筑群沿星球弧度下沉没入地平线 |
| **Site Local** | 登陆点/任务场景归一化坐标，经 `siteCenter` 与 `siteRadius`（默认 160m）映射至 Planet Local | 承载 MissionSiteBlueprint 人工关卡锚点、双路线样条、掩体与过渡带半径比例（coreRadiusFactor, transitionRadiusFactor）；仿射变换 **SiteTransform** 无缝兼容旧 GroundMission 二维任务坐标 |
| **World / Entity** | 稳定实体 ID（如 `poi_plt_3_01`）与持久化世界映射 | 存档序列化、跨视图（SystemView ↔ ColonyView ↔ GroundView）状态同步、POI 奖励锁与命令引用 |
| **Render Camera** | 相机相对坐标 | 近景高精度着色与矩阵变换，消除远距离大坐标 32 位浮点抖动 |

### 3.2 连续三角网格生成五项核心算法规范（doc7:154-162）

**TerrainChunk 顶点数据**（doc7:156）：`position`(Float32Array)、`normal`(Float32Array)、`tangent`(Float32Array)、`materialWeights`(Uint8Array, 4 通道材质混合权重)、`biomeId`(Uint8Array)、`flags`(Uint16Array, 标记道路/建筑地基/任务核心保护区/危险表面/可采矿脉/桥梁甲板)、`indices`(Uint32Array)。

1. **多尺度地貌场叠加**（doc7:158）：宏观地貌场（大陆/海盆、山脉走向、裂谷、火山口、冰川盆地、盐湖、平顶桌山）→ 中尺度侵蚀结构（山脊分叉、支谷、风蚀槽、沙丘波纹、熔岩堤岸、珊瑚礁阶地）→ 融合人工任务核心 SDF 约束场；每顶点计算高度、坡度、曲率、湿度、温度。
2. **曲率自适应对角线切分**（doc7:159）：严禁全图单一方向固定对角线。比较两条对角线高差 |y00-y11| 与 |y10-y01|（辅以奇偶交替微偏置与道路样条切线方向约束），始终沿**高差更小**（顺应等高线/山脊棱线/峡谷槽底）方向连接，并按严格一致**逆时针绕序（gl.CCW）**输出索引。
3. **局部受约束细化与多级分块 LOD**（doc7:160）：近景（距相机 <96m 及任务核心区）**LOD 0** 步长 1.0m、65×65 顶点/Chunk，表达悬崖边缘/桥梁落点/掩体/脚下起伏；中景 96–192m **LOD 1** 步长 2.0m；远景 ≥192m **LOD 2** 步长 4.0m 仅保留大尺度山脉轮廓与地标剪影；视锥外区块暂停细节更新。
4. **零裂缝水密拼接 + Geomorph**（doc7:161）：相邻不同 LOD 区块共享边界顶点强制线性插值对齐；区块外沿向下延伸 **3.0m 垂直裙边（Skirt）**；顶点着色器在 LOD 切换带（宽 **16m**）内执行顶点高度 Geomorph 平滑插值，无裂缝无闪烁跳变。
5. **连续多材质三平面混合着色**（doc7:162）：摒弃"每三角形涂纯色"；片元着色器按高度/坡度/温度/湿度/化学参数驱动 **4 层材质**平滑过渡；陡坡岩壁用世界空间三平面投影（Triplanar）叠加水平沉积岩层理，消除大坡度 UV 拉伸；坡度 >48° 的断崖与晶柱混合屏幕空间偏导面法线呈现硬边雕塑感。主题颜色以 **sRGB 十六进制**为设计输入，渲染前统一转换至线性空间（doc7:162 image11，转换式应为线性化 pow）参与光照。

---

## 4. 18 大主题规格（doc7:164-247）

九维规范（doc7:166）：每个行星绑定 `primaryThemeId` + 可选 1-3 个 `secondaryThemeModifiers`，覆盖：①轨道主轮廓 Silhouette ②地貌结构 Geomorphology ③主材质 Surface Materials ④主色/强调色板 Palette ⑤光照与天空 Lighting/Atmosphere ⑥动态天气 Weather/Motion ⑦生态或结构地标语法 Landmark Grammar ⑧危险与行动规则 Gameplay ⑨资源与经济钩子 Economy。

### 4.0 主题总矩阵（doc7:169-188）

| 批次 | 主题 ID | 天体类别 | 主色板 (sRGB) | 标志性地貌 | 玩法/经济钩子 |
|---|---|---|---|---|---|
| 首批 P3 | abyssal_ocean 碧渊海洋 | ocean, ice_moon | 深海蓝 #042A46 / 碧蓝 #087F95 / 荧光青 #5DEBDF / 珍珠紫 #B77BFF | 无边际海面、深海沟、亚特兰蒂斯珊瑚巨构、娜迦螺旋海神塔、半埋海底穹顶 | 潜航与水压管理、潮汐开闭通道、海底遗迹采样；产深海生物质、重氢、耐压材料科技 |
| 首批 P3 | permafrost_furnace 永冬炉境 | ice | 冰白 #EAF5FF / 蓝白 #91BBD1 / 深冰蓝 #466D8A / 热源琥珀 #F2A85D | 蓝白冰原、深渊冰裂隙、喷涌橙火中央热源塔、融雪暖光聚落、加热钢桥 | 热量管网（Heat Means Life）、暴风雪撤离窗口、冰层钻探；产富水冰、隔热超导科技 |
| 首批 P3 | red_regolith_frontier 赤砾边疆 | desert, rocky | 铁锈红 #C66B3B / 熟褐 #8B4F36 / 沙金 #D4A36A / 淡尘 #F0C78D | 平顶砂岩桌山、风蚀峡谷、环形陨坑、巨型砂岩拱门、红色尘暴幕墙 | 深井地下水勘探、高日照太阳能、沙尘暴降产防护；产铁族矿、硅酸盐、基础工业 |
| 首批 P3 | dry_night_polar 永夜晶荒 | ice, rocky | 深黑蓝 #101421 / 月白 #D8DCE8 / 灰紫 #77718F / 极光紫 #BDA4FF | 干燥黑岩冻原、白盐晶盆地、极夜星空、紫色极光 | 极夜无光热储能、雷达信标导航、防流星激光网；产工业盐晶、光学晶体、储能科技 |
| 首批 P3 | sulfur_marsh 硫雾沼泽 | toxic | 沼绿 #1D341B / 硫黄 #748F2B / 毒荧绿 #B7D84C / 气体高光 #D9FF76 | 冒泡腐泥潭、硫磺喷气锥、强酸池、低洼硫化沼气云、高架管桥 | 防腐服滤芯消耗、低洼毒雾绕行/抽气净化、沼气防爆；产挥发性气体、硫化物、化工链 |
| 首批 P3 | biolume_canopy 星辉生物圈 | rocky, ocean | 深海青 #082B3D / 蓝绿 #007E91 / 生物青 #42D8C6 / 荧光紫 #A981FF | 潘多拉巨型林冠、磁场悬浮石拱、发光根系网、浮游孢子、踩踏荧光涟漪 | 压感生态追踪、昼夜窗口共生采样、植被回收移植；产再生生物质、神经纤维、医疗前体 |
| 首批 P3 | obsidian_lava 黑曜熔海 | lava | 熔岩黑 #160F14 / 暗红 #5B171D / 熔火红 #E54B24 / 灼橙 #FFAA3C | 黑色玄武岩山脊、岩浆河、黑曜石高架拱桥、六棱柱阵 | 拱桥路线规划与断桥抢修、热辐射防护、岩浆虹吸地热发电；产重金属、稀土、耐热装甲 |
| 扩展 P4 | prism_crystal 棱镜晶原 | rocky, ice | 冷白 #DCEFF7 / 晶蓝 #56CBE5 / 棱镜紫 #9A83D8 / 折射粉 #FFB7EC | 六棱水晶山峰、几何折射峡谷、彩虹色散光带 | 晶体无线电干扰与光学中继导航、折射光路谐振解密；产量子水晶、高能激光组件 |
| 扩展 P4 | salt_mirror_desert 镜盐荒原 | desert | 盐白 #E8E1CD / 灰粉 #C7A8A2 / 尘紫 #8B6C88 / 日落金 #D9B86C | 乌尤尼式镜面盐湖、浅粉尘丘、天地镜像、孤立灰紫岩山 | 强反光光学测距干扰、超大型聚光太阳能阵列、地下卤水提取；产轻金属、高能蓄电池 |
| 扩展 P4 | cryomethane_sea 甲烷雾海 | ice, ocean | 深青 #082B32 / 冷青 #167C87 / 甲烷青 #56C6C2 / 冰雾白 #B8E7E2 | 泰坦式粘稠暗青液态甲烷海、蓝绿水冰海岸、浮冰航道、贴地冷雾带 | 薄冰承重断裂风险、低温烃类抽采、耐寒船体/浮台；产液态甲烷燃料、重氢、推进剂 |
| 扩展 P4 | tidal_lock_dusk 晨昏环带 | rocky, lava, ice | 炽昼金 #E2A05A / 暮沙 #CDA978 / 夜侧蓝 #31445F / 晨光青 #80BCD5 | 一侧永昼焦土、一侧永夜冰封，中央暮光环带（Terminator）流淌融水可建基地 | 沿暮光带狭长布局、跨温区远距输送太阳能与冷媒；产温差热电、双极特殊矿物 |
| 扩展 P4 | cloud_giant_atolls 云海浮岛 | gasGiant | 云金 #E5A65A / 粉铜 #C87E67 / 风暴紫 #5D618F / 云顶白 #F2D6AA | 多层风暴云海、悬浮反重力环状岛链、云瀑、高空气囊采集平台 | **严禁普通陆地登陆**；高空浮台、滑翔索道、大气风暴探针；独占高产氦-3 与氘 |
| 扩展 P4 | fungal_catacombs 菌海深渊 | toxic, rocky | 洞穴黑紫 #160F2C / 菌褐紫 #4B2A71 / 孢子紫 #9B4DCA / 共生青 #5AD3A8 | 双层遮蔽：25m 巨型伞菌盖穹顶 + 发光菌丝网、孢子瀑布、地下湖 | 巨型菌盖双层寻路、孢子浓雾过滤通风、共生菌落培育；产特效药物、生物质、菌丝材料 |
| 扩展 P4 | ancient_megastructure 机械圣骸 | artificial | 工业黑 #161F29 / 氧化钢 #6D7F8C / 能量青 #42C3D6 / 遗物白 #D8E1E8 | 断裂沉降六角金属装甲板、古代输能脊、不对称坍塌涡轮塔、电路沟壑 | 古代能源管网跳线重启、协议破译、哨卫机甲攻防；产远古数据、现成合金、奇异物质 |
| 扩展 P4 | glassstorm_barrens 硅晶风暴 | desert, rocky | 暗玻璃 #33262E / 风蚀棕 #9C735D / 硅砂金 #E2BE93 / 玻璃白 #F5E0BB | 半透明熔融玻璃化沙丘、刀刃状硅质山脊、高速碎玻璃喷流风暴 | 顺逆风移速显著差异、背风掩体推进、抗磨蚀护甲维护；产高纯光学硅晶、装甲玻璃 |
| 扩展 P4 | magnetar_aurora 磁暴极光荒原 | rocky, artificial | 极夜蓝 #091729 / 磁层蓝 #1A3F69 / 电离紫 #6A56C4 / 磁暴青白 #B9FFEB | 沿磁力线倾斜生长的螺旋磁铁矿丘、电弧地裂、周期性紫青极光幕帘 | **天空周期性磁暴脉冲威胁**：脉冲峰值期户外电子护盾与喷气背包静默，依托避雷屏蔽塔窗口行动；产超导体 |
| 扩展 P4 | canopy_colossus 巨木云冠 | rocky | 林影绿 #123D32 / 树冠绿 #2F8D69 / 叶金 #A9C85B / 孢子金 #F4D979 | **强制双层地图高度**：百米超巨木平展树冠构成第二层空中大陆，藤蔓桥连接，底层幽暗根谷 | 树冠平台基地、空中藤蔓索道、垂直升降缆索、林冠掠食者巡逻；产高强度生物木质复合材 |
| 扩展 P4 | fractured_moon 碎环月 | rocky, ice_moon | 月岩灰 #39414B / 陨尘褐 #8B7967 / 残阳橙 #D99A62 / 真空蓝白 #B6C4D9 | 0.25g 低重力无大气断裂大峡谷、微重力漂浮碎石、天幕巨型母行星与破碎星环 | 低重力超远跳跃与喷气飞跃裂谷、坠毁舰船残骸打捞、真空骨传导声效；产合金、模块、氦-3 |

### 4.1 七大旗舰主题工程实施细则（doc7:190-247）

1. **abyssal_ocean 碧渊海洋**（doc7:192-204）——三条核心设计准则：
   - 建筑/地貌像从海洋与珊瑚礁自然生长（非水泥方盒沉底）：GroundMeshes.js 必须构建三套专属地标网格 `reef_dome_ruin`（珍珠白鎏金拱肋半埋珊瑚穹顶）、`tide_spire`（顶端悬浮青色能量球的娜迦双螺旋尖塔）、`biolume_kelp_arch`（发光巨藻珊瑚拱桥）。
   - 垂直分层海底地形 + "明暗气袋"色彩过渡：高度场 `ocean_basin_reef_trench`，海平面见 doc7:197（image12 公式，浅海环礁台地 -4m~+6m 呈 #087F95；中层海底沙脊平原 -14m~-4m；深渊海沟沿断层骤降 -32m 沉入 #042A46，荧光青 #5DEBDF 与珊瑚珍珠紫 #B77BFF 发光水母球、螺旋发光藻沿海沟悬崖与古桥两侧排列）。
   - **五层可分级开关水下光学管线（PlanetWater.js）**：① 海面双面波浪层——在海平面高度（doc7:199 image13）绘制叠加 Gerstner 波的透明水面网格，岸边水深 <0.8m 自动生成白色浪花泡沫带；② RGB 波长选择性吸收——水下片元按深度与视线水程指数衰减（doc7:200 image14；据 §8.2 蓝本 `exp(-depth * vec3(0.12, 0.038, 0.014))`），红先消失、蓝青穿透最深；③ 深度阳光衰减与水路雾（doc7:201 image15）；④ 实时双波干涉海床焦散 Caustics——水深 0.2m–22m 采样两组反向滚动正弦/Worley 干涉波纹投射青白聚焦光斑；⑤ 海洋雪与发光浮游颗粒——复用粒子池渲染随洋流横向漂移的微光悬浮微粒。
   - 玩法经济：水深 >8m 进入高压区，持续消耗外骨骼耐压护盾/氧气；周期性洋流脉冲推拽角色；**潮汐窗口每 90 秒升降海平面 3.5m** 控制海底洞穴通道开闭；浅海仅允许漂浮基地平台与潮汐发电机，深海需耐压桩基；独产深海活性生物质、重氢、远古水下碑文数据。
2. **permafrost_furnace 永冬炉境**（doc7:206-212）——Frostpunk 核心是"85% 冷酷蓝白死寂中唯有中央热源塔琥珀暖光(#F2A85D)代表生存半径"：
   - 地形 `glacial_basin_crevasse`：任务核心区生成四周高耸蓝白冰崖环抱的圆形避风冰川盆地，中央矗立 12m 黑铁蒸汽/聚变**中央热源塔 central_furnace_tower**，外围 -25m 深冰蓝裂隙与风雪掩埋前哨残骸，仅可经裂谷**加热钢桁架桥 heated_span_bridge** 通行。
   - **径向热区融雪着色器**：PlanetTerrainMesh 接收最多 8 个热源 `uHeatZones[8]`（中央热源塔、加热中继站、输热干线）；热源覆盖半径内地表顶点**自动下沉 0.32m**（厚雪融化凹陷），材质由高反光积雪平滑过渡为深褐湿润冻土与暗色金属路基，叠加暖琥珀点光源；扫描键触发《冰汽时代》标志性红/橙/黄/蓝四档**等温线热力视图**。
   - 玩法经济（Heat Means Life）：离开热源覆盖圈（vHeatField==0）外骨骼体温槽下降，归零移速减半并冻伤掉血；周期性 **Whiteout 大暴风雪**：横向风雪粒子密度倍增、能见度骤降 18m、**所有热源半径收缩 40%**，迫使抢修输热管线或撤回热源塔；冰层深钻产高纯富水冰、冷冻基因样本、超导隔热合金科技。
3. **red_regolith_frontier 赤砾边疆**（doc7:214-219）——PlanetBase Class D 沙漠星 + 火星：
   - 地形 `mesa_canyon_crater_steppe`：60% 开阔平坦铁锈红/沙金干涸河床盆地 + 40% 顶平壁陡熟褐平顶砂岩桌山（Mesas）与环形陨石坑；陡壁强制水平沉积岩层理着色（Strata Banding），平地风蚀沙波纹；淡尘杏黄天空，山口连续沙尘幕；地标：巨型风蚀砂岩拱门 sandstone_arch、崖边旧采矿平台、深井水塔。
   - 玩法经济：晴天大气稀薄阳光强，**太阳能阵列效率 125%**，平地易铺圆顶建筑群与传送带网；地表极缺水（干涸河床低洼勘探深层含水层建深井水塔）；周期性红色沙尘暴来袭**能见度骤降、太阳能出力暴跌至 15%**，户外未防护人员机械受风沙磨损；盛产铁族金属 ferro、硅酸盐 silicate。
4. **dry_night_polar 永夜晶荒**（doc7:221-226）——极夜但干燥（PlanetBase 第二张图，黑白紫）：
   - **核心区分纪律：严禁生成积雪或冰川，绝不允许做成 permafrost_furnace 换色版**。干燥脆硬极夜荒原：深黑蓝裸露冻岩基底 #101421；干裂盆地与断层脊线析出白骨骼/碎钻般的**月白多边形盐晶壳 #D8DCE8**；天空常年黑夜（`uStars = 1.0`），极光紫 #BDA4FF 与灰紫电离带 #77718F 为最醒目色彩源，盐晶与紫晶簇映出冷冽紫罗兰边缘高光。
   - 玩法经济：极夜常规太阳能完全无效，依赖地热井、聚变堆、大容量**热储能电池塔 thermal_storage_vault**；缺厚大气保护，偶发高能陨石坠落（望远镜 + 防空激光塔拦截，致敬 PlanetBase Steel Dome）；黑暗视野受限，依靠旋转雷达站、地面反光信标、外骨骼热成像推进；独产高纯工业盐晶、稀有同位素、低温超导元件。
5. **sulfur_marsh 硫雾沼泽**（doc7:228-233）——PlanetBase 第三张图（绿）+ 真实火山喷气孔地质：
   - 绿色 = 腐泥深沼绿 #1D341B / 硫磺结壳黄绿 #748F2B / 强酸池毒荧绿 #B7D84C / 沼气喷流高光绿 #D9FF76（腐蚀感与化学不稳定感，非森林绿）。地形 `fumarole_acid_terraces`：焦黑蚀变岩柱平台 + 低洼环状酸液阶地池、冒泡泥潭；**海拔 <4.5m 的所有洼地**由 PlanetAtmosphere.js 渲染高度锁定的翻滚黄绿**体积毒气湖**；巨型硫磺喷气锥 giant_fumarole_cone 每 20 秒喷一道黄绿沼气烟柱。
   - 玩法经济（"危险与资源同源"）：低洼毒气湖持续腐蚀外骨骼防腐层与普通建筑地基；浓沼气区使用等离子/火焰武器引发**沼气爆燃冲击波**；沿高处黑色岩脊推进或架耐腐蚀**高架管桥 acid_pipe_bridge** 跨酸池；任务：抢修高处风向观测塔、启动抽气净化站、冷凝封堵器采集喷气锥；星区最重要挥发性气体、硫酸化工与高能燃料产地。
6. **biolume_canopy 星辉生物圈**（doc7:235-240）——Avatar 潘多拉：
   - 白昼蓝青湿润大气、紫青山影、阶梯瀑布、地磁托举天然巨型石拱 magnetic_stone_arch；夜晚/林冠阴影下深海青黑基底 #082B3D 亮起艾娃荧光青 #42D8C6、深海蓝绿 #007E91、电光紫罗兰 #A981FF 活体生物神经网络。
   - **脚步压感荧光涟漪**：渲染器实时追踪玩家小队脚步坐标 `uFootsteps[8]`，踏在苔毯/浅溪上激发向外扩散的青绿生物光环（见 §8.2 TERRAIN_MESH_FS）。**每种可见发光结构都有玩法语义**：青色脉络指向灵魂母树 soul_willow_tree 与共生采样点；紫色螺旋植物靠近收缩并提供高额护盾掩体；品红闪烁菌簇警示附近掠食异虫巢穴。生态工具非破坏采集可再生 biomass、共生纤维、药物前体；发光植物可移植回殖民地美化。
7. **obsidian_lava 黑曜熔海**（doc7:242-247）——直接实现用户构想（红黑橙）：
   - 地表 80% 为熔岩黑 #160F14 高耸山脊与巨人堤道式**六棱玄武岩柱阵 basalt_hex_pillars**，山脊高差 +28m；深谷底（-4.0m）流淌暗红冷却浮渣 #5B171D、熔火红 #E54B24、灼橙 #FFAA3C 蜿蜒岩浆大河。山脊跨河要冲由地形生成器与关卡蓝图自动构建**抛物线黑曜石高架拱桥 obsidian_arch_bridge**——桥面带 **FLAG_BRIDGE_DECK** 承载属性，外骨骼小队可从拱桥跨越岩浆河。
   - 玩法经济：**严禁全屏染成刺眼通红**，亮部严格克制在谷底岩浆裂隙与热能转换站内；地面路线规划是核心工程挑战：主路线拱桥稳固但有重兵把守，侧翼捷径拱桥存在断裂缺口，需用工程建造枪消耗合金/玄武岩纤维架设临时跨接桥面；沿岩浆河岸部署悬空**地热虹吸发电站 lava_geothermal_siphon** 与重金属/稀土深井钻机。

---

## 5. 登陆点三层关卡架构（doc7:249-266）

铁律（doc7:251）："地图并不是完全随机生成的，落地点中心要有人工设计的小细节，因为登陆星球就是为了做任务，必须有设计；周围走远了就都是随机地形了。" 所有行星着陆场景统一在 `src/domain/ground/missionSiteFactory.js` 采用三层同心架构。

### 5.1 三层空间职责与 SDF 融合（doc7:253-261）

参数化控制：`siteRadius = 160m`、`coreRadiusFactor = 0.28`、`transitionRadiusFactor = 0.26`。

| 区域 | 相对半径/占地 | 内容密度 | 构图与规则 |
|---|---|---|---|
| **1. 人工任务核心 Authored Mission Core** | 中心 0–45m（约占核心视域 25%–30%） | 高（手工蓝图驱动） | 平整着陆区 anchor_dropzone、1 个一眼可辨主视觉地标（中央热源塔/珊瑚穹顶/黑曜石大拱桥等）、≥2 辅助地标、主/次任务目标、**初始即存在的撤离点**、高低差掩体、主题环境机制。**强制至少两条可行进路线**：宽阔平缓有掩体的主路线 route_main + 狭窄险峻但更短或可绕后的侧翼路线 route_flank |
| **2. 人工控制过渡带 Transition Ring** | 环带 45m–86m（约 25%–30%） | 中（SDF 受控渐变） | 用有向距离场（SDF）平滑过渡权重（doc7:260 image16 公式）将人工整平基地高程、装甲路面、受控照明自然衰减融合进外围山脉河谷，消除"人工基地贴在随机高度图上"的断层台阶 |
| **3. 确定性程序化外围 Procedural Frontier** | 86m–256m+（其余探索区） | 低至中（随距离与风险分层） | 行星主题地貌场 + 独立子种子确定性延展。近外围 86–140m：基础露天矿脉；中外围 140–200m：1–3 个带持久化 ID 与 **rewardPaid 幂等锁**的行星兴趣点 POI；远外围 200–256m：高风险稀有矿藏与异常巢穴 |

### 5.2 八问门禁与首屏构图（doc7:263-266）

- 每个写入 `src/content/missionSites.js` 的正式登陆任务蓝图必须明确回答序列 6 §5.5 的**八个设计问题**：①玩家为何被派来此处 ②着陆首屏第一眼看到什么焦点地标 ③建议朝哪个方向前进 ④主目标位于何处及其环境逻辑 ⑤两条路线的风险收益如何权衡 ⑥主题环境如何改变战术动作 ⑦失败或中止撤离的代价是什么 ⑧任务完成后向主世界 World 回写怎样的持久状态变化。
- **首屏构图法则**：点击"开始行动/派遣先遣队勘探"落地瞬间，相机初始偏航 `cam.yaw` 自动对准 `anchor_dropzone → primaryLandmark` 矢量方向，主地标位于首屏视野**黄金分割位**，配合顶部 HUD 罗盘与三维发光路径信标，玩家着陆 **2 秒内**无需打开二级菜单即可读懂局势与前进路线。

---

## 6. GamePlay 闭环（doc7:268-273）

行星地表体验是贯穿 **先遣勘探 Survey → 战术行动 Mission → 自由地表作业 Field Work → 殖民与工业运营 Colony & Industry** 的可持续循环（非一次性孤立小游戏）。

**轨道扫描与登陆准备**（doc7:271）：SystemView 与 GroundView 简报页必须展示：主主题标签、物理环境（重力/大气/温度/流体概况）、矿藏储量与探测置信度、已知持久化 POI 信号数量、推荐装备、着陆点坡度/灾害风险。**打破"尚无玩家殖民地即禁止登陆"死锁**：任何已完成二级分类扫描（`surveyedLevel >= 2`）的可登陆行星均可直接派遣先遣队进入 survey 模式（气态巨行星自动转入 cloud_giant_atolls 高空浮台/风暴探针模式）。

**第三人称外操控与连续地形交互**（doc7:272）：保留 WASD 移动、Shift 冲刺、空格跳跃/喷气背包悬停、鼠标右键旋转视角、底部 1–6 快捷技能栏。相机弹簧臂防穿模与准星拾取由体素 ddaRaycast 全面升级为与连续三角网格求交的 **`raycastTerrain(terrainField, origin, dir, maxDist)`**；角色移动脚底严格贴合三角网格高度并按地面法线微调躯干倾角；高低差真实阻挡或扩展磁轨步枪与敌方炮塔射击视线。靠近外围持久化 POI 信标按 **E** 采样交互 → 前端派发 **`app.dispatch('HarvestPlanetPOI', { planetId, poiId })`**，领域层以 **`poi.rewardPaid === true`** 为严格幂等锁，将 researchData、ancientData、新招募科学官或**行星矿藏丰度 +35% / 宜居度 +8 的永久修正**实时写入 World。

**地形改造与三维工业殖民**（doc7:273）：**槽位 5** 工具升级为连续地表整形与岩芯钻探器（平滑斜坡、压平建筑地基、筑堤，以及 DSP 式 **R 键一键恢复自然地貌**与移植发光植被）。**B 键**放置 24 种殖民地建筑时，对建筑底面**四角及中心**执行三角网格高度差与坡度校验（doc7:273 image17/image18 为阈值公式，详见门禁 GAME-05..08：满足则绿色直建并自动生成贴合斜坡的地基承台裙边；坡度过大拒绝或要求先整形推平/加装主题专属耐压浮台、隔热桥台或耐酸高脚桩基）。采矿设施、精炼厂与轨道港口之间用**三维 Catmull-Rom 连续样条**生成贴合地形起伏的传送带、管线与高架栈桥；实时货箱吞吐密度与殖民地人口岗位分配（jobsFilled）及**五类运行状态诊断（running、understaffed、starved_input、low_power、storage_full）保持 100% 同步**。

---

## 7. 22 项原子任务详表（doc7:275-307）★核心★

施工顺序铁律（doc7:277）：**P0 Render & Navigation Stability → P1 Triangulated Terrain Vertical Slice → P1 Authored Mission Site → P1 Theme System (Core 7) → P2 Theme Expansion (11) → P2/P3 Industry, Ecological Depth & Save Hardening**；6 个串行阶段（Phase 0–5）、共 22 个原子任务。严禁跳步或合并跨阶段大提交（doc7:282）。

### Phase 0 — P0 渲染故障止血与导航软锁解除（最高阻断级）

**TASK-0.1**（doc7:286）
- 提交代号：`fix(gl): attach depth24 rbo to scene float target and enforce explicit frame clear`
- 文件：`src/render/gl/GLCore.js`、`src/render/gl/PostProcessor.js`、`src/render/gl/PlanetSurface3D.js`
- 强制内容：GLCore.createFloatTarget 增加 `depth: true` 支持并挂载 `gl.DEPTH_COMPONENT24` 渲染缓冲；PostProcessor.beginScene() 强制复位 BLEND/SCISSOR/colorMask/depthMask 并执行 `gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)`；加固 SKY_FS 防 NaN。
- 绑定门禁：TERRAIN-02、TERRAIN-07、TERRAIN-08

**TASK-0.2**（doc7:287）
- 提交代号：`feat(devtools): add surface debug render modes and GL state snapshot logger`
- 文件：`src/render/gl/PlanetSurface3D.js`、`src/ui/screens/DiagnosticsView.js`
- 强制内容：实装 F3 切换的三档诊断渲染模式（unlit_nocull、wireframe_normal、winding_audit）；在 PlanetSurface3D 建立每个 Pass 的 CULL_FACE(CCW) 与 BLEND 进出恢复契约；支持导出渲染诊断 JSON。
- 绑定门禁：TERRAIN-02、TERRAIN-03

**TASK-0.3**（doc7:288）
- 提交代号：`fix(render): fix System3D GLOW_VERT double model transform and add orbit lerp`
- 文件：`src/render/gl/System3D.js`、`src/ui/screens/SystemView.js`
- 强制内容：合并序列 5 P0-01/P0-02——修复 GLOW_VERT 二次左乘 uModel 导致的二倍轨道半径辉光漂移；补齐 SystemView 双击行星平滑聚焦、右键径向菜单与未分类天体全息线框回波。
- 绑定门禁：GL-01、UI-01..03

**TASK-0.4**（doc7:289）
- 提交代号：`fix(ui): implement UIStateStore, RouteStack, safe sidebar layout, and fix GroundView softlock`
- 文件：`styles.css`、`src/ui/state/UIStateStore.js`、`src/ui/components/panels.js`、`src/app/App.js`、`src/ui/screens/GroundView.js`
- 强制内容：合并序列 5 P0-03..P0-07——实装 `.vf-view:not(.vf-view-immersive)` 左侧栏退避、UIStateStore 折叠状态与滚动保持、App.goBack() 路由栈、closeInspector() 守卫；修复 GroundView 简报页接收 planetId 参数、无条件渲染顶部返回按钮、响应 Escape 并开放未殖民行星 survey 入口。
- 绑定门禁：UI-04..07、NAV-01..04、GAME-02、GAME-10

### Phase 1 — 连续三角网格地形垂直切片（P0/P1 核心底座）

**TASK-1.1**（doc7:290）
- 提交代号：`feat(ground): implement deterministic planetSeeds and continuous terrainField generator`
- 文件：`src/domain/ground/planetSeeds.js`、`src/content/terrainProfiles.js`、`src/domain/ground/terrainField.js`
- 强制内容：建立 derivePlanetSeeds 子流隔离树；构建 512m×512m（8×8 区块）连续高度场与地质语义场（高度、坡度、曲率、湿度、温度、4 通道 materialWeights、TERRAIN_FLAGS）；实现曲率自适应对角线切分与严格 CCW 索引生成。
- 绑定门禁：TERRAIN-01、TERRAIN-02、SITE-06

**TASK-1.2**（doc7:291）
- 提交代号：`feat(ground): implement continuous surfaceQueries, raycastTerrain, and capsule grounding`
- 文件：`src/domain/ground/surfaceQueries.js`、`src/ui/screens/GroundView.js`
- 强制内容：实现重心坐标连续高度与法线插值查询 `sampleTerrain(x,z)`；Chunk AABB + 高度场步进射线求交 `raycastTerrain()`（替代体素 ddaRaycast）；角色胶囊体斜坡贴合碰撞与基于坡度代价图的地表 A* 寻路。
- 绑定门禁：TERRAIN-05

**TASK-1.3**（doc7:292)
- 提交代号：`feat(render): implement PlanetTerrainMesh with 3-level LOD, skirts, and triplanar splat shader`
- 文件：`src/render/gl/PlanetTerrainMesh.js`、`src/render/gl/PlanetAtmosphere.js`、`src/render/gl/PlanetSurfaceScene.js`
- 强制内容：构建分块三角网格 GPU 渲染器：LOD 0/1/2 视距分级、共享边界顶点对齐 + 垂直裙边（Vertical Skirt）+ 顶点 Geomorph 平滑过渡；编写手写 GLSL ES 3.0 世界空间三平面（Triplanar）4 层材质混合与行星曲率地平线着色器。
- 绑定门禁：TERRAIN-03、TERRAIN-04、TERRAIN-09

**TASK-1.4**（doc7:293）
- 提交代号：`feat(ground): bridge GroundMission and Colony buildings onto continuous triangulated terrain`
- 文件：`src/domain/ground/GroundMission.js`、`src/ui/screens/GroundView.js`
- 强制内容：通过 SiteTransform 将现有地面任务单位、敌人、NPC、目标物与殖民地建筑无缝吸附至三角网格表面高度与法线；确保在不破坏 GROUND-01..03 确定性与结算幂等的前提下跑通第一颗岩质/火星测试星。
- 绑定门禁：TERRAIN-05、GAME-09

### Phase 2 — 人工任务核心 + 过渡带 + 程序化外围（P1 关卡架构）

**TASK-2.1**（doc7:294）
- 提交代号：`feat(content): define MissionSiteBlueprint schema and 8 authored mission site templates`
- 文件：`src/content/missionSites.js`、`src/domain/ground/missionSiteFactory.js`
- 强制内容：定义 MissionSiteBlueprint 数据契约；实装 SDF 锚点整平与 Catmull-Rom 道路/河道样条雕刻算子，实现 Mission Core、Transition Ring 与 Procedural Frontier 三环无缝融合及 **6 项生成质量门禁自检**。
- 绑定门禁：SITE-01、SITE-03、SITE-04、SITE-06

**TASK-2.2**（doc7:295）
- 提交代号：`feat(ground): implement dual-route tactical layouts, landmark prefabs, and first-screen framing`
- 文件：`src/render/meshes/GroundMeshes.js`、`src/domain/ground/missionSiteFactory.js`、`src/ui/screens/GroundView.js`
- 强制内容：GroundMeshes.js 扩充主题地标 3D 网格；实装主路线（wide_safe）与侧翼绕行路线（narrow_risky）差异化掩体/危险区生成；着陆首帧镜头强制聚焦主视觉地标与首条路径引导。
- 绑定门禁：SITE-02、SITE-08

**TASK-2.3**（doc7:296）
- 提交代号：`feat(world): implement persistent planetPOI and WorldObjective spatial navigation`
- 文件：`src/domain/ground/planetPOI.js`、`src/domain/events/objectives.js`、`src/render/GalaxyRenderer.js`、`src/app/commands.js`
- 强制内容：合并序列 5 P1-01..P1-05 与序列 6 §6.6——在 galaxyGen.js 为每颗行星生成持久化 POI（挂载于外围地形三维坐标）；实装 HarvestPlanetPOI 幂等结算命令；空间事件 WorldObjective 星图 Pin 与离屏方向箭头。
- 绑定门禁：SITE-05、GAME-01..04、EVT-01..02

### Phase 3 — 行星主题系统与首批 7 大旗舰主题（P1 核心审美闭环）

**TASK-3.1**（doc7:297）
- 提交代号：`feat(content): implement planetThemes registry, orbital-to-surface visual sync, and theme RNG`
- 文件：`src/content/planetThemes.js`、`src/domain/world/galaxyGen.js`、`src/render/gl/System3D.js`
- 强制内容：建立 planetThemes.js 九维配置中心；galaxyGen.js 按天体物理约束与同星系去重规则分配 primaryThemeId；升级 System3D 行星着色器，使轨道远景直接反映 18 大主题的云带、冰盖、海沟、极光、晨昏线或熔岩裂谷轮廓。
- 绑定门禁：THEME-01、THEME-07

**TASK-3.2**（doc7:298）
- 提交代号：`feat(themes): implement red_regolith_frontier and obsidian_lava with arch bridges and lava rivers`
- 文件：`src/render/gl/PlanetTerrainMesh.js`、`src/render/meshes/GroundMeshes.js`、`src/domain/ground/terrainField.js`
- 强制内容：实装「赤砾边疆」（平顶桌山层理、沙波纹、红尘暴与太阳能波动）与「黑曜熔海」（高耸玄武岩山脊、HDR 黑体流动岩浆河、抛物线黑曜石高架拱桥生成与抢修通行机制）。
- 绑定门禁：THEME-02..05、GAME-05

**TASK-3.3**（doc7:299）
- 提交代号：`feat(themes): implement permafrost_furnace and dry_night_polar with heat-zone and aurora shaders`
- 文件：`src/render/gl/PlanetAtmosphere.js`、`src/render/gl/PlanetTerrainMesh.js`、`src/domain/ground/GroundMission.js`
- 强制内容：实装「永冬炉境」（中央热源塔、径向热区融雪凹陷着色器、等温线扫描图层与暴风雪窗口）与「永夜晶荒」（干燥黑岩+白盐晶多边形盆地、天幕紫色极光幕帘、无日光储能与防流星激光机制）。
- 绑定门禁：THEME-02..05、GAME-05

**TASK-3.4**（doc7:300）
- 提交代号：`feat(themes): implement abyssal_ocean, sulfur_marsh, and biolume_canopy with water and reactive glow`
- 文件：`src/render/gl/PlanetWater.js`、`src/render/gl/PlanetAtmosphere.js`、`src/render/gl/PlanetTerrainMesh.js`
- 强制内容：实装「碧渊海洋」（5 层水下光学：水路雾、RGB 波长吸收、阳光深度衰减、双波焦散、海洋雪与亚特兰蒂斯珊瑚穹顶/娜迦海神塔）、「硫雾沼泽」（低空体积毒气湖与硫磺喷气锥）与「星辉生物圈」（潘多拉压感脚步荧光涟漪与呼吸树冠网）。
- 绑定门禁：THEME-02..05、GAME-05

### Phase 4 — 高辨识度主题扩充（11 个扩展主题）与天体伴生结构（P2 宇宙丰富度）

**TASK-4.1**（doc7:301）
- 提交代号：`feat(themes): implement prism_crystal, salt_mirror_desert, cryomethane_sea, and tidal_lock_dusk`
- 文件：`src/content/planetThemes.js`、`src/render/gl/PlanetTerrainMesh.js`、`src/render/gl/PlanetWater.js`
- 强制内容：实装「棱镜晶原」（色散光斑与无线电干扰）、「镜盐荒原」（天空之镜反射盐壳）、「甲烷雾海」（高粘度暗青烃海与浮冰碎裂）与「晨昏环带」（永昼/永夜双极天空与狭长宜居暮光带跨区输能）。
- 绑定门禁：THEME-01..07

**TASK-4.2**（doc7:302）
- 提交代号：`feat(themes): implement cloud_giant_atolls, fungal_catacombs, ancient_megastructure, and glassstorm_barrens`
- 文件：`src/content/planetThemes.js`、`src/ui/screens/GroundView.js`、`src/render/gl/PlanetAtmosphere.js`
- 强制内容：实装「云海浮岛」（气态巨行星专属浮空采集平台与风暴探针，**严禁普通陆地登陆**）、「菌海深渊」（双层巨型菌盖穹顶与荧光孢子雨）、「机械圣骸」（远古金属装甲板与供能重启）及「硅晶风暴」（半透明玻璃沙丘与顺逆风磨蚀）。
- 绑定门禁：THEME-01..07、GAME-05

**TASK-4.3**（doc7:303）
- 提交代号：`feat(themes): implement magnetar_aurora, canopy_colossus, fractured_moon, secondary modifiers, and moons`
- 文件：`src/content/planetThemes.js`、`src/domain/world/galaxyGen.js`、`src/render/gl/System3D.js`、`src/render/AudioManager.js`
- 强制内容：实装「磁暴极光荒原」（周期性天空电离脉冲与电子系统静默）、「巨木云冠」（地面+树冠双层地图高度与藤蔓桥）、「碎环月」（0.25g 低重力跳跃与母星碎环背景）；实装次级主题修饰器、伴生卫星/小行星带及 18 主题 Web Audio 合成环境音。
- 绑定门禁：THEME-06、WORLD-02

### Phase 5 — 行星工业/生态/地形改造深化与存档硬化（P2/P3 终局收敛）

**TASK-5.1**（doc7:304）
- 提交代号：`feat(ground): implement terrainEdits brush, DSP-style terrain restoration, and flora transplanting`
- 文件：`src/domain/ground/terrainEdits.js`、`src/app/commands.js`、`src/ui/screens/GroundView.js`
- 强制内容：实装槽位 5 地形整形器（平滑/压平/抬升/一键恢复自然状态）与发光植物/晶簇回收再部署系统；每次编辑仅增量重建受影响 Chunk 并持久化压缩差异记录。
- 绑定门禁：TERRAIN-06、SITE-07、GAME-06

**TASK-5.2**（doc7:305）
- 提交代号：`feat(colony): implement slope-aware building foundations, theme pilings, and spline conveyors/bridges`
- 文件：`src/domain/planets/colony.js`、`src/render/meshes/GroundMeshes.js`、`src/ui/screens/GroundView.js`、`src/ui/screens/ColonyView.js`
- 强制内容：实装建筑底面 9 点三角网格投影坡度校验、自动地基承台与主题专属桩基（浮台/隔热基座/耐酸桩）；实装 Catmull-Rom 连续样条传送带、输热管与高架桥；合并序列 5 P2-01..P2-03（岗位 jobsFilled、五态 runtimeStatus 看板与四项审计技术债 TD1–TD4）。
- 绑定门禁：GAME-07、GAME-08、COL-01..04、ECON-02

**TASK-5.3**（doc7:306）
- 提交代号：`feat(persistence): implement v1-to-v2 surface save migration and 100-seed/100-mount stress suites`
- 文件：`src/persistence/MigrationRegistry.js`、`tests/suites/planetary-terrain-theme.suite.js`、`src/devtools/glGateTest.js`
- 强制内容：实装旧体素存档向连续三角网格与主题系统的无损迁移函数；新增 100 种子地表生成门禁套件与 100 次连续挂载/卸载地表 GL 资源零泄漏压测。
- 绑定门禁：SAVE-03..04、TERRAIN-01..09、THEME-01..07

**TASK-5.4**（doc7:307）
- 提交代号：`build(release): sync static bundle, verify file:// and subpath deployment, and update runbook`
- 文件：`tests/tools/build-static-bundle.mjs`、`dist/void-frontier.bundle.js`、`docs/AUTONOMOUS_RUNBOOK.md`、`README.md`
- 强制内容：重新运行打包器生成 dist/void-frontier.bundle.js；校准 README.md 与 AUTONOMOUS_RUNBOOK.md 测试套件计数；完成 file:// 与二级路径 `/void-frontier/` 全链路实机端到端验收。
- 绑定门禁：DEPLOY-01..02、E2E-02

---

## 8. 代码蓝本清单（doc7:309-619）

### 8.0 GLCore.js createFloatTarget（doc7:40-100）

- 签名：`createFloatTarget(width, height, { linear = true, depth = false } = {})`。
- 关键点：`_tracked.rbos` 登记与清理（resetTracking/destroy 调 `gl.deleteRenderbuffer`）；`make(floatMode)` —— float: `gl.texImage2D(..., gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)`，否则 RGBA8/UNSIGNED_BYTE；MIN/MAG_FILTER = linear?LINEAR:NEAREST；WRAP_S/T = CLAMP_TO_EDGE；FBO 挂 COLOR_ATTACHMENT0；`depth:true` → Renderbuffer `DEPTH_COMPONENT24` → DEPTH_ATTACHMENT；`checkFramebufferStatus` 验 FRAMEBUFFER_COMPLETE；float 不完备降级 RGBA8 重建；仍不完备 `throw new Error('float target FBO incomplete (WxH)')`；返回 `{ texture, fbo, rbo, width, height, float, hasDepth }`。

### 8.0b PostProcessor.js beginScene（doc7:104-125）

- 签名：`beginScene(clearColor = null)`；`if (this.tier >= 3 || !this._scene) return null;`
- 8 步契约（顺序）：bindFramebuffer(_scene.fbo) → viewport(0,0,_scene.width,_scene.height) → disable(SCISSOR_TEST) → disable(BLEND) → colorMask(true×3) → depthMask(true) → frontFace(CCW) + cullFace(BACK) + disable(CULL_FACE) → clearColor(cc || [0.02,0.03,0.06,1.0]) + clearDepth(1.0) + clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)。返回 `{ fbo, width, height }`。
- 配套：`_buildTargets()` 中 `this._scene = glc.createFloatTarget(w, h, { linear: true, depth: true })`，金字塔模糊缓冲 depth:false；`_releaseTargets()` 释放 `this._scene.rbo`（doc7:104）。

### 8.1 src/domain/ground/terrainField.js — 连续三角网格与曲率自适应对角线构建器（doc7:313-443）

- 导出签名：`export function buildTriangulatedChunkMesh(chunk, evalPoint)`。零外部依赖。
- 输入约定：`N = chunk.gridSize`（如 65），`cells = N - 1`（64），`step = (chunk.bounds.maxX - chunk.bounds.minX) / cells`，`ox = chunk.bounds.minX`，`oz = chunk.bounds.minZ`；`evalPoint(wx, wz)` 返回已融合宏观地貌 + MissionSiteBlueprint SDF 的高度评估 `{ y, weights[4], biomeId, flags, temp, moisture }`。
- **步骤 1 采样**（doc7:340-369）：双层循环 j,i ∈ [0,N)；`vIdx = j*N + i`；y 非有限则取 0.0；pos = (wx, y, wz)；`wgt[vIdx*4..+3] = sample.weights[0..3]`；`bio = sample.biomeId || 0`；`flg = sample.flags || 0`；`aux[vIdx*2] = sample.temp ?? 0.5`；`aux[vIdx*2+1] = sample.moisture ?? 0.0`；统计 chunk.bounds.minY/maxY。
- **步骤 2 曲率自适应对角线 + 严格 CCW**（doc7:371-397）：四角 `v00 = j*N+i`、`v10 = v00+1`、`v01 = (j+1)*N+i`、`v11 = v01+1`；**`checkerboardBias = (((i+j) & 1) === 0 ? -0.02 : 0.02)`**；`diffDiagA = |y00-y11| + checkerboardBias`；`diffDiagB = |y10-y01|`；`diffDiagA <= diffDiagB` 时输出三角形 `(v00,v01,v11),(v00,v11,v10)`，否则 `(v00,v01,v10),(v10,v01,v11)`——从 +Y 俯视逆时针，外法线朝 +Y。
- **步骤 3 面积加权法线累积 + 陡坡材质增强**（doc7:399-438）：先 `nor.fill(0)`；对每三角形用叉积 `(B-A)×(C-A)` 累加到 3 个顶点；随后逐顶点 `len = Math.hypot(nx,ny,nz) || 1.0` 归一化，**`if (ny < 0) 全分量取反`**（强制朝上）；切线 `t = (ny, -nx, 0)` 再归一化；陡坡增强：`if (ny < 0.86)` → `cliffFactor = min(1.0, (0.86 - ny) / 0.38)`，`addG = Math.round(cliffFactor * 200)` 加到材质通道 1（崖壁，clamp 255），再按四通道总和归一到 255（`w3 = max(0, 255 - w0 - w1 - w2)`）。
- 收尾：`chunk.meshRevision = chunk.sourceRevision; chunk.dirty = false; return chunk;`

### 8.2 src/render/gl/PlanetTerrainMesh.js — 多主题连续地形与光学着色器（doc7:445-619）

统一管线整合：DSP 行星曲率、三平面岩层纹理、Frostpunk 热区融雪凹陷、Avatar 压感脚步荧光涟漪、AquaMan 水下双波焦散与波长吸收、黑曜熔海裂隙黑体自发光。

**TERRAIN_MESH_VS**（GLSL ES 3.00，`#version 300 es` 由 GLCore 自动前置；doc7:450-490）
- Attributes：`aPos`(loc 0, vec3)、`aNormal`(1, vec3)、`aWeights`(2, vec4)、`aAux`(3, vec2)。
- Uniforms：`uVP`(mat4)、`uCamPos`(vec3)、`uPlanetCurveInv2R`(float, **= 1.0 / (2.0 * 1800.0)**)、`uHeatZoneCount`(int)、`uHeatZones[8]`(vec4: x, z, radius, intensity)。
- 热区累积：`heat += hz.w * (1.0 - smoothstep(hz.z * 0.60, hz.z, distance(worldPos.xz, hz.xy)))`，循环 8 次按 uHeatZoneCount break，`heat = clamp(heat, 0.0, 1.0)`。
- 融雪凹陷：`worldPos.y -= heat * 0.32 * aWeights.x`（0.32m，按材质通道 0=积雪权重缩放）。
- 行星曲率：`dCam = worldPos.xz - uCamPos.xz; distSq = dot(dCam,dCam); curvedPos = vec3(worldPos.x, worldPos.y - distSq * uPlanetCurveInv2R, worldPos.z)`。
- Outputs：`vWorldPos`（**未弯曲**的世界坐标）、`vNormal`、`vWeights`、`vAux`、`vHeatField`；`gl_Position = uVP * vec4(curvedPos, 1.0)`。

**TERRAIN_MESH_FS**（doc7:493-619）
- Uniforms：`uCamPos, uSunDir, uSunColor, uFogColor`(vec3)、`uFogRange`(vec2)、`uTime, uHdr`(float)、`uMatCol0..3`(vec3)、`uThemeFx`(vec4: **x=waterLevel, y=biolumePulse, z=lavaEmissive, w=debugMode**)、`uFootsteps[8]`(vec4: x, z, triggerTime, strength)。输出 `fragColor`。
- 噪声：`hash31(vec3 p)`（fract(p*0.1031) + dot(p, p.yzx+31.32) 哈希）与 `noise3D(p)`（三线性插值 value noise，f*f*(3-2f) 平滑）。
- 调试分支：`dbg==3` → `gl_FrontFacing ? vec4(0.1,0.9,0.3,1) : vec4(1.0,0.0,0.8,1)` 直接返回（绕序审计）；`dbg==2` → 法线 RGB（N*0.5+0.5）叠加 1m 世界格线（`abs(fract(vWorldPos)-0.5)`，smoothstep(0.02,0.06) 提取，黄色 vec3(1.0,0.9,0.2) 权重 0.6）。
- 软硬边法线：`smoothN = normalize(vNormal)`；`flatN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)))`；`hardBlend = smoothstep(0.82, 0.55, smoothN.y)`；`N = normalize(mix(smoothN, flatN, hardBlend * 0.65))`。
- 岩层理：`detailXZ = noise3D(vec3(x*0.8, 0.0, z*0.8))`；`strata = 0.82 + 0.36 * sin(y * 2.6 + detailXZ * 2.2)`。
- 4 通道混合：`w = vWeights / max(sum(weights), 1e-4)`；`baseCol = uMatCol0 * (0.88 + 0.24*detailXZ)`（vHeatField>0.01 时向 vec3(0.14,0.10,0.08) 按 smoothstep(0.15,0.65,heat) 混合为湿润冻土）；`cliffCol = uMatCol1 * strata`；`biomeCol = uMatCol2 * (0.85 + 0.30*noise3D(vWorldPos*1.4))`；`roadCol = uMatCol3`；`albedo = baseCol*w.x + cliffCol*w.y + biomeCol*w.z + roadCol*w.w`。
- 光照：`ndl = max(dot(N, uSunDir), 0)`；`hemi = 0.38 + 0.24*(N.y*0.5+0.5)`；`lit = albedo * (uSunColor*ndl*0.82 + hemi)`；热区加发光：`lit += albedo * vec3(1.85, 0.82, 0.24) * vHeatField * 0.95`。
- 生物荧光（uThemeFx.y > 0.5）：`pulse = 0.55 + 0.45*sin(length(xz)*0.35 - uTime*2.2)`；`bioVein = smoothstep(0.62, 0.88, noise3D(vWorldPos*1.9)) * w.z`；`lit += uMatCol3 * bioVein * pulse * 1.6`；**脚步涟漪**：遍历 uFootsteps[8]，`age = uTime - fp.z`，有效条件 `fp.w > 0.01 && 0 <= age < 3.5`；`rRing = age * 4.2`（扩散半径）；`ring = exp(-((dFoot - rRing)^2) / 0.20) * exp(-age * 1.1) * fp.w`；`lit += vec3(0.26, 0.95, 0.82) * ring * 2.2`。
- 岩浆自发光（uThemeFx.z > 0.5 且 y < -1.5）：`flow = noise3D(vec3(x*0.55 + uTime*0.35, y, z*0.55))`；`crack = smoothstep(0.42, 0.78, flow)`；`lavaCol = mix(vec3(0.90,0.16,0.04), vec3(2.80,1.35,0.22), crack)`（HDR 黑体）；`lit = mix(lit, lavaCol, smoothstep(-1.5, -3.2, vWorldPos.y))`。
- 水下（waterLv = uThemeFx.x > -90.0 且 y < waterLv）：`depth = waterLv - y`；两组反向滚动焦散 `uv1 = xz*0.38 + vec2(t*0.18, t*0.11)`、`uv2 = xz*0.42 - vec2(t*0.14, t*0.19)`；`c1/c2 = abs(sin(uv.x*π)*cos(uv.y*π))`；`caustic = pow(1 - min(c1,c2), 4.0) * exp(-depth*0.08) * ndl`；`lit += vec3(0.25,0.92,0.88) * caustic * 1.35`；RGB 波长吸收 `lit *= exp(-depth * vec3(0.12, 0.038, 0.014))`（红衰减最快）。
- 雾与输出：`fog = smoothstep(uFogRange.x, uFogRange.y, distance(vWorldPos, uCamPos))`；`fragColor = vec4(mix(lit, uFogColor, fog) * uHdr, 1.0)`。

> 诊断模式与 §2.2 F3 三档的对应：dbg==2 线框/法线、dbg==3 绕序审计；unlit_nocull（模式 1）在渲染器侧控制。

---

## 9. 门禁清单 A-D（doc7:621-665）★全项★

总则（doc7:623）：不得以"代码已提交""WebGL Draw Call 未报错"替代玩家体验验收；每阶段合入主分支前逐项通过四大类硬性门禁（原文称"共 41 项"，逐 ID 实数 45，见文末异常注记）。

### 9.1 清单 A：地形几何、背面剔除与无重影渲染（TERRAIN-01..09 & GL-01，doc7:625-636）

- **TERRAIN-01 三角网格生成有限值断言**：固定种子批量生成 100 张以上主题地表，所有顶点位置、法线、切线与矩阵均无 NaN/Infinity，无零面积退化三角形，无越界索引。
- **TERRAIN-02 三角绕序与背面剔除一致性**：所有朝上地面三角形满足 (v1-v0)×(v2-v0) 与外法线点积为正；无剔除诊断模式与 gl.frontFace(CCW)+gl.enable(CULL_FACE) 正式模式得到完全一致的正面可见结果，零地表消失破洞。
- **TERRAIN-03 软硬边法线与消除规则斜线**：斜坡漫反射光照连续平滑，断崖与晶柱硬边折角清晰，远景与中景无肉眼可见的单一方向规则斜线网格纹理。
- **TERRAIN-04 地形分块 LOD 零裂缝**：相机移动与缩放跨越 LOD 0/1/2 边界时，共享边界对齐、垂直裙边与 Geomorph 生效，零裂缝（Watertight）、零明显 Pop 跳变。
- **TERRAIN-05 连续三角网格碰撞贴合**：角色、队友、敌军与 NPC 脚底严格贴合三角网格表面，走过斜坡与黑曜石拱桥时零穿地、零悬空漂浮。
- **TERRAIN-06 局部地表修改增量重建**：地形整形器修改局部地表后，仅更新受影响的 1–4 个 Chunk，邻接区块边界高度与法线连续。
- **TERRAIN-07 场景 FBO 深度生效与背景零重影**：PostProcessor._scene 挂载 24 位深度缓冲且每帧显式清除 COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT；连续 10 分钟相机 360° 旋转、缩放与快速移动，天空与背景零历史帧残影累积。
- **TERRAIN-08 WebGL 上下文恢复与 100 次挂载零泄漏**：触发 webglcontextlost 与 webglcontextrestored 后地形、天空与 HUD 完整恢复；连续加载/卸载地表场景 100 次，GL 资源清册零泄漏、无残留 requestAnimationFrame 循环。
- **TERRAIN-09 屏幕空间三角密度与帧率预算**：近景细、远景粗，常规桌面设备稳定达到 60 FPS 目标（低配 Tier 2 稳定 ≥ 30 FPS）。
- **GL-01 星系轨道大气辉光对齐**：在 System3D 中检验 orbitIndex 为 0, 1, 3, 7 的行星，GLOW_VERT 辉光壳体中心与行星本体中心完全重合，零二倍轨道半径漂移。

### 9.2 清单 B：18 主题辨识度与九维一致性（THEME-01..07，doc7:638-646）

- **THEME-01 轨道远景盲测识别**：隐藏 UI 文本，仅凭 System3D 行星球面轮廓、色块、极冠、云带、晨昏线或熔岩裂谷即可辨识主主题身份。
- **THEME-02 地表中景地貌与天气一致性**：18 个主题各自具备专属地貌高度场、主材质、天空散射与天气粒子（绝非同一高度图改 uTint）。
- **THEME-03 地表近景材质细节**：角色近景可清晰辨认三平面岩层纹理、盐晶裂纹、水下焦散或脚步压感荧光涟漪，不形成平铺噪点。
- **THEME-04 主题专属玩法规则**：每个主题至少改变一种移动、环境生存、采集、建筑地基或任务规则（如碧渊水压与潮汐、永冬热源塔保温、赤砾沙暴降太阳能、永夜无光储能、硫雾低地毒气腐蚀、星辉夜间压感生态、黑曜高架拱桥通行、云海气态星浮空平台与探针等）。
- **THEME-05 主题资源与经济回写**：主题独特产出真实进入殖民地仓储、派系账本、制造配方或科技树，零纯展示假数据。
- **THEME-06 主题混合与同星系去重**：次级修饰器不掩盖主主题视觉身份；同一星系内相邻同类别行星优先分配不同主主题。
- **THEME-07 跨种子多样性与身份恒定**：同一主题在不同种子下局部山脉与河道有自然变化，但主题色板、地标语法与核心机制保持一致。

### 9.3 清单 C：人工任务核心、过渡带与程序化外围（SITE-01..08 & UI/NAV-01..07，doc7:648-658）

- **SITE-01 人工任务核心完备性**：100% 包含平整着陆区、主视觉地标、辅助地标、主/次目标物、掩体与初始即存在的撤离点。
- **SITE-02 双路线战术差异**：至少两条可行路线（route_main 宽阔稳健、route_flank 狭窄高险或需修桥绕后），风险、时间与视野有显著差异。
- **SITE-03 任务主线与撤离可达性**：validateGeneratedSite 路径连通测试 100% 通过，随机装饰物绝不堵死关键通路或撤离点。
- **SITE-04 过渡带无缝衔接**：Mission Core 经 Transition Ring 到 Procedural Frontier 的高度场与材质权重连续渐变，无突变拼缝。
- **SITE-05 外围分层内容密度**：外围按距离分层生成次要地标、矿脉节点与持久化 POI，绝不出现无限空白平地。
- **SITE-06 种子确定性与主 RNG 零污染**：相同 world.seed + blueprintVersion + generatorVersion 生成结果逐字节一致，且不改变主 world.rng 序列。
- **SITE-07 地表编辑与状态持久化**：地形整形、已建建筑、样条道路/桥梁与已完成 POI 在保存并刷新页面后完整恢复。
- **SITE-08 首屏构图引导**：玩家着陆首帧自动聚焦主视觉地标与首条建议路径。
- **UI/NAV-01..07 全局导航与状态保持**（doc7:658，单条合并列出）：星系双击聚焦、右键径向菜单、管理视图左侧栏退避、UIStateStore 保持 Collapse 展开与滚动位置、GroundView 简报返回按钮与 Escape 回退、跨视图自动收起 Inspector 100% 通过。

### 9.4 清单 D：GamePlay 闭环、旧档迁移与静态部署（GAME-01..10 & SAVE/DEPLOY，doc7:660-665）

- **GAME-01..04 先遣勘探与 POI 幂等结算**：轨道扫描逐级揭示主题与 POI 情报；未殖民行星可直接进入 survey 先遣勘探；采样与 HarvestPlanetPOI 奖励正确回写 World 且重复触发/重进/读档绝不二次发奖。
- **GAME-05..08 环境危险、地形工具、坡度地基与样条物流**：主题环境实际影响防护/移动/视野/耗材；地形整形器实际改变通行与可建性；建筑按三角网格坡度校验并生成地基承台；样条传送带/管线连通且吞吐量与账本一致。
- **GAME-09..10 任务回写与零软锁返回**：任务成功、失败与中止结果幂等回写主世界；任何地表子模式均可一键返回所属恒星系或银河星图，零软锁。
- **SAVE-04 与 DEPLOY-01..02 旧档迁移与双模部署**：旧版体素存档迁移至新版连续地形后资源账本与任务记录零丢失、零重复；全量自动化测试套件双轮 100% PASS；./dist/void-frontier.bundle.js 同步更新，file:// 本地直玩与 GitHub Pages 二级路径模拟部署零 404、零外部网络请求、零未捕获异常。

---

## 10. 开工纪律与交付物模板（doc7:667-674）

进入工作区后必须遵循的交付纪律（doc7:669 声明"十项"，正文编号列出 4 条，其中第 4 条含 10 项交付物）：

1. **开工前基线核查**（doc7:671）：执行 `git status`、`git log -n 5` 与 `npm test`，确认工作树干净且 52/52 PASS 基线完好；记录旧体素实现与本方案目标实现的模块映射清单；严禁先删文件再查依赖。
2. **先写失败测试，再写实现代码**（doc7:672）：进入每个 Phase 时先为该阶段阻塞门禁编写自动化断言或诊断日志（Phase 0 先写 FBO 深度附件断言与 GL 状态快照记录器；Phase 1 先写 TERRAIN-01..03 网格有限值与 CCW 法线点积单测）。
3. **严格遵守串行波次**（doc7:673）：Phase 0 的地形消失与背景重影未彻底根治、§9.1 门禁未全绿前，严禁跨阶段编写新主题或新建筑代码。
4. **每阶段十项标准交付物**（doc7:674）：每个 Phase 完成并提交 Git 后，在 `docs/AUTONOMOUS_RUNBOOK.md` 按序列 6 §13.4 格式输出：(1) 阶段目标与范围；(2) 代码变更文件清单；(3) 数据 Schema 与接口变更；(4) 固定种子、浏览器环境与复现步骤；(5) Node 侧自动化测试套件结果；(6) 真实浏览器人工 E2E 操作步骤与结果；(7) 实机高分辨率截图路径（必须涵盖轨道全景、地表远景、地表中景、角色近景、人工任务核心、外围过渡区域、F3 线框/法线/绕序诊断图）；(8) 实测性能数据（FPS、三角形总数、Chunk 数、Draw Calls、内存占用、单次 Mesh Rebuild 耗时）；(9) 遗留风险与回退策略；(10) 当前 Git Commit 哈希与下一步最小原子任务。

---

## 附录：异常与阅读注意事项

1. **内嵌 base64 图片**：doc7:716/742/746/752 为 `[image1/14/16/19]: <data:image/png;base64,...>` 定义（270KB/3.2KB/3.9KB/172KB），Read 工具按 2000 字符截断，但纯像素数据无文字内容；全文共 19 张内嵌图（image1-19，定义行分散在 doc7:716-752），文中以 `![][imageN]` 引用。
2. **公式图未 OCR**：image2-18 为坐标/公式截图，无法直接读取。关键公式已从上下文与 §8.2 着色器蓝本反推：行星曲率修正 `y -= distSq/(2R)`（R=1800m，doc7:149/458/482）；RGB 水下吸收 `exp(-depth*vec3(0.12,0.038,0.014))`（doc7:200/611）；对角线高差 |y00-y11| vs |y10-y01|（doc7:159/386-387）。**唯 image17/18 的建筑可建性高度差与坡度阈值数值无法从文本恢复**（doc7:273），实现时需回读原文图片或以 GAME-05..08 门禁语义（绿色直建/过大拒绝）自定合理阈值。
3. **门禁计数不一致**：doc7:623 称"四大类共 41 项"，逐 ID 清点实为 **45 项**（TERRAIN 9 + GL 1 + THEME 7 + SITE 8 + UI/NAV 7 + GAME 10 + SAVE-04 1 + DEPLOY 2）。
4. **被任务表引用但 §9 未定义验证项的门禁 ID**：SAVE-03（TASK-5.3 引用 SAVE-03..04，§9.4 仅定义 SAVE-04）；EVT-01..02（TASK-2.3）、WORLD-02（TASK-4.3）、COL-01..04 与 ECON-02（TASK-5.2）、E2E-02（TASK-5.4）——这些应在序列 5/6 门禁体系中落地。UI-01..07 / NAV-01..07 在 §9.3 被压缩为单条 "UI/NAV-01..07"（doc7:658），无逐项验证文本。
5. **主题 ID 拼写不一致**：doc7:192 的 4.1 标题写 `abyssa_ocean`，doc7:171 矩阵与 doc7:300 任务表均为 `abyssal_ocean`（以 abyssal_ocean 为准）。
6. **章节计数口径**：doc7:669 称"十项交付纪律"但仅列 4 条（第 4 条内含 10 项交付物，疑为"十项标准交付物"的混称）。
7. **句尾引用标记**：几乎每句末尾的孤立"1"/"2"/"3"等为脚注引用编号（指向 doc7:678-714 的"引用的著作"），非内容成分。
8. **任务数核对**：Phase 0×4 + Phase 1×4 + Phase 2×3 + Phase 3×4 + Phase 4×3 + Phase 5×4 = **22**，与 doc7:277 声明一致。
