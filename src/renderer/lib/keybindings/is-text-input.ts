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
