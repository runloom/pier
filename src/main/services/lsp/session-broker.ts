import type { LspSessionClosedEvent } from "@shared/contracts/lsp.ts";
import type { LspServerLaunchSpec } from "@shared/contracts/lsp-provider.ts";
import { buildLspInitializeParams } from "./client-capabilities.ts";
import { LspDocumentGate } from "./document-gate.ts";
import {
  type EditorConsumer,
  handleEditorMethodMessage,
  isLspRequestId,
  type LspRealSessionInfo,
  lspIdKey,
  parseEditorJsonRpc,
  type RealSessionRecord,
  routeBrokerInbound,
} from "./session-broker-route.ts";
import type {
  LanguageToolsTextDocument,
  LspSessionHost,
} from "./session-host.ts";
import type { RuntimeLogger } from "./session-runtime.ts";

export type { LspRealSessionInfo } from "./session-broker-route.ts";

export interface LspSessionBrokerDeps {
  host: LspSessionHost;
  logger?: RuntimeLogger;
  /** host 接受关闭请求（markTreeDraining 时机）。 */
  onRealSessionCloseAccepted?(info: LspRealSessionInfo): void;
  /** 真实会话终态（policy release / markTreeTerminal 时机）。 */
  onRealSessionClosed?(
    info: LspRealSessionInfo,
    event: LspSessionClosedEvent,
    treeTerminal: Promise<void>
  ): void;
}

/**
 * LSP Gateway：真实进程树按 (workspaceKey, serverId, rootPath) 唯一，
 * renderer editor 消费者持虚拟会话经此路由；language-tools 直接消费
 * 真实会话。职责：请求 id 重写、通知扇出、initialize 一次化（超集
 * capabilities + 结果缓存合成）、server→client 请求路由、didOpen/didClose
 * 引用计数（LspDocumentGate）。
 */
export class LspSessionBroker {
  readonly #deps: LspSessionBrokerDeps;
  readonly #byRealSessionId = new Map<string, RealSessionRecord>();
  readonly #realSessionIdByKey = new Map<string, string>();
  readonly #recordByVirtualId = new Map<string, RealSessionRecord>();
  /** language-tools 在途引用：>0 时末位编辑器离开不关真实进程树。 */
  readonly #languageToolsHolds = new Map<string, number>();
  #virtualSeq = 0;
  /** 单调活跃序号：同毫秒内也能区分“最近活跃”的消费者。 */
  #activitySeq = 0;

  constructor(deps: LspSessionBrokerDeps) {
    this.#deps = deps;
  }

  ensureEditorSession(input: {
    deliver(virtualSessionId: string, jsonBody: string): void;
    launch: LspServerLaunchSpec;
    notifyClosed(
      virtualSessionId: string,
      event: LspSessionClosedEvent,
      treeTerminal: Promise<void>
    ): void;
    rootPath: string;
    serverId: string;
    webContentsId: number;
    workspaceKey: string;
  }): {
    realSessionId: string;
    reusedReal: boolean;
    rootPath: string;
    serverId: string;
    virtualSessionId: string;
  } {
    const { record, reusedReal } = this.#ensureReal(input);
    for (const consumer of record.consumersByVirtualId.values()) {
      if (consumer.webContentsId !== input.webContentsId) {
        continue;
      }
      consumer.deliver = (jsonBody) =>
        input.deliver(consumer.virtualSessionId, jsonBody);
      consumer.notifyClosed = (event, treeTerminal) =>
        input.notifyClosed(consumer.virtualSessionId, event, treeTerminal);
      this.#activitySeq += 1;
      consumer.lastActivityAt = this.#activitySeq;
      return {
        realSessionId: record.info.realSessionId,
        reusedReal,
        rootPath: record.info.rootPath,
        serverId: record.info.serverId,
        virtualSessionId: consumer.virtualSessionId,
      };
    }
    this.#virtualSeq += 1;
    const virtualSessionId = `lspv-${this.#virtualSeq}`;
    this.#activitySeq += 1;
    const consumer: EditorConsumer = {
      deliver: (jsonBody) => input.deliver(virtualSessionId, jsonBody),
      lastActivityAt: this.#activitySeq,
      notifyClosed: (event, treeTerminal) =>
        input.notifyClosed(virtualSessionId, event, treeTerminal),
      virtualSessionId,
      webContentsId: input.webContentsId,
      wireIdByOriginalKey: new Map(),
    };
    record.consumersByVirtualId.set(virtualSessionId, consumer);
    this.#recordByVirtualId.set(virtualSessionId, record);
    return {
      realSessionId: record.info.realSessionId,
      reusedReal,
      rootPath: record.info.rootPath,
      serverId: record.info.serverId,
      virtualSessionId,
    };
  }

