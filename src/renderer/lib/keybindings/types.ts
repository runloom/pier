/**
 * Keybinding 域模型. 三条核心设计:
 *
 *   1. Action ↔ Keybinding 解耦: Action 只描述"能做什么"; Keybinding 描述"怎么触发".
 *      二者一对多, 通过 commandId 字符串关联.
 *   2. -commandId 解绑语法 (VS Code 风格): 用户层 commandId 以 "-" 前缀
 *      → 屏蔽该 command 在默认层的所有绑定, 不删除 default registry 数据.
 *   3. KeyboardEvent.code 作权威源 (不用 .key): macOS Option 死键 / 多语言
 *      键盘 / 软键盘 都不影响 code, 命中稳定.
 */

export type KeymapSource = "default" | "user";

/**
 * Keybinding scope tag — resolve 优先级 [overlay 阻断] > [panel] > [global].
 * 新 panel kit / overlay 在 panel-registry 或 overlay component 内声明对应 scope id.
 */
export type KeybindingScope =
  | "global"
  | `panel:${string}`
  | `overlay:${string}`;

export interface KeyChord {
  readonly alt: boolean;
  /** "Mod" — mac 上等价 metaKey, 其他平台等价 ctrlKey. */
  readonly cmdOrCtrl: boolean;
  /** KeyboardEvent.code 值: "KeyP" / "Digit1" / "ArrowUp" / "Escape" 等. */
  readonly code: string;
  /**
   * 独立 Ctrl 物理键. mac 上独立于 Cmd; 非 mac 上无意义 (永远 false, 因为
   * Mod 和 Ctrl 在非 mac 上是同一物理键). 用于表达 mac 上 "Ctrl+Shift+方向键"
   * 这种与 Cmd 区分的 binding.
   */
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export interface Keybinding {
  readonly chord: KeyChord;
  readonly commandId: string;
  readonly scope: KeybindingScope;
  readonly source: KeymapSource;
}

export interface KeybindingInput {
  /**
   * Action id (普通绑定) 或 "-actionId" (解绑标记, 仅在 user 层生效).
   */
  readonly commandId: string;
  /** DSL: "Mod+Shift+KeyP" / "Mod+KeyW". 解绑条目本字段可为空. */
  readonly keys: string;
  /** Default 'global' if omitted (兼容老 keymap entries). */
  readonly scope?: KeybindingScope;
}

/**
 * resolve(chord, scopeState) 的输入. 优先级 [overlay 阻断] > [panel] > [global].
 * activePanelComponent 是 dockview panel component id (例: "terminal" / "web").
 */
export interface ResolveScopeState {
  readonly activePanelComponent: string | null;
  readonly overlayStack: readonly string[];
}
