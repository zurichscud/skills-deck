import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run('git', ['--no-pager', ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout.trim() : '',
      stderr: typeof e.stderr === 'string' ? e.stderr.trim() : (e.message ?? 'git 执行失败'),
    }
  }
}

export async function isGitAvailable(): Promise<boolean> {
  const r = await git(process.cwd(), ['--version'])
  return r.ok
}

async function hasRepo(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(join(dir, '.git'))
    return st.isDirectory() || st.isFile()
  } catch {
    return false
  }
}

const GITIGNORE = ['.DS_Store', '**/.DS_Store', ''].join('\n')

/**
 * 确保中央仓库是一个 git 仓库（幂等）。
 * git 不可用时返回 false，调用方不应因此阻断写操作。
 */
export async function ensureRepo(dir: string): Promise<boolean> {
  if (!(await isGitAvailable())) return false
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    return false
  }
  if (!(await hasRepo(dir))) {
    const init = await git(dir, ['init', '-q', '-b', 'main'])
    if (!init.ok) await git(dir, ['init', '-q'])
    const ignore = join(dir, '.gitignore')
    try {
      await fs.access(ignore)
    } catch {
      await fs.writeFile(ignore, GITIGNORE, 'utf8').catch(() => undefined)
    }
  }
  return true
}

export async function lastCommit(dir: string): Promise<string | null> {
  if (!(await hasRepo(dir))) return null
  const r = await git(dir, ['log', '-1', '--pretty=%h %s'])
  return r.ok && r.stdout ? r.stdout : null
}

/**
 * 有改动才提交；无改动、无仓库、git 缺失都静默返回。
 * 身份缺失时用仓库级兜底身份，避免因缺少 user.name 而失败。
 */
export async function autoCommit(
  dir: string,
  message: string,
): Promise<{ committed: boolean; detail?: string }> {
  if (!(await ensureRepo(dir))) return { committed: false, detail: 'git 不可用' }

  const status = await git(dir, ['status', '--porcelain'])
  if (!status.ok) return { committed: false, detail: status.stderr }
  if (!status.stdout) return { committed: false, detail: '无改动' }

  const add = await git(dir, ['add', '-A'])
  if (!add.ok) return { committed: false, detail: add.stderr }

  const identity = await git(dir, ['config', 'user.email'])
  if (!identity.ok || !identity.stdout) {
    await git(dir, ['config', 'user.email', 'skillsdeck@localhost'])
    await git(dir, ['config', 'user.name', 'Skills Deck'])
  }

  const commit = await git(dir, ['commit', '-q', '-m', message])
  if (!commit.ok) return { committed: false, detail: commit.stderr || commit.stdout }
  return { committed: true }
}
