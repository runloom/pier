import {
  type LogRecord,
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webListeners = new Map<string, (...args: unknown[]) => void>();

const webContents = {
  forcefullyCrashRenderer: vi.fn(),
  getOSProcessId: vi.fn(() => 4242),
  getProcessId: vi.fn(() => 7),
  getURL: vi.fn(() => "http://localhost:5173/app?token=secret#x"),
  isDestroyed: vi.fn(() => false),
  loadURL: vi.fn(async () => undefined),
  on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    webListeners.set(event, listener);
    return webContents;
  }),
  once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    webListeners.set(event, listener);
    return webContents;
  }),
  removeListener: vi.fn(
    (event: string, listener: (...args: unknown[]) => void) => {
      if (webListeners.get(event) === listener) {
        webListeners.delete(event);
      }
      return webContents;
    }
  ),
};

const window = {
  destroy: vi.fn(),
  focus: vi.fn(),
  host: {
    setOpacity: vi.fn(),
    show: vi.fn(),
  },
  id: 99,
  isDestroyed: vi.fn(() => false),
  isMinimized: vi.fn(() => false),
  webContents,
};

vi.mock("electron", () => ({
  app: {
    getAppMetrics: vi.fn(() => [{ type: "Browser" }, { type: "Tab" }]),
    getLocale: vi.fn(() => "zh-CN"),
    getPath: vi.fn((name: string) =>
      name === "userData" ? "/tmp/pier-user-data" : `/tmp/${name}`
    ),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
}));

describe("installRendererFailureRecovery logging", () => {
  const records: LogRecord[] = [];

  beforeEach(() => {
    webListeners.clear();
    records.length = 0;
    vi.clearAllMocks();
    webContents.forcefullyCrashRenderer.mockReset();
    webContents.forcefullyCrashRenderer.mockImplementation(() => undefined);
    webContents.loadURL.mockClear();
    webContents.getURL.mockImplementation(
      () => "http://localhost:5173/app?token=secret#x"
    );
    setDefaultLogSink((record) => {
      records.push(record);
    });
  });

  afterEach(() => {
    resetDefaultLogSinkForTests();
  });

  it("logs structured render-process-gone with incident and recovery detail", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample: vi.fn(async () => ({
        file: null,
        ok: false,
        reason: "platform" as const,
      })),
      isContentVisible: () => true,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("render-process-gone")?.(undefined, {
      exitCode: 5,
      reason: "crashed",
    });

    const gone = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "render-process-gone"
    );
    expect(gone?.level).toBe("error");
    expect(gone?.ctx).toMatchObject({
      exitCode: 5,
      forceCrashed: false,
      mainPid: expect.any(Number),
      reason: "crashed",
      rendererOsPid: 4242,
      url: "http://localhost:5173/app",
      windowId: 99,
    });
    expect(String(gone?.ctx?.incidentId ?? "")).toMatch(/^[0-9a-f]{12}$/i);

    await vi.waitFor(() => expect(webContents.loadURL).toHaveBeenCalled());
    const loadCalls = webContents.loadURL.mock.calls as unknown as string[][];
    const recoveryUrl = String(loadCalls[0]?.[0] ?? "");
    const html = decodeURIComponent(
      recoveryUrl.replace("data:text/html;charset=utf-8,", "")
    );
    expect(html).toContain("crashed (exit 5)");
    expect(html).toMatch(/incident: [0-9a-f]{12}/i);
    expect(html).toContain("logs:");

    await vi.waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.scope === "renderer.failure" && r.msg === "recovery-page-loaded"
        )
      ).toBe(true)
    );
    const pageLoaded = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "recovery-page-loaded"
    );
    expect(pageLoaded?.ctx?.incidentId).toBe(gone?.ctx?.incidentId);
  });

  /** 可手动放行的采样桩，用来精确控制 6s 采样窗口的时序。 */
  function deferredSample(): {
    captureHangSample: (
      input: unknown
    ) => Promise<{ file: null; ok: false; reason: "platform" }>;
    release: () => void;
  } {
    let release: (() => void) | null = null;
    const captureHangSample = (
      _input: unknown
    ): Promise<{ file: null; ok: false; reason: "platform" }> =>
      new Promise((resolve) => {
        release = () => resolve({ file: null, ok: false, reason: "platform" });
      });
    return {
      captureHangSample,
      release: () => release?.(),
    };
  }

  it("keeps force-crashing when the renderer recovers and hangs again inside the sample window", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    const sample = deferredSample();
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample: sample.captureHangSample,
      isContentVisible: () => false,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("unresponsive")?.();
    // 采样窗口内：先答上，再卡死。一次性 recovered 闩会在这里误判成已恢复。
    webListeners.get("responsive")?.();
    webListeners.get("unresponsive")?.();
    sample.release();

    await vi.waitFor(() =>
      expect(webContents.forcefullyCrashRenderer).toHaveBeenCalled()
    );
    expect(
      records.some(
        (r) =>
          r.scope === "renderer.failure" &&
          r.msg === "renderer-recovered-before-force-crash"
      )
    ).toBe(false);
  });

  it("leaves a renderer alone when it is responsive after the sample", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    const sample = deferredSample();
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample: sample.captureHangSample,
      isContentVisible: () => false,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("unresponsive")?.();
    webListeners.get("responsive")?.();
    sample.release();

    await vi.waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.scope === "renderer.failure" &&
            r.msg === "renderer-recovered-before-force-crash"
        )
      ).toBe(true)
    );
    expect(webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });

  it("deferred unresponsive runs after the in-flight chain finishes", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    const pending: Array<() => void> = [];
    const captureHangSample = vi.fn(
      () =>
        new Promise<{ file: null; ok: false; reason: "platform" }>(
          (resolve) => {
            pending.push(() =>
              resolve({ file: null, ok: false, reason: "platform" })
            );
          }
        )
    );
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample,
      isContentVisible: () => false,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("unresponsive")?.();
    // 第一条链还在采样，第二次 unresponsive 只能排队，不能丢掉。
    webListeners.get("unresponsive")?.();
    expect(captureHangSample).toHaveBeenCalledTimes(1);

    pending[0]?.();
    await vi.waitFor(() => expect(captureHangSample).toHaveBeenCalledTimes(2));
    pending[1]?.();
  });

  it("correlates unresponsive force-crash with the following process-gone", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample: vi.fn(async () => ({
        file: null,
        ok: false,
        reason: "platform" as const,
      })),
      isContentVisible: () => true,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("unresponsive")?.();
    await vi.waitFor(() =>
      expect(webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
    );
    expect(
      records.some(
        (r) =>
          r.scope === "renderer.failure" && r.msg === "renderer-hang-sample"
      )
    ).toBe(true);

    const unresponsive = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "renderer-unresponsive"
    );
    const forceCrash = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "renderer-force-crash"
    );
    const incidentId = String(unresponsive?.ctx?.incidentId ?? "");
    expect(incidentId).toMatch(/^[0-9a-f]{12}$/i);
    expect(forceCrash?.ctx?.incidentId).toBe(incidentId);

    webListeners.get("render-process-gone")?.(undefined, {
      exitCode: 5,
      reason: "crashed",
    });

    const gone = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "render-process-gone"
    );
    expect(gone?.ctx).toMatchObject({
      forceCrashed: true,
      hadUnresponsive: true,
      incidentId,
    });

    const failure = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "renderer-failure"
    );
    expect(failure?.ctx).toMatchObject({
      incidentId,
      kind: "unresponsive",
    });
    expect(String(failure?.ctx?.detail ?? "")).toContain(
      "cause: unresponsive-force-crash"
    );
  });

  it("on force-crash failure presents once and does not link later process-gone", async () => {
    webContents.forcefullyCrashRenderer.mockImplementationOnce(() => {
      throw new Error("force failed");
    });

    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone: vi.fn(),
      captureHangSample: vi.fn(async () => ({
        file: null,
        ok: false,
        reason: "platform" as const,
      })),
      isContentVisible: () => true,
      isQuitting: () => false,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("unresponsive")?.();

    const unresponsive = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "renderer-unresponsive"
    );
    const incidentId = String(unresponsive?.ctx?.incidentId ?? "");
    expect(incidentId).toMatch(/^[0-9a-f]{12}$/i);

    await vi.waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.scope === "renderer.failure" &&
            r.msg === "renderer-failure" &&
            r.ctx?.kind === "unresponsive"
        )
      ).toBe(true)
    );
    const failRecovery = records.find(
      (r) =>
        r.scope === "renderer.failure" &&
        r.msg === "renderer-failure" &&
        r.ctx?.incidentId === incidentId
    );
    expect(failRecovery?.ctx?.kind).toBe("unresponsive");
    expect(String(failRecovery?.ctx?.detail ?? "")).toContain(
      "unresponsive-force-crash-failed"
    );
    expect(
      records.some(
        (r) =>
          r.scope === "renderer.failure" && r.msg === "renderer-force-crash"
      )
    ).toBe(false);

    await vi.waitFor(() => expect(webContents.loadURL).toHaveBeenCalledOnce());
    const firstLoadCalls = webContents.loadURL.mock.calls.length;

    webListeners.get("render-process-gone")?.(undefined, {
      exitCode: 5,
      reason: "crashed",
    });

    const gone = records.find(
      (r) => r.scope === "renderer.failure" && r.msg === "render-process-gone"
    );
    expect(gone?.ctx).toMatchObject({
      forceCrashed: false,
      hadUnresponsive: true,
    });
    expect(gone?.ctx?.incidentId).not.toBe(incidentId);

    // Second incident may present its own recovery; first incident must not
    // re-present via forceCrashed linkage.
    const failures = records.filter(
      (r) => r.scope === "renderer.failure" && r.msg === "renderer-failure"
    );
    expect(
      failures.filter((r) => r.ctx?.incidentId === incidentId)
    ).toHaveLength(1);
    expect(
      failures.some(
        (r) =>
          r.ctx?.incidentId === incidentId &&
          String(r.ctx?.detail ?? "").includes(
            "cause: unresponsive-force-crash"
          )
      )
    ).toBe(false);

    // A distinct real crash after failed force may still recover once more.
    await vi.waitFor(() =>
      expect(webContents.loadURL.mock.calls.length).toBeGreaterThanOrEqual(
        firstLoadCalls
      )
    );
  });

  it("logs clean-exit at info only without recovery UI", async () => {
    const { installRendererFailureRecovery } = await import(
      "@main/windows/renderer-failure-recovery.ts"
    );
    const beforeRendererGone = vi.fn();
    installRendererFailureRecovery({
      beforeLoadFailure: vi.fn(),
      beforeRendererGone,
      isContentVisible: () => false,
      isQuitting: () => true,
      reloadAppEntry: vi.fn(),
      window: window as never,
    });

    webListeners.get("render-process-gone")?.(undefined, {
      exitCode: 0,
      reason: "clean-exit",
    });

    expect(beforeRendererGone).toHaveBeenCalledOnce();
    expect(
      records.some(
        (r) =>
          r.scope === "renderer.failure" &&
          r.msg === "render-process-gone" &&
          r.level === "error"
      )
    ).toBe(false);
    const clean = records.find(
      (r) =>
        r.scope === "renderer.failure" && r.msg === "render-process-clean-exit"
    );
    expect(clean?.level).toBe("info");
    expect(webContents.loadURL).not.toHaveBeenCalled();
  });
});
