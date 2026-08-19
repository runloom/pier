import {
  allocatePane,
  paneIdForPanel,
  removePane,
  type SessionMap,
  saveSessionMap,
} from "../main/session-map.ts";
import { applyTmuxFormat, paneFormatVars } from "./format.ts";
import {
  flagOn,
  flagString,
  parsePaneTarget,
  parsePercentRatio,
} from "./parse.ts";
import type { JsonCommand } from "./types.ts";
import { resultDataRecord, resultErrorMessage } from "./types.ts";
import {
  fail,
  invokeTracked,
  ok,
  paneLaunchFields,
  requireBinding,
  type VerbContext,
  type VerbOutcome,
} from "./verb-context.ts";

function printPane(ctx: VerbContext, paneId: string, windowId: string): string {
  if (!flagOn(ctx.flags, "-P")) {
    return "";
  }
  const template = flagString(ctx.flags, "-F") ?? "#{pane_id}";
  return `${applyTmuxFormat(template, paneFormatVars({ paneId, windowId }))}\n`;
}

async function openAndBind(
  ctx: VerbContext,
  command: JsonCommand,
  paneId: string
): Promise<VerbOutcome> {
  const result = await invokeTracked(ctx, command);
  if (!result.ok) {
    return fail(resultErrorMessage(result));
  }
  const data = resultDataRecord(result);
  const panelId =
    (typeof data?.panelId === "string" ? data.panelId : undefined) ??
    (typeof data?.id === "string" ? data.id : undefined);
  const windowId =
    (typeof data?.windowId === "string" ? data.windowId : undefined) ??
    (typeof command.windowId === "string" ? command.windowId : undefined) ??
    ctx.env.PIER_WINDOW_ID;
  if (!(panelId && windowId)) {
    return fail("terminal.open did not return panelId/windowId");
  }
  const previous = ctx.map.panes[paneId];
  const map = {
    ...ctx.map,
    panes: {
      ...ctx.map.panes,
      [paneId]: {
        panelId,
        windowId,
        ...(previous?.splitAxis ? { splitAxis: previous.splitAxis } : {}),
      },
    },
  };
  saveSessionMap(ctx.workDir, map);
  return ok(printPane(ctx, paneId, windowId), map);
}

async function applyOptionalSplitSize(
  ctx: VerbContext,
  paneId: string,
  outcome: VerbOutcome
): Promise<void> {
  const ratio = parsePercentRatio(flagString(ctx.flags, "-l"));
  const binding = outcome.map?.panes[paneId];
  if (!(ratio && binding)) {
    return;
  }
  await invokeTracked(ctx, {
    type: "panel.setSize",
    panelId: binding.panelId,
    windowId: binding.windowId,
    ...(flagOn(ctx.flags, "-h")
      ? { widthRatio: ratio }
      : { heightRatio: ratio }),
  });
}

async function openAllocated(
  ctx: VerbContext,
  command: JsonCommand,
  allocated: { map: SessionMap; paneId: string }
): Promise<VerbOutcome> {
  const outcome = await openAndBind(ctx, command, allocated.paneId);
  if (outcome.exitCode !== 0) {
    saveSessionMap(ctx.workDir, removePane(allocated.map, allocated.paneId));
    return outcome;
  }
  await applyOptionalSplitSize(ctx, allocated.paneId, outcome);
  return outcome;
}

export async function splitWindow(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = parsePaneTarget(
    flagString(ctx.flags, "-t"),
    ctx.env.TMUX_PANE
  );
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const allocated = allocatePane(ctx.map, {
    panelId: binding.panelId,
    splitAxis: flagOn(ctx.flags, "-h") ? "horizontal" : "vertical",
    windowId: binding.windowId,
  });
  saveSessionMap(ctx.workDir, allocated.map);
  ctx.map = allocated.map;
  const command: JsonCommand = {
    type: "terminal.open",
    launch: paneLaunchFields(ctx, allocated.paneId),
    placement: flagOn(ctx.flags, "-h") ? "split-right" : "split-below",
    referencePanelId: binding.panelId,
    windowId: binding.windowId,
    focus: !flagOn(ctx.flags, "-d"),
  };
  return await openAllocated(ctx, command, allocated);
}

export async function newWindow(ctx: VerbContext): Promise<VerbOutcome> {
  const requested = parsePaneTarget(
    flagString(ctx.flags, "-t"),
    ctx.env.TMUX_PANE
  );
  const paneId =
    requested ??
    (ctx.env.PIER_PANEL_ID
      ? paneIdForPanel(ctx.map, ctx.env.PIER_PANEL_ID)
      : undefined) ??
    ctx.map.leaderPaneId;
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const allocated = allocatePane(ctx.map, {
    panelId: "pending",
    windowId: binding.windowId,
  });
  saveSessionMap(ctx.workDir, allocated.map);
  ctx.map = allocated.map;
  const command: JsonCommand = {
    type: "terminal.open",
    launch: paneLaunchFields(ctx, allocated.paneId),
    placement: "active-tab",
    referencePanelId: binding.panelId,
    windowId: binding.windowId,
    focus: !flagOn(ctx.flags, "-d"),
  };
  return await openAllocated(ctx, command, allocated);
}

export async function respawnPane(ctx: VerbContext): Promise<VerbOutcome> {
  if (!flagOn(ctx.flags, "-k")) {
    return fail("can't respawn pane in a live pane (use -k)");
  }
  const paneId = parsePaneTarget(
    flagString(ctx.flags, "-t"),
    ctx.env.TMUX_PANE
  );
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const command: JsonCommand = {
    type: "terminal.open",
    launch: paneLaunchFields(ctx, paneId),
    panelId: binding.panelId,
    windowId: binding.windowId,
    focus: false,
  };
  return await openAndBind(ctx, command, paneId);
}
