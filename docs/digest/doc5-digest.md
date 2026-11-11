# doc5 摘要：《无垠边疆：星海纪元》全栈架构收敛与核心体验闭环施工全套方案

> 源文件：`[REDACTED]\docs\specs\5_无垠边疆全套施工方案.md`（1111 行 + 末行 [image56] 定义，~1.1MB）。
> 本文为实施级摘要，行号引用格式 `doc5:NNN`，可直接回查原文。
> **阅读注意**：原文所有行内数学公式（矩阵证明、容差、分布统计）与截图均为内嵌 base64 PNG（`[image1]`…`[image56]`，定义在 doc5:1002-1112），非文本。本摘要按上下文还原其语义；个别精确 LaTeX（如 GL-01 的容差符号）需解图确认。

**文档标识**：PLAN-MASTER-VOID-FRONTIER-202611-FULL（doc5:3）
**关联案卷**：MANDATE-RFP-VOID-FRONTIER-202611-01（专家调研委托书）¹、AUDIT-SPEC-VOID-FRONTIER-202611（负责人审计报告）²、专家诊断报告 report.md ³（doc5:4）
**工程基线**：GitHub main @ `2d471a5e35db4fb8f9cb5b58d3fcb79dbedff9d2`（含前序基线 `071961a` 全部资产；129 源模块 / 35,192 行原生 JS；26 个自动化测试套件 × 2 轮 = 52/52 PASS）（doc5:5）

---

## 1. 执行摘要与三大系统收敛铁律（doc5:7-18）

### 1.1 二元悖论：工程底座成熟度 vs 玩家体验断裂带（doc5:9-13）

- **底座（准工业级，审计评分 9.2/10.0）**：单向命令总线（CommandBus 事务验证 + 深拷贝回滚）、xoshiro128** 种子级确定性 PRNG、分级时钟管线（TickPipeline 时/日/月/季）、原生 WebGL 2.0 双画布合成（40,000 粒子对数旋臂银河、史瓦西度规 72 步光线步进黑洞、球面散射大气、64×24×64 体素地表）、IndexedDB→localStorage→InMemory 三级降级存储（doc5:11）。CI 由 22 套件扩至 26 套件，双轮 52/52 全绿（doc5:11）。
- **断裂（52/52 全绿 ≠ 浏览器内玩家意图流转正确）**：八大痛点本质是 **World State / Ephemeral UI State / Spatial Route Stack / Operational Entities 四者缺乏统一连接契约** 的集中爆发（doc5:12）。典型实测症状：
  - 视觉/空间导航：SystemView 只有单击拾取+卡片高亮，缺双击聚焦、右键径向菜单、键盘直达；System3D.js 大气顶点着色器 `GLOW_VERT` 存在 uModel 二次复合数学错误，行星辉光壳体漂移至 **2× 轨道半径** 处（doc5:12）。
  - 状态机/布局：`.vf-sidebar`（46px→176px）在管理界面无退避遮挡内容；`SystemView.onSnapshot()` 每 250ms `clearEl(this._dossier)` 暴力清 DOM，抹掉手风琴折叠态与滚动位置；进 GroundView 时路由不传行星 ID、不清右侧 Inspector、无殖民地时 `_setHead('简报', [])` 返回按钮为空且屏蔽 Escape → **永久软锁死**（doc5:12）。
  - 玩法/导引：叙事事件（如 evt_pirate_raid）只做纯文本弹窗+账本加减，无 WorldObjective/星图 Pin/离屏箭头；未殖民星球有完整 3D 体素网格却被"尚无玩家殖民地"硬拦截，无持久化 POI 与先遣科考 → 玩家感知"每个星系只有两颗星球、宇宙空旷如荒漠"（doc5:12）。

### 1.2 三大系统收敛铁律（doc5:18）

1. **单向数据流与瞬态 UI 状态彻底解耦（Data-UI State Separation）**：领域状态 `world.*` 继续由 CommandBus 与 SnapshotBuilder（4Hz 只读浅快照）权威驱动；所有视图的展开/闭合、滚动偏移、选中高亮、表单焦点、相机插值目标一律收归前端 **UIStateStore** 独立持有，由细粒度 DOM 差异比对与局部补丁算子消费快照；**彻底废除 `innerHTML = ''` / `replaceChildren()` 式暴力重建**。
2. **防御性视图栈与全局单例守卫契约（Defensive View Stack & Singleton Guard）**：任何路由跳转必须压入结构化历史返回栈（RouteStack）；任何叶子视图（尤其 GroundView 简报与探索态）必须**无条件**渲染顶部返回导航条并响应 Escape 逐级回退；全局抽屉 Inspector 的显隐与重绑定严格受控于路由生命周期守卫。
3. **空间感知先于殖民开发（Exploration Precedes Colonization）**：打破"无殖民地即不可登陆、无文本外即无事件目标"；在 `World.entities` 正式引入 **objectives（空间任务目标）** 与 **pois（行星持久化兴趣点）** 两类一等公民实体，使每个事件弹窗在星图有迹可循、每颗荒芜星球在建前哨前具备科考采样与遗迹发掘价值。

### 1.3 文档基线对齐准则（doc5:17）

- 严格恪守《星际游戏长线研发任务书》最高准则：**单一游戏应用、统一 World 实体模型、单一确定性模拟内核、全系统命令与事件互联**。
- **严禁**套用《[REDACTED]》面向八个独立科学模拟沙盒的 `{5,1,4,3,6,8,7,2}` 目录拆分模式——不得把殖民、外交、行星、战斗拆成互不关联的小游戏。
- 将 README.md 与 AUTONOMOUS_RUNBOOK.md 中滞后的"22 个测试套件"统一校准为当前 CI 实跑的 **26 个**自动化测试套件（52 轮断言）。

---

## 2. 标杆机制移植矩阵与四层空间交互协议（doc5:20-37）

### 2.1 标杆作品核心机制解构与移植矩阵（doc5:24-31）

设计光谱横跨宏观大战略、星系轨道运营、行星体素沙盒、小队战术动作四维度；从十款标杆萃取底层操作语法与反馈闭环，映射到 L1–L4：

