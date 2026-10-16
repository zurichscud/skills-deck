# Skills Deck

统一管理 **Claude Code / Codex / opencode / Agents** 四个存储位置里 Agent Skill 的 macOS 桌面应用。

一套界面查看、链接、删除散落在多个目录里的 skill，并明确回答一个核心问题：**这个 Agent 到底能用哪些 skill？**

---

## 一、核心模型

只有三层概念：**存储位置 → Skill 条目 → 工作区**。skill 的内容就在某个存储位置里，没有中间仓库。

```
~/.claude/skills/                ─┐
~/.codex/skills/（含 .system）    │  存储位置：skill 的内容本体就在这些位置里
~/.config/opencode/skills/        │  （真实目录，或指向别处的软链）
~/.agents/skills/                ─┘
```

| 概念 | 说明 |
|---|---|
| **存储位置** | 四个 agent 读取 skill 的全局目录，可在设置里改址；`.codex/skills/.system` 内置 skill 保持原地、锁定 |
| **Skill 条目** | 某个位置里的一个目录（真实目录或软链）。**按解析后的真实路径归并**：同一份内容出现在多个位置时算一个 skill |
| **链接** | 把一个位置里的 skill 链到另一个位置：在目标位置建指向本体的软链 |
| **工作区** | Agent 视角的可用清单：Claude Code 读 claude，Codex 读 codex，**opencode 读三者并集**（不含 agents） |

映射定义在 `src/renderer/src/hooks/use-skills.ts` 的 `AGENT_SOURCES`。

同名但**内容不同**的条目不算同一个 skill：它们各自成立，并互相把对方所在的位置记为「被占用」。

---

## 二、链接语义 ⚠️

这是最容易出错的地方。任何写操作都遵守一条铁律：**只动自己的链接，绝不覆盖别人的东西**。

| 状态 | 含义 | 链接操作 | 取消链接 |
|---|---|---|---|
| `self` | 内容本体就在这个位置（真实目录） | 拒绝（已在） | 拒绝（那是内容，要删就删条目） |
| `linked` | 这个位置是指向本体的有效软链 | 幂等成功 | 删除链接本体 |
| `absent` | 该位置没有同名条目 | 创建软链 | 幂等成功 |
| `broken` | 该位置是软链但目标已失效 | 删掉残骸后重建 | 拒绝（不是本 skill 的链接） |
| `conflict` | 该位置被真实目录或指向别处的有效软链占用 | **中止并报 `CONFLICT`** | 拒绝，不做改动 |
| `native` | Codex `.system` 内置，天然可用 | 不可操作 | 不可操作 |

- 链接使用**解析后的真实路径**，形如 `<存储位置>/<name> -> <内容真实路径>`
- 扫描**跟随软链**（`fs.stat` 而非 `Dirent.isDirectory()`）；没有 `SKILL.md` 的目录不算 skill
- 失效软链没有内容可读，仍如实列出（标记为残骸），任何 skill 都可以安全替换它

交互上不再有逐位置的开关：点某个 skill 的「**链接…**」打开对话框，四个位置一栏一个勾选框 —— 勾上建链，取消勾选删链；`self` 显示为「本体」且不可取消，`conflict` 显示冲突路径并禁用。

---

## 三、关键机制

### 3.1 删除 = 移入回收站

- **删除**作用于一个 skill 在各位置的**条目整体**：本体目录与各处软链一起移入回收站，删完原位置不留痕迹
- 别人留在同名位置上的失效残骸不牵连：它属于另一条记录，要删就在它自己那行删
- **内置 skill**：拒绝
- 二次确认对话框逐条列出将被移动的条目（本体 / 链接）与回收站目录

### 3.2 回收站

存放在应用数据目录下的 `trash/`（可用 `SKILLSDECK_TRASH_ROOT` 改址），条目布局：

```
<trashRoot>/<时间戳-随机>/entry        ← 被移走的目录本体，或软链本身
<trashRoot>/<时间戳-随机>/meta.json    ← 名称、原位置、原路径、类型、软链目标、删除时间
```

| 操作 | 行为 |
|---|---|
| 恢复 | 放回原路径；原位置已被占用则中止并报 `CONFLICT`，绝不覆盖 |
| 打开所在文件夹 | 在 Finder 中显示条目 |
| 彻底删除 | 删除该条目，不可恢复（二次确认） |
| 清空回收站 | 一次删掉全部条目（二次确认） |

