// @vitest-environment node
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCanvasTrustService,
  flushCanvasTrustState,
} from "../../../../src/main/services/canvas-trust/service.ts";

const dirs: string[] = [];

afterEach(async () => {
  await flushCanvasTrustState();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

let activeUserDataDir = "";

function userDataDir(): string {
  if (!activeUserDataDir) {
    throw new Error("no temp dir created yet");
  }
  return activeUserDataDir;
}

async function createService() {
  activeUserDataDir = await mkdtemp(join(tmpdir(), "pier-canvas-trust-"));
  dirs.push(activeUserDataDir);
  return createCanvasTrustService({ userDataDir: activeUserDataDir });
}

async function projectRoot(base = userDataDir()): Promise<string> {
  const root = join(base, "proj");
  await mkdir(root, { recursive: true });
  return root;
}

describe("canvas trust service", () => {
  it("starts untrusted and round-trips a grant", async () => {
    const service = await createService();
    const root = await projectRoot();

    await expect(service.status(root)).resolves.toEqual({
      grantedAt: null,
      trusted: false,
    });

    await service.grant(root);
    const status = await service.status(root);
    expect(status.trusted).toBe(true);
    expect(status.grantedAt).toEqual(expect.any(String));
  });

  it("normalizes trailing slashes and separators when keying decisions", async () => {
    const service = await createService();
    const root = await projectRoot();

    await service.grant(`${root}/`);
    await expect(service.status(root)).resolves.toMatchObject({
      trusted: true,
    });
  });

  it("treats a symlink and its realpath as the same trust key", async () => {
    const service = await createService();
    const root = await projectRoot();
    const alias = join(userDataDir(), "alias");
    await symlink(root, alias);

    await service.grant(alias);
    await expect(service.status(root)).resolves.toMatchObject({
      trusted: true,
    });
    await expect(service.status(await realpath(alias))).resolves.toMatchObject({
      trusted: true,
    });
  });

  it("revoke drops the decision and asks again on next preview", async () => {
    const service = await createService();
    const root = await projectRoot();
    await service.grant(root);
    await service.revoke(root);

    await expect(service.status(root)).resolves.toEqual({
      grantedAt: null,
      trusted: false,
    });
    await expect(
      service.revoke(join(userDataDir(), "other"))
    ).resolves.toBeUndefined();
  });

  it("persists decisions to userData across service instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-canvas-trust-"));
    dirs.push(dir);
    const root = await projectRoot(dir);
    const grantedAt = "2026-01-01T00:00:00.000Z";

    const first = createCanvasTrustService({
      now: () => new Date(grantedAt),
      userDataDir: dir,
    });
    await first.grant(root);
    await first.flush();

    const raw = await readFile(join(dir, "canvas-trust.json"), "utf-8");
    expect(raw).toContain("proj");
    expect(raw).toContain(grantedAt);

    const second = createCanvasTrustService({ userDataDir: dir });
    await expect(second.status(root)).resolves.toMatchObject({
      trusted: true,
      grantedAt,
    });
  });

  it("refuses to grant an unresolvable path", async () => {
    const service = await createService();
    await expect(service.grant(join(userDataDir(), "missing"))).rejects.toThrow(
      /could not be resolved/
    );
  });

  it("replaces a schema-invalid store so a later grant can persist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-canvas-trust-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "canvas-trust.json"),
      `${JSON.stringify({ extra: true, roots: {}, version: 2 })}\n`
    );
    const root = await projectRoot(dir);
    const service = createCanvasTrustService({ userDataDir: dir });
    await service.grant(root);
    await service.flush();

    const stored = JSON.parse(
      await readFile(join(dir, "canvas-trust.json"), "utf-8")
    ) as { version: number; roots: Record<string, unknown> };
    expect(stored.version).toBe(1);
    expect(Object.keys(stored.roots).length).toBe(1);
    await expect(service.status(root)).resolves.toMatchObject({
      trusted: true,
    });
  });

  it("fails closed on a corrupt store file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-canvas-trust-"));
    dirs.push(dir);
    await writeFile(join(dir, "canvas-trust.json"), "{not json");
    const root = await projectRoot(dir);

    const service = createCanvasTrustService({ userDataDir: dir });
    await expect(service.status(root)).resolves.toEqual({
      grantedAt: null,
      trusted: false,
    });
  });
});
