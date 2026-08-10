import { classifyLocalControlFirstFrame } from "@shared/contracts/local-control/classify.ts";
import { LOCAL_CONTROL_V2_API_VERSION } from "@shared/contracts/local-control/v2-errors.ts";
import {
  localControlV2ClientHelloSchema,
  localControlV2ServerHelloSchema,
} from "@shared/contracts/local-control/v2-frames.ts";
import { describe, expect, it } from "vitest";

describe("local-control v2 frames", () => {
  it("parses client.hello round-trip", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_1",
      clientKind: "cli-human" as const,
      auth: { method: "none" as const },
    };
    expect(localControlV2ClientHelloSchema.parse(hello)).toEqual(hello);
  });

  it("parses server.hello with empty features", () => {
    const frame = {
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "server.hello" as const,
      requestId: "req_1",
      bootId: "boot_1",
      serverTimeMs: 1,
      features: [] as string[],
    };
    expect(localControlV2ServerHelloSchema.parse(frame)).toEqual(frame);
  });
});

describe("classifyLocalControlFirstFrame", () => {
  it("classifies v1 envelope", () => {
    const envelope = {
      protocolVersion: 1,
      requestId: "r1",
      clientId: "cli-local",
      command: { type: "app.status" },
    };
    const result = classifyLocalControlFirstFrame(envelope);
    expect(result.kind).toBe("v1");
  });

  it("classifies v2 hello", () => {
    const result = classifyLocalControlFirstFrame({
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "client.hello",
      requestId: "r1",
      clientKind: "agent",
      auth: {
        method: "agent-credential",
        credentialId: "cred_1",
        secret: "s3cret-value-here",
      },
    });
    expect(result.kind).toBe("v2-hello");
  });

  it("rejects v2 non-hello first frame", () => {
    const result = classifyLocalControlFirstFrame({
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "request",
      requestId: "r1",
      op: "agents.self",
      params: {},
    });
    expect(result).toMatchObject({
      kind: "invalid",
      code: "protocol_unsupported",
    });
  });

  it("rejects unknown protocol", () => {
    const result = classifyLocalControlFirstFrame({ foo: 1 });
    expect(result).toMatchObject({
      kind: "invalid",
      code: "protocol_unsupported",
    });
  });
});
