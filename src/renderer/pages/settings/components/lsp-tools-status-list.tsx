import { Button } from "@pier/ui/button.tsx";
import {
  COLLECTION_LSP_TOOL_ITEM_MIN_WIDTH,
  collectionAutoFitClassName,
  collectionAutoFitStyle,
  collectionLayoutMode,
} from "@pier/ui/collection-auto-layout.ts";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { LspCatalogStatusRow } from "@shared/contracts/lsp-provider.ts";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";

const COPY_FEEDBACK_MS = 1500;
const VERSION_TOKEN = /v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?/u;

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

function leafName(pathValue: string): string {
  const leaf = pathValue.split(/[\\/]/u).at(-1)?.trim();
  return leaf && leaf.length > 0 ? leaf : pathValue;
}

function shortVersion(version: string): string {
  return version.match(VERSION_TOKEN)?.[0] ?? version;
}

function availableDetail(row: LspCatalogStatusRow): string | undefined {
  const binary = row.resolvedPath ? leafName(row.resolvedPath) : undefined;
  const version = row.version ? shortVersion(row.version) : undefined;
  if (binary && version) {
    return `${binary} ${version}`;
  }
  return version ?? binary;
}

async function copyText(text: string): Promise<void> {
  const write = window.pier?.clipboard?.writeText;
  if (write) {
    await write(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function CopyInstallButton({
  command,
  name,
}: {
  command: string;
  name: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      window.clearTimeout(resetRef.current);
    },
    []
  );

  return (
    <Button
      aria-label={
        copied
          ? t("settings.row.lspToolsCopied")
          : t("settings.row.lspToolsCopyInstall", { name })
      }
      onClick={() => {
        copyText(command)
          .then(() => {
            if (!mountedRef.current) {
              return;
            }
            window.clearTimeout(resetRef.current);
            setCopied(true);
            resetRef.current = window.setTimeout(() => {
              if (mountedRef.current) {
                setCopied(false);
              }
            }, COPY_FEEDBACK_MS);
          })
          .catch(() => {
            if (mountedRef.current) {
              toast.error(t("settings.row.lspToolsCopyFailed"));
            }
          });
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
    </Button>
  );
}

function LspToolsStatusSkeleton({ label }: { label: string }) {
  const placeholders = ["a", "b", "c", "d"] as const;
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={collectionAutoFitClassName(placeholders.length, {
        gapClassName: "gap-2",
        singleAs: "block",
      })}
      data-testid="lsp-tools-status-loading"
      role="status"
      style={collectionAutoFitStyle(
        placeholders.length,
        COLLECTION_LSP_TOOL_ITEM_MIN_WIDTH
      )}
    >
      {placeholders.map((id) => (
        <Skeleton className="h-16 w-full" key={id} />
      ))}
    </div>
  );
}

function LspToolStatusItem({ row }: { row: LspCatalogStatusRow }) {
  const t = useT();
  const detail = availableDetail(row);
  const installCommand =
    row.status === "missing" ? row.installCommand : undefined;

  return (
    <Item className="h-full min-w-0" size="sm" variant="outline">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle>{row.displayName}</ItemTitle>
        {detail ? (
          <p className="truncate font-mono text-muted-foreground text-xs">
            {detail}
          </p>
        ) : null}
        {installCommand ? (
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="min-w-0 truncate font-mono text-muted-foreground text-xs"
              title={installCommand}
            >
              {installCommand}
            </span>
            <CopyInstallButton
              command={installCommand}
              name={row.displayName}
            />
          </div>
        ) : null}
      </ItemContent>
      <ItemActions>
        <span className="text-muted-foreground text-xs">
          {statusLabel(row.status, t)}
        </span>
      </ItemActions>
    </Item>
  );
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
    return <LspToolsStatusSkeleton label={t("settings.row.lspToolsLoading")} />;
  }
  if (failed) {
    return (
      <div
        className="flex flex-col gap-1"
        data-testid="lsp-tools-status-failed"
      >
        <p className="text-sm">{t("settings.row.lspToolsEmpty")}</p>
        <p className="text-muted-foreground text-sm">
          {t("settings.row.lspToolsEmptyDesc")}
        </p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-1" data-testid="lsp-tools-status-empty">
        <p className="text-sm">{t("settings.row.lspToolsNone")}</p>
        <p className="text-muted-foreground text-sm">
          {t("settings.row.lspToolsNoneDesc")}
        </p>
      </div>
    );
  }

  const layout = collectionLayoutMode(rows.length);
  return (
    <ItemGroup
      aria-label={t("settings.row.lspToolsTitle")}
      className={collectionAutoFitClassName(rows.length, {
        gapClassName: "gap-2",
        singleAs: "block",
      })}
      data-layout={layout}
      data-testid="lsp-tools-status-list"
      style={collectionAutoFitStyle(
        rows.length,
        COLLECTION_LSP_TOOL_ITEM_MIN_WIDTH
      )}
    >
      {rows.map((row) => (
        <li className="min-w-0" key={row.id}>
          <LspToolStatusItem row={row} />
        </li>
      ))}
    </ItemGroup>
  );
}
