import { describe, expect, it, vi } from "vitest";
import { applySubscriptionToAccount } from "../../../../../packages/plugin-grok/src/main/accounts-records.ts";
import type { FetchImpl } from "../../../../../packages/plugin-grok/src/main/grok-usage-types.ts";
import { GROK_REMAINING_RESETS_URL } from "../../../../../packages/plugin-grok/src/main/reset-credits.ts";
import {
  GROK_RATE_LIMITS_URL,
  GROK_SUBSCRIPTIONS_URL,
  GROK_USER_URL,
  withSoftSubscription,
} from "../../../../../packages/plugin-grok/src/main/subscription-fetch.ts";

function response(options: {
  body?: unknown;
  ok: boolean;
  status: number;
}): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: options.ok,
    status: options.status,
    text: async () => JSON.stringify(options.body ?? {}),
  };
}

describe("Grok membership soft fallbacks", () => {
  it("replaces a saved paid plan when live membership is explicitly empty", async () => {
    const fetchImpl: FetchImpl = async (url) =>
      url === GROK_USER_URL
        ? response({
            body: { userId: "user-1", subscriptionTier: null },
            ok: true,
            status: 200,
          })
        : response({ ok: false, status: 403 });
    const result = await withSoftSubscription(
      { metrics: [], status: "ok" },
      {
        caller: new AbortController().signal,
        fetchImpl,
        overall: null,
        sessionKey: "session-key",
      }
    );

    expect(result.subscriptionResolved).toBe(true);
    expect(result.subscription).toEqual({ planType: "free", status: "none" });
    if (!result.subscription) throw new Error("Missing resolved membership");
    const account = applySubscriptionToAccount(
      {
        createdAt: 1,
        id: "account-1",
        kind: "oidc",
        provider: "grok",
        subscription: {
          planType: "super_grok_pro",
          status: "active",
          expiresAt: 1000,
          trialEndsAt: 500,
          cancelAtPeriodEnd: true,
        },
        updatedAt: 1,
      },
      result.subscription,
      2000
    );
    expect(account.subscription).toEqual({ planType: "free", status: "none" });
  });

  it.each([
    { body: {}, ok: true, status: 200 },
    { body: { subscriptionTier: null }, ok: false, status: 503 },
  ])("does not resolve membership after an unavailable result: %j", async (userResponse) => {
    const result = await withSoftSubscription(
      { metrics: [], status: "ok" },
      {
        caller: new AbortController().signal,
        fetchImpl: async (url) =>
          response(
            url === GROK_USER_URL ? userResponse : { ok: false, status: 403 }
          ),
        overall: null,
        sessionKey: "session-key",
      }
    );
    expect(result.subscription).toBeUndefined();
    expect(result.subscriptionResolved).toBeUndefined();
  });

  it("starts independent membership probes together and keeps direct membership authoritative", async () => {
    let resolveDirect:
      | ((value: Awaited<ReturnType<FetchImpl>>) => void)
      | undefined;
    let resolveFallback:
      | ((value: Awaited<ReturnType<FetchImpl>>) => void)
      | undefined;
    let directSettled = false;
    let userStartedBeforeDirectSettled = false;
    const fetchImpl: FetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_SUBSCRIPTIONS_URL) {
        return await new Promise<Awaited<ReturnType<FetchImpl>>>((resolve) => {
          resolveDirect = (value) => {
            directSettled = true;
            resolve(value);
          };
        });
      }
      if (url === GROK_USER_URL) {
        userStartedBeforeDirectSettled = !directSettled;
        return await new Promise<Awaited<ReturnType<FetchImpl>>>((resolve) => {
          resolveFallback = resolve;
        });
      }
      if (url === GROK_RATE_LIMITS_URL || url === GROK_REMAINING_RESETS_URL) {
        return response({ ok: false, status: 404 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const resultPromise = withSoftSubscription(
      {
        metrics: [],
        status: "ok",
      },
      {
        caller: new AbortController().signal,
        fetchImpl,
        overall: null,
        sessionKey: "session-key",
      }
    );
    await Promise.resolve();
    await Promise.resolve();
    resolveDirect?.(
      response({
        body: {
          subscriptions: [
            {
              status: "SUBSCRIPTION_STATUS_ACTIVE",
              tier: "SUBSCRIPTION_TIER_GROK_PRO",
            },
          ],
        },
        ok: true,
        status: 200,
      })
    );
    const resultSettledBeforeFallback = await Promise.race([
      resultPromise.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 0);
      }),
    ]);
    resolveFallback?.(
      response({
        body: {
          subscription: {
            status: "active",
            tier: "supergrok",
          },
        },
        ok: true,
        status: 200,
      })
    );

    await expect(resultPromise).resolves.toMatchObject({
      subscription: {
        planType: "pro",
        status: "active",
      },
      subscriptionResolved: true,
    });
    expect(userStartedBeforeDirectSettled).toBe(true);
    expect(resultSettledBeforeFallback).toBe(true);
  });
});
