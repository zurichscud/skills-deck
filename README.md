# Skills Deck

统一管理 **Claude Code / Codex / opencode** 三方 Agent Skill 的 macOS 桌面应用。

用一套界面查看、启停、分发、删除散落在多个目录里的 skill，并明确回答一个核心问题：**这个 Agent 到底能用哪些 skill？**

---

## 一、核心概念

理解本软件只需三个概念：**存储位置 → Skill 条目 → 工作区**。

### 1. 存储位置（Storage Location）

skill 文件在磁盘上的**物理存放目录**。默认三个，可在设置中改址：

| 位置 | 默认路径 |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.codex/skills` |
| opencode | `~/.config/opencode/skills` |

每个位置下是若干 skill 目录，格式统一：`SKILL.md`（YAML frontmatter）+ 可选附属资源（`references/`、`templates/`、脚本、图片等）。

### 2. Skill 条目（Skill）

**「一个位置上的一个 skill 目录」**即一条条目。同一 skill 若在三个位置各有一份，就是**三条独立条目**——可分别启停、分别删除。

标识：`id = `${source}:${relDir}``，例如 `claude:vue`、`codex:.system/imagegen`。用 `relDir` 而非 `name` 参与 id，是为了能表达嵌套路径（如 Codex 内置 skill）。

### 3. 工作区（Workspace / Agent）

**Agent 视角的「可用 skill 清单」**——它由若干存储位置合并而来：

| Agent | 读取的存储位置 | 合并后 |
|---|---|---|
| Claude Code | `claude` | 1:1 |
| Codex | `codex` | 1:1 |
| **opencode** | `claude` + `codex` + `opencode` | **三位置并集** |

因此 opencode 工作区会看到 74 条（22+30+22），其中同名 skill 出现多行、每行标注「位置」。映射定义在 `src/renderer/src/hooks/use-skills.ts` 的 `AGENT_SOURCES`。

---

## 二、目录约定

```
~/.claude/skills/                        ← 存储位置：Claude Code
~/.codex/skills/                         ← 存储位置：Codex
│   └── .system/<name>/SKILL.md          ←   Codex 内置 skill（锁定，见下）
~/.config/opencode/skills/               ← 存储位置：opencode

~/Library/Application Support/skillsdeck/
├── config.json                          ← 应用配置（路径、关闭行为）
└── disabled/                            ← ★ 停用停车场
    ├── claude/<name>/
    ├── codex/<name>/
    └── opencode/<name>/
```

**停用停车场**按来源二级分目录，因此同名 skill 分别停用时**不会撞路径**，且启用时天然知道该移回哪个源。

---

## 三、关键机制

### 3.1 扫描与符号链接语义 ⚠️

三方 skill 目录里**大量条目是符号链接**（例如统一指向 `~/.skills-manager/skills/<name>`）。这是最容易出错的地方，规则如下：

| 场景 | 行为 | 原因 |
|---|---|---|
| 扫描 | **跟随软链**识别为 skill | `Dirent.isDirectory()` 不跟随软链，必须 `fs.stat` |
| 断链 | 照常列出，标记 `entryKind: 'broken'` | 让用户看见并清理，而不是静默消失 |
| 启停移动 | **只移动链接本体** | 真身可能被三个来源共享 |
| 复制分发 | **解引用复制真身** | 目标得到独立副本，不依赖原软链指向 |
| 物理删除 | **只删链接本身** | 删真身会一次干掉所有引用它的来源 |

`Skill.entryKind: 'real' | 'symlink' | 'broken'`，软链会记录 `linkTarget`（真身路径）并在详情面板展示。

### 3.2 启用 / 停用（移动到停车场）

```
停用：  rename(~/.claude/skills/vue  →  .../skillsdeck/disabled/claude/vue)
启用：  rename(.../skillsdeck/disabled/claude/vue  →  ~/.claude/skills/vue)
```

- **同卷**：`fs.rename` 原子完成
- **跨卷（EXDEV）**：`copy → 临时名 rename → 删源`，任一步失败即清理残留，避免半移动状态
- **状态判定**：扫源目录 = 启用；扫停车场 = 停用。**不依赖元数据文件**，位置即状态
- **冲突**：目标已存在同名目录一律**中止并报 `CONFLICT`**，绝不静默覆盖
- **粒度**：按来源独立。同名 skill 可在 Claude 启用、Codex 停用

### 3.3 复制分发

把 skill 内容复制到另一个存储位置。解引用复制，产物是独立真实目录。目标冲突时四种策略：

| 策略 | 行为 |
|---|---|
| `ask` | 不改动，返回 `CONFLICT` + 冲突路径，交给 UI 弹窗 |
| `skip` | 保留目标，返回 `skipped` |
| `overwrite` | 删除目标后复制，返回 `overwritten` |
| `rename` | 生成 `name-2`、`name-3`… 并存，返回 `created` |

### 3.4 物理删除（不可恢复）

不进停车场、不可撤销。二次确认对话框**按条目类型如实说明后果**：

- **真实目录** → 列出文件数与体积，整目录递归删除
- **符号链接** → 只删链接，显示真身路径并说明「其它来源中指向同一真身的链接不受影响」
- **断链** → 只清理链接残骸

### 3.5 内置 skill（`codex/.system/`）

Codex 自带的 6 个系统 skill。始终为启用态，**锁定**：不可停用、不可复制、不可删除，只读浏览。UI 上以「内置」区分，并单列筛选。

---

## 四、架构

```
┌─ Renderer（React 19 + Tailwind 4 + shadcn/ui）────────────────┐
│  Sidebar │ ViewHeader │ SkillTable │ SkillDetail │ Dashboard   │
└─────────────────┬────────────────────────────────────────────┘
                  │ contextBridge（contextIsolation + sandbox）
