# 《无垠边疆：星海纪元》外网实测深度复盘报告与阶段五（M5）热修复及共创实装 SuperPower 施工文档

> **文档编号**：`SPEC-PLAN-056`（External Playtest Audit & Phase 5 / M5 Hotfix + Co-Creation Execution Spec）
> **归属工程**：《无垠边疆：星海纪元》（`void-frontier-age-of-stars`）
> **编制角色**：游戏系统架构、太空歌剧叙事与微模拟领域专家（Domain Expert）
> **编制日期**：2026-11-14
> **输入基准（外网实测三份核心报告）**：
> 1. [docs/reports/深度游玩体验报告.md](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk)（CDP 真机接管 16 屏巡检 + 契约探针 + 六赛道脑洞）
> 2. [docs/reports/游玩实记.md](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk)（第一人称先锋指挥官黄金前 15 分钟全流程实录）
> 3. [docs/reports/深度游玩体验报告_无垠边疆星海纪元.md](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk)（`EXTERNAL-PLAYTEST-REPORT-055-A`，2 个游戏月 125 条命令全视图 + 热修复绕过 3D 地表深度实测）
> **方法论标准**：`SuperPower` 工程实施范式（Mandatory `Plan` + `Tasks` + `Checklists` 三段式闭环）

---

## 第一部分：三份外网实测报告穿透式复盘总审（Domain Expert Audit）

### 1.1 外测核心定性与总体评分汇总

两批独立外测环境（Chrome 158 CDP 真机接管与 Chromium 152 WebGL2 硬件加速长达 2 个游戏月、125 条指令的深度游玩）得出高度一致的结论：

> **“这是一座完成度惊人、战略层咬合极深、信标微小说极具灵魂，但被一行命名脱节代码焊死了 3D 地表舱门的太空歌剧星舰。”**

| 评估维度 | 报告 A（`深度游玩体验报告` & `游玩实记`） | 报告 B（`EXTERNAL-PLAYTEST-REPORT-055-A`） | 领域专家交叉复核定性 |
| :--- | :---: | :---: | :--- |
| **太空歌剧氛围与叙事吸引力** | **9.0 / 10** | **8.5 / 10** | **极高赞誉**：「铁蕨号 40 小时求救」「先驱者平方素数链低语」「CHOAM 分红法案直播」等信标微小说密度与抉择代价真实成立。 |
| **系统咬合度与架构完成度** | **PASS (15/16 屏)** | **9.0 / 10** | **硬核扎实**：市场逐量抬价 $\to$ 殖民地四级物流看板（五态诊断） $\to$ 三层垂直空间 $\to$ `#2` 量子相位锁定 $\to$ 戏剧导演 $T/A$ 遥测与内置 17 项自检套件全部真实运转。 |
| **界面清晰度与操作顺手度** | **6.0 / 10** | **6.5 / 10** | **受静默失败拖累**：点击 `3D 地表` 闪回主菜单（P0）、建造入队列无 Toast、信标响应无收益回执、情报不足点渗透无提示。 |
| **3D 星系与 3D 地表视觉表现** | **8.0 / 10** | **7.5 / 10** | **星系轨道惊艳，地表待解锁**：3D 脉冲星/气巨环带与右键四向径向轮盘获满分好评；热修复绕过 `B1` 后 3D 地表外骨骼与环境生存硬核可玩，但存在初始 HP 残留与平衡痛点。 |

---

### 1.2 外测暴露的 12 项缺陷全链路源码根因定位表（100% 精确到行号）

领域专家已将三份报告发现的所有异常与源码逐行比对，全部定位到确切文件与行号，无一悬案：

