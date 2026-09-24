import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type {
  Skill,
  SkillFile,
  SkillFileKind,
  SkillLink,
  SkillSource,
  UnmanagedSkill,
} from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

import { SKILL_ENTRY_FILE, classifyFile, parseSkillDoc } from './parse'
import { centralRoot, makeExternalId, makeSkillId, sourceDirFor, sourceRootFor } from './paths'

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

/** 目录项能否作为 skill 候选（跟随软链） */
async function isDirCandidate(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 判定某个存储位置上该 skill 的链接状态。
 * 只有「指向中央仓库真身的软链」才算 linked，其余占用一律如实报告、绝不覆盖。
 */
export async function linkStateFor(
  source: SkillSource,
  relDir: string,
  centralRealPath: string,
): Promise<SkillLink> {
  const path = sourceDirFor(source, relDir)
  let lst
  try {
    lst = await fs.lstat(path)
  } catch {
    return { state: 'absent', path }
  }

  if (!lst.isSymbolicLink()) return { state: 'conflict', path }

  let target: string
  try {
    target = await fs.readlink(path)
  } catch {
    return { state: 'broken', path }
  }

  let real: string
  try {
    real = await fs.realpath(path)
  } catch {
    return { state: 'broken', path, target }
  }

  if (real === join(centralRealPath, relDir)) return { state: 'linked', path, target: real }
  return { state: 'conflict', path, target: real }
}

function emptyLinks(): Record<SkillSource, SkillLink> {
  const out = {} as Record<SkillSource, SkillLink>
  for (const source of SKILL_SOURCES) out[source] = { state: 'absent', path: '' }
  return out
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

async function resolveReal(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    return p
  }
}

/** 中央仓库真身 → Skill（含三个存储位置的链接状态） */
export async function scanCentral(): Promise<Skill[]> {
  const root = centralRoot()
  const real = await resolveReal(root)
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
    if (!(await isDirCandidate(dirPath))) continue
    const doc = await loadDir(dirPath, entry.name)
    if (!doc) continue

    const links = {} as Record<SkillSource, SkillLink>
    for (const source of SKILL_SOURCES) {
      links[source] = await linkStateFor(source, entry.name, real)
    }

    out.push({
      id: makeSkillId('central', entry.name),
      kind: 'central',
      name: doc.name,
      relDir: entry.name,
      description: doc.description,
      dirPath,
      origin: null,
      links,
      frontmatter: doc.frontmatter,
      files: doc.files,
      mtime: doc.mtime,
      byteSize: doc.byteSize,
    })
  }
  return out
}

/** codex `.system` 内置 skill：只读、锁定 */
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
    const relDir = `.system/${entry.name}`
    const dirPath = join(root, entry.name)
    if (!(await isDirCandidate(dirPath))) continue
    const doc = await loadDir(dirPath, entry.name)
    if (!doc) continue

    const links = emptyLinks()
    links.codex = { state: 'native', path: dirPath }

    out.push({
      id: makeSkillId('builtin', relDir),
      kind: 'builtin',
      name: doc.name,
      relDir,
      description: doc.description,
      dirPath,
      origin: 'codex',
      links,
      frontmatter: doc.frontmatter,
      files: doc.files,
      mtime: doc.mtime,
      byteSize: doc.byteSize,
    })
  }
  return out
}

/**
 * 存储位置里未被中央仓库纳管的条目：
 * 真实目录、指向别处的软链、断链残骸——如实列出，供用户导入或清理。
 * 已指向中央仓库真身的链接由 scanCentral 表达，这里跳过以免重复。
 */
