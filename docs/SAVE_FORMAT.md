# SAVE_FORMAT — 存档格式与持久化协议

> 实现文件：`src/persistence/SaveCodec.js`（编码/校验/导入导出）、
> `src/persistence/SaveManager.js`（槽位与加载管线）、`src/persistence/Database.js`
> （IndexedDB 封装）、`src/persistence/MigrationRegistry.js`（版本迁移）、
> `src/persistence/ImportExport.js`（文件下载/选择）。schemaVersion 当前为 **1**
> （`src/domain/world/World.js SCHEMA_VERSION`），尚无历史版本。

## 1. 存档记录结构

每条存档记录（IndexedDB 一行 / 导出 JSON 一个对象）：

```json
{
  "format": "void-frontier-save",
  "schemaVersion": 1,
  "gameVersion": "0.1.0",
  "createdAt": null,
  "savedAt": "2026-11-03T12:00:00.000Z",
  "worldSeed": 24601,
  "worldTick": 1728,
  "checksum": "9a3f01c4",
  "summary": {
    "factionName": "边境联合体",
    "name": "自动 · 星历3.04 00:00",
    "slotId": "auto",
    "galaxySize": "standard",
    "difficulty": "standard",
    "playTicks": 1728,
    "entityCounts": { "factions": 6, "systems": 96, "...": "..." }
  },
  "payload": { "...完整 World 对象...": "" }
}
```

字段说明（`SaveCodec.encodeSave`）：

| 字段 | 来源 | 说明 |
| :--- | :--- | :--- |
| `format` | 常量 `SAVE_FORMAT` | 格式标识，校验第一关 |
| `schemaVersion` | `world.schemaVersion` | 迁移链入口版本 |
| `gameVersion` | `world.gameVersion` | 人类可读版本；不参与迁移判定 |
| `createdAt` | `world.createdAt ?? null` | **当前 world 不写 createdAt，恒为 null**（占位字段） |
| `savedAt` | `new Date().toISOString()` | 唯一允许的真实时间——只存在于存档记录，**不进入 payload**，不破坏确定性回归 |
| `worldSeed` / `worldTick` | `world.seed` / `world.tick` | 摘要冗余，供列表页免解包显示 |
| `checksum` | `hash32(stableStringify(payload))` 的 8 位十六进制 | FNV-1a 32 位，对 payload 规范化字符串计算 |
| `summary` | `encodeSave(world, summary)` 入参 + 自动统计 | 文明名/星系规模/难度/实体计数；槽位名（`dateStr(tick)` 或玩家命名） |
| `payload` | 整个 World 对象 | World 本身即纯数据，直接作为 payload；结构见 `docs/DATA_SCHEMA.md` |

## 2. 校验流程

### 2.1 写入前（`SaveManager.save`）

1. `checkWorldInvariants(world)`（`src/core/invariant.js` 完整检查：全局 ID 唯一、
   引用可解析、账本/殖民地库存非负、RNG 状态合法）——不通过**拒绝保存**，
   绝不把非法世界写盘。
2. `Database.putSave(rec)` 整条记录覆盖式写入；`Database.setMeta('lastSlot', slotId)`
   记录最近槽位。

### 2.2 读取/导入（`SaveManager.load`、`SaveCodec.decodeImported`）

加载管线顺序（任一步失败即终止并返回 `{ok:false, reason}`）：

```text
validateSaveRecord(rec)
  ├─ format === 'void-frontier-save'
  ├─ schemaVersion 为正整数
  ├─ worldTick 为非负整数
  ├─ payload 存在且含 seed / tick / entities
  └─ checksum === hash32(stableStringify(payload))   ← SAVE-03 主防线
→ migratePayload(payload, rec.schemaVersion → SCHEMA_VERSION)
→ checkWorldInvariants(world)                          ← 语义级终检
→ 返回 { ok, world, record }
```

关键点：**校验失败不覆盖原存档**——load 全程只读；导入记录在玩家确认前不落库
（`importFromText` 只解析，`commitImport` 由 UI 确认后写入指定槽位）。

## 3. 版本迁移（`MigrationRegistry.js`）

- 单向版本链 `v1 → v2 → …`：`registerMigration(fromVersion, fn)` 注册
  「payload 从 v 升到 v+1」的纯函数；`migratePayload` 循环执行直到最新版本，
  返回 `{ok, payload, applied[]}`；缺迁移函数或抛错 → `{ok:false, reason}`，
  原记录保留不动（SAVE-04）。
- **当前状态：v1 为首个正式 schema，未注册任何迁移函数**（文件内注释给出示例写法）。
  任务书要求的「每个历史版本 fixture + 迁移测试」在 SAVE-04 PENDING 前需要先建立
  fixture 目录（建议 `tests/fixtures/save-v*.json`）。
