import { lstat, readFile, readdir, readlink, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import { expect, openView, refresh, rowByName, test, toast } from './fixtures'
import { seedSkill } from './sandbox'

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** 表格行：名称单元格是 `span[title=<skill 名>]`，避开描述列里可能出现的同名字样 */
function rowsOf(page: Page, name: string): Locator {
  return page.locator('tbody tr').filter({ has: page.locator(`span[title="${name}"]`) })
}

/** 「类型」列只有「文件 / 软链」两个值，按列里的徽标收窄到具体那一行 */
function rowByType(page: Page, name: string, typeText: '文件' | '软链'): Locator {
  return rowsOf(page, name).filter({ has: page.getByText(typeText, { exact: true }) })
}

/** 行内「更多操作」菜单（同名条目时传 rowByType(...) 定位到具体那一行） */
async function openRowMenu(page: Page, name: string, row?: Locator): Promise<void> {
  await (row ?? rowsOf(page, name)).getByRole('button', { name: `更多操作：${name}` }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/** 打开链接对话框，返回对话框 locator */
async function openLinkDialog(page: Page, name: string, row?: Locator): Promise<Locator> {
  await openRowMenu(page, name, row)
  await page.getByRole('menuitem', { name: '链接…' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function confirmDelete(page: Page, label = '移入回收站'): Promise<void> {
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: label, exact: true }).click()
}

test.describe('视图与归并', () => {
  test('同一份内容只算一条：本体在 Claude Code、软链在 Codex，列表里也只出现一次', async ({
    sandbox,
    page,
    shot,
  }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha', 'Alpha 技能')
    await symlink(join(sandbox.claude, 'alpha'), join(sandbox.codex, 'alpha'), 'dir')
    await seedSkill(join(sandbox.codex, 'only-codex'), 'only-codex', 'Codex 独有')
    await refresh(page)

    // opencode 同时读 claude 与 codex：alpha 有两处条目，但按内容只算一条
    await openView(page, 'workspace', 'opencode')
    await expect(page.getByRole('heading', { name: 'opencode' })).toBeVisible()
    await expect(rowByName(page, 'alpha')).toHaveCount(1)
    await expect(rowByName(page, 'only-codex')).toHaveCount(1)
    // 类型列只说条目形态：本体落在四个位置里 = 「文件」
    await expect(rowByType(page, 'alpha', '文件')).toHaveCount(1)
    await expect(page.getByText('2 条结果')).toBeVisible()
    await shot('e2e-01-workspace-opencode')

    // 详情面板如实说明：本体在 Claude Code，Codex 是软链
    await rowByName(page, 'alpha').click()
    await expect(page.getByRole('heading', { name: '各位置' })).toBeVisible()
    await expect(page.getByText('本体', { exact: true })).toBeVisible()
    await expect(page.getByText('已链接')).toBeVisible()
    await expect(page.getByText('内容路径')).toBeVisible()
  })

  test('位置视图只列该位置的条目；agents 不属于任何工作区', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.claude, 'from-claude'), 'from-claude')
    await seedSkill(join(sandbox.codex, 'from-codex'), 'from-codex')
    await seedSkill(join(sandbox.agents, 'from-agents'), 'from-agents')
    await refresh(page)

    await openView(page, 'location', 'Agents')
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    await expect(page.getByText(sandbox.agents, { exact: true })).toBeVisible()
    await expect(rowByName(page, 'from-agents')).toBeVisible()
    await expect(rowByName(page, 'from-claude')).toHaveCount(0)
    await shot('e2e-02-location-agents')

    // opencode 读三个位置，但不含 agents
    await openView(page, 'workspace', 'opencode')
    await expect(rowByName(page, 'from-claude')).toBeVisible()
    await expect(rowByName(page, 'from-codex')).toBeVisible()
    await expect(rowByName(page, 'from-agents')).toHaveCount(0)
  })

  test('总览统计与回收站入口', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await refresh(page)

    await openView(page, 'dashboard')
    await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()
    await expect(page.getByText('个 skill')).toBeVisible()
    await shot('e2e-03-dashboard')

    await page
      .locator('aside')
      .getByRole('button')
      .filter({ hasText: /^回收站/ })
      .click()
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(page.getByText('回收站是空的')).toBeVisible()
  })
})

