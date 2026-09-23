import { SKILL_SOURCES, SOURCE_LABEL, type Skill } from '@shared/types'
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
  skills: Skill[]
  busy: boolean
  onClose: () => void
  onConfirm: (skills: Skill[]) => void
}

function isBrokenLink(skill: Skill): boolean {
  return skill.kind === 'external' && skill.links[skill.origin ?? 'claude']?.state === 'broken'
}

/** 多选删除：未纳管条目逐条列出，如实说明真实目录与断链的差别 */
function BatchBody({ skills }: { skills: Skill[] }): ReactElement {
  const broken = skills.filter(isBrokenLink)
  const realDirs = skills.filter((s) => !isBrokenLink(s))
  const files = realDirs.reduce((n, s) => n + s.files.length, 0)
  const bytes = realDirs.reduce((n, s) => n + s.byteSize, 0)

  return (
    <div className="space-y-2 text-[13px]">
      <p>
        将从各自所在位置删除选中的 <b>{skills.length}</b> 个条目，<b>不可恢复</b>。
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11.5px] break-all">
        {skills.map((s) => (
          <li key={s.id}>{s.dirPath}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        {realDirs.length > 0 && (
          <>
            其中 <b>{realDirs.length}</b> 个是真实目录，共 <b>{files}</b> 个文件（
            {formatBytes(bytes)}）会被一并删除
          </>
        )}
        {realDirs.length > 0 && broken.length > 0 && '；'}
        {broken.length > 0 && (
          <>
            <b>{broken.length}</b> 个是失效软链，仅删除链接本身
          </>
        )}
        。
      </p>
    </div>
  )
}

export function DeleteDialog({
  skills,
  busy,
  onClose,
  onConfirm,
}: DeleteDialogProps): ReactElement | null {
  if (skills.length === 0) return null

  const skill = skills[0]!
  const isCentral = skill.kind === 'central'
  const isExternal = skill.kind === 'external'
  const links = isCentral
    ? SKILL_SOURCES.filter((s) => skill.links[s].state === 'linked').map((s) => ({
        source: s,
        path: skill.links[s].path,
      }))
    : []

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {skills.length > 1 ? `永久删除 ${skills.length} 个条目？` : `永久删除 ${skill.name}？`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            {skills.length > 1 ? (
              <BatchBody skills={skills} />
            ) : (
              <div className="space-y-2 text-[13px]">
                {isCentral ? (
                  <>
                    <p>
                      将从中央仓库中<b>永久删除真身</b>，并清理指向它的软链。
                      <b>不可恢复</b>（若已提交 git，可从历史中找回）。
                    </p>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11.5px] break-all">
                      {skill.dirPath}
                    </div>
                    <p className="text-muted-foreground">
                      这是真实目录，其中 <b>{skill.files.length}</b> 个文件（共{' '}
                      {formatBytes(skill.byteSize)}）将被一并删除。
                    </p>
                    {links.length > 0 ? (
                      <div className="text-muted-foreground">
                        同时移除以下软链：
                        <ul className="mt-1 space-y-0.5 font-mono text-[11px] break-all">
                          {links.map((l) => (
                            <li key={l.source}>
                              {SOURCE_LABEL[l.source]}：{l.path}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">当前没有任何存储位置链接到它。</p>
                    )}
                    <p className="text-[12px] text-muted-foreground/70">
                      其它未纳管位置（如 ~/.agents/skills）中的同名链接不会被清理，会变成失效链接。
                    </p>
                  </>
                ) : isExternal ? (
                  <>
                    <p>
                      这是一个<b>未纳管</b>条目，将直接从其所在位置删除，<b>不可恢复</b>。
                    </p>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11.5px] break-all">
                      {skill.dirPath}
                    </div>
                    {isBrokenLink(skill) ? (
                      <p className="text-muted-foreground">这是失效的软链残骸，仅删除链接本身。</p>
                    ) : (
                      <p className="text-muted-foreground">
                        这是真实目录，其中 <b>{skill.files.length}</b> 个文件（共{' '}
                        {formatBytes(skill.byteSize)}）将被一并删除。
                      </p>
                    )}
                  </>
                ) : (
                  <p>内置 skill 不可删除。</p>
                )}
              </div>
            )}
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
              onConfirm(skills)
            }}
          >
            {busy ? '删除中…' : skills.length > 1 ? `永久删除 ${skills.length} 项` : '永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
