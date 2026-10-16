import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyPathOverrides,
  makeSkillId,
  sourceDirFor,
  sourceRootFor,
  trashRoot,
} from '../src/main/paths'

describe('paths', () => {
  it('id 由锚点位置与 relDir 构成', () => {
    expect(makeSkillId('claude', 'vue')).toBe('claude:vue')
    expect(makeSkillId('agents', 'vue')).toBe('agents:vue')
    expect(makeSkillId('detached', 'stray')).toBe('detached:stray')
  })

  it('四个存储位置各有默认目录，id 不重叠', () => {
    applyPathOverrides({ sourceRoots: {} })
    expect(sourceRootFor('claude')).toBe(join(homedir(), '.claude', 'skills'))
    expect(sourceRootFor('codex')).toBe(join(homedir(), '.codex', 'skills'))
    expect(sourceRootFor('opencode')).toBe(join(homedir(), '.config', 'opencode', 'skills'))
    expect(sourceRootFor('agents')).toBe(join(homedir(), '.agents', 'skills'))
    expect(sourceDirFor('opencode', 'vue')).not.toBe(sourceDirFor('agents', 'vue'))
  })

  it('配置覆盖生效，环境变量优先于配置', () => {
    const saved = process.env['SKILLSDECK_SOURCE_ROOT_AGENTS']
    delete process.env['SKILLSDECK_SOURCE_ROOT_AGENTS']
    applyPathOverrides({ sourceRoots: { agents: '/tmp/from-config' } })
    expect(sourceRootFor('agents')).toBe('/tmp/from-config')

    process.env['SKILLSDECK_SOURCE_ROOT_AGENTS'] = '/tmp/from-env'
    expect(sourceRootFor('agents')).toBe('/tmp/from-env')

    if (saved === undefined) delete process.env['SKILLSDECK_SOURCE_ROOT_AGENTS']
    else process.env['SKILLSDECK_SOURCE_ROOT_AGENTS'] = saved
    applyPathOverrides({ sourceRoots: {} })
  })

  it('回收站默认落在应用数据目录下，可被环境变量改址', () => {
    const savedTrash = process.env['SKILLSDECK_TRASH_ROOT']
    const savedManaged = process.env['SKILLSDECK_MANAGED_ROOT']
    delete process.env['SKILLSDECK_TRASH_ROOT']
    process.env['SKILLSDECK_MANAGED_ROOT'] = '/tmp/managed'
    expect(trashRoot()).toBe(join('/tmp/managed', 'trash'))

    process.env['SKILLSDECK_TRASH_ROOT'] = '/tmp/trash'
    expect(trashRoot()).toBe('/tmp/trash')

    if (savedTrash === undefined) delete process.env['SKILLSDECK_TRASH_ROOT']
    else process.env['SKILLSDECK_TRASH_ROOT'] = savedTrash
    if (savedManaged === undefined) delete process.env['SKILLSDECK_MANAGED_ROOT']
    else process.env['SKILLSDECK_MANAGED_ROOT'] = savedManaged
  })
})
