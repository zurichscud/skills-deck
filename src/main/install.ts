import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { SKILL_ENTRY_FILE } from './parse'

const run = promisify(execFile)

/** 克隆大仓库可能很慢，给足时间；超时后 git 会被杀掉并报错 */
const GIT_TIMEOUT_MS = 180_000
const MAX_SCAN_DEPTH = 3

interface GitRun {
  ok: boolean
  message: string
}

async function git(args: string[], cwd?: string): Promise<GitRun> {
  try {
    await run('git', ['--no-pager', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        // 不等待账号密码输入，也不要下载 LFS 大文件
        GIT_TERMINAL_PROMPT: '0',
        GIT_LFS_SKIP_SMUDGE: '1',
      },
    })
    return { ok: true, message: '' }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const message = (e.stderr || e.message || 'git 执行失败').trim().split('\n').slice(-3).join('\n')
    return { ok: false, message }
  }
}

export interface RepoSkill {
  /** 仓库里的目录名，作为中央仓库的默认名字 */
  name: string
  /** 克隆出来的绝对路径 */
  dir: string
}

/** 校验用户填的仓库地址：只做防注入与空值检查，其余交给 git */
export function validateRepoUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return '请填写 git 仓库地址'
  if (trimmed.startsWith('-')) return '仓库地址不合法'
  if (/\s/.test(trimmed)) return '仓库地址不能包含空格'
  return null
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

/** 深度优先收集 skill 目录：目录里带 SKILL.md 即为一个 skill，不再往下找 */
async function collectSkills(dir: string, depth: number, out: RepoSkill[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return
  if (await isFile(join(dir, SKILL_ENTRY_FILE))) {
    out.push({ name: basename(dir), dir })
    return
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = join(dir, entry.name)
    if (await isDir(child)) await collectSkills(child, depth + 1, out)
  }
}

/**
 * 只把仓库里的 `skills/` 目录拉下来：
 * 浅克隆（--depth 1）+ 部分克隆（--filter=blob:none）+ 稀疏检出（--sparse），
 * 不下载其余目录与历史，仓库再大也不会整仓拉取。
 */
export async function cloneSkillsDir(
  url: string,
  workDir: string,
  subdir = 'skills',
): Promise<RepoSkill[]> {
  await fs.mkdir(workDir, { recursive: true })

  // 依次降级：部分克隆 → 普通浅克隆 → 不稀疏的浅克隆
  const attempts: string[][] = [
    ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--quiet', url, workDir],
    ['clone', '--depth', '1', '--sparse', '--quiet', url, workDir],
    ['clone', '--depth', '1', '--quiet', url, workDir],
  ]

  let cloned = false
  let lastError = ''
  for (const [index, args] of attempts.entries()) {
    if (index > 0) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
      await fs.mkdir(workDir, { recursive: true })
    }
    const result = await git(args)
    if (result.ok) {
      cloned = true
      break
    }
    lastError = result.message
  }
  if (!cloned) throw new Error(`克隆失败：${lastError}`)

  // 稀疏检出 skills/：部分克隆下这一步才按需拉取该目录的 blob
  const sparse = await git(['sparse-checkout', 'set', subdir], workDir)
  if (!sparse.ok) throw new Error(`检出 ${subdir}/ 失败：${sparse.message}`)

  const root = join(workDir, subdir)
  if (!(await isDir(root))) {
    throw new Error(`仓库里没有 ${subdir}/ 目录，无法安装`)
  }

  const out: RepoSkill[] = []
  await collectSkills(root, 0, out)
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
