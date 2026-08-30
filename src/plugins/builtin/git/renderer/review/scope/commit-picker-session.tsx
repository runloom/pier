import { Popover } from "@pier/ui/popover.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewCommitTarget } from "@shared/contracts/git/review.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GitReviewCommitPickerSessionContext } from "./commit-picker-context.tsx";
import { GitReviewCommitPickerList } from "./commit-picker-list.tsx";
import { visibleCommitCountInRange } from "./commit-range.ts";

export { useOptionalGitReviewCommitPickerSession } from "./commit-picker-context.tsx";

export function GitReviewCommitPickerSession({
  children,
  context,
  enabled,
  gitRootPath,
  onSelectTarget,
  selectedFromOid = null,
  selectedOid,
  visible = true,
}: {
  readonly children: ReactNode;
  readonly context: RendererPluginContext;
  readonly enabled: boolean;
  readonly gitRootPath: string;
  readonly onSelectTarget: (target: GitReviewCommitTarget) => void;
  readonly selectedFromOid?: string | null;
  readonly selectedOid: string | null;
  readonly visible?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [visibleOids, setVisibleOids] = useState<readonly string[]>([]);
  const [orderOids, setOrderOids] = useState<readonly string[]>([]);
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const [rememberedCommit, setRememberedCommit] = useState<{
    message: string;
    oid: string;
  } | null>(null);
  const [originOid, setOriginOid] = useState<string | null>(null);
  const originOidRef = useRef<string | null>(originOid);
  originOidRef.current = originOid;
  useEffect(() => {
    if (!(enabled && visible)) {
      setOpen(false);
    }
  }, [enabled, visible]);
  useEffect(() => {
    if (selectedOid === null) {
      setOriginOid(null);
      return;
    }
    setOriginOid((current) => {
      if (current === selectedOid || current === selectedFromOid) {
        return current;
      }
      if (
        current === null &&
        selectedFromOid !== null &&
        selectedFromOid !== selectedOid
      ) {
        return selectedOid;
      }
      return null;
    });
  }, [selectedFromOid, selectedOid]);
  useEffect(() => {
    if (
      selectedOid === null ||
      selectedFromOid === null ||
      selectedFromOid === selectedOid
    ) {
      setRangeCount(null);
      return;
    }
    const counted = visibleCommitCountInRange(
      selectedFromOid,
      selectedOid,
      orderOids
    );
    if (counted !== null) {
      setRangeCount(counted);
    }
  }, [orderOids, selectedFromOid, selectedOid]);
  return (
    <GitReviewCommitPickerSessionContext.Provider
      value={{
        enabled,
        open,
        orderOids,
        originOid,
        originOidRef,
        rangeCount,
        rememberCommit: setRememberedCommit,
        rememberedCommit,
        setOpen,
        setOrderOids,
        setOriginOid,
        setRangeCount,
        setVisibleOids,
        visibleOids,
      }}
    >
      <Popover
        modal={false}
        onOpenChange={(nextOpen) => {
          setOpen(enabled ? nextOpen : false);
        }}
        open={enabled && open}
      >
        {children}
        {enabled ? (
          <GitReviewCommitPickerList
            context={context}
            gitRootPath={gitRootPath}
            onSelectTarget={onSelectTarget}
            selectedFromOid={selectedFromOid}
            selectedOid={selectedOid}
          />
        ) : null}
      </Popover>
    </GitReviewCommitPickerSessionContext.Provider>
  );
}
