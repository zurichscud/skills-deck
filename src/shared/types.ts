export type SkillSource = 'claude' | 'codex' | 'opencode' | 'agents'

export const SKILL_SOURCES = [
  'claude',
  'codex',
  'opencode',
  'agents',
] as const satisfies readonly SkillSource[]

export const SOURCE_LABEL: Record<SkillSource, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  agents: 'Agents',
}

export type SkillFileKind = 'md' | 'script' | 'asset' | 'other'

/**
 * - skill:    存储位置里的 skill 条目（真实目录，或指向别处的软链）
 * - builtin:  codex `.system` 内置 skill，只读、不可链接、不可删除
 */
export type SkillKind = 'skill' | 'builtin'

/**
 * 单个存储位置上该 skill 的呈现。
 * - self:     内容本体就在这个位置（真实目录）
 * - linked:   这个位置是指向本体的有效软链
 * - absent:   该位置没有同名条目
 * - broken:   该位置是软链但目标已失效（可安全替换）
 * - conflict: 该位置被真实目录或指向别处的有效软链占用（拒绝覆盖）
 * - native:   codex 内置，天然可用且不可操作
 */
export type LinkState = 'self' | 'linked' | 'absent' | 'broken' | 'conflict' | 'native'

export interface SkillLink {
  state: LinkState
  /** 条目路径（存储位置根 + relDir）；absent 时为空串 */
  path: string
  /** 当前指向（软链时记录，断链记录原目标） */
  target?: string
}

export interface SkillFile {
  path: string
  size: number
  kind: SkillFileKind
}

export interface Skill {
  /** 稳定 id：`<本体所在位置|detached>:<relDir>`；内置为 `builtin:<relDir>` */
  id: string
  kind: SkillKind
  name: string
  /** 目录名；跨位置匹配同名条目用它 */
  relDir: string
  /** 内容真实路径；断链残骸为链接自身路径 */
  dirPath: string
  /** 本体所在位置；本体在应用管理的四个位置之外（只放软链）时为 null */
  home: SkillSource | null
  /** 各存储位置上这个 skill 的呈现 */
  links: Record<SkillSource, SkillLink>
  description: string
  frontmatter: Record<string, unknown>
  files: SkillFile[]
  mtime: number
  byteSize: number
  /** 残骸：全部条目都是失效软链，没有内容可读，只能删除 */
  broken: boolean
}

export type TrashKind = 'dir' | 'symlink'

/** 回收站里的一个条目（一次删除动作移动的一份东西） */
export interface TrashItem {
  id: string
  /** 原目录名 */
  relDir: string
  /** 展示名（frontmatter name 或目录名） */
  name: string
  /** 删除前所在位置；索引损坏时为 null */
  origin: SkillSource | null
  kind: TrashKind
  /** 软链条目的原目标 */
  linkTarget?: string
  /** 原路径，恢复的目标位置；索引损坏时为 null（只能彻底删除） */
  sourcePath: string | null
  deletedAt: number | null
  byteSize: number
  /** 内容本体是否就在回收站里（软链条目为 false，内容仍在别处） */
  hasContent: boolean
}

export interface AppInfo {
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  managedRoot: string
  trashRoot: string
  sourceRoots: Record<SkillSource, string>
}

/** 常驻侧边栏、不参与菜单配置的项 */
export const FIXED_MENU_ITEM_IDS = ['dashboard', 'trash'] as const

/** 可配置（排序 / 显隐）的菜单项 id，不含固定的「设置」 */
export const MENU_ITEM_IDS = [
  'location:claude',
  'location:codex',
  'location:opencode',
  'location:agents',
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

export type CloseBehavior = 'ask' | 'tray' | 'quit'

export const CLOSE_BEHAVIOR_LABEL: Record<CloseBehavior, string> = {
  ask: '每次询问',
  tray: '最小化到托盘',
  quit: '退出应用',
}

export interface AppSettings {
  /** 各 agent 的全局 skills 目录（skill 内容就在这些位置里） */
  sourceRoots: Record<SkillSource, string>
  closeBehavior: CloseBehavior
  menu: MenuPrefs
}

/* ---------------------------------- IPC ---------------------------------- */

export interface SkillApi {
  info(): Promise<AppInfo>
  list(): Promise<Skill[]>
  refresh(): Promise<Skill[]>
  readFile(skillId: string, relPath: string): Promise<string>
  link(skillId: string, source: SkillSource): Promise<ActionResult>
  unlink(skillId: string, source: SkillSource): Promise<ActionResult>
  /** 删除 = 内容本体移入回收站，各存储位置上的软链（含失效残骸）直接删除 */
  deleteSkill(skillId: string): Promise<ActionResult>
  trash(): Promise<TrashItem[]>
  restoreFromTrash(itemId: string): Promise<ActionResult>
  /** 从回收站彻底删除，不可恢复 */
  purgeTrash(itemId: string): Promise<ActionResult>
  emptyTrash(): Promise<ActionResult>
  revealInFinder(skillId: string): Promise<void>
  revealTrashItem(itemId: string): Promise<void>
  openPath(target: SkillSource): Promise<ActionResult>
  onChanged(listener: () => void): () => void
  getSettings(): Promise<AppSettings>
  saveSettings(next: AppSettings): Promise<ActionResult>
  pickDirectory(): Promise<string | null>
}
