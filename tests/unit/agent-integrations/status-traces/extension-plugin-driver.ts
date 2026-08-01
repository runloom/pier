import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

type Handler = (event: unknown, context: unknown) => void;

export async function createExtensionPluginProducer(
  agentId: "omp" | "pi",
  source: string
): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(
    join(tmpdir(), `pier-${agentId}-extension-trace-`)
  );
  const logPath = join(root, "events.jsonl");
  const previous = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panel: process.env.PIER_PANEL_ID,
    window: process.env.PIER_WINDOW_ID,
  };
  process.env.PIER_AGENT_EVENT_LOG = logPath;
  process.env.PIER_PANEL_ID = "p1";
  process.env.PIER_WINDOW_ID = "w1";
  const moduleShim: { exports?: (host: unknown) => void } = {};
  new Function(
    "module",
    source.replace(
      "export default function PierAgentStatus(pi)",
      "module.exports = function PierAgentStatus(pi)"
    )
  )(moduleShim);
  const handlers = new Map<string, Handler>();
  moduleShim.exports?.({
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
  });
  let consumedLines = 0;
  return {
    async close() {
      if (previous.log === undefined) delete process.env.PIER_AGENT_EVENT_LOG;
      else process.env.PIER_AGENT_EVENT_LOG = previous.log;
      if (previous.panel === undefined) delete process.env.PIER_PANEL_ID;
      else process.env.PIER_PANEL_ID = previous.panel;
      if (previous.window === undefined) delete process.env.PIER_WINDOW_ID;
      else process.env.PIER_WINDOW_ID = previous.window;
      await rm(root, { force: true, recursive: true });
    },
    async run(action: AgentStatusTraceAction) {
      const payload = action.payload as {
        event: Record<string, unknown>;
        sessionId: string;
      };
      handlers.get(action.producerKey ?? action.nativeEvent)?.(payload.event, {
        sessionManager: { getSessionId: () => payload.sessionId },
      });
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`${agentId}:${action.nativeEvent} 扩展未写入事件`);
      }
      return next;
    },
  };
}
