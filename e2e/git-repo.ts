import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 本地 git 仓库（含 skills/），供「从 Git 仓库安装」E2E 使用 */
export async function createLocalSkillRepo(root: string, skillName: string): Promise<string> {
  const repo = join(root, 'remote-repo')
  const skillDir = join(repo, 'skills', skillName)
  const docsDir = join(repo, 'docs')
  await mkdir(skillDir, { recursive: true })
  await mkdir(docsDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: 本地 git 仓库中的 E2E skill\n---\n\n# ${skillName}\n`,
    'utf8',
  )
  // 仓库里不该被安装的杂物，验证 sparse 只取 skills/
  await writeFile(join(docsDir, 'README.md'), 'not a skill\n', 'utf8')
  await writeFile(join(repo, 'package.json'), '{"name":"remote-fixture"}\n', 'utf8')

  const opts = {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: 'e2e@test.local',
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: 'e2e@test.local',
    },
  }
  await run('git', ['init', '-b', 'main'], opts)
  await run('git', ['add', '.'], opts)
  await run('git', ['commit', '-m', 'seed'], opts)
  return repo
}
