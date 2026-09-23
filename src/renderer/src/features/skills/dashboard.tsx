import { SOURCE_LABEL, type Skill, type SkillSource } from '@shared/types'
import { AlertTriangle, ChevronRight, Package, Sparkles } from 'lucide-react'
import { type ReactElement } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AGENT_SOURCES,
  isActive,
  linkedCount,
  skillInView,
  type AgentId,
  type View,
} from '@/hooks/use-skills'
import { formatBytes } from '@/lib/utils'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const AGENTS: AgentId[] = ['claude', 'codex', 'opencode']

export interface DashboardProps {
  skills: Skill[]
  onJump: (view: View) => void
  unmanaged: { total: number; conflicts: number; onOpen: () => void } | null
}

export function Dashboard({ skills, onJump, unmanaged }: DashboardProps): ReactElement {
  const central = skills.filter((s) => s.kind === 'central')
  const builtin = skills.filter((s) => s.kind === 'builtin')
  const external = skills.filter((s) => s.kind === 'external')
  const linked = central.filter(isActive)
  const unlinked = central.filter((s) => !isActive(s))
  const brokenLinks = central.filter((s) => SOURCES.some((src) => s.links[src].state === 'broken'))
  const occupied = central.filter((s) => SOURCES.some((src) => s.links[src].state === 'conflict'))
  const totalBytes = central.reduce((n, s) => n + s.byteSize, 0)

  return (
    <ScrollArea className="h-full">
      <div className="flex max-w-5xl flex-col gap-7 p-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            中央仓库是唯一真身，各 agent 目录只放指向它的软链。
          </p>
        </div>

        {unmanaged && (
          <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 px-3.5 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium">
                发现 {unmanaged.total} 个未纳入中央仓库的 skill
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {unmanaged.conflicts > 0
                  ? `其中 ${unmanaged.conflicts} 个与中央仓库同名，需要你决定如何取舍。`
                  : '逐个纳入即可让三个 agent 共享同一份真身。'}
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-[12.5px]"
              onClick={unmanaged.onOpen}
            >
              逐个处理
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            <span className="text-[52px] leading-none font-semibold tracking-tight tabular-nums">
              {central.length}
            </span>
            <div className="pb-1 text-[13px] leading-tight text-muted-foreground">
              <p>个 skill 在中央仓库</p>
              <p className="font-mono text-[12px]">{formatBytes(totalBytes)}</p>
            </div>
          </div>
          <div className="flex gap-5 pb-1.5 text-[12px] text-muted-foreground">
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {linked.length}
              </span>{' '}
              启用
            </span>
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {unlinked.length}
              </span>{' '}
              未启用
            </span>
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {builtin.length}
              </span>{' '}
              内置
            </span>
            <span>
              <span className="font-mono text-[13px] font-medium text-foreground">
                {external.length}
              </span>{' '}
              未纳管
            </span>
          </div>
        </div>

        {brokenLinks.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {brokenLinks.length} 个 skill 在某处链接失效
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
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
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
              <AlertTriangle className="h-3.5 w-3.5" />
              {occupied.length} 个 skill 在某个存储位置被非纳管条目占用
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              这些位置不会自动覆盖；可在「未纳管的 Skill」弹窗里逐个归集，或手动处理后重试。
            </p>
          </div>
        )}

        <div className="grid gap-x-10 gap-y-7 md:grid-cols-[3fr_2fr]">
          <section className="grid content-start gap-1">
            <h2 className="pb-1 text-[13px] font-medium text-muted-foreground">中央仓库</h2>
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => onJump({ kind: 'repository' })}
                className="w-full border-b border-border py-3 text-left transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center gap-3 px-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
                    <Package className="h-3 w-3" />
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">全部 Skill</span>
                  <span className="font-mono text-[15px] tabular-nums">{central.length}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                </div>
                <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">
                  {linked.length} 启用，{unlinked.length} 未启用，{formatBytes(totalBytes)}
                </p>
              </button>

              <h2 className="pt-5 pb-1 text-[13px] font-medium text-muted-foreground">存储位置</h2>
              {SOURCES.map((src) => {
                const here = skills.filter((s) => skillInView(s, { kind: 'location', source: src }))
                const hereLinked = linkedCount(skills, { kind: 'location', source: src })
                const foreign = here.filter((s) => s.kind === 'external').length
                const native = here.filter((s) => s.kind === 'builtin').length
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
                      <span className="font-mono text-[15px] tabular-nums">{here.length}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    </div>
                    <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">
                      {hereLinked} 条软链
                      {native > 0 ? `，${native} 个内置` : ''}
                      {foreign > 0 ? `，${foreign} 个未纳管` : ''}
                    </p>
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
                const inView = skills.filter((s) => skillInView(s, { kind: 'workspace', agent }))
                const available = linkedCount(skills, { kind: 'workspace', agent })
                const foreign = skills.filter(
                  (s) =>
                    s.kind === 'external' &&
                    s.origin !== null &&
                    AGENT_SOURCES[agent].includes(s.origin),
                ).length
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
                        可用 {available} 个，读取 {srcs.length} 个位置
                        {foreign > 0 ? `，另有 ${foreign} 个未纳管` : ''}
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
                    <span className="font-mono text-[15px] tabular-nums">{inView.length}</span>
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
