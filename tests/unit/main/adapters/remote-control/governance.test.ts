// @vitest-environment node
/**
 * Task 14 治理收口：规格 §13 四条不变量 + M2 账号时代兼容性两条 + T1 契约回归。
 *
 * 1. remote-control 默认关闭：装配路径静态断言 + 构造断言双重锁定。
 * 2. 同网切片不强制会合云：pairingQrPayloadSchema 必含 relayHint 键，M1 构造
 *    的 payload relayHint 恒 null（M2-① 同源断言）。
 * 3. mobile-paired 默认能力集不含 *:write（notification:write 除外）——跨引用
 *    Task 1 治理测试（tests/unit/shared/permissions-mobile-paired.test.ts）防回退。
 * 4. 移动端文案治理：静态扫描 apps/mobile-web/src/** 与宿主新增 locale 键
 *    （src/renderer/i18n/locales/<lang>/settings-remote-access.ts），禁词
 *    scrollback / 完整历史；注释行与测试文件中的负向断言行豁免（启发式）。
 * 5. M2-②：PierPairedDevice（remote.ts）与 pairing-store.ts 源码注释锁
 *    additive-only 演进。
 * 6. T1 契约：terminalScreenPayloadSchema forbid scrollback 最小回归。
 *
 * @see docs/superpowers/specs/2026-08-26-mobile-companion-design.md §13/§11.3
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootAppCoreRemoteControl } from "@main/adapters/remote-control/boot.ts";
import { createRemoteControlRegistrationOwner } from "@main/adapters/remote-control/registration.ts";
import {
  createRemoteControlServer,
  type RemoteControlServer,
} from "@main/adapters/remote-control/server.ts";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { buildPairingQrPayload } from "@main/services/pairing/qr-payload.ts";
import type { PairingService } from "@main/services/pairing/service.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { pairingQrPayloadSchema } from "@shared/contracts/remote.ts";
import { terminalScreenPayloadSchema } from "@shared/contracts/terminal/screen.ts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// bootAppCoreRemoteControl 在构造期读取 app.getAppPath()；指向临时目录，
// pairing store 的 userData 初始化也落在里面，测试后整体清理。
const electronPaths = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
  app: {
    getAppPath: () => electronPaths.root,
    getPath: () => electronPaths.root,
  },
}));

const REPO_ROOT = process.cwd();
const BOOT_PATH = "src/main/adapters/remote-control/boot.ts";
const REGISTRATION_PATH = "src/main/adapters/remote-control/registration.ts";
const REMOTE_CONTRACTS_PATH = "src/shared/contracts/remote.ts";
const PAIRING_STORE_PATH = "src/main/state/pairing-store.ts";
const TASK1_GOVERNANCE_TEST =
  "tests/unit/shared/permissions-mobile-paired.test.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

beforeAll(() => {
  electronPaths.root = mkdtempSync(join(tmpdir(), "pier-governance-"));
  tempDirs.push(electronPaths.root);
});

// ---- 不变量 1：remote-control 默认关闭 -------------------------------------

describe("不变量 1：remote-control 默认关闭（无设置开启不监听）", () => {
  const registrationSrc = readFileSync(
    join(REPO_ROOT, REGISTRATION_PATH),
    "utf8"
  );
  const bootSrc = readFileSync(join(REPO_ROOT, BOOT_PATH), "utf8");

  it("静态：registration 初始 phase = stopped，源码无任何 listen 调用", () => {
    expect(registrationSrc).toMatch(
      /phase: RemoteControlRegistrationPhase = "stopped"/
    );
    // 文件头声明默认关闭语义：start 只由设置开关的装配侧触发。
    expect(registrationSrc).toMatch(/默认不启动/u);
    expect(registrationSrc).not.toMatch(/\.listen\(/);
  });

  it("静态：boot 装配路径不调用 owner/server start，无 listen", () => {
    expect(bootSrc).not.toMatch(
      /owner\.start\(|registration\.start\(|server\.start\(/
    );
    expect(bootSrc).not.toMatch(/\.listen\(/);
    expect(bootSrc).toMatch(/默认关/u);
  });

  it("构造：registration owner 初始 stopped，未触发 server.start", async () => {
    const start = vi.fn<RemoteControlServer["start"]>(async () => ({
      host: "127.0.0.1",
      port: 0,
    }));
    const owner = createRemoteControlRegistrationOwner({
      logError: () => {},
      server: {
        isThrottled: () => false,
        recordFailure: () => {},
        recordSuccess: () => {},
        start,
        state: () => ({ enabled: false, host: null, port: null }),
        stop: vi.fn(async () => {}),
      },
    });
    // 让任何意外启动的微任务有机会暴露。
    await new Promise((resolve) => setImmediate(resolve));
    expect(owner.state()).toBe("stopped");
    expect(start).not.toHaveBeenCalled();
  });

  it("构造：bootAppCoreRemoteControl 装配后 owner=stopped、server 无监听", () => {
    const boot = bootAppCoreRemoteControl({
      clients: createClientRegistry(),
      // 装配期不允许触碰 core.services（惰性 getter，仅 WS hello 后求值）；
      // 本测试只验证构造期行为，一旦被调用立即暴露。
      getServices: (): PierCoreServices => {
        throw new Error(
          "governance test: services must not be touched at boot"
        );
      },
    });
    expect(boot.owner.state()).toBe("stopped");
    expect(boot.server.state()).toEqual({
      enabled: false,
      host: null,
      port: null,
    });
  });

  it("构造：createRemoteControlServer 不 start 则端口为空", () => {
    const server = createRemoteControlServer({
      clients: createClientRegistry(),
      executeCommand: async () => ({ ok: true, data: null }),
      onWebSocketConnection: () => {},
      pairing: unusedPairing(),
      sessionDeps: { bootId: "governance-construct" },
      spaDistDir: electronPaths.root,
    });
    expect(server.state()).toEqual({ enabled: false, host: null, port: null });
  });
});

/** 构造期占位：任何在 start 之前触碰 pairing 的路径都是治理违规。 */
function unusedPairing(): PairingService {
  const fail = (): never => {
    throw new Error(
      "governance test: pairing must not be touched before start"
    );
  };
  return {
    assertEpochCurrent: fail,
    authenticate: fail,
    beginPairing: fail,
    cancelPairing: fail,
    listDevices: () => [],
    onRevoke: () => () => {},
    pendingPairing: () => null,
    redeemPairingCode: fail,
    revokeDevice: fail,
    touchLastSeen: fail,
  };
}

