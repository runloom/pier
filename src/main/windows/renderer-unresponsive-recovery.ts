import type { Logger } from "@shared/logger.ts";
import { app } from "electron";
import { getHangBreadcrumbsForDiagnostics } from "../ipc/renderer-hang-breadcrumb-store.ts";
import type { AppWindow } from "./app-window.ts";
import {
  formatRendererCrashDetail,
  type RendererFailureIncidentTracker,
  rendererFailureLogCtx,
} from "./renderer-failure-diagnostics.ts";
import {
  type CaptureRendererHangSampleInput,
  captureRendererHangSample,
  findRendererProcessMetric,
  type RendererHangSampleResult,
  type RendererProcessMetricSnapshot,
} from "./renderer-hang-capture.ts";
import type { RendererFailureRecovery } from "./renderer-resource-failure.ts";

/**
 * 无响应（`unresponsive`）处理链：取证 → 判断是否仍在卡 → force-crash。
 *
 * 这条链单独成模块有两个原因：
 * - 采样窗口现在最长 6 秒，窗口内的重入、恢复、再卡死都需要显式状态机；
 * - 宿主恢复主流程只关心「何时挂载恢复页」，不该被采样细节撑大。
 */

export interface UnresponsiveHandlerDeps {
  captureHangSample?(
    input: CaptureRendererHangSampleInput
  ): Promise<RendererHangSampleResult>;
  incidents: RendererFailureIncidentTracker;
  isQuitting(): boolean;
  log: Logger;
  recovery: RendererFailureRecovery;
  /** 和 `renderer-unresponsive` 日志同一份快照。 */
  snapshotFor(): Parameters<typeof rendererFailureLogCtx>[1];
  window: AppWindow;
}

export interface UnresponsiveHandler {
  /** `unresponsive` 事件：串行执行，窗口内重入会排队重跑一次；同时也是「又卡住了」的信号。 */
  handle(): void;
  /** `responsive` 事件：只更新状态，不结束处理链。 */
  noteResponsive(): void;
}

