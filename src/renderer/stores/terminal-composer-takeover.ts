/**
 * Agent Composer 键盘接管注册表。composer 挂载时注册 focus 回调；
 * workspace-host 在「焦点归还终端」的路径上先询问这里——命中则聚焦
 * composer 输入框，不再把键盘交回 native 终端。
 *
 * 回调返回 boolean：true 表示焦点确实被接了过去（调用方应就此止步）；
 * false 表示注册存在但未能接管（例如输入框当前 disabled）——调用方
 * 必须视作未命中，走原生焦点归还路径，否则键盘会悬空。
 */
const takeovers = new Map<string, () => boolean>();

export function registerTerminalComposerTakeover(
  panelId: string,
  focus: () => boolean
): () => void {
  takeovers.set(panelId, focus);
  return () => {
    if (takeovers.get(panelId) === focus) {
      takeovers.delete(panelId);
    }
  };
}

export function terminalComposerTakeoverFocus(panelId: string): boolean {
  const focus = takeovers.get(panelId);
  if (!focus) {
    return false;
  }
  return focus();
}

export function resetTerminalComposerTakeoverForTests(): void {
  takeovers.clear();
}
