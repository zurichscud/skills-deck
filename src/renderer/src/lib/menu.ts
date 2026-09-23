import {
  DEFAULT_MENU_PREFS,
  MENU_ITEM_IDS,
  SOURCE_LABEL,
  type MenuItemId,
  type MenuPrefs,
  type SkillSource,
} from '@shared/types'

import type { View } from '@/hooks/use-skills'

export type MenuGroup = 'overview' | 'repository' | 'location' | 'workspace'

export const MENU_GROUP_ORDER: MenuGroup[] = ['overview', 'repository', 'location', 'workspace']

export const MENU_GROUP_LABEL: Record<MenuGroup, string> = {
  overview: '总览',
  repository: '中央仓库',
  location: '存储位置',
  workspace: '工作区',
}

export interface MenuItemDef {
  id: MenuItemId
  group: MenuGroup
  label: string
  view: View
  /** location / workspace 项对应的来源，用于渲染品牌图标 */
  source?: SkillSource
  /** 常驻项：始终显示在侧边栏，不参与排序与显隐配置 */
  fixed?: boolean
}

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']

/** 默认顺序即 MENU_ITEM_IDS 的声明顺序 */
export const MENU_ITEMS: MenuItemDef[] = [
  {
    id: 'dashboard',
    group: 'overview',
    label: 'Dashboard',
    view: { kind: 'dashboard' },
    fixed: true,
  },
  {
    id: 'repository',
    group: 'repository',
    label: '全部 Skill',
    view: { kind: 'repository' },
    fixed: true,
  },
  ...SOURCES.map<MenuItemDef>((s) => ({
    id: `location:${s}`,
    group: 'location',
    label: SOURCE_LABEL[s],
    view: { kind: 'location', source: s },
    source: s,
  })),
  ...SOURCES.map<MenuItemDef>((s) => ({
    id: `workspace:${s}`,
    group: 'workspace',
    label: SOURCE_LABEL[s],
    view: { kind: 'workspace', agent: s },
    source: s,
  })),
]

const MENU_BY_ID = new Map<string, MenuItemDef>(MENU_ITEMS.map((m) => [m.id, m]))

export function menuItemById(id: MenuItemId): MenuItemDef | undefined {
  return MENU_BY_ID.get(id)
}

/** 完整菜单顺序（含隐藏项）：用户顺序优先，未列出的按默认顺序补齐 */
export function resolveMenuIds(menu: MenuPrefs = DEFAULT_MENU_PREFS): MenuItemId[] {
  const known = new Set<string>(menu.order)
  return [...menu.order, ...MENU_ITEM_IDS.filter((id) => !known.has(id))]
}

/** 侧边栏实际渲染的菜单项：常驻项 + 用户顺序 + 过滤隐藏项 */
export function resolveMenu(menu: MenuPrefs = DEFAULT_MENU_PREFS): MenuItemDef[] {
  const hidden = new Set<string>(menu.hidden)
  const fixed = MENU_ITEMS.filter((m) => m.fixed)
  const configurable = resolveMenuIds(menu)
    .filter((id) => !hidden.has(id))
    .map((id) => MENU_BY_ID.get(id))
    .filter((m): m is MenuItemDef => !!m)
  return [...fixed, ...configurable]
}

/** 组内拖拽排序：只调整该组的相对顺序，组间位置不变 */
export function reorderMenuGroup(
  menu: MenuPrefs,
  group: MenuGroup,
  activeId: MenuItemId,
  overId: MenuItemId,
): MenuPrefs {
  if (activeId === overId) return menu
  const order = resolveMenuIds(menu)
  const groupIds = order.filter((id) => MENU_BY_ID.get(id)?.group === group)
  const from = groupIds.indexOf(activeId)
  const to = groupIds.indexOf(overId)
  if (from < 0 || to < 0) return menu
  const [moved] = groupIds.splice(from, 1)
  groupIds.splice(to, 0, moved)
  let cursor = 0
  const next = order.map((id) => (MENU_BY_ID.get(id)?.group === group ? groupIds[cursor++] : id))
  return { ...menu, order: next }
}

/** 显示/隐藏菜单项 */
export function setMenuItemVisible(menu: MenuPrefs, id: MenuItemId, visible: boolean): MenuPrefs {
  const hidden = new Set<string>(menu.hidden)
  if (visible) hidden.delete(id)
  else hidden.add(id)
  return { ...menu, hidden: MENU_ITEM_IDS.filter((i) => hidden.has(i)) }
}
