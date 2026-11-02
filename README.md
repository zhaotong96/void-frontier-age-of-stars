# 无垠边疆：星海纪元 — VOID FRONTIER: AGE OF STARS

单机 4X 星际大战略 · 纯静态 Web 应用 · 零服务端、零外部运行时依赖。

> 从银河边缘的一支小型远航舰队开始：勘探、殖民、建链、造舰、外交、战争，
> 直至直面改写银河命运的终局抉择。所有逻辑在浏览器本地运行，可离线游玩。

## 快速开始

```bash
# 任意静态服务器指向本目录即可（无需构建）
python -m http.server 8090
# 浏览器打开 http://127.0.0.1:8090/
```

- **新战役**：主菜单设置种子/难度/规模后启航。
- **时间控制**：空格暂停；1-4 调整倍率。
- **存档**：自动存档每 2 游戏日；手动槽位在设置 → 存档管理。
- **诊断**：左侧导航「系统诊断」可在浏览器内运行全部自动化测试并导出报告。

## 技术栈（冻结）

原生 HTML5 / CSS3 / ES2022 Modules · Canvas 2D（WebGL2 可选）·
Web Audio（程序化合成）· IndexedDB 存档 · Service Worker 离线缓存。
生产环境不加载任何 CDN、字体、API 或第三方运行时（详见
`THIRD_PARTY_NOTICES.md` 与静态审计脚本）。

## 开发

```bash
npm test          # 运行全部自动化测试套件（Node）
npm run sim       # 离线批量模拟 CLI（平衡调参）
npm run lint:static  # 静态审计：外部依赖/绝对路径/占位代码扫描
```

工程结构与架构约定见 `docs/ARCHITECTURE.md`；世界数据模型见
`docs/DATA_SCHEMA.md`；规则与数值见 `docs/GAME_RULES.md`。

## 部署（GitHub Pages）

仓库即发布目录：推送后启用 Pages（root / main 分支）即可。全部资源为
相对路径，hash 路由（`#/galaxy`），天然兼容 `https://<user>.github.io/<repo>/`
二级路径。`404.html` 提供回退。

## 许可证

MIT（见 `LICENSE`）。所有代码、美术（程序化生成）、音频（合成）与文本均为原创。
