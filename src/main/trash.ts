import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import type { ActionResult, FailResult, SkillSource, TrashItem, TrashKind } from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

import { exists, isSymlink, moveEntry, removeQuietly, withRetry } from './fsops'
import { sourceRootFor, trashRoot } from './paths'

const ENTRY_NAME = 'entry'
const META_NAME = 'meta.json'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function fail(code: FailResult['code'], message: string, conflictAt?: string): FailResult {
  return { ok: false, code, message, ...(conflictAt ? { conflictAt } : {}) }
}

interface TrashMeta {
  id: string
  relDir: string
  name: string
  origin: SkillSource | null
  kind: TrashKind
  linkTarget?: string
  sourcePath: string | null
  deletedAt: number
  byteSize: number
}

export interface TrashInput {
  /** 要移除的条目路径 */
  path: string
  relDir: string
  name: string
  origin: SkillSource
  /** 软链的原目标，恢复时按它重建 */
  linkTarget?: string
  byteSize: number
}

function boxOf(id: string): string {
  return join(trashRoot(), id)
}

function entryOf(id: string): string {
  return join(boxOf(id), ENTRY_NAME)
}

function metaOf(id: string): string {
  return join(boxOf(id), META_NAME)
}

/** id 来自 IPC，必须挡住 `..` 与绝对路径 */
function safeId(id: unknown): string | null {
  return typeof id === 'string' && ID_PATTERN.test(id) && !id.includes('..') ? id : null
}

/** 恢复目标必须落在某个存储位置里，防止被构造的索引写到别处 */
function isInsideLocations(p: string): boolean {
  return SKILL_SOURCES.some((source) => {
    const rel = relative(sourceRootFor(source), p)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

async function readMeta(id: string): Promise<TrashMeta | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(metaOf(id), 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as TrashMeta
  } catch {
    return null
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '')
}

async function allocateId(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const id = `${stamp()}-${randomUUID().slice(0, 6)}`
    if (!(await exists(boxOf(id)))) return id
  }
  return `${stamp()}-${randomUUID()}`
}

/** 把一个条目搬进回收站：先落盘内容，再写索引；任一步失败都搬回原处 */
export async function trashEntry(
  input: TrashInput,
): Promise<{ ok: true; item: TrashItem } | FailResult> {
  const symlink = await isSymlink(input.path)
  if (!symlink && !(await exists(input.path))) return fail('NOT_FOUND', '条目已不存在')

  const id = await allocateId()
  const box = boxOf(id)
  const dest = entryOf(id)
  const meta: TrashMeta = {
    id,
    relDir: input.relDir,
    name: input.name,
    origin: input.origin,
    kind: symlink ? 'symlink' : 'dir',
    ...(input.linkTarget ? { linkTarget: input.linkTarget } : {}),
    sourcePath: input.path,
    deletedAt: Date.now(),
    byteSize: input.byteSize,
  }

  try {
    await fs.mkdir(box, { recursive: true })
    await moveEntry(input.path, dest)
    await fs.writeFile(metaOf(id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  } catch (err) {
    if (await exists(dest)) await moveEntry(dest, input.path).catch(() => undefined)
    await removeQuietly(box)
    return fail('IO', `移入回收站失败：${(err as Error).message}`)
  }

  return {
    ok: true,
    item: {
      id,
      relDir: meta.relDir,
      name: meta.name,
      origin: meta.origin,
      kind: meta.kind,
      ...(meta.linkTarget ? { linkTarget: meta.linkTarget } : {}),
      sourcePath: meta.sourcePath,
      deletedAt: meta.deletedAt,
      byteSize: meta.byteSize,
      hasContent: meta.kind === 'dir',
    },
  }
}

/** 回收站内容清单（按删除时间倒序）；索引损坏的条目如实列出、只允许彻底删除 */
export async function scanTrash(): Promise<TrashItem[]> {
  const root = trashRoot()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const out: TrashItem[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const id = safeId(entry.name)
    if (!id) continue
    const path = entryOf(id)
    const stat = await fs.lstat(path).catch(() => null)
    if (!stat) continue

    const meta = await readMeta(id)
    const kind: TrashKind = meta?.kind ?? (stat.isSymbolicLink() ? 'symlink' : 'dir')
    out.push({
      id,
      relDir: meta?.relDir ?? id,
      name: meta?.name ?? id,
      origin: meta?.origin ?? null,
      kind,
      ...(meta?.linkTarget ? { linkTarget: meta.linkTarget } : {}),
      sourcePath: meta?.sourcePath ?? null,
      deletedAt: meta?.deletedAt ?? stat.mtimeMs,
      byteSize: meta?.byteSize ?? 0,
      hasContent: kind === 'dir',
    })
  }

  out.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  return out
}

/** 放回原位置；原位置已被占用时拒绝，绝不覆盖 */
export async function restoreTrashItem(idInput: string): Promise<ActionResult> {
  const id = safeId(idInput)
  if (!id) return fail('IO', '非法的条目 id')

  const from = entryOf(id)
  if (!(await exists(from))) return fail('NOT_FOUND', '回收站里已没有这个条目')

  const meta = await readMeta(id)
  if (!meta?.sourcePath) return fail('NOT_FOUND', '缺少原位置信息，只能彻底删除')
  if (!isInsideLocations(meta.sourcePath)) {
    return fail('IO', '原位置不在任何存储位置里，拒绝恢复')
  }
  if (await exists(meta.sourcePath)) {
    return fail('CONFLICT', '原位置已被同名条目占用', meta.sourcePath)
  }

  try {
    await moveEntry(from, meta.sourcePath)
  } catch (err) {
    return fail('IO', `恢复失败：${(err as Error).message}`)
  }
  await removeQuietly(boxOf(id))
  return { ok: true }
}

/** 彻底删除一个条目，不可恢复 */
export async function purgeTrashItem(idInput: string): Promise<ActionResult> {
  const id = safeId(idInput)
  if (!id) return fail('IO', '非法的条目 id')

  const box = boxOf(id)
  if (!(await exists(box))) return fail('NOT_FOUND', '回收站里已没有这个条目')
  try {
    await withRetry(() => fs.rm(box, { recursive: true, force: true }))
  } catch (err) {
    return fail('IO', `删除失败：${(err as Error).message}`)
  }
  return { ok: true }
}

/** 清空回收站：全部彻底删除 */
export async function emptyTrash(): Promise<ActionResult> {
  const root = trashRoot()
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return { ok: true }
  }

  const failed: string[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    try {
      await withRetry(() => fs.rm(join(root, name), { recursive: true, force: true }))
    } catch (err) {
      failed.push(`${name}：${(err as Error).message}`)
    }
  }
  if (failed.length > 0) return fail('IO', `${failed.length} 个条目未能删除：${failed[0]}`)
  return { ok: true }
}

/** 回收站条目的所在目录，用于「在 Finder 中显示」 */
export function trashPathOf(idInput: string): string | null {
  const id = safeId(idInput)
  return id ? entryOf(id) : null
}