export async function scanExternals(centralRealPath: string): Promise<Skill[]> {
  const out: Skill[] = []

  for (const source of SKILL_SOURCES) {
    const root = sourceRootFor(source)
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const dirPath = join(root, entry.name)
      let lst
      try {
        lst = await fs.lstat(dirPath)
      } catch {
        continue
      }

      if (lst.isSymbolicLink()) {
        const real = await realpathOrNull(dirPath)
        if (real && real === join(centralRealPath, entry.name)) continue
      }

      const links = emptyLinks()
      let name = entry.name
      let description = ''
      let files: SkillFile[] = []
      let mtime = 0
      let byteSize = 0

      if (lst.isSymbolicLink()) {
        let target: string | undefined
        let real: string | null = null
        try {
          target = await fs.readlink(dirPath)
        } catch {
          /* ignore */
        }
        try {
          real = await fs.realpath(dirPath)
        } catch {
          real = null
        }
        if (!real) {
          links[source] = { state: 'broken', path: dirPath, ...(target ? { target } : {}) }
          description = '符号链接失效，无法读取内容'
          out.push({
            id: makeExternalId(source, entry.name),
            kind: 'external',
            name,
            relDir: entry.name,
            description,
            dirPath,
            origin: source,
            links,
            frontmatter: {},
            files,
            mtime,
            byteSize,
          })
          continue
        }
        links[source] = { state: 'conflict', path: dirPath, target: real }
        const doc = await loadDir(dirPath, entry.name)
        if (doc) {
          name = doc.name
          description = doc.description
          files = doc.files
          mtime = doc.mtime
          byteSize = doc.byteSize
        }
      } else if (lst.isDirectory()) {
        const doc = await loadDir(dirPath, entry.name)
        if (!doc) continue
        links[source] = { state: 'conflict', path: dirPath }
        name = doc.name
        description = doc.description
        files = doc.files
        mtime = doc.mtime
        byteSize = doc.byteSize
      } else {
        continue
      }

      out.push({
        id: makeExternalId(source, entry.name),
        kind: 'external',
        name,
        relDir: entry.name,
        description,
        dirPath,
        origin: source,
        links,
        frontmatter: {},
        files,
        mtime,
        byteSize,
      })
    }
  }
  return out
}

/** 目录内容指纹：SKILL.md 内容 + 全部文件相对路径与大小 */
async function fingerprintOf(dir: string): Promise<string> {
  const files: string[] = []
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 6 || files.length > 2000) return
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue
      const abs = join(d, entry.name)
      const st = await fs.stat(abs).catch(() => null)
      if (!st) continue
      if (st.isDirectory()) await walk(abs, depth + 1)
      else if (st.isFile()) files.push(`${relative(dir, abs).split(sep).join('/')}:${st.size}`)
    }
  }
  await walk(dir, 0)
  files.sort()
  const head = await fs.readFile(join(dir, SKILL_ENTRY_FILE), 'utf8').catch(() => '')
  return createHash('sha1').update(head).update('\n').update(files.join('\n')).digest('hex')
}

/**
 * 三个存储位置里尚未纳入中央仓库的 skill（断链残骸除外，它没有内容可纳入）。
 * 与中央仓库同名时标记 conflict，并由 identical 指出内容是否一致。
 */
export async function scanUnmanaged(): Promise<UnmanagedSkill[]> {
  const real = await resolveReal(centralRoot())
  const central = await scanCentral()
  const centralByName = new Map(central.map((s) => [s.relDir, s.dirPath]))
  const externals = await scanExternals(real)

  const out: UnmanagedSkill[] = []
  for (const item of externals) {
    const source = item.origin
    if (!source) continue
    const link = item.links[source]
    if (link.state === 'broken') continue

    const centralPath = centralByName.get(item.relDir)
    const conflict = centralPath !== undefined
    out.push({
      id: `${source}:${item.relDir}`,
      source,
      relDir: item.relDir,
      name: item.name,
      description: item.description,
      path: item.dirPath,
      isSymlink: link.target !== undefined,
      conflict,
      identical: conflict
        ? (await fingerprintOf(item.dirPath)) === (await fingerprintOf(centralPath))
        : false,
    })
  }

  out.sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.name.localeCompare(b.name))
  return out
}

export async function scanAll(): Promise<Skill[]> {
  const real = await resolveReal(centralRoot())
  const central = await scanCentral()
  const [builtins, externals] = await Promise.all([scanBuiltins(), scanExternals(real)])
  const out = [...central, ...builtins, ...externals]
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return out
}
