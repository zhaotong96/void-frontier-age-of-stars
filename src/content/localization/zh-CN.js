/**
 * content/localization/zh-CN.js — 简体中文词典（默认语言）
 *
 * 语域：冷峻科幻军事指挥系统风格——简练、专业、去口语化。
 * 键结构：扁平点分键（如 'ui.galaxy'），与 en-US.js 键集严格一致；
 * 新增词条时两侧必须同步补充。
 */

export const DICT = {
  // ── 主导航界面 ──
  'ui.galaxy': '银河',
  'ui.system': '星系',
  'ui.colony': '殖民地',
  'ui.fleet': '舰队',
  'ui.designer': '舰船设计',
  'ui.combat': '战斗',
  'ui.research': '科研',
  'ui.market': '市场',
  'ui.diplomacy': '外交',
  'ui.intel': '情报',
  'ui.government': '政府',
  'ui.characters': '人物',
  'ui.ground': '行星行动',
  'ui.events': '事件',
  'ui.chronicle': '纪年',
  'ui.codex': '百科',
  'ui.settings': '设置',
  'ui.diagnostics': '系统诊断',
  'ui.saves': '存档',

  // ── 顶栏状态 ──
  'ui.pause': '暂停',
  'ui.speed': '倍率',
  'ui.resume': '继续',
  'ui.date': '日期',
  'ui.credits': '信用点',
  'ui.influence': '影响力',
  'ui.researchRate': '科研速率',
  'ui.threat': '威胁等级',
  'ui.notifications': '通知',

  // ── 通用操作 ──
  'ui.select': '选择',
  'ui.cancel': '取消',
  'ui.confirm': '确认',
  'ui.close': '关闭',
  'ui.back': '返回',
  'ui.search': '搜索',
  'ui.filter': '筛选',
  'ui.sort': '排序',
  'ui.export': '导出',
  'ui.import': '导入',
  'ui.save': '保存',
  'ui.load': '读取',
  'ui.newGame': '新战役',
  'ui.rename': '重命名',
  'ui.delete': '删除',
  'ui.details': '详情',
  'ui.explain': '计算来源',
  'ui.locked': '未解锁',
  'ui.blocked': '无法执行',
  'ui.cost': '成本',
  'ui.eta': '预计抵达',
  'ui.progress': '进度',
  'ui.queue': '队列',
  'ui.orders': '命令',
  'ui.status': '状态',
  'ui.owner': '归属',
  'ui.none': '无',
  'ui.unknown': '未知',
  'ui.all': '全部',
  'ui.yes': '是',
  'ui.no': '否',

  // ── 新战役配置 ──
  'ui.newGameTitle': '开启新战役',
  'ui.seed': '世界种子',
  'ui.difficulty': '难度',
  'ui.difficulty.story': '故事',
  'ui.difficulty.standard': '标准',
  'ui.difficulty.hard': '困难',
  'ui.difficulty.sandbox': '沙盒',
  'ui.start': '启航',
  'ui.campaignName': '战役名称',

  // ── 存档管理 ──
  'ui.save.title': '存档管理',
  'ui.save.slotManual': '手动槽位',
  'ui.save.slotAuto': '自动存档',
  'ui.save.slotQuick': '快速存档',
  'ui.save.empty': '空槽位',
  'ui.save.confirmOverwrite': '覆盖该槽位？',
  'ui.save.exported': '存档已导出',
  'ui.save.importConfirm': '导入该存档将需要确认后生效',
  'ui.save.checksum': '校验和',
  'ui.save.version': '版本',
  'ui.save.playtime': '游戏时间',

  // ── 指令错误 ──
  'ui.err.noFunds': '资源不足',
  'ui.err.noTech': '科技未解锁',
  'ui.err.blocked': '条件不满足',
  'ui.err.targetInvalid': '目标无效',
  'ui.err.range': '距离过远',
  'ui.err.blockedLane': '航道受阻',

  // ── 星图图层 ──
  'ui.layer.factions': '势力范围',
  'ui.layer.claims': '领土主张',
  'ui.layer.lanes': '航道控制',
  'ui.layer.resources': '资源富集',
  'ui.layer.danger': '星系危险度',
  'ui.layer.fleets': '已知舰队',
  'ui.layer.surveys': '扫描覆盖',
  'ui.layer.colonies': '殖民状态',
  'ui.layer.trade': '贸易流',
  'ui.layer.fronts': '战争前线',

  // ── 资源与经济 ──
  'ui.res.alloys': '合金',
  'ui.res.fuel': '燃料',
  'ui.res.minerals': '矿物',
  'ui.res.population': '人口',
  'ui.res.morale': '民心',
  'ui.res.income': '收入',
  'ui.res.maintenance': '维护费',

  // ── 舰队指令 ──
  'ui.build': '建造',
  'ui.move': '移动',
  'ui.attack': '攻击',
  'ui.defend': '防御',
  'ui.patrol': '巡逻',
  'ui.scout': '侦察',
  'ui.colonize': '殖民',
  'ui.survey': '扫描',
  'ui.dock': '入港',
  'ui.undock': '离港',
  'ui.repair': '维修',
  'ui.refit': '改装',

  // ── 领土与外交 ──
  'ui.upgrade': '升级',
  'ui.recruit': '征募',
  'ui.disband': '解散',
  'ui.claim': '宣示主权',
  'ui.trade': '贸易',
  'ui.treaty': '条约',
  'ui.declareWar': '宣战',
  'ui.peace': '议和',
  'ui.approve': '批准',
  'ui.reject': '驳回',

  // ── 通用界面操作补充 ──
  'ui.reset': '重置',
  'ui.apply': '应用',
  'ui.copy': '复制',
  'ui.copied': '已复制',
  'ui.language': '语言',
  'ui.cycle': '周期',

  // ── 状态提示 ──
  'ui.loading': '载入中…',
  'ui.complete': '已完成',
  'ui.inProgress': '进行中',

  // ── 提示语模板 ──
  'ui.hint.required': '需要：{req}',
  'ui.hint.confirmDelete': '确认删除 {name}？该操作不可撤销。',
};
