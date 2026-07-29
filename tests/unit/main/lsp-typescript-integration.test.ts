import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LspSessionHost } from "@main/services/lsp/lsp-session-host.ts";
import { createTypescriptLspProvider } from "@main/services/lsp/providers/typescript-provider.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("TypeScript language server integration", () => {
  it("resolves a cross-file definition through the process host", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-lsp-typescript-"));
    tempDirs.push(rootPath);
    const sourcePath = join(rootPath, "a.ts");
    const consumerPath = join(rootPath, "b.ts");
    const source = "export function value() { return 42; }\n";
    const consumer = 'import { value } from "./a";\nconsole.log(value());\n';
    await Promise.all([
      writeFile(sourcePath, source),
      writeFile(consumerPath, consumer),
    ]);

    const provider = createTypescriptLspProvider();
    const launch = await provider.resolveLaunch({
      rootPath,
      workspaceKey: `main:${rootPath}`,
    });
    expect(launch).not.toBeNull();
    if (!launch) {
      return;
    }

    const host = new LspSessionHost();
    try {
      const session = host.ensure({
        clientRole: "editor",
        launch,
        onMessage: () => undefined,
        rootPath,
        serverId: provider.id,
        webContentsId: 1,
        workspaceKey: `main:${rootPath}`,
      });
      const rootUri = fileUriFromAbsolutePath(rootPath);
      await host.ensureInitialized(session.sessionId, {
        capabilities: {},
        processId: null,
        rootUri,
        workspaceFolders: [{ name: "workspace", uri: rootUri }],
      });
      expect(
        host.send(
          session.sessionId,
          JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                languageId: "typescript",
                text: source,
                uri: fileUriFromAbsolutePath(sourcePath),
                version: 1,
              },
            },
          })
        )
      ).toBe(true);
      expect(
        host.send(
          session.sessionId,
          JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                languageId: "typescript",
                text: consumer,
                uri: fileUriFromAbsolutePath(consumerPath),
                version: 1,
              },
            },
          })
        )
      ).toBe(true);

      const definition = await host.request(
        session.sessionId,
        "textDocument/definition",
        {
          position: { character: 13, line: 1 },
          textDocument: { uri: fileUriFromAbsolutePath(consumerPath) },
        }
      );

      expect(JSON.stringify(definition)).toContain(
        fileUriFromAbsolutePath(sourcePath)
      );
    } finally {
      await host.dispose();
    }
  }, 20_000);
});