| 层级 | 标杆对标 | 萃取交互范式 | 本工程落地模块与机制映射 |
| :--- | :--- | :--- | :--- |
| **L1 银河战略层** | Stellaris、WOW、Endless Space 2 | ① 地图模式图层与双击星系平滑切入；② 事件目标 Pin 锚定、右侧任务追踪栏（Objective Tracker）、屏幕边缘离屏方向指示器；③ 势力边界与航路威胁脉冲高亮 | GalaxyView.js / GalaxyRenderer.js：新增 WorldObjective 追踪浮窗与离屏箭头（基于 atan2 视口边缘钳制）；劫掠/危机航路琥珀色与红色脉冲着色 |
| **L2 星系空间层** | Endless Space 2、KSP、EVE Online | ① 单击选中检视、双击相机平滑推近（Orbit Lerp）聚焦天体；② 右键径向快捷动作环（Radial Action Menu）；③ 航行机动前 ETA/燃料/风险预演；未探测天体显示雷达回波虚影 | SystemView.js / System3D.js：绑定 dblclick 弹簧阻尼运镜聚焦+行星详情抽屉；右键 `.vf-radial-menu`（扫描/前哨/先遣登陆/聚焦）；`surveyedLevel < 2` 天体渲染全息扫描线框回波 |
| **L3 行星经营探索层** | Dyson Sphere Program、Stonehearth、Shapez/Planetbase | ① 探索先于殖民：轨道扫描发现持久化 POI → 先遣队采样 → 评估建站；② 居民岗位分配（矿工/工程师/运输员/科学家）决定设施实际开动率；③ 采掘、传送带物流、精炼加工与阻塞原因可视化分离 | ColonyView.js / colony.js / galaxyGen.js：每行星确定性生成 1–3 个持久化 POI；实装 jobsFilled 岗位分配权重与物流吞吐瓶颈诊断标签；气态巨行星专属"高空浮空采集与风暴探针"模式 |
| **L4 局部战术行动层** | Terraria、Astroneer | ① 第三人称越肩/弹簧臂直接操控、快捷工具栏（武器/扫描仪/地形采掘枪）即时切换；② 体素地形实时挖掘（DDA 射线求交）与结构建造、矿物即时入账并持久化 | GroundView.js / SurfaceSandbox.js：开放无殖民地限制的 survey（先遣勘探）入场模式；3D 地表 POI 信标光柱渲染、交互采样引导与 HarvestPlanetPOI 幂等结算回写 |

### 2.2 四层无断点操作语法契约（doc5:33-36）

每层视图任意时刻必须传达三要素：**当前空间坐标、眼前对象支持的直接动作、操作后推进或安全退回的路径**。统一跨层级输入语义：

- **左键单击**：仅承担非破坏性空间拾取与上下文检视（GalaxyView 选中星系、SystemView 选中行星并联动高亮右侧卡片、GroundView 主武器/采掘准星），**绝不触发突兀的跨屏路由跳变**。
- **左键双击**：严格定义为"空间层级向下推进或镜头平滑聚焦"算子——GalaxyView 双击星系节点切入 `#/system/<systemId>`；SystemView 双击行星触发相机平滑插值推近该行星轨道（Camera Orbit Lerp）并展开行星深层操作舱；再次双击或点主操作按钮进入 `#/colony/<colonyId>` 或 `#/ground/<planetId>`。
- **右键单击**：在 SystemView 与 GalaxyView 画布天体上抑制浏览器原生上下文菜单，弹出以光标为圆心的径向战术动作环，直接暴露四项高频空间指令：**轨道扫描、建立前哨、派遣先遣队登陆、设为舰队目标**——消除三维画布与右侧折叠列表间的长距离鼠标往返摩擦。
- **键盘**：Enter/Space 对当前选中天体执行默认推进动作；**Escape 绑定为全局防御性视图栈回退热键**，确定性逃逸序列：关闭径向菜单 → 取消天体聚焦回到星系全景 → 退出地表简报/自由探索返回所属星系 → 从星系返回银河星图 → 打开系统主菜单。

---

## 3. 痛点 1–8 逐条根治方案

> 原文章节编号为痛点三/二/四/五/六+一/七/八（痛点一与痛点六合并成节），末节为工业物流深化+四项技术债（无独立痛点编号）。终审口径：5 项 P0 级交互状态机与着色器变换缺陷 + 3 项 P1 级空间导引与前殖民期探索闭环缺失（doc5:971）。

### 3.1 痛点三：大气辉光二倍轨道半径漂移（doc5:40-148）— P0

**根因（数学证明，doc5:42-55）**：`src/render/gl/System3D.js` 中行星本体 `_drawPlanets` 与大气壳层 `_drawGlows` 共用正二十面体细分球 `_vaoSphere`（单位球顶点 aPos）。本体侧模型矩阵由 `mat4TRS(...)` 构建（内含轨道平移 T(C) 与均匀缩放），`PLANET_VERT` 正确单次变换：`w = uModel * vec4(aPos,1.0); gl_Position = uMVP * vec4(aPos,1.0)`。而 `_drawGlows` 的 CPU 端先构建纯平移矩阵 `T(C) = mat4Translate(s.model, e.world[0..2])`，并计算已含 T(C) 的复合矩阵 `uMVP = P·V·T(C)`；但 `GLOW_VERT` 却执行：

```glsl
vec4 w = uModel * vec4(aPos * uRadius, 1.0);  // 第一次左乘 uModel
gl_Position = uMVP * w;                        // uMVP 内部已含 uModel → 第二次左乘！
```

即裁剪坐标 = `P·V·T(C)·T(C)·(aPos·uRadius)`——**平移矩阵被执行了平方**。恒星位于世界原点、行星轨道位置向量为 C，故辉光壳体几何中心被精确推远至 **2C，即距恒星中心恰好 2× 行星轨道半径**；且 `GLOW_FRAG` 收到的插值 vWorld 停留在 C、屏幕光栅化位置却在 2C，视线向量与菲涅尔边缘角同步失真。

**处方**（doc5:56-148）：
1. **全仓 WebGL 2.0 着色器统一矩阵契约**：凡传入 uMVP（P·V·M）的顶点着色器，`gl_Position` 必须且只能直接左乘局部空间坐标 localPos（仅缩放一次）；uModel 仅用于计算世界空间 vWorld（供光照与视线求值）；法线变换统一用归一化模型旋转矩阵或逆转置矩阵。
2. 重写 `GLOW_VERT`：`localPos = vec4(aPos*uRadius,1); worldPos = uModel*localPos; vWorld = worldPos.xyz; vN = normalize(mat3(uModel)*aPos); gl_Position = uMVP*localPos`（doc5:61-77）。
3. 重写 `GLOW_FRAG` 大气散射模型（doc5:79-116）：双幂次菲涅尔（外缘 `pow(1-ndv,2.4)×0.75` + 内缘 `pow(1-ndv,5.0)×0.45`）；日照相位 `dayFactor = smoothstep(-0.22,0.35,ndl)`；晨昏线窄带高斯 `exp(-pow((ndl-0.02)/0.16,2))×fresnelOuter`（瑞利红移/琥珀暖色 `mix(uTint, vec3(1.0,0.48,0.18), 0.65)`）；前向散射 `pow(max(dot(-V,L),0),4)×0.35`；`illumination = (0.12+0.88×dayFactor) + forwardScatter×dayFactor`；`alpha = clamp(fresnel×illumination×uPower, 0, 1)`；`fragColor = vec4(scatterColor×alpha×uHdr, alpha)`。
4. 校准 `_drawGlows` 驱动端（doc5:118-148）：`s.model` 仅承载平移 T(C)；球体缩放由 `uRadius = e.radius × shellScale` 承担；逐行星从 `GLOW_STYLE[category]` 取 shellScale/power/tint 并上传 `uCenter/uTint/uPower`；`mat4Multiply` 链 `vm = view×model`、`vp = proj×vm` 后绑定 `uMVP`、`uModel`。

