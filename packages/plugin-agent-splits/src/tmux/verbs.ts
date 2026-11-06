import {
  bindLeaderSession,
  loadSessionMap,
  parseTmuxValue,
  type SessionMap,
  saveSessionMap,
  sessionFileExpired,
} from "../main/session-map.ts";
import { parseTmuxArgv } from "./parse.ts";
import {
  type ControlResult,
  type JsonCommand,
  type RunTmuxResult,
  type TmuxRuntime,
  windowIdFromResult,
} from "./types.ts";
import {
  rebindPanelWindow,
  type VerbContext,
  type VerbOutcome,
} from "./verb-context.ts";
import { capturePane, killPane, selectPane, sendKeys } from "./verbs-io.ts";
import { resizePane, selectLayout } from "./verbs-layout.ts";
import { displayMessage, listPanes, listWindows } from "./verbs-list.ts";
import { newWindow, respawnPane, splitWindow } from "./verbs-open.ts";
import { runWaitFor } from "./wait-for.ts";

export const TMUX_VERSION_LINE = "tmux 3.4\n";

const REJECTED = new Set([
  "attach",
  "attach-session",
  "bind-key",
  "source-file",
]);

const LOCAL_NOOP = new Set([
  "rename-window",
  "set",
  "set-option",
  "set-window-option",
  "setw",
]);

const HOST_VERBS = new Set([
  "capture-pane",
  "display-message",
  "kill-pane",
  "kill-window",
  "list-panes",
  "list-windows",
  "new-session",
  "new-window",
  "respawn-pane",
  "resize-pane",
  "select-layout",
  "select-pane",
  "select-window",
  "send-keys",
  "split-window",
]);

type LeaderProbe = "alive" | "missing" | "unknown";

interface PaneProbe {
  status: LeaderProbe;
  /** 宿主回报的当前内部窗口 id；面板跨窗移动后用它刷新绑定。 */
  windowId?: string | undefined;
}

async function invokeGet(
  invoke: (command: JsonCommand) => Promise<ControlResult>,
  commands: JsonCommand[],
  panelId: string,
  windowId: string | undefined
): Promise<ControlResult | null> {
  const command: JsonCommand = {
    type: "terminal.get",
    panelId,
    ...(windowId ? { windowId } : {}),
  };
  commands.push(command);
  try {
    return await invoke(command);
  } catch {
    // 控制通道超时 / socket 错误：结果未知，不能当 pane 已死。
    return null;
  }
}

async function probePane(
  invoke: (command: JsonCommand) => Promise<ControlResult>,
  commands: JsonCommand[],
  binding: SessionMap["panes"][string]
): Promise<PaneProbe> {
  const scoped = await invokeGet(
    invoke,
    commands,
    binding.panelId,
    binding.windowId
  );
  if (!scoped) {
    return { status: "unknown" };
  }
  if (scoped.ok) {
    return { status: "alive", windowId: windowIdFromResult(scoped) };
  }
  // 只有宿主明确回报 not_found 才继续核对；通信失败 / 宿主忙碌等未知结果
  // 不能当死亡：按整份 map 重建会丢掉仍存活子 pane 的绑定。
  if (scoped.error.code !== "not_found") {
    return { status: "unknown" };
  }
  // 绑定里的窗口可能是创建时位置：不带 windowId 再查当前位置，面板跨窗
  // 移动后仍算存活，并回填宿主返回的内部窗口 id。
  const anywhere = await invokeGet(
    invoke,
    commands,
    binding.panelId,
    undefined
  );
  if (!anywhere) {
    return { status: "unknown" };
  }
  if (anywhere.ok) {
    return { status: "alive", windowId: windowIdFromResult(anywhere) };
  }
  return {
    status: anywhere.error.code === "not_found" ? "missing" : "unknown",
  };
}

async function probeLeader(
  invoke: (command: JsonCommand) => Promise<ControlResult>,
  commands: JsonCommand[],
  map: SessionMap
): Promise<PaneProbe> {
  const leader = map.panes[map.leaderPaneId];
  if (!leader) {
    return { status: "missing" };
  }
  return await probePane(invoke, commands, leader);
}

/**
 * 逐 pane 核对：只清理宿主明确回报 not_found 的记录，保留仍存活 /
 * 结果未知的 pane。全部消失才返回 null 交给重建。
 * - `skipLeader`：调用方已确认 leader 不存在，不再重复探测。
 * - `createdAt`：TTL 过期但仍有存活 pane 时刷新会话寿命。
 */
