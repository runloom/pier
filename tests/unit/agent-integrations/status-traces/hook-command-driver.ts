import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "@main/services/agents/hooks-install.ts";
import {
  type NestedHookEventSpec,
  withPierNestedHooks,
} from "@main/services/agents/integrations/shared.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { pathForHookSpawn } from "../hook-spawn-path.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

const ORIGINAL_PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

export async function createNestedHookCommandProducer(
  agentId: AgentKind,
  events: readonly NestedHookEventSpec[]
): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), `pier-${agentId}-trace-`));
  const userData = join(root, "userData");
  const hooksHome = join(root, "hooks");
  await installAgentHooksEmitScript(userData, { hooksHome });
  const logPath = eventsJsonlPath(userData);
  const installed = withPierNestedHooks(
    {},
    {
      agentId,
      configPath: () => join(root, "unused.json"),
      events,
      runtime: { stopAuthority: "none" },
    }
  );
  const hookRecord = (installed.hooks ?? installed) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  const commands = new Map<string, string>();
  for (const [nativeEvent, entries] of Object.entries(hookRecord)) {
    entries.forEach((entry, index) => {
      const command = entry.hooks[0]?.command;
      if (command) {
        commands.set(`${nativeEvent}:${index}`, command);
      }
    });
  }
  let consumedLines = 0;
  return {
    close: () => rm(root, { force: true, recursive: true }),
    async run(action: AgentStatusTraceAction) {
      const key = action.producerKey ?? `${action.nativeEvent}:0`;
      const command = commands.get(key);
      if (!command) {
        throw new Error(`${agentId} 安装产物中找不到 producer ${key}`);
      }
      const result = spawnSync("/bin/sh", ["-c", command], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(ORIGINAL_PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
        },
        input: JSON.stringify(action.payload),
      });
      if (result.status !== 0) {
        throw new Error(
          `${agentId}:${action.nativeEvent} producer 退出 ${result.status}: ${result.stderr.toString()}`
        );
      }
      const output = await readFile(logPath, "utf8").catch(() => "");
      const lines = output.trim() ? output.trim().split("\n") : [];
      const next = lines.slice(consumedLines).map((line) => JSON.parse(line));
      consumedLines = lines.length;
      if (next.length === 0) {
        throw new Error(`${agentId}:${action.nativeEvent} producer 未写入事件`);
      }
      return next;
    },
  };
}
