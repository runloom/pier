import { classifyLocalControlFirstFrame } from "@shared/contracts/local-control/classify.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  localControlClientHelloSchema,
  localControlServerHelloSchema,
} from "@shared/contracts/local-control/frames.ts";
import { describe, expect, it } from "vitest";

describe("local-control frames", () => {
  it("parses client.hello round-trip", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_1",
      clientKind: "cli-human" as const,
      auth: { method: "none" as const },
    };
    expect(localControlClientHelloSchema.parse(hello)).toEqual(hello);
  });

  it("parses server.hello with empty features", () => {
    const frame = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.hello" as const,
      requestId: "req_1",
      bootId: "boot_1",
      serverTimeMs: 1,
      features: [] as string[],
    };
    expect(localControlServerHelloSchema.parse(frame)).toEqual(frame);
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

  it("classifies v2 hello with cli-human", () => {
    const result = classifyLocalControlFirstFrame({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello",
      requestId: "r1",
      clientKind: "cli-human",
      auth: { method: "none" },
    });
    expect(result.kind).toBe("session-hello");
  });

  it("rejects agent clientKind (removed from product frames)", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "r1",
      clientKind: "agent",
      auth: { method: "agent-binding", bindingId: "bind_1" },
    };
    expect(() => localControlClientHelloSchema.parse(hello)).toThrow();
  });

  it("rejects v2 non-hello first frame", () => {
    const result = classifyLocalControlFirstFrame({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "request",
      requestId: "r1",
      op: "agents.list",
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
