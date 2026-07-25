/**
 * Rich Input / agent composer 键盘路径注册表。
 *
 * workspace-host 与 tab header 在「焦点归还终端」路径上先询问这里：
 * - reason `"activate"`：面板激活 / 点已激活 tab → 若 composer 仍打开，refocus 输入框
 * - reason `"surface"`：点终端内容区 → **吞掉**归还键盘（return true）：
 *   不关卡片、不 yield、键仍钉在增强输入；鼠标已点到 TUI 可复原输入聚焦，
 *   并立刻重探光标。关闭只走 Esc / 发送成功 / 资格失效
 *
 * 回调返回 boolean：true = 已处理（调用方止步）；false = 未接管，走原生路径。
 */
export type TerminalComposerTakeoverReason = "activate" | "surface";

type TakeoverHandler = (reason: TerminalComposerTakeoverReason) => boolean;

const takeovers = new Map<string, TakeoverHandler>();

export function registerTerminalComposerTakeover(
  panelId: string,
  handler: TakeoverHandler
): () => void {
  takeovers.set(panelId, handler);
  return () => {
    if (takeovers.get(panelId) === handler) {
      takeovers.delete(panelId);
    }
  };
}

export function terminalComposerTakeoverFocus(
  panelId: string,
  reason: TerminalComposerTakeoverReason = "activate"
): boolean {
  const handler = takeovers.get(panelId);
  if (!handler) {
    return false;
  }
  return handler(reason);
}

/** True while Rich Input is mounted for the panel (takeover registered). */
export function isTerminalComposerOpen(panelId: string): boolean {
  return takeovers.has(panelId);
}

export function resetTerminalComposerTakeoverForTests(): void {
  takeovers.clear();
}
