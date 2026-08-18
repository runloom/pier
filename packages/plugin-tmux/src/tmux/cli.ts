import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  controlTimeoutMsForCommand,
  invokeLocalControl,
} from "./control-client.ts";
import type { JsonCommand } from "./types.ts";
import { runTmux } from "./verbs.ts";

export { runTmux, TMUX_VERSION_LINE } from "./verbs.ts";

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const socketPath = process.env.PIER_CONTROL_SOCKET ?? "";
  const result = await runTmux(process.argv.slice(2), {
    env: process.env,
    invoke: async (command: JsonCommand) => {
      const timeoutMs = controlTimeoutMsForCommand(command);
      return await invokeLocalControl({
        command,
        socketPath,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
