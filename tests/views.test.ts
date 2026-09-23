import type { Skill, SkillKind, SkillSource } from '@shared/types'
import { describe, expect, it } from 'vitest'

import {
  isLinkedInView,
  linkTargetsFor,
  localSourceInView,
  symlinkCount,
  type View,
} from '../src/renderer/src/hooks/use-skills'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode']

function skill(kind: SkillKind, origin: SkillSource | null, links: Partial<Record<SkillSource, string>> = {}): Skill {
  return {
    id: `${kind}:${origin ?? 'central'}:demo`,
    kind,
    name: 'demo',
    relDir: 'demo',
    description: '',
    dirPath: `C:/fake/${kind}/demo`,
    origin,
    links: Object.fromEntries(
      SOURCES.map((s) => [s, { state: links[s] ?? 'absent', path: '' }]),
    ) as Skill['links'],
    frontmatter: {},
    files: [],
    mtime: 0,
    byteSize: 0,
  }
}

const central = (links: Partial<Record<SkillSource, string>> = {}): Skill =>
  skill('central', null, links)
const external = (origin: SkillSource): Skill => skill('external', origin, { [origin]: 'conflict' })
const builtin = (): Skill => skill('builtin', 'codex', { codex: 'native' })

const locationView = (source: SkillSource): View => ({ kind: 'location', source })
const workspaceView = (agent: SkillSource): View => ({ kind: 'workspace', agent })

describe('工作区/存储位置：本地条目天然可用', () => {
  it('本地未纳管条目在对应视图里算「已启用」', () => {
    expect(isLinkedInView(external('opencode'), locationView('opencode'))).toBe(true)
    expect(isLinkedInView(external('opencode'), workspaceView('opencode'))).toBe(true)
    // opencode 会读取三个位置，所以 claude 目录里的本地条目对它也可用
    expect(isLinkedInView(external('claude'), workspaceView('opencode'))).toBe(true)
    // Claude Code 不读 opencode 的目录
    expect(isLinkedInView(external('opencode'), workspaceView('claude'))).toBe(false)
    // 未纳管视图里它们仍是「未启用」（没链接到中央仓库）
    expect(isLinkedInView(external('claude'), { kind: 'unmanaged' })).toBe(false)
  })

  it('本地条目只在自己所在的位置可用，中央仓库条目按链接状态判定', () => {
    expect(localSourceInView(external('claude'), workspaceView('opencode'))).toBe('claude')
    expect(localSourceInView(external('claude'), workspaceView('claude'))).toBe('claude')
    expect(localSourceInView(external('claude'), locationView('codex'))).toBeNull()
    expect(localSourceInView(central({ claude: 'linked' }), locationView('claude'))).toBeNull()

    expect(isLinkedInView(central({ claude: 'linked' }), locationView('claude'))).toBe(true)
    expect(isLinkedInView(central({ claude: 'linked' }), locationView('codex'))).toBe(false)
    expect(isLinkedInView(builtin(), locationView('codex'))).toBe(true)
  })

  it('软链条数只统计中央仓库真身的链接', () => {
    const list = [
      central({ claude: 'linked', codex: 'linked' }),
      central({ opencode: 'linked' }),
      external('claude'),
      builtin(),
    ]
    expect(symlinkCount(list, locationView('claude'))).toBe(1)
    expect(symlinkCount(list, locationView('opencode'))).toBe(1)
    expect(symlinkCount(list, workspaceView('opencode'))).toBe(2)
  })

  it('本地条目只展示自己所在位置的开关', () => {
    expect(linkTargetsFor(external('claude'), workspaceView('opencode'))).toEqual(['claude'])
    expect(linkTargetsFor(central(), workspaceView('opencode'))).toEqual(SOURCES)
  })
})
