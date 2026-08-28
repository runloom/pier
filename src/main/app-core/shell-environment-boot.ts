/**
 * Boot wiring for shell-env parity: prefs-gated PES, host apply, soft degrade.
 * Extracted from app-core index to keep file-size under the hard cap.
 *
 * Soft degrade (industry practice): dump failure does not block boot; host
 * keeps process.env. User-facing status is Settings → Terminal only — no
 * notification-center row and no toast by default.
 */
import { createLogger } from "@shared/logger.ts";
import { getNotificationCenterService } from "../ipc/notification-center.ts";
import { maybeInstallPackagedCliOnPath } from "../services/app-cli/index.ts";
import {
  createShellEnvFailureNotify,
  SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX,
} from "../services/process-environment/notify-failure.ts";
import {
  createProcessEnvironmentService,
  type ProcessEnvironmentDiagnostics,
  type ProcessEnvironmentService,
} from "../services/process-environment-service.ts";
import type { PierEventBus } from "./event-bus.ts";

export interface ShellEnvironmentBootInput {
  eventBus: PierEventBus;
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
  // Log-only controller: no NCS ingest (settings page is the UX surface).
  const shellEnvFailureNotify = createShellEnvFailureNotify({
    bootId: shellEnvBootId,
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
      // failed: onShellEnvFailed already logged; do not NCS-notify.
      // Drop legacy shell-env inbox rows (pre soft-degrade product default).
      try {
        const ncs = await getNotificationCenterService();
        ncs?.removeWhere(
          (item) =>
            typeof item.dedupeKey === "string" &&
            item.dedupeKey.startsWith(SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX)
        );
      } catch {
        // NCS may not be ready yet; ignore.
      }
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

  hostShellEnvReady
    .catch(() => undefined)
    .finally(() => {
      maybeInstallPackagedCliOnPath().catch((error: unknown) => {
        createLogger("app-cli").warn("auto-install skipped", { error });
      });
    });

  return {
    hostShellEnvReady,
    processEnvironment,
    waitForHostEnv: () => hostShellEnvReady.then(() => undefined),
  };
}

/** Git/LSP inherit the project dump at `cwd` (Zed: binary + project env). */
export async function resolvePathEnv(
  processEnvironment: ProcessEnvironmentService,
  cwd: string
): Promise<Record<string, string>> {
  const { env } = await processEnvironment.resolve({
    cwd,
    projectRootPath: cwd,
    source: "plugin",
  });
  return env;
}
