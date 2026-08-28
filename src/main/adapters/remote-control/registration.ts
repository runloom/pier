/**
 * remote-control 启停 owner：仿 cli local-control registration 的状态机。
 * 默认不启动（适配器默认关闭的全局约束）；start/stop 由设置开关的装配侧调用。
 * 串行化 start/stop 竞争：stop 等待进行中的 start 收口；失败写日志并回到 stopped。
 */
import type { RemoteControlServer } from "./server.ts";

export type RemoteControlRegistrationPhase =
  | "running"
  | "starting"
  | "stopped"
  | "stopping";

export interface RemoteControlRegistrationOwner {
  start(): Promise<void>;
  state(): RemoteControlRegistrationPhase;
  stop(): Promise<void>;
}

export function createRemoteControlRegistrationOwner(args: {
  logError(error: unknown): void;
  server: RemoteControlServer;
}): RemoteControlRegistrationOwner {
  const { logError, server } = args;
  let phase: RemoteControlRegistrationPhase = "stopped";
  let pendingStart: Promise<void> | null = null;
  let pendingStop: Promise<void> | null = null;

  const owner: RemoteControlRegistrationOwner = {
    start() {
      if (phase === "starting" || phase === "running") {
        return pendingStart ?? Promise.resolve();
      }
      if (phase === "stopping") {
        return (pendingStop ?? Promise.resolve()).then(() => owner.start());
      }
      phase = "starting";
      pendingStart = (async () => {
        try {
          await server.start();
          if (phase === "starting") {
            phase = "running";
          }
        } catch (error) {
          logError(error);
          if (phase === "starting") {
            phase = "stopped";
          }
        } finally {
          pendingStart = null;
        }
      })();
      return pendingStart;
    },
    state() {
      return phase;
    },
    stop() {
      if (phase === "stopped") {
        return pendingStop ?? Promise.resolve();
      }
      if (pendingStop) {
        return pendingStop;
      }
      const awaitedStart = phase === "starting" ? pendingStart : null;
      phase = "stopping";
      pendingStop = (async () => {
        await awaitedStart;
        try {
          await server.stop();
        } catch (error) {
          logError(error);
        }
        phase = "stopped";
        pendingStop = null;
      })();
      return pendingStop;
    },
  };
  return owner;
}
