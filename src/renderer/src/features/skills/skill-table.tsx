import { SOURCE_LABEL, type Skill, type SkillLink } from '@shared/types'
import { File, Link2, Loader2, MoreHorizontal, Unlink } from 'lucide-react'
import { type ReactElement } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { AGENT_SOURCES, type ListView } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

/** 「类型」列只有两个值：文件 = 位置里是真实内容；软链 = 位置里只有指向别处的软链 */
type RowType = {
  text: '文件' | '软链'
  variant: 'secondary' | 'outline'
  warn: boolean
  hint: string
  /** 软链用虚线边框 + 链接图标，与文件明显区分 */
  symlink: boolean
}

/** 该位置里这个条目是不是软链；被占用的条目按真实路径判断 */
function isSymlinkEntry(link: SkillLink): boolean {
  if (link.state === 'linked' || link.state === 'broken') return true
  return link.state === 'conflict' && link.target !== undefined && link.target !== link.path
}

function entryHint(link: SkillLink): string {
  switch (link.state) {
    case 'linked':
      return `软链指向 ${link.target ?? '未知目标'}：${link.path}`
    case 'broken':
      return `链接已失效，只剩残骸：${link.path}`
    case 'conflict':
      return `位置被同名条目占用：${link.path}`
    default:
      return `内容本体：${link.path}`
  }
}

/**
 * 这一行的类型按当前视图里实际存在的条目判断：
 * - 位置视图只看该位置；工作区看该 agent 读取的位置。
 * - 条目是软链（含失效残骸）就显示「软链」，真实目录才显示「文件」。
 */
function typeLabel(skill: Skill, view: ListView): RowType {
  if (skill.kind === 'builtin') {
    return {
      text: '文件',
      variant: 'secondary',
      warn: false,
      hint: `.system 自带，锁定不可改：${skill.dirPath}`,
      symlink: false,
    }
  }

  const sources = view.kind === 'location' ? [view.source] : AGENT_SOURCES[view.agent]
  const entries = sources
    .map((source) => ({ source, link: skill.links[source] }))
    .filter((entry) => entry.link.state !== 'absent')
  if (entries.length === 0) {
    return {
      text: '文件',
      variant: 'secondary',
      warn: false,
      hint: skill.dirPath,
      symlink: false,
    }
  }

  const allSymlink = entries.every((entry) => isSymlinkEntry(entry.link))
  const warn = entries.some(
    (entry) => entry.link.state === 'broken' || entry.link.state === 'conflict',
  )
  const detail = entries
    .map((entry) =>
      entries.length > 1
        ? `${SOURCE_LABEL[entry.source]}：${entryHint(entry.link)}`
        : entryHint(entry.link),
    )
    .join('\n')

  return {
    text: allSymlink ? '软链' : '文件',
    variant: allSymlink ? 'outline' : 'secondary',
    warn,
    hint: detail,
    symlink: allSymlink,
  }
}

/** 名称中与搜索词匹配的片段标红；不区分大小写，命中多处全部标出 */
function HighlightedName({ name, query }: { name: string; query: string }): ReactElement {
  const needle = query.trim().toLowerCase()
  if (!needle) return <>{name}</>

  const lower = name.toLowerCase()
  const parts: ReactElement[] = []
  let from = 0
  let at = lower.indexOf(needle)
  let key = 0
  while (at !== -1) {
    if (at > from) parts.push(<span key={key++}>{name.slice(from, at)}</span>)
    parts.push(
      <mark key={key++} className="bg-transparent font-semibold text-primary-text">
        {name.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
    at = lower.indexOf(needle, from)
  }
  if (from < name.length) parts.push(<span key={key++}>{name.slice(from)}</span>)
  return <>{parts}</>
}

export interface SkillTableProps {
  view: ListView
  /** 当前搜索词，用于高亮名称中的匹配片段 */
  query: string
  skills: Skill[]
  loading: boolean
  /** 当前存在搜索词或状态筛选（决定空状态文案） */
  filtered: boolean
  selectedId: string | null
  pendingIds: ReadonlySet<string>
  checkedIds: ReadonlySet<string>
  onToggleCheck: (id: string) => void
  onToggleAll: () => void
  allChecked: boolean
  onSelect: (skill: Skill) => void
  /** 打开链接对话框 */
  onLink: (skill: Skill) => void
  onReveal: (skill: Skill) => void
  onDelete: (skill: Skill) => void
}

export function SkillTable({
  view,
  query,
  skills,
  loading,
  filtered,
  selectedId,
  pendingIds,
  checkedIds,
  onToggleCheck,
  onToggleAll,
  allChecked,
  onSelect,
  onLink,
  onReveal,
  onDelete,
}: SkillTableProps): ReactElement {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        {filtered ? (
          <>
            <p className="text-sm font-medium">没有匹配的 skill</p>
            <p className="text-sm text-muted-foreground">调整搜索词或上方状态筛选再试。</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">这里还没有 skill</p>
            <p className="text-sm text-muted-foreground">
              检查设置里的存储位置，或点击右上角刷新重新扫描。
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-left text-2xs font-medium text-muted-foreground">
            <th className="w-8 px-2 py-2">
              <Checkbox
                checked={allChecked}
                onCheckedChange={onToggleAll}
                onClick={(e) => e.stopPropagation()}
                aria-label="全选"
              />
            </th>
            <th className="w-[190px] px-2 py-2">名称</th>
            <th className="px-2 py-2">描述</th>
            <th className="w-[170px] px-2 py-2">类型</th>
            <th className="w-10 px-1 py-2">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => {
            const pending = pendingIds.has(skill.id)
            const selected = skill.id === selectedId
            const locked = skill.kind === 'builtin'
            const type = typeLabel(skill, view)
            return (
              <tr
                key={skill.id}
                onClick={() => onSelect(skill)}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50',
                  selected && 'row-select-rail bg-accent/60',
                )}
              >
                <td
                  className="cursor-pointer px-2 py-2"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCheck(skill.id)
                  }}
                >
                  <Checkbox
                    checked={checkedIds.has(skill.id)}
                    onCheckedChange={() => onToggleCheck(skill.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`选择 ${skill.name}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    {pending && (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    <span className="truncate font-mono text-xs" title={skill.name}>
                      <HighlightedName name={skill.name} query={query} />
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <span className="block truncate text-muted-foreground" title={skill.description}>
                    {skill.description || '无描述'}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <Badge
                    variant={type.variant}
                    className={cn(
                      'gap-1 text-2xs',
                      type.symlink
                        ? type.warn
                          ? 'border-dashed border-warn/60 bg-warn/10 text-warn'
                          : 'border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground'
                        : 'bg-secondary text-secondary-foreground',
                      type.warn && !type.symlink && 'border-warn/50 text-warn',
                    )}
                    title={type.hint}
                  >
                    {type.symlink ? type.warn ? <Unlink /> : <Link2 /> : <File />}
                    {type.text}
                  </Badge>
                </td>
                <td className="px-1 py-2">
                  <span className="sr-only">操作</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        static
                        className="h-6 w-6"
                        aria-label={`更多操作：${skill.name}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-sm">
                      <DropdownMenuItem onSelect={() => onReveal(skill)}>
                        打开所在文件夹
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={locked || skill.broken}
                        onSelect={() => onLink(skill)}
                      >
                        链接…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={locked}
                        variant="destructive"
                        onSelect={() => onDelete(skill)}
                      >
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
