/**
 * 文本输入焦点检测 — 用于在文本输入场景下跳过无 cmdOrCtrl 的快捷键, 不抢用户字符
 * 输入. 带 Cmd/Ctrl 的快捷键 (如 Cmd+W) 仍允许触发.
 *
 * 覆盖三类:
 *   1. 原生 <input> (非按钮型) / <textarea>
 *   2. contenteditable 元素自身或后代
 *   3. role="textbox" / "searchbox" / "combobox" 的自定义可编辑组件
 */

const EDITABLE_ROLES: Record<string, true> = {
  combobox: true,
  searchbox: true,
  textbox: true,
};

/**
 * IME 仍在处理该键（Chromium `keyCode` 229 或 `isComposing`）。
 * 此时不能把 Enter 当发送：preventDefault 会把候选字按 UTF-8 字节提交
 * （汉字「现」变成三个 U+FFFD）。
 */
export const IME_PENDING_KEYCODE = 229;

export function isImePendingKeyboardEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">
): boolean {
  return event.isComposing === true || event.keyCode === IME_PENDING_KEYCODE;
}

/**
 * Lexical `KEY_ENTER_COMMAND`：IME 确认回车应消费命令且**不要**
 * preventDefault，否则会落到 PlainTextPlugin 再拦默认行为并插入换行。
 */
export function isImePendingLexicalEnter(event: KeyboardEvent | null): boolean {
  return event !== null && isImePendingKeyboardEvent(event);
}

export function isTextInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "TEXTAREA") {
    return true;
  }
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return (
      type !== "checkbox" &&
      type !== "radio" &&
      type !== "button" &&
      type !== "submit" &&
      type !== "reset"
    );
  }
  if (
    target instanceof HTMLElement &&
    target.closest('[contenteditable=""], [contenteditable="true"]')
  ) {
    return true;
  }
  const role = target.getAttribute("role");
  return role !== null && EDITABLE_ROLES[role] === true;
}