async function retainLivePanes(
  invoke: (command: JsonCommand) => Promise<ControlResult>,
  commands: JsonCommand[],
  map: SessionMap,
  options: { createdAt?: number; skipLeader?: boolean } = {}
): Promise<SessionMap | null> {
  const probed = await Promise.all(
    Object.entries(map.panes)
      .filter(
        ([paneId]) => !(options.skipLeader && paneId === map.leaderPaneId)
      )
      .map(async ([paneId, binding]) => ({
        binding,
        paneId,
        probe: await probePane(invoke, commands, binding),
      }))
  );
  const panes: SessionMap["panes"] = {};
  const alivePaneIds: string[] = [];
  for (const { paneId, binding, probe } of probed) {
    if (probe.status === "missing") {
      continue;
    }
    if (probe.status === "alive") {
      alivePaneIds.push(paneId);
    }
    panes[paneId] =
      probe.windowId && probe.windowId !== binding.windowId
        ? { ...binding, windowId: probe.windowId }
        : binding;
  }
  // leader 已确认消失时优先提升确认存活的面板；只有全部探测失败时才退回
  // 第一个保留项，避免把会话本身丢掉。
  const leaderPaneId = panes[map.leaderPaneId]
    ? map.leaderPaneId
    : (alivePaneIds[0] ?? Object.keys(panes)[0]);
  if (!leaderPaneId) {
    return null;
  }
  return {
    ...map,
    ...(options.createdAt === undefined
      ? {}
      : { createdAt: options.createdAt }),
    leaderPaneId,
    panes,
  };
}

/** 缓存维护写盘失败不应阻断本次只读命令；下一条命令会重新核对。 */
function saveCacheMap(workDir: string, map: SessionMap): void {
  try {
    saveSessionMap(workDir, map);
  } catch {
    // 磁盘版本留待下次核对，内存结果仍可继续使用。
  }
}

async function resolveMap(
  runtime: TmuxRuntime,
  commands: JsonCommand[]
): Promise<{ map: SessionMap; workDir: string } | RunTmuxResult> {
  const parsed = runtime.env.TMUX ? parseTmuxValue(runtime.env.TMUX) : null;
  if (!parsed) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  const { sessionId, workDir } = parsed;
  const now = runtime.now ?? Date.now();
  const existing = loadSessionMap(workDir, sessionId);
  const expired = sessionFileExpired(workDir, sessionId, now);
  if (existing) {
    if (expired) {
      // TTL 过期不等于 pane 已死：先核对，仍有存活 / 未知结果就续期。
      const retained = await retainLivePanes(
        runtime.invoke,
        commands,
        existing,
        {
          createdAt: now,
        }
      );
      if (retained) {
        saveCacheMap(workDir, retained);
        return { map: retained, workDir };
      }
    } else {
      const leaderProbe = await probeLeader(runtime.invoke, commands, existing);
      if (leaderProbe.status !== "missing") {
        const leader = existing.panes[existing.leaderPaneId];
        if (
          leader &&
          leaderProbe.windowId &&
          leaderProbe.windowId !== leader.windowId
        ) {
          // 面板跨窗移动：绑定写回宿主当前内部窗口 id。以磁盘最新版本为底，
          // 避免覆盖探测期间其它 shim 新绑定的 pane；位置刷新是缓存维护，
          // 写盘失败不应让本次只读命令失去输出。
          const latest = loadSessionMap(workDir, sessionId) ?? existing;
          const rebound = rebindPanelWindow(
            latest,
            leader.panelId,
            leaderProbe.windowId
          );
          if (rebound.changed) {
            saveCacheMap(workDir, rebound.map);
          }
          return { map: rebound.map, workDir };
        }
        return { map: existing, workDir };
      }
      const pruned = await retainLivePanes(runtime.invoke, commands, existing, {
        skipLeader: true,
      });
      if (pruned) {
        saveCacheMap(workDir, pruned);
        return { map: pruned, workDir };
      }
    }
  }
  const panelId = runtime.env.PIER_PANEL_ID;
  const windowId = runtime.env.PIER_WINDOW_ID;
  if (!(panelId && windowId)) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  // 重建会话时也向宿主确认该面板当前所在的内部窗口 id：PIER_WINDOW_ID 是
  // Electron 词表，若直接落盘会和 openAndBind 写入的内部 id 混用两套词表。
  // sessionId 仍由 env 词表派生（必须与调用方 TMUX 里的 sock 名一致）。
  const probe = await probePane(runtime.invoke, commands, {
    panelId,
    windowId,
  });
  const bound = bindLeaderSession({ panelId, windowId, workDir });
  const currentWindowId = probe.windowId;
  const leaderBinding = bound.map.panes[bound.map.leaderPaneId];
  if (leaderBinding && currentWindowId && currentWindowId !== windowId) {
    const map: SessionMap = {
      ...bound.map,
      panes: {
        ...bound.map.panes,
        [bound.map.leaderPaneId]: {
          ...leaderBinding,
          windowId: currentWindowId,
        },
      },
    };
    // 只刷新缓存里的窗口 id；bindLeaderSession 已建好会话，写盘失败不阻断本次命令。
    saveCacheMap(workDir, map);
    return { map, workDir };
  }
  return { map: bound.map, workDir };
}

