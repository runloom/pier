/**
 * 蒙层淡入淡出、toast 堆叠位移/高度变化期间按帧重读几何。挂载读一次会把
 * native 蒙层 / 终端洞钉在动画起点，底部状态栏在洞外却在逐帧变，两边错拍。
 * 只认运行中的 opacity / transform / height 动画：卡片上若挂无限动画
 * （pulse / spin），逐帧 flush 会把 IPC 快照链无限续命，必须让它到点停。
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
    if (!isMotionRunning(element)) {
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
  // transition 不会回弹到起点；opacity / transform / height 结束时补读终值。
  const onTransitionEnd = (event: Event) => {
    if (event.target !== element) {
      return;
    }
    const property = "propertyName" in event ? event.propertyName : "";
    if (typeof property === "string" && isFollowedTransition(property)) {
      flush();
    }
  };

  // 打断的 transition 没有终态，但下一帧仍是当前视觉位置，补读一次。
  const onTransitionCancel = onTransitionEnd;

  element.addEventListener("animationstart", onStart);
  element.addEventListener("transitionstart", onStart);
  element.addEventListener("animationend", onAnimationEnd);
  element.addEventListener("transitionend", onTransitionEnd);
  element.addEventListener("transitioncancel", onTransitionCancel);
  if (isMotionRunning(element)) {
    start();
  }

  return () => {
    stop();
    element.removeEventListener("animationstart", onStart);
    element.removeEventListener("transitionstart", onStart);
    element.removeEventListener("animationend", onAnimationEnd);
    element.removeEventListener("transitionend", onTransitionEnd);
    element.removeEventListener("transitioncancel", onTransitionCancel);
  };
}

function isExitAnimation(event: Event): boolean {
  const name = "animationName" in event ? event.animationName : "";
  return typeof name === "string" && /exit|out/i.test(name);
}

function isMotionRunning(element: HTMLElement): boolean {
  const animations = element.getAnimations?.() ?? [];
  return animations.some((animation) => isFollowedAnimation(animation));
}

function isFollowedTransition(property: string): boolean {
  return (
    property === "opacity" ||
    property === "transform" ||
    property === "height" ||
    property === "all"
  );
}

interface KeyframeEffectLike {
  getComputedTiming?: () => { iterations?: number };
  getKeyframes?: () => Keyframe[];
}

/**
 * 只跟会改变原生洞几何的属性：transition 的 opacity / transform / height，
 * 或 keyframes 真的动画这三者。tw-animate 的 `enter` / `exit` 名字不含 fade，
 * opacity 由 --tw-enter-opacity / --tw-exit-opacity 驱动；按名字匹配会把
 * Radix 弹层钉在挂载时的 opacity=0。
 */
function isFollowedAnimation(animation: Animation): boolean {
  if (animation.playState !== "running") {
    return false;
  }
  if ("transitionProperty" in animation) {
    const property = animation.transitionProperty;
    return typeof property === "string" && isFollowedTransition(property);
  }
  const effect = animation.effect as unknown as KeyframeEffectLike | null;
  // pulse / spin 这类无限动画不能把逐帧 flush 链无限续命。
  if (effect?.getComputedTiming?.().iterations === Number.POSITIVE_INFINITY) {
    return false;
  }
  if (
    effect
      ?.getKeyframes?.()
      .some(
        (frame) =>
          "opacity" in frame || "transform" in frame || "height" in frame
      )
  ) {
    return true;
  }
  const name = "animationName" in animation ? animation.animationName : "";
  return typeof name === "string" && /fade/i.test(name);
}
