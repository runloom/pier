import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../hooks-install.ts";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  maxPierHookGenerationInSettings,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinValueDispatch,
  preflightPierNestedHooksInstall,
  readJsonConfig,
  transformJsonConfig,
  transformPierHooksUnlessNewer,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

/**
 * Droid (Factory AI) 当前规范 hook 配置路径是 **~/.factory/hooks.json**，
 * 且独立 hooks.json 的事件键**直接在顶层**（官方 hooks 文档：「Standalone
 * hooks.json files are keyed directly by event name」；`hooks` 包裹结构
 * 仅用于 settings.json）。历史实现误把 wrapped 结构写进独立文件——
 * droid 0.213.0 一手对照实验（2026-09-06）：wrapped 独立文件整份被忽略、
 * hook 永不执行，flat 顶层结构正常执行；据此修复为 flat 写入，并在安装
 * 时迁移清理旧 wrapped Pier 条目（用户/orca 条目原样保留）。
 *
 * 自 v0.136.0 起官方将 hooks 路径标准化为 hooks.json；只有该文件不存在时
 * 才回退读取 matching settings.json 的 `hooks`。因此首次创建 hooks.json
 * 时必须先合并 fallback 中的用户 hooks——写入 **flat 顶层事件键**（droid
 * 唯一读取的形态；写进 wrapped 记录等于静默丢弃），否则新文件会遮蔽它们；
 * 成功后只剔除 settings.json 内的旧 Pier 条目，用户设置与用户 hooks 均保留。
 *
 * 官方事件全集（docs.factory.ai 9 事件表）：PreToolUse, PostToolUse,
 * UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact,
 * SessionStart, SessionEnd。`StopFailure` 不在官方事件表，不能用其他产品
 * 的本机配置把它升级为 Droid 事实。
 * Notification 的 permission_prompt / elicitation_dialog 只有无关联 ID 的
 * 请求通知，没有结果 hook，不能形成 waiting 闭环。Droid 没有 SubagentStart，
 * 单独安装 SubagentStop 无法建立身份与开始边界，故不安装。
 *
 * **取消路径（2026-08-29 审计，@factory/cli 0.202.0 二进制一手证据）**：
 * 用户取消（Esc）发 `Notification` 而**不发 Stop**（官方文档「Cancellation
 * emits the informational Notification hook instead of Stop」）。binary 全量
 * 只有三种 notification_type：`idle_prompt`（唯一发射点在
 * requestCancelledByUser 路径，message="Agent stopped by user and is
 * waiting for input"）、`permission_prompt`、`elicitation_dialog`。因此
 * Notification 按 `notification_type` 在命令内分发：`idle_prompt` →
 * TurnInterrupted（可信中断终态；否则取消后在飞工具钉住「执行工具中」
 * 直到下次提问或 30 分钟 TTL）；其余请求型通知落 processing（回合内
 * 等审批仍是推进，避免 TTL 早衰；无结果 hook 不能进 waiting）。
 * 注意 droid 的 Notification 派发**不给 matcher 传值**（binary：payload
 * 第二参 void 0，roA(!H)=true 直接放行）——config 级 matcher 对
 * Notification 不过滤，必须走 stdin 值分发。
 *
 * 子会话锚点：SessionStart 载荷含 `calling_session_id`（由工具调用派生的
 * 会话，binary sessionOrigin 字段）——映射 parentSessionId。该 SessionStart
 * 会被子会话旁路丢掉，聚合器在丢弃前登记 child→parent，后续只有子
 * sessionId 的工具事件仍按子会话丢弃，不建幽灵主 scope。
 * `previous_session_id` 是 resume 语义，不得映射 parent。
 */
const droidConfigPath = () => join(homedir(), ".factory", "hooks.json");
const droidLegacySettingsPath = () =>
  join(homedir(), ".factory", "settings.json");

async function cleanupDroidLegacySettings(): Promise<void> {
  if (!existsSync(droidLegacySettingsPath())) {
    return;
  }
  await transformJsonConfig(
    droidLegacySettingsPath(),
    withoutPierDroidHooks,
    "droid-settings-legacy"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 按 command 粒度清理 Pier hook（wrapped settings.json 与 flat hooks.json
 * 两形态共用）。Factory 允许同一 matcher 含多个 handler，不能因为其中一个
 * 由 Pier 管理就连同用户 handler 一起删除。
 */
function withoutPierDroidHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings, DROID_SPEC);
}

/**
 * 把 settings.json fallback 内的用户 hooks（wrapped 记录）迁移进独立
 * hooks.json 的 **flat 顶层事件键**——droid 只读 flat 形态，写进 wrapped
 * `hooks` 记录等于静默丢弃（新文件一旦存在，settings fallback 即被遮蔽）。
 */
function mergeDroidUserHooks(
  canonical: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(fallback.hooks)) {
    return canonical;
  }
  const next: Record<string, unknown> = { ...canonical };
  let changed = false;
  for (const [event, fallbackEntries] of Object.entries(fallback.hooks)) {
    // 事件名恰为 "hooks" 会覆盖 legacy wrapped 记录，禁止迁移该键。
    if (event === "hooks") {
      continue;
    }
    if (Object.hasOwn(next, event) && !Array.isArray(next[event])) {
      // canonical 用户值所有权优先；不得把未知结构当空数组后用 fallback 覆盖。
      continue;
    }
    // flat 事件键必须是数组：非数组 fallback 值不迁移（写入畸形值会让
    // droid 忽略整份新文件），原值留在 settings.json 不丢失。
    if (!Array.isArray(fallbackEntries)) {
      continue;
    }
    const canonicalEntries = Array.isArray(next[event])
      ? [...(next[event] as unknown[])]
      : [];
    const serialized = new Set(
      canonicalEntries.map((entry) => JSON.stringify(entry))
    );
    for (const entry of fallbackEntries) {
      const key = JSON.stringify(entry);
      if (!serialized.has(key)) {
        canonicalEntries.push(entry);
        serialized.add(key);
        changed = true;
      }
    }
    if (canonicalEntries.length > 0) {
      next[event] = canonicalEntries;
    }
  }
  return changed ? next : canonical;
}

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

