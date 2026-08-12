/**
 * 本机控制首帧分流：v1 短请求 vs v2 会话。
 */
import { LOCAL_CONTROL_API_VERSION } from "./errors.ts";
import {
  type LocalControlClientHello,
  localControlClientHelloSchema,
} from "./frames.ts";

export type LocalControlFirstFrame =
  | { kind: "v1"; envelope: unknown }
  | { kind: "session-hello"; hello: LocalControlClientHello }
  | {
      kind: "invalid";
      reason: string;
      code: "invalid_command" | "protocol_unsupported";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析已 JSON.parse 的首帧对象。
 * v1：protocolVersion === 1 且含 command。
 * v2：apiVersion pier.control/v2 且 type === client.hello。
 */
export function classifyLocalControlFirstFrame(
  value: unknown
): LocalControlFirstFrame {
  if (!isRecord(value)) {
    return {
      kind: "invalid",
      reason: "frame must be a JSON object",
      code: "invalid_command",
    };
  }

  if (value.apiVersion === LOCAL_CONTROL_API_VERSION) {
    if (value.type !== "client.hello") {
      return {
        kind: "invalid",
        reason: "v2 session must start with client.hello",
        code: "protocol_unsupported",
      };
    }
    const parsed = localControlClientHelloSchema.safeParse(value);
    if (!parsed.success) {
      return {
        kind: "invalid",
        reason: parsed.error.issues[0]?.message ?? "invalid client.hello",
        code: "invalid_command",
      };
    }
    return { kind: "session-hello", hello: parsed.data };
  }

  if (value.protocolVersion === 1 && "command" in value) {
    return { kind: "v1", envelope: value };
  }

  if (value.protocolVersion === 1) {
    return {
      kind: "invalid",
      reason: "v1 envelope requires command",
      code: "invalid_command",
    };
  }

  return {
    kind: "invalid",
    reason: "unrecognized control protocol",
    code: "protocol_unsupported",
  };
}
