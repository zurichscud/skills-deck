import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { Skill, SkillEntryKind, SkillFile, SkillSource } from '@shared/types'

import { SKILL_ENTRY_FILE, classifyFile, parseSkillDoc } from './parse'
import { makeSkillId, sourceRootFor } from './paths'

const SKIP_DIRS = new Set(['node_modules', '.git'])
const MAX_FILES = 400
const MAX_DEPTH = 5

async function walkFiles(
  root: string,
  dir: string,
  out: SkillFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    const abs = join(dir, entry.name)
    if (SKIP_DIRS.has(entry.name)) continue
    let st
    try {
      st = await fs.stat(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      await walkFiles(root, abs, out, depth + 1)
    } else if (st.isFile()) {
      const rel = relative(root, abs).split(sep).join('/')
      out.push({ path: rel, size: st.size, kind: classifyFile(rel) })
    }
  }
}

/** 判定目录项类型：跟随符号链接，区分真身/软链/断链 */
async function entryKindOf(
  dirPath: string,
): Promise<{ kind: SkillEntryKind; linkTarget?: string }> {
  let lst
  try {
    lst = await fs.lstat(dirPath)
  } catch {
    return { kind: 'broken' }
  }
  if (!lst.isSymbolicLink()) {
    return { kind: lst.isDirectory() ? 'real' : 'broken' }
  }
  try {
    return { kind: 'symlink', linkTarget: await fs.realpath(dirPath) }
  } catch {
    return { kind: 'broken', linkTarget: await fs.readlink(dirPath).catch(() => undefined) }
  }
}

async function loadSkill(
  source: SkillSource,
  relDir: string,
  dirPath: string,
  enabled: boolean,
  builtin: boolean,
): Promise<Skill | null> {
  const fallbackName = relDir.split('/').pop() ?? relDir
  const { kind, linkTarget } = await entryKindOf(dirPath)
  const originPath = join(sourceRootFor(source), relDir)

  if (kind === 'broken') {
    return {
      id: makeSkillId(source, relDir),
      source,
      name: fallbackName,
      relDir,
      description: '符号链接失效，无法读取内容',
      enabled,
      builtin,
      entryKind: 'broken',
      linkTarget,
      dirPath,
      originPath,
      frontmatter: {},
      files: [],
      mtime: 0,
      byteSize: 0,
    }
  }

  const entryPath = join(dirPath, SKILL_ENTRY_FILE)
  let entryStat
  try {
    entryStat = await fs.stat(entryPath)
    if (!entryStat.isFile()) return null
  } catch {
    return null
  }

  const files: SkillFile[] = []
  await walkFiles(dirPath, dirPath, files, 0)
  files.sort((a, b) => a.path.localeCompare(b.path))

  let doc
  try {
    doc = parseSkillDoc(await fs.readFile(entryPath, 'utf8'), fallbackName)
  } catch {
    return null
  }

  return {
    id: makeSkillId(source, relDir),
    source,
    name: doc.name,
    relDir,
    description: doc.description,
    enabled,
    builtin,
    entryKind: kind,
    linkTarget,
    dirPath,
    originPath,
    frontmatter: doc.frontmatter,
    files,
    mtime: entryStat.mtimeMs,
    byteSize: files.reduce((n, f) => n + f.size, 0),
  }
}

async function isSkillDirCandidate(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs)
    return st.isDirectory()
  } catch {
    // 断链或无权限：仅当 lstat 显示是符号链接时才作为「失效 skill」候选
    try {
      return (await fs.lstat(abs)).isSymbolicLink()
    } catch {
      return false
    }
  }
}

async function scanSourceRoot(
  source: SkillSource,
  root: string,
  enabled: boolean,
  includeSystem: boolean,
): Promise<Skill[]> {
  const out: Skill[] = []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    const abs = join(root, entry.name)
    if (!(await isSkillDirCandidate(abs))) continue

    if (entry.name === '.system') {
      if (!includeSystem) continue
      let subs
      try {
        subs = await fs.readdir(abs, { withFileTypes: true })
      } catch {
        continue
      }
      for (const sub of subs) {
        const subAbs = join(abs, sub.name)
        if (!(await isSkillDirCandidate(subAbs))) continue
        const skill = await loadSkill(source, `.system/${sub.name}`, subAbs, true, true)
        if (skill) out.push(skill)
      }
      continue
    }

    if (entry.name.startsWith('.')) continue
    const skill = await loadSkill(source, entry.name, abs, enabled, false)
    if (skill) out.push(skill)
  }
  return out
}

export async function scanAll(disabledRootFor: (source: SkillSource) => string): Promise<Skill[]> {
  const out: Skill[] = []
  const sources: SkillSource[] = ['claude', 'codex', 'opencode']
  for (const source of sources) {
    out.push(...(await scanSourceRoot(source, sourceRootFor(source), true, source === 'codex')))
    out.push(...(await scanSourceRoot(source, disabledRootFor(source), false, false)))
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))
  return out
}
