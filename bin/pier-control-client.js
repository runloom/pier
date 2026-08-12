/**
 * pier.control/v2 短会话客户端：hello → request →（可选 event*）→ response → close。
 * 产品终态：仅 cli-human（auth.none）。
 */

import { createConnection } from "node:net";

const API = "pier.control/v2";

/**
 * @param {string} socketPath
 * @param {string[]} writeLines
 * @param {{ timeoutMs?: number, untilTerminal?: boolean, minFrames?: number }} [opts]
 *   untilTerminal: 等到 response|server.error（中间可穿插 event）；否则按 minFrames
 */
function shouldStopReading(frames, untilTerminal, minFrames) {
  if (untilTerminal) {
    const last = frames.at(-1);
    return last?.type === "server.error" || last?.type === "response";
  }
  return frames.length >= minFrames;
}

function appendNdjsonLines(body, chunk, onLine) {
  let next = body + chunk;
  while (true) {
    const nl = next.indexOf("\n");
    if (nl < 0) {
      return next;
    }
    const line = next.slice(0, nl);
    next = next.slice(nl + 1);
    if (line) {
      onLine(line);
    }
  }
}

function readNdjsonFrames(
  socketPath,
  writeLines,
  { minFrames = 1, timeoutMs = 15_000, untilTerminal = false } = {}
) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const frames = [];
    let body = "";
    let settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out on pier.control/v2 at ${socketPath}`));
    }, timeoutMs);

    const finish = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
        return;
      }
      resolve(frames);
    };

    const onLine = (line) => {
      try {
        frames.push(JSON.parse(line));
      } catch (error) {
        finish(error);
        return;
      }
      if (shouldStopReading(frames, untilTerminal, minFrames)) {
        socket.end();
        finish();
      }
    };

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      for (const line of writeLines) {
        socket.write(`${line}\n`);
      }
    });
    socket.on("data", (chunk) => {
      body = appendNdjsonLines(body, chunk, onLine);
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish());
  });
}

function resolveClientKindAndAuth(args) {
  const clientKind = args.clientKind ?? "cli-human";
  if (clientKind !== "cli-human") {
    throw new Error(
      `unknown clientKind: ${clientKind} (product is cli-human only)`
    );
  }
  return { clientKind: "cli-human", auth: { method: "none" } };
}

function formatServerError(frame) {
  const code =
    typeof frame?.code === "string" && frame.code.length > 0
      ? frame.code
      : "server_error";
  const message =
    typeof frame?.message === "string" && frame.message.length > 0
      ? frame.message
      : "control session error";
  return `${code}: ${message}`;
}

function assertV2Pair(helloFrame, responseFrame, frames = []) {
  // 无 hello：常见为首帧/任意帧 server.error（peer deny、invalid hello）
  if (helloFrame?.type !== "server.hello") {
    const err =
      (helloFrame?.type === "server.error" ? helloFrame : null) ||
      frames.find((f) => f?.type === "server.error");
    if (err) {
      throw new Error(formatServerError(err));
    }
    throw new Error("expected server.hello from pier.control/v2");
  }
  if (responseFrame?.type !== "response") {
    if (responseFrame?.type === "server.error") {
      throw new Error(formatServerError(responseFrame));
    }
    const err = frames.find((f) => f?.type === "server.error");
    if (err) {
      throw new Error(formatServerError(err));
    }
    throw new Error("expected response from pier.control/v2");
  }
}

/**
 * @param {{
 *   socketPath: string,
 *   requestId?: string,
 *   op: string,
 *   params?: Record<string, unknown>,
 *   clientKind?: "cli-human",
 *   effectKey?: string,
 *   expectedBootId?: string,
 *   timeoutMs?: number,
 * }} args
 */
export async function invokePierControl(args) {
  const requestId = args.requestId ?? `req_${Date.now()}`;
  const helloId = `hello_${requestId}`;
  const { clientKind, auth } = resolveClientKindAndAuth(args);

  const hello = {
    apiVersion: API,
    type: "client.hello",
    requestId: helloId,
    clientKind,
    auth,
  };
  const request = {
    apiVersion: API,
    type: "request",
    requestId,
    op: args.op,
    params: args.params ?? {},
    ...(args.effectKey ? { effectKey: args.effectKey } : {}),
    ...(args.expectedBootId ? { expectedBootId: args.expectedBootId } : {}),
  };

  const frames = await readNdjsonFrames(
    args.socketPath,
    [JSON.stringify(hello), JSON.stringify(request)],
    {
      // watch 等会在 response 前推送 event；必须等到终态帧
      untilTerminal: true,
      timeoutMs: args.timeoutMs ?? 15_000,
    }
  );

  const helloFrame = frames.find((f) => f?.type === "server.hello");
  const responseFrame =
    frames.find((f) => f?.type === "response") ??
    frames.find((f) => f?.type === "server.error");
  const events = frames.filter((f) => f?.type === "event");
  assertV2Pair(helloFrame, responseFrame, frames);
  return { hello: helloFrame, response: responseFrame, events };
}
