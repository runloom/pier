# 智能体终端生命周期与输入终态

日期：2026-09-07。范围：Pier 宿主的终端、智能体启动与输入、未发送草稿、窗口转移及资源清理。实施记录见 [实施计划](../plans/2026-09-07-terminal-agent-lifecycle-implementation.md)。

## 结论与问题来源

原问题的直接原因是停止智能体时调用了销毁原生终端的操作：Ghostty 视图与输出缓冲已经释放，Dockview 面板和智能体状态仍存在，所以留下空白面板。该终端此前停在 Codex 的原生钩子授权界面；授权等待和空白显示是两个不同阶段，不能把“等待用户确认”当作可以粘贴任务的就绪信号。

同一错误路径属于宿主共享逻辑，其他智能体也会受影响。本次以所有 35 个 catalog 条目为边界修正公共管线，保持各智能体原生 CLI、授权与续接语义。

补充实机验收还复现了另一条空白路径：CoreVideo 创建 display link 返回 `-6661`，上游包装层误报为 `OutOfMemory`，导致原生 surface 初始化失败。0113 将显示服务不可用与真实分配失败区分：前者使用 Ghostty 已有的按变化绘制路径，成功取得 display link 的终端保持默认行为。此回退按 surface 生效，不增加自动重试或第二套渲染器。[Apple 的返回值契约](https://developer.apple.com/documentation/corevideo/cvdisplaylinkcreatewithactivecgdisplays(_:))说明该 API 返回 Core Video 结果码，不能将所有失败归为内存不足。

## 验收契约

| 用户动作或事件 | 最终行为 | 证据边界 |
|---|---|---|
| 启动智能体并附带首条任务 | 有已核验交互式入口时，经原生 argv 交给 CLI；否则保存在增强输入框，用户手动发送 | 不使用定时粘贴，不发送自动确认按键 |
| 启动时原生授权 | 原样保留原生界面，用户手动确认；首条原生任务由 CLI 继续处理 | 已知需要用户处理的状态阻止后续增强输入；不宣称能识别任意 TUI 提示 |
| 增强输入或 `agents turn` | 先持久化发送检查点；每次写入及延迟 Return 前复核同一个实际终端实例 | 成功只表示输入传输接受，不表示模型完成或任务成功 |
| 中断 | 原生 Ctrl+C | 保留进程、面板与输出；具体中断语义由 CLI 决定 |
| 停止 | 原生 TERM，2 秒升级 KILL，最多等待 10 秒真实退出确认 | 成功来自退出回执；超时保留输出、阻止新输入并返回错误 |
| 停止或自然退出后 | 保留 Ghostty 视图与滚动历史，允许查看、复制和编辑未发送草稿；发送关闭 | 智能体退出不显示任务成功；显式停止任务显示取消 |
| 显式关闭或重启面板 | 等待当前进程清理后释放视图；重启取得新代次 | 旧回调、延迟按键与旧创建请求不能作用于新实例 |
| 窗口转移 | 冻结新编辑，等已接受附件操作和保存完成，转移原生终端与所有权，再解除冻结 | 原进程、输出和草稿保持；源窗口关闭不清理已转移终端；失败补偿原所有权 |
| renderer 重载 | 复用现有原生终端与创建回执，重新水合草稿 | 不重复包装命令、不重新提交首条任务 |
| 窗口或应用退出 | 保存草稿，取消尚未执行的创建，清理归属当前窗口的原生资源 | 正常退出等待持久化；强制结束进程无法保存尚未落盘的最新编辑 |
| 再次启动 Pier | 恢复未发送草稿；未确定的发送恢复为需要用户检查 | 不自动重放；已发送会话的续接仍使用智能体自身能力 |

## 责任与实现入口

- **原生终端**持有 PTY、进程与滚动历史。`0112-signal-process-retain-surface.patch` 增加 IO 线程信号请求和结果保留。macOS 保留尚未回收的进程组首进程直至升级清理完成，避免用已经失效的 PID/PGID；当前前台组通过所拥有 PTY 的 `TIOCSIG` 发送信号。
- **main 进程**以 `ipc/terminal/process/registry.ts` 记录实际创建代次、原生键、退出、停止与转移状态；`creation/serial.ts` 序列化创建/关闭，窗口销毁使旧请求失效。`runtime-control` 的运行配额跟随该事实，不根据前台活动图标猜测进程是否存在。
- **输入策略**沿用 `shared/agent-catalog.ts`，能力字段定义于 `shared/agent-surfaces/initial-prompts.ts`，解析及验证在 `services/agents/initial-prompt.ts`。最终执行核验过的绝对路径；任务文本在解析基础命令之后按单个字面参数附加。逻辑恢复命令不携带首条任务。
- **草稿**唯一写入方是 `main/state/terminal-drafts/`，文件为 userData 下的 `terminal-unsent-drafts.json`。按窗口记录 UUID 与面板 ID 索引，原子写入、0600 权限、修订号 CAS。保存文本、编辑器快照和附件引用/必要元数据，不保存模型输出或对话台账。
- **renderer**镜像 main 草稿。内容比较使用 `terminalDraftCompositionKey`，避免 IPC 字段顺序变化引发重复保存。附件操作在打开选择器/开始粘贴时登记完整 Promise；包括多图片和末尾文本。转移/退出的 flush 即使命中正在保存的请求，也重新越过附件等待屏障。
- **转移**使用现有 `panel-transfer` 服务：原生终端、进程记录、任务回调和输出所有权在第一个异步边界前同步迁移，随后原子迁移会话与草稿；回滚使用对应补偿。没有增加转移数据库。

## 35 个智能体覆盖矩阵

以下是本机 2026-09-07 的帮助/版本核验结果，不是远端模型调用测试。17 个条目具备已核验的原生交互式首条任务入口，18 个保守保存为草稿；**生命周期、草稿与停止逻辑对 35 个条目共用**。每次使用前按所解析二进制及文件元数据核验/缓存帮助，缺失、超时或不匹配一律回退。

| 智能体 | 首条任务入口 | 本机核验 |
|---|---|---|
| Claude（`claude`） | 原生交互 -- | 2.1.261；帮助匹配 |
| Codex（`codex`） | 原生交互 -- | codex-cli 0.153.4；帮助匹配 |
| Gemini（`gemini`） | 原生交互 --prompt-interactive | 0.56.0；帮助匹配 |
| Aider（`aider`） | 增强输入框草稿 | aider 0.86.2；保守回退 |
| OpenCode（`opencode`） | 原生交互 --prompt | 1.18.29；帮助匹配 |
| Cursor（`cursor`） | 原生交互 -- | 2026.09.02-c22c1a3；帮助匹配 |
| GitHub Copilot（`copilot`） | 原生交互 --interactive | GitHub Copilot CLI 1.0.83.；帮助匹配 |
| Droid（`droid`） | 原生交互 -- | 0.213.0；帮助匹配 |
| Kimi（`kimi`） | 增强输入框草稿 | 0.41.0；保守回退 |
| Pi（`pi`） | 原生交互 -- | 0.85.1；帮助匹配 |
| Amp（`amp`） | 增强输入框草稿 | 0.0.1788609637-g09e066；保守回退 |
| Grok（`grok`） | 原生交互 -- | grok 1.0.13；帮助匹配 |
| MiMo Code（`mimo-code`） | 原生交互 --prompt | 0.1.13；帮助匹配 |
| Ante（`ante`） | 增强输入框草稿 | 未取得本机版本；回退 |
| OMP（`omp`） | 原生交互 -- | omp/18.1.11；帮助匹配 |
| Antigravity（`antigravity`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Goose（`goose`） | 增强输入框草稿 | 1.47.0；保守回退 |
| Kilo Code（`kilo`） | 原生交互 --prompt | 7.4.23；帮助匹配 |
| Kiro（`kiro`） | 原生交互 -- | kiro-cli 2.16.1；帮助匹配 |
| Crush（`crush`） | 增强输入框草稿 | crush version v0.92.0；保守回退 |
| Auggie（`aug`） | 原生交互 --instruction | 0.36.0；帮助匹配 |
| Autohand Code（`autohand`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Cline（`cline`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Codebuff（`codebuff`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Command Code（`command-code`） | 增强输入框草稿 | 1.49.1；保守回退 |
| Continue（`continue`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Mistral Vibe（`mistral-vibe`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Qwen Code（`qwen-code`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Rovo Dev（`rovo`） | 增强输入框草稿 | 未取得本机版本；回退 |
| Hermes（`hermes`） | 增强输入框草稿 | Hermes Agent v0.20.0；保守回退 |
| OpenClaw（`openclaw`） | 增强输入框草稿 | OpenClaw 2026.9.1；保守回退 |
| Devin（`devin`） | 原生交互 -- | devin 3000.6.14；帮助匹配 |
| OpenClaude（`openclaude`） | 增强输入框草稿 | 未取得本机版本；回退 |
| CodeBuddy（`codebuddy`） | 原生交互 -- | 2.138.0；帮助匹配 |
| Qoder（`qodercli`） | 原生交互 --prompt-interactive | 1.1.45；帮助匹配 |

补充规则：

- Kiro 入口为 `kiro-cli chat --tui`，核验 `chat --help`；矩阵只列附加任务参数。
- Pi / OMP 的 `@` 前缀具有原生特殊含义，相关任务回退为草稿。
- Win32、超出原生参数安全长度、NUL、复杂 shell 表达式、包装器、已有 prompt/续接/无交互选项等不推断为可自动传入。
- Command Code 1.49.1 未取得足以证明字面位置参数语义的证据，继续使用草稿。不会为追求“全支持”改用 one-shot、headless 或自动回车。

## 验证记录

2026-09-07 最终工作区验证结果：

| 检查 | 结果 |
|---|---|
| 全量单测 | 1,573 个文件通过；13,654 个测试通过，2 个既有测试跳过 |
| 组件测试 | 44 个文件、623 个测试通过 |
| 串行集成测试 | 7 个文件、55 个测试通过 |
| Swift 原生测试 | 默认配置，99 个测试全部通过 |
| 真实 Electron / Ghostty E2E | Apple Silicon 4/4、Intel 4/4 通过；正常退出均未触发强制清理 |
| 构建与静态检查 | arm64 + x86_64 原生构建、Electron 构建、类型、lint、依赖边界、文件/目录规模检查全部通过 |

显示环境分层：Apple Silicon 原始探针返回 `-6661`，最终原生测试和 E2E 记录了按变化绘制回退并通过；Intel 探针返回 `0`，在可创建 display link 的环境完成同组 E2E。临时关闭 vsync 的诊断改动已经撤销。

两个测试机使用同一组 universal 产物（SHA-256 一致）：

- `ghostty_native.node`：`d3e07d105d9cc67849c5960313e9d7cb0535185e4d9ef68271b38c2b961b9b4d`
- `libGhosttyBridge.dylib`：`8127ec5f805ff8c96718a52194566d41d1418fc04974e5e8096b6323f082702b`

本次本机日志、截图与产物摘要收集于 `/tmp/pier-lifecycle-evidence/`；这些是临时验收材料，源码、契约和用例保存在仓库。复验命令：

- `pnpm check:static`：类型、格式、依赖边界、文件与目录规模检查。
- `pnpm test:unit`：全量单测，以及真实失败后补充的创建/关闭交错、发送检查点、代次隔离、草稿 CAS、附件转移屏障、正常退出回归。
- `pnpm test:component`：终端结束态、草稿与增强输入组件。
- `pnpm test:integration`：按仓库要求串行执行集成测试。
- `bash scripts/build-libghostty.sh` 与 `NATIVE_ARCHS='arm64 x86_64' pnpm build:native`：两种架构的 Ghostty、Swift Bridge 和 C++ addon。
- `pnpm test:native`：默认配置的 Swift 原生测试，覆盖输出、重绘、尺寸、滚动历史和跨窗口进程连续性。
- `pnpm test:e2e:auto tests/e2e/agents/subagent-panels-smoke.spec.ts tests/e2e/agents/terminal-lifecycle.spec.ts tests/e2e/agents/terminal-draft-restore.spec.ts --workers=1`：远端优先，真实 Electron/Ghostty 加隔离的 CLI fixture，验证授权、字面首条任务、Ctrl+C、TERM/KILL、顽固孙进程、配额、保留输出与正常退出恢复。

E2E 创建独立 userData，并清除继承的 Pier socket、窗口和面板身份；测试替身另有独立 ZDOTDIR 与 PATH，防止个人登录 shell 配置改为真实模型 CLI。恢复后等待 renderer 面板列表就绪再执行聚焦。测试结束必须自然退出；15 秒强制清理只能让用例失败，不能算通过。原生 viewport 读取用于验证输出；Playwright 的网页截图不包含原生 IOSurface，不能单凭黑色截图判定终端内容。

附加截图边界：本机按隔离窗口 ID 调用 `screencapture -l` 返回 `could not create image from window`，未获得原生整窗截图；该附加探针未计入通过项，临时用例已移除。原生绘制以默认配置的 Swift 帧/尺寸/重绘测试和双平台真实终端用例为证据。

## 明确边界

1. 进程清理保证宿主拥有的启动进程组及所拥有 PTY 的当前前台进程组；主动脱离终端的服务和任意自定义 shell 作业不纳入“全部后代必回收”的承诺。
2. 当前应用内滚动历史由 Ghostty 保存。重启应用后的已发送会话依赖智能体原生续接能力；Pier 不保存第二份 transcript。
3. 发送的传输确认与模型接收、执行结果分离。崩溃后的歧义必须交给用户判断，不通过自动重放追求虚假的 exactly-once。
4. 35 个条目均有明确策略与公共管线覆盖；未声称对 35 个供应商逐一执行联网模型回合。
5. 本次在当前开发分支交付源码与验收证据；没有替换已安装应用、重启正在工作的会话或发布版本。
