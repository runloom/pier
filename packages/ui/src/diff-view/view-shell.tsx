import type { CodeViewOptions } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
} from "react";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import { PierDiffWorkerProvider } from "./worker.tsx";

type PierCodeViewItem = CodeViewItem<PierDiffAnnotationMetadata>;

/**
 * diffs-container 的 overflow / contain 仍在 light DOM（自定义元素宿主）。
 * 文件间 1px 分隔在 shadow `:host::after`（appearance.ts）。不要给宿主画
 * box-shadow：inset 会被不透明文件头盖住，顶外阴影会在 align:start 露出发丝。
 */
export const PIER_DIFF_CODE_VIEW_CLASSNAME =
  "cv-scrollbar relative h-full min-h-0 w-full min-w-0 flex-1 overflow-auto overscroll-contain border-border border-b [contain:strict] [overflow-anchor:none] [scrollbar-gutter:auto] [will-change:scroll-position] md:border-b-0 [&_diffs-container]:overflow-x-visible [&_diffs-container]:[contain:layout_paint_style]";

export function PierDiffViewShell(props: {
  readonly codeThemes: { readonly dark: string; readonly light: string };
  readonly codeViewItems: PierCodeViewItem[];
  readonly codeViewKey: string;
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
  readonly handleCodeViewScroll: () => void;
  readonly handleHeaderClickCapture: (
    event: MouseEvent<HTMLDivElement>
  ) => void;
  readonly handleContextMenuCapture: (
    event: MouseEvent<HTMLDivElement>
  ) => void;
  readonly handlePointerDownCapture: (
    event: PointerEvent<HTMLDivElement>
  ) => void;
  readonly handleUserScrollIntent: () => void;
  readonly handleUserScrollKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onError: (error: Error) => void;
  readonly onUnavailable: () => void;
  readonly options: CodeViewOptions<PierDiffAnnotationMetadata>;
  readonly renderAnnotation?: (
    annotation: { readonly metadata?: PierDiffAnnotationMetadata },
    item: { readonly id: string }
  ) => ReactNode;
  readonly renderHeaderMetadata: (item: PierCodeViewItem) => ReactNode;
  readonly renderHeaderPrefix: (item: PierCodeViewItem) => ReactNode;
  readonly style: CSSProperties;
  readonly workerUnavailable: boolean;
}): React.JSX.Element {
  const codeView = (
    <CodeView
      className={PIER_DIFF_CODE_VIEW_CLASSNAME}
      data-scrollbar="overlay"
      disableWorkerPool={props.workerUnavailable}
      initialItems={props.codeViewItems}
      key={props.codeViewKey}
      onScroll={props.handleCodeViewScroll}
      options={props.options}
      ref={props.codeViewRef}
      {...(props.renderAnnotation
        ? { renderAnnotation: props.renderAnnotation }
        : {})}
      renderHeaderMetadata={props.renderHeaderMetadata}
      renderHeaderPrefix={props.renderHeaderPrefix}
      style={props.style}
    />
  );
  return (
    <div
      className="h-full"
      data-testid="pierre-diff-root"
      onClickCapture={props.handleHeaderClickCapture}
      onContextMenuCapture={props.handleContextMenuCapture}
      onKeyDownCapture={props.handleUserScrollKey}
      onPointerDownCapture={props.handlePointerDownCapture}
      onTouchMoveCapture={props.handleUserScrollIntent}
      onWheelCapture={props.handleUserScrollIntent}
    >
      {props.workerUnavailable ? (
        codeView
      ) : (
        <PierDiffWorkerProvider
          onError={props.onError}
          onUnavailable={props.onUnavailable}
          theme={props.codeThemes}
        >
          {codeView}
        </PierDiffWorkerProvider>
      )}
    </div>
  );
}
