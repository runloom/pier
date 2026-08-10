import {
  bindAgentCallerIssuer,
  getBoundAgentCallerIssuer,
  scrubAgentCallerCredentialEnv,
  tryIssueAgentCallerLaunchEnv,
} from "@main/services/agent-caller/host-bind.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  bindAgentCallerIssuer(null);
});

describe("agent-caller host-bind", () => {
  it("bind / get / unbind issuer", () => {
    expect(getBoundAgentCallerIssuer()).toBeNull();
    const issuer = vi.fn(() => ({
      material: {} as never,
      env: { PIER_AGENT_CALLER_BINDING: "bind_x" },
    }));
    bindAgentCallerIssuer(issuer);
    expect(getBoundAgentCallerIssuer()).toBe(issuer);
    bindAgentCallerIssuer(null);
    expect(getBoundAgentCallerIssuer()).toBeNull();
  });

  it("tryIssueAgentCallerLaunchEnv returns binding env when bound", () => {
    bindAgentCallerIssuer(() => ({
      material: {} as never,
      env: { PIER_AGENT_CALLER_BINDING: "bind_x" },
    }));
    expect(tryIssueAgentCallerLaunchEnv()).toEqual({
      PIER_AGENT_CALLER_BINDING: "bind_x",
    });
  });

  it("tryIssue returns null when unbound or issuer throws", () => {
    expect(tryIssueAgentCallerLaunchEnv()).toBeNull();
    bindAgentCallerIssuer(() => {
      throw new Error("disk full");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(tryIssueAgentCallerLaunchEnv()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("scrub strips binding and legacy credential file env", () => {
    const env = {
      PATH: "/bin",
      PIER_AGENT_CALLER_BINDING: "bind_parent",
      PIER_AGENT_CALLER_CREDENTIAL_FILE: "/secret.json",
    };
    const scrubbed = scrubAgentCallerCredentialEnv(env);
    expect(scrubbed).toEqual({ PATH: "/bin" });
    expect(env.PIER_AGENT_CALLER_BINDING).toBe("bind_parent");
  });
});
