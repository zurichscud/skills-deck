import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

import type {
  ActionResult,
  AdoptAction,
  AdoptAllResult,
  FailResult,
  ImportResult,
  InstallFromGitResult,
  Skill,
  SkillSource,
  UnmanagedSkill,
} from '@shared/types'
import { SKILL_SOURCES } from '@shared/types'

import { autoCommit } from './git'
import { cloneSkillsDir, validateRepoUrl, type RepoSkill } from './install'
import { SKILL_ENTRY_FILE } from './parse'
import { centralDirFor, centralRoot, managedRoot, sourceDirFor } from './paths'
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

const RETRY_DELAYS_MS = [100, 200, 400, 800, 1200, 1600]
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Windows 上杀软、索引器、编辑器会短暂占用刚变动的目录，表现为 EBUSY/EPERM。
 * 退避重试覆盖绝大多数瞬时占用，超出后如实报错。
 */
async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (!RETRYABLE_CODES.has(code) || attempt >= RETRY_DELAYS_MS.length) throw err
      await delay(RETRY_DELAYS_MS[attempt]!)
    }
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
  await withRetry(() => fs.symlink(target, linkPath, type))
}

async function removeEntry(p: string): Promise<void> {
  if (await isSymlink(p)) await withRetry(() => fs.unlink(p))
  else await withRetry(() => fs.rm(p, { recursive: true, force: true }))
}

/** 解引用复制整个目录（软链来源得到独立真身） */
async function copyDir(src: string, dest: string): Promise<void> {
  await withRetry(() => fs.cp(src, dest, { recursive: true, dereference: true, force: true }))
}

async function removeQuietly(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true }).catch(() => undefined)
}

