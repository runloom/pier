import { PierDiffWorkerHost } from "@pier/ui/diff-view-worker.tsx";
import type { ReactNode } from "react";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

/** App 级 Pierre worker 宿主：包住 workspace，hide/show remount 不冷启 pool。 */
export function DiffWorkerHost({ children }: { children: ReactNode }) {
  const stylePresetId = useThemeStore((state) => state.stylePresetId);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const theme =
    getShikiTheme(stylePresetId, resolvedTheme).name ?? stylePresetId;
  return <PierDiffWorkerHost theme={theme}>{children}</PierDiffWorkerHost>;
}
