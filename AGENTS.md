# AGENTS.md

Skills Deck：统一管理 Claude Code / Codex / opencode 三方 Agent Skill 的 Electron 桌面应用（electron-vite + React 19 + Tailwind 4 + shadcn/ui，macOS 优先）。代码注释、UI 文案、提交信息均为中文。

## 常用命令

```bash
npm run dev        # Electron + HMR（不是浏览器 dev server）
npm test           # vitest run，一次跑完 8 个测试文件
npx vitest run tests/store.test.ts   # 单个文件
npx vitest run -t "建链幂等"          # 按用例名过滤
npm run check      # lint + format:check + typecheck（改完必跑）
npm run format     # oxfmt 自动修复格式与 import/Tailwind 排序
npm run dist       # lint + typecheck + build + electron-builder → release/<version>/
```

## 代码约定

- 工具链是 **oxlint + oxfmt**（没有 eslint/prettier）。无分号、单引号、100 列；Tailwind 类名按 `src/renderer/src/assets/main.css` 排序，识别 `cn`/`clsx`/`cva`。配置见 `.oxlintrc.json` / `.oxfmtrc.json`。
- 别名：`@shared` → `src/shared`（main/preload/renderer/vitest 都可用）；`@` → `src/renderer/src`（仅 renderer）。
- typecheck 分两套：`tsconfig.node.json`（main/preload，CommonJS）/ `tsconfig.web.json`（renderer，ESM bundler）；根 `tsconfig.json` 额外覆盖 `tests/`。

## 架构铁律（改动前先确认）

- `src/shared/types.ts` 是**唯一跨进程契约**：改接口先改它，再同步 preload / main / renderer。
- `src/main/store.ts` 是**唯一状态属主与全部写操作入口**；`scanner.ts` 只读；`parse.ts` / `paths.ts` 保持纯函数、可脱离 Electron 单测。
- IPC 通道白名单在 `src/main/ipc.ts`；preload 严格按 `SkillApi` 实现 `window.api`，renderer 只依赖契约。
- 链接状态机 `linked / absent / broken / conflict / native`：**只动自己的软链，绝不覆盖他人条目**；遇占用中止并返回 `{ ok:false, code:'CONFLICT', conflictAt }`。`.system` 内置 skill 全锁（不可链接/删除）。`skills:readFile` 必须防 `..` 路径越界。
- 所有写操作统一返回 `{ ok:true } | { ok:false, code, message }`，renderer 必须处理失败分支。

## 测试策略

- **绝不「先写实现、后补单测」**。
- **优先 E2E，把它当作唯一测试手段**：用真实应用（`npm run dev`）跑完整流程验证复杂特性。E2E 收尾必须留下**可验证、可复现的工件**（可重跑的脚本 / 报告 / 截图），只给口头结论不算完成。
- 确实需要隔离测试某个系统时：**先穷举它可能失败的每一种方式，再写实现**（失败清单在前，代码在后）。
- 现有 `tests/**/*.test.ts`（node 环境，vitest）只作为纯函数与写操作语义的历史回归保留：直接 import main 进程模块（相对路径）与 `use-skills.ts` 纯函数（`views.test.ts`），**必须用 vitest 跑**（依赖 `@shared` alias）。不要为新增实现事后补单测。
- 跑测试或 E2E 一律 `mkdtemp` 临时目录 + `SKILLSDECK_CENTRAL_ROOT`、`SKILLSDECK_SOURCE_ROOT_{CLAUDE,CODEX,OPENCODE}`、`SKILLSDECK_MANAGED_ROOT` 环境变量隔离，进程内配置用 `applyPathOverrides()`。**绝不要指向真实 `~` 目录**——导入/纳入/删除会自动对中央仓库 `git commit`（分支 `main`）。

## 文档

- `README.md` 是详细规格：链接语义表、未纳管纳入流程（adopt/overwrite/rename/keep）、完整 IPC 表、安全边界。改 `store.ts` / `scanner.ts` 语义前先读。
- 应用运行数据在 `~/Library/Application Support/skillsdeck/config.json`；中央仓库默认 `~/.skills-deck/skills`。手动跑 `npm run dev` 会真实读写这些目录。
