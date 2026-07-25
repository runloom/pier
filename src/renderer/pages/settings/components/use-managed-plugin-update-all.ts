import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import type { ManagedPluginsWindowShim } from "./managed-plugin-rows.tsx";
import {
  formatManagedPluginUpdateAllAlertBody,
  listUpdatableManagedPlugins,
  runManagedPluginUpdateAll,
} from "./managed-plugin-update-all.ts";

export function useManagedPluginUpdateAll(input: {
  catalog: ManagedPluginCatalogSnapshot | null;
  refresh: () => void;
  win: ManagedPluginsWindowShim | undefined;
}): {
  showUpdateAll: boolean;
  updatingAll: boolean;
  handleUpdateAll: () => void;
} {
  const t = useT();
  const { catalog, refresh, win } = input;
  const [updatingAll, setUpdatingAll] = useState(false);
  const officialMutationsAllowed = catalog?.officialMutationsAllowed ?? true;
  const updatable = listUpdatableManagedPlugins(
    catalog,
    officialMutationsAllowed
  );
  const showUpdateAll = updatable.length >= 2;

  const handleUpdateAll = useCallback((): void => {
    if (updatingAll) return;
    const targets = listUpdatableManagedPlugins(
      catalog,
      catalog?.officialMutationsAllowed ?? true
    );
    if (targets.length < 2) return;
    const updateFn = win?.managedPlugins?.update;
    if (!updateFn) return;

    setUpdatingAll(true);
    const loadingId = toast.loading(t("settings.plugins.toast.updatingAll"));

    runManagedPluginUpdateAll({
      targets,
      update: (id) => updateFn(id),
      onProgress: (current, total) => {
        toast.loading(
          t("settings.plugins.toast.updatingAllProgress", { current, total }),
          { id: loadingId }
        );
      },
    })
      .then((result) => {
        const { successes, failures } = result;
        if (failures.length === 0) {
          toast.success(
            t("settings.plugins.toast.updatedAll", {
              count: successes.length,
            }),
            { id: loadingId }
          );
          return;
        }
        toast.dismiss(loadingId);
        const successSummaryLabel =
          successes.length > 0
            ? t("settings.plugins.toast.updateAllSuccessSummary", {
                count: successes.length,
              })
            : "";
        showAppAlert({
          title: t(
            successes.length === 0
              ? "settings.plugins.toast.updateAllFailedTitle"
              : "settings.plugins.toast.updateAllPartialTitle"
          ),
          body: formatManagedPluginUpdateAllAlertBody({
            successCount: successes.length,
            failures,
            successSummaryLabel,
          }),
        });
      })
      .catch((err: unknown) => {
        toast.dismiss(loadingId);
        showAppAlert({
          title: t("settings.plugins.toast.updateAllFailedTitle"),
          body: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        setUpdatingAll(false);
        refresh();
      });
  }, [catalog, refresh, t, updatingAll, win]);

  return { showUpdateAll, updatingAll, handleUpdateAll };
}
