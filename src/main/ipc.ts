import { join } from 'node:path'

import type {
  AppInfo,
  AppSettings,
  CopyResult,
  CopyStrategy,
  SetEnabledResult,
  Skill,
  SkillSource,
} from '@shared/types'
import { BrowserWindow, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'

import { currentSettings, loadSettings, saveSettings } from './config'
import { disabledRoot, managedRoot, sourceRootFor } from './paths'
import { skillStore } from './store'
import { broadcastSkillsChanged, startWatcher } from './watcher'

export function registerIpc(): void {
  ipcMain.handle('skills:info', (): AppInfo => ({
    platform: process.platform as AppInfo['platform'],
    version: app.getVersion(),
    managedRoot: managedRoot(),
    disabledRoot: disabledRoot(),
    sourceRoots: {
      claude: sourceRootFor('claude'),
      codex: sourceRootFor('codex'),
      opencode: sourceRootFor('opencode'),
    },
  }))

  ipcMain.handle('skills:list', (): Skill[] => skillStore.list())

  ipcMain.handle('skills:refresh', async (): Promise<Skill[]> => {
    await skillStore.refresh()
    broadcastSkillsChanged()
    return skillStore.list()
  })

  ipcMain.handle('skills:readFile', (_e, skillId: string, relPath: string) =>
    skillStore.readFile(skillId, relPath),
  )

  ipcMain.handle(
    'skills:setEnabled',
    async (_e, skillId: string, enabled: boolean): Promise<SetEnabledResult> => {
      const result = await skillStore.setEnabled(skillId, enabled)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle(
    'skills:copyTo',
    async (
      _e,
      skillId: string,
      target: SkillSource,
      strategy: CopyStrategy,
    ): Promise<CopyResult> => {
      const result = await skillStore.copyTo(skillId, target, strategy)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle('skills:revealInFinder', (_e, skillId: string) =>
    skillStore.revealInFinder(skillId),
  )

  ipcMain.handle('skills:delete', async (_e, skillId: string): Promise<SetEnabledResult> => {
    const result = await skillStore.deleteSkill(skillId)
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle('settings:get', async (): Promise<AppSettings> => currentSettings())

  ipcMain.handle('settings:save', async (_e, next: AppSettings): Promise<SetEnabledResult> => {
    try {
      await saveSettings(next)
      await skillStore.refresh()
      broadcastSkillsChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, code: 'IO', message: `保存设置失败：${(err as Error).message}` }
    }
  })

  ipcMain.handle('settings:pickDirectory', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  void loadSettings().then(async () => {
    await skillStore.init()
    startWatcher(() => {
      void skillStore.refresh().then(() => broadcastSkillsChanged())
    })
    broadcastSkillsChanged()
  })
}

let tray: Tray | null = null

export function ensureTray(onShow: () => void): void {
  if (tray) return
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'tray-icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  if (process.platform === 'darwin' && icon.isEmpty()) tray.setTitle('SD')
  tray.setToolTip('Skills Deck')
  tray.on('click', onShow)
  tray.on('double-click', onShow)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function wireCloseBehavior(win: BrowserWindow, onShow: () => void): void {
  let forceQuit = false

  app.on('before-quit', () => {
    forceQuit = true
    destroyTray()
  })

  win.on('close', (e) => {
    if (forceQuit) return
    const behavior = currentSettings().closeBehavior

    if (behavior === 'quit') return

    e.preventDefault()

    if (behavior === 'tray') {
      win.hide()
      ensureTray(onShow)
      return
    }

    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['退出应用', '最小化到托盘', '取消'],
        defaultId: 0,
        cancelId: 2,
        title: '关闭 Skills Deck',
        message: '要如何处理这个窗口？',
        detail: '可在侧栏「设置」中更改此行为。',
      })
      .then(({ response }) => {
        if (response === 0) {
          forceQuit = true
          destroyTray()
          app.quit()
        } else if (response === 1) {
          win.hide()
          ensureTray(onShow)
        }
      })
  })
}

export async function pickDirectoryForSettings(): Promise<void> {
  await shell.openPath(managedRoot())
}
