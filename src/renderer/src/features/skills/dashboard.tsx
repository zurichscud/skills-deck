import { SOURCE_LABEL, type Skill, type SkillSource } from '@shared/types'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { type ReactElement } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AGENT_SOURCES, skillInView, type AgentId, type View } from '@/hooks/use-skills'
import { formatBytes } from '@/lib/utils'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const AGENTS: AgentId[] = ['claude', 'codex', 'opencode']

export interface DashboardProps {
  skills: Skill[]
  onJump: (view: View) => void
}

export function Dashboard({ skills, onJump }: DashboardProps): ReactElement {
  const enabled = skills.filter((s) => s.enabled && !s.builtin)
  const disabled = skills.filter((s) => !s.enabled && !s.builtin)
  const builtin = skills.filter((s) => s.builtin)
  const broken = skills.filter((s) => s.entryKind === 'broken')
  const totalBytes = skills.reduce((n, s) => n + s.byteSize, 0)

  const bySource = (src: SkillSource): Skill[] => skills.filter((s) => s.source === src)
  const maxSource = Math.max(1, ...SOURCES.map((s) => bySource(s).length))

  return (
    <ScrollArea className="h-full">
      <div className="flex max-w-5xl flex-col gap-7 p-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            三个存储位置的 skill 总览，点击下方条目进入对应视图。
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            <span className="text-[52px] leading-none font-semibold tracking-tight tabular-nums">
              {skills.length}
            </span>
            <div className="pb-1 text-[13px] leading-tight text-muted-foreground">
              <p>个 skill</p>
              <p className="font-mono text-[12px]">{formatBytes(totalBytes)}</p>
            </div>
          </div>
          <div className="flex gap-5 pb-1.5 text-[12px] text-muted-foreground">
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {enabled.length}
              </span>{' '}
              启用中
            </span>
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {disabled.length}
              </span>{' '}
              已停用
            </span>
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {builtin.length}
              </span>{' '}
              内置
            </span>
          </div>
        </div>

        {broken.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {broken.length} 个符号链接已失效
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
              {broken.slice(0, 6).map((s) => (
                <li key={s.id} className="truncate" title={s.id}>
                  {s.id}
                </li>
              ))}
              {broken.length > 6 ? <li>…另有 {broken.length - 6} 个</li> : null}
            </ul>
          </div>
        )}

        <div className="grid gap-x-10 gap-y-7 md:grid-cols-[3fr_2fr]">
          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-[13px] font-medium text-muted-foreground">存储位置</h2>
            <div className="border-t border-border">
              {SOURCES.map((src) => {
                const list = bySource(src)
                const on = list.filter((s) => s.enabled && !s.builtin).length
                const off = list.filter((s) => !s.enabled && !s.builtin).length
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => onJump({ kind: 'location', source: src })}
                    className="w-full border-b border-border py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-3 px-1">
                      <AgentIcon agent={src} className="h-5 w-5" />
                      <span className="flex-1 truncate text-[13px] font-medium">
                        {SOURCE_LABEL[src]}
                      </span>
                      <span className="font-mono text-[15px] tabular-nums">{list.length}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    </div>
                    <div className="mt-2 px-1">
                      <div
                        className="h-1.5"
                        style={{
                          width: `${(list.length / maxSource) * 100}%`,
                          background: `var(--source-${src})`,
                        }}
                      />
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                        {on} 启用，{off} 停用，
                        {formatBytes(list.reduce((n, s) => n + s.byteSize, 0))}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-[13px] font-medium text-muted-foreground">工作区</h2>
            <div className="border-t border-border">
              {AGENTS.map((agent) => {
                const srcs = AGENT_SOURCES[agent]
                const list = skills.filter((s) => skillInView(s, { kind: 'workspace', agent }))
                const uniq = new Set(list.map((s) => s.name)).size
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => onJump({ kind: 'workspace', agent })}
                    className="flex w-full items-center gap-3 border-b border-border py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <AgentIcon agent={agent} className="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{SOURCE_LABEL[agent]}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {uniq} 个不重复，读取 {srcs.length} 个位置
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                        {srcs.map((s) => (
                          <span key={s} className="flex items-center gap-1">
                            <AgentIcon agent={s} className="h-3 w-3" />
                            {SOURCE_LABEL[s]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="font-mono text-[15px] tabular-nums">{list.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </ScrollArea>
  )
}
