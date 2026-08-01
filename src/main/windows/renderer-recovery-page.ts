import type { WebContents } from "electron";

export const PIER_RECOVERY_RELOAD_URL = "pier-recovery://reload/";
export const PIER_RECOVERY_CLOSE_URL = "pier-recovery://close/";

export type RendererRecoveryKind =
  | "crash"
  | "unresponsive"
  | "load"
  | "preload";

export interface RendererRecoveryCopy {
  closeLabel: string;
  detail: string;
  message: string;
  reloadLabel: string;
  title: string;
}

export function isRendererRecoveryUrl(url: string | undefined | null): boolean {
  if (typeof url !== "string") {
    return false;
  }
  return (
    url.startsWith("pier-recovery://reload") ||
    url.startsWith("pier-recovery://close")
  );
}

export function isRendererRecoveryReloadUrl(
  url: string | undefined | null
): boolean {
  return typeof url === "string" && url.startsWith("pier-recovery://reload");
}

export function isRendererRecoveryCloseUrl(
  url: string | undefined | null
): boolean {
  return typeof url === "string" && url.startsWith("pier-recovery://close");
}

export function buildRendererRecoveryCopy(input: {
  detail: string;
  isChinese: boolean;
  kind: RendererRecoveryKind;
}): RendererRecoveryCopy {
  const { detail, isChinese, kind } = input;
  if (isChinese) {
    const messages: Record<RendererRecoveryKind, string> = {
      crash: "界面进程意外退出。",
      load: "界面资源加载失败。",
      preload: "安全桥接脚本加载失败。",
      unresponsive: "界面长时间无响应。",
    };
    return {
      closeLabel: "关闭窗口",
      detail: detail.slice(0, 20_000),
      message: messages[kind],
      reloadLabel: "重新加载",
      title: "Pier 界面不可用",
    };
  }
  const messages: Record<RendererRecoveryKind, string> = {
    crash: "The interface process exited unexpectedly.",
    load: "The interface resources failed to load.",
    preload: "The secure preload bridge failed to load.",
    unresponsive: "The interface stopped responding.",
  };
  return {
    closeLabel: "Close window",
    detail: detail.slice(0, 20_000),
    message: messages[kind],
    reloadLabel: "Reload",
    title: "Pier interface unavailable",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildRendererRecoveryHtml(copy: RendererRecoveryCopy): string {
  const title = escapeHtml(copy.title);
  const message = escapeHtml(copy.message);
  const detail = escapeHtml(copy.detail);
  const reloadLabel = escapeHtml(copy.reloadLabel);
  const closeLabel = escapeHtml(copy.closeLabel);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1115;
      --fg: #f4f4f5;
      --muted: #a1a1aa;
      --card: #18181b;
      --border: #27272a;
      --primary: #3b82f6;
      --primary-fg: #fff;
      --secondary: transparent;
      --secondary-border: #3f3f46;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f4f4f5;
        --fg: #18181b;
        --muted: #52525b;
        --card: #ffffff;
        --border: #e4e4e7;
        --secondary-border: #d4d4d8;
      }
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 100%;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--fg);
    }
    body {
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(440px, 100%);
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--card);
      padding: 24px;
      box-shadow: 0 16px 40px rgb(0 0 0 / 18%);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 600;
    }
    p {
      margin: 0 0 12px;
      color: var(--muted);
    }
    pre {
      margin: 0 0 20px;
      max-height: 160px;
      overflow: auto;
      padding: 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--fg) 6%, transparent);
      color: var(--muted);
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    a.button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 0 14px;
      border-radius: 999px;
      border: 1px solid transparent;
      text-decoration: none;
      font-weight: 550;
      cursor: pointer;
      user-select: none;
    }
    a.button-secondary {
      color: var(--fg);
      border-color: var(--secondary-border);
      background: var(--secondary);
    }
    a.button-primary {
      color: var(--primary-fg);
      background: var(--primary);
    }
  </style>
</head>
<body>
  <main role="alert" aria-live="assertive">
    <h1>${title}</h1>
    <p>${message}</p>
    <pre>${detail}</pre>
    <div class="actions">
      <a class="button button-secondary" href="${PIER_RECOVERY_CLOSE_URL}">${closeLabel}</a>
      <a class="button button-primary" href="${PIER_RECOVERY_RELOAD_URL}">${reloadLabel}</a>
    </div>
  </main>
</body>
</html>`;
}

export async function loadRendererRecoveryPage(
  webContents: Pick<WebContents, "isDestroyed" | "loadURL">,
  copy: RendererRecoveryCopy
): Promise<void> {
  if (webContents.isDestroyed()) {
    return;
  }
  const html = buildRendererRecoveryHtml(copy);
  await webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
}
