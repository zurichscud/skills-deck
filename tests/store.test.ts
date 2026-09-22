import { mkdtemp, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillStore } from '../src/main/store'

const ENV_KEYS = [
  'SKILLSDECK_MANAGED_ROOT',
  'SKILLSDECK_SOURCE_ROOT_CLAUDE',
  'SKILLSDECK_SOURCE_ROOT_CODEX',
  'SKILLSDECK_SOURCE_ROOT_OPENCODE'
] as const

let root: string
let store: SkillStore
const saved: Record<string, string | undefined> = {}

async function makeSkill(dir: string, name: string, description = 'desc'): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`)
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
  root = await mkdtemp(join(tmpdir(), 'skillsdeck-'))
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env['SKILLSDECK_MANAGED_ROOT'] = join(root, 'managed')
  process.env['SKILLSDECK_SOURCE_ROOT_CLAUDE'] = join(root, 'claude')
  process.env['SKILLSDECK_SOURCE_ROOT_CODEX'] = join(root, 'codex')
  process.env['SKILLSDECK_SOURCE_ROOT_OPENCODE'] = join(root, 'opencode')

  await makeSkill(join(root, 'claude', 'alpha'), 'alpha')
  await makeSkill(join(root, 'opencode', 'beta'), 'beta')
  await makeSkill(join(root, 'codex', 'gamma'), 'gamma')

  store = new SkillStore()
  await store.init()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(root, { recursive: true, force: true })
})

describe('SkillStore.setEnabled', () => {
  it('停用：移入受管停车场，源目录消失，附属资源一并带走', async () => {
    const r = await store.setEnabled('claude:alpha', false)
    expect(r).toEqual({ ok: true })

    expect(await exists(join(root, 'claude', 'alpha'))).toBe(false)
    const parked = join(root, 'managed', 'disabled', 'claude', 'alpha')
    expect(await exists(join(parked, 'SKILL.md'))).toBe(true)
    expect(await exists(join(parked, 'references', 'a.md'))).toBe(true)

    const s = store.get('claude:alpha')
    expect(s?.enabled).toBe(false)
    expect(s?.dirPath).toBe(parked)
  })

  it('启用：从停车场移回源目录', async () => {
    await store.setEnabled('claude:alpha', false)
    const r = await store.setEnabled('claude:alpha', true)
    expect(r).toEqual({ ok: true })

    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
    expect(await exists(join(root, 'managed', 'disabled', 'claude', 'alpha'))).toBe(false)
    expect(store.get('claude:alpha')?.enabled).toBe(true)
  })

  it('同名 skill 在不同来源分别停用不冲突', async () => {
    await makeSkill(join(root, 'claude', 'same'), 'same')
    await makeSkill(join(root, 'opencode', 'same'), 'same')
    await store.refresh()

    expect(await store.setEnabled('claude:same', false)).toEqual({ ok: true })
    expect(await store.setEnabled('opencode:same', false)).toEqual({ ok: true })

    expect(await exists(join(root, 'managed', 'disabled', 'claude', 'same', 'SKILL.md'))).toBe(true)
    expect(await exists(join(root, 'managed', 'disabled', 'opencode', 'same', 'SKILL.md'))).toBe(true)
  })

  it('目标已存在同名目录时中止并返回 CONFLICT，两侧均不被覆盖', async () => {
    await makeSkill(join(root, 'managed', 'disabled', 'claude', 'alpha'), 'alpha-parked')
    await writeFile(join(root, 'claude', 'alpha', 'marker.txt'), 'source-should-survive')

    const r = await store.setEnabled('claude:alpha', false)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT')
      expect(r.conflictAt).toContain('alpha')
    }
    // 源侧未被破坏
    expect(await readFile(join(root, 'claude', 'alpha', 'marker.txt'), 'utf8')).toBe('source-should-survive')
    // 停车场侧未被覆盖
    expect(await exists(join(root, 'managed', 'disabled', 'claude', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('内置 skill 拒绝停用', async () => {
    await mkdir(join(root, 'codex', '.system', 'imagegen'), { recursive: true })
    await writeFile(
      join(root, 'codex', '.system', 'imagegen', 'SKILL.md'),
      '---\nname: imagegen\ndescription: d\n---\n'
    )
    await store.refresh()

    const r = await store.setEnabled('codex:.system/imagegen', false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('LOCKED')
  })

  it('幂等：已是目标状态时直接成功', async () => {
    expect(await store.setEnabled('claude:alpha', true)).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('未知 id 返回 NOT_FOUND', async () => {
    const r = await store.setEnabled('claude:nope', false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })

  it('符号链接 skill：只移动链接本体，真身保持原位', async () => {
    const central = join(root, 'central', 'linked')
    await makeSkill(central, 'linked')
    await symlink(central, join(root, 'claude', 'linked'))
    await store.refresh()

    expect(store.get('claude:linked')?.entryKind).toBe('symlink')

    const r = await store.setEnabled('claude:linked', false)
    expect(r).toEqual({ ok: true })

    // 真身未动
    expect(await exists(join(central, 'SKILL.md'))).toBe(true)
    // 停车场里的是链接，且仍指向同一真身
    const parked = join(root, 'managed', 'disabled', 'claude', 'linked')
    expect((await lstat(parked)).isSymbolicLink()).toBe(true)
    expect(await readlink(parked)).toBe(central)
    expect(await exists(join(root, 'claude', 'linked'))).toBe(false)
  })

  it('断链 skill 也能停用（移走失效链接）', async () => {
    await symlink(join(root, 'gone'), join(root, 'claude', 'dangling'))
    await store.refresh()

    const s = store.get('claude:dangling')
    expect(s?.entryKind).toBe('broken')

    expect(await store.setEnabled('claude:dangling', false)).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'dangling'))).toBe(false)
  })
})

describe('SkillStore.copyTo', () => {
  it('复制到另一来源：解引用生成独立真身', async () => {
    const r = await store.copyTo('claude:alpha', 'codex', 'ask')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.outcome).toBe('created')
      expect(r.targetName).toBe('alpha')
    }
    const dest = join(root, 'codex', 'alpha')
    expect((await stat(dest)).isDirectory()).toBe(true)
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await exists(join(dest, 'references', 'a.md'))).toBe(true)
  })

  it('目标已存在且 ask：返回 CONFLICT 不改动', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'existing')
    await writeFile(join(root, 'codex', 'alpha', 'keep.txt'), 'keep')

    const r = await store.copyTo('claude:alpha', 'codex', 'ask')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('CONFLICT')
      expect(r.conflictAt).toContain('alpha')
    }
    expect(await readFile(join(root, 'codex', 'alpha', 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('冲突策略 skip：保留目标，报告 skipped', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'existing')
    const r = await store.copyTo('claude:alpha', 'codex', 'skip')
    expect(r).toEqual({ ok: true, outcome: 'skipped', targetName: 'alpha' })
    expect(await readFile(join(root, 'codex', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: existing')
  })

  it('冲突策略 overwrite：目标被替换', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'existing')
    await writeFile(join(root, 'codex', 'alpha', 'old-only.txt'), 'x')

    const r = await store.copyTo('claude:alpha', 'codex', 'overwrite')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome).toBe('overwritten')
    expect(await exists(join(root, 'codex', 'alpha', 'old-only.txt'))).toBe(false)
    expect(await exists(join(root, 'codex', 'alpha', 'references', 'a.md'))).toBe(true)
  })

  it('冲突策略 rename：保留两者', async () => {
    await makeSkill(join(root, 'codex', 'alpha'), 'existing')
    const r = await store.copyTo('claude:alpha', 'codex', 'rename')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.targetName).toBe('alpha-2')

    const names = (await readdir(join(root, 'codex'))).sort()
    expect(names).toContain('alpha')
    expect(names).toContain('alpha-2')
  })

  it('复制到同一来源被拒绝', async () => {
    const r = await store.copyTo('claude:alpha', 'claude', 'ask')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('CONFLICT')
  })

  it('内置 skill 不可分发', async () => {
    await mkdir(join(root, 'codex', '.system', 'img'), { recursive: true })
    await writeFile(join(root, 'codex', '.system', 'img', 'SKILL.md'), '---\nname: img\n---\n')
    await store.refresh()
    const r = await store.copyTo('codex:.system/img', 'claude', 'ask')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('LOCKED')
  })

  it('复制符号链接 skill 时解引用，产物是独立目录', async () => {
    const central = join(root, 'central', 'linked')
    await makeSkill(central, 'linked')
    await symlink(central, join(root, 'claude', 'linked'))
    await store.refresh()

    const r = await store.copyTo('claude:linked', 'opencode', 'ask')
    expect(r.ok).toBe(true)
    const dest = join(root, 'opencode', 'linked')
    expect((await lstat(dest)).isSymbolicLink()).toBe(false)
    expect(await exists(join(dest, 'SKILL.md'))).toBe(true)
    // 改副本不影响真身
    await writeFile(join(dest, 'only-in-copy.txt'), 'x')
    expect(await exists(join(central, 'only-in-copy.txt'))).toBe(false)
  })
})

describe('SkillStore.deleteSkill（物理删除）', () => {
  it('真实目录：连同文件永久删除', async () => {
    expect(await exists(join(root, 'claude', 'alpha', 'SKILL.md'))).toBe(true)
    const r = await store.deleteSkill('claude:alpha')
    expect(r).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'alpha'))).toBe(false)
    expect(store.get('claude:alpha')).toBeUndefined()
  })

  it('符号链接：只删链接，真身保留', async () => {
    const central = join(root, 'central', 'linked')
    await makeSkill(central, 'linked')
    await symlink(central, join(root, 'claude', 'linked'))
    await store.refresh()

    const r = await store.deleteSkill('claude:linked')
    expect(r).toEqual({ ok: true })
    // 真身完好
    expect(await exists(join(central, 'SKILL.md'))).toBe(true)
    expect(await exists(join(central, 'references', 'a.md'))).toBe(true)
    // 链接已消失
    expect(await exists(join(root, 'claude', 'linked'))).toBe(false)
  })

  it('软链真身被多来源共享时，删一处不影响另一处', async () => {
    const central = join(root, 'central', 'shared')
    await makeSkill(central, 'shared')
    await symlink(central, join(root, 'claude', 'shared'))
    await symlink(central, join(root, 'opencode', 'shared'))
    await store.refresh()

    expect(await store.deleteSkill('claude:shared')).toEqual({ ok: true })
    await store.refresh()
    // 另一处仍在，且真身完好
    expect(store.get('opencode:shared')).toBeTruthy()
    expect(await exists(join(central, 'SKILL.md'))).toBe(true)
  })

  it('停用状态的 skill 也能物理删除', async () => {
    await store.setEnabled('claude:alpha', false)
    expect(await store.deleteSkill('claude:alpha')).toEqual({ ok: true })
    expect(await exists(join(root, 'managed', 'disabled', 'claude', 'alpha'))).toBe(false)
  })

  it('内置 skill 拒绝删除', async () => {
    await mkdir(join(root, 'codex', '.system', 'img'), { recursive: true })
    await writeFile(join(root, 'codex', '.system', 'img', 'SKILL.md'), '---\nname: img\n---\n')
    await store.refresh()
    const r = await store.deleteSkill('codex:.system/img')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('LOCKED')
    expect(await exists(join(root, 'codex', '.system', 'img', 'SKILL.md'))).toBe(true)
  })

  it('未知 id 返回 NOT_FOUND', async () => {
    const r = await store.deleteSkill('claude:nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })

  it('断链 skill：删掉链接残骸，不动真身路径', async () => {
    await symlink(join(root, 'gone-dir'), join(root, 'claude', 'dangling'))
    await store.refresh()
    expect(await store.deleteSkill('claude:dangling')).toEqual({ ok: true })
    expect(await exists(join(root, 'claude', 'dangling'))).toBe(false)
    expect(await exists(join(root, 'gone-dir'))).toBe(false)
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
