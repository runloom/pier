import {
  classifyGhosttyChildExited,
  GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS,
} from "@shared/contracts/ghostty-host-copy.ts";
import { describe, expect, it, vi } from "vitest";
import {
  formatGhosttyChildExitedBufferText,
  inferTerminalExitRole,
  resolveDismissMode,
  resolveGhosttyChildExitedBanner,
} from "@/panel-kits/terminal/format-ghostty-host-copy.ts";

vi.mock("i18next", () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        "terminal.ghosttyHost.processExited": "Process exited",
        "terminal.ghosttyHost.processExitedFailed": `Process exited with code ${String(options?.code ?? "")}`,
        "terminal.ghosttyHost.processExitedAbnormal": `The command exited too quickly (${String(options?.duration ?? "")}).`,
        "terminal.ghosttyHost.agentExited": "Agent session ended",
        "terminal.ghosttyHost.agentExitedFailed": `Agent session ended with code ${String(options?.code ?? "")}`,
        "terminal.ghosttyHost.taskExited": "Task finished",
        "terminal.ghosttyHost.taskOutputExited": "Task output ended",
        "terminal.ghosttyHost.dismissAnyKey": "Press any key to close",
        "terminal.ghosttyHost.dismissExplicit":
          "Close the tab when you’re done reviewing",
      };
      return table[key] ?? key;
    },
  },
}));

describe("classifyGhosttyChildExited", () => {
  it("marks short runtime as abnormal", () => {
    expect(
      classifyGhosttyChildExited(0, GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS)
    ).toBe("abnormal");
    expect(classifyGhosttyChildExited(0, 10)).toBe("abnormal");
  });

  it("uses exit code after the abnormal window", () => {
    expect(
      classifyGhosttyChildExited(
        0,
        GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS + 1
      )
    ).toBe("normal");
    expect(
      classifyGhosttyChildExited(
        1,
        GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS + 1
      )
    ).toBe("failed");
  });
});

describe("inferTerminalExitRole", () => {
  it("prefers explicit presentation role", () => {
    expect(
      inferTerminalExitRole({
        activityKind: "agent",
        exitPresentation: { role: "shell" },
        params: { task: { taskId: "x" } },
      })
    ).toBe("shell");
  });

  it("infers taskOutput before activity", () => {
    expect(
      inferTerminalExitRole({
        activityKind: "agent",
        params: {
          taskOutput: { label: "Build", runId: "r1", taskId: "build" },
        },
      })
    ).toBe("taskOutput");
  });

  it("infers agent from activity when params are plain", () => {
    expect(
      inferTerminalExitRole({
        activityKind: "agent",
        params: {},
      })
    ).toBe("agent");
  });
});

describe("resolveGhosttyChildExitedBanner", () => {
  it("localizes a normal shell exit with any-key dismiss", () => {
    const copy = resolveGhosttyChildExitedBanner({
      exitCode: 0,
      params: {},
      runtimeMs: 1200,
    });
    expect(copy.variant).toBe("normal");
    expect(copy.role).toBe("shell");
    expect(copy.primary).toBe("Process exited");
    expect(copy.dismiss).toBe("Press any key to close");
  });

  it("uses agent copy when activity is agent", () => {
    const copy = resolveGhosttyChildExitedBanner({
      activityKind: "agent",
      exitCode: 0,
      params: {},
      runtimeMs: 5000,
    });
    expect(copy.role).toBe("agent");
    expect(copy.primary).toBe("Agent session ended");
    expect(copy.dismiss).toBe("Close the tab when you’re done reviewing");
  });

  it("honors messageOverride from exitPresentation", () => {
    const copy = resolveGhosttyChildExitedBanner({
      exitCode: 0,
      exitPresentation: { messageOverride: "自定义结束提示" },
      params: {},
      runtimeMs: 5000,
    });
    expect(copy.primary).toBe("自定义结束提示");
  });

  it("reads exitPresentation from panel params", () => {
    const copy = resolveGhosttyChildExitedBanner({
      exitCode: 0,
      params: {
        exitPresentation: {
          dismissMode: "explicit",
          messageOverride: "From params",
        },
      },
      runtimeMs: 5000,
    });
    expect(copy.primary).toBe("From params");
    expect(copy.dismiss).toBe("Close the tab when you’re done reviewing");
  });

  it("uses explicit dismiss for taskOutput role by default", () => {
    expect(
      resolveDismissMode({
        role: "taskOutput",
      })
    ).toBe("explicit");
  });

  it("formats buffer inject text with CR/LF and both lines", () => {
    const text = formatGhosttyChildExitedBufferText({
      exitCode: 0,
      params: {},
      runtimeMs: 1200,
    });
    expect(text.startsWith("\r\n")).toBe(true);
    expect(text).toContain("Process exited");
    expect(text).toContain("Press any key to close");
  });
});
