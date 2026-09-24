import type { SkillFileKind } from '@shared/types'
import { load } from 'js-yaml'

export interface ParsedSkillDoc {
  name: string
  description: string
  frontmatter: Record<string, unknown>
  body: string
}

const OPEN_RE = /^---[ \t]*\r?\n/

export function splitFrontmatter(raw: string): { yaml: string | null; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  const open = OPEN_RE.exec(text)
  if (!open) return { yaml: null, body: text }

  const afterOpen = open[0].length
  const close = /^---[ \t]*(?:\r?\n|$)/gm
  close.lastIndex = afterOpen
  const closeMatch = close.exec(text)
  if (!closeMatch) return { yaml: null, body: text }

  const yaml = text.slice(afterOpen, closeMatch.index).replace(/\r?\n$/, '')
  const body = text.slice(closeMatch.index + closeMatch[0].length)
  return { yaml, body }
}

export function parseSkillDoc(raw: string, fallbackName: string): ParsedSkillDoc {
  const { yaml, body } = splitFrontmatter(raw)
  let frontmatter: Record<string, unknown> = {}
  if (yaml) {
    try {
      const parsed: unknown = load(yaml)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>
      }
    } catch {
      frontmatter = { __parseError: 'frontmatter YAML 解析失败' }
    }
  }
  const name =
    typeof frontmatter['name'] === 'string' && frontmatter['name'].trim()
      ? frontmatter['name'].trim()
      : fallbackName
  const description =
    typeof frontmatter['description'] === 'string' ? frontmatter['description'].trim() : ''
  return { name, description, frontmatter, body }
}

const SCRIPT_EXT = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'sh',
  'ps1',
  'rb',
  'go',
  'rs',
  'bash',
  'zsh',
])
const ASSET_EXT = new Set([
  'png',
  'svg',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'woff',
  'woff2',
  'ttf',
])

export function classifyFile(relPath: string): SkillFileKind {
  const base = relPath.split('/').pop() ?? relPath
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'other'
  const ext = base.slice(dot + 1).toLowerCase()
  if (ext === 'md' || ext === 'mdx') return 'md'
  if (SCRIPT_EXT.has(ext)) return 'script'
  if (ASSET_EXT.has(ext)) return 'asset'
  return 'other'
}

export const SKILL_ENTRY_FILE = 'SKILL.md'
