import type { PierCommand } from "@shared/contracts/commands.ts";
import {
  type PierClient,
  pierCapabilitySchema,
} from "@shared/contracts/permissions.ts";
import {
  commandMetadataFor,
  requiredCapabilitiesForCommand,
} from "./command-metadata.ts";

export type { CommandMetadata } from "./command-metadata.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

export function authorizeCommand(
  command: PierCommand,
  client: PierClient
): AuthorizationResult {
  const meta = commandMetadataFor(command.type);
  if (
    client.kind === "plugin-principal" &&
    meta.allowPluginPrincipals !== true
  ) {
    return {
      ok: false,
      reason: `plugin principal not allowed for ${command.type}`,
    };
  }
  const allowedKinds = meta.allowedClientKinds;
  if (allowedKinds && !allowedKinds.includes(client.kind)) {
    return {
      ok: false,
      reason: `client kind ${client.kind} not allowed for ${command.type}`,
    };
  }
  const requiredCapabilities = requiredCapabilitiesForCommand(command);
  const missing = requiredCapabilities.find(
    (capability) => !client.capabilities.includes(capability)
  );
  if (missing) {
    return {
      ok: false,
      reason: `missing capability: ${missing}`,
    };
  }
  return { ok: true };
}

// ── 沙箱轨插件主体（Phase 2）────────────────────────────────────────────
// main 侧能力桥把第三方插件的宿主调用包装成 plugin-principal client 后
// 再走统一授权：能力来自 manifest 权限集（安装期已验签），静态默认为零；
// 命令级闸门由 CommandMetadata.allowPluginPrincipals 控制。

export function pluginPrincipalClientId(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function createPluginPrincipalClient(
  pluginId: string,
  permissions: readonly string[],
  now: () => number = () => Date.now()
): PierClient {
  const known = new Set<string>(pierCapabilitySchema.options);
  // 未知能力字符串直接过滤，不进主体能力集。
  const capabilities = permissions.filter((p) =>
    known.has(p)
  ) as PierClient["capabilities"];
  const issuedAt = now();
  return {
    capabilities,
    createdAt: issuedAt,
    id: pluginPrincipalClientId(pluginId),
    kind: "plugin-principal",
    lastSeenAt: issuedAt,
  };
}

/** main 侧桥转发前的授权检查：与 renderer 能力桥同一套 deny-by-default 语义。 */
export function authorizeForPluginPrincipal(input: {
  command: PierCommand;
  pluginId: string;
  manifestPermissions: readonly string[];
}): AuthorizationResult {
  return authorizeCommand(
    input.command,
    createPluginPrincipalClient(input.pluginId, input.manifestPermissions)
  );
}
