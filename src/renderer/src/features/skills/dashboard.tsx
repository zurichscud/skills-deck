import { type ReactElement } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { AgentIcon } from '@/components/agent-icons'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn, formatBytes } from '@/lib/utils'
import { AGENT_SOURCES, type AgentId, type View } from '@/hooks/use-skills'
import { SOURCE_LABEL, type Skill, type SkillSource } from '@shared/types'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const AGENTS: AgentId[] = ['claude', 'codex', 'opencode']

function SourceDot({ source, className }: { source: SkillSource; className?: string }): ReactElement {
  return (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', className)}
      style={{ background: `var(--source-${source})` }}
    />
  )
}

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

  return (
    <ScrollArea className="h-full">
      <div className="flex max-w-5xl flex-col gap-5 p-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">三个存储位置的 skill 总览，点击下方条目进入对应视图。</p>
        </div>

        {/* 重点元素：总数 + 三来源分布仪表 */}
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <span className="text-[52px] font-semibold leading-none tracking-tight tabular-nums">
                {skills.length}
              </span>
              <div className="pb-1 text-[13px] leading-tight text-muted-foreground">
                <p>个 skill</p>
                <p className="font-mono text-[12px]">{formatBytes(totalBytes)}</p>
              </div>
            </div>
            <div className="flex gap-5 pb-1.5 text-[12px] text-muted-foreground">
              <span>
                <span className="font-mono text-[13px] font-medium text-foreground">{enabled.length}</span> 启用中
              </span>
              <span>
                <span className="font-mono text-[13px] font-medium text-foreground">{disabled.length}</span> 已停用
              </span>
              <span>
                <span className="font-mono text-[13px] font-medium text-foreground">{builtin.length}</span> 内置
              </span>
            </div>
          </div>

          <div className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted/60">
            {skills.length > 0 &&
              SOURCES.map((src) => {
                const n = bySource(src).length
                if (n === 0) return null
                return (
                  <div
                    key={src}
                    className="h-full"
                    style={{ width: `${(n / skills.length) * 100}%`, background: `var(--source-${src})` }}
                    title={`${SOURCE_LABEL[src]} ${n}`}
                  />
                )
              })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
            {SOURCES.map((src) => (
              <span key={src} className="flex items-center gap-1.5">
                <SourceDot source={src} />
                {SOURCE_LABEL[src]}
                <span className="font-mono tabular-nums">{bySource(src).length}</span>
              </span>
            ))}
          </div>
        </div>

        {broken.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
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

        <div className="grid gap-5 md:grid-cols-2">
          <section className="grid content-start gap-2">
            <h2 className="text-[13px] font-medium text-muted-foreground">存储位置</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {SOURCES.map((src) => {
                const list = bySource(src)
                const on = list.filter((s) => s.enabled && !s.builtin).length
                const off = list.filter((s) => !s.enabled && !s.builtin).length
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => onJump({ kind: 'location', source: src })}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <AgentIcon agent={src} className="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{SOURCE_LABEL[src]}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {on} 启用，{off} 停用，{formatBytes(list.reduce((n, s) => n + s.byteSize, 0))}
                      </p>
                    </div>
                    <span className="font-mono text-[15px] tabular-nums">{list.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  </button>
                )
              })}
            </div>
          </section>

          <section className="grid content-start gap-2">
            <h2 className="text-[13px] font-medium text-muted-foreground">工作区</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {AGENTS.map((agent) => {
                const srcs = AGENT_SOURCES[agent]
                const list = skills.filter((s) => srcs.includes(s.source))
                const uniq = new Set(list.map((s) => s.name)).size
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => onJump({ kind: 'workspace', agent })}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <AgentIcon agent={agent} className="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{SOURCE_LABEL[agent]}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {uniq} 个不重复，读取 {srcs.length} 个位置
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/80">
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
