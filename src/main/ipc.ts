import { join } from 'node:path'

import type {
  ActionResult,
  AppInfo,
  AppSettings,
  Skill,
  SkillSource,
  TrashItem,
} from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'
import { BrowserWindow, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'

import { currentSettings, loadSettings, saveSettings } from './config'
import { managedRoot, sourceRootFor, trashRoot } from './paths'
import { skillStore } from './store'
import { broadcastSkillsChanged, startWatcher } from './watcher'

/** 渲染层传来的位置标识必须落在白名单里，避免索引越界 */
function isSource(value: unknown): value is SkillSource {
  return typeof value === 'string' && (SKILL_SOURCES as readonly string[]).includes(value)
}

export function registerIpc(): void {
  ipcMain.handle('skills:info', (): AppInfo => {
    const sourceRoots = {} as Record<SkillSource, string>
    for (const source of SKILL_SOURCES) sourceRoots[source] = sourceRootFor(source)
    return {
      platform: process.platform as AppInfo['platform'],
      version: app.getVersion(),
      managedRoot: managedRoot(),
      trashRoot: trashRoot(),
      sourceRoots,
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
      if (!isSource(source)) return { ok: false, code: 'IO', message: '未知的存储位置' }
      const result = await skillStore.link(skillId, source)
      if (result.ok) broadcastSkillsChanged()
      return result
    },
  )

  ipcMain.handle(
    'skills:unlink',
    async (_e, skillId: string, source: SkillSource): Promise<ActionResult> => {
      if (!isSource(source)) return { ok: false, code: 'IO', message: '未知的存储位置' }
      const result = await skillStore.unlink(skillId, source)
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

  ipcMain.handle('skills:openPath', async (_e, target: SkillSource): Promise<ActionResult> => {
    if (!isSource(target)) return { ok: false, code: 'IO', message: '未知的存储位置' }
    const err = await shell.openPath(sourceRootFor(target))
    if (err) return { ok: false, code: 'IO', message: err }
    return { ok: true }
  })

  ipcMain.handle('trash:list', (): Promise<TrashItem[]> => skillStore.trash())

  ipcMain.handle('trash:restore', async (_e, itemId: string): Promise<ActionResult> => {
    const result = await skillStore.restoreFromTrash(itemId)
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle('trash:purge', async (_e, itemId: string): Promise<ActionResult> => {
    const result = await skillStore.purgeTrash(itemId)
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle('trash:empty', async (): Promise<ActionResult> => {
    const result = await skillStore.emptyTrash()
    if (result.ok) broadcastSkillsChanged()
    return result
  })

  ipcMain.handle('trash:reveal', (_e, itemId: string) => skillStore.revealTrashItem(itemId))

  ipcMain.handle('settings:get', (): AppSettings => currentSettings())

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
