import { StatusStack } from "@pier/ui/status-stack.tsx";
import { cleanup, render } from "@testing-library/react";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSkillsProjectStatusItems } from "@/pages/settings/components/skills/build-skills-project-status-items.ts";
import {
  notifyRecentImportSuccess,
  resolveImportSuccessName,
} from "@/pages/settings/components/skills/skills-apply-flow.ts";

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.name ? `${key}:${String(opts.name)}` : key) as unknown as TFunction;

const noop = () => undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildSkillsProjectStatusItems", () => {
  it("returns empty when there is nothing to surface", () => {
    expect(
      buildSkillsProjectStatusItems({
        errorMessage: null,
        lastApplyOutcome: null,
        loadStatus: "ready",
        onCopyGitIgnore: noop,
        onDismissSessionRefresh: noop,
        onReload: noop,
        onRepair: noop,
        onRetryOperation: noop,
        reloadRequired: false,
        riskyGitStates: [],
        sessionRefreshHint: false,
        t,
        writesDisabled: false,
        writesFrozen: false,
      })
    ).toEqual([]);
  });

  it("stacks session refresh and git risk in one shell without alert roots", () => {
    const items = buildSkillsProjectStatusItems({
      errorMessage: null,
      lastApplyOutcome: null,
      loadStatus: "ready",
      onCopyGitIgnore: noop,
      onDismissSessionRefresh: noop,
      onReload: noop,
      onRepair: noop,
      onRetryOperation: noop,
      reloadRequired: false,
      riskyGitStates: [
        { relativeTarget: ".agents/skills/demo", state: "untracked" },
      ],
      sessionRefreshHint: true,
      t,
      writesDisabled: false,
      writesFrozen: false,
    });

    expect(items.map((item) => item.id)).toEqual([
      "skills-git",
      "skills-session-refresh",
    ]);
    expect(
      items.find((item) => item.id === "skills-session-refresh")
    ).toMatchObject({
      tone: "info",
      dismissible: true,
    });
    expect(items.find((item) => item.id === "skills-git")).toMatchObject({
      tone: "warning",
    });

    render(
      <StatusStack data-testid="skills-project-status-stack" items={items} />
    );

    expect(
      document.querySelectorAll('[data-testid="skills-project-status-stack"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("maps reload, degraded, and frozen banner tones", () => {
    expect(
      buildSkillsProjectStatusItems({
        errorMessage: null,
        lastApplyOutcome: null,
        loadStatus: "ready",
        onCopyGitIgnore: noop,
        onDismissSessionRefresh: noop,
        onReload: noop,
        onRepair: noop,
        onRetryOperation: noop,
        reloadRequired: true,
        riskyGitStates: [],
        sessionRefreshHint: false,
        t,
        writesDisabled: true,
        writesFrozen: false,
      })[0]
    ).toMatchObject({
      id: "skills-banner",
      tone: "warning",
      title: "settings.skills.reloadRequired",
    });

    expect(
      buildSkillsProjectStatusItems({
        errorMessage: null,
        lastApplyOutcome: "degraded",
        loadStatus: "ready",
        onCopyGitIgnore: noop,
        onDismissSessionRefresh: noop,
        onReload: noop,
        onRepair: noop,
        onRetryOperation: noop,
        reloadRequired: false,
        riskyGitStates: [],
        sessionRefreshHint: false,
        t,
        writesDisabled: false,
        writesFrozen: false,
      })[0]
    ).toMatchObject({
      id: "skills-degraded",
      tone: "warning",
    });

    expect(
      buildSkillsProjectStatusItems({
        errorMessage: null,
        lastApplyOutcome: null,
        loadStatus: "ready",
        onCopyGitIgnore: noop,
        onDismissSessionRefresh: noop,
        onReload: noop,
        onRepair: noop,
        onRetryOperation: noop,
        reloadRequired: false,
        riskyGitStates: [],
        sessionRefreshHint: false,
        t,
        writesDisabled: true,
        writesFrozen: true,
      })[0]
    ).toMatchObject({
      id: "skills-banner",
      tone: "default",
      title: "settings.skills.applyIndeterminate",
    });
  });
});

describe("notifyRecentImportSuccess", () => {
  it("fires toast.success with import title only", () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);

    notifyRecentImportSuccess("demo-skill", t);

    expect(success).toHaveBeenCalledWith(
      "settings.skills.importAddedTitle:demo-skill"
    );
    expect(success.mock.calls[0]?.[1]).toBeUndefined();
  });
});

describe("resolveImportSuccessName", () => {
  it("reads candidate name before candidates map is cleared", () => {
    const name = resolveImportSuccessName(
      { importTokens: ["tok-1"] } as never,
      {
        "tok-1": {
          name: "Demo",
          skillId: "demo",
          sourceKind: "local-import",
        },
      }
    );
    expect(name).toBe("Demo");
  });

  it("returns null when candidates were already cleared", () => {
    expect(
      resolveImportSuccessName({ importTokens: ["tok-1"] } as never, {})
    ).toBeNull();
  });
});
