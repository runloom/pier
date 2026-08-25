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
    // 确定性均分：每个 teammate 槽位显式设 1/N 高度（不依赖网格路径分析
    // 的 equalize——它在嵌套分支下会静默失败留下不均布局）。
    const others = Object.entries(ctx.map.panes)
      .filter(([paneId]) => paneId !== ctx.map.leaderPaneId)
      .map(([, pane]) => pane);
    const ratio = others.length > 0 ? 1 / others.length : 0;
    for (const pane of others) {
      const sized = await invokeTracked(ctx, {
        type: "panel.setSize",
        heightRatio: ratio,
        panelId: pane.panelId,
        windowId: pane.windowId,
      });
      if (!sized.ok) {
        return fail(resultErrorMessage(sized));
      }
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