test.describe('链接', () => {
  test('勾选建链、取消勾选删链，以磁盘为准', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await refresh(page)

    const dialog = await openLinkDialog(page, 'alpha')
    await expect(dialog.getByText('链接 alpha')).toBeVisible()
    // 长路径与状态文案不得把弹窗网格撑宽（回归：整行卡片溢出到弹窗外面）
    const widths = await dialog.evaluate((el) => ({
      client: el.clientWidth,
      scroll: el.scrollWidth,
    }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
    await shot('e2e-04-link-dialog')
    // 本体所在位置不可改动
    await expect(dialog.getByRole('checkbox', { name: /^Claude Code：本体/ })).toBeDisabled()

    await dialog.getByRole('checkbox', { name: /^Codex：/ }).click()
    await expect
      .poll(async () => (await lstat(join(sandbox.codex, 'alpha'))).isSymbolicLink())
      .toBe(true)
    expect(await readlink(join(sandbox.codex, 'alpha'))).toBe(
      await realpath(join(sandbox.claude, 'alpha')),
    )
    // 全部成功自动关闭
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await shot('e2e-04-linked')

    const again = await openLinkDialog(page, 'alpha')
    await expect(again.getByRole('checkbox', { name: /^Codex：已链接/ })).toBeChecked()
    await again.getByRole('checkbox', { name: /^Codex：/ }).click()
    await expect.poll(async () => exists(join(sandbox.codex, 'alpha'))).toBe(false)
  })

  test('被同名条目占用：位置禁用并提示，绝不覆盖', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'dup'), 'dup')
    await seedSkill(join(sandbox.opencode, 'dup'), 'dup-other', '另一份内容')
    await refresh(page)

    // Claude Code 视图里只有 dup 本体这一行（opencode 的同名条目是另一个 skill）
    const dialog = await openLinkDialog(page, 'dup')
    await expect(dialog.getByRole('checkbox', { name: /^opencode：/ })).toBeDisabled()
    await expect(dialog.getByText(/^被占用：/).first()).toBeVisible()

    // 对话框右上角的 ✕ 也叫「关闭」，取页脚那个
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
    expect(await readFile(join(sandbox.opencode, 'dup', 'SKILL.md'), 'utf8')).toContain('dup-other')
  })

  test('失效残骸可被替换为正确链接', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await symlink(join(sandbox.root, 'gone'), join(sandbox.agents, 'alpha'), 'dir')
    await refresh(page)

    // 残骸是另一个 skill（条目只在 Agents 位置），本视图里 alpha 只有本体那一行：类型列是「文件」
    const dialog = await openLinkDialog(page, 'alpha', rowByType(page, 'alpha', '文件'))
    const broken = dialog.getByRole('checkbox', { name: /^Agents：/ })
    await expect(broken).toBeEnabled()
    await expect(dialog.getByText('勾选将替换失效的链接')).toBeVisible()

    await broken.click()
    await expect.poll(async () => exists(join(sandbox.agents, 'alpha'))).toBe(true)
    expect(await readlink(join(sandbox.agents, 'alpha'))).toBe(
      await realpath(join(sandbox.claude, 'alpha')),
    )
  })

  test('断链残骸单独成条：可删除，但不能链接', async ({ sandbox, page }) => {
    await symlink(join(sandbox.root, 'nope'), join(sandbox.agents, 'dangling'), 'dir')
    await refresh(page)

    await openView(page, 'location', 'Agents')
    await expect(rowByName(page, 'dangling')).toBeVisible()
    // 类型列如实标成软链：残骸也是软链
    await expect(rowByType(page, 'dangling', '软链')).toHaveCount(1)
    await openRowMenu(page, 'dangling')
    await expect(page.getByRole('menuitem', { name: '链接…' })).toBeDisabled()
    await page.getByRole('menuitem', { name: '删除' }).click()
    // 只剩软链、没有内容进回收站，按钮就是「删除」
    await confirmDelete(page, '删除')
    await expect.poll(async () => exists(join(sandbox.agents, 'dangling'))).toBe(false)
    expect(await readdir(sandbox.trash)).toEqual([])
  })
})

