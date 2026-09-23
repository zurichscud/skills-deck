# Skills Deck

统一管理 **Claude Code / Codex / opencode** 三方 Agent Skill 的 macOS 桌面应用。

一套界面查看、链接、导入、删除散落在多个目录里的 skill，并明确回答一个核心问题：**这个 Agent 到底能用哪些 skill？**

---

## 一、核心模型

只有四层概念：**中央仓库 → Skill 真身 → 存储位置（软链）→ 工作区**。

```
~/.skills-deck/skills/          ← 中央仓库：唯一真身，git 管理（路径可配置）
└── <name>/SKILL.md

~/.claude/skills/<name>          ─┐
~/.codex/skills/<name>            ├─ 存储位置：只放指向中央仓库的软链
~/.config/opencode/skills/<name> ─┘
```

| 概念 | 说明 |
|---|---|
| **中央仓库** | skill 内容的**唯一真身**存放处，默认 `~/.skills-deck/skills`，每次结构变更自动 git commit |
| **Skill 条目** | 中央仓库里的一个目录；对三个存储位置分别有「已链接 / 未链接 / 断链 / 被占用」状态 |
| **存储位置** | 各 agent 读取 skill 的全局目录，**只存放软链**；`.codex/skills/.system` 内置 skill 保持原地、锁定 |
| **工作区** | Agent 视角的可用清单：Claude Code 读 claude，Codex 读 codex，**opencode 读三者并集** |

映射定义在 `src/renderer/src/hooks/use-skills.ts` 的 `AGENT_SOURCES`。

**不再有**：停用停车场、复制分发。启用即建软链，停用即删软链，真身始终只有一份。

---

## 二、链接语义 ⚠️

这是最容易出错的地方。任何写操作都遵守一条铁律：**只动自己的链接，绝不覆盖别人的东西**。

| 状态 | 含义 | 链接操作 | 取消链接 |
|---|---|---|---|
| `linked` | 指向中央仓库真身的有效软链 | 幂等成功 | 删除链接本体 |
| `absent` | 该位置没有同名条目 | 创建软链 | 幂等成功 |
| `broken` | 该位置是软链但目标已失效 | 删掉残骸后重建 | 拒绝（不是本 skill 的链接） |
| `conflict` | 该位置被真实目录或指向别处的有效软链占用 | **中止并报 `CONFLICT`** | 拒绝，不做改动 |
| `native` | Codex `.system` 内置，天然可用 | 不可操作 | 不可操作 |

- 链接使用**绝对路径**，形如 `<存储位置>/<name> -> ~/.skills-deck/skills/<name>`
- 扫描**跟随软链**（`fs.stat` 而非 `Dirent.isDirectory()`）
- 存储位置里**未纳管**的条目（真实目录、指向别处的软链、断链残骸）会如实列出，可一键导入或清理

---

## 三、关键机制

### 3.1 删除（不可恢复）

- **中央仓库真身**：先摘除三处指向它的软链，再删除真身目录，最后自动 git commit
- **未纳管条目**：只删除该条目自身（软链则只删链接）
- **内置 skill**：拒绝

二次确认对话框按条目类型如实说明后果。**其它未纳管位置**（如 `~/.agents/skills`）中的同名链接不会被清理，会变成失效链接——这一点在对话框中明确提示。

### 3.2 导入

入口只有两个：**Dashboard** 与**中央仓库**视图右上角的「导入 Skill」下拉。两条路都只写入中央仓库，不会写进任何存储位置。

| 方式 | 行为 |
|---|---|
| 从本地目录导入 | 选择一个含 `SKILL.md` 的目录 → **解引用复制**进中央仓库（源若是软链，产物是独立真身） |
| 从 Git 仓库安装 | 填仓库地址 → 只拉取仓库里的 `skills/` 目录 → 其中每个含 `SKILL.md` 的目录各导入一个 skill |

同名冲突时默认自动改名 `name-2` 并存，不覆盖已有内容；若是从「未纳管」弹窗纳入，则由用户逐项决定。

**从 Git 仓库安装不整仓下载**：`git clone --depth 1 --filter=blob:none --sparse` + `git sparse-checkout set skills`，只取 `skills/` 下的文件与 blob（不下载历史、不下载其余目录，并跳过 LFS 大文件）；服务器不支持部分克隆时自动降级为浅克隆 + 稀疏检出。临时克隆目录用完即删。

### 3.3 Git 自动提交

中央仓库自动 `git init`（分支 `main`）+ `.gitignore`，每次导入/纳入/删除后自动 commit：

```
import: <name>
adopt: <name>
delete: <name>
```

无改动、git 缺失、身份缺失都不会阻断写操作（身份缺失时使用仓库级兜底身份）。

### 3.4 内置 skill（`codex/.system/`）

Codex 自带的系统 skill。始终为启用态，**锁定**：不可链接、不可取消链接、不可删除，只读浏览。
「内置」筛选仅在 **Codex 视图**提供。

---

## 四、未纳管条目（逐个纳入）

三个存储位置里凡是**没有指向中央仓库真身**的 skill，都会被识别为「未纳管」并集中在一个弹窗里：

