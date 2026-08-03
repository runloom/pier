/**
 * Boot wiring for shell-env parity: prefs-gated PES, host apply, failure notify.
 * Extracted from app-core index to keep file-size under the hard cap.
 */
import { resolveAppUpdateUiLocale } from "../services/app-updates/ui-locale.ts";
import {
  createShellEnvFailureNotify,
  formatShellEnvFailureCopy,
} from "../services/process-environment/notify-failure.ts";
import {
  createProcessEnvironmentService,
  type ProcessEnvironmentDiagnostics,
  type ProcessEnvironmentService,
} from "../services/process-environment-service.ts";
import type { PierEventBus } from "./event-bus.ts";

export interface ShellEnvironmentBootInput {
  eventBus: PierEventBus;
  getFocusedWindow: () => unknown | null;
  ingestNotification: Parameters<
    typeof createShellEnvFailureNotify
  >[0]["ingest"];
  onWindowCreate: (cb: () => void) => void;
  onWindowFocus: (cb: () => void) => void;
  readPreferences: () => Promise<{
    shellEnvironment: { disabled: boolean; timeoutMs: number };
  }>;
}

export interface ShellEnvironmentBoot {
  hostShellEnvReady: Promise<ProcessEnvironmentDiagnostics>;
  processEnvironment: ProcessEnvironmentService;
  waitForHostEnv: () => Promise<void>;
}

export function createShellEnvironmentBoot(
  input: ShellEnvironmentBootInput
): ShellEnvironmentBoot {
  const shellEnvPrefsRef = {
    disabled: false,
    timeoutMs: 10_000,
  };
  // Block first host dump until disk prefs land (disabled / timeout).
  const shellEnvPrefsReady = input.readPreferences().then((prefs) => {
    shellEnvPrefsRef.disabled = prefs.shellEnvironment.disabled;
    shellEnvPrefsRef.timeoutMs = prefs.shellEnvironment.timeoutMs;
  });
  input.eventBus.subscribe((event) => {
    if (event.type !== "preferences.changed") {
      return;
    }
    if (!event.changedKeys.includes("shellEnvironment")) {
      return;
    }
    shellEnvPrefsRef.disabled = event.snapshot.shellEnvironment.disabled;
    shellEnvPrefsRef.timeoutMs = event.snapshot.shellEnvironment.timeoutMs;
  });

  const shellEnvBootId = `${process.pid}-${Date.now()}`;
  const shellEnvFailureNotify = createShellEnvFailureNotify({
    bootId: shellEnvBootId,
    getFocusedWindow: input.getFocusedWindow,
    ingest: input.ingestNotification,
    resolveCopy: async () => {
      // Main has no i18n runtime — resolve locale at deliver time (app-update pattern).
      const locale = await resolveAppUpdateUiLocale();
      return formatShellEnvFailureCopy(locale);
    },
  });
  input.onWindowFocus(() => {
    shellEnvFailureNotify.tryDeliver();
  });
  input.onWindowCreate(() => {
    shellEnvFailureNotify.tryDeliver();
  });

  const processEnvironment = createProcessEnvironmentService({
    getTimeoutMs: () => shellEnvPrefsRef.timeoutMs,
    isDisabled: () =>
      shellEnvPrefsRef.disabled ||
      process.env.PIER_FORCE_DISABLE_SHELL_ENV === "1",
    onShellEnvFailed: (diagnostics) => {
      shellEnvFailureNotify.onShellEnvFailed(diagnostics);
    },
  });

  // Route boot apply through the service so lastAppliedKeys is owned there.
  const hostShellEnvReady: Promise<ProcessEnvironmentDiagnostics> =
    (async () => {
      await shellEnvPrefsReady;
      const diagnostics = await processEnvironment.invalidate({
        reapplyHost: true,
      });
      // failed: onShellEnvFailed already scheduled notify; do not double-call.
      return (
        diagnostics ??
        processEnvironment.getHostDiagnostics() ?? {
          cacheHit: false,
          pathChanged: false,
          shellEnvStatus: "skipped" as const,
          source: "plugin" as const,
        }
      );
    })();

  return {
    hostShellEnvReady,
    processEnvironment,
    waitForHostEnv: () => hostShellEnvReady.then(() => undefined),
  };
}
