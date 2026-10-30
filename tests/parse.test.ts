import { describe, expect, it } from 'vitest'

import { classifyFile, parseSkillDoc, splitFrontmatter } from '../src/main/parse'

describe('splitFrontmatter', () => {
  it('提取标准 frontmatter', () => {
    const raw = '---\nname: foo\ndescription: bar\n---\n\n# Body\n'
    const { yaml, body } = splitFrontmatter(raw)
    expect(yaml).toBe('name: foo\ndescription: bar')
    expect(body).toBe('\n# Body\n')
  })

  it('无 frontmatter 时整篇为 body', () => {
    const raw = '# Just markdown\n'
    const { yaml, body } = splitFrontmatter(raw)
    expect(yaml).toBeNull()
    expect(body).toBe('# Just markdown\n')
  })

  it('容忍 CRLF', () => {
    const raw = '---\r\nname: a\r\n---\r\nbody'
    const { yaml, body } = splitFrontmatter(raw)
    expect(yaml).toBe('name: a')
    expect(body).toBe('body')
  })

  it('剥离 BOM', () => {
    const raw = '\uFEFF---\nname: a\n---\nx'
    expect(splitFrontmatter(raw).yaml).toBe('name: a')
  })

  it('空 frontmatter', () => {
    const raw = '---\n---\nbody'
    expect(splitFrontmatter(raw).yaml).toBe('')
    expect(splitFrontmatter(raw).body).toBe('body')
  })

  it('行内 --- 不误判为闭合定界符', () => {
    const raw = '---\nname: a\ndescription: x --- y\n---\nbody'
    const { yaml, body } = splitFrontmatter(raw)
    expect(yaml).toBe('name: a\ndescription: x --- y')
    expect(body).toBe('body')
  })
})

describe('parseSkillDoc', () => {
  it('读取 name 与 description', () => {
    const doc = parseSkillDoc(
      '---\nname: agent-browser\ndescription: Browser automation.\n---\n# hi\n',
      'fallback',
    )
    expect(doc.name).toBe('agent-browser')
    expect(doc.description).toBe('Browser automation.')
  })

  it('name 缺失时回退目录名', () => {
    const doc = parseSkillDoc('---\ndescription: d\n---\n', 'vue')
    expect(doc.name).toBe('vue')
  })

  it('name 为空白时回退目录名', () => {
    const doc = parseSkillDoc('---\nname: "   "\n---\n', 'vue')
    expect(doc.name).toBe('vue')
  })

  it('保留可选字段', () => {
    const doc = parseSkillDoc(
      '---\nname: a\ndescription: b\nversion: 1.0.0\nauthor: me\nallowed-tools: Bash(x:*)\n---\n',
      'a',
    )
    expect(doc.frontmatter['version']).toBe('1.0.0')
    expect(doc.frontmatter['author']).toBe('me')
    expect(doc.frontmatter['allowed-tools']).toBe('Bash(x:*)')
  })

  it('支持嵌套 metadata', () => {
    const doc = parseSkillDoc('---\nname: a\ndescription: b\nmetadata:\n  nested: 1\n---\n', 'a')
    expect(doc.frontmatter['metadata']).toEqual({ nested: 1 })
  })

  it('YAML 非法时不抛出', () => {
    const doc = parseSkillDoc('---\nname: [unclosed\n---\nbody', 'fallback')
    expect(doc.name).toBe('fallback')
    expect(doc.body).toBe('body')
    expect(doc.frontmatter['__parseError']).toBeTruthy()
  })

  it('frontmatter 为数组时视为无元数据', () => {
    const doc = parseSkillDoc('---\n- a\n- b\n---\nbody', 'fallback')
    expect(doc.name).toBe('fallback')
  })

  it('description 非字符串时为空', () => {
    const doc = parseSkillDoc('---\nname: a\ndescription:\n  - x\n---\n', 'a')
    expect(doc.description).toBe('')
  })
})

describe('classifyFile', () => {
  it('markdown', () => {
    expect(classifyFile('SKILL.md')).toBe('md')
    expect(classifyFile('references/guide.mdx')).toBe('md')
  })

  it('脚本', () => {
    expect(classifyFile('scripts/run.py')).toBe('script')
    expect(classifyFile('templates/capture.sh')).toBe('script')
    expect(classifyFile('x.mjs')).toBe('script')
  })

  it('资源', () => {
    expect(classifyFile('img/logo.png')).toBe('asset')
    expect(classifyFile('icon.svg')).toBe('asset')
  })

  it('其它', () => {
    expect(classifyFile('data.yaml')).toBe('other')
    expect(classifyFile('LICENSE')).toBe('other')
  })
})
