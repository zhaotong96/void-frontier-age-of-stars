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
});

/** 事件类型 → 中文显示名（未知回退原文名；空值回退占位） */
export function eventTypeZh(type) {
  if (type == null || type === '') return '未知事件';
  return EVENT_TYPE_ZH[type] || String(type);
}
