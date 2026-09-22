import { type ReactElement, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SOURCE_LABEL, type ConflictStrategy, type CopyResult, type Skill, type SkillSource } from '@shared/types'

const TARGETS: SkillSource[] = ['claude', 'codex', 'opencode']

const DOT: Record<SkillSource, string> = {
  claude: 'var(--source-claude)',
  codex: 'var(--source-codex)',
  opencode: 'var(--source-opencode)'
}

export interface CopyDialogProps {
  skill: Skill | null
  onClose: () => void
  onConfirm: (skill: Skill, target: SkillSource, strategy: ConflictStrategy | 'ask') => Promise<CopyResult>
  onDone: () => void
}

export function CopyDialog({ skill, onClose, onConfirm, onDone }: CopyDialogProps): ReactElement | null {
  const [target, setTarget] = useState<SkillSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<{ target: SkillSource; at: string } | null>(null)

  if (!skill) return null

  const close = (): void => {
    setTarget(null)
    setBusy(false)
    setConflict(null)
    onClose()
  }

  const run = async (t: SkillSource, strategy: ConflictStrategy | 'ask'): Promise<void> => {
    setBusy(true)
    const result = await onConfirm(skill, t, strategy)
    setBusy(false)

    if (result.ok) {
      onDone()
      close()
      return
    }
    if (result.code === 'CONFLICT' && strategy === 'ask') {
      setConflict({ target: t, at: result.conflictAt ?? '' })
      return
    }
    onDone()
    close()
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>复制到其他来源</DialogTitle>
            <DialogDescription>
              将 <span className="font-mono">{skill.name}</span> 的完整内容（含附属资源）复制到目标来源。目标可独立修改，不影响原 skill。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-1">
            {TARGETS.map((t) => {
              const disabled = t === skill.source
              return (
                <Button
                  key={t}
                  variant={target === t ? 'default' : 'outline'}
                  className="justify-start gap-2 text-[13px]"
                  disabled={disabled || busy}
                  onClick={() => setTarget(t)}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: DOT[t] }} />
                  {SOURCE_LABEL[t]}
                  {disabled && <span className="ml-auto text-[11px] opacity-60">当前来源</span>}
                </Button>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              取消
            </Button>
            <Button
              disabled={!target || busy}
              onClick={() => {
                if (target) void run(target, 'ask')
              }}
            >
              {busy ? '复制中…' : '复制'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflict !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>目标已存在同名 skill</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{SOURCE_LABEL[conflict?.target ?? 'claude']}</span> 中已有{' '}
              <span className="font-mono">{skill.name}</span>。请选择处理方式。
              {conflict?.at ? (
                <span className="mt-2 block break-all font-mono text-[11px] text-muted-foreground">{conflict.at}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel
              disabled={busy}
              onClick={() => {
                close()
              }}
            >
              取消
            </AlertDialogCancel>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (conflict) void run(conflict.target, 'rename')
              }}
            >
              保留两者（改名）
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (conflict) void run(conflict.target, 'skip')
              }}
            >
              跳过
            </Button>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (conflict) void run(conflict.target, 'overwrite')
              }}
            >
              覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
