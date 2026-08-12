import type { LspCatalogStatusRow } from "@shared/contracts/lsp-provider.ts";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";

function statusLabel(
  status: LspCatalogStatusRow["status"],
  t: ReturnType<typeof useT>
): string {
  if (status === "bundled") {
    return t("settings.row.lspToolsStatusBundled");
  }
  if (status === "available") {
    return t("settings.row.lspToolsStatusAvailable");
  }
  return t("settings.row.lspToolsStatusMissing");
}

/**
 * Read-only PATH / bundled language-server probe for Settings → Files.
 */
export function LspToolsStatusList() {
  const t = useT();
  const [rows, setRows] = useState<LspCatalogStatusRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await window.pier.lsp.catalogStatus();
        if (!cancelled) {
          setRows(list);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setFailed(true);
        }
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("settings.row.lspToolsLoading")}
      </p>
    );
  }
  if (failed || rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("settings.row.lspToolsEmpty")}
      </p>
    );
  }

  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <li
          className="flex flex-col gap-0.5 border-border/60 border-b pb-2 last:border-0 last:pb-0"
          key={row.id}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-sm">
              {row.displayName}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {statusLabel(row.status, t)}
            </span>
          </div>
          {row.status === "missing" && row.installCommand ? (
            <p className="font-mono text-muted-foreground text-xs leading-snug">
              {t("settings.row.lspToolsInstallHint", {
                command: row.installCommand,
              })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
