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
import {
  authorizerFromCapabilityAuthority,
  createCapabilityAuthority,
} from "../../services/capability/authority.ts";
import { controlSnapshotSourcesFromCore } from "../../services/control-snapshot/from-core.ts";
import { createControlSnapshotService } from "../../services/control-snapshot/service.ts";
import { createFakeTerminalBackend } from "../../services/runtime-control/fake-backend.ts";
import { createHostTerminalBackend } from "../../services/runtime-control/host-backend.ts";
import { createRuntimeControlService } from "../../services/runtime-control/service.ts";
import { createStaticAgentsDiscovery } from "./local-control/agents-discovery.ts";
import { createDefaultLocalControlAuthorizer } from "./local-control/authorize.ts";
import { createEffectReceiptStore } from "./local-control/receipts.ts";
import {
  createPierLocalControlServer,
  type PierLocalControlServer,
  resolveLocalControlSocketPath,
} from "./local-control/server.ts";

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
  const capabilityAuthority = createCapabilityAuthority({
    base: createDefaultLocalControlAuthorizer(),
  });
  const authorizer = authorizerFromCapabilityAuthority(capabilityAuthority);
  const receipts = createEffectReceiptStore();
  const discovery = createStaticAgentsDiscovery(() =>
    core.services.agentRuntimeIndex.listMachine()
  );
  const bootId = randomUUID();
  // 仅 dev/test 允许 fake；打包产物忽略 PIER_RUNTIME_CONTROL_FAKE，避免静默假后端。
  const wantFake =
    process.env.PIER_RUNTIME_CONTROL_FAKE === "1" ||
    process.env.PIER_RUNTIME_CONTROL_FAKE === "true";
  const useFakeBackend = wantFake && !app.isPackaged;
  const runtimeControl = createRuntimeControlService({
    bootId,
    backend: useFakeBackend
      ? createFakeTerminalBackend()
      : createHostTerminalBackend({
          executeCommand: (envelope) => core.commandRouter.execute(envelope),
        }),
    // wait 谓词：从 Runtime Index / FA 投影状态（无则回落 registry fact）
    resolveFact: (record) => {
      if (record.closed) {
        return "exited";
      }
      try {
        const snap = core.services.agentRuntimeIndex.listMachine();
        const hit = snap.entries.find(
          (e) => e.panelId === record.panelId && e.windowId === record.windowId
        );
        if (hit?.status) {
          return hit.status;
        }
      } catch {
        /* FA 未就绪时忽略 */
      }
      return record.fact;
    },
  });
  const snapshotService = createControlSnapshotService(
    controlSnapshotSourcesFromCore(core.services, bootId)
  );
  // 与 v1 app.snapshot 共享 revision 高水位（桌面 IPC 与 CLI 对齐）
  core.services.controlBootId = bootId;
  core.services.controlSnapshot = snapshotService;
  const server: PierLocalControlServer = createPierLocalControlServer({
    handleRequest(envelope, context) {
      const clientId = clientIdOf(envelope);
      if (clientId) {
        core.clients.heartbeat(clientId);
      }
      return core.commandRouter.execute(envelope, {
        ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {}),
      });
    },
    socketPath,
    bootId,
    credentialStore,
    discovery,
    authorizer,
    receipts,
    runtimeControl,
    snapshotService,
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
        // exactOptionalPropertyTypes：用 Reflect.deleteProperty 清可选字段
        Reflect.deleteProperty(core.services, "controlSnapshot");
        Reflect.deleteProperty(core.services, "controlBootId");
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
