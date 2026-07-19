import { z } from "zod/mini";

export const SSH_MAX_PORT = 65_535;

const nonEmptyStringSchema = z.string().check(z.minLength(1));
const sshDestinationPartSchema = nonEmptyStringSchema.check(
  z.regex(/^[^-]/, "SSH destination fields must not start with '-'")
);

export const sshHostSchema = z.object({
  /** Hostname, IP, or an alias defined in the user's ssh config. */
  host: sshDestinationPartSchema,
  id: nonEmptyStringSchema,
  identityFile: z.optional(nonEmptyStringSchema),
  /** Display name; defaults to the host when created from import. */
  name: nonEmptyStringSchema,
  port: z.optional(z.int().check(z.minimum(1), z.maximum(SSH_MAX_PORT))),
  user: z.optional(sshDestinationPartSchema),
});
export type SshHost = z.infer<typeof sshHostSchema>;

export const sshHostsSnapshotSchema = z.object({
  hosts: z.array(sshHostSchema),
});
export type SshHostsSnapshot = z.infer<typeof sshHostsSnapshotSchema>;

export const sshHostUpsertPayloadSchema = z.object({
  host: sshHostSchema,
});
export const sshHostRemovePayloadSchema = z.object({
  hostId: nonEmptyStringSchema,
});
export const sshHostsImportPayloadSchema = z.object({
  hosts: z.array(sshHostSchema).check(z.minLength(1)),
});
export const sshHostTestPayloadSchema = z.object({
  hostId: nonEmptyStringSchema,
});

export interface SshImportCandidatesResult {
  candidates: SshHost[];
}

export interface SshTestConnectionResult {
  detail?: string;
  ok: boolean;
}

export const HOSTS_CHANGED_EVENT = "hosts.changed";

/** `user@host` target plus connection flags, shared by terminal open and test. */
export function sshTargetArgs(host: SshHost): string[] {
  const args: string[] = [];
  if (host.port !== undefined) {
    args.push("-p", String(host.port));
  }
  if (host.identityFile) {
    args.push("-i", host.identityFile);
  }
  // Stop option parsing before the destination. Shell quoting alone does not
  // prevent a value such as `-oProxyCommand=...` from becoming an ssh option.
  args.push("--");
  args.push(host.user ? `${host.user}@${host.host}` : host.host);
  return args;
}

const SHELL_SAFE_ARG = /^[A-Za-z0-9@%+=:,./_-]+$/;

function quoteShellArg(value: string): string {
  if (SHELL_SAFE_ARG.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Command line executed inside the host terminal panel. */
export function buildSshCommand(host: SshHost): string {
  return ["ssh", ...sshTargetArgs(host)].map(quoteShellArg).join(" ");
}

/** Short human-readable target, e.g. `user@example.com:2222`. */
export function describeSshTarget(host: SshHost): string {
  const base = host.user ? `${host.user}@${host.host}` : host.host;
  return host.port === undefined ? base : `${base}:${host.port}`;
}
