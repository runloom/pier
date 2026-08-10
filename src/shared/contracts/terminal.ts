import { z } from "zod";
import type { AgentKind } from "./agent.ts";
import type { TerminalExitPresentation } from "./ghostty-host-copy.ts";
import type { PanelContext, PanelTabChrome } from "./panel.ts";
import type { TaskOutputPanelParams, TaskPanelMetadata } from "./tasks.ts";
import type { SkillsLaunchBlockedInfo } from "./terminal/skills-launch.ts";

export type {
  GhosttyChildExitedVariant,
  GhosttyHostMessageKind,
  TerminalChildExitedEvent,
  TerminalExitDismissMode,
  TerminalExitPresentation,
  TerminalExitRole,
} from "./ghostty-host-copy.ts";
export {
  classifyGhosttyChildExited,
  defaultDismissModeForExitRole,
  GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS,
  GHOSTTY_HOST_MESSAGE_CATALOG,
  primaryI18nKeyForChildExited,
} from "./ghostty-host-copy.ts";

export type {
  TerminalComposerAttachmentDto,
  TerminalComposerImageBytes,
  TerminalComposerMaterializeResult,
  TerminalComposerPasteTextWrite,
  TerminalComposerPasteTextWriteResult,
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
  TerminalComposerTextBytes,
} from "./terminal/composer-attachments.ts";
export type {
  SkillsLaunchBlockedInfo,
  SkillsLaunchContinueResult,
} from "./terminal/skills-launch.ts";

export interface TerminalFrame {
  /** BrowserWindow contentView 坐标，top-left origin，已叠加 Electron page zoom。 */
  height: number;
  width: number;
  x: number;
  y: number;
}

export type TerminalPresentationReason =
  | "anchor-resize"
  | "dockview-active-panel"
  | "dockview-dimensions"
  | "dockview-layout"
  | "dockview-maximize"
  | "restore"
  | "visibility"
  | "window-blur"
  | "window-focus"
  | "window-resize"
  | `window-${"resize" | "view-zoom" | "zoom"}`;

export interface TerminalWebOverlayRect {
  frame: TerminalFrame;
  id: string;
}

export type TerminalKeyboardFocusTarget =
  | {
      kind: "terminal";
      panelId: string;
    }
  | {
      kind: "web";
    };

export interface TerminalHostEntry {
  frame: TerminalFrame | null;
  panelId: string;
  visible: boolean;
}

export type TerminalHostReason =
  | TerminalPresentationReason
  | "input-routing"
  | "surface-created"
  | "surface-closing";

export interface TerminalHostSnapshot {
  activePanelId: string | null;
  activeTerminalPanelId: string | null;
  basePanel: TerminalKeyboardFocusTarget;
  /**
   * 原生聚焦开关关闭的面板（Agent Composer 等 web 输入组件接管期间）。
   * 名单内终端不得成为原生键盘目标；native pin surface focus（防 ESC[O]）
   * 并 suppress 绘制光标（避免与增强输入 caret 双闪）。探针仍读 DECTCEM
   * 模式位。renderer panelId。
   */
  focusDisabledPanelIds: string[];
  hasMaximizedGroup: boolean;
  reason: TerminalHostReason;
  rendererSequence: number;
  terminals: TerminalHostEntry[];
  webOverlayRects: TerminalWebOverlayRect[];
  webRequestCount: number;
}

export interface TerminalNativeWindowState {
  /**
   * 原生聚焦开关关闭的面板（native panelId，含窗口前缀）：
   * 不做 first responder；surface focus pin + 绘制光标 suppress。
   */
  focusDisabledPanelIds: string[];
  keyboardTarget: TerminalKeyboardFocusTarget;
  nativeApplySequence: number;
  reason: TerminalHostReason;
  rendererSequence: number;
  terminals: Array<TerminalHostEntry & { focused: boolean }>;
  webOverlayRects: TerminalWebOverlayRect[];
  windowFocused: boolean;
}

export type TerminalNativeApplyResult =
  | { status: "applied" | "stale" | "unchanged" }
  | { status: "error"; error: string };

export interface TerminalCoordinatorDebugSnapshot {
  desired: TerminalHostSnapshot | null;
  dirty: boolean;
  effective: TerminalNativeWindowState | null;
  lastError: string | null;
  lastSuccessfulNativeApplySequence: number;
  readyPanelIds: string[];
}