**文件/函数**：`src/render/gl/System3D.js`（GLOW_VERT、GLOW_FRAG、_drawGlows）。
**验收门禁**：GL-01（见 §5）。

### 3.2 痛点二：恒星系天体构成扩充、视锥自适应运镜与未探测回波（doc5:150-296）— P3 波次施工

**根因（三重叠加，doc5:152）**：
1. **战争迷雾与调查层级过滤**：`SystemView.js _buildDossier()` 在 `lvl < 2`（未完成「分类」扫描）时右侧面板只渲染一行静态提示"完成「分类」层级后揭示行星情报。"，完全隐藏天体数量；3D 画布上未扫描行星无"未知引力源"雷达回波框、无编号标签，暗色小行星（lava/rocky 半径仅 0.09~0.105 世界单位）融入深空背景，肉眼仅见 1–2 颗近恒星/带环亮星。
2. **轨道相位与视口裁剪**：`System3D.js _layout()` 初始轨道角 `ang = (orbit/n)×TAU + tick×0.0004 + time×0.008` 构成单调递增阿基米德螺旋，相邻轨道行星在倾斜透视下拥挤同侧象限；右侧常驻 340px `.vf-float-panel` 毛玻璃面板遮挡相机对准屏幕几何中心时的右侧外圈轨道。
3. **天体构成单一**：`galaxyGen.js` 仅生成一级 planets，缺天然卫星（Moons）、小行星带（Asteroid Belts）与柯伊伯带结构。
- **RNG 无截断**（澄清）：`RNG.intRange(world, 2, 8)` 数学上是严格闭区间均匀分布，理论期望值 5——"只有 2 个星球"是感知问题不是生成问题（doc5:152）。

**处方（doc5:153-296）**：
1. **确定性子流扩充，不破坏 52 项回归与 golden.json 主随机流**：用 `src/core/rng.js` 原生 `RNG.fork(world, (p.idx + 1) * 0x45d9f3b)` 派生子随机流；主 world.rng 调用步数严格不变；在星系生成末尾为每行星注入黄金分割初始相位 `orbitPhase`、伴生卫星 `planet.moons`、星系小行星带 `sys.belts`、持久化 POI `planet.pois`（doc5:153, 164-196, 198-213）。
   - 黄金角：`pl.orbitPhase = ((orbit * 2.399963229728653) + float(subRng) * 0.85) % (2π)`（doc5:176）。
   - 卫星：`maxMoons = gasGiant ? 3 : (radiusClass >= 3 ? 2 : 1)`；`moonChance = gasGiant ? 0.85 : 0.35`；kind ∈ {barren_moon, ice_moon, volcanic_moon, captured_asteroid}；`radiusRatio 0.22+float×0.14`；`orbitRadius 1.65+m×0.55`；orbitSpeed/phase 由子流派生（doc5:178-192）。
   - 小行星带概率按恒星光谱：yellowDwarf 0.65 / redDwarf 0.35 / blueGiant 0.80 / whiteDwarf 0.75 / neutronStar·pulsar 0.90 / blackHole 0.85 / 默认 0.55；`midOrbit = max(1.5, floor(行星数×0.55)+0.5)`；`richRes` blueGiant/neutronStar → heavyMetal 否则 ferro；density = round((0.5+rich×0.6)×100)/100（doc5:200-213）。
   - **恒星类型天体物理黄金分布表**（doc5:155-162）：黄矮星 4–8 星/65% 内外岩质气态分界带/气星 1–3 卫星；红矮星 3–7/35% 外围冰封柯伊伯带/0–2、潮汐锁定紧凑轨道 habitZone: 0.55；蓝巨星 4–8/80% 双层富金属碎石带/2–4、强辐射耀斑；白矮星 2–5/75% 古行星解体残骸环/0–1、稀有晶体与远古遗迹 POI；中子星/脉冲星 2–4/90% 高能磁层重金属环/0–1、scanNoise 0.7~0.9、超导/奇异物质；黑洞 2–4/85% 吸积盘外缘引力捕获带/1–2、史瓦西强引力井、暗物质与深渊科学。
2. **视锥自适应 + 帧率无关指数阻尼运镜**（doc5:215-296）：`_layout` 优先用 `p.orbitPhase`，未定义时按黄金角公式确定性派生；开普勒角速度近似 `keplerSpeed = 1/(max(1,orbit+1))^0.65`，`ang = basePhase + (tick×0.00045 + time×0.010)×keplerSpeed`（内圈快外圈慢）；`e.unknown = surveyedLevel < 2`，unknown 时 category 记为 'artificial'；`e.moons` 透传。构造函数 `this._s` 新增 `focusCur/focusTarget(Float32Array[0,0,0])、distCur:6.0、lastTime`；`frame()` 中 `dt = clamp(time-lastTime, 0.001, 0.1)`；双击聚焦时 `targetDist = max(0.75, radius×9.5)`，`zoomScale = 1/max(0.5, min(3.0, opts.zoom||1))`；`alphaLerp = 1 - exp(-8.5×dt)` 对 focusCur 三分量与 distCur 插值；yaw 自转 `0.55 + time×(isBHCam?0.008:0.015) + opts.yaw`；透视近裁剪 `max(0.02, distCur×0.02)`。
3. **未探测回波范式**：`surveyedLevel < 2` 时所有天体在 3D 视口与 2D HUD 常驻**青色虚线扫描框 + `[? 引力回波 #I..#VIII]` 标签**，让玩家第一时间感知星系纵深（doc5:215）。

**文件/函数**：`src/domain/world/galaxyGen.js`（generateGalaxy 循环、belts）、`src/ui/screens/SystemView.js`（_buildDossier）、`src/render/gl/System3D.js`（_layout、frame、构造状态）、SystemRenderer.js。
**验收门禁**：WORLD-02、UI-03；对应施工任务 P3-01。

### 3.3 痛点四：双模自适应外壳布局契约（doc5:300-342）— P0

**根因（doc5:302）**：`styles.css` 中 `.vf-sidebar` 为 `position:fixed; left:10px; width:46px; z-index:40`（:hover 展开 176px）。galaxy/system 全屏画布沉浸无碍；但 colony/research/diplomacy/government/fleet/designer/market/chronicle/events/settings/diagnostics 等管理视图的 `.vf-view-head`/`.vf-view-body` 无左侧安全区约束，内容自 `left:0` 排布，**最左 56px–186px 区域被侧栏物理遮挡**（共 11 个管理界面）。

**处方（doc5:303-342）**：不引入外部 UI 框架，在 `.vf-shell` 严格区分两类布局模式：
- CSS 变量：`--vf-sidebar-left:10px`、`--vf-sidebar-collapsed-w:46px`、`--vf-sidebar-expanded-w:176px`、`--vf-safe-left-collapsed:68px`（10+46+12 呼吸间距）、`--vf-safe-left-expanded:198px`（10+176+12）、`--vf-inspector-w:330px`。
- **管理模式**（非 `.vf-view-immersive` 的全部视图）：`.vf-view:not(.vf-view-immersive){ padding-left: var(--vf-safe-left-collapsed); transition: padding-left .18s cubic-bezier(.22,1,.36,1); box-sizing:border-box; width:100% }`；`.vf-shell:has(.vf-sidebar:hover)` 时平滑推移至 198px；`.vf-shell:has(.vf-inspector.is-open)` 时右侧自动退避 `padding-right: calc(var(--vf-inspector-w) + 16px)`。
- **沉浸模式**（`.vf-view-immersive` = galaxy/system/combat/ground/menu）：画布保持 100vw×100vh 不动，但 `.vf-view-head` 顶栏 `padding-left` 从 68px 过渡到 198px 强制避让侧栏。

