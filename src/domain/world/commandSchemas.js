/**
 * domain/world/commandSchemas.js — 跨阶段 18 条太空歌剧 CommandBus 命令契约注册表
 * （SPEC-PLAN-043 总控卷 Task 0.2；责任人：Eng-A / Eng-B / Eng-C 协同）
 *
 * 所有玩家主动干预局势、调整区划、切换学说、签署私掠证或互动子空间信标的
 * 操作，必须封装为纯数据 Payload 命令经 CommandBus.dispatch 执行，确保录像
 * 回放 100% 可重现（doc43 §Task 0.2）。
 *
 * 本模块只承载「契约数据 + 纯校验函数」：不改世界、不挂命令（注册副作用在
 * src/app/commandsSpaceOpera.js）、不消费 world.rng。requiredFields 之外的字段
 * 一律忽略（宽松透传，向后兼容后续阶段的扩展参数）。
 */

/**
 * 太空歌剧 18 条命令契约（冻结；顺序与 doc43 §Task 0.2 表逐条一致）。
 * 每条：{ type, phase, module, requiredFields, postCondition }；
 * requiredFields 字段描述：{ name, type: 'number'|'string'|'boolean', enum? }。
 */
export const SPACE_OPERA_COMMANDS = Object.freeze([
  {
    type: 'SetSituationApproach',
    phase: 'M1',
    module: 'situationEngine.js',
    requiredFields: [
      { name: 'situationId', type: 'number' },
      { name: 'approachId', type: 'string' },
    ],
    postCondition: '切换指定局势的应对策略（如 Cautious / Overdrive），更新月度进度增量 Δp 与修正 Buff，记录冷却时间戳',
  },
  {
    type: 'ConfigureUrbanZone',
    phase: 'M1',
    module: 'planetStateSchema.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'zoneSlot', type: 'number', enum: [0, 1] },
      { name: 'zoneType', type: 'number' },
    ],
    postCondition: '配置行星城市区划的 2 个自定义功能区（如档案馆区、重工冶炼区、商贸自由港区），重算岗位容量',
  },
  {
    type: 'ConstructOrbitalFacility',
    phase: 'M1',
    module: 'planetStateSchema.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'slotIndex', type: 'number' },
      { name: 'facilityType', type: 'number' },
    ],
    postCondition: '在行星轨道环带层建造轨道居住站（Orbitals）或黑洞观测站；若为黑洞观测站则自动派生引力井局势（起始进度 25）',
  },
  {
    type: 'ExcavateSubterraneanLayer',
    phase: 'M1',
    module: 'planetStateSchema.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'depthTier', type: 'number', enum: [1, 2, 3] },
    ],
    postCondition: '掘进深层地壳，解锁地下城市槽或先驱者地宫；同步增加 envVector[0]（构造应力）与 envVector[7]（工业扰动）',
  },
  {
    type: 'TriggerTerraformingPhase',
    phase: 'M1',
    module: 'ecologicalPhaseArc.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'targetArchetype', type: 'number' },
    ],
    postCondition: '消耗 5,000 能量/信用点执行气候改造或触发行星五纪元跃迁（epochStage +1），写入 historyRing[8]',
  },
  {
    type: 'EmergencyDebtRestructure',
    phase: 'M1',
    module: 'shortageSituationArc.js',
    requiredFields: [
      { name: 'empireId', type: 'number' },
      { name: 'resourceId', type: 'string' },
      { name: 'cutInvestment', type: 'boolean' },
    ],
    postCondition: '在 S4 资源短缺局势中启用/关闭 Cut Investments（工匠与冶金产出 -25%，维护费 -50%）',
  },
  {
    type: 'LockQuantumPhasePlanet',
    phase: 'M2',
    module: 'archetypeMechanics.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'fleetId', type: 'number' },
      { name: 'engageLock', type: 'boolean' },
    ],
    postCondition: '针对 #2 量子游离天体，派遣科研舰张开观测场锁定其量子相位，暂停相移但增加反应堆维护',
  },
  {
    type: 'EnactColonyMartialLaw',
    phase: 'M2',
    module: 'colonySocialArc.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'crackDownLevel', type: 'number', enum: [1, 2] },
    ],
    postCondition: '在 S3 殖民地叛乱局势中执行镇压或全面戒严（Total Crackdown），立即修正稳定度与阶层幸福度',
  },
  {
    type: 'PurgeRadicalCell',
    phase: 'M2',
    module: 'shadowSyndicateArc.js',
    requiredFields: [
      { name: 'planetId', type: 'number' },
      { name: 'useMilitaryForce', type: 'boolean' },
    ],
    postCondition: '清剿行星上因工业关注度 ≥ 7 激活的激进分子潜伏基地（Luddic Path Cell），消除海盗袭击信标源',
  },
  {
    type: 'EstablishSyndicateBranch',
    phase: 'M2',
    module: 'shadowSyndicateArc.js',
    requiredFields: [
      { name: 'targetPlanetId', type: 'number' },
      { name: 'branchType', type: 'string' },
    ],
    postCondition: '在目标殖民地建立犯罪辛迪加地下分部，建立 Shady Contacts（+1 解密/加密）并抽取黑市暗流收益',
  },
  {
    type: 'ConfigureFleetDoctrine',
    phase: 'M3',
    module: 'fleetDoctrineAndScars.js',
    requiredFields: [
      { name: 'empireId', type: 'number' },
      { name: 'doctrineSize', type: 'number' },
      { name: 'qualityWeight', type: 'number' },
      { name: 'officerAggression', type: 'number' },
    ],
    postCondition: '在巡逻司令部（Patrol HQ）调整舰队学说配比（舰船尺寸 vs 装备质量 vs 军官鲁莽度），重算星区巡逻编队模板',
  },
  {
    type: 'RestoreShipDMod',
    phase: 'M3',
    module: 'fleetDoctrineAndScars.js',
    requiredFields: [
      { name: 'shipId', type: 'number' },
      { name: 'dModId', type: 'string' },
    ],
    postCondition: '消耗高额合金修复战舰永久结构暗伤（D-Mod），恢复战舰原始部署补给成本（消除 -20% D-Mod 折扣）',
  },
  {
    type: 'InstallShipSMod',
    phase: 'M3',
    module: 'fleetDoctrineAndScars.js',
    requiredFields: [
      { name: 'shipId', type: 'number' },
      { name: 'moduleId', type: 'string' },
    ],
    postCondition: '消耗剧情点/稀有遗物为老兵战舰永久焊死精英改装件（S-Mod），解锁额外传奇词条',
  },
  {
    type: 'SalvageBattleWreckHabitat',
    phase: 'M3',
    module: 'fleetDoctrineAndScars.js',
    requiredFields: [
      { name: 'wreckEntityId', type: 'number' },
      { name: 'convertToHabitat', type: 'boolean' },
    ],
    postCondition: '将重大战役遗留的巨型主力舰残骸改造为永久「残骸栖息地（Wrecked Warship Habitat）」或拆解回收',
  },
  {
    type: 'AssignParagonDestinyTrait',
    phase: 'M3',
    module: 'galacticParagons.js',
    requiredFields: [
      { name: 'leaderId', type: 'number' },
      { name: 'destinyTraitId', type: 'string' },
    ],
    postCondition: '当领袖达到 8 级（Lv 8）时，从确定性派生的三项专精天命特质（Destiny Traits）中择一固化',
  },
  {
    type: 'ToggleBeholderMode',
    phase: 'M3',
    module: 'galacticParagons.js',
    requiredFields: [
      { name: 'paragonId', type: 'number' },
      { name: 'mode', type: 'string', enum: ['WARSHIP_COMMANDER', 'MURMURING_MONOLITH'] },
    ],
    postCondition: '切换传奇灵能机械核心 The Beholder 的形态（战舰指挥官 vs 行星地表「低语方尖碑」总督，将矿工转化为灵能体产能量与凝聚力）',
  },
  {
    type: 'RespondSubspaceBeacon',
    phase: 'M3',
    module: 'subspaceBeaconStream.js',
    requiredFields: [
      { name: 'beaconId', type: 'number' },
      { name: 'responseOptionId', type: 'string' },
    ],
    postCondition: '响应星区内的动态子空间无线电信标（救援遇险商船、竞标黑市军火合约、拦截古代求救信号）',
  },
  {
    type: 'ManageLeviathanParade',
    phase: 'M3',
    module: 'galacticSenateAndCrisisArc.js',
    requiredFields: [
      { name: 'situationId', type: 'number' },
      { name: 'action', type: 'string', enum: ['ENCOURAGE', 'SUPPRESS', 'REORGANIZE'] },
    ],
    postCondition: '操控击杀太空巨兽后的「利维坦凯旋大游行」局势（鼓励 +6/月、压制 -4/月、消耗 1,000 凝聚力重整路线）',
  },
].map((def) => Object.freeze({
  ...def,
  requiredFields: Object.freeze(def.requiredFields.map((f) => Object.freeze({ ...f, ...(f.enum ? { enum: Object.freeze([...f.enum]) } : {}) }))),
})));

