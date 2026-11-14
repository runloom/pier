/**
 * 蒙层淡入淡出期间按帧重读 opacity。挂载读一次会把 native 蒙层钉在
 * 动画起点（通常是 0 或终值），底部状态栏在洞外却在逐帧变，两边错拍。
 * 只认 opacity 相关的运行中动画：卡片上若挂无限动画（pulse / spin），
 * 逐帧 flush 会把 IPC 快照链无限续命，必须让它到点停。
 */
export function bindScrimFade(
  element: HTMLElement,
  flush: () => void
): () => void {
  let frame: number | null = null;

  const stop = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const step = () => {
    frame = null;
    // 先确认动画仍在跑再读色：fill-mode none 的淡出结束后 computed opacity
    // 会回弹到 1，再读一次会把阴影/蒙层按全强度重发一帧（终端上闪一下）。
    if (!isFading(element)) {
      return;
    }
    flush();
    frame = requestAnimationFrame(step);
  };

  const start = () => {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(step);
  };

  const onStart = (event: Event) => {
    if (event.target === element) {
      start();
    }
  };

  // rAF 链在动画结束前的最后一帧就停了（step 先判 isFading）。进场动画
  // 的终值是 opacity 1，补读一次拿到终帧；退场动画结束后 fill-mode none
  // 会回弹到 1，不能读，否则按全强度重发一帧。
  const onAnimationEnd = (event: Event) => {
    if (event.target !== element || isExitAnimation(event)) {
      return;
    }
    flush();
  };
  // transition 不会回弹到起点；opacity / all 结束时补读终值。
  const onTransitionEnd = (event: Event) => {
    if (event.target !== element) {
      return;
    }
    const property = "propertyName" in event ? event.propertyName : "";
    if (property === "opacity" || property === "all") {
      flush();
    }
  };

  element.addEventListener("animationstart", onStart);
  element.addEventListener("transitionstart", onStart);
  element.addEventListener("animationend", onAnimationEnd);
  element.addEventListener("transitionend", onTransitionEnd);
  if (isFading(element)) {
    start();
  }

  return () => {
    stop();
    element.removeEventListener("animationstart", onStart);
    element.removeEventListener("transitionstart", onStart);
    element.removeEventListener("animationend", onAnimationEnd);
    element.removeEventListener("transitionend", onTransitionEnd);
  };
}

function isExitAnimation(event: Event): boolean {
  const name = "animationName" in event ? event.animationName : "";
  return typeof name === "string" && /exit|out/i.test(name);
}

function isFading(element: HTMLElement): boolean {
  const animations = element.getAnimations?.() ?? [];
  return animations.some((animation) => isOpacityAnimation(animation));
}

interface KeyframeEffectLike {
  getComputedTiming?: () => { iterations?: number };
  getKeyframes?: () => Keyframe[];
}

/**
 * 只跟 opacity：transition 的属性是 opacity，或 keyframes 真的在动画 opacity。
 * tw-animate 的 `enter` / `exit` 名字不含 fade，opacity 由 --tw-enter-opacity /
 * --tw-exit-opacity 驱动；按名字匹配会把 Radix 弹层钉在挂载时的 opacity=0。
 */
function isOpacityAnimation(animation: Animation): boolean {
  if (animation.playState !== "running") {
    return false;
  }
  if ("transitionProperty" in animation) {
    const property = animation.transitionProperty;
    return property === "opacity" || property === "all";
  }
  const effect = animation.effect as unknown as KeyframeEffectLike | null;
  // pulse / spin 这类无限动画不能把逐帧 flush 链无限续命。
  if (effect?.getComputedTiming?.().iterations === Number.POSITIVE_INFINITY) {
    return false;
  }
  if (effect?.getKeyframes?.().some((frame) => "opacity" in frame)) {
    return true;
  }
  const name = "animationName" in animation ? animation.animationName : "";
  return typeof name === "string" && /fade/i.test(name);
}
