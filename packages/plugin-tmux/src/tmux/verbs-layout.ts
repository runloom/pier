import { flagString, parsePaneTarget, parsePercentRatio } from "./parse.ts";
import { resultErrorMessage } from "./types.ts";
import {
  fail,
  invokeTracked,
  mappedPanelIds,
  ok,
  requireBinding,
  type VerbContext,
  type VerbOutcome,
} from "./verb-context.ts";

function targetPane(ctx: VerbContext): string | undefined {
  return parsePaneTarget(flagString(ctx.flags, "-t"), ctx.env.TMUX_PANE);
}

export async function resizePane(ctx: VerbContext): Promise<VerbOutcome> {
  const paneId = targetPane(ctx);
  if (!paneId) {
    return fail("missing target pane");
  }
  const binding = requireBinding(ctx, paneId);
  if ("exitCode" in binding) {
    return binding;
  }
  const widthRatio = parsePercentRatio(flagString(ctx.flags, "-x"));
  const heightRatio = parsePercentRatio(flagString(ctx.flags, "-y"));
  if (widthRatio === undefined && heightRatio === undefined) {
    return ok();
  }
  const result = await invokeTracked(ctx, {
    type: "panel.setSize",
    panelId: binding.panelId,
    windowId: binding.windowId,
    ...(widthRatio === undefined ? {} : { widthRatio }),
    ...(heightRatio === undefined ? {} : { heightRatio }),
  });
  if (!result.ok) {
    return fail(resultErrorMessage(result));
  }
  return ok();
}

export async function selectLayout(ctx: VerbContext): Promise<VerbOutcome> {
  const layout = ctx.rest[0] ?? "";
  const panelIds = mappedPanelIds(ctx.map);
  const windowId =
    Object.values(ctx.map.panes)[0]?.windowId ?? ctx.env.PIER_WINDOW_ID;
  if (!(windowId && panelIds.length > 0)) {
    return ok();
  }
  if (layout === "even-horizontal") {
    const result = await invokeTracked(ctx, {
      axis: "horizontal",
      panelIds,
      type: "panel.equalize",
      windowId,
    });
    return result.ok ? ok() : fail(resultErrorMessage(result));
  }
  if (layout === "even-vertical") {
    const result = await invokeTracked(ctx, {
      axis: "vertical",
      panelIds,
      type: "panel.equalize",
      windowId,
    });
    return result.ok ? ok() : fail(resultErrorMessage(result));
  }
  if (layout === "main-vertical") {
    const leader = ctx.map.panes[ctx.map.leaderPaneId];
    if (leader) {
      const sized = await invokeTracked(ctx, {
        type: "panel.setSize",
        panelId: leader.panelId,
        widthRatio: 0.3,
        windowId: leader.windowId,
      });
      if (!sized.ok) {
        return fail(resultErrorMessage(sized));
      }
    }
    const others = Object.entries(ctx.map.panes)
      .filter(([paneId]) => paneId !== ctx.map.leaderPaneId)
      .map(([, pane]) => pane.panelId);
    if (others.length >= 2) {
      await invokeTracked(ctx, {
        axis: "vertical",
        panelIds: others,
        type: "panel.equalize",
        windowId,
      });
    }
    return ok();
  }
  if (layout === "tiled") {
    await invokeTracked(ctx, {
      axis: "horizontal",
      panelIds,
      type: "panel.equalize",
      windowId,
    });
    await invokeTracked(ctx, {
      axis: "vertical",
      panelIds,
      type: "panel.equalize",
      windowId,
    });
    return ok();
  }
  return fail(`unsupported layout: ${layout || "(none)"}`);
}
