import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MODULE_DIR = join(ROOT, "src", "main", "services", "notification-center");

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
    if (/\.ts$/.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

describe("notification-center main module boundary", () => {
  it("does not import services/agents (对齐 foreground-activity 单向边界)", () => {
    const offenders: string[] = [];
    for (const filePath of sourceFiles(MODULE_DIR)) {
      const content = readFileSync(filePath, "utf8");
      if (/from\s+["'][^"']*services\/agents\//.test(content)) {
        offenders.push(relative(ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("history persistence stays inside store.ts", () => {
    for (const filePath of sourceFiles(MODULE_DIR)) {
      const rel = relative(ROOT, filePath);
      const content = readFileSync(filePath, "utf8");
      if (rel.endsWith("store.ts")) {
        continue;
      }
      expect(
        /debouncedJsonStore|writeFileAtomic|notifications\.json/.test(content),
        `${rel} 不应直接触碰历史持久化`
      ).toBe(false);
    }
  });

  it("schedules interrupts via resolveDeliveryPlan (not bare resolveToastTarget only)", () => {
    const service = readFileSync(join(MODULE_DIR, "service.ts"), "utf8");
    expect(service).toContain("resolveDeliveryPlan");
    expect(service).toContain("deliverOs");
  });
});

describe("notification-center agent panel focus signal", () => {
  it("IPC isTargetPanelFocused uses activeTerminalPanelId via pure helper", () => {
    const ipc = readFileSync(
      join(ROOT, "src/main/ipc/notification-center.ts"),
      "utf8"
    );
    const helper = readFileSync(
      join(ROOT, "src/main/ipc/notification-center-agent-focus.ts"),
      "utf8"
    );
    expect(helper).toContain("activeTerminalPanelId === input.panelId");
    expect(helper).not.toContain("activePanelId");
    expect(ipc).toContain("isTargetAgentPanelFocused");
    expect(ipc).toContain(
      "terminalFocusCoordinator.activeTerminalPanelId(focused)"
    );
  });
});

describe("agent-attention no longer owns OS delivery", () => {
  const ATTENTION_DIR = join(
    ROOT,
    "src",
    "main",
    "services",
    "agent-attention"
  );

  it("service.ts does not import OS adapter or call showNotification", () => {
    const service = readFileSync(join(ATTENTION_DIR, "service.ts"), "utf8");
    expect(service).not.toMatch(
      /from\s+["'][^"']*system-notification[^"']*["']/
    );
    expect(service).not.toMatch(/\bshowNotification\b/);
    expect(service).toContain("ingestNotification");
  });
});