| 编号 | 严重度 | 外测报告现象描述 | 源码级真实根因定位（Verified Causal Truth） | 修复复杂度 |
| :---: | :---: | :--- | :--- | :---: |
| **`BUG-01`**<br/>(B1) | **P0 阻断** | 点击【🌍 3D 地表模式】或【派遣先遣队登陆】立即闪回主菜单，控制台报 `路由失败 TypeError: this._refreshOperaChip is not a function`。 | [src/ui/screens/GroundView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:363` 在 `_setHead()` 中调用了 `this._refreshOperaChip()`，但 M4 工位 D 在文件末尾 `:1952` 将其实现为了独立导出函数 `export function refreshGroundOperaChip(view)`，未在 `GroundView` 对象上挂载 `_refreshOperaChip` 方法！且 `App.js` 捕获路由异常后仅打印 `console.warn('路由失败')` 并重定向回 `'menu'`，导致只检查 `console.error` 的旧门禁漏检。 | **1 行秒修** |
| **`BUG-02`**<br/>(领袖超编) | **P0 严重** | 新战役第 1 天打开【政府】视图，群像英雄即显示 `在编 18/上限 4`（统帅）与 `10/上限 4`（政务官），开局直接承受 `×4.50` 维护费与 `×0.10` XP 惩罚！ | 1. [src/domain/world/worldMigration.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:84-90` 对全银河 **6 大派系全部 30 名角色**挂载了 `ch.paragon`；<br/>2. 但 [src/domain/characters/galacticParagons.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:155-173` `leaderCapStats`、[src/ui/screens/GovernmentView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:347-349` 与 [src/simulation/ViewModels.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:428` 遍历 `world.entities.characters` 时**漏写了 `ch.factionId === world.playerFactionId` 过滤条件**，把 5 个 AI 帝国的 25 名将领全算进了玩家编制！ | **3 处过滤即修** |
| **`BUG-03`**<br/>(B4) | **P1 高危** | 在【外交】视图点击【买入 5% CHOAM 股份】，持股从 `0% -> 5%`，但信用点 `1941 -> 1941` 分文未扣（白嫖垄断股权漏洞）。 | [src/domain/diplomacy/galacticSenateAndCrisisArc.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:266-279` `adjustChoamShares(world, delta)` 仅修改了 `soState.landsraad.choamShares`，**完全漏掉了对玩家账本 `debit / credit` 的信用点扣减与回收结算**。 | **10 行函数补齐** |
| **`BUG-04`**<br/>(§4.2) | **P1 高危** | 外部探针或控制台以标准字符串实体 ID（如 `planetId: "plt_101"`、`empireId: "fac_553"`）派发 `ExcavateSubterraneanLayer` / `ConfigureFleetDoctrine` 时被契约校验拒绝。 | [src/domain/world/commandSchemas.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) 将 `planetId / empireId / fleetId / shipId / leaderId` 声明为 `type: 'number'`。虽然 UI 内部用 `numId('plt_101') -> 101` 做了剥离，但直接传运行时字符串 ID 会被 `validateSpaceOperaCommandPayload` 拦截。 | **兼容 `number \| string` 归一化** |
| **`BUG-05`**<br/>(B2) | **P1 高危** | 弱网/跨海首次打开 GitHub Pages 时，界面偶发卡在「加载核心模块」超过 6 分钟不前进。 | [index.html](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:38-58` 默认先走 `<script type="module" src="./src/main.js">`，触发 **188 个独立 JS 文件的跨洋瀑布请求**；当深层子模块挂起或超时，浏览器未触发顶层 `m.onerror`，导致既不回退 `dist/void-frontier.bundle.js` 也不提示错误。 | **默认直载单文件 Bundle + 超时守护** |
| **`BUG-06`**<br/>(B3 & B5) | **P1 高危** | 银河星图默认取景偏下（星系集群挤在画布底部 1/4），且后期偶发一次切换回银河视图时画布黑屏（仅剩 HUD）。 | [src/render/GalaxyRenderer.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:124` 固定初始化 `view = {x:500, y:500, zoom:1}` 且相机俯仰 55°，未根据实际生成星系坐标包络或玩家母星居中对焦；GL FBO 异常或尺寸抖动时缺少一键复位与自动回退重绘。 | **首帧母星/质心自适配 + 复位按钮** |
| **`BUG-07`**<br/>(B7) | **P2 中危** | 在 3D 地表任务阵亡后进入【自由探索模式】，左下角结构 HP 显示 `0/100`。 | [src/ui/screens/GroundView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:1049-1055` `_setupScene` 仅重置了 `c.vy = 0; c.onGround = true; c.state = 'idle'; c.fuel = 100;`，**漏写了 `c.hp = c.hpMax = 100; c.shield = c.shieldMax; c.stamina = c.staminaMax;`**，导致沿用了上一场阵亡时的残血状态！ | **3 行状态复位** |
| **`BUG-08`**<br/>(UX 回执) | **P2 中危** | 1. 响应子空间信标后弹窗关闭，但无浮层提示获得了什么奖励；<br/>2. 殖民地点击【建造】后进入队列，但无 Toast 提示，且缺合金 `waiting` 时未提示可去【市场】采购；<br/>3. 0 情报点点击【深度渗透】静默失败无提示。 | 1. [GalaxyView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:472` 与 [SystemView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:733` 派发 `RespondSubspaceBeacon` 后未读取 `lastBeaconResponse` 弹出 `toast`；<br/>2. [ColonyView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:453` 派发 `BuildOnColony` 后未弹入队回执；<br/>3. [DiplomacyView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:472-483` 未按玩家当前 `intelPoints` 预禁用按钮或弹出不足提示。 | **全面补齐 Toast 回执与按钮门控提示** |
| **`BUG-09`**<br/>(§4.4 & 信标 band) | **P2 中危** | 1. `colony.industrialAttention` 与 `radicalCellActive` 仅存于 `planet.compactState.colony`，未镜像到 `world.entities.colonies[cid]`；<br/>2. 信标对象缺少显式 `band`（`'red'\|'gold'\|'cyan'\|'purple'`）字段。 | 1. [src/domain/planets/spaceOperaColonyBridge.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:82-148` `syncColonyToSpaceOpera` 计算了关注度但未回写 `colony.industrialAttention` 与 `colony.radicalCellActive`；<br/>2. [src/simulation/ViewModels.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:755-780` 映射了 `color` 与 `frequency`，未附带 `band` 简写键。 | **双向字段镜像补齐** |
| **`BUG-10`**<br/>(Beholder 保底) | **P2 体验** | 指南力推的招牌双形态传奇领袖 `The Beholder` 在新局前 60 分钟找不到（原逻辑需 `month >= 120` 才按 10% 概率刷出）。 | [src/domain/characters/galacticParagons.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:647` `LEGENDARY_ARRIVAL_MIN_MONTH = { TUBOREK: 60, THE_BEHOLDER: 120 }` 门槛过高，外测前 2 个游戏月不可能触发。 | **开局保底或首座先驱者信标/遗迹保底唤醒** |
| **`BUG-11`**<br/>(B6 & B9) | **P2 体验** | 1. 3D 地表任务模式按 `7/8/9/0` 部署键被静默忽略，按 `V` 面罩提示不够醒目；<br/>2. 打开弹窗或切离 `ground` 视图时地表任务时钟未自动暂停。 | 1. [src/ui/screens/GroundView.js](https://drive.google.com/file/d/[REDACTED]/view?usp=drivesdk) `:1455` 限制了 `if (this.mode === 'free')` 才允许部署 `7/8/9/0`，导致任务模式无法放 `8` 号充能桩抵御熔岩风暴；<br/>2. `_missionFrame` 未检测活跃弹窗或页面失焦暂停。 | **开放任务模式野战部署 + 弹窗自动暂停** |
| **`BUG-12`**<br/>(B10 & 生存平衡) | **P3 平衡** | 熔岩星大气伤害在 223 秒内团灭 30 护盾小队；队友「跟随」AI 径直冲进 60 HP 敌方炮塔火线送死。 | 外骨骼初始护盾 `30` 偏低且任务模式原先禁用了 `8` 号热能充能桩；小队跟随 AI 未对敌方固定炮塔射程做切向绕行或优先集火判定。 | **外骨骼护盾提升至 `60` + 开放充能桩 + AI 避障/集火** |

---

## 第二部分：阶段五（Phase 5 / M5）SuperPower 施工文档（热修复收口 + 外测共创精选实装）

### 一、Plan（M5 阶段架构目标与双轨路线图）

阶段五（M5）定名为 **“外网实测痛点清零与玩家共创精选实装战役（Live Playtest Polish & Co-Creation Expansion）”**，分为两大并行波次：

1. **Wave 1（P0/P1 阻断级热修复与 UX 零静默工程 —— 工位 A & B）**：
   - **彻底修复 `GroundView` 挂载崩溃（`BUG-01`）**，并在门禁套件中将 `console.warn('路由失败')` 升级为硬性失败断言，确保 **16 / 16 视图 100% 真机零警告挂载**；
   - **修复群像英雄跨派系超编统计（`BUG-02`）**、**补齐 `CHOAM` 股份买卖信用点结算（`BUG-03`）**、**打通 `commandSchemas` 整数/字符串双模 ID 兼容（`BUG-04`）**、**将 `index.html` 切换为单文件 Bundle 优先秒开模式（`BUG-05`）**；
   - **消除全部静默失败（`BUG-06` ~ `BUG-12`）**：为信标回应、建筑入队、间谍渗透、地表部署与面罩切换全部加上即时 Toast 回执与前置原因提示，并在新战役中提供传奇领袖 `The Beholder` 的首日/首月保底招募入口。
2. **Wave 2（外测六大共创赛道高票脑洞精选实装 —— 工位 C & D）**：
   - 从两份外测报告提交的 12 个高质量玩家共创提案中，精选 **6 项最具太空歌剧灵魂且架构正交的创意** 直接实装入库：
     1. **【赛道 A · 新增原型】** 扩展天体机制或特殊奇观词条 **「镜渊回声 / 记忆尘埃场（Echo Mirror Anomaly）」**（提升全星区情报解密 `+2`，但深核钻探有概率唤醒镜像守卫掉落双倍奇异物质）；
     2. **【赛道 B · 玩家署名信标入库】** 在 `src/content/spaceOperaBeacons.js` 正式实装外测玩家投稿的两条高赞信标微小说——**《最后的跃迁灯塔员（K. 维瑟尔）》** 与 **《自动收费门架 Toll-Station-7》**（含完整双分支效果与玩家共创致谢标识）；
     3. **【赛道 C · 新增第 3 位传奇群像】** 在 `galacticParagons.js` 新增传奇导航官 **「缄默制图师 · 赛拉（Sera the Silent Cartographer）」**（携带创伤背景与专属天命【虚空裁缝】：全帝国舰队跨星系航行燃料消耗 `-40%`、航速 `+25%`）；
     4. **【赛道 D · 兰兹拉德第 4 宪章法案】** 在 `galacticSenateAndCrisisArc.js` 新增 **《星火科研共享公约（`CHARTER_STARFIRE_PACT`）》**（通过后全银河科研速度 `+20%`，违约宣战方承受 `+25%` 市场交易税惩罚）；
     5. **【赛道 E · 传奇 S-Mod 新词条】** 在 `fleetDoctrineAndScars.js` 新增 **【不沉勋章（`smod_unsinkable_medal`）】** 与 **【纳米寄生修复群（`smod_nanite_symbiont`）】**；
     6. **【赛道 F · 3D 地表巨兽过载弱点联动】** 在 `GroundView.js` 实装 **“深核钻机（`X`）共振破甲机制”**：当深核钻机运转且警戒热度达到 `★3` 以上时，利维坦与先驱者机偶守卫受到共振干扰，玩家武器对其造成的伤害提升 **`×2.0`**（将“深核采掘风险”转化为“讨伐巨兽的战术正反馈”）。

---

### 二、Tasks（M5 原子化施工任务拆解）

#### Task 56.1：【工位 A · P0/P1 核心阻断修复】3D 地表挂载、单文件秒开引导与命令 ID 双模兼容
* **修改文件**：
  1. `src/ui/screens/GroundView.js`
  2. `src/app/App.js`
  3. `src/domain/world/commandSchemas.js`
  4. `src/app/commandsSpaceOpera.js`
  5. `index.html`
* **精确实施契约**：
  1. **`GroundView` 挂载崩溃修复（`BUG-01`）**：
     - 在 `src/ui/screens/GroundView.js:363` `_setHead` 方法内，将 `this._refreshOperaChip();` 改为调用 `refreshGroundOperaChip(this);`；
     - 同时在 `GroundView` 对象上显式定义实例方法 `_refreshOperaChip() { refreshGroundOperaChip(this); }`，保证任何外部或内部调用 `this._refreshOperaChip()` 均安全无误。
  2. **`GroundView` 自由探索与任务模式状态隔离修复（`BUG-07 / BUG-11 / BUG-12`）**：
     - 在 `GroundView.js:1049` `_setupScene` 初始化 `this.char3d` 时，显式重置满状态：`c.hpMax = 100; c.hp = 100; c.shieldMax = 60; c.shield = 60; c.staminaMax = 100; c.stamina = 100; c.fuel = 100; c.flash = 0;`（将初始外骨骼护盾由 `30` 提升至 `60`）；
     - 在 `GroundView.js:1455` `Digit7..Digit0` 与 `KeyX` 处理分支中，移除 `if (this.mode === 'free')` 的硬限制，改为 `if ((this.mode === 'free' || this.mode === 'mission') && this.planet)`，允许玩家在地面战术任务中同样部署 `8` 号热能充能桩抵御极端环境伤害與恢复护盾；
     - 按 `KeyV` 切换分析面罩时，调用 `toast(this._visorOn ? '已开启三模态科考面罩（按 Tab 切换：生态光谱 / 电磁测向 / 地质穿透）' : '已关闭科考分析面罩', { kind: 'info' })`；
     - 在 `_missionFrame(dt)` 首部检查：若 `document.querySelector('.vf-modal-backdrop')` 存在（即有模态弹窗打开），则暂停推进 `stepMission` 时钟，防止玩家阅读弹窗时小队被环境伤害团灭（`BUG-09`）。
  3. **命令契约 `number | string` 实体 ID 双模兼容（`BUG-04`）**：
     - 在 `src/domain/world/commandSchemas.js` 的 `validateSpaceOperaCommandPayload(cmd)` 中，当字段定义 `f.type === 'number'` 且字段名以 `'Id'` 结尾（如 `planetId`, `empireId`, `fleetId`, `shipId`, `leaderId`, `paragonId`, `wreckEntityId`, `targetPlanetId`, `situationId`, `beaconId`）时，若传入值为形如 `'plt_101'`、`'fac_553'`、`'flt_563'`、`'shp_12'`、`'chr_7'` 的非空字符串且尾部或整体可解析为有限整数，视为合法通过；
     - 在 `src/app/commandsSpaceOpera.js` 的 `executeSpaceOpera` 入口，对上述 ID 字段若为字符串则自动兼容解析，确保无论传入 `{ planetId: 101 }` 还是 `{ planetId: 'plt_101' }`、无论传入 `{ empireId: 1 }` 还是 `{ empireId: 'fac_553' }`，均 100% 正常执行并改变世界状态。
  4. **`index.html` 单文件 Bundle 优先极速加载器（`BUG-05`）**：
     - 修改 `index.html:38-58`：除 URL 显式携带 `?esm=1` 的源码调试模式外，默认直接加载 `./dist/void-frontier.bundle.js`（将 188 个文件的跨洋请求压缩为 **1 个请求**，冷启动耗时从分钟级降至 `< 1.5 秒`），若 Bundle 加载失败再回退 `./src/main.js` 并在 8 秒超时后在 `#boot-status` 给出可见重试按钮。

#### Task 56.2：【工位 B · 经济与群像平衡修复】本国领袖过滤、CHOAM 股价结算、信标 `band` 与全链路 Toast 回执
* **修改文件**：
  1. `src/domain/characters/galacticParagons.js`
  2. `src/ui/screens/GovernmentView.js`
  3. `src/simulation/ViewModels.js`
  4. `src/domain/diplomacy/galacticSenateAndCrisisArc.js`
  5. `src/domain/planets/spaceOperaColonyBridge.js`
  6. `src/ui/screens/GalaxyView.js`、`SystemView.js`、`ColonyView.js`、`DiplomacyView.js`
* **精确实施契约**：
  1. **修复领袖容量统计跨派系污染（`BUG-02`）**：
     - 在 `galacticParagons.js:155-173` `leaderCapStats(world, profession, factionId = null)` 中：确定目标派系 `const targetFaction = factionId || (world && world.playerFactionId) || null;`；遍历 `characters` 时，若 `targetFaction && ch.factionId && ch.factionId !== targetFaction` 则 `continue` 跳过（兼容无 `factionId` 的合成单元测试人物）；
     - 在 `GovernmentView.js:349` 与 `ViewModels.js:428` 过滤 `roster` 时，严格加上 `(!w.playerFactionId || !ch.factionId || ch.factionId === w.playerFactionId)`，使玩家【政府】视图只展示本国在编领袖（开局约 5 人，每职业 1~2 人，均在上限 `4` 以内，彻底消除开局 `18/4` 超编 Bug！）。
  2. **传奇领袖 `The Beholder` 保底唤醒机制（`BUG-10`）**：
     - 在 `galacticParagons.js` 与 `GovernmentView.js` 中，若当前战役尚未招募 `THE_BEHOLDER`，在【政府 · 星海群像英雄】面板提供 **【唤醒先驱者核心：全视凝视者（The Beholder）】** 按钮（或在新战役 `activateSpaceOperaCampaign` 时直接为玩家派系生成处于待命态的 `THE_BEHOLDER` 传奇档案，`capExempt: true`），让所有外测玩家开局即可实测“低语方尖碑总督 ⟷ 战舰旗舰统帅”双形态切换！
  3. **补齐 `CHOAM` 股份买卖信用点真实结算（`BUG-03`）**：
     - 在 `galacticSenateAndCrisisArc.js` 中定义常量 `export const CHOAM_SHARE_CREDITS_PER_PCT = 100;`（每 1% 股份基准价 100 信用点，买入 `5%` 需 `500` 信用点，抛售 `5%` 回收 `500` 信用点）；
     - 在 `adjustChoamShares(world, delta)` 中：当 `world.economy && world.playerFactionId && world.economy.ledgers && world.economy.ledgers[world.playerFactionId]` 存在时，若 `actualDelta > 0` 则调用 `debit(world, pf, 'credits', actualDelta * CHOAM_SHARE_CREDITS_PER_PCT, 'choamBuy', 's7')`（余额不足时抛 `Error('SO: 信用点不足，无法买入 CHOAM 股份')`）；若 `actualDelta < 0` 则调用 `credit(world, pf, 'credits', Math.abs(actualDelta) * CHOAM_SHARE_CREDITS_PER_PCT, 'choamSell', 's7')`。
  4. **补齐 `colony.industrialAttention` 镜像与信标 `band` 字段（`BUG-09`）**：
     - 在 `spaceOperaColonyBridge.js` `syncColonyToSpaceOpera` 末尾，将 `colony.industrialAttention = cColony.industrialAttention;` 与 `colony.radicalCellActive = Boolean(cColony.radicalCell && cColony.radicalCell.state === 'ACTIVE');` 镜像回写到 `world.entities.colonies[cid]` 实体上；
     - 在 `ViewModels.js:763-780` `beaconsList` 投影中，新增 `band` 字段（`FREQ_MILITARY_SOS -> 'red'`, `FREQ_COMMERCE_BLACK -> 'gold'`, `FREQ_PRECURSOR_WHISPER -> 'cyan'`, `FREQ_GALACTIC_DAILY -> 'purple'`, `OPPORTUNITY_BEACON -> 'gold'`），并同步写入 `subspaceBeaconStream.js` 生成的信标对象。
  5. **全视图交互回执 Toast 与星图居中复位（`BUG-06 / BUG-08`）**：
     - `GalaxyView.js` & `SystemView.js`：点击信标响应按钮后，读取 `w.spaceOperaState.lastBeaconResponse` 并弹出 `toast` 明示奖励（如 `◈ 信标响应完成：获得 +600 信用点` 或 `◈ 信标响应完成：帝国凝聚力 +15`）；
     - `ColonyView.js`：点击【建造】成功后弹出 `toast('已排入建造队列：' + def.name + '（缺合金时可在【市场】采购）', { kind: 'ok' })`；
     - `GalaxyRenderer.js` & `GalaxyView.js`：首次加载快照时自动将 `this.view.x / y` 对准玩家母星系（或全部星系坐标质心），并在 `GalaxyView` 顶栏增加 **【🎯 复位视角】** 按钮。

#### Task 56.3：【工位 C & D · 外测玩家共创脑洞精选实装】信标微小说、传奇制图师赛拉、星火公约与巨兽共振破甲
* **修改文件**：
  1. `src/content/spaceOperaBeacons.js`
  2. `src/domain/characters/galacticParagons.js`
  3. `src/domain/diplomacy/galacticSenateAndCrisisArc.js`
  4. `src/domain/fleets/fleetDoctrineAndScars.js`
  5. `src/ui/screens/GroundView.js`
* **精确实施契约**：
  1. **实装外测共创信标微小说（赛道 B）**：
     - 在 `src/content/spaceOperaBeacons.js` 的 `SUBSPACE_BEACON_TEMPLATES` 中新增：
       - `tpl_co_last_lighthouse`（**《最后的跃迁灯塔员》**，频段 `FREQ_GALACTIC_DAILY`，致谢外测指挥官 K.V.）：提供「回拨坐标继承遗产（`+350` 信用点）」与「将灯塔铭文刻入信标链（`+25` 凝聚力）」双选项；
       - `tpl_co_automated_toll_7`（**《自动收费门架 Toll-Station-7》**，频段 `FREQ_COMMERCE_BLACK`）：提供「照付过路费获取跃迁固件校准（`+40` 科研数据）」与「黑入收费门架截留资金（`+400` 信用点）」双选项。
  2. **实装第 3 位传奇群像英雄「缄默制图师 · 赛拉」（赛道 C）**：
     - 在 `galacticParagons.js` `LEGENDARY_PARAGONS` 中新增 `SERA_CARTOGRAPHER: { nameZh: '缄默制图师·赛拉', capExempt: true, foldLaneFuelSaving: 0.40 }`，并在 `DESTINY_TRAITS` 中新增 `commander_void_tailor`（**【虚空裁缝】**：折叠航道直连，舰队补给消耗 `-40%`、紧急撤退成功率 `+20%`）。
  3. **实装兰兹拉德第 4 宪章法案《星火科研公约》与传奇 S-Mod（赛道 D & E）**：
     - 在 `LANDSRAAD_BILL_KINDS` 中新增 `'CHARTER_STARFIRE_PACT'`（**《星火科研共享公约》**：通过后赐予玩家 `+120` 科研数据并激活星火科研加成）；
     - 在 `SMOD_CATALOG` 中新增 `smod_unsinkable_medal`（**【伤口即勋章·不沉者】**：结构低于 25% 时全武器伤害 `+30%`）与 `smod_nanite_symbiont`（**【群星寄生菌群】**：战后自动修复舰队 `5%` 结构）。
  4. **实装 3D 地表「深核钻机共振破甲」机制（赛道 F）**：
     - 在 `GroundView.js` `_syncLeviathan` 与 `_updateWarden` 玩家攻击结算中：检测当前行星 `this.planet.surfaceDelta.extraction[0] === 1`（深核钻机运行中）且警戒星级 `star >= 3` 时，触发 **【深核共振弱点暴露】**，玩家对利维坦与先驱者机偶造成的伤害乘以 **`2.0`**，并弹出 `toast('⚡ 深核共振破甲触发：巨兽晶核过载，造成双倍伤害！', { kind: 'ok' })`。

---

### 三、Checklists（M5 防伪绿验收清单与门禁断言）

- [ ] **CHK-M5-01（`GroundView` 真机挂载与 16 屏零警告门禁）**：调用 `GroundView.mount({ root, app, param: planetId })` 断言不抛任何异常、`this.headOperaChip` 正确渲染行星原型徽标，且全量 16 屏切换过程中 `console.error` 与 `路由失败` 警告数严格等于 **`0`**。
- [ ] **CHK-M5-02（本国领袖容量隔离与 `The Beholder` 保底可达）**：在 6 派系 30 角色新战役中，断言 `leaderCapStats(world, 'commander')` 仅统计玩家派系角色（在编数 $\le 4$，维护费倍率 `=== 1.0`），且玩家在开局【政府】视图可直接操作 `The Beholder` 双形态切换。
- [ ] **CHK-M5-03（`CHOAM` 股份买卖信用点守恒与双模 ID 派发）**：断言玩家派发 `AdjustChoamShares({ delta: 5 })` 精确扣减 `500` 信用点、抛售 `-5` 精确退还 `500` 信用点；断言以字符串 `{ planetId: 'plt_101', depthTier: 1 }` 派发 `ExcavateSubterraneanLayer` 及以 `{ empireId: 'fac_553', ... }` 派发 `ConfigureFleetDoctrine` 均返回 `{ ok: true }`。
- [ ] **CHK-M5-04（`colony.industrialAttention` 实体镜像与信标 `band` 字段）**：在殖民地建造 3 座重工 + 1 座实验室后，断言 `world.entities.colonies[cid].industrialAttention >= 7` 且 `radicalCellActive === true`；断言 `spaceOperaView(world).beaconsList` 每项均含非空 `band ∈ {'red','gold','cyan','purple'}`。
- [ ] **CHK-M5-05（外测共创精选内容实装核验）**：断言 `SUBSPACE_BEACON_TEMPLATES` 含《最后的跃迁灯塔员》与《自动收费门架》，`LANDSRAAD_BILL_KINDS` 含 `CHARTER_STARFIRE_PACT`，`SMOD_CATALOG` 含 `smod_unsinkable_medal`，且 `REG-01` 4,320 Ticks 金快照哈希仍保持 **`8be8ce2c`** 零漂移。