不自动清理。`meta.json` 缺失或损坏时条目仍会列出，但标记为「来源未知」——只能彻底删除，不给恢复入口。

### 3.3 内置 skill（`codex/.system/`）

Codex 自带的系统 skill。始终为启用态，**锁定**：不可链接、不可取消链接、不可删除，只读浏览。
「内置」筛选仅在 **Codex 视图**提供。

---

## 四、架构

```
┌─ Renderer（React 19 + Tailwind 4 + shadcn/ui）────────────────┐
│  Sidebar │ ViewHeader │ SkillTable │ SkillDetail │ Dashboard   │
│  LinkDialog │ TrashPage │ DeleteDialog │ SettingsPage          │
└─────────────────┬────────────────────────────────────────────┘
                  │ contextBridge（contextIsolation + sandbox）
┌─────────────────▼────────────────────────────────────────────┐
│  Main                                                           │
│  store.ts    ★ 唯一状态属主：索引 + 全部写操作（link/unlink/     │
│              删除、回收站恢复/彻底删除/清空）                     │
│  scanner.ts  只读扫描：按位置收条目 → 按真实路径归并成 skill      │
│  trash.ts    回收站落盘：移入、索引、恢复、彻底删除               │
│  fsops.ts    文件操作与瞬时占用退避重试（无业务语义）             │
│  watcher.ts  chokidar 监听 4 个位置 + 回收站 → 广播 skills:changed│
│  paths.ts    路径解析（env > config > 默认）                     │
│  config.ts   config.json 读写                                   │
│  parse.ts    frontmatter 拆分与 YAML 解析（纯函数）                │
└───────────────────────────────────────────────────────────────┘
```

**分层原则**

- `src/shared/types.ts` 是**唯一的跨进程契约**，preload 按其签名实现 `window.api`，renderer 只依赖它
- **单一可变状态属主**：`SkillStore` 独占索引与全部写操作；`scanner` / `trash`（扫描侧）只读；其它层读契约、发命令
- `parse.ts` / `paths.ts` 保持纯逻辑，可脱离 Electron 单测

**IPC 通道**（白名单，仅这些）

