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
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-store-'))
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

  await makeSkill(join(root, 'central', 'alpha'), 'alpha')
  await makeSkill(join(root, 'central', 'beta'), 'beta')

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

describe('SkillStore.link / unlink', () => {
  it('链接：在目标位置创建指向真身的软链，真身不动', async () => {
    const r = await store.link('central:alpha', 'claude')
    expect(r).toEqual({ ok: true })

    const link = join(root, 'claude', 'alpha')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(join(root, 'central', 'alpha'))
    expect(await exists(join(root, 'central', 'alpha', 'SKILL.md'))).toBe(true)
    expect(store.get('central:alpha')?.links.claude.state).toBe('linked')
  })

  it('链接幂等：已链接时直接成功', async () => {
    await store.link('central:alpha', 'claude')
    expect(await store.link('central:alpha', 'claude')).toEqual({ ok: true })
  })

  it('目标被真实目录占用时中止并返回 CONFLICT，两侧均不破坏', async () => {
    await makeSkill(join(root, 'claude', 'alpha'), 'local-alpha')
    await writeFile(join(root, 'claude', 'alpha', 'marker.txt'), 'keep')
    await store.refresh()

    const r = await store.link('central:alpha', 'claude')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT')
      expect(r.conflictAt).toContain('alpha')
    }
    expect(await readFile(join(root, 'claude', 'alpha', 'marker.txt'), 'utf8')).toBe('keep')
  })

  it('断链残骸可被替换为正确链接', async () => {
    await symlink(join(root, 'gone'), join(root, 'claude', 'alpha'))
    await store.refresh()
    expect(store.get('central:alpha')?.links.claude.state).toBe('broken')

    expect(await store.link('central:alpha', 'claude')).toEqual({ ok: true })
    expect(await readlink(join(root, 'claude', 'alpha'))).toBe(join(root, 'central', 'alpha'))
  })

  it('取消链接：只删链接本体，真身保留', async () => {
    await store.link('central:alpha', 'opencode')
    expect(await store.unlink('central:alpha', 'opencode')).toEqual({ ok: true })

    expect(await exists(join(root, 'opencode', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'central', 'alpha', 'SKILL.md'))).toBe(true)
    expect(store.get('central:alpha')?.links.opencode.state).toBe('absent')
  })

  it('取消链接幂等，且不触碰别处的同名目录', async () => {
    expect(await store.unlink('central:alpha', 'codex')).toEqual({ ok: true })

    await makeSkill(join(root, 'codex', 'alpha'), 'local-alpha')
    await store.refresh()
    const r = await store.unlink('central:alpha', 'codex')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CONFLICT')
    expect(await exists(join(root, 'codex', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('内置与未纳管条目拒绝链接操作', async () => {
    await makeSkill(join(root, 'codex', '.system', 'img'), 'img')
    await makeSkill(join(root, 'claude', 'stray'), 'stray')
    await store.refresh()

    const a = await store.link('builtin:codex:.system/img', 'claude')
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.code).toBe('LOCKED')

    const b = await store.link('external:claude:stray', 'codex')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.code).toBe('LOCKED')
  })

  it('未知 id 返回 NOT_FOUND', async () => {
    const r = await store.link('central:nope', 'claude')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })
})

describe('SkillStore.deleteSkill', () => {
  it('中央真身：删除目录并清理三处软链', async () => {
    await store.link('central:alpha', 'claude')
    await store.link('central:alpha', 'codex')
    await store.link('central:alpha', 'opencode')

    expect(await store.deleteSkill('central:alpha')).toEqual({ ok: true })
    expect(await exists(join(root, 'central', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'claude', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'codex', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'opencode', 'alpha'))).toBe(false)
    expect(store.get('central:alpha')).toBeUndefined()
  })

  it('未链接的真身：直接删除', async () => {
    expect(await store.deleteSkill('central:beta')).toEqual({ ok: true })
    expect(await exists(join(root, 'central', 'beta'))).toBe(false)
  })

  it('不清理指向别处的同名条目', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'local-alpha')
    await store.refresh()

    await store.deleteSkill('central:alpha')
    expect(await exists(join(root, 'codex', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('未纳管条目：只删除自身', async () => {
    await makeSkill(join(root, 'claude', 'stray'), 'stray')
    await store.refresh()

    expect(await store.deleteSkill('external:claude:stray')).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'stray'))).toBe(false)
  })

  it('未纳管的断链：只删链接残骸', async () => {
    await symlink(join(root, 'gone-dir'), join(root, 'claude', 'dangling'))
    await store.refresh()
    expect(await store.deleteSkill('external:claude:dangling')).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'dangling'))).toBe(false)
  })

  it('内置拒绝删除', async () => {
    await makeSkill(join(root, 'codex', '.system', 'img'), 'img')
    await store.refresh()
    const r = await store.deleteSkill('builtin:codex:.system/img')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('LOCKED')
    expect(await exists(join(root, 'codex', '.system', 'img', 'SKILL.md'))).toBe(true)
  })
})

describe('SkillStore.importSkill', () => {
  it('复制进中央仓库，源目录保留', async () => {
    const src = join(root, 'incoming', 'gamma')
    await makeSkill(src, 'gamma')

    const r = await store.importSkill(src)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('gamma')

    expect(await exists(join(root, 'central', 'gamma', 'SKILL.md'))).toBe(true)
    expect(await exists(join(root, 'central', 'gamma', 'references', 'a.md'))).toBe(true)
    expect(await exists(join(src, 'SKILL.md'))).toBe(true)
    expect(store.get('central:gamma')).toBeTruthy()
  })

  it('解引用导入软链来源，产物是独立真身', async () => {
    await mkdir(join(root, 'incoming'), { recursive: true })
    await symlink(join(root, 'central', 'alpha'), join(root, 'incoming', 'link-src'))

    const r = await store.importSkill(join(root, 'incoming', 'link-src'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('link-src')

    const dest = join(root, 'central', 'link-src')
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    await writeFile(join(dest, 'only-in-copy.txt'), 'x')
    expect(await exists(join(root, 'central', 'alpha', 'only-in-copy.txt'))).toBe(false)
  })

  it('同名时自动改名共存', async () => {
    const src = join(root, 'incoming', 'alpha')
    await makeSkill(src, 'alpha-new')

    const r = await store.importSkill(src)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('alpha-2')
    expect((await readdir(join(root, 'central'))).sort()).toContain('alpha-2')
  })

  it('overwrite 时替换同名真身', async () => {
    const src = join(root, 'incoming', 'alpha')
    await makeSkill(src, 'alpha-new')

    const r = await store.importSkill(src, { overwrite: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('alpha')
    expect(await readFile(join(root, 'central', 'alpha', 'SKILL.md'), 'utf8')).toContain(
      'name: alpha-new',
    )
  })

  it('缺少 SKILL.md 的目录被拒绝', async () => {
    await mkdir(join(root, 'incoming', 'not-a-skill'), { recursive: true })
    const r = await store.importSkill(join(root, 'incoming', 'not-a-skill'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })
})

describe('SkillStore.readFile', () => {
  it('拒绝路径越界', async () => {
    const r = await store.readFile('central:alpha', '../../../etc/passwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('IO')
  })

  it('可读 skill 内文件', async () => {
    const r = await store.readFile('central:alpha', 'references/a.md')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toContain('# ref')
  })
})
