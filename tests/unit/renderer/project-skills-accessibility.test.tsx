import type { ProjectSkillView } from "@shared/contracts/project-skills.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ManagedSkillRow } from "@/pages/settings/components/skills/skills-detail-rows.tsx";
import { SkillsListToolbar } from "@/pages/settings/components/skills/skills-detail-toolbar.tsx";
import { SkillsImportReview } from "@/pages/settings/components/skills/skills-import-review.tsx";
import { AgentEffectSummary } from "@/pages/settings/components/skills/skills-shared.tsx";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";

const SKILL: ProjectSkillView = {
  actualContentDigest: null,
  alwaysInclude: false,
  contentDigest: `sha256:${"a".repeat(64)}`,
  description: "Review changes",
  directorySummary: null,
  effects: [],
  enabled: false,
  delivery: null,
  fileCount: 1,
  id: "review-guide",
  issueIds: [],
  managedBy: "user",
  name: "Review Guide",
  riskSummary: null,
  source: { type: "local-import" },
  totalBytes: 100,
};

describe("project skills accessibility", () => {
  beforeEach(async () => {
    await initI18n();
    useProjectSkillsStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("names repeated row controls for their skill and exposes launch focus", () => {
    render(
      <ul>
        <ManagedSkillRow
          disabled={false}
          onOpenSkill={vi.fn()}
          skill={SKILL}
          t={i18next.t}
        />
      </ul>
    );

    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open Review Guide" })
    ).toBeInTheDocument();

    const launchTarget = document.querySelector<HTMLElement>(
      '[data-skill-id="review-guide"]'
    );
    expect(launchTarget).toHaveAttribute("tabindex", "-1");
    expect(launchTarget).toHaveClass(
      "outline-none",
      "focus-visible:ring-3",
      "focus-visible:ring-ring/30"
    );
    launchTarget?.focus();
    expect(document.activeElement).toBe(launchTarget);
  });

  it("turns a conflict review into a navigable blocked state", () => {
    const onConfirm = vi.fn();
    const onResolveConflict = vi.fn();
    render(
      <SkillsImportReview
        candidate={{
          token: "candidate",
          skillId: "review-guide",
          name: "Review Guide",
          description: "Review changes",
          sourceKind: "local-import",
          sourceDisplayPath: "/tmp/review-guide",
          contentDigest: "digest",
          riskFingerprint: "",
          fileCount: 1,
          totalBytes: 10,
          expiresAt: Date.now() + 60_000,
          skillMdPreview: "# Review",
        }}
        conflict
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onConflictResolve={onResolveConflict}
      />
    );

    expect(screen.getByRole("button", { name: "Add skill" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reload and return" })
    ).toBeEnabled();
    expect(
      screen.getAllByRole("button", { name: "Back to skills" }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Back to skills" })[0]
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload and return" }));
    expect(onResolveConflict).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("expires candidate reviews at their deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
    const onConfirm = vi.fn();
    render(
      <SkillsImportReview
        candidate={{
          token: "candidate",
          skillId: "review-guide",
          name: "Review Guide",
          description: "Review changes",
          sourceKind: "local-import",
          sourceDisplayPath: "/tmp/review-guide",
          contentDigest: "digest",
          riskFingerprint: "",
          fileCount: 1,
          totalBytes: 10,
          expiresAt: Date.now() + 1000,
          skillMdPreview: "# Review",
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    const confirm = screen.getByRole("button", { name: "Add skill" });
    expect(confirm).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(confirm).toBeDisabled();
    expect(screen.getByText(/This import expired/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows unique discoverable agent icons without path labels", () => {
    render(
      <AgentEffectSummary
        effects={[
          {
            agentKind: "claude",
            effect: {
              state: "discoverable",
              viaRoot: ".agents/skills",
            },
          },
          {
            agentKind: "codex",
            effect: {
              state: "discoverable",
              viaRoot: ".agents/skills",
            },
          },
          {
            agentKind: "claude",
            effect: {
              state: "discoverable",
              viaRoot: ".claude/skills",
            },
          },
          {
            agentKind: "claude",
            effect: { state: "duplicate", roots: [".agents/skills"] },
          },
        ]}
        t={i18next.t}
      />
    );

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByLabelText("Claude")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex")).toBeInTheDocument();
    expect(screen.queryByText(/\.agents\/skills/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.claude\/skills/)).not.toBeInTheDocument();
  });

  it("renders a singular result count with count interpolation", () => {
    render(
      <SkillsListToolbar
        filter="all"
        onFilterChange={vi.fn()}
        onQueryChange={vi.fn()}
        query=""
        shownCount={1}
        t={i18next.t}
        totalCount={1}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("1 of 1 skill");
  });
});