| 情况 | 处理方式 |
|---|---|
| 真实目录 | 移入中央仓库 → 原地留下软链 |
| 指向别处的软链（如旧仓库） | 解引用复制成独立真身 → 原地改指中央仓库 |
| 断链残骸 | 不列入（没有内容可纳入），在列表里可单独删除 |
| 与中央仓库同名 | **由你逐项决定**，见下 |

**同名冲突的三个选项**（每一项单独生效，处理完即从列表消失）：

| 选项 | 结果 |
|---|---|
| 用本地覆盖中央 | 中央版本被替换（旧版本仍可从 git 历史找回） |
| 两份并存 | 本地副本以 `<name>-2` 纳入中央仓库，原地建链指向它 |
| 保留中央版本 | 本地副本被丢弃，原地改为指向中央版本的链接 |

Dashboard 横幅的「去处理」给出两条路：**由我决定**（打开弹窗逐项处理）或**一键导入**（没有同名冲突的条目全部直接纳入，同名冲突原样留下）。

弹窗按轮播的方式**一次只显示一项**（进度条 + `已纳入 / 已忽略` 计数），每项二选一：「纳入中央仓库」或「忽略」跳过，处理后自动前进到下一项；全部忽略后可以「重新过一遍」。点击遮罩与 `Esc` 都不会关闭弹窗，只能用右上角 ✕ 关闭。
入口有四个：Dashboard 的检测横幅、侧边栏「未纳管」视图、设置页的「未纳管的 Skill」、skill 行菜单的「纳入中央仓库…」（后两个直接进「由我决定」）。侧边栏「未纳管」是常驻菜单项，列出三个存储位置里可纳入的条目（与弹窗同一口径，断链残骸不算）；表格以图标显示来源、不显示链接开关，行菜单只有「纳入中央仓库 / 删除」，勾选后工具条提供批量「纳入管理 / 删除」。

**失败不丢内容**：纳入流程先复制进中央仓库、再删除原位置。Windows 上杀软/索引器/编辑器会短暂占用刚变动的目录，表现为 `EBUSY`/`EPERM`，这类瞬时占用会自动退避重试（最多约 4 秒）；仍然失败则回滚——把内容还回原位置，并把被覆盖的中央版本从隐藏备份还原。任何情况下都不会出现「原位置与中央仓库都没有」的空档。

---

## 五、架构

```
┌─ Renderer（React 19 + Tailwind 4 + shadcn/ui）────────────────┐
│  Sidebar │ ViewHeader │ SkillTable │ SkillDetail │ Dashboard   │
│  MigrationDialog │ SettingsPage                                │
└─────────────────┬────────────────────────────────────────────┘
                  │ contextBridge（contextIsolation + sandbox）
┌─────────────────▼────────────────────────────────────────────┐
│  Main                                                           │
│  store.ts    ★ 唯一状态属主：索引 + 全部写操作（link/unlink/     │
│              import/adopt/delete）                              │
│  scanner.ts  只读扫描（中央仓库真身 + 三处链接状态 + 未纳管条目）  │
│  git.ts      中央仓库 git init / 自动提交                        │
│  watcher.ts  chokidar 监听 4 个根目录 → 广播 skills:changed       │
│  paths.ts    路径解析（env > config > 默认）                      │
│  config.ts   config.json 读写                                   │
│  parse.ts    frontmatter 拆分与 YAML 解析（纯函数）                │
└───────────────────────────────────────────────────────────────┘
```

**分层原则**

- `src/shared/types.ts` 是**唯一的跨进程契约**，preload 按其签名实现 `window.api`，renderer 只依赖它
- **单一可变状态属主**：`SkillStore` 独占索引与全部写操作；`scanner` 只读；其它层读契约、发命令
- `parse.ts` / `paths.ts` 保持纯逻辑，可脱离 Electron 单测

**IPC 通道**（白名单，仅这些）

| 通道 | 说明 |
|---|---|
| `skills:info` | 平台、各根目录路径、git 状态 |
| `skills:list` / `skills:refresh` | 读快照 / 强制重扫后返回 |
| `skills:readFile` | 读 skill 内文件（**防路径越界**，`..` 拒绝） |
| `skills:link` / `skills:unlink` | 建链 / 删链 |
| `skills:import` | 从任意目录导入到中央仓库（可带路径，省略则弹选择器） |
| `skills:installFromGit` | 从 git 仓库安装：只拉 `skills/`，逐个导入中央仓库 |
| `skills:unmanaged` | 列出三个存储位置里未纳管的 skill |
| `skills:adoptUnmanaged` | 逐个纳入（adopt / overwrite / rename / keep） |
| `skills:adoptAllUnmanaged` | 一键导入：无冲突的全部纳入，返回 adopted / conflicts / failed |
| `skills:delete` | 删除真身或未纳管条目 |
| `skills:revealInFinder` / `skills:openPath` | 在 Finder 中显示 / 打开目录 |
| `skills:changed` | 主进程 → 渲染进程的变更广播 |
| `settings:get` / `settings:save` / `settings:pickDirectory` | 配置与原生目录选择器 |

