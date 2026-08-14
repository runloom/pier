/**
 * Map system-skill provider ids to product-facing labels.
 * Internal ids like `pier.app` must not appear in the UI.
 */
export function pierHomeSystemProviderLabel(
  providerId: string,
  t: (key: string) => string
): string {
  if (providerId === "pier.app" || providerId === "pier.home") {
    return t("settings.projects.pierHomeSystemProviderApp");
  }
  return providerId;
}
