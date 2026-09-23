import { SOURCE_LABEL, type AppInfo, type Skill, type SkillSource } from '@shared/types'
import { FolderOpen, Package, Plus, RefreshCw, Search } from 'lucide-react'
import { type ReactElement, type RefObject } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AGENT_SOURCES, skillInView, type ListView } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

export interface ViewHeaderProps {
  view: ListView
  skills: Skill[]
  info: AppInfo | null
  query: string
  onQueryChange: (v: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  refreshing: boolean
  onRefresh: () => void
  onAdd: () => void
  /** 打开当前视图对应的目录 */
  onOpenLocation: () => void
}

function HeaderIcon({ view }: { view: ListView }): ReactElement {
  if (view.kind === 'repository') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <Package className="h-4 w-4" />
      </span>
    )
  }
  const agent: SkillSource = view.kind === 'location' ? view.source : view.agent
  return <AgentIcon agent={agent} className="h-8 w-8 shrink-0" />
}

function titleOf(view: ListView): string {
  if (view.kind === 'repository') return '中央仓库'
  if (view.kind === 'location') return SOURCE_LABEL[view.source]
  return SOURCE_LABEL[view.agent]
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
  onAdd,
  onOpenLocation,
}: ViewHeaderProps): ReactElement {
  const title = titleOf(view)
  const scoped = skills.filter((s) => skillInView(s, view))

  const pathLine =
    view.kind === 'repository'
      ? (info?.centralRoot ?? '…')
      : view.kind === 'location'
        ? (info?.sourceRoots[view.source] ?? '…')
        : `合并读取 ${AGENT_SOURCES[view.agent].length} 个位置，共 ${scoped.length} 条 skill`

  return (
    <div className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <HeaderIcon view={view} />
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <p className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground" title={pathLine}>
          {pathLine}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative w-[300px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索 Agent Skills..."
            className="h-9 pr-14 pl-8 text-[13px]"
            aria-label="搜索 skill"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新"
          title="重新扫描 skill"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-3 text-[13px]"
          onClick={onOpenLocation}
          title={pathLine}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {view.kind === 'repository' ? '打开中央仓库' : '打开存储位置'}
        </Button>

        <Button size="sm" className="h-9 gap-1.5 px-3.5 text-[13px]" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          导入 Skill
        </Button>
      </div>
    </div>
  )
}
