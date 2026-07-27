/**
 * App-update ready notification copy (main-resolved at emit time).
 * titleKey still stored so inbox cards re-resolve after locale switch.
 */
export type AppUpdateUiLocale = "en" | "zh-CN";

export function formatAppUpdateReadyCopy(
  version: string,
  locale: AppUpdateUiLocale
): { body: string; title: string } {
  if (locale === "zh-CN") {
    return {
      body: `Pier ${version} · 重启后自动安装`,
      title: "更新已就绪",
    };
  }
  return {
    body: `Pier ${version} · restart to finish installing`,
    title: "Update ready",
  };
}
