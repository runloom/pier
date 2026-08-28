// @vitest-environment node
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSpaStaticHandler,
  resolveMobileWebSpaDistDir,
} from "@main/adapters/remote-control/static-spa.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;
let distDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pier-spa-root-"));
  distDir = join(rootDir, "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<html>spa</html>");
  await writeFile(join(distDir, "assets", "app.js"), "console.log(1)");
  await writeFile(join(distDir, "assets", "app.css"), "body{}");
  await writeFile(join(distDir, "assets", "logo.svg"), "<svg/>");
  await writeFile(join(distDir, "assets", "img.png"), "png-bytes");
  await writeFile(join(distDir, "assets", "font.woff2"), "woff2-bytes");
  await writeFile(join(distDir, "manifest.webmanifest"), "{}");
  await writeFile(join(distDir, "data.json"), "{}");
  await writeFile(join(distDir, "locked.js"), "console.log(2)");
  // stat 通过但 open 抛 EACCES，确定性复现 stat→open 的 TOCTOU 窗口。
  await chmod(join(distDir, "locked.js"), 0o000);
  await writeFile(join(rootDir, "secret.txt"), "top-secret");
  server = createServer(createSpaStaticHandler(distDir));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server did not bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await rm(rootDir, { force: true, recursive: true });
});

describe("createSpaStaticHandler", () => {
  it("GET / 返回 index.html，no-cache", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe("<html>spa</html>");
  });

  it("GET /assets/** 命中静态文件且 immutable 缓存", async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(await res.text()).toBe("console.log(1)");
  });

  it.each([
    ["/assets/app.css", "text/css"],
    ["/assets/logo.svg", "image/svg+xml"],
    ["/assets/img.png", "image/png"],
    ["/assets/font.woff2", "font/woff2"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/data.json", "application/json"],
  ])("MIME: %s → %s", async (path, contentType) => {
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(contentType);
  });

  it("不存在的文件 → 404", async () => {
    const res = await fetch(`${baseUrl}/missing.js`);
    expect(res.status).toBe(404);
  });
  // root 下 chmod 000 仍可 open，无法确定性复现，跳过。
  const itUnreadable =
    typeof process.getuid === "function" && process.getuid() === 0
      ? it.skip
      : it;
  itUnreadable("stat 后文件变为不可读（TOCTOU）→ 404 而非崩溃", async () => {
    const res = await fetch(`${baseUrl}/locked.js`);
    expect(res.status).toBe(404);
  });

  it("路径穿越（编码后的 ..）→ 404，不泄漏 dist 外文件", async () => {
    for (const path of [
      "/%2e%2e/secret.txt",
      "/assets/%2e%2e/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("top-secret");
    }
  });

  it("非 GET/HEAD 方法 → 405", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("resolveMobileWebSpaDistDir", () => {
  it("优先 asar/repo 根下 out/mobile-web", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-spa-asar-"));
    try {
      const dist = join(root, "out", "mobile-web");
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, "index.html"), "<html/>");
      expect(resolveMobileWebSpaDistDir(root)).toBe(resolve(dist));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("unpackaged out/main → 兄目录 mobile-web", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-spa-main-"));
    try {
      const appPath = join(root, "out", "main");
      const dist = join(root, "out", "mobile-web");
      await mkdir(appPath, { recursive: true });
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, "index.html"), "<html/>");
      expect(resolveMobileWebSpaDistDir(appPath)).toBe(resolve(dist));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("产物缺失时回落到 out/mobile-web", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-spa-miss-"));
    try {
      expect(resolveMobileWebSpaDistDir(root)).toBe(
        resolve(join(root, "out", "mobile-web"))
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