export function createUnresponsiveHandler(
  deps: UnresponsiveHandlerDeps
): UnresponsiveHandler {
  const { incidents, isQuitting, log, recovery, snapshotFor, window } = deps;
  const captureHangSample = deps.captureHangSample ?? captureRendererHangSample;

  /**
   * renderer 当前是否仍处于无响应状态。`responsive` 只证明「某一刻答上了」，
   * 不能当成终止闩：采样窗口内先恢复再卡死时，闩会把仍冻着的窗口判成已恢复。
   */
  let responsive = true;
  let inFlight = false;
  let rearm = false;

  const forceCrashAfterSample = (
    incident: ReturnType<RendererFailureIncidentTracker["beginUnresponsive"]>,
    snapshot: ReturnType<UnresponsiveHandlerDeps["snapshotFor"]>
  ): void => {
    if (isQuitting() || window.isDestroyed()) {
      return;
    }
    try {
      if (
        window.webContents.isDestroyed() ||
        window.webContents.getOSProcessId() === 0
      ) {
        return;
      }
    } catch {
      return;
    }
    try {
      // Kill the hung process so we can load a recovery document that the
      // user can interact with (reload / close) without waiting forever.
      // Mark the link only after a successful call so a throw cannot leave a
      // stale pending force-crash that mis-attributes a later process-gone.
      window.webContents.forcefullyCrashRenderer();
      incidents.markForceCrashAttempt(incident.incidentId);
      log.error("renderer-force-crash", {
        incidentId: incident.incidentId,
        windowId: window.id,
      });
    } catch (error) {
      incidents.clearPendingForceCrash();
      log.error("force-crash-failed", {
        incidentId: incident.incidentId,
        message: error instanceof Error ? error.message : String(error),
        windowId: window.id,
      });
      recovery.report({
        detail: formatRendererCrashDetail({
          diagnosticsDir: snapshot.diagnosticsDir,
          exitCode: -1,
          forceCrashed: false,
          incidentId: incident.incidentId,
          reason: "unresponsive-force-crash-failed",
        }),
        incidentId: incident.incidentId,
        kind: "unresponsive",
      });
    }
  };

  const run = async (): Promise<void> => {
    const incident = incidents.beginUnresponsive();
    const snapshot = snapshotFor();
    // Breadcrumbs flushed earlier via IPC; ring is oldest→newest. Dump the
    // newest N only so diagnostics array sanitization cannot drop the tail.
    const hangBreadcrumbs = getHangBreadcrumbsForDiagnostics(window.id);
    let rendererMetrics: RendererProcessMetricSnapshot | null = null;
    try {
      rendererMetrics = findRendererProcessMetric(
        app.getAppMetrics(),
        snapshot.rendererOsPid
      );
    } catch {
      // Metrics are best-effort; the incident still gets logged.
    }
    log.error(
      "renderer-unresponsive",
      rendererFailureLogCtx(incident, snapshot, undefined, {
        hangBreadcrumbCount: hangBreadcrumbs.length,
        hangBreadcrumbs,
        ...(rendererMetrics === null ? {} : { rendererMetrics }),
      })
    );

    // Capture a native stack before force-crash destroys the process. The
    // sampler is bounded; a renderer that recovers meanwhile is left alone.
    //
    // 采样窗口（最长 6s，见 renderer-hang-capture）内不要碰 webContents：
    // 主线程卡死时 data: 恢复页同样要排队渲染，loadURL 可能永不落定；
    // 早挂恢复页既救不了当场，又会在「采样期间自己恢复」时把健康页面顶掉。
    const sample = await captureHangSample({
      diagnosticsDir: snapshot.diagnosticsDir,
      incidentId: incident.incidentId,
      pid: snapshot.rendererOsPid,
    });
    // 判断依据是「此刻是否仍无响应」，不是一次性的闩：
    // 采样窗口内先恢复、再卡死的 renderer 必须继续走 force-crash，
    // 否则日志会写「已恢复」而窗口其实还冻着。
    const stillHanging = !responsive;
    log.error("renderer-hang-sample", {
      incidentId: incident.incidentId,
      ok: sample.ok,
      ...(sample.file === null ? {} : { file: sample.file }),
      ...(sample.reason === undefined ? {} : { reason: sample.reason }),
      ...(sample.error === undefined ? {} : { error: sample.error }),
      windowId: window.id,
      ...(stillHanging ? {} : { recoveredBeforeForceCrash: true }),
    });
    if (!stillHanging) {
      log.info("renderer-recovered-before-force-crash", {
        incidentId: incident.incidentId,
        windowId: window.id,
      });
      return;
    }
    forceCrashAfterSample(incident, snapshot);
  };

  /**
   * 同一时刻只允许一条处理链。采样窗口内再触发 `unresponsive` 会另起
   * 采样与 force-crash 路径，两条链交错时后到的那条可能在恢复页加载后
   * 重启进程，把取证记录撕成两个事故。
   *
   * 被挡下的那次不能直接丢掉：Electron 对同一段卡顿只发一次 `unresponsive`，
   * 丢掉就等于把窗口留在无响应状态。记下来，等当前链结束后重跑一遍。
   */
  const handleDeferred = (): void => {
    if (inFlight) {
      rearm = true;
      log.info("renderer-unresponsive-deferred", {
        reason: "in-flight",
        windowId: window.id,
      });
      return;
    }
    if (isQuitting() || window.isDestroyed()) {
      return;
    }
    inFlight = true;
    run()
      .catch((error: unknown) => {
        log.error("unresponsive-handler-failed", {
          message: error instanceof Error ? error.message : String(error),
          windowId: window.id,
        });
        try {
          if (!(isQuitting() || window.isDestroyed())) {
            window.webContents.forcefullyCrashRenderer();
          }
        } catch {
          // Recovery already failed; nothing else can be done here.
        }
      })
      .finally(() => {
        inFlight = false;
        if (!rearm) {
          return;
        }
        rearm = false;
        if (!(isQuitting() || window.isDestroyed())) {
          handleDeferred();
        }
      });
  };

  return {
    handle: () => {
      // 每次 `unresponsive` 都是一次「此刻没答上」的采样。
      responsive = false;
      handleDeferred();
    },
    noteResponsive: () => {
      responsive = true;
    },
  };
}