// ---- 不变量 2 + M2-①：QR payload relayHint ---------------------------------

describe("不变量 2 / M2-①：同网切片不强制会合云（relayHint）", () => {
  it("pairingQrPayloadSchema 必含 relayHint 键（M2 会合地址冻结位）", () => {
    expect(Object.keys(pairingQrPayloadSchema.shape)).toContain("relayHint");
  });

  it("M1 构造的 QR payload relayHint 恒为 null 且键真实存在", () => {
    const raw = buildPairingQrPayload({
      code: "123456",
      fingerprint: "ab12cd34",
      host: "pier.local",
      port: 8787,
    });
    // 原始 JSON 里键必须显式存在（不是 zod 默认值补齐）。
    expect(JSON.parse(raw)).toHaveProperty("relayHint", null);
    const parsed = pairingQrPayloadSchema.parse(JSON.parse(raw));
    expect(parsed.relayHint).toBeNull();
  });
});

// ---- 不变量 3：mobile-paired 默认集 ----------------------------------------

describe("不变量 3：mobile-paired 默认集不含 *:write（notification:write 除外）", () => {
  it("默认集中唯一的写能力是 notification:write", () => {
    const writes = DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"].filter(
      (capability) => capability.endsWith(":write")
    );
    expect(writes).toEqual(["notification:write"]);
  });

  it("跨引用：Task 1 治理测试存在且持续锁定默认能力集", () => {
    const task1 = readFileSync(join(REPO_ROOT, TASK1_GOVERNANCE_TEST), "utf8");
    expect(task1).toContain("mobile-paired 默认能力集");
    expect(task1).toContain("DEFAULT_CAPABILITIES_BY_CLIENT_KIND");
  });
});

