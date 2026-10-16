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

/** 会随删除一起进回收站的三种呈现 */
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
          <>
            将把 <b>{single.name}</b> 在各位置的条目移入回收站
          </>
        ) : (
          <>
            将把选中的 <b>{skills.length}</b> 个 skill 在各位置的条目移入回收站
          </>
        )}
        ，之后可从「回收站」<b>恢复</b>。
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
        <p className="text-muted-foreground">没有可移动的条目。</p>
      )}

      <p className="text-muted-foreground">
        {bodyCount > 0 && (
          <>
            其中 <b>{bodyCount}</b> 处是内容本体，共 <b>{files}</b> 个文件（
            {formatBytes(bytes)}）会一并移入
          </>
        )}
        {bodyCount > 0 && linkCount > 0 && '；'}
        {linkCount > 0 && (
          <>
            <b>{linkCount}</b> 处是软链，只移动链接本身
          </>
        )}
        {entries.length > 0 && '。'}
      </p>

      {builtins.length > 0 && (
        <p className="text-xs text-muted-foreground">
          其中 <b>{builtins.length}</b> 个是 Codex 内置 skill，已锁定，不会被移动。
        </p>
      )}

      {info && (
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
  const movable = skills.flatMap(moveEntriesOf).length

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive-text" />
            {skills.length > 1
              ? `将 ${skills.length} 个 skill 移入回收站？`
              : `将 ${skill.name} 移入回收站？`}
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
            {busy
              ? '移动中…'
              : skills.length > 1
                ? `移入回收站（${skills.length} 项）`
                : '移入回收站'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
