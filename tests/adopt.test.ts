import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyPathOverrides } from '../src/main/paths'
import { scanUnmanaged } from '../src/main/scanner'
import { SkillStore } from '../src/main/store'

const ENV_KEYS = [
  'SKILLSDECK_CENTRAL_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
] as const

let root: string
let store: SkillStore
const saved: Record<string, string | undefined> = {}

async function makeSkill(dir: string, name: string, description = 'desc'): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
  await mkdir(join(dir, 'references'), { recursive: true })
  await writeFile(join(dir, 'references', 'a.md'), '# ref\n')
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-adopt-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_CENTRAL_ROOT'] = join(root, 'central')
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')
  applyPathOverrides({ sourceRoots: {} })

  for (const s of ['claude', 'codex', 'opencode']) {
    await mkdir(join(root, s), { recursive: true })
  }
  store = new SkillStore()
  await store.init()
})

afterEach(async () => {
  applyPathOverrides({ sourceRoots: {} })
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(root, { recursive: true, force: true })
})

describe('scanUnmanaged', () => {
  it('列出三个位置里未纳管的 skill，并标注来源与是否软链', async () => {
    await makeSkill(join(root, 'claude', 'local-a'), 'local-a')
    await mkdir(join(root, 'codex'), { recursive: true })
    await symlink(join(root, 'elsewhere', 'local-b'), join(root, 'codex', 'local-b'))

    const items = await scanUnmanaged()
    const a = items.find((i) => i.id === 'claude:local-a')
    expect(a?.source).toBe('claude')
    expect(a?.conflict).toBe(false)
    expect(a?.isSymlink).toBe(false)
    // 断链没有内容可纳入，不出现在列表里
    expect(items.find((i) => i.id === 'codex:local-b')).toBeUndefined()
  })

  it('中央仓库已有同名时标记 conflict，并区分内容是否一致', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue', 'desc')
    await makeSkill(join(root, 'opencode', 'other'), 'other')
    await store.refresh()

    const items = await scanUnmanaged()
    const same = items.find((i) => i.id === 'claude:vue')
    expect(same?.conflict).toBe(true)
    expect(same?.identical).toBe(true)

    const fresh = items.find((i) => i.id === 'opencode:other')
    expect(fresh?.conflict).toBe(false)
  })

  it('内容不同时 identical 为 false', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local')
    await store.refresh()

    const items = await scanUnmanaged()
    expect(items.find((i) => i.id === 'claude:vue')?.identical).toBe(false)
  })

  it('忽略 .system 内置与非 skill 目录', async () => {
    await makeSkill(join(root, 'codex', '.system', 'imagegen'), 'imagegen')
    await mkdir(join(root, 'claude', 'not-a-skill'), { recursive: true })
    await writeFile(join(root, 'claude', 'not-a-skill', 'readme.md'), 'x')

    expect(await scanUnmanaged()).toHaveLength(0)
  })

  it('已指向中央仓库的软链不算未纳管', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await symlink(join(root, 'central', 'vue'), join(root, 'claude', 'vue'))
    await store.refresh()

    expect(await scanUnmanaged()).toHaveLength(0)
  })
})

