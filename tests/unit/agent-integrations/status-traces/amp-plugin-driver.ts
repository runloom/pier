import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAmpPluginSource } from "@main/services/agents/integrations/amp.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

type Handler = (...args: unknown[]) => unknown;

export async function createAmpPluginProducer(): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), "pier-amp-plugin-trace-"));
  const logPath = join(root, "events.jsonl");
  const previous = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panel: process.env.PIER_PANEL_ID,
    window: process.env.PIER_WINDOW_ID,
  };
  process.env.PIER_AGENT_EVENT_LOG = logPath;
  process.env.PIER_PANEL_ID = "p1";
  process.env.PIER_WINDOW_ID = "w1";
  const moduleShim: { exports?: (amp: unknown) => void } = {};
  new Function(
    "module",
    buildAmpPluginSource().replace(
      "export default function (amp)",
      "module.exports = function (amp)"
    )
  )(moduleShim);
  const handlers = new Map<string, Handler>();
  let stateHandler: ((state: string) => void) | undefined;
  moduleShim.exports?.({
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    onDispose() {
      return { unsubscribe() {} };
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
        event?: Record<string, unknown>;
        sessionId: string;
        state?: string;
      };
      if (action.producerKey === "thread.state") {
        stateHandler?.(payload.state ?? "");
      } else {
        const thread = {
          id: payload.sessionId,
          state: {
            get: () => undefined,
            subscribe(handler: (state: string) => void) {
              stateHandler = handler;
              return { unsubscribe() {} };
            },
          },
        };
        handlers.get(action.producerKey ?? action.nativeEvent)?.(
          { id: "turn-1", thread: { id: payload.sessionId }, ...payload.event },
          { thread }
        );
        await Promise.resolve();
      }
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`amp:${action.nativeEvent} 生成插件未写入事件`);
      }
      return next;
    },
  };
}
