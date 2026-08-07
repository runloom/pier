// @vitest-environment node
import {
  __resetHangBreadcrumbsForTests,
  clearHangBreadcrumbsForWindow,
  getHangBreadcrumbsForDiagnostics,
  getHangBreadcrumbsForWindow,
  normalizeHangBreadcrumbBatch,
  rememberHangBreadcrumb,
} from "@main/ipc/renderer-hang-breadcrumb.ts";
import {
  clampHangBreadcrumbPath,
  HANG_BREADCRUMB_DIAGNOSTICS_MAX,
  HANG_BREADCRUMB_PATH_MAX,
  rendererHangBreadcrumbSchema,
} from "@shared/contracts/renderer-hang-breadcrumb.ts";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  __resetHangBreadcrumbsForTests();
});

describe("renderer hang breadcrumbs", () => {
  it("accepts panel-close, panel-activate, command, and files-conflict", () => {
    expect(
      rendererHangBreadcrumbSchema.safeParse({
        kind: "panel-close",
        phase: "start",
        commandId: "pier.panel.closeActive",
        activePanelComponent: "pier.files.filePanel",
        panelId: "pier.files.filePanel:disk:x",
        detail: "closeActive",
      }).success
    ).toBe(true);
  });

  it("clamps long paths so deep monorepo crumbs still parse", () => {
    const deep = `src/${"very/".repeat(80)}file.ts`;
    expect(deep.length).toBeGreaterThan(HANG_BREADCRUMB_PATH_MAX);
    const clamped = clampHangBreadcrumbPath(deep);
    expect(clamped?.length).toBe(HANG_BREADCRUMB_PATH_MAX);
    const crumbs = normalizeHangBreadcrumbBatch([
      {
        kind: "files-conflict",
        phase: "state",
        path: deep,
        detail: "empty-state",
      },
    ]);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]?.path?.length).toBe(HANG_BREADCRUMB_PATH_MAX);
  });

  it("keeps valid crumbs when a batch item is invalid", () => {
    const crumbs = normalizeHangBreadcrumbBatch([
      { kind: "mark", detail: "ok-1" },
      { kind: "not-a-kind", detail: "bad" },
      { kind: "heartbeat", phase: "tick", detail: "alive-2" },
    ]);
    expect(crumbs).toHaveLength(2);
    expect(crumbs.map((c) => c.detail)).toEqual(["ok-1", "alive-2"]);
  });

  it("dumps newest diagnostics crumbs when ring is full", () => {
    for (let i = 0; i < HANG_BREADCRUMB_DIAGNOSTICS_MAX + 20; i++) {
      rememberHangBreadcrumb(7, {
        kind: "mark",
        detail: `n-${i}`,
        receivedAt: 1000 + i,
      });
    }
    const all = getHangBreadcrumbsForWindow(7);
    expect(all).toHaveLength(HANG_BREADCRUMB_DIAGNOSTICS_MAX);
    expect(all[0]?.detail).toBe("n-20");
    expect(all.at(-1)?.detail).toBe(
      `n-${HANG_BREADCRUMB_DIAGNOSTICS_MAX + 19}`
    );

    const forDiag = getHangBreadcrumbsForDiagnostics(7);
    expect(forDiag).toHaveLength(HANG_BREADCRUMB_DIAGNOSTICS_MAX);
    expect(forDiag[0]?.detail).toBe(all[0]?.detail);
    expect(forDiag.at(-1)?.detail).toBe(all.at(-1)?.detail);

    clearHangBreadcrumbsForWindow(7);
    expect(getHangBreadcrumbsForWindow(7)).toEqual([]);
  });
});
