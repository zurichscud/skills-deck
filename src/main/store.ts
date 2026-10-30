import { promises as fs } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

import type {
  ActionResult,
  FailResult,
  Skill,
  SkillLink,
  SkillSource,
  TrashItem,
} from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

import { exists, symlinkDir, withRetry } from './fsops'
import { sourceDirFor, trashRoot } from './paths'
import { scanAll } from './scanner'
import {
  emptyTrash,
  purgeTrashItem,
  restoreTrashItem,
  scanTrash,
  trashEntry,
  trashPathOf,
} from './trash'

function fail(code: FailResult['code'], message: string, conflictAt?: string): FailResult {
  return { ok: false, code, message, ...(conflictAt ? { conflictAt } : {}) }
}

/** 回滚用：把刚删掉的软链照原样建回去；目标未知的条目不重建 */
async function relink(links: SkillLink[]): Promise<void> {
  for (const link of links) {
    if (!link.target) continue
    try {
      await fs.mkdir(dirname(link.path), { recursive: true })
      await symlinkDir(link.target, link.path)
    } catch {
      /* 回滚尽力而为，失败也不掩盖原始错误 */
    }
  }
}

export class SkillStore {
  private index = new Map<string, Skill>()

  async init(): Promise<void> {
    await fs.mkdir(trashRoot(), { recursive: true })
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const skills = await scanAll()
    this.index = new Map(skills.map((s) => [s.id, s]))
  }

  list(): Skill[] {
    return [...this.index.values()]
  }

  get(id: string): Skill | undefined {
    return this.index.get(id)
  }

  async readFile(id: string, relPath: string): Promise<{ ok: true; content: string } | FailResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (relPath.includes('\0')) return fail('IO', '非法路径')
    const resolved = resolve(skill.dirPath, relPath)
    const root = resolve(skill.dirPath)
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      return fail('IO', '路径越界')
    }
    try {
      return { ok: true, content: await fs.readFile(resolved, 'utf8') }
    } catch {
      return fail('IO', '读取文件失败')
    }
  }

  /** 在目标存储位置创建指向本体的软链（幂等）；被占用时中止，绝不覆盖 */
  async link(id: string, source: SkillSource): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可链接')
    if (skill.broken) return fail('NOT_FOUND', '内容已失效，没有可链接的对象')

    const link = skill.links[source]
    if (link.state === 'self') return fail('CONFLICT', '本体就在这个位置', link.path)
    if (link.state === 'linked') return { ok: true }
    if (link.state === 'conflict') {
      return fail('CONFLICT', '目标位置已被同名条目占用', link.path)
    }
    if (!(await exists(skill.dirPath))) return fail('NOT_FOUND', '内容已不存在')

    const target = sourceDirFor(source, skill.relDir)
    try {
      await fs.mkdir(dirname(target), { recursive: true })
      // 断链残骸可安全替换：只删链接本体
      if (link.state === 'broken') await withRetry(() => fs.rm(target, { force: true }))
      await symlinkDir(skill.dirPath, target)
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `创建链接失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return { ok: true }
  }

  /** 移除指向本体的软链（幂等）；不触碰任何非本 skill 的条目 */
  async unlink(id: string, source: SkillSource): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可取消链接')

    const link = skill.links[source]
    if (link.state === 'absent') return { ok: true }
    if (link.state === 'native') return fail('LOCKED', '内置 skill 不可取消链接')
    if (link.state === 'self') {
      return fail('CONFLICT', '本体就在这个位置，取消链接即删除内容，请改用删除', link.path)
    }
    if (link.state !== 'linked') {
      return fail('CONFLICT', '该位置不是本 skill 的链接，未做改动', link.path)
    }

    try {
      await withRetry(() => fs.unlink(link.path))
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `移除链接失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return { ok: true }
  }

  /**
   * 删除：软链直接删掉，不进回收站；只有真实内容（本体）移入回收站，可恢复。
   * 先删链接再搬本体：本体搬迁失败就把刚删的链接照原样建回去，绝不留半截状态。
   */
  async deleteSkill(id: string): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可删除')

    const content = SKILL_SOURCES.find((source) => skill.links[source].state === 'self')
    // 只带走属于自己的条目：别人留在同名位置上的失效残骸不牵连
    const links = SKILL_SOURCES.filter((source) => {
      const state = skill.links[source].state
      return state === 'linked' || (state === 'broken' && skill.broken)
    }).map((source) => skill.links[source])
    if (content === undefined && links.length === 0) return fail('NOT_FOUND', '没有可删除的条目')

    const removed: SkillLink[] = []
    for (const link of links) {
      try {
        await withRetry(() => fs.unlink(link.path))
      } catch (err) {
        await relink(removed)
        await this.safeRefresh()
        return fail('IO', `删除链接失败：${(err as Error).message}`)
      }
      removed.push(link)
    }

    if (content !== undefined) {
      const result = await trashEntry({
        path: skill.links[content].path,
        relDir: skill.relDir,
        name: skill.name,
        origin: content,
        byteSize: skill.byteSize,
      })
      if (!result.ok) {
        await relink(removed)
        await this.safeRefresh()
        return result
      }
    }

    await this.safeRefresh()
    return { ok: true }
  }

  async revealInFinder(id: string): Promise<FailResult | null> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    const { shell } = await import('electron')
    shell.showItemInFolder(skill.dirPath)
    return null
  }

  /* ------------------------------- 回收站 ------------------------------- */

  trash(): Promise<TrashItem[]> {
    return scanTrash()
  }

  restoreFromTrash(itemId: string): Promise<ActionResult> {
    return restoreTrashItem(itemId)
  }

  purgeTrash(itemId: string): Promise<ActionResult> {
    return purgeTrashItem(itemId)
  }

  emptyTrash(): Promise<ActionResult> {
    return emptyTrash()
  }

  async revealTrashItem(itemId: string): Promise<FailResult | null> {
    const path = trashPathOf(itemId)
    if (!path || !(await exists(path))) return fail('NOT_FOUND', '回收站里已没有这个条目')
    const { shell } = await import('electron')
    shell.showItemInFolder(path)
    return null
  }

  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh()
    } catch {
      /* 刷新失败不阻断写操作结果 */
    }
  }
}

export const skillStore = new SkillStore()
