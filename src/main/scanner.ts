import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { Skill, SkillFile, SkillFileKind, SkillLink, SkillSource } from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

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
      const kind: SkillFileKind = classifyFile(rel)
      out.push({ path: rel, size: st.size, kind })
    }
  }
}

interface LoadedDoc {
  name: string
  description: string
  frontmatter: Record<string, unknown>
  files: SkillFile[]
  mtime: number
  byteSize: number
}

/** 读取一个 skill 目录；缺少 SKILL.md 或不可读时返回 null */
async function loadDir(dirPath: string, fallbackName: string): Promise<LoadedDoc | null> {
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
    name: doc.name,
    description: doc.description,
    frontmatter: doc.frontmatter,
    files,
    mtime: entryStat.mtimeMs,
    byteSize: files.reduce((n, f) => n + f.size, 0),
  }
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

/** 存储位置里的一个条目（真实目录或软链），已带内容摘要 */
interface RawEntry {
  source: SkillSource
  /** 目录名，跨位置匹配同名条目用它 */
  relDir: string
  /** 条目自身路径（可能是软链） */
  path: string
  /** 是否软链 */
  symlink: boolean
  /** readlink 的原始目标（软链才有） */
  linkTarget?: string
  /** 解析后的真实路径；失效软链为 null */
  real: string | null
  name: string
  description: string
  frontmatter: Record<string, unknown>
  files: SkillFile[]
  mtime: number
  byteSize: number
}

/**
 * 扫描一个存储位置里的全部条目。
 * 缺少 SKILL.md 的目录不算 skill；失效软链没有内容可读，仍如实列出（可删除）。
 */
async function scanLocation(source: SkillSource): Promise<RawEntry[]> {
  const root = sourceRootFor(source)
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const out: RawEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    let lst
    try {
      lst = await fs.lstat(path)
    } catch {
      continue
    }

    if (lst.isSymbolicLink()) {
      let linkTarget: string | undefined
      try {
        linkTarget = await fs.readlink(path)
      } catch {
        /* 读不到目标就按失效处理 */
      }
      const real = await realpathOrNull(path)
      if (!real) {
        out.push({
          source,
          relDir: entry.name,
          path,
          symlink: true,
          ...(linkTarget ? { linkTarget } : {}),
          real: null,
          name: entry.name,
          description: '符号链接失效，无法读取内容',
          frontmatter: {},
          files: [],
          mtime: 0,
          byteSize: 0,
        })
        continue
      }
      const doc = await loadDir(real, entry.name)
      if (!doc) continue
      out.push({
        source,
        relDir: entry.name,
        path,
        symlink: true,
        ...(linkTarget ? { linkTarget } : {}),
        real,
        ...doc,
      })
      continue
    }

    if (!lst.isDirectory()) continue
    const doc = await loadDir(path, entry.name)
    if (!doc) continue
    out.push({
      source,
      relDir: entry.name,
      path,
      symlink: false,
      real: await realpathOrNull(path),
      ...doc,
    })
  }
  return out
}

function emptyLinks(): Record<SkillSource, SkillLink> {
  const out = {} as Record<SkillSource, SkillLink>
  for (const source of SKILL_SOURCES) out[source] = { state: 'absent', path: '' }
  return out
}

/** codex `.system` 内置 skill：只读、锁定、不可链接 */
export async function scanBuiltins(): Promise<Skill[]> {
  const root = join(sourceRootFor('codex'), '.system')
  const out: Skill[] = []

  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const dirPath = join(root, entry.name)
    let st
    try {
      st = await fs.stat(dirPath)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const doc = await loadDir(dirPath, entry.name)
    if (!doc) continue

    const relDir = `.system/${entry.name}`
    const links = emptyLinks()
    links.codex = { state: 'native', path: dirPath }

    out.push({
      id: `builtin:${relDir}`,
      kind: 'builtin',
      name: doc.name,
      relDir,
      dirPath,
      home: null,
      links,
      description: doc.description,
      frontmatter: doc.frontmatter,
      files: doc.files,
      mtime: doc.mtime,
      byteSize: doc.byteSize,
      broken: false,
    })
  }
  return out
}

/** 同名条目按内容（真实路径）分成一组，一个分组就是一个 skill */
interface Group {
  relDir: string
  real: string | null
  broken: boolean
  entries: RawEntry[]
}

export async function scanAll(): Promise<Skill[]> {
  const perSource = new Map<SkillSource, RawEntry[]>()
  for (const source of SKILL_SOURCES) perSource.set(source, await scanLocation(source))

  /** `位置:目录名` → 该位置上的条目（一个位置里同名条目唯一） */
  const slots = new Map<string, RawEntry>()
  for (const source of SKILL_SOURCES) {
    for (const entry of perSource.get(source) ?? []) slots.set(`${source}:${entry.relDir}`, entry)
  }

  const groups: Group[] = []
  /** `位置:目录名` → 它所属的分组，用于分辨「被同名条目占用」 */
  const owner = new Map<string, Group>()
  const relDirs = new Set<string>()
  for (const entry of slots.values()) relDirs.add(entry.relDir)

  for (const relDir of relDirs) {
    const entries = [...slots.values()].filter((e) => e.relDir === relDir)
    const byReal = new Map<string, RawEntry[]>()
    const broken: RawEntry[] = []
    for (const entry of entries) {
      if (!entry.real) {
        broken.push(entry)
        continue
      }
      const list = byReal.get(entry.real) ?? []
      list.push(entry)
      byReal.set(entry.real, list)
    }
    for (const [real, list] of byReal) groups.push({ relDir, real, broken: false, entries: list })
    if (broken.length > 0) groups.push({ relDir, real: null, broken: true, entries: broken })
  }

  for (const group of groups) {
    for (const entry of group.entries) owner.set(`${entry.source}:${entry.relDir}`, group)
  }

  const out: Skill[] = []
  for (const group of groups) {
    const { relDir, real, broken, entries } = group
    const sample = entries.find((e) => !e.symlink) ?? entries[0]!
    // 本体 = 真实目录所在的位置；全是软链（内容在应用之外）时为 null
    const home = entries.find((e) => !e.symlink)?.source ?? null
    const anchor = home ?? entries[0]!.source

    const links = emptyLinks()
    for (const source of SKILL_SOURCES) {
      const entry = slots.get(`${source}:${relDir}`)
      if (!entry) {
        links[source] = { state: 'absent', path: '' }
        continue
      }
      // 失效软链没有内容、也不属于任何条目，任何 skill 都可以安全替换它
      if (!entry.real) {
        links[source] = {
          state: 'broken',
          path: entry.path,
          ...(entry.linkTarget ? { target: entry.linkTarget } : {}),
        }
        continue
      }
      if (owner.get(`${source}:${relDir}`) !== group) {
        links[source] = { state: 'conflict', path: entry.path, target: entry.real }
        continue
      }
      links[source] = {
        state: entry.symlink ? 'linked' : 'self',
        path: entry.path,
        target: entry.real,
      }
    }

    out.push({
      id: makeSkillId(anchor, relDir),
      kind: 'skill',
      name: sample.name,
      relDir,
      dirPath: real ?? entries[0]!.path,
      home,
      links,
      description: sample.description,
      frontmatter: sample.frontmatter,
      files: sample.files,
      mtime: sample.mtime,
      byteSize: sample.byteSize,
      broken,
    })
  }

  out.push(...(await scanBuiltins()))
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return out
}
