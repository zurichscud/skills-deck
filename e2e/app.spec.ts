import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, openView, refresh, rowByName, test, toast } from './fixtures'
import { createLocalSkillRepo } from './git-repo'
import { seedSkill } from './sandbox'

test.describe('启动扫描与视图', () => {
  test('中央仓库列出真身，侧栏计数与状态筛选正确', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha', 'Alpha 技能')
    await seedSkill(join(sandbox.central, 'beta'), 'beta', 'Beta 技能')
    await seedSkill(join(sandbox.central, 'gamma'), 'gamma')
    await mkdir(sandbox.claude, { recursive: true })
    await symlink(join(sandbox.central, 'gamma'), join(sandbox.claude, 'gamma'), 'dir')
    await refresh(page)

    await openView(page, 'repository')
    await expect(page.getByRole('heading', { name: '中央仓库' })).toBeVisible()
    await expect(page.getByText(sandbox.central, { exact: true })).toBeVisible()
    await expect(rowByName(page, 'alpha')).toBeVisible()
    await expect(rowByName(page, 'beta')).toBeVisible()
    await expect(rowByName(page, 'gamma')).toBeVisible()
    await shot('e2e-01-repository-list')

    // 状态筛选：启用 = 至少链一处 → gamma；未启用 = alpha/beta
    await page.getByRole('button', { name: /^启用/ }).click()
    await expect(rowByName(page, 'gamma')).toBeVisible()
    await expect(rowByName(page, 'alpha')).toHaveCount(0)

    await page.getByRole('button', { name: /^未启用/ }).click()
    await expect(rowByName(page, 'alpha')).toBeVisible()
    await expect(rowByName(page, 'beta')).toBeVisible()
    await expect(rowByName(page, 'gamma')).toHaveCount(0)

    // 搜索
    await page.getByRole('button', { name: /^全部/ }).click()
    await page.getByLabel('搜索 skill').fill('bet')
    await expect(rowByName(page, 'beta')).toBeVisible()
    await expect(rowByName(page, 'alpha')).toHaveCount(0)
    await page.getByLabel('搜索 skill').fill('')

    // 侧栏中央仓库计数 = 3
    const repoNav = page
      .locator('aside > div')
      .filter({ has: page.locator('p:text-is("总览")') })
      .getByRole('button')
      .filter({ hasText: /^中央仓库/ })
      .first()
    await expect(repoNav).toContainText('3')
  })

  test('总览页展示统计与跳转；存储位置视图路径正确', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await seedSkill(join(sandbox.opencode, 'local-one'), 'local-one')
    await refresh(page)

    await openView(page, 'dashboard')
    await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()
    await expect(page.getByText('个 skill 在中央仓库')).toBeVisible()
    await expect(page.getByText(/发现 1 个未纳入中央仓库的 skill/)).toBeVisible()
    await shot('e2e-02-dashboard')

    await page.getByRole('button', { name: /全部 skill/ }).click()
    await expect(page.getByRole('heading', { name: '中央仓库' })).toBeVisible()

    await openView(page, 'location', 'opencode')
    await expect(page.getByRole('heading', { name: 'opencode' })).toBeVisible()
    await expect(page.getByText(sandbox.opencode, { exact: true })).toBeVisible()
    await expect(rowByName(page, 'local-one')).toBeVisible()
    await expect(rowByName(page, 'alpha')).toBeVisible()
    await shot('e2e-03-location-opencode')
  })

  test('工作区 opencode 读三处并集', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.central, 'c1'), 'c1')
    await seedSkill(join(sandbox.claude, 'from-claude'), 'from-claude')
    await seedSkill(join(sandbox.codex, 'from-codex'), 'from-codex')
    await refresh(page)

    await openView(page, 'workspace', 'opencode')
    await expect(page.getByRole('heading', { name: 'opencode' })).toBeVisible()
    await expect(rowByName(page, 'c1')).toBeVisible()
    await expect(rowByName(page, 'from-claude')).toBeVisible()
    await expect(rowByName(page, 'from-codex')).toBeVisible()
  })
})

