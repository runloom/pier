import type { TerminalChildExitedEvent } from "../ghostty-host-copy.ts";
import type { TaskOutputPanelParams } from "../tasks.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
  RebindTaskOutputResult,
  TerminalCloseOptions,
  TerminalColors,
  TerminalContextMenuRequest,
  TerminalCursorVisibility,
  TerminalCwdEvent,
  TerminalFocusRequest,
  TerminalFont,
  TerminalHostSnapshot,
  TerminalOpenUrlEvent,
  TerminalOperation,
  TerminalOperationResult,
  TerminalRuntimeConfig,
  TerminalSearchDirection,
  TerminalSearchStateEvent,
  TerminalSelectionTextResult,
  TerminalSendKeyPressArgs,
  TerminalSendTextArgs,
  TerminalSurfaceCloseRequest,
  TerminalTitleEvent,
} from "../terminal.ts";
import type {
  TerminalComposerImageBytes,
  TerminalComposerMaterializeResult,
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
  TerminalComposerTextBytes,
} from "./composer-attachments.ts";
import type {
  TerminalDebugRendererSnapshot,
  TerminalDebugRendererSnapshotRequest,
  TerminalDebugSnapshot,
  TerminalDebugSnapshotArgs,
  TerminalDebugWindowOpenResult,
} from "./debug.ts";
import type { TerminalEndState } from "./end-state.ts";
import type { TerminalPanelSessionSnapshot } from "./panel-session.ts";
import type { TerminalFrameCommittedEvent } from "./presentation.ts";

