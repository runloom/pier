export type AppletChrome = "island" | "panel";

export function appletChrome(
  props: { chrome?: unknown; embedded?: unknown },
  fallback: AppletChrome
): AppletChrome {
  if (props.chrome === "island" || props.chrome === "panel") {
    return props.chrome;
  }
  if (props.embedded === true) {
    return "panel";
  }
  return fallback;
}

export function appletRootClass(chrome: AppletChrome): string {
  if (chrome === "island") {
    return "overflow-hidden rounded-xl border border-border/80 bg-background p-3";
  }
  return "h-full min-h-0 min-w-0 bg-background";
}

export function appletBodyClass(chrome: AppletChrome): string {
  if (chrome === "island") {
    return "max-h-[min(32rem,70vh)] overflow-auto";
  }
  return "min-h-0 flex-1 overflow-auto";
}
