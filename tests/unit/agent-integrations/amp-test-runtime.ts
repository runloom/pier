import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentHookEvent,
  agentHookEventSchema,
} from "../../../src/shared/contracts/agent-session.ts";

export type AmpTestHandler = (...args: unknown[]) => unknown;
type AmpAgentEvent = Extract<AgentHookEvent, { kind: "agentEvent"; v: 3 }>;

export interface AmpTestLifecycle {
  dispose: () => unknown;
}

export async function runAmpPluginScenario(
  source: string,
  scenario: (
    handlers: Map<string, AmpTestHandler>,
    lifecycle: AmpTestLifecycle
  ) => void | Promise<void>
): Promise<AmpAgentEvent[]> {
  const dir = await mkdtemp(join(tmpdir(), "pier-amp-state-"));
  const logPath = join(dir, "events.jsonl");
  const previous = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panelId: process.env.PIER_PANEL_ID,
    windowId: process.env.PIER_WINDOW_ID,
  };
  process.env.PIER_AGENT_EVENT_LOG = logPath;
  process.env.PIER_PANEL_ID = "p1";
  process.env.PIER_WINDOW_ID = "w1";
  try {
    const cjsSource = source.replace(
      "export default function (amp)",
      "module.exports = function (amp)"
    );
    const pluginModule: { exports?: (amp: unknown) => void } = {};
    const evaluate = new Function("module", cjsSource) as (
      module: typeof pluginModule
    ) => void;
    evaluate(pluginModule);
    const handlers = new Map<string, AmpTestHandler>();
    let disposeHandler: AmpTestHandler | undefined;
    pluginModule.exports?.({
      on(name: string, handler: AmpTestHandler) {
        handlers.set(name, handler);
      },
      onDispose(handler: AmpTestHandler) {
        disposeHandler = handler;
        return { unsubscribe() {} };
      },
    });
    await scenario(handlers, {
      dispose: () => disposeHandler?.(),
    });
    return (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const row = agentHookEventSchema.parse(JSON.parse(line));
        if (row.kind !== "agentEvent" || row.v !== 3) {
          throw new Error(`Amp 测试日志出现非 v3 agentEvent 记录：${row.kind}`);
        }
        return row;
      });
  } finally {
    if (previous.log === undefined) {
      delete process.env.PIER_AGENT_EVENT_LOG;
    } else {
      process.env.PIER_AGENT_EVENT_LOG = previous.log;
    }
    if (previous.panelId === undefined) {
      delete process.env.PIER_PANEL_ID;
    } else {
      process.env.PIER_PANEL_ID = previous.panelId;
    }
    if (previous.windowId === undefined) {
      delete process.env.PIER_WINDOW_ID;
    } else {
      process.env.PIER_WINDOW_ID = previous.windowId;
    }
  }
}
