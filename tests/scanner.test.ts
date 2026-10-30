import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyPathOverrides } from '../src/main/paths'
import { scanAll } from '../src/main/scanner'

const ENV_KEYS = [
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
  'SKILLSDECK_SOURCE_ROOT_AGENTS',
] as const

let root: string
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-scan-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')
  process.env['SKILLSDECK_SOURCE_ROOT_AGENTS'] = join(root, 'agents')
  applyPathOverrides({ sourceRoots: {} })

  for (const s of ['claude', 'codex', 'opencode', 'agents']) {
    await mkdir(join(root, s), { recursive: true })
  }
})

afterEach(async () => {
  applyPathOverrides({ sourceRoots: {} })
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(root, { recursive: true, force: true })
})

describe('scanAll（临时目录集成）', () => {
  it('按内容归并：本体一个位置、其余位置是指向它的软链', async () => {
    await makeSkill(join(root, 'claude', 'vue'), 'vue')
    await symlink(join(root, 'claude', 'vue'), join(root, 'codex', 'vue'))
    await symlink(join(root, 'claude', 'vue'), join(root, 'agents', 'vue'))
    await symlink(join(root, 'gone'), join(root, 'opencode', 'vue'))

    const skills = await scanAll()
    const vue = skills.find((s) => s.relDir === 'vue' && s.links.claude.state === 'self')
    expect(vue?.id).toBe('claude:vue')
    expect(vue?.kind).toBe('skill')
    expect(vue?.home).toBe('claude')
    expect(vue?.links.claude.state).toBe('self')
    expect(vue?.links.codex.state).toBe('linked')
    expect(vue?.links.agents.state).toBe('linked')
    expect(vue?.links.opencode.state).toBe('broken')
    expect(vue?.broken).toBe(false)
    expect(vue?.files.some((f) => f.path === 'SKILL.md')).toBe(true)
  })

  it('同名但内容不同：各自成条目，并互相标记为被占用', async () => {
    await makeSkill(join(root, 'claude', 'dup'), 'dup')
    await makeSkill(join(root, 'codex', 'dup'), 'dup-local-copy')

    const skills = (await scanAll()).filter((s) => s.relDir === 'dup')
    expect(skills).toHaveLength(2)

    const inClaude = skills.find((s) => s.id === 'claude:dup')
    const inCodex = skills.find((s) => s.id === 'codex:dup')
    expect(inClaude?.links.claude.state).toBe('self')
    expect(inClaude?.links.codex.state).toBe('conflict')
    expect(inCodex?.links.codex.state).toBe('self')
    expect(inCodex?.links.claude.state).toBe('conflict')
  })

  it('内容在四个位置之外时 home 为 null，锚点取第一个有条目的位置', async () => {
    await makeSkill(join(root, 'outside', 'shared'), 'shared')
    await symlink(join(root, 'outside', 'shared'), join(root, 'codex', 'shared'))

    const skills = (await scanAll()).filter((s) => s.relDir === 'shared')
    expect(skills).toHaveLength(1)
    expect(skills[0]?.home).toBeNull()
    expect(skills[0]?.id).toBe('codex:shared')
    expect(skills[0]?.links.codex.state).toBe('linked')
    expect(skills[0]?.links.claude.state).toBe('absent')
  })

  it('codex .system 内置锁定为 native', async () => {
    await makeSkill(join(root, 'codex', '.system', 'imagegen'), 'imagegen')

    const skills = await scanAll()
    const builtin = skills.find((s) => s.id === 'builtin:.system/imagegen')
    expect(builtin?.kind).toBe('builtin')
    expect(builtin?.links.codex.state).toBe('native')
    expect(builtin?.links.claude.state).toBe('absent')
  })

  it('断链残骸自成一个条目，标记 broken 且路径指向链接本身', async () => {
    await symlink(join(root, 'nope'), join(root, 'opencode', 'dangling'))

    const skills = await scanAll()
    const dangling = skills.find((s) => s.relDir === 'dangling')
    expect(dangling?.broken).toBe(true)
    expect(dangling?.id).toBe('opencode:dangling')
    expect(dangling?.home).toBeNull()
    expect(dangling?.dirPath).toBe(join(root, 'opencode', 'dangling'))
    expect(dangling?.links.opencode.state).toBe('broken')
  })

  it('没有 SKILL.md 的目录不算 skill', async () => {
    await mkdir(join(root, 'agents', 'not-a-skill'), { recursive: true })
    await writeFile(join(root, 'agents', 'not-a-skill', 'readme.md'), '# nope\n')

    const skills = await scanAll()
    expect(skills.some((s) => s.relDir === 'not-a-skill')).toBe(false)
  })

  it('id 唯一', async () => {
    await makeSkill(join(root, 'claude', 'a'), 'a')
    await makeSkill(join(root, 'agents', 'b'), 'b')
    await makeSkill(join(root, 'codex', '.system', 'c'), 'c')
    const skills = await scanAll()
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length)
  })
})
