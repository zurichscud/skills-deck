import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentSettings, loadSettings, saveSettings } from '../src/main/config'
import { applyPathOverrides, centralRoot, sourceRootFor } from '../src/main/paths'
import type { AppSettings } from '../src/shared/types'

const ENV_KEYS = [
  'SKILLSDECK_MANAGED_ROOT',
  'SKILLSDECK_CENTRAL_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
] as const

let root: string
const saved: Record<string, string | undefined> = {}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-cfg-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_MANAGED_ROOT'] = join(root, 'managed')
  applyPathOverrides({ sourceRoots: {} })
})

afterEach(async () => {
  applyPathOverrides({ sourceRoots: {} })
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(root, { recursive: true, force: true })
})

function sample(): AppSettings {
  return {
    centralRoot: join(root, 'central'),
    sourceRoots: {
      claude: join(root, 'c'),
      codex: join(root, 'x'),
      opencode: join(root, 'o'),
    },
    closeBehavior: 'tray',
    menu: { order: [], hidden: [] },
  }
}

describe('config', () => {
  it('无配置文件时回退默认值，关闭行为默认 ask', async () => {
    const s = await loadSettings()
    expect(s.closeBehavior).toBe('ask')
    expect(s.centralRoot).toBe(join(homedir(), '.skills-deck', 'skills'))
    expect(sourceRootFor('claude')).toBeTruthy()
  })

  it('保存后写入 config.json 并可读回', async () => {
    await saveSettings(sample())
    const raw = JSON.parse(await readFile(join(root, 'managed', 'config.json'), 'utf8'))
    expect(raw.closeBehavior).toBe('tray')
    expect(raw.sourceRoots.claude).toBe(join(root, 'c'))
    expect(raw.centralRoot).toBe(join(root, 'central'))

    const s = await loadSettings()
    expect(s).toEqual(sample())
  })

  it('保存后 paths 立即生效（中央仓库与存储位置改址）', async () => {
    await saveSettings(sample())
    expect(sourceRootFor('claude')).toBe(join(root, 'c'))
    expect(sourceRootFor('opencode')).toBe(join(root, 'o'))
    expect(centralRoot()).toBe(join(root, 'central'))
  })

  it('非法 closeBehavior 回退 ask', async () => {
    await mkdir(join(root, 'managed'), { recursive: true })
    await writeFile(join(root, 'managed', 'config.json'), JSON.stringify({ closeBehavior: 'nope' }))
    const s = await loadSettings()
    expect(s.closeBehavior).toBe('ask')
  })

  it('损坏的配置文件不抛出', async () => {
    await mkdir(join(root, 'managed'), { recursive: true })
    await writeFile(join(root, 'managed', 'config.json'), '{{{ not json')
    const s = await loadSettings()
    expect(s.closeBehavior).toBe('ask')
    expect(currentSettings().sourceRoots.claude).toBeTruthy()
  })

  it('环境变量优先于配置（测试隔离）', async () => {
    await saveSettings(sample())
    process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'from-env')
    await loadSettings()
    expect(sourceRootFor('claude')).toBe(join(root, 'from-env'))
  })

  it('菜单显隐与排序持久化，非法 id 被过滤', async () => {
    await saveSettings({
      ...sample(),
      menu: {
        order: ['workspace:opencode', 'location:claude'],
        hidden: ['location:codex', 'bogus'] as AppSettings['menu']['hidden'],
      },
    })
    const s = await loadSettings()
    expect(s.menu.order).toEqual(['workspace:opencode', 'location:claude'])
    expect(s.menu.hidden).toEqual(['location:codex'])
  })

  it('常驻项（Dashboard / 全部 Skill）不参与菜单配置', async () => {
    await saveSettings({
      ...sample(),
      menu: {
        order: ['dashboard', 'repository', 'workspace:codex'],
        hidden: ['dashboard', 'repository', 'workspace:claude'],
      } as AppSettings['menu'],
    })
    const s = await loadSettings()
    expect(s.menu.order).toEqual(['workspace:codex'])
    expect(s.menu.hidden).toEqual(['workspace:claude'])
  })

  it('缺失或损坏的 menu 回退默认', async () => {
    await mkdir(join(root, 'managed'), { recursive: true })
    await writeFile(
      join(root, 'managed', 'config.json'),
      JSON.stringify({ menu: { order: 'nope', hidden: [1, 'location:codex', 'location:codex'] } }),
    )
    const s = await loadSettings()
    expect(s.menu.order).toEqual([])
    expect(s.menu.hidden).toEqual(['location:codex'])
  })
})
