import { SOURCE_LABEL, type Skill } from '@shared/types'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { type ReactElement } from 'react'

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
import { cn } from '@/lib/utils'

/**
 * 这一行的东西是什么：
 * - 目录：内容本体是真实目录，落在某个存储位置里
 * - 软链：内容在应用管理的四个位置之外，位置里只有一个指向它的软链
 * - 内置：codex `.system` 自带
 * - 残骸：软链已失效，没有内容可读
 */
function typeLabel(skill: Skill): { text: string; hint: string; warn: boolean } {
  if (skill.kind === 'builtin') {
    return { text: '内置', hint: `.system 自带，锁定不可改：${skill.dirPath}`, warn: false }
  }
  if (skill.broken) {
    return { text: '残骸 · 软链', hint: `链接已失效，只剩残骸：${skill.dirPath}`, warn: true }
  }
  if (skill.home === null) {
    return {
      text: '软链 · 应用之外',
      hint: `内容不在四个位置里，位置里只有软链：${skill.dirPath}`,
      warn: false,
    }
  }
  return {
    text: `目录 · ${SOURCE_LABEL[skill.home]}`,
    hint: `内容本体：${skill.dirPath}`,
    warn: false,
  }
}

export interface SkillTableProps {
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
            const type = typeLabel(skill)
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
                      {skill.name}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <span className="block truncate text-muted-foreground" title={skill.description}>
                    {skill.description || '无描述'}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span
                    className={cn(
                      'block truncate text-2xs',
                      type.warn ? 'text-warn' : 'text-muted-foreground',
                    )}
                    title={type.hint}
                  >
                    {type.text}
                  </span>
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
