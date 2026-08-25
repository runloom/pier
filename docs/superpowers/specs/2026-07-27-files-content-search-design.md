# Files 项目内容搜索（content mode）设计

Date: 2026-07-27  
Status: accepted / implementing（契约 + main 骨架先落地；搜索面板 UI 后置）  
Parent: `docs/archive/superpowers/plans/2026-07-10-files-core-stability.md` 任务 6–7、9  
Depends: `docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md`（path mode 已落地）

## 1. 问题

`pier.files` 已有：

- 文件内查找（CodeMirror / Markdown）
- 路径发现：树搜索 + `Cmd+P`（`FileQueryService` path mode）

仍缺项目范围文本搜索（`Cmd+Shift+F`）：用户无法在工作区文件内容中按关键字/正则浏览命中并连续打开。

## 2. 目标

1. 扩展既有 `FILE_QUERY_*` 管道，增加 **content mode**（与 path mode 共享会话/取消/定向事件模型）。
2. main 使用**应用自有**搜索运行时（首选打包 `rg`）；禁止依赖用户 `PATH` 上的系统工具。
3. 流式分批返回命中；renderer 只保留有界结果窗口。
4. 命中契约保留**行文本 + 文件内字节范围**；定位到编辑器时由 renderer 转 UTF-16。
5. 为后续 `pier.files.searchPanel` / `Cmd+Shift+F` 提供可测的 main + facade 骨架。

### 非目标（本轮）

- 搜索面板 UI、快捷键与树「在文件夹中查找」入口（任务 9）
- 项目级批量替换
- 持久全文索引
- 把 `@vscode/ripgrep` 二进制正式打进 arm64/x64 安装包的完整供应链（任务 6 收口；本轮先固定解析接口与缺失错误码）
- `.cursorignore` 等 Agent 检索规则

## 3. 架构

```text
┌─────────────────────────────┐
│ Search Panel / 未来入口      │  owner: content-search:<panelId>
└──────────────┬──────────────┘
               │ context.files.queryContents
               ▼
        PIER.FILE_QUERY_START|CANCEL|EVENT
               │ mode: "content"
               ▼
        FileQueryService
        ├── path  → walk + score（既有）
        └── content → SearchRuntime + rg 子进程
               │ started → batch(mode:content)* → done|error
               ▼
        虚拟结果列表 → 打开文件 + 按字节范围定位
```

原则（继承 path query）：

- 发现在 main，展示在 renderer
- 会话键：`webContents.id + owner`；同 owner 新查询取消旧查询
- 不同 owner（quick-open / tree-search / content-search）可并行
- `destroyed` / `did-navigate` → `cancelAll(sender)`
- 查询事件定向回传，不进广播总线
- capability：`file:read`

## 4. 契约

### 4.1 Start

Path start 保持兼容（可选 `mode: "path"`）。Content start：

