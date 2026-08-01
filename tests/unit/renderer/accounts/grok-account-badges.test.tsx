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
