---
name: void-frontier-qa-lifecycle
description: docs 25-28 全生命周期测试工程竣工：56 套件 168 轮全绿、11 项生产热修（F-03/05/12 P0）、F-14
  原型污染、金快照重基线 8be8ce2c
metadata:
  node_type: memory
  type: project
  originSessionId: [REDACTED]-00ec-4aef-b31d-b1901d7dbecf
---

2026-11-08 `[REDACTED]` 按 docs 25-28 顺序测试方案竣工（doc24 为总纲）：**56 套件 × 3 轮 = 168 轮全绿零漂移（exit 0）**，lint:static 零违规，bundle 151 模块 1970KB，金快照合法重基线 **68462446 → 8be8ce2c**（CHANGELOG 归档）。逐轮记录 `test_review.md`（5 章），终版报告 `docs/reports/report-full-lifecycle-qa.md`。

**新增测试资产**：tests/agent（五阶段 Agent）、tests/fuzz（10k 步风暴 + BlackBox Dump + replay-crash.mjs）、tests/soak（1,000 天浸泡 + 真实 GL 泄漏审计 + 千种子巡检）、tests/e2e（四战役里程碑，胜利 ending=transcendence）、4 张浏览器门禁页（agent/fuzz/soak/campaign runner，端口 8093 dev-server）；run-suites.mjs 升 v2（REPEAT=3 指纹对拍 + Math.random 毒丸 + tier/group/id 筛选 + 毫秒计时归一化）。

**生产热修 11 项**（P0×3：F-03/F-05 HourlySystems 缺失导入死代码链、F-12 工业电网无发电节点弹射死锁；P1×7：F-04 getRelation 守卫、F-06 幽灵关系键、F-07 八处 FLOW 记账、F-09 真机 GL VAO buffer 泄漏、F-10a 舰队 shipIds 重复、F-11 ALL_AI 广播失效、F-14 原型污染）+ F-10 主体（战斗停局）与 F-08（管线 1.8ms/日）移交。

**关键手法（复用）**：
1. **假绿三连实证**：Gate 套件直调域层绕过 HourlySystems 集成线（F-03/05/12）、mock VAO 级联删除语义偏离真机（F-09）、实体查询原型污染（F-14）——均 doc24 预言类。
2. **每命令全宇宙 deepClone 事务快照**（commandBus.js:83）→ 测试内高频命令派发不可行；UI 逐帧输入走 mission.input 瞬态通道（GroundView.js:2392 明示不经命令总线）。
3. **F-14 排查手法**：分域 worldHash 对拍（仅 stations 分包漂移）→ 对象内容 diff（titanAssembly 多出）→ Object.prototype 扫描定位。修复=registry.js DANGEROUS_KEYS 守卫。
4. **金快照漂移裁决程序**：先证「漂移被已审计修复完全解释」→ golden:update → REG-01/GATE-09 双口径 ×3 → CHANGELOG 归档。
5. **账本守恒审计**：transactions 原始账按 tick 窗口收割（daily 流水有相位差残差陷阱；record() 存带符号 delta）。
6. **IAB 测试页三件套**：rAF 看门狗 + window.__xxxReport 取证 + 长同步任务分 milestone 间让出主线程。
7. **dev-server 残留进程**：会话重启后先 netstat 查旧监听（2 天前的 stale server 会抢端口且内容为旧盘读）。

**遗留**：F-10 主体（战斗集成停局：移动冻结/歼灭判定/配对口径——完整证据链在 test_review.md 第 4 轮）与 F-08（管线 77-91µs/tick）移交施工轨；Pages 推送仍等凭据。

相关：[[void-frontier-ultra-longline]]、[[void-frontier-final-rework]]、[[stella-environment-setup]]、[[browser-automation-gotchas]]
