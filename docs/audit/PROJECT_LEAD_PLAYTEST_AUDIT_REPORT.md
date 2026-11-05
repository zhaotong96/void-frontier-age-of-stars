# 《无垠边疆：星海纪元》项目负责人实机深度游玩验收与缺陷穿透审计报告

**报告编号**：`AUDIT-PLAYTEST-VOID-FRONTIER-202611-02`  
**验收人**：项目架构负责人 (Project Lead & Principal Architect)  
**被验收对象**：执行工程师提交的行星美学与行星 GamePlay 全线交付成果（Commit `f634828`）  
**审计方法**：真实全链路场景实机操作 + 宿主 Node.js 全星系 3,648 场景高频物理推演模拟  
**最终验收结论**：**【准予整改重修 · 阻断投产上线】(REJECTED / CONDITIONAL REWORK REQUIRED)**  
**综合工程与体验评分修正**：**7.4 / 10.0**（较此前自动化静态指标评级撤回 2.2 分；自动化测试全绿掩盖了严重的可玩性物理崩溃与玩法几何断裂）。

---

## 1. 致命缺陷实证复现：为什么“刚登陆地表就掉到地面下去了”？

在用户实测反馈“刚登陆地表就掉到地面下面去了，根本没办法正常玩”后，项目负责人立即展开全星系高频物理步进模拟与代码断点追踪。

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家
    participant UI as GroundView.js
    participant GM as GroundMission.js (2D)
    participant Field as terrainField.js (3D)
    participant Physics as _followMissionCharacter

    Player->>UI: 点击「开始行动」(登陆地表)
    UI->>Field: 初始化场域: c.y = _groundAt(sw.spawn.x, sw.spawn.z) [例如 y=10.0m]
    UI->>GM: 任务启动: au 单位生成于 (au.x, au.y) [例如映射到 3D (7.2m, 7.0m)]
    Note over UI,Physics: 致命断层: au 位置的 3D 地形高度 groundY 实际为 24.5m！
    loop 第 1 帧至第 180 帧物理死锁
        Physics->>Physics: 重力积分: c.vy -= g * dt; c.y += c.vy * dt
        Note over Physics: 初始 c.y=10.0m，深陷地下 14.5 米 (c.y < groundY)
        Physics->>Physics: 试图爬坡: c.y = min(groundY, c.y + 9 * dt) [每帧最多爬 0.144m]
        Note over Physics: 致命设计: c.vy 永不重置！|c.vy| 快速突破 9.0m/s
        Physics->>Physics: 下降速度大于爬坡速率: 下沉量 > 爬升量
        Physics->>Physics: c.y 呈指数级坠落入深渊 (c.y < -30m / -60m)
    end
    Physics->>UI: 角色彻底跌出世界底部，摄像机穿地折叠！
