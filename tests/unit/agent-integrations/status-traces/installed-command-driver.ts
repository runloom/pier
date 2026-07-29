import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "@main/services/agents/agent-hooks-install.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentStatusTraceProducer } from "./status-trace-types.ts";

const ORIGINAL_PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

export async function createInstalledCommandProducer(
  agentId: AgentKind,
  commands: ReadonlyMap<string, string>
): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), `pier-${agentId}-command-trace-`));
  const userData = join(root, "userData");
  const hooksHome = join(root, "hooks");
  await installAgentHooksEmitScript(userData, { hooksHome });
  const logPath = eventsJsonlPath(userData);
  let consumedLines = 0;
  return {
    close: () => rm(root, { force: true, recursive: true }),
    async run(action) {
      const key = action.producerKey ?? action.nativeEvent;
      const command = commands.get(key);
      if (!command) {
        throw new Error(`${agentId} 安装产物中找不到 producer ${key}`);
      }
      const result = spawnSync("/bin/sh", ["-c", command], {
        env: {
          ...process.env,
          PATH: ORIGINAL_PATH,
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
