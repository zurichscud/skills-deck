import type { Skill } from '@shared/types'
import { AlertTriangle } from 'lucide-react'
import { type ReactElement } from 'react'

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
import { formatBytes } from '@/lib/utils'

export interface DeleteDialogProps {
  skill: Skill | null
  busy: boolean
  onClose: () => void
  onConfirm: (skill: Skill) => void
}

export function DeleteDialog({
  skill,
  busy,
  onClose,
  onConfirm,
}: DeleteDialogProps): ReactElement | null {
  if (!skill) return null

  const isLink = skill.entryKind === 'symlink'
  const isBroken = skill.entryKind === 'broken'

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            永久删除 {skill.name}？
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-[13px]">
              <p>
                将从 <span className="font-mono">{skill.source}</span> 中<b>永久删除</b>该条目，
                <b>不进入停用停车场、不可恢复</b>。
              </p>

              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11.5px] break-all">
                {skill.dirPath}
              </div>

              {isLink && (
                <p className="text-muted-foreground">
                  这是符号链接，<b>只会删除链接本身</b>。真身保留在：
                  <span className="mt-1 block font-mono text-[11px] break-all">
                    {skill.linkTarget ?? '（未知）'}
                  </span>
                  其它来源中指向同一真身的链接不受影响。
                </p>
              )}
              {isBroken && (
                <p className="text-muted-foreground">这是一个已失效的符号链接，仅删除链接残骸。</p>
              )}
              {!isLink && !isBroken && (
                <p className="text-muted-foreground">
                  这是真实目录，其中 <b>{skill.files.length}</b> 个文件（共{' '}
                  {formatBytes(skill.byteSize)}）将被一并永久删除。
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onClose}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm(skill)
            }}
          >
            {busy ? '删除中…' : '永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