/** 命令类型 → 契约定义 索引（模块内部校验用） */
const SCHEMA_BY_TYPE = new Map(SPACE_OPERA_COMMANDS.map((def) => [def.type, def]));

/**
 * 太空歌剧命令 Payload 严格校验（纯函数，不改任何状态）
 *
 * 规则（doc43 §Task 0.2 + CHK-00-05）：
 *  - cmd 必须为 { type, params } 信封；params 必须为普通对象（缺省即拒）；
 *  - number：typeof === 'number' 且有限且为整数（ID/档位/配比统一按整数契约）；
 *  - string / boolean：严格 typeof；
 *  - enum：值必须 ∈ 枚举表（与字段类型双重校验）；
 *  - requiredFields 之外的未知字段一律忽略（宽松透传）。
 *
 * @param {{type: string, params?: object}} cmd - 命令信封
 * @returns {{ok: boolean, reason: string|null}} ok=false 时 reason 指明首个违规字段
 */
export function validateSpaceOperaCommandPayload(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
    return { ok: false, reason: 'SO: 命令信封必须为对象 {type, params}' };
  }
  const def = SCHEMA_BY_TYPE.get(cmd.type);
  if (!def) {
    return { ok: false, reason: `SO: 未知太空歌剧命令 ${String(cmd.type)}` };
  }
  const params = cmd.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, reason: `SO: ${cmd.type} 缺少 params 对象` };
  }
  for (const f of def.requiredFields) {
    const v = params[f.name];
    const present = Object.prototype.hasOwnProperty.call(params, f.name);
    if (!present) {
      return { ok: false, reason: `SO: ${cmd.type} 缺少必填字段 ${f.name}（${f.type}）` };
    }
    if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
        return { ok: false, reason: `SO: ${cmd.type}.${f.name} 必须为有限整数（实测 ${String(v)}）` };
      }
    } else if (f.type === 'string') {
      if (typeof v !== 'string') {
        return { ok: false, reason: `SO: ${cmd.type}.${f.name} 必须为 string（实测 ${typeof v}）` };
      }
    } else if (f.type === 'boolean') {
      if (typeof v !== 'boolean') {
        return { ok: false, reason: `SO: ${cmd.type}.${f.name} 必须为 boolean（实测 ${typeof v}）` };
      }
    } else {
      return { ok: false, reason: `SO: ${cmd.type}.${f.name} 契约字段类型非法（${String(f.type)}）` };
    }
    if (f.enum && !f.enum.includes(v)) {
      return { ok: false, reason: `SO: ${cmd.type}.${f.name} 必须为枚举值 [${f.enum.join(' | ')}]（实测 ${String(v)}）` };
    }
  }
  return { ok: true, reason: null };
}
