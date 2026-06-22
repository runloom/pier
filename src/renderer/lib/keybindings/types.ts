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

export interface KeyChord {
  readonly alt: boolean;
  /** "Mod" — mac 上等价 metaKey, 其他平台等价 ctrlKey. */
  readonly cmdOrCtrl: boolean;
  /** KeyboardEvent.code 值: "KeyP" / "Digit1" / "ArrowUp" / "Escape" 等. */
  readonly code: string;
  readonly shift: boolean;
}

export interface Keybinding {
  readonly chord: KeyChord;
  readonly commandId: string;
  readonly source: KeymapSource;
}

export interface KeybindingInput {
  /**
   * Action id (普通绑定) 或 "-actionId" (解绑标记, 仅在 user 层生效).
   */
  readonly commandId: string;
  /** DSL: "Mod+Shift+KeyP" / "Mod+KeyW". 解绑条目本字段可为空. */
  readonly keys: string;
}