export interface TerminalFocusApplyResult {
  effective: TerminalNativeWindowState | null;
  error: string | null;
  nativeStatus: TerminalNativeApplyResult["status"] | null;
  rendererSequence: number | null;
  shouldAck: boolean;
  status:
    | "applied"
    | "conflict"
    | "error"
    | "stale"
    | "unavailable"
    | "unchanged";
  webContentsFocused: boolean;
}

export type NativeFocusIntentResult =
  | { ok: true; panelId: string }
  | {
      ok: false;
      reason: "cross-window" | "hidden" | "not-ready" | "stale";
    };

/**
 * Terminal 字体配置. family 是有序的字体族 fallback 链, 已在 renderer 侧由
 * computeMonoFontFamilyList 产出 (用户字体在前 + 真实字体名 fallback, 不含 CSS
 * generic). native 端逐项喂给 ghostty 的 font-family (每行一个、可重复), 而非拼成
 * 逗号串 —— ghostty 不吃逗号. size 单位 px, 是基础 monoFontSize 叠加整体界面缩放
 * 后的有效字号, 范围 8-48.
 */
export interface TerminalFont {
  /** 字体族 fallback 链 (有序)，已在 renderer 侧由 computeMonoFontFamilyList 产出，native 端逐项喂给 ghostty font-family。 */
  family: string[];
  size: number;
}

export type TerminalCursorStyle = "block" | "bar" | "underline";

export interface TerminalRuntimeConfig {
  cursorBlink: boolean;
  cursorStyle: TerminalCursorStyle;
  pasteProtection: boolean;
  scrollbackLimitBytes: number;
}

export interface CreateTerminalArgs {
  context?: PanelContext | undefined;
  /**
   * 进程退出文案策略（与 dockview panel params.exitPresentation 同构）。
   * native 不解析 i18n；renderer 在 child-exited 时读 params 拼最终串再 inject。
   */
  exitPresentation?: TerminalExitPresentation | undefined;
  font: TerminalFont;
  frame: TerminalFrame;
  initialInput?: string | undefined;
  launchId?: string | undefined;
  panelId: string;
  /**
   * Native surface presentation generation for frame gate / create handoff.
   * Renderer allocates per open; main passes through to Ghostty create.
   */
  presentationId?: number | undefined;
  /**
   * 受管启动重试握手（design v8 §5.2.7）：携带处于 SPAWN_INTENT 授权窗口内的
   * attempt id 时，跳过重新校正直接放行；窗口外拒绝且不 replay。
   */
  skillsLaunchContinuation?: string | undefined;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
  /** 后台任务的只读 Ghostty 输出会话；存在时不创建 shell/PTY。 */
  taskOutput?: TaskOutputPanelParams | undefined;
}

export type TerminalAgentRestoreOutcome =
  | "resumed"
  | "cold-start"
  | "unsupported";

/** Cold-start toast action: user-triggered native "resume last / continue". */
export interface TerminalTryResumeLastSpec {
  agentId: AgentKind;
  command: string;
  cwd?: string | undefined;
}

export interface CreateTerminalResult {
  /**
   * 恢复 running agent 时的结果：有 sessionId 则 resumed；无 id / 缺命令为
   * cold-start；adapter 不支持为 unsupported。非 restore 路径省略。
   */
  agentRestore?: TerminalAgentRestoreOutcome | undefined;
  error?: string;
  ok: boolean;
  /** 受管启动被技能门阻断时的结构化信息（renderer 弹三选）。 */
  skillsLaunchBlocked?: SkillsLaunchBlockedInfo | undefined;
  /**
   * cold-start 且 agent 支持「最近会话」入口时给出；renderer toast 操作可
   * 用它 relaunch，不扫盘、不猜 session id。
   */
  tryResumeLast?: TerminalTryResumeLastSpec | undefined;
}

export interface RebindTaskOutputResult extends CreateTerminalResult {
  generation?: number;
  stale?: boolean;
}

export type {
  TerminalAgentPanelMetadata,
  TerminalAgentResumeMetadata,
  TerminalPanelSessionSnapshot,
} from "./terminal/panel-session.ts";
export type { TerminalFrameCommittedEvent } from "./terminal/presentation.ts";

export interface TerminalContextMenuRequest {
  panelId: string;
  /** BrowserWindow contentView 坐标 (top-left origin, flipped). */
  x: number;
  y: number;
}

export interface TerminalFocusRequest {
  panelId: string;
  reason: "mouse-down" | "key-event" | "window-become-key" | "system";
}

/** Ghostty 的已退出 surface 收到用户按键后，请求关闭宿主 panel。 */
export interface TerminalSurfaceCloseRequest {
  panelId: string;
}