所有写操作返回 `{ ok: true } | { ok: false, code, message }`，`code ∈ NOT_FOUND | CONFLICT | LOCKED | IO`，冲突时附 `conflictAt` 路径。

---

## 六、配置

`~/Library/Application Support/skillsdeck/config.json`

```json
{
  "centralRoot": "/Users/you/.skills-deck/skills",
  "sourceRoots": {
    "claude": "/Users/you/.claude/skills",
    "codex": "/Users/you/.codex/skills",
    "opencode": "/Users/you/.config/opencode/skills"
  },
  "closeBehavior": "ask",
  "menu": {
    "order": [],
    "hidden": []
  }
}
```

- `centralRoot`：中央仓库真身目录，可在设置页改址
- `closeBehavior`：`ask`（每次询问）/ `tray`（最小化到菜单栏）/ `quit`（直接退出）
- `menu`：侧边栏菜单的排序与显隐（在设置页拖拽排序、开关显隐）。`order` 为菜单项 id 数组（未列出的按默认顺序补齐），`hidden` 为隐藏项；非法 id 读取时自动过滤
- 应用数据目录（存 config 的位置）**固定**；设置界面**修改即自动保存**，路径变化后立即重扫生效

**路径解析优先级**：环境变量 > `config.json` > 内置默认。环境变量便于测试隔离与可移植安装：

```
SKILLSDECK_CENTRAL_ROOT           # 中央仓库
SKILLSDECK_SOURCE_ROOT_CLAUDE / _CODEX / _OPENCODE
SKILLSDECK_MANAGED_ROOT           # 应用数据目录
```

---

## 七、开发

```bash
npm install
npm run dev          # 开发模式（HMR）
npm run build        # 构建到 out/
npm run typecheck    # tsc --noEmit（node + web 两套配置）
npm test             # 70 项单元 / 集成测试
npm run dist         # 打包 DMG + zip → release/<version>/
```

**测试**（`tests/`）全部使用临时目录 + 环境变量隔离，不触碰本机真实数据：

| 文件 | 覆盖 |
|---|---|
| `parse.test.ts` | frontmatter 拆分（BOM/CRLF/空/内联 `---`）、字段回退、文件归类 |
| `paths.test.ts` | id 构造、中央仓库默认路径与覆盖优先级、环境变量优先 |
| `config.test.ts` | 配置读写、非法值回退、损坏文件容错、env 优先级 |
| `scanner.test.ts` | 链接状态判定（linked/broken/conflict）、内置 native、未纳管条目、id 唯一 |
| `store.test.ts` | 建链/删链幂等、冲突中止不破坏两侧、断链替换、删除清理三处链接、导入与解引用、路径越界拒绝 |
| `adopt.test.ts` | 未纳管识别（真身/软链/断链/内置）、同名冲突判定与内容比对、四种纳入动作、逐个纳入互不影响、一键导入跳过冲突、失败回滚 |
| `install.test.ts` | 从本地 git 仓库安装：只取 `skills/`、忽略其余目录、同名改名并存、缺 `skills/` 报错、地址校验 |

---

## 八、项目结构

```
src/
├── shared/types.ts              # 跨进程契约（唯一）
├── main/
│   ├── index.ts                 # 窗口 / 生命周期 / 关闭行为
│   ├── ipc.ts                   # IPC 注册（写操作唯一入口）
│   ├── store.ts                 # ★ 状态属主：索引 + 链接/导入/纳入/删除
│   ├── scanner.ts               # 只读扫描（真身 + 链接状态 + 未纳管）
│   ├── git.ts                   # 中央仓库 git init / 自动提交
│   ├── watcher.ts               # chokidar 监听 + 广播
│   ├── paths.ts                 # 路径解析与覆盖
│   ├── config.ts                # config.json
│   └── parse.ts                 # frontmatter / 文件归类（纯）
├── preload/index.ts             # 按契约实现 window.api
└── renderer/src/
    ├── App.tsx                  # 视图状态与编排
    ├── hooks/use-skills.ts      # 数据订阅 + 视图/状态筛选 + AGENT_SOURCES
    ├── components/
    │   ├── agent-icons.tsx      # 品牌图标（暗色反相）
    │   └── ui/                  # shadcn/ui
    └── features/skills/         # sidebar / view-header / skill-table
                                 # skill-detail / dashboard / migration-dialog
                                 # settings-page / menu-editor / delete-dialog
resources/tray-icon.png          # 托盘图标
```

---

## 九、安全边界（不做的事）

- **不跟随软链破坏真身**：链接/取消链接只作用于链接本体，真身只在删除时移除
- **绝不静默覆盖**：任何写操作遇到目标已存在，一律中止并回报冲突路径
- **冲突人工介入**：同名冲突必须由用户逐项选择决议，不自动取舍、不批量执行
- **拒绝路径越界**：`skills:readFile` 校验解析后路径必须落在 skill 目录内
- **内置 skill 全锁**：`.system/` 不可链接、复制、删除
- **删除不可撤销**，因此强制二次确认并如实说明后果；同时明确告知未纳管位置可能残留失效链接
