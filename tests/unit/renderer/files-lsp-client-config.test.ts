import { beforeEach, describe, expect, it, vi } from "vitest";

const lspHarness = vi.hoisted(() => {
  const completionExtension = { id: "completion" };
  const diagnosticsExtension = { id: "diagnostics" };
  const formatBinding = { id: "format" };
  const definitionBinding = { id: "definition" };
  const keymapExtension = { id: "keymap" };
  const referencesBinding = { id: "references" };
  const renameBinding = { id: "rename" };
  const signatureExtension = { id: "signature" };
  const instances: MockLspClient[] = [];

  class MockWorkspace {
    readonly client: MockLspClient;
    files: Array<{ uri: string }> = [];

    constructor(client: MockLspClient) {
      this.client = client;
    }

    getFile(uri: string) {
      return this.files.find((file) => file.uri === uri) ?? null;
    }
  }

  class MockLspClient {
    readonly config: {
      extensions?: readonly unknown[];
      rootUri?: string;
      sanitizeHTML?: (html: string) => string;
      timeout?: number;
      workspace?: (client: MockLspClient) => unknown;
    };
    readonly connect = vi.fn();
    readonly didClose = vi.fn();
    readonly didOpen = vi.fn();
    readonly disconnect = vi.fn();
    readonly initializing = Promise.resolve();
    readonly plugin = vi.fn(() => []);
    readonly workspace: unknown;
    workspaceFactoryCalls = 0;

    constructor(config: MockLspClient["config"]) {
      this.config = config;
      if (config.workspace) {
        this.workspaceFactoryCalls += 1;
        this.workspace = config.workspace(this);
      } else {
        this.workspace = new MockWorkspace(this);
      }
      instances.push(this);
    }
  }

  return {
    completionExtension,
    diagnosticsExtension,
    findReferencesKeymap: [referencesBinding],
    formatKeymap: [formatBinding],
    hoverTooltips: vi.fn(() => ({ id: "upstream-hover" })),
    instances,
    jumpToDefinitionKeymap: [definitionBinding],
    keymapExtension,
    keymapOf: vi.fn(() => keymapExtension),
    languageServerExtensions: vi.fn(() => [{ id: "legacy-bundle" }]),
    MockLspClient,
    MockWorkspace,
    renameKeymap: [renameBinding],
    sanitizeFilesLspHtml: vi.fn((html: string) =>
      html.replace(/<script>.*?<\/script>/gu, "")
    ),
    serverCompletion: vi.fn(() => completionExtension),
    serverDiagnostics: vi.fn(() => diagnosticsExtension),
    signatureExtension,
    signatureHelp: vi.fn(() => signatureExtension),
  };
});

vi.mock("@codemirror/view", () => ({
  keymap: { of: lspHarness.keymapOf },
}));

vi.mock("@codemirror/lsp-client", () => ({
  findReferencesKeymap: lspHarness.findReferencesKeymap,
  formatKeymap: lspHarness.formatKeymap,
  hoverTooltips: lspHarness.hoverTooltips,
  jumpToDefinitionKeymap: lspHarness.jumpToDefinitionKeymap,
  languageServerExtensions: lspHarness.languageServerExtensions,
  LSPClient: lspHarness.MockLspClient,
  LSPPlugin: { get: vi.fn() },
  renameKeymap: lspHarness.renameKeymap,
  serverCompletion: lspHarness.serverCompletion,
  serverDiagnostics: lspHarness.serverDiagnostics,
  signatureHelp: lspHarness.signatureHelp,
  Workspace: lspHarness.MockWorkspace,
}));

vi.mock(
  "../../../src/plugins/builtin/files/renderer/files-lsp-html-sanitizer.ts",
  () => ({ sanitizeFilesLspHtml: lspHarness.sanitizeFilesLspHtml })
);

import {
  createFilesLspClientConfig,
  createFilesLspClientExtensions,
} from "../../../src/plugins/builtin/files/renderer/files-lsp-client-config.ts";
import { FilesLspRootSession } from "../../../src/plugins/builtin/files/renderer/files-lsp-root-recovery.ts";

function createRootSession(sessionId: string, rootPath: string) {
  const workspaceKey = `main:${rootPath}`;
  const facade = {
    close: vi.fn(async () => true),
    ensureSession: vi.fn(async () => null),
    onClosed: vi.fn(() => () => undefined),
    onMessage: vi.fn(() => () => undefined),
    onPolicyChanged: vi.fn(() => () => undefined),
    send: vi.fn(async () => true),
  };

  return new FilesLspRootSession({
    cacheKey: `${workspaceKey}\0typescript\0${rootPath}`,
    ensured: {
      languageId: "typescript",
      ok: true,
      rootPath,
      serverId: "typescript",
      sessionId,
      workspaceKey,
    },
    facade,
    isWorktree: false,
    onDelete: vi.fn(),
    onDisplayFile: vi.fn(async () => null),
    onSessionChanged: vi.fn(),
    shouldRetainWithoutAttachments: () => false,
    request: {
      kind: "local",
      rootPath,
      workspaceKey,
    },
  });
}

