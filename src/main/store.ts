import { promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { disabledDirFor, disabledRoot, disabledSourceRootFor, sourceDirFor } from './paths'
import { scanAll } from './scanner'
import type { CopyResult, CopyStrategy, FailResult, SetEnabledResult, Skill, SkillSource } from '@shared/types'

function fail(code: FailResult['code'], message: string, conflictAt?: string): FailResult {
  return { ok: false, code, message, ...(conflictAt ? { conflictAt } : {}) }
}

/** 用 lstat：断链也算「已存在」，避免 rename 时 EEXIST 被漏判 */
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

/**
 * 移动目录项。
 * 符号链接只移动链接本体（不触碰真身）；跨卷时先落临时名再原子改名，失败清理残留。
 */
async function moveEntry(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
  }

  const tmp = `${dest}.partial-${Date.now()}`
  await fs.rm(tmp, { recursive: true, force: true })
  try {
    if (await isSymlink(src)) {
      await fs.symlink(await fs.readlink(src), tmp)
    } else {
      await fs.cp(src, tmp, { recursive: true, dereference: true, force: true })
    }
    await fs.rename(tmp, dest)
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
  await fs.rm(src, { recursive: true, force: true })
}

async function removeEntry(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

async function ensureManagedDirs(): Promise<void> {
  await fs.mkdir(disabledRoot(), { recursive: true })
  const sources: SkillSource[] = ['claude', 'codex', 'opencode']
  for (const source of sources) {
    await fs.mkdir(disabledSourceRootFor(source), { recursive: true })
  }
}

async function resolveFreeName(dir: string, name: string): Promise<string> {
  if (!(await exists(join(dir, name)))) return name
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name}-${i}`
    if (!(await exists(join(dir, candidate)))) return candidate
  }
  throw new Error('无法生成唯一名称')
}

export class SkillStore {
  private index = new Map<string, Skill>()

  async init(): Promise<void> {
    await ensureManagedDirs()
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const skills = await scanAll(disabledSourceRootFor)
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

  async setEnabled(id: string, enabled: boolean): Promise<SetEnabledResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.builtin) return fail('LOCKED', '内置 skill 不可停用')
    if (skill.enabled === enabled) return { ok: true }

    const from = skill.dirPath
    const to = enabled ? sourceDirFor(skill.source, skill.relDir) : disabledDirFor(skill.source, skill.relDir)

    if (!(await exists(from))) return fail('NOT_FOUND', 'skill 目录不存在')
    if (await exists(to)) return fail('CONFLICT', '目标位置已存在同名目录', to)

    try {
      await fs.mkdir(dirname(to), { recursive: true })
      await moveEntry(from, to)
    } catch (err) {
      await this.safeRefresh()
      return fail('IO', `移动失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return { ok: true }
  }

  async copyTo(id: string, target: SkillSource, strategy: CopyStrategy): Promise<CopyResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.builtin) return fail('LOCKED', '内置 skill 不可分发')
    if (target === skill.source) return fail('CONFLICT', '目标来源与当前来源相同')
    if (skill.entryKind === 'broken') return fail('NOT_FOUND', '符号链接失效，无法复制')

    const srcDir = skill.dirPath
    if (!(await exists(srcDir))) return fail('NOT_FOUND', 'skill 目录不存在')

    const targetRoot = sourceDirFor(target, '')
    await fs.mkdir(targetRoot, { recursive: true })

    let destName = skill.relDir
    const destDir = join(targetRoot, destName)
    const conflict = await exists(destDir)

    if (conflict) {
      if (strategy === 'ask') return fail('CONFLICT', '目标来源已存在同名 skill', destDir)
      if (strategy === 'skip') return { ok: true, outcome: 'skipped', targetName: destName }
      if (strategy === 'rename') {
        destName = await resolveFreeName(targetRoot, skill.relDir)
      } else {
        await removeEntry(destDir)
      }
    }

    const finalDir = join(targetRoot, destName)
    try {
      // 解引用复制：目标得到独立真身，不依赖原软链指向
      await fs.cp(srcDir, finalDir, { recursive: true, dereference: true, force: true })
    } catch (err) {
      await removeEntry(finalDir).catch(() => undefined)
      return fail('IO', `复制失败：${(err as Error).message}`)
    }
    await this.safeRefresh()
    return {
      ok: true,
      outcome: conflict && strategy === 'overwrite' ? 'overwritten' : 'created',
      targetName: destName
    }
  }

  /**
   * 物理删除（不可恢复）。
   * 符号链接只删除链接本身，不触碰真身——因为真身可能被其它来源的同名链接共享。
   */
  async deleteSkill(id: string): Promise<SetEnabledResult> {
    const skill = this.index.get(id)
    if (!skill) return fail('NOT_FOUND', '未找到该 skill')
    if (skill.builtin) return fail('LOCKED', '内置 skill 不可删除')
    if (!(await exists(skill.dirPath))) return fail('NOT_FOUND', 'skill 目录不存在')

    try {
      if (await isSymlink(skill.dirPath)) {
        await fs.unlink(skill.dirPath)
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