async function copyQuietly(src: string, dest: string): Promise<boolean> {
  try {
    await copyDir(src, dest)
    return true
  } catch {
    return false
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

export interface ImportOptions {
  /** 目标目录名，默认取源目录名 */
  name?: string
  /** 已存在同名时覆盖；否则自动改名共存 */
  overwrite?: boolean
  /** 是否立即 git 提交（批量导入时由调用方统一提交） */
  commit?: boolean
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
      if (state === 'broken') await withRetry(() => fs.rm(target, { force: true }))
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
      await withRetry(() => fs.unlink(link.path))
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
        await removeEntry(destDir)
      } else {
        destName = await resolveFreeName(root, wanted)
      }
    }

    const finalDir = join(root, destName)
    try {
      await copyDir(srcPath, finalDir)
    } catch (err) {
      await removeQuietly(finalDir)
      return fail('IO', `导入失败：${(err as Error).message}`)
    }

    if (options.commit !== false) await autoCommit(root, `import: ${destName}`)
    await this.safeRefresh()
    return { ok: true, name: destName, target: finalDir }
  }

  /**
   * 从 git 仓库安装 skills：只克隆仓库里的 `skills/` 目录（浅克隆 + 部分克隆 + 稀疏检出），
   * 再逐个导入中央仓库。同名冲突自动以 -2 后缀并存，不覆盖已有内容。
   */
  async installFromGit(url: string): Promise<InstallFromGitResult | FailResult> {
    const invalid = validateRepoUrl(url)
    if (invalid) return fail('IO', invalid)

    const repo = url.trim()
    const workDir = join(managedRoot(), 'tmp', `install-${Date.now()}`)
    let discovered: RepoSkill[]
    try {
      discovered = await cloneSkillsDir(repo, workDir)
    } catch (err) {
      await removeQuietly(workDir)
      return fail('IO', (err as Error).message)
    }

    if (discovered.length === 0) {
      await removeQuietly(workDir)
      return fail('NOT_FOUND', '仓库的 skills/ 目录里没有找到含 SKILL.md 的 skill')
    }

    const installed: { source: string; name: string }[] = []
    const failed: { name: string; message: string }[] = []
    for (const skill of discovered) {
      const result = await this.importSkill(skill.dir, { name: skill.name, commit: false })
      if (result.ok) installed.push({ source: skill.name, name: result.name })
      else failed.push({ name: skill.name, message: result.message })
    }

    await removeQuietly(workDir)
    if (installed.length > 0) {
      await autoCommit(centralRoot(), `install: ${repo}（${installed.length} 个）`)
    }
    await this.safeRefresh()
    return { ok: true, repo, installed, failed }
  }

  /**
   * 把一个未纳管的 skill 纳入中央仓库管理，并在其原位置留下指向真身的软链。
   * 每一步只处理一个条目，由用户在弹窗中逐项决定。
   */
  async adoptUnmanaged(itemId: string, action: AdoptAction): Promise<ActionResult> {
    const item = (await scanUnmanaged()).find((u) => u.id === itemId)
    if (!item) return fail('NOT_FOUND', '未找到该未纳管条目')
    return this.adoptOne(item, action)
  }

  /**
   * 一键导入：把所有「没有同名冲突」的未纳管条目直接纳入中央仓库。
   * 同名冲突必须由用户逐项决定，这里原样跳过并如实回报。
   */
  async adoptAllUnmanaged(): Promise<AdoptAllResult | FailResult> {
    return this.adoptBatch(await scanUnmanaged())
  }

  /**
   * 批量纳入指定条目（选中若干项时使用），同名冲突同样跳过。
   * 兼容两种 id：`UnmanagedSkill.id`（`claude:foo`）与列表行的
   * `Skill.id`（`external:claude:foo`）——渲染层勾选后传的是后者。
   */
  async adoptManyUnmanaged(itemIds: string[]): Promise<AdoptAllResult | FailResult> {
    const wanted = new Set(itemIds)
    for (const id of itemIds) {
      if (id.startsWith('external:')) wanted.add(id.slice('external:'.length))
    }
    const items = (await scanUnmanaged()).filter((i) => wanted.has(i.id))
    if (items.length === 0) return fail('NOT_FOUND', '未找到要纳入的条目')
    return this.adoptBatch(items)
  }

  private async adoptBatch(items: UnmanagedSkill[]): Promise<AdoptAllResult> {
    const targets = items.filter((i) => !i.conflict)
    let adopted = 0
    let failed = 0

    for (const item of targets) {
      const result = await this.adoptOne(item, 'adopt', false)
      if (result.ok) adopted++
      else failed++
    }

    if (adopted > 0) await autoCommit(centralRoot(), `adopt: 批量纳入 ${adopted} 个`)
    await this.safeRefresh()
    return { ok: true, adopted, conflicts: items.length - targets.length, failed }
  }

  /**
   * 单个条目的纳入流程。
   * 先复制再删除，任一步失败都回滚——绝不出现「原位置与中央仓库都没有」的空档。
   */
  private async adoptOne(
    item: UnmanagedSkill,
    action: AdoptAction,
    commit = true,
  ): Promise<ActionResult> {
    if (!(await exists(item.path))) return fail('NOT_FOUND', '本地条目已不存在')

    const root = centralRoot()
    const existing = centralDirFor(item.relDir)

    if (action === 'keep') {
      // 保留中央版本：本地副本按选择丢弃，原地改为指向中央仓库的链接
      if (!(await exists(existing))) return fail('NOT_FOUND', '中央仓库中不存在同名 skill')
      try {
        await removeEntry(item.path)
        await symlinkDir(existing, item.path)
      } catch (err) {
        await this.safeRefresh()
        return fail(
          'IO',
          `替换失败：${(err as Error).message}；本地副本已按选择丢弃，可在列表中把中央版本链接回来`,
        )
      }
      await this.safeRefresh()
      return { ok: true }
    }

    if (action === 'adopt' && (await exists(existing))) {
      return fail('CONFLICT', '中央仓库已存在同名 skill', existing)
    }

    const targetName = action === 'rename' ? await resolveFreeName(root, item.relDir) : item.relDir
    const targetDir = centralDirFor(targetName)
    // 隐藏名：扫描器与监听器都会忽略，仅在回滚窗口内存在
    const backupDir = join(root, `.backup-${targetName}-${Date.now()}`)
    let centralBackedUp = false
    let sourceTouched = false

    try {
      await fs.mkdir(root, { recursive: true })
      // overwrite：先备份中央版本，失败时才能原样还回去
      if (action === 'overwrite' && (await exists(existing))) {
        await copyDir(existing, backupDir)
        centralBackedUp = true
        await removeEntry(existing)
      }
      await copyDir(item.path, targetDir)
      sourceTouched = true
      await removeEntry(item.path)
      await symlinkDir(targetDir, item.path)
    } catch (err) {
      const message = (err as Error).message
      // 回滚：先把内容还回原位置，再清理中央仓库里的半成品
      if (sourceTouched && !(await copyQuietly(targetDir, item.path))) {
        await this.safeRefresh()
        return fail(
          'IO',
          `纳入失败：${message}；原位置恢复失败，内容已保留在中央仓库 ${targetDir}` +
            (centralBackedUp ? `，原中央版本备份在 ${backupDir}` : ''),
        )
      }
      if (centralBackedUp) {
        await removeQuietly(targetDir)
        if (!(await copyQuietly(backupDir, existing))) {
          await this.safeRefresh()
          return fail('IO', `纳入失败：${message}；中央版本回滚失败，备份保留在 ${backupDir}`)
        }
      } else {
        await removeQuietly(targetDir)
      }
      await removeQuietly(backupDir)
      await this.safeRefresh()
      return fail('IO', `纳入失败：${message}（已恢复原状，可稍后重试）`)
    }

    await removeQuietly(backupDir)
    if (commit) await autoCommit(root, `adopt: ${targetName}`)
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
        await withRetry(() => fs.unlink(skill.dirPath))
        await this.safeRefresh()
        return { ok: true }
      }

      if (skill.kind === 'central') {
        const centralDir = skill.dirPath
        // 先摘链接再删真身：真身一旦消失，realpath 校验就无从谈起
        for (const source of SKILL_SOURCES) {
          const link = skill.links[source]
          if (link.state !== 'linked') continue
          await withRetry(() => fs.unlink(link.path)).catch(() => undefined)
        }
        await removeEntry(centralDir)
        await autoCommit(centralRoot(), `delete: ${skill.name}`)
      } else {
        await removeEntry(skill.dirPath)
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
