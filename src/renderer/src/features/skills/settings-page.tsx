import {
  CLOSE_BEHAVIOR_LABEL,
  SOURCE_LABEL,
  type AppInfo,
  type AppSettings,
  type CloseBehavior,
  type MenuPrefs,
  type SkillSource,
} from '@shared/types'
import { FolderOpen, GitBranch, Package, Settings, Sparkles } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { MenuEditor } from '@/features/skills/menu-editor'
import { cn } from '@/lib/utils'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const BEHAVIORS: CloseBehavior[] = ['ask', 'tray', 'quit']

export interface SettingsPageProps {
  onSave: (next: AppSettings) => Promise<boolean>
  version?: string
  info: AppInfo | null
  unmanaged: { total: number; conflicts: number } | null
  onOpenUnmanaged: () => void
}

export function SettingsPage({
  onSave,
  version,
  info,
  unmanaged,
  onOpenUnmanaged,
}: SettingsPageProps): ReactElement {
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const savedRef = useRef<AppSettings | null>(null)

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      savedRef.current = s
      setDraft(s)
    })
  }, [])

  const commit = useCallback(
    async (next: AppSettings): Promise<void> => {
      const ok = await onSave(next)
      if (ok) savedRef.current = next
    },
    [onSave],
  )

  /** 路径输入在失焦或回车时落盘，避免逐字符保存触发频繁重扫 */
  const commitPath = useCallback((): void => {
    if (!draft || draft === savedRef.current) return
    void commit(draft)
  }, [draft, commit])

  const setPath = (key: 'centralRoot' | SkillSource, value: string): void => {
    setDraft((prev) =>
      !prev
        ? prev
        : key === 'centralRoot'
          ? { ...prev, centralRoot: value }
          : { ...prev, sourceRoots: { ...prev.sourceRoots, [key]: value } },
    )
  }

  const pick = async (key: 'centralRoot' | SkillSource): Promise<void> => {
    const dir = await window.api.pickDirectory()
    if (!dir || !draft) return
    const next =
      key === 'centralRoot'
        ? { ...draft, centralRoot: dir }
        : { ...draft, sourceRoots: { ...draft.sourceRoots, [key]: dir } }
    setDraft(next)
    void commit(next)
  }

  const chooseBehavior = (behavior: CloseBehavior): void => {
    if (!draft || draft.closeBehavior === behavior) return
    const next = { ...draft, closeBehavior: behavior }
    setDraft(next)
    void commit(next)
  }

  const changeMenu = (menu: MenuPrefs): void => {
    if (!draft) return
    const next = { ...draft, menu }
    setDraft(next)
    void commit(next)
  }

  const pathRow = (
    key: 'centralRoot' | SkillSource,
    label: string,
    value: string,
    icon?: SkillSource | 'central',
  ): ReactElement => (
    <div key={key} className="grid grid-cols-[112px_1fr_auto] items-center gap-2">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon === 'central' ? (
          <Package className="h-3.5 w-3.5" />
        ) : icon ? (
          <AgentIcon agent={icon} className="h-3.5 w-3.5" />
        ) : null}
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => setPath(key, e.target.value)}
        onBlur={commitPath}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitPath()
        }}
        className="h-8 font-mono text-2xs"
        spellCheck={false}
        aria-label={label}
        title={value}
      />
      <Button
        variant="outline"
        size="icon"
        static
        className="h-8 w-8 shrink-0"
        onClick={() => void pick(key)}
        aria-label={`选择${label}目录`}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full flex-col">
        <div className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Settings className="h-4 w-4" />
              </span>
              <h1 className="truncate text-xl font-semibold tracking-tight">设置</h1>
              {version && (
                <span className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
                  v{version}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              修改即自动保存并立即生效；调整仓库地址后会重新扫描。
            </p>
          </div>
        </div>

        {!draft ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium text-muted-foreground">中央仓库</h2>
                {info && (
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <GitBranch className="h-3 w-3" />
                    {info.git.available ? (
                      info.git.lastCommit ? (
                        <span className="font-mono">{info.git.lastCommit}</span>
                      ) : (
                        'git 已就绪，暂无提交'
                      )
                    ) : (
                      <span className="text-warn">未检测到 git，改动不会自动提交</span>
                    )}
                  </span>
                )}
              </div>
              {pathRow('centralRoot', '真身目录', draft.centralRoot, 'central')}
              <p className="text-2xs text-muted-foreground">
                所有 skill 的唯一真身都存放在这里，并由 git
                记录每次结构变更；各存储位置只放指向它的软链。
              </p>
            </section>

            <Separator />

            <section className="grid gap-3">
              <h2 className="text-xs font-medium text-muted-foreground">存储位置</h2>
              {SOURCES.map((s) => pathRow(s, SOURCE_LABEL[s], draft.sourceRoots[s], s))}
              <p className="text-2xs text-muted-foreground">
                各 agent 读取 skill
                的全局目录；启用即在此创建软链，停用即删除软链，真身始终留在中央仓库。
              </p>
            </section>

            <Separator />

            <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-3.5 w-3.5" />
                  未纳管的 skill
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {unmanaged
                    ? `三个存储位置里有 ${unmanaged.total} 个 skill 尚未纳入中央仓库${
                        unmanaged.conflicts > 0
                          ? `，其中 ${unmanaged.conflicts} 个同名需你决定`
                          : ''
                      }。`
                    : '三个存储位置里的 skill 都已在中央仓库管理之下。'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                static
                className="h-8 text-xs"
                onClick={onOpenUnmanaged}
              >
                查看未纳管
              </Button>
            </section>

            <Separator />

            <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">关闭行为</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  选择点击窗口关闭按钮后的应用行为。
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="关闭行为"
                className="flex shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5"
              >
                {BEHAVIORS.map((b) => {
                  const active = draft.closeBehavior === b
                  return (
                    <label
                      key={b}
                      className={cn(
                        'cursor-pointer rounded-sm px-3 py-1.5 text-xs transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                        active
                          ? 'bg-secondary font-medium text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <input
                        type="radio"
                        name="close-behavior"
                        value={b}
                        checked={active}
                        onChange={() => chooseBehavior(b)}
                        className="sr-only"
                      />
                      {CLOSE_BEHAVIOR_LABEL[b]}
                    </label>
                  )
                })}
              </div>
            </section>

            <Separator />

            <section className="grid gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">菜单</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  调整侧边栏菜单的显示与顺序；隐藏的菜单不会出现在侧边栏。
                </p>
              </div>
              <MenuEditor menu={draft.menu} onChange={changeMenu} />
            </section>

            {info && (
              <p className="pb-2 font-mono text-2xs text-muted-foreground">
                配置目录 {info.managedRoot}
              </p>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
