import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { applyPathOverrides, disabledRoot, managedRoot, sourceRootFor } from './paths'
import type { AppSettings, CloseBehavior, SkillSource } from '@shared/types'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const CLOSE_BEHAVIORS: CloseBehavior[] = ['ask', 'tray', 'quit']

interface RawConfig {
  sourceRoots?: Partial<Record<SkillSource, string>>
  disabledRoot?: string
  closeBehavior?: CloseBehavior
}

let cache: { sourceRoots: Record<SkillSource, string>; disabledRoot: string; closeBehavior: CloseBehavior } | null = null

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

function normalize(raw: RawConfig): AppSettings {
  const sourceRoots = {} as Record<SkillSource, string>
  for (const s of SOURCES) {
    const v = raw.sourceRoots?.[s]
    sourceRoots[s] = typeof v === 'string' && v.trim() ? v.trim() : sourceRootFor(s)
  }
  const disabled = typeof raw.disabledRoot === 'string' && raw.disabledRoot.trim() ? raw.disabledRoot.trim() : disabledRoot()
  const closeBehavior = CLOSE_BEHAVIORS.includes(raw.closeBehavior as CloseBehavior)
    ? (raw.closeBehavior as CloseBehavior)
    : 'ask'
  return { sourceRoots, disabledRoot: disabled, closeBehavior }
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await readRaw()
  // 先清空覆盖再求默认值，避免把上一次覆盖当成默认
  applyPathOverrides({ sourceRoots: {} })
  const effective = normalize(raw)
  applyPathOverrides({ sourceRoots: effective.sourceRoots, disabledRoot: effective.disabledRoot })
  cache = effective
  return effective
}

export function currentSettings(): AppSettings {
  return (
    cache ?? {
      sourceRoots: {
        claude: sourceRootFor('claude'),
        codex: sourceRootFor('codex'),
        opencode: sourceRootFor('opencode')
      },
      disabledRoot: disabledRoot(),
      closeBehavior: 'ask'
    }
  )
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const raw: RawConfig = {
    sourceRoots: { ...next.sourceRoots },
    disabledRoot: next.disabledRoot,
    closeBehavior: next.closeBehavior
  }
  await fs.mkdir(managedRoot(), { recursive: true })
  await fs.writeFile(configPath(), `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await loadSettings()
}
