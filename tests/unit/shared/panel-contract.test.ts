import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  panelContextSchema,
  panelDescriptorSchema,
  panelSnapshotSchema,
  panelTabChromeSchema,
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
        busy: true,
        colorToken: "state.running",
        label: "Running",
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
      state: { busy: true, label: "Running" },
      title: "test",
    });
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
