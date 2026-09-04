# 终端文件链接在 Pier 中打开

日期：2026-09-04  
状态：现行权威  
范围：终端视口里 OSC 8 / 已解析超链接的点击与右键；`pier://file` 深链；源码路径不得落到系统默认应用。  
不包含：Markdown 预览相对链接（已走 `handleOpenMarkdownInternal`）；CLI `pier <文件>` 路径简写（[`2026-08-29-cli-path-open-design.md`](./2026-08-29-cli-path-open-design.md)）；终端选区复制菜单本身（[`2026-08-31-terminal-clipboard-gold-standard.md`](./2026-08-31-terminal-clipboard-gold-standard.md)）。

相关：右键组序仍以 [`2026-08-31-context-menu-order-gold-standard.md`](./2026-08-31-context-menu-order-gold-standard.md) 为准（文档/终端家族：打开/复制优先）。源码永不 `shell.openPath` 沿用 `shouldNeverSystemOpen`。

背景缺陷：Grok 等全屏 TUI 打开鼠标上报后，文件引用的单击由 TUI 自己 `open` / `xdg-open`，macOS 上 `.md` 进 Xcode。Pier 的 `OPEN_URL` 管道已经能把文件系统路径送进 Files，但 press 根本到不了 Ghostty。

---

## 一句话终态

终端里点到的文件进 Pier Files；http(s)/mailto 进系统浏览器；TUI 开着鼠标上报也不能再对源码调用 `open`。系统应用打开只作为右键显式逃生舱。

---

## 决策树

指针下有 OSC 8（Ghostty `mouse_over_link` 非空）：

| 手势 | 行为 |
|---|---|
| 左键单击（位移 ≤ 4pt） | **宿主消费**：不把 press/release 发给 TUI |
| `file://` / 无 scheme 本地路径 / `pier://file/…` | 现有 Files 打开链（复用标签、`:line[:col]`） |
| `http:` / `https:` / `mailto:` | main `shell.openExternal`（已有 remote 分支） |
| `javascript:` / `data:` / `vbscript:` | 不打开、不转发给 OS |
| `vscode://` / `cursor://` / `zed://` / `idea://` | **不**收进 Pier，不当文件打开，也不转 `open` |
| 左键拖拽（位移 > 4pt） | 不打开；本次 press 已消费则不补发给 TUI |
| 右键且指针在链接上 | 见「右键」 |

指针下 **没有** 超链接：点击原样发给 Ghostty/TUI。

判定「要不要从 TUI 手里拿走这次 click」只在 native：`HostLinkClick.shouldConsume`。真正打开仍走现有 `OPEN_URL` → `handleTerminalOpenUrl` → Files / `openExternal`。

**不要用 Cmd 当门禁。** Grok 文件引用是普通单击；macOS Cmd 编不进 SGR，不能依赖「Cmd+click 交给终端」。

---

## 鼠标上报

对齐 Zed `open_links_in_mouse_mode`：有超链接命中时宿主抢走单击，即使 TUI 在报鼠标。

1. `mouseMoved` / `mouseDown` 先 `sendMousePos`，缓存 `hoverLinkUrl`。
2. 左键 `mouseDown`：`shouldConsume(hoverLinkUrl)` 为真 → 记下 pending + 起点，**禁止** `sendMouseButton` PRESS。
3. 左键 `mouseUp`：pending 且位移 ≤ 4pt → `terminalDidRequestOpenURL`（与现网 OPEN_URL 同槽）；否则丢弃 pending。
4. 消费后绝不能再把这次 press 发给 TUI，否则 Grok 仍会 `open`（Pier + Xcode 双开）。
5. `OPEN_URL` 对 Ghostty 仍须 return true（已有 `TerminalController+Callbacks`）。

`MOUSE_OVER_LINK` 必须写入 `TerminalCallbackBridge.hoverLinkUrl`（与 delegate 是否实现 hover 无关）。只在测试 fixture 里接 hover、生产路径不缓存，等于永远拿不到 URL。

---

## 打开链

| URL | main 分类 | renderer |
|---|---|---|
| `file://`、绝对/相对本地路径 | filesystem | Files `openDiskTarget`；源码 `shouldNeverSystemOpen` 挡住 `files.openPath` |
| `pier://file/<abs>{#Lline}` | filesystem | 同一条 Files 链 |
| `http(s):` / `mailto:` | remote | 不广播，`openExternal` |
| `vscode://` 等编辑器 scheme | app-internal | 不当时文件；可 toast 无法打开 |
| 危险 scheme | 不打开 | — |

源码/文本（`.md` / `.ts` / Dockerfile / `.env` 等）产品路径禁止 `shell.openPath`。OS 出口仍只有 `src/main/services/files/open-path.ts`。

---

## `pier://file`

格式：`pier://file/<absolute-path>`，可选 `#L12` 或 `#L12C5`（1-based）。POSIX 为真源。

本窗 OSC 8 与壳外深链同一解析。`app.setAsDefaultProtocolClient("pier")` + `electron-builder.yml` `CFBundleURLTypes`；第二实例 `open-url` 转到 Files，禁止 `open -a Pier` 当打开器。

---

## 右键

表面仍是 `terminal/content`（文档/终端家族）。指针在可消费链接上时：

1. 第一项：文件 → 「在 Pier 中打开」；http(s)/mailto → 「打开链接」。
2. 其后：复制路径或 URL。
3. 「在访达中显示」仅文件。
4. 「用系统应用打开」仅当路径 **不是** `shouldNeverSystemOpen`。源码/文本不提供把 `.md` 送进 Xcode 的项。
5. 关闭类仍在 `9_close`。

组序以右键金标准为准。无链接时菜单保持今天的复制/粘贴，不出现打开项。

---

## 明确不做（不劫持）

1. PATH 里放名为 `open` 的 shim。
2. 把 `TERM_PROGRAM` 设成 `vscode`（宿主 spawn 继续剥离该键）。
3. 把 Pier 登记为 `.md` / Markdown UTI 默认应用。
4. 为某个智能体 TUI 单独做 opener 插件。
5. 把 `vscode://file/…` 映射成 Pier 打开。
6. 设置页「文件链接打开到系统默认」。默认永远是 Pier。

---

## 检查点

- `tests/unit/main/terminal/file-open/governance.test.ts`
- `native/Tests/GhosttyBridgeTests/HostLinkClickTests.swift`
- `native/Tests/GhosttyBridgeTests/TerminalLinkWrapDetectionTests.swift`
- `tests/unit/main/terminal/open-url-forwarding.test.ts`
- `tests/unit/app-core/pier-file-protocol.test.ts`
- `tests/unit/renderer/files/terminal-open-url-handler.test.ts`
- `tests/unit/renderer/terminal/context-menu-actions.test.ts`
- `tests/unit/shared/system-open-guard.test.ts`