test.describe('链接状态机', () => {
  test('建链/删链幂等，磁盘软链与 UI 同步', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await refresh(page)

    await openView(page, 'repository')
    const toggle = page.getByRole('button', { name: 'Claude Code 链接 alpha' })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toast(page, '已链接到 Claude Code')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Claude Code 取消链接 alpha' })).toBeVisible()
    await shot('e2e-04-linked')

    const linkPath = join(sandbox.claude, 'alpha')
    const st = await lstat(linkPath)
    expect(st.isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(join(sandbox.central, 'alpha'))

    await page.getByRole('button', { name: 'Claude Code 取消链接 alpha' }).click()
    await expect(toast(page, '已取消链接 Claude Code')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Claude Code 链接 alpha' })).toBeVisible()
    await expect(lstat(linkPath).then((s) => s.isSymbolicLink())).rejects.toThrow()
  })

  test('conflict 中止：不覆盖占用方，UI 报错', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await mkdir(join(sandbox.claude, 'alpha'), { recursive: true })
    await writeFile(join(sandbox.claude, 'alpha', 'KEEP'), 'occupied\n', 'utf8')
    await refresh(page)

    await openView(page, 'repository')
    const blocked = page.locator('button[data-source="claude"][title*="占用"]').first()
    await expect(blocked).toBeDisabled()
    await shot('e2e-05-conflict-disabled')

    expect(await readFile(join(sandbox.claude, 'alpha', 'KEEP'), 'utf8')).toBe('occupied\n')
    expect((await lstat(join(sandbox.claude, 'alpha'))).isDirectory()).toBe(true)
  })

  test('broken 残骸可替换为有效软链', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await symlink(join(sandbox.root, 'gone-target'), join(sandbox.claude, 'alpha'), 'dir')
    await refresh(page)

    await openView(page, 'repository')
    const brokenBtn = page.locator('button[data-source="claude"][data-state="broken"]')
    await expect(brokenBtn).toBeVisible()
    await brokenBtn.click()
    await expect(toast(page, '已链接到 Claude Code')).toBeVisible()

    const target = await readlink(join(sandbox.claude, 'alpha'))
    expect(target).toBe(join(sandbox.central, 'alpha'))
  })

  test('存储位置视图启用开关同样建链', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await refresh(page)
    await openView(page, 'location', 'Claude Code')

    const sw = page.getByRole('switch', { name: '启用 alpha（Claude Code）' })
    await expect(sw).toBeVisible()
    await sw.click()
    await expect(toast(page, '已链接到 Claude Code')).toBeVisible()
    expect((await lstat(join(sandbox.claude, 'alpha'))).isSymbolicLink()).toBe(true)
  })
})

test.describe('未纳管纳入', () => {
  test('检测横幅 → 由我决定 → 纳入中央仓库并留下软链', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.claude, 'solo'), 'solo', '未纳管技能')
    await refresh(page)

    await openView(page, 'dashboard')
    await expect(page.getByText(/发现 1 个未纳入中央仓库的 skill/)).toBeVisible()
    await page.getByRole('button', { name: /去处理/ }).click()
    await page.getByRole('menuitem', { name: /由我决定/ }).click()

    await expect(page.getByText('未纳管的 skill')).toBeVisible()
    await expect(page.getByText('solo', { exact: true }).first()).toBeVisible()
    await shot('e2e-06-migration-dialog')

    await page.getByRole('button', { name: /纳入中央仓库/ }).click()
    await expect(toast(page, '已纳入中央仓库')).toBeVisible()
    // 处理完后 total>0 → 「全部 1 项已处理完毕」；total=0 才是「没有需要处理的条目」
    await expect(page.getByText(/全部 1 项已处理完毕|没有需要处理的条目/)).toBeVisible()

    expect((await lstat(join(sandbox.central, 'solo'))).isDirectory()).toBe(true)
    expect((await lstat(join(sandbox.claude, 'solo'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(sandbox.claude, 'solo'))).toBe(join(sandbox.central, 'solo'))

    // 遮罩/Esc 无效，只能点页脚「关闭」
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: '未纳管的 skill' })).toHaveCount(0)
  })

  test('同名冲突：三选项之一 rename 并存', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.central, 'dup'), 'dup', '中央版本')
    await seedSkill(join(sandbox.codex, 'dup'), 'dup', '本地不同版本')
    await refresh(page)

    await openView(page, 'unmanaged')
    await expect(rowByName(page, 'dup')).toBeVisible()
    await page.getByRole('button', { name: '更多操作：dup' }).click()
    await page.getByRole('menuitem', { name: /纳入中央仓库/ }).click()
    await expect(page.getByText('同名冲突', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /两份并存/ }).click()
    await expect(toast(page, '已并存纳入中央仓库')).toBeVisible()

    expect((await lstat(join(sandbox.central, 'dup-2'))).isDirectory()).toBe(true)
    expect((await lstat(join(sandbox.codex, 'dup'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(sandbox.codex, 'dup'))).toBe(join(sandbox.central, 'dup-2'))
  })

  test('一键导入：无冲突全部纳入，冲突留下', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'clean-a'), 'clean-a')
    await seedSkill(join(sandbox.opencode, 'clean-b'), 'clean-b')
    await seedSkill(join(sandbox.central, 'clash'), 'clash')
    await seedSkill(join(sandbox.codex, 'clash'), 'clash')
    await refresh(page)

    await openView(page, 'dashboard')
    await page.getByRole('button', { name: /去处理/ }).click()
    await page.getByRole('menuitem', { name: /一键导入/ }).click()

    await expect(toast(page, '已纳入中央仓库 2 个 skill')).toBeVisible()
    await expect(toast(page, /1 个同名冲突需要你决定/)).toBeVisible()

    expect((await lstat(join(sandbox.central, 'clean-a'))).isDirectory()).toBe(true)
    expect((await lstat(join(sandbox.central, 'clean-b'))).isDirectory()).toBe(true)
    expect((await lstat(join(sandbox.codex, 'clash'))).isDirectory()).toBe(true)
    await expect(page.getByRole('heading', { name: '未纳管的 skill' })).toBeVisible()
  })
})

