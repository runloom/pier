import { GitChangesPanel } from "@plugins/builtin/git/renderer/git-changes-panel.tsx";
import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";

function makeProps(
  params?: Record<string, unknown>
): IDockviewPanelProps<{ heading?: string; hint?: string }> {
  return {
    api: { id: "pier.git.changes", setTitle: vi.fn() },
    containerApi: {},
    ...(params ? { params } : {}),
  } as unknown as IDockviewPanelProps<{ heading?: string; hint?: string }>;
}

describe("GitChangesPanel (plugin)", () => {
  it("renders heading and hint from params", () => {
    render(
      <GitChangesPanel
        {...makeProps({ heading: "Git Changes", hint: "Coming soon" })}
      />
    );
    expect(screen.getByText("Git Changes")).toBeDefined();
    expect(screen.getByText("Coming soon")).toBeDefined();
  });

  it("falls back to English defaults when params are absent", () => {
    render(<GitChangesPanel {...makeProps()} />);
    expect(screen.getByText("Git Changes")).toBeDefined();
    expect(screen.getByText("Change preview coming soon")).toBeDefined();
  });
});
