import { SKILL_SOURCES, SOURCE_LABEL, type Skill, type SkillSource } from '@shared/types'
import { AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AGENT_IDS,
  AGENT_SOURCES,
  isActive,
  linkedCount,
  skillInView,
  symlinkCount,
  type View,
} from '@/hooks/use-skills'
import { cn, formatBytes } from '@/lib/utils'

const FOCUS_RING =
  'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

const ROW_CLASS = 'w-full border-b border-border text-left transition-colors hover:bg-accent/40'

export interface DashboardProps {
  skills: Skill[]
  onJump: (view: View) => void
  /** 回收站里的条目数 */
  trashCount: number
}

export function Dashboard({ skills, onJump, trashCount }: DashboardProps): ReactElement {
  const realSkills = skills.filter((s) => s.kind === 'skill')
  const builtin = skills.filter((s) => s.kind === 'builtin')
  const linked = realSkills.filter(isActive)
  const totalBytes = realSkills.reduce((n, s) => n + s.byteSize, 0)
  /** 各存储位置上的条目合计（一个 skill 出现在多个位置时会被重复计入） */
  const entryTotal = SKILL_SOURCES.reduce(
    (n, src) => n + skills.filter((s) => skillInView(s, { kind: 'location', source: src })).length,
    0,
  )
  const brokenLinks = realSkills.filter((s) =>
    SKILL_SOURCES.some((src) => s.links[src].state === 'broken'),
  )
  const occupied = realSkills.filter((s) =>
    SKILL_SOURCES.some((src) => s.links[src].state === 'conflict'),
  )

  return (
    <ScrollArea className="h-full">
      <div className="flex max-w-5xl flex-col gap-7 p-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            直接管理各存储位置里的
            skill：链接会在勾选的位置建立软链，删除时内容本体进回收站、各位置的软链直接删。
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            <span className="text-hero font-semibold tracking-tight tabular-nums">
              {realSkills.length}
            </span>
            <div className="pb-1 text-sm leading-tight text-muted-foreground">
              <p>个 skill</p>
              <p className="font-mono text-xs">{formatBytes(totalBytes)}</p>
            </div>
          </div>
          <div className="flex gap-5 pb-1.5 text-xs text-muted-foreground">
            <span>
              <span className="font-mono text-sm font-medium text-foreground">{entryTotal}</span>{' '}
              各位置合计
            </span>
            <span>
              <span className="font-mono text-sm font-medium text-foreground">{linked.length}</span>{' '}
              已链接
            </span>
            <span>
              <span className="font-mono text-sm font-medium text-foreground">
                {builtin.length}
              </span>{' '}
              内置
            </span>
          </div>
        </div>

        {brokenLinks.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive-text">
              <AlertTriangle className="h-3.5 w-3.5" />
              {brokenLinks.length} 个 skill 在某处链接失效
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-2xs text-muted-foreground">
              {brokenLinks.slice(0, 6).map((s) => (
                <li key={s.id} className="truncate" title={s.id}>
                  {s.name}
                </li>
              ))}
              {brokenLinks.length > 6 ? <li>…另有 {brokenLinks.length - 6} 个</li> : null}
            </ul>
          </div>
        )}

        {occupied.length > 0 && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              {occupied.length} 个 skill 在某个存储位置被同名条目占用
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">
              应用不会覆盖别人的条目；可在该位置手动处理后重新链接。
            </p>
          </div>
        )}

        <div className="grid gap-x-10 gap-y-7 md:grid-cols-[3fr_2fr]">
          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-sm font-medium text-muted-foreground">存储位置</h2>
            <div className="border-t border-border">
              {SKILL_SOURCES.map((src) => {
                const here = skills.filter((s) => skillInView(s, { kind: 'location', source: src }))
                const hereLinked = symlinkCount(skills, { kind: 'location', source: src })
                const native = here.filter((s) => s.kind === 'builtin').length
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => onJump({ kind: 'location', source: src })}
                    className={cn(FOCUS_RING, ROW_CLASS, 'py-3')}
                  >
                    <div className="flex items-center gap-3 px-1">
                      <AgentIcon agent={src} className="h-5 w-5" />
                      <span className="flex-1 truncate text-sm font-medium">
                        {SOURCE_LABEL[src]}
                      </span>
                      <span className="font-mono text-base tabular-nums">{here.length}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-2 px-1 text-2xs text-muted-foreground">
                      {hereLinked} 条软链{native > 0 ? `，${native} 个内置` : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-sm font-medium text-muted-foreground">工作区</h2>
            <div className="border-t border-border">
              {AGENT_IDS.map((agent) => {
                const srcs = AGENT_SOURCES[agent]
                const inView = skills.filter((s) => skillInView(s, { kind: 'workspace', agent }))
                const available = linkedCount(skills, { kind: 'workspace', agent })
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => onJump({ kind: 'workspace', agent })}
                    className={cn(FOCUS_RING, ROW_CLASS, 'flex items-center gap-3 py-3')}
                  >
                    <AgentIcon agent={agent} className="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{SOURCE_LABEL[agent]}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        可用 {available} 个，读取 {srcs.length} 个位置
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-muted-foreground">
                        {srcs.map((s: SkillSource) => (
                          <span key={s} className="flex items-center gap-1">
                            <AgentIcon agent={s} className="h-3 w-3" />
                            {SOURCE_LABEL[s]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="font-mono text-base tabular-nums">{inView.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          </section>

          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-sm font-medium text-muted-foreground">回收站</h2>
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => onJump({ kind: 'trash' })}
                className={cn(FOCUS_RING, ROW_CLASS, 'py-3')}
              >
                <div className="flex items-center gap-3 px-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
                    <Trash2 className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">回收站</span>
                  <span className="font-mono text-base tabular-nums">{trashCount}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </div>
                <p className="mt-2 px-1 text-2xs text-muted-foreground">
                  {trashCount > 0 ? '删除的条目都在这里，可以恢复到原位置' : '回收站是空的'}
                </p>
              </button>
            </div>
          </section>
        </div>
      </div>
    </ScrollArea>
  )
}
