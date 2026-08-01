import { PierDiffWorkerHost } from "@pier/ui/diff-view/worker.tsx";
import { type ReactNode, useMemo } from "react";
import { getShikiThemePair } from "@/lib/theme/preset-registry.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

/** App 级 Pierre worker 宿主：包住 workspace，hide/show remount 不冷启 pool。 */
export function DiffWorkerHost({ children }: { children: ReactNode }) {
  const stylePresetId = useThemeStore((state) => state.stylePresetId);
  // Dual-theme pair only depends on style preset. Light/dark is themeType on
  // CodeView — avoids worker setRenderOptions races on every mode toggle.
  const theme = useMemo(
    () => getShikiThemePair(stylePresetId),
    [stylePresetId]
  );
  return <PierDiffWorkerHost theme={theme}>{children}</PierDiffWorkerHost>;
}
