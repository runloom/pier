import type {
  PanelOpenPathEntry,
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  diskTargetPartsForAbsolute,
  withTerminalOpenAnchor,
} from "@shared/terminal-open-disk-target.ts";
import { resolvePanelContextForPath } from "../../services/panel-context-resolver.ts";
import { commandFailure, commandSuccess } from "../command-results.ts";
import { asRecord, stringValue } from "../command-value.ts";
import { resolveCommandWindow } from "../window-routing.ts";
import type { PanelCommandServices } from "./panel.ts";
import {
  ensureDirectoryTerminal,
  liveReferencePanelId,
  type PathOpenResult,
} from "./panel-open-ensure.ts";
import { type ClassifiedPath, classifyPath } from "./panel-open-stat.ts";

type PanelOpenCommand = Extract<PierCommand, { type: "panel.open" }>;

function pathEntries(command: PanelOpenCommand): PanelOpenPathEntry[] {
  if (command.paths && command.paths.length > 0) {
    return command.paths;
  }
  return [{ path: command.path }];
}

export function resolvePathOpenWindow(
  command: PanelOpenCommand,
  services: PanelCommandServices
) {
  if (!command.windowId) {
    return resolveCommandWindow(undefined, services, {
      requireStableDefault: true,
    });
  }
  const hit = resolveCommandWindow(command.windowId, services);
  if (hit.window) {
    return hit;
  }
  if (command.referencePanelId) {
    return resolveCommandWindow(undefined, services, {
      requireStableDefault: true,
    });
  }
  return hit;
}

async function openFileInEditor(input: {
  column?: number;
  focus?: boolean;
  line?: number;
  path: string;
  placement?: PanelOpenCommand["placement"];
  referencePanelId?: string;
  requestId: string;
  services: PanelCommandServices;
  windowId: string;
}): Promise<PathOpenResult | { error: PierCommandResult }> {
  const context = await resolvePanelContextForPath(input.path, {
    pathKind: "file",
    source: "cli",
  });
  const parts = diskTargetPartsForAbsolute(input.path, {
    ...context,
    openedPath: context.cwd,
  });
  if (!parts.relativePath) {
    return {
      error: commandFailure(
        input.requestId,
        "invalid_command",
        `not a file path: ${input.path}`
      ),
    };
  }
  const openContext = withTerminalOpenAnchor(context, parts.root) ?? context;
  const originId = await liveReferencePanelId(
    input.windowId,
    input.referencePanelId,
    input.services
  );
  const result = await input.services.rendererCommand.execute({
    type: "files.openDisk",
    path: parts.relativePath,
    root: parts.root,
    revealTree: false,
    windowId: input.windowId,
    context: openContext,
    ...(input.column === undefined ? {} : { column: input.column }),
    ...(input.focus === undefined ? {} : { focus: input.focus }),
    ...(input.line === undefined ? {} : { line: input.line }),
    ...(input.placement ? { placement: input.placement } : {}),
    ...(originId ? { referencePanelId: originId } : {}),
  });
  if (!result.ok) {
    return {
      error: commandFailure(
        input.requestId,
        result.error.code ?? "platform_unavailable",
        result.error.message
      ),
    };
  }
  const record = asRecord(result.data);
  const panelId = stringValue(record ?? {}, "panelId");
  if (!panelId) {
    return {
      error: commandFailure(
        input.requestId,
        "platform_unavailable",
        "files.openDisk did not return panelId"
      ),
    };
  }
  return {
    context: openContext,
    kind: "file",
    panelId,
    path: input.path,
    reused: record?.reused === true,
    ...(input.column === undefined ? {} : { column: input.column }),
    ...(input.line === undefined ? {} : { line: input.line }),
  };
}

export async function executePanelOpenCommand(
  requestId: string,
  command: PanelOpenCommand,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  const target = resolvePathOpenWindow(command, services);
  if (!target.window) {
    return commandFailure(
      requestId,
      target.code ?? (command.windowId ? "not_found" : "platform_unavailable"),
      target.error ?? "no renderer window available"
    );
  }

  const classified: ClassifiedPath[] = [];
  for (const entry of pathEntries(command)) {
    const next = await classifyPath(entry);
    if ("error" in next) {
      return commandFailure(requestId, next.error.code, next.error.message);
    }
    classified.push(next);
  }

  const results: PathOpenResult[] = [];
  for (const item of classified) {
    if (item.kind === "directory") {
      const opened = await ensureDirectoryTerminal({
        dir: item.path,
        recordId: target.window.recordId,
        requestId,
        services,
        windowId: target.window.id,
        ...(command.focus === undefined ? {} : { focus: command.focus }),
        ...(command.placement ? { placement: command.placement } : {}),
        ...(command.referencePanelId
          ? { referencePanelId: command.referencePanelId }
          : {}),
      });
      if ("error" in opened) {
        return opened.error;
      }
      results.push(opened);
      continue;
    }
    const opened = await openFileInEditor({
      path: item.path,
      requestId,
      services,
      windowId: target.window.id,
      ...(item.column === undefined ? {} : { column: item.column }),
      ...(command.focus === undefined ? {} : { focus: command.focus }),
      ...(item.line === undefined ? {} : { line: item.line }),
      ...(command.placement ? { placement: command.placement } : {}),
      ...(command.referencePanelId
        ? { referencePanelId: command.referencePanelId }
        : {}),
    });
    if ("error" in opened) {
      return opened.error;
    }
    results.push(opened);
  }

  const last = results.at(-1);
  if (!last) {
    return commandFailure(requestId, "invalid_command", "no paths to open");
  }
  const lastDirectory = results.findLast((item) => item.kind === "terminal");
  const context = lastDirectory?.context ?? last.context;
  await services.panelContexts.recordRecent(
    context ?? (await resolvePanelContextForPath(last.path, { source: "cli" }))
  );
  return commandSuccess(requestId, {
    context,
    panelId: last.panelId,
    results: results.map((item) => ({
      kind: item.kind,
      panelId: item.panelId,
      path: item.path,
      reused: item.reused,
      ...(item.column === undefined ? {} : { column: item.column }),
      ...(item.line === undefined ? {} : { line: item.line }),
    })),
    reused: last.reused,
    windowId: target.window.id,
  });
}