test.describe('删除', () => {
  test('删除中央真身：二次确认、清理软链、真身消失', async ({ sandbox, page, shot }) => {
    await seedSkill(join(sandbox.central, 'doomed'), 'doomed')
    await symlink(join(sandbox.central, 'doomed'), join(sandbox.claude, 'doomed'), 'dir')
    await symlink(join(sandbox.central, 'doomed'), join(sandbox.opencode, 'doomed'), 'dir')
    await refresh(page)

    await openView(page, 'repository')
    await page.getByRole('button', { name: '更多操作：doomed' }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()

    await expect(page.getByText('永久删除 doomed？')).toBeVisible()
    await expect(page.getByText(/将从中央仓库中永久删除真身/)).toBeVisible()
    await expect(page.getByText(/同时移除以下软链/)).toBeVisible()
    await shot('e2e-07-delete-dialog')

    await page.getByRole('button', { name: '永久删除', exact: true }).click()
    await expect(toast(page, '已永久删除 1 个 skill')).toBeVisible()

    await expect(rowByName(page, 'doomed')).toHaveCount(0)
    await expect(lstat(join(sandbox.central, 'doomed'))).rejects.toThrow()
    await expect(lstat(join(sandbox.claude, 'doomed'))).rejects.toThrow()
    await expect(lstat(join(sandbox.opencode, 'doomed'))).rejects.toThrow()
  })

  test('取消删除不改动磁盘', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.central, 'keep-me'), 'keep-me')
    await refresh(page)
    await openView(page, 'repository')
    await page.getByRole('button', { name: '更多操作：keep-me' }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('永久删除 keep-me？')).toHaveCount(0)
    await expect(rowByName(page, 'keep-me')).toBeVisible()
  })

  test('内置 skill 不可删除', async ({ sandbox, page }) => {
    await mkdir(join(sandbox.codex, '.system', 'sys-skill'), { recursive: true })
    await writeFile(
      join(sandbox.codex, '.system', 'sys-skill', 'SKILL.md'),
      '---\nname: sys-skill\ndescription: 内置\n---\n',
      'utf8',
    )
    await refresh(page)

    await openView(page, 'location', 'Codex')
    await page.getByRole('button', { name: /^内置/ }).click()
    await expect(rowByName(page, 'sys-skill')).toBeVisible()
    await page.getByRole('button', { name: '更多操作：sys-skill' }).click()
    const del = page.getByRole('menuitem', { name: '删除', exact: true })
    await expect(del).toBeDisabled()
  })
})

