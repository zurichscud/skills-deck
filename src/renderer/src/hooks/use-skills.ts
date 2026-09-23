import type { Skill, SkillSource } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'

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
  opencode: ['claude', 'codex', 'opencode'],
}

/** 「内置」只存在于 codex 的 .system，因此该筛选仅属于 Codex 视图 */
export function isCodexView(view: View): boolean {
  if (view.kind === 'location') return view.source === 'codex'
  if (view.kind === 'workspace') return view.agent === 'codex'
  return false
}

/**
 * skill 是否出现在指定视图中。
 * codex 的 .system 内置 skill 只被 codex 自身读取，其他 agent（如 opencode）无法使用，故在工作区中排除。
 */
export function skillInView(skill: Skill, view: View): boolean {
  if (view.kind === 'location') return skill.source === view.source
  if (view.kind === 'workspace') {
    if (!AGENT_SOURCES[view.agent].includes(skill.source)) return false
    return !skill.builtin || view.agent === 'codex'
  }
  return true
}

export function filterSkills(
  skills: Skill[],
  query: string,
  view: View,
  status: StatusFilter,
): Skill[] {
  const q = query.trim().toLowerCase()
  return skills.filter((s) => {
    if (!skillInView(s, view)) return false
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
