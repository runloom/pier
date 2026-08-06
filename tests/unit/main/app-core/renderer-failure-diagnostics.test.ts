import {
  createRendererFailureIncidentId,
  createRendererFailureIncidentTracker,
  formatRendererCrashDetail,
  RENDERER_FORCE_CRASH_LINK_MS,
  rendererFailureLogCtx,
  sanitizeRendererFailureUrl,
} from "@main/windows/renderer-failure-diagnostics.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("renderer-failure-diagnostics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates compact incident ids", () => {
    const id = createRendererFailureIncidentId();
    expect(id).toMatch(/^[0-9a-f]{12}$/i);
    expect(createRendererFailureIncidentId()).not.toBe(id);
  });

  it("strips query and hash from failure URLs", () => {
    expect(
      sanitizeRendererFailureUrl(
        "https://app.example/work?token=secret#panel=1"
      )
    ).toBe("https://app.example/work");
    expect(sanitizeRendererFailureUrl("data:text/html,huge")).toBe("data:...");
    expect(sanitizeRendererFailureUrl("")).toBeNull();
  });

  it("formats crash detail with incident and optional diagnostics path", () => {
    expect(
      formatRendererCrashDetail({
        diagnosticsDir: null,
        exitCode: 5,
        forceCrashed: false,
        incidentId: "abc123def456",
        reason: "crashed",
      })
    ).toBe("crashed (exit 5)\nincident: abc123def456");

    expect(
      formatRendererCrashDetail({
        diagnosticsDir: "/tmp/pier/diagnostics",
        exitCode: 5,
        forceCrashed: true,
        incidentId: "abc123def456",
        reason: "crashed",
      })
    ).toBe(
      [
        "crashed (exit 5)",
        "incident: abc123def456",
        "cause: unresponsive-force-crash",
        "logs: /tmp/pier/diagnostics",
      ].join("\n")
    );
  });

  it("links force-crash to the subsequent process-gone event", () => {
    vi.useFakeTimers();
    const tracker = createRendererFailureIncidentTracker();
    const unresponsive = tracker.beginUnresponsive();
    tracker.markForceCrashAttempt(unresponsive.incidentId);
    vi.advanceTimersByTime(50);
    const gone = tracker.resolveForProcessGone();
    expect(gone).toEqual({
      forceCrashed: true,
      hadUnresponsive: true,
      incidentId: unresponsive.incidentId,
    });
  });

  it("does not link force-crash after the link window expires", () => {
    vi.useFakeTimers();
    const tracker = createRendererFailureIncidentTracker();
    const unresponsive = tracker.beginUnresponsive();
    tracker.markForceCrashAttempt(unresponsive.incidentId);
    vi.advanceTimersByTime(RENDERER_FORCE_CRASH_LINK_MS + 1);
    const gone = tracker.resolveForProcessGone();
    expect(gone.forceCrashed).toBe(false);
    expect(gone.incidentId).not.toBe(unresponsive.incidentId);
  });

  it("clearPendingForceCrash drops a pending link", () => {
    const tracker = createRendererFailureIncidentTracker();
    const unresponsive = tracker.beginUnresponsive();
    tracker.markForceCrashAttempt(unresponsive.incidentId);
    tracker.clearPendingForceCrash();
    const gone = tracker.resolveForProcessGone();
    expect(gone.forceCrashed).toBe(false);
    expect(gone.hadUnresponsive).toBe(true);
    expect(gone.incidentId).not.toBe(unresponsive.incidentId);
  });

  it("builds structured log context with main-process metric names", () => {
    const ctx = rendererFailureLogCtx(
      {
        forceCrashed: true,
        hadUnresponsive: true,
        incidentId: "deadbeefcafe",
      },
      {
        arch: "arm64",
        chrome: "120.0.0",
        diagnosticsDir: "/tmp/diagnostics",
        electron: "43.0.0",
        isDev: true,
        mainHeapUsedMb: 40,
        mainPid: 123,
        mainRssMb: 200,
        platform: "darwin",
        processCount: 4,
        processTypes: { Browser: 1, Tab: 3 },
        rendererOsPid: 456,
        rendererPid: 2,
        uptimeSec: 12,
        url: "http://localhost:5173/",
        visible: true,
        windowId: 7,
      },
      { exitCode: 5, reason: "crashed" }
    );
    expect(ctx).toMatchObject({
      exitCode: 5,
      forceCrashed: true,
      hadUnresponsive: true,
      incidentId: "deadbeefcafe",
      mainPid: 123,
      mainRssMb: 200,
      reason: "crashed",
      rendererOsPid: 456,
      windowId: 7,
    });
    expect(ctx).not.toHaveProperty("pid");
    expect(ctx).not.toHaveProperty("rssMb");
  });
});
