import { showAppAlert } from "@/stores/app-dialog.store.ts";

/** Surface Appearance font preference write failures (no silent catch). */
export function reportFontPreferenceUpdateFailure(
  title: string,
  error: unknown
): void {
  showAppAlert({
    body: error instanceof Error ? error.message : String(error),
    title,
  }).catch(() => undefined);
}
