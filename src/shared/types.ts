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

/**
 * - central:  中央仓库里的真身（唯一可链接的条目）
 * - builtin:  codex `.system` 内置 skill，只读、不可链接
 * - external: 存储位置里未纳管的条目（真实目录或指向别处的链接）
 */
export type SkillKind = 'central' | 'builtin' | 'external'

/**
 * 单个存储位置上该 skill 的链接状态。
 * - linked:   指向中央仓库真身的有效软链
 * - absent:   该位置没有同名条目
 * - broken:   该位置是软链但目标已失效（可安全替换）
 * - conflict: 该位置被真实目录或指向别处的有效软链占用（拒绝覆盖）
 * - native:   codex 内置，天然可用且不可操作
 */
export type LinkState = 'linked' | 'absent' | 'broken' | 'conflict' | 'native'

export interface SkillLink {
  state: LinkState
  /** 链接路径（存储位置根 + relDir） */
  path: string
  /** 链接当前指向（断链时记录原目标） */
  target?: string
}

export interface SkillFile {
  path: string
  size: number
  kind: SkillFileKind
}

export interface Skill {
  id: string
  kind: SkillKind
  name: string
  /** 中央仓库内的相对路径；builtin/external 为其所在位置的相对路径 */
  relDir: string
  description: string
  /** 真身路径 */
  dirPath: string
  /** builtin/external 的物理所在位置；central 为 null */
  origin: SkillSource | null
  links: Record<SkillSource, SkillLink>
  frontmatter: Record<string, unknown>
  files: SkillFile[]
  mtime: number
  byteSize: number
}

export interface GitInfo {
  available: boolean
  repoReady: boolean
  lastCommit: string | null
}

export interface AppInfo {
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  managedRoot: string
  centralRoot: string
  sourceRoots: Record<SkillSource, string>
  git: GitInfo
}

/** 常驻侧边栏、不参与菜单配置的项 */
export const FIXED_MENU_ITEM_IDS = ['dashboard', 'repository', 'unmanaged'] as const

/** 可配置（排序 / 显隐）的菜单项 id，不含固定的「设置」 */
export const MENU_ITEM_IDS = [
  'location:claude',
  'location:codex',
  'location:opencode',
  'workspace:claude',
  'workspace:codex',
  'workspace:opencode',
] as const

export type FixedMenuItemId = (typeof FIXED_MENU_ITEM_IDS)[number]

export type MenuItemId = FixedMenuItemId | (typeof MENU_ITEM_IDS)[number]

export interface MenuPrefs {
  /** 用户排序；未出现的项按默认顺序追加在组内 */
  order: MenuItemId[]
  /** 隐藏的菜单项 */
  hidden: MenuItemId[]
}

export const DEFAULT_MENU_PREFS: MenuPrefs = { order: [], hidden: [] }

export type FailCode = 'NOT_FOUND' | 'CONFLICT' | 'LOCKED' | 'IO'

export interface FailResult {
  ok: false
  code: FailCode
  message: string
  conflictAt?: string
}

export type ActionResult = { ok: true } | FailResult

export type ImportResult = { ok: true; name: string; target: string } | FailResult

export type CloseBehavior = 'ask' | 'tray' | 'quit'

export const CLOSE_BEHAVIOR_LABEL: Record<CloseBehavior, string> = {
  ask: '每次询问',
  tray: '最小化到托盘',
  quit: '退出应用',
}

export interface AppSettings {
  /** 中央仓库根目录（唯一真身存放处，git 管理） */
  centralRoot: string
  /** 各 agent 的全局 skills 目录（只放软链） */
  sourceRoots: Record<SkillSource, string>
  closeBehavior: CloseBehavior
  menu: MenuPrefs
}

/* -------------------------------- 未纳管条目 -------------------------------- */

/** 某个存储位置上、尚未纳入中央仓库的 skill */
export interface UnmanagedSkill {
  /** 稳定 id：`${source}:${relDir}` */
  id: string
  source: SkillSource
  relDir: string
  name: string
  description: string
  /** 物理路径（真实目录或软链） */
  path: string
  isSymlink: boolean
  /** 中央仓库已存在同名 skill */
  conflict: boolean
  /** 与中央仓库同名版本的内容是否一致 */
  identical: boolean
}

/**
 * 纳入动作：
 * - adopt:     无冲突，直接移入中央仓库并原地建链
 * - overwrite: 用本地副本覆盖中央仓库的同名 skill
 * - rename:    本地副本以 `<name>-2` 并存进中央仓库
 * - keep:      保留中央仓库版本，本地副本改为指向它的链接
 */
export type AdoptAction = 'adopt' | 'overwrite' | 'rename' | 'keep'

/** 一键导入的汇总结果 */
export interface AdoptAllResult {
  ok: true
  /** 已纳入中央仓库的条目数 */
  adopted: number
  /** 同名冲突，必须由用户逐项决定 */
  conflicts: number
  /** 纳入失败的条目数 */
  failed: number
}

/** 从 git 仓库安装 skills 的结果 */
export interface InstallFromGitResult {
  ok: true
  repo: string
  /** source 为仓库里的目录名；同名冲突时会以 name 落地（如 xxx-2） */
  installed: { source: string; name: string }[]
  failed: { name: string; message: string }[]
}

/* ---------------------------------- IPC ---------------------------------- */

export interface SkillApi {
  info(): Promise<AppInfo>
  list(): Promise<Skill[]>
  refresh(): Promise<Skill[]>
  readFile(skillId: string, relPath: string): Promise<string>
  link(skillId: string, source: SkillSource): Promise<ActionResult>
  unlink(skillId: string, source: SkillSource): Promise<ActionResult>
  importSkill(path?: string): Promise<ImportResult>
  installFromGit(url: string): Promise<InstallFromGitResult | FailResult>
  unmanaged(): Promise<UnmanagedSkill[]>
  adoptUnmanaged(itemId: string, action: AdoptAction): Promise<ActionResult>
  adoptAllUnmanaged(): Promise<AdoptAllResult | FailResult>
  adoptManyUnmanaged(itemIds: string[]): Promise<AdoptAllResult | FailResult>
  deleteSkill(skillId: string): Promise<ActionResult>
  revealInFinder(skillId: string): Promise<void>
  openPath(target: 'central' | SkillSource): Promise<ActionResult>
  onChanged(listener: () => void): () => void
  getSettings(): Promise<AppSettings>
  saveSettings(next: AppSettings): Promise<ActionResult>
  pickDirectory(): Promise<string | null>
}