async function dispatchVerb(
  verb: string,
  ctx: VerbContext
): Promise<VerbOutcome> {
  if (REJECTED.has(verb)) {
    return {
      exitCode: 1,
      stderr: `unsupported command: ${verb}\n`,
      stdout: "",
    };
  }
  switch (verb) {
    case "split-window":
      return await splitWindow(ctx);
    case "new-window":
    case "new-session":
      return await newWindow(ctx);
    case "respawn-pane":
      return await respawnPane(ctx);
    case "send-keys":
      return await sendKeys(ctx);
    case "capture-pane":
      return await capturePane(ctx);
    case "select-pane":
    case "select-window":
      return await selectPane(ctx);
    case "kill-pane":
    case "kill-window":
      return await killPane(ctx);
    case "list-panes":
      return await listPanes(ctx);
    case "list-windows":
      return await listWindows(ctx);
    case "resize-pane":
      return await resizePane(ctx);
    case "select-layout":
      return await selectLayout(ctx);
    case "display-message":
      return await displayMessage(ctx);
    default:
      return {
        exitCode: 1,
        stderr: `unknown command: ${verb}\n`,
        stdout: "",
      };
  }
}

export async function runTmux(
  argv: string[],
  runtime: TmuxRuntime
): Promise<RunTmuxResult> {
  const commands: JsonCommand[] = [];
  const parsed = parseTmuxArgv(argv);
  if (parsed.kind === "version") {
    return { commands, exitCode: 0, stderr: "", stdout: TMUX_VERSION_LINE };
  }
  if (parsed.kind === "error") {
    return {
      commands,
      exitCode: parsed.exitCode,
      stderr: `${parsed.message}\n`,
      stdout: "",
    };
  }
  if (!(runtime.env.TMUX && runtime.env.PIER_CONTROL_SOCKET)) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  if (LOCAL_NOOP.has(parsed.verb)) {
    return { commands, exitCode: 0, stderr: "", stdout: "" };
  }
  if (parsed.verb === "has-session") {
    return { commands, exitCode: 0, stderr: "", stdout: "" };
  }
  if (parsed.verb === "list-sessions") {
    const session = parseTmuxValue(runtime.env.TMUX ?? "");
    const name = session?.sessionId ?? "default";
    return {
      commands,
      exitCode: 0,
      stderr: "",
      stdout: `${name}: 1 windows\n`,
    };
  }
  if (parsed.verb === "wait-for") {
    return await runWaitFor(parsed, runtime, commands);
  }
  if (REJECTED.has(parsed.verb)) {
    return {
      commands,
      exitCode: 1,
      stderr: `unsupported command: ${parsed.verb}\n`,
      stdout: "",
    };
  }
  if (!HOST_VERBS.has(parsed.verb)) {
    return {
      commands,
      exitCode: 1,
      stderr: `unknown command: ${parsed.verb}\n`,
      stdout: "",
    };
  }
  let resolved: Awaited<ReturnType<typeof resolveMap>>;
  try {
    resolved = await resolveMap(runtime, commands);
  } catch (err) {
    return {
      commands,
      exitCode: 1,
      stderr: `${err instanceof Error ? err.message : String(err)}\n`,
      stdout: "",
    };
  }
  if ("exitCode" in resolved) {
    return resolved;
  }
  const ctx: VerbContext = {
    commands,
    cwd: runtime.cwd,
    env: runtime.env,
    flags: parsed.flags,
    invoke: runtime.invoke,
    map: resolved.map,
    rest: parsed.rest,
    workDir: resolved.workDir,
  };
  try {
    const outcome = await dispatchVerb(parsed.verb, ctx);
    return {
      commands,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
    };
  } catch (err) {
    return {
      commands,
      exitCode: 1,
      stderr: `${err instanceof Error ? err.message : String(err)}\n`,
      stdout: "",
    };
  }
}
