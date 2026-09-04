import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-04-panel-drop-overlay-lifecycle-gold-standard.md";
const TEAR_OFF =
  "docs/superpowers/specs/2026-09-01-panel-tear-off-gold-standard.md";
const MAIN_OVERLAY = "src/main/services/panel-transfer/overlay-preview.ts";
const SERVICE = "src/main/services/panel-transfer/service.ts";
const RENDERER_OVERLAY =
  "src/renderer/components/workspace/transfer/overlay-preview.ts";
const ATTACH = "src/renderer/components/workspace/transfer/attach.ts";
const PATCH = "patches/dockview-core@7.0.2.patch";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function methodBody(source: string, name: string): string {
  const start = source.indexOf(`${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + 900);
}

describe("panel drop overlay lifecycle gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 面板落点浮层生命周期");
    expect(agents).toContain(
      "tests/unit/renderer/workspace/panel-drop-overlay-lifecycle-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("拖还在，浮层才能在");
    expect(spec).toContain("单一主人");
    expect(spec).toContain("seal");
    expect(spec).toContain("transferId");
    expect(spec).toContain("不夺 Esc");
    expect(spec).toContain("begin(B)` 先 `end(A)");
    expect(spec).toContain("start(B)` 先 `seal(A)");
    expect(spec).toContain("明确不做");
    expect(spec).toContain("finishDrag");
    expect(spec).toContain("waitForOffer");
    expect(spec).toContain("panel-transfer-drop-preview");
    expect(spec).toContain("看得见但点不到");
    expect(spec).toContain("button-up");
    expect(agents).toContain("panel-transfer-drop-preview");
  });

  it("keeps tear-off spec as a cross-link, not the overlay owner", () => {
    const tearOff = read(TEAR_OFF);
    expect(tearOff).toContain("2026-09-04-panel-drop-overlay-lifecycle");
    expect(tearOff).toContain("不包含：拖入另一扇已有 Pier 窗口的落点 overlay");
    expect(tearOff).not.toContain("overlaySession.end() 防止晚到的 preview");
  });

  it("seals preview before finishDrag waits for a late offer", () => {
    const service = read(SERVICE);
    const finishDrag = methodBody(service, "async finishDrag");
    expect(finishDrag).toContain("overlayPreview?.seal(transferId)");
    expect(finishDrag.indexOf("seal(transferId)")).toBeLessThan(
      finishDrag.indexOf("finishPanelTransferDrag")
    );
    expect(service).toContain(
      "overlayPreview?.start(offer.transferId, caller.runtimeWindowId)"
    );
    const startGuard = read(MAIN_OVERLAY);
    expect(startGuard).toContain("seal(transferId: string)");
    expect(startGuard).toContain("seal: sealTransfer");
    expect(startGuard).toContain("sealed");
    const startAt = startGuard.indexOf("start(transferId, sourceWindowId)");
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(startGuard.slice(startAt, startAt + 400)).toContain(
      "sealed.has(transferId)"
    );
    expect(startGuard).toContain("sealTransfer(active.transferId)");
    expect(startGuard).not.toContain("stop(transferId)");
    expect(startGuard).toContain("sawButtonDown");
    expect(startGuard).toContain("isLeftMouseButtonDown()");
  });

  it("keys the renderer overlay session by transferId and does not steal Escape", () => {
    const session = read(RENDERER_OVERLAY);
    expect(session).toContain("begin(transferId");
    expect(session).toContain("end(transferId");
    expect(session).toContain("endedIds");
    expect(session).toContain("endTransfer(liveId)");
    expect(session).toContain("liveId && liveId !== id");
    const attach = read(ATTACH);
    expect(attach).toContain("overlaySession.begin(");
    expect(attach).toContain("overlaySession.end(");
    expect(attach).toContain("queueMicrotask");
    expect(attach).not.toContain('event.key === "Escape"');
    expect(attach).not.toContain('event.key !== "Escape"');
  });

  it("keeps the document-dragend patch as fail-closed defense, not the owner", () => {
    const spec = read(SPEC);
    expect(spec).toContain("不拥有");
    expect(spec).toContain("onDocumentDragEnd");
    const patch = read(PATCH);
    expect(patch).toContain("onDocumentDragEnd");
    expect(patch).toContain("document.addEventListener('dragend'");
  });
});
