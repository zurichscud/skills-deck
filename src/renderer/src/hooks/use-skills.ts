import { SKILL_SOURCES, type LinkState, type Skill, type SkillSource } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'

/** 应用管理的 agent；与存储位置解耦（agents 位置不对应任何 agent 工作区） */
export type AgentId = 'claude' | 'codex' | 'opencode'

export const AGENT_IDS = ['claude', 'codex', 'opencode'] as const satisfies readonly AgentId[]

export type View =
  | { kind: 'dashboard' }
  | { kind: 'trash' }
  | { kind: 'location'; source: SkillSource }
  | { kind: 'workspace'; agent: AgentId }
  | { kind: 'settings' }

/** 列表状态筛选：只剩「内置」这一个维度，可用与否由行内图标表达 */
export type StatusFilter = 'all' | 'builtin'

/** Agent → 它实际读取的存储位置；opencode 合并读取三个位置 */
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

/** 列表视图（非 dashboard / trash / settings） */
export type ListView = Extract<View, { kind: 'location' | 'workspace' }>

export function isListView(view: View): view is ListView {
  return view.kind === 'location' || view.kind === 'workspace'
}

/** 该位置上有这个 skill 的条目（本体、有效链接、待替换残骸或他人占位） */
function hasEntry(state: LinkState): boolean {
  return state === 'self' || state === 'linked' || state === 'broken' || state === 'conflict'
}

/** 该位置上这个 skill 能用：本体就在这里、链接生效，或 codex 内置 */
function availableAt(skill: Skill, source: SkillSource): boolean {
  const state = skill.links[source].state
  return state === 'self' || state === 'linked' || state === 'native'
}

/** 是否至少在一个存储位置可用 */
export function isActive(skill: Skill): boolean {
  if (skill.kind === 'builtin') return true
  return SKILL_SOURCES.some((s) => availableAt(skill, s))
}

/** 视图覆盖的位置：location 一个，workspace 看 agent 的读取范围，其余为全部位置 */
function sourcesFor(view: View): SkillSource[] {
  if (view.kind === 'location') return [view.source]
  if (view.kind === 'workspace') return AGENT_SOURCES[view.agent]
  return [...SKILL_SOURCES]
}

/**
 * skill 是否出现在指定视图中。
 * - location：该位置上有条目（本体 / 链接 / 残骸 / 被占用）的 skill；codex 视图额外含内置
 * - workspace：该 agent 读取范围里任位置有条目的 skill；codex 视图额外含内置
 */
export function skillInView(skill: Skill, view: View): boolean {
  if (view.kind === 'location') {
    if (skill.kind === 'builtin') return view.source === 'codex'
    return hasEntry(skill.links[view.source].state)
  }
  if (view.kind === 'workspace') {
    if (skill.kind === 'builtin') return view.agent === 'codex'
    return AGENT_SOURCES[view.agent].some((s) => hasEntry(skill.links[s].state))
  }
  return true
}

/** 在指定视图下「可用」的判定（本体在此、链接生效，内置天然可用） */
export function isLinkedInView(skill: Skill, view: View): boolean {
  if (skill.kind === 'builtin') return true
  return sourcesFor(view).some((s) => availableAt(skill, s))
}

/** 视图下「可用」的条目数（内置天然可用，不计，与列表状态筛选口径一致） */
export function linkedCount(skills: Skill[], view: ListView): number {
  return skills.filter((s) => s.kind !== 'builtin' && isLinkedInView(s, view)).length
}

/** 视图下由软链接入的条目数（本体就在此位置的、内置都不计） */
export function symlinkCount(skills: Skill[], view: ListView): number {
  const sources = sourcesFor(view)
  return skills.filter(
    (s) => s.kind === 'skill' && sources.some((src) => s.links[src].state === 'linked'),
  ).length
}

export function linkStateOf(skill: Skill, source: SkillSource): LinkState {
  return skill.links[source].state
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
    if (status === 'builtin' && s.kind !== 'builtin') return false
    if (!q) return true
    return s.name.toLowerCase().includes(q)
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
    return window.api.onChanged(() => void reload())
  }, [reload])

  return { skills, loading, reload, refresh }
}
