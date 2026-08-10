/**
 * pier.control/v2 短会话客户端：hello → 单 request → response → close。
 * Agent 主体必须携带 credentialId + secret（从凭证文件加载）。
 */

import { lstatSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";

const API = "pier.control/v2";

function readNdjsonFrames(
  socketPath,
  writeLines,
  { minFrames = 1, timeoutMs = 15_000 } = {}
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

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      for (const line of writeLines) {
        socket.write(`${line}\n`);
      }
    });
    socket.on("data", (chunk) => {
      body += chunk;
      while (true) {
        const nl = body.indexOf("\n");
        if (nl < 0) {
          break;
        }
        const line = body.slice(0, nl);
        body = body.slice(nl + 1);
        if (!line) {
          continue;
        }
        try {
          frames.push(JSON.parse(line));
        } catch (error) {
          finish(error);
          return;
        }
        if (frames.length >= minFrames) {
          socket.end();
          finish();
          return;
        }
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish());
  });
}

/**
 * @param {{
 *   socketPath: string,
 *   requestId?: string,
 *   op: string,
 *   params?: Record<string, unknown>,
 *   clientKind?: "agent" | "cli-human",
 *   credentialId?: string,
 *   secret?: string,
 *   timeoutMs?: number,
 * }} args
 */
export async function invokePierControlV2(args) {
  const requestId = args.requestId ?? `req_${Date.now()}`;
  const helloId = `hello_${requestId}`;
  const clientKind =
    args.clientKind ??
    (args.credentialId && args.secret ? "agent" : "cli-human");

  let auth;
  if (clientKind === "agent") {
    if (!(args.credentialId && args.secret)) {
      throw new Error("agent principal requires credentialId and secret");
    }
    auth = {
      method: "agent-credential",
      credentialId: args.credentialId,
      secret: args.secret,
    };
  } else {
    auth = { method: "none" };
  }

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
  };

  const frames = await readNdjsonFrames(
    args.socketPath,
    [JSON.stringify(hello), JSON.stringify(request)],
    { minFrames: 2, timeoutMs: args.timeoutMs ?? 15_000 }
  );

  const helloFrame = frames[0];
  const responseFrame = frames[1];
  if (helloFrame?.type !== "server.hello") {
    if (helloFrame?.type === "server.error") {
      throw new Error(`${helloFrame.code}: ${helloFrame.message}`);
    }
    throw new Error("expected server.hello from pier.control/v2");
  }
  if (responseFrame?.type !== "response") {
    if (responseFrame?.type === "server.error") {
      throw new Error(`${responseFrame.code}: ${responseFrame.message}`);
    }
    throw new Error("expected response from pier.control/v2");
  }
  return { hello: helloFrame, response: responseFrame };
}

/**
 * 从 PIER_AGENT_CALLER_CREDENTIAL_FILE 安全读取 credentialId + secret。
 * 拒绝 symlink 与 other 可读（Unix）；解析失败返回 null。
 * @returns {{ credentialId: string, secret: string } | null}
 */
export function readAgentCredentialFromEnv(env = process.env) {
  const path = env.PIER_AGENT_CALLER_CREDENTIAL_FILE;
  if (!path || typeof path !== "string") {
    return null;
  }
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      return null;
    }
    if (!st.isFile()) {
      return null;
    }
    if (process.platform !== "win32") {
      // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
      const mode = st.mode & 0o777;
      // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
      if ((mode & 0o077) !== 0) {
        return null;
      }
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (
      raw &&
      typeof raw.credentialId === "string" &&
      raw.credentialId.length > 0 &&
      typeof raw.secret === "string" &&
      raw.secret.length > 0
    ) {
      return { credentialId: raw.credentialId, secret: raw.secret };
    }
  } catch {
    return null;
  }
  return null;
}

/** @deprecated 使用 readAgentCredentialFromEnv */
export function readCredentialIdFromEnv(env = process.env) {
  return readAgentCredentialFromEnv(env)?.credentialId ?? null;
}
