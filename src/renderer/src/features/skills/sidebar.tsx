import { type MenuItemId, type MenuPrefs, type SkillSource } from '@shared/types'
import { Inbox, LayoutDashboard, Moon, Package, Settings, Sun } from 'lucide-react'
import { type ReactElement, type ReactNode } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import type { AgentId, View } from '@/hooks/use-skills'
import { MENU_GROUP_LABEL, MENU_GROUP_ORDER, resolveMenu, type MenuItemDef } from '@/lib/menu'
import { cn } from '@/lib/utils'

export interface TitleBarProps {
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  actions?: ReactNode
}

export function TitleBar({ theme, onThemeToggle, actions }: TitleBarProps): ReactElement {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center border-b border-sidebar-border bg-sidebar pr-3 pl-[86px]">
      <div className="no-drag ml-auto flex shrink-0 items-center gap-1">
        {actions}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onThemeToggle}
          aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  )
}

function NavItem({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  icon: ReactNode
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-[13px] transition-colors',
        active
          ? 'border-primary bg-sidebar-accent font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">{count}</span>
      )}
    </button>
  )
}

function NavSection({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

export interface SidebarProps {
  view: View
  onViewChange: (v: View) => void
  menu: MenuPrefs
  counts: {
    all: number
    central: number
    external: number
    bySource: Record<SkillSource, number>
    byAgent: Record<AgentId, number>
    linked: number
    unlinked: number
    builtin: number
  }
}

function isViewActive(current: View, target: View): boolean {
  if (current.kind !== target.kind) return false
  if (current.kind === 'location' && target.kind === 'location')
    return current.source === target.source
  if (current.kind === 'workspace' && target.kind === 'workspace')
    return current.agent === target.agent
  return true
}

function countFor(id: MenuItemId, counts: SidebarProps['counts']): number {
  if (id === 'dashboard') return counts.all
  if (id === 'repository') return counts.central
  if (id === 'unmanaged') return counts.external
  const [kind, source] = id.split(':') as ['location' | 'workspace', SkillSource]
  return kind === 'location' ? counts.bySource[source] : counts.byAgent[source]
}

function iconFor(item: MenuItemDef): ReactNode {
  if (item.source) return <AgentIcon agent={item.source} className="h-3.5 w-3.5" />
  if (item.id === 'repository') return <Package className="h-3.5 w-3.5" />
  if (item.id === 'unmanaged') return <Inbox className="h-3.5 w-3.5" />
  return <LayoutDashboard className="h-3.5 w-3.5" />
}

export function Sidebar({ view, onViewChange, menu, counts }: SidebarProps): ReactElement {
  const items = resolveMenu(menu)

  return (
    <aside className="flex w-[212px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-sidebar-border bg-sidebar px-2 py-3">
      <div className="flex items-center gap-2 px-2">
        <img
          src="./icon.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-5 w-5 shrink-0 rounded-[6px]"
        />
        <span className="truncate text-[14px] font-semibold tracking-tight">Skills Deck</span>
      </div>

      {MENU_GROUP_ORDER.map((group) => {
        const list = items.filter((item) => item.group === group)
        if (list.length === 0) return null
        return (
          <NavSection key={group} label={MENU_GROUP_LABEL[group]}>
            {list.map((item) => (
              <NavItem
                key={item.id}
                active={isViewActive(view, item.view)}
                label={item.label}
                count={countFor(item.id, counts)}
                icon={iconFor(item)}
                onClick={() => onViewChange(item.view)}
              />
            ))}
          </NavSection>
        )
      })}

      <div className="mt-auto px-0 pt-2">
        <NavItem
          active={view.kind === 'settings'}
          label="设置"
          icon={<Settings className="h-3.5 w-3.5" />}
          onClick={() => onViewChange({ kind: 'settings' })}
        />
      </div>
    </aside>
  )
}
