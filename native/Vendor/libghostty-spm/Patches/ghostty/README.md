# Pier 独有的 Ghostty patches

放在 `Patches/ghostty/` 下，`scripts/build-libghostty.sh` 在 apply 完
Lakr233 上游 patches 之后再 apply 这一批。编号从 `0100` 起，跟 Lakr233
的 `0001-0009` 保持距离，一眼看清归属。

## 现存 patches

| 编号 | 说明 |
|---|---|
| `0100-command-started-action.patch` | 加 `GHOSTTY_ACTION_COMMAND_STARTED` C 符号 + Zig `Action` 变体 + Surface 消息路由，从 OSC 133 C / 633 E 提取 `cmdline_url` 交给上层。Native 通路的核心，pier `command_started` C API 依赖这一坨。等 Lakr233 上游合并同款可以删。 |
| `0101-zsh-cmdline-url.patch` | 让 ghostty 自带的 zsh shell integration 在 OSC 133 C 中附带 `cmdline_url=<URL-percent 编码>`。pier 靠这一段拿到用户敲的命令行文本，匹配 agent CLI 名点亮 tab icon。仅 zsh，其他 shell 上游没有等价 hook。 |
| `0102-embedded-main-thread-target-render.patch` | 为 embedded runtime 声明主线程绘制要求。renderer 完成 frame 后沿 Ghostty 原有 `redraw_surface` 路径保留精确 surface target，由宿主主线程只呈现目标 surface。 |
| `0103-host-cursor-suppress.patch` | 加 `ghostty_surface_set_cursor_suppress`：renderer 层强制不画光标（不受 TUI `CSI ?25h` 影响）。增强输入 pin 时 suppress 绘制（只闪 composer caret）；探针 0104 仍读模式位。 |
| `0104-cursor-visibility-probe.patch` | 加 `ghostty_surface_cursor_visible` 只读探针：读应用设置的 DECTCEM(?25) 模式位（不受 0103 渲染层 suppress 影响），用作「TUI 输入框是否聚焦」信号——现代 TUI 输入失焦即藏光标。 |
| `0105-host-user-messages.patch` | 宿主文案 get API（Pier Swift 实现）：Thread 启动失败 printString 读 catalog；Surface 进程退出 **fallback**（action 未消费）可读 `processExitedWithDismiss`。进程退出主路径不依赖本 patch——Pier 抑制英文后由 renderer `injectDisplayText`。需 `pnpm build:libghostty`。 |
| `0106-free-text-abi.patch` | 回移上游 main 对 `ghostty_surface_free_text` 的 ABI 修复（v1.2.3–v1.3.1 头文件声明两参、Zig 实现只收一参）：C 调用方把 surface 当 `Text*` 传入，`dumpTextLocked` 分配的文本永不释放。Pier 每 250ms 轮询 agent 终端 viewport 文本，长会话下主进程按 ~8KB/次线性泄漏（实测 40h 泄 ~8GB）。ghostty 升级到包含上游修复的版本后本 patch 会 apply 失败，直接删除即可。 |
| `0107-output-tap.patch` | 加 `ghostty_surface_set_output_tap`：per-surface 原始 PTY 输出 tap（`Termio.processOutputLocked` 解析前触发，IO 线程持 renderer 锁）。C API 留在 fork；Pier 宿主不再接线落盘。 |
| `0108-live-scrollback-limit.patch` | 加 `ghostty_surface_set_scrollback_limit`：运行时改主屏 `PageList.setMaxSize`，立刻丢掉超限页。Pier 用来让滚动历史偏好对存量 surface 即时生效。 |
| `0109-keystroke-follow-skip-nav-keys.patch` | 收窄 Ghostty 默认 `scroll-to-bottom = keystroke`：裸方向键 / Page（含小键盘）编码进 PTY 但不 `scrollViewport(.bottom)`。打字 / Enter / Backspace 以及 Ctrl/Alt/Super 和弦仍回 live。 |
| `0110-color-scheme-report-state.patch` | Mode 2031 通知和 CSI 996 查询使用 surface 当前明暗状态。无条件主题配置时，Ghostty 会跳过配置重放，不能从配置缓存推断当前外观；初始化与配置更新都显式传入实际状态。宿主还需同步处理 soft reload，确保状态先于通知进入 IO 队列。需 `pnpm build:libghostty` 与 `pnpm build:native`。 |
| `0111-utf8-safe-pty-write-chunk.patch` | `Exec.queueWrite` 写 PTY 时按 64 字节硬切，粘贴 / `ghostty_surface_text` 的正文会被切在多字节字符中间（21 个汉字 = 63 字节，第 22 个字被拆成 `E5` + `91 A2` 两次 write）。逐块解码的 TUI（cursor-agent 等）就把它显示成 `���`。加 `utf8ChunkEnd`：下一块首字节是续字节时把整个字符让给下一次 write，快路径与 `\r`→`\r\n` 慢路径同用；畸形输入回退到字节边界，绝不产生空块。缓冲仍是 64 字节，读端流式解码仍是读端自己的责任。上游 main 截至 2026-09-06 仍未对齐，可向上游提。 |

## 规则

- 幂等：`git apply --check` 与 `git apply --check --reverse` 双向识别，避免
  重跑 build 时 apply 失败。
- 只写「Lakr233 patches 之后」的增量。不要重复上游已有的改动。
- Lakr233 上游 `libghostty-spm` 的 tag `storage.1.2.8`（截至 2026-06-29）
  尚不包含 command_started action；pier 自带 `0100-`。