**文件/函数**：`styles.css`（全局双模外壳布局与左侧栏退避契约）、`src/app/App.js`（immersive 类归属，见任务 P0-03）。
**验收门禁**：UI-04、UI-05。

### 3.4 痛点五：瞬态交互状态存储与局部差异更新（doc5:344-482）— P0

**根因（doc5:346）**：`SystemView.onSnapshot(snap)` 每 250ms 触发 `_refreshAll()` → `_buildDossier()`；其首行 `clearEl(box)`（= `box.replaceChildren()`）后调用 `panel({title, open})` 全新构造 `<section class="vf-panel">` 节点树；而 `src/ui/components/panels.js` 中面板开合状态仅存于闭包局部变量 `let isOpen = open !== false`。→ 玩家点击展开/折叠后**至多 250ms** 下一快照到达即销毁重建整个情报舱 DOM，按硬编码初始 open 参数复原：**"点击展开后瞬间缩回闪烁"**，且悬浮舱 `scrollTop` 重置为 0。

**处方（零依赖轻量方案，非虚拟 DOM 框架）**：
1. **新增 `src/ui/state/UIStateStore.js`**（doc5:349-415）——`UIStateManager`：
   - `_panels: Map(panelKey → isOpen)`、`_scrolls: Map(containerKey → {top,left})`、`_viewStates: Map(viewId → plain object)`。
   - API：`isPanelOpen(panelKey, defaultOpen=true)`（未记录回退默认值）、`setPanelOpen(panelKey, isOpen)`、`view(viewId, defaults)`（惰性初始化视图瞬态槽）、`preserveScrollAndFocus(containerKey, containerEl, mutateFn)`——变更前保存 scrollTop/scrollLeft 与容器内 `document.activeElement` 的 `dataset.focusKey`，执行 mutateFn 后恢复滚动并用 `[data-focus-key="…"]` 查询恢复焦点；导出单例 `uiState`。
2. **升级 `src/ui/components/panels.js` panel() 工厂**（doc5:417-480）：支持显式 `id` 键，未传时回退稳定默认键 `` `panel:${title}` ``；`isOpen = uiState.isPanelOpen(stableId, open !== false)`；root 挂 `dataset.panelId`；`setOpen(next, persist=true)` 持久化到 uiState 并同步 `.is-collapsed`、`hidden`、`aria-expanded`、`▾/▸` 图标与 title——不改业务调用签名即赋予全仓折叠面板跨快照状态记忆。
3. **视图侧接线**（doc5:482）：SystemView/Inspector 为每面板绑定精确域级键（`sys:$sys.id:file`、`sys:${sys.id}:planets`、`sys:planet:${p.id}` 等）；`_buildDossier()` 包裹进 `uiState.preserveScrollAndFocus(\`dossier:${this._systemId}\`, this._dossier, () => {...})`；对情报舱数据生成**轻量级摘要签名**（调查层级、行星归属、舰队状态、异常进度），未实质变动则直接跳过 DOM 替换——任意时钟倍速下折叠态与滚动条绝对稳定。

**文件/函数**：`src/ui/state/UIStateStore.js`（新增）、`src/ui/components/panels.js`（panel/fillContent/setOpen）、`SystemView.js`（_buildDossier/_refreshAll）、`Inspector.js`。
**验收门禁**：UI-06、UI-07。

### 3.5 痛点六 + 痛点一：全局视图栈、检视器守卫、地表软锁死修复与星系多模态交互（doc5:484-677）— P0

**根因（四处跨模块生命周期契约同时断裂，doc5:486-487）**：
1. 星系视图行星卡登陆按钮仅 `app._groundTargetPlanet = p.id; app.goto('ground')`——p.id 未作为正式路由参数，`GroundView._build(param)` 也完全不读取 `app._groundTargetPlanet` 临时属性。
2. `GroundView._buildBriefing` 目标行星下拉只遍历已建殖民地 `w.entities.colonies` → 无殖民地时下拉为空，无法启动任何地面行动。
3. `_buildBriefing` 调 `this._setHead('简报', [])` 空数组 → 顶部不渲染任何返回按钮；`_onKeyDown` 首行 `if (!this._mounted || this.mode === 'briefing') return;` → **剥夺简报页 Escape 退出能力 → 永久软锁死**。
4. `App._onRoute()` 激活新视图时未清理全局 Inspector → 星系视图打开的检视抽屉残留并遮挡地表简报。

**处方**：
1. **`src/app/App.js` 路由栈 + Inspector 守卫 + Escape 兜底**（doc5:488-526）：`goto(screen, param, opts)`：条件满足（路由不同或参数不同且非 replace）时压栈 `{screen, param: this._routeParam || null, selection: this.selection ? {...this.selection} : null}`，栈深 > 16 时 shift；`keepInspectorScreens = new Set(['galaxy'])`，其余 screen 一律 `closeInspector()` 再 navigate；`goBack(fallbackScreen='galaxy', fallbackParam=null)` 弹栈回退否则兜底；`closeInspector()` 置 `selection=null` 并对 `inspector.root` 移除 `is-open`/`open`、设 `hidden`。
2. **`src/ui/screens/SystemView.js` 多模态空间交互升级**（doc5:528-592）：mount 时 `uiState.view('system', {selectedPlanetId:null, focusedPlanetId:null})` 初始化并挂 `.vf-radial-menu`（hidden）；`_bindCanvasEvents()` 增补：
   - `dblclick`：picker 命中→设 selected+focused、`uiState.view('system')` 同步、`_highlightPlanetCard(hit)`、强制展开 `sys:${systemId}:planets` 与 `sys:planet:${hit}` 面板、`_buildDossier()`；未命中（双击空白）→复位相机聚焦至星系全景。
   - `contextmenu`：`preventDefault()`；命中→选中+高亮+`_showRadialMenu(e.clientX, e.clientY, hit)`；未命中→隐藏径向菜单。
   - `keydown`：Escape 三级退避（径向菜单开启→关菜单；有聚焦→取消聚焦；否则 `app.goto('galaxy')`）；Enter/Space 且有选中→第一次聚焦、第二次 `app.goto('ground', selectedPlanetId)`。
   - 行星卡登陆按钮统一改为显式参数路由 `app.goto('ground', p.id)`（doc5:528）。
