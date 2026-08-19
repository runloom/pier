import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC = join(
  ROOT,
  "docs",
  "superpowers",
  "specs",
  "2026-08-14-host-catalog-design.md"
);
const FRESHNESS_DIR = join(ROOT, "src", "main", "services", "freshness");
const PERSIST = join(
  ROOT,
  "src",
  "main",
  "services",
  "host-catalog",
  "persist.ts"
);

function listTs(roots: readonly string[]): string[] {
  const out: string[] = [];
  const visit = (full: string): void => {
    const stat = statSync(full);
    if (stat.isDirectory()) {
      for (const name of readdirSync(full)) {
        visit(join(full, name));
      }
      return;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(root);
    }
  }
  return out;
}

describe("host-catalog governance", () => {
  it("keeps the gold-standard spec with the runtime contract", () => {
    expect(existsSync(SPEC)).toBe(true);
    const text = readFileSync(SPEC, "utf8");
    expect(text).toContain("打开 ≠ 探测");
    expect(text).toContain("HostCatalogRuntime");
    expect(text).toContain("统一管理面，不统一数据堆");
    expect(text).toContain("agent-inventory.json");
    expect(text).toContain("prepareLaunch");
  });

  it("does not introduce a cross-domain freshness dump service", () => {
    expect(existsSync(FRESHNESS_DIR)).toBe(false);
  });

  it("does not remotely check plugin updates from the settings mount path", () => {
    const hook = readFileSync(
      join(
        ROOT,
        "src",
        "renderer",
        "stores",
        "host-catalog",
        "use-managed-plugin-catalog.ts"
      ),
      "utf8"
    );
    expect(hook).not.toContain(".list(");
    expect(hook).not.toContain("managedPlugins?.checkUpdates");
    expect(hook).toContain('classKind: "local" | "remote"');
    const mountEffect = hook.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[applyFresh\]\);/
    )?.[0];
    expect(mountEffect).toBeTruthy();
    expect(mountEffect).toContain('"local"');
    expect(mountEffect).not.toContain('"remote"');
  });

  it("product renderer paths do not schedule detect/probe/list", () => {
    const roots = [
      join(ROOT, "src", "renderer", "pages"),
      join(ROOT, "src", "renderer", "lib"),
      join(ROOT, "src", "renderer", "components"),
      join(ROOT, "src", "renderer", "stores"),
      join(ROOT, "src", "renderer", "main.tsx"),
    ];
    const forbidden = [
      /\bagents\??\.\s*detect\s*\(/u,
      /\.lifecycle\??\.\s*probe\s*\(/u,
      /\bmanagedPlugins\??\.\s*list\s*\(/u,
    ];
    const hits: string[] = [];
    for (const file of listTs(roots)) {
      const rel = relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          hits.push(`${rel} matches ${pattern.source}`);
        }
      }
    }
    expect(hits).toEqual([]);
    expect(
      readFileSync(
        join(ROOT, "src", "renderer", "app", "start-application.tsx"),
        "utf8"
      )
    ).toContain("initHostCatalog()");
    expect(
      readFileSync(
        join(ROOT, "src", "renderer", "app", "start-application.tsx"),
        "utf8"
      )
    ).not.toContain("initAgentDetection");
  });

  it("only the catalog store talks to window.pier.catalog.ensureFresh", () => {
    const hits: string[] = [];
    for (const file of listTs([join(ROOT, "src", "renderer")])) {
      const rel = relative(ROOT, file);
      if (rel.endsWith("stores/host-catalog/store.ts")) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (
        /window\.pier\??\.catalog\??\.\s*ensureFresh/u.test(text) ||
        /api\.ensureFresh\s*\(/u.test(text)
      ) {
        hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  });

  it("preload no longer exposes agents.detect or lifecycle.probe", () => {
    const preload = readFileSync(
      join(ROOT, "src", "preload", "index.ts"),
      "utf8"
    );
    const types = readFileSync(
      join(ROOT, "src", "preload", "api-types.ts"),
      "utf8"
    );
    expect(preload).not.toContain("pier:agents:detect");
    expect(preload).not.toContain("pier:agents:lifecycle:probe");
    expect(types).not.toMatch(/detect\s*:/u);
    expect(types).not.toMatch(/probe\s*:/u);
    const ipc = readFileSync(
      join(ROOT, "src", "main", "ipc", "agents.ts"),
      "utf8"
    );
    expect(ipc).not.toContain("pier:agents:detect");
    expect(ipc).not.toContain("pier:agents:lifecycle:probe");
  });

  it("detect and lifecycle stores are catalog views, not probe schedulers", () => {
    const detect = readFileSync(
      join(ROOT, "src", "renderer", "stores", "agent-detect.store.ts"),
      "utf8"
    );
    const lifecycle = readFileSync(
      join(ROOT, "src", "renderer", "stores", "agent-lifecycle.store.ts"),
      "utf8"
    );
    expect(detect).toContain("useHostCatalogStore.subscribe");
    expect(detect).toContain("useHostCatalogStore.getState().ensureFresh");
    expect(detect).not.toContain("window.pier");
    expect(lifecycle).toContain("useHostCatalogStore.subscribe");
    expect(lifecycle).not.toMatch(/async probe\(/u);
    expect(lifecycle).not.toContain("shouldSkipFullCatalogProbe");
  });

  it("runtime tests lock TTL merge, live fingerprint, and remote force", () => {
    const runtime = readFileSync(
      join(ROOT, "tests", "unit", "main", "host-catalog", "runtime.test.ts"),
      "utf8"
    );
    expect(runtime).toContain(
      "keeps the sibling timestamp so ensureFresh all honors TTL"
    );
    expect(runtime).toContain(
      "re-runs local when the live fingerprint changes inside TTL"
    );
    expect(runtime).toContain("force all skips derived when remote exists");
    const plugin = readFileSync(
      join(
        ROOT,
        "tests",
        "unit",
        "main",
        "host-catalog",
        "managed-plugin-provider.test.ts"
      ),
      "utf8"
    );
    expect(plugin).toContain(
      "forwards ensureFresh force into official index refresh"
    );
    const service = readFileSync(
      join(ROOT, "src", "main", "services", "host-catalog", "service.ts"),
      "utf8"
    );
    expect(service).toContain("mergeStamps");
    expect(service).toContain("provider.fingerprint");
    const newAgent = readFileSync(
      join(ROOT, "src", "renderer", "lib", "actions", "new-agent-action.ts"),
      "utf8"
    );
    const addPanel = readFileSync(
      join(
        ROOT,
        "src",
        "renderer",
        "components",
        "workspace",
        "add-panel-action.tsx"
      ),
      "utf8"
    );
    expect(newAgent).not.toContain("ensureDetected");
    expect(addPanel).not.toContain("ensureDetected");
    expect(readFileSync(SPEC, "utf8")).toContain("打开路径不跑 Class A/B/C");
  });

  it("persists agent inventory in its own file, not a mixed catalog blob", () => {
    const persist = readFileSync(PERSIST, "utf8");
    expect(persist).toContain("agent-inventory.json");
    expect(persist).toContain("app-update-last-check.json");
    expect(persist).toContain("managed-plugin-catalog.json");
    expect(persist).not.toMatch(/catalog-all\.json|freshness\.json/);
  });
});