// ---- 不变量 4：移动端文案治理 ----------------------------------------------

const FORBIDDEN_PATTERNS = [/scrollback/i, /完整历史/] as const;

/** 豁免：注释行；测试文件中的负向断言行（禁词只允许出现在禁令里）。 */
function isExemptLine(relativePath: string, line: string): boolean {
  const trimmed = line.trim();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  ) {
    return true;
  }
  if (
    /\.(test|spec)\.[jt]sx?$/.test(relativePath) &&
    /not\.(toMatch|toContain|toHaveProperty|toBeInTheDocument)|queryByText|禁词|红线|不含/.test(
      line
    )
  ) {
    return true;
  }
  return false;
}

function collectForbiddenLines(relativePath: string, source: string): string[] {
  const hits: string[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    if (isExemptLine(relativePath, line)) {
      continue;
    }
    if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(line))) {
      hits.push(`${relativePath}:${index + 1}`);
    }
  }
  return hits;
}

const TEXT_SUFFIXES = new Set([".css", ".html", ".json", ".ts", ".tsx"]);

function listSourceFiles(rootDir: string): string[] {
  return readdirSync(join(REPO_ROOT, rootDir), { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => TEXT_SUFFIXES.has(entry.slice(entry.lastIndexOf("."))))
    .map((entry) => `${rootDir}/${entry}`);
}

describe("不变量 4：移动端文案不把 T1 称为 scrollback / 完整历史", () => {
  it("apps/mobile-web/src/** 与宿主 settings-remote-access locale 键无禁词", () => {
    const files = [
      ...listSourceFiles("apps/mobile-web/src"),
      ...readdirSync(join(REPO_ROOT, "src/renderer/i18n/locales"), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => [
          `src/renderer/i18n/locales/${entry.name}/settings-remote-access.ts`,
        ])
        .filter((path) => {
          try {
            readFileSync(join(REPO_ROOT, path), "utf8");
            return true;
          } catch {
            return false;
          }
        }),
    ];
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((path) =>
      collectForbiddenLines(path, readFileSync(join(REPO_ROOT, path), "utf8"))
    );
    expect(violations).toEqual([]);
  });
});

// ---- M2-②：pairing schema additive-only 演进 -------------------------------

describe("M2-②：PierPairedDevice / pairing store schema 只许 additive 演进", () => {
  it("remote.ts 注释锁定 additive-only（Task 4 既有锁跨引用）", () => {
    const source = readFileSync(join(REPO_ROOT, REMOTE_CONTRACTS_PATH), "utf8");
    expect(source).toMatch(/演进只许 additive/u);
    expect(source).toMatch(/M2 加 accountId/u);
  });

  it("pairing-store.ts 注释锁定 additive 演进（磁盘 schema 侧）", () => {
    const source = readFileSync(join(REPO_ROOT, PAIRING_STORE_PATH), "utf8");
    expect(source).toMatch(/additive/u);
    expect(source).toMatch(/accountId/u);
  });
});

// ---- T1 契约回归：terminalScreenPayloadSchema forbid scrollback -------------

describe("T1 契约：terminalScreenPayloadSchema 拒绝 scrollback/history", () => {
  const basePayload = {
    capturedAt: 0,
    cols: 80,
    maxBytes: 65_536,
    maxLines: 200,
    panelId: "panel-1",
    rows: 24,
    scope: "viewport",
    text: "prompt$ ",
    truncated: false,
    windowId: "1",
  } as const;

  it("合法 viewport payload 通过", () => {
    expect(terminalScreenPayloadSchema.parse(basePayload).scope).toBe(
      "viewport"
    );
  });

  it("携带 scrollback / history 键一律被拒", () => {
    expect(() =>
      terminalScreenPayloadSchema.parse({ ...basePayload, scrollback: "x" })
    ).toThrow();
    expect(() =>
      terminalScreenPayloadSchema.parse({ ...basePayload, history: [] })
    ).toThrow();
  });
});
