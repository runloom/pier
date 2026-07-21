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
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { promptNewBlankSkill } from "@/pages/settings/components/skills/skills-blank-skill-dialog.tsx";
import { ManagedSkillRow } from "@/pages/settings/components/skills/skills-detail-rows.tsx";
import { SkillsListToolbar } from "@/pages/settings/components/skills/skills-detail-toolbar.tsx";
import { SkillsImportReview } from "@/pages/settings/components/skills/skills-import-review.tsx";
import { AgentEffectSummary } from "@/pages/settings/components/skills/skills-shared.tsx";
import { resetAppContentDialogForTests } from "@/stores/app-content-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";

const SKILL: ProjectSkillView = {
  actualContentDigest: null,
  contentDigest: `sha256:${"a".repeat(64)}`,
  description: "Review changes",
  directorySummary: null,
  effects: [],
  enabled: false,
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
    resetAppContentDialogForTests();
  });

  it("names repeated row controls for their skill and exposes launch focus", () => {
    render(
      <ul>
        <ManagedSkillRow
          disabled={false}
          enabled={false}
          onOpenSkill={vi.fn()}
          onToggle={vi.fn()}
          skill={SKILL}
          t={i18next.t}
        />
      </ul>
    );

    expect(
      screen.getByRole("switch", { name: "Enable skill Review Guide" })
    ).toBeInTheDocument();
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

  it("links required blank-skill fields to help and validation text", async () => {
    render(<AppContentDialogHost />);
    await act(async () => {
      promptNewBlankSkill("New blank skill");
    });

    const idInput = screen.getByRole("textbox", { name: "New skill id" });
    const descriptionInput = screen.getByRole("textbox", {
      name: "Skill description",
    });

    expect(idInput).toBeRequired();
    expect(idInput).toHaveAttribute("aria-required", "true");
    expect(idInput).toHaveAttribute("aria-describedby", "skills-blank-id-help");
    expect(descriptionInput).toBeRequired();
    expect(descriptionInput).toHaveAttribute("aria-required", "true");
    expect(descriptionInput).toHaveAttribute(
      "aria-describedby",
      "skills-blank-description-help"
    );

    fireEvent.change(idInput, { target: { value: "Invalid id" } });

    expect(idInput).toHaveAttribute(
      "aria-describedby",
      "skills-blank-id-help skills-blank-id-error"
    );
    expect(screen.getByText(/Use lowercase letters/)).toHaveAttribute(
      "id",
      "skills-blank-id-error"
    );
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
      screen.getByRole("button", { name: "Back to skills" })
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

  it("groups repeated warning effects and uses English singular copy", () => {
    render(
      <AgentEffectSummary
        effects={[
          {
            agentKind: "claude",
            effect: { state: "duplicate", roots: [".agents/skills"] },
          },
          {
            agentKind: "codex",
            effect: { state: "duplicate", roots: [".agents/skills"] },
          },
        ]}
        t={i18next.t}
      />
    );

    expect(
      screen.getAllByText("2 agents: Discovered more than once")
    ).toHaveLength(1);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(
      i18next.t("settings.skills.effectSummaryDiscoverable", { count: 1 })
    ).toBe("Available to 1 agent");
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
