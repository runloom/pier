import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";

/**
 * Pier 统一的 LSP client capabilities 超集（唯一来源）。
 *
 * Gateway 下真实服务器只 initialize 一次：任何消费者（renderer editor /
 * main language-tools）的能力声明都不再直达服务器。这里必须覆盖
 * `@codemirror/lsp-client` 基础声明、其扩展声明（serverDiagnostics 的
 * `publishDiagnostics.versionSupport`）以及 language-tools 侧
 * documentSymbol / workspace.symbol 的并集。
 *
 * 刻意不声明的能力（收窄 server→client 请求面，broker 只需兜底应答）：
 * - `workspace.configuration` → 服务器不发 workspace/configuration
 * - 任何 `dynamicRegistration` → 不发 client/registerCapability
 * - `window.workDoneProgress` → 不发 window/workDoneProgress/create
 */
export const PIER_LSP_CLIENT_CAPABILITIES: Readonly<Record<string, unknown>> = {
  general: {
    markdown: {
      parser: "marked",
    },
  },
  textDocument: {
    completion: {
      completionItem: {
        documentationFormat: ["markdown", "plaintext"],
        insertReplaceSupport: false,
        snippetSupport: true,
      },
      completionItemKind: { valueSet: [] },
      completionList: {
        itemDefaults: ["commitCharacters", "editRange", "insertTextFormat"],
      },
      contextSupport: true,
    },
    declaration: {},
    definition: {},
    diagnostic: {},
    documentSymbol: {},
    formatting: {},
    hover: {
      contentFormat: ["markdown", "plaintext"],
    },
    implementation: {},
    publishDiagnostics: { versionSupport: true },
    references: {},
    rename: {},
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        activeParameterSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
      },
    },
    typeDefinition: {},
  },
  window: {
    showMessage: {},
  },
  workspace: {
    symbol: {},
  },
};

/** initialize 请求参数（真实会话唯一一次 initialize 用）。 */
export function buildLspInitializeParams(
  serverRoot: string
): Record<string, unknown> {
  return {
    capabilities: PIER_LSP_CLIENT_CAPABILITIES,
    clientInfo: { name: "Pier" },
    processId: process.pid,
    rootUri: fileUriFromAbsolutePath(serverRoot),
    workspaceFolders: [
      {
        name: serverRoot.split(/[\\/]/).at(-1) ?? serverRoot,
        uri: fileUriFromAbsolutePath(serverRoot),
      },
    ],
  };
}