```

### 1.1 致命代码证据链穿透（Three-Tier Fatal Mechanism）

通过查阅 [GroundView.js](file:///C:/Users/zt/My%20Drive/work/void-frontier-age-of-stars/src/ui/screens/GroundView.js)，确认以下三重物理逻辑叠加缺陷：

#### 根因一：场景初始化坐标与任务出击位置严重脱节
查阅 [GroundView.js lines 790-799](file:///C:/Users/zt/My%20Drive/work/void-frontier-age-of-stars/src/ui/screens/GroundView.js#L790-L799)：
```javascript
const c = this.char3d;
const spawn = this.sw.spawn;
c.x = spawn.x; // 32.5 (体素中心)
c.z = spawn.z; // 32.5
c.y = this._groundAt(spawn.x, spawn.z); // 计算的是体素中心点的高度！
```
但在进入任务的第一帧 `_followMissionCharacter(view, dt)` 中（lines 1395-1397）：
```javascript
const kx = SURFACE_SIZE.X / (m.w * TS);
const kz = SURFACE_SIZE.Z / (m.h * TS);
c.x = au.x * kx; // 直接瞬移到任务出击点（如 7.2m）
c.z = au.y * kz; // 直接瞬移到任务出击点（如 7.0m）
// 致命漏洞：完全未同步重置 c.y = this._groundAt(c.x, c.z)！
```
若任务出击点所在山脉的地面高度高于体素中心，角色在第 1 帧就**物理内嵌在地下数米甚至数十米处**！

#### 根因二：重力发散死循环（Runaway Downward Velocity Loop）
查阅 [GroundView.js lines 1415-1428](file:///C:/Users/zt/My%20Drive/work/void-frontier-age-of-stars/src/ui/screens/GroundView.js#L1415-L1428)：
```javascript
c.vy -= g * dt;
c.y += c.vy * dt;
if (ground !== Infinity) {
  if (c.y < ground) {
    // 爬坡平滑：以有限速率贴上新地面
    c.y = Math.min(ground, c.y + 9 * dt);
    if (ground - c.y < 0.02) { // 仅当差距极小时才清空 vy
      c.y = ground;
      c.vy = 0;
      c.onGround = true;
    }
  }
}
```
**数学证明**：
* 设重力 $g = 9.8 \text{ m/s}^2$，帧耗时 $\Delta t = 0.0166 \text{ s}$；
* 若初始差值 $ground - c.y \ge 0.02$（例如由于坐标错位初始陷入地下 2 米），`c.vy` **不会被重置为 0**；
* 每一帧 `c.vy` 累减 $g \Delta t$。当且仅当第 15 帧后，垂直向下速度 $|c.vy| > 9 \text{ m/s}$；
* 此时一帧内的下坠位移 $|c.vy| \Delta t > 9 \Delta t$，而向上平滑补偿仅有 $+9 \Delta t$。净垂直位移变为**绝对向下**；
* 差值 $ground - c.y$ 随时间推移不缩反增，呈发散状态。角色直接被自身不断累加的重力加速度拽入无底深渊！

#### 根因三：死亡橡皮筋循环（Rubberbanding Trap）
当角色掉至 $c.y < -60$ 时，第 1432 行试图救赎：`c.x = sp.x; c.z = sp.z; c.y = this._groundAt(sp.x, sp.z);`。但进入下一帧后，第 1396 行又无条件被 `au.x * kx` 覆盖回任务出击点，形成角色每隔数秒疯狂在深渊与地下反复闪烁抽搐的严重 Bug！

### 1.2 全星系大样本模拟证据（112 / 3648 绝对崩溃率）
在项目负责人编写的沙盒测试中，对全银河 600+ 颗行星、全部 6 款任务模板共 **3,648 个出击场景**进行端到端物理模拟，实测捕获 **112 个百分之百坠入深渊（Fell into Abyss）的崩溃行星**：

```text
[FALL FAILURE] plt_18 (岚拉 I)  tpl=gmt_relic_survey: spawnY=-26.01, groundY=-11.69, belowBy=+14.32m -> 坠入深渊 (Frame 132)!
[FALL FAILURE] plt_51 (苍德 V)  tpl=gmt_relic_survey: spawnY=-19.75, groundY=-0.41,  belowBy=+19.34m -> 坠入深渊 (Frame 158)!
[FALL FAILURE] plt_85 (岚珞 III) tpl=gmt_destroy_aa:   spawnY=-12.93, groundY=1.32,   belowBy=+14.26m -> 坠入深渊 (Frame 180)!
[FALL FAILURE] plt_119 (桉翁 III) tpl=gmt_rescue_crew: spawnY=-27.97, groundY=-7.93,  belowBy=+20.03m -> 坠入深渊 (Frame 122)!
[FALL FAILURE] plt_452 (卡希 III) tpl=gmt_rescue_crew: spawnY=-16.11, groundY=22.29,  belowBy=+38.40m -> 坠入深渊 (Frame 170)!
...
汇总：3,648 场景中 112 个场景在落地数秒内彻底穿地坠毁！
```

---

## 2. 深入实测发现的另外 5 大严重架构与体验病灶

除了上述直接导致游戏无法进行的跌落 Bug 外，实机深度游玩还暴露出执行工程师在理解 docs 4-7 时遗留的深层次结构性断裂：

### 病灶一：2D 室内迷宫 FSM 与 3D 连续地貌的“灵魂撕裂” (Spatial Dimension Mismatch)
* **现象**：玩家在 3D 开放大平原或山坡上奔跑，走着走着突然撞上空气墙动弹不得；或者向肉眼可见就在正前方的敌人挥刀砍不到，因为敌人在 2D 逻辑里被判定隔着一堵墙。
* **技术病理**：
  * `GroundMission.js` 底层是一个源自 Phase 01 的经典 2D 瓷砖网格（Tile Grid 32×32），内部由 BSP 生成地下城走廊和墙壁（`T_WALL`, `T_FLOOR`）；
  * 执行工程师在施工时，**仅仅简单地把 2D 像素坐标按比例缩放贴到 3D 地形上**（`kx = 64 / (m.w * 24)`）；
  * 实测表明：在同一张 2D 地牢平地上，对应的 3D 连续山脉高低落差高达 **4.86 米**！2D 逻辑判定是平地可以走，3D 表现上角色却在强行横穿悬崖。两者在维度与物理空间上处于割裂状态。

### 病灶二：弹簧臂相机（Spring-Arm Camera）地下视锥压溃 (Camera Terrain Inversion)
* **现象**：当角色落入地面微小凹陷或坡度陡升时，摄像机镜头瞬间猛烈拉近至角色脚踝，视口被大量撕裂的灰色多边形内表面充斥。
* **技术病理**：
  * [GroundView.js line 1991](file:///C:/Users/zt/My%20Drive/work/void-frontier-age-of-stars/src/ui/screens/GroundView.js#L1991)：摄像机视线目标取 `tgt = [c.x, c.y + 1.55, c.z]`；
  * 当角色处于地势负落差时，`tgt` 已经位于地形网格下方。此时调用 `raycastTerrain` 从地下向天空发射射线，射线在 $t \approx 0$ 处即触碰到地形内壁背面，导致相机安全臂长 `want` 直接被强行锁死在最小值 `1.4m`，产生令人眩晕的镜头穿模与画面翻滚。

### 病灶三：殖民地建筑与任务站点的“盲盒式堆叠” (Colony Spiral vs Site Collision)
* **现象**：降落到地表后，原本应该宏伟的工业基地，所有建筑被死板地排布在 $(32, 32)$ 黄金角同心圆螺旋上；而在有山脉的主题星上，冶炼厂直接被腰斩插在半山腰，矿机悬空吊在峡谷顶端。
* **技术病理**：
  * `_layoutColony()` 依然沿用旧版简单的径向公式生成建筑坐标，完全无视 `buildTerrainField` 产出的实际等高线与坡度承载能力；未与任务核心蓝图（`MissionSiteBlueprint`）的建筑基座区实现动态对齐。

### 病灶四：海洋/沼泽生态缺乏基础流体物理与交互响应 (Zero Aquatic Interaction)
* **现象**：在碧渊（abyssal）与沼泽主题行星，地表水深达数米，角色像完全没看见水一样在水底如履平地狂奔，没有任何水花、阻力减速、浮力或氧气机制，水面仅是一层没有厚度与物理阻隔的装饰贴图。

### 病灶五：工业与先遣勘探界面的“伪自动化闭环” (Gameplay Disjoint)
* **现象**：地表采掘的矿物入账后，缺乏直观的即时合成与地表建造反馈；虽然实装了 E 键采样 POI，但采集后的遗迹残骸依然突兀地立在原地，缺乏采样后的状态蜕变与空间视效反馈。

---

## 3. 验收结论修正与整改要求 (Actionable Directives)

执行工程师虽然提交了 38 个全绿测试套件与精美的着色器，但在核心 Gameplay 链路的组装上犯了“**只对单元断言负责、不对真实用户体验负责**”的严重工程形式主义错误。

项目负责人指令如下：
1. **立即撤销准予投产结论**，在 GitHub 仓库发布前必须完成物理穿地 Bug 的闭环修复；
2. 本报告将与下附的《领域专家二次验收与协查任务委托书》一同正式移交领域专家；
3. 要求领域专家基于目前暴露的深层维度撕裂，给出明确的**审美风格统一规范与 Gameplay 深度返工指示**；
4. 收到专家指示后，项目负责人将直接输出精确到文件与行号的《返工施工全套方案》，督导执行团队彻底打通真实可玩的星际地表体验。
