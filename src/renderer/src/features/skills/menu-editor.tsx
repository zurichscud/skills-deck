import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { MenuItemId, MenuPrefs } from '@shared/types'
import { GripVertical, LayoutDashboard } from 'lucide-react'
import { type ReactElement, useMemo } from 'react'

import { AgentIcon } from '@/components/agent-icons'
import { Switch } from '@/components/ui/switch'
import {
  MENU_GROUP_LABEL,
  MENU_GROUP_ORDER,
  menuItemById,
  reorderMenuGroup,
  resolveMenuIds,
  setMenuItemVisible,
  type MenuGroup,
  type MenuItemDef,
} from '@/lib/menu'
import { cn } from '@/lib/utils'

function SortableRow({
  item,
  visible,
  onToggle,
}: {
  item: MenuItemDef
  visible: boolean
  onToggle: (visible: boolean) => void
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-md border bg-background py-1 pr-2 pl-1',
        !visible && 'opacity-55',
        isDragging && 'relative z-10 shadow-sm',
      )}
    >
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
        aria-label={`拖拽排序 ${item.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {item.source ? (
          <AgentIcon agent={item.source} className="h-3.5 w-3.5" />
        ) : (
          <LayoutDashboard className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="flex-1 truncate text-[13px]">{item.label}</span>
      <Switch checked={visible} onCheckedChange={onToggle} aria-label={`显示 ${item.label}`} />
    </div>
  )
}

function SortableGroup({
  group,
  items,
  hidden,
  onReorder,
  onToggle,
}: {
  group: MenuGroup
  items: MenuItemDef[]
  hidden: ReadonlySet<string>
  onReorder: (group: MenuGroup, activeId: MenuItemId, overId: MenuItemId) => void
  onToggle: (id: MenuItemId, visible: boolean) => void
}): ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder(group, active.id as MenuItemId, over.id as MenuItemId)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-1">
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              visible={!hidden.has(item.id)}
              onToggle={(visible) => onToggle(item.id, visible)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

export interface MenuEditorProps {
  menu: MenuPrefs
  onChange: (menu: MenuPrefs) => void
}

/** 侧边栏菜单编辑器：组内拖拽排序 + 逐个显隐 */
export function MenuEditor({ menu, onChange }: MenuEditorProps): ReactElement {
  const ordered = useMemo(
    () =>
      resolveMenuIds(menu)
        .map((id) => menuItemById(id))
        .filter((item): item is MenuItemDef => item !== undefined),
    [menu],
  )
  const hidden = useMemo(() => new Set<string>(menu.hidden), [menu])

  return (
    <div className="grid gap-4">
      {MENU_GROUP_ORDER.map((group) => {
        const items = ordered.filter((item) => item.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="grid gap-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {MENU_GROUP_LABEL[group]}
            </p>
            <SortableGroup
              group={group}
              items={items}
              hidden={hidden}
              onReorder={(g, activeId, overId) =>
                onChange(reorderMenuGroup(menu, g, activeId, overId))
              }
              onToggle={(id, visible) => onChange(setMenuItemVisible(menu, id, visible))}
            />
          </div>
        )
      })}
    </div>
  )
}
