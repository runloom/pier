import type { TerminalBackend } from "./types.ts";

export interface FakeTerminalBackend extends TerminalBackend {
  readonly panels: Map<
    string,
    {
      agentId: string;
      cwd?: string | undefined;
      windowId: string;
      viewport: string;
      closed: boolean;
      sent: string[];
    }
  >;
  setViewport(panelId: string, text: string): void;
}

export function createFakeTerminalBackend(options?: {
  defaultWindowId?: string;
}): FakeTerminalBackend {
  const panels = new Map<
    string,
    {
      agentId: string;
      cwd?: string | undefined;
      windowId: string;
      viewport: string;
      closed: boolean;
      sent: string[];
    }
  >();
  let seq = 0;
  const defaultWindowId = options?.defaultWindowId ?? "win_fake";

  return {
    panels,
    setViewport(panelId, text) {
      const panel = panels.get(panelId);
      if (panel && !panel.closed) {
        panel.viewport = text;
      }
    },
    async create(args) {
      seq += 1;
      const panelId = `panel_fake_${seq}`;
      const runtimeId = panelId;
      const windowId = args.windowId ?? defaultWindowId;
      panels.set(panelId, {
        agentId: args.agentId,
        cwd: args.cwd,
        windowId,
        viewport: "",
        closed: false,
        sent: [],
      });
      return {
        panelId,
        windowId,
        runtimeId,
        ...(args.cwd ? { cwd: args.cwd } : {}),
      };
    },
    async sendText(panelId, text) {
      const panel = panels.get(panelId);
      if (!panel || panel.closed) {
        return false;
      }
      panel.sent.push(text);
      panel.viewport = `${panel.viewport}${text}`;
      return true;
    },
    async readViewport(panelId) {
      const panel = panels.get(panelId);
      if (!panel || panel.closed) {
        return null;
      }
      const lines = panel.viewport.split("\n");
      return {
        text: panel.viewport,
        rows: lines.length,
        cols: Math.max(0, ...lines.map((line) => line.length)),
      };
    },
    async interrupt(panelId) {
      const panel = panels.get(panelId);
      if (!panel || panel.closed) {
        return false;
      }
      panel.sent.push("\u0003");
      return true;
    },
    async terminate(panelId) {
      const panel = panels.get(panelId);
      if (!panel) {
        return false;
      }
      panel.closed = true;
      return true;
    },
    async focus(panelId, _windowId) {
      const panel = panels.get(panelId);
      return Boolean(panel && !panel.closed);
    },
  };
}
