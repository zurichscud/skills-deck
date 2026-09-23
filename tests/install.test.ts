import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyPathOverrides } from '../src/main/paths'
import { SkillStore } from '../src/main/store'

const run = promisify(execFile)

const ENV_KEYS = [
  'SKILLSDECK_CENTRAL_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
  'SKILLSDECK_MANAGED_ROOT',
] as const

let root: string
let store: SkillStore
const saved: Record<string, string | undefined> = {}

async function git(cwd: string, args: string[]): Promise<void> {
  await run('git', ['--no-pager', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

async function makeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: desc\n---\n\n# ${name}\n`,
  )
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** 造一个本地 git 仓库当作「远端」，避免测试依赖网络 */
async function makeRemote(name: string): Promise<string> {
  const remote = join(root, name)
  await mkdir(remote, { recursive: true })
  await git(remote, ['init', '-q', '-b', 'main'])
  return remote
}

async function commit(remote: string): Promise<void> {
  await git(remote, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'])
  await git(remote, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-install-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_CENTRAL_ROOT'] = join(root, 'central')
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')
  process.env['SKILLSDECK_MANAGED_ROOT'] = join(root, 'managed')
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

describe('SkillStore.installFromGit', () => {
  it('只取 skills/ 目录：导入其中的 skill，忽略仓库其它内容', async () => {
    const remote = await makeRemote('remote')
    await makeSkill(join(remote, 'skills', 'alpha'), 'alpha')
    await makeSkill(join(remote, 'skills', 'group', 'beta'), 'beta')
    await mkdir(join(remote, 'skills', 'not-a-skill'), { recursive: true })
    await writeFile(join(remote, 'skills', 'not-a-skill', 'readme.md'), 'x')
    await mkdir(join(remote, 'docs'), { recursive: true })
    await writeFile(join(remote, 'docs', 'huge.md'), 'x'.repeat(2000))
    await commit(remote)

    const result = await store.installFromGit(remote)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.installed.map((i) => i.name).sort()).toEqual(['alpha', 'beta'])
    expect(result.failed).toEqual([])
    expect(await readFile(join(root, 'central', 'alpha', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha',
    )
    expect(await readFile(join(root, 'central', 'beta', 'SKILL.md'), 'utf8')).toContain(
      'name: beta',
    )
    // 仓库里的其它目录不会被带进中央仓库
    expect(await exists(join(root, 'central', 'docs'))).toBe(false)
    expect(await exists(join(root, 'central', 'not-a-skill'))).toBe(false)
    // 临时克隆目录已清理
    expect(await readdir(join(root, 'managed', 'tmp')).catch(() => [])).toEqual([])
  })

  it('同名冲突自动改名并存，不覆盖已有内容', async () => {
    await makeSkill(join(root, 'central', 'alpha'), 'alpha')
    await store.refresh()

    const remote = await makeRemote('remote')
    await makeSkill(join(remote, 'skills', 'alpha'), 'alpha-remote')
    await commit(remote)

    const result = await store.installFromGit(remote)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.installed).toEqual([{ source: 'alpha', name: 'alpha-2' }])
    expect(await readFile(join(root, 'central', 'alpha', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha\n',
    )
    expect(await readFile(join(root, 'central', 'alpha-2', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha-remote',
    )
  })

  it('仓库里没有 skills/ 目录时如实报错', async () => {
    const remote = await makeRemote('remote')
    await writeFile(join(remote, 'README.md'), '# no skills here\n')
    await commit(remote)

    const result = await store.installFromGit(remote)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('skills/')
  })

  it('地址为空或以 - 开头时直接拒绝', async () => {
    expect(await store.installFromGit('   ')).toMatchObject({ ok: false })
    expect(await store.installFromGit('--upload-pack=calc')).toMatchObject({ ok: false })
  })
})
