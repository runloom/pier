import type { SkillsLaunchContinueResult } from "@shared/contracts/terminal.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSkillsLaunchBlock } from "@/lib/skills/launch-block.ts";
import { openProjectsSettings } from "@/pages/settings/data/projects-settings-nav.ts";

const dialogMocks = vi.hoisted(() => ({
  showAppChoice: vi.fn(
    async (): Promise<"alt" | "cancel" | "confirm"> => "alt"
  ),
  showAppConfirm: vi.fn(async () => true),
}));

const requestOpenProject = vi.hoisted(() => vi.fn());

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppChoice: dialogMocks.showAppChoice,
  showAppConfirm: dialogMocks.showAppConfirm,
}));

vi.mock("@/pages/settings/data/projects-settings-nav.ts", () => ({
  openProjectsSettings: vi.fn(),
}));

vi.mock("@/stores/project-skills.store.ts", () => ({
  useProjectSkillsStore: {
    getState: () => ({ requestOpenProject }),
  },
}));

vi.mock("@/stores/settings-dialog.store.ts", () => ({
  useSettingsDialogStore: {
    getState: () => ({ openSection: vi.fn() }),
    setState: vi.fn(),
  },
}));

describe("project skills replacement launch gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogMocks.showAppChoice.mockResolvedValue("alt");
    dialogMocks.showAppConfirm.mockResolvedValue(true);
  });

  it("presents a replacement gate before continuing", async () => {
    const launchContinue = vi
      .fn<
        (request: {
          launchAttemptId: string;
          decision: "open-settings" | "degrade" | "cancel";
          acknowledgements?: readonly {
            requirementId: string;
            nonce: string;
          }[];
        }) => Promise<SkillsLaunchContinueResult>
      >()
      .mockResolvedValueOnce({
        status: "rejected",
        launchAttemptId: "attempt-1",
        reason: "acknowledgement-required",
        message: "replacement required",
        gate: {
          status: "blocked",
          launchAttemptId: "attempt-1",
          issueSummary: ["library-drift skill=review-guide"],
          issues: [
            {
              id: "library-drift-2",
              code: "library-drift",
              skillId: "review-guide",
            },
          ],
          degradePolicySummary: "requires-content-risk-confirmation",
          expiresAt: Date.now() + 60_000,
        },
      })
      .mockResolvedValueOnce({
        status: "ready",
        launchAttemptId: "attempt-1",
        degraded: true,
      });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { projectSkills: { launchContinue } },
    });

    const continuation = await resolveSkillsLaunchBlock({
      blocked: {
        launchAttemptId: "attempt-1",
        issueSummary: ["projection-missing skill=review-guide"],
        degradePolicySummary: "allowed",
        expiresAt: Date.now() + 60_000,
      },
      t: ((key: string) => key) as never,
    });

    expect(continuation).toBe("attempt-1");
    expect(dialogMocks.showAppChoice).toHaveBeenCalledTimes(2);
    expect(launchContinue).toHaveBeenNthCalledWith(2, {
      launchAttemptId: "attempt-1",
      decision: "degrade",
    });
  });

  it("opens the projects skills tab with focus path on open-settings", async () => {
    dialogMocks.showAppChoice.mockResolvedValue("confirm");
    const launchContinue = vi.fn(async () => ({
      status: "ready" as const,
      launchAttemptId: "attempt-open",
      degraded: false,
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { projectSkills: { launchContinue } },
    });

    const continuation = await resolveSkillsLaunchBlock({
      blocked: {
        launchAttemptId: "attempt-open",
        projectRootPath: "/Users/me/proj",
        focusIssueIds: ["issue-1"],
        issueSummary: ["projection-missing skill=review-guide"],
        degradePolicySummary: "allowed",
        expiresAt: Date.now() + 60_000,
      },
      t: ((key: string) => key) as never,
    });

    expect(continuation).toBeNull();
    expect(launchContinue).toHaveBeenCalledWith({
      launchAttemptId: "attempt-open",
      decision: "open-settings",
    });
    expect(requestOpenProject).toHaveBeenCalledWith("/Users/me/proj", [
      "issue-1",
    ]);
    expect(openProjectsSettings).toHaveBeenCalledWith({
      tab: "skills",
      projectRootPath: "/Users/me/proj",
    });
  });
});
