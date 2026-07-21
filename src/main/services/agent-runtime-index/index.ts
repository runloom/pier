import type {
  AgentRuntimeFocusResult,
  AgentRuntimeIndexSnapshot,
  SortAgentIndexEntriesOptions,
} from "@shared/contracts/agent-runtime-index.ts";
import {
  isAgentIndexNeedsYou,
  projectAgentActivities,
  sortAgentIndexEntries,
} from "@shared/contracts/agent-runtime-index.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";
import { peekTerminalPanelContext } from "../../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findInternalWindowId,
  findWindowContext,
} from "../../windows/window-identity.ts";
import type { RendererCommandService } from "../renderer-command-service.ts";
import { focusAgentByRef } from "./focus.ts";

export interface AgentRuntimeIndexService {
  focus(agentRef: string): Promise<AgentRuntimeFocusResult>;
  focusWaiting(
    options?: SortAgentIndexEntriesOptions
  ): Promise<AgentRuntimeFocusResult>;
  listMachine(
    options?: SortAgentIndexEntriesOptions
  ): AgentRuntimeIndexSnapshot;
}

export interface CreateAgentRuntimeIndexServiceArgs {
  rendererCommand: RendererCommandService;
  resolveInternalWindowId?(electronWindowId: string): string | null;
  /** Session store scope (record UUID) — separate from the runtime window id. */
  resolveSessionScope?(electronWindowId: string): string | null;
  snapshot(): ForegroundActivityBroadcast;
}

function defaultResolveInternalWindowId(
  electronWindowId: string
): string | null {
  const electronId = Number(electronWindowId);
  if (!Number.isFinite(electronId)) {
    return null;
  }
  const win = findAppWindowByElectronId(electronId);
  if (!win || win.isDestroyed()) {
    return null;
  }
  return findInternalWindowId(win);
}

/** Terminal session store scope (window record UUID), not the runtime id. */
function defaultResolveSessionScope(electronWindowId: string): string | null {
  const electronId = Number(electronWindowId);
  if (!Number.isFinite(electronId)) {
    return null;
  }
  const win = findAppWindowByElectronId(electronId);
  if (!win || win.isDestroyed()) {
    return null;
  }
  return findWindowContext(win)?.recordId ?? null;
}

export function createAgentRuntimeIndexService({
  snapshot,
  rendererCommand,
  resolveInternalWindowId = defaultResolveInternalWindowId,
  resolveSessionScope = defaultResolveSessionScope,
}: CreateAgentRuntimeIndexServiceArgs): AgentRuntimeIndexService {
  const listMachine = (
    options?: SortAgentIndexEntriesOptions
  ): AgentRuntimeIndexSnapshot => {
    const broadcast = snapshot();
    const entries = sortAgentIndexEntries(
      projectAgentActivities(broadcast.activities, {
        resolveContext: (electronWindowId, panelId) => {
          const sessionScope = resolveSessionScope(electronWindowId);
          if (!sessionScope) {
            return null;
          }
          const context = peekTerminalPanelContext(sessionScope, panelId);
          if (!context) {
            return null;
          }
          return {
            ...(context.cwd ? { cwd: context.cwd } : {}),
            projectRootPath: context.projectRootPath,
            ...(context.worktreeKey
              ? { worktreeKey: context.worktreeKey }
              : {}),
          };
        },
      }),
      options
    );
    return { entries, ts: broadcast.ts };
  };

  const executePanelFocus = (input: {
    panelId: string;
    windowId: string;
  }): Promise<RendererCommandResult> =>
    rendererCommand.execute({
      type: "panel.focus",
      panelId: input.panelId,
      windowId: input.windowId,
      focus: true,
    });

  const focus = (agentRef: string): Promise<AgentRuntimeFocusResult> => {
    const { entries } = listMachine();
    return focusAgentByRef({
      agentRef,
      entryExists: entries.some((entry) => entry.agentRef === agentRef),
      resolveInternalWindowId,
      executePanelFocus,
    });
  };

  const focusWaiting = async (
    options?: SortAgentIndexEntriesOptions
  ): Promise<AgentRuntimeFocusResult> => {
    const { entries } = listMachine(options);
    const target = entries.find((entry) => isAgentIndexNeedsYou(entry.status));
    if (!target) {
      return { status: "empty" };
    }
    return focus(target.agentRef);
  };

  return { listMachine, focus, focusWaiting };
}
