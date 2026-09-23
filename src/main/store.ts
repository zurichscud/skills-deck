import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

import type {
  ActionResult,
  AdoptAction,
  FailResult,
  ImportResult,
  Skill,
  SkillSource,
} from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

import { autoCommit } from './git'
import { SKILL_ENTRY_FILE } from './parse'
import { centralDirFor, centralRoot, sourceDirFor } from './paths'
import { scanAll, scanUnmanaged } from './scanner'

function fail(code: FailResult['code'], message: string, conflictAt?: string): FailResult {
  return { ok: false, code, message, ...(conflictAt ? { conflictAt } : {}) }
}

/** 用 lstat：断链也算「已存在」，避免漏判占用 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

async function isSymlink(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isSymbolicLink()
  } catch {
    return false
  }
}

async function symlinkDir(target: string, linkPath: string): Promise<void> {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await fs.symlink(target, linkPath, type)
}

async function removeEntry(p: string): Promise<void> {
  if (await isSymlink(p)) await fs.unlink(p)
  else await fs.rm(p, { recursive: true, force: true })
}

/** 丢弃本地副本，原地改为指向中央仓库真身的软链 */
async function replaceWithLink(localPath: string, target: string): Promise<void> {
  await removeEntry(localPath)
  await symlinkDir(target, localPath)
}

