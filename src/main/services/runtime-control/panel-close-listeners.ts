import { createLogger } from "@shared/logger.ts";

const log = createLogger("runtime-control.panel-close");

type TerminalPanelGoneListener = (panelId: string, windowId?: string) => void;

function createRegistry() {
  const listeners = new Set<TerminalPanelGoneListener>();
  return {
    subscribe(listener: TerminalPanelGoneListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(panelId: string, windowId?: string): void {
      for (const listener of listeners) {
        try {
          listener(panelId, windowId);
        } catch (err) {
          log.error("terminal runtime-gone listener failed", { err });
        }
      }
    },
  };
}

/** renderer 终端面板关闭（面板与 surface 一并消失）。 */
const panelClosed = createRegistry();

export const onTerminalPanelClosed = panelClosed.subscribe;
export const notifyTerminalPanelClosed = panelClosed.notify;

/**
 * native pty 进程退出：智能体已死、面板可能仍开着展示终态。
 * 配额按「运行时存活」计，故 pty 退出即释放；之后真正关面板时幂等 no-op。
 */
const ptyExited = createRegistry();

export const onTerminalPtyExited = ptyExited.subscribe;
export const notifyTerminalPtyExited = ptyExited.notify;
