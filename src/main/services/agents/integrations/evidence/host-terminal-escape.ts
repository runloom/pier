import { PIER_TERMINAL_USER_ESCAPE } from "../../terminal-escape-cancel.ts";
import type {
  AgentStatusEvidence,
  AgentStatusTransport,
} from "./matrix-types.ts";
import { fact } from "./matrix-types.ts";

export { PIER_TERMINAL_USER_ESCAPE } from "../../terminal-escape-cancel.ts";

/**
 * 宿主终端裸 Esc 取消：全局能力，不绑定某一 provider transcript。
 *
 * 运行时：`terminal-escape-cancel` 在任意 busy agent（processing/tool/running）
 * 上注入 `TurnInterrupted`；搜索/composer allowlist Escape 不观察。
 *
 * 矩阵：对「能进入 processing 的 active agent」统一挂 transport + 映射，
 * 避免在每个 matrix-rows 文件重复粘贴。
 */

export const HOST_TERMINAL_ESCAPE_TRANSPORT =
  "host-terminal-escape" as const satisfies AgentStatusTransport;

const HOST_ESCAPE_MAPPINGS = [
  fact("ready", "reconciled", PIER_TERMINAL_USER_ESCAPE, "TurnInterrupted"),
  fact(
    "interrupted",
    "reconciled",
    PIER_TERMINAL_USER_ESCAPE,
    "TurnInterrupted"
  ),
] as const;

export function withHostTerminalEscapeEvidence(
  row: AgentStatusEvidence
): AgentStatusEvidence {
  if (row.integration !== "active") {
    return row;
  }
  // 从未进入忙态的 agent 不会触发 host Esc 取消，不抬升能力面。
  if (row.evidence.processing === "unsupported") {
    return row;
  }

  const transport = row.transport.includes(HOST_TERMINAL_ESCAPE_TRANSPORT)
    ? row.transport
    : ([...row.transport, HOST_TERMINAL_ESCAPE_TRANSPORT] as const);

  const hasEscapeMapping = row.eventMappings.some(
    (entry) => entry.nativeEvent === PIER_TERMINAL_USER_ESCAPE
  );
  const eventMappings = hasEscapeMapping
    ? row.eventMappings
    : [...row.eventMappings, ...HOST_ESCAPE_MAPPINGS];

  return {
    ...row,
    transport,
    evidence: {
      ...row.evidence,
      // TurnInterrupted 投影为 ready；host 路径足以声明这两维至少 reconciled。
      ready:
        row.evidence.ready === "unsupported"
          ? "reconciled"
          : row.evidence.ready,
      interrupted:
        row.evidence.interrupted === "unsupported"
          ? "reconciled"
          : row.evidence.interrupted,
    },
    eventMappings,
  };
}
