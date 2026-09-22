import { describe, expect, it } from 'vitest'
import { disabledDirFor, makeSkillId, sourceDirFor } from '../src/main/paths'

describe('paths', () => {
  it('id 由 source 与 relDir 构成，可表达嵌套', () => {
    expect(makeSkillId('claude', 'vue')).toBe('claude:vue')
    expect(makeSkillId('codex', '.system/imagegen')).toBe('codex:.system/imagegen')
  })

  it('源目录与停用目录互不重叠且同名不冲突', () => {
    const a = sourceDirFor('claude', 'vue')
    const b = disabledDirFor('claude', 'vue')
    expect(a).not.toBe(b)
    expect(disabledDirFor('claude', 'vue')).toContain(`${'claude'}/vue`)
    expect(disabledDirFor('codex', 'vue')).not.toBe(disabledDirFor('claude', 'vue'))
  })

  it('停用目录按来源二级隔离', () => {
    expect(disabledDirFor('opencode', 'x')).toMatch(/disabled[/\\]opencode[/\\]x$/)
  })
})
