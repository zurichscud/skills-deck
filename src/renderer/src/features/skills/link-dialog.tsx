import {
  SKILL_SOURCES,
  SOURCE_LABEL,
  type AppInfo,
  type Skill,
  type SkillSource,
} from '@shared/types'
import { Loader2 } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface LinkDialogProps {
  open: boolean
  skills: Skill[]
  onClose: () => void
  /** 操作完成后调用（刷新列表） */
  onChanged: () => void
}

/** 单个 skill 在某个位置上的勾选能力 */
interface Cell {
  checked: boolean
  /** 能否在界面上改动；本体、内置、被占用、内容已丢失都不可改 */
  actionable: boolean
  hint: string
  warn?: boolean
}

interface OpFailure {
  skill: string
  source: SkillSource
  message: string
}

/** 每个位置一行要展示与执行的内容 */
interface Row {
  checked: boolean | 'indeterminate'
  disabled: boolean
  /** 本次点击要改动的 skill（已按方向筛掉无需改动的） */
  targets: Skill[]
  next: boolean
  hint: string
  warn: boolean
  title: string
}

/** skill id → 位置 → 本地覆盖的勾选值（props 尚未刷新时保持界面与已发生的操作一致） */
type Overrides = Record<string, Partial<Record<SkillSource, boolean>>>

/**
 * 只改自己的软链：本体是内容所在处、内置天然可用、被占用的位置绝不覆盖。
 * 失效链接可以勾选（会替换残骸重建），断链残骸没有内容可链接。
 */
function baseCell(skill: Skill, source: SkillSource): Cell {
  const link = skill.links[source]
  if (skill.kind === 'builtin') {
    return link.state === 'native'
      ? { checked: true, actionable: false, hint: '内置，天然可用' }
      : { checked: false, actionable: false, hint: '内置 skill 不可链接' }
  }

  switch (link.state) {
    case 'self':
      return { checked: true, actionable: false, hint: '源位置' }
    case 'linked':
      return { checked: true, actionable: true, hint: '已链接，取消勾选即移除软链' }
    case 'native':
      return { checked: true, actionable: false, hint: '内置，天然可用' }
    case 'broken':
      return skill.broken
        ? { checked: false, actionable: false, hint: '失效链接，内容已丢失', warn: true }
        : { checked: false, actionable: true, hint: '勾选将替换失效的链接', warn: true }
    case 'conflict':
      return { checked: false, actionable: false, hint: `被占用：${link.path}`, warn: true }
    case 'absent':
      return skill.broken
        ? { checked: false, actionable: false, hint: '内容已丢失，无法链接' }
        : { checked: false, actionable: true, hint: '未链接' }
  }
}

