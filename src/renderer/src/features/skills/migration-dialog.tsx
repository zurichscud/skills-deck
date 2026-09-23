import { type AdoptAction, type UnmanagedSkill } from '@shared/types'
import { AlertTriangle, Check, EyeOff, Loader2, Package, RotateCcw, Sparkles } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { AgentIcon } from '@/components/agent-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const CHOICES: { action: AdoptAction; label: string; detail: string }[] = [
  { action: 'overwrite', label: '用本地覆盖中央', detail: '中央版本被替换（可从 git 找回）' },
  { action: 'rename', label: '两份并存', detail: '本地副本以 -2 后缀纳入中央仓库' },
  { action: 'keep', label: '保留中央版本', detail: '本地副本被丢弃，改为指向中央的链接' },
]

const TOAST_LABEL: Record<AdoptAction, string> = {
  adopt: '已纳入中央仓库',
  overwrite: '已用本地覆盖中央',
  rename: '已并存纳入中央仓库',
  keep: '已改为指向中央仓库的链接',
}

type Direction = 'next' | 'prev'

export interface MigrationDialogProps {
  open: boolean
  onClose: () => void
  /** 每处理完一项后通知外部刷新计数 */
  onChanged: () => void
}

function SlideCard({
  item,
  busy,
  direction,
  onApply,
}: {
  item: UnmanagedSkill
  busy: boolean
  direction: Direction
  onApply: (item: UnmanagedSkill, action: AdoptAction) => void
}): ReactElement {
  return (
    <div
      className={cn(
        'flex min-h-[196px] flex-col px-4 py-4 duration-200',
        direction === 'next'
          ? 'animate-in fade-in-0 slide-in-from-right-6'
          : 'animate-in fade-in-0 slide-in-from-left-6',
      )}
    >
      <div className="flex items-start gap-3">
        <AgentIcon agent={item.source} className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-medium">{item.name}</span>
            {item.isSymlink && (
              <Badge variant="outline" className="text-[10.5px] text-muted-foreground">
                软链
              </Badge>
            )}
            {item.conflict && (
              <Badge variant="outline" className="border-warn/40 text-[10.5px] text-warn">
                同名冲突
              </Badge>
            )}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {item.description && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          )}
          <p className="mt-2 font-mono text-[10.5px] break-all text-muted-foreground/60">
            {item.path}
          </p>
        </div>
      </div>

      {item.conflict && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[11.5px] text-warn">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            中央仓库已存在同名 skill
            {item.identical ? '（内容一致）' : '（内容不同）'}
          </p>
          <div className="mt-2 grid gap-1.5">
            {CHOICES.map((choice) => (
              <button
                key={choice.action}
                type="button"
                disabled={busy}
                onClick={() => onApply(item, choice.action)}
                className={cn(
                  'flex items-baseline gap-2 rounded-[5px] border px-2.5 py-1.5 text-left transition-colors',
                  'disabled:cursor-default disabled:opacity-60',
                  choice.action === 'keep'
                    ? 'border-destructive/35 hover:bg-destructive/5'
                    : 'hover:bg-accent/60',
                )}
              >
                <span className="shrink-0 text-[12px] font-medium">{choice.label}</span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[11px]',
                    choice.action === 'keep' ? 'text-destructive/80' : 'text-muted-foreground',
                  )}
                >
                  {choice.detail}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 每次打开弹窗时重新挂载，状态天然从第一项开始 */
function Carousel({
  onClose,
  onChanged,
}: Omit<MigrationDialogProps, 'open'>): ReactElement {
  const [items, setItems] = useState<UnmanagedSkill[] | null>(null)
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<Direction>('next')
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .unmanaged()
      .then((next) => {
        if (cancelled) return
        setItems(next)
        setTotal(next.length)
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
        setTotal(0)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const count = items?.length ?? 0
  /** 从当前位置向后找第一项没被忽略的条目 */
  const currentIndex = useMemo(() => {
    if (!items) return -1
    for (let i = Math.min(index, Math.max(items.length - 1, 0)); i < items.length; i++) {
      const item = items[i]
      if (item && !skipped.has(item.id)) return i
    }
    return -1
  }, [items, index, skipped])
  const current = currentIndex >= 0 && items ? items[currentIndex]! : null
  const busy = current !== null && busyId === current.id
  const allIgnored = items !== null && count > 0 && currentIndex < 0

  const ignore = useCallback(() => {
    if (!current) return
    setDirection('next')
    setSkipped((prev) => new Set(prev).add(current.id))
    setIndex(currentIndex + 1)
  }, [current, currentIndex])

  const restart = useCallback(() => {
    setDirection('prev')
    setSkipped(new Set())
    setIndex(0)
  }, [])

  const apply = useCallback(
    async (item: UnmanagedSkill, action: AdoptAction): Promise<void> => {
      setBusyId(item.id)
      const result = await window.api.adoptUnmanaged(item.id, action)
      setBusyId(null)
      if (result.ok) toast.success(`${item.name}：${TOAST_LABEL[action]}`)
      else toast.error(`${item.name}：${result.message}`)
      const next = await window.api.unmanaged()
      setItems(next)
      setDirection('next')
      setIndex((i) => Math.min(i, Math.max(next.length - 1, 0)))
      onChanged()
    },
    [onChanged],
  )

  const processed = total - count
  const ignored = items?.filter((i) => skipped.has(i.id)).length ?? 0
  const progress = total > 0 ? ((processed + ignored) / total) * 100 : 0
  const conflicts = items?.filter((i) => i.conflict && !skipped.has(i.id)).length ?? 0

  return (
    <>
      <DialogHeader className="shrink-0 gap-2 border-b px-4 py-3.5">
        <DialogTitle className="flex items-center gap-2 text-[15px]">
          <Sparkles className="h-4 w-4 text-primary" />
          未纳管的 Skill
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          {items === null
            ? '正在扫描三个存储位置…'
            : count === 0
              ? '三个存储位置里的 skill 都已在中央仓库管理之下。'
              : `共 ${total} 项 · 已纳入 ${processed} · 已忽略 ${ignored}${
                  conflicts > 0 ? ` · 还有 ${conflicts} 个同名冲突` : ''
                }`}
        </DialogDescription>
        {count > 0 && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </DialogHeader>

      {current && (
        <ScrollArea className="min-h-[196px] flex-1">
          <SlideCard
            key={current.id}
            item={current}
            busy={busy}
            direction={direction}
            onApply={(target, action) => void apply(target, action)}
          />
        </ScrollArea>
      )}

      {allIgnored && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <EyeOff className="h-5 w-5 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            已忽略全部 {count} 项，它们仍留在原位置
          </p>
        </div>
      )}

      {items !== null && count === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Check className="h-5 w-5 text-ok" />
          <p className="text-[13px] text-muted-foreground">
            {total > 0 ? `全部 ${total} 项已处理完毕` : '没有需要处理的条目'}
          </p>
        </div>
      )}

      <DialogFooter className="shrink-0 border-t px-4 py-3">
        {current && !current.conflict && (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[12.5px]"
            disabled={busy}
            onClick={() => void apply(current, 'adopt')}
          >
            <Package className="h-3.5 w-3.5" />
            纳入中央仓库
          </Button>
        )}
        {current && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12.5px]"
            disabled={busy}
            onClick={ignore}
          >
            忽略
          </Button>
        )}
        {!current && allIgnored && (
          <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={restart}>
            <RotateCcw className="h-3.5 w-3.5" />
            重新过一遍
          </Button>
        )}
        {!current && (
          <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={onClose}>
            关闭
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

export function MigrationDialog({ open, onClose, onChanged }: MigrationDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <Carousel onClose={onClose} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  )
}
