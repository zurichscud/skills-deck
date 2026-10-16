import type { LinkState, Skill, SkillSource } from '@shared/types'
import { describe, expect, it } from 'vitest'

import {
  isLinkedInView,
  skillInView,
  symlinkCount,
  type View,
} from '../src/renderer/src/hooks/use-skills'

const SOURCES: SkillSource[] = ['claude', 'codex', 'opencode', 'agents']

function skill(
  kind: Skill['kind'],
  home: SkillSource | null,
  links: Partial<Record<SkillSource, LinkState>> = {},
): Skill {
  return {
    id: `${home ?? 'detached'}:demo`,
    kind,
    name: 'demo',
    relDir: 'demo',
    dirPath: '/fake/demo',
    home,
    links: Object.fromEntries(
      SOURCES.map((s) => [s, { state: links[s] ?? 'absent', path: '' }]),
    ) as Skill['links'],
    description: '',
    frontmatter: {},
    files: [],
    mtime: 0,
    byteSize: 0,
    broken: false,
  }
}

const locationView = (source: SkillSource): View => ({ kind: 'location', source })
const workspaceView = (agent: 'claude' | 'codex' | 'opencode'): View => ({
  kind: 'workspace',
  agent,
})

/** 本体在 claude，codex 是指向它的链接 */
const claudeHome = (): Skill => skill('skill', 'claude', { claude: 'self', codex: 'linked' })

describe('视图归属', () => {
  it('位置视图只列该位置上真正有条目的 skill', () => {
    expect(skillInView(claudeHome(), locationView('claude'))).toBe(true)
    expect(skillInView(claudeHome(), locationView('codex'))).toBe(true)
    expect(skillInView(claudeHome(), locationView('agents'))).toBe(false)
  })

  it('被同名条目占用的位置也算「有条目」，免得条目在界面上凭空消失', () => {
    const occupied = skill('skill', null, { agents: 'conflict' })
    expect(skillInView(occupied, locationView('agents'))).toBe(true)
  })

  it('工作区按 agent 的读取范围取并集，agents 位置不属于任何工作区', () => {
    const inAgents = skill('skill', 'agents', { agents: 'self' })
    expect(skillInView(inAgents, locationView('agents'))).toBe(true)
    expect(skillInView(inAgents, workspaceView('opencode'))).toBe(false)
    expect(skillInView(inAgents, workspaceView('claude'))).toBe(false)
  })

  it('内置只属于 Codex 视图', () => {
    const builtin = skill('builtin', null, { codex: 'native' })
    expect(skillInView(builtin, locationView('codex'))).toBe(true)
    expect(skillInView(builtin, locationView('claude'))).toBe(false)
    expect(skillInView(builtin, workspaceView('codex'))).toBe(true)
    expect(skillInView(builtin, workspaceView('claude'))).toBe(false)
  })
})

describe('可用判定', () => {
  it('本体在此或链接生效都算可用；被占用与残骸不算', () => {
    expect(isLinkedInView(claudeHome(), locationView('claude'))).toBe(true)
    expect(isLinkedInView(claudeHome(), locationView('codex'))).toBe(true)
    expect(isLinkedInView(claudeHome(), locationView('agents'))).toBe(false)

    const blocked = skill('skill', 'claude', { claude: 'self', agents: 'conflict' })
    expect(isLinkedInView(blocked, locationView('agents'))).toBe(false)

    const dangling = skill('skill', null, { opencode: 'broken' })
    expect(isLinkedInView(dangling, locationView('opencode'))).toBe(false)

    expect(isLinkedInView(skill('builtin', null, { codex: 'native' }), locationView('codex'))).toBe(
      true,
    )
  })

  it('工作区里只要读取范围内任一处可用即算可用', () => {
    expect(isLinkedInView(claudeHome(), workspaceView('opencode'))).toBe(true)
    expect(isLinkedInView(claudeHome(), workspaceView('claude'))).toBe(true)

    const onlyAgents = skill('skill', 'agents', { agents: 'self' })
    expect(isLinkedInView(onlyAgents, workspaceView('opencode'))).toBe(false)
    expect(isLinkedInView(onlyAgents, locationView('agents'))).toBe(true)
  })

  it('软链条数只统计由链接带来的条目，本体与内置不计', () => {
    const list = [
      claudeHome(),
      skill('skill', 'agents', { agents: 'self', claude: 'linked' }),
      skill('builtin', null, { codex: 'native' }),
    ]
    // opencode 读三个位置，两个 skill 各在其中一个位置由软链接入
    expect(symlinkCount(list, workspaceView('opencode'))).toBe(2)
    expect(symlinkCount(list, locationView('claude'))).toBe(1)
    expect(symlinkCount(list, locationView('agents'))).toBe(0)
  })
})
