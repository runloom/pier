import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { StatusIcon } from "@pier/ui/status-icon.tsx";
import i18next from "i18next";
import { RotateCcw } from "lucide-react";

export interface StartupErrorScreenProps {
  error: unknown;
  kind?: "runtime" | "startup";
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

function fallbackCopy(kind: "runtime" | "startup") {
  const isChinese = document.documentElement.lang.startsWith("zh");
  if (kind === "runtime") {
    return isChinese
      ? {
          description: "终端会话已保留，请重新加载。",
          retry: "重新加载",
          title: "界面出现错误",
        }
      : {
          description: "Terminal sessions are preserved. Reload to continue.",
          retry: "Reload",
          title: "Interface error",
        };
  }
  return isChinese
    ? {
        description: "请重新加载后再试。",
        retry: "重新加载",
        title: "Pier 启动失败",
      }
    : {
        description: "Reload to try again.",
        retry: "Reload",
        title: "Pier failed to start",
      };
}

function translatedCopy(kind: "runtime" | "startup") {
  const fallback = fallbackCopy(kind);
  if (!i18next.isInitialized) {
    return fallback;
  }
  const key = kind === "runtime" ? "runtimeError" : "startupError";
  return {
    description: i18next.t(`workspace.${key}.description`, {
      defaultValue: fallback.description,
    }),
    retry: i18next.t(`workspace.${key}.retry`, {
      defaultValue: fallback.retry,
    }),
    title: i18next.t(`workspace.${key}.title`, {
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
  kind = "startup",
  onRetry = retryStartup,
}: StartupErrorScreenProps) {
  const copy = translatedCopy(kind);
  const detail = formatStartupError(error);

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <Empty className="rounded-none p-6">
        <EmptyHeader>
          <EmptyMedia>
            <StatusIcon kind="error" />
          </EmptyMedia>
          <EmptyTitle>
            <h1>{copy.title}</h1>
          </EmptyTitle>
          <EmptyDescription>{copy.description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-xl">
          <pre
            className="max-h-[min(50vh,20rem)] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-left font-mono text-muted-foreground text-xs leading-5"
            data-scrollbar="stable"
          >
            {detail}
          </pre>
          <Button onClick={onRetry} size="sm" type="button">
            <RotateCcw aria-hidden data-icon="inline-start" />
            {copy.retry}
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
