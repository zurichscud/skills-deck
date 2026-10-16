# AGENTS.md

Skills Deck：统一管理 Claude Code / Codex / opencode / Agents 四个存储位置里 Agent Skill 的 Electron 桌面应用（electron-vite + React 19 + Tailwind 4 + shadcn/ui，macOS 优先）。代码注释、UI 文案、提交信息均为中文。

## 常用命令

```bash
npm run dev        # Electron + HMR（不是浏览器 dev server）
npm test           # vitest run，一次跑完全部测试文件
npx vitest run tests/store.test.ts   # 单个文件
npx vitest run -t "建链幂等"          # 按用例名过滤
npm run check      # lint + format:check + typecheck（改完必跑）
npm run format     # oxfmt 自动修复格式与 import/Tailwind 排序
npm run test:e2e   # build + Playwright Electron E2E（沙箱隔离，报告在 playwright-report/，截图在 e2e/artifacts/）
npm run dist       # lint + typecheck + build + electron-builder → release/<version>/
```

## 代码约定

- 工具链是 **oxlint + oxfmt**（没有 eslint/prettier）。无分号、单引号、100 列；Tailwind 类名按 `src/renderer/src/assets/main.css` 排序，识别 `cn`/`clsx`/`cva`。配置见 `.oxlintrc.json` / `.oxfmtrc.json`。
- 别名：`@shared` → `src/shared`（main/preload/renderer/vitest 都可用）；`@` → `src/renderer/src`（仅 renderer）。
- typecheck 分两套：`tsconfig.node.json`（main/preload，CommonJS）/ `tsconfig.web.json`（renderer，ESM bundler）；根 `tsconfig.json` 额外覆盖 `tests/`。

## 架构铁律（改动前先确认）

- `src/shared/types.ts` 是**唯一跨进程契约**：改接口先改它，再同步 preload / main / renderer。
- `src/main/store.ts` 是**唯一状态属主与全部写操作入口**（含回收站的恢复/彻底删除/清空）；`scanner.ts` 只读；`trash.ts` 只管回收站的落盘；`fsops.ts` 是无业务的文件操作与重试；`parse.ts` / `paths.ts` 保持纯函数、可脱离 Electron 单测。
- IPC 通道白名单在 `src/main/ipc.ts`；preload 严格按 `SkillApi` 实现 `window.api`，renderer 只依赖契约；渲染层传来的位置标识必须在 ipc 层过白名单。
- **没有中央仓库**：skill 的内容本体就在某个存储位置里，其余位置放指向它的软链。归并按解析后的真实路径（`realpath`）分组，同名但内容不同的条目互相记为 `conflict`。
- 链接状态机 `self / linked / absent / broken / conflict / native`：**只动自己的软链，绝不覆盖他人条目**；遇占用中止并返回 `{ ok:false, code:'CONFLICT', conflictAt }`。`broken` 是失效残骸，任何 skill 都可安全替换。`.system` 内置 skill 全锁（不可链接/删除）。`skills:readFile` 必须防 `..` 路径越界。
- **删除 = 移入回收站**（`managedRoot()/trash/<id>/`，含 `meta.json` 索引）：本体目录与各处软链一起进站，可恢复；恢复时原位置被占用就拒绝，绝不覆盖。内置 skill 拒绝删除。
- 所有写操作统一返回 `{ ok:true } | { ok:false, code, message }`，renderer 必须处理失败分支。

## 测试策略

- **绝不「先写实现、后补单测」**。
- **优先 E2E，把它当作唯一测试手段**：用真实应用（`npm run dev`）跑完整流程验证复杂特性。E2E 收尾必须留下**可验证、可复现的工件**（可重跑的脚本 / 报告 / 截图），只给口头结论不算完成。
- 确实需要隔离测试某个系统时：**先穷举它可能失败的每一种方式，再写实现**（失败清单在前，代码在后）。
- 现有 `tests/**/*.test.ts`（node 环境，vitest）只作为纯函数与写操作语义的历史回归保留：直接 import main 进程模块（相对路径）与 `use-skills.ts` 纯函数（`views.test.ts`），**必须用 vitest 跑**（依赖 `@shared` alias）。不要为新增实现事后补单测。
- Electron E2E 在 `e2e/`（Playwright `_electron`，`npm run test:e2e`）：每个用例 `mkdtemp` 沙箱 + `SKILLSDECK_*` 环境变量隔离，只碰临时目录；工件为 `playwright-report/`（HTML）与 `e2e/artifacts/*.png`（关键步骤截图）。
- 跑测试或 E2E 一律 `mkdtemp` 临时目录 + `SKILLSDECK_SOURCE_ROOT_{CLAUDE,CODEX,OPENCODE,AGENTS}`、`SKILLSDECK_MANAGED_ROOT`、`SKILLSDECK_TRASH_ROOT` 环境变量隔离，进程内配置用 `applyPathOverrides()`。**绝不要指向真实 `~` 目录**。
- **E2E 不显示窗口**：夹具固定传 `SKILLSDECK_HEADLESS=1`，主进程建窗后不 `show()`、隐藏 Dock 图标，并且 `backgroundThrottling:false` 让隐藏窗口照常渲染；`page` 夹具会统计窗口的 `show` 事件，一旦有窗口被显示就叫停用例。**不要在渲染层用 `window.confirm` / `alert` / `prompt`**——Electron 会为原生模态把窗口显示出来，二次确认一律用应用内的 `AlertDialog`。

## 文档

- `README.md` 是详细规格：链接语义表、删除与回收站流程、完整 IPC 表、安全边界。改 `store.ts` / `scanner.ts` / `trash.ts` 语义前先读。
- 应用运行数据在 `~/Library/Application Support/skillsdeck/config.json`，回收站默认在 `~/Library/Application Support/skillsdeck/trash`。手动跑 `npm run dev` 会真实读写这些目录。
- 存储位置默认目录：`~/.claude/skills`、`~/.codex/skills`、`~/.config/opencode/skills`、`~/.agents/skills`。
