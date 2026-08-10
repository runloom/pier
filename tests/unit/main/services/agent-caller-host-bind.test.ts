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
      credentialFilePath: "/tmp/c.json",
      env: { PIER_AGENT_CALLER_CREDENTIAL_FILE: "/tmp/c.json" },
    }));
    bindAgentCallerIssuer(issuer);
    expect(getBoundAgentCallerIssuer()).toBe(issuer);
    bindAgentCallerIssuer(null);
    expect(getBoundAgentCallerIssuer()).toBeNull();
  });

  it("tryIssueAgentCallerLaunchEnv returns env when bound", () => {
    bindAgentCallerIssuer(() => ({
      material: {} as never,
      credentialFilePath: "/tmp/c.json",
      env: { PIER_AGENT_CALLER_CREDENTIAL_FILE: "/tmp/c.json" },
    }));
    expect(tryIssueAgentCallerLaunchEnv()).toEqual({
      PIER_AGENT_CALLER_CREDENTIAL_FILE: "/tmp/c.json",
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

  it("scrubAgentCallerCredentialEnv strips credential path", () => {
    const env = {
      PATH: "/bin",
      PIER_AGENT_CALLER_CREDENTIAL_FILE: "/secret.json",
    };
    const scrubbed = scrubAgentCallerCredentialEnv(env);
    expect(scrubbed).toEqual({ PATH: "/bin" });
    expect(env.PIER_AGENT_CALLER_CREDENTIAL_FILE).toBe("/secret.json");
  });
});
