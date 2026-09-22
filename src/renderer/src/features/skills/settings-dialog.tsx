import { type ReactElement, useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { CLOSE_BEHAVIOR_LABEL, SOURCE_LABEL, type AppSettings, type CloseBehavior, type SkillSource } from '@shared/types'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const BEHAVIORS: CloseBehavior[] = ['ask', 'tray', 'quit']

const BEHAVIOR_HINT: Record<CloseBehavior, string> = {
  ask: '关闭窗口时弹出询问，由你决定退出还是收进托盘。',
  tray: '窗口隐藏到菜单栏，应用继续在后台运行。',
  quit: '直接退出应用，不驻留后台。'
}

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onSave: (next: AppSettings) => Promise<boolean>
}

export function SettingsDialog({ open, onClose, onSave }: SettingsDialogProps): ReactElement | null {
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(true)
    void window.api.getSettings().then((s) => {
      setDraft(s)
      setBusy(false)
    })
  }, [open])

  if (!open || !draft) return null

  const setPath = (key: 'disabledRoot' | SkillSource, value: string): void => {
    setDraft((prev) =>
      !prev
        ? prev
        : key === 'disabledRoot'
          ? { ...prev, disabledRoot: value }
          : { ...prev, sourceRoots: { ...prev.sourceRoots, [key]: value } }
    )
  }

  const pick = async (key: 'disabledRoot' | SkillSource): Promise<void> => {
    const dir = await window.api.pickDirectory()
    if (dir) setPath(key, dir)
  }

  const submit = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    const ok = await onSave(draft)
    setBusy(false)
    if (ok) onClose()
  }

  const pathRow = (
    key: 'disabledRoot' | SkillSource,
    label: string,
    value: string,
    icon?: SkillSource
  ): ReactElement => (
    <div className="grid grid-cols-[112px_1fr_auto] items-center gap-2">
      <Label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {icon ? <AgentIcon agent={icon} className="h-3.5 w-3.5" /> : null}
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => setPath(key, e.target.value)}
        className="h-8 font-mono text-[11.5px]"
        spellCheck={false}
        aria-label={label}
        title={value}
      />
      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void pick(key)} aria-label={`选择${label}目录`}>
        <FolderOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>修改 skill 仓库地址与窗口关闭行为。保存后立即生效并重新扫描。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">仓库地址</p>
          {SOURCES.map((s) => pathRow(s, SOURCE_LABEL[s], draft.sourceRoots[s], s))}
          {pathRow('disabledRoot', '停用停车场', draft.disabledRoot)}
          <p className="text-[11px] text-muted-foreground/60">
            停用的 skill 会被移动到「停用停车场」，启用后移回对应来源目录。
          </p>
        </div>

        <Separator />

        <div className="grid gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">关闭行为</p>
          <div className="grid gap-1.5">
            {BEHAVIORS.map((b) => {
              const active = draft.closeBehavior === b
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setDraft((p) => (p ? { ...p, closeBehavior: b } : p))}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    active ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
                  )}
                >
                  <span className="block text-[13px] font-medium">{CLOSE_BEHAVIOR_LABEL[b]}</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{BEHAVIOR_HINT[b]}</span>
                </button>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