  /** language-tools 等 main 侧消费者共享真实会话（无虚拟会话）。 */
  ensureRealSession(input: {
    launch: LspServerLaunchSpec;
    rootPath: string;
    serverId: string;
    workspaceKey: string;
  }): { realSessionId: string; reusedReal: boolean; rootPath: string } {
    const { record, reusedReal } = this.#ensureReal(input);
    return {
      realSessionId: record.info.realSessionId,
      reusedReal,
      rootPath: record.info.rootPath,
    };
  }

  ensureInitialized(realSessionId: string): Promise<unknown> {
    const record = this.#byRealSessionId.get(realSessionId);
    if (!record) {
      return Promise.reject(new Error("LSP session not available"));
    }
    return this.#deps.host.ensureInitialized(
      realSessionId,
      buildLspInitializeParams(record.info.rootPath)
    );
  }

  ensureLanguageToolsDocumentOpen(
    realSessionId: string,
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>
  ): Promise<void> {
    const record = this.#byRealSessionId.get(realSessionId);
    if (!record) {
      return Promise.reject(new Error("LSP session not available"));
    }
    if (record.gate.hasEditorRefs(document.uri)) {
      // 编辑器持有该文档：以编辑器缓冲为服务器真相，不用磁盘内容覆盖。
      return Promise.resolve();
    }
    return this.#deps.host
      .ensureLanguageToolsDocumentOpen(realSessionId, document, readText)
      .then(() => {
        record.gate.holdEphemeral(document.uri);
      });
  }

  handleEditorSend(
    virtualSessionId: string,
    jsonBody: string,
    senderWebContentsId: number
  ): boolean {
    const record = this.#recordByVirtualId.get(virtualSessionId);
    const consumer = record?.consumersByVirtualId.get(virtualSessionId);
    if (!(record && consumer)) {
      return false;
    }
    if (consumer.webContentsId !== senderWebContentsId) {
      return false;
    }
    const parsed = parseEditorJsonRpc(jsonBody);
    if (!parsed) {
      return false;
    }
    this.#activitySeq += 1;
    consumer.lastActivityAt = this.#activitySeq;
    if (typeof parsed.method === "string") {
      return handleEditorMethodMessage(
        this.#routeHost(),
        record,
        consumer,
        parsed,
        jsonBody
      );
    }
    if (isLspRequestId(parsed.id)) {
      const key = lspIdKey(parsed.id);
      if (
        record.serverRequestConsumerByIdKey.get(key) ===
        consumer.virtualSessionId
      ) {
        record.serverRequestConsumerByIdKey.delete(key);
        return this.#deps.host.send(record.info.realSessionId, jsonBody);
      }
    }
    return true;
  }

  workspaceKeyOf(virtualSessionId: string): string | null {
    return (
      this.#recordByVirtualId.get(virtualSessionId)?.info.workspaceKey ?? null
    );
  }

  consumerWebContentsId(virtualSessionId: string): number | null {
    const record = this.#recordByVirtualId.get(virtualSessionId);
    return (
      record?.consumersByVirtualId.get(virtualSessionId)?.webContentsId ?? null
    );
  }

  releaseEditorSession(
    virtualSessionId: string,
    senderWebContentsId?: number
  ): Promise<boolean> {
    const record = this.#recordByVirtualId.get(virtualSessionId);
    const consumer = record?.consumersByVirtualId.get(virtualSessionId);
    if (!(record && consumer)) {
      return Promise.resolve(false);
    }
    if (
      senderWebContentsId !== undefined &&
      consumer.webContentsId !== senderWebContentsId
    ) {
      return Promise.resolve(false);
    }
    this.#detachConsumer(record, consumer);
    return this.#closeIfUnused(record, "client-release");
  }

  async dropConsumersForWebContents(webContentsId: number): Promise<void> {
    const closers: Promise<unknown>[] = [];
    for (const record of this.#byRealSessionId.values()) {
      for (const consumer of [...record.consumersByVirtualId.values()]) {
        if (consumer.webContentsId !== webContentsId) {
          continue;
        }
        this.#detachConsumer(record, consumer);
        closers.push(this.#closeIfUnused(record, "owner-destroyed"));
      }
    }
    await Promise.all(closers);
  }

  /** 治理测试用：当前真实会话数。 */
  realSessionCount(): number {
    return this.#byRealSessionId.size;
  }

  /** 治理测试用：某真实会话上的消费者虚拟 id。 */
  consumerVirtualIdsOf(realSessionId: string): readonly string[] {
    const record = this.#byRealSessionId.get(realSessionId);
    return record ? [...record.consumersByVirtualId.keys()] : [];
  }

  retainLanguageTools(realSessionId: string): void {
    if (!this.#byRealSessionId.has(realSessionId)) {
      return;
    }
    this.#languageToolsHolds.set(
      realSessionId,
      (this.#languageToolsHolds.get(realSessionId) ?? 0) + 1
    );
  }

  releaseLanguageTools(realSessionId: string): void {
    const held = this.#languageToolsHolds.get(realSessionId) ?? 0;
    if (held <= 1) {
      this.#languageToolsHolds.delete(realSessionId);
      return;
    }
    this.#languageToolsHolds.set(realSessionId, held - 1);
  }

  #ensureReal(input: {
    launch: LspServerLaunchSpec;
    rootPath: string;
    serverId: string;
    workspaceKey: string;
  }): { record: RealSessionRecord; reusedReal: boolean } {
    const ensured = this.#deps.host.ensure({
      launch: input.launch,
      onClose: (event, treeTerminal) => {
        this.#handleRealClosed(event, treeTerminal);
      },
      onCloseAccepted: (sessionId) => {
        const info = this.#byRealSessionId.get(sessionId)?.info;
        if (info) {
          this.#deps.onRealSessionCloseAccepted?.(info);
        }
      },
      onMessage: (sessionId, jsonBody, parsed) => {
        const inbound = this.#byRealSessionId.get(sessionId);
        if (inbound) {
          routeBrokerInbound(this.#routeHost(), inbound, jsonBody, parsed);
        }
      },
      rootPath: input.rootPath,
      serverId: input.serverId,
      workspaceKey: input.workspaceKey,
    });
    let record = this.#byRealSessionId.get(ensured.sessionId);
    if (!record) {
      const info: LspRealSessionInfo = {
        realSessionId: ensured.sessionId,
        rootPath: ensured.rootPath,
        serverId: ensured.serverId,
        workspaceKey: input.workspaceKey,
      };
      record = {
        consumersByVirtualId: new Map(),
        gate: new LspDocumentGate({
          documentState: (uri) =>
            this.#deps.host.documentStateOf(ensured.sessionId, uri),
          send: (jsonBody) => this.#deps.host.send(ensured.sessionId, jsonBody),
        }),
        info,
        routesByWireId: new Map(),
        serverRequestConsumerByIdKey: new Map(),
        wireSeq: 0,
      };
      this.#byRealSessionId.set(ensured.sessionId, record);
      this.#realSessionIdByKey.set(
        this.#realKeyOf(record.info),
        record.info.realSessionId
      );
    }
    return { record, reusedReal: ensured.reused };
  }

  #realKeyOf(info: {
    rootPath: string;
    serverId: string;
    workspaceKey: string;
  }): string {
    return `${info.workspaceKey}::${info.serverId}::${info.rootPath}`;
  }

  #routeHost() {
    return {
      ensureInitialized: (realSessionId: string) =>
        this.ensureInitialized(realSessionId),
      host: this.#deps.host,
      ...(this.#deps.logger ? { logger: this.#deps.logger } : {}),
    };
  }

  #closeIfUnused(
    record: RealSessionRecord,
    cause: "client-release" | "owner-destroyed"
  ): Promise<boolean> {
    if (
      record.consumersByVirtualId.size > 0 ||
      (this.#languageToolsHolds.get(record.info.realSessionId) ?? 0) > 0
    ) {
      return Promise.resolve(true);
    }
    return this.#deps.host.close(record.info.realSessionId, cause);
  }

  #detachConsumer(record: RealSessionRecord, consumer: EditorConsumer): void {
    record.gate.releaseConsumer(consumer.virtualSessionId);
    record.consumersByVirtualId.delete(consumer.virtualSessionId);
    this.#recordByVirtualId.delete(consumer.virtualSessionId);
    for (const [wireId, route] of record.routesByWireId) {
      if (route.virtualSessionId === consumer.virtualSessionId) {
        record.routesByWireId.delete(wireId);
      }
    }
    for (const [key, virtualId] of record.serverRequestConsumerByIdKey) {
      if (virtualId === consumer.virtualSessionId) {
        record.serverRequestConsumerByIdKey.delete(key);
      }
    }
  }

  #handleRealClosed(
    event: LspSessionClosedEvent,
    treeTerminal: Promise<void>
  ): void {
    const record = this.#byRealSessionId.get(event.sessionId);
    if (!record) {
      return;
    }
    this.#byRealSessionId.delete(event.sessionId);
    this.#languageToolsHolds.delete(event.sessionId);
    const realKey = this.#realKeyOf(record.info);
    if (this.#realSessionIdByKey.get(realKey) === event.sessionId) {
      this.#realSessionIdByKey.delete(realKey);
    }
    this.#deps.onRealSessionClosed?.(record.info, event, treeTerminal);
    for (const consumer of record.consumersByVirtualId.values()) {
      this.#recordByVirtualId.delete(consumer.virtualSessionId);
      consumer.notifyClosed(
        { ...event, sessionId: consumer.virtualSessionId },
        treeTerminal
      );
    }
    record.consumersByVirtualId.clear();
    record.gate.clear();
  }
}
