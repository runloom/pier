import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentStopAuthority } from "../../foreground-activity/types.ts";
import type { AgentStatusEvidence } from "./evidence/matrix.ts";

export interface AgentRuntimeSemantics {
  /** 实际安装的 hook / 插件可发出的原生事件与 Pier 规范事件的精确对应。 */
  emittedMappings: readonly AgentRuntimeEventMapping[];
  /** 当前集成映射出的 canonical Stop 是否足以结算用户回合。 */
  stopAuthority: AgentStopAuthority;
}

export interface AgentRuntimeEventMapping {
  readonly nativeEvent: string;
  readonly pierEvent: string;
  readonly turnStartAuthority?: "authoritative";
}

/**
 * 单个 agent 的 hook 集成。设计约束（沿袭 claude 集成的既有纪律）：
 * - install/uninstall 幂等；配置损坏不覆盖；语义无变化不落盘；原子写。
 * - 事件映射在安装时完成（hook 命令直接携带 pier 规范事件名, loomdesk 模式）,
 *   接收端（loopback 服务器/聚合器）完全 agent 无关, 零改动。
 * - 路由凭证一律运行时读 PIER_* 环境变量（PTY 注入）, 配置内容为静态文本。
 * - detect() false 时 install/uninstall 均跳过（不视为错误）。
 */
export interface AgentHookIntegration {
  detect(): boolean;
  readonly id: AgentKind;
  install(): Promise<void>;
  readonly runtime: AgentRuntimeSemantics;
  uninstall(): Promise<void>;
}

/** A registry entry is the integration implementation plus its audited facts. */
export interface RegisteredAgentHookIntegration extends AgentHookIntegration {
  readonly statusEvidence: AgentStatusEvidence;
}
