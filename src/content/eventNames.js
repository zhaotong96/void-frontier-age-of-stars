/**
 * content/eventNames.js — 事件/告警类型统一中文字典（[SPEC-39 Bug 5]）
 *
 * 底栏事件日志、事件视图、编年史时间线此前各自为政：未知类型直接回退
 * `e.type` 原始枚举名（如 FleetFormed、ColonyFounded）泄漏到界面。
 * 本模块提供唯一权威映射 eventTypeZh(type)，未知键回退原文名（防御新增
 * 类型短暂未收录），各渲染端统一消费，杜绝再发散。
 *
 * 纯数据 + 纯函数：无 DOM、无副作用，Node/浏览器双端安全。
 */

export const EVENT_TYPE_ZH = Object.freeze({
  // —— 战斗 ——
  BattleStarted: '战斗开始', BattleEnded: '战斗结束', ShipDestroyed: '舰船损失',
  BattleRetreat: '战斗撤离', BattleJoined: '战斗增援',
  // —— 外交 ——
  WarDeclared: '宣战', TreatySigned: '条约缔结', TreatyBreached: '条约违约',
  TreatyExpired: '条约到期', TreatyRejected: '条约被拒', DiplomaticGift: '外交赠礼',
  FirstContact: '首次接触', FirstContactSignal: '接触信号',
  ProposePeace: '和谈提议', PeaceSigned: '和约缔结', AnnexOccupied: '占领吞并',
  EmbargoChanged: '禁运变化',
  // —— 舰队 ——
  FleetStranded: '舰队受困', FleetFormed: '舰队编成', FleetArrived: '舰队抵达',
  FleetDeparted: '舰队出发', FleetDissolved: '舰队解散', FleetMerged: '舰队合并',
  FleetSplit: '舰队分编', FleetReinforced: '舰队补充',
  // —— 殖民地 ——
  ColonyFounded: '殖民地建立', ColonyLost: '殖民地失守', ColonyFamine: '殖民地饥荒',
  ColonyBlackout: '殖民地停电', ColonyShortage: '资源短缺', ColonyExpanded: '殖民地扩容',
  // —— 星系勘测 ——
  SystemSurveyed: '星系调查', SystemLocated: '星系定位', SystemClassified: '星系分类',
  AnomalyDetected: '发现异常', AnomalyResolved: '异常解决',
  // —— 生产科研 ——
  TechCompleted: '科技完成', ShipCompleted: '舰船建成', BuildingCompleted: '建筑完成',
  ResearchStarted: '科研启动', BlueprintSaved: '蓝图保存', ShipyardQueued: '船厂排程',
  // —— 危机剧情 ——
  CrisisPhase: '危机阶段', StoryFlag: '剧情标记', AIError: 'AI 异常',
  EventFired: '事件触发', EventResolved: '事件裁决', EventAutoResolved: '事件自动处置',
  NarrativeChoice: '叙事抉择', StoryBeat: '剧情节拍',
  // —— 目标 ——
  ObjectiveCreated: '空间目标建立', ObjectiveCompleted: '目标完成',
  ObjectiveExpired: '目标超时', ObjectiveFleetDispatched: '目标舰队派遣',
  // —— 地表勘探（doc18 / SPEC-39 Phase S1） ——
  PoiHarvested: 'POI 采样', PoiScientistJoined: '幸存者入队', PoiCrewXp: '地表历练',
  PoiStageAdvanced: '遗迹推进', SosBeaconResolved: '求救信标处置',
  SurfaceDeployed: '野战部署', DeepCoreExtracted: '深核采掘完成',
  SurveyGrandAward: '星际联盟勘探大奖', ScanPlanetarySpecimens: '物种扫描',
  SamplePlanetarySpecimen: '活体采样', MonolithStage: '巨石遗迹',
  ColonyDilemmaTriggered: '聚落困境', ColonyDilemmaResolved: '聚落裁决',
  WeatherStormWarning: '风暴预警', LeviathanDefeated: '利维坦击杀',
  // —— 太空歌剧四幕局势弧（doc44 M1 Task 1.3-1.6） ——
  SituationSpawned: '局势爆发', SituationApproachSwitched: '局势策略切换',
  SituationResolved: '局势收束', SituationArcEvent: '局势弧事件',
  EnvironmentalDeterioration: '行星环境恶化', EnvironmentalHazardEvent: '局部环境灾害',
  ResourceShortageStarted: '资源短缺爆发', EmpireDefaulted: '帝国主权违约',
  GravityWellEvent: '引力井事件',
  // —— 太空歌剧 M2：S3/S6 弧、雅可比涟漪与 16 天体原型（doc45 Task 2.1/2.3/2.4/2.5） ——
  PlanetaryRevolt: '行星叛乱', RadicalCellActivated: '激进细胞激活',
  Decivilized: '去文明化', LeviathanAwakened: '利维坦苏醒',
  TidalVolcanoEruption: '潮汐火山期喷发', MatterBackflowPhase: '物质倒灌相位切换',
  QuantumPhaseShift: '量子相移重组', QuantumPhaseLockToggled: '量子观测场锁定切换',
  PurifierGuardiansAwakened: '远古净化守卫苏醒',
  // —— 太空歌剧 M3：S5 舰队学说与战损伤痕（doc46 Task 3.1） ——
  PatrolHQUpgraded: '巡逻司令部升级', DoctrineReconfigured: '舰队学说重配',
  ShipSalvagedWithDMods: '战舰打捞挂伤', ShipDModRestored: '战舰暗伤修复',
  ShipSModInstalled: '传奇改装焊死', EpicBattleWreckRecorded: '史诗会战残骸记录',
  WreckHabitatConverted: '残骸栖息地改造', WreckSalvaged: '残骸拆解回收',
  FleetSubsystemFault: '舰队子系统故障',
  // —— 太空歌剧 M3：星海群像英雄（doc46 Task 3.2） ——
  ParagonDestinyOffered: '天命抉择呈现', ParagonDestinyAssigned: '天命特质固化',
  ParagonLeaderPromoted: '群像领袖晋升', BorderlordCoup: '边境军阀政变',
  BeholderModeToggled: '凝视者形态切换', EnclaveMentorHired: '城邦导师雇佣',
  EnclaveMentorDeparted: '城邦导师离职',
  // —— 太空歌剧 M3：自主生态舰队与子空间信标流（doc46 Task 3.3） ——
  TradeConvoyDelivered: '商队到港交付', SmugglerRunDelivered: '走私到港入库',
  SmugglerBustedByPatrol: '巡逻查获走私', MarketExpeditionRaided: '远征军袭击产区',
  MarketExpeditionDestroyed: '远征军遭伏击歼灭', BountyHuntSettled: '赏金游猎结算',
  AutonomousFleetInterdicted: '自主舰队遭截击', AutonomousFleetDestroyed: '自主舰队被歼灭',
  ConvoyInterdictShortagePushed: '截击断供短缺推升',
  SubspaceBeaconResponded: '子空间信标响应', OpportunityBeaconsInjected: '机遇信标注入',
  // —— 太空歌剧 M3：S7 议会暗战与三大终局天灾（doc46 Task 3.4） ——
  CommissionSigned: '委任状签署', CommissionSalaryPaid: '委任状月饷发放',
  ChoamSharesAdjusted: 'CHOAM 股份调整', PalaceEspionageUpgraded: '宫殿间谍翼升级',
  SpyNetworkLayerUp: '间谍网升层', DoubleAgentPlanted: '双面间谍植入',
  FactionLeaderAssassinated: '派系首脑遇刺',
  EndgameCrisisStarted: '终局天灾降临', PlanetInfested: '行星被感染',
  SystemInfested: '星系沦陷感染', PrethorynSwarmReinforced: '虫群援军抵达',
  DimensionalAnchorRemoved: '维度锚点拔除', DimensionalAnchorsCleared: '维度锚点全清',
  RivalDimensionalFactionsArrived: '敌对高维派系降临',
  ContingencyCoreBroken: '机械核心击破', EncryptionFirewallDeployed: '加密防火墙部署',
  ContingencyTerminated: '肃正协议终结',
  LeviathanParadeStarted: '利维坦凯旋大游行开幕', LeviathanParadeEncouraged: '大游行庆典鼓励',
  LeviathanParadeReorganized: '大游行迁址', LeviathanParadeCompleted: '大游行落幕',
  // —— 太空歌剧 M3：自适应戏剧导演（doc46 Task 3.5） ——
  GrandClimaxTriggered: '史诗高潮触发', GrandClimaxResolved: '高潮宣泄结算',
  DramaTraumaReported: '戏剧导演创伤折算',
});

/** 事件类型 → 中文显示名（未知回退原文名；空值回退占位） */
export function eventTypeZh(type) {
  if (type == null || type === '') return '未知事件';
  return EVENT_TYPE_ZH[type] || String(type);
}
