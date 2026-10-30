import {
  CLOSE_BEHAVIOR_LABEL,
  SKILL_SOURCES,
  SOURCE_LABEL,
  type AppInfo,
  type AppSettings,
  type CloseBehavior,
  type MenuPrefs,
  type SkillSource,
} from '@shared/types'
import { FolderOpen, Settings } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { MenuEditor } from '@/features/skills/menu-editor'
import { cn } from '@/lib/utils'

const BEHAVIORS: CloseBehavior[] = ['ask', 'tray', 'quit']

export interface SettingsPageProps {
  onSave: (next: AppSettings) => Promise<boolean>
  version?: string
  info: AppInfo | null
}

export function SettingsPage({ onSave, version, info }: SettingsPageProps): ReactElement {
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

  const setPath = (key: SkillSource, value: string): void => {
    setDraft((prev) =>
      !prev ? prev : { ...prev, sourceRoots: { ...prev.sourceRoots, [key]: value } },
    )
  }

  const pick = async (key: SkillSource): Promise<void> => {
    const dir = await window.api.pickDirectory(key)
    if (!dir || !draft) return
    const next = { ...draft, sourceRoots: { ...draft.sourceRoots, [key]: dir } }
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

  const pathRow = (key: SkillSource, label: string, value: string): ReactElement => (
    <div key={key} className="grid grid-cols-[112px_1fr_auto] items-center gap-2">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AgentIcon agent={key} className="h-3.5 w-3.5" />
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
              修改即自动保存并立即生效；调整存储位置后会重新扫描。
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
              <h2 className="text-xs font-medium text-muted-foreground">存储位置</h2>
              {SKILL_SOURCES.map((s) => pathRow(s, SOURCE_LABEL[s], draft.sourceRoots[s]))}
              <p className="text-2xs text-muted-foreground">
                skill 内容就存放在这些位置里；链接只是在勾选的位置建立一个指向内容的软链，
                取消勾选即删掉软链，内容本身不受影响。
              </p>
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
              <div className="grid gap-0.5 pb-2 font-mono text-2xs text-muted-foreground">
                <p>配置目录 {info.managedRoot}</p>
                <p>回收站目录 {info.trashRoot}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
