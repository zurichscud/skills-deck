import { type ReactElement, type RefObject } from 'react'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AGENT_SOURCES, type View } from '@/hooks/use-skills'
import { SOURCE_LABEL, type AppInfo, type Skill, type SkillSource } from '@shared/types'

export interface ViewHeaderProps {
  view: Exclude<View, { kind: 'dashboard' }>
  skills: Skill[]
  info: AppInfo | null
  query: string
  onQueryChange: (v: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  refreshing: boolean
  onRefresh: () => void
  onAdd: () => void
}

function titleOf(view: Exclude<View, { kind: 'dashboard' }>): { agent: SkillSource; title: string } {
  if (view.kind === 'location') return { agent: view.source, title: SOURCE_LABEL[view.source] }
  return { agent: view.agent as SkillSource, title: SOURCE_LABEL[view.agent as SkillSource] }
}

export function ViewHeader({
  view,
  skills,
  info,
  query,
  onQueryChange,
  searchRef,
  refreshing,
  onRefresh,
  onAdd
}: ViewHeaderProps): ReactElement {
  const { agent, title } = titleOf(view)

  const allowed: SkillSource[] = view.kind === 'location' ? [view.source] : AGENT_SOURCES[view.agent]
  const scoped = skills.filter((s) => allowed.includes(s.source))
  const unique = new Set(scoped.map((s) => s.name)).size

  const pathLine =
    view.kind === 'location'
      ? info?.sourceRoots[view.source] ?? '…'
      : `读取 ${allowed.length} 个位置 · ${scoped.length} 条 skill · ${unique} 个不重复`

  const statLine =
    view.kind === 'location'
      ? `${scoped.filter((s) => s.enabled && !s.builtin).length} 启用 / ${scoped.filter((s) => !s.enabled && !s.builtin).length} 停用 / ${scoped.filter((s) => s.builtin).length} 内置`
      : null

  return (
    <div className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <AgentIcon agent={agent} className="h-8 w-8 shrink-0" />
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[12px] tabular-nums text-muted-foreground">
            {scoped.length}
          </span>
          {view.kind === 'workspace' && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">工作区</span>
          )}
        </div>
        <p className="mt-1 truncate text-[12px] text-muted-foreground" title={pathLine}>
          {statLine ? `${pathLine} · ${statLine}` : pathLine}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative w-[300px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索 Agent Skills..."
            className="h-9 rounded-lg bg-muted/40 pl-8 pr-14 text-[13px]"
            aria-label="搜索 skill"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新"
          title="重新扫描 skill"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>

        <Button
          size="sm"
          className="h-9 gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-[13px] text-white hover:bg-emerald-700"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          添加 Skill
        </Button>
      </div>
    </div>
  )
}
