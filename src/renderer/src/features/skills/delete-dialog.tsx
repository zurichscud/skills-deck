import {
  SKILL_SOURCES,
  SOURCE_LABEL,
  type AppInfo,
  type LinkState,
  type Skill,
  type SkillSource,
} from '@shared/types'
import { Trash2 } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn, formatBytes } from '@/lib/utils'

export interface DeleteDialogProps {
  skills: Skill[]
  busy: boolean
  onClose: () => void
  onConfirm: (skills: Skill[]) => void
}

/** 删除时按去向分：内容本体进回收站，软链（含失效的）直接删除 */
type MoveState = Extract<LinkState, 'self' | 'linked' | 'broken'>

const MOVE_STATE_LABEL: Record<MoveState, string> = {
  self: '本体',
  linked: '链接',
  broken: '失效链接',
}

interface MoveEntry {
  key: string
  skillName: string
  source: SkillSource
  state: MoveState
  path: string
}

function isMoveState(state: LinkState): state is MoveState {
  return state === 'self' || state === 'linked' || state === 'broken'
}

/** 该 skill 在各存储位置会被搬进回收站的条目（内置已锁定，不列出） */
function moveEntriesOf(skill: Skill): MoveEntry[] {
  if (skill.kind === 'builtin') return []
  return SKILL_SOURCES.filter((source) => isMoveState(skill.links[source].state)).map((source) => {
    const link = skill.links[source]
    return {
      key: `${skill.id}:${source}`,
      skillName: skill.name,
      source,
      state: link.state as MoveState,
      path: link.path,
    }
  })
}

function Body({ skills, info }: { skills: Skill[]; info: AppInfo | null }): ReactElement {
  const entries = skills.flatMap(moveEntriesOf)
  const builtins = skills.filter((s) => s.kind === 'builtin')
  const bodyCount = entries.filter((e) => e.state === 'self').length
  const linkCount = entries.length - bodyCount
  const bodies = skills.filter(
    (s) => s.kind !== 'builtin' && SKILL_SOURCES.some((source) => s.links[source].state === 'self'),
  )
  const files = bodies.reduce((n, s) => n + s.files.length, 0)
  const bytes = bodies.reduce((n, s) => n + s.byteSize, 0)
  const single = skills.length === 1 ? skills[0]! : null

  return (
    <div className="space-y-2 text-sm">
      <p>
        {single ? (
          <b>{single.name}</b>
        ) : (
          <>
            选中的 <b>{skills.length}</b> 个 skill
          </>
        )}{' '}
        在各存储位置的条目会被删除：
        {bodyCount > 0 ? (
          <>
            内容本体 <b>{bodyCount}</b> 处（<b>{files}</b> 个文件、{formatBytes(bytes)}）
            <b>移入回收站</b>，之后可恢复
          </>
        ) : (
          <>没有内容本体，删除后不可恢复</>
        )}
        {linkCount > 0 && (
          <>
            ；软链 <b>{linkCount}</b> 处<b>直接删除</b>，不进回收站
          </>
        )}
        。
      </p>

      {entries.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-start gap-1.5">
              <AgentIcon agent={entry.source} className="mt-0.5 h-3.5 w-3.5" />
              <span className="shrink-0 text-2xs text-muted-foreground">
                {SOURCE_LABEL[entry.source]} · {MOVE_STATE_LABEL[entry.state]}
                {skills.length > 1 && (
                  <span className="text-muted-foreground"> · {entry.skillName}</span>
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-mono text-2xs',
                  entry.state === 'broken' ? 'text-warn' : 'text-foreground',
                )}
                title={entry.path}
              >
                {entry.path}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">没有可删除的条目。</p>
      )}

      {builtins.length > 0 && (
        <p className="text-xs text-muted-foreground">
          其中 <b>{builtins.length}</b> 个是 Codex 内置 skill，已锁定，不会被删除。
        </p>
      )}

      {info && bodyCount > 0 && (
        <p className="text-xs text-muted-foreground">
          回收站目录：<span className="font-mono break-all">{info.trashRoot}</span>
        </p>
      )}
    </div>
  )
}

export function DeleteDialog({
  skills,
  busy,
  onClose,
  onConfirm,
}: DeleteDialogProps): ReactElement | null {
  const [info, setInfo] = useState<AppInfo | null>(null)

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

  if (skills.length === 0) return null

  const skill = skills[0]!
  const entries = skills.flatMap(moveEntriesOf)
  const movable = entries.length
  /** 只剩残骸（没有内容本体）时删掉即删掉，不走回收站 */
  const hasBody = entries.some((entry) => entry.state === 'self')
  const subject = skills.length > 1 ? `${skills.length} 个 skill` : skill.name
  const bulk = skills.length > 1 ? `（${skills.length} 项）` : ''
  const actionLabel = hasBody ? `移入回收站${bulk}` : '删除'

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive-text" />
            {hasBody ? `将 ${subject} 移入回收站？` : `删除 ${subject}？`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <Body skills={skills} info={info} />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onClose}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || movable === 0}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm(skills)
            }}
          >
            {busy ? '删除中…' : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
