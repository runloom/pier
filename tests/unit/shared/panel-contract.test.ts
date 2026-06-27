import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  normalizePanelTabChromeInput,
  panelContextSchema,
  panelDescriptorSchema,
  panelSnapshotSchema,
  panelTabChromeSchema,
  panelTabStatusSchema,
} from "@shared/contracts/panel.ts";
import { rendererCommandSchema } from "@shared/contracts/renderer-command.ts";
import { describe, expect, it } from "vitest";

const context = {
  contextId: "ctx-1",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
};

describe("shared panel contract", () => {
  it("parses the canonical tab status enum", () => {
    expect(panelTabStatusSchema.parse("running")).toBe("running");
    expect(panelTabStatusSchema.parse("waiting")).toBe("waiting");
    expect(panelTabStatusSchema.parse("blocked")).toBe("blocked");
    expect(panelTabStatusSchema.parse("succeeded")).toBe("succeeded");
    expect(panelTabStatusSchema.parse("failed")).toBe("failed");
    expect(panelTabStatusSchema.safeParse("busy").success).toBe(false);
  });

  it("parses reusable panel context fields", () => {
    expect(
      panelContextSchema.parse({
        ...context,
        branch: "main",
        gitCommonDir: "/Users/xyz/ABC/pier/.git",
        gitRoot: "/Users/xyz/ABC/pier",
        head: "abc123",
        worktreeRoot: "/Users/xyz/ABC/pier",
      })
    ).toMatchObject({
      contextId: "ctx-1",
      cwd: "/Users/xyz/ABC/pier",
      worktreeKey: "/Users/xyz/ABC/pier",
    });
  });

  it("parses shared panel descriptors", () => {
    expect(
      panelDescriptorSchema.parse({
        context,
        display: {
          long: "/Users/xyz/ABC/pier",
          short: "pier",
        },
      })
    ).toMatchObject({
      context: { contextId: "ctx-1" },
      display: { short: "pier" },
    });
  });

  it("parses generic tab chrome without business or icon enums", () => {
    const tab = panelTabChromeSchema.parse({
      ariaLabel: "Run task test",
      badge: { colorToken: "surface.muted", label: "package.json" },
      description: "pnpm run test",
      icon: {
        colorToken: "accent.info",
        id: "custom.anything.from.host.registry",
        label: "Task",
      },
      state: {
        colorToken: "state.running",
        label: "Running",
        status: "running",
      },
      title: "test",
      tooltip: {
        lines: [
          { label: "Command", value: "pnpm run test" },
          { label: "CWD", value: "/Users/xyz/ABC/pier" },
        ],
        title: "test",
      },
    });

    expect(tab).toMatchObject({
      badge: { label: "package.json" },
      icon: { id: "custom.anything.from.host.registry" },
      state: { label: "Running", status: "running" },
      title: "test",
    });
  });

  it("does not accept busy as canonical tab state", () => {
    expect(
      panelTabChromeSchema.safeParse({
        state: { busy: true, label: "Running" },
        title: "test",
      }).success
    ).toBe(false);
  });

  it("normalizes legacy busy tab state at ingress boundaries", () => {
    const running = normalizePanelTabChromeInput({
      state: { busy: true, label: "Running" },
      title: "dev",
    });
    expect(running).toEqual({
      state: { label: "Running", status: "running" },
      title: "dev",
    });
    expect(running?.state).not.toHaveProperty("busy");

    const succeeded = normalizePanelTabChromeInput({
      state: {
        busy: false,
        colorToken: "success",
        label: "Succeeded",
      },
      title: "test",
    });
    expect(succeeded?.state).toEqual({
      colorToken: "success",
      label: "Succeeded",
      status: "succeeded",
    });
    expect(succeeded?.state).not.toHaveProperty("busy");

    const failed = normalizePanelTabChromeInput({
      state: {
        busy: false,
        colorToken: "destructive",
        label: "Failed 1",
      },
      title: "test",
    });
    expect(failed?.state).toEqual({
      colorToken: "destructive",
      label: "Failed 1",
      status: "failed",
    });
    expect(failed?.state).not.toHaveProperty("busy");
  });

  it("allows descriptors and snapshots to carry tab chrome", () => {
    const tab = {
      icon: { id: "pier.task" },
      title: "test",
    };

    expect(
      panelDescriptorSchema.parse({
        context,
        display: { short: "pier" },
        tab,
      })
    ).toMatchObject({ tab });
    expect(
      panelSnapshotSchema.parse({
        display: { short: "pier" },
        id: "terminal-1",
        kind: "terminal",
        tab,
      })
    ).toMatchObject({ tab });
  });

  it("PanelSnapshot exposes context and display without legacy cwd/title fields", () => {
    const parsed = panelSnapshotSchema.parse({
      active: true,
      context,
      display: {
        long: "/Users/xyz/ABC/pier",
        short: "pier",
      },
      id: "terminal-1",
      kind: "terminal",
    });

    expect(parsed).toMatchObject({
      context: { contextId: "ctx-1" },
      display: { short: "pier" },
      id: "terminal-1",
      kind: "terminal",
    });
  });

  it("allows renderer panel.open commands to carry only resolved context", () => {
    expect(
      rendererCommandSchema.parse({
        context,
        type: "panel.open",
      })
    ).toMatchObject({
      context: { contextId: "ctx-1" },
      type: "panel.open",
    });
  });

  it("allows public terminal.open commands to carry launch options", () => {
    expect(
      pierCommandSchema.parse({
        focus: false,
        launch: {
          command: "pnpm test",
          cwd: "/Users/xyz/ABC/pier",
          env: {
            PIER_MODE: "dev",
          },
          profileId: "codex",
        },
        placement: "split-right",
        type: "terminal.open",
        windowId: "main",
      })
    ).toMatchObject({
      focus: false,
      launch: {
        command: "pnpm test",
        cwd: "/Users/xyz/ABC/pier",
        env: {
          PIER_MODE: "dev",
        },
        profileId: "codex",
      },
      placement: "split-right",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("allows renderer terminal.open commands to carry launchId without raw env", () => {
    expect(
      rendererCommandSchema.parse({
        context,
        launchId: "launch-1",
        tab: {
          icon: { id: "pier.task" },
          title: "test",
        },
        type: "terminal.open",
      })
    ).toMatchObject({
      context: { contextId: "ctx-1" },
      launchId: "launch-1",
      tab: {
        icon: { id: "pier.task" },
        title: "test",
      },
      type: "terminal.open",
    });
  });

  it("normalizes legacy renderer terminal.open tab state", () => {
    const command = rendererCommandSchema.parse({
      context,
      launchId: "launch-1",
      tab: {
        state: { busy: true, label: "Running" },
        title: "test",
      },
      type: "terminal.open",
    });

    expect(command).toMatchObject({
      tab: {
        state: { label: "Running", status: "running" },
        title: "test",
      },
      type: "terminal.open",
    });
    if (command.type !== "terminal.open") {
      throw new Error("expected terminal.open command");
    }
    expect(command.tab?.state).not.toHaveProperty("busy");
  });

  it("allows public terminal profile management commands", () => {
    expect(
      pierCommandSchema.parse({ type: "terminal.profile.list" })
    ).toMatchObject({ type: "terminal.profile.list" });
    expect(
      pierCommandSchema.parse({
        profileId: "codex",
        type: "terminal.profile.read",
      })
    ).toMatchObject({
      profileId: "codex",
      type: "terminal.profile.read",
    });
    expect(
      pierCommandSchema.parse({
        profile: {
          command: "codex",
          cwd: "/Users/xyz/ABC/pier",
          env: { PIER_MODE: "dev" },
        },
        profileId: "codex",
        type: "terminal.profile.upsert",
      })
    ).toMatchObject({
      profile: {
        command: "codex",
        cwd: "/Users/xyz/ABC/pier",
        env: { PIER_MODE: "dev" },
      },
      profileId: "codex",
      type: "terminal.profile.upsert",
    });
    expect(
      pierCommandSchema.parse({
        profileId: "codex",
        type: "terminal.profile.delete",
      })
    ).toMatchObject({
      profileId: "codex",
      type: "terminal.profile.delete",
    });
  });
});