3. **`src/ui/screens/GroundView.js` 解锁与未殖民准入**（doc5:594-677）：
   - `_returnToOrbit()`：由 `_targetPlanetId || freePlanetId || mission.planetId` 反查 planet.systemId → `goto('system', systemId)`，否则 `goBack('galaxy')`。
   - `_buildBriefing(resumeMission)`：`_setHead(目标行星名·简报, [ {← 返回 {sysName} 星系 (primary, Esc, _returnToOrbit)}, {← 银河星图 (goto 'galaxy')} ])` **无条件渲染逃逸按钮**；目标行星选择器（`data-focus-key="ground-planet-sel"`）用去重 Set 依次填入：传入目标行星（无论是否已殖民，tag "己方殖民地"/"先遣勘探目标"）→ 玩家全部殖民地/前哨行星 → 全部 `surveyedBy[playerFactionId] >= 3`（3 级定位扫描完成）星系下的无主行星（tag "未殖民 · 可勘探"）。
   - `_onKeyDown(e)`：`mode === 'briefing'` 时 Escape → `preventDefault()` + `_returnToOrbit()`；mission/free 模式键位保持不变。

**文件/函数**：`src/app/App.js`（goto/goBack/closeInspector/_routeStack）、`src/ui/screens/SystemView.js`、`src/ui/screens/GroundView.js`（_buildBriefing/_onKeyDown/_returnToOrbit）、`src/ui/shell/Inspector.js`（重绑定守卫，任务 P0-07）。
**验收门禁**：NAV-01、NAV-02、NAV-03、NAV-04、UI-01/02/03（交互面）。

### 3.6 痛点七：结构化空间任务实体与离屏指标导航（doc5:681-809）— P1

**根因（doc5:683）**：`src/content/events.js` 的 34 个事件全部为纯文本+静态资源算子。以 `evt_pirate_raid`（航线劫掠）为例：正文"一支无旗籍的劫掠舰队出现在边域航路，袭击了孤立商队"，两个选项仅"花费 400 信用点设 convoy_ok 标记"或"扣 250 信用点让商队自行规避"——**无目标星系/航路 ID，无任何可在星图执行的护航或清剿任务目标**。

**处方**：
1. **事件模型二分**（doc5:683）：A 类纯内政外交叙事决策事件维持即时结算；B 类空间运营事件（`evt_pirate_raid` 航线劫掠、`evt_signal_frontier` 边疆信号、`evt_famine_relieef` 饥荒求援、`evt_frontier_dispute` 边境摩擦、`evt_deepspace_signal` 非自然来源）触发时动态绑定真实世界空间实体并创建持久化 WorldObjective。
2. **实体注册**（doc5:684）：`src/domain/world/World.js` entities 容器与 `src/core/ids.js` PREFIXES 注册 `objectives: 'obj'`；新增领域模块 **`src/domain/events/objectives.js`**（doc5:686-727）：`createWorldObjective(world, { sourceEventId, titleZh, descZh, kind /* 'escort_lane'|'investigate_system'|'relief_colony'|'survey_planet' */, targetSystemId, secondarySystemId /* 航路另一端（劫掠） */, targetPlanetId, priority='high', durationHours=336 /* 14 天行动窗口 */, rewards=[], penalty })` → `createEntity(world,'objectives',{ status:'active'|'completed'|'expired', createdTick, deadlineTick: world.tick+durationHours, assignedFleetId, progress:0, goalProgress:100, ... })`，并 `emit(world, 'ObjectiveCreated', {objectiveId, targetSystemId, kind}, 'world')`。完整支持 JSON 存档序列化。
3. **事件接线**（doc5:729）：`evt_pirate_raid` 触发时自动选取玩家一个边域殖民地所在星系 sysA 及一条活跃邻接航路端点 sysB 建 WorldObjective；事件卡与主界面右上角常驻 **Objective Tracker（当前任务追踪条）** 展示目标航路名与剩余小时数；提供"聚焦目标航路"、"一键派遣最近护航舰队"（内联显示 Dijkstra 航路预演的 ETA 与氢燃料消耗）等直接空间操作入口。
4. **银河图 HUD 叠加层**（doc5:730-809）：`src/render/GalaxyRenderer.js` 新增 `_drawObjectivesOverlay(ctx, snap, t, posFn)`：
   - **离屏数学**：目标星系投影坐标移出视口安全矩形时，以视口中心 (cx,cy) 为原点取位移向量 (dx,dy)，方位角 `θ = atan2(dy,dx)`；设安全半宽 padX、半高 padY，射线与安全边界矩形交点缩放因子 `t = min(padX/|dx|, padY/|dy|)`，边缘钳制坐标 `(ex,ey) = (cx,cy) + t×(dx,dy)`；在 (ex,ey) 绘制旋转角 θ 的高对比度指向箭头，点击可一键平滑移镜至目标星系。代码常量：`padX = max(80, cx-84)`（避开左侧导航栏）、`padY = max(60, cy-64)`。
   - 在屏：脉冲菱形 Pin（`pulse = sin(t×5)×2.5`，y = sy−18−pulse）+ 目标名；离屏：实心箭头多边形 (8,0)(−6,−5)(−3,0)(−6,5)。
   - 高危航路：secondarySystemId 存在时绘制动态脉冲警戒线 `strokeStyle = priority==='high' ? '#e85f5f' : '#e8b04f'`、`lineWidth 2.4`、`setLineDash([8,6])`、`lineDashOffset = -t×28`。

**文件/函数**：`src/content/events.js`、`src/domain/world/World.js`、`src/core/ids.js`、`src/domain/events/objectives.js`（新增）、`src/render/GalaxyRenderer.js`（_drawObjectivesOverlay）、EventsView.js（P1-02）、OrderFleetMove 命令管线（EVT-02）。
**验收门禁**：EVT-01、EVT-02。

### 3.7 痛点八：持久化行星兴趣点与前殖民期先遣勘探系统（doc5:811-869）— P1

**根因（doc5:813, 868）**：未殖民星球"只有一组枯燥的引力、大气与矿脉数字"；简报入口被"尚无玩家殖民地"硬性拦截；无 POI、无先遣科考 → 玩家负面感知"每个星系似乎只有两颗星球、宇宙空旷如荒漠"。行星实体从静态参数表升维至**四维价值模型**（doc5:813-814，公式图 image45）。

