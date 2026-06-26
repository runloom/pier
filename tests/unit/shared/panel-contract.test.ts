import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  panelContextSchema,
  panelDescriptorSchema,
  panelSnapshotSchema,
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
        type: "terminal.open",
      })
    ).toMatchObject({
      context: { contextId: "ctx-1" },
      launchId: "launch-1",
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
