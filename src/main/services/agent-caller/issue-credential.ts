/**
 * 签发 agent caller binding：默认仅内存 put + env 注入 bindingId。
 * 对齐业界本机默认（surface/session id 注入）；不写 secret、不写凭证文件。
 * 可选 withSecret / writeFile 供委派增强或调试。
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentCallerCredentialMaterial,
  PIER_AGENT_CALLER_BINDING_ENV,
  PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV,
} from "@shared/contracts/local-control/agent-credential.ts";
import type { AgentCallerCredentialStore } from "./credential-store.ts";

export interface IssueAgentCallerCredentialArgs {
  allowedAgents?: string[];
  bootId: string;
  callerGeneration?: number;
  callerRuntimeId?: string;
  /** 仅 writeFile 时使用；默认 os.tmpdir()/pier-agent-bindings/<bootId> */
  directory?: string;
  incarnationId?: string;
  maxActiveChildren?: number;
  maxDepth?: number;
  operations?: string[];
  store: AgentCallerCredentialStore;
  /** 默认 1h */
  ttlMs?: number;
  /** 可选：签发 secret（agent-credential 增强路径） */
  withSecret?: boolean;
  worktreeKey?: string;
  /** 可选：落盘非秘密快照（调试）；默认 false */
  writeFile?: boolean;
}

export interface IssuedAgentCallerCredential {
  /** writeFile 时才有路径 */
  credentialFilePath?: string;
  env: {
    [PIER_AGENT_CALLER_BINDING_ENV]: string;
    [PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV]?: string;
  };
  material: AgentCallerCredentialMaterial;
}

const DEFAULT_OPS = [
  "agents.self",
  "agents.catalog",
  "agents.list",
  "agents.get",
  "control.hold",
  "control.trace",
] as const;

/** ≥128-bit 不透明 binding id */
function newBindingId(): string {
  return `bind_${randomBytes(16).toString("base64url")}`;
}

/**
 * 原子创建文件：O_CREAT|O_EXCL|O_WRONLY（Unix 另加 O_NOFOLLOW），mode 0600。
 */
export function writeCredentialFileExclusive(
  filePath: string,
  body: string
): void {
  // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are bitmasks
  let flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
  if (typeof constants.O_NOFOLLOW === "number") {
    // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are bitmasks
    flags |= constants.O_NOFOLLOW;
  }
  let fd: number | undefined;
  try {
    fd = openSync(filePath, flags, 0o600);
    writeSync(fd, body, undefined, "utf8");
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

export function issueAgentCallerCredential(
  args: IssueAgentCallerCredentialArgs
): IssuedAgentCallerCredential {
  const bindingId = newBindingId();
  const material: AgentCallerCredentialMaterial = {
    credentialId: bindingId,
    bootId: args.bootId,
    callerRuntimeId:
      args.callerRuntimeId ?? `rt_${randomBytes(8).toString("hex")}`,
    callerGeneration: args.callerGeneration ?? 0,
    grantId: `grant_${randomBytes(8).toString("hex")}`,
    parentClauseId: `clause_${randomBytes(8).toString("hex")}`,
    allowedAgents: args.allowedAgents ?? ["*"],
    operations: args.operations ? [...args.operations] : [...DEFAULT_OPS],
    maxDepth: args.maxDepth ?? 2,
    maxActiveChildren: args.maxActiveChildren ?? 4,
    activeChildren: 0,
    expiresAt: Date.now() + (args.ttlMs ?? 60 * 60 * 1000),
    ...(args.withSecret
      ? { secret: randomBytes(32).toString("base64url") }
      : {}),
    ...(args.worktreeKey ? { worktreeKey: args.worktreeKey } : {}),
    ...(args.incarnationId ? { incarnationId: args.incarnationId } : {}),
  };

  args.store.put(material);

  const env: IssuedAgentCallerCredential["env"] = {
    [PIER_AGENT_CALLER_BINDING_ENV]: bindingId,
  };

  let credentialFilePath: string | undefined;
  if (args.writeFile) {
    const dir =
      args.directory ??
      join(
        tmpdir(),
        "pier-agent-bindings",
        args.bootId.replace(/[^a-zA-Z0-9_-]/g, "")
      );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // 共享 tmp 等不可 chmod 时忽略
    }
    credentialFilePath = join(dir, `${bindingId}.json`);
    // 落盘时去掉 secret，避免文件成为持有证明副本
    const { secret: _secret, ...publicMaterial } = material;
    writeCredentialFileExclusive(
      credentialFilePath,
      `${JSON.stringify(publicMaterial, null, 2)}\n`
    );
    env[PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV] = credentialFilePath;
  }

  return {
    material,
    ...(credentialFilePath ? { credentialFilePath } : {}),
    env,
  };
}
