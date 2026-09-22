import { useCallback, useEffect, useState } from 'react'
import type { Skill, SkillSource } from '@shared/types'

export type AgentId = 'claude' | 'codex' | 'opencode'

export type View =
  | { kind: 'dashboard' }
  | { kind: 'location'; source: SkillSource }
  | { kind: 'workspace'; agent: AgentId }
  | { kind: 'settings' }

export type StatusFilter = 'all' | 'enabled' | 'disabled' | 'builtin'

/** Agent → 它实际读取的存储位置；opencode 合并三个位置，其余 1:1 */
export const AGENT_SOURCES: Record<AgentId, SkillSource[]> = {
  claude: ['claude'],
  codex: ['codex'],
  opencode: ['claude', 'codex', 'opencode']
}

export function viewSources(view: View): SkillSource[] | null {
  if (view.kind === 'location') return [view.source]
  if (view.kind === 'workspace') return AGENT_SOURCES[view.agent]
  return null
}

export function filterSkills(skills: Skill[], query: string, view: View, status: StatusFilter): Skill[] {
  const allowed = viewSources(view)
  const q = query.trim().toLowerCase()
  return skills.filter((s) => {
    if (allowed && !allowed.includes(s.source)) return false
    if (status === 'builtin' && !s.builtin) return false
    if (status === 'enabled' && (!s.enabled || s.builtin)) return false
    if (status === 'disabled' && (s.enabled || s.builtin)) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })
}

export interface UseSkillsResult {
  skills: Skill[]
  loading: boolean
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const list = await window.api.list()
      setSkills(list)
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.refresh()
      setSkills(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return window.api.onChanged(() => {
      void reload()
    })
  }, [reload])

  return { skills, loading, reload, refresh }
}