describe("Files LSP client configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lspHarness.instances.length = 0;
  });

  it("explicitly composes every supported upstream extension except hover and definition jump", () => {
    const extensions = createFilesLspClientExtensions();
    const expectedKeymap = [
      ...lspHarness.formatKeymap,
      ...lspHarness.renameKeymap,
      ...lspHarness.findReferencesKeymap,
    ];

    expect(lspHarness.serverCompletion).toHaveBeenCalledOnce();
    expect(lspHarness.signatureHelp).toHaveBeenCalledOnce();
    expect(lspHarness.serverDiagnostics).toHaveBeenCalledOnce();
    expect(lspHarness.keymapOf).toHaveBeenCalledOnce();
    expect(lspHarness.keymapOf).toHaveBeenCalledWith(expectedKeymap);
    expect(extensions).toEqual([
      lspHarness.completionExtension,
      lspHarness.keymapExtension,
      lspHarness.signatureExtension,
      lspHarness.diagnosticsExtension,
    ]);
    expect(lspHarness.hoverTooltips).not.toHaveBeenCalled();
    expect(lspHarness.languageServerExtensions).not.toHaveBeenCalled();
    // Upstream jumpToDefinitionKeymap is replaced by Pier hover-extension F12.
    expect(expectedKeymap).not.toContain(lspHarness.jumpToDefinitionKeymap[0]);
  });

  it("adopts every root with an isolated sanitizer and workspace factory", async () => {
    const first = createRootSession("session-one", "/repo-one");
    const second = createRootSession("session-two", "/repo-two");

    await expect(
      Promise.all([first.initialize(), second.initialize()])
    ).resolves.toEqual([true, true]);

    expect(lspHarness.instances).toHaveLength(2);
    const [firstClient, secondClient] = lspHarness.instances;
    const [firstConfig, secondConfig] = lspHarness.instances.map(
      (client) => client.config
    );
    expect(firstClient?.workspaceFactoryCalls).toBe(1);
    expect(secondClient?.workspaceFactoryCalls).toBe(1);
    expect(firstClient?.workspace).not.toBe(secondClient?.workspace);
    expect(firstConfig?.workspace).not.toBe(secondConfig?.workspace);
    expect(firstConfig).toMatchObject({
      rootUri: "file:///repo-one",
      timeout: 12_000,
    });
    expect(secondConfig).toMatchObject({
      rootUri: "file:///repo-two",
      timeout: 12_000,
    });
    expect(firstConfig?.extensions).toEqual([
      lspHarness.completionExtension,
      lspHarness.keymapExtension,
      lspHarness.signatureExtension,
      lspHarness.diagnosticsExtension,
    ]);
    expect(secondConfig?.extensions).toEqual(firstConfig?.extensions);
    expect(firstConfig?.sanitizeHTML).toEqual(expect.any(Function));
    expect(secondConfig?.sanitizeHTML).toEqual(expect.any(Function));
    expect(firstConfig?.sanitizeHTML).not.toBe(secondConfig?.sanitizeHTML);

    const unsafeHtml = "<p>safe</p><script>bad()</script>";
    expect(firstConfig?.sanitizeHTML?.(unsafeHtml)).toBe("<p>safe</p>");
    expect(secondConfig?.sanitizeHTML?.(unsafeHtml)).toBe("<p>safe</p>");
    expect(lspHarness.sanitizeFilesLspHtml).toHaveBeenNthCalledWith(
      1,
      unsafeHtml
    );
    expect(lspHarness.sanitizeFilesLspHtml).toHaveBeenNthCalledWith(
      2,
      unsafeHtml
    );
    expect(lspHarness.languageServerExtensions).not.toHaveBeenCalled();
    expect(lspHarness.hoverTooltips).not.toHaveBeenCalled();
  });

  it("creates a fresh sanitizer closure for each standalone config", () => {
    const firstWorkspace = vi.fn(() => ({ id: "first-workspace" }) as never);
    const secondWorkspace = vi.fn(() => ({ id: "second-workspace" }) as never);
    const first = createFilesLspClientConfig({
      rootUri: "file:///first",
      workspace: firstWorkspace,
    });
    const second = createFilesLspClientConfig({
      rootUri: "file:///second",
      workspace: secondWorkspace,
    });

    expect(first.sanitizeHTML).toEqual(expect.any(Function));
    expect(second.sanitizeHTML).toEqual(expect.any(Function));
    expect(first.sanitizeHTML).not.toBe(second.sanitizeHTML);
    expect(first.workspace).toBe(firstWorkspace);
    expect(second.workspace).toBe(secondWorkspace);
    expect(first.timeout).toBe(12_000);
    expect(second.timeout).toBe(12_000);
  });
});