| 通道 | 说明 |
|---|---|
| `skills:info` | 平台、各位置路径、应用数据目录、回收站目录 |
| `skills:list` / `skills:refresh` | 读快照 / 强制重扫后返回 |
| `skills:readFile` | 读 skill 内文件（**防路径越界**，`..` 拒绝） |
| `skills:link` / `skills:unlink` | 建链 / 删链（位置标识过白名单） |
| `skills:delete` | 删除 = 把该 skill 的各处条目移入回收站 |
| `trash:list` / `trash:restore` / `trash:purge` / `trash:empty` / `trash:reveal` | 回收站清单与操作 |
| `skills:revealInFinder` / `skills:openPath` | 在 Finder 中显示 / 打开存储位置 |
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
    "opencode": "/Users/you/.config/opencode/skills",
    "agents": "/Users/you/.agents/skills"
  },
  "closeBehavior": "ask",
  "menu": {
    "order": [],
    "hidden": []
  }
}
```

- `sourceRoots`：四个存储位置，可在设置页改址
- `closeBehavior`：`ask`（每次询问）/ `tray`（最小化到菜单栏）/ `quit`（直接退出）
- `menu`：侧边栏菜单的排序与显隐（在设置页拖拽排序、开关显隐）。`order` 为菜单项 id 数组（未列出的按默认顺序补齐），`hidden` 为隐藏项；非法 id 读取时自动过滤。常驻项「总览 / 回收站」不参与配置
- 应用数据目录（存 config 与回收站的位置）**固定**；设置界面**修改即自动保存**，路径变化后立即重扫生效

**路径解析优先级**：环境变量 > `config.json` > 内置默认。环境变量便于测试隔离与可移植安装：

```
SKILLSDECK_SOURCE_ROOT_CLAUDE / _CODEX / _OPENCODE / _AGENTS
SKILLSDECK_MANAGED_ROOT           # 应用数据目录
SKILLSDECK_TRASH_ROOT             # 回收站目录
```

---

## 六、开发

```bash
npm install
npm run dev          # 开发模式（HMR）
npm run build        # 构建到 out/
npm run typecheck    # tsc --noEmit（node / web / e2e 三套配置）
npm test             # vitest run
npm run test:e2e     # build + Playwright Electron E2E
npm run dist         # 打包 DMG + zip → release/<version>/
```

**测试**（`tests/`）

没有开发者的允许，不能主动进行测试

全部使用临时目录 + 环境变量隔离，不触碰本机真实数据：

| 文件 | 覆盖 |
|---|---|
| `parse.test.ts` | frontmatter 拆分（BOM/CRLF/空/内联 `---`）、字段回退、文件归类 |
| `paths.test.ts` | id 构造、四个位置默认目录、回收站默认位置、配置覆盖与环境变量优先 |
| `config.test.ts` | 配置读写、缺失字段回落、非法值回退、损坏文件容错、菜单项过滤 |
| `scanner.test.ts` | 按内容归并（本体 + 软链）、同名不同内容互相占用、内容在应用之外、内置 native、断链残骸、id 唯一 |
| `store.test.ts` | 建链/删链幂等、占用中止不破坏两侧、断链替换、删除进回收站与逐条恢复、恢复冲突拒绝、彻底删除与清空、路径越界拒绝 |
| `views.test.ts` | `use-skills.ts` 纯函数的视图归属与可用判定 |

Electron E2E 在 `e2e/`（Playwright `_electron`）：每个用例 `mkdtemp` 沙箱，用 `SKILLSDECK_*` 环境变量隔离四个位置与回收站；**窗口从不显示**（夹具传 `SKILLSDECK_HEADLESS=1`，并有断言守卫），因此跑测试不会在屏幕上弹窗打扰别人；工件是 `playwright-report/`（HTML 报告）与 `e2e/artifacts/*.png`（关键步骤截图，用 CDP 直接抓渲染面，不依赖窗口可见）。

---

## 七、项目结构

```
src/
├── shared/types.ts              # 跨进程契约（唯一）
├── main/
│   ├── index.ts                 # 窗口 / 生命周期 / 关闭行为
│   ├── ipc.ts                   # IPC 注册（写操作唯一入口）
│   ├── store.ts                 # ★ 状态属主：索引 + 链接/删除/回收站操作
│   ├── scanner.ts               # 只读扫描（按位置收条目 → 按真实路径归并）
│   ├── trash.ts                 # 回收站落盘（移入 / 索引 / 恢复 / 彻底删除）
│   ├── fsops.ts                 # 文件操作与退避重试
│   ├── watcher.ts               # chokidar 监听 + 广播
│   ├── paths.ts                 # 路径解析与覆盖
│   ├── config.ts                # config.json
│   └── parse.ts                 # frontmatter / 文件归类（纯）
├── preload/index.ts             # 按契约实现 window.api
└── renderer/src/
    ├── App.tsx                  # 视图状态与编排
    ├── hooks/use-skills.ts      # 数据订阅 + 视图/筛选 + AGENT_SOURCES
    ├── components/
    │   ├── agent-icons.tsx      # 位置图标（品牌 SVG，缺失时回退通用图标）
    │   └── ui/                  # shadcn/ui
    └── features/skills/         # sidebar / view-header / skill-table
                                 # skill-detail / dashboard / link-dialog
                                 # trash-page / delete-dialog / settings-page
                                 # menu-editor
resources/tray-icon.png          # 托盘图标
```

---

## 八、安全边界（不做的事）

- **不跟随软链破坏真身**：链接/取消链接只作用于链接本体；删除本体时同名的**失效残骸**（属于别人）不牵连
- **绝不静默覆盖**：任何写操作遇到目标已存在，一律中止并回报冲突路径
- **恢复不覆盖**：回收站恢复时若原位置已被占用，中止并提示，绝不顶掉现成条目
- **索引不可信**：回收站条目 id 与恢复目标都做校验（拒绝 `..`、拒绝落在四个位置之外的路径）
- **拒绝路径越界**：`skills:readFile` 校验解析后路径必须落在 skill 目录内
- **内置 skill 全锁**：`.system/` 不可链接、复制、删除
- **删除进回收站**，但「彻底删除」与「清空回收站」不可撤销，因此强制二次确认并如实说明后果
