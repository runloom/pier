/**
 * terminal list/get/send/key。
 * send/key 对 agent 与 shell 终端同构（W3：假 tmux send-keys 必须能写入智能体 panel）。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { getTerminalAddon } from "../../ipc/terminal/index.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { listPanels } from "./panel.ts";
import {
  isTerminalComponent,
  pickUniquePanel,
  resolveNativeKey,
} from "./terminal-locate.ts";

type TerminalListCommand = Extract<PierCommand, { type: "terminal.list" }>;
type TerminalGetCommand = Extract<PierCommand, { type: "terminal.get" }>;
type TerminalSendCommand = Extract<PierCommand, { type: "terminal.send" }>;
type TerminalKeyCommand = Extract<PierCommand, { type: "terminal.key" }>;

export function agentIdFromParams(
  params: Record<string, unknown> | undefined
): string | undefined {
  if (!params) {
    return;
  }
  const raw = params.agentId;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  // launch 选项嵌套 / 历史字段
  const launch = params.launch;
  if (launch && typeof launch === "object" && !Array.isArray(launch)) {
    const nested = (launch as { agentId?: unknown }).agentId;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }
  return;
}

export interface AgentPanelIndex {
  byScope: Map<string, string>;
  uniqueByPanel: Map<string, string>;
}

export function indexAgentIdsByPanel(
  entries: readonly {
    agentId?: string | undefined;
    panelId?: string | undefined;
    windowId?: string | undefined;
  }[]
): AgentPanelIndex {
  const byScope = new Map<string, string>();
  const seen = new Map<string, string[]>();
  for (const e of entries) {
    if (e.panelId && e.agentId) {
      byScope.set(`${e.windowId ?? ""}\0${e.panelId}`, e.agentId);
      const ids = seen.get(e.panelId) ?? [];
      ids.push(e.agentId);
      seen.set(e.panelId, ids);
    }
  }
  const uniqueByPanel = new Map<string, string>();
  for (const [panelId, ids] of seen) {
    // 词表不一致时：panelId 全局唯一才允许回退（跨窗同 id 禁止误绑）。
    if (ids.length === 1 && ids[0]) {
      uniqueByPanel.set(panelId, ids[0]);
    }
  }
  return { byScope, uniqueByPanel };
}

function agentIdsByPanel(services: PierCoreServices): AgentPanelIndex {
  try {
    return indexAgentIdsByPanel(
      services.agentRuntimeIndex.listMachine().entries
    );
  } catch {
    return { byScope: new Map(), uniqueByPanel: new Map() };
  }
}

export function toLocator(
  panel: {
    id: string;
    windowId: string;
    component?: string | undefined;
    active?: boolean | undefined;
    context?:
      | {
          projectRootPath?: string | undefined;
          worktreeKey?: string | undefined;
          cwd?: string | undefined;
        }
      | undefined;
    params?: Record<string, unknown> | undefined;
    display?: { short?: string | undefined } | undefined;
  },
  index: AgentPanelIndex
) {
  const path =
    panel.context?.cwd ??
    panel.context?.projectRootPath ??
    panel.context?.worktreeKey;
  const fromParams = agentIdFromParams(panel.params);
  const fromIndex =
    index.byScope.get(`${panel.windowId}\0${panel.id}`) ??
    index.uniqueByPanel.get(panel.id);
  const agentId = fromParams ?? fromIndex;
  return {
    panelId: panel.id,
    windowId: panel.windowId,
    component: panel.component ?? "terminal",
    ...(panel.active === undefined ? {} : { active: panel.active }),
    ...(path ? { canonicalPath: path } : {}),
    ...(panel.context?.worktreeKey
      ? { worktreeKey: panel.context.worktreeKey }
      : {}),
    ...(agentId ? { agentId } : {}),
    ...(panel.display?.short ? { title: panel.display.short } : {}),
    role: agentId ? ("agent" as const) : ("shell" as const),
  };
}

async function collectTerminals(
  services: PierCoreServices,
  windowId?: string
): Promise<ReturnType<typeof toLocator>[]> {
  const listed = await listPanels(
    windowId ? { type: "panel.list", windowId } : { type: "panel.list" },
    services as never
  );
  const indexAgentByPanel = agentIdsByPanel(services);
  return listed.panels
    .filter((p) => isTerminalComponent(p.component))
    .map((p) => toLocator(p, indexAgentByPanel));
}

export async function executeTerminalListCommand(
  requestId: string,
  command: TerminalListCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const terminals = await collectTerminals(services, command.windowId);
  return success(requestId, { terminals });
}

export async function executeTerminalGetCommand(
  requestId: string,
  command: TerminalGetCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const terminals = await collectTerminals(services, command.windowId);
  const picked = pickUniquePanel(
    terminals,
    command.panelId,
    command.windowId,
    (terminal) => terminal.panelId
  );
  if (!picked.ok) {
    return failure(
      requestId,
      "not_found",
      picked.reason === "ambiguous"
        ? `terminal panel is ambiguous across windows: ${command.panelId}`
        : `terminal panel not found: ${command.panelId}`
    );
  }
  return success(requestId, { terminal: picked.item });
}

function keySequence(key: string): string | null {
  const k = key.toLowerCase();
  if (k === "enter" || k === "return") {
    return "\r";
  }
  if (k === "escape" || k === "esc") {
    return "\u001b";
  }
  if (k === "tab") {
    return "\t";
  }
  if (k === "ctrl-c" || k === "ctrl+c" || k === "interrupt") {
    return "\u0003";
  }
  if (key.length === 1) {
    return key;
  }
  return null;
}

async function resolvePanelForWrite(
  requestId: string,
  panelId: string,
  windowId: string | undefined,
  services: PierCoreServices
): Promise<
  | { ok: true; windowId: string; params?: Record<string, unknown> }
  | { ok: false; result: PierCommandResult }
> {
  const terminals = await collectTerminals(services, windowId);
  const picked = pickUniquePanel(
    terminals,
    panelId,
    windowId,
    (terminal) => terminal.panelId
  );
  if (!picked.ok) {
    return {
      ok: false,
      result: failure(
        requestId,
        "not_found",
        picked.reason === "ambiguous"
          ? `terminal panel is ambiguous across windows: ${panelId}`
          : `terminal panel not found: ${panelId}`
      ),
    };
  }
  return { ok: true, windowId: picked.item.windowId };
}

export async function executeTerminalSendCommand(
  requestId: string,
  command: TerminalSendCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const resolved = await resolvePanelForWrite(
    requestId,
    command.panelId,
    command.windowId,
    services
  );
  if (!resolved.ok) {
    return resolved.result;
  }
  const key = resolveNativeKey(command.panelId, resolved.windowId);
  const addon = getTerminalAddon();
  if (!(key && addon)) {
    return failure(
      requestId,
      "platform_unavailable",
      "terminal native backend unavailable"
    );
  }
  const ok = addon.sendText(key, command.text);
  if (!ok) {
    return failure(requestId, "platform_unavailable", "terminal.send failed");
  }
  return success(requestId, {
    accepted: true as const,
    panelId: command.panelId,
  });
}

export async function executeTerminalKeyCommand(
  requestId: string,
  command: TerminalKeyCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const resolved = await resolvePanelForWrite(
    requestId,
    command.panelId,
    command.windowId,
    services
  );
  if (!resolved.ok) {
    return resolved.result;
  }
  const seq = keySequence(command.key);
  if (!seq) {
    return failure(
      requestId,
      "invalid_command",
      `unsupported terminal.key: ${command.key}`
    );
  }
  const key = resolveNativeKey(command.panelId, resolved.windowId);
  const addon = getTerminalAddon();
  if (!(key && addon)) {
    return failure(
      requestId,
      "platform_unavailable",
      "terminal native backend unavailable"
    );
  }
  const ok = addon.sendText(key, seq);
  if (!ok) {
    return failure(requestId, "platform_unavailable", "terminal.key failed");
  }
  return success(requestId, {
    accepted: true as const,
    panelId: command.panelId,
    key: command.key,
  });
}
