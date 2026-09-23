import { join } from 'node:path'

import type {
  ActionResult,
  AdoptAction,
  AdoptAllResult,
  AppInfo,
  AppSettings,
  FailResult,
  ImportResult,
  InstallFromGitResult,
  Skill,
  SkillSource,
  UnmanagedSkill,
} from '@shared/types'
import { BrowserWindow, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'

import { currentSettings, loadSettings, saveSettings } from './config'
import { ensureRepo, isGitAvailable, lastCommit } from './git'
import { centralRoot, managedRoot, sourceRootFor } from './paths'
import { scanUnmanaged } from './scanner'
import { skillStore } from './store'
import { broadcastSkillsChanged, startWatcher } from './watcher'

export function registerIpc(): void {
  ipcMain.handle('skills:info', async (): Promise<AppInfo> => {
    const central = centralRoot()
    const available = await isGitAvailable()
    return {
      platform: process.platform as AppInfo['platform'],
      version: app.getVersion(),
      managedRoot: managedRoot(),
      centralRoot: central,
      sourceRoots: {
        claude: sourceRootFor('claude'),
        codex: sourceRootFor('codex'),
        opencode: sourceRootFor('opencode'),
      },
      git: {
        available,
        repoReady: available ? await ensureRepo(central) : false,
        lastCommit: await lastCommit(central),
      },
    }
  })

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
    'skills:link',
    async (_e, skillId: string, source: SkillSource): Promise<ActionResult> => {
      const result = await skillStore.link(skillId, source)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle(
    'skills:unlink',
    async (_e, skillId: string, source: SkillSource): Promise<ActionResult> => {
      const result = await skillStore.unlink(skillId, source)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle('skills:import', async (_e, path?: string): Promise<ImportResult> => {
    let srcPath = path
    if (!srcPath) {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const picked = await dialog.showOpenDialog(win, {
        title: '选择要导入中央仓库的 skill 目录',
        message: '所选目录需包含 SKILL.md',
        properties: ['openDirectory'],
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, code: 'IO', message: '已取消' }
      }
      srcPath = picked.filePaths[0]
    }
    const result = await skillStore.importSkill(srcPath)
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle(
    'skills:installFromGit',
    async (_e, url: string): Promise<InstallFromGitResult | FailResult> => {
      const result = await skillStore.installFromGit(url)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle('skills:delete', async (_e, skillId: string): Promise<ActionResult> => {
    const result = await skillStore.deleteSkill(skillId)
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle('skills:revealInFinder', (_e, skillId: string) =>
    skillStore.revealInFinder(skillId),
  )

  ipcMain.handle(
    'skills:openPath',
    async (_e, target: 'central' | SkillSource): Promise<ActionResult> => {
      const path = target === 'central' ? centralRoot() : sourceRootFor(target)
      const err = await shell.openPath(path)
      if (err) return { ok: false, code: 'IO', message: err }
      return { ok: true }
    },
  )

  ipcMain.handle('settings:get', async (): Promise<AppSettings> => currentSettings())

  ipcMain.handle('settings:save', async (_e, next: AppSettings): Promise<ActionResult> => {
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

  ipcMain.handle('skills:unmanaged', (): Promise<UnmanagedSkill[]> => scanUnmanaged())

  ipcMain.handle(
    'skills:adoptUnmanaged',
    async (_e, itemId: string, action: AdoptAction): Promise<ActionResult> => {
      const result = await skillStore.adoptUnmanaged(itemId, action)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle(
    'skills:adoptAllUnmanaged',
    async (): Promise<AdoptAllResult | FailResult> => {
      const result = await skillStore.adoptAllUnmanaged()
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle(
    'skills:adoptManyUnmanaged',
    async (_e, itemIds: string[]): Promise<AdoptAllResult | FailResult> => {
      const result = await skillStore.adoptManyUnmanaged(itemIds)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

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
