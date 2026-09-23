import {
  SKILL_SOURCES,
  SOURCE_LABEL,
  type LinkState,
  type Skill,
  type SkillFile,
  type SkillFileKind,
  type SkillSource,
} from '@shared/types'
import {
  AlertTriangle,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Link2,
  Link2Off,
  Terminal,
} from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { isActive } from '@/hooks/use-skills'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'

function StatusBadge({ skill }: { skill: Skill }): ReactElement {
  if (skill.kind === 'builtin')
    return (
      <Badge variant="outline" className="text-[11px]">
        内置
      </Badge>
    )
  if (skill.kind === 'external') {
    return skill.links[skill.origin as SkillSource]?.state === 'broken' ? (
      <Badge variant="destructive" className="text-[11px]">
        失效
      </Badge>
    ) : (
      <Badge variant="outline" className="border-warn/50 text-[11px] text-warn">
        未纳管
      </Badge>
    )
  }
  if (isActive(skill))
    return (
      <Badge variant="outline" className="border-ok/40 text-[11px] text-ok">
        已启用
      </Badge>
    )
  return (
    <Badge variant="secondary" className="text-[11px]">
      未启用
    </Badge>
  )
}

const LINK_LABEL: Record<LinkState, string> = {
  linked: '已启用',
  absent: '未启用',
  broken: '失效软链',
  conflict: '被占用',
  native: '内置可用',
}

const LINK_STYLE: Record<LinkState, string> = {
  linked: 'text-ok',
  absent: 'text-muted-foreground/60',
  broken: 'text-warn',
  conflict: 'text-warn',
  native: 'text-muted-foreground/70',
}

function LinkRow({ skill, source }: { skill: Skill; source: SkillSource }): ReactElement | null {
  const link = skill.links[source]
  if (skill.kind === 'external' && skill.origin !== source) return null

  return (
    <div className="flex items-start gap-2 py-1.5">
      <AgentIcon agent={source} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px]">{SOURCE_LABEL[source]}</span>
          <span className={cn('text-[11px]', LINK_STYLE[link.state])}>
            {LINK_LABEL[link.state]}
          </span>
        </div>
        {link.path && (
          <p className="mt-0.5 font-mono text-[10.5px] break-all text-muted-foreground/60">
            {link.path}
          </p>
        )}
        {link.target && link.state !== 'linked' && (
          <p className="mt-0.5 font-mono text-[10.5px] break-all text-muted-foreground/60">
            → {link.target}
          </p>
        )}
      </div>
    </div>
  )
}

const KIND_META: Record<SkillFileKind, { label: string; icon: typeof File }> = {
  md: { label: 'Markdown', icon: FileText },
  script: { label: '脚本', icon: Terminal },
  asset: { label: '资源', icon: Image },
  other: { label: '其它', icon: File },
}

function formatValue(v: unknown): string {
  if (v == null) return '无'
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
      let dir = level.find(
        (n): n is Extract<TreeNode, { type: 'dir' }> => n.type === 'dir' && n.name === name,
      )
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
              <span
                className="flex min-w-0 items-center gap-1.5 font-mono text-muted-foreground"
                title={node.path}
              >
                <Icon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{node.name}</span>
              </span>
              <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                {formatBytes(node.file.size)}
              </span>
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
              <ChevronRight
                className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
              />
              {open ? (
                <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              ) : (
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              )}
              <span className="truncate font-mono">{node.name}</span>
            </button>
            {open && (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            )}
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
        <p className="text-[13px] text-muted-foreground/70">
          在列表中选择一项，这里会显示链接状态、路径、frontmatter 和文件。
        </p>
      </div>
    )
  }

  const fmEntries = Object.entries(skill.frontmatter)
  const brokenExternal =
    skill.kind === 'external' &&
    skill.origin !== null &&
    skill.links[skill.origin].state === 'broken'

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-mono text-[15px] leading-snug font-semibold break-all">
              {skill.name}
            </h2>
            <StatusBadge skill={skill} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {skill.kind === 'central' && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Link2 className="h-3 w-3" />
                中央仓库
              </Badge>
            )}
            {skill.kind === 'builtin' && <Badge variant="secondary">Codex 内置</Badge>}
            {skill.kind === 'external' && (
              <Badge variant="outline" className="gap-1 border-warn/50 text-[11px] text-warn">
                <Link2Off className="h-3 w-3" />
                未纳管
              </Badge>
            )}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {skill.description || '（无描述）'}
          </p>
        </div>

        {brokenExternal && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              符号链接失效
            </p>
          </div>
        )}

        {skill.kind !== 'external' && (
          <>
            <Separator />
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">启用状态</p>
              <div className="divide-y divide-border/50">
                {SKILL_SOURCES.map((source) => (
                  <LinkRow key={source} skill={skill} source={source} />
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            {skill.kind === 'central' ? '真身路径' : '所在路径'}
          </p>
          <dl className="space-y-1.5 text-[11.5px]">
            <div>
              <dt className="text-muted-foreground/70">目录</dt>
              <dd className="font-mono break-all text-muted-foreground">{skill.dirPath}</dd>
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
                  <dd className="font-mono break-all text-foreground/90" title={formatValue(v)}>
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
                      <FileTree
                        nodes={buildFileTree(list)}
                        depth={0}
                        collapsed={collapsed}
                        onToggle={toggleDir}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className={cn('pb-2 text-[10.5px] text-muted-foreground/60')}>
          {skill.mtime ? `更新于 ${formatRelativeTime(skill.mtime)}` : '更新时间未知'}
        </p>
      </div>
    </ScrollArea>
  )
}
