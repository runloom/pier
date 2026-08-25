import { randomUUID } from "node:crypto";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import { app } from "electron";
import type { PierAppCore } from "../../app-core/index.ts";
import { appCore } from "../../app-core/index.ts";
import {
  authorizerFromCapabilityAuthority,
  createCapabilityAuthority,
} from "../../services/capability/authority.ts";
import { controlSnapshotSourcesFromCore } from "../../services/control-snapshot/from-core.ts";
import { createControlSnapshotService } from "../../services/control-snapshot/service.ts";
import { createFakeTerminalBackend } from "../../services/runtime-control/fake-backend.ts";
import { createHostTerminalBackend } from "../../services/runtime-control/host-backend.ts";
import {
  onTerminalPanelClosed,
  onTerminalPtyExited,
} from "../../services/runtime-control/panel-close-listeners.ts";
import { createRuntimeControlService } from "../../services/runtime-control/service.ts";
import { createStaticAgentsDiscovery } from "./local-control/agents-discovery.ts";
import { createDefaultLocalControlAuthorizer } from "./local-control/authorize.ts";
import {
  type ResolveOriginPanel,
  releaseRuntimeReservation,
} from "./local-control/capability-hot-path.ts";
import { createEffectReceiptStore } from "./local-control/receipts.ts";
import {
  createPierLocalControlServer,
  type PierLocalControlServer,
  resolveLocalControlSocketPath,
} from "./local-control/server.ts";

export interface RegisteredLocalControl {
  bootId: string;
  close(): Promise<void>;
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
  const capabilityAuthority = createCapabilityAuthority({
    base: createDefaultLocalControlAuthorizer(),
  });
  const authorizer = authorizerFromCapabilityAuthority(capabilityAuthority);
  const receipts = createEffectReceiptStore();
  const discovery = createStaticAgentsDiscovery(() =>
    core.services.agentRuntimeIndex.listMachine()
  );
  // R18：agents.start 发起方解析——panelId 与 windowId 都命中 FA 索引才算有效 origin。
  const resolveOriginPanel: ResolveOriginPanel = (panelId, windowId) => {
    try {
      const hit = core.services.agentRuntimeIndex
        .listMachine()
        .entries.find(
          (entry) => entry.panelId === panelId && entry.windowId === windowId
        );
      return hit ? { agentId: hit.agentId } : undefined;
    } catch {
      return;
    }
  };
  const bootId = randomUUID();
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
    // R10：UI 关面板 → 释放子额占位（boot 进程内配额）。
    releaseReservation: (runtimeId) => {
      releaseRuntimeReservation({ authority: capabilityAuthority, runtimeId });
    },
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
  const unsubscribePanelClose = onTerminalPanelClosed((panelId) => {
    runtimeControl.releaseForPanel(panelId);
  });
  // pty 退出（含用户在子终端里 exit）：运行时已死即释放占额；后关面板幂等。
  const unsubscribePtyExit = onTerminalPtyExited((panelId) => {
    runtimeControl.releaseForPanel(panelId);
  });
  core.services.controlRuntimes = {
    listRuntimeSummaries: () => runtimeControl.listRuntimeSummaries(),
  };
  const snapshotService = createControlSnapshotService(
    controlSnapshotSourcesFromCore(core.services, bootId)
  );
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
    discovery,
    authorizer,
    receipts,
    runtimeControl,
    capabilityAuthority,
    resolveOriginPanel,
    snapshotService,
  });
  try {
    await server.start(signal);
    if (signal?.aborted) {
      throw new DOMException(
        "Local control registration aborted",
        "AbortError"
      );
    }

    return {
      close: async () => {
        unsubscribePanelClose();
        unsubscribePtyExit();
        Reflect.deleteProperty(core.services, "controlSnapshot");
        Reflect.deleteProperty(core.services, "controlBootId");
        await server.close();
      },
      socketPath,
      bootId: server.bootId,
    };
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}