**处方**：
1. **POI 生成器**（doc5:828-866）：`galaxyGen.js` 新增 `generatePlanetPOIs(rng, planet, star, rich)`——每行星按物理类别（rocky/ocean/ice/desert/lava/toxic/gasGiant/artificial）与星系资源富集度确定性生成 **1–3 个**（gasGiant 固定 1 个）持久化 POI，挂 `planet.pois` 随存档持久化。类别池：rocky→[crashed_ship, deep_vein, ancient_ruin, magnetic_anomaly]；ocean→[subsurface_ocean, bio_trace, crashed_ship]；ice→[subsurface_ocean, lost_station, deep_vein, crashed_ship]；desert→[ancient_ruin, crashed_ship, lost_station]；gasGiant→[storm_vortex]；lava→[deep_vein, magnetic_anomaly]；toxic→[bio_trace, lost_station]；artificial→[ancient_ruin, magnetic_anomaly]。字段：`id = ${planet.id}_poi_${i+1}`、planetId、kind、`state: 'unexplored'|'explored'`（**严格持久化防无限刷奖**）、`threatLevel = clamp(round(1 + star.danger×0.35 + i×0.8), 1, 5)`、`voxelPos = { x: 14 + poiSeed%36, z: 14 + (poiSeed>>>8)%36 }`（64×64 体素地表安全圈 14..50 内确定性三维信标网格坐标）、seed、`rewardPaid: false`。
2. **八类 POI 玩法与跨系统回写收益表**（doc5:817-826）：
   | kind | 名称 | 适用类别 | 勘探交互与环境风险 | 回写奖励 |
   | :--- | :--- | :--- | :--- | :--- |
   | ancient_ruin | 远古先驱遗迹 | desert, rocky, artificial | 地表小队回收 3 处全息碑文（废墟坍塌/自动哨卫风险） | ancientData×4~8、researchData×25，推进主线弦锚点线索 |
   | crashed_ship | 坠毁星舰残骸 | rocky, ice, desert | 切割反应堆舱室打捞黑匣子（辐射泄漏） | alloy×35、powerCell×8，15% 概率解锁稀有武器模块蓝图 |
   | deep_vein | 超深层富集矿脉 | lava, rocky, ice | 地质震源钻探采样（岩浆喷发/冰层裂隙） | 立即入账 rareEarth/heavyMetal×40，永久提升该行星对应矿藏丰度 +35% |
   | subsurface_ocean | 冰下热泉生态圈 | ice, ocean | 冰层钻孔释放深潜采样器（极寒失温/高压） | biomass×35、researchData×20，该行星宜居度永久修正 +8 |
   | bio_trace | 异星掠食集群巢穴 | toxic, ocean, rocky | 战术小队清剿孢子母体并采集高活性酶（高生物威胁） | medicine×12、biomass×45，参与人员 +60 XP |
   | magnetic_anomaly | 强磁单极子异常区 | lava, artificial, rocky | 架设三脚架磁通量校准仪坚守 90 秒（护盾失效） | conductor×10、quantumCrystal×3、researchData×30 |
   | lost_station | 失联科考前哨 | ice, desert, toxic | 搜索生命信标并护送幸存科学家撤离（敌对机械守卫） | 获得 1 名带 bookish 特质的 Lv2 科学官加入文明人物池 |
   | storm_vortex | 气态风暴超导涡流 | gasGiant 专属 | 轨道释放耐压大气探针（无需着陆，耗 2 能量电池） | helium3×50、deuterium×20、researchData×15 |
3. **前殖民期准入与地表勘探闭环**（doc5:868）：星系调查 `lvl >= 2` 时行星卡与径向菜单直观显示未探索 POI 信号数量；**无需先耗 20 合金+150 信用点建前哨**即可"派遣先遣队勘探"进 GroundView。先遣模式中 BuildingMeshBatch 在每个未探索 POI 的 `(poi.voxelPos.x, surfaceY, poi.voxelPos.z)` 渲染高发光脉冲（emit: 1.8）三维遗迹/残骸信标，HUD 罗盘显示方位与距离；第三人称外骨骼角色靠近信标 ≤1 体素单位按 E 采样 → 前端派发 `app.dispatch('HarvestPlanetPOI', { planetId, poiId })`；领域层以 `poi.rewardPaid === true` 为**严格幂等锁**（重进星球/读档恢复绝不重复发奖），将科研数据、远古数据、新船员角色、矿脉储量/宜居度永久修正实时写入 world。核心探索闭环：**轨道扫描 → 先遣登陆勘探 → 发现稀有矿脉或宜居度改造潜力 → 科学决策建立前哨站**。

**文件/函数**：`src/domain/world/galaxyGen.js`（generatePlanetPOIs）、`src/ui/screens/GroundView.js`（survey 入场模式）、SurfaceSandbox.js、`src/app/commands.js`（HarvestPlanetPOI）、BuildingMeshBatch。
**验收门禁**：WORLD-03、SAVE-03、NAV-02、E2E-02。

### 3.8 工业物流可视化深化 + 审计报告四项技术债（doc5:871-900）— P2

**根因（doc5:873）**：`src/domain/planets/colony.js` 的 `colony.population = { total, strata: { worker: n } }` 仅作静态统计参与粮食消耗与增长计算；`foundColony` 预留的 `colony.jobsFilled: {}` 从未被日结生产循环实际消费。借鉴 Stonehearth 岗位体系与 Shapez/DSP 物流加工分离原则。

**处方（物流深化，doc5:873）**：
- 每座活跃建筑按类别声明标准岗位定额：**采掘类 2 名矿工、精炼与制造类 2 名技工、科研类 2 名科学家、农业类 1 名生态员、行政类 1 名行政官**；按玩家设定的岗位优先级将总人口动态分配至建筑槽位，计算实际劳动开动率 η（doc5:873，公式图 image48）。
- 每日结算为每座建筑实时写入 `b.runtimeStatus` 诊断状态码，五类：**running（满载）、understaffed（劳力短缺）、starved_input（上游原料断供，指明缺失原料 ID）、low_power（电力不足降产）、storage_full（仓储满溢）**。
- ColonyView.js 将扁平表格升级为四级可视化流向看板：**矿脉采掘 → 殖民地仓储物流 → 精炼加工制造 → 船坞与轨道输出**，一眼洞察产能瓶颈。

**处方（TD1–TD4 同步清偿，doc5:874-900）**：
- **TD1 stationIds 数据回填缺失**（doc5:874-881）：在 `src/devtools/scenarioFactory.js`（开局母星轨道船坞）及 `src/app/commands.js` 中凡 `createEntity(world,'stations',{systemId,...})` 处强制追加确定性回填：`const sys = world.entities.systems[station.systemId]; if (sys && Array.isArray(sys.stationIds) && !sys.stationIds.includes(station.id)) sys.stationIds.push(station.id);` 确保星系快照 stationCount 统计准确。
- **TD2 外交战争终局指令未闭环**（doc5:883-898）：在 `src/app/commands.js` 与 `src/domain/diplomacy/war.js` 激活已预留的 `war.peaceOffers` 与 `war.occupiedSystems`；正式注册 **ProposePeace**（validate：war 存在且 `status === 'active'`，否则 `{ok:false, code:'NO_WAR'}`；execute：`resolvePeaceProposal(world, actorId, warId, terms || 'whitePeace')`）与 **AnnexOccupied**（割地占领）命令；DiplomacyView.js 暴露战果评估与和谈按钮；玩家战场胜率与占领星系得分达阈值即可经外交协议正式吞并被占领星系。
- **TD3 GC 压力 + 战斗特质断链**（doc5:900）：`src/domain/combat/BattleSimulation.js` 将高频弹道投射物与命中事件改为**容量 256 的预分配环形对象池**复用；`HourlySystems.js:114` 与 `fleet.js:28` 调用 createShip 时完整传入文明修正表 `factionMods`，使文明战斗特质加成准确汇入 computeShipStats。
- **TD4 深度叙事文本国际化**（doc5:900）：提供自动化词条抽取脚本 `tests/tools/extract-i18n-content.mjs`，将 `src/content/events.js` 与 `anomalies.js` 中文文案映射至 `src/content/localization/` 双语词典键位，消除英文环境语言割裂。

