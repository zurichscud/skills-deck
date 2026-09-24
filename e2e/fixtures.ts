import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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
        SKILLSDECK_CENTRAL_ROOT: sandbox.central,
        SKILLSDECK_SOURCE_ROOT_CLAUDE: sandbox.claude,
        SKILLSDECK_SOURCE_ROOT_CODEX: sandbox.codex,
        SKILLSDECK_SOURCE_ROOT_OPENCODE: sandbox.opencode,
        SKILLSDECK_MANAGED_ROOT: sandbox.managed,
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
    await use(page)
  },

  shot: async ({ page }, use) => {
    await use(async (name: string) => {
      await mkdir(artifactsDir, { recursive: true })
      await page.screenshot({
        path: join(artifactsDir, `${name}.png`),
        fullPage: false,
      })
    })
  },
})

export { expect }
export type { ElectronApplication, Page }

/**
 * 侧栏按钮：可访问名含右侧计数（如「中央仓库 0」），不能 exact 匹配。
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
  kind: 'dashboard' | 'repository' | 'unmanaged' | 'settings' | 'location' | 'workspace',
  label?: string,
): Promise<void> {
  if (kind === 'dashboard') {
    await sidebarButton(page, '总览', '总览').click()
    return
  }
  if (kind === 'repository') {
    await sidebarButton(page, '总览', '中央仓库').click()
    return
  }
  if (kind === 'unmanaged') {
    await sidebarButton(page, '总览', '未纳管').click()
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
 * 但未纳管横幅只在 mount / 点击刷新时重拉——播种后统一点一次刷新。
 */
export async function refresh(page: Page): Promise<void> {
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('加载中…')).toHaveCount(0, { timeout: 15_000 })
  // 给 watcher debounce + IPC 广播一点时间
  await page.waitForTimeout(400)
}
