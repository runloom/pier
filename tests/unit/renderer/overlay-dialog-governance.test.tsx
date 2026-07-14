import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../packages/ui/src/dialog.tsx";
import { useDeferredDialogOpen } from "../../../packages/ui/src/use-deferred-dialog-open.ts";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const PRODUCTION_SOURCE_ROOTS = [
  join(ROOT, "src", "renderer"),
  join(ROOT, "src", "plugins", "builtin"),
  join(ROOT, "packages", "plugin-codex", "src", "renderer"),
];

/**
 * Product code should not special-case modal=false / manual schedule when
 * opening Dialog from menu items. The Dialog primitive owns deferred open.
 */
const MENU_ITEM_UNSAFE_OPEN_RE =
  /<(?:DropdownMenuItem|ContextMenuItem|MenubarItem)[\s\S]{0,400}?on(?:Select|Click)\s*=\s*\{[\s\S]{0,200}?\bscheduleAfterOverlay\b/s;

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(filePath));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath);
}

function OpenProbe({ open }: { open: boolean }) {
  const deferred = useDeferredDialogOpen(open);
  return (
    <div
      data-body-pointer-events={document.body.style.pointerEvents || ""}
      data-open={String(deferred)}
      data-testid="open-probe"
    />
  );
}

describe("overlay → dialog open governance", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    document.body.style.pointerEvents = "";
    vi.useRealTimers();
  });

  it("keeps deferred open inside Dialog and AlertDialog primitives", () => {
    const dialogSource = readFileSync(
      join(ROOT, "packages", "ui", "src", "dialog.tsx"),
      "utf8"
    );
    const alertDialogSource = readFileSync(
      join(ROOT, "packages", "ui", "src", "alert-dialog.tsx"),
      "utf8"
    );
    const deferredHook = readFileSync(
      join(ROOT, "packages", "ui", "src", "use-deferred-dialog-open.ts"),
      "utf8"
    );
    const scheduleSource = readFileSync(
      join(ROOT, "packages", "ui", "src", "schedule-after-overlay.ts"),
      "utf8"
    );

    expect(deferredHook).toContain("export function useDeferredDialogOpen");
    expect(deferredHook).toContain("onAbandon");
    expect(dialogSource).toContain("useDeferredDialogOpen");
    expect(alertDialogSource).toContain("useDeferredDialogOpen");
    expect(scheduleSource).toContain("options.onAbandon");
    expect(scheduleSource).toContain("options.onAbandon?.()");
  });

  it("forbids menu item handlers from manually scheduling after overlay", () => {
    const offenders = PRODUCTION_SOURCE_ROOTS.flatMap(sourceFiles)
      .filter((filePath) =>
        MENU_ITEM_UNSAFE_OPEN_RE.test(readFileSync(filePath, "utf8"))
      )
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("defers dialog mount while body pointer-events are locked, then opens after unlock", async () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";

    const { getByRole, queryByRole, rerender } = render(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Deferred</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    expect(queryByRole("dialog")).toBeNull();

    rerender(
      <Dialog open={true}>
        <DialogContent>
          <DialogTitle>Deferred</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(queryByRole("dialog")).toBeNull();

    document.body.style.pointerEvents = "";
    await act(async () => {
      vi.runAllTimers();
    });

    // Dialog is mounted only after unlock; Radix itself may set body styles
    // while the open dialog is present, so do not assert body unlock here.
    expect(getByRole("dialog")).toBeTruthy();
  });

  it("documents that product open=true may remain unmounted until unlock", () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";
    const { getByTestId, rerender } = render(<OpenProbe open={false} />);
    rerender(<OpenProbe open={true} />);
    expect(getByTestId("open-probe").dataset.open).toBe("false");
    expect(getByTestId("open-probe").dataset.bodyPointerEvents).toBe("none");
  });
});
