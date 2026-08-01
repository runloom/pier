import { StatusStack } from "@pier/ui/status-stack.tsx";
import { cleanup, render } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSkillsImportStatusItems } from "@/pages/settings/components/skills/build-import-status-items.ts";

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts?.id) {
    return `${key}:${String(opts.id)}`;
  }
  if (opts?.count !== undefined) {
    return `${key}:${String(opts.count)}`;
  }
  if (opts?.keys) {
    return `${key}:${String(opts.keys)}`;
  }
  return key;
}) as unknown as TFunction;

const noop = () => undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("buildSkillsImportStatusItems", () => {
  it("returns empty when there is nothing to surface", () => {
    expect(
      buildSkillsImportStatusItems({
        actionBlocked: false,
        conflict: false,
        expired: false,
        reloadRequired: false,
        skillId: "demo",
        t,
      })
    ).toEqual([]);
  });

  it("stacks risk + conflict in one shell with warning and destructive tones", () => {
    const items = buildSkillsImportStatusItems({
      actionBlocked: false,
      conflict: true,
      expired: false,
      onConflictResolve: noop,
      reloadRequired: true,
      riskSummary: {
        executables: ["scripts/run.sh"],
        dynamicCommandTraces: [],
        riskFrontmatter: {},
      },
      skillId: "demo-skill",
      t,
    });

    expect(items.map((item) => item.id)).toEqual([
      "skills-import-risk",
      "skills-import-conflict",
    ]);
    expect(
      items.find((item) => item.id === "skills-import-risk")
    ).toMatchObject({
      tone: "warning",
      title: "settings.skills.riskTitle",
    });
    expect(
      items.find((item) => item.id === "skills-import-conflict")
    ).toMatchObject({
      tone: "destructive",
      title: "settings.skills.conflictExists:demo-skill",
      action: { label: "settings.skills.reloadAndReturn" },
    });
    // conflict wins over reload when both flags are set
    expect(items.some((item) => item.id === "skills-import-reload")).toBe(
      false
    );

    render(
      <StatusStack data-testid="skills-import-status-stack" items={items} />
    );

    expect(
      document.querySelectorAll('[data-testid="skills-import-status-stack"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(2);
    expect(
      document.querySelectorAll(
        '[data-slot="status-stack-item"][data-tone="warning"]'
      )
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        '[data-slot="status-stack-item"][data-tone="destructive"]'
      )
    ).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("keeps conflict and reload mutually exclusive", () => {
    const reloadOnly = buildSkillsImportStatusItems({
      actionBlocked: false,
      conflict: false,
      expired: false,
      onConflictResolve: noop,
      reloadRequired: true,
      skillId: "demo",
      t,
    });
    expect(reloadOnly.map((item) => item.id)).toEqual(["skills-import-reload"]);
    expect(reloadOnly[0]).toMatchObject({
      tone: "destructive",
      action: { label: "settings.skills.reloadAndReturn" },
    });

    const conflictWins = buildSkillsImportStatusItems({
      actionBlocked: false,
      conflict: true,
      expired: false,
      reloadRequired: true,
      skillId: "demo",
      t,
    });
    expect(conflictWins.map((item) => item.id)).toEqual([
      "skills-import-conflict",
    ]);
  });

  it("includes action-blocked and expired as destructive items", () => {
    const items = buildSkillsImportStatusItems({
      actionBlocked: true,
      conflict: false,
      expired: true,
      reloadRequired: false,
      skillId: "demo",
      t,
    });
    expect(items.map((item) => item.id)).toEqual([
      "skills-import-action-blocked",
      "skills-import-expired",
    ]);
    expect(items.every((item) => item.tone === "destructive")).toBe(true);
  });
});
