import type {
  ActionResult,
  AppSettings,
  Skill,
  SkillApi,
  SkillSource,
  TrashItem,
} from '@shared/types'
import { contextBridge, ipcRenderer } from 'electron'

/** 主进程的写操作统一返回 `{ ok } | { ok:false, message }`；失败在这里抛出，让渲染层的 catch 真正生效 */
function throwIfFailed(result: unknown): void {
  if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
    throw new Error((result as { message?: string }).message ?? '操作失败')
  }
}

const api: SkillApi = {
  info: () => ipcRenderer.invoke('skills:info'),
  list: (): Promise<Skill[]> => ipcRenderer.invoke('skills:list'),
  refresh: (): Promise<Skill[]> => ipcRenderer.invoke('skills:refresh'),
  readFile: (skillId: string, relPath: string): Promise<string> =>
    ipcRenderer.invoke('skills:readFile', skillId, relPath).then((r) => {
      if (r && typeof r === 'object' && 'ok' in r) {
        if (r.ok) return r.content
        throw new Error(r.message)
      }
      return String(r ?? '')
    }),
  link: (skillId: string, source: SkillSource): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:link', skillId, source),
  unlink: (skillId: string, source: SkillSource): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:unlink', skillId, source),
  deleteSkill: (skillId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:delete', skillId),
  trash: (): Promise<TrashItem[]> => ipcRenderer.invoke('trash:list'),
  restoreFromTrash: (itemId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('trash:restore', itemId),
  purgeTrash: (itemId: string): Promise<ActionResult> => ipcRenderer.invoke('trash:purge', itemId),
  emptyTrash: (): Promise<ActionResult> => ipcRenderer.invoke('trash:empty'),
  revealInFinder: (skillId: string): Promise<void> =>
    ipcRenderer.invoke('skills:revealInFinder', skillId).then(throwIfFailed),
  revealTrashItem: (itemId: string): Promise<void> =>
    ipcRenderer.invoke('trash:reveal', itemId).then(throwIfFailed),
  openPath: (target: SkillSource): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:openPath', target),
  onChanged: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('skills:changed', handler)
    return () => ipcRenderer.removeListener('skills:changed', handler)
  },
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (next: AppSettings): Promise<ActionResult> =>
    ipcRenderer.invoke('settings:save', next),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('settings:pickDirectory'),
}

contextBridge.exposeInMainWorld('api', api)
