export type SkillSource = 'claude' | 'codex' | 'opencode'

export const SKILL_SOURCES = [
  'claude',
  'codex',
  'opencode',
] as const satisfies readonly SkillSource[]

export const SOURCE_LABEL: Record<SkillSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
}

export type SkillFileKind = 'md' | 'script' | 'asset' | 'other'

export type SkillEntryKind = 'real' | 'symlink' | 'broken'

export interface SkillFile {
  path: string
  size: number
  kind: SkillFileKind
}

export interface Skill {
  id: string
  source: SkillSource
  name: string
  relDir: string
  description: string
  enabled: boolean
  builtin: boolean
  entryKind: SkillEntryKind
  linkTarget?: string
  dirPath: string
  originPath: string
  frontmatter: Record<string, unknown>
  files: SkillFile[]
  mtime: number
  byteSize: number
}

export interface AppInfo {
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  managedRoot: string
  disabledRoot: string
  sourceRoots: Record<SkillSource, string>
}

/** 侧边栏菜单项 id（不含固定的「设置」） */
export const MENU_ITEM_IDS = [
  'dashboard',
  'location:claude',
  'location:codex',
  'location:opencode',
  'workspace:claude',
  'workspace:codex',
  'workspace:opencode',
] as const

export type MenuItemId = (typeof MENU_ITEM_IDS)[number]

export interface MenuPrefs {
  /** 用户排序；未出现的项按默认顺序追加在组内 */
  order: MenuItemId[]
  /** 隐藏的菜单项 */
  hidden: MenuItemId[]
}

export const DEFAULT_MENU_PREFS: MenuPrefs = { order: [], hidden: [] }

export type ConflictStrategy = 'skip' | 'overwrite' | 'rename'

export type CopyStrategy = ConflictStrategy | 'ask'

export type FailCode = 'NOT_FOUND' | 'CONFLICT' | 'LOCKED' | 'IO'

export interface FailResult {
  ok: false
  code: FailCode
  message: string
  conflictAt?: string
}

export type SetEnabledResult = { ok: true } | FailResult

export type CopyOutcome = 'created' | 'overwritten' | 'skipped'

export type CopyResult = { ok: true; outcome: CopyOutcome; targetName: string } | FailResult

export type CloseBehavior = 'ask' | 'tray' | 'quit'

export const CLOSE_BEHAVIOR_LABEL: Record<CloseBehavior, string> = {
  ask: '每次询问',
  tray: '最小化到托盘',
  quit: '退出应用',
}

export interface AppSettings {
  sourceRoots: Record<SkillSource, string>
  disabledRoot: string
  closeBehavior: CloseBehavior
  menu: MenuPrefs
}

export interface SkillApi {
  info(): Promise<AppInfo>
  list(): Promise<Skill[]>
  refresh(): Promise<Skill[]>
  readFile(skillId: string, relPath: string): Promise<string>
  setEnabled(skillId: string, enabled: boolean): Promise<SetEnabledResult>
  copyTo(skillId: string, target: SkillSource, strategy: CopyStrategy): Promise<CopyResult>
  deleteSkill(skillId: string): Promise<SetEnabledResult>
  revealInFinder(skillId: string): Promise<void>
  onChanged(listener: () => void): () => void
  getSettings(): Promise<AppSettings>
  saveSettings(next: AppSettings): Promise<SetEnabledResult>
  pickDirectory(): Promise<string | null>
}
