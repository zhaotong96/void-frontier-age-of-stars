# VOID FRONTIER: AGE OF STARS — 视觉美学返工报告

**返工依据**：`rework.md`（静态化部署修复与 WebGL 2.0 全 3D 光感美学重构）
**仓库**：`C:\PUBLIC\stella\void-frontier`
**基线承诺**：金快照 `a7492dc9`（后因平衡调优 + 政策系统 + 人物系统更新为最新确定性哈希）、23+ 自动化套件 46/46 全绿 —— **本次返工后仍 46/46 全绿**（领域层与模拟内核零改动）。

---

## Phase R1：零服务器纯静态自足（P0）✅

### 修复项
| 问题 | 修复 | 提交 |
|---|---|---|
| ES Modules 在 file:// 被 CORS 拦截，双击 index.html 永久卡死 | 新增 `tests/tools/build-static-bundle.mjs` 零依赖打包器（递归解析 import、export 全形态改写、IIFE 注册表），生成 `dist/void-frontier.bundle.js`（120 模块 1020 KB）；`index.html` 注入双模自适应加载器（file:// 直载 bundle / HTTP 优先 ESM 并 onerror 回退） | 59e523d |
| `SaveManager.captureCheckpoint` 缺失 | 补齐方法；App.startNewGame 兼容 captureCheckpoint 与 save 双接口 | 59e523d |
| IndexedDB 受限时 unhandledrejection 死锁 | Database 三级无感降级（IndexedDB → localStorage → 内存，运行时异常永久降级绝不外抛）；App.startNewGame 先进游戏后非阻塞检查点；TabGuard 防御性隔离 | 59e523d |
| `_advanceTick()` 异步 Promise 竞态 | 改为纯同步 `advanceOneTick(world)` 调用（静态导入消除微任务延迟） | 59e523d |
| 动态 `import()` 瀑布流启动阻塞 | scenarioFactory / commands / WorldSimulation 全部改为静态顶层导入 | 59e523d |
| Service Worker 路径与注册条件 | 仅 https: 注册（?nosw=1 跳过），相对路径 + scope './'，静默失败 | 59e523d |
| GitHub Pages Jekyll 干扰 | 添加 `.nojekyll` | 59e523d |

### 验收
- file:// 双击 index.html → 1 秒内进入主菜单 → 正常开启新战役（dist bundle 模式）
- HTTP 二级路径 `/void-frontier/` → Network 零 404、Console 零报错
- `npm test` → 46/46 全绿

---

## Phase R2：WebGL 2.0 底座与 HDR Bloom 管线（P0）✅

### 新增文件
| 文件 | 公开 API | 行数 |
|---|---|---|
| `src/render/gl/GLCore.js` | GLContext（fromExisting / compileShader / createProgram / createBuffer / createVAO / createTexture2D / createFloatTarget / createFullscreenVAO / createPingPongFBOs / destroy）+ drawInstanced + GLSL_VERSION | ~240 |
| `src/render/gl/Mat4.js` | mat4 全套（identity/multiply/perspective/ortho/lookAt/invert/translate/rotate/scale/TRS）+ vec3ApplyMat4 + mat4MulVec4 | ~180 |
| `src/render/gl/PostProcessor.js` | PostProcessor（resize / beginScene / endScene / setTier / rebuild / destroy）：RGBA16F 浮点帧缓冲（floatOk 探测 + RGBA8 回退模拟）、软膝盖高亮提取（threshold 0.85/knee 0.55）、4 级高斯辉光金字塔、Narkowicz ACES 色调映射、确定性哈希抖动去色带 | ~340 |
| `src/render/CanvasManager.js`（升级） | 双画布合成容器：底层 glCanvas（WebGL2）+ 顶层 hudCanvas（透明 2D，pointer-events:none）；beginGLFrame/endGLFrame/setTier/onGLStateChange/rebuild；webglcontextlost → opacity:0 退化（保留事件命中）+ contextrestored 自动重建 | ~280 |

### 验收
- gl.getError() = 0（GL 资源构建后）
- WEBGL_lose_context 触发 → 画面无报错平滑退化至 2D；恢复后自动重建
- 50 次视图切换无显存泄漏（资源清册 destroy 释放）

---

## Phase R3：3D 旋臂银河与天体光学着色器（P0）✅

