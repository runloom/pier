import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOpencodePluginSource } from "@main/services/agents/integrations/opencode.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

interface OpenCodePlugin {
  "chat.message"(
    input: Record<string, unknown>,
    output: Record<string, unknown>
  ): void;
  event(args: { event: Record<string, unknown> }): void;
  "tool.execute.after"(input: Record<string, unknown>): void;
  "tool.execute.before"(input: Record<string, unknown>): void;
}

type OpenCodeInvocation =
  | { event: Record<string, unknown>; handler: "event" }
  | {
      handler: "chat.message";
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    }
  | {
      handler: "tool.execute.after" | "tool.execute.before";
      input: Record<string, unknown>;
    };

function invoke(plugin: OpenCodePlugin, invocation: OpenCodeInvocation): void {
  if (invocation.handler === "event") {
    plugin.event({ event: invocation.event });
  } else if (invocation.handler === "chat.message") {
    plugin["chat.message"](invocation.input, invocation.output);
  } else {
    plugin[invocation.handler](invocation.input);
  }
}

export async function createOpenCodePluginProducer(): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), "pier-opencode-plugin-trace-"));
  const logPath = join(root, "events.jsonl");
  const previous = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panel: process.env.PIER_PANEL_ID,
    window: process.env.PIER_WINDOW_ID,
  };
  process.env.PIER_AGENT_EVENT_LOG = logPath;
  process.env.PIER_PANEL_ID = "p1";
  process.env.PIER_WINDOW_ID = "w1";
  const moduleShim: { exports?: () => OpenCodePlugin } = {};
  new Function(
    "module",
    buildOpencodePluginSource().replace(
      "export const PierAgentStatus =",
      "module.exports ="
    )
  )(moduleShim);
  const plugin = moduleShim.exports?.();
  if (!plugin) throw new Error("OpenCode 生成插件没有导出 factory");
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
      const invocations = Array.isArray(action.payload)
        ? (action.payload as OpenCodeInvocation[])
        : [action.payload as OpenCodeInvocation];
      for (const invocation of invocations) invoke(plugin, invocation);
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`opencode:${action.nativeEvent} 生成插件未写入事件`);
      }
      return next;
    },
  };
}
