import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  buildCredentialEnvelope,
  CLAUDE_OAUTH_CLIENT_ID,
  createPkcePair,
  exchangeAuthorizationCode,
  fetchOauthProfile,
  LOGIN_EXPIRED_ERROR,
  mergeRefreshedTokens,
  parseCredentialEnvelope,
  refreshAccessToken,
} from "../../../packages/plugin-claude/src/main/oauth.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("claude oauth", () => {
  it("builds a PKCE authorize URL with the Claude Code client id", () => {
    const pkce = createPkcePair();
    const url = new URL(buildAuthorizeUrl(pkce));
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLAUDE_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(pkce.verifier);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it("exchanges a pasted code#state pair for tokens", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.grant_type).toBe("authorization_code");
      expect(body.code).toBe("the-code");
      expect(body.state).toBe("the-state");
      return jsonResponse({
        access_token: "at-1",
        expires_in: 3600,
        refresh_token: "rt-1",
        scope: "user:profile user:inference",
      });
    });
    const tokens = await exchangeAuthorizationCode({
      fetchImpl,
      now: () => 1000,
      pastedCode: " the-code#the-state ",
      verifier: "verifier",
    });
    expect(tokens).toEqual({
      accessToken: "at-1",
      expiresAt: 1000 + 3_600_000,
      refreshToken: "rt-1",
      scopes: ["user:profile", "user:inference"],
    });
  });

  it("maps refresh rejection to the login-expired error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant" }, 400)
    );
    await expect(
      refreshAccessToken({
        fetchImpl,
        now: () => 0,
        refreshToken: "stale",
      })
    ).rejects.toThrow(LOGIN_EXPIRED_ERROR);
  });

  it("parses the oauth profile into identity fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        account: { email_address: "a@example.com", uuid: "uuid-a" },
        organization: { name: "Acme", uuid: "org-1" },
        subscriptionType: "max",
      })
    );
    await expect(
      fetchOauthProfile({ accessToken: "at", fetchImpl })
    ).resolves.toEqual({
      accountUuid: "uuid-a",
      email: "a@example.com",
      organizationName: "Acme",
      organizationUuid: "org-1",
      subscriptionType: "max",
    });
  });

  it("round-trips and merges credential envelopes without dropping foreign fields", () => {
    const envelope = buildCredentialEnvelope(
      {
        accessToken: "at-1",
        expiresAt: 111,
        refreshToken: "rt-1",
        scopes: ["user:inference"],
      },
      "pro"
    );
    const parsed = parseCredentialEnvelope(envelope);
    expect(parsed).toMatchObject({
      accessToken: "at-1",
      expiresAt: 111,
      refreshToken: "rt-1",
      subscriptionType: "pro",
    });

    const withExtra = JSON.stringify({
      ...JSON.parse(envelope),
      mcpOAuth: { keep: true },
    });
    const merged = mergeRefreshedTokens(withExtra, {
      accessToken: "at-2",
      expiresAt: 222,
      refreshToken: "rt-2",
      scopes: [],
    });
    const root = JSON.parse(merged);
    expect(root.mcpOAuth).toEqual({ keep: true });
    expect(root.claudeAiOauth).toMatchObject({
      accessToken: "at-2",
      expiresAt: 222,
      refreshToken: "rt-2",
      subscriptionType: "pro",
    });
  });
});
