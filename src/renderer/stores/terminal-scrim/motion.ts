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
    flush();
    if (isFading(element)) {
      frame = requestAnimationFrame(step);
    }
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

  element.addEventListener("animationstart", onStart);
  element.addEventListener("transitionstart", onStart);
  if (isFading(element)) {
    start();
  }

  return () => {
    stop();
    element.removeEventListener("animationstart", onStart);
    element.removeEventListener("transitionstart", onStart);
  };
}

function isFading(element: HTMLElement): boolean {
  const animations = element.getAnimations?.() ?? [];
  return animations.some((animation) => isOpacityAnimation(animation));
}

/** 只跟 opacity：transition 的属性是 opacity，或 keyframe 名含 fade。 */
function isOpacityAnimation(animation: Animation): boolean {
  if (animation.playState !== "running") {
    return false;
  }
  if ("transitionProperty" in animation) {
    const property = animation.transitionProperty;
    return property === "opacity" || property === "all";
  }
  const name = "animationName" in animation ? animation.animationName : "";
  return typeof name === "string" && /fade/i.test(name);
}
