import type { SessionMap } from "../main/session-map.ts";
import { applyTmuxFormat, paneFormatVars } from "./format.ts";
import { flagOn, flagString, parsePaneTarget } from "./parse.ts";
import { isRecord, resultDataRecord, windowIdFromResult } from "./types.ts";
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

interface PaneLocation {
  path: string;
  windowId: string;
}

/**
 * 读取 pane 的宿主侧路径。invokeTracked 在面板跨窗移动后会回填 ctx.map，
 * 所以这里同时返回最新绑定窗口，调用方不能再使用调用前的 binding。
 */
async function locatePane(
  ctx: VerbContext,
  paneId: string,
  binding: SessionMap["panes"][string]
): Promise<PaneLocation> {
  const result = await invokeTracked(ctx, {
    type: "terminal.get",
    panelId: binding.panelId,
    windowId: binding.windowId,
  });
  const data = resultDataRecord(result);
  const terminal = data && isRecord(data.terminal) ? data.terminal : data;
  // 宿主回报的窗口 id 已归一化为内部 id；命令成功时也优先采用，否则
  // 升级前写入的 Electron id 绑定会让同一窗口在输出里出现两次。
  return {
    path:
      terminal && typeof terminal.canonicalPath === "string"
        ? terminal.canonicalPath
        : "",
    windowId:
      windowIdFromResult(result) ??
      ctx.map.panes[paneId]?.windowId ??
      binding.windowId,
  };
}

export async function listPanes(ctx: VerbContext): Promise<VerbOutcome> {
  const template = flagString(ctx.flags, "-F") ?? "#{pane_id}";
  const lines: string[] = [];
  for (const [paneId, binding] of Object.entries(ctx.map.panes)) {
    const { path, windowId } = await locatePane(ctx, paneId, binding);
    lines.push(
      applyTmuxFormat(template, paneFormatVars({ paneId, path, windowId }))
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
    const { path, windowId } = await locatePane(ctx, paneId, binding);
    if (seen.has(windowId)) {
      continue;
    }
    seen.add(windowId);
    lines.push(
      applyTmuxFormat(template, paneFormatVars({ paneId, path, windowId }))
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
  const { path, windowId } = await locatePane(ctx, paneId, binding);
  const text = applyTmuxFormat(
    template,
    paneFormatVars({ paneId, path, windowId })
  );
  if (
    !(flagOn(ctx.flags, "-p") || flagString(ctx.flags, "-F") || ctx.rest[0])
  ) {
    return ok();
  }
  return ok(`${text}\n`);
}
