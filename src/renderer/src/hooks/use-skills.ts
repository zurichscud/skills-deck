import { SKILL_SOURCES, type LinkState, type Skill, type SkillSource } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'

export type AgentId = SkillSource

export type View =
  | { kind: 'dashboard' }
  | { kind: 'repository' }
  | { kind: 'unmanaged' }
  | { kind: 'location'; source: SkillSource }
  | { kind: 'workspace'; agent: AgentId }
  | { kind: 'settings' }

export type StatusFilter = 'all' | 'linked' | 'unlinked' | 'builtin'

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

/** 列表视图（非 dashboard / settings） */
export type ListView = Extract<
  View,
  { kind: 'repository' | 'unmanaged' | 'location' | 'workspace' }
>

export function isListView(view: View): view is ListView {
  return (
    view.kind === 'repository' ||
    view.kind === 'unmanaged' ||
    view.kind === 'location' ||
    view.kind === 'workspace'
  )
}

/** 该 skill 是否在指定存储位置可用（链接生效或内置天然可用） */
function availableAt(skill: Skill, source: SkillSource): boolean {
  const state = skill.links[source].state
  return state === 'linked' || state === 'native'
}

/** 是否至少链接到一个存储位置 */
export function isActive(skill: Skill): boolean {
  if (skill.kind === 'builtin') return true
  return SKILL_SOURCES.some((s) => availableAt(skill, s))
}

/**
 * skill 是否出现在指定视图中。
 * - 中央仓库：只看真身
 * - 未纳管：只看三个存储位置里没指向中央仓库真身的条目
 * - 存储位置：该位置的启用清单——全部候选真身（含尚未链接的）+ 未纳管条目 + codex 内置
 * - 工作区：该 agent 读取范围内的一切——全部候选真身 + 相关未纳管条目 + codex 内置
 */
export function skillInView(skill: Skill, view: View): boolean {
  if (view.kind === 'repository') return skill.kind === 'central'
  if (view.kind === 'unmanaged') {
    // 与「未纳管的 Skill」弹窗同一口径：断链残骸没有内容可纳入，不列入
    if (skill.kind !== 'external' || skill.origin === null) return false
    return skill.links[skill.origin].state !== 'broken'
  }

  if (view.kind === 'location') {
    if (skill.kind === 'central') return true
    return skill.origin === view.source
  }

  if (view.kind === 'workspace') {
    if (skill.kind === 'builtin') return view.agent === 'codex'
    if (skill.kind === 'external') {
      return skill.origin !== null && AGENT_SOURCES[view.agent].includes(skill.origin)
    }
    return true
  }

  return true
}

/** 在指定视图下「已启用」的判定 */
export function isLinkedInView(skill: Skill, view: View): boolean {
  if (skill.kind === 'builtin') return true
  if (view.kind === 'location') return availableAt(skill, view.source)
  if (view.kind === 'workspace') {
    return AGENT_SOURCES[view.agent].some((s) => availableAt(skill, s))
  }
  return isActive(skill)
}

/**
 * 该视图用「单一启用位置」的开关呈现时返回那个位置，否则返回 null（用多位置图标区分）。
 * 存储位置视图天然只有一个位置；工作区只有读取单一位置的 agent（Claude Code / Codex）适用。
 */
export function switchSourceFor(view: ListView): SkillSource | null {
  if (view.kind === 'location') return view.source
  if (view.kind === 'workspace') {
    const sources = AGENT_SOURCES[view.agent]
    return sources.length === 1 ? sources[0] : null
  }
  return null
}

/** 视图下「已启用」的条目数（内置不计，与状态筛选 tab 的口径一致） */
export function linkedCount(skills: Skill[], view: ListView): number {
  return skills.filter((s) => s.kind !== 'builtin' && isLinkedInView(s, view)).length
}

/** 该视图中需要展示开关的存储位置 */
export function linkTargetsFor(skill: Skill, view: View): SkillSource[] {
  if (skill.kind === 'external') return []
  if (skill.kind === 'builtin') return ['codex']
  if (view.kind === 'location') return [view.source]
  if (view.kind === 'workspace') return AGENT_SOURCES[view.agent]
  return [...SKILL_SOURCES]
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
    const builtin = s.kind === 'builtin'
    if (status === 'builtin' && !builtin) return false
    if (status === 'linked' && (builtin || !isLinkedInView(s, view))) return false
    if (status === 'unlinked' && (builtin || isLinkedInView(s, view))) return false
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
    return window.api.onChanged(() => void reload())
  }, [reload])

  return { skills, loading, reload, refresh }
}
