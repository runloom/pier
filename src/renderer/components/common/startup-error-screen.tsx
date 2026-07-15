import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { StatusIcon } from "@pier/ui/status-icon.tsx";
import i18next from "i18next";
import { RotateCcw } from "lucide-react";

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
        <Spinner aria-hidden />
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

function retryStartup(): void {
  const relaunch = window.pier?.app?.relaunch;
  if (relaunch) {
    // Pier 窗口是 BaseWindow + WebContentsView。dev 下真正的 soft restart
    // 走 main 侧 webContents.reload()（见 performDevSoftRelaunch）；
    // location.reload() 在这条路径上不可靠，会出现“点了没反应”。
    relaunch().catch((error: unknown) => {
      console.error("[pier] startup relaunch failed:", error);
      window.location.reload();
    });
    return;
  }
  window.location.reload();
}

export function StartupErrorScreen({
  error,
  onRetry = retryStartup,
}: StartupErrorScreenProps) {
  const copy = translatedCopy();
  const detail = formatStartupError(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="flex max-h-[min(80vh,36rem)] w-full max-w-xl">
        <CardHeader className="shrink-0">
          <div className="flex items-start gap-3">
            <StatusIcon className="mt-0.5" kind="error" />
            <div className="min-w-0 flex-1">
              <CardTitle>
                <h1>{copy.title}</h1>
              </CardTitle>
              <p className="mt-2 text-muted-foreground text-sm leading-6">
                {copy.description}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent
          className="min-h-0 flex-1 overflow-y-auto px-0"
          data-scrollbar="stable"
        >
          <div className="px-(--card-spacing)">
            <div className="font-medium text-foreground text-sm">
              {copy.details}
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs leading-5">
              {detail}
            </pre>
          </div>
        </CardContent>
        <CardFooter className="shrink-0 justify-end">
          <Button onClick={onRetry} size="sm" type="button">
            <RotateCcw aria-hidden data-icon="inline-start" />
            {copy.retry}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