- 新增字段的操作规程：改 `World.js` 工厂 → bump `SCHEMA_VERSION` → 注册迁移
  → 在 `tests/suites/` 补迁移套件 → 更新 `docs/DATA_SCHEMA.md`。

## 4. 槽位与自动保存

- **槽位**（`SaveManager.SLOTS`）：`manual-1` `manual-2` `manual-3` `auto` `quick`
  （3 手动 + 1 自动 + 1 快速，符合任务书 8.1）。
- **自动保存**：`App._autosaveCheck`（`src/app/App.js`）按世界设置
  `settings.autosaveIntervalDays`（默认 2 游戏日 = 48 tick）触发 `saveAuto`，
  记 `stats.lastAutosaveTick`；写入为异步 `.catch` 记录，不阻塞模拟帧。
- `saveQuick` / `save(world, slotId, name)` 供设置页与快捷键调用；
  `list()` 返回按 `savedAt` 降序的槽位列表（主菜单存档列表消费，`MenuView.js`）。
- 两段式提示：当前实现为「不变量校验通过才写」，任务书 8.2 的
  「临时记录→写入成功后标记」增强（write-ahead temp record）尚未实现，见 §8。

## 5. IndexedDB 结构（`Database.js`）

| 项 | 值 |
| :--- | :--- |
| 数据库名 | `void-frontier` |
| 版本 | 1（`onupgradeneeded` 建库） |
| store `saves` | `keyPath: 'slotId'`，整条存档记录（含 payload） |
| store `meta` | `keyPath: 'k'`，轻量键值（`lastSlot` 等） |
| 事务 | 每次 put/get/delete/getAll 独立事务；`onabort/onerror` 向上 reject |
| 退化模式 | `indexedDB === undefined`（部分浏览器 `file://`、Node 测试环境）→ **内存 Map 实现**（`memoryMode`），行为一致，测试可用；`Database.isMemoryMode()` 可查询 |

localStorage 只保存轻量设置（音量、语言、教程标志等，`SettingsView.js` 与
`AudioManager.js`），不存任何世界数据——与任务书 8.1 一致。

## 6. 导入 / 导出与安全约束

- **导出**：`ImportExport.downloadSave(record, filename)` → Blob JSON 下载
  （默认名 `void-frontier-save-<tick>.json`）；`SaveCodec.exportSaveCompressed`
  在支持 `CompressionStream` 时输出 gzip 的 base64，否则退化为纯 JSON。
- **导入**：`ImportExport.pickSaveFile()` 文件选择器（上限 **24MB**，`MAX_IMPORT_BYTES`）
  → `decodeImported(text)`：JSON.parse（不 eval、不 new Function、不拼 HTML）→
  `validateSaveRecord` 全检 → 返回待确认记录，UI 展示版本/文明/游戏时间后由玩家
  确认槽位再 `commitImport`（不静默覆盖当前槽位）。
- 导入文本一律视为不可信输入：解析失败、格式不符、checksum 不匹配、字段缺失
  全部拒绝并给出 reason；存档内容不含任何可执行结构。

## 7. 多标签页策略 — **未实现（如实记录）**

任务书 8.4 要求 BroadcastChannel 会话 lease / 只读降级。当前代码库**没有**任何
BroadcastChannel 或 Web Locks 实现（全仓 grep 无命中）；两个标签页同时打开同一
浏览器配置文件时会共享同一 IndexedDB，并发自动保存存在相互覆盖槽位的风险。
临时缓解（交接者须知）：

- `Database.setMeta('lastSlot', …)` 可作为后续 lease 实现的挂点；
- 建议实现顺序：启动时 `navigator.locks`（若可用）→ BroadcastChannel 仲裁 →
  localStorage 尽力而为提示，与任务书 8.4 的降级顺序一致。

## 8. 已知缺口（与 TEST_MATRIX / RUNBOOK 对应）

| 缺口 | 影响 | 计划 |
| :--- | :--- | :--- |
| SAVE-02（RNG 恢复一致性）无套件 | 存读档续推的确定性无回归保护 | `save-rng.suite.js`（worldHash 对照） |
| SAVE-03 仅 codec 层覆盖 | ImportExport/Database 层损坏路径未测 | `save-corrupt.suite.js` |
| SAVE-04 无历史 fixture | 迁移机制有实现、无证据 | 建 `tests/fixtures/` + `save-migration.suite.js` |
| `captureCheckpoint` 缺失 | `App.startNewGame` 调用了 `saveManager.captureCheckpoint(world)`（`src/app/App.js`），但 `SaveManager.js` 无此方法 → 新战役开局会抛错进错误边界 | 在 SaveManager 补实现（建议语义：写入一次性检查点槽位或直接落 `auto`） |
| 两段式自动保存未实现 | 极端情况下写入中断可能留下旧记录（不会损坏，校验会拒绝） | 任务书 8.2 临时记录模式 |
| 多标签页仲裁未实现 | 并发写覆盖风险 | §7 的实现顺序 |
