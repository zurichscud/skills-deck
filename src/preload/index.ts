import type {
  ActionResult,
  AdoptAction,
  AdoptAllResult,
  AppSettings,
  FailResult,
  ImportResult,
  InstallFromGitResult,
  Skill,
  SkillApi,
  SkillSource,
  UnmanagedSkill,
} from '@shared/types'
import { contextBridge, ipcRenderer } from 'electron'

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
  importSkill: (path?: string): Promise<ImportResult> => ipcRenderer.invoke('skills:import', path),
  installFromGit: (url: string): Promise<InstallFromGitResult | FailResult> =>
    ipcRenderer.invoke('skills:installFromGit', url),
  unmanaged: (): Promise<UnmanagedSkill[]> => ipcRenderer.invoke('skills:unmanaged'),
  adoptUnmanaged: (itemId: string, action: AdoptAction): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:adoptUnmanaged', itemId, action),
  adoptAllUnmanaged: (): Promise<AdoptAllResult | FailResult> =>
    ipcRenderer.invoke('skills:adoptAllUnmanaged'),
  adoptManyUnmanaged: (itemIds: string[]): Promise<AdoptAllResult | FailResult> =>
    ipcRenderer.invoke('skills:adoptManyUnmanaged', itemIds),
  deleteSkill: (skillId: string): Promise<ActionResult> =>
    ipcRenderer.invoke('skills:delete', skillId),
  revealInFinder: (skillId: string): Promise<void> =>
    ipcRenderer.invoke('skills:revealInFinder', skillId),
  openPath: (target: 'central' | SkillSource): Promise<ActionResult> =>
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
