/**
 * content/leviathans.js — 四类天体级深空奇观/太空利维坦定义（doc35 WP-P2-1）
 *
 * 融合 doc33 §2.3（利维坦叙事与三选一工程抉择）与 doc34 §2.2.2（数值与机制）：
 *   grd_mining_mothership 万年采矿母舰「奥尔特吞噬者」：可协议嫁接为永久轨道采掘奇观
 *   grd_singularity_horror 黑洞视界吞噬体「奇点之喉」：击败后解锁逆质量裂隙课题
 *   grd_void_leviathan     以太星尘巨鲲「虚空利维坦」：温和滤食，途经星系产出 +25%
 *   grd_enigmatic_vault    弦网谜锁要塞「无穷回廊」：战斗 + 三级弦频率调谐 DAG 解谜
 *
 * 纯静态数据；实体化仅在 EngageSpaceLeviathan 命令触达时惰性进行（金快照零漂移）。
 */

export const LEVIATHANS = [
  {
    id: 'grd_mining_mothership',
    nameZh: '万年采矿母舰「奥尔特吞噬者」',
    nameEn: 'The Lithophage',
    systemTraitZh: '富集矿脉星系（ferro/rareEarth 富集）',
    structure: 4500,
    armor: 800,
    shield: 0,
    weaponZh: '行星切割热熔束（单发 180 thermal）',
    droneStrike: true,
    peacefulOption: {
      id: 'graft_protocol',
      nameZh: '协议嫁接（工程船 180 天 · conductor 40 + ancientData 10）',
      cost: { conductor: 40, ancientData: 10 },
      days: 180,
      effectZh: '永久轨道采掘奇观：每战略日向玩家账本输送 ferro 25 / rareEarth 8',
      dailyOutput: { ferro: 25, rareEarth: 8 },
    },
    killLoot: { alloy: 600, quantumCore: 2 },
    killUnlockZh: '深核碎星采矿激光研究',
  },
  {
    id: 'grd_singularity_horror',
    nameZh: '黑洞视界吞噬体「奇点之喉」',
    nameEn: 'Singularity Horror',
    systemTraitZh: '黑洞引力井',
    structure: 6000,
    armor: 0,
    shield: 4000,
    weaponZh: '无视常规装甲（对相位护盾伤害减半）',
    afterKill: {
      projectId: 'proj_negative_mass_rift',
      nameZh: '逆质量裂隙课题',
      effectZh: '全帝国舰队 +15% 能量武器伤害，darkMatter +85',
      reward: { darkMatter: 85 },
    },
  },
  {
    id: 'grd_void_leviathan',
    nameZh: '以太星尘巨鲲「虚空利维坦」',
    nameEn: 'Void Leviathan',
    systemTraitZh: '固定星域航路巡游（温和滤食）',
    structure: 5200,
    armor: 600,
    shield: 1500,
    weaponZh: '无主动攻击（受击后逃离）',
    passiveEffectZh: '途经星系生物质与挥发物产出 +25%',
    peacefulOption: {
      id: 'gene_sequencing',
      nameZh: '抵近基因测序',
      cost: { ancientData: 8 },
      effectZh: '解锁活性再生装甲模块',
      unlockModuleZh: '活性再生装甲',
    },
    killLoot: { exoticMatter: 6, credits: 5000 },
    killPenaltyZh: '全生态派系好感 -25 与狂暴幼崽复仇事件',
  },
  {
    id: 'grd_enigmatic_vault',
    nameZh: '弦网谜锁要塞「无穷回廊」',
    nameEn: 'Enigmatic Vault',
    systemTraitZh: '黑洞/脉冲星/远古遗迹星系',
    structure: 9500,
    armor: 1200,
    shield: 3500,
    weaponZh: '四座自动防御平台拱卫',
    puzzle: {
      stages: 3,
      nameZh: '弦频率调谐',
      skipCost: { darkMatter: 2 },
      failEffectZh: '要塞重新充能苏醒（60% 血量重启）',
      successUnlock: {
        moduleId: 'mod_enigmatic_cipher',
        nameZh: '神秘编码器',
        effectZh: '命中率 +15%、闪避 +15%、特征值 -25%',
      },
    },
  },
];

export const LEVIATHAN_BY_ID = Object.fromEntries(LEVIATHANS.map((l) => [l.id, l]));

/** 奇观星系选址资格（EngageSpaceLeviathan 命令校验；确定性） */
export function leviathanSiteOk(sys, leviathanId) {
  if (!sys) return false;
  const danger = sys.dangerRating ?? 0;
  switch (leviathanId) {
    case 'grd_mining_mothership':
      return danger >= 4;
    case 'grd_singularity_horror':
      return sys.star?.typeId === 'blackHole';
    case 'grd_void_leviathan':
      return danger >= 2;
    case 'grd_enigmatic_vault':
      return danger >= 6 || sys.star?.typeId === 'blackHole' || sys.star?.typeId === 'neutronStar';
    default:
      return false;
  }
}
