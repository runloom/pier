import { existsSync } from "node:fs";
import { readFile, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import * as hermesConfig from "./hermes-config.ts";
import { pierManagedPluginMarker } from "./managed-plugin-file.ts";
import {
  type ManagedPluginGroupFile,
  ownedManagedPluginGroupPaths,
  writeManagedPluginGroup,
} from "./managed-plugin-group.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "hermes";
const PLUGIN_NAME = "pier-status";
const MARKER = pierManagedPluginMarker();

/** 固定提交 cbecd72 的原生事实到规范事件映射。 */
const HERMES_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> =
  [
    { nativeEvent: "on_session_start", pierEvent: "SessionStart" },
    { nativeEvent: "pre_llm_call", pierEvent: "PromptSubmit" },
    { nativeEvent: "pre_tool_call", pierEvent: "ToolStart" },
    {
      nativeEvent: "pre_tool_call.clarify",
      pierEvent: "InteractionRequested",
    },
    { nativeEvent: "post_tool_call", pierEvent: "ToolComplete" },
    {
      nativeEvent: "post_tool_call.clarify",
      pierEvent: "InteractionResolved",
    },
    {
      nativeEvent: "pre_approval_request",
      pierEvent: "InteractionRequested",
    },
    {
      nativeEvent: "post_approval_response",
      pierEvent: "InteractionResolved",
    },
    {
      nativeEvent: "on_session_end.completed",
      pierEvent: "TurnCompleted",
    },
    { nativeEvent: "on_session_end.failed", pierEvent: "error" },
    {
      nativeEvent: "on_session_end.interrupted",
      pierEvent: "TurnInterrupted",
    },
    { nativeEvent: "on_session_finalize", pierEvent: "SessionEnd" },
    { nativeEvent: "on_session_reset", pierEvent: "SessionStart" },
    { nativeEvent: "subagent_start", pierEvent: "SubagentStart" },
    { nativeEvent: "subagent_stop", pierEvent: "SubagentStop" },
  ];

const HERMES_HOOK_NAMES = [
  "on_session_start",
  "pre_llm_call",
  "pre_tool_call",
  "post_tool_call",
  "pre_approval_request",
  "post_approval_response",
  "on_session_end",
  "on_session_finalize",
  "on_session_reset",
  "subagent_start",
  "subagent_stop",
] as const;

export function hermesHome(): string {
  const raw = (process.env.HERMES_HOME ?? "").trim();
  return raw.length > 0 ? raw : join(homedir(), ".hermes");
}

export function hermesConfigPath(): string {
  return join(hermesHome(), "config.yaml");
}

export function hermesPluginDir(): string {
  return join(hermesHome(), "plugins", PLUGIN_NAME);
}

export function hermesManifestPath(): string {
  return join(hermesPluginDir(), "plugin.yaml");
}

export function hermesInitPath(): string {
  return join(hermesPluginDir(), "__init__.py");
}

export function hermesDetect(): boolean {
  return existsSync(hermesHome()) || commandExistsOnPath("hermes");
}

export function buildHermesPluginManifest(): string {
  const eventLines = HERMES_HOOK_NAMES.map((event) => `  - ${event}`).join(
    "\n"
  );
  return `# ${MARKER}
name: ${PLUGIN_NAME}
version: 1.0.0
description: "Reports Hermes agent lifecycle events to Pier."
author: "Pier"
kind: standalone
provides_hooks:
${eventLines}
`;
}

/**
 * Python 插件入口。emit 内嵌：`os.environ` 读三个 PIER_ 变量, 缺任一静默
 * no-op；`open(..., "a")` append 写 JSONL, except 吞异常
 * （payload 精简为 pier v1 agentEvent schema）。
 * POSIX 保证 <4KB append 原子。
 */
export function buildHermesPluginInit(): string {
  const eventNames = HERMES_HOOK_NAMES.map((event) => `"${event}"`).join(", ");
  return `# ${MARKER}
from __future__ import annotations

import json
import os
import time
from typing import Any, Callable

EVENTS = (${eventNames})

EVENT_MAP = {
    "on_session_start": "SessionStart",
    "pre_llm_call": "PromptSubmit",
    "pre_tool_call": "ToolStart",
    "post_tool_call": "ToolComplete",
    "on_session_finalize": "SessionEnd",
    "on_session_reset": "SessionStart",
    "subagent_start": "SubagentStart",
    "subagent_stop": "SubagentStop",
}


def _pier_string(value: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def _pier_emit(
    pier_event: str,
    native_event: str,
    payload: dict[str, Any],
    *,
    interaction_kind: str | None = None,
    interaction_outcome: str | None = None,
    native_state: str | None = None,
) -> None:
    log = os.environ.get("PIER_AGENT_EVENT_LOG", "")
    panel_id = os.environ.get("PIER_PANEL_ID", "")
    window_id = os.environ.get("PIER_WINDOW_ID", "")
    if not log or not panel_id or not window_id:
        return
    body = {
        "v": 3,
        "kind": "agentEvent",
        "ts": int(time.time_ns()),
        "panelId": panel_id,
        "windowId": window_id,
        "pid": os.getpid(),
        "agent": "hermes",
        "event": pier_event,
        "nativeEvent": native_event,
    }
    session_id = _pier_string(
        payload,
        "session_id",
        "sessionId",
        "sessionID",
        "session_key",
        "child_session_id",
    )
    if session_id:
        body["sessionId"] = session_id
    turn_id = _pier_string(payload, "turn_id", "parent_turn_id", "task_id")
    if turn_id:
        body["turnId"] = turn_id
    tool_use_id = _pier_string(payload, "tool_call_id")
    if tool_use_id:
        body["toolUseId"] = tool_use_id
    tool_name = _pier_string(payload, "tool_name")
    if tool_name:
        body["toolName"] = tool_name
    parent_session_id = _pier_string(payload, "parent_session_id")
    if parent_session_id:
        body["parentSessionId"] = parent_session_id
    if native_event in ("subagent_start", "subagent_stop"):
        body["actorHint"] = "subagent"
        # cbecd72 tools/delegate_tool.py 的真实 start/stop 调用点都从同一个
        # child.session_id 传入 child_session_id；child_subagent_id 只在
        # start 出现，不能作为双方关联键。
        child_session_id = _pier_string(payload, "child_session_id")
        if child_session_id:
            body["agentInstanceId"] = child_session_id
        child_role = _pier_string(payload, "child_role")
        if child_role:
            body["agentType"] = child_role
    if pier_event == "PromptSubmit":
        prompt = _pier_string(payload, "user_message")
        if prompt:
            body["promptSnippet"] = prompt[:512]
    interaction_id = _pier_string(payload, "pattern_key", "tool_call_id")
    if interaction_kind:
        body["interactionKind"] = interaction_kind
        if interaction_id:
            body["interactionId"] = interaction_id
    if interaction_outcome:
        body["interactionOutcome"] = interaction_outcome
    if native_state:
        body["nativeState"] = native_state
    line = json.dumps(body) + "\\n"
    lock = log + ".lock"
    token = f"{os.getpid()}.{time.time_ns()}"
    candidate = lock + "." + token
    try:
        with open(candidate, "x", encoding="ascii") as fp:
            fp.write(token)
    except OSError:
        return
    acquired = False
    for _ in range(500):
        try:
            os.link(candidate, lock)
            acquired = True
            break
        except FileExistsError:
            time.sleep(0.01)
        except OSError:
            return
    try:
        os.remove(candidate)
    except OSError:
        pass
    if not acquired:
        return
    try:
        with open(log, "a", encoding="utf-8") as fp:
            fp.write(line)
    except OSError:
        pass
    finally:
        try:
            with open(lock, encoding="ascii") as fp:
                if fp.read() == token:
                    os.remove(lock)
        except OSError:
            pass


def _pier_approval_outcome(choice: Any) -> tuple[str, str]:
    if choice in ("once", "session", "always", "smart_approve"):
        return ("accepted", str(choice))
    if choice in ("deny", "smart_deny"):
        return ("rejected", str(choice))
    if choice == "timeout":
        return ("cancelled", "timeout")
    return ("unknown", str(choice or "unknown"))


def _make_hook(event_name: str) -> Callable[..., None]:

    def _hook(**kwargs: Any) -> None:
        if event_name == "pre_tool_call" and kwargs.get("tool_name") == "clarify":
            _pier_emit(
                "InteractionRequested",
                "pre_tool_call.clarify",
                kwargs,
                interaction_kind="question",
            )
            return
        if event_name == "post_tool_call" and kwargs.get("tool_name") == "clarify":
            state = str(kwargs.get("status") or "unknown")
            outcome = "completed" if state == "ok" else "failed"
            _pier_emit(
                "InteractionResolved",
                "post_tool_call.clarify",
                kwargs,
                interaction_kind="question",
                interaction_outcome=outcome,
                native_state=state,
            )
            return
        if event_name == "pre_approval_request":
            _pier_emit(
                "InteractionRequested",
                event_name,
                kwargs,
                interaction_kind="permission",
            )
            return
        if event_name == "post_approval_response":
            outcome, state = _pier_approval_outcome(kwargs.get("choice"))
            _pier_emit(
                "InteractionResolved",
                event_name,
                kwargs,
                interaction_kind="permission",
                interaction_outcome=outcome,
                native_state=state,
            )
            return
        if event_name == "on_session_end":
            if kwargs.get("failed") is True:
                _pier_emit("error", "on_session_end.failed", kwargs)
            elif kwargs.get("interrupted") is True:
                _pier_emit(
                    "TurnInterrupted", "on_session_end.interrupted", kwargs
                )
            elif kwargs.get("completed") is True:
                _pier_emit("TurnCompleted", "on_session_end.completed", kwargs)
            return
        pier_event = EVENT_MAP[event_name]
        native_state = (
            str(kwargs.get("status") or "unknown")
            if event_name == "post_tool_call"
            else None
        )
        _pier_emit(
            pier_event,
            event_name,
            kwargs,
            native_state=native_state,
        )

    return _hook


def register(ctx: Any) -> None:
    for event_name in EVENTS:
        ctx.register_hook(event_name, _make_hook(event_name))
`;
}

function hermesPluginFiles(): ManagedPluginGroupFile[] {
  return [
    {
      label: AGENT_ID,
      path: hermesManifestPath(),
      source: buildHermesPluginManifest(),
    },
    {
      label: AGENT_ID,
      path: hermesInitPath(),
      source: buildHermesPluginInit(),
    },
  ];
}

export {
  withHermesPluginEnabled,
  withoutHermesPluginEnabled,
} from "./hermes-config.ts";

async function readConfigRaw(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function installHermesPlugin(
  configPath: string = hermesConfigPath()
): Promise<void> {
  if (!hermesDetect()) {
    return;
  }
  const raw = await readConfigRaw(configPath);
  const next = hermesConfig.withHermesPluginEnabled(raw);
  if (next === null) {
    console.warn(
      "[agent-hooks:hermes] plugins.enabled has unrecognized structure, skip install to avoid corrupting config.yaml:",
      configPath
    );
    return;
  }
  const pluginsOk = await writeManagedPluginGroup(hermesPluginFiles());
  if (!pluginsOk) {
    // 更高世代或非托管插件文件：不写 plugins.enabled，避免混世代半启用。
    return;
  }
  if (next !== raw) {
    await atomicWriteFile(configPath, next);
  }
}

export async function uninstallHermesPlugin(
  configPath: string = hermesConfigPath()
): Promise<void> {
  const ownedPaths = await ownedManagedPluginGroupPaths(hermesPluginFiles());
  if (!ownedPaths) {
    return;
  }
  for (const path of ownedPaths) {
    await rm(path, { force: true });
  }
  await rmdir(hermesPluginDir()).catch(() => undefined);
  const raw = await readConfigRaw(configPath);
  if (!hermesConfig.hasTopLevelHermesPluginsKey(raw)) {
    return;
  }
  const next = hermesConfig.withoutHermesPluginEnabled(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export const hermesIntegration: AgentHookIntegration = {
  detect: hermesDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: HERMES_EVENTS,
    stopAuthority: "none",
  },
  install: () => installHermesPlugin(),
  uninstall: () => uninstallHermesPlugin(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const HERMES_EVENT_MAP = HERMES_EVENTS;

/** marker / 插件名常量导出（测试断言用）。 */
export const HERMES_MARKER = MARKER;
export const HERMES_PLUGIN_NAME = PLUGIN_NAME;
