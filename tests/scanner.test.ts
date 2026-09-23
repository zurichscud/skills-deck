import { describe, expect, it } from 'vitest'

import { disabledSourceRootFor } from '../src/main/paths'
import { scanAll } from '../src/main/scanner'

describe('scanAll（真实目录集成）', () => {
  it('能扫描到三方 skill 并正确标注来源/启停', async () => {
    const skills = await scanAll(disabledSourceRootFor)
    expect(skills.length).toBeGreaterThan(0)

    const sources = new Set(skills.map((s) => s.source))
    expect(sources.has('claude')).toBe(true)
    expect(sources.has('codex')).toBe(true)
    expect(sources.has('opencode')).toBe(true)

    for (const s of skills) {
      expect(s.id).toBe(`${s.source}:${s.relDir}`)
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.originPath.endsWith(s.relDir)).toBe(true)
    }
  })

  it('跟随符号链接识别 skill（本机三方目录以软链为主）', async () => {
    const skills = await scanAll(disabledSourceRootFor)
    const linked = skills.filter((s) => s.entryKind === 'symlink')
    expect(linked.length).toBeGreaterThan(0)
    for (const s of linked) {
      expect(s.linkTarget).toBeTruthy()
      expect(s.files.some((f) => f.path === 'SKILL.md')).toBe(true)
    }
  })

  it('codex .system 标记为 builtin 且始终启用', async () => {
    const skills = await scanAll(disabledSourceRootFor)
    const builtins = skills.filter((s) => s.builtin)
    expect(builtins.length).toBeGreaterThan(0)
    expect(builtins.every((s) => s.source === 'codex' && s.relDir.startsWith('.system/'))).toBe(
      true,
    )
    expect(builtins.every((s) => s.enabled === true)).toBe(true)
    expect(builtins.every((s) => s.files.some((f) => f.path === 'SKILL.md'))).toBe(true)
  })

  it('id 唯一', async () => {
    const skills = await scanAll(disabledSourceRootFor)
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length)
  })

  it('每条 skill 要么可读到 SKILL.md，要么被标记为断链', async () => {
    const skills = await scanAll(disabledSourceRootFor)
    for (const s of skills) {
      const hasEntry = s.files.some((f) => f.path === 'SKILL.md')
      expect(hasEntry || s.entryKind === 'broken').toBe(true)
    }
  })
})
