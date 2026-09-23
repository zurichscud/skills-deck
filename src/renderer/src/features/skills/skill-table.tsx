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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

function stateHint(skill: Skill): string {
  if (skill.builtin) return '内置 skill，不可停用'
  if (skill.entryKind === 'broken') return '符号链接失效，无法操作'
  return skill.enabled ? '启用中' : '已停用'
}

export interface SkillTableProps {
  skills: Skill[]
  loading: boolean
  /** 当前存在搜索词或状态筛选（决定空状态文案） */
  filtered: boolean
  /** 工作区视图：同一 skill 可能来自多个位置，需要显示位置列 */
  showLocation: boolean
  selectedId: string | null
  pendingIds: ReadonlySet<string>
  checkedIds: ReadonlySet<string>
  onToggleCheck: (id: string) => void
  onToggleAll: () => void
  allChecked: boolean
  onSelect: (skill: Skill) => void
  onSetEnabled: (skill: Skill, next: boolean) => void
  onCopyTo: (skill: Skill) => void
  onReveal: (skill: Skill) => void
  onDelete: (skill: Skill) => void
}

export function SkillTable({
  skills,
  loading,
  filtered,
  showLocation,
  selectedId,
  pendingIds,
  checkedIds,
  onToggleCheck,
  onToggleAll,
  allChecked,
  onSelect,
  onSetEnabled,
  onCopyTo,
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
            <p className="text-[13px] text-muted-foreground">调整搜索词或上方状态筛选再试。</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">这里还没有 skill</p>
            <p className="text-[13px] text-muted-foreground">
              检查设置中的仓库地址，或点击右上角刷新重新扫描。
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[620px] table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-left text-[11px] font-medium text-muted-foreground">
            <th className="w-8 px-2 py-2">
              <Checkbox checked={allChecked} onCheckedChange={onToggleAll} aria-label="全选" />
            </th>
            <th className="w-[180px] px-2 py-2">名称</th>
            <th className="px-2 py-2">描述</th>
            {showLocation && <th className="w-[88px] px-2 py-2">位置</th>}
            <th className="w-[56px] px-2 py-2">状态</th>
            <th className="w-10 px-1 py-2">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => {
            const pending = pendingIds.has(skill.id)
            const selected = skill.id === selectedId
            const locked = skill.builtin || skill.entryKind === 'broken'
            return (
              <tr
                key={skill.id}
                onClick={() => onSelect(skill)}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50',
                  selected && 'bg-accent/60',
                )}
                style={selected ? { boxShadow: 'inset 2px 0 0 var(--primary)' } : undefined}
              >
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={checkedIds.has(skill.id)}
                    onCheckedChange={() => onToggleCheck(skill.id)}
                    aria-label={`选择 ${skill.name}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    {pending && (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    <span className="truncate font-mono text-[12.5px]" title={skill.name}>
                      {skill.name}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <span className="block truncate text-muted-foreground" title={skill.description}>
                    {skill.description || '无'}
                  </span>
                </td>
                {showLocation && (
                  <td className="px-2 py-2">
                    <span
                      className="block truncate text-[11.5px] text-muted-foreground"
                      title={skill.dirPath}
                    >
                      {SOURCE_LABEL[skill.source]}
                    </span>
                  </td>
                )}
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <div title={stateHint(skill)}>
                    <Switch
                      checked={skill.enabled}
                      disabled={locked || pending}
                      onCheckedChange={(next) => onSetEnabled(skill, next)}
                      aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                    />
                  </div>
                </td>
                <td className="px-1 py-2">
                  <span className="sr-only">操作</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="更多操作"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-[13px]">
                      <DropdownMenuItem disabled={skill.builtin} onSelect={() => onCopyTo(skill)}>
                        复制到其他源
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onReveal(skill)}>
                        打开所在文件夹
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={skill.builtin}
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