function droidStandardCommand(
  event: StandardV3Event,
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({ agentId, event, nativeEvent });
}

const DROID_SPEC: NestedJsonIntegrationSpec = {
  agentId: "droid",
  // 独立 hooks.json 事件键在顶层（官方规范）；settings.json fallback 才用
  // `hooks` 包裹。见文件头「2026-09-06」对照实验。
  hooksKeyStyle: "flat",
  runtime: { stopAuthority: "advisory" },
  configPath: droidConfigPath,
  detect: () =>
    existsSync(droidConfigPath()) ||
    existsSync(droidLegacySettingsPath()) ||
    commandExistsOnPath("droid"),
  events: [
    {
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdin({
          agentId,
          event: "SessionStart",
          nativeEvent: "SessionStart",
          // calling_session_id = 由工具调用派生的子会话锚点（binary 一手
          // 证据）；resume 语义的 previous_session_id 不得映射 parent。
          parentSessionIdFields: ["calling_session_id"],
        }),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: droidStandardCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
    {
      buildCommand: droidStandardCommand("PromptSubmit", "UserPromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      // 官方 Stop 只在主 agent 完成回复（回合终态）时发射；取消不发 Stop
      // 只发 Notification（见文件头「取消路径」）。因此 Stop 是可信完成
      // 事实，按 copilot `agentStop→TurnCompleted` 同款直接映射
      // TurnCompleted（trusted terminal）。若映射 advisory pier Stop 只能
      // 产生 completionObserved 候选：droid 无 transcript 对账、无原生
      // ready 兜底，终态永远到不了 ready——agent.turn-finished 通知与
      // 智能体列表 ready 桶全部失效（2026-09-05 修复）。
      buildCommand: droidStandardCommand("TurnCompleted", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "TurnCompleted",
    },
    {
      // 取消不发 Stop 只发 Notification（见文件头「取消路径」）。matcher
      // 对 Notification 无效（droid 不传匹配值），按 notification_type
      // 在命令内分发：idle_prompt=用户取消后等输入 → TurnInterrupted。
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdinValueDispatch({
          agentId,
          cases: [{ nativeValue: "idle_prompt", pierEvent: "TurnInterrupted" }],
          fallbackPierEvent: "processing",
          nativeEvent: "Notification",
          nativeStateFields: ["notification_type"],
        }),
      emittedPierEvents: ["TurnInterrupted", "processing"],
      nativeEvent: "Notification",
      pierEvent: "processing",
    },
    {
      buildCommand: droidStandardCommand("processing", "PreCompact"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: droidStandardCommand("ToolStart", "PreToolUse"),
      matcher: ".*",
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: droidStandardCommand("ToolComplete", "PostToolUse"),
      matcher: ".*",
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
  ],
};

export const DROID_HOOK_EVENTS = DROID_SPEC.events;

const droidBase = createNestedJsonIntegration(DROID_SPEC);

export const droidIntegration: typeof droidBase = {
  ...droidBase,
  install: async () => {
    const canonicalExisted = existsSync(droidConfigPath());
    // 损坏的规范配置不能被覆盖，也不能先删掉仍可能生效的 settings fallback。
    const canonical = await readJsonConfig(droidConfigPath());
    if (canonical === null) {
      await droidBase.install();
      return;
    }
    if (!preflightPierNestedHooksInstall(canonical, DROID_SPEC)) {
      return;
    }
    const fallback = existsSync(droidLegacySettingsPath())
      ? await readJsonConfig(droidLegacySettingsPath())
      : {};
    // hooks.json 一旦创建，Factory 就不再读取 settings fallback。首次迁移时
    // 若 fallback 无法解析，宁可跳过安装，也不能用新文件遮蔽未知的用户 hooks。
    if (!canonicalExisted && fallback === null) {
      console.warn(
        "[agent-hooks:droid] fallback settings unparsable, skip migration:",
        droidLegacySettingsPath()
      );
      return;
    }
    if (
      fallback !== null &&
      !preflightPierNestedHooksInstall(fallback, DROID_SPEC)
    ) {
      return;
    }
    if (
      Math.max(
        maxPierHookGenerationInSettings(canonical),
        fallback === null ? 0 : maxPierHookGenerationInSettings(fallback)
      ) > PIER_HOOK_COMMAND_GENERATION
    ) {
      return;
    }
    const shouldMigrateFallback =
      !canonicalExisted || maxPierHookGenerationInSettings(canonical) > 0;
    const fallbackUserHooks =
      fallback === null ? null : withoutPierDroidHooks(fallback);
    await transformJsonConfig(
      droidConfigPath(),
      (settings) => {
        if (!preflightPierNestedHooksInstall(settings, DROID_SPEC)) {
          return settings;
        }
        return transformPierHooksUnlessNewer(
          shouldMigrateFallback && fallbackUserHooks
            ? mergeDroidUserHooks(settings, fallbackUserHooks)
            : settings,
          (current) =>
            withPierNestedHooks(withoutPierDroidHooks(current), DROID_SPEC)
        );
      },
      "droid"
    );
    await cleanupDroidLegacySettings();
  },
  uninstall: async () => {
    await transformJsonConfig(
      droidConfigPath(),
      withoutPierDroidHooks,
      "droid"
    );
    await cleanupDroidLegacySettings();
  },
};
