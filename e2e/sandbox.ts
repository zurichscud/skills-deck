import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 每个用例独立的四根路径 + 应用数据目录，绝不指向真实 ~ */
export interface Sandbox {
  root: string
  central: string
  claude: string
  codex: string
  opencode: string
  managed: string
}

export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'skillsdeck-e2e-'))
  const sandbox: Sandbox = {
    root,
    central: join(root, 'central'),
    claude: join(root, 'claude'),
    codex: join(root, 'codex'),
    opencode: join(root, 'opencode'),
    managed: join(root, 'managed'),
  }
  for (const dir of [
    sandbox.central,
    sandbox.claude,
    sandbox.codex,
    sandbox.opencode,
    sandbox.managed,
  ]) {
    await mkdir(dir, { recursive: true })
  }
  // 关闭行为设为直接退出，避免 teardown 弹「关闭确认」卡死
  await writeFile(
    join(sandbox.managed, 'config.json'),
    `${JSON.stringify(
      {
        centralRoot: sandbox.central,
        sourceRoots: {
          claude: sandbox.claude,
          codex: sandbox.codex,
          opencode: sandbox.opencode,
        },
        closeBehavior: 'quit',
        menu: { order: [], hidden: [] },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return sandbox
}

export async function destroySandbox(sandbox: Sandbox): Promise<void> {
  await rm(sandbox.root, { recursive: true, force: true }).catch(() => undefined)
}

/** 种一个标准 SKILL.md 目录（不含 git，不碰真实仓库） */
export async function seedSkill(
  dir: string,
  name: string,
  description = `E2E skill ${name}`,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n由 E2E 播种。\n`,
    'utf8',
  )
  await mkdir(join(dir, 'references'), { recursive: true })
  await writeFile(join(dir, 'references', 'notes.md'), `# ${name} notes\n`, 'utf8')
  return dir
}