async function resolveFreeName(dir: string, name: string): Promise<string> {
  if (!(await exists(join(dir, name)))) return name
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name}-${i}`
    if (!(await exists(join(dir, candidate)))) return candidate
  }
  throw new Error('无法生成唯一名称')
}

export interface ImportOptions {
  /** 目标目录名，默认取源目录名 */
  name?: string
  /** 已存在同名时覆盖；否则自动改名共存 */
  overwrite?: boolean
}

export class SkillStore {
  private index = new Map<string, Skill>()

  async init(): Promise<void> {
    await fs.mkdir(centralRoot(), { recursive: true })
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

  /** 在指定存储位置创建指向中央仓库真身的软链（幂等） */
  async link(id: string, source: SkillSource): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可链接')
    if (skill.kind === 'external') return fail('LOCKED', '未纳管的条目，请先导入中央仓库')

    const state = skill.links[source].state
    if (state === 'linked') return { ok: true }
    if (state === 'conflict') {
      return fail('CONFLICT', '目标位置已被同名条目占用', skill.links[source].path)
    }

    if (!(await exists(skill.dirPath))) return fail('NOT_FOUND', '中央仓库中的真身不存在')

    const target = sourceDirFor(source, skill.relDir)
    try {
      await fs.mkdir(dirname(target), { recursive: true })
      // 断链残骸可安全替换：只删链接本体
      if (state === 'broken') await fs.rm(target, { force: true })
      await symlinkDir(skill.dirPath, target)
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `创建链接失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return { ok: true }
  }

  /** 移除指向中央仓库真身的软链（幂等）；不触碰任何非本 skill 的条目 */
  async unlink(id: string, source: SkillSource): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可取消链接')
    if (skill.kind === 'external') return fail('LOCKED', '未纳管的条目，请直接删除或导入')

    const link = skill.links[source]
    if (link.state === 'absent') return { ok: true }
    if (link.state !== 'linked') {
      return fail('CONFLICT', '该位置不是本 skill 的链接，未做改动', link.path)
    }

    try {
      await fs.unlink(link.path)
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `移除链接失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return { ok: true }
  }

  /**
   * 导入一个外部目录到中央仓库。
   * 解引用复制：源若是软链，得到的是独立真身。
   */
  async importSkill(srcPath: string, options: ImportOptions = {}): Promise<ImportResult> {
    const root = centralRoot()
    await fs.mkdir(root, { recursive: true })

    const srcStat = await fs.stat(srcPath).catch(() => null)
    if (!srcStat?.isDirectory()) return fail('NOT_FOUND', '源目录不存在')
    if (!(await exists(join(srcPath, SKILL_ENTRY_FILE)))) {
      return fail('NOT_FOUND', `源目录缺少 ${SKILL_ENTRY_FILE}`)
    }

    const wanted = options.name ?? basename(srcPath)
    let destName = wanted
    const destDir = join(root, destName)

    if (await exists(destDir)) {
      if (options.overwrite) {
        await fs.rm(destDir, { recursive: true, force: true })
      } else {
        destName = await resolveFreeName(root, wanted)
      }
    }

    const finalDir = join(root, destName)
    try {
      await fs.cp(srcPath, finalDir, { recursive: true, dereference: true, force: true })
    } catch (err) {
      await fs.rm(finalDir, { recursive: true, force: true }).catch(() => undefined)
      return fail('IO', `导入失败：${(err as Error).message}`)
    }

    await autoCommit(root, `import: ${destName}`)
    await this.safeRefresh()
    return { ok: true, name: destName, target: finalDir }
  }

  /**
   * 把一个未纳管的 skill 纳入中央仓库管理，并在其原位置留下指向真身的软链。
   * 每一步只处理一个条目，由用户在弹窗中逐项决定。
   */
  async adoptUnmanaged(itemId: string, action: AdoptAction): Promise<ActionResult> {
    const item = (await scanUnmanaged()).find((u) => u.id === itemId)
    if (!item) return fail('NOT_FOUND', '未找到该未纳管条目')

    const root = centralRoot()
    const existing = centralDirFor(item.relDir)

    if (action === 'keep') {
      // 保留中央版本：本地副本丢弃，原地改为指向中央仓库的链接
      if (!(await exists(existing))) return fail('NOT_FOUND', '中央仓库中不存在同名 skill')
      try {
        await replaceWithLink(item.path, existing)
      } catch (err) {
        await this.safeRefresh()
        return fail('IO', `替换失败：${(err as Error).message}`)
      }
      await this.safeRefresh()
      return { ok: true }
    }

    if (!(await exists(item.path))) return fail('NOT_FOUND', '本地条目已不存在')

    let targetName = item.relDir
    if (action === 'adopt' || action === 'overwrite') {
      if (await exists(existing)) {
        if (action === 'adopt') {
          return fail('CONFLICT', '中央仓库已存在同名 skill', existing)
        }
        await fs.rm(existing, { recursive: true, force: true })
      }
    } else {
      targetName = await resolveFreeName(root, item.relDir)
    }

    const targetDir = centralDirFor(targetName)
    try {
      await fs.mkdir(root, { recursive: true })
      // 解引用复制：本地若是软链，得到的是独立真身
      await fs.cp(item.path, targetDir, { recursive: true, dereference: true, force: true })
      await removeEntry(item.path)
      await symlinkDir(targetDir, item.path)
    } catch (err) {
      await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
      await this.safeRefresh()
      return fail('IO', `纳入失败：${(err as Error).message}`)
    }

    await autoCommit(root, `adopt: ${targetName}`)
    await this.safeRefresh()
    return { ok: true }
  }

  /**
   * 删除（不可恢复）。
   * - central：删除真身，并清理三处指向它的软链
   * - external：只删除该未纳管条目本身
   * - builtin：拒绝
   */
  async deleteSkill(id: string): Promise<ActionResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.kind === 'builtin') return fail('LOCKED', '内置 skill 不可删除')
    if (!(await exists(skill.dirPath))) return fail('NOT_FOUND', 'skill 目录不存在')

    try {
      if (skill.kind === 'external' && (await isSymlink(skill.dirPath))) {
        await fs.unlink(skill.dirPath)
        await this.safeRefresh()
        return { ok: true }
      }

      if (skill.kind === 'central') {
        const centralDir = skill.dirPath
        // 先摘链接再删真身：真身一旦消失，realpath 校验就无从谈起
        for (const source of SKILL_SOURCES) {
          const link = skill.links[source]
          if (link.state !== 'linked') continue
          await fs.unlink(link.path).catch(() => undefined)
        }
        await fs.rm(centralDir, { recursive: true, force: true })
        await autoCommit(centralRoot(), `delete: ${skill.name}`)
      } else {
        await fs.rm(skill.dirPath, { recursive: true, force: true })
      }
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `删除失败：${(err as Error).message}`)
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

  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh()
    } catch {
      /* 刷新失败不阻断写操作结果 */
    }
  }
}

export const skillStore = new SkillStore()
