import { Button } from "@pier/ui/button.tsx";
import i18next from "i18next";
import { CircleAlert, RotateCcw } from "lucide-react";

export interface StartupErrorScreenProps {
  error: unknown;
  onRetry?: () => void;
}

function formatStartupError(error: unknown, seen = new Set<unknown>()): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (seen.has(error)) {
    return `${error.name}: ${error.message} (repeated)`;
  }
  seen.add(error);
  const lines = [error.stack ?? `${error.name}: ${error.message}`];
  if (error instanceof AggregateError) {
    error.errors.forEach((item, index) => {
      lines.push(`\n[${index + 1}] ${formatStartupError(item, seen)}`);
    });
  }
  if (error.cause !== undefined) {
    lines.push(`\nCaused by: ${formatStartupError(error.cause, seen)}`);
  }
  return lines.join("\n").slice(0, 20_000);
}

export function StartupScreen() {
  const isChinese = document.documentElement.lang.startsWith("zh");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
        <span>{isChinese ? "正在启动 Pier…" : "Starting Pier…"}</span>
      </div>
    </main>
  );
}

function fallbackCopy() {
  const isChinese = document.documentElement.lang.startsWith("zh");
  return isChinese
    ? {
        description:
          "Pier 无法完成核心初始化。请重试；如果问题持续存在，请保留下面的错误详情。",
        details: "错误详情",
        retry: "重新加载",
        title: "Pier 启动失败",
      }
    : {
        description:
          "Pier could not finish core initialization. Retry, and keep the error details below if the problem continues.",
        details: "Error details",
        retry: "Reload",
        title: "Pier failed to start",
      };
}

function translatedCopy() {
  const fallback = fallbackCopy();
  if (!i18next.isInitialized) {
    return fallback;
  }
  return {
    description: i18next.t("workspace.startupError.description", {
      defaultValue: fallback.description,
    }),
    details: i18next.t("workspace.startupError.details", {
      defaultValue: fallback.details,
    }),
    retry: i18next.t("workspace.startupError.retry", {
      defaultValue: fallback.retry,
    }),
    title: i18next.t("workspace.startupError.title", {
      defaultValue: fallback.title,
    }),
  };
}

export function StartupErrorScreen({
  error,
  onRetry = () => window.location.reload(),
}: StartupErrorScreenProps) {
  const copy = translatedCopy();
  const detail = formatStartupError(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-base">{copy.title}</h1>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              {copy.description}
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-md border bg-muted/40 p-3">
          <div className="mb-1 font-medium text-muted-foreground text-xs">
            {copy.details}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
            {detail}
          </pre>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onRetry} size="sm" type="button">
            <RotateCcw aria-hidden className="size-4" />
            {copy.retry}
          </Button>
        </div>
      </section>
    </main>
  );
}
