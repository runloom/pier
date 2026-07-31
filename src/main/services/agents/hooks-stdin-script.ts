import { MAX_PROMPT_SNIPPET_LENGTH } from "@shared/agent-session-title/index.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "./hooks-title-script.ts";

/**
 * 构造纯 Node stdin 提取脚本。
 *
 * 默认模式维持历史 stdout base64(metadata) 协议；`--shell-fields` 模式在
 * 同一次顶层 JSON 解析中输出经过单引号转义的固定 shell 变量赋值。调用方只
 * eval 这份受管理脚本的固定变量名输出，payload 字符串不能逃逸引号。
 */
export function buildExtractStdinMetaScript(): string {
  return `#!/usr/bin/env node
// pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}
// Managed by Pier. Do not edit.
"use strict";
const MAX_SNIPPET = ${MAX_PROMPT_SNIPPET_LENGTH};
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const METADATA_KEYS = [
  "session_id",
  "sessionId",
  "turn_id",
  "turnId",
  "prompt_id",
  "generation_id",
  "generationId",
  "tool_use_id",
  "toolUseId",
  "tool_call_id",
  "toolCallId",
  "tool_name",
  "toolName",
  "agent_id",
  "agentId",
  "agent_type",
  "agentType",
  "transcript_path",
  "transcriptPath",
  "parent_session_id",
  "parentSessionId",
  "conversation_id",
  "conversationId",
  "task_id",
  "taskId",
  "subagent_id",
  "subagentId",
  "subagent_type",
  "subagentType",
  "parent_conversation_id",
  "parentConversationId",
  "parent_agent_id",
  "parentAgentId",
];
const FIXED_FIELD_GROUPS = [
  ["_pier_session_id", ["session_id", "sessionId", "conversation_id", "conversationId", "task_id", "taskId"]],
  ["_pier_turn_id", ["turn_id", "turnId"]],
  ["_pier_tool_use_id", ["tool_use_id", "toolUseId", "tool_call_id", "toolCallId"]],
  ["_pier_tool_name", ["tool_name", "toolName"]],
  ["_pier_agent_id", ["agent_id", "agentId"]],
  ["_pier_agent_type", ["agent_type", "agentType"]],
  ["_pier_transcript_path", ["transcript_path", "transcriptPath"]],
  ["_pier_parent_session_id", ["parent_session_id", "parentSessionId"]],
];
function ownString(payload, key) {
  return Object.hasOwn(payload, key) && typeof payload[key] === "string"
    ? payload[key]
    : undefined;
}
function ownScalar(payload, key) {
  if (!Object.hasOwn(payload, key)) return undefined;
  const value = payload[key];
  return typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
    ? String(value)
    : undefined;
}
function firstOwnString(payload, keys) {
  for (const key of keys) {
    const value = ownString(payload, key);
    if (value !== undefined) return value;
  }
  return "";
}
function firstOwnScalar(payload, keys) {
  for (const key of keys) {
    const value = ownScalar(payload, key);
    if (value !== undefined) return value;
  }
  return "";
}
function dynamicFields(raw) {
  return String(raw || "")
    .split(",")
    .filter((key) => SAFE_FIELD_NAME.test(key));
}
function dynamicPaths(raw) {
  return String(raw || "")
    .split(",")
    .map((path) => path.split("."))
    .filter(
      (segments) =>
        segments.length > 1 && segments.every((key) => SAFE_FIELD_NAME.test(key)),
    );
}
function firstOwnScalarAtPath(payload, paths) {
  for (const path of paths) {
    let current = payload;
    let found = true;
    for (const key of path) {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        !Object.hasOwn(current, key)
      ) {
        found = false;
        break;
      }
      current = current[key];
    }
    if (
      found &&
      (typeof current === "string" ||
        typeof current === "boolean" ||
        typeof current === "number")
    ) {
      return String(current);
    }
  }
  return "";
}
function metadataFrom(payload) {
  const metadata = {};
  for (const key of METADATA_KEYS) {
    const value = ownString(payload, key);
    if (value !== undefined) metadata[key] = value;
  }
  const prompt = firstOwnString(payload, [
    "prompt",
    "user_prompt",
    "content",
    "message",
  ]);
  if (prompt.trim()) {
    metadata.promptSnippet = prompt.slice(0, MAX_SNIPPET);
  }
  return metadata;
}
function shellQuote(value) {
  const quote = "'";
  const slash = String.fromCharCode(92);
  return quote + value.split(quote).join(quote + slash + quote + quote) + quote;
}
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      return;
    }
    const metadataBase64 = Buffer.from(
      JSON.stringify(metadataFrom(payload))
    ).toString("base64");
    if (process.argv[2] !== "--shell-fields") {
      process.stdout.write(metadataBase64);
      return;
    }
    const assignments = [
      ["_pier_metadata_b64", metadataBase64],
      ...FIXED_FIELD_GROUPS.map(([variable, keys]) => [
        variable,
        firstOwnString(payload, keys),
      ]),
      [
        "_pier_interaction_id",
        firstOwnString(payload, dynamicFields(process.argv[3])),
      ],
      [
        "_pier_native_state",
        firstOwnScalar(payload, dynamicFields(process.argv[4])) ||
          firstOwnScalarAtPath(payload, dynamicPaths(process.argv[6])),
      ],
      [
        "_pier_turn_id",
        firstOwnString(payload, [
          "turn_id",
          "turnId",
          ...dynamicFields(process.argv[5]),
        ]),
      ],
      [
        "_pier_agent_id",
        firstOwnString(payload, [
          "agent_id",
          "agentId",
          ...dynamicFields(process.argv[7]),
        ]),
      ],
      [
        "_pier_parent_session_id",
        firstOwnString(payload, [
          "parent_session_id",
          "parentSessionId",
          ...dynamicFields(process.argv[8]),
        ]),
      ],
      [
        "_pier_agent_type",
        firstOwnString(payload, [
          "agent_type",
          "agentType",
          ...dynamicFields(process.argv[9]),
        ]),
      ],
      [
        "_pier_tool_use_id",
        firstOwnString(payload, ["tool_use_id", "toolUseId", "tool_call_id", "toolCallId"]) ||
          firstOwnScalarAtPath(payload, dynamicPaths(process.argv[10])),
      ],
      [
        "_pier_tool_name",
        firstOwnString(payload, ["tool_name", "toolName"]) ||
          firstOwnScalarAtPath(payload, dynamicPaths(process.argv[11])),
      ],
    ];
    for (const [variable, value] of assignments) {
      process.stdout.write(variable + "=" + shellQuote(value) + "\\n");
    }
  } catch {
    // best-effort
  }
});
`;
}