test.describe('从 Git 仓库安装', () => {
  test('本地仓库只安装 skills/，写入中央仓库', async ({ sandbox, page, shot }) => {
    const repo = await createLocalSkillRepo(sandbox.root, 'git-skill')
    await refresh(page)
    await openView(page, 'repository')
    await expect(page.getByText('这里还没有 skill')).toBeVisible()

    await page.getByRole('button', { name: /导入 skill/ }).click()
    await page.getByRole('menuitem', { name: /从 Git 仓库安装/ }).click()
    await expect(page.getByText('从 Git 仓库安装 skill')).toBeVisible()
    await page.getByLabel('Git 仓库地址').fill(repo)
    await shot('e2e-08-install-dialog')
    await page.getByRole('button', { name: '安装', exact: true }).click()

    await expect(toast(page, '已从仓库安装 1 个 skill')).toBeVisible()
    await expect(page.getByText(/已安装 1 个 skill 到中央仓库/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click()

    await expect(rowByName(page, 'git-skill')).toBeVisible()
    const skillMd = await readFile(join(sandbox.central, 'git-skill', 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('git-skill')
    await expect(lstat(join(sandbox.central, 'git-skill', 'docs'))).rejects.toThrow()
    await expect(lstat(join(sandbox.central, 'package.json'))).rejects.toThrow()
  })

  test('非法地址被拒绝', async ({ page }) => {
    await openView(page, 'repository')
    await page.getByRole('button', { name: /导入 skill/ }).click()
    await page.getByRole('menuitem', { name: /从 Git 仓库安装/ }).click()
    await page.getByLabel('Git 仓库地址').fill('https://example.com/has space/repo')
    await page.getByRole('button', { name: '安装', exact: true }).click()
    await expect(toast(page, /仓库地址不能包含空格/)).toBeVisible()
  })
})

test.describe('设置', () => {
  test('展示隔离路径与 git 状态；关闭行为自动保存', async ({ sandbox, page, shot, app }) => {
    await seedSkill(join(sandbox.central, 'alpha'), 'alpha')
    await refresh(page)
    await openView(page, 'settings')

    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '真身目录' })).toHaveValue(sandbox.central)
    await expect(page.getByRole('textbox', { name: 'Claude Code' })).toHaveValue(sandbox.claude)
    await expect(page.getByRole('textbox', { name: 'Codex' })).toHaveValue(sandbox.codex)
    await expect(page.getByRole('textbox', { name: 'opencode' })).toHaveValue(sandbox.opencode)
    await expect(page.getByText(`配置目录 ${sandbox.managed}`)).toBeVisible()
    await shot('e2e-09-settings')

    // 沙箱初始为 quit；改一次再改回来验证自动落盘
    await page.getByRole('radio', { name: '最小化到托盘' }).check({ force: true })
    await expect
      .poll(async () => {
        const text = await readFile(join(sandbox.managed, 'config.json'), 'utf8')
        return (JSON.parse(text) as { closeBehavior?: string }).closeBehavior
      })
      .toBe('tray')
    await page.getByRole('radio', { name: '退出应用' }).check({ force: true })

    await expect
      .poll(async () => {
        const text = await readFile(join(sandbox.managed, 'config.json'), 'utf8')
        return JSON.parse(text) as { closeBehavior?: string }
      })
      .toMatchObject({ closeBehavior: 'quit' })

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.reload()
    })
    await expect(page.getByText('Skills Deck').first()).toBeVisible()
    await expect(page.getByText('加载中…')).toHaveCount(0, { timeout: 15_000 })
    await openView(page, 'settings')
    await expect(page.getByRole('textbox', { name: '真身目录' })).toHaveValue(sandbox.central)
  })

  test('未纳管视图：批量纳入', async ({ sandbox, page }) => {
    await seedSkill(join(sandbox.claude, 'b1'), 'b1')
    await seedSkill(join(sandbox.codex, 'b2'), 'b2')
    await refresh(page)

    await openView(page, 'unmanaged')
    await expect(rowByName(page, 'b1')).toBeVisible()
    await expect(rowByName(page, 'b2')).toBeVisible()

    // Radix Checkbox 是 button[role=checkbox]
    await page.getByRole('checkbox', { name: '选择 b1' }).click()
    await page.getByRole('checkbox', { name: '选择 b2' }).click()
    await expect(page.getByText('已选')).toBeVisible()

    // 先确认渲染层选中集合与 unmanaged id 对齐（checkedInView 为空会静默 return）
    const selected = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('[role="checkbox"][aria-label^="选择 "]')]
      return boxes
        .filter((el) => el.getAttribute('data-state') === 'checked')
        .map((el) => el.getAttribute('aria-label'))
    })
    expect(selected.sort()).toEqual(['选择 b1', '选择 b2'])

    await page.getByRole('button', { name: '纳入管理', exact: true }).click()

    // 以磁盘为准（toast 可能被后续刷新顶掉）
    await expect
      .poll(
        async () => {
          try {
            return (await lstat(join(sandbox.central, 'b1'))).isDirectory()
          } catch {
            return false
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect
      .poll(
        async () => {
          try {
            return (await lstat(join(sandbox.central, 'b2'))).isDirectory()
          } catch {
            return false
          }
        },
        { timeout: 15_000 },
      )
      .toBe(true)

    expect((await lstat(join(sandbox.claude, 'b1'))).isSymbolicLink()).toBe(true)
    expect((await lstat(join(sandbox.codex, 'b2'))).isSymbolicLink()).toBe(true)

    await openView(page, 'unmanaged')
    await expect(page.getByText('这里还没有 skill')).toBeVisible()
  })
})
