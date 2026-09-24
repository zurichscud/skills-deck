import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  MENU_ITEM_IDS,
  SKILL_SOURCES,
  type AppSettings,
  type CloseBehavior,
  type MenuItemId,
  type MenuPrefs,
  type SkillSource,
} from '@shared/types'

import { applyPathOverrides, centralRoot, managedRoot, sourceRootFor } from './paths'

const CLOSE_BEHAVIORS: CloseBehavior[] = ['ask', 'tray', 'quit']
const MENU_IDS = new Set<string>(MENU_ITEM_IDS)

interface RawConfig {
  centralRoot?: string
  sourceRoots?: Partial<Record<SkillSource, string>>
  closeBehavior?: CloseBehavior
  menu?: unknown
}

let cache: AppSettings | null = null

export function configPath(): string {
  return join(managedRoot(), 'config.json')
}

async function readRaw(): Promise<RawConfig> {
  try {
    const text = await fs.readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as RawConfig
  } catch {
    /* 配置缺失或损坏时用默认值 */
  }
  return {}
}

/** 只保留已知菜单 id，去重；非法输入回退为空数组（即默认顺序、全部显示） */
function normalizeMenuIds(input: unknown): MenuItemId[] {
  if (!Array.isArray(input)) return []
  const out: MenuItemId[] = []
  for (const item of input) {
    if (typeof item === 'string' && MENU_IDS.has(item) && !out.includes(item as MenuItemId)) {
      out.push(item as MenuItemId)
    }
  }
  return out
}

function normalizeMenu(raw: unknown): MenuPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown }
  return { order: normalizeMenuIds(value.order), hidden: normalizeMenuIds(value.hidden) }
}

function normalize(raw: RawConfig): AppSettings {
  const sourceRoots = {} as Record<SkillSource, string>
  for (const s of SKILL_SOURCES) {
    const v = raw.sourceRoots?.[s]
    sourceRoots[s] = typeof v === 'string' && v.trim() ? v.trim() : sourceRootFor(s)
  }
  const central =
    typeof raw.centralRoot === 'string' && raw.centralRoot.trim()
      ? raw.centralRoot.trim()
      : centralRoot()
  const closeBehavior = CLOSE_BEHAVIORS.includes(raw.closeBehavior as CloseBehavior)
    ? (raw.closeBehavior as CloseBehavior)
    : 'ask'
  return { centralRoot: central, sourceRoots, closeBehavior, menu: normalizeMenu(raw.menu) }
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await readRaw()
  // 先清空覆盖再求默认值，避免把上一次覆盖当成默认
  applyPathOverrides({ sourceRoots: {} })
  const effective = normalize(raw)
  applyPathOverrides({ sourceRoots: effective.sourceRoots, centralRoot: effective.centralRoot })
  cache = effective
  return effective
}

export function currentSettings(): AppSettings {
  return (
    cache ?? {
      centralRoot: centralRoot(),
      sourceRoots: {
        claude: sourceRootFor('claude'),
        codex: sourceRootFor('codex'),
        opencode: sourceRootFor('opencode'),
      },
      closeBehavior: 'ask',
      menu: { order: [], hidden: [] },
    }
  )
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const raw: RawConfig = {
    centralRoot: next.centralRoot,
    sourceRoots: { ...next.sourceRoots },
    closeBehavior: next.closeBehavior,
    menu: normalizeMenu(next.menu),
  }
  await fs.mkdir(managedRoot(), { recursive: true })
  await fs.writeFile(configPath(), `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await loadSettings()
}
