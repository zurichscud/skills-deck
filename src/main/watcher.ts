import type { SkillSource } from '@shared/types'
import chokidar from 'chokidar'
import { BrowserWindow } from 'electron'

import { disabledRoot, disabledSourceRootFor, sourceRootFor } from './paths'

const DEBOUNCE_MS = 350

function shouldIgnore(p: string): boolean {
  return (
    /[/\\](node_modules|\.git)([/\\]|$)/.test(p) ||
    /[/\\]\.DS_Store$/.test(p) ||
    /\.partial-\d+/.test(p) ||
    /[/\\]package-lock\.json$/.test(p)
  )
}

export function startWatcher(onChange: () => void): () => void {
  const sources: SkillSource[] = ['claude', 'codex', 'opencode']
  const roots = [
    ...sources.map((s) => sourceRootFor(s)),
    disabledRoot(),
    ...sources.map((s) => disabledSourceRootFor(s)),
  ]

  let timer: NodeJS.Timeout | null = null
  const fire = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, DEBOUNCE_MS)
  }

  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    depth: 4,
    ignored: shouldIgnore,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 60 },
  })

  watcher.on('all', fire)
  watcher.on('error', () => undefined)

  return () => {
    if (timer) clearTimeout(timer)
    void watcher.close()
  }
}

export function broadcastSkillsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('skills:changed')
  }
}
