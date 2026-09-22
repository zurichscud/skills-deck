import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Ban, Check, X } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CopyDialog } from '@/features/skills/copy-dialog'
import { Dashboard } from '@/features/skills/dashboard'
import { DeleteDialog } from '@/features/skills/delete-dialog'
import { SettingsPage } from '@/features/skills/settings-page'
import { Sidebar, TitleBar } from '@/features/skills/sidebar'
import { SkillDetail } from '@/features/skills/skill-detail'
import { SkillTable } from '@/features/skills/skill-table'
import { ViewHeader } from '@/features/skills/view-header'
import {
  AGENT_SOURCES,
  filterSkills,
  useSkills,
  type StatusFilter,
  type View
} from '@/hooks/use-skills'
import type { AppInfo, AppSettings, ConflictStrategy, CopyResult, Skill, SkillSource } from '@shared/types'

type Theme = 'light' | 'dark'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'enabled', label: '启用中' },
  { key: 'disabled', label: '已停用' },
  { key: 'builtin', label: '内置' }
]

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem('skillsdeck.theme')
    return v === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export default function App(): ReactElement {
  const { skills, loading, reload, refresh } = useSkills()

  const [view, setView] = useState<View>({ kind: 'workspace', agent: 'opencode' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [copyTarget, setCopyTarget] = useState<Skill | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const lastViewRef = useRef<View>({ kind: 'workspace', agent: 'opencode' })
  const detailRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (view.kind !== 'settings') lastViewRef.current = view
  }, [view])

  useEffect(() => {
    void window.api.info().then(setInfo)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('skillsdeck.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = useMemo(() => filterSkills(skills, query, view, status), [skills, query, view, status])

  const counts = useMemo(() => {
    const bySource = { claude: 0, codex: 0, opencode: 0 } as Record<SkillSource, number>
    for (const s of skills) bySource[s.source] += 1
    const byAgent = { claude: 0, codex: 0, opencode: 0 } as Record<string, number>
    for (const agent of Object.keys(AGENT_SOURCES) as Array<keyof typeof AGENT_SOURCES>) {
      const set = AGENT_SOURCES[agent]
      byAgent[agent] = skills.filter((s) => set.includes(s.source)).length
    }
    return {
      all: skills.length,
      bySource,
      byAgent: byAgent as Record<'claude' | 'codex' | 'opencode', number>,
      enabled: skills.filter((s) => s.enabled && !s.builtin).length,
      disabled: skills.filter((s) => !s.enabled && !s.builtin).length,
      builtin: skills.filter((s) => s.builtin).length
    }
  }, [skills])

  const selected = useMemo(() => skills.find((s) => s.id === selectedId) ?? null, [skills, selectedId])

  const markPending = useCallback((ids: Iterable<string>, on: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  const setEnabled = useCallback(
    async (skill: Skill, next: boolean): Promise<void> => {
      markPending([skill.id], true)
      const result = await window.api.setEnabled(skill.id, next)
      markPending([skill.id], false)
      if (result.ok) toast.success(`${skill.name} 已${next ? '启用' : '停用'}`)
      else toast.error(`${skill.name}：${result.message}`)
      await reload()
    },
    [markPending, reload]
  )

  const batchSetEnabled = useCallback(
    async (next: boolean): Promise<void> => {
      const targets = skills.filter((s) => checkedIds.has(s.id) && !s.builtin && s.entryKind !== 'broken')
      if (targets.length === 0) {
        toast.info('所选 skill 均不可操作')
        return
      }
      markPending(
        targets.map((s) => s.id),
        true
      )
      let okCount = 0
      const errors: string[] = []
      for (const s of targets) {
        const r = await window.api.setEnabled(s.id, next)
        if (r.ok) okCount += 1
        else errors.push(`${s.name}: ${r.message}`)
      }
      markPending(
        targets.map((s) => s.id),
        false
      )
      if (okCount > 0) toast.success(`已${next ? '启用' : '停用'} ${okCount} 个 skill`)
      if (errors.length > 0) toast.error(errors.slice(0, 3).join('\n'))
      setCheckedIds(new Set())
      await reload()
    },
    [skills, checkedIds, markPending, reload]
  )

  const reveal = useCallback(async (skill: Skill): Promise<void> => {
    try {
      await window.api.revealInFinder(skill.id)
    } catch {
      toast.error('无法打开所在文件夹')
    }
  }, [])

  const confirmCopy = useCallback(
    async (skill: Skill, target: SkillSource, strategy: ConflictStrategy | 'ask'): Promise<CopyResult> => {
      const result = await window.api.copyTo(skill.id, target, strategy)
      if (result.ok) {
        const label = result.outcome === 'skipped' ? '已跳过' : result.outcome === 'overwritten' ? '已覆盖' : '已创建'
        toast.success(`复制完成：${result.targetName}（${label}）`)
      } else if (result.code !== 'CONFLICT' || strategy !== 'ask') {
        toast.error(result.message)
      }
      return result
    },
    []
  )

  const doRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refresh()
      setInfo(await window.api.info())
      toast.success('已重新扫描')
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const doDelete = useCallback(
    async (skill: Skill): Promise<void> => {
      setDeleteBusy(true)
      const result = await window.api.deleteSkill(skill.id)
      setDeleteBusy(false)
      if (result.ok) {
        toast.success(`已永久删除 ${skill.name}`)
        if (selectedId === skill.id) setSelectedId(null)
        setCheckedIds((prev) => {
          const next = new Set(prev)
          next.delete(skill.id)
          return next
        })
      } else {
        toast.error(`${skill.name}：${result.message}`)
      }
      setDeleteTarget(null)
      await reload()
    },
    [reload, selectedId]
  )

  const saveSettings = useCallback(
    async (next: AppSettings): Promise<boolean> => {
      const result = await window.api.saveSettings(next)
      if (result.ok) {
        toast.success('设置已保存')
        setInfo(await window.api.info())
        await reload()
        return true
      }
      toast.error(result.message)
      return false
    },
    [reload]
  )

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setCheckedIds((prev) => (prev.size >= visible.length ? new Set() : new Set(visible.map((s) => s.id))))
  }, [visible])

  const allChecked = visible.length > 0 && checkedIds.size >= visible.length
  const isDashboard = view.kind === 'dashboard'
  const isSettings = view.kind === 'settings'
  const showLocation = view.kind === 'workspace'

  useEffect(() => {
    if (isDashboard || isSettings) return
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (detailRef.current?.contains(target)) return
      if (target.closest('tbody tr')) return
      setSelectedId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isDashboard, isSettings])

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar view={view} onViewChange={setView} counts={counts} />

          <main className="flex min-w-0 flex-1 flex-col">
            {isDashboard ? (
              <Dashboard skills={skills} onJump={setView} />
            ) : isSettings ? (
              <SettingsPage onSave={saveSettings} onBack={() => setView(lastViewRef.current)} />
            ) : (
              <>
                <ViewHeader
                  view={view}
                  skills={skills}
                  info={info}
                  query={query}
                  onQueryChange={setQuery}
                  searchRef={searchRef}
                  refreshing={refreshing}
                  onRefresh={() => void doRefresh()}
                  onAdd={() => toast.info('功能暂未开发')}
                />

                {/* 固定高度工具条：始终占位，避免操作按钮出现/消失引起表格抖动 */}
                <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
                  {checkedIds.size > 0 ? (
                    <>
                      <span className="text-[12px] tabular-nums text-muted-foreground">已选 {checkedIds.size} 项</span>
                      <Separator orientation="vertical" className="h-4" />
                      <div className="ml-auto flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 border-emerald-500/45 text-[12px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:border-emerald-500/45 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                          onClick={() => void batchSetEnabled(true)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          启用
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 border-amber-500/45 text-[12px] text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:border-amber-500/45 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                          onClick={() => void batchSetEnabled(false)}
                        >
                          <Ban className="h-3.5 w-3.5" />
                          停用
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1.5 text-[12px] text-muted-foreground"
                          onClick={() => setCheckedIds(new Set())}
                        >
                          <X className="h-3.5 w-3.5" />
                          取消选择
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        {STATUS_TABS.map((t) => (
                          <Button
                            key={t.key}
                            size="sm"
                            variant={status === t.key ? 'secondary' : 'ghost'}
                            className="h-6 px-2 text-[12px]"
                            onClick={() => setStatus(t.key)}
                          >
                            {t.label}
                          </Button>
                        ))}
                      </div>
                      <span className="ml-auto text-[12px] tabular-nums text-muted-foreground/60">
                        {loading ? '加载中…' : `${visible.length} 条结果`}
                      </span>
                    </>
                  )}
                </div>

                <div className="min-h-0 flex-1">
                  <SkillTable
                    skills={visible}
                    loading={loading}
                    showLocation={showLocation}
                    selectedId={selectedId}
                    pendingIds={pendingIds}
                    checkedIds={checkedIds}
                    onToggleCheck={toggleCheck}
                    onToggleAll={toggleAll}
                    allChecked={allChecked}
                    onSelect={(s) => setSelectedId(s.id)}
                    onSetEnabled={(s, next) => void setEnabled(s, next)}
                    onCopyTo={(s) => setCopyTarget(s)}
                    onReveal={(s) => void reveal(s)}
                    onDelete={(s) => setDeleteTarget(s)}
                  />
                </div>
              </>
            )}
          </main>

          {!isDashboard && !isSettings && (
            <section ref={detailRef} className="flex w-[336px] shrink-0 flex-col border-l">
              <SkillDetail skill={selected} />
            </section>
          )}
        </div>

        {copyTarget && (
          <CopyDialog
            skill={copyTarget}
            onClose={() => setCopyTarget(null)}
            onConfirm={confirmCopy}
            onDone={() => void reload()}
          />
        )}

        <DeleteDialog
          skill={deleteTarget}
          busy={deleteBusy}
          onClose={() => setDeleteTarget(null)}
          onConfirm={(s) => void doDelete(s)}
        />

        <Toaster theme={theme} richColors closeButton position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}