```ts
type FileContentQueryStart = {
  mode: "content";
  queryId: string;
  owner: string; // e.g. "content-search:<panelId>"
  root: string; // 绝对项目根
  query: string; // 空串 → 立即 completed，无 batch
  options?: {
    caseSensitive?: boolean; // 默认 false
    wholeWord?: boolean; // 默认 false
    regexp?: boolean; // 默认 false（字面量）
    include?: string; // 单 glob，如 `**/*.{ts,tsx}`
    excludePatterns?: string; // 多行 glob；与 path 同源语义
    applyGitIgnore?: boolean; // 默认 true
    applyExcludePatterns?: boolean; // 默认 true
    maxResults?: number; // 默认 2000，硬顶 10000
    maxFileSizeBytes?: number; // 默认 1 MiB
    scopeDir?: string; // root 相对 posix 目录；须在 root 内
  };
};
```

IPC 仍用 `PIER.FILE_QUERY_START`：按 `mode === "content"` 解析 content schema，否则 path schema。

### 4.2 Batch / 命中项

```ts
// path batch（既有 items 形状 + 显式 mode）
{ kind: "batch"; mode: "path"; queryId; items: { path; score }[] }

// content batch
{
  kind: "batch";
  mode: "content";
  queryId;
  items: {
    path: string; // root 相对 posix
    line: number; // 1-based
    matchByteStart: number; // 文件内字节偏移（含）
    matchByteEnd: number; // 文件内字节偏移（不含）
    preview: string; // 行文本（去 EOL，可截断）
    previewMatchStart: number; // 预览串内 UTF-16 无关的字节/字符切片起点（见下）
    previewMatchEnd: number;
  }[];
}
```

- `matchByteStart/End` 来自 `rg --json` 的 `absolute_offset + submatch.{start,end}`，供打开文件后做字节→UTF-16 定位。
- `preview*` 仅供结果列表高亮；预览截断时仍尽量保留命中片段。
- 同一行多个 submatch → 多条 item。

### 4.3 Done / Error

与 path 共用：

- `done`：`reason: completed|cancelled`，`truncated`，`scanned`（content：已产出命中条数），`elapsedMs`
- `error.code` 至少包括：
  - `search-runtime-unavailable` — 未解析到可执行搜索引擎
  - `content-search-failed` — 进程/解析失败
  - `invalid-scope` — `scopeDir` 越界或不存在
  - `invalid-regexp` — 用户正则不被引擎接受（若可区分）

取消：detach emit 后 abort；content 子进程 SIGTERM，超时 SIGKILL；禁止 cancel 后再发 batch。

## 5. 搜索运行时

### 5.1 解析顺序（`resolveSearchRuntime`）

1. 注入/测试覆盖（单测）
2. 环境变量 `PIER_RG_PATH`（仅 dev/诊断；生产仍应指向包内路径）
3. 应用资源：`resources/search/<arch>/rg`（dev 相对仓库；packaged 相对 `process.resourcesPath`）
4. 均失败 → `unavailable`

**禁止**默认回退到 `PATH` 上的 `rg`（避免「开发机能搜、安装包不能搜」）。  
任务 6 完成前：资源目录可为空；content 查询返回明确 `search-runtime-unavailable`，UI 可提示。

### 5.2 引擎参数（ripgrep）

- 输出：`--json --no-config --color=never --hidden`
- 字面量：`-F`；正则：不加 `-F`
- 大小写：默认 `-i`；`caseSensitive` 时不加
- 整词：`-w`
- gitignore 关：`--no-ignore --no-ignore-vcs --no-ignore-parent`
- exclude：对每一行 exclude glob 追加 `--glob !<pattern>`
- include：`--glob <include>`
- 体积：`--max-filesize <n>`
- 搜索路径：`root` 或 `root/scopeDir`

批大小默认 50；达 `maxResults` 后终止进程并 `truncated: true`。

## 6. Facade

```ts
// RendererPluginFilesFacade
onPathQueryEvent(listener): () => void; // 事件总线共用（含 content）
queryPaths(...); // path
queryContents(request): { cancel(); queryId; started: Promise<boolean> };
```

`queryContents` 与 `queryPaths` 一样：省略 `queryId` 时客户端生成；`file:read` 断言；subscribe-before-start 由调用方负责。

## 7. 实施切片

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| A | 契约 + batch mode 判别 + 契约测试 | 本轮 |
| B | `resolveSearchRuntime` + content runner（可注入）+ service 路由 | 本轮 |
| C | IPC 解析 content start + facade `queryContents` | 本轮 |
| D | 打包 `rg` 进 resources + verify 脚本 + 双 arch 冒烟 | 任务 6 |
| E | search panel UI + `Cmd+Shift+F` + 树 scope | 任务 9 |

## 8. 反模式

- renderer 递归 list + 读文件做项目搜索
- 依赖系统 `PATH` 的 `rg`/`grep` 作为默认运行时
- 结果全集写入 dockview `panel.params`
- 查询事件全窗口广播
- 把 path / content 做成两套互不兼容的 cancel 语义
- 项目级 Replace 复用单文件 replace 无预览硬刚

## 9. 验收（本轮骨架）

- path 既有单测全绿；batch 带 `mode: "path"`
- content：注入 runner 可流式 batch + cancel 后无迟到 batch
- 运行时缺失 → `error.code === "search-runtime-unavailable"`
- IPC 接受 content start；畸形 payload 不碰 service
- 契约测试覆盖 content start / content batch item
