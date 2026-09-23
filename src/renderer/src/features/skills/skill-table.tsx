import { SOURCE_LABEL, type LinkState, type Skill, type SkillSource } from '@shared/types'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { type ReactElement } from 'react'

import { AgentIcon } from '@/components/agent-icons'
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
import { linkStateOf, linkTargetsFor, switchSourceFor, type ListView } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

const LINK_HINT: Record<LinkState, string> = {
  linked: '已链接，点击取消',
  absent: '未链接，点击链接',
  broken: '该位置是失效软链，点击替换为指向中央仓库的链接',
  conflict: '该位置已被同名条目占用，需手动处理',
  native: 'Codex 内置，天然可用',
}

/** 单一启用位置：开/关软链；未纳管与内置一律禁用 */
function EnableSwitch({
  skill,
  source,
  pending,
  onToggle,
}: {
  skill: Skill
  source: SkillSource
  pending: boolean
  onToggle: (skill: Skill, source: SkillSource, next: boolean) => void
}): ReactElement {
  const state = linkStateOf(skill, source)
  const checked = state === 'linked' || state === 'native'
  const disabled =
    pending || skill.kind === 'external' || skill.kind === 'builtin' || state === 'conflict'

  const hint =
    skill.kind === 'external'
      ? '未纳管条目，无法在此启用'
      : skill.kind === 'builtin'
        ? 'Codex 内置，天然可用'
        : state === 'conflict'
          ? '该位置已被同名条目占用，需手动处理'
          : state === 'broken'
            ? '该位置是失效软链，开启会替换为指向中央仓库的链接'
            : checked
              ? '已启用，关闭将移除该位置的软链'
              : '未启用，开启将创建指向中央仓库的软链'

  return (
    <Switch
      checked={checked}
      disabled={disabled}
      title={hint}
      onCheckedChange={(next) => onToggle(skill, source, next)}
      aria-label={`${checked ? '停用' : '启用'} ${skill.name}（${SOURCE_LABEL[source]}）`}
    />
  )
}

function typeLabel(skill: Skill): string {
  if (skill.kind === 'central') return '中央仓库'
  if (skill.kind === 'builtin') return 'Codex 内置'
  return '未纳管'
}

function LinkToggle({
  skill,
  source,
  pending,
  onToggle,
}: {
  skill: Skill
  source: SkillSource
  pending: boolean
  onToggle: (skill: Skill, source: SkillSource, next: boolean) => void
}): ReactElement {
  const state = linkStateOf(skill, source)
  const linked = state === 'linked' || state === 'native'
  const disabled = pending || state === 'native' || state === 'conflict'

  const tint = `var(--source-${source})`
  const style =
    state === 'conflict'
      ? undefined
      : linked
        ? {
            color: tint,
            borderColor: `color-mix(in oklab, ${tint} 45%, transparent)`,
            background: `color-mix(in oklab, ${tint} 13%, transparent)`,
          }
        : state === 'broken'
          ? {
              color: 'var(--warn)',
              borderColor: 'color-mix(in oklab, var(--warn) 45%, transparent)',
            }
          : undefined

  return (
    <button
      type="button"
      disabled={disabled}
      title={`${SOURCE_LABEL[source]}：${LINK_HINT[state]}`}
      aria-label={`${SOURCE_LABEL[source]} ${linked ? '取消链接' : '链接'} ${skill.name}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(skill, source, !linked)
      }}
      style={style}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-[5px] border transition-colors',
        !linked && state !== 'conflict' && state !== 'broken' && 'border-dashed border-border/70',
        state === 'conflict' && 'border-warn/50 text-warn',
        disabled ? 'cursor-default opacity-70' : 'hover:border-foreground/30',
        !disabled && linked && 'hover:opacity-80',
      )}
    >
      <AgentIcon agent={source} className="h-3.5 w-3.5" />
    </button>
  )
}

export interface SkillTableProps {
  skills: Skill[]
  view: ListView
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
  onToggleLink: (skill: Skill, source: SkillSource, next: boolean) => void
  onAdopt: () => void
  onReveal: (skill: Skill) => void
  onDelete: (skill: Skill) => void
}

export function SkillTable({
  skills,
  view,
  loading,
  filtered,
  selectedId,
  pendingIds,
  checkedIds,
  onToggleCheck,
  onToggleAll,
  allChecked,
  onSelect,
  onToggleLink,
  onAdopt,
  onReveal,
  onDelete,
}: SkillTableProps): ReactElement {
  const switchSource = switchSourceFor(view)
  /** 未纳管视图：来源图标代替链接开关，操作只保留「纳入中央仓库 / 删除」 */
  const isUnmanaged = view.kind === 'unmanaged'

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
      <table className="w-full min-w-[680px] table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-left text-[11px] font-medium text-muted-foreground">
            <th className="w-8 cursor-pointer px-2 py-2" onClick={onToggleAll}>
              <Checkbox
                checked={allChecked}
                onCheckedChange={onToggleAll}
                onClick={(e) => e.stopPropagation()}
                aria-label="全选"
              />
            </th>
            <th className="w-[190px] px-2 py-2">名称</th>
            <th className="px-2 py-2">描述</th>
            {!isUnmanaged && <th className="w-[132px] px-2 py-2">类型</th>}
            <th
              className={cn(
                'px-2 py-2',
                isUnmanaged ? 'w-[64px]' : switchSource ? 'w-[64px]' : 'w-[112px]',
              )}
            >
              {isUnmanaged ? '来源' : switchSource ? '启用' : '链接'}
            </th>
            <th className="w-10 px-1 py-2">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => {
            const pending = pendingIds.has(skill.id)
            const selected = skill.id === selectedId
            const targets = linkTargetsFor(skill, view)
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
                {!isUnmanaged && (
                  <td className="px-2 py-2">
                    <span
                      className={cn(
                        'block truncate text-[11.5px]',
                        skill.kind === 'external'
                          ? 'text-warn'
                          : skill.kind === 'builtin'
                            ? 'text-muted-foreground/70'
                            : 'text-muted-foreground',
                      )}
                      title={skill.dirPath}
                    >
                      {typeLabel(skill)}
                    </span>
                  </td>
                )}
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  {isUnmanaged ? (
                    <span
                      className="flex h-6 w-6 items-center justify-center"
                      title={skill.origin ? `来源：${SOURCE_LABEL[skill.origin]}` : undefined}
                    >
                      {skill.origin && <AgentIcon agent={skill.origin} className="h-3.5 w-3.5" />}
                    </span>
                  ) : switchSource ? (
                    <EnableSwitch
                      skill={skill}
                      source={switchSource}
                      pending={pending}
                      onToggle={onToggleLink}
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      {targets.map((source) => (
                        <LinkToggle
                          key={source}
                          skill={skill}
                          source={source}
                          pending={pending}
                          onToggle={onToggleLink}
                        />
                      ))}
                    </div>
                  )}
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
                      {isUnmanaged ? (
                        <>
                          <DropdownMenuItem onSelect={() => onAdopt()}>
                            纳入中央仓库…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(skill)}>
                            删除
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          {skill.kind === 'external' && (
                            <>
                              <DropdownMenuItem onSelect={() => onAdopt()}>
                                纳入中央仓库…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem onSelect={() => onReveal(skill)}>
                            打开所在文件夹
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={skill.kind === 'builtin'}
                            variant="destructive"
                            onSelect={() => onDelete(skill)}
                          >
                            删除
                          </DropdownMenuItem>
                        </>
                      )}
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
