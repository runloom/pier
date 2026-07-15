import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractOauthFromGrokAuth,
  syncCrossToolCredentials,
} from "../../../packages/plugin-grok/src/main/cross-tool-sync.ts";

const AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    auth_mode: "oidc",
    create_time: "2026-01-01T00:00:00.000Z",
    email: "user@example.com",
    expires_at: "2099-01-01T00:00:00.000Z",
    key: "access-token-xyz",
    refresh_token: "refresh-token-xyz",
    user_id: "user-1",
  },
});

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-cross-tool-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("grok cross-tool sync", () => {
  it("extracts oauth tokens from managed auth.json", () => {
    expect(extractOauthFromGrokAuth(AUTH)).toMatchObject({
      accountId: "user-1",
      accessToken: "access-token-xyz",
      email: "user@example.com",
      kind: "oauth",
      refreshToken: "refresh-token-xyz",
    });
  });

  it("writes xai oauth into opencode and pi auth.json", async () => {
    const opencodeDataDir = join(dir, "opencode");
    const homeDir = join(dir, "home");
    await writeFile(join(dir, "placeholder"), "", "utf8");
    const credential = extractOauthFromGrokAuth(AUTH);
    const results = await syncCrossToolCredentials(
      ["opencode", "pi"],
      credential,
      { homeDir, opencodeDataDir }
    );
    expect(results.every((result) => result.ok)).toBe(true);

    const opencodeAuth = JSON.parse(
      await readFile(join(opencodeDataDir, "auth.json"), "utf8")
    ) as {
      xai: {
        access: string;
        accountId: string;
        expires: number;
        refresh: string;
        type: string;
      };
    };
    expect(opencodeAuth.xai).toMatchObject({
      access: "access-token-xyz",
      accountId: "user-1",
      refresh: "refresh-token-xyz",
      type: "oauth",
    });

    const piAuth = JSON.parse(
      await readFile(join(homeDir, ".pi", "agent", "auth.json"), "utf8")
    ) as {
      xai: {
        access: string;
        type: string;
      };
    };
    expect(piAuth.xai).toMatchObject({
      access: "access-token-xyz",
      type: "oauth",
    });
  });

  it("writes xai api key into opencode auth.json", async () => {
    const opencodeDataDir = join(dir, "opencode-api");
    const results = await syncCrossToolCredentials(
      ["opencode"],
      { apiKey: "xai-secret", kind: "api_key" },
      { opencodeDataDir }
    );
    expect(results).toEqual([{ ok: true, target: "opencode" }]);
    const opencodeAuth = JSON.parse(
      await readFile(join(opencodeDataDir, "auth.json"), "utf8")
    ) as { xai: { key: string; type: string } };
    expect(opencodeAuth.xai).toEqual({ key: "xai-secret", type: "api" });
  });
});
