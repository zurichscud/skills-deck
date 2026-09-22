import { type ReactElement, type ReactNode } from 'react'
import { Boxes, HardDrive, LayoutDashboard, Moon, Settings, Sun } from 'lucide-react'
import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SOURCE_LABEL, type SkillSource } from '@shared/types'
import type { AgentId, View } from '@/hooks/use-skills'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']
const AGENTS: AgentId[] = ['claude', 'codex', 'opencode']

export interface TitleBarProps {
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  actions?: ReactNode
}

export function TitleBar({ theme, onThemeToggle, actions }: TitleBarProps): ReactElement {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center gap-3 border-b bg-background pl-[86px] pr-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[13px] font-semibold tracking-tight">Skills Deck</span>
      </div>

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
  onClick
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
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="tabular-nums text-[11px] text-muted-foreground/70">{count}</span>
      )}
    </button>
  )
}

function NavSection({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div>
      <p className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <span className="flex h-3 w-3 items-center justify-center">{icon}</span>
        {label}
      </p>
      {children}
    </div>
  )
}

export interface SidebarProps {
  view: View
  onViewChange: (v: View) => void
  counts: {
    all: number
    bySource: Record<SkillSource, number>
    byAgent: Record<AgentId, number>
    enabled: number
    disabled: number
    builtin: number
  }
}

export function Sidebar({ view, onViewChange, counts }: SidebarProps): ReactElement {
  return (
    <aside className="flex w-[212px] shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar px-2 py-3">
      <NavSection label="总览" icon={<LayoutDashboard className="h-3 w-3" />}>
        <NavItem
          active={view.kind === 'dashboard'}
          label="Dashboard"
          count={counts.all}
          icon={<LayoutDashboard className="h-3.5 w-3.5" />}
          onClick={() => onViewChange({ kind: 'dashboard' })}
        />
      </NavSection>

      <NavSection label="存储位置" icon={<HardDrive className="h-3 w-3" />}>
        {SOURCES.map((s) => (
          <NavItem
            key={s}
            active={view.kind === 'location' && view.source === s}
            label={SOURCE_LABEL[s]}
            count={counts.bySource[s]}
            icon={<AgentIcon agent={s} className="h-3.5 w-3.5" />}
            onClick={() => onViewChange({ kind: 'location', source: s })}
          />
        ))}
      </NavSection>

      <NavSection label="工作区" icon={<Boxes className="h-3 w-3" />}>
        {AGENTS.map((a) => (
          <NavItem
            key={a}
            active={view.kind === 'workspace' && view.agent === a}
            label={SOURCE_LABEL[a]}
            count={counts.byAgent[a]}
            icon={<AgentIcon agent={a} className="h-3.5 w-3.5" />}
            onClick={() => onViewChange({ kind: 'workspace', agent: a })}
          />
        ))}
      </NavSection>

      <div className="mt-auto px-2 pt-2">
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
