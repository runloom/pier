/**
 * Diff 文件头路径（shadow 内 [data-title] > bdi）的 mono + hover 下划线。
 *
 * **权威路径是 postRender DOM 绑定**（本模块）。unsafeCSS 只保留 cursor 兜底，
 * 不负责 hover 下划线：HMR/useMemo 可能钉死旧 CSS，且 text-decoration 在
 * direction:rtl + overflow 下不稳定。与 estimate-skeleton 一样在 onPostRender 钉 DOM。
 *
 * 绑定 token 用元素上的 CLEANUP_KEY（不是 dataset）：Pierre 可能清 data-* 却复用节点。
 */

const MONO_FONT =
  "var(--pier-mono-font-family, var(--diffs-font-family, var(--diffs-font-fallback, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)))";

const CLEANUP_KEY = "__pierPathTitleChromeCleanup";

type TitleWithCleanup = HTMLElement & {
  [CLEANUP_KEY]?: () => void;
};

function setHoverDecoration(target: HTMLElement, on: boolean): void {
  if (on) {
    target.style.setProperty("text-decoration", "underline");
    target.style.setProperty("text-decoration-skip-ink", "none");
    target.style.setProperty("-webkit-text-decoration-skip", "none");
    target.style.setProperty("text-underline-offset", "2px");
    return;
  }
  target.style.removeProperty("text-decoration");
  target.style.removeProperty("text-decoration-skip-ink");
  target.style.removeProperty("-webkit-text-decoration-skip");
  target.style.removeProperty("text-underline-offset");
}

function applyBaseChrome(title: HTMLElement): void {
  title.style.setProperty("cursor", "pointer");
  title.style.setProperty("font-family", MONO_FONT);
  title.style.setProperty("font-weight", "400");
  for (const node of title.querySelectorAll("bdi")) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    node.style.setProperty("font-family", "inherit");
    node.style.setProperty("font-weight", "400");
  }
}

function applyHover(title: HTMLElement, on: boolean): void {
  setHoverDecoration(title, on);
  for (const node of title.querySelectorAll("bdi")) {
    if (node instanceof HTMLElement) {
      setHoverDecoration(node, on);
    }
  }
}

function detachPathTitleChrome(title: TitleWithCleanup): void {
  title[CLEANUP_KEY]?.();
}

function attachPathTitleChrome(title: TitleWithCleanup): void {
  // CLEANUP_KEY 是唯一绑定 token：已绑定时只刷新 base chrome，不叠监听。
  if (title[CLEANUP_KEY]) {
    applyBaseChrome(title);
    return;
  }

  applyBaseChrome(title);

  const onEnter = () => {
    applyHover(title, true);
  };
  const onLeave = () => {
    applyHover(title, false);
  };
  title.addEventListener("pointerenter", onEnter);
  title.addEventListener("pointerleave", onLeave);

  title[CLEANUP_KEY] = () => {
    title.removeEventListener("pointerenter", onEnter);
    title.removeEventListener("pointerleave", onLeave);
    applyHover(title, false);
    title.style.removeProperty("cursor");
    title.style.removeProperty("font-family");
    title.style.removeProperty("font-weight");
    for (const node of title.querySelectorAll("bdi")) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      node.style.removeProperty("font-family");
      node.style.removeProperty("font-weight");
    }
    delete title[CLEANUP_KEY];
  };
}

/**
 * 在 diffs-container 的 shadowRoot 内给路径标题挂 mono + hover 下划线。
 * 可重复调用；已绑定（CLEANUP_KEY）则只重刷 base。unmount 时传 clear=true。
 */
export function syncPathTitleChrome(element: HTMLElement, clear = false): void {
  const root = element.shadowRoot;
  if (root == null) {
    return;
  }
  const title = root.querySelector<TitleWithCleanup>("[data-title]");
  if (title == null) {
    return;
  }

  if (clear) {
    detachPathTitleChrome(title);
    return;
  }

  attachPathTitleChrome(title);
}
