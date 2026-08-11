/**
 * 产品 non-goal：agents.invoke 已撤回，不得再作为 product 路径。
 */

import {
  LOCAL_CONTROL_V2_FEATURE_AGENTS_CATALOG,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_GET,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_LIST,
} from "@main/adapters/cli/local-control-v2-features.ts";
import { createLocalControlV2SessionFromHello } from "@main/adapters/cli/local-control-v2-session.ts";
import { LOCAL_CONTROL_V2_API_VERSION } from "@shared/contracts/local-control/v2-errors.ts";
import { describe, expect, it } from "vitest";
import { parsePierCliArgs } from "../../../../bin/pier-cli-parser.js";

describe("agents.invoke product withdrawal", () => {
  it("CLI parse rejects pier agents invoke", () => {
    expect(() =>
      parsePierCliArgs(["agents", "invoke", "codex", "--json"], {
        requestId: "req-1",
      })
    ).toThrow(/not a product command|native CLI/u);
  });

  it("usage does not advertise agents invoke", async () => {
    const { usage } = await import("../../../../bin/pier-cli-parser.js");
    expect(usage()).not.toMatch(/agents invoke/u);
  });

  it("v2 features do not advertise agents.invoke", () => {
    const frames: unknown[] = [];
    const created = createLocalControlV2SessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_V2_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot-test",
        features: [],
        emit: (f) => frames.push(f),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const hello = created.helloFrame as {
      features?: string[];
    };
    expect(hello.features).toContain(LOCAL_CONTROL_V2_FEATURE_AGENTS_CATALOG);
    expect(hello.features).toContain(LOCAL_CONTROL_V2_FEATURE_AGENTS_LIST);
    expect(hello.features).toContain(LOCAL_CONTROL_V2_FEATURE_AGENTS_GET);
    expect(hello.features).not.toContain("agents.invoke");
  });

  it("request agents.invoke returns unsupported", () => {
    const frames: Array<{
      type?: string;
      ok?: boolean;
      error?: { code?: string; message?: string };
    }> = [];
    const created = createLocalControlV2SessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_V2_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot-test",
        features: [],
        emit: (f) => frames.push(f),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_V2_API_VERSION,
        type: "request",
        requestId: "r1",
        op: "agents.invoke",
        params: { agentId: "codex", prompt: "hi" },
      })
    );
    const response = frames.find((f) => f.type === "response");
    expect(response?.ok).toBe(false);
    expect(response?.error?.code).toBe("unsupported");
    expect(response?.error?.message ?? "").toMatch(
      /native CLI|not a Pier product/u
    );
  });

  it("mismatched expectedBootId returns boot_changed", () => {
    const frames: Array<{
      type?: string;
      ok?: boolean;
      error?: { code?: string };
    }> = [];
    const created = createLocalControlV2SessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_V2_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot-current",
        features: [],
        emit: (f) => frames.push(f),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_V2_API_VERSION,
        type: "request",
        requestId: "r-boot",
        op: "agents.catalog",
        params: {},
        expectedBootId: "boot-stale",
      })
    );
    const response = frames.find((f) => f.type === "response");
    expect(response?.ok).toBe(false);
    expect(response?.error?.code).toBe("boot_changed");
  });
});
