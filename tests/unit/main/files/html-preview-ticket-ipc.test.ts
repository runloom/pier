import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIER } from "@shared/ipc-channels.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capabilities: ["file:read"] as string[],
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, payload: unknown) => unknown
      ) => {
        mocks.handlers.set(channel, handler);
      }
    ),
  },
}));
vi.mock("@main/app-core/index.ts", () => ({
  appCore: {
    clients: {
      heartbeat: vi.fn(() => ({ capabilities: mocks.capabilities })),
      register: vi.fn(),
    },
  },
}));
vi.mock("@main/windows/manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "window-1"),
    fromWebContents: vi.fn(() => ({})),
  },
}));

import { registerHtmlPreviewTicketIpc } from "@main/files/html-preview-ipc.ts";

function sender() {
  const mainFrame = {};
  return {
    mainFrame,
    sender: {
      id: 7,
      isDestroyed: vi.fn(() => false),
      mainFrame,
      on: vi.fn(),
      once: vi.fn(),
      session: { storagePath: "/partition" },
    },
    senderFrame: mainFrame,
  };
}

let root: string;

beforeEach(async () => {
  mocks.handlers.clear();
  mocks.capabilities = ["file:read"];
  registerHtmlPreviewTicketIpc();
  root = await mkdtemp(join(tmpdir(), "pier-html-preview-ipc-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("html preview ticket IPC", () => {
  it("issues a ticket with the jailed relPath and releases it", async () => {
    await writeFile(join(root, "demo.html"), "<!doctype html>");
    const event = sender();
    const issue = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_ISSUE);
    const release = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_RELEASE);

    const issued = (await issue?.(event, {
      path: join(root, "demo.html"),
      root,
    })) as { issued: true; relPath: string; ticket: string };

    expect(issued.issued).toBe(true);
    expect(issued.relPath).toBe("demo.html");
    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{22,128}$/u);
    expect(issued.ticket).not.toContain(root);

    await expect(release?.(event, { ticket: issued.ticket })).resolves.toBe(
      true
    );
    await expect(release?.(event, { ticket: issued.ticket })).resolves.toBe(
      false
    );
  });

  it("rotates the previous ticket on re-issue", async () => {
    await writeFile(join(root, "demo.html"), "<!doctype html>");
    const event = sender();
    const issue = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_ISSUE);

    const first = (await issue?.(event, {
      path: join(root, "demo.html"),
      root,
    })) as { issued: true; ticket: string };
    const second = (await issue?.(event, {
      path: join(root, "demo.html"),
      previousTicket: first.ticket,
      root,
    })) as { issued: true; ticket: string };

    expect(second.issued).toBe(true);
    const release = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_RELEASE);
    await expect(release?.(event, { ticket: first.ticket })).resolves.toBe(
      false
    );
    await expect(release?.(event, { ticket: second.ticket })).resolves.toBe(
      true
    );
  });

  it("rejects subframes and renderers without file:read", async () => {
    const issue = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_ISSUE);
    const subframe = sender();
    subframe.senderFrame = {};
    await expect(
      issue?.(subframe, { path: "/tmp/a.html", root: "/tmp" })
    ).resolves.toEqual({ issued: false, reason: "forbidden" });

    mocks.capabilities = [];
    await expect(
      issue?.(sender(), { path: "/tmp/a.html", root: "/tmp" })
    ).resolves.toEqual({ issued: false, reason: "forbidden" });
  });

  it("rejects paths outside the root and missing files", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-html-preview-out-"));
    try {
      await writeFile(join(outside, "a.html"), "<!doctype html>");
      const issue = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_ISSUE);

      await expect(
        issue?.(sender(), { path: join(outside, "a.html"), root })
      ).resolves.toEqual({ issued: false, reason: "outside-root" });
      await expect(
        issue?.(sender(), { path: join(root, "missing.html"), root })
      ).resolves.toEqual({ issued: false, reason: "not-found" });
      await expect(issue?.(sender(), { path: "" })).resolves.toEqual({
        issued: false,
        reason: "invalid-request",
      });
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("touches a live ticket and rejects subframes", async () => {
    await writeFile(join(root, "demo.html"), "<!doctype html>");
    const event = sender();
    const issue = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_ISSUE);
    const touch = mocks.handlers.get(PIER.HTML_PREVIEW_TICKET_TOUCH);
    const issued = (await issue?.(event, {
      path: join(root, "demo.html"),
      root,
    })) as { issued: true; ticket: string };

    await expect(touch?.(event, { ticket: issued.ticket })).resolves.toBe(true);

    const subframe = sender();
    subframe.senderFrame = {};
    await expect(touch?.(subframe, { ticket: issued.ticket })).resolves.toBe(
      false
    );
  });
});
