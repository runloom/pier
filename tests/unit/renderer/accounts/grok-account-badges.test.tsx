import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountBadges } from "../../../../packages/plugin-grok/src/renderer/account-display.tsx";

const t = (key: string, fallback: string): string => {
  if (key.endsWith("authKindApiKey")) return "API key";
  if (key.endsWith("authKindOidc")) return "OIDC";
  return fallback;
};

describe("Grok account badges", () => {
  it("keeps the authentication kind when membership is unavailable", () => {
    const { rerender } = render(
      <AccountBadges
        account={{ kind: "api_key" }}
        language="en"
        mode="all"
        t={t}
      />
    );

    expect(screen.getByText("API key")).toBeInTheDocument();

    rerender(
      <AccountBadges
        account={{ kind: "oidc" }}
        language="en"
        mode="tier"
        t={t}
      />
    );
    expect(screen.getByText("OIDC")).toBeInTheDocument();
  });

  it("shows quota reset counts from usage metrics", () => {
    render(
      <AccountBadges
        account={{
          kind: "oidc",
          usage: {
            attemptedAt: 1,
            metrics: [
              {
                format: "count",
                id: "grok:reset-credits",
                kind: "scalar",
                value: 2,
              },
            ],
            status: "ok",
            updatedAt: 1,
          },
        }}
        language="en"
        t={t}
      />
    );
    expect(screen.getByText("Quota resets 2")).toBeInTheDocument();
  });

  it("hides quota reset metadata when the count cannot be fetched", () => {
    const legacyUnavailableUsage = {
      attemptedAt: 1,
      metrics: [],
      resetCreditsResolved: false,
      status: "ok" as const,
      updatedAt: 1,
    };
    const { container } = render(
      <AccountBadges
        account={{
          kind: "oidc",
          usage: legacyUnavailableUsage,
        }}
        language="en"
        t={t}
      />
    );

    expect(screen.getByText("OIDC")).toBeInTheDocument();
    expect(
      screen.queryByText("Quota resets temporarily unavailable")
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-availability="unavailable"]')
    ).toBeNull();
  });

  it("does not present a clock-expired SuperGrok plan as a current member", () => {
    render(
      <AccountBadges
        account={{
          kind: "oidc",
          subscription: {
            planType: "super_grok_pro",
            status: "active",
            expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
          },
        }}
        language="en"
        now={Date.parse("2026-09-10T00:00:00.000Z")}
        t={t}
      />
    );

    expect(screen.getByText("SUPER GROK PRO")).toHaveAttribute(
      "data-variant",
      "danger"
    );
    expect(screen.getByText("Expired")).toHaveAttribute(
      "data-variant",
      "danger"
    );
    expect(screen.queryByText(/Expires /)).not.toBeInTheDocument();
  });

  it("shows free instead of a leftover paid SKU", () => {
    render(
      <AccountBadges
        account={{
          kind: "oidc",
          subscription: { planType: "free", status: "none" },
        }}
        language="en"
        t={t}
      />
    );

    expect(screen.getByText("FREE")).toBeInTheDocument();
    expect(screen.queryByText("SUPER GROK PRO")).not.toBeInTheDocument();
    expect(screen.queryByText(/Expires /)).not.toBeInTheDocument();
  });

  it("does not override compact-mode metadata hiding", () => {
    render(
      <AccountBadges
        account={{ kind: "oidc" }}
        language="en"
        mode="hidden"
        t={t}
      />
    );

    expect(screen.queryByText("OIDC")).not.toBeInTheDocument();
  });
});
