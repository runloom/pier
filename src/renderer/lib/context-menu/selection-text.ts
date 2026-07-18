import type { ActionInvocation } from "@/lib/actions/types.ts";

export type SelectionTextProvider = () => string;
export type SelectionSelectAllProvider = () => boolean;

const selectionTextProviders = new Set<SelectionTextProvider>();
const selectionSelectAllProviders = new Set<SelectionSelectAllProvider>();

/**
 * 注册非 DOM 选区提供者（如 Pierre Diff 行选区）。
 * 返回 disposer；popup 前会按注册顺序取第一个非空文本。
 */
export function registerSelectionTextProvider(
  provider: SelectionTextProvider
): () => void {
  selectionTextProviders.add(provider);
  return () => {
    selectionTextProviders.delete(provider);
  };
}

/**
 * 注册面板级「全选」实现（如 Pierre Diff selectAll）。
 * 返回 disposer；菜单点击时取第一个返回 true 的 provider。
 */
export function registerSelectionSelectAllProvider(
  provider: SelectionSelectAllProvider
): () => void {
  selectionSelectAllProviders.add(provider);
  return () => {
    selectionSelectAllProviders.delete(provider);
  };
}

function captureProviderSelectionText(): string {
  for (const provider of selectionTextProviders) {
    try {
      const text = provider().replace(/\u00a0/g, " ");
      if (text.length > 0) {
        return text;
      }
    } catch {
      // 单个 provider 失败不阻断其它路径
    }
  }
  return "";
}

/**
 * 右键打开菜单瞬间的选区文本。
 * 优先 provider（Pierre live getSelectedText）→ DOM 选区。
 * 不再读全局 memory：选区真相在 Pierre / 打开菜单时的快照。
 */
export function captureDomSelectionText(): string {
  const fromProvider = captureProviderSelectionText();
  if (fromProvider.length > 0) {
    return fromProvider;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    const text = selection.toString().replace(/\u00a0/g, " ");
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

export function runSelectionSelectAll(): boolean {
  for (const provider of selectionSelectAllProviders) {
    try {
      if (provider()) {
        return true;
      }
    } catch {
      // 单个 provider 失败不阻断其它路径
    }
  }
  return false;
}

export function selectedTextFromInvocation(
  invocation?: ActionInvocation
): string {
  const raw = invocation?.metadata?.selectedText;
  return typeof raw === "string" ? raw : "";
}

/** 已有自管复制/全选，或无可复制选区的 surface，不并入共享编辑项。 */
export function surfaceHasLocalCopyAction(
  surface: string | undefined
): boolean {
  return (
    surface === "terminal/content" ||
    surface === "files/editor" ||
    surface === "files/tree-item" ||
    surface === "files/tree-background" ||
    surface === "git/review-tree-item"
  );
}
