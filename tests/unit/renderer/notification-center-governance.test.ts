import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const RENDERER_ROOT = join(ROOT, "src", "renderer");

/**
 * 系统事件路径清单（P0 迁移完成）：这些文件禁止回退到裸 toast，
 * 系统消息必须经 systemNotify 门面（toast + 消息中心双写）。
 */
const SYSTEM_EVENT_FILES = [
  "src/renderer/stores/app-update.store.ts",
  "src/renderer/stores/agent-runtime-index.store.ts",
  "src/renderer/panel-kits/terminal/notify-task-run-finished.ts",
  "src/renderer/components/common/agent-runtime-index-bridge.tsx",
  "src/renderer/components/common/task-runs-error-bridge.tsx",
];

const NOTIFICATION_CARD_FILE =
  "src/renderer/components/common/notification-card.tsx";

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(filePath));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function systemNotifyCallBlocks(
  content: string
): { block: string; line: number }[] {
  const blocks: { block: string; line: number }[] = [];
  const callRe = /systemNotify\(\{/g;
  let match = callRe.exec(content);
  while (match) {
    // 简单配对到第一个 `\n  }` / `\n}` 收尾（调用都是对象字面量单行收尾风格）
    const rest = content.slice(match.index);
    const end = rest.search(/\n\s*\}\)/);
    const block = end === -1 ? rest.slice(0, 800) : rest.slice(0, end);
    const line = content.slice(0, match.index).split("\n").length;
    blocks.push({ block, line });
    match = callRe.exec(content);
  }
  return blocks;
}

describe("notification center governance", () => {
  it("documents the message center policy in project agent context", () => {
    const agentContext = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agentContext).toContain("消息中心");
    expect(agentContext).toContain("systemNotify");
    expect(agentContext).toContain("NotificationCard");
  });

  it("system event paths never fall back to bare toast", () => {
    for (const file of SYSTEM_EVENT_FILES) {
      const content = readFileSync(join(ROOT, file), "utf8");
      expect(
        /(^|[^\w.])toast(?:\.\w+)?\(/.test(content),
        `${file} 出现裸 toast 调用；系统事件必须走 systemNotify`
      ).toBe(false);
      expect(content).toContain("systemNotify");
    }
  });

  it("systemNotify calls always carry kind + severity + titleKey", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      const content = readFileSync(filePath, "utf8");
      if (!content.includes("systemNotify({")) {
        continue;
      }
      for (const { block, line } of systemNotifyCallBlocks(content)) {
        // 字段可显式 `kind:` 或解构简写 `kind,`；其余形态视为缺失
        for (const required of ["kind", "severity", "titleKey"]) {
          if (!new RegExp(`\\b${required}[,:]`).test(block)) {
            violations.push(`${rel}:${line} 缺少 ${required}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("toast-bearing systemNotify calls must provide a friendly body (不靠类型行回退)", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      const content = readFileSync(filePath, "utf8");
      if (!content.includes("systemNotify({")) {
        continue;
      }
      for (const { block, line } of systemNotifyCallBlocks(content)) {
        // suppressToast: true 只落档不弹 toast，豁免 body 要求
        if (/suppressToast:\s*true/.test(block)) {
          continue;
        }
        // 展开调用（...base）的 body 可能在被展开对象里，无法静态判定，跳过
        if (/\.\.\./.test(block)) {
          continue;
        }
        if (!/\bbody[,:]/.test(block)) {
          violations.push(
            `${rel}:${line} 缺少 body；弹 toast 的调用点必须提供友好内容`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("NotificationCard is the only message card implementation", () => {
    const offenders: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      if (rel === NOTIFICATION_CARD_FILE) {
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      if (content.includes('data-slot="notification-card"')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("delivery routing has a single shared implementation", () => {
    const offenders: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      const content = readFileSync(filePath, "utf8");
      // 禁止在业务代码里手写 DND 判定；必须走 @shared/notification-delivery.ts
      if (
        /dndEnabled\s*&&\s*input\.severity/.test(content) ||
        /dndEnabled\s*&&\s*\w+\.severity\s*!==\s*"error"/.test(content)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("shape-B toast is only rendered from the main single-window bridge", () => {
    const ALLOWED = new Set([
      "src/renderer/components/common/notification-message-toast-bridge.tsx",
      "src/renderer/lib/notifications/show-notification-toast.tsx",
    ]);
    const offenders: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      if (ALLOWED.has(rel)) {
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      if (/\bshowNotificationToast\s*\(/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("locks dual toast placement: 形态 A top-center, 形态 B top-right", () => {
    const sonner = readFileSync(
      join(ROOT, "src/renderer/components/primitives/sonner.tsx"),
      "utf8"
    );
    const showNotification = readFileSync(
      join(ROOT, "src/renderer/lib/notifications/show-notification-toast.tsx"),
      "utf8"
    );
    const agentContext = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    // 默认 Toaster 必须是中间上方（确认型短提示）；禁止回退为整站 top-right。
    expect(sonner).toMatch(/position=["']top-center["']/);
    expect(sonner).not.toMatch(/position=["']top-right["']/);
    // 形态 B 仅 per-call 右上角；不得依赖第二个 Toaster id 或样式分支。
    expect(showNotification).toMatch(/position:\s*["']top-right["']/);
    expect(agentContext).toContain('position="top-center"');
    expect(agentContext).toContain('position: "top-right"');
  });

  it("does not reintroduce store-subscribe toast preview bridge", () => {
    expect(() =>
      readFileSync(
        join(
          ROOT,
          "src/renderer/components/common/notification-toast-preview-bridge.tsx"
        ),
        "utf8"
      )
    ).toThrow();
    const appShell = readFileSync(
      join(ROOT, "src/renderer/components/common/app-shell.tsx"),
      "utf8"
    );
    expect(appShell).toContain("NotificationMessageToastBridge");
    expect(appShell).not.toContain("NotificationToastPreviewBridge");
  });

  it("plain toasts never carry description (消息详情只走形态 B 渲染器)", () => {
    const ALLOWED = new Set([
      "src/renderer/lib/notifications/show-notification-toast.tsx",
    ]);
    const offenders: string[] = [];
    for (const filePath of sourceFiles(RENDERER_ROOT)) {
      const rel = relative(ROOT, filePath);
      if (ALLOWED.has(rel)) {
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      if (/toast(?:\.\w+)?\([\s\S]{0,400}?description\s*:/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("plugin systemEvent marker is restricted to the sanctioned call site", () => {
    const ALLOWED = new Set([
      "packages/plugin-api/src/peer-sync/notify-failures.ts",
    ]);
    const PLUGIN_ROOTS = [
      join(ROOT, "packages", "plugin-api", "src"),
      join(ROOT, "src", "plugins", "builtin"),
      join(ROOT, "packages", "plugin-codex", "src"),
      join(ROOT, "packages", "plugin-grok", "src"),
      join(ROOT, "packages", "plugin-claude", "src"),
      join(ROOT, "packages", "plugin-ssh", "src"),
    ];
    const offenders: string[] = [];
    for (const root of PLUGIN_ROOTS) {
      for (const filePath of sourceFiles(root)) {
        const rel = relative(ROOT, filePath);
        if (ALLOWED.has(rel)) {
          continue;
        }
        const content = readFileSync(filePath, "utf8");
        if (/systemEvent\s*:\s*true/.test(content)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
