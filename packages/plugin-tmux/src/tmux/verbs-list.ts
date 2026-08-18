import { applyTmuxFormat, paneFormatVars } from "./format.ts";
import { flagOn, flagString, parsePaneTarget } from "./parse.ts";
import { isRecord, resultDataRecord } from "./types.ts";
import {
  fail,
  invokeTracked,
  ok,
  requireBinding,
  type VerbContext,
  type VerbOutcome,
} from "./verb-context.ts";

function targetPane(ctx: VerbContext): string | undefined {
  return parsePaneTarget(flagString(ctx.flags, "-t"), ctx.env.TMUX_PANE);
}

async function pathForPane(
  ctx: VerbContext,
  panelId: string,
  windowId: string
): Promise<string> {
  const result = await invokeTracked(ctx, {
    type: "terminal.get",
    panelId,
    windowId,
  });
  const data = resultDataRecord(result);
  const terminal = data && isRecord(data.terminal) ? data.terminal : data;
  if (terminal && typeof terminal.canonicalPath === "string") {
    return terminal.canonicalPath;
  }
  return "";
}

export async function listPanes(ctx: VerbContext): Promise<VerbOutcome> {
  const template = flagString(ctx.flags, "-F") ?? "#{pane_id}";
  const lines: string[] = [];
  for (const [paneId, binding] of Object.entries(ctx.map.panes)) {
    const path = await pathForPane(ctx, binding.panelId, binding.windowId);
    lines.push(
      applyTmuxFormat(
        template,
        paneFormatVars({ paneId, path, windowId: binding.windowId })
      )
    );
  }
  const stdout = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  return ok(stdout);
}

export async function listWindows(ctx: VerbContext): Promise<VerbOutcome> {
  const template = flagString(ctx.flags, "-F") ?? "#{window_id}";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const [paneId, binding] of Object.entries(ctx.map.panes)) {
    if (seen.has(binding.windowId)) {
      continue;
    }
    seen.add(binding.windowId);
    const path = await pathForPane(ctx, binding.panelId, binding.windowId);
    lines.push(
      applyTmuxFormat(
        template,
        paneFormatVars({ paneId, path, windowId: binding.windowId })
      )
    );
  }
  const stdout = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  return ok(stdout);
}

export async function displayMessage(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const template = flagString(ctx.flags, "-F") ?? ctx.rest[0] ?? "#{pane_id}";
  const path = await pathForPane(ctx, binding.panelId, binding.windowId);
  const text = applyTmuxFormat(
    template,
    paneFormatVars({ paneId, path, windowId: binding.windowId })
  );
  if (
    !(flagOn(ctx.flags, "-p") || flagString(ctx.flags, "-F") || ctx.rest[0])
  ) {
    return ok();
  }
  return ok(`${text}\n`);
}
