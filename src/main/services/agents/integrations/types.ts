import type { AgentKind } from "@shared/contracts/agent.ts";

/**
 * agent hook 集成能力档位（对齐 loomdesk HookCapability / 目录 statusSupport）：
 * - full：完整生命周期事件（prompt/tool/permission/stop）
 * - coarse：粗粒度（仅回合级或工具级少数事件）
 * - none：无 hook 机制, 仅标题/进程兜底（此类不注册集成模块）
 */
export type AgentHookCapability = "coarse" | "full";

/**
 * 单个 agent 的 hook 集成。设计约束（沿袭 claude 集成的既有纪律）：
 * - install/uninstall 幂等；配置损坏不覆盖；语义无变化不落盘；原子写。
 * - 事件映射在安装时完成（hook 命令直接携带 pier 规范事件名, loomdesk 模式）,
 *   接收端（loopback 服务器/聚合器）完全 agent 无关, 零改动。
 * - 路由凭证一律运行时读 PIER_* 环境变量（PTY 注入）, 配置内容为静态文本。
 * - detect() false 时 install/uninstall 均跳过（不视为错误）。
 */
export interface AgentHookIntegration {
  readonly capability: AgentHookCapability;
  detect(): boolean;
  readonly id: AgentKind;
  install(): Promise<void>;
  uninstall(): Promise<void>;
}
