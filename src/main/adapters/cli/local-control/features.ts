/**
 * feature 广告、op 名单常量与 server.error 帧构造。
 */
import {
  LOCAL_CONTROL_API_VERSION,
  type LocalControlErrorCode,
} from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";

export const LOCAL_CONTROL_FEATURE_AGENTS_CATALOG = "agents.catalog";
export const LOCAL_CONTROL_FEATURE_AGENTS_LIST = "agents.list";
export const LOCAL_CONTROL_FEATURE_AGENTS_GET = "agents.get";
export const LOCAL_CONTROL_FEATURE_AGENTS_START = "agents.start";
export const LOCAL_CONTROL_FEATURE_AGENTS_TURN = "agents.turn";
export const LOCAL_CONTROL_FEATURE_AGENTS_SCREEN = "agents.screen";
export const LOCAL_CONTROL_FEATURE_AGENTS_WAIT = "agents.wait";
export const LOCAL_CONTROL_FEATURE_AGENTS_WATCH = "agents.watch";
export const LOCAL_CONTROL_FEATURE_AGENTS_FOCUS = "agents.focus";
export const LOCAL_CONTROL_FEATURE_AGENTS_INTERRUPT = "agents.interrupt";
export const LOCAL_CONTROL_FEATURE_AGENTS_TERMINATE = "agents.terminate";
export const LOCAL_CONTROL_FEATURE_CONTROL_HOLD = "control.hold";
export const LOCAL_CONTROL_FEATURE_CONTROL_TRACE = "control.trace";
export const LOCAL_CONTROL_FEATURE_CONTROL_SNAPSHOT = "control.snapshot";
export const LOCAL_CONTROL_FEATURE_CONTROL_WATCH = "control.watch";
export const LOCAL_CONTROL_FEATURE_SUBSCRIBE = "stream.subscribe";

/** 持久运行 op 单一名单（authorize / session 路由 / handlers 共用）。 */
export const AGENTS_RUNTIME_OPS = [
  LOCAL_CONTROL_FEATURE_AGENTS_START,
  LOCAL_CONTROL_FEATURE_AGENTS_TURN,
  LOCAL_CONTROL_FEATURE_AGENTS_SCREEN,
  LOCAL_CONTROL_FEATURE_AGENTS_WAIT,
  LOCAL_CONTROL_FEATURE_AGENTS_WATCH,
  LOCAL_CONTROL_FEATURE_AGENTS_FOCUS,
  LOCAL_CONTROL_FEATURE_AGENTS_INTERRUPT,
  LOCAL_CONTROL_FEATURE_AGENTS_TERMINATE,
] as const;

export type AgentsRuntimeOp = (typeof AGENTS_RUNTIME_OPS)[number];

/** 需 effectKey + receipt 的写 op（focus 只读焦点，不入此集）。 */
export const AGENTS_RUNTIME_WRITE_OPS = [
  LOCAL_CONTROL_FEATURE_AGENTS_START,
  LOCAL_CONTROL_FEATURE_AGENTS_TURN,
  LOCAL_CONTROL_FEATURE_AGENTS_INTERRUPT,
  LOCAL_CONTROL_FEATURE_AGENTS_TERMINATE,
] as const;

const DISCOVERY_FEATURES = [
  LOCAL_CONTROL_FEATURE_AGENTS_CATALOG,
  LOCAL_CONTROL_FEATURE_AGENTS_LIST,
  LOCAL_CONTROL_FEATURE_AGENTS_GET,
] as const;

const CONTROL_FEATURES = [
  LOCAL_CONTROL_FEATURE_CONTROL_HOLD,
  LOCAL_CONTROL_FEATURE_CONTROL_TRACE,
  LOCAL_CONTROL_FEATURE_CONTROL_SNAPSHOT,
  LOCAL_CONTROL_FEATURE_CONTROL_WATCH,
  LOCAL_CONTROL_FEATURE_SUBSCRIBE,
] as const;

/** hello 默认可广告能力 = 发现 + 持久运行名单 + 控制探针/订阅。 */
const BASE_ADVERTISED_FEATURES = [
  ...DISCOVERY_FEATURES,
  ...AGENTS_RUNTIME_OPS,
  ...CONTROL_FEATURES,
] as const;

export function serverErrorFrame(
  code: LocalControlErrorCode,
  message: string
): LocalControlServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "server.error",
    code,
    message,
  };
}

export function buildLocalControlFeatures(
  base: readonly string[] = []
): string[] {
  const set = new Set(base);
  for (const f of BASE_ADVERTISED_FEATURES) {
    set.add(f);
  }
  return [...set];
}
