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

  it("presents a denied replacement gate before opening settings", async () => {
    const launchContinue = vi
      .fn<
        (request: {
          launchAttemptId: string;
          decision: "open-settings" | "degrade" | "cancel";
        }) => Promise<SkillsLaunchContinueResult>
      >()
      .mockResolvedValueOnce({
        status: "rejected",
        launchAttemptId: "attempt-1",
        reason: "denied",
        message: "current health denies degraded launch",
        gate: {
          status: "blocked",
          launchAttemptId: "attempt-1",
          issueSummary: ["ledger-corrupt"],
          issues: [
            {
              id: "ledger-corrupt-1",
              code: "ledger-corrupt",
            },
          ],
          degradePolicySummary: "denied",
          expiresAt: Date.now() + 60_000,
        },
      })
      .mockResolvedValueOnce({
        status: "cancelled",
        launchAttemptId: "attempt-1",
        decision: "open-settings",
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

    expect(continuation).toBeNull();
    expect(dialogMocks.showAppChoice).toHaveBeenCalledTimes(1);
    expect(dialogMocks.showAppConfirm).toHaveBeenCalledTimes(1);
    expect(launchContinue).toHaveBeenNthCalledWith(1, {
      launchAttemptId: "attempt-1",
      decision: "degrade",
    });
    expect(launchContinue).toHaveBeenNthCalledWith(2, {
      launchAttemptId: "attempt-1",
      decision: "open-settings",
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
