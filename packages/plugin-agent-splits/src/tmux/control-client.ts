import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { type ControlResult, isRecord, type JsonCommand } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Must exceed host `TERMINAL_OPEN_RENDERER_TIMEOUT_MS` so the shim reports the Pier error. */
export const TERMINAL_OPEN_CONTROL_TIMEOUT_MS = 25_000;

export function controlTimeoutMsForCommand(
  command: JsonCommand
): number | undefined {
  if (command.type === "terminal.open") {
    return TERMINAL_OPEN_CONTROL_TIMEOUT_MS;
  }
}

function parseControlResult(value: unknown): ControlResult {
  if (!isRecord(value)) {
    throw new Error("invalid control result");
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (value.ok === true) {
    return { data: value.data, ok: true, requestId };
  }
  if (value.ok === false) {
    const error = isRecord(value.error) ? value.error : {};
    return {
      error: {
        code: typeof error.code === "string" ? error.code : "internal_error",
        message:
          typeof error.message === "string" ? error.message : "command failed",
      },
      ok: false,
      requestId,
    };
  }
  throw new Error("invalid control result");
}

export async function invokeLocalControl(options: {
  command: JsonCommand;
  socketPath: string;
  timeoutMs?: number;
}): Promise<ControlResult> {
  const requestId = randomUUID();
  const envelope = {
    clientId: "cli-local",
    command: options.command,
    protocolVersion: 1,
    requestId,
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise((resolve, reject) => {
    const socket = createConnection(options.socketPath);
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      finish(new Error("control socket timed out"));
    }, timeoutMs);

    function finish(error: Error | null, result?: ControlResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (result) {
        resolve(result);
      }
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(envelope)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = buffer.slice(0, newline).trim();
      try {
        finish(null, parseControlResult(JSON.parse(line)));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on("error", (err) => {
      finish(err);
    });
    socket.on("end", () => {
      if (!settled) {
        finish(new Error("control socket closed before result"));
      }
    });
  });
}
