/**
 * pier.control/v2 短会话客户端：hello → 单 request → response → close。
 * 本机默认：agent 用 PIER_AGENT_CALLER_BINDING（不透明 id，无 secret）。
 * 可选增强：凭证文件含 secret 时走 agent-credential。
 */

import { lstatSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";

const API = "pier.control/v2";
const BINDING_ENV = "PIER_AGENT_CALLER_BINDING";
const CREDENTIAL_FILE_ENV = "PIER_AGENT_CALLER_CREDENTIAL_FILE";

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

function resolveClientKindAndAuth(args) {
  const clientKind =
    args.clientKind ??
    (args.bindingId || (args.credentialId && args.secret)
      ? "agent"
      : "cli-human");
  if (clientKind !== "agent") {
    return { clientKind, auth: { method: "none" } };
  }
  if (args.credentialId && args.secret) {
    return {
      clientKind,
      auth: {
        method: "agent-credential",
        credentialId: args.credentialId,
        secret: args.secret,
      },
    };
  }
  if (args.bindingId) {
    return {
      clientKind,
      auth: { method: "agent-binding", bindingId: args.bindingId },
    };
  }
  throw new Error(
    "agent principal requires PIER_AGENT_CALLER_BINDING (or credential+secret)"
  );
}

function assertV2Pair(helloFrame, responseFrame) {
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
}

/**
 * @param {{
 *   socketPath: string,
 *   requestId?: string,
 *   op: string,
 *   params?: Record<string, unknown>,
 *   clientKind?: "agent" | "cli-human",
 *   bindingId?: string,
 *   credentialId?: string,
 *   secret?: string,
 *   effectKey?: string,
 *   expectedBootId?: string,
 *   timeoutMs?: number,
 * }} args
 */
export async function invokePierControlV2(args) {
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
    { minFrames: 2, timeoutMs: args.timeoutMs ?? 15_000 }
  );

  const helloFrame = frames[0];
  const responseFrame = frames[1];
  assertV2Pair(helloFrame, responseFrame);
  return { hello: helloFrame, response: responseFrame };
}

/**
 * 读取 agent 主体：优先 PIER_AGENT_CALLER_BINDING；
 * 回退旧凭证文件（若含 secret 则返回 credential 增强路径）。
 * @returns {{ bindingId?: string, credentialId?: string, secret?: string } | null}
 */
export function readAgentCallerFromEnv(env = process.env) {
  const binding = env[BINDING_ENV];
  if (typeof binding === "string" && binding.length > 0) {
    return { bindingId: binding };
  }

  const path = env[CREDENTIAL_FILE_ENV];
  if (!path || typeof path !== "string") {
    return null;
  }
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) {
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
      !(
        raw &&
        typeof raw.credentialId === "string" &&
        raw.credentialId.length > 0
      )
    ) {
      return null;
    }
    if (typeof raw.secret === "string" && raw.secret.length > 0) {
      return { credentialId: raw.credentialId, secret: raw.secret };
    }
    // 文件仅有 id、无 secret → 当 binding 用
    return { bindingId: raw.credentialId };
  } catch {
    return null;
  }
}

/**
 * @deprecated 使用 readAgentCallerFromEnv。
 * 仅返回旧的 credential+secret 形状；binding-only 返回 null（勿合成空 secret）。
 */
export function readAgentCredentialFromEnv(env = process.env) {
  const v = readAgentCallerFromEnv(env);
  if (!v) {
    return null;
  }
  if (
    typeof v.credentialId === "string" &&
    v.credentialId.length > 0 &&
    typeof v.secret === "string" &&
    v.secret.length > 0
  ) {
    return { credentialId: v.credentialId, secret: v.secret };
  }
  return null;
}

/** @deprecated 使用 readAgentCallerFromEnv */
export function readCredentialIdFromEnv(env = process.env) {
  const v = readAgentCallerFromEnv(env);
  return v?.bindingId ?? v?.credentialId ?? null;
}
