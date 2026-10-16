import {
  DEFAULT_MENU_PREFS,
  SKILL_SOURCES,
  SOURCE_LABEL,
  type AppInfo,
  type AppSettings,
  type Skill,
  type SkillSource,
} from '@shared/types'
import { Link2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { toast, Toaster } from 'sonner'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Dashboard } from '@/features/skills/dashboard'
import { DeleteDialog } from '@/features/skills/delete-dialog'
import { LinkDialog } from '@/features/skills/link-dialog'
import { SettingsPage } from '@/features/skills/settings-page'
import { Sidebar, TitleBar } from '@/features/skills/sidebar'
import { SkillDetail } from '@/features/skills/skill-detail'
import { SkillTable } from '@/features/skills/skill-table'
import { TrashPage } from '@/features/skills/trash-page'
import { ViewHeader } from '@/features/skills/view-header'
import {
  AGENT_IDS,
  filterSkills,
  isCodexView,
  isListView,
  skillInView,
  useSkills,
  type AgentId,
  type ListView,
  type StatusFilter,
  type View,
} from '@/hooks/use-skills'

type Theme = 'light' | 'dark'

/** 状态筛选只剩「内置」这个维度；可用与否由行内图标表达 */
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'builtin', label: '内置' },
]

/** 主题切换时抑制全局过渡，避免颜色一齐渐变造成「涂抹」 */
function suppressThemeTransitions(): void {
  const style = document.createElement('style')
  style.append(document.createTextNode('*,*::before,*::after{transition:none !important}'))
  document.head.append(style)
  // 强制同步 reflow，让新主题在 override 生效期间提交
  void document.body.offsetHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => style.remove())
  })
}

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

  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<Skill[]>([])
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [linkTargets, setLinkTargets] = useState<Skill[]>([])
  const [trashCount, setTrashCount] = useState(0)
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLElement>(null)

  const reloadInfo = useCallback(async (): Promise<void> => {
    setInfo(await window.api.info())
    setSettings(await window.api.getSettings())
  }, [])

  const reloadTrash = useCallback(async (): Promise<void> => {
    try {
      setTrashCount((await window.api.trash()).length)
    } catch {
      setTrashCount(0)
    }
  }, [])

  useEffect(() => {
    void window.api.info().then(setInfo)
    void window.api.getSettings().then(setSettings)
    // 回收站的写操作同样会广播变更，这里保持条目数同步
    const syncTrash = (): void => {
      void window.api
        .trash()
        .then((items) => setTrashCount(items.length))
        .catch(() => setTrashCount(0))
    }
    syncTrash()
    return window.api.onChanged(syncTrash)
  }, [])

  useEffect(() => {
    suppressThemeTransitions()
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
      // 弹窗自己处理 Escape（Radix 会 preventDefault），不在此清掉选中项
      if (e.key === 'Escape' && !e.defaultPrevented) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = useMemo(
    () => (isListView(view) ? filterSkills(skills, query, view, status) : []),
    [skills, query, view, status],
  )

  const counts = useMemo(() => {
    const realSkills = skills.filter((s) => s.kind === 'skill')
    const bySource = {} as Record<SkillSource, number>
    for (const source of SKILL_SOURCES) {
      bySource[source] = skills.filter((s) => skillInView(s, { kind: 'location', source })).length
    }
    const byAgent = {} as Record<AgentId, number>
    for (const agent of AGENT_IDS) {
      byAgent[agent] = skills.filter((s) => skillInView(s, { kind: 'workspace', agent })).length
    }
    return { all: realSkills.length, bySource, byAgent, trashCount }
  }, [skills, trashCount])

  const selected = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  /** 各状态筛选按钮角标：视图 + 搜索词范围内计数，不随当前 status 变化 */
  const statusCounts = useMemo(() => {
    const base = isListView(view) ? filterSkills(skills, query, view, 'all') : []
    return {
      all: base.length,
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

  const reveal = useCallback(async (skill: Skill): Promise<void> => {
    try {
      await window.api.revealInFinder(skill.id)
    } catch {
      toast.error('无法打开所在文件夹')
    }
  }, [])

  const openLocation = useCallback(async (source: SkillSource): Promise<void> => {
    const result = await window.api.openPath(source)
    if (!result.ok) toast.error(`${SOURCE_LABEL[source]}：${result.message}`)
  }, [])

  const doRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refresh()
      await reloadInfo()
      await reloadTrash()
      toast.success('已重新扫描')
    } finally {
      setRefreshing(false)
    }
  }, [refresh, reloadInfo, reloadTrash])

  /** 删除 = 把该 skill 在各存储位置的条目一起移入回收站 */
  const doDelete = useCallback(
    async (targets: Skill[]): Promise<void> => {
      if (targets.length === 0) return
      setDeleteBusy(true)
      markPending(
        targets.map((s) => s.id),
        true,
      )
      let okCount = 0
      const errors: string[] = []
      for (const skill of targets) {
        const result = await window.api.deleteSkill(skill.id)
        if (result.ok) okCount += 1
        else errors.push(`${skill.name}：${result.message}`)
      }
      markPending(
        targets.map((s) => s.id),
        false,
      )
      setDeleteBusy(false)
      if (okCount > 0) toast.success(`已移入回收站：${okCount} 个 skill`)
      if (errors.length > 0) toast.error(errors.slice(0, 3).join('\n'))
      if (selectedId !== null && targets.some((s) => s.id === selectedId)) setSelectedId(null)
      setCheckedIds((prev) => {
        const next = new Set(prev)
        for (const s of targets) next.delete(s.id)
        return next
      })
      setDeleteTargets([])
      await reload()
      await reloadTrash()
    },
    [markPending, reload, reloadTrash, selectedId],
  )

  /** 设置页自动保存：成功静默，失败提示 */
  const saveSettings = useCallback(
    async (next: AppSettings): Promise<boolean> => {
      const result = await window.api.saveSettings(next)
      if (result.ok) {
        setSettings(next)
        await reloadInfo()
        await reload()
        return true
      }
      toast.error(result.message)
      return false
    },
    [reload, reloadInfo],
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

  /** 勾选项里可操作的条目：内置 skill 既不能链接也不能删除，只能查看 */
  const actionableChecked = useMemo(
    () => checkedInView.filter((s) => s.kind === 'skill'),
    [checkedInView],
  )
  const builtinChecked = checkedInView.length - actionableChecked.length

  /** 打开链接对话框：只对可链接的 skill 生效 */
  const openLinkDialog = useCallback((targets: Skill[]): void => {
    setLinkTargets(targets.filter((s) => s.kind === 'skill'))
  }, [])

  /** 回收站里的条目变化后：刷新列表与回收站计数 */
  const afterChange = useCallback((): void => {
    void reload()
    void reloadTrash()
  }, [reload, reloadTrash])

  // 「内置」只来自 codex/.system，该筛选仅在 Codex 视图显示
  const statusTabs = useMemo(
    () => (isCodexView(view) ? STATUS_TABS : STATUS_TABS.filter((t) => t.key !== 'builtin')),
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
          onThemeToggle={() => {
            suppressThemeTransitions()
            setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
          }}
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
              <Dashboard skills={skills} onJump={changeView} trashCount={trashCount} />
            ) : view.kind === 'trash' ? (
              <TrashPage onChanged={afterChange} />
            ) : isSettings ? (
              <SettingsPage onSave={saveSettings} version={info?.version} info={info} />
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
                  onOpenLocation={(source) => void openLocation(source)}
                />

                {/* 固定高度工具条：始终占位，避免操作按钮出现/消失引起表格抖动 */}
                <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
                  {checkedIds.size > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        已选 <span className="font-mono tabular-nums">{checkedIds.size}</span> 项
                      </span>
                      {builtinChecked > 0 && (
                        <span className="text-2xs text-muted-foreground">
                          （其中 {builtinChecked} 个内置不可操作）
                        </span>
                      )}
                      <Separator orientation="vertical" className="h-4" />
                      <div className="ms-auto flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          static
                          className="h-7 gap-1.5 border-ok/40 text-xs text-ok hover:bg-ok/10 hover:text-ok"
                          disabled={actionableChecked.length === 0}
                          onClick={() => openLinkDialog(actionableChecked)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          链接…
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          static
                          className="h-7 gap-1.5 border-destructive/40 text-xs text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                          disabled={actionableChecked.length === 0}
                          onClick={() => setDeleteTargets(actionableChecked)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                        <Separator orientation="vertical" className="h-4" />
                        <Button
                          size="sm"
                          variant="ghost"
                          static
                          className="h-7 gap-1.5 text-xs text-muted-foreground"
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
                            static
                            className="h-6 gap-1.5 px-2 text-xs"
                            onClick={() => setStatus(t.key)}
                          >
                            {t.label}
                            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                              {statusCounts[t.key]}
                            </span>
                          </Button>
                        ))}
                      </div>
                      <span className="ms-auto font-mono text-2xs text-muted-foreground tabular-nums">
                        {loading ? '加载中…' : `${visible.length} 条结果`}
                      </span>
                    </>
                  )}
                </div>

                <div className="min-h-0 flex-1">
                  <SkillTable
                    skills={visible}
                    loading={loading}
                    filtered={query.trim() !== '' || status !== 'all'}
                    selectedId={selectedId}
                    pendingIds={pendingIds}
                    checkedIds={checkedIds}
                    onToggleCheck={toggleCheck}
                    onToggleAll={toggleAll}
                    allChecked={allChecked}
                    onSelect={(s) => setSelectedId(s.id)}
                    onLink={(s) => openLinkDialog([s])}
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
              className="flex w-[336px] shrink-0 flex-col border-s border-sidebar-border bg-sidebar"
            >
              <SkillDetail key={selected?.id ?? 'empty'} skill={selected} />
            </section>
          )}
        </div>

        <LinkDialog
          open={linkTargets.length > 0}
          skills={linkTargets}
          onClose={() => setLinkTargets([])}
          onChanged={() => {
            setCheckedIds(new Set())
            afterChange()
          }}
        />

        <DeleteDialog
          skills={deleteTargets}
          busy={deleteBusy}
          onClose={() => setDeleteTargets([])}
          onConfirm={(targets) => void doDelete(targets)}
        />

        <Toaster theme={theme} richColors closeButton position="bottom-right" />
      </div>
    </TooltipProvider>
  )
}
