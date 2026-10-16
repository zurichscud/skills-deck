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

/** 行内「更多操作」菜单（同名条目时用 typeText 定位到具体那一行） */
async function openRowMenu(page: Page, name: string, typeText?: string): Promise<void> {
  const trigger = typeText
    ? rowByType(page, name, typeText).getByRole('button', { name: `更多操作：${name}` })
    : page.getByRole('button', { name: `更多操作：${name}` })
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
}

function rowByType(page: Page, name: string, typeText: string): Locator {
  return page
    .locator('tbody tr')
    .filter({ hasText: typeText })
    .filter({ has: page.locator(`span[title="${name}"]`) })
}

/** 打开链接对话框，返回对话框 locator */
async function openLinkDialog(page: Page, name: string, typeText?: string): Promise<Locator> {
  await openRowMenu(page, name, typeText)
  await page.getByRole('menuitem', { name: '链接…' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function confirmDelete(page: Page): Promise<void> {
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '移入回收站', exact: true }).click()
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
    await expect(page.getByText('目录 · Claude Code')).toBeVisible()
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

    const dialog = await openLinkDialog(page, 'dup', '目录 · Claude Code')
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

    // 残骸自成一列，和本体那行同名 —— 按「类型」列定位到本体那行
    const dialog = await openLinkDialog(page, 'alpha', '目录 · Claude Code')
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
    await openRowMenu(page, 'dangling')
    await expect(page.getByRole('menuitem', { name: '链接…' })).toBeDisabled()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await confirmDelete(page)
    await expect.poll(async () => exists(join(sandbox.agents, 'dangling'))).toBe(false)
  })
})

test.describe('删除与回收站', () => {
  test('删除：本体与各处链接一起进回收站，恢复后回到原位', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.claude, 'alpha'), 'alpha')
    await refresh(page)

    const dialog = await openLinkDialog(page, 'alpha')
    await dialog.getByRole('checkbox', { name: /^Codex：/ }).click()
    await expect.poll(async () => exists(join(sandbox.codex, 'alpha'))).toBe(true)

    await openRowMenu(page, 'alpha')
    await page.getByRole('menuitem', { name: '删除' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByText('将 alpha 移入回收站？')).toBeVisible()
    await expect(confirm.getByText('回收站目录：')).toBeVisible()
    await shot('e2e-05-delete-confirm')
    await confirm.getByRole('button', { name: '移入回收站', exact: true }).click()
    await expect(toast(page, '已移入回收站：1 个 skill')).toBeVisible()

    await expect.poll(async () => exists(join(sandbox.claude, 'alpha'))).toBe(false)
    await expect.poll(async () => exists(join(sandbox.codex, 'alpha'))).toBe(false)
    // 目录 + 软链两条都进了回收站
    await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(2)

    await openView(page, 'trash')
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
    await expect(page.getByText('目录', { exact: true })).toBeVisible()
    await expect(page.getByText('软链', { exact: true })).toBeVisible()
    await shot('e2e-06-trash')

    // 两条都恢复（顺序由删除时间决定，不假设谁先谁后）
    for (const left of [1, 0]) {
      await page.getByRole('button', { name: '恢复 alpha' }).first().click()
      await expect.poll(async () => (await readdir(sandbox.trash)).length).toBe(left)
    }
    await expect(page.getByText('回收站是空的')).toBeVisible()
    expect(await readFile(join(sandbox.claude, 'alpha', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha',
    )
    expect(await readlink(join(sandbox.codex, 'alpha'))).toBe(
      await realpath(join(sandbox.claude, 'alpha')),
    )
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
