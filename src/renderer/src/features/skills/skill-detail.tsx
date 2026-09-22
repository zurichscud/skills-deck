import { type ReactElement, useMemo } from 'react'
import { File, FileText, FolderOpen, Image, Link2, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'
import { SOURCE_LABEL, type Skill, type SkillFileKind } from '@shared/types'

function StatusBadge({ skill }: { skill: Skill }): ReactElement {
  if (skill.builtin) return <Badge variant="outline" className="text-[11px]">内置</Badge>
  if (skill.entryKind === 'broken') return <Badge variant="destructive" className="text-[11px]">失效</Badge>
  return (
    <Badge variant={skill.enabled ? 'default' : 'secondary'} className="text-[11px]">
      {skill.enabled ? '启用' : '停用'}
    </Badge>
  )
}

const KIND_META: Record<SkillFileKind, { label: string; icon: typeof File }> = {
  md: { label: 'Markdown', icon: FileText },
  script: { label: '脚本', icon: Terminal },
  asset: { label: '资源', icon: Image },
  other: { label: '其它', icon: File }
}

function formatValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export interface SkillDetailProps {
  skill: Skill | null
  pending: boolean
  onSetEnabled: (skill: Skill, next: boolean) => void
  onCopyTo: (skill: Skill) => void
  onReveal: (skill: Skill) => void
}

export function SkillDetail({ skill, pending, onSetEnabled, onCopyTo, onReveal }: SkillDetailProps): ReactElement {
  const grouped = useMemo(() => {
    const map = new Map<SkillFileKind, Skill['files']>()
    if (skill) {
      for (const f of skill.files) {
        const list = map.get(f.kind) ?? []
        list.push(f)
        map.set(f.kind, list)
      }
    }
    return map
  }, [skill])

  if (!skill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">未选中 skill</p>
        <p className="text-[13px] text-muted-foreground/70">在左侧列表中选择一项查看详情。</p>
      </div>
    )
  }

  const locked = skill.builtin || skill.entryKind === 'broken'
  const fmEntries = Object.entries(skill.frontmatter)

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="break-all font-mono text-[15px] font-semibold leading-snug">{skill.name}</h2>
            <StatusBadge skill={skill} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1.5 text-[11px]">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background:
                    skill.source === 'claude'
                      ? 'var(--source-claude)'
                      : skill.source === 'codex'
                        ? 'var(--source-codex)'
                        : 'var(--source-opencode)'
                }}
              />
              {SOURCE_LABEL[skill.source]}
            </Badge>
            {skill.entryKind === 'symlink' && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Link2 className="h-3 w-3" />
                符号链接
              </Badge>
            )}
            {skill.entryKind === 'broken' && <Badge variant="destructive">链接失效</Badge>}
            {skill.builtin && <Badge variant="secondary">内置</Badge>}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {skill.description || '（无描述）'}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
          <div>
            <p className="text-[13px] font-medium">{skill.enabled ? '启用中' : '已停用'}</p>
            <p className="text-[11px] text-muted-foreground">
              {skill.enabled ? '对来源工具可见' : '存放在停用停车场'}
            </p>
          </div>
          <Switch
            checked={skill.enabled}
            disabled={locked || pending}
            onCheckedChange={(next) => onSetEnabled(skill, next)}
            aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-[13px]"
            disabled={skill.builtin}
            onClick={() => onCopyTo(skill)}
          >
            复制到其他来源…
          </Button>
          <Button size="sm" variant="outline" className="text-[13px]" onClick={() => onReveal(skill)}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            Finder
          </Button>
        </div>

        {skill.entryKind === 'broken' && skill.linkTarget && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-[12px] font-medium text-destructive">符号链接失效</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">→ {skill.linkTarget}</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">路径</p>
          <dl className="space-y-1.5 text-[11.5px]">
            <div>
              <dt className="text-muted-foreground/70">当前位置</dt>
              <dd className="break-all font-mono text-muted-foreground">{skill.dirPath}</dd>
            </div>
            {!skill.enabled && (
              <div>
                <dt className="text-muted-foreground/70">启用位置</dt>
                <dd className="break-all font-mono text-muted-foreground">{skill.originPath}</dd>
              </div>
            )}
            {skill.entryKind === 'symlink' && skill.linkTarget && (
              <div>
                <dt className="text-muted-foreground/70">链接真身</dt>
                <dd className="break-all font-mono text-muted-foreground">{skill.linkTarget}</dd>
              </div>
            )}
          </dl>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Frontmatter</p>
            <span className="text-[11px] text-muted-foreground/60">{fmEntries.length} 字段</span>
          </div>
          {fmEntries.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70">（无）</p>
          ) : (
            <dl className="space-y-1 text-[12px]">
              {fmEntries.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[88px_1fr] gap-2">
                  <dt className="truncate font-mono text-muted-foreground/70" title={k}>
                    {k}
                  </dt>
                  <dd className="break-all font-mono text-foreground/90" title={formatValue(v)}>
                    {formatValue(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">文件</p>
            <span className="text-[11px] text-muted-foreground/60">
              {skill.files.length} 个 · {formatBytes(skill.byteSize)}
            </span>
          </div>
          {skill.files.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70">（空）</p>
          ) : (
            <div className="space-y-3">
              {(['md', 'script', 'asset', 'other'] as SkillFileKind[]).map((kind) => {
                const list = grouped.get(kind)
                if (!list || list.length === 0) return null
                const meta = KIND_META[kind]
                const Icon = meta.icon
                return (
                  <div key={kind}>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                      <Icon className="h-3 w-3" />
                      {meta.label}
                      <span className="tabular-nums">({list.length})</span>
                    </p>
                    <ul className="space-y-0.5">
                      {list.map((f) => (
                        <li key={f.path} className="flex items-center justify-between gap-2 text-[11.5px]">
                          <span className="truncate font-mono text-muted-foreground" title={f.path}>
                            {f.path}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground/60">{formatBytes(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className={cn('pb-2 text-[10.5px] text-muted-foreground/50')}>
          更新于 {skill.mtime ? formatRelativeTime(skill.mtime) : '—'}
        </p>
      </div>
    </ScrollArea>
  )
}
