import { ChevronDown, Plus } from 'lucide-react'
import { type ReactElement } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type ImportMode = 'local' | 'git'

/**
 * 导入入口：两条路都只写入中央仓库（本地目录 → 中央仓库；git 仓库 → 只取 skills/ → 中央仓库）。
 * 仅在总览与中央仓库视图出现。
 */
export function ImportMenu({ onImport }: { onImport: (mode: ImportMode) => void }): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" static className="h-9 gap-1.5 px-3.5 text-sm">
          <Plus className="h-3.5 w-3.5" />
          导入 skill
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-sm">
        <DropdownMenuItem onSelect={() => onImport('local')}>从本地目录导入…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onImport('git')}>从 Git 仓库安装…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
