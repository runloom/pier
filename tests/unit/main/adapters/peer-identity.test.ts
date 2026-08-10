import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkLocalControlPeerIdentity,
  createFdPeerUidResolver,
  extractSocketFd,
  getRegisteredUnixPeerUidResolver,
  registerUnixPeerUidResolver,
  tryResolveUnixPeerUid,
} from "@main/adapters/cli/peer-identity.ts";
import { afterEach, describe, expect, it } from "vitest";

function fakeSocket(fd?: number): Socket {
  if (fd === undefined) {
    return {} as Socket;
  }
  return { _handle: { fd } } as unknown as Socket;
}

afterEach(() => {
  registerUnixPeerUidResolver(null);
});

describe("checkLocalControlPeerIdentity", () => {
  it("accepts matching injected peer uid", () => {
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: 42,
      resolvePeerUid: () => 42,
    });
    expect(result).toEqual({ ok: true, uid: 42, method: "inject" });
  });

  it("denies mismatched injected peer uid without leaking paths", () => {
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: 1,
      resolvePeerUid: () => 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("peer_identity_denied");
      expect(result.message).not.toMatch(/Users|Library|boot/i);
    }
  });

  it("denies when requirePeerUid and uid unproven", () => {
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: 1,
      resolvePeerUid: () => null,
      requirePeerUid: true,
    });
    expect(result.ok).toBe(false);
  });

  it("fs-acl accepts owner-only socket file", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "pier-peer-"));
    const sock = join(dir, "pier-control.sock");
    writeFileSync(sock, "");
    chmodSync(dir, 0o700);
    chmodSync(sock, 0o600);
    const uid =
      typeof process.geteuid === "function"
        ? process.geteuid()
        : process.getuid?.();
    expect(uid).toEqual(expect.any(Number));
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: uid,
      socketPath: sock,
      resolvePeerUid: () => null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.method).toBe("fs-acl");
    }
  });

  it("fs-acl denies world-readable socket", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "pier-peer-open-"));
    const sock = join(dir, "pier-control.sock");
    writeFileSync(sock, "");
    chmodSync(sock, 0o644);
    const uid =
      typeof process.geteuid === "function"
        ? process.geteuid()
        : process.getuid?.();
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: uid,
      socketPath: sock,
      resolvePeerUid: () => null,
    });
    expect(result.ok).toBe(false);
  });

  it("platform resolver yields peer-uid method", () => {
    registerUnixPeerUidResolver(() => 77);
    const result = checkLocalControlPeerIdentity({
      socket: fakeSocket(),
      expectedUid: 77,
    });
    expect(result).toEqual({ ok: true, uid: 77, method: "peer-uid" });
  });
});

describe("registerUnixPeerUidResolver / createFdPeerUidResolver", () => {
  it("createFdPeerUidResolver reads fd and maps uid", () => {
    const resolve = createFdPeerUidResolver((fd) => (fd === 9 ? 501 : null));
    expect(resolve(fakeSocket(9))).toBe(501);
    expect(resolve(fakeSocket(3))).toBeNull();
    expect(resolve(fakeSocket())).toBeNull();
  });

  it("tryResolveUnixPeerUid uses registered resolver", () => {
    expect(tryResolveUnixPeerUid(fakeSocket())).toBeNull();
    registerUnixPeerUidResolver(() => 12);
    expect(getRegisteredUnixPeerUidResolver()).toBeTruthy();
    expect(tryResolveUnixPeerUid(fakeSocket())).toBe(12);
  });

  it("extractSocketFd reads _handle.fd", () => {
    expect(extractSocketFd(fakeSocket(16))).toBe(16);
    expect(extractSocketFd(fakeSocket())).toBeNull();
  });
});