export interface TerminalAPI {
  applyHostSnapshot(snapshot: TerminalHostSnapshot): void;
  applyTheme(colors: TerminalColors): void;
  /**
   * 关闭 terminal panel 的 native NSView. 普通 workspace close 可以忽略返回的
   * promise；同 panel relaunch 必须 await, 避免旧 close 删除新 session 状态.
   * 调用 idempotent (panelId 不存在时 no-op).
   */
  close(panelId: string, options?: TerminalCloseOptions): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  /**
   * TUI 输入聚焦探针：读该 surface 应用设置的 DECTCEM(?25) 光标模式位。
   * 现代 TUI 输入框失焦即隐藏硬件光标（crush 已源码验证），「visible」
   * 可解释为「输入框大概率聚焦」；「unknown」时调用方禁止按「失焦」行动。
   */
  cursorVisible(panelId: string): Promise<TerminalCursorVisibility>;
  debugSnapshot(
    args?: TerminalDebugSnapshotArgs
  ): Promise<TerminalDebugSnapshot>;
  endSearch(panelId: string): Promise<TerminalOperationResult>;
  /** Resolve the absolute path for a dropped File (sandbox-safe). */
  getPathForFile(file: File): string;
  /**
   * Inject fully localized text into the terminal display (not PTY).
   * Used after child-exited; text must already be i18n-resolved.
   */
  injectDisplayText(
    panelId: string,
    text: string
  ): Promise<{ error?: string; ok: boolean }>;
  materializeComposerClipboardImage(): Promise<TerminalComposerMaterializeResult>;
  materializeComposerImageBytes(
    data: TerminalComposerImageBytes
  ): Promise<TerminalComposerMaterializeResult>;
  materializeComposerTextBytes(
    data: TerminalComposerTextBytes
  ): Promise<TerminalComposerMaterializeResult>;
  navigateSearch(
    panelId: string,
    direction: TerminalSearchDirection
  ): Promise<TerminalOperationResult>;
  /**
   * Ghostty `SHOW_CHILD_EXITED`：宿主已消费 action（抑制英文 printString）。
   * renderer 解析最终本地化文案后调用 `injectDisplayText` 写入终端 buffer。
   */
  onChildExited: (cb: (event: TerminalChildExitedEvent) => void) => () => void;
  /** 订阅 swift 转发的右键事件. 返回 unsubscribe. */
  onContextMenuRequest: (
    cb: (req: TerminalContextMenuRequest) => void
  ) => () => void;
  /**
   * 订阅 terminal cwd 变化. 回调返回 dispose 函数, 调用即取消订阅.
   * 每次调用建立一个独立 listener — 调用方收到所有 panel 的事件并自行按
   * panelId 过滤. 多 panel 场景下会有 N 个 listener, 每个 panel 自行 dispose.
   */
  onCwdChange(cb: (event: TerminalCwdEvent) => void): () => void;
  onDebugRendererSnapshotRequest: (
    cb: (
      req: TerminalDebugRendererSnapshotRequest
    ) => Promise<TerminalDebugRendererSnapshot> | TerminalDebugRendererSnapshot
  ) => () => void;
  /**
   * Agent/task 结果查看终态变更（main 权威 → renderer EndState store）。
   */
  onEndStateChanged(cb: (end: TerminalEndState) => void): () => void;
  /** native terminal 内容区收到左键聚焦意图时, 通知 renderer 激活对应 dockview tab. */
  onFocusRequest: (cb: (req: TerminalFocusRequest) => void) => () => void;
  /** 当前 native 实例、当前像素尺寸的首帧已提交到 Core Animation 图层树。 */
  onFrameCommitted(
    cb: (event: TerminalFrameCommittedEvent) => void
  ): () => void;
  onOpenUrl(cb: (event: TerminalOpenUrlEvent) => void): () => void;
  /** renderer 下发的 presentation 已被 native 同步应用, 用于 resize 撤占位的精确握手. */
  onPresentationApplied(
    cb: (payload: { rendererSequence: number }) => void
  ): () => void;
  /** main 端应用菜单请求打开当前终端搜索栏. */
  onSearchOpenRequest(cb: () => void): () => void;
  onSearchState(cb: (event: TerminalSearchStateEvent) => void): () => void;
  /** 用户在 Ghostty 的进程退出提示上按键后，关闭对应宿主 panel。 */
  onSurfaceCloseRequest: (
    cb: (req: TerminalSurfaceCloseRequest) => void
  ) => () => void;
  /**
   * 订阅 terminal title (OSC 0/2) 变化. 回调返回 dispose 函数.
   * 与 onCwdChange 相同的"多 listener 各自过滤"模式.
   */
  onTitleChange(cb: (event: TerminalTitleEvent) => void): () => void;
  openDebugWindow(): Promise<TerminalDebugWindowOpenResult>;
  performOperation(
    panelId: string,
    operation: TerminalOperation
  ): Promise<TerminalOperationResult>;
  pickComposerFiles(): Promise<TerminalComposerPickResult>;
  readSelectionText(panelId: string): Promise<TerminalSelectionTextResult>;
  /**
   * 读取上次关闭前的 terminal panel 展示状态. 用于 app 重启后先恢复 tab
   * 标题/cwd, 真正的 native terminal 可以等 panel 可见时再创建.
   */
  readSession(panelId: string): Promise<TerminalPanelSessionSnapshot | null>;
  /**
   * 在不更换 dockview panel 的前提下，把只读输出终端切换到另一 TaskRun。
   */
  rebindTaskOutput(
    panelId: string,
    params: TaskOutputPanelParams
  ): Promise<RebindTaskOutputResult>;
  /**
   * 报告 renderer 当前活跃的 terminal panelId 集合. swift 把不在集合里的 NSView
   * 清掉 — C 方案 reload 零销毁路径的孤儿兜底:reload 前 layout 有但新 layout
   * 没有的 panel 在这里被回收. dockview restore 完成时 (renderer 知道完整 layout)
   * 调一次即可. fire-and-forget.
   */
  reconcile(activeIds: string[]): void;
  resolveComposerPaths(paths: string[]): Promise<TerminalComposerPathsResult>;
  /** Reveal an attachment path in the platform file manager (Finder/Explorer). */
  revealComposerPath(path: string): Promise<void>;
  search(panelId: string, query: string): Promise<TerminalOperationResult>;
  /**
   * 注入一次 AppKit 虚拟键码的 press+release（绕过 bracketed paste）。
   * Composer 控制键透传与 submit 后的 Return 都走这条路径。
   */
  sendKeyPress(
    args: TerminalSendKeyPressArgs
  ): Promise<TerminalOperationResult>;
  /**
   * 向已存在 terminal panel 的 PTY 直写 UTF-8 文本（绕过按键翻译）。
   * shell 开启 bracketed paste (mode 2004) 时 libghostty 自动包裹粘贴标记。
   * surface 未就绪返回 { ok: false }——调用方负责反馈，不做重试。
   * 控制键（Esc / Ctrl+C / 方向键）不要走这里，用 {@link sendKeyPress}。
   */
  sendText(args: TerminalSendTextArgs): Promise<TerminalOperationResult>;
  setAppShortcutKeys(keys: string[]): void;
  setConfig(config: TerminalRuntimeConfig): void;
  /**
   * 热更新已存在 terminal 的字体. 走 Ghostty TerminalController.setTerminalConfiguration
   * → ghostty_surface_update_config, 不重建 surface, 不杀 shell. fire-and-forget.
   */
  setFont(panelId: string, font: TerminalFont): void;
  /**
   * Push fully localized host copy catalog (keys = GhosttyHostMessageKind leaf
   * names). Used for buffer inject + paste confirm + Thread.zig startup errors.
   */
  setHostCopyCatalog(
    messages: Record<string, string>
  ): Promise<{ error?: string; ok: boolean }>;
  /**
   * Push UI language tag (e.g. `zh-CN`, `en`) to native host copy
   * (paste confirm). Empty string clears override → system preferred language.
   */
  setHostLanguage(
    languageTag: string
  ): Promise<{ error?: string; ok: boolean }>;
  /**
   * 用户改名。`rule` / `model` 是 main 内部层级，renderer 不得写入——
   * 因此 source 固定 `user`（最高秩，可覆盖任何自动标题）。
   * 失败安全：返回 ok/applied，不抛。
   */
  setSessionTitle(
    panelId: string,
    input: { title: string; source: "user" }
  ): Promise<{ applied: boolean; ok: boolean }>;
  setup(): Promise<CreateTerminalResult>;
}
