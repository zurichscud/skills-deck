import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { ChevronRight, File, FileText, Folder, FolderOpen, Image, Link2, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'
import { SOURCE_LABEL, type Skill, type SkillFile, type SkillFileKind } from '@shared/types'

function StatusBadge({ skill }: { skill: Skill }): ReactElement {
  if (skill.builtin) return <Badge variant="outline" className="text-[11px]">内置</Badge>
  if (skill.entryKind === 'broken') return <Badge variant="destructive" className="text-[11px]">失效</Badge>
  if (skill.enabled)
    return (
      <Badge variant="outline" className="gap-1.5 border-ok/40 text-[11px] text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        启用
      </Badge>
    )
  return <Badge variant="secondary" className="text-[11px]">停用</Badge>
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

type TreeNode =
  | { type: 'file'; path: string; name: string; file: SkillFile }
  | { type: 'dir'; path: string; name: string; children: TreeNode[] }

function buildFileTree(files: SkillFile[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let level = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      const isFile = i === parts.length - 1
      if (isFile) {
        level.push({ type: 'file', path, name, file })
        break
      }
      let dir = level.find((n): n is Extract<TreeNode, { type: 'dir' }> => n.type === 'dir' && n.name === name)
      if (!dir) {
        dir = { type: 'dir', path, name, children: [] }
        level.push(dir)
      }
      level = dir.children
    }
  }

  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.type === 'dir') sortNodes(n.children)
  }
  sortNodes(root)
  return root
}

interface FileTreeProps {
  nodes: TreeNode[]
  depth: number
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
}

function FileTree({ nodes, depth, collapsed, onToggle }: FileTreeProps): ReactElement {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === 'file') {
          const Icon = KIND_META[node.file.kind].icon
          return (
            <div
              key={node.path}
              className="flex items-center justify-between gap-2 py-0.5 text-[11.5px]"
              style={{ paddingLeft: depth * 14 + 4 }}
            >
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-muted-foreground" title={node.path}>
                <Icon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{node.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground/60">{formatBytes(node.file.size)}</span>
            </div>
          )
        }

        const open = !collapsed.has(node.path)
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              className="flex w-full items-center gap-1 py-0.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              style={{ paddingLeft: depth * 14 }}
            >
              <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
              {open ? (
                <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              ) : (
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              )}
              <span className="truncate font-mono">{node.name}</span>
            </button>
            {open && <FileTree nodes={node.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />}
          </div>
        )
      })}
    </>
  )
}

export interface SkillDetailProps {
  skill: Skill | null
}

export function SkillDetail({ skill }: SkillDetailProps): ReactElement {
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

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setCollapsed(new Set())
  }, [skill?.id])

  const toggleDir = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (!skill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">未选择 skill</p>
        <p className="text-[13px] text-muted-foreground/70">在列表中选择一项，这里会显示路径、frontmatter 和文件。</p>
      </div>
    )
  }

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

        {skill.entryKind === 'broken' && skill.linkTarget && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-[12px] font-medium text-destructive">符号链接失效</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">→ {skill.linkTarget}</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">路径</p>
          <dl className="space-y-1.5 text-[11.5px]">
            <div>
              <dt className="text-muted-foreground/70">当前位置</dt>
              <dd className="break-all font-mono text-muted-foreground">{skill.dirPath}</dd>
            </div>
          </dl>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-medium text-muted-foreground">Frontmatter</p>
            <span className="text-[11px] text-muted-foreground/60">{fmEntries.length} 字段</span>
          </div>
          {fmEntries.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70">（无）</p>
          ) : (
            <dl className="space-y-2 text-[12px]">
              {fmEntries.map(([k, v]) => (
                <div key={k}>
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
            <p className="text-[11px] font-medium text-muted-foreground">文件</p>
            <span className="text-[11px] text-muted-foreground/60">
              {skill.files.length} 个，共 {formatBytes(skill.byteSize)}
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
                    <div className="rounded-md border bg-muted/20 px-1.5 py-1">
                      <FileTree nodes={buildFileTree(list)} depth={0} collapsed={collapsed} onToggle={toggleDir} />
                    </div>
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
