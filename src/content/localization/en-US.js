/**
 * content/localization/en-US.js — English dictionary (English (US))
 *
 * Register: cold sci-fi military command console — concise, professional, no colloquialisms.
 * Key structure: flat dotted keys (e.g. 'ui.galaxy'), key set must stay identical
 * to zh-CN.js; add entries to both sides at the same time.
 */

export const DICT = {
  // ── Main navigation ──
  'ui.galaxy': 'Galaxy',
  'ui.system': 'System',
  'ui.colony': 'Colony',
  'ui.fleet': 'Fleet',
  'ui.designer': 'Ship Designer',
  'ui.combat': 'Combat',
  'ui.research': 'Research',
  'ui.market': 'Market',
  'ui.diplomacy': 'Diplomacy',
  'ui.intel': 'Intel',
  'ui.government': 'Government',
  'ui.characters': 'Characters',
  'ui.ground': 'Ground Ops',
  'ui.events': 'Events',
  'ui.chronicle': 'Chronicle',
  'ui.codex': 'Codex',
  'ui.settings': 'Settings',
  'ui.diagnostics': 'Diagnostics',
  'ui.saves': 'Saves',

  // ── Top bar status ──
  'ui.pause': 'Pause',
  'ui.speed': 'Speed',
  'ui.resume': 'Resume',
  'ui.date': 'Date',
  'ui.credits': 'Credits',
  'ui.influence': 'Influence',
  'ui.researchRate': 'Research Rate',
  'ui.threat': 'Threat Level',
  'ui.notifications': 'Notifications',

  // ── Common actions ──
  'ui.select': 'Select',
  'ui.cancel': 'Cancel',
  'ui.confirm': 'Confirm',
  'ui.close': 'Close',
  'ui.back': 'Back',
  'ui.search': 'Search',
  'ui.filter': 'Filter',
  'ui.sort': 'Sort',
  'ui.export': 'Export',
  'ui.import': 'Import',
  'ui.save': 'Save',
  'ui.load': 'Load',
  'ui.newGame': 'New Campaign',
  'ui.rename': 'Rename',
  'ui.delete': 'Delete',
  'ui.details': 'Details',
  'ui.explain': 'Calculation Source',
  'ui.locked': 'Locked',
  'ui.blocked': 'Blocked',
  'ui.cost': 'Cost',
  'ui.eta': 'ETA',
  'ui.progress': 'Progress',
  'ui.queue': 'Queue',
  'ui.orders': 'Orders',
  'ui.status': 'Status',
  'ui.owner': 'Owner',
  'ui.none': 'None',
  'ui.unknown': 'Unknown',
  'ui.all': 'All',
  'ui.yes': 'Yes',
  'ui.no': 'No',

  // ── New campaign setup ──
  'ui.newGameTitle': 'Begin New Campaign',
  'ui.seed': 'Seed',
  'ui.difficulty': 'Difficulty',
  'ui.difficulty.story': 'Story',
  'ui.difficulty.standard': 'Standard',
  'ui.difficulty.hard': 'Hard',
  'ui.difficulty.sandbox': 'Sandbox',
  'ui.start': 'Launch',
  'ui.campaignName': 'Campaign Name',

  // ── Save management ──
  'ui.save.title': 'Save Management',
  'ui.save.slotManual': 'Manual Slot',
  'ui.save.slotAuto': 'Autosave Slot',
  'ui.save.slotQuick': 'Quicksave Slot',
  'ui.save.empty': 'Empty Slot',
  'ui.save.confirmOverwrite': 'Overwrite this slot?',
  'ui.save.exported': 'Save exported',
  'ui.save.importConfirm': 'Imported save takes effect after confirmation.',
  'ui.save.checksum': 'Checksum',
  'ui.save.version': 'Version',
  'ui.save.playtime': 'Playtime',

  // ── Order errors ──
  'ui.err.noFunds': 'Insufficient resources',
  'ui.err.noTech': 'Technology not unlocked',
  'ui.err.blocked': 'Requirements not met',
  'ui.err.targetInvalid': 'Invalid target',
  'ui.err.range': 'Out of range',
  'ui.err.blockedLane': 'Lane blocked',

  // ── Star map layers ──
  'ui.layer.factions': 'Faction Territory',
  'ui.layer.claims': 'Territorial Claims',
  'ui.layer.lanes': 'Lane Control',
  'ui.layer.resources': 'Resource Abundance',
  'ui.layer.danger': 'System Hazard',
  'ui.layer.fleets': 'Known Fleets',
  'ui.layer.surveys': 'Survey Coverage',
  'ui.layer.colonies': 'Colonization Status',
  'ui.layer.trade': 'Trade Flow',
  'ui.layer.fronts': 'War Fronts',

  // ── Resources and economy ──
  'ui.res.alloys': 'Alloys',
  'ui.res.fuel': 'Fuel',
  'ui.res.minerals': 'Minerals',
  'ui.res.population': 'Population',
  'ui.res.morale': 'Morale',
  'ui.res.income': 'Income',
  'ui.res.maintenance': 'Maintenance',

  // ── Fleet orders ──
  'ui.build': 'Build',
  'ui.move': 'Move',
  'ui.attack': 'Attack',
  'ui.defend': 'Defend',
  'ui.patrol': 'Patrol',
  'ui.scout': 'Scout',
  'ui.colonize': 'Colonize',
  'ui.survey': 'Survey',
  'ui.dock': 'Dock',
  'ui.undock': 'Undock',
  'ui.repair': 'Repair',
  'ui.refit': 'Refit',

  // ── Territory and diplomacy ──
  'ui.upgrade': 'Upgrade',
  'ui.recruit': 'Recruit',
  'ui.disband': 'Disband',
  'ui.claim': 'Claim',
  'ui.trade': 'Trade',
  'ui.treaty': 'Treaty',
  'ui.declareWar': 'Declare War',
  'ui.peace': 'Peace',
  'ui.approve': 'Approve',
  'ui.reject': 'Reject',

  // ── Additional common UI operations ──
  'ui.reset': 'Reset',
  'ui.apply': 'Apply',
  'ui.copy': 'Copy',
  'ui.copied': 'Copied',
  'ui.language': 'Language',
  'ui.cycle': 'Cycle',

  // ── Status hints ──
  'ui.loading': 'Loading…',
  'ui.complete': 'Complete',
  'ui.inProgress': 'In Progress',

  // ── Hint templates ──
  'ui.hint.required': 'Requires: {req}',
  'ui.hint.confirmDelete': 'Delete {name}? This action cannot be undone.',
};
