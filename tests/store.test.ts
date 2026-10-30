import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyPathOverrides, trashRoot } from '../src/main/paths'
import { SkillStore } from '../src/main/store'

const ENV_KEYS = [
  'SKILLSDECK_MANAGED_ROOT',
  'SKILLSDECK_TRASH_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE',
  'SKILLSDECK_SOURCE_ROOT_AGENTS',
] as const

let root: string
let store: SkillStore
const saved: Record<string, string | undefined> = {}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

async function makeSkill(dir: string, name: string, description = 'desc'): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
  await mkdir(join(dir, 'references'), { recursive: true })
  await writeFile(join(dir, 'references', 'a.md'), '# ref\n')
}

/** 链接目标是解析后的真实路径（macOS 上临时目录带 /private 前缀） */
function alphaReal(): Promise<string> {
  return realpath(join(root, 'claude', 'alpha'))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-store-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_MANAGED_ROOT'] = join(root, 'managed')
  process.env['SKILLSDECK_TRASH_ROOT'] = join(root, 'trash')
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')
  process.env['SKILLSDECK_SOURCE_ROOT_AGENTS'] = join(root, 'agents')
  applyPathOverrides({ sourceRoots: {} })

  for (const s of ['claude', 'codex', 'opencode', 'agents']) {
    await mkdir(join(root, s), { recursive: true })
  }

  await makeSkill(join(root, 'claude', 'alpha'), 'alpha')
  await makeSkill(join(root, 'agents', 'beta'), 'beta')

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
  it('链接：在目标位置创建指向本体的软链，本体不动', async () => {
    const r = await store.link('claude:alpha', 'codex')
    expect(r).toEqual({ ok: true })

    const link = join(root, 'codex', 'alpha')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(await alphaReal())
    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
    expect(store.get('claude:alpha')?.links.codex.state).toBe('linked')
  })

  it('链接幂等：已链接时直接成功', async () => {
    await store.link('claude:alpha', 'codex')
    expect(await store.link('claude:alpha', 'codex')).toEqual({ ok: true })
  })

  it('本体所在位置拒绝链接', async () => {
    const r = await store.link('claude:alpha', 'claude')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CONFLICT')
  })

  it('目标被真实目录占用时中止并返回 CONFLICT，两侧均不破坏', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'local-alpha')
    await writeFile(join(root, 'codex', 'alpha', 'marker.txt'), 'keep')
    await store.refresh()

    const r = await store.link('claude:alpha', 'codex')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT')
      expect(r.conflictAt).toContain('alpha')
    }
    expect(await readFile(join(root, 'codex', 'alpha', 'marker.txt'), 'utf8')).toBe('keep')
  })

  it('断链残骸可被替换为正确链接', async () => {
    await symlink(join(root, 'gone'), join(root, 'codex', 'alpha'))
    await store.refresh()
    expect(store.get('claude:alpha')?.links.codex.state).toBe('broken')

    expect(await store.link('claude:alpha', 'codex')).toEqual({ ok: true })
    expect(await readlink(join(root, 'codex', 'alpha'))).toBe(await alphaReal())
  })

  it('取消链接：只删链接本体，内容保留', async () => {
    await store.link('claude:alpha', 'opencode')
    expect(await store.unlink('claude:alpha', 'opencode')).toEqual({ ok: true })

    expect(await exists(join(root, 'opencode', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
    expect(store.get('claude:alpha')?.links.opencode.state).toBe('absent')
  })

  it('取消链接幂等，且不触碰别处的同名目录', async () => {
    expect(await store.unlink('claude:alpha', 'codex')).toEqual({ ok: true })

    await makeSkill(join(root, 'codex', 'alpha'), 'local-alpha')
    await store.refresh()
    const r = await store.unlink('claude:alpha', 'codex')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CONFLICT')
    expect(await exists(join(root, 'codex', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('内置拒绝链接与取消链接', async () => {
    await makeSkill(join(root, 'codex', '.system', 'img'), 'img')
    await store.refresh()

    const a = await store.link('builtin:.system/img', 'claude')
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.code).toBe('LOCKED')

    const b = await store.unlink('builtin:.system/img', 'codex')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.code).toBe('LOCKED')
  })

  it('未知 id 返回 NOT_FOUND', async () => {
    const r = await store.link('claude:nope', 'codex')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })
})

describe('SkillStore.deleteSkill（内容进回收站，软链直接删）', () => {
  it('本体进回收站、各处软链直接删除；恢复只把本体放回原处', async () => {
    await store.link('claude:alpha', 'codex')
    await store.link('claude:alpha', 'agents')
    expect(store.get('claude:alpha')?.links.codex.state).toBe('linked')

    expect(await store.deleteSkill('claude:alpha')).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'codex', 'alpha'))).toBe(false)
    expect(await exists(join(root, 'agents', 'alpha'))).toBe(false)

    // 软链不进回收站，站里只有本体这一条
    const items = await store.trash()
    expect(items).toHaveLength(1)
    expect(items[0]?.origin).toBe('claude')
    expect(items[0]?.kind).toBe('dir')

    expect(await store.restoreFromTrash(items[0]!.id)).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
    // 软链在删除时就已经删掉，恢复不会把它带回来
    expect(await exists(join(root, 'codex', 'alpha'))).toBe(false)
    expect(await store.trash()).toHaveLength(0)
  })

  it('恢复时原位置被占用则拒绝，不覆盖', async () => {
    const r = await store.deleteSkill('agents:beta')
    expect(r.ok).toBe(true)
    const [item] = await store.trash()
    expect(item).toBeTruthy()

    await makeSkill(join(root, 'agents', 'beta'), 'someone-else')
    const restore = await store.restoreFromTrash(item!.id)
    expect(restore.ok).toBe(false)
    if (!restore.ok) expect(restore.code).toBe('CONFLICT')
    expect(await readFile(join(root, 'agents', 'beta', 'SKILL.md'), 'utf8')).toContain(
      'someone-else',
    )
  })

  it('彻底删除与清空回收站', async () => {
    await store.deleteSkill('claude:alpha')
    await store.deleteSkill('agents:beta')
    const items = await store.trash()
    expect(items).toHaveLength(2)

    expect(await store.purgeTrash(items[0]!.id)).toEqual({ ok: true })
    expect(await store.trash()).toHaveLength(1)

    expect(await store.emptyTrash()).toEqual({ ok: true })
    expect(await store.trash()).toHaveLength(0)
    expect(await readdir(trashRoot())).toEqual([])
  })

  it('断链残骸可删除：只有软链，不进回收站', async () => {
    await symlink(join(root, 'gone-dir'), join(root, 'opencode', 'dangling'))
    await store.refresh()

    expect(await store.deleteSkill('opencode:dangling')).toEqual({ ok: true })
    expect(await exists(join(root, 'opencode', 'dangling'))).toBe(false)
    expect(await store.trash()).toHaveLength(0)
  })

  it('内置拒绝删除', async () => {
    await makeSkill(join(root, 'codex', '.system', 'img'), 'img')
    await store.refresh()
    const r = await store.deleteSkill('builtin:.system/img')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('LOCKED')
    expect(await exists(join(root, 'codex', '.system', 'img', 'SKILL.md'))).toBe(true)
  })

  it('只影响自己：同名但内容不同的条目不受牵连', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'local-alpha')
    await store.refresh()

    await store.deleteSkill('claude:alpha')
    expect(await exists(join(root, 'codex', 'alpha', 'SKILL.md'))).toBe(true)
    expect((await store.trash()).map((i) => i.origin)).toEqual(['claude'])
  })
})

describe('SkillStore.readFile', () => {
  it('拒绝路径越界', async () => {
    const r = await store.readFile('claude:alpha', '../../../etc/passwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('IO')
  })

  it('可读 skill 内文件', async () => {
    const r = await store.readFile('claude:alpha', 'references/a.md')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content).toContain('# ref')
  })
})
