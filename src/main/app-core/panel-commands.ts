import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PanelSnapshot, WindowInfo } from "@shared/contracts/events.ts";
import {
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
  panelDisplaySchema,
  panelKindSchema,
} from "@shared/contracts/panel.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type {
  TaskPanelMetadata,
  TaskPanelRef,
} from "@shared/contracts/tasks.ts";
import type {
  ResolvedTerminalLaunchOptions,
  TerminalLaunchOptions,
} from "@shared/contracts/terminal-launch.ts";
import { resolveAgentCommand } from "../services/agents/agent-launch.ts";
import type {
  ProcessEnvironmentResolveRequest,
  ProcessEnvironmentService,
  ProcessEnvironmentSource,
} from "../services/process-environment-service.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import {
  asRecord,
  booleanValue,
  numberValue,
  stringValue,
} from "./command-value.ts";
import { orderedWindows, resolveCommandWindow } from "./window-routing.ts";

export interface PanelCommandServices {
  panelContexts: {
    recordRecent(context: PanelContext): Promise<void>;
    resolveForPath(path: string): Promise<PanelContext>;
  };
  preferences: {
    read(): Promise<ProjectPreferences>;
  };
  processEnvironment: ProcessEnvironmentService;
  rendererCommand: RendererCommandService;
  terminalLaunches: {
    consume(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    discard(launchId: string): Promise<void> | void;
    read(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    register(launch: ResolvedTerminalLaunchOptions): Promise<string> | string;
  };
  terminalProfiles: {
    resolve(
      profileId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
  };
  window: {
    list(): WindowInfo[];
  };
}

interface GlobalPanelSnapshot extends PanelSnapshot {
  recordId: string;
  windowFocused: boolean;
  windowId: string;
  windowIndex: number;
}

interface PanelListSnapshot {
  errors: Array<{
    code?: PierCommandErrorCode | undefined;
    message: string;
    recordId?: string | undefined;
    windowId?: string | undefined;
  }>;
  panels: GlobalPanelSnapshot[];
}

function normalizePanelSnapshot(
  raw: unknown,
  windowInfo: WindowInfo,
  windowIndex: number
): GlobalPanelSnapshot | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const id = stringValue(record, "id") ?? stringValue(record, "panelId");
  if (!id) {
    return null;
  }
  const rawKind = stringValue(record, "kind");
  const parsedKind = panelKindSchema.safeParse(rawKind);
  const kind = parsedKind.success ? parsedKind.data : "web";
  const active = booleanValue(record, "active");
  const context = panelContextSchema.safeParse(record.context);
  const display = panelDisplaySchema.safeParse(record.display);
  return {
    groupIndex: numberValue(record, "groupIndex", 0),
    id,
    kind,
    recordId: windowInfo.recordId,
    tabCount: numberValue(record, "tabCount", 1),
    tabIndex: numberValue(record, "tabIndex", 0),
    windowFocused: windowInfo.focused,
    windowId: windowInfo.id,
    windowIndex,
    ...(active === undefined ? {} : { active }),
    ...(context.success ? { context: context.data } : {}),
    ...(display.success ? { display: display.data } : {}),
  };
}

function mergeTerminalLaunchCommandAndCwd(
  launch: TerminalLaunchOptions,
  profile: ResolvedTerminalLaunchOptions | null
): ResolvedTerminalLaunchOptions {
  return {
    ...(profile?.agentId && { agentId: profile.agentId }),
    ...(profile?.command && { command: profile.command }),
    ...(profile?.cwd && { cwd: profile.cwd }),
    ...(launch.agentId && { agentId: launch.agentId }),
    ...(launch.command && { command: launch.command }),
    ...(launch.cwd && { cwd: launch.cwd }),
  };
}

function optionalEnv(
  env: Record<string, string>
): Pick<ResolvedTerminalLaunchOptions, "env"> | Record<string, never> {
  return Object.keys(env).length > 0 ? { env } : {};
}

/** ok:false ⇒ unknown agent (catalog miss) → invalid_command. */
type AgentCmdResult = { ok: true; command: string } | { ok: false };

async function resolveAgentLaunchCommand(
  agentId: AgentKind,
  services: Pick<PanelCommandServices, "preferences">
): Promise<AgentCmdResult> {
  const prefs = await services.preferences.read();
  const command = resolveAgentCommand({
    agentId,
    override: prefs.agentCommandOverrides?.[agentId],
    agentDefaultArgs: prefs.agentDefaultArgs,
  });
  return command === null ? { ok: false } : { ok: true, command };
}

interface ResolvedLaunchBase {
  launchBase: ResolvedTerminalLaunchOptions;
  profile: ResolvedTerminalLaunchOptions | null;
}

async function resolveTerminalLaunchBase(
  rawLaunch: TerminalLaunchOptions,
  services: Pick<PanelCommandServices, "preferences" | "terminalProfiles">
): Promise<ResolvedLaunchBase | { error: string }> {
  const profile = rawLaunch.profileId
    ? await services.terminalProfiles.resolve(rawLaunch.profileId)
    : null;
  if (rawLaunch.profileId && !profile) {
    return { error: `unknown terminal profile: ${rawLaunch.profileId}` };
  }
  let launchBase = mergeTerminalLaunchCommandAndCwd(rawLaunch, profile);
  // Explicit command / profile command wins; only resolve agent when neither set.
  if (!launchBase.command && launchBase.agentId) {
    const result = await resolveAgentLaunchCommand(
      launchBase.agentId,
      services
    );
    if (!result.ok) {
      return { error: `unknown agent: ${launchBase.agentId}` };
    }
    launchBase = { ...launchBase, command: result.command };
  }
  return { launchBase, profile };
}

function dataWithWindowId(
  data: unknown,
  windowId: string
): Record<string, unknown> {
  const record = asRecord(data);
  return {
    ...(record ?? {}),
    windowId,
  };
}

function resolveTerminalOpenTarget(
  command: Extract<PierCommand, { type: "terminal.open" }>,
  services: PanelCommandServices,
  reusePanel: TaskPanelRef | undefined
) {
  const windowId = reusePanel?.windowId ?? command.windowId;
  return resolveCommandWindow(windowId, services, {
    requireStableDefault: !windowId,
  });
}

async function listPanels(
  command: Extract<PierCommand, { type: "panel.list" }>,
  services: PanelCommandServices
): Promise<PanelListSnapshot> {
  const windows = orderedWindows(services.window.list());
  const targetWindows = command.windowId
    ? windows.filter((windowInfo) => windowInfo.id === command.windowId)
    : windows;
  const errors: PanelListSnapshot["errors"] = [];
  if (command.windowId && targetWindows.length === 0) {
    errors.push({
      code: "not_found",
      message: `window not found: ${command.windowId}`,
      windowId: command.windowId,
    });
  }

  const panels: GlobalPanelSnapshot[] = [];
  for (const windowInfo of targetWindows) {
    const windowIndex = windows.findIndex(
      (candidate) => candidate.id === windowInfo.id
    );
    const result = await services.rendererCommand.execute({
      type: "panel.list",
      windowId: windowInfo.id,
    });
    if (!result.ok) {
      errors.push({
        code: result.error.code,
        message: result.error.message,
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    if (!Array.isArray(result.data)) {
      errors.push({
        code: "platform_unavailable",
        message: "renderer returned invalid panel list",
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    for (const rawPanel of result.data) {
      const snapshot = normalizePanelSnapshot(
        rawPanel,
        windowInfo,
        windowIndex >= 0 ? windowIndex : 0
      );
      if (snapshot) {
        panels.push(snapshot);
      }
    }
  }
  return { errors, panels };
}

export async function executePanelListCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.list" }>,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  if (command.windowId) {
    const result = await services.rendererCommand.execute(command);
    if (result.ok) {
      return commandSuccess(requestId, result.data);
    }
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  return commandSuccess(requestId, await listPanels(command, services));
}

export async function executePanelOpenCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.open" }>,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  const target = resolveCommandWindow(command.windowId, services, {
    requireStableDefault: !command.windowId,
  });
  if (!target.window) {
    return commandFailure(
      requestId,
      target.code ?? (command.windowId ? "not_found" : "platform_unavailable"),
      target.error ?? "no renderer window available"
    );
  }

  const context = await services.panelContexts.resolveForPath(command.path);
  const result = await services.rendererCommand.execute({
    focus: command.focus,
    placement: command.placement,
    type: "panel.open",
    context,
    windowId: target.window.id,
  });
  if (!result.ok) {
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  await services.panelContexts.recordRecent(context);
  return commandSuccess(requestId, result.data);
}

export async function executeTerminalOpenCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "terminal.open" }>,
  services: PanelCommandServices,
  options: {
    clientEnv?: Record<string, string> | undefined;
    source?: ProcessEnvironmentSource | undefined;
    tab?: PanelTabChrome;
    task?: TaskPanelMetadata;
    reusePanel?: TaskPanelRef | undefined;
  } = {}
): Promise<PierCommandResult> {
  const target = resolveTerminalOpenTarget(
    command,
    services,
    options.reusePanel
  );
  if (!target.window) {
    return commandFailure(
      requestId,
      target.code ?? (command.windowId ? "not_found" : "platform_unavailable"),
      target.error ?? "no renderer window available"
    );
  }

  const rawLaunch = command.launch ?? {};
  const resolved = await resolveTerminalLaunchBase(rawLaunch, services);
  if ("error" in resolved) {
    return commandFailure(requestId, "invalid_command", resolved.error);
  }
  const { launchBase, profile } = resolved;
  const environmentRequest: ProcessEnvironmentResolveRequest = {
    cwd: launchBase.cwd,
    ...(options.clientEnv ? { clientEnv: options.clientEnv } : {}),
    ...(rawLaunch.env ? { explicitEnv: rawLaunch.env } : {}),
    ...(profile?.env ? { profileEnv: profile.env } : {}),
    source: options.source ?? "terminal",
  };
  const resolvedEnvironment =
    await services.processEnvironment.resolve(environmentRequest);
  const launch: ResolvedTerminalLaunchOptions = {
    ...launchBase,
    ...optionalEnv(resolvedEnvironment.env),
  };
  const context = launch.cwd
    ? await services.panelContexts.resolveForPath(launch.cwd)
    : undefined;
  const launchId = await services.terminalLaunches.register(launch);
  let result: Awaited<ReturnType<typeof services.rendererCommand.execute>>;
  try {
    result = await services.rendererCommand.execute({
      ...(context && { context }),
      focus: command.focus,
      launchId,
      ...(options.reusePanel ? { panelId: options.reusePanel.panelId } : {}),
      placement: command.placement,
      ...(options.tab && { tab: options.tab }),
      ...(options.task && { task: options.task }),
      type: "terminal.open",
      windowId: target.window.id,
    });
  } catch (err) {
    await services.terminalLaunches.discard(launchId);
    throw err;
  }
  if (!result.ok) {
    await services.terminalLaunches.discard(launchId);
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  if (context) {
    await services.panelContexts.recordRecent(context);
  }
  return commandSuccess(
    requestId,
    dataWithWindowId(result.data, target.window.id)
  );
}

export async function executePanelFocusCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.focus" }>,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  if (command.windowId) {
    const result = await services.rendererCommand.execute(command);
    if (result.ok) {
      return commandSuccess(requestId, result.data);
    }
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }

  const snapshot = await listPanels({ type: "panel.list" }, services);
  if (snapshot.errors.length > 0) {
    return commandFailure(
      requestId,
      "platform_unavailable",
      "panel list incomplete; pass --window"
    );
  }
  const matches = snapshot.panels.filter(
    (panel) => panel.id === command.panelId
  );
  if (matches.length === 0) {
    return commandFailure(
      requestId,
      "not_found",
      `panel not found: ${command.panelId}`
    );
  }
  if (matches.length > 1) {
    return commandFailure(
      requestId,
      "invalid_command",
      `panel id is ambiguous: ${command.panelId}; pass --window`
    );
  }
  const match = matches[0];
  if (!match) {
    return commandFailure(
      requestId,
      "not_found",
      `panel not found: ${command.panelId}`
    );
  }

  const result = await services.rendererCommand.execute({
    ...command,
    windowId: match.windowId,
  });
  if (!result.ok) {
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  const record = asRecord(result.data);
  return commandSuccess(requestId, {
    ...(record ?? {}),
    windowId: match.windowId,
  });
}