test.describe('删除与回收站', () => {
  test('删除：内容进回收站、各处软链直接删除，恢复只把内容放回原处', async ({
    sandbox,
    page,
    shot,
  }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await refresh(page)

    const dialog = await openLinkDialog(page, 'alpha')
    await dialog.getByRole('checkbox', { name: /^Codex：/ }).click()
    await expect.poll(async () => exists(join(sandbox.codex, 'alpha'))).toBe(true)

    await openRowMenu(page, 'alpha')
    await page.getByRole('menuitem', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByText('将 alpha 移入回收站？')).toBeVisible()
    await expect(confirm.getByText(/软链 1 处直接删除/)).toBeVisible()
    await expect(confirm.getByText('回收站目录：')).toBeVisible()
    await shot('e2e-05-delete-confirm')
    await confirm.getByRole('button', { name: '移入回收站', exact: true }).click()
    await expect(toast(page, '已删除：1 个 skill')).toBeVisible()

    await expect.poll(async () => exists(join(sandbox.claude, 'alpha'))).toBe(false)
    await expect.poll(async () => exists(join(sandbox.codex, 'alpha'))).toBe(false)
    // 只有内容本体进回收站；软链删了就没了
    await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(1)

    await openView(page, 'trash')
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(rowByName(page, 'alpha')).toBeVisible()
    // 回收站里只有文件，没有「类型」这一列
    await expect(page.getByText('类型')).toHaveCount(0)
    await shot('e2e-06-trash')

    await page.getByRole('button', { name: '恢复 alpha' }).click()
    await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(0)
    await expect(page.getByText('回收站是空的')).toBeVisible()
    expect(await readFile(join(sandbox.claude, 'alpha', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha',
    )
    // 软链删除时就已经删掉，恢复不会把它带回来
    expect(await exists(join(sandbox.codex, 'alpha'))).toBe(false)
  })

  test('内容在应用之外：删除只删软链，外面的真身一个都不动', async ({ sandbox, page }) => {
    const outside = join(sandbox.root, 'outside', 'gamma')
    await seedSkill(outside, 'gamma')
    await symlink(outside, join(sandbox.agents, 'gamma'), 'dir')
    await refresh(page)

    await openView(page, 'location', 'Agents')
    await expect(rowByType(page, 'gamma', '软链')).toHaveCount(1)
    await openRowMenu(page, 'gamma')
    await page.getByRole('menuitem', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    // 没有内容本体，删除即删除，不进回收站
    await expect(confirm.getByText('删除 gamma？')).toBeVisible()
    await expect(confirm.getByText(/没有内容本体/)).toBeVisible()
    await confirmDelete(page, '删除')

    await expect.poll(async () => exists(join(sandbox.agents, 'gamma'))).toBe(false)
    expect(await exists(join(outside, 'SKILL.md'))).toBe(true)
    expect(await readdir(sandbox.trash)).toEqual([])
  })

  test('恢复时原位置被占用：拒绝并如实提示', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.agents, 'beta'), 'beta')
    await refresh(page)

    await openView(page, 'location', 'Agents')
    await openRowMenu(page, 'beta')
    await page.getByRole('menuitem', { name: '删除' }).click()
    await confirmDelete(page)
    await expect.poll(async () => exists(join(sandbox.agents, 'beta'))).toBe(false)

    await seedSkill(join(sandbox.agents, 'beta'), 'someone-else')
    await openView(page, 'trash')
    await page.getByRole('button', { name: '恢复 beta' }).first().click()
    await expect(page.getByText(/原位置已被同名条目占用/)).toBeVisible()
    expect(await readFile(join(sandbox.agents, 'beta', 'SKILL.md'), 'utf8')).toContain(
      'someone-else',
    )
  })

  test('彻底删除与清空回收站', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'one'), 'one')
    await seedSkill(join(sandbox.agents, 'two'), 'two')
    await refresh(page)

    // 两个条目分别在两个位置里，各自到对应视图里删
    const targets: { name: string; view: string; path: string }[] = [
      { name: 'one', view: 'Claude Code', path: join(sandbox.claude, 'one') },
      { name: 'two', view: 'Agents', path: join(sandbox.agents, 'two') },
    ]
    for (const target of targets) {
      await openView(page, 'location', target.view)
      await openRowMenu(page, target.name)
      await page.getByRole('menuitem', { name: '删除' }).click()
      await confirmDelete(page)
      await expect.poll(async () => exists(target.path)).toBe(false)
    }

    await openView(page, 'trash')
    await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(2)

    // 二次确认走应用内的 AlertDialog，不再用原生 confirm
    await page.getByRole('button', { name: '彻底删除 one' }).click()
    const purge = page.getByRole('alertdialog')
    await expect(purge.getByText('彻底删除 one？')).toBeVisible()
    await purge.getByRole('button', { name: '彻底删除', exact: true }).click()
    await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(1)

    await page.getByRole('button', { name: '清空回收站' }).click()
    const empty = page.getByRole('alertdialog')
    await expect(empty.getByText('清空回收站（1 个条目）？')).toBeVisible()
    await empty.getByRole('button', { name: '彻底删除', exact: true }).click()
    await expect(page.getByText('回收站是空的')).toBeVisible()
    expect(await readdir(sandbox.trash)).toEqual([])
  })
})

