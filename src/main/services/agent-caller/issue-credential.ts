/**
 * 签发 agent 调用凭证：内存 put + 私有文件（O_EXCL|O_NOFOLLOW）。
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
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import type { AgentCallerCredentialStore } from "./credential-store.ts";

export interface IssueAgentCallerCredentialArgs {
  allowedAgents?: string[];
  bootId: string;
  callerGeneration?: number;
  callerRuntimeId?: string;
  /** 凭证文件目录；默认 os.tmpdir()/pier-agent-creds/<bootId> */
  directory?: string;
  incarnationId?: string;
  maxActiveChildren?: number;
  maxDepth?: number;
  operations?: string[];
  store: AgentCallerCredentialStore;
  /** 默认 1h */
  ttlMs?: number;
  worktreeKey?: string;
}

export interface IssuedAgentCallerCredential {
  credentialFilePath: string;
  env: {
    PIER_AGENT_CALLER_CREDENTIAL_FILE: string;
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

/** ≥128-bit 不透明 id */
function newCredentialId(): string {
  return `cred_${randomBytes(16).toString("base64url")}`;
}

/**
 * 原子创建凭证文件：O_CREAT|O_EXCL|O_WRONLY（Unix 另加 O_NOFOLLOW），mode 0600。
 * 已存在路径 / symlink 目标均失败。
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
  const credentialId = newCredentialId();
  const secret = randomBytes(32).toString("base64url");
  const material: AgentCallerCredentialMaterial = {
    credentialId,
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
    secret,
    ...(args.worktreeKey ? { worktreeKey: args.worktreeKey } : {}),
    ...(args.incarnationId ? { incarnationId: args.incarnationId } : {}),
  };

  args.store.put(material);

  const dir =
    args.directory ??
    join(
      tmpdir(),
      "pier-agent-creds",
      args.bootId.replace(/[^a-zA-Z0-9_-]/g, "")
    );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // 共享 tmp 等不可 chmod 时忽略；文件本身仍为 0600 排他创建
  }

  const credentialFilePath = join(dir, `${credentialId}.json`);
  writeCredentialFileExclusive(
    credentialFilePath,
    `${JSON.stringify(material, null, 2)}\n`
  );

  return {
    material,
    credentialFilePath,
    env: {
      PIER_AGENT_CALLER_CREDENTIAL_FILE: credentialFilePath,
    },
  };
}