describe('SkillStore.adoptUnmanaged', () => {
  it('adopt：真身移入中央仓库并原地建链', async () => {
    await makeSkill(join(root, 'claude', 'local-a'), 'local-a')
    await store.refresh()

    expect(await store.adoptUnmanaged('claude:local-a', 'adopt')).toEqual({ ok: true })

    expect(await exists(join(root, 'central', 'local-a', 'SKILL.md'))).toBe(true)
    expect(await exists(join(root, 'central', 'local-a', 'references', 'a.md'))).toBe(true)
    expect((await lstat(join(root, 'claude', 'local-a'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(root, 'claude', 'local-a'))).toBe(join(root, 'central', 'local-a'))
    expect(await scanUnmanaged()).toHaveLength(0)
  })

  it('adopt：软链来源被解引用，得到独立真身', async () => {
    await makeSkill(join(root, 'elsewhere', 'shared'), 'shared')
    await mkdir(join(root, 'opencode'), { recursive: true })
    await symlink(join(root, 'elsewhere', 'shared'), join(root, 'opencode', 'shared'))
    await store.refresh()

    expect(await store.adoptUnmanaged('opencode:shared', 'adopt')).toEqual({ ok: true })

    const centralDir = join(root, 'central', 'shared')
    expect((await lstat(centralDir)).isSymbolicLink()).toBe(false)
    expect(await readlink(join(root, 'opencode', 'shared'))).toBe(centralDir)
    // 原真身不受影响
    expect(await exists(join(root, 'elsewhere', 'shared', 'SKILL.md'))).toBe(true)
  })

  it('adopt：同名时返回 CONFLICT，两侧都不破坏', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local')
    await writeFile(join(root, 'claude', 'vue', 'marker.txt'), 'keep')
    await store.refresh()

    const r = await store.adoptUnmanaged('claude:vue', 'adopt')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CONFLICT')
    expect(await readFile(join(root, 'claude', 'vue', 'marker.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(root, 'central', 'vue', 'SKILL.md'), 'utf8')).toContain('name: vue')
  })

  it('overwrite：用本地覆盖中央版本', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local')
    await store.refresh()

    expect(await store.adoptUnmanaged('claude:vue', 'overwrite')).toEqual({ ok: true })

    expect(await readFile(join(root, 'central', 'vue', 'SKILL.md'), 'utf8')).toContain(
      'name: vue-local',
    )
    expect(await readlink(join(root, 'claude', 'vue'))).toBe(join(root, 'central', 'vue'))
  })

  it('rename：两份并存，本地原地建链指向新名字', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local')
    await store.refresh()

    expect(await store.adoptUnmanaged('claude:vue', 'rename')).toEqual({ ok: true })

    expect(await readFile(join(root, 'central', 'vue', 'SKILL.md'), 'utf8')).toContain('name: vue')
    expect(await readFile(join(root, 'central', 'vue-2', 'SKILL.md'), 'utf8')).toContain(
      'name: vue-local',
    )
    expect(await readlink(join(root, 'claude', 'vue'))).toBe(join(root, 'central', 'vue-2'))
  })

  it('keep：保留中央版本，本地改为指向它的链接', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local')
    await store.refresh()

    expect(await store.adoptUnmanaged('claude:vue', 'keep')).toEqual({ ok: true })

    expect(await readFile(join(root, 'central', 'vue', 'SKILL.md'), 'utf8')).toContain('name: vue')
    expect((await lstat(join(root, 'claude', 'vue'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(root, 'claude', 'vue'))).toBe(join(root, 'central', 'vue'))
  })

  it('keep：中央仓库没有同名时返回 NOT_FOUND', async () => {
    await makeSkill(join(root, 'claude', 'lonely'), 'lonely')
    await store.refresh()
    const r = await store.adoptUnmanaged('claude:lonely', 'keep')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })

  it('未知条目返回 NOT_FOUND', async () => {
    const r = await store.adoptUnmanaged('claude:nope', 'adopt')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })

  it('逐个纳入互不影响，处理完列表自然清空', async () => {
    await makeSkill(join(root, 'claude', 'a'), 'a')
    await makeSkill(join(root, 'codex', 'b'), 'b')
    await makeSkill(join(root, 'opencode', 'c'), 'c')
    await store.refresh()

    expect(await scanUnmanaged()).toHaveLength(3)
    await store.adoptUnmanaged('codex:b', 'adopt')
    expect((await scanUnmanaged()).map((i) => i.id)).toEqual(['claude:a', 'opencode:c'])
    await store.adoptUnmanaged('opencode:c', 'adopt')
    await store.adoptUnmanaged('claude:a', 'adopt')
    expect(await scanUnmanaged()).toHaveLength(0)
    expect((await readdir(join(root, 'central'))).filter((n) => !n.startsWith('.')).sort()).toEqual(
      ['a', 'b', 'c'],
    )
  })
})
