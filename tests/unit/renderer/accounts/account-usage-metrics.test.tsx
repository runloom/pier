import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as accountUsageRenderer from "../../../../packages/plugin-api/src/account-usage/renderer.ts";

describe("shared account usage metrics", () => {
  it("exports the shared metrics view", () => {
    expect(typeof accountUsageRenderer.AccountUsageMetrics).toBe("function");
    expect(typeof accountUsageRenderer.AccountMetadataBadges).toBe("function");
  });

  it("keeps scalars on the meter only when identity badges hide them", () => {
    const metrics = [
      {
        groupId: "codex",
        id: "codex:primary",
        kind: "quota" as const,
        usedPercent: 20,
      },
      {
        format: "count" as const,
        id: "codex:reset-credits",
        kind: "scalar" as const,
        value: 1,
      },
    ];

    expect(
      accountUsageRenderer.accountWidgetMeterMetrics(metrics, "all")
    ).toEqual([metrics[0]]);
    expect(
      accountUsageRenderer.accountWidgetMeterMetrics(metrics, "tier")
    ).toEqual(metrics);
    expect(
      accountUsageRenderer.accountWidgetMeterMetrics(metrics, "hidden")
    ).toEqual(metrics);
  });

  it("labels quota percentages as remaining and formats relative reset time", () => {
    render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={{
          noUsage: "No usage",
          remaining: "remaining",
          resetsIn: (duration) => `Resets in ${duration}`,
          stale: (duration) => `Showing data from ${duration} ago`,
        }}
        language="en"
        metricLabel={() => "7-day quota"}
        metrics={[
          {
            groupId: "codex",
            id: "codex:weekly",
            kind: "quota",
            resetsAt: 3_600_000,
            usedPercent: 0,
            windowMinutes: 10_080,
          },
        ]}
        now={0}
        status="ok"
        updatedAt={0}
      />
    );

    expect(screen.getByText("remaining")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Resets in 1h 0m")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "7-day quota: remaining 100%",
      })
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("only tightens the quota number and spacing in compact widgets", () => {
    const copy = {
      noUsage: "No usage",
      remaining: "remaining",
      resetsIn: (duration: string) => `Resets in ${duration}`,
      stale: (duration: string) => `Showing data from ${duration} ago`,
    };
    const metrics = [
      {
        groupId: "codex",
        id: "codex:weekly",
        kind: "quota" as const,
        resetsAt: 3_600_000,
        usedPercent: 37,
      },
    ];
    const { container, rerender } = render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={copy}
        density="compact"
        language="en"
        metricLabel={() => "7-day quota"}
        metrics={metrics}
        now={0}
        status="ok"
      />
    );

    const compactRoot = container.querySelector(
      '[data-slot="account-usage-metrics"]'
    );
    const compactQuota = container.querySelector(
      '[data-slot="account-usage-quota"]'
    );
    const compactNumber = screen.getByText("63%");
    expect(compactRoot).toHaveAttribute("data-density", "compact");
    expect(compactRoot).toHaveClass("gap-2");
    expect(compactQuota).toHaveClass("gap-1");
    expect(compactNumber).toHaveClass("text-base");
    expect(compactNumber).not.toHaveClass("text-lg");
    expect(screen.getByText("7-day quota")).toHaveClass("text-xs");
    expect(screen.getByText("Resets in 1h 0m").parentElement).toHaveClass(
      "text-xs"
    );

    rerender(
      <accountUsageRenderer.AccountUsageMetrics
        copy={copy}
        language="en"
        metricLabel={() => "7-day quota"}
        metrics={metrics}
        now={0}
        status="ok"
      />
    );

    const fullRoot = container.querySelector(
      '[data-slot="account-usage-metrics"]'
    );
    const fullQuota = container.querySelector(
      '[data-slot="account-usage-quota"]'
    );
    expect(fullRoot).toHaveAttribute("data-density", "full");
    expect(fullRoot).toHaveClass("gap-3");
    expect(fullQuota).toHaveClass("gap-1.5");
    expect(screen.getByText("63%")).toHaveClass("text-lg");
  });

  it("renders count and currency metrics in the account summary", () => {
    render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={{
          noUsage: "No usage",
          remaining: "remaining",
          resetsIn: (duration) => `Resets in ${duration}`,
          stale: (duration) => `Showing data from ${duration} ago`,
        }}
        language="en-US"
        metricLabel={(metric) =>
          metric.id === "reset-credits" ? "Quota resets" : "Prepaid balance"
        }
        metrics={[
          {
            format: "count",
            id: "reset-credits",
            kind: "scalar",
            value: 2,
          },
          {
            currency: "USD",
            format: "currency",
            id: "prepaid-balance",
            kind: "scalar",
            value: 12.5,
          },
        ]}
        status="ok"
      />
    );

    expect(screen.getByText("Quota resets 2").parentElement).toHaveAttribute(
      "data-slot",
      "account-usage-scalars"
    );
    expect(screen.getByText("Prepaid balance $12.50")).toBeInTheDocument();
  });

  it("renders scalar values after quota meters", () => {
    const { container } = render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={{
          noUsage: "No usage",
          remaining: "remaining",
          resetsIn: (duration) => `Resets in ${duration}`,
          stale: (duration) => `Showing data from ${duration} ago`,
        }}
        language="en"
        metricLabel={(metric) => metric.name ?? metric.id}
        metrics={[
          {
            format: "count",
            id: "credits:resets",
            kind: "scalar",
            name: "Quota resets",
            value: 2,
          },
          {
            groupId: "weekly",
            id: "weekly",
            kind: "quota",
            name: "Weekly",
            usedPercent: 25,
          },
        ]}
        status="ok"
      />
    );

    const quotas = container.querySelector(
      '[data-slot="account-usage-quotas"]'
    );
    const scalars = container.querySelector(
      '[data-slot="account-usage-scalars"]'
    );
    expect(quotas?.nextElementSibling).toBe(scalars);
  });

  it("preserves provider quota order when utilization changes", () => {
    const { container } = render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={{
          noUsage: "No usage",
          remaining: "remaining",
          resetsIn: (duration) => `Resets in ${duration}`,
          stale: (duration) => `Showing data from ${duration} ago`,
        }}
        language="en"
        metricLabel={(metric) => metric.name ?? metric.id}
        metrics={[
          {
            groupId: "weekly",
            id: "weekly",
            kind: "quota",
            name: "Weekly",
            usedPercent: 25,
          },
          {
            groupId: "session",
            id: "session",
            kind: "quota",
            name: "Session",
            usedPercent: 92,
          },
        ]}
        status="ok"
      />
    );

    const metrics = Array.from(
      container.querySelectorAll('[data-slot="account-usage-quota"]'),
      (element) => element.getAttribute("data-metric-id")
    );
    expect(metrics).toEqual(["weekly", "session"]);
  });

  it("marks retained metrics with the age of the last successful update", () => {
    render(
      <accountUsageRenderer.AccountUsageMetrics
        copy={{
          noUsage: "No usage",
          remaining: "remaining",
          resetsIn: (duration) => `Resets in ${duration}`,
          stale: (duration) => `Showing data from ${duration} ago`,
        }}
        language="en"
        metricLabel={() => "Quota"}
        metrics={[
          {
            groupId: "codex",
            id: "codex:primary",
            kind: "quota",
            usedPercent: 25,
          },
        ]}
        now={3_600_000}
        status="error"
        updatedAt={0}
      />
    );

    expect(screen.getByText("Showing data from 1h 0m ago")).toBeInTheDocument();
  });

  it("merges cancel-at-period-end with far-away expiry into one neutral badge", () => {
    render(
      <accountUsageRenderer.AccountMetadataBadges
        copy={{
          cancelAtPeriodEnd: "Stops renewing",
          cancelsOn: (relative) => `Cancels ${relative}`,
          expired: "Expired",
          expires: (relative) => `Expires ${relative}`,
          trialEnds: (relative) => `Trial ends ${relative}`,
        }}
        language="en-US"
        membership={{
          cancelAtPeriodEnd: true,
          expiresAt: Date.parse("2026-08-29T00:00:00Z"),
          status: "active",
          tier: "pro-20x",
          updatedAt: Date.parse("2026-07-29T00:00:00Z"),
        }}
        membershipLabel={() => "PRO 20x"}
        metricLabel={() => "Quota resets"}
        metrics={[
          {
            format: "count",
            id: "reset-credits",
            kind: "scalar",
            value: 2,
          },
        ]}
        now={Date.parse("2026-07-29T00:00:00Z")}
      />
    );

    expect(screen.getByText("PRO 20x")).toHaveAttribute("data-variant", "info");
    // Time + no-renewal share one chip; far-away stays neutral (same window as expiry).
    expect(screen.getByText("Cancels in 31 days")).toHaveAttribute(
      "data-variant",
      "neutral"
    );
    expect(screen.queryByText("Expires in 31 days")).not.toBeInTheDocument();
    expect(screen.queryByText("Stops renewing")).not.toBeInTheDocument();
    expect(screen.getByText("Quota resets 2")).toBeInTheDocument();
    expect(screen.queryByText("Updated now")).not.toBeInTheDocument();
  });

  it("warns on merged cancel chip only when the period is within the attention window", () => {
    render(
      <accountUsageRenderer.AccountMetadataBadges
        copy={{
          cancelAtPeriodEnd: "Stops renewing",
          cancelsOn: (relative) => `Cancels ${relative}`,
          expired: "Expired",
          expires: (relative) => `Expires ${relative}`,
          trialEnds: (relative) => `Trial ends ${relative}`,
        }}
        language="en-US"
        membership={{
          cancelAtPeriodEnd: true,
          expiresAt: Date.parse("2026-08-02T00:00:00Z"),
          status: "active",
          tier: "pro",
          updatedAt: Date.parse("2026-07-29T00:00:00Z"),
        }}
        membershipLabel={() => "PRO"}
        metricLabel={() => "Quota"}
        metrics={[]}
        now={Date.parse("2026-07-29T00:00:00Z")}
      />
    );

    expect(screen.getByText("Cancels in 4 days")).toHaveAttribute(
      "data-variant",
      "warning"
    );
    expect(screen.queryByText("Expires in 4 days")).not.toBeInTheDocument();
    expect(screen.queryByText("Stops renewing")).not.toBeInTheDocument();
  });

  it("warns on expiry only when the period is within the attention window", () => {
    render(
      <accountUsageRenderer.AccountMetadataBadges
        copy={{
          cancelAtPeriodEnd: "Stops renewing",
          cancelsOn: (relative) => `Cancels ${relative}`,
          expired: "Expired",
          expires: (relative) => `Expires ${relative}`,
          trialEnds: (relative) => `Trial ends ${relative}`,
        }}
        language="en-US"
        membership={{
          expiresAt: Date.parse("2026-08-02T00:00:00Z"),
          status: "active",
          tier: "pro",
          updatedAt: Date.parse("2026-07-29T00:00:00Z"),
        }}
        membershipLabel={() => "PRO"}
        metricLabel={() => "Quota"}
        metrics={[]}
        now={Date.parse("2026-07-29T00:00:00Z")}
      />
    );

    expect(screen.getByText("Expires in 4 days")).toHaveAttribute(
      "data-variant",
      "warning"
    );
    expect(screen.queryByText("Stops renewing")).not.toBeInTheDocument();
  });

  it("keeps cancel-only copy when end date is unknown", () => {
    render(
      <accountUsageRenderer.AccountMetadataBadges
        copy={{
          cancelAtPeriodEnd: "Stops renewing",
          cancelsOn: (relative) => `Cancels ${relative}`,
          expired: "Expired",
          expires: (relative) => `Expires ${relative}`,
          trialEnds: (relative) => `Trial ends ${relative}`,
        }}
        language="en-US"
        membership={{
          cancelAtPeriodEnd: true,
          status: "active",
          tier: "pro",
          updatedAt: Date.parse("2026-07-29T00:00:00Z"),
        }}
        membershipLabel={() => "PRO"}
        metricLabel={() => "Quota"}
        metrics={[]}
        now={Date.parse("2026-07-29T00:00:00Z")}
      />
    );

    expect(screen.getByText("Stops renewing")).toHaveAttribute(
      "data-variant",
      "warning"
    );
    expect(screen.queryByText(/Cancels /)).not.toBeInTheDocument();
  });

  it("shows provider identity only in metadata modes that retain identity", () => {
    const props = {
      copy: {
        cancelAtPeriodEnd: "Stops renewing",
        cancelsOn: (relative: string) => `Cancels ${relative}`,
        expired: "Expired",
        expires: (relative: string) => `Expires ${relative}`,
        trialEnds: (relative: string) => `Trial ends ${relative}`,
      },
      identityLabel: "OIDC",
      language: "en",
      membershipLabel: () => "PRO",
      metricLabel: () => "Quota",
      metrics: [],
    };
    const { rerender } = render(
      <accountUsageRenderer.AccountMetadataBadges {...props} mode="tier" />
    );

    expect(screen.getByText("OIDC")).toHaveAttribute("data-variant", "neutral");

    rerender(
      <accountUsageRenderer.AccountMetadataBadges {...props} mode="attention" />
    );
    expect(screen.queryByText("OIDC")).not.toBeInTheDocument();

    rerender(
      <accountUsageRenderer.AccountMetadataBadges {...props} mode="hidden" />
    );
    expect(screen.queryByText("OIDC")).not.toBeInTheDocument();
  });
});
