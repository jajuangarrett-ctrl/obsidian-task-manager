/** Keep collapsed disclosure content out of the DOM until it is requested. */
export function mountExpandedContent(section: HTMLDetailsElement, render: () => void): void {
  let mounted = false;
  const mount = () => {
    if (!section.open || mounted) return;
    mounted = true;
    render();
  };
  section.addEventListener("toggle", mount);
  mount();
}
