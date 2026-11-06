import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  controlTimeoutMsForCommand,
  invokeLocalControl,
} from "./control-client.ts";
import type { JsonCommand } from "./types.ts";
import { runTmux } from "./verbs.ts";

export { runTmux, TMUX_VERSION_LINE } from "./verbs.ts";

export function isMainEntry(
  entry: string | undefined,
  moduleFile: string
): boolean {
  if (!entry) {
    return false;
  }
  try {
    // 安装后的 shim 没有 .js 扩展名，且 macOS 临时目录常带 /var → /private/var
    // 符号链接：Node 以 realpath 加载入口，argv 保留调用路径，直接比较会永远
    // 不相等并让 shim 静默退出 0。两侧都先规范化。
    return realpathSync(moduleFile) === realpathSync(entry);
  } catch {
    return false;
  }
}

function isMainModule(): boolean {
  return isMainEntry(process.argv[1], fileURLToPath(import.meta.url));
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
