import { SOURCE_LABEL, type AppInfo, type Skill, type SkillSource } from '@shared/types'
import { FolderOpen, Inbox, Package, RefreshCw, Search } from 'lucide-react'
import { type ReactElement, type RefObject } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AGENT_SOURCES, skillInView, type ListView } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

import { ImportMenu, type ImportMode } from './import-menu'

export interface ViewHeaderProps {
  view: ListView
  skills: Skill[]
  info: AppInfo | null
  query: string
  onQueryChange: (v: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  refreshing: boolean
  onRefresh: () => void
  /** 导入入口：仅中央仓库视图提供，且只写入中央仓库 */
  onImport: (mode: ImportMode) => void
  /** 打开当前视图对应的目录 */
  onOpenLocation: () => void
}

function HeaderIcon({ view }: { view: ListView }): ReactElement {
  if (view.kind === 'repository' || view.kind === 'unmanaged') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        {view.kind === 'repository' ? (
          <Package className="h-4 w-4" />
        ) : (
          <Inbox className="h-4 w-4" />
        )}
      </span>
    )
  }
  const agent: SkillSource = view.kind === 'location' ? view.source : view.agent
  return <AgentIcon agent={agent} className="h-8 w-8 shrink-0" />
}

function titleOf(view: ListView): string {
  if (view.kind === 'repository') return '中央仓库'
  if (view.kind === 'unmanaged') return '未纳管'
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
  onImport,
  onOpenLocation,
}: ViewHeaderProps): ReactElement {
  const title = titleOf(view)
  const scoped = skills.filter((s) => skillInView(s, view))

  const pathLine =
    view.kind === 'repository'
      ? (info?.centralRoot ?? '…')
      : view.kind === 'unmanaged'
        ? `三个存储位置里尚未纳入中央仓库的 ${scoped.length} 个条目`
        : view.kind === 'location'
          ? (info?.sourceRoots[view.source] ?? '…')
          : `合并读取 ${AGENT_SOURCES[view.agent].length} 个位置，共 ${scoped.length} 条 skill`

  const modKey = info?.platform === 'darwin' ? '⌘K' : 'Ctrl K'

  return (
    <div className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <HeaderIcon view={view} />
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <p className="mt-1 truncate font-mono text-2xs text-muted-foreground" title={pathLine}>
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
            placeholder="搜索 skill…"
            className="h-9 ps-8 pe-14 text-sm"
            aria-label="搜索 skill"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            {modKey}
          </kbd>
        </div>

        <Button
          variant="outline"
          size="icon"
          static
          className="h-9 w-9"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新"
          title="重新扫描 skill"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>

        {view.kind !== 'unmanaged' && (
          <Button
            variant="outline"
            size="sm"
            static
            className="h-9 gap-1.5 px-3 text-sm"
            onClick={onOpenLocation}
            title={pathLine}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {view.kind === 'repository' ? '打开中央仓库' : '打开存储位置'}
          </Button>
        )}

        {view.kind === 'repository' && <ImportMenu onImport={onImport} />}
      </div>
    </div>
  )
}