test.describe('内置与旧入口', () => {
  test('codex 内置锁定：不可链接、不可取消、不可删除', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.codex, '.system', 'sys-skill'), 'sys-skill')
    await refresh(page)

    await openView(page, 'location', 'Codex')
    // 「内置」筛选只在 Codex 视图提供
    await expect(page.getByRole('button', { name: /^内置/ })).toBeVisible()
    await expect(rowByName(page, 'sys-skill')).toBeVisible()

    await openRowMenu(page, 'sys-skill')
    await expect(page.getByRole('menuitem', { name: '链接…' })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: '删除' })).toBeDisabled()
    await page.keyboard.press('Escape')

    await openView(page, 'location', 'Agents')
    await expect(page.getByRole('button', { name: /^内置/ })).toHaveCount(0)
    expect(await exists(join(sandbox.codex, '.system', 'sys-skill', 'SKILL.md'))).toBe(true)
  })

  test('设置页展示四个存储位置与回收站目录，关闭行为自动保存', async ({ sandbox, page, shot }) => {
    await refresh(page)
    await openView(page, 'settings')

    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Claude Code' })).toHaveValue(sandbox.claude)
    await expect(page.getByRole('textbox', { name: 'Codex' })).toHaveValue(sandbox.codex)
    await expect(page.getByRole('textbox', { name: 'opencode' })).toHaveValue(sandbox.opencode)
    await expect(page.getByRole('textbox', { name: 'Agents' })).toHaveValue(sandbox.agents)
    await expect(page.getByText(`回收站目录 ${sandbox.trash}`)).toBeVisible()
    await expect(page.getByRole('textbox', { name: '真身目录' })).toHaveCount(0)
    await shot('e2e-07-settings')

    await page.getByRole('radio', { name: '最小化到托盘' }).check({ force: true })
    await expect
      .poll(async () => {
        const text = await readFile(join(sandbox.managed, 'config.json'), 'utf8')
        return (JSON.parse(text) as { closeBehavior?: string }).closeBehavior
      })
      .toBe('tray')
  })

  test('旧的中央仓库、未纳管与汇总入口都已移除', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await refresh(page)

    const aside = page.locator('aside')
    await expect(aside.getByText('中央仓库')).toHaveCount(0)
    await expect(aside.getByText('未纳管')).toHaveCount(0)
    await expect(aside.getByText('全部 Skill')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /导入/ })).toHaveCount(0)
    await expect(page.getByText('.skills-deck')).toHaveCount(0)

    await openView(page, 'dashboard')
    await expect(page.getByText(/未纳入中央仓库/)).toHaveCount(0)
  })
})
