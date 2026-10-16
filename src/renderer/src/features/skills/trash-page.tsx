import { SOURCE_LABEL, type ActionResult, type AppInfo, type TrashItem } from '@shared/types'
import { FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatBytes } from '@/lib/utils'

export interface TrashPageProps {
  onChanged: () => void
}

/** 需要二次确认的动作：彻底删除单条，或清空整个回收站 */
type Confirming = { kind: 'purge'; item: TrashItem } | { kind: 'empty' }

/** 索引损坏（缺少原位置信息）的条目只能彻底删除 */
function isOrphan(item: TrashItem): boolean {
  return item.origin === null || item.sourcePath === null
}

function timeText(deletedAt: number | null): string {
  if (deletedAt === null) return '—'
  return new Date(deletedAt).toLocaleString('zh-CN', { hour12: false })
}

export function TrashPage({ onChanged }: TrashPageProps): ReactElement {
  const [items, setItems] = useState<TrashItem[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [emptying, setEmptying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)

  const load = async (): Promise<void> => {
    try {
      setItems(await window.api.trash())
    } catch (err) {
      setError(`读取回收站失败：${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    window.api
      .trash()
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((err: unknown) => {
        if (alive) setError(`读取回收站失败：${(err as Error).message}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    window.api
      .info()
      .then((next) => {
        if (alive) setInfo(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  /** 逐条操作：进度的行禁用、失败信息就地提示，成功后重新拉取清单 */
  async function runItem(item: TrashItem, op: () => Promise<ActionResult>): Promise<void> {
    setPendingIds((prev) => new Set(prev).add(item.id))
    setError(null)
    try {
      const result = await op()
      if (!result.ok) {
        setError(
          result.conflictAt
            ? `${result.message}（${result.conflictAt}）`
            : `${item.name}：${result.message}`,
        )
      }
    } catch (err) {
      setError(`${item.name}：${(err as Error).message}`)
    } finally {
      setPendingIds((prev) => {
        const rest = new Set(prev)
        rest.delete(item.id)
        return rest
      })
    }
    await load()
    onChanged()
  }

  async function empty(): Promise<void> {
    setEmptying(true)
    setError(null)
    try {
      const result = await window.api.emptyTrash()
      if (!result.ok) setError(result.message)
    } catch (err) {
      setError(`清空失败：${(err as Error).message}`)
    } finally {
      setEmptying(false)
    }
    await load()
    onChanged()
  }

  const subtitle = info
    ? `${items.length} 个条目 · ${info.trashRoot}`
    : '删除的 skill 会先移到这里，可以恢复或彻底删除'

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Trash2 className="h-4 w-4" />
            </span>
            <h1 className="truncate text-xl font-semibold tracking-tight">回收站</h1>
          </div>
          <p className="mt-1 truncate font-mono text-2xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            static
            className="h-9 gap-1.5 px-3 text-sm"
            disabled={items.length === 0 || emptying}
            onClick={() => setConfirming({ kind: 'empty' })}
            title="彻底删除回收站里的全部条目"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {emptying ? '清空中…' : '清空回收站'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive-text">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm font-medium">回收站是空的</p>
          <p className="text-sm text-muted-foreground">
            删除的 skill 会先移到这里，之后可以恢复或彻底删除。
          </p>
        </div>
      ) : (
        <div className="h-full overflow-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-left text-2xs font-medium text-muted-foreground">
                <th className="w-[200px] px-3 py-2">名称</th>
                <th className="w-[76px] px-2 py-2">类型</th>
                <th className="w-[120px] px-2 py-2">原位置</th>
                <th className="w-[160px] px-2 py-2">删除时间</th>
                <th className="w-[80px] px-2 py-2">大小</th>
                <th className="w-[112px] px-2 py-2 text-right">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const pending = pendingIds.has(item.id)
                const orphan = isOrphan(item)
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      'border-b border-border/60 transition-colors hover:bg-accent/50',
                      pending && 'opacity-60',
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs" title={item.relDir}>
                          {item.name}
                        </span>
                        {orphan && (
                          <span
                            className="shrink-0 text-2xs text-warn"
                            title="缺少原位置信息，只能彻底删除"
                          >
                            索引损坏
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {item.kind === 'dir' ? '目录' : '软链'}
                    </td>
                    <td className="px-2 py-2">
                      {item.origin ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <AgentIcon agent={item.origin} className="h-3.5 w-3.5" />
                          <span className="truncate">{SOURCE_LABEL[item.origin]}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">来源未知</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{timeText(item.deletedAt)}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {item.byteSize > 0 ? formatBytes(item.byteSize) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending || orphan}
                          title={
                            orphan
                              ? '缺少原位置信息，无法恢复，只能彻底删除'
                              : `恢复到 ${item.sourcePath}`
                          }
                          aria-label={`恢复 ${item.name}`}
                          onClick={() =>
                            void runItem(item, () => window.api.restoreFromTrash(item.id))
                          }
                        >
                          <RotateCcw />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending}
                          title="打开所在文件夹"
                          aria-label={`打开 ${item.name} 所在文件夹`}
                          onClick={() => void window.api.revealTrashItem(item.id)}
                        >
                          <FolderOpen />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending}
                          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                          title="彻底删除，不可恢复"
                          aria-label={`彻底删除 ${item.name}`}
                          onClick={() => setConfirming({ kind: 'purge', item })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive-text" />
              {confirming?.kind === 'empty'
                ? `清空回收站（${items.length} 个条目）？`
                : `彻底删除 ${confirming?.item.name ?? ''}？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可恢复，回收站里的内容会被直接删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                const action = confirming
                setConfirming(null)
                if (!action) return
                if (action.kind === 'empty') void empty()
                else void runItem(action.item, () => window.api.purgeTrash(action.item.id))
              }}
            >
              彻底删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
