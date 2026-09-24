import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyPathOverrides,
  centralDirFor,
  centralRoot,
  makeExternalId,
  makeSkillId,
  sourceDirFor,
} from '../src/main/paths'

describe('paths', () => {
  it('id 由 kind 与 relDir 构成', () => {
    expect(makeSkillId('central', 'vue')).toBe('central:vue')
    expect(makeSkillId('builtin', '.system/imagegen')).toBe('builtin:codex:.system/imagegen')
    expect(makeExternalId('claude', 'stray')).toBe('external:claude:stray')
  })

  it('中央仓库默认落在 ~/.skills-deck/skills', () => {
    const saved = process.env['SKILLSDECK_CENTRAL_ROOT']
    delete process.env['SKILLSDECK_CENTRAL_ROOT']
    applyPathOverrides({ sourceRoots: {} })
    expect(centralRoot()).toBe(join(homedir(), '.skills-deck', 'skills'))
    expect(centralDirFor('vue')).toBe(join(homedir(), '.skills-deck', 'skills', 'vue'))
    if (saved !== undefined) process.env['SKILLSDECK_CENTRAL_ROOT'] = saved
  })

  it('中央仓库地址可被覆盖，且与存储位置不重叠', () => {
    applyPathOverrides({ sourceRoots: {}, centralRoot: '/tmp/central' })
    expect(centralRoot()).toBe('/tmp/central')
    expect(centralDirFor('vue')).toBe('/tmp/central/vue')
    expect(centralDirFor('vue')).not.toBe(sourceDirFor('claude', 'vue'))
    applyPathOverrides({ sourceRoots: {} })
  })

  it('环境变量优先于覆盖值', () => {
    const saved = process.env['SKILLSDECK_CENTRAL_ROOT']
    applyPathOverrides({ sourceRoots: {}, centralRoot: '/tmp/from-config' })
    process.env['SKILLSDECK_CENTRAL_ROOT'] = '/tmp/from-env'
    expect(centralRoot()).toBe('/tmp/from-env')
    if (saved === undefined) delete process.env['SKILLSDECK_CENTRAL_ROOT']
    else process.env['SKILLSDECK_CENTRAL_ROOT'] = saved
    applyPathOverrides({ sourceRoots: {} })
  })
})
