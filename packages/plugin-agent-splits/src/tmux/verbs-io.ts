import { removePane, saveSessionMap } from "../main/session-map.ts";
import { flagOn, flagString, parsePaneTarget } from "./parse.ts";
import { resultDataRecord, resultErrorMessage } from "./types.ts";
import {
  fail,
  invokeTracked,
  mappedPanelIds,
  ok,
  requireBinding,
  type VerbContext,
  type VerbOutcome,
} from "./verb-context.ts";

const KEY_NAMES: Record<string, string> = {
  "^c": "ctrl-c",
  "c-[": "escape",
  "c-c": "ctrl-c",
  "c-i": "tab",
  "c-m": "enter",
  "ctrl+c": "ctrl-c",
  "ctrl-c": "ctrl-c",
  enter: "enter",
  esc: "escape",
  escape: "escape",
  kpenter: "enter",
  return: "enter",
  tab: "tab",
};

function specialKey(token: string): string | undefined {
  return KEY_NAMES[token.toLowerCase()];
}

function targetPane(ctx: VerbContext): string | undefined {
  return parsePaneTarget(flagString(ctx.flags, "-t"), ctx.env.TMUX_PANE);
}

export async function sendKeys(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const literal = flagOn(ctx.flags, "-l");
  let pending = "";
  const flushSend = async (): Promise<VerbOutcome | null> => {
    if (!pending) {
      return null;
    }
    const result = await invokeTracked(ctx, {
      type: "terminal.send",
      panelId: binding.panelId,
      text: pending,
      windowId: binding.windowId,
    });
    pending = "";
    if (!result.ok) {
      return fail(resultErrorMessage(result));
    }
    return null;
  };
  for (const token of ctx.rest) {
    const key = literal ? undefined : specialKey(token);
    if (key) {
      const sendFail = await flushSend();
      if (sendFail) {
        return sendFail;
      }
      const result = await invokeTracked(ctx, {
        type: "terminal.key",
        key,
        panelId: binding.panelId,
        windowId: binding.windowId,
      });
      if (!result.ok) {
        return fail(resultErrorMessage(result));
      }
      continue;
    }
    pending += token;
  }
  const sendFail = await flushSend();
  if (sendFail) {
    return sendFail;
  }
  return ok();
}

export async function capturePane(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  if (!flagOn(ctx.flags, "-p")) {
    return ok();
  }
  const result = await invokeTracked(ctx, {
    type: flagString(ctx.flags, "-S") ? "terminal.read" : "terminal.screen",
    panelId: binding.panelId,
    windowId: binding.windowId,
  });
  if (!result.ok) {
    return fail(resultErrorMessage(result));
  }
  const data = resultDataRecord(result);
  const text = typeof data?.text === "string" ? data.text : "";
  return ok(text.endsWith("\n") ? text : `${text}\n`);
}

export async function selectPane(ctx: VerbContext): Promise<VerbOutcome> {
  if (flagString(ctx.flags, "-T") !== undefined) {
    return ok();
  }
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const result = await invokeTracked(ctx, {
    type: "panel.focus",
    focus: true,
    panelId: binding.panelId,
    windowId: binding.windowId,
  });
  if (!result.ok) {
    return fail(resultErrorMessage(result));
  }
  return ok();
}

export async function killPane(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const result = await invokeTracked(ctx, {
    type: "terminal.close",
    panelId: binding.panelId,
    windowId: binding.windowId,
  });
  if (!result.ok) {
    return fail(resultErrorMessage(result));
  }
  const map = removePane(ctx.map, paneId);
  saveSessionMap(ctx.workDir, map);
  const remaining = mappedPanelIds(map);
  if (remaining.length >= 2 && binding.splitAxis) {
    const windowId = Object.values(map.panes)[0]?.windowId ?? binding.windowId;
    await invokeTracked(ctx, {
      axis: binding.splitAxis,
      panelIds: remaining,
      type: "panel.equalize",
      windowId,
    });
  }
  return ok("", map);
}
