/**
 * 移动端帧扩展（规格 §17.1）：mobile-paired hello + command 帧 + 协议冻结。
 * 帧是纯 JSON 文本契约，源码不得出现 window / document / ServiceWorker / IndexedDB。
 * @see docs/superpowers/specs/2026-08-26-mobile-companion-design.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  localControlClientCommandSchema,
  localControlClientFrameSchema,
  localControlClientHelloSchema,
} from "@shared/contracts/local-control/frames.ts";
import { describe, expect, it } from "vitest";

describe("mobile-paired client.hello", () => {
  it("accepts mobile-paired with device-token auth and defaults shell to web", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_1",
      clientKind: "mobile-paired" as const,
      auth: {
        method: "device-token" as const,
        deviceId: "dev_1",
        deviceToken: "tok_1",
      },
    };
    const parsed = localControlClientHelloSchema.parse(hello);
    expect(parsed.clientKind).toBe("mobile-paired");
    expect(parsed.auth).toEqual({
      method: "device-token",
      deviceId: "dev_1",
      deviceToken: "tok_1",
      shell: "web",
    });
  });

  it("records an explicit companion shell", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_2",
      clientKind: "mobile-paired" as const,
      auth: {
        method: "device-token" as const,
        deviceId: "dev_1",
        deviceToken: "tok_1",
        shell: "app" as const,
      },
    };
    const parsed = localControlClientHelloSchema.parse(hello);
    expect(parsed.auth).toMatchObject({ shell: "app" });
  });

  it("rejects device-token auth missing token material", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_3",
      clientKind: "mobile-paired" as const,
      auth: { method: "device-token" as const, deviceId: "dev_1" },
    };
    expect(() => localControlClientHelloSchema.parse(hello)).toThrow();
  });

  it("keeps cli-human none auth unchanged", () => {
    const hello = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello" as const,
      requestId: "req_4",
      clientKind: "cli-human" as const,
      auth: { method: "none" as const },
    };
    expect(localControlClientHelloSchema.parse(hello)).toEqual(hello);
  });
});

describe("command frame", () => {
  it("round-trips a command frame carrying an opaque PierCommand", () => {
    const frame = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "command" as const,
      requestId: "req_9",
      command: { type: "app.snapshot" },
    };
    expect(localControlClientCommandSchema.parse(frame)).toEqual(frame);
    expect(localControlClientFrameSchema.parse(frame)).toEqual(frame);
  });

  it("rejects a command frame without requestId", () => {
    const frame = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "command" as const,
      command: { type: "app.snapshot" },
    };
    expect(() => localControlClientCommandSchema.parse(frame)).toThrow();
    expect(() => localControlClientFrameSchema.parse(frame)).toThrow();
  });
});

describe("protocol freeze", () => {
  it("frame/error/remote contract sources contain no DOM vocabulary", () => {
    const files = [
      "src/shared/contracts/local-control/frames.ts",
      "src/shared/contracts/local-control/errors.ts",
      "src/shared/contracts/remote.ts",
    ];
    const forbidden = /\bwindow\b|\bdocument\b|ServiceWorker|IndexedDB/u;
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(forbidden);
    }
  });
});
