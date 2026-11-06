import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  allocatePane,
  loadSessionMap,
  paneIdForPanel,
  removePane,
  type SessionMap,
  type SessionPaneBinding,
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

function logOpenFailure(
  ctx: VerbContext,
  command: JsonCommand,
  paneId: string,
  message: string
): void {
  try {
    const dir = join(ctx.workDir, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "open-failures.jsonl"),
      `${JSON.stringify({
        ts: Date.now(),
        paneId,
        type: command.type,
        placement: command.placement,
        referencePanelId: command.referencePanelId,
        message,
      })}\n`
    );
  } catch {
    // 日志失败不影响主流程
  }
}

async function openAndBind(
  ctx: VerbContext,
  command: JsonCommand,
  paneId: string
): Promise<VerbOutcome> {
  const result = await invokeTracked(ctx, command);
  if (!result.ok) {
    const message = resultErrorMessage(result);
    logOpenFailure(ctx, command, paneId, message);
    return fail(message);
  }
  const data = resultDataRecord(result);
  const panelId =
    (typeof data?.panelId === "string" ? data.panelId : undefined) ??
    (typeof data?.id === "string" ? data.id : undefined);
  // terminal.open 返回宿主内部窗口 id（如 "main"）；绑定按宿主返回记录，
  // 避免 shim 自己维护第二套窗口词表。PIER_WINDOW_ID（Electron id）仅回退。
  const windowId =
    (typeof data?.windowId === "string" ? data.windowId : undefined) ??
    ctx.env.PIER_WINDOW_ID ??
    (typeof command.windowId === "string" ? command.windowId : undefined);
  if (!(panelId && windowId)) {
    const message = "terminal.open did not return panelId/windowId";
    logOpenFailure(
      ctx,
      command,
      paneId,
      `${message} data=${JSON.stringify(data)}`
    );
    return fail(message);
  }
  const previous = ctx.map.panes[paneId];
  // 绑定落盘前先并到磁盘最新版本：打开期间其它 shim 可能已刷新窗口或新增
  // pane，不能拿分配时的 ctx.map 整段覆盖。
  const latest = loadSessionMap(ctx.workDir, ctx.map.sessionId) ?? ctx.map;
  const map = {
    ...latest,
    panes: {
      ...latest.panes,
      [paneId]: {
        panelId,
        windowId,
        ...(previous?.splitAxis ? { splitAxis: previous.splitAxis } : {}),
      },
    },
  };
  try {
    saveSessionMap(ctx.workDir, map);
  } catch (err) {
    // 面板已经打开；map 只是适配索引，写盘失败不应把成功报告成失败。
    // 但磁盘上会残留分配时的占位绑定，必须留下可诊断记录。
    logOpenFailure(
      ctx,
      command,
      paneId,
      `session map save failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  ctx.map = map;
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

/**
 * 回收已分配但未成功打开的 pane；只删仍是本次占位的那条记录。
 * 以磁盘最新版本为底，保留其它 shim 在打开期间写入的 pane。
 */
function rollbackAllocation(
  ctx: VerbContext,
  paneId: string,
  placeholder: SessionPaneBinding | undefined
): void {
  if (!placeholder) {
    return;
  }
  // 打开失败未必走过 not_found 重试，ctx.map 可能还是分配时的快照：
  // 直接整段写回会丢掉并发 shim 在打开期间写入的 pane。
  const latest = loadSessionMap(ctx.workDir, ctx.map.sessionId) ?? ctx.map;
  ctx.map = latest;
  const current = latest.panes[paneId];
  if (current && current.panelId !== placeholder.panelId) {
    // 并发 shim 已把同一个 pane id 绑定到真实面板（打开成功），
    // 不能把它的绑定当成我们的占位删掉。
    return;
  }
  const map = removePane(latest, paneId);
  ctx.map = map;
  try {
    saveSessionMap(ctx.workDir, map);
  } catch {
    // 占位记录留给下一次探测清理；不能让它盖掉真正的打开错误。
  }
}

async function openAllocated(
  ctx: VerbContext,
  command: JsonCommand,
  allocated: { map: SessionMap; paneId: string }
): Promise<VerbOutcome> {
  const placeholder = allocated.map.panes[allocated.paneId];
  let outcome: VerbOutcome;
  try {
    outcome = await openAndBind(ctx, command, allocated.paneId);
  } catch (err) {
    // 首次 terminal.open 也可能超时 / 断链（不只是重试）：占位绑定必须回收，
    // 否则后续 send-keys -t %N 会把按键送到参照 pane。
    rollbackAllocation(ctx, allocated.paneId, placeholder);
    throw err;
  }
  if (outcome.exitCode !== 0) {
    // ctx.map 在 invokeTracked 重试后已按磁盘最新版本刷新；用分配时的快照回滚
    // 会把刚刷新的窗口 id 改回旧值，并丢掉其它 shim 并发写入的 pane。
    rollbackAllocation(ctx, allocated.paneId, placeholder);
    return outcome;
  }
  try {
    await applyOptionalSplitSize(ctx, allocated.paneId, outcome);
  } catch {
    // 尺寸是可选的：面板已打开并绑定，失败不应让整条命令失败。
  }
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
    backgroundCreate: true,
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
    backgroundCreate: true,
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
