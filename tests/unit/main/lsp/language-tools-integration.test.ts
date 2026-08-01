import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileService } from "@main/services/files/service.ts";
import { DEFAULT_LSP_POLICY_PREFS } from "@shared/contracts/lsp.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  readPrefs: vi.fn(),
  readDocument: vi.fn(),
  readText: vi.fn(),
  subscribe: vi.fn(),
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
      heartbeat: vi.fn(() => ({ capabilities: ["file:read"] })),
      register: vi.fn(),
    },
    eventBus: { subscribe: mocks.subscribe },
    services: {
      files: {
        readDocument: mocks.readDocument,
        readText: mocks.readText,
      },
      preferences: { read: mocks.readPrefs },
    },
  },
}));

vi.mock("@main/windows/manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "window-1"),
    fromWebContents: vi.fn(() => ({})),
    getAll: vi.fn(() => []),
  },
}));

import { disposeLspIpcHost, registerLspIpc } from "@main/ipc/lsp.ts";

const fileService = createFileService();

const tempDirs: string[] = [];

function event() {
  const mainFrame = {};
  const sender = {
    id: 17,
    isDestroyed: vi.fn(() => false),
    mainFrame,
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
  };
  return { sender, senderFrame: mainFrame };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
  mocks.readDocument.mockReset();
  mocks.readPrefs.mockReset();
  mocks.readText.mockReset();
});

afterAll(async () => {
  await disposeLspIpcHost();
});

describe("LanguageTools IPC integration", () => {
  it("synchronizes the TypeScript document before resolving cross-file definitions", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-language-tools-"));
    tempDirs.push(rootPath);
    const sourcePath = join(rootPath, "a.ts");
    const consumerPath = join(rootPath, "b.ts");
    await Promise.all([
      writeFile(sourcePath, "export function value() { return 42; }\n"),
      writeFile(
        consumerPath,
        'import { value } from "./a";\nconsole.log(value());\n'
      ),
      writeFile(
        join(rootPath, "tsconfig.json"),
        JSON.stringify({ include: ["*.ts"] })
      ),
    ]);
    mocks.readPrefs.mockResolvedValue({ lsp: DEFAULT_LSP_POLICY_PREFS });
    mocks.readDocument.mockImplementation(
      async (request: { path: string; root: string }) =>
        fileService.readDocument(request)
    );
    mocks.readText.mockImplementation(
      async ({ path, root }: { path: string; root: string }) =>
        readFile(resolve(root, path), "utf8")
    );
    registerLspIpc();
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }

    const ipcEvent = event();
    const request = {
      filePath: consumerPath,
      method: "textDocument/definition",
      params: { position: { character: 24, line: 0 } },
      rootPath,
    };
    const firstResponse = await handler(ipcEvent, request);
    const concurrentResponses = await Promise.all([
      handler(ipcEvent, request),
      handler(ipcEvent, request),
    ]);

    for (const response of [firstResponse, ...concurrentResponses]) {
      expect(response).toMatchObject({ ok: true });
      expect(JSON.stringify(response)).toContain(
        fileUriFromAbsolutePath(sourcePath)
      );
    }
    expect(mocks.readDocument).toHaveBeenCalledTimes(3);
    expect(mocks.readDocument).toHaveBeenCalledWith({
      path: "b.ts",
      root: rootPath,
    });
    expect(mocks.readText).not.toHaveBeenCalled();
  }, 20_000);

  it("decodes BOM-prefixed LanguageTools documents before synchronization", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-language-tools-"));
    tempDirs.push(rootPath);
    const sourcePath = join(rootPath, "a.ts");
    const utf8BomPath = join(rootPath, "utf8-bom.ts");
    const utf16Path = join(rootPath, "utf16.ts");
    const consumer = 'import { value } from "./a";\nconsole.log(value());\n';
    await Promise.all([
      writeFile(sourcePath, "export function value() { return 42; }\n"),
      writeFile(
        utf8BomPath,
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(consumer, "utf8"),
        ])
      ),
      writeFile(
        utf16Path,
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(consumer, "utf16le"),
        ])
      ),
      writeFile(
        join(rootPath, "tsconfig.json"),
        JSON.stringify({ include: ["*.ts"] })
      ),
    ]);
    mocks.readPrefs.mockResolvedValue({ lsp: DEFAULT_LSP_POLICY_PREFS });
    mocks.readDocument.mockImplementation(
      async (request: { path: string; root: string }) =>
        fileService.readDocument(request)
    );
    mocks.readText.mockImplementation(
      async ({ path, root }: { path: string; root: string }) =>
        readFile(resolve(root, path), "utf8")
    );
    registerLspIpc();
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }

    for (const filePath of [utf8BomPath, utf16Path]) {
      const response = await handler(event(), {
        filePath,
        method: "textDocument/definition",
        params: { position: { character: 22, line: 0 } },
        rootPath,
      });
      expect(response).toMatchObject({ ok: true });
      expect(JSON.stringify(response)).toContain(
        fileUriFromAbsolutePath(sourcePath)
      );
    }
    expect(mocks.readDocument).toHaveBeenCalledTimes(2);
    expect(mocks.readDocument).toHaveBeenCalledWith({
      path: "utf8-bom.ts",
      root: rootPath,
    });
    expect(mocks.readDocument).toHaveBeenCalledWith({
      path: "utf16.ts",
      root: rootPath,
    });
    expect(mocks.readText).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects image documents before sending a LanguageTools request", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-language-tools-"));
    tempDirs.push(rootPath);
    const imagePath = join(rootPath, "image.ts");
    await Promise.all([
      writeFile(
        imagePath,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ),
      writeFile(
        join(rootPath, "tsconfig.json"),
        JSON.stringify({ include: ["*.ts"] })
      ),
    ]);
    mocks.readPrefs.mockResolvedValue({ lsp: DEFAULT_LSP_POLICY_PREFS });
    mocks.readDocument.mockImplementation(
      async (request: { path: string; root: string }) =>
        fileService.readDocument(request)
    );
    mocks.readText.mockImplementation(
      async ({ path, root }: { path: string; root: string }) =>
        readFile(resolve(root, path), "utf8")
    );
    registerLspIpc();
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }

    await expect(
      handler(event(), {
        filePath: imagePath,
        method: "textDocument/definition",
        params: { position: { character: 0, line: 0 } },
        rootPath,
      })
    ).resolves.toEqual({
      ok: false,
      reason: "request-failed",
      result: null,
    });
    expect(mocks.readDocument).toHaveBeenCalledWith({
      path: "image.ts",
      root: rootPath,
    });
    expect(mocks.readText).not.toHaveBeenCalled();
  }, 20_000);
});
