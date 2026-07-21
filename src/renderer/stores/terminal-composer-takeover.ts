/**
 * Rich Input / agent composer 键盘路径注册表。
 *
 * workspace-host 与 tab header 在「焦点归还终端」路径上先询问这里：
 * - reason `"activate"`：面板激活 / 点已激活 tab → 若 composer 仍打开，应 refocus 输入框
 * - reason `"surface"`：点终端内容区 focus-request → 关闭 composer 并归还 TUI
 *
 * 回调返回 boolean：true = 已处理焦点（调用方止步）；false = 未接管，
 * 调用方走原生焦点归还路径。
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

export function resetTerminalComposerTakeoverForTests(): void {
  takeovers.clear();
}
