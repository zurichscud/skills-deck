import { type ReactElement } from 'react'
import { AlertTriangle, Boxes, HardDrive, LayoutDashboard } from 'lucide-react'
import { AgentIcon } from '@/components/agent-icons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AGENT_SOURCES, type AgentId, type View } from '@/hooks/use-skills'
import { formatBytes } from '@/lib/utils'
import { SOURCE_LABEL, type Skill, type SkillSource } from '@shared/types'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const AGENTS: AgentId[] = ['claude', 'codex', 'opencode']

function Stat({
  label,
  value,
  hint,
  tone = 'default'
}: {
  label: string
  value: number
  hint?: string
  tone?: 'default' | 'ok' | 'muted' | 'warn'
}): ReactElement {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-500'
      : tone === 'muted'
        ? 'text-muted-foreground'
        : tone === 'warn'
          ? 'text-amber-500'
          : 'text-foreground'
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground/60">{hint}</p> : null}
      </CardContent>
    </Card>
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
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            三个存储位置共 {skills.length} 个 skill，合计 {formatBytes(totalBytes)}。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Skill 总数" value={skills.length} hint="跨全部存储位置" />
          <Stat label="启用中" value={enabled.length} tone="ok" hint="对来源工具可见" />
          <Stat label="已停用" value={disabled.length} tone="muted" hint="存放在停用停车场" />
          <Stat label="内置" value={builtin.length} hint="不可停用" />
        </div>

        {broken.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/10">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {broken.length} 个符号链接失效
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11.5px] text-muted-foreground">
              <ul className="space-y-0.5">
                {broken.slice(0, 6).map((s) => (
                  <li key={s.id} className="truncate font-mono" title={s.id}>
                    {s.id}
                  </li>
                ))}
                {broken.length > 6 ? <li>…另有 {broken.length - 6} 个</li> : null}
              </ul>
            </CardContent>
          </Card>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            <HardDrive className="h-3 w-3" />
            存储位置
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {SOURCES.map((src) => {
              const list = bySource(src)
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => onJump({ kind: 'location', source: src })}
                  className="rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-2">
                    <AgentIcon agent={src} />
                    <span className="text-[13px] font-medium">{SOURCE_LABEL[src]}</span>
                    <span className="ml-auto tabular-nums text-[13px]">{list.length}</span>
                  </div>
                  <dl className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <dt>启用</dt>
                      <dd className="tabular-nums">{list.filter((s) => s.enabled && !s.builtin).length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>停用</dt>
                      <dd className="tabular-nums">{list.filter((s) => !s.enabled && !s.builtin).length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>体积</dt>
                      <dd className="tabular-nums">{formatBytes(list.reduce((n, s) => n + s.byteSize, 0))}</dd>
                    </div>
                  </dl>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            <Boxes className="h-3 w-3" />
            工作区
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {AGENTS.map((agent) => {
              const srcs = AGENT_SOURCES[agent]
              const list = skills.filter((s) => srcs.includes(s.source))
              const uniq = new Set(list.map((s) => s.name)).size
              return (
                <button
                  key={agent}
                  type="button"
                  onClick={() => onJump({ kind: 'workspace', agent })}
                  className="rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-2">
                    <AgentIcon agent={agent} />
                    <span className="text-[13px] font-medium">{SOURCE_LABEL[agent]}</span>
                    <span className="ml-auto tabular-nums text-[13px]">{list.length}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {uniq} 个不重复 skill · 读取 {srcs.length} 个位置
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {srcs.map((s) => (
                      <span key={s} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <AgentIcon agent={s} className="h-3 w-3" />
                        {SOURCE_LABEL[s]}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
