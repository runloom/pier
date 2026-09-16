import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fxIntegration } from "@main/services/agents/integrations/fx.ts";
import { createFxHerdrListener } from "@main/services/foreground-activity/fx-herdr-listener.ts";
import { action } from "./remaining-hosted-trace-helpers.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

function herdr(
  state: string,
  nativeEvent: string,
  eventName: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  customStatus?: string
): AgentStatusTraceAction {
  return action(nativeEvent, eventName, dimension, expected, {
    custom_status: customStatus ?? null,
    state,
  });
}

/**
 * fx Herdr socket 轨迹：producer 直连真实监听 socket，帧格式与
 * `src/builtins/hooks/herdr.zig` 的 wire 样本逐字节一致。
 */
export async function createFxHerdrProducer(): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-trace-"));
  const userData = join(root, "userData");
  const events: Record<string, unknown>[] = [];
  const listener = createFxHerdrListener({
    onAgentEvent: (event) => {
      events.push(event as unknown as Record<string, unknown>);
    },
    resolveOwner: (panelId) => ({ panelId, windowId: "w1" }),
    userData,
  });
  const consumed = { count: 0 };
  const socketPath = listener.env().HERDR_SOCKET_PATH ?? "";
  return {
    close: () => {
      listener.dispose();
      return rm(root, { force: true, recursive: true });
    },
    async run(action: AgentStatusTraceAction) {
      const payload = action.payload as {
        custom_status: string | null;
        state: string;
      };
      const socket = connect(socketPath);
      const replied = once(socket, "data");
      socket.setEncoding("utf8");
      const params: Record<string, unknown> = {
        agent: "fx",
        pane_id: "terminal-fx-1",
        source: "custom:fx",
        state: payload.state,
      };
      if (payload.custom_status) {
        params.custom_status = payload.custom_status;
      }
      socket.write(
        `${JSON.stringify({ id: "1", method: "pane.report_agent", params })}\n`
      );
      await replied;
      socket.end();
      const next = events.slice(consumed.count);
      consumed.count = events.length;
      if (next.length === 0) {
        throw new Error(`fx:${action.nativeEvent} 监听未收到事件`);
      }
      return next;
    },
  };
}

const fxActions: AgentStatusTraceAction[] = [
  herdr("working", "herdr.working", "processing", "processing", {
    expectedStatus: "processing",
  }),
  herdr(
    "blocked",
    "herdr.blocked.permission",
    "processing",
    "processing",
    { expectedStatus: "processing" },
    "permission"
  ),
  herdr("working", "herdr.working", "processing", "processing", {
    expectedStatus: "processing",
  }),
  herdr("idle", "herdr.idle", "ActivityIdle", "ready", {
    expectedStatus: "ready",
  }),
];

export const FX_HERDR_STATUS_TRACE = {
  actions: fxActions,
  agentId: "fx",
  covers: ["processing", "ready"],
  createProducer: createFxHerdrProducer,
  stopAuthority: fxIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
