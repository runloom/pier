import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseGrokAuthJson,
  readGrokIdentity,
} from "../../../packages/plugin-grok/src/main/identity.ts";

const FIXTURE = {
  "https://auth.x.ai::test-client": {
    auth_mode: "oidc",
    create_time: "2026-01-01T00:00:00.000Z",
    email: "user@example.com",
    expires_at: "2099-01-01T00:00:00.000Z",
    key: "access-token",
    oidc_client_id: "test-client",
    oidc_issuer: "https://auth.x.ai",
    principal_id: "principal-1",
    principal_type: "User",
    refresh_token: "refresh-token",
    team_id: "team-1",
    user_id: "user-1",
  },
};

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-identity-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("pier.grok identity", () => {
  it("parses the newest usable OIDC entry", () => {
    const raw = JSON.stringify({
      "https://auth.x.ai::old": {
        auth_mode: "oidc",
        create_time: "2025-01-01T00:00:00.000Z",
        email: "old@example.com",
        refresh_token: "old-refresh",
        user_id: "old-user",
      },
      ...FIXTURE,
    });
    expect(parseGrokAuthJson(raw)).toEqual({
      authEntryKey: "https://auth.x.ai::test-client",
      email: "user@example.com",
      kind: "oidc",
      providerAccountId: "user-1",
      teamId: "team-1",
    });
  });

  it("falls back to user_id then entry key tail for email", () => {
    expect(
      parseGrokAuthJson(
        JSON.stringify({
          "https://auth.x.ai::client-tail": {
            auth_mode: "oidc",
            create_time: "2026-01-01T00:00:00.000Z",
            refresh_token: "r",
            user_id: "uid-only",
          },
        })
      )
    ).toMatchObject({
      email: "uid-only",
      providerAccountId: "uid-only",
    });

    expect(
      parseGrokAuthJson(
        JSON.stringify({
          "https://auth.x.ai::client-tail": {
            auth_mode: "oidc",
            create_time: "2026-01-01T00:00:00.000Z",
            principal_id: "principal-only",
            refresh_token: "r",
          },
        })
      )
    ).toMatchObject({
      email: "client-tail",
      providerAccountId: "principal-only",
    });
  });

  it("returns null for missing or empty auth", async () => {
    expect(parseGrokAuthJson("{}")).toBeNull();
    expect(parseGrokAuthJson("not-json")).toBeNull();
    await expect(readGrokIdentity(dir)).resolves.toBeNull();
  });

  it("reads identity from GROK_HOME auth.json", async () => {
    await writeFile(join(dir, "auth.json"), JSON.stringify(FIXTURE), "utf8");
    await expect(readGrokIdentity(dir)).resolves.toMatchObject({
      email: "user@example.com",
      providerAccountId: "user-1",
    });
  });
});
