import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyPathOverrides } from '../src/main/paths'
import { scanAll } from '../src/main/scanner'

const ENV_KEYS = [
  'SKILLSDECK_CENTRAL_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
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
  process.env['SKILLSDECK_CENTRAL_ROOT'] = join(root, 'central')
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')
  applyPathOverrides({ sourceRoots: {} })

  for (const s of ['claude', 'codex', 'opencode']) {
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
  it('中央仓库真身带出三处链接状态', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await symlink(join(root, 'central', 'vue'), join(root, 'claude', 'vue'))
    await symlink(join(root, 'central', 'vue'), join(root, 'codex', 'vue'))
    await symlink(join(root, 'gone'), join(root, 'opencode', 'vue'))

    const skills = await scanAll()
    const vue = skills.find((s) => s.id === 'central:vue')
    expect(vue).toBeTruthy()
    expect(vue?.kind).toBe('central')
    expect(vue?.links.claude.state).toBe('linked')
    expect(vue?.links.codex.state).toBe('linked')
    expect(vue?.links.opencode.state).toBe('broken')
    expect(vue?.files.some((f) => f.path === 'SKILL.md')).toBe(true)
  })

  it('被真实目录占用时标记为 conflict，绝不当作已链接', async () => {
    await makeSkill(join(root, 'central', 'vue'), 'vue')
    await makeSkill(join(root, 'claude', 'vue'), 'vue-local-copy')

    const skills = await scanAll()
    expect(skills.find((s) => s.id === 'central:vue')?.links.claude.state).toBe('conflict')
    // 同时作为未纳管条目出现
    const external = skills.find((s) => s.id === 'external:claude:vue')
    expect(external?.kind).toBe('external')
    expect(external?.origin).toBe('claude')
  })

  it('codex .system 内置锁定为 native，且不产生 external 条目', async () => {
    await makeSkill(join(root, 'codex', '.system', 'imagegen'), 'imagegen')

    const skills = await scanAll()
    const builtin = skills.find((s) => s.id === 'builtin:codex:.system/imagegen')
    expect(builtin?.kind).toBe('builtin')
    expect(builtin?.links.codex.state).toBe('native')
    expect(builtin?.links.claude.state).toBe('absent')
    expect(skills.some((s) => s.kind === 'external')).toBe(false)
  })

  it('断链残骸被列为未纳管条目', async () => {
    await symlink(join(root, 'nope'), join(root, 'opencode', 'dangling'))

    const skills = await scanAll()
    const dangling = skills.find((s) => s.id === 'external:opencode:dangling')
    expect(dangling?.kind).toBe('external')
    expect(dangling?.links.opencode.state).toBe('broken')
  })

  it('id 唯一', async () => {
    await makeSkill(join(root, 'central', 'a'), 'a')
    await makeSkill(join(root, 'claude', 'b'), 'b')
    await makeSkill(join(root, 'codex', '.system', 'c'), 'c')
    const skills = await scanAll()
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length)
  })
})
