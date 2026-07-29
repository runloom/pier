import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHermesPluginInit } from "@main/services/agents/integrations/hermes.ts";
import { buildKiloPluginSource } from "@main/services/agents/integrations/kilo.ts";
import { buildMimoCodePluginSource } from "@main/services/agents/integrations/mimo-code.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

interface HostedPlugin {
  [handler: string]:
    | ((...args: Record<string, unknown>[]) => unknown)
    | undefined;
}

interface HostedInvocation {
  readonly event?: Record<string, unknown>;
  readonly handler: string;
  readonly input?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
}

function invoke(
  plugin: HostedPlugin,
  invocation: HostedInvocation
): Promise<unknown> {
  const handler = plugin[invocation.handler];
  if (!handler) {
    throw new Error(`生成插件没有导出 ${invocation.handler}`);
  }
  if (invocation.handler === "event") {
    return Promise.resolve(handler({ event: invocation.event ?? {} }));
  }
  if (invocation.output) {
    return Promise.resolve(handler(invocation.input ?? {}, invocation.output));
  }
  return Promise.resolve(handler(invocation.input ?? {}));
}

async function createJavascriptHostedProducer(
  agentId: "kilo" | "mimo-code",
  source: string
): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), `pier-${agentId}-source-trace-`));
  const logPath = join(root, "events.jsonl");
  const previous = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panel: process.env.PIER_PANEL_ID,
    window: process.env.PIER_WINDOW_ID,
  };
  process.env.PIER_AGENT_EVENT_LOG = logPath;
  process.env.PIER_PANEL_ID = "p1";
  process.env.PIER_WINDOW_ID = "w1";
  const moduleShim: { exports?: unknown } = {};
  const executable =
    agentId === "kilo"
      ? source.replace("export default", "module.exports =")
      : source
          .replace("export const PierAgentStatus =", "module.exports =")
          .replace(
            'export default { id: "pier-agent-status", server: PierAgentStatus };',
            ""
          );
  new Function("module", executable)(moduleShim);
  const plugin =
    agentId === "kilo"
      ? await (
          moduleShim.exports as
            | { server?: () => Promise<HostedPlugin> }
            | undefined
        )?.server?.()
      : (moduleShim.exports as (() => HostedPlugin) | undefined)?.();
  if (!plugin) {
    throw new Error(`${agentId} 生成插件没有导出 factory`);
  }
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
        ? (action.payload as HostedInvocation[])
        : [action.payload as HostedInvocation];
      for (const invocation of invocations) {
        await invoke(plugin, invocation);
      }
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`${agentId}:${action.nativeEvent} 生成插件未写入事件`);
      }
      return next;
    },
  };
}

export function createKiloPluginProducer(): Promise<AgentStatusTraceProducer> {
  return createJavascriptHostedProducer("kilo", buildKiloPluginSource());
}

export function createMimoCodePluginProducer(): Promise<AgentStatusTraceProducer> {
  return createJavascriptHostedProducer(
    "mimo-code",
    buildMimoCodePluginSource()
  );
}

export async function createHermesPluginProducer(): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), "pier-hermes-source-trace-"));
  const initPath = join(root, "pier_status.py");
  const logPath = join(root, "events.jsonl");
  await writeFile(initPath, buildHermesPluginInit(), "utf8");
  let consumedLines = 0;
  return {
    close: () => rm(root, { force: true, recursive: true }),
    async run(action: AgentStatusTraceAction) {
      const invocation = action.payload as {
        readonly hook: string;
        readonly kwargs: Record<string, unknown>;
      };
      const runner = `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("pier_status", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self): self.hooks = {}
    def register_hook(self, name, callback): self.hooks[name] = callback
ctx = Ctx()
mod.register(ctx)
ctx.hooks[sys.argv[2]](**json.loads(sys.argv[3]))
`;
      const result = spawnSync(
        "python3",
        [
          "-c",
          runner,
          initPath,
          invocation.hook,
          JSON.stringify(invocation.kwargs),
        ],
        {
          env: {
            ...process.env,
            PIER_AGENT_EVENT_LOG: logPath,
            PIER_PANEL_ID: "p1",
            PIER_WINDOW_ID: "w1",
          },
        }
      );
      if (result.status !== 0) {
        throw new Error(
          `hermes:${action.nativeEvent} producer 退出 ${result.status}: ${result.stderr.toString()}`
        );
      }
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`hermes:${action.nativeEvent} 生成插件未写入事件`);
      }
      return next;
    },
  };
}