### 新增/重写文件
| 文件 | 核心实现 |
|---|---|
| `src/render/gl/NoiseGLSL.js` | hash/simplex4D/fbm/脊状噪声/黑体色温 可拼接 GLSL 片段 |
| `src/render/gl/GalaxyParticles.js` | 确定性 40,000 实例化对数旋臂微粒（4 臂 + 核球 + 银晕 + H-II 粉紫团块 + 蓝巨星簇）；generateSupernovaSeeds |
| `src/render/shaders/BlackHoleShader.js` | 史瓦西度规 72 步 Velocity-Verlet 光线步进（引力透镜上下光弧、光子环、多普勒束流增亮、开普勒剪切吸积盘、Reinhard 输出压缩） |
| `src/render/shaders/StarCoronaShader.js` | 7 星型光球（4D Simplex-Worley 米粒组织 + 临边昏暗 + 黑子/耀斑）+ 日冕 billboard 风流线日珥 + 脉冲星双极相对论喷流 + 磁层激波环 |
| `src/render/shaders/NebulaShader.js` | 3D fBm 5 八度体积星云（域扭曲 + 比尔-朗伯尘埃消光）+ 超新星遗迹球壳（[O III] / H-α 双色交织 + 菲涅尔激波壳层） |
| `src/render/GalaxyRenderer.js`（重写） | 3D 轨道相机（pitch 10°..85° 右/中键旋转、光标锚定缩放）；40k 实例化粒子星系盘；体积星云 raymarch；航路/标尺线 3D 化；超新星遗迹球壳；星系节点 sprite；拾取经 viewProj 投影缓存（API 不变） |
| `src/render/gl/Galaxy3D.js` | GL 资源容器（粒子/精灵/线段/球壳 VAO + 5 个 GLSL 程序）；外部着色器模块动态探测 + 内置回退 |
| `src/render/SystemRenderer.js`（重写） | 3D 恒星系视图编排 + _render2D 兜底 + 投影拾取（射线-球相交） |
| `src/render/gl/System3D.js` | GL 资源（10 程序：背景/光球/日冕/脉冲星/黑洞 raymarch/行星 8 类/大气壳/行星环/轨道线）；行星 8 类 uCategory 分支着色器；已殖民夜半球灯火 + 轨道站环 |

### 浏览器实测截图
| 截图 | 内容 | 状态 |
|---|---|---|
| 3D 银河战略图 | 96 星系 3D 航路网络 + 势力环 + 银心光核 + 确定性星点 + 3D 透视 | ✅ 已截图 |
| 黑洞星系 | 史瓦西引力透镜阴影 + 吸积盘盘面（Doppler 增亮侧对角带）+ 3D 行星 | ✅ 已截图 |
| 脉冲星系统 | 双极相对论喷流十字 + 3D 轨道行星 + 舰队三角 | ✅ 已截图 |

---

## Phase R4：3D 舰队战术战场与全量回归（P1）✅

### 新增文件
| 文件 | 核心实现 |
|---|---|
| `src/render/meshes/ShipMeshes.js` | MeshBuilder（盒/楔形舰体/棱锥/鳍板/低模球）确定性构建 12 船体（59..129 三角形/船） |
| `src/render/gl/Battle3D.js` | 逻辑坐标→三维战术空间映射；12 船体 GL 网格 + 阵营色 Phong + 灯带；尾焰等离子锥；菲涅尔蜂窝护盾壳层（受击闪白）；相机对齐光束带（HDR 芯白 + 阵营辉光）；导弹光点；撤退切伦科夫跃迁漏斗；屏幕空间拾取 |
| `src/render/BattleRenderer.js`（改造） | GL / 2D 双通道调度（公开 API 不变）；环绕运镜相机；HUD 2D 层态势条/铭牌/微型血条；上下文丢失平滑退化 2D |
| `src/simulation/ViewModels.js`（增量） | battleView 补 hullId / retreatCharge / systemId |

### 验收
- 战斗视图 3D 舰体/光束/护盾正常渲染（COMBAT-01..06 断言 100% 一致）
- 100 艘战舰帧率：CPU 模拟层逻辑不变（~2ms/tick）+ GL 渲染 ~5ms → 60 FPS 预算内

---

## 全量回归验证

| 门禁 | 结果 |
|---|---|
| `npm test`（23 套件 × 2 轮 = 46 项） | **PASS 46 / FAIL 0** ✅ |
| 金快照确定性回归 | **PASS** ✅（领域层/模拟内核零改动） |
| 静态审计（`npm run lint:static`） | 无违规（无 Math.random / eval / 外链 / TODO）✅ |
| file:// 双击即玩 | ✅（bundle 模式） |
| HTTP 二级路径 | ✅（零 404 / 零报错） |
| 浏览器 Console | 零未处理异常 ✅ |
| GitHub Pages | deploy.yml 就位；实际推送需用户凭据（gh auth status 未登录）⚠️ |

## 剩余已知事项（均为增强，非阻断）
- AI 扩张速率偏快（平衡调优项）
- 战争触发条件过严（管线已验证，条件可调）
- 百科视图未单列（GAME_RULES.md 替代）
- 内容键的 en-US 深翻未完成（zh 为主语言）

## Git 提交链（返工新增 7 提交）
```
[政策/平衡/人物/成就等 8 提交 —— 上一阶段]
59e523d fix(boot): 静态自足与启动死锁修复（R1）
42ebf48 feat(render): 战术战斗 3D 战场与程序化舰体（R4）
88e12ca feat(render): R3 着色器资产层
5f03350 feat(render): 银河战略视图 3D 重写（R3）
0bed92f feat(render): 恒星系视图 3D 重写（R3）
15f1820 fix(render): 黑洞渲染管线修复 + 视觉调优
[+1 文档提交]
```
