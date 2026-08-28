/**
 * remote-control 装配（Task 13）：pairing 服务 + LAN server + registration
 * owner 组装进 appCore.services。默认关：构造期零监听，只有设置开远程访问
 * （remoteAccess.setEnabled(true) → owner.start）才监听；quit 路径由
 * src/main/index.ts stop + flushPairingState。
 *
 * §8 共存共享：sessionDeps 经 getter 惰性读 core.services.controlPlane 单例
 * （CLI 轨 registerCliLocalControl 注册时挂载、close 时摘除），移动端
 * control.snapshot/watch 与 agents.* 因此拿到与 UDS local-control 同一份
 * 快照/发现/运行时控制依赖；CLI 轨未注册时缺省降级（相关 op 回
 * unavailable/unsupported 类错误），绝不另建第二实例与之竞争。
 *
 * SPA 静态托管目录：monorepo 产物 out/mobile-web。打包 asar 根含 out/**；
 * unpackaged e2e/dev 的 getAppPath() 常是 out/main，见 resolveMobileWebSpaDistDir。
 * pairing store 构造期不 init（首次 remoteAccess 命令才加载）。
 */
import { randomUUID } from "node:crypto";
import type { PierCommandEnvelope } from "@shared/contracts/commands.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import type { PierClientRegistry } from "../../app-core/client-registry.ts";
import type {
  CommandRouter,
  PierCoreServices,
} from "../../app-core/command-router.ts";
import type { PairingService } from "../../services/pairing/service.ts";
import { createPairingService } from "../../services/pairing/service.ts";
import { getSharedPairingStore } from "../../state/pairing-store.ts";
import type { CreateLocalControlSessionArgs } from "../cli/local-control/session.ts";
import type { RemoteControlRegistrationOwner } from "./registration.ts";
import { createRemoteControlRegistrationOwner } from "./registration.ts";
import {
  createRemoteControlServer,
  type RemoteControlServer,
} from "./server.ts";
import {
  attachMobileSession,
  createMobileSessionTracker,
} from "./session-bridge.ts";
import { resolveMobileWebSpaDistDir } from "./static-spa.ts";

const log = createLogger("remote-control");

export interface RemoteControlBoot {
  owner: RemoteControlRegistrationOwner;
  pairing: PairingService;
  server: RemoteControlServer;
  /** 直接摊入 PierCoreServices 的键（remoteAccess.* 命令面消费）。 */
  services: Pick<PierCoreServices, "pairing" | "remoteControl">;
  /** executeCommand 桥的延迟绑定（见文件头注释）。 */
  setCommandRouter(router: CommandRouter): void;
}

export function bootAppCoreRemoteControl(args: {
  clients: PierClientRegistry;
  /**
   * core.services 惰性访问器：装配期 services 字面量尚未建好，getter 只在
   * WS hello 之后求值（DI 边界，由 index.ts 注入）。
   */
  getServices: () => PierCoreServices;
}): RemoteControlBoot {
  const store = getSharedPairingStore();
  // 默认关：构造期不 init / 不写 pairing.json。首次 remoteAccess.* 或
  // owner.start 才加载；否则 FIFO 启动关窗会与 userData 写盘竞态挂死。
  const pairing = createPairingService({ store });
  const sessionTracker = createMobileSessionTracker();
  const { getServices } = args;
  // receipts：boot 级内存幂等层——选「跨适配器共享」：直接复用 CLI 轨的
  // EffectReceiptStore 实例，两轨同一 effectKey 幂等空间；CLI 轨未注册时
  // 缺省（会话层回退自建临时实例，见 session.ts receipts ?? 分支）。
  const fallbackBootId = randomUUID();
  // getter 在 session-bridge hello 时经 {...ctx.sessionDeps} 展开求值一次，
  // 会话内快照化：中途 CLI 轨 close 摘除不会撕裂已建立会话的依赖引用。
  const sessionDeps: Omit<
    CreateLocalControlSessionArgs,
    "authorizer" | "emit"
  > = {
    get bootId() {
      return getServices().controlPlane?.bootId ?? fallbackBootId;
    },
    get capabilityAuthority() {
      return getServices().controlPlane?.capabilityAuthority;
    },
    get discovery() {
      return getServices().controlPlane?.discovery;
    },
    get receipts() {
      return getServices().controlPlane?.receipts;
    },
    get resolveOriginPanel() {
      return getServices().controlPlane?.resolveOriginPanel;
    },
    get runtimeControl() {
      return getServices().controlPlane?.runtimeControl;
    },
    get snapshotService() {
      return getServices().controlPlane?.snapshotService;
    },
  };
  let commandRouter: CommandRouter | null = null;
  const executeCommand = (envelope: PierCommandEnvelope): Promise<unknown> => {
    const router = commandRouter;
    if (router === null) {
      return Promise.resolve({
        ok: false,
        error: { code: "internal_error", message: "command router not ready" },
      });
    }
    return router.execute(envelope);
  };
  const server = createRemoteControlServer({
    clients: args.clients,
    executeCommand,
    onWebSocketConnection: (ws, req) => {
      attachMobileSession(ws, {
        clients: args.clients,
        executeCommand,
        pairing,
        recordFailure: (remoteAddress) => server.recordFailure(remoteAddress),
        recordSuccess: (remoteAddress) => server.recordSuccess(remoteAddress),
        remoteAddress: req.socket.remoteAddress ?? "",
        sessionDeps,
        sessionTracker,
      });
    },
    pairing,
    sessionDeps,
    spaDistDir: resolveMobileWebSpaDistDir(app.getAppPath()),
  });
  const registration = createRemoteControlRegistrationOwner({
    logError: (error) => {
      log.error("remote-control server start/stop failed", { error });
    },
    server,
  });
  return {
    owner: registration,
    pairing,
    server,
    services: {
      pairing,
      remoteControl: {
        owner: registration,
        server,
      },
    },
    setCommandRouter(router) {
      commandRouter = router;
    },
  };
}
