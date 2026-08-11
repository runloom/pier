import { randomUUID } from "node:crypto";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import { app } from "electron";
import type { PierAppCore } from "../../app-core/index.ts";
import { appCore } from "../../app-core/index.ts";
import type { AgentCallerCredentialStore } from "../../services/agent-caller/credential-store.ts";
import { createAgentCallerCredentialStore } from "../../services/agent-caller/credential-store.ts";
import {
  type AgentCallerIssuer,
  bindAgentCallerIssuer,
} from "../../services/agent-caller/host-bind.ts";
import {
  type IssueAgentCallerCredentialArgs,
  type IssuedAgentCallerCredential,
  issueAgentCallerCredential,
} from "../../services/agent-caller/issue-credential.ts";
import { createStaticAgentsDiscovery } from "./agents-discovery.ts";
import { createDefaultLocalControlAuthorizer } from "./local-control-authorize.ts";
import { createEffectReceiptStore } from "./local-control-receipts.ts";
import {
  createPierLocalControlServer,
  type PierLocalControlServer,
  resolveLocalControlSocketPath,
} from "./local-control-server.ts";

export interface RegisteredLocalControl {
  bootId: string;
  close(): Promise<void>;
  /** 与控制面共享的凭证索引（启动链 put / 测试注入） */
  credentialStore: AgentCallerCredentialStore;
  /**
   * 签发凭证：内存注册 + 私有文件，供子进程 env 注入。
   * 架构闭环生产路径；后续 AgentCallerService 应调用此入口。
   */
  issueAgentCredential: (
    args?: Omit<IssueAgentCallerCredentialArgs, "store" | "bootId">
  ) => IssuedAgentCallerCredential;
  socketPath: string;
}

export interface RegisterCliLocalControlArgs {
  core?: PierAppCore;
  signal?: AbortSignal;
  userDataDir?: string;
}

function registerCliClient(core: PierAppCore): PierClient {
  const now = Date.now();
  return core.clients.register({
    capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"],
    createdAt: now,
    id: "cli-local",
    kind: "cli-local",
    lastSeenAt: now,
  });
}

function clientIdOf(envelope: unknown): string | null {
  if (
    envelope &&
    typeof envelope === "object" &&
    "clientId" in envelope &&
    typeof envelope.clientId === "string"
  ) {
    return envelope.clientId;
  }
  return null;
}

export async function registerCliLocalControl({
  core = appCore,
  signal,
  userDataDir = app.getPath("userData"),
}: RegisterCliLocalControlArgs = {}): Promise<RegisteredLocalControl> {
  registerCliClient(core);
  const socketPath = resolveLocalControlSocketPath(userDataDir);
  const credentialStore = createAgentCallerCredentialStore();
  const authorizer = createDefaultLocalControlAuthorizer();
  const receipts = createEffectReceiptStore();
  const discovery = createStaticAgentsDiscovery(() =>
    core.services.agentRuntimeIndex.listMachine()
  );
  const bootId = randomUUID();
  const server: PierLocalControlServer = createPierLocalControlServer({
    handleRequest(envelope) {
      const clientId = clientIdOf(envelope);
      if (clientId) {
        core.clients.heartbeat(clientId);
      }
      return core.commandRouter.execute(envelope);
    },
    socketPath,
    bootId,
    credentialStore,
    discovery,
    authorizer,
    receipts,
  });
  const issueAgentCredential: AgentCallerIssuer = (args = {}) =>
    issueAgentCallerCredential({
      ...args,
      store: credentialStore,
      bootId: server.bootId,
    });

  try {
    await server.start(signal);
    if (signal?.aborted) {
      throw new DOMException(
        "Local control registration aborted",
        "AbortError"
      );
    }
    // 实验/单测入口：手动 issue 仍可走 host-bind。产品 spawn **不**注入 binding
    //（见 create-handler + design 实现水位）；关闭时必须 unbind。
    bindAgentCallerIssuer(issueAgentCredential);
    return {
      close: async () => {
        bindAgentCallerIssuer(null);
        await server.close();
      },
      socketPath,
      bootId: server.bootId,
      credentialStore,
      issueAgentCredential,
    };
  } catch (error) {
    bindAgentCallerIssuer(null);
    await server.close().catch(() => undefined);
    throw error;
  }
}
