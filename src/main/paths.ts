import { homedir } from 'node:os'
import { join } from 'node:path'

import type { SkillSource } from '@shared/types'

const ENV_SOURCE: Record<SkillSource, string> = {
  claude: 'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  codex: 'SKILLSDECK_SOURCE_ROOT_CODEX',
  opencode: 'SKILLSDECK_SOURCE_ROOT_OPENCODE',
  agents: 'SKILLSDECK_SOURCE_ROOT_AGENTS',
}

interface PathOverrides {
  sourceRoots: Partial<Record<SkillSource, string>>
}

const overrides: PathOverrides = { sourceRoots: {} }

/** 由 config.ts 在加载/保存后写入；环境变量优先级高于配置，便于测试隔离 */
export function applyPathOverrides(next: PathOverrides): void {
  overrides.sourceRoots = { ...next.sourceRoots }
}

function defaultSourceRootFor(source: SkillSource): string {
  const home = homedir()
  switch (source) {
    case 'claude':
      return join(home, '.claude', 'skills')
    case 'codex':
      return join(home, '.codex', 'skills')
    case 'opencode':
      return join(home, '.config', 'opencode', 'skills')
    case 'agents':
      return join(home, '.agents', 'skills')
  }
}

export function sourceRootFor(source: SkillSource): string {
  const fromEnv = process.env[ENV_SOURCE[source]]
  if (fromEnv) return fromEnv
  return overrides.sourceRoots[source] ?? defaultSourceRootFor(source)
}

/** 应用数据目录（存放 config.json 与回收站）——固定，不受设置影响 */
export function managedRoot(): string {
  const fromEnv = process.env['SKILLSDECK_MANAGED_ROOT']
  if (fromEnv) return fromEnv
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'skillsdeck')
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    return join(appData, 'skillsdeck')
  }
  const xdg = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config')
  return join(xdg, 'skillsdeck')
}

/** 回收站根目录：删除的条目都搬到这里，可恢复或彻底删除 */
export function trashRoot(): string {
  const fromEnv = process.env['SKILLSDECK_TRASH_ROOT']
  if (fromEnv) return fromEnv
  return join(managedRoot(), 'trash')
}

export function sourceDirFor(source: SkillSource, relDir: string): string {
  return join(sourceRootFor(source), relDir)
}

export function makeSkillId(anchor: SkillSource | 'detached', relDir: string): string {
  return `${anchor}:${relDir}`
}
