// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillContentBody } from "@/pages/settings/components/skills/content-body.tsx";

const t = (key: string) => key;

describe("SkillContentBody", () => {
  it("loadFailed uses ErrorEmpty (not Alert strip)", () => {
    const onRetry = vi.fn();
    render(
      <SkillContentBody
        content={null}
        displayPath="skills/demo"
        errorDetail="ENOENT"
        loadFailed
        onRetry={onRetry}
        t={t}
      />
    );

    const empty = document.querySelector('[data-slot="error-empty"]');
    expect(empty).toBeTruthy();
    expect(screen.getByText("settings.skills.contentUnavailable")).toBeTruthy();
    expect(screen.getByText("ENOENT")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    screen.getByRole("button", { name: "settings.skills.retry" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