/**
 * Terminal cwd 变化事件 — swift OSC 7 解析后通过 IPC 推送到 renderer.
 * cwd 是绝对路径 (file:// 前缀已由 swift 端从 URL 提取掉).
 */
export interface TerminalCwdEvent {
  context: PanelContext;
  panelId: string;
}

/**
 * Terminal title 变化事件 — swift OSC 0/2 解析后通过 IPC 推送到 renderer.
 * title 是 TUI 应用 (claude / vim / aider) 主动设置的自定义 window title,
 * descriptor.long 的最高优先级来源.
 */
export interface TerminalTitleEvent {
  panelId: string;
  title: string;
}

export const terminalOpenUrlKindSchema = z.enum(["text", "html", "unknown"]);
export type TerminalOpenUrlKind = z.infer<typeof terminalOpenUrlKindSchema>;

export const terminalOpenUrlEventSchema = z.object({
  column: z.number().int().positive().optional(),
  kind: terminalOpenUrlKindSchema,
  /** 1-based line for editor reveal after open (e.g. path:10:5). */
  line: z.number().int().positive().optional(),
  panelId: z.string().min(1),
  url: z.string().min(1).max(16_384),
});
export type TerminalOpenUrlEvent = z.infer<typeof terminalOpenUrlEventSchema>;

export type TerminalOperation = "copy" | "paste" | "selectAll" | "clearScreen";

export interface TerminalOperationResult {
  error?: string | undefined;
  ok: boolean;
  /**
   * submit 路径：文本已 paste 进 PTY，但随后的 Return 键失败。
   * 调用方应清空草稿（避免重试重复粘贴），并提示用户用空 Enter 再提交。
   */
  textDelivered?: boolean | undefined;
}

export interface TerminalSendTextArgs {
  panelId: string;
  /**
   * true：先 paste 文本，再注入真实 Return 键提交。
   * 不能把 `\r` 拼进同一次 sendText——bracketed paste 下末尾回车不会提交。
   * paste 与 Return 之间 main 侧会留 settle 延迟（SUBMIT_ENTER_SETTLE_MS）：
   * 两次写入落在 TUI 同一次 stdin read() 时，部分 agent 会把 \r 吞进
   * paste 处理而不提交（codex#28167 同款）。
   */
  submit?: boolean | undefined;
  text: string;
}

/** 合成按键（Esc / Ctrl+C / 方向键等）。绕过 bracketed paste。 */
export interface TerminalSendKeyPressArgs {
  keycode: number;
  /** ghostty_input_mods 位掩码；缺省 0。 */
  mods?: number | undefined;
  panelId: string;
  /**
   * Optional UTF-8 text associated with the key (e.g. "\\r" for Return).
   * Ghostty needs this for some TUI submit paths when only keycode is synthetic.
   */
  text?: string | undefined;
}

/**
 * TUI 输入聚焦探针结果：读应用设置的 DECTCEM(?25) 光标模式位。
 * `unknown` = surface 不存在 / addon 未加载——禁止当作「失焦」处理。
 */
export type TerminalCursorVisibility = "hidden" | "unknown" | "visible";

export type TerminalSelectionTextResult =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; text: string };

export type TerminalSearchDirection = "next" | "previous";

export interface TerminalSearchStateEvent {
  panelId: string;
  selected: number;
  total: number;
}

/**
 * ANSI 16 色 palette. 索引语义 = xterm-256color 前 16 槽:
 * 0..7   = black, red, green, yellow, blue, magenta, cyan, white
 * 8..15  = bright black .. bright white
 *
 * 每项是 #RRGGBB (6 字符, 不含 alpha) — Ghostty 库接收 hex 字符串.
 */
export type AnsiPalette = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * 终端配色描述. 由 renderer 侧从当前 Shiki 主题派生, 经 IPC → native addon →
 * Ghostty controller.setTheme 应用. 所有色值都是 #RRGGBB (含 #, 6 字符).
 *
 * cursor / selectionBackground / selectionForeground 写成 `| undefined` 而非纯
 * optional, 是因为项目 tsconfig 启用 exactOptionalPropertyTypes — derive 函数
 * 会显式赋 undefined 表示"主题缺这个键", IPC 边界用 isString 守卫区分缺失
 * vs 实际值.
 */
export interface TerminalColors {
  background: string;
  cursor?: string | undefined;
  foreground: string;
  palette: AnsiPalette;
  selectionBackground?: string | undefined;
  selectionForeground?: string | undefined;
}

export interface TerminalCloseOptions {
  reason?: "relaunch" | "workspace" | undefined;
}

export type { TerminalAPI } from "./terminal/api-surface.ts";
