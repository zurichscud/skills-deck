import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'

import { createSandbox, destroySandbox, type Sandbox } from './sandbox'

// Playwright 以 CJS 加载本仓库（package.json 无 type:module），不能用 import.meta
const projectRoot = process.cwd()
const artifactsDir = join(projectRoot, 'e2e', 'artifacts')

export interface Fixtures {
  sandbox: Sandbox
  app: ElectronApplication
  page: Page
  /** 截图落到 e2e/artifacts/，作为可复现工件 */
  shot: (name: string) => Promise<void>
}

export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright 无依赖夹具的固定签名
  sandbox: async ({}, use) => {
    const sandbox = await createSandbox()
    await use(sandbox)
    await destroySandbox(sandbox)
  },

  app: async ({ sandbox }, use) => {
    // 必须先 build 出 out/；生产主入口 package.json → out/main/index.js
    if (!existsSync(join(projectRoot, 'out', 'main', 'index.js'))) {
      throw new Error('缺少 out/main/index.js，请先运行 npm run build')
    }
    const app = await electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: {
        ...process.env,
        SKILLSDECK_SOURCE_ROOT_CLAUDE: sandbox.claude,
        SKILLSDECK_SOURCE_ROOT_CODEX: sandbox.codex,
        SKILLSDECK_SOURCE_ROOT_OPENCODE: sandbox.opencode,
        SKILLSDECK_SOURCE_ROOT_AGENTS: sandbox.agents,
        SKILLSDECK_MANAGED_ROOT: sandbox.managed,
        SKILLSDECK_TRASH_ROOT: sandbox.trash,
        // 不显示窗口、不占 Dock：跑测试时不打扰正在用电脑的人
        SKILLSDECK_HEADLESS: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
    })
    await use(app)
    // macOS 上 window-all-closed 不会自动 quit；先主动退出再 close，避免 worker 挂死
    await app
      .evaluate(({ app: electronApp }) => {
        electronApp.quit()
      })
      .catch(() => undefined)
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((r) => setTimeout(r, 5_000)),
    ])
    // 兜底：进程若还活着直接杀，防止占住调试端口影响下一用例
    try {
      const proc = app.process()
      if (proc && proc.exitCode === null) {
        proc.kill('SIGKILL')
        await new Promise((r) => setTimeout(r, 200))
      }
    } catch {
      /* 已退出 */
    }
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow({ timeout: 45_000 })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText('Skills Deck').first()).toBeVisible({ timeout: 30_000 })
    // 等首屏扫描结束（工具条不再显示「加载中…」）
    await expect(page.getByText('加载中…')).toHaveCount(0, { timeout: 15_000 })
    // 装上「窗口有没有被显示过」的计数钩子，用例结束前核对，防止回归成弹窗打扰用户
    await app.evaluate(({ BrowserWindow }) => {
      const guard = globalThis as unknown as { skillsdeckShown?: number }
      guard.skillsdeckShown = 0
      const count = (): void => {
        guard.skillsdeckShown = (guard.skillsdeckShown ?? 0) + 1
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isVisible()) count()
        win.on('show', count)
      }
    })
    await use(page)
    const shown = await app.evaluate(
      () => (globalThis as unknown as { skillsdeckShown?: number }).skillsdeckShown ?? 0,
    )
    expect(shown, 'E2E 期间不应有任何窗口被显示（SKILLSDECK_HEADLESS 失效了？）').toBe(0)
  },

  shot: async ({ page }, use) => {
    await use(async (name: string) => {
      await mkdir(artifactsDir, { recursive: true })
      // 直接抓渲染面（fromSurface: false）：不等 compositor 出帧，隐藏窗口也能拿到图
      const session = await page.context().newCDPSession(page)
      try {
        const shot = await session.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: false,
        })
        await writeFile(join(artifactsDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
      } finally {
        await session.detach().catch(() => undefined)
      }
    })
  },
})

export { expect }
export type { ElectronApplication, Page }

/**
 * 侧栏按钮：可访问名含右侧计数（如「全部 Skill 0」），不能 exact 匹配。
 * 按分组 div（含 p 标题）过滤，消解「存储位置 / 工作区」同名项。
 */
function sidebarGroup(page: Page, group: string): Locator {
  return page.locator('aside > div').filter({ has: page.locator(`p:text-is("${group}")`) })
}

function sidebarButton(page: Page, group: string, label: string): Locator {
  return sidebarGroup(page, group)
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${label}`) })
    .first()
}

export function navItem(page: Page, group: string, label: string): Locator {
  return sidebarButton(page, group, label)
}

export async function openView(
  page: Page,
  kind: 'dashboard' | 'trash' | 'settings' | 'location' | 'workspace',
  label?: string,
): Promise<void> {
  if (kind === 'dashboard') {
    await sidebarButton(page, '总览', '总览').click()
    return
  }
  if (kind === 'trash') {
    await sidebarButton(page, '总览', '回收站').click()
    return
  }
  if (kind === 'settings') {
    await page
      .locator('aside')
      .getByRole('button')
      .filter({ hasText: /^设置/ })
      .last()
      .click()
    return
  }
  if (!label) throw new Error('location/workspace 视图需要 label')
  const group = kind === 'location' ? '存储位置' : '工作区'
  await sidebarButton(page, group, label).click()
}

/** 等待 sonner toast 出现 */
export function toast(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

/** 表格里的名称单元格（title 精确等于 skill 名，避开描述/路径 title 撞车） */
export function rowByName(page: Page, name: string): Locator {
  return page.locator(`span[title="${name}"]`)
}

/**
 * 应用启动后种子写入磁盘时，watcher 会刷新列表，
 * 但侧栏计数与回收站计数只在 mount / 点击刷新时重拉——播种后统一点一次刷新。
 * 刷新按钮只在列表视图（存储位置 / 工作区）里，因此先落到一个固定的位置视图。
 */
export async function refresh(page: Page): Promise<void> {
  await openView(page, 'location', 'Claude Code')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('加载中…')).toHaveCount(0, { timeout: 15_000 })
  // 给 watcher debounce + IPC 广播一点时间
  await page.waitForTimeout(400)
}
