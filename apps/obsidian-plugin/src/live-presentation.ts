export const LIVE_SPLIT_MIN_WIDTH = 720;
const LIVE_SPLIT_EXIT_WIDTH = 680;

export function canSplitLive(width: number, alreadySplit: boolean): boolean {
  return width >= (alreadySplit ? LIVE_SPLIT_EXIT_WIDTH : LIVE_SPLIT_MIN_WIDTH);
}

const voiceViewportProperties = ['left', 'top', 'width', 'height'] as const;

/** Follow the space available to the native modal or workspace, including the iOS keyboard. */
export function followLiveViewport(host: HTMLElement, onWidth: (width: number) => void, reserveNavbar = false): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  const visual = win.visualViewport;
  let frame = 0;
  let settleUntil = 0;
  const measure = () => {
    frame = 0;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { onWidth(0); return; }
    const left = Math.max(rect.left, visual?.offsetLeft ?? 0);
    const top = Math.max(rect.top, visual?.offsetTop ?? 0);
    const viewportBottom = (visual?.offsetTop ?? 0) + (visual?.height ?? win.innerHeight);
    const width = Math.min(rect.right, (visual?.offsetLeft ?? 0) + (visual?.width ?? win.innerWidth)) - left;
    const navbar = reserveNavbar ? doc.querySelector('.mobile-navbar')?.getBoundingClientRect() : undefined;
    const navTop = navbar && navbar.width > 0 && navbar.height > 0 && navbar.top > top ? navbar.top : Infinity;
    const height = Math.min(rect.bottom, viewportBottom, navTop) - top;
    if (width <= 0 || height <= 0) { onWidth(0); return; }
    const pixels = [left - rect.left, top - rect.top, width, height];
    voiceViewportProperties.forEach((key, i) => {
      const prop = `--fjg-live-lane-${key}`, value = `${pixels[i]}px`;
      if (host.style.getPropertyValue(prop) !== value) host.style.setProperty(prop, value);
    });
    const keyboard = rect.bottom - viewportBottom > 80;
    if (host.classList.contains("fjg-live-lane-keyboard") !== keyboard) host.classList.toggle("fjg-live-lane-keyboard", keyboard);
    onWidth(width);
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(() => {
      measure();
      if (Date.now() < settleUntil) schedule();
    });
  };
  // Mobile drawers can translate the native root without changing its layout size.
  // Watch only the host/ancestor attributes and follow their transitions to the final
  // frame. Do not modify, close or unpin any Obsidian drawer.
  const movingHosts = new Set<HTMLElement>();
  for (let el: HTMLElement | null = host; el; el = el.parentElement) movingHosts.add(el);
  const onTransition = (event: Event) => {
    if (!movingHosts.has(event.target as HTMLElement)) return;
    if (event.type === "transitionrun") settleUntil = Date.now() + 500;
    schedule();
  };
  const transitions = ["transitionrun", "transitionend", "transitioncancel"];
  transitions.forEach(name => doc.addEventListener?.(name, onTransition, true));
  const mutations = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(schedule);
  movingHosts.forEach(el => mutations?.observe(el, { attributes: true, attributeFilter: ["class", "style"] }));

  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  observer?.observe(host);
  win.addEventListener('resize', schedule);
  visual?.addEventListener('resize', schedule);
  visual?.addEventListener('scroll', schedule);
  measure();
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    observer?.disconnect();
    mutations?.disconnect();
    transitions.forEach(name => doc.removeEventListener?.(name, onTransition, true));
    win.removeEventListener('resize', schedule);
    visual?.removeEventListener('resize', schedule);
    visual?.removeEventListener('scroll', schedule);
    voiceViewportProperties.forEach(key => host.style.removeProperty(`--fjg-live-lane-${key}`));
    host.classList.remove('fjg-live-lane-keyboard');
  };
}
