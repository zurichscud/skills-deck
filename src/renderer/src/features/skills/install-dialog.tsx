import type { InstallFromGitResult } from '@shared/types'
import { AlertTriangle, Check, GitBranch, Loader2 } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface InstallDialogProps {
  open: boolean
  onClose: () => void
  /** 安装完成后通知外部刷新 */
  onChanged: () => void
}

function ResultPanel({ result }: { result: InstallFromGitResult }): ReactElement {
  const renamed = result.installed.filter((s) => s.name !== s.source)

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5 text-[12.5px]">
      <p className="flex items-center gap-1.5 font-medium text-ok">
        <Check className="h-3.5 w-3.5" />
        已安装 {result.installed.length} 个 skill 到中央仓库
      </p>
      {result.installed.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11.5px] text-muted-foreground">
          {result.installed.map((s) => (
            <li key={s.name} className="truncate" title={s.name}>
              {s.name}
              {s.name !== s.source && <span className="text-warn">（同名，改存为 {s.name}）</span>}
            </li>
          ))}
        </ul>
      )}
      {renamed.length > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          有 {renamed.length} 个与已有 skill 同名，已自动改名并存，未覆盖原有内容。
        </p>
      )}
      {result.failed.length > 0 && (
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {result.failed.length} 个安装失败
          </p>
          <ul className="space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
            {result.failed.map((f) => (
              <li key={f.name} className="break-all">
                {f.name}：{f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground/80">
        已放进中央仓库，可在列表里按需链接到各个存储位置。
      </p>
    </div>
  )
}

function Body({ onClose, onChanged }: Omit<InstallDialogProps, 'open'>): ReactElement {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InstallFromGitResult | null>(null)

  const submit = async (): Promise<void> => {
    const repo = url.trim()
    if (!repo || busy) return
    setBusy(true)
    setResult(null)
    try {
      const next = await window.api.installFromGit(repo)
      if (next.ok) {
        setResult(next)
        toast.success(`已从仓库安装 ${next.installed.length} 个 skill`)
        onChanged()
      } else {
        toast.error(next.message)
      }
    } catch (err) {
      toast.error(`安装失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader className="gap-1.5">
        <DialogTitle className="flex items-center gap-2 text-[15px]">
          <GitBranch className="h-4 w-4 text-primary" />
          从 Git 仓库安装 Skill
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          只下载仓库里的 <span className="font-mono">skills/</span> 目录，不会拉取整个仓库。
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 py-1">
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            // 改地址即视为新一轮安装
            if (result) setResult(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          disabled={busy}
          placeholder="https://github.com/anthropics/skills"
          className="h-9 font-mono text-[12.5px]"
          aria-label="Git 仓库地址"
        />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          用浅克隆 + 部分克隆 + 稀疏检出，只取 <span className="font-mono">skills/</span>{' '}
          下的文件与 SKILL.md；仓库体积很大也不会整仓下载。
          {busy && (
            <span className="mt-1 flex items-center gap-1.5 text-foreground/80">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在下载并导入，仓库大时可能需要一会儿…
            </span>
          )}
        </p>
      </div>

      {result && <ResultPanel result={result} />}

      <DialogFooter>
        <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={onClose}>
          关闭
        </Button>
        {result === null && (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[12.5px]"
            disabled={busy || url.trim() === ''}
            onClick={() => void submit()}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? '安装中…' : '安装'}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

export function InstallDialog({ open, onClose, onChanged }: InstallDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <Body onClose={onClose} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  )
}