**验收门禁**：COL-01..04、ECON-02、DIP-02、REG-01（对应 P2 任务）。

---

## 4. 四阶段原子施工波次与优先级矩阵（doc5:902-927）

**波次总规则**（doc5:906）：遵循《星际游戏长线研发任务书》第 12.7 节"**P0 缺陷阻塞一切新功能、先恢复交互可靠性再扩展内容**"铁律；全栈施工划分为四个**串行**原子波次（Phase P0 → P3）；**每一波次完成后必须通过全量回归门禁并重新运行静态打包器生成 `./dist/void-frontier.bundle.js`**，确保 file:// 本地双击直玩模式与 HTTP/GitHub Pages 原生 ES Modules 模式完全同步。依赖语义：波次严格串行（P0 全部完成并通过门禁后才进入 P1，依此类推）；单任务间的耦合通过"绑定验收门禁"体现（下表），未另行声明任务级依赖。

| 任务编号 | 阶段 | 核心施工内容 | 涉及核心模块与文件路径 | 技术风险 | 体验收益 | 绑定验收门禁 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-01** | P0 | 星系 Canvas 单击/双击运镜、快捷键与右键径向菜单 | src/ui/screens/SystemView.js、System3D.js | 低 | 极高 | UI-01, UI-02, UI-03 |
| **P0-02** | P0 | 修复 GLOW_VERT 模型矩阵二次复合与晨昏线散射升级 | src/render/gl/System3D.js | 极低 | 极高 | GL-01 |
| **P0-03** | P0 | 全局双模布局契约（immersive vs management 侧栏退避） | styles.css、src/app/App.js | 极低 | 极高 | UI-04, UI-05 |
| **P0-04** | P0 | 实装 UIStateStore 与 panels.js 稳定 ID 绑定、滚动/焦点保持 | src/ui/state/UIStateStore.js、panels.js、SystemView.js | 低 | 极高 | UI-06, UI-07 |
| **P0-05** | P0 | 实装全局 RouteStack 历史回退栈与 Escape 防御性逃逸链 | src/app/App.js、src/app/Router.js | 低 | 极高 | NAV-01, NAV-03 |
| **P0-06** | P0 | 修复 GroundView 简报目标行星传参、返回按钮与未殖民星准入 | src/ui/screens/GroundView.js | 低 | 致命阻断解除 | NAV-01, NAV-02, NAV-03 |
| **P0-07** | P0 | 全局 Inspector 跨视图路由切换自动收起与重绑定守卫 | src/app/App.js、src/ui/shell/Inspector.js | 极低 | 高 | NAV-04 |
| **P1-01** | P1 | 建立 WorldObjective 空间任务目标实体与事件生成器接线 | src/domain/events/objectives.js、events.js、World.js | 中 | 极高 | EVT-01, EVT-02 |
| **P1-02** | P1 | 银河星图目标 Pin、威胁航路脉冲与 atan2 离屏方向箭头 | src/render/GalaxyRenderer.js、EventsView.js | 低 | 极高 | EVT-01, EVT-02 |
| **P1-03** | P1 | 开放未殖民行星先遣勘探模式（entryMode: 'survey'）与气态星探针 | src/ui/screens/GroundView.js、commands.js | 低 | 极高 | NAV-02, E2E-02 |
| **P1-04** | P1 | 行星持久化 POI 生成（8 类）与 3D 地表全息信标渲染 | src/domain/world/galaxyGen.js、GroundView.js | 中 | 极高 | WORLD-03 |
| **P1-05** | P1 | HarvestPlanetPOI 幂等结算命令与科研/矿藏/宜居度回写 | src/app/commands.js、SurfaceSandbox.js | 低 | 极高 | SAVE-03, E2E-02 |
| **P2-01** | P2 | 殖民地居民岗位分配（jobsFilled）与设施开动率耦合 | src/domain/planets/colony.js、ColonyView.js | 中 | 高 | COL-01..04 |
| **P2-02** | P2 | 建筑输入/输出吞吐看板与五类阻塞原因（runtimeStatus）诊断 | src/domain/planets/colony.js、ColonyView.js | 低 | 高 | ECON-02 |
| **P2-03** | P2 | 清偿 4 项审计技术债（stationIds 回填、和谈命令、对象池、i18n） | scenarioFactory.js、war.js、BattleSimulation.js | 低 | 中 | DIP-02, REG-01 |
| **P3-01** | P3 | 伴生卫星（moons）、小行星带（belts）与迷雾雷达回波渲染 | galaxyGen.js、System3D.js、SystemRenderer.js | 低 | 高 | WORLD-02 |

任务计数：**P0 × 7 + P1 × 5 + P2 × 3 + P3 × 1 = 17 项原子任务**（doc5:912-927）。P2-03 的 COL-01..04/ECON-02/DIP-02/REG-01 中，COL 与 ECON 族门禁为波次内并联目标；REG-01 为金快照回归（见 §5 命令 3）。

---

## 5. 浏览器级端到端自动化验收矩阵（doc5:929-967）

**总则**（doc5:931）：决不能仅凭 Node 侧领域模拟测试通过判定交互达标；必须建立覆盖**真实 DOM 状态与渲染管线几何契约**的浏览器级 UI E2E 验收套件；合入主分支前必须 **100% 通过的 18 项刚性验收场景**：

