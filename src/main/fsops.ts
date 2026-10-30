import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

const RETRY_DELAYS_MS = [100, 200, 400, 800, 1200, 1600]
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Windows 上杀软、索引器、编辑器会短暂占用刚变动的目录，表现为 EBUSY/EPERM。
 * 退避重试覆盖绝大多数瞬时占用，超出后如实报错。
 */
export async function withRetry<T>(op: () => Promise<T>): Promise<T> {
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

/** 用 lstat：断链也算「已存在」，避免漏判占用 */
export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

export async function isSymlink(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isSymbolicLink()
  } catch {
    return false
  }
}

export async function symlinkDir(target: string, linkPath: string): Promise<void> {
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await withRetry(() => fs.symlink(target, linkPath, type))
}

/** 删除一个条目本体；软链只删链接，不碰目标 */
export async function removeEntry(p: string): Promise<void> {
  if (await isSymlink(p)) await withRetry(() => fs.unlink(p))
  else await withRetry(() => fs.rm(p, { recursive: true, force: true }))
}

/** 复制整个目录（解引用：软链来源得到独立真身） */
export async function copyDir(src: string, dest: string): Promise<void> {
  await withRetry(() => fs.cp(src, dest, { recursive: true, dereference: true, force: true }))
}

/** 移动条目本身（软链移动的是链接，不是目标）；跨卷时回退为复制 + 删除 */
export async function moveEntry(src: string, dest: string): Promise<void> {
  await fs.mkdir(dirname(dest), { recursive: true })
  try {
    await withRetry(() => fs.rename(src, dest))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    if (await isSymlink(src)) {
      const target = await fs.readlink(src)
      await symlinkDir(target, dest)
      await fs.unlink(src)
      return
    }
    await copyDir(src, dest)
    await removeEntry(src)
  }
}

export async function removeQuietly(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true }).catch(() => undefined)
}
