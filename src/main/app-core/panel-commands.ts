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
import type {
  ResolvedTerminalLaunchOptions,
  TerminalLaunchOptions,
} from "@shared/contracts/terminal-launch.ts";
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

function mergeTerminalLaunchProfile(
  launch: TerminalLaunchOptions,
  profile: ResolvedTerminalLaunchOptions | null
): ResolvedTerminalLaunchOptions {
  const env =
    profile?.env || launch.env
      ? { ...(profile?.env ?? {}), ...(launch.env ?? {}) }
      : undefined;
  return {
    ...(profile?.command && { command: profile.command }),
    ...(profile?.cwd && { cwd: profile.cwd }),
    ...(env && { env }),
    ...(launch.command && { command: launch.command }),
    ...(launch.cwd && { cwd: launch.cwd }),
  };
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
  options: { tab?: PanelTabChrome } = {}
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

  const rawLaunch = command.launch ?? {};
  const profile = rawLaunch.profileId
    ? await services.terminalProfiles.resolve(rawLaunch.profileId)
    : null;
  if (rawLaunch.profileId && !profile) {
    return commandFailure(
      requestId,
      "invalid_command",
      `unknown terminal profile: ${rawLaunch.profileId}`
    );
  }
  const launch = mergeTerminalLaunchProfile(rawLaunch, profile);
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
      placement: command.placement,
      ...(options.tab && { tab: options.tab }),
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
  return commandSuccess(requestId, result.data);
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
