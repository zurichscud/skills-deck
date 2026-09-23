import { SOURCE_LABEL, type AdoptAction, type UnmanagedSkill } from '@shared/types'
import { AlertTriangle, Check, Loader2, Package, Sparkles } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useState } from 'react'
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

export interface MigrationDialogProps {
  open: boolean
  onClose: () => void
  /** 每处理完一项后通知外部刷新计数 */
  onChanged: () => void
}

function ItemRow({
  item,
  busy,
  onApply,
}: {
  item: UnmanagedSkill
  busy: boolean
  onApply: (item: UnmanagedSkill, action: AdoptAction) => void
}): ReactElement {
  return (
    <div className="border-b border-border/60 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <AgentIcon agent={item.source} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12.5px] font-medium">{item.name}</span>
            <Badge variant="outline" className="text-[10.5px]">
              {SOURCE_LABEL[item.source]}
            </Badge>
            {item.isSymlink && (
              <Badge variant="outline" className="text-[10.5px] text-muted-foreground">
                软链
              </Badge>
            )}
            {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
              {item.description}
            </p>
          )}
          <p className="mt-1 font-mono text-[10.5px] break-all text-muted-foreground/60">
            {item.path}
          </p>

          {item.conflict ? (
            <div className="mt-2.5">
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
          ) : (
            <div className="mt-2.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[12px]"
                disabled={busy}
                onClick={() => onApply(item, 'adopt')}
              >
                <Package className="h-3.5 w-3.5" />
                纳入中央仓库
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function MigrationDialog({ open, onClose, onChanged }: MigrationDialogProps): ReactElement {
  const [items, setItems] = useState<UnmanagedSkill[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setItems(await window.api.unmanaged())
  }, [])

  useEffect(() => {
    if (!open) return
    void window.api
      .unmanaged()
      .then((next) => {
        setItems(next)
      })
      .catch(() => setItems([]))
  }, [open])

  const apply = useCallback(
    async (item: UnmanagedSkill, action: AdoptAction): Promise<void> => {
      setBusyId(item.id)
      const result = await window.api.adoptUnmanaged(item.id, action)
      setBusyId(null)
      if (result.ok) toast.success(`${item.name}：${TOAST_LABEL[action]}`)
      else toast.error(`${item.name}：${result.message}`)
      await load()
      onChanged()
    },
    [load, onChanged],
  )

  const conflicts = items?.filter((i) => i.conflict).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 gap-1.5 border-b px-4 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Sparkles className="h-4 w-4 text-primary" />
            未纳管的 Skill
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {items === null
              ? '正在扫描三个存储位置…'
              : items.length === 0
                ? '三个存储位置里的 skill 都已在中央仓库管理之下。'
                : `发现 ${items.length} 个未纳入中央仓库的 skill${
                    conflicts > 0 ? `，其中 ${conflicts} 个与中央仓库同名` : ''
                  }；逐个决定如何处理。`}
          </DialogDescription>
        </DialogHeader>

        {items !== null && items.length > 0 && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="divide-y divide-border/60">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onApply={(target, action) => void apply(target, action)}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {items !== null && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Check className="h-5 w-5 text-ok" />
            <p className="text-[13px] text-muted-foreground">没有需要处理的条目</p>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:justify-end">
          <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