export function LinkDialog({ open, skills, onClose, onChanged }: LinkDialogProps): ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [pending, setPending] = useState<ReadonlySet<SkillSource>>(new Set())
  /** 待确认的勾选：确认前只改界面，不落盘；关闭对话框即丢弃 */
  const [draft, setDraft] = useState<Overrides>({})
  /** 已成功落盘的结果：props 尚未刷新时也能如实反映刚做完的操作 */
  const [applied, setApplied] = useState<Overrides>({})
  const [failures, setFailures] = useState<OpFailure[]>([])

  const busy = pending.size > 0

  useEffect(() => {
    let alive = true
    void window.api
      .info()
      .then((next) => {
        if (alive) setInfo(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  /** 位置当前的实际情况（已考虑刚落盘的结果） */
  function actualOf(skill: Skill, source: SkillSource): Cell {
    const cell = baseCell(skill, source)
    if (!cell.actionable) return cell
    const appliedValue = applied[skill.id]?.[source]
    return appliedValue === undefined ? cell : { ...cell, checked: appliedValue }
  }

  function cellOf(skill: Skill, source: SkillSource): Cell {
    const cell = actualOf(skill, source)
    if (!cell.actionable) return cell
    const draftValue = draft[skill.id]?.[source]
    if (draftValue === undefined || draftValue === cell.checked) return cell
    return {
      ...cell,
      checked: draftValue,
      hint: draftValue ? '确认后创建软链' : '确认后移除软链',
    }
  }

  /** 每个位置一行：勾选状态、本次点击要执行的操作、状态说明 */
  function buildRow(source: SkillSource): Row {
    const pairs = skills.map((skill) => ({ skill, cell: cellOf(skill, source) }))
    const movable = pairs.filter((p) => p.cell.actionable)
    const allOn = movable.length > 0 && movable.every((p) => p.cell.checked)
    const next = !allOn
    const targets = movable.filter((p) => p.cell.checked !== next).map((p) => p.skill)

    const onCount = pairs.filter((p) => p.cell.checked).length
    const checked: boolean | 'indeterminate' =
      onCount === pairs.length ? true : onCount === 0 ? false : 'indeterminate'
    const blocked = pairs.length - movable.length
    const warnCount = pairs.filter((p) => p.cell.warn).length
    const draftCount = movable.filter(
      (p) => p.cell.checked !== actualOf(p.skill, source).checked,
    ).length

    const hint =
      pairs.length === 1
        ? pairs[0]!.cell.hint
        : `${onCount} / ${pairs.length} 已启用` +
          (blocked > 0 ? `，${blocked} 个不可改动` : '') +
          (warnCount > 0 ? `，${warnCount} 个需留意` : '') +
          (draftCount > 0 ? `，${draftCount} 个待确认` : '')

    const detail = pairs
      .map((p) => `${p.skill.name}：${p.cell.hint}`)
      .filter((line, index, all) => all.indexOf(line) === index)
      .join('\n')

    return {
      checked,
      disabled: movable.length === 0 || busy,
      targets,
      next,
      hint,
      warn: warnCount > 0,
      title: detail,
    }
  }

  /** 勾选只改草稿，点「确定」才真正创建或移除软链 */
  function toggleRow(source: SkillSource, row: Row): void {
    if (row.targets.length === 0) return
    setDraft((prev) => {
      const next = { ...prev }
      for (const skill of row.targets) {
        next[skill.id] = { ...prev[skill.id], [source]: row.next }
      }
      return next
    })
  }

  /** 所有待落盘的改动；草稿与实际情况相同的不算 */
  function plannedChanges(): { skill: Skill; source: SkillSource; next: boolean }[] {
    return SKILL_SOURCES.flatMap((source) =>
      skills.flatMap((skill) => {
        const cell = cellOf(skill, source)
        const actual = actualOf(skill, source).checked
        return cell.actionable && cell.checked !== actual
          ? [{ skill, source, next: cell.checked }]
          : []
      }),
    )
  }

  async function confirmChanges(): Promise<void> {
    const changes = plannedChanges()
    if (changes.length === 0 || busy) return
    setPending(new Set(changes.map((change) => change.source)))
    setFailures([])

    const nextFailures: OpFailure[] = []
    let changed = false
    for (const change of changes) {
      const result = change.next
        ? await window.api.link(change.skill.id, change.source)
        : await window.api.unlink(change.skill.id, change.source)
      if (result.ok) {
        changed = true
        setApplied((prev) => ({
          ...prev,
          [change.skill.id]: { ...prev[change.skill.id], [change.source]: change.next },
        }))
      } else {
        nextFailures.push({
          skill: change.skill.name,
          source: change.source,
          message: result.conflictAt ? `${result.message}（${result.conflictAt}）` : result.message,
        })
      }
    }

    setPending(new Set())
    // 有改动就立刻通知（部分失败时列表也已变化）
    if (changed) onChanged()

    if (nextFailures.length > 0) {
      // 失败项保留草稿，用户可以再次确认重试
      setFailures(nextFailures)
      return
    }
    // 全部成功才自动关闭
    handleClose()
  }

  function handleClose(): void {
    setDraft({})
    setApplied({})
    setPending(new Set())
    setFailures([])
    onClose()
  }

  const single = skills.length === 1 ? skills[0]! : null
  const title = single ? `链接 ${single.name}` : `链接 ${skills.length} 个 skill`
  const changes = plannedChanges()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm">
              <p>勾选要链接的位置</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {SKILL_SOURCES.map((source) => {
            const row = buildRow(source)
            const root = info?.sourceRoots[source]
            return (
              <div
                key={source}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2',
                  row.disabled ? 'opacity-70' : 'hover:bg-accent/40',
                )}
              >
                <Checkbox
                  checked={row.checked}
                  disabled={row.disabled}
                  title={row.title}
                  onCheckedChange={() => toggleRow(source, row)}
                  aria-label={`${SOURCE_LABEL[source]}：${row.hint}`}
                />
                <AgentIcon agent={source} className="h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm',
                      row.disabled ? 'text-muted-foreground' : 'font-medium',
                    )}
                  >
                    {SOURCE_LABEL[source]}
                  </p>
                  {root && (
                    <p className="truncate font-mono text-2xs text-muted-foreground" title={root}>
                      {root}
                    </p>
                  )}
                </div>
                {pending.has(source) ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <p
                    className={cn(
                      'max-w-[46%] shrink-0 truncate text-right text-2xs',
                      row.warn ? 'text-warn' : 'text-muted-foreground',
                    )}
                    title={row.title}
                  >
                    {row.hint}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {failures.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <p className="text-xs font-medium text-destructive-text">以下操作未成功</p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-2xs break-all text-muted-foreground">
              {failures.map((failure, index) => (
                <li key={`${failure.skill}-${failure.source}-${index}`}>
                  {failure.skill} → {SOURCE_LABEL[failure.source]}：{failure.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Separator />
        <DialogFooter className="items-center sm:justify-between">
          {changes.length > 0 && (
            <p className="text-2xs text-muted-foreground">待确认 {changes.length} 处变更</p>
          )}
          <div className="ms-auto flex items-center gap-2">
            <Button variant="outline" static onClick={handleClose} disabled={busy}>
              取消
            </Button>
            <Button
              static
              onClick={() => void confirmChanges()}
              disabled={busy || changes.length === 0}
            >
              {busy ? '应用中…' : '确定'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
