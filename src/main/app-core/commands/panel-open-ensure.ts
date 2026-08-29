import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { resolvePanelContextForPath } from "../../services/panel-context-resolver.ts";
import {
  peekTerminalPanelAgent,
  peekTerminalPanelContext,
  peekTerminalPanelTask,
} from "../../state/terminal-session-state.ts";
import { commandFailure } from "../command-results.ts";
import { asRecord, stringValue } from "../command-value.ts";
import {
  executePanelFocusCommand,
  executeTerminalOpenCommand,
  listPanels,
  type PanelCommandServices,
} from "./panel.ts";
import { sameResolvedPath } from "./panel-open-stat.ts";
import { agentIdFromParams, toLocator } from "./terminal-control.ts";
import { isTerminalComponent } from "./terminal-locate.ts";

type PanelOpenCommand = Extract<PierCommand, { type: "panel.open" }>;

export interface PathOpenResult {
  column?: number;
  context?: PanelContext;
  kind: "file" | "terminal";
  line?: number;
  panelId: string;
  path: string;
  reused: boolean;
}

function indexAgentByPanel(
  services: PanelCommandServices
): Map<string, string> {
  const map = new Map<string, string>();
  try {
    for (const entry of services.agentRuntimeIndex?.listMachine().entries ??
      []) {
      if (entry.panelId && entry.agentId) {
        map.set(entry.panelId, entry.agentId);
      }
    }
  } catch {
    /* Index optional in tests */
  }
  return map;
}

function isExcludedWorkface(
  panel: {
    id: string;
    component?: string | undefined;
    params?: Record<string, unknown> | undefined;
  },
  recordId: string,
  agents: Map<string, string>
): boolean {
  const locator = toLocator(
    {
      id: panel.id,
      windowId: "",
      component: panel.component,
      params: panel.params,
    },
    agents
  );
  if (locator.role === "agent") {
    return true;
  }
  if (peekTerminalPanelAgent(recordId, panel.id)) {
    return true;
  }
  if (agentIdFromParams(panel.params)) {
    return true;
  }
  if (panel.params?.task) {
    return true;
  }
  return Boolean(peekTerminalPanelTask(recordId, panel.id));
}

export async function liveReferencePanelId(
  windowId: string,
  referencePanelId: string | undefined,
  services: PanelCommandServices
): Promise<string | undefined> {
  if (!referencePanelId) {
    return;
  }
  const listed = await listPanels({ type: "panel.list", windowId }, services);
  return listed.panels.some((panel) => panel.id === referencePanelId)
    ? referencePanelId
    : undefined;
}

async function findMatchingShellTerminal(
  services: PanelCommandServices,
  windowId: string,
  recordId: string,
  dir: string
): Promise<string | undefined> {
  const listed = await listPanels({ type: "panel.list", windowId }, services);
  const agents = indexAgentByPanel(services);
  const matches: Array<{ active?: boolean; id: string }> = [];
  for (const panel of listed.panels) {
    if (!isTerminalComponent(panel.component)) {
      continue;
    }
    if (isExcludedWorkface(panel, recordId, agents)) {
      continue;
    }
    const cwd =
      peekTerminalPanelContext(recordId, panel.id)?.cwd ?? panel.context?.cwd;
    if (!cwd) {
      continue;
    }
    if (await sameResolvedPath(cwd, dir)) {
      matches.push({
        id: panel.id,
        ...(typeof panel.active === "boolean" ? { active: panel.active } : {}),
      });
    }
  }
  const active = matches.find((item) => item.active);
  return active?.id ?? matches[0]?.id;
}

async function focusPanel(
  requestId: string,
  services: PanelCommandServices,
  panelId: string,
  windowId: string,
  focus: boolean | undefined
): Promise<PierCommandResult> {
  return await executePanelFocusCommand(
    requestId,
    {
      panelId,
      type: "panel.focus",
      windowId,
      ...(focus === undefined ? {} : { focus }),
    },
    services
  );
}

export async function ensureDirectoryTerminal(input: {
  dir: string;
  focus?: boolean;
  placement?: PanelOpenCommand["placement"];
  recordId: string;
  referencePanelId?: string;
  requestId: string;
  services: PanelCommandServices;
  windowId: string;
}): Promise<PathOpenResult | { error: PierCommandResult }> {
  const context = await resolvePanelContextForPath(input.dir, {
    source: "cli",
  });
  const originId = await liveReferencePanelId(
    input.windowId,
    input.referencePanelId,
    input.services
  );
  if (!input.placement && originId) {
    const originCwd = peekTerminalPanelContext(input.recordId, originId)?.cwd;
    if (originCwd && (await sameResolvedPath(originCwd, input.dir))) {
      const listed = await listPanels(
        { type: "panel.list", windowId: input.windowId },
        input.services
      );
      const origin = listed.panels.find((panel) => panel.id === originId);
      const excluded =
        origin !== undefined &&
        isExcludedWorkface(
          origin,
          input.recordId,
          indexAgentByPanel(input.services)
        );
      if (!excluded) {
        const focused = await focusPanel(
          input.requestId,
          input.services,
          originId,
          input.windowId,
          input.focus
        );
        if (!focused.ok) {
          return { error: focused };
        }
        return {
          context,
          kind: "terminal",
          panelId: originId,
          path: input.dir,
          reused: true,
        };
      }
    }
  }
  if (!input.placement) {
    const match = await findMatchingShellTerminal(
      input.services,
      input.windowId,
      input.recordId,
      input.dir
    );
    if (match) {
      const focused = await focusPanel(
        input.requestId,
        input.services,
        match,
        input.windowId,
        input.focus
      );
      if (!focused.ok) {
        return { error: focused };
      }
      return {
        context,
        kind: "terminal",
        panelId: match,
        path: input.dir,
        reused: true,
      };
    }
  }
  const opened = await executeTerminalOpenCommand(
    input.requestId,
    {
      type: "terminal.open",
      windowId: input.windowId,
      launch: { cwd: input.dir },
      ...(input.focus === undefined ? {} : { focus: input.focus }),
      ...(input.placement ? { placement: input.placement } : {}),
      ...(originId ? { referencePanelId: originId } : {}),
    },
    input.services
  );
  if (!opened.ok) {
    return { error: opened };
  }
  const record = asRecord(opened.data);
  const panelId = stringValue(record ?? {}, "panelId");
  if (!panelId) {
    return {
      error: commandFailure(
        input.requestId,
        "platform_unavailable",
        "terminal.open did not return panelId"
      ),
    };
  }
  return {
    context,
    kind: "terminal",
    panelId,
    path: input.dir,
    reused: false,
  };
}
