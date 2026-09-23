import type {
  AppSettings,
  CopyResult,
  CopyStrategy,
  SetEnabledResult,
  Skill,
  SkillApi,
  SkillSource,
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
  setEnabled: (skillId: string, enabled: boolean): Promise<SetEnabledResult> =>
    ipcRenderer.invoke('skills:setEnabled', skillId, enabled),
  copyTo: (skillId: string, target: SkillSource, strategy: CopyStrategy): Promise<CopyResult> =>
    ipcRenderer.invoke('skills:copyTo', skillId, target, strategy),
  deleteSkill: (skillId: string): Promise<SetEnabledResult> =>
    ipcRenderer.invoke('skills:delete', skillId),
  revealInFinder: (skillId: string): Promise<void> =>
    ipcRenderer.invoke('skills:revealInFinder', skillId),
  openSourceRoot: (source: SkillSource): Promise<SetEnabledResult> =>
    ipcRenderer.invoke('skills:openSourceRoot', source),
  onChanged: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('skills:changed', handler)
    return () => ipcRenderer.removeListener('skills:changed', handler)
  },
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (next: AppSettings): Promise<SetEnabledResult> =>
    ipcRenderer.invoke('settings:save', next),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('settings:pickDirectory'),
}

contextBridge.exposeInMainWorld('api', api)
