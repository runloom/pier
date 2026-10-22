import { PierDiffWorkerHost } from "@pier/ui/diff-view/worker.tsx";
import { type ReactNode, useCallback, useMemo } from "react";
import { noteHangBreadcrumb } from "@/lib/diagnostics/hang-breadcrumb.ts";
import { getShikiThemePair } from "@/lib/theme/preset-registry.ts";
import { ensureCustomShikiThemesRegistered } from "@/lib/theme/register-custom-themes.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

// Register vendored TextMate themes (Tokyo Night Light) before pool resolves names.
ensureCustomShikiThemesRegistered();

/** App 级 Pierre worker 宿主：包住 workspace，hide/show remount 不冷启 pool。 */
export function DiffWorkerHost({ children }: { children: ReactNode }) {
  const stylePresetId = useThemeStore((state) => state.stylePresetId);
  // Dual-theme pair only depends on style preset. Light/dark is themeType on
  // CodeView — avoids worker setRenderOptions races on every mode toggle.
  const theme = useMemo(
    () => getShikiThemePair(stylePresetId),
    [stylePresetId]
  );
  const handleWorkerError = useCallback((error: Error) => {
    noteHangBreadcrumb({
      kind: "mark",
      phase: "state",
      detail: `diff-worker-error: ${error.message.slice(0, 100)}`,
    });
    console.error("[diff-worker]", error);
  }, []);
  const handleWorkerUnavailable = useCallback((reason: string) => {
    noteHangBreadcrumb({
      kind: "mark",
      phase: "state",
      detail: `diff-worker-unavailable: ${reason.slice(0, 100)}`,
    });
  }, []);
  return (
    <PierDiffWorkerHost
      onError={handleWorkerError}
      onUnavailable={handleWorkerUnavailable}
      theme={theme}
    >
      {children}
    </PierDiffWorkerHost>
  );
}
