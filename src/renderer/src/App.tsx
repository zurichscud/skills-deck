import {
  DEFAULT_MENU_PREFS,
  SOURCE_LABEL,
  type AppInfo,
  type AppSettings,
  type Skill,
  type SkillSource,
} from '@shared/types'
import { Link2, Link2Off, Package, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { toast, Toaster } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Dashboard } from '@/features/skills/dashboard'
import { DeleteDialog } from '@/features/skills/delete-dialog'
import { InstallDialog } from '@/features/skills/install-dialog'
import { MigrationDialog } from '@/features/skills/migration-dialog'
import { SettingsPage } from '@/features/skills/settings-page'
import { Sidebar, TitleBar } from '@/features/skills/sidebar'
import { SkillDetail } from '@/features/skills/skill-detail'
import { SkillTable } from '@/features/skills/skill-table'
import { ViewHeader } from '@/features/skills/view-header'
import {
  AGENT_SOURCES,
  filterSkills,
  isActive,
  isCodexView,
  isLinkedInView,
  isListView,
  skillInView,
  useSkills,
  type AgentId,
  type ListView,
  type StatusFilter,
  type View,
} from '@/hooks/use-skills'

type Theme = 'light' | 'dark'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'linked', label: '启用' },
  { key: 'unlinked', label: '未启用' },
  { key: 'builtin', label: '内置' },
]

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']

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

  const [view, setView] = useState<View>({ kind: 'repository' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<Skill[]>([])
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [unmanaged, setUnmanaged] = useState<{ total: number; conflicts: number } | null>(null)
  const [unmanagedOpen, setUnmanagedOpen] = useState(false)
  const [adoptingAll, setAdoptingAll] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLElement>(null)

  const reloadInfo = useCallback(async (): Promise<void> => {
    setInfo(await window.api.info())
    setSettings(await window.api.getSettings())
  }, [])

  const reloadUnmanaged = useCallback(async (): Promise<void> => {
    try {
      const items = await window.api.unmanaged()
      setUnmanaged(
        items.length > 0
          ? { total: items.length, conflicts: items.filter((i) => i.conflict).length }
          : null,
      )
    } catch {
      setUnmanaged(null)
    }
  }, [])

  useEffect(() => {
    void window.api.info().then(setInfo)
    void window.api.getSettings().then(setSettings)
    void window.api
      .unmanaged()
      .then((items) =>
        setUnmanaged(
          items.length > 0
            ? { total: items.length, conflicts: items.filter((i) => i.conflict).length }
            : null,
        ),
      )
      .catch(() => setUnmanaged(null))
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

  const visible = useMemo(
    () => (isListView(view) ? filterSkills(skills, query, view, status) : []),
    [skills, query, view, status],
  )

  const counts = useMemo(() => {
    const central = skills.filter((s) => s.kind === 'central')
    const bySource = { claude: 0, codex: 0, opencode: 0 } as Record<SkillSource, number>
    for (const source of SOURCES) {
      bySource[source] = skills.filter((s) => skillInView(s, { kind: 'location', source })).length
    }
    const byAgent = { claude: 0, codex: 0, opencode: 0 } as Record<AgentId, number>
    for (const agent of Object.keys(AGENT_SOURCES) as AgentId[]) {
      byAgent[agent] = skills.filter((s) => skillInView(s, { kind: 'workspace', agent })).length
    }
    return {
      all: skills.length,
      central: central.length,
      external: skills.filter((s) => skillInView(s, { kind: 'unmanaged' })).length,
      bySource,
      byAgent,
      linked: central.filter(isActive).length,
      unlinked: central.filter((s) => !isActive(s)).length,
      builtin: skills.filter((s) => s.kind === 'builtin').length,
    }
  }, [skills])

  const selected = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  /** 各状态筛选按钮角标：视图 + 搜索词范围内计数，不随当前 status 变化 */
  const statusCounts = useMemo(() => {
    const base = isListView(view) ? filterSkills(skills, query, view, 'all') : []
    const noBuiltin = base.filter((s) => s.kind !== 'builtin')
    return {
      all: base.length,
      linked: noBuiltin.filter((s) => isLinkedInView(s, view)).length,
      unlinked: noBuiltin.filter((s) => !isLinkedInView(s, view)).length,
      builtin: base.filter((s) => s.kind === 'builtin').length,
    } as Record<StatusFilter, number>
  }, [skills, query, view])

  const markPending = useCallback((ids: Iterable<string>, on: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const toggleLink = useCallback(
    async (skill: Skill, source: SkillSource, next: boolean): Promise<void> => {
      markPending([skill.id], true)
      const result = next
        ? await window.api.link(skill.id, source)
        : await window.api.unlink(skill.id, source)
      markPending([skill.id], false)
      if (result.ok) {
        toast.success(`${skill.name} 已${next ? '链接到' : '取消链接'} ${SOURCE_LABEL[source]}`)
      } else {
        toast.error(`${skill.name}：${result.message}`)
      }
      await reload()
    },
    [markPending, reload],
  )

  const batchLink = useCallback(
    async (source: SkillSource, next: boolean): Promise<void> => {
      const targets = skills.filter((s) => checkedIds.has(s.id) && s.kind === 'central')
      if (targets.length === 0) {
        toast.info('所选条目中没有可链接的 skill')
        return
      }
      markPending(
        targets.map((s) => s.id),
        true,
      )
      let okCount = 0
      const errors: string[] = []
      for (const s of targets) {
        const r = next ? await window.api.link(s.id, source) : await window.api.unlink(s.id, source)
        if (r.ok) okCount += 1
        else errors.push(`${s.name}: ${r.message}`)
      }
      markPending(
        targets.map((s) => s.id),
        false,
      )
      if (okCount > 0) {
        toast.success(
          `${okCount} 个 skill 已${next ? '链接到' : '取消链接'} ${SOURCE_LABEL[source]}`,
        )
      }
      if (errors.length > 0) toast.error(errors.slice(0, 3).join('\n'))
      setCheckedIds(new Set())
      await reload()
    },
    [skills, checkedIds, markPending, reload],
  )

  const doImport = useCallback(
    async (skill?: Skill): Promise<void> => {
      const result = await window.api.importSkill(skill?.dirPath)
      if (result.ok) toast.success(`已导入中央仓库：${result.name}`)
      else if (result.message !== '已取消') toast.error(result.message)
      await reload()
      await reloadUnmanaged()
    },
    [reload, reloadUnmanaged],
  )

  /** 一键导入：无冲突的直接纳入，同名冲突留给用户逐个决定 */
  const doAdoptAll = useCallback(async (): Promise<void> => {
    setAdoptingAll(true)
    try {
      const result = await window.api.adoptAllUnmanaged()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (result.adopted > 0) toast.success(`已纳入中央仓库 ${result.adopted} 个 skill`)
      if (result.failed > 0) toast.error(`${result.failed} 个条目纳入失败，请逐个处理`)
      if (result.conflicts > 0) {
        toast.info(`${result.conflicts} 个同名冲突需要你决定`)
        setUnmanagedOpen(true)
      }
      await reload()
      await reloadUnmanaged()
    } finally {
      setAdoptingAll(false)
    }
  }, [reload, reloadUnmanaged])

  /** 选中若干未纳管条目后批量纳入中央仓库 */
  const doAdoptSelected = useCallback(
    async (targets: Skill[]): Promise<void> => {
      if (targets.length === 0) return
      setAdoptingAll(true)
      try {
        const result = await window.api.adoptManyUnmanaged(targets.map((s) => s.id))
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        if (result.adopted > 0) toast.success(`已纳入中央仓库 ${result.adopted} 个 skill`)
        if (result.failed > 0) toast.error(`${result.failed} 个条目纳入失败，请逐个处理`)
        if (result.conflicts > 0) {
          toast.info(`${result.conflicts} 个同名冲突需要你决定`)
          setUnmanagedOpen(true)
        }
        setCheckedIds(new Set())
        await reload()
        await reloadUnmanaged()
      } finally {
        setAdoptingAll(false)
      }
    },
    [reload, reloadUnmanaged],
  )

  const reveal = useCallback(async (skill: Skill): Promise<void> => {
    try {
      await window.api.revealInFinder(skill.id)
    } catch {
      toast.error('无法打开所在文件夹')
    }
  }, [])

  const openPath = useCallback(async (target: 'central' | SkillSource): Promise<void> => {
    const result = await window.api.openPath(target)
    if (!result.ok) toast.error(result.message)
  }, [])

  const doRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refresh()
      await reloadInfo()
      await reloadUnmanaged()
      toast.success('已重新扫描')
    } finally {
      setRefreshing(false)
    }
  }, [refresh, reloadInfo, reloadUnmanaged])

  const doDelete = useCallback(
    async (targets: Skill[]): Promise<void> => {
      setDeleteBusy(true)
      let okCount = 0
      const errors: string[] = []
      for (const skill of targets) {
        const result = await window.api.deleteSkill(skill.id)
        if (result.ok) okCount += 1
        else errors.push(`${skill.name}：${result.message}`)
      }
      setDeleteBusy(false)
      if (okCount > 0) toast.success(`已永久删除 ${okCount} 个 skill`)
      if (errors.length > 0) toast.error(errors.slice(0, 3).join('\n'))
      if (selectedId !== null && targets.some((s) => s.id === selectedId)) setSelectedId(null)
      setCheckedIds((prev) => {
        const next = new Set(prev)
        for (const s of targets) next.delete(s.id)
        return next
      })
      setDeleteTargets([])
      await reload()
      await reloadUnmanaged()
    },
    [reload, reloadUnmanaged, selectedId],
  )

  /** 设置页自动保存：成功静默，失败提示 */
  const saveSettings = useCallback(
    async (next: AppSettings): Promise<boolean> => {
      const result = await window.api.saveSettings(next)
      if (result.ok) {
        setSettings(next)
        await reloadInfo()
        await reload()
        await reloadUnmanaged()
        return true
      }
      toast.error(result.message)
      return false
    },
    [reload, reloadInfo, reloadUnmanaged],
  )

  /** 切换菜单：清空搜索词、状态筛选与选中项，避免带着上一个视图的上下文进入新视图 */
  const changeView = useCallback((next: View) => {
    setView(next)
    setQuery('')
    setStatus('all')
    setCheckedIds(new Set())
  }, [])

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setCheckedIds((prev) =>
      prev.size >= visible.length ? new Set() : new Set(visible.map((s) => s.id)),
    )
  }, [visible])

  const allChecked = visible.length > 0 && checkedIds.size >= visible.length
  const isDashboard = view.kind === 'dashboard'
  const isSettings = view.kind === 'settings'
  const listView: ListView | null = isListView(view) ? view : null

  /** 选中且确实在当前视图里的条目（避免切换视图后残留的选择被误操作） */
  const checkedInView = useMemo(
    () => (listView ? skills.filter((s) => checkedIds.has(s.id) && skillInView(s, listView)) : []),
    [skills, checkedIds, listView],
  )

  // 「内置」仅 Codex 视图可用（内置 skill 只来自 codex/.system）；未纳管视图里全是未纳管条目，不需要状态筛选
  const statusTabs = useMemo(
    () =>
      view.kind === 'unmanaged'
        ? []
        : isCodexView(view)
          ? STATUS_TABS
          : STATUS_TABS.filter((t) => t.key !== 'builtin'),
    [view],
  )

  useEffect(() => {
    if (!listView) return
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (detailRef.current?.contains(target)) return
      if (target.closest('tbody tr')) return
      setSelectedId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [listView])

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            view={view}
            onViewChange={changeView}
            menu={settings?.menu ?? DEFAULT_MENU_PREFS}
            counts={counts}
          />

          <main className="flex min-w-0 flex-1 flex-col">
            {isDashboard ? (
              <Dashboard
                skills={skills}
                onJump={changeView}
                onImport={(mode) => (mode === 'local' ? void doImport() : setInstallOpen(true))}
                unmanaged={
                  unmanaged
                    ? {
                        total: unmanaged.total,
                        conflicts: unmanaged.conflicts,
                        busy: adoptingAll,
                        onOpen: () => setUnmanagedOpen(true),
                        onAdoptAll: () => void doAdoptAll(),
                      }
                    : null
                }
              />
            ) : isSettings ? (
              <SettingsPage
                onSave={saveSettings}
                version={info?.version}
                info={info}
                unmanaged={unmanaged}
                onOpenUnmanaged={() => setUnmanagedOpen(true)}
              />
            ) : listView ? (
              <>
                <ViewHeader
                  view={listView}
                  skills={skills}
                  info={info}
                  query={query}
                  onQueryChange={setQuery}
                  searchRef={searchRef}
                  refreshing={refreshing}
                  onRefresh={() => void doRefresh()}
                  onImport={(mode) => (mode === 'local' ? void doImport() : setInstallOpen(true))}
                  onOpenLocation={() => {
                    if (listView.kind === 'unmanaged') return
                    void openPath(
                      listView.kind === 'repository'
                        ? 'central'
                        : listView.kind === 'location'
                          ? listView.source
                          : listView.agent,
                    )
                  }}
                />

                {/* 固定高度工具条：始终占位，避免操作按钮出现/消失引起表格抖动 */}
                <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
                  {checkedIds.size > 0 ? (
                    <>
                      <span className="text-[12px] text-muted-foreground">
                        已选 <span className="font-mono tabular-nums">{checkedIds.size}</span> 项
                      </span>
                      <Separator orientation="vertical" className="h-4" />
                      <div className="ml-auto flex items-center gap-2">
                        {/* 未纳管条目无法直接链接，该视图只提供「纳入管理 / 删除」 */}
                        {listView.kind === 'unmanaged' ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 gap-1.5 text-[12px]"
                              disabled={adoptingAll}
                              onClick={() => void doAdoptSelected(checkedInView)}
                            >
                              <Package className="h-3.5 w-3.5" />
                              纳入管理
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 border-destructive/40 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleteTargets(checkedInView)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </Button>
                            <Separator orientation="vertical" className="h-4" />
                          </>
                        ) : (
                          <>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1.5 border-ok/40 text-[12px] text-ok hover:bg-ok/10 hover:text-ok dark:border-ok/40 dark:hover:bg-ok/10"
                                >
                                  <Link2 className="h-3.5 w-3.5" />
                                  链接到…
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-[13px]">
                                {SOURCES.map((source) => (
                                  <DropdownMenuItem
                                    key={source}
                                    onSelect={() => void batchLink(source, true)}
                                  >
                                    链接到 {SOURCE_LABEL[source]}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1.5 text-[12px] text-muted-foreground"
                                >
                                  <Link2Off className="h-3.5 w-3.5" />
                                  取消链接
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-[13px]">
                                {SOURCES.map((source) => (
                                  <DropdownMenuItem
                                    key={source}
                                    onSelect={() => void batchLink(source, false)}
                                  >
                                    取消 {SOURCE_LABEL[source]} 的链接
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <Separator orientation="vertical" className="h-4" />
                          </>
                        )}

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
                        {statusTabs.map((t) => (
                          <Button
                            key={t.key}
                            size="sm"
                            variant={status === t.key ? 'secondary' : 'ghost'}
                            className="h-6 gap-1.5 px-2 text-[12px] transition-none active:scale-100"
                            onClick={() => setStatus(t.key)}
                          >
                            {t.label}
                            <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                              {statusCounts[t.key]}
                            </span>
                          </Button>
                        ))}
                      </div>
                      <span className="ml-auto font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">
                        {loading ? '加载中…' : `${visible.length} 条结果`}
                      </span>
                    </>
                  )}
                </div>

                <div className="min-h-0 flex-1">
                  <SkillTable
                    skills={visible}
                    view={listView}
                    loading={loading}
                    filtered={query.trim() !== '' || status !== 'all'}
                    selectedId={selectedId}
                    pendingIds={pendingIds}
                    checkedIds={checkedIds}
                    onToggleCheck={toggleCheck}
                    onToggleAll={toggleAll}
                    allChecked={allChecked}
                    onSelect={(s) => setSelectedId(s.id)}
                    onToggleLink={(s, source, next) => void toggleLink(s, source, next)}
                    onAdopt={() => setUnmanagedOpen(true)}
                    onReveal={(s) => void reveal(s)}
                    onDelete={(s) => setDeleteTargets([s])}
                  />
                </div>
              </>
            ) : null}
          </main>

          {listView && (
            <section
              ref={detailRef}
              className="flex w-[336px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar"
            >
              <SkillDetail key={selected?.id ?? 'empty'} skill={selected} />
            </section>
          )}
        </div>

        <MigrationDialog
          open={unmanagedOpen}
          onClose={() => setUnmanagedOpen(false)}
          onChanged={() => {
            void reloadUnmanaged()
            void reload()
          }}
        />

        <DeleteDialog
          skills={deleteTargets}
          busy={deleteBusy}
          onClose={() => setDeleteTargets([])}
          onConfirm={(targets) => void doDelete(targets)}
        />

        <InstallDialog
          open={installOpen}
          onClose={() => setInstallOpen(false)}
          onChanged={() => {
            void reload()
            void reloadUnmanaged()
          }}
        />

        <Toaster theme={theme} richColors closeButton position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}
