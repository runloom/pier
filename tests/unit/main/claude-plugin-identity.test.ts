import { describe, expect, it } from "vitest";
import {
  parseIdentityFromOauthAccount,
  parseManagedCredential,
  readOauthAccountFromClaudeJson,
  serializeManagedCredential,
  subscriptionTypeFromCredential,
} from "../../../packages/plugin-claude/src/main/identity.ts";

function parseIdentityFromClaudeJson(
  claudeJsonRaw: string,
  credential?: string
) {
  return parseIdentityFromOauthAccount(
    readOauthAccountFromClaudeJson(claudeJsonRaw),
    credential
  );
}

const OAUTH_ACCOUNT = {
  accountUuid: "acc-uuid-1",
  emailAddress: "user@example.com",
  organizationName: "Acme Corp",
  organizationUuid: "org-uuid-1",
};

const CREDENTIAL = JSON.stringify({
  claudeAiOauth: {
    accessToken: "sk-access",
    expiresAt: 1_900_000_000_000,
    refreshToken: "sk-refresh",
    scopes: ["user:inference"],
    subscriptionType: "max",
  },
});

const CLAUDE_JSON = JSON.stringify({
  numStartups: 42,
  oauthAccount: OAUTH_ACCOUNT,
});

describe("claude identity", () => {
  it("parses identity from ~/.claude.json oauthAccount + credential", () => {
    const identity = parseIdentityFromClaudeJson(CLAUDE_JSON, CREDENTIAL);
    expect(identity).toEqual({
      email: "user@example.com",
      organizationName: "Acme Corp",
      organizationUuid: "org-uuid-1",
      providerAccountId: "acc-uuid-1",
      subscriptionType: "max",
    });
  });

  it("uses accountUuid as the stable provider id (survives token rotation)", () => {
    const rotated = JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-access-ROTATED",
        refreshToken: "sk-refresh-ROTATED",
        subscriptionType: "max",
      },
    });
    const a = parseIdentityFromClaudeJson(CLAUDE_JSON, CREDENTIAL);
    const b = parseIdentityFromClaudeJson(CLAUDE_JSON, rotated);
    expect(a?.providerAccountId).toBe(b?.providerAccountId);
  });

  it("returns null when the oauthAccount lacks email or accountUuid", () => {
    expect(
      parseIdentityFromClaudeJson(
        JSON.stringify({ oauthAccount: { emailAddress: "x@y.z" } })
      )
    ).toBeNull();
    expect(parseIdentityFromClaudeJson("{}")).toBeNull();
    expect(parseIdentityFromClaudeJson("not json")).toBeNull();
  });

  it("reads subscriptionType from a credential envelope", () => {
    expect(subscriptionTypeFromCredential(CREDENTIAL)).toBe("max");
    expect(subscriptionTypeFromCredential("garbage")).toBeUndefined();
  });

  it("round-trips a managed credential record", () => {
    const raw = serializeManagedCredential({
      credential: CREDENTIAL,
      oauthAccount: OAUTH_ACCOUNT,
    });
    const parsed = parseManagedCredential(raw);
    expect(parsed?.credential).toBe(CREDENTIAL);
    expect(parsed?.oauthAccount).toEqual(OAUTH_ACCOUNT);
  });

  it("rejects a managed record without a credential", () => {
    expect(
      parseManagedCredential(JSON.stringify({ oauthAccount: {} }))
    ).toBeNull();
    expect(parseManagedCredential("nope")).toBeNull();
  });
});