┌─────────────────▼────────────────────────────────────────────┐
│  Main                                                           │
│  store.ts    ★ 唯一状态属主：可变索引 + 全部写操作                │
│  scanner.ts  只读扫描（跟随软链、解析 frontmatter、归类文件）      │
│  watcher.ts  chokidar 监听 4 个根目录 → 广播 skills:changed       │
│  paths.ts    路径解析（env > config > 默认）                      │
│  config.ts   config.json 读写                                   │
│  parse.ts    frontmatter 拆分与 YAML 解析（纯函数）                │
└───────────────────────────────────────────────────────────────┘
```

**分层原则**

- `src/shared/types.ts` 是**唯一的跨进程契约**，preload 按其签名实现 `window.api`，renderer 只依赖它
- **单一可变状态属主**：`SkillStore` 独占索引与全部写操作（`setEnabled` / `copyTo` / `deleteSkill`）；`scanner` 只读；其它层读契约、发命令，不持有第二份真相
- `parse.ts` / `paths.ts` 保持纯逻辑，可脱离 Electron 单测

**IPC 通道**（白名单，仅这些）

| 通道 | 说明 |
|---|---|
| `skills:info` | 平台与各根目录路径 |
| `skills:list` / `skills:refresh` | 读快照 / 强制重扫后返回 |
| `skills:readFile` | 读 skill 内文件（**防路径越界**，`..` 拒绝） |
| `skills:setEnabled` | 启停（移动） |
| `skills:copyTo` | 分发到其它位置 |
| `skills:delete` | 物理删除 |
| `skills:revealInFinder` | 在 Finder 中显示 |
| `skills:changed` | 主进程 → 渲染进程的变更广播 |
| `settings:get` / `settings:save` / `settings:pickDirectory` | 配置与原生目录选择器 |

所有写操作返回 `{ ok: true } | { ok: false, code, message }`，`code ∈ NOT_FOUND | CONFLICT | LOCKED | IO`，冲突时附 `conflictAt` 路径。

---

## 五、配置

`~/Library/Application Support/skillsdeck/config.json`

```json
{
  "sourceRoots": {
    "claude": "/Users/you/.claude/skills",
    "codex": "/Users/you/.codex/skills",
    "opencode": "/Users/you/.config/opencode/skills"
  },
  "disabledRoot": "/Users/you/Library/Application Support/skillsdeck/disabled",
  "closeBehavior": "ask"
}
```

- `closeBehavior`：`ask`（每次询问）/ `tray`（最小化到菜单栏）/ `quit`（直接退出）
- 应用数据目录（存 config 的位置）**固定**；`disabledRoot` 可改址
- 也可通过设置界面修改，保存后立即重扫生效

**路径解析优先级**：环境变量 > `config.json` > 内置默认。环境变量便于测试隔离与可移植安装：

```
SKILLSDECK_SOURCE_ROOT_CLAUDE / _CODEX / _OPENCODE
SKILLSDECK_DISABLED_ROOT
SKILLSDECK_MANAGED_ROOT
```

---

## 六、开发

```bash
npm install
npm run dev          # 开发模式（HMR）
npm run build        # 构建到 out/
npm run typecheck    # tsc --noEmit（node + web 两套配置）
npm test             # 58 项单元 / 集成测试
npm run dist         # 打包 DMG + zip → release/<version>/
```

**测试**（`tests/`）覆盖纯逻辑与真实目录集成：

| 文件 | 覆盖 |
|---|---|
| `parse.test.ts` | frontmatter 拆分（BOM/CRLF/空/内联 `---`）、字段回退、文件归类 |
| `paths.test.ts` | id 构造、源目录与停车场隔离 |
| `config.test.ts` | 配置读写、非法值回退、损坏文件容错、env 优先级 |
| `store.test.ts` | 启停移动、同名跨源不冲突、冲突中止不破坏两侧、软链只动链接、共享真身互不干扰、复制四种冲突策略、解引用复制、删除、路径越界拒绝 |
| `scanner.test.ts` | 本机真实目录集成：软链识别、`.system` 内置、id 唯一 |

---

## 七、项目结构

```
src/
├── shared/types.ts              # 跨进程契约（唯一）
├── main/
│   ├── index.ts                 # 窗口 / 生命周期 / 关闭行为
│   ├── ipc.ts                   # IPC 注册（写操作唯一入口）
│   ├── store.ts                 # ★ 状态属主：索引 + 启停/复制/删除
│   ├── scanner.ts               # 只读扫描（跟随软链）
│   ├── watcher.ts               # chokidar 监听 + 广播
│   ├── paths.ts                 # 路径解析与覆盖
│   ├── config.ts                # config.json
│   └── parse.ts                 # frontmatter / 文件归类（纯）
├── preload/index.ts             # 按契约实现 window.api
└── renderer/src/
    ├── App.tsx                  # 视图状态与编排
    ├── hooks/use-skills.ts      # 数据订阅 + AGENT_SOURCES 映射
    ├── components/
    │   ├── agent-icons.tsx      # 品牌图标（暗色反相）
    │   └── ui/                  # shadcn/ui
    └── features/skills/         # sidebar / view-header / skill-table
                                 # skill-detail / dashboard / *-dialog
resources/tray-icon.png          # 托盘图标
```

---

## 八、安全边界（不做的事）

- **不跟随软链破坏真身**：删除/启停只作用于当前条目路径
- **绝不静默覆盖**：任何写操作遇到目标已存在，一律中止并回报冲突路径
- **拒绝路径越界**：`skills:readFile` 校验解析后路径必须落在 skill 目录内
- **内置 skill 全锁**：`.system/` 不可停用、复制、删除
- **删除不可撤销**，因此强制二次确认并如实说明后果
