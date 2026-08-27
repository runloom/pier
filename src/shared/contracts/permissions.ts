import { z } from "zod";

export const pierClientKindSchema = z.enum([
  "desktop-renderer",
  "cli-local",
  "mcp-local",
  "mobile-paired",
  "canvas",
  /** 沙箱轨第三方插件主体：能力完全来自 manifest，静态默认为零（Phase 2）。 */
  "plugin-principal",
]);

export const pierCapabilitySchema = z.enum([
  "app:read",
  "environment:read",
  "environment:write",
  "preferences:read",
  "preferences:write",
  "workspace:read",
  "workspace:write",
  "workspace:open",
  "worktree:read",
  "worktree:write",
  "window:read",
  "window:control",
  "window:create",
  "window:focus",
  "window:close",
  "panel:open",
  "panel:read",
  "panel:control",
  "terminal:read",
  "terminal:control",
  /**
   * Official plugin spawn decoration. Manifest-only; not a client-kind default.
   */
  "terminal:launchWrap",
  "plugin:read",
  "plugin:write",
  /**
   * Canvas-declared plugin RPC actions (`pluginAction.invoke`).
   * Not a `:write` host-domain capability; gated by manifest `canvasActions`.
   */
  "plugin:action",
  /**
   * Canvas-declared shell commands (`canvasCommand.invoke`).
   * Not a `:write` host-domain capability; gated by instance.json + confirm.
   */
  "canvas:command",
  "command:register",
  "panel:register",
  "git:read",
  "git:write",
  "file:read",
  "file:write",
  "profile:read",
  "secret:read",
  "secret:write",
  "usage:publish",
  "evidence:write",
  "external:open",
  "network",
  "ai:invoke",
  "skills:read",
  "skills:write",
  // 统一评论能力：读 / 写分离授权（git 插件等消费端经门面读写）。
  "comments:read",
  "comments:write",
  /** Main-side: register PATH language servers into the host LSP registry. */
  "lsp:provide",
  /**
   * Contribute editor language modes (extensions → badge + highlight preset).
   * Consumed by the Files editor language-mode registry (display track).
   */
  "languageMode:provide",
  // 消息中心：CLI/宿主 list·get·watch 读；mark-read·focus 写（focus 不改 runtime 事实）。
  "notification:read",
  "notification:write",
]);

export type PierClientKind = z.infer<typeof pierClientKindSchema>;
export type PierCapability = z.infer<typeof pierCapabilitySchema>;

export const pierClientSchema = z.object({
  id: z.string().min(1),
  kind: pierClientKindSchema,
  capabilities: z.array(pierCapabilitySchema),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

export type PierClient = z.infer<typeof pierClientSchema>;

export const DEFAULT_CAPABILITIES_BY_CLIENT_KIND: Record<
  PierClientKind,
  PierCapability[]
> = {
  "desktop-renderer": [
    "app:read",
    "environment:read",
    "environment:write",
    "preferences:read",
    "preferences:write",
    "workspace:read",
    "workspace:write",
    "workspace:open",
    "worktree:read",
    "worktree:write",
    "window:read",
    "window:control",
    "window:create",
    "window:focus",
    "window:close",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
    "plugin:read",
    "plugin:write",
    // 与 worktree:write 同等待遇:主体提供能力,二次确认由插件 UI 负责
    "git:read",
    "git:write",
    "file:read",
    "file:write",
    "ai:invoke",
    "skills:read",
    "skills:write",
    "external:open",
    // network 用于 plugin.checkUpdates / plugin.install / plugin.update
    // 拉取签名官方索引与下载 GitHub Release asset (design §5)。
    "network",
    // 统一评论能力：桌面 renderer 直连评论服务（镜像 store 读 + 命令写）。
    "comments:read",
    "comments:write",
    "notification:read",
    "notification:write",
  ],
  "cli-local": [
    "app:read",
    "environment:read",
    "preferences:read",
    "workspace:read",
    "workspace:open",
    "worktree:read",
    "worktree:write",
    "window:read",
    "window:focus",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
    "plugin:read",
    "git:read",
    "skills:read",
    "notification:read",
    "notification:write",
  ],
  "mcp-local": [
    "app:read",
    "environment:read",
    "preferences:read",
    "workspace:read",
    "workspace:open",
    "worktree:read",
    "window:read",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
    "git:read",
    "notification:read",
  ],
  "mobile-paired": [
    "app:read",
    "preferences:read",
    "workspace:read",
    "worktree:read",
    "window:read",
    "window:control",
    "window:create",
    "window:focus",
    "window:close",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
    "notification:read",
  ],
  canvas: [
    "app:read",
    "environment:read",
    "preferences:read",
    "workspace:read",
    "worktree:read",
    "window:read",
    "panel:read",
    "terminal:read",
    "plugin:read",
    "plugin:action",
    "canvas:command",
    "git:read",
    "file:read",
    "notification:read",
  ],
  // 沙箱轨插件主体：静态默认为零，能力完全来自 manifest（deny-by-default）。
  "plugin-principal": [],
};