| 门禁编号 | 验收场景 | 自动化步骤与断言（定量通过判据） |
| :--- | :--- | :--- |
| **UI-01** | 银河双击进入星系 | GalaxyView 双击星系节点 → 断言路由切换为 `#/system/<id>` 且 `SystemView._systemId === id` |
| **UI-02** | 星系单击行星联动 | SystemView 单击行星 → 该行星卡获得高亮边框且 `app.selection.id === planetId`，**不发生路由跳变** |
| **UI-03** | 星系双击行星聚焦 | SystemView 双击行星 → System3D 相机目标收敛至该行星世界坐标，右侧对应行星折叠卡展开 |
| **GL-01** | 多轨道位置大气辉光对齐 | 遍历 orbitIndex = 0, 1, 3, 7 的行星 → 校验 GLOW_VERT 裁剪坐标中心与 PLANET_VERT 中心误差 ≤ 容差（零 2R 漂移；原文为公式图 image50/image51） |
| **UI-04** | 管理页面与侧栏退避 | 遍历全部 11 个非地图管理视图 → 断言 `.vf-view-body` 内容区左边界 ≥ 左侧安全距离（公式图 image52），与 `.vf-sidebar` 交集面积为 0（公式图 image53） |
| **UI-05** | 导航栏展开与收起一致性 | 触发 `.vf-sidebar:hover` 展开至 176px → 管理视图平滑内缩至 198px，沉浸式视图画布尺寸不抖动 |
| **UI-06** | 折叠面板跨快照状态保持 | SystemView 手动折叠/展开任意 panel → 连续推进 10 次 onSnapshot（时间跨度 ≥ 2.5s，公式图 image54）→ 断言 `.is-collapsed` 状态 100% 不变 |
| **UI-07** | 快照刷新期间滚动条保持 | `.vf-float-panel` 滚至 `scrollTop = 180` → 触发 onSnapshot() → 断言刷新后 `scrollTop === 180` |
| **NAV-01** | 银河→星系→地表往返 | 银河进星系再点登陆进 GroundView 简报 → 点击头部「← 返回星系」按钮 → 精确回到原星系 sys_xxx |
| **NAV-02** | 未殖民行星直接登陆勘探 | 开局无任何殖民地的行星上点击登陆 → GroundView 下拉框自动选中该行星并可正常启动先遣探索模式 |
| **NAV-03** | 地表简报 Escape 逃逸 | GroundView briefing 模式派发 `KeyboardEvent('keydown', { code:'Escape', key:'Escape' })` → 立即退回上一层路由 |
| **NAV-04** | 跨视图 Inspector 自动清理 | SystemView 打开右侧 Inspector 后跳转 `#/ground` → 断言 `.vf-inspector` 具有 `hidden` 属性且不遮挡简报 |
| **EVT-01** | 航线劫掠生成空间目标 | 触发 evt_pirate_raid → 断言 `world.entities.objectives` 新增 active 实体且含合法 targetSystemId 与 secondarySystemId |
| **EVT-02** | 事件一键派遣舰队 | 事件目标卡点击派遣护航 → 断言 OrderFleetMove 命令进入模拟管线且舰队 transit 路径指向目标星系 |
| **WORLD-02** | 千种子天体分布统计 | 批量运行 1,000 个随机种子 → 断言行星数分布覆盖 [2,8]（均值 5，公式图 image55/image56），moons 与 belts 生成率符合恒星光谱表（§3.2 表） |
| **WORLD-03** | 同一星球多次进出 POI 持久 | 多次进入同一行星地表 → `planet.pois` 的数量、类型与体素坐标 (vx, vz) 100% 恒定 |
| **SAVE-03** | POI 采样后存档恢复幂等 | 采样 POI 获奖励后执行 SaveCodec 序列化+反序列化 → 再次交互该 POI → 断言 `rewardPaid === true` 且不重复发奖 |
| **E2E-02** | 扫描→登陆→探索→科研全链路 | 自动化跑通"扫描未知冰封行星 → 先遣队登陆 → 采样遗迹与深层矿脉 → researchData 入账解锁科技 → 建立前哨"完整闭环 |

**合入前四条验证命令**（项目根目录依次执行，doc5:954-967）：

```bash
# 1. 重新生成零依赖单文件静态包（同步 dist/void-frontier.bundle.js，保障 file:// 双击即玩）
node tests/tools/build-static-bundle.mjs

# 2. 运行全量领域与 UI E2E 测试套件（含新增 UI-01..07 / NAV-01..04 / E2E-02，双轮确定性校验）
npm test

# 3. 若 WorldObjective / POI 新字段推进世界 Schema：更新金快照基线并二次复验 REG-01
npm run golden:update && npm test

# 4. 静态合规审计（断言零 Math.random、零 eval、零外链 CDN、零未声明全局变量）
npm run lint:static
```

---

## 6. 领域专家终审结论与施工签批准则（doc5:969-971）

- **无需重写**：高度成熟的确定性模拟内核与 WebGL 2.0 硬件加速渲染底座予以完整保留。
- **症结定位**：阻碍产品从硬核技术演示迈向高耐玩度商业级星际沙盒的全部症结 = **5 项 P0 级交互状态机与着色器变换缺陷 + 3 项 P1 级空间事件引导与前殖民期地表探索闭环缺失**。
- **施工清单**（按方案逐项落地）：齐次矩阵变换修正、瑞利-菲涅尔晨昏线散射着色器、CSS 双模安全退避布局、UIStateStore 瞬态状态仓库、RouteStack 防软锁契约、WorldObjective 与持久化 POI 领域扩展。
- **达成判据**：完整保留"**纯静态、零外部依赖、100% 确定性**"核心工程美学；打通 L1 银河战略 → L2 星系轨道 → L3 行星工业物流 → L4 体素地表探险的**四层无缝心流**；达成 **VOID FRONTIER · PLAYABLE FRONTIER** 里程碑交付标准。
- **签批前置条件**（综合 doc5:906、931、954）：四个波次串行推进；每波次后全量回归门禁 + 重建 `./dist/void-frontier.bundle.js`（file:// 与 HTTP/ESM 同步）；18 项 E2E 刚性场景 100% 通过；四条验证命令全绿（含金快照更新与静态合规审计）。

---

## 7. 附录

### 7.1 参考资料（doc5:973-1000，共 26 项）

项目内案卷与源码（Google Drive 链接）：¹专家调研委托书 TASK_DELEGATION_EXPERT_RESEARCH_BRIEF.md、²负责人审计 PROJECT_LEAD_AUDIT_REPORT.md、³专家诊断 report.md、⁴AUTONOMOUS_RUNBOOK.md、⁵report.md、⁶System3D.js、⁷SystemView.js、⁸void-frontier.bundle.js、⁹Inspector.js、¹⁰events.js、¹⁴GalaxyRenderer.js、²²galaxyGen.js、²³SystemRenderer.js、¹⁸/²⁶[REDACTED]方案两份。
外部方法论文献：¹¹/¹²Stellaris 双击切图与地图缩放（Reddit）、¹³离屏指示器（YouTube）、¹⁵Endless Space 2（NamuWiki）、¹⁶/²⁵atan2（CSS-Tricks/MATLAB）、¹⁷Rust 控制台命令、¹⁹4X 界面演进 Dev Journal #114（SteamDB）、²⁰WebGL 大气绘制（Mike Lodato）、²¹GLSL 大气技法、²⁴MDN CSS 数学函数。

### 7.2 内嵌图像与公式还原说明（doc5:1002-1112）

全部 56 幅 `[image1]..[image56]` 为 base64 data-URL PNG（数学公式截图与 UI 截图），定义位于文末。关键公式图的上下文语义：
- image20 ≈ 辉光中心被推至 `2|C|`（2× 轨道半径，doc5:54）；image24 = 辉光偏移示意截图（doc5:55）。
- image26/27 = `intRange(2,8)` 均匀分布与期望值 5（doc5:152）；image55/56 = 千种子分布 [2,8] 与均值 5（doc5:949）。
- image30-33 = 相机焦点/指数阻尼/收敛距离参数（doc5:215）；image43 = 离屏箭头求交公式（doc5:731）；image45 = 行星四维价值模型（doc5:814）；image48 = 劳动开动率公式（doc5:873）。
- image50/51（GL-01 容差）、image52/53（UI-04 左边界与交集面积）、image54（UI-06 时间跨度 ≥2.5s）为判定符号图，正文语义已按上下文写入 §5；若需精确符号请解 base64 图确认。
- image2/34/47/49 为执行摘要痛点示意、面板闪烁示意、POI 闭环示意、四阶段波次图截图。
